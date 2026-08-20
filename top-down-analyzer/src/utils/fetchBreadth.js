// Market breadth indicators — fetched from Yahoo Finance via /yf-api proxy.
// All symbols are non-fatal: each one resolves to null if unavailable.
// Returns a FAVORABLE / MIXED / HOSTILE verdict + individual data points.

import { calcEMASeries } from './indicators'

const BASE = '/yf-api/v8/finance/chart'

async function fetchChart(symbol, interval = '1d', range = '1mo') {
  try {
    const url = `${BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const r = json.chart?.result?.[0]
    if (!r) return null
    const ts = r.timestamp ?? []
    const q  = r.indicators?.quote?.[0] ?? {}
    // NOTE: do NOT filter b.c > 0 — breadth indices like new highs/lows can legitimately be 0
    return ts
      .map((t, i) => ({ ts: t, c: q.close?.[i], h: q.high?.[i], l: q.low?.[i], v: q.volume?.[i] ?? 0 }))
      .filter(b => b.c != null)
  } catch { return null }
}

function last(arr) { return arr?.[arr.length - 1] ?? null }
function prev(arr) { return arr?.[arr.length - 2] ?? null }

function ema(closes, period) {
  const s = calcEMASeries(closes, period)
  return s[s.length - 1] ?? null
}

export async function fetchBreadth() {
  const [nyadR, trinR, nyhghR, nylowR, spyR, qqR, iwmR, vixR] = await Promise.allSettled([
    fetchChart('^NYAD',  '1d', '3mo'),   // NYSE advance-decline cumulative
    fetchChart('^TRIN',  '1d', '5d'),    // Arms index — <1 bullish, >1 bearish
    fetchChart('^NYHGH', '1d', '1mo'),   // NYSE new 52-week highs
    fetchChart('^NYLOW', '1d', '1mo'),   // NYSE new 52-week lows
    fetchChart('SPY',    '1d', '1y'),    // S&P 500 proxy for EMA analysis
    fetchChart('QQQ',    '1d', '1y'),    // Nasdaq proxy
    fetchChart('IWM',    '1d', '1y'),    // Small caps
    fetchChart('^VIX',   '1d', '6mo'),   // CBOE VIX — needed by MarketPulse on load
  ])

  const get = r => r.status === 'fulfilled' ? r.value : null

  // ── NYSE Advance-Decline ─────────────────────────────────────────────────────
  const nyadBars  = get(nyadR)
  const nyadLast  = last(nyadBars)?.c ?? null
  const nyad10    = nyadBars?.[nyadBars.length - 10]?.c ?? null
  const nyadTrend = nyadLast != null && nyad10 != null
    ? (nyadLast > nyad10 ? 'rising' : nyadLast < nyad10 ? 'falling' : 'flat')
    : null
  const nyad = nyadLast != null ? { value: nyadLast, trend: nyadTrend } : null

  // ── TRIN (Arms Index) ───────────────────────────────────────────────────────
  const trinBars = get(trinR)
  const trinVal  = last(trinBars)?.c ?? null
  const trin = trinVal != null ? {
    value:   +trinVal.toFixed(2),
    label:   trinVal < 0.80 ? 'STRONG BUYING' : trinVal < 1.20 ? 'NEUTRAL' : trinVal < 2.0 ? 'SELLING PRESSURE' : 'PANIC SELLING',
    bullish: trinVal < 1.0,
  } : null

  // ── New 52-week Highs vs Lows ────────────────────────────────────────────────
  const nyhghBars = get(nyhghR)
  const nylowBars = get(nylowR)
  // Use last 5 trading days; include days where the value is 0 (valid)
  const highs5d   = nyhghBars?.slice(-5).map(b => b.c).filter(v => v != null) ?? []
  const lows5d    = nylowBars?.slice(-5).map(b => b.c).filter(v => v != null) ?? []
  const avgHighs  = highs5d.length ? Math.round(highs5d.reduce((a, b) => a + b, 0) / highs5d.length) : null
  const avgLows   = lows5d.length  ? Math.round(lows5d.reduce((a, b) => a + b, 0)  / lows5d.length)  : null
  const hlRatio   = (avgHighs != null && avgLows != null && avgLows > 0)
    ? +(avgHighs / avgLows).toFixed(1)
    : avgHighs != null && avgLows === 0 ? null : null
  const hl = avgHighs != null ? {
    highs:   avgHighs,
    lows:    avgLows ?? 0,
    ratio:   hlRatio,
    bullish: hlRatio != null ? hlRatio > 1 : avgHighs > (avgLows ?? 0),
  } : null

  // ── VIX ─────────────────────────────────────────────────────────────────────
  // Fetched here so MarketPulse has VIX data from the moment the app loads,
  // independent of whether the user has loaded a ticker yet.
  const vixBars = get(vixR)
  let vixData = null
  if (vixBars && vixBars.length >= 2) {
    const vixCur  = last(vixBars)?.c
    const vixAgo  = vixBars[Math.max(0, vixBars.length - 6)]?.c
    if (vixCur != null) {
      const rising = vixAgo != null ? vixCur > vixAgo : null
      const level  = vixCur < 15 ? 'LOW' : vixCur > 30 ? 'EXTREME' : vixCur > 22 ? 'HIGH' : vixCur > 18 ? 'ELEVATED' : 'NORMAL'
      const low52  = Math.min(...vixBars.map(b => b.l ?? b.c).filter(v => v != null))
      const high52 = Math.max(...vixBars.map(b => b.h ?? b.c).filter(v => v != null))
      const pct52  = high52 > low52 ? +((vixCur - low52) / (high52 - low52) * 100).toFixed(0) : 50
      vixData = { current: +vixCur.toFixed(2), rising, level, pct52, low52: +low52.toFixed(2), high52: +high52.toFixed(2) }
    }
  }

  // ── Index EMA Analysis ───────────────────────────────────────────────────────
  function analyzeIndex(bars) {
    if (!bars || bars.length < 30) return null
    const closes  = bars.map(b => b.c)
    const price   = last(closes)
    const e15     = ema(closes, 15)
    const e65     = ema(closes, 65)
    const e200    = ema(closes, 200)
    const above15  = price > e15
    const above65  = price > e65
    const above200 = e200 != null ? price > e200 : null
    const ref20    = bars[bars.length - 20]?.c
    const chg20    = ref20 ? +((price - ref20) / ref20 * 100).toFixed(1) : null
    const healthScore = [above15, above65, above200].filter(Boolean).length
    return { price, e15, e65, e200, above15, above65, above200, chg20, healthScore }
  }

  const spy = analyzeIndex(get(spyR))
  const qq  = analyzeIndex(get(qqR))
  const iwm = analyzeIndex(get(iwmR))

  // ── Overall breadth verdict ──────────────────────────────────────────────────
  let bullPts = 0, bearPts = 0, total = 0

  if (nyadTrend === 'rising')        { bullPts++; total++ }
  else if (nyadTrend === 'falling')  { bearPts++; total++ }

  if (trin?.bullish)  { bullPts++; total++ }
  else if (trin)      { bearPts++; total++ }

  if (hl?.bullish)    { bullPts++; total++ }
  else if (hl)        { bearPts++; total++ }

  if (spy?.above200 === true)        { bullPts++; total++ }
  else if (spy?.above200 === false)  { bearPts++; total++ }

  if (spy?.above65 === true)         { bullPts++; total++ }
  else if (spy?.above65 === false)   { bearPts++; total++ }

  if (iwm?.above65 === true)         { bullPts++; total++ }
  else if (iwm?.above65 === false)   { bearPts++; total++ }

  if (spy?.chg20 != null) {
    if (spy.chg20 > 0) { bullPts++; total++ }
    else               { bearPts++; total++ }
  }

  // VIX confirmation: extreme VIX (>25) is bearish context
  if (vixData?.current != null) {
    if (vixData.current > 25)       { bearPts++; total++ }
    else if (vixData.current < 18)  { bullPts++; total++ }
  }

  const verdict =
    total === 0            ? 'UNKNOWN'
    : bullPts >= total * 0.72 ? 'FAVORABLE'
    : bearPts >= total * 0.72 ? 'HOSTILE'
    : bullPts > bearPts       ? 'LEANING BULLISH'
    : bearPts > bullPts       ? 'LEANING BEARISH'
    : 'MIXED'

  // ── Sector rotation (11 SPDR ETFs) ─────────────────────────────────────────
  const SECTOR_ETFS = [
    { etf: 'XLK',  name: 'Tech' },
    { etf: 'XLE',  name: 'Energy' },
    { etf: 'XLF',  name: 'Financials' },
    { etf: 'XLV',  name: 'Health Care' },
    { etf: 'XLI',  name: 'Industrials' },
    { etf: 'XLB',  name: 'Materials' },
    { etf: 'XLRE', name: 'Real Estate' },
    { etf: 'XLU',  name: 'Utilities' },
    { etf: 'XLY',  name: 'Consumer Disc' },
    { etf: 'XLP',  name: 'Staples' },
    { etf: 'XLC',  name: 'Comm Svcs' },
  ]

  const sectorResults = await Promise.allSettled(
    SECTOR_ETFS.map(({ etf }) => fetchChart(etf, '1d', '3mo'))
  )

  const sectors = SECTOR_ETFS.map(({ etf, name }, i) => {
    const bars = sectorResults[i].status === 'fulfilled' ? sectorResults[i].value : null
    if (!bars || bars.length < 22) return { etf, name, chg20d: null, above15ema: null, above65ema: null, price: null }
    const closes = bars.map(b => b.c)
    const n      = closes.length
    const price  = closes[n - 1]
    const ref20  = closes[Math.max(0, n - 21)]
    const chg20d = ref20 ? +((price - ref20) / ref20 * 100).toFixed(1) : null
    const e15arr = calcEMASeries(closes, 15)
    const e65arr = calcEMASeries(closes, 65)
    const e15    = e15arr[n - 1]
    const e65    = e65arr[n - 1]
    return {
      etf, name,
      price:      +price.toFixed(2),
      chg20d,
      above15ema: e15 != null ? price > e15 : null,
      above65ema: e65 != null ? price > e65 : null,
    }
  }).filter(s => s.chg20d != null)
    .sort((a, b) => b.chg20d - a.chg20d)

  return { nyad, trin, hl, spy, qq, iwm, vix: vixData, verdict, bullPts, bearPts, total, sectors, fetchedAt: Date.now() }
}
