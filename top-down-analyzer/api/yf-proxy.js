// Vercel serverless Yahoo Finance proxy.
// All crumb/cookie/session logic lives in the shared ./_yfCrumb.js module so dev
// (vite.config.js) and prod (this file) can never drift out of sync.

import {
  nodeGet, ensureCrumb, getCookie, getCrumb, invalidateCrumb, needsCrumb, YF_HOSTS,
} from './_yfCrumb.js'

// Host-level failures worth retrying against the alternate Yahoo host.
// (401/403 are auth problems — a different host won't help; we invalidate the crumb
//  instead so the client's next request re-authenticates.)
const FAILOVER_STATUS = new Set([429, 500, 502, 503, 504])

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  try {
    const { yfpath = '', ...rest } = req.query || {}
    const crumbed = needsCrumb(yfpath)

    if (crumbed) {
      try { await ensureCrumb() } catch (_) {}
    }

    const qs = new URLSearchParams(rest)
    if (crumbed && getCrumb()) qs.set('crumb', getCrumb())
    const qsStr = qs.toString()
    const targetPath = '/' + yfpath + (qsStr ? '?' + qsStr : '')
    const headers = { Accept: 'application/json, text/plain, */*', Referer: 'https://finance.yahoo.com' }

    // Try query1, then fail over to query2 on transient host-level failures.
    let result
    for (let h = 0; h < YF_HOSTS.length; h++) {
      result = await nodeGet(YF_HOSTS[h], targetPath, headers, getCookie())
      if (result.status === 401 || result.status === 403) { invalidateCrumb(); break }
      if (!FAILOVER_STATUS.has(result.status)) break
    }

    res.setHeader('Content-Type', result.headers['content-type'] || 'application/json')
    res.statusCode = result.status
    res.end(result.body)
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message }))
  }
}
