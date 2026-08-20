// Alpaca paper-trading proxy — forwards user-provided API key headers to Alpaca.
// Keys are stored in localStorage by the browser and sent in request headers;
// this proxy adds CORS headers so the browser can reach paper-api.alpaca.markets.
// In production /alpaca-api/* is rewritten here by vercel.json.

import https from 'node:https'

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'APCA-API-KEY-ID, APCA-API-SECRET-KEY, Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  let alpacapath = req.query.alpacapath || ''
  if (!alpacapath.startsWith('/')) alpacapath = '/' + alpacapath

  const qs = new URLSearchParams()
  for (const [key, val] of Object.entries(req.query)) {
    if (key !== 'alpacapath') qs.append(key, val)
  }
  const qstr = qs.toString()
  const targetPath = alpacapath + (qstr ? '?' + qstr : '')

  return new Promise((resolve) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const body = chunks.length ? Buffer.concat(chunks) : null

      const fwdHeaders = {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
      }
      // Forward Alpaca credentials the browser included in request headers
      if (req.headers['apca-api-key-id'])     fwdHeaders['APCA-API-KEY-ID']     = req.headers['apca-api-key-id']
      if (req.headers['apca-api-secret-key']) fwdHeaders['APCA-API-SECRET-KEY'] = req.headers['apca-api-secret-key']
      if (body?.length)                        fwdHeaders['Content-Length']       = body.length

      const alpReq = https.request({
        hostname: 'paper-api.alpaca.markets',
        path:     targetPath,
        method:   req.method,
        headers:  fwdHeaders,
      }, (alpRes) => {
        res.statusCode = alpRes.statusCode
        alpRes.pipe(res)
        alpRes.on('end', resolve)
      })

      alpReq.setTimeout(10000, () => {
        alpReq.destroy()
        if (!res.headersSent) { res.statusCode = 504; res.end('{}') }
        resolve()
      })
      alpReq.on('error', () => {
        if (!res.headersSent) { res.statusCode = 502; res.end('{}') }
        resolve()
      })
      if (body?.length) alpReq.write(body)
      alpReq.end()
    })
  })
}
