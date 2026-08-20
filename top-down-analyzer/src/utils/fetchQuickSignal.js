// Lightweight signal check for multi-ticker scanning.
// Fetches weekly + daily + 5m + 15m bars in parallel per ticker.
// 5m/15m bars power the ORB (Opening Range Breakout) detection.

import { calcORBreakRetest } from './indicators'

const BASE = '/yf-api/v8/finance/chart'

async function fetchBars(ticker, interval, range, minBars = 10) {
  try {
    const url = `${BASE}/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=false`
    const res  = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const r    = json.chart?.result?.[0]
    if (!r) return null
    const ts = r.timestamp ?? []
    const q  = r.indicators?.quote?.[0] ?? {}
    const bars = ts
      .map((t, i) => ({
        ts: t,
        close:  q.close?.[i],
        high:   q.high?.[i],
        low:    q.low?.[i],
        open:   q.open?.[i],
        volume: q.volume?.[i] ?? 0,
      }))
      .filter(b => b.close != null && b.high != null && b.low != null)
    if (bars.length < minBars) return null
    return {
      closes:     bars.map(b => b.close),
      highs:      bars.map(b => b.high),
      lows:       bars.map(b => b.low),
      opens:      bars.map(b => b.open ?? b.close),
      volumes:    bars.map(b => b.volume),
      timestamps: bars.map(b => b.ts),
    }
  } catch { return null }
}

function ema(prices, period) {
  const k = 2 / (period + 1)
  let e = prices[0]
  return prices.map(p => (e = p * k + e * (1 - k)))
}

function rsiLast(prices, period = 14) {
  const n = prices.length
  if (n < period + 2) return 50
  let g = 0, l = 0
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) g += d; else l -= d
  }
  g /= period; l /= period
  for (let i = period + 1; i < n; i++) {
    const d = prices[i] - prices[i - 1]
    g = (g * (period - 1) + Math.max(0,  d)) / period
    l = (l * (period - 1) + Math.max(0, -d)) / period
  }
  return l === 0 ? 100 : +(100 - 100 / (1 + g / l)).toFixed(1)
}

export async function fetchQuickSignal(ticker) {
  try {
    // All 4 fetches fire in parallel — total latency = slowest single request
    const [weekly, daily, bars5m, bars15m] = await Promise.all([
      fetchBars(ticker, '1wk', '1y'),
      fetchBars(ticker, '1d',  '3mo'),
      fetchBars(ticker, '5m',  '1d', 3),   // intraday — only need a few bars
      fetchBars(ticker, '15m', '1d', 1),   // only need OR bar (first 15m candle)
    ])
    if (!weekly || !daily) return { ticker, signal: 'NO DATA', score: 50, error: true }

    const wc  = weekly.closes
    const dc  = daily.closes
    const wn  = wc.length
    const dn  = dc.length
    const cur = wc[wn - 1]

    // Weekly indicators
    const wRSI    = rsiLast(wc)
    const wEMA8   = ema(wc, 8)[wn - 1]
    const wEMA15  = ema(wc, 15)[wn - 1]
    const wEMA12  = ema(wc, 12)
    const wEMA26  = ema(wc, 26)
    const wMACD   = wEMA12[wn - 1] - wEMA26[wn - 1]
    const wMACDp  = wEMA12[wn - 2] - wEMA26[wn - 2]

    // Daily indicators
    const dRSI    = rsiLast(dc)
    const dEMA8   = ema(dc, 8)[dn - 1]
    const dEMA15  = ema(dc, 15)[dn - 1]
    const dEMA12  = ema(dc, 12)
    const dEMA26  = ema(dc, 26)
    const dMACD   = dEMA12[dn - 1] - dEMA26[dn - 1]
    const dClose  = dc[dn - 1]

    // Bull checks (8 total)
    const checks = [
      cur    > wEMA8,           // W: price above 8W EMA
      cur    > wEMA15,          // W: price above 15W EMA
      wMACD  > 0,               // W: MACD positive
      wMACD  > wMACDp,          // W: MACD rising
      wRSI   > 50,              // W: RSI bullish
      dClose > dEMA8,           // D: price above 8D EMA
      dMACD  > 0,               // D: daily MACD positive
      dRSI   > 50,              // D: daily RSI bullish
    ]

    const bullCount = checks.filter(Boolean).length
    const score     = Math.round(bullCount / checks.length * 100)

    let signal = 'NO TRADE'
    if (score >= 63) signal = 'CALL'
    else if (score <= 37) signal = 'PUT'

    // 52-week position
    const wk52 = wc.slice(-52)
    const h52  = Math.max(...wk52)
    const l52  = Math.min(...wk52)
    const pct52 = h52 > l52 ? +((cur - l52) / (h52 - l52) * 100).toFixed(0) : 50

    // Cycle phase from weekly bars
    let cyclePhase = null, cycleColor = '#3a5a7a'
    try {
      const { analyzeCycle } = await import('./cycleAnalysis.js')
      const c = analyzeCycle(weekly)
      if (c) { cyclePhase = c.phase; cycleColor = c.phaseColor }
    } catch {}

    // ── 15m ORB (Opening Range Breakout) detection ──────────────────────────
    // Requires 10M+ avg daily volume to filter out low-liquidity whipsaw setups.
    const recentVols = daily.volumes.slice(-20).filter(v => v > 0)
    const avgVol     = recentVols.length ? recentVols.reduce((s, v) => s + v, 0) / recentVols.length : 0
    const meetsVolume = avgVol >= 500_000

    // Gate: skip tickers below 500K avg daily volume (illiquid options)
    if (!meetsVolume) return null

    let orb = null
    if (bars5m && bars15m) {
      try { orb = calcORBreakRetest(bars5m, bars15m) } catch {}
    }

    return {
      ticker,
      signal,
      score,
      bullCount,
      bearCount: checks.length - bullCount,
      wRSI,
      dRSI,
      cyclePhase,
      cycleColor,
      pct52,
      price: +cur.toFixed(2),
      orb,
      avgVol: Math.round(avgVol),
      error: false,
    }
  } catch (e) {
    return { ticker, signal: 'ERROR', score: 50, error: true }
  }
}

// Batched parallel scan with progress callback
export async function scanSignals(tickers, onProgress) {
  const BATCH = 4   // parallel tickers per wave
  const results = []
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH)
    const res   = (await Promise.all(batch.map(t => fetchQuickSignal(t)))).filter(Boolean)
    results.push(...res)
    onProgress?.(Math.min(results.length, tickers.length), tickers.length)
  }
  // Sort: ORB actionable first, then by swing signal, then by score
  return results.sort((a, b) => {
    const orbPri = r => {
      const s = r.orb?.signal
      if (s === 'ENTER')      return 0
      if (s === 'RETEST')     return 1
      if (s === 'RECAPTURED') return 2
      if (s === 'BREAK')      return 3
      if (s === 'INSIDE')     return 4
      return 5
    }
    const oa = orbPri(a), ob = orbPri(b)
    if (oa !== ob) return oa - ob
    const sigOrd = { CALL: 0, PUT: 1, 'NO TRADE': 2, 'NO DATA': 3, ERROR: 4 }
    const sa = sigOrd[a.signal] ?? 5, sb = sigOrd[b.signal] ?? 5
    if (sa !== sb) return sa - sb
    return b.score - a.score
  })
}
