import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// Yahoo crumb/session logic is shared with the prod serverless proxy (api/yf-proxy.js)
// so the two can never drift apart. See api/_yfCrumb.js.
import { refreshCrumb, ensureCrumb, getCookie, getCrumb, invalidateCrumb } from './api/_yfCrumb.js'

// SEC's fair-access policy wants a contact in the User-Agent. We read it from the
// SEC_CONTACT env var (set in .env.local for dev, or the Vercel dashboard for prod)
// so no personal email is ever committed to the repo. Falls back to a non-personal
// app identifier when unset.
function secUserAgent(contact) {
  return contact
    ? `Top-Down-Stock-Option-Analyzer/1.0 (contact: ${contact})`
    : 'Top-Down-Stock-Option-Analyzer/1.0'
}

// Intercepts /v7/finance/options/ and /v10/finance/quoteSummary/ requests before the
// proxy touches them: appends ?crumb=... to the URL. Cookie injection happens in the
// proxy's proxyReq handler below. All auth state comes from the shared crumb module.
function yfCrumbPlugin() {
  return {
    name: 'yf-crumb',
    configureServer(server) {
      // Eagerly establish the YF session on server start so the first ticker load
      // already has valid auth.
      refreshCrumb().catch(e => console.warn('[YF prewarm]', e.message))

      server.middlewares.use(async (req, _res, next) => {
        if (req.url?.includes('/v7/finance/options/') || req.url?.includes('/v10/finance/quoteSummary/')) {
          try { await ensureCrumb() } catch (e) { console.warn('[YF crumb]', e.message) }
          if (getCrumb()) {
            const sep = req.url.includes('?') ? '&' : '?'
            req.url  += sep + 'crumb=' + encodeURIComponent(getCrumb())
          }
        }
        next()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const SEC_UA = secUserAgent(env.SEC_CONTACT)

  return {
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
              // Forward session cookie for ALL Yahoo Finance requests — the chart endpoint
              // also requires an authenticated session or Yahoo returns 401/empty data.
              const cookie = getCookie()
              if (cookie) proxyReq.setHeader('Cookie', cookie)
            })
            // Auto-invalidate crumb on any 401/403 so the next request re-authenticates.
            proxy.on('proxyRes', (proxyRes, req) => {
              if (proxyRes.statusCode === 401 || proxyRes.statusCode === 403) {
                invalidateCrumb()
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
              proxyReq.setHeader('User-Agent', SEC_UA)
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
  }
})
