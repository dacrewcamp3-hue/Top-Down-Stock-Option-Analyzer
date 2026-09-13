import https from 'node:https'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  try {
    const { secpath = '', ...rest } = req.query || {}
    const qs = new URLSearchParams(rest).toString()
    const targetPath = '/' + secpath + (qs ? '?' + qs : '')

    const result = await new Promise((resolve, reject) => {
      const headers = {
        'User-Agent': 'Top-Down-Stock-Option-Analyzer/1.0 (contact: dacrewcamp3@gmail.com)',
        'Accept':     'application/json',
      }
      const r = https.request({ hostname: 'efts.sec.gov', path: targetPath, method: 'GET', headers }, proxyRes => {
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
