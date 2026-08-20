import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'node:https'

// ── Yahoo Finance crumb cache ──────────────────────────────────────────────────
const yf = { cookie: '', crumb: '', ts: 0 }
const CRUMB_TTL = 40 * 60 * 1000   // 40-minute cache
let pending = null

// HTTPS GET that follows redirects and accumulates Set-Cookie across hops.
// Using Accept-Encoding: identity so we always get plain text (no gzip decode needed).
function nodeGet(hostname, path, extraHeaders = {}, accCookies = '', hop = 0) {
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

      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, cookies: merged, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function refreshCrumb() {
  // Visit a real Yahoo Finance options page — more likely to produce a valid session
  // than the homepage, and Referer: Google makes it look like organic traffic.
  const r1 = await nodeGet(
    'finance.yahoo.com',
    '/quote/SPY/options',
    { Referer: 'https://www.google.com/' }
  )
  yf.cookie = r1.cookies
  console.log('[YF] Session cookies length:', yf.cookie.length)

  // Strategy A: exchange session cookies for a crumb via the dedicated endpoint
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

  // Strategy B: extract crumb that Yahoo Finance embeds in the page JSON
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

// Intercepts /v7/finance/options/ requests before the proxy touches them:
// appends ?crumb=... to the URL and injects the session cookie.
function yfCrumbPlugin() {
  return {
    name: 'yf-crumb',
    configureServer(server) {
      // Eagerly establish the YF session on server start so chart data requests
      // (which now forward the cookie) already have valid auth on the first ticker load.
      refreshCrumb().catch(e => console.warn('[YF prewarm]', e.message))

      server.middlewares.use(async (req, _res, next) => {
        if (req.url?.includes('/v7/finance/options/') || req.url?.includes('/v10/finance/quoteSummary/')) {
          try { await ensureCrumb() } catch (e) { console.warn('[YF crumb]', e.message) }
          if (yf.crumb) {
            const sep = req.url.includes('?') ? '&' : '?'
            req.url  += sep + 'crumb=' + encodeURIComponent(yf.crumb)
          }
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), yfCrumbPlugin()],
  server: {
    proxy: {
      '/yf-api': {
        target:       'https://query1.finance.yahoo.com',
        changeOrigin: true,
        secure:       true,
        rewrite:      path => path.replace(/^\/yf-api/, ''),
        configure:    proxy => {
          proxy.on('proxyReq', (proxyReq, _req) => {
            proxyReq.setHeader('User-Agent',      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
            proxyReq.setHeader('Accept',          'application/json, text/plain, */*')
            proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9')
            proxyReq.setHeader('Referer',         'https://finance.yahoo.com')
            // Forward session cookie for ALL Yahoo Finance requests — the chart (v8/finance/chart)
            // endpoint also requires an authenticated session or Yahoo returns 401/empty data.
            if (yf.cookie) proxyReq.setHeader('Cookie', yf.cookie)
          })
          // Auto-invalidate crumb on any 401/403 from Yahoo so the next request re-authenticates.
          proxy.on('proxyRes', (proxyRes, req) => {
            if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
              yf.crumb = ''
              yf.ts    = 0
              console.warn('[YF] Auth error on', req.url?.split('?')[0], '— crumb cleared, auto-refresh on next request')
            }
          })
        },
      },
      // SEC EDGAR full-text search — used for Form 4 insider filing lookups
      '/sec-efts': {
        target:       'https://efts.sec.gov',
        changeOrigin: true,
        secure:       true,
        rewrite:      path => path.replace(/^\/sec-efts/, ''),
        configure:    proxy => {
          proxy.on('proxyReq', proxyReq => {
            proxyReq.setHeader('User-Agent', 'Top-Down-Stock-Option-Analyzer/1.0 (contact: dacrewcamp3@gmail.com)')
            proxyReq.setHeader('Accept',     'application/json')
          })
        },
      },
      // Alpaca paper-trading REST API — credentials forwarded by the browser in request headers
      '/alpaca-api': {
        target:       'https://paper-api.alpaca.markets',
        changeOrigin: true,
        secure:       true,
        rewrite:      path => path.replace(/^\/alpaca-api/, ''),
        configure:    proxy => {
          proxy.on('proxyReq', proxyReq => {
            proxyReq.setHeader('Accept', 'application/json')
            // Key/secret headers are set by the browser component and forwarded transparently
          })
        },
      },
    },
  },
})
