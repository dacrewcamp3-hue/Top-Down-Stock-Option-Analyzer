import https from 'node:https'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'APCA-API-KEY-ID, APCA-API-SECRET-KEY, Content-Type')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  try {
    const { alpacapath = '', ...rest } = req.query || {}
    const qs = new URLSearchParams(rest).toString()
    const targetPath = '/' + alpacapath + (qs ? '?' + qs : '')

    const result = await new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json' }
      // Forward Alpaca auth headers from the browser request
      if (req.headers['apca-api-key-id'])     headers['APCA-API-KEY-ID']     = req.headers['apca-api-key-id']
      if (req.headers['apca-api-secret-key']) headers['APCA-API-SECRET-KEY'] = req.headers['apca-api-secret-key']

      const r = https.request({ hostname: 'paper-api.alpaca.markets', path: targetPath, method: req.method || 'GET', headers }, proxyRes => {
        const chunks = []
        proxyRes.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
        proxyRes.on('end', () => resolve({ status: proxyRes.statusCode, headers: proxyRes.headers, body: Buffer.concat(chunks) }))
      })
      r.on('error', reject)
      r.end()
    })

    res.setHeader('Content-Type', result.headers['content-type'] || 'application/json')
    res.statusCode = result.status
    res.end(result.body)
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message }))
  }
}
