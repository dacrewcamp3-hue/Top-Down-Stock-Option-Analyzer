// SEC EDGAR full-text search proxy — required because EDGAR enforces a User-Agent
// header that identifies the app (per SEC guidelines at https://efts.sec.gov).
// In production /sec-efts/* is rewritten here by vercel.json.

import https from 'node:https'

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  let secpath = req.query.secpath || ''
  if (!secpath.startsWith('/')) secpath = '/' + secpath

  const qs = new URLSearchParams()
  for (const [key, val] of Object.entries(req.query)) {
    if (key !== 'secpath') qs.append(key, val)
  }
  const qstr = qs.toString()
  const targetPath = secpath + (qstr ? '?' + qstr : '')

  return new Promise((resolve) => {
    const secReq = https.request({
      hostname: 'efts.sec.gov',
      path:     targetPath,
      method:   'GET',
      headers: {
        'User-Agent': 'Top-Down-Stock-Option-Analyzer/1.0 (contact: dacrewcamp3@gmail.com)',
        'Accept':     'application/json',
      },
    }, (secRes) => {
      const ct = secRes.headers['content-type']
      if (ct) res.setHeader('Content-Type', ct)
      res.statusCode = secRes.statusCode
      secRes.pipe(res)
      secRes.on('end', resolve)
    })

    secReq.setTimeout(8000, () => {
      secReq.destroy()
      if (!res.headersSent) { res.statusCode = 504; res.end(JSON.stringify({ hits: { hits: [] } })) }
      resolve()
    })
    secReq.on('error', () => {
      if (!res.headersSent) { res.statusCode = 502; res.end(JSON.stringify({ hits: { hits: [] } })) }
      resolve()
    })
    secReq.end()
  })
}
