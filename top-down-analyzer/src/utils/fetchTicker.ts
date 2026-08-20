// Fetches OHLCV data from Yahoo Finance for all 5 timeframes via the Vite dev proxy.
// The proxy (configured in vite.config.js) strips /yf-api and forwards to
// https://query1.finance.yahoo.com to avoid CORS.

import type { BarData, AllTimeframes, VixData } from '../types'

const CHART_BASE    = '/yf-api/v8/finance/chart'
const OPTIONS_BASE  = '/yf-api/v7/finance/options'
const SUMMARY_BASE  = '/yf-api/v10/finance/quoteSummary'

const SECTOR_ETFS = {
  'Technology':             'XLK',
  'Financial Services':     'XLF',
  'Healthcare':             'XLV',
  'Consumer Cyclical':      'XLY',
  'Consumer Defensive':     'XLP',
  'Energy':                 'XLE',
  'Industrials':            'XLI',
  'Real Estate':            'XLRE',
  'Utilities':              'XLU',
  'Basic Materials':        'XLB',
  'Communication Services': 'XLC',
}

async function fetchYFChart(ticker, interval, range, prePost = false) {
  const url = `${CHART_BASE}/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=${prePost}`
  const res = await fetch(url, { cache: 'no-cache' })

  if (res.status === 404) throw new Error(`Ticker "${ticker}" not found`)
  if (!res.ok) throw new Error(`Yahoo Finance returned HTTP ${res.status} — try again later`)

  const json = await res.json()
  const yfError = json.chart?.error
  if (yfError) throw new Error(yfError.description || 'Yahoo Finance returned an error')

  const result = json.chart?.result?.[0]
  if (!result) throw new Error(`No chart data found for "${ticker}"`)

  const timestamps = result.timestamp ?? []
  const q = result.indicators?.quote?.[0] ?? {}

  // Filter out bars where close is null (market holidays, gaps, etc.)
  const valid = timestamps
    .map((ts, i) => ({
      ts,
      open:   q.open?.[i],
      high:   q.high?.[i],
      low:    q.low?.[i],
      close:  q.close?.[i],
      volume: q.volume?.[i] ?? 0,
    }))
    .filter(b => b.close != null && b.open != null && b.high != null && b.low != null)

  if (valid.length === 0) throw new Error(`No valid price bars returned for "${ticker}"`)

  return {
    timestamps: valid.map(b => b.ts),
    opens:      valid.map(b => b.open),
    highs:      valid.map(b => b.high),
    lows:       valid.map(b => b.low),
    closes:     valid.map(b => b.close),
    volumes:    valid.map(b => b.volume),
    // Official previous close from Yahoo Finance quote meta — more accurate than derives-from-bar
    prevClose:  result.meta?.regularMarketPreviousClose ?? result.meta?.chartPreviousClose ?? null,
  }
}

// Filter bars to NYSE regular session: 9:30 AM – 4:00 PM ET.
// Uses Intl.DateTimeFormat for accurate DST-aware timezone conversion.
// Applied to intraday data fetched with longer ranges so Yahoo Finance can't leak
// extended-hours bars that would corrupt EMA and VWAP seed calculations.
function filterRegularHours(bars) {
  const { timestamps, opens, highs, lows, closes, volumes } = bars
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/New_York',
  })
  const keep = []
  for (let i = 0; i < timestamps.length; i++) {
    const parts  = fmt.formatToParts(new Date(timestamps[i] * 1000))
    const h      = parseInt(parts.find(p => p.type === 'hour').value,   10)
    const m      = parseInt(parts.find(p => p.type === 'minute').value, 10)
    const etMin  = h * 60 + m
    if (etMin >= 570 && etMin < 960) keep.push(i)  // 9:30 AM ≤ bar start < 4:00 PM ET
  }
  return {
    timestamps: keep.map(i => timestamps[i]),
    opens:      keep.map(i => opens[i]),
    highs:      keep.map(i => highs[i]),
    lows:       keep.map(i => lows[i]),
    closes:     keep.map(i => closes[i]),
    volumes:    keep.map(i => volumes[i]),
  }
}

