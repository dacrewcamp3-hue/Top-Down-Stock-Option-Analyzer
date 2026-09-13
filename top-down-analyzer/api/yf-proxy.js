import https from 'node:https'

// Module-level cache persists within a warm serverless container instance
const yf = { cookie: '', crumb: '', ts: 0 }
const CRUMB_TTL = 40 * 60 * 1000
let pending = null

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

async function refreshCrumb() {
  const r1 = await nodeGet('finance.yahoo.com', '/quote/SPY/options', { Referer: 'https://www.google.com/' })
  yf.cookie = r1.cookies

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

  const bodyStr = r1.body.toString()
  const m = bodyStr.match(/"crumb"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]
  if (m) {
    yf.crumb = m.replace(/\\\//g, '/').replace(/\\"/g, '"')
    yf.ts = Date.now()
    return
  }
  throw new Error('Failed to obtain Yahoo Finance crumb')
}

async function ensureCrumb() {
  if (yf.crumb && Date.now() - yf.ts < CRUMB_TTL) return
  if (pending) return pending
  pending = refreshCrumb().finally(() => { pending = null })
  return pending
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  try {
    const { yfpath = '', ...rest } = req.query || {}
    const needsCrumb = yfpath.includes('/v7/finance/options/') || yfpath.includes('/v10/finance/quoteSummary/')

    if (needsCrumb) {
      try { await ensureCrumb() } catch (_) {}
    }

    const qs = new URLSearchParams(rest)
    if (needsCrumb && yf.crumb) qs.set('crumb', yf.crumb)
    const qsStr = qs.toString()
    const targetPath = '/' + yfpath + (qsStr ? '?' + qsStr : '')

    const result = await nodeGet(
      'query1.finance.yahoo.com',
      targetPath,
      { Accept: 'application/json, text/plain, */*', Referer: 'https://finance.yahoo.com' },
      yf.cookie
    )

    if (result.status === 401 || result.status === 403) {
      yf.crumb = ''; yf.ts = 0
    }

    res.setHeader('Content-Type', result.headers['content-type'] || 'application/json')
    res.statusCode = result.status
    res.end(result.body)
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message }))
  }
}
