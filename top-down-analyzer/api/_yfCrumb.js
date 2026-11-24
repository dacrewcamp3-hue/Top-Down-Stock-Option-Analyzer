// Shared Yahoo Finance session/crumb logic.
//
// This is the SINGLE source of truth for Yahoo auth, imported by BOTH:
//   • vite.config.js        (local dev proxy)
//   • api/yf-proxy.js       (Vercel serverless prod proxy)
//
// The leading underscore keeps Vercel from exposing this file as an API route
// (it is a helper module, not an endpoint) while still bundling it for yf-proxy.js.
//
// Before this module existed the crumb logic was duplicated in both files and had
// to be kept byte-for-byte in sync — when Yahoo changed auth, you had to fix it twice.

import https from 'node:https'

// Yahoo serves the same API from two hosts. If one throttles or 5xx's, the caller
// can fail over to the other without touching a different vendor.
export const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']

// Module-level cache. In dev this lives in the Vite process; in prod it persists
// within a warm serverless container instance.
const yf = { cookie: '', crumb: '', ts: 0 }
const CRUMB_TTL = 40 * 60 * 1000   // 40-minute cache
let pending = null

// HTTPS GET that follows redirects and accumulates Set-Cookie across hops.
// Accept-Encoding: identity so we always get plain text (no gzip decode needed).
// Returns the body as a Buffer so binary-safe; callers .toString() when they need text.
export function nodeGet(hostname, path, extraHeaders = {}, accCookies = '', hop = 0) {
  return new Promise((resolve, reject) => {
    if (hop > 6) { reject(new Error('Too many redirects')); return }
    const headers = {
      'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':           'text/html,application/xhtml+xml,*/*;q=0.9',
      'Accept-Encoding':  'identity',
      'Accept-Language':  'en-US,en;q=0.9',
      ...extraHeaders,
    }
    if (accCookies) headers['Cookie'] = accCookies

    const req = https.request({ hostname, path, method: 'GET', headers, maxHeaderSize: 65536 }, res => {
      // Merge new Set-Cookie values into accCookies
      const map = {}
      for (const pair of (accCookies || '').split('; ').filter(Boolean)) {
        const i = pair.indexOf('='); if (i > 0) map[pair.slice(0, i)] = pair.slice(i + 1)
      }
      for (const raw of [].concat(res.headers['set-cookie'] || [])) {
        const pair = raw.split(';')[0]; const i = pair.indexOf('=')
        if (i > 0) map[pair.slice(0, i)] = pair.slice(i + 1)
      }
      const merged = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ')

      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        const loc = res.headers.location
        try {
          const u = new URL(loc.startsWith('http') ? loc : `https://${hostname}${loc}`)
          nodeGet(u.hostname, u.pathname + u.search, extraHeaders, merged, hop + 1)
            .then(resolve).catch(reject)
        } catch (e) { reject(e) }
        return
      }

      const chunks = []
      res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, cookies: merged, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

export async function refreshCrumb() {
  // Visit a real Yahoo Finance options page — more likely to produce a valid session
  // than the homepage, and Referer: Google makes it look like organic traffic.
  const r1 = await nodeGet('finance.yahoo.com', '/quote/SPY/options', { Referer: 'https://www.google.com/' })
  yf.cookie = r1.cookies

  // Strategy A: exchange session cookies for a crumb via the dedicated endpoint
  if (yf.cookie) {
    try {
      const r2 = await nodeGet(
        'query1.finance.yahoo.com',
        '/v1/test/getcrumb',
        { Referer: 'https://finance.yahoo.com/quote/SPY/options' },
        yf.cookie
      )
      const crumb = r2.body.toString().trim()
      if (crumb && !crumb.startsWith('<') && crumb !== 'null' && crumb.length >= 3) {
        yf.crumb = crumb; yf.ts = Date.now(); return
      }
    } catch (_) {}
  }

  // Strategy B: extract crumb that Yahoo Finance embeds in the page JSON
  const m = r1.body.toString().match(/"crumb"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  if (m) {
    yf.crumb = m.replace(/\\\//g, '/').replace(/\\"/g, '"')
    yf.ts = Date.now()
    return
  }
  throw new Error('Failed to obtain Yahoo Finance crumb — will retry on next request')
}

export async function ensureCrumb() {
  if (yf.crumb && Date.now() - yf.ts < CRUMB_TTL) return
  if (pending) return pending
  pending = refreshCrumb().finally(() => { pending = null })
  return pending
}

export const getCookie       = () => yf.cookie
export const getCrumb        = () => yf.crumb
export const invalidateCrumb = () => { yf.crumb = ''; yf.ts = 0 }

// The authenticated endpoints that require a crumb appended to the query string.
export const needsCrumb = (path = '') =>
  path.includes('/v7/finance/options/') || path.includes('/v10/finance/quoteSummary/')