// Yahoo Finance doesn't have a 4H interval — aggregate 4 × 60m bars into one 4H bar.
// Groups by ET trading day first so bars from different sessions are never merged.
function aggregate4H(bars) {
  if (!bars?.closes?.length) return null

  const dayMap = {}
  const dayOrder = []
  bars.timestamps.forEach((ts, i) => {
    const dk = new Date(ts * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    if (!dayMap[dk]) { dayMap[dk] = []; dayOrder.push(dk) }
    dayMap[dk].push(i)
  })

  const out = { opens: [], highs: [], lows: [], closes: [], volumes: [], timestamps: [] }
  for (const dk of dayOrder) {
    const idxs = dayMap[dk]
    for (let i = 0; i < idxs.length; i += 4) {
      const chunk = idxs.slice(i, i + 4)
      out.opens.push(bars.opens[chunk[0]])
      out.highs.push(Math.max(...chunk.map(j => bars.highs[j])))
      out.lows.push(Math.min(...chunk.map(j => bars.lows[j])))
      out.closes.push(bars.closes[chunk[chunk.length - 1]])
      out.volumes.push(chunk.reduce((sum, j) => sum + bars.volumes[j], 0))
      out.timestamps.push(bars.timestamps[chunk[0]])
    }
  }
  return out.closes.length ? out : null
}

async function fetchSectorData(ticker) {
  try {
    const res = await fetch(`${SUMMARY_BASE}/${encodeURIComponent(ticker)}?modules=assetProfile`)
    if (!res.ok) return null
    const json = await res.json()
    const sector = json.quoteSummary?.result?.[0]?.assetProfile?.sector
    if (!sector || !SECTOR_ETFS[sector]) return null
    const etf = SECTOR_ETFS[sector]
    const etfData = await fetchYFChart(etf, '1d', '6mo')
    return { sector, etf, closes: etfData.closes }
  } catch { return null }
}

// Keep bars from 4:00 AM ET to 4:00 PM ET (pre-market + regular session, no after-hours)
function filterWithPreMarket(bars) {
  const { timestamps, opens, highs, lows, closes, volumes } = bars
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/New_York',
  })
  const keep = []
  for (let i = 0; i < timestamps.length; i++) {
    const parts  = fmt.formatToParts(new Date(timestamps[i] * 1000))
    const rawH   = parseInt(parts.find(p => p.type === 'hour').value,   10)
    const m      = parseInt(parts.find(p => p.type === 'minute').value, 10)
    const etH    = rawH === 24 ? 0 : rawH
    const etMin  = etH * 60 + m
    if (etMin >= 240 && etMin < 960) keep.push(i)  // 4:00 AM ≤ bar < 4:00 PM ET
  }
  return {
    timestamps: keep.map(i => timestamps[i]),
    opens:      keep.map(i => opens[i]),
    highs:      keep.map(i => highs[i]),
    lows:       keep.map(i => lows[i]),
    closes:     keep.map(i => closes[i]),
    volumes:    keep.map(i => volumes[i]),
  }
}

// Wraps fetchYFChart so a failure returns null instead of throwing.
// Used for intraday timeframes so a bad 60m/15m/5m fetch doesn't block daily/weekly chart data.
async function tryFetchYFChart(ticker, interval, range, prePost = false) {
  try { return await fetchYFChart(ticker, interval, range, prePost) } catch { return null }
}

// Yahoo Finance multi-day ranges (5d, 60d, 1y, etc.) silently omit the current in-progress
// trading session. range=1d always returns today's session bars. This function merges those
// into the historical dataset so all charts show today's price action.
//
// Uses ET calendar dates (not raw timestamps) for deduplication so that a multi-day range
// whose cached daily bar carries a midnight-UTC timestamp (same epoch seconds as the live
// range=1d bar's midnight-ET timestamp) is still correctly replaced with the fresher data.
// Any historical bars whose ET calendar date appears in the live dataset are dropped and
// the live bars take their place — guaranteeing today's chart always shows current prices.
function appendTodayBars(historical, today) {
  if (!today?.timestamps?.length) return historical ?? null
  if (!historical?.timestamps?.length) return today

  const etDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })

  // Collect all ET dates present in the live (today) data
  const liveDates = new Set(today.timestamps.map(etDate))

  // Keep only historical bars whose date is NOT already covered by live data
  const keep: number[] = []
  historical.timestamps.forEach((ts, i) => {
    if (!liveDates.has(etDate(ts))) keep.push(i)
  })

  return {
    timestamps: [...keep.map(i => historical.timestamps[i]), ...today.timestamps],
    opens:      [...keep.map(i => historical.opens[i]),      ...today.opens],
    highs:      [...keep.map(i => historical.highs[i]),      ...today.highs],
    lows:       [...keep.map(i => historical.lows[i]),       ...today.lows],
    closes:     [...keep.map(i => historical.closes[i]),     ...today.closes],
    volumes:    [...keep.map(i => historical.volumes[i]),    ...today.volumes],
    prevClose:  historical.prevClose,
  }
}

