import https from 'node:https'

function anthropicPost(body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body))
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': payload.length,
      }
    }, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }))
    return
  }

  let body = ''
  for await (const chunk of req) body += chunk
  const ctx = JSON.parse(body || '{}')
  const mode = req.query?.mode ?? 'brief'

  const contextStr = `
Ticker: ${ctx.ticker ?? 'N/A'}
Market Regime: ${ctx.verdict ?? 'UNKNOWN'}
VIX: ${ctx.vix ?? 'N/A'}
TRIN: ${ctx.trin ?? 'N/A'}
NYSE A/D Trend: ${ctx.nyadTrend ?? 'N/A'}
New Highs vs Lows: ${ctx.highs ?? 0} highs / ${ctx.lows ?? 0} lows (5-day avg)
MTF EMA Alignment: W=${ctx.tfW ?? '?'} D=${ctx.tfD ?? '?'} 4H=${ctx.tf4H ?? '?'} 1H=${ctx.tf1H ?? '?'} 15M=${ctx.tf15M ?? '?'}
Chart Trend: ${ctx.chartTrend ?? 'N/A'}
Options Flow: ${ctx.flowBias ?? 'N/A'}
Gamma Regime: ${ctx.gammaRegime ?? 'N/A'} (Gamma Flip at ${ctx.gammaFlip ?? 'N/A'}, Current Price ${ctx.currentPrice ?? 'N/A'})
Call Wall: ${ctx.callWall ?? 'N/A'} | Put Wall: ${ctx.putWall ?? 'N/A'} | Max Pain: ${ctx.maxPain ?? 'N/A'}
RSI Divergence: ${ctx.rsiDiv ?? 'None detected'}
Seasonality: ${ctx.monthAvg ?? 'N/A'} historical avg for ${ctx.monthName ?? 'this month'}
Earnings Proximity: ${ctx.earningsIn ?? 'N/A'}
Weight of Evidence: ${ctx.evidenceScore ?? 'N/A'}
`.trim()

  let systemPrompt, userPrompt

  if (mode === 'brief') {
    systemPrompt = `You are a professional market analyst providing a concise pre-decision brief.
Write exactly 4 sentences. No bullet points. No headers. Plain prose only.
Sentence 1: State the current market environment and what it means for directional trades.
Sentence 2: Describe what the specific ticker's technical and options structure is indicating.
Sentence 3: Identify the single most important risk or confirmation signal to watch.
Sentence 4: Give a plain-English weight-of-evidence conclusion.
Be direct, specific, and actionable. Do not hedge every sentence. Do not use jargon without explanation.`
    userPrompt = `Based on the following market data, write the pre-decision brief:\n\n${contextStr}`
  } else {
    systemPrompt = `You are a professional devil's advocate — your job is to argue the OPPOSITE of what the data suggests.
If the evidence points bullish, argue the strongest bearish case. If bearish, argue the strongest bullish case.
Write exactly 3 sentences. No bullet points. No headers. Plain prose only.
Sentence 1: State why the dominant thesis could be completely wrong.
Sentence 2: Identify the specific data point or condition that would cause a reversal.
Sentence 3: Describe the scenario the consensus is ignoring.
Be intellectually honest and specific. This is meant to stress-test a thesis, not to be contrarian for its own sake.`
    userPrompt = `The current data suggests: ${ctx.dominantThesis ?? 'bullish'}. Argue the strongest possible counter-case:\n\n${contextStr}`
  }

  try {
    const result = await anthropicPost({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
    const parsed = JSON.parse(result.body)
    const text = parsed?.content?.[0]?.text ?? ''
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = 200
    res.end(JSON.stringify({ text, mode }))
  } catch (e) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: e.message }))
  }
}
