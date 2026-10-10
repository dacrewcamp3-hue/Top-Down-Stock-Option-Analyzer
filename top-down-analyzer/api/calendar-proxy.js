import https from 'node:https'

// ForexFactory calendar — high-impact USD events for the current week
// Free, no API key required
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Top-Down-Analyzer/1.0)',
        'Accept': 'application/json',
      }
    }, res => {
      const chunks = []
      res.on('data', d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  try {
    const result = await httpsGet('https://nfs.faireconomy.media/ff_calendar_thisweek.json')

    // Parse and filter to USD high-impact events only
    const all = JSON.parse(result.body.toString())
    const filtered = all.filter(e =>
      e.country === 'USD' &&
      (e.impact === 'High' || e.impact === 'Medium')
    )

    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify(filtered))
  } catch (e) {
    // Fallback: return empty array rather than error — calendar is non-critical
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify([]))
  }
}