export async function fetchAllTimeframes(ticker: string): Promise<AllTimeframes> {
  // Daily and weekly are required — they throw on failure and surface the error to the user.
  // Intraday (60m / 15m / 5m) are best-effort: a failure returns null so the daily chart
  // still loads. Yahoo Finance sometimes 401s or rate-limits intraday endpoints independently.
  // The *Today fetches use range=1d to capture the current in-progress session that multi-day
  // ranges exclude; they run in parallel so there is no added latency.
  const [weekly, daily, dailyToday, h1_60d, h1_5d, m15raw, m5raw, h60Today, m15Today, m5Today] = await Promise.all([
    fetchYFChart(ticker, '1wk', '2y'),
    fetchYFChart(ticker, '1d',  '1y'),
    tryFetchYFChart(ticker, '1d',  '1d'),   // today's daily bar
    tryFetchYFChart(ticker, '60m', '60d'),
    tryFetchYFChart(ticker, '60m', '5d'),
    tryFetchYFChart(ticker, '15m', '5d'),
    tryFetchYFChart(ticker, '5m',  '2d'),
    tryFetchYFChart(ticker, '60m', '1d'),   // today's 60m bars
    tryFetchYFChart(ticker, '15m', '1d'),   // today's 15m bars
    tryFetchYFChart(ticker, '5m',  '1d'),   // today's 5m bars
  ])

  // Append today's session to each dataset before filtering
  const dailyFull = appendTodayBars(daily, dailyToday)
  const h1_60d_full = appendTodayBars(h1_60d, h60Today)
  const h1_5d_full  = appendTodayBars(h1_5d,  h60Today)
  const m15full     = appendTodayBars(m15raw,  m15Today)
  const m5full      = appendTodayBars(m5raw,   m5Today)

  // Filter ALL intraday data to regular session hours (9:30–4:00 PM ET).
  const h60m_60d = h1_60d_full ? filterRegularHours(h1_60d_full) : null
  const h60m_5d  = h1_5d_full  ? filterRegularHours(h1_5d_full)  : null
  const m15 = m15full ? filterRegularHours(m15full) : null
  const m5  = m5full  ? filterRegularHours(m5full)  : null

  // SPY + sector ETF — non-fatal parallel fetches
  let spy = null, sectorETF = null
  try {
    spy = ticker.toUpperCase() === 'SPY'
      ? dailyFull
      : await fetchYFChart('SPY', '1d', '6mo')
  } catch (_) { /* non-fatal */ }
  try { sectorETF = await fetchSectorData(ticker) } catch (_) { /* non-fatal */ }

  let vix = null
  try {
    const vixRaw = await fetchYFChart('%5EVIX', '1d', '6mo')
    const n   = vixRaw.closes.length
    const cur = vixRaw.closes[n - 1]
    const ago = vixRaw.closes[Math.max(0, n - 6)]
    const low52  = Math.min(...vixRaw.lows)
    const high52 = Math.max(...vixRaw.highs)
    const pct52  = high52 > low52 ? +((cur - low52) / (high52 - low52) * 100).toFixed(0) : 50
    let level: VixData['level'] = 'NORMAL'
    if (cur < 15)      level = 'LOW'
    else if (cur > 30) level = 'EXTREME'
    else if (cur > 22) level = 'HIGH'
    else if (cur > 18) level = 'ELEVATED'
    vix = { current: +cur.toFixed(2), rising: cur > ago, level, pct52, low52: +low52.toFixed(2), high52: +high52.toFixed(2) } satisfies VixData
  } catch (_) { /* non-fatal */ }

  return {
    weekly,
    daily: dailyFull,
    '4h': h60m_60d ? aggregate4H(h60m_60d) : null,
    // Prefer 60-day 60m data for 1H so users can scroll back further; fall back to 5-day
    '1h': h60m_60d ?? h60m_5d ?? null,
    '15m': m15 ?? null,
    '5m':  m5  ?? null,
    spy,
    vix,
    sectorETF,
  }
}

