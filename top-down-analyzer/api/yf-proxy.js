// Production Yahoo Finance proxy for Vercel serverless.
// Mirrors the Vite dev proxy in vite.config.js — that file only runs locally.
// In production every /yf-api/* request is rewritten here by vercel.json.

import https from 'node:https'

// Module-level state persists within a warm serverless instance.
// Cold starts re-fetch credentials; ensureCrumb() guards against concurrent refreshes.
const yf = { cookie: '', crumb: '', ts: 0 }
const CRUMB_TTL = 40 * 60 * 1000   // 40-minute cache
let pending = null

// HTTPS GET with redirect following and Set-Cookie accumulation.
// Identical to the version in vite.config.js.
function nodeGet(hostname, path, extraHeaders = {}, accCookies = '', hop = 0) {
  return new Promise((resolve, reject) => {
    if (hop > 6) { reject(new Error('Too many redirects')); return }
    const headers = {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          'text/html,application/xhtml+xml,*/*;q=0.9',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'en-US,en;q=0.9',
      ...extraHeaders,
    }
    if (accCookies) headers['Cookie'] = accCookies

    const req = https.request({ hostname, path, method: 'GET', headers, maxHeaderSize: 65536 }, res => {
      const map = {}
      for (const pair of (accCookies || '').split('; ').filter(Boolean)) {
        const i = pair.indexOf('='); if (i > 0) map[pair.slice(0, i)] = pair.slice(i + 1)
      }
      for (const raw of [].concat(res.headers['set-cookie'] || [])) {
        const pair = raw.split(';')[0]; const i = pair.indexOf('=')
        if (i > 0) map[pair.slice(0, i)] = pair.slice(i + 1)
      }
      const merged = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ')

      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        const loc = res.headers.location
        try {
          const u = new URL(loc.startsWith('http') ? loc : `https://${hostname}${loc}`)
          nodeGet(u.hostname, u.pathname + u.search, extraHeaders, merged, hop + 1).then(resolve).catch(reject)
        } catch (e) { reject(e) }
        return
      }

      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, cookies: merged, body }))
    })
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timeout')) })
    req.on('error', reject)
    req.end()
  })
}

async function refreshCrumb() {
  const r1 = await nodeGet('finance.yahoo.com', '/quote/SPY/options', { Referer: 'https://www.google.com/' })
  yf.cookie = r1.cookies
  console.log('[YF] Session cookies length:', yf.cookie.length)

  if (yf.cookie) {
    try {
      const r2 = await nodeGet(
        'query1.finance.yahoo.com',
        '/v1/test/getcrumb',
        { Referer: 'https://finance.yahoo.com/quote/SPY/options' },
        yf.cookie
      )
      const crumb = r2.body.trim()
      if (crumb && !crumb.startsWith('<') && crumb !== 'null' && crumb.length >= 3) {
        yf.crumb = crumb
        yf.ts    = Date.now()
        console.log('[YF] Crumb via API:', yf.crumb.slice(0, 6) + '…')
        return
      }
    } catch (_) {}
  }

  const m = r1.body.match(/"crumb"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  if (m) {
    yf.crumb = m.replace(/\\\//g, '/').replace(/\\"/g, '"')
    yf.ts    = Date.now()
    console.log('[YF] Crumb from HTML:', yf.crumb.slice(0, 6) + '…')
    return
  }

  throw new Error('Failed to obtain Yahoo Finance crumb — will retry on next request')
}

async function ensureCrumb() {
  if (yf.crumb && Date.now() - yf.ts < CRUMB_TTL) return
  if (pending) return pending
  pending = refreshCrumb().finally(() => { pending = null })
  return pending
}

export default async function handler(req, res) {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  // yfpath comes from the Vercel rewrite: /yf-api/(.*) → /api/yf-proxy?yfpath=$1
  let yfpath = req.query.yfpath || ''
  if (!yfpath.startsWith('/')) yfpath = '/' + yfpath

  // Rebuild query string — all params forwarded except yfpath (our routing param)
  const qs = new URLSearchParams()
  for (const [key, val] of Object.entries(req.query)) {
    if (key !== 'yfpath') qs.append(key, val)
  }

  // Options/quoteSummary endpoints require an authenticated crumb.
  // Also ensure we have a session cookie before any chart data request.
  const needsCrumb = yfpath.includes('/v7/finance/options') || yfpath.includes('/v10/finance/quoteSummary')
  if (needsCrumb || !yf.cookie) {
    try { await ensureCrumb() } catch (e) { console.warn('[YF crumb]', e.message) }
  }
  if (needsCrumb && yf.crumb) qs.set('crumb', yf.crumb)

  const qstr = qs.toString()
  const targetPath = yfpath + (qstr ? '?' + qstr : '')

  return new Promise((resolve) => {
    const headers = {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':          'application/json, text/plain, */*',
      'Accept-Encoding': 'identity',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer':         'https://finance.yahoo.com',
    }
    if (yf.cookie) headers['Cookie'] = yf.cookie

    const yfReq = https.request({
      hostname: 'query1.finance.yahoo.com',
      path:     targetPath,
      method:   'GET',
      headers,
    }, (yfRes) => {
      if (yfRes.statusCode === 401 || yfRes.statusCode === 403) {
        yf.crumb = ''; yf.ts = 0
        console.warn('[YF] Auth error on', yfpath, '— crumb cleared, auto-refresh on next request')
      }

      const ct = yfRes.headers['content-type']
      if (ct) res.setHeader('Content-Type', ct)
      res.statusCode = yfRes.statusCode
      yfRes.pipe(res)
      yfRes.on('end', resolve)
    })

    yfReq.setTimeout(9000, () => {
      yfReq.destroy()
      if (!res.headersSent) {
        res.statusCode = 504
        res.end(JSON.stringify({ error: 'Yahoo Finance request timed out' }))
      }
      resolve()
    })

    yfReq.on('error', err => {
      console.error('[YF proxy error]', err.message)
      if (!res.headersSent) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Proxy error', message: err.message }))
      }
      resolve()
    })

    yfReq.end()
  })
}