// Fetch ATM implied volatility from Yahoo Finance's options chain.
// Stores one IV sample per day in localStorage and computes IV Rank / IV Percentile
// from the rolling 1-year history so traders know if options are cheap or expensive.
export async function fetchIVData(ticker) {
  try {
    const res = await fetch(`${OPTIONS_BASE}/${encodeURIComponent(ticker)}`)
    if (!res.ok) return null
    const json = await res.json()
    const result = json.optionChain?.result?.[0]
    if (!result) return null

    const currentPrice = result.quote?.regularMarketPrice
    const options = result.options?.[0]
    if (!options || !currentPrice) return null

    const allContracts = [
      ...(options.calls ?? []),
      ...(options.puts  ?? []),
    ].filter(o => o.impliedVolatility > 0)
    if (allContracts.length === 0) return null

    // ATM IV = IV of the contract with strike closest to current price
    const atm   = allContracts.sort((a, b) => Math.abs(a.strike - currentPrice) - Math.abs(b.strike - currentPrice))[0]
    const atmIV = +(atm.impliedVolatility * 100).toFixed(1)

    // One sample per day, rolling 1-year window stored in localStorage
    const key    = `iv_${ticker.toUpperCase()}`
    let history  = []
    try { history = JSON.parse(localStorage.getItem(key) ?? '[]') } catch {}
    const today  = new Date().toISOString().slice(0, 10)
    const cutoff = Date.now() - 365 * 86400000
    history = history.filter(s => s.ts > cutoff && new Date(s.ts).toISOString().slice(0, 10) !== today)
    history.push({ ts: Date.now(), iv: atmIV })
    try { localStorage.setItem(key, JSON.stringify(history.slice(-252))) } catch {}

    const ivs   = history.map(s => s.iv)
    const ivMin = Math.min(...ivs)
    const ivMax = Math.max(...ivs)
    const ivRank = history.length >= 5 && ivMax > ivMin
      ? Math.round((atmIV - ivMin) / (ivMax - ivMin) * 100)
      : null
    const ivPct = history.length >= 5
      ? Math.round(ivs.filter(v => v <= atmIV).length / ivs.length * 100)
      : null

    return { atmIV, ivRank, ivPct, samples: history.length }
  } catch {
    return null
  }
}

// Fetches the next scheduled earnings date for a ticker from Yahoo Finance.
// Returns a Date object or null (non-fatal — missing earnings data never blocks the app).
export async function fetchEarningsDate(ticker) {
  try {
    const res = await fetch(`${SUMMARY_BASE}/${encodeURIComponent(ticker)}?modules=calendarEvents`)
    if (!res.ok) return null
    const json  = await res.json()
    const dates = json.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate
    if (!dates?.length) return null
    const raw = dates[0].raw
    return raw ? new Date(raw * 1000) : null
  } catch {
    return null
  }
}

// Fetches 1H, 15M, and 5M bars that include the pre-market session (4:00 AM–9:30 AM ET).
// Returns null per timeframe on failure so callers degrade gracefully.
export async function fetchPreMarketBars(ticker) {
  const [h1raw, m15raw, m5raw, h1Today, m15Today, m5Today] = await Promise.all([
    tryFetchYFChart(ticker, '60m', '5d', true),
    tryFetchYFChart(ticker, '15m', '5d', true),
    tryFetchYFChart(ticker, '5m',  '2d', true),
    tryFetchYFChart(ticker, '60m', '1d', true),   // today's pre-market + regular 60m bars
    tryFetchYFChart(ticker, '15m', '1d', true),   // today's pre-market + regular 15m bars
    tryFetchYFChart(ticker, '5m',  '1d', true),   // today's pre-market + regular 5m bars
  ])
  const h1full  = appendTodayBars(h1raw,  h1Today)
  const m15full = appendTodayBars(m15raw, m15Today)
  const m5full  = appendTodayBars(m5raw,  m5Today)
  return {
    '1h':  h1full  ? filterWithPreMarket(h1full)  : null,
    '15m': m15full ? filterWithPreMarket(m15full) : null,
    '5m':  m5full  ? filterWithPreMarket(m5full)  : null,
  }
}
