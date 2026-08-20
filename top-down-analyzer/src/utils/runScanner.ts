import { calcEMASeries, calcRSI, calcMACD, calcADX } from './indicators'
import type { ScanResult, ScanRow } from '../types'

const CHART_BASE = '/yf-api/v8/finance/chart'

// ~180 liquid, optionable stocks across all sectors — the market scan universe
export const UNIVERSE = [
  // Index ETFs
  'SPY', 'QQQ', 'IWM', 'DIA',
  // Mega-cap tech
  'AAPL', 'MSFT', 'NVDA', 'META', 'GOOGL', 'AMZN', 'TSLA',
  // Large-cap tech
  'AMD', 'NFLX', 'ORCL', 'CSCO', 'IBM', 'INTC', 'QCOM', 'AMAT',
  'AVGO', 'MU', 'TSM', 'ADI', 'KLAC', 'LRCX', 'CDNS', 'ADBE',
  // Growth / momentum
  'PLTR', 'SNOW', 'NET', 'SHOP', 'COIN', 'APP', 'HOOD', 'RBLX',
  'SPOT', 'MSTR', 'SMCI', 'ARM', 'IONQ', 'CRM', 'UBER', 'INTU',
  // Cybersecurity / cloud
  'CRWD', 'PANW', 'ZS', 'FTNT', 'DDOG', 'MDB', 'TTD', 'HUBS',
  'ADSK', 'VEEV',
  // Fintech
  'PYPL', 'SQ', 'AFRM', 'SOFI', 'UPST', 'MELI', 'BKNG',
  // EV / clean energy
  'RIVN', 'NIO', 'LCID', 'CHPT',
  // Financials
  'JPM', 'GS', 'BAC', 'MS', 'WFC', 'V', 'MA', 'AXP', 'SCHW',
  'BLK', 'MCO', 'SPGI', 'AON', 'MMC',
  // Healthcare / biotech
  'LLY', 'UNH', 'MRNA', 'ABBV', 'JNJ', 'AMGN', 'GILD', 'VRTX',
  'REGN', 'ISRG', 'TMO', 'DHR', 'ELV', 'CI', 'PFE', 'BMY',
  // Consumer discretionary
  'COST', 'WMT', 'HD', 'NKE', 'MCD', 'SBUX', 'TJX', 'LOW',
  'DASH', 'LYFT', 'ABNB',
  // Consumer staples
  'PM', 'PG', 'KO', 'PEP', 'MDLZ',
  // Industrials / defense
  'CAT', 'DE', 'RTX', 'LMT', 'BA', 'GE', 'ETN', 'HON', 'TT',
  'UPS', 'WM', 'NOC', 'HII',
  // Energy
  'XOM', 'CVX', 'OXY', 'SLB', 'FCX', 'MPC', 'VLO',
  // Materials
  'NEM', 'AA', 'CF',
  // Real estate / utilities
  'PLD', 'AMT', 'CCI', 'NEE', 'SO', 'DUK',
  // Macro / commodities
  'GLD', 'SLV', 'TLT', 'USO', 'GDX',
  // Insurance / diversified
  'SHW', 'MMM',
]

export const SECTOR_ETFS = [
  { ticker: 'XLK',  label: 'Tech' },
  { ticker: 'XLF',  label: 'Finance' },
  { ticker: 'XLV',  label: 'Health' },
  { ticker: 'XLE',  label: 'Energy' },
  { ticker: 'XLY',  label: 'Cons Disc' },
  { ticker: 'XLI',  label: 'Industrial' },
  { ticker: 'XLC',  label: 'Comm Svc' },
]

// Maps each sector ETF to the UNIVERSE stocks that primarily belong to that sector.
// Used by the Scanner to surface leading individual names within each leading sector.
export const SECTOR_STOCKS = {
  'XLK': [
    'AAPL','MSFT','NVDA','AMD','ORCL','CSCO','IBM','INTC','QCOM','AMAT',
    'AVGO','MU','TSM','ADI','KLAC','LRCX','CDNS','ADBE',
    'CRWD','PANW','ZS','FTNT','DDOG','MDB','TTD','HUBS','ADSK','VEEV',
    'CRM','INTU','PLTR','SNOW','NET','SMCI','ARM','IONQ','COIN','APP',
  ],
  'XLF': [
    'JPM','GS','BAC','MS','WFC','V','MA','AXP','SCHW',
    'BLK','MCO','SPGI','AON','MMC',
    'PYPL','SQ','AFRM','SOFI','UPST','MELI','BKNG','HOOD',
  ],
  'XLV': [
    'LLY','UNH','ABBV','JNJ','AMGN','GILD','VRTX','REGN',
    'ISRG','TMO','DHR','ELV','CI','PFE','BMY','MRNA',
  ],
  'XLE': ['XOM','CVX','OXY','SLB','MPC','VLO','FCX'],
  'XLY': [
    'AMZN','TSLA','MCD','NKE','SBUX','HD','LOW','TJX','COST',
    'BKNG','ABNB','DASH','LYFT','RIVN','NIO','LCID','CHPT','SHOP',
  ],
  'XLI': ['CAT','DE','RTX','LMT','BA','GE','ETN','HON','TT','UPS','WM','NOC','HII'],
  'XLC': ['GOOGL','META','NFLX','UBER','SPOT','RBLX'],
}

// ── Stage / RS / Tightness helpers ───────────────────────────────────────────

// Weinstein-style stage from daily data using EMA30 slope + price position
function detectStage(closes: number[], ema30s: (number | null)[]): 'S1' | 'S2' | 'S3' | 'S4' | null {
  const n = closes.length
  if (n < 35) return null
  const cur  = ema30s[n - 1]
  const prev = ema30s[n - 6] ?? ema30s[n - 2]
  if (cur == null || prev == null || prev === 0) return null
  const slope    = (cur - prev) / prev
  const aboveEma = closes[n - 1] > cur
  if (aboveEma  && slope >  0.001) return 'S2'
  if (aboveEma)                    return 'S1'
  if (!aboveEma && slope < -0.001) return 'S4'
  return 'S3'
}

// 12-week (60-bar) return vs SPY — outperformance in percentage points
function calcRS(closes: number[], spyReturn: number | null): number | null {
  const n = closes.length
  if (n < 61 || spyReturn == null) return null
  const stockReturn = (closes[n - 1] - closes[n - 61]) / closes[n - 61]
  return +((stockReturn - spyReturn) * 100).toFixed(1)
}

// ATR compression — 5-day range vs 20-day avg range; <0.65 = coiling, >1.35 = extended
function calcTightness(highs: number[], lows: number[]): number | null {
  const n = highs.length
  if (n < 25) return null
  const range5 = Math.max(...highs.slice(-5)) - Math.min(...lows.slice(-5))
  let avgRange20 = 0
  for (let i = n - 20; i < n; i++) avgRange20 += highs[i] - lows[i]
  avgRange20 /= 20
  return avgRange20 > 0 ? +(range5 / avgRange20).toFixed(2) : null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekKey(unixSec) {
  const d    = new Date(unixSec * 1000)
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const wk   = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`
}

function resampleWeekly(closes, highs, lows, timestamps) {
  const weeks: Record<string, { c: number[], h: number[], l: number[] }> = {}
  timestamps.forEach((ts, i) => {
    const k = getWeekKey(ts)
    if (!weeks[k]) weeks[k] = { c: [], h: [], l: [] }
    weeks[k].c.push(closes[i])
    weeks[k].h.push(highs[i])
    weeks[k].l.push(lows[i])
  })
  const keys = Object.keys(weeks).sort()
  return {
    closes: keys.map(k => weeks[k].c[weeks[k].c.length - 1]),
    highs:  keys.map(k => Math.max(...weeks[k].h)),
    lows:   keys.map(k => Math.min(...weeks[k].l)),
  }
}

async function fetchDaily(symbol) {
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=6mo&includePrePost=false`
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const r    = json.chart?.result?.[0]
  if (!r) throw new Error('No data')
  const ts = r.timestamp ?? []
  const q  = r.indicators?.quote?.[0] ?? {}
  const bars = ts
    .map((t, i) => ({
      ts: t,
      c:  q.close?.[i],
      h:  q.high?.[i],
      l:  q.low?.[i],
      v:  q.volume?.[i] ?? 0,
    }))
    .filter(b => b.c != null)
  return {
    closes:     bars.map(b => b.c),
    highs:      bars.map(b => b.h),
    lows:       bars.map(b => b.l),
    volumes:    bars.map(b => b.v),
    timestamps: bars.map(b => b.ts),
  }
}

function tfSignal(closes, highs, lows) {
  const n = closes.length
  if (n < 20) return { dir: 'neutral', bull: 0, bear: 0, conf: 0 }

  let bull = 0, bear = 0

  const ema30s = calcEMASeries(closes, 30)
  if (ema30s[n - 1] != null) {
    closes[n - 1] > ema30s[n - 1] ? bull++ : bear++
  }

  const rsiVal = calcRSI(closes)
  if (rsiVal != null) {
    if (rsiVal >= 44) bull++
    else if (rsiVal >= 30) bear++
  }

  const m = calcMACD(closes)
  if (m) { m.histogram > 0 ? bull++ : bear++ }

  const adxR = calcADX(highs, lows, closes)
  if (adxR?.adx >= 21) {
    adxR.plusDI >= adxR.minusDI ? bull++ : bear++
  }

  if (n >= 10) {
    const ema8s = calcEMASeries(closes, 8)
    const la = closes[n - 1] > ema8s[n - 1]
    const pa = closes[n - 2] > ema8s[n - 2]
    if (la && pa)   bull++
    if (!la && !pa) bear++
  }

  const total = bull + bear
  const conf  = total >= 3 ? (bull - bear) / total : 0
  const dir   = conf >= 0.34 ? 'bull' : conf <= -0.34 ? 'bear' : 'neutral'
  return { dir, bull, bear, conf }
}

function shortTermDir(closes) {
  const n = closes.length
  if (n < 10) return 'neutral'
  const ema8s = calcEMASeries(closes, 8)
  if (ema8s[n - 1] == null || ema8s[n - 2] == null) return 'neutral'
  const cur  = closes[n - 1] > ema8s[n - 1]
  const prev = closes[n - 2] > ema8s[n - 2]
  if (cur && prev)   return 'bull'
  if (!cur && !prev) return 'bear'
  return 'neutral'
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanTicker(symbol: string, spyReturn: number | null = null): Promise<ScanRow> {
  try {
    const { closes, highs, lows, volumes, timestamps } = await fetchDaily(symbol)
    const n = closes.length

    // Gate: require ≥10M average daily volume — filters illiquid names before any computation
    const _slice = volumes.slice(-21, -1)
    const _avg   = _slice.length ? _slice.reduce((a, b) => a + b, 0) / _slice.length : 0
    if (_avg < 10_000_000) return { ticker: symbol, ok: false, error: 'avg vol < 10M' }

    const dySig   = tfSignal(closes, highs, lows)
    const dyTotal = dySig.bull + dySig.bear
    const dyConf  = dyTotal < 3 ? 0 : (dySig.bull - dySig.bear) / dyTotal
    const ema30s  = calcEMASeries(closes, 30)

    let signal: ScanResult['signal'] = 'NO TRADE'
    if (dyTotal >= 3) {
      if (dyConf >= 0.60)  signal = 'CALL'
      if (dyConf <= -0.60) signal = 'PUT'
    }

    const wk    = resampleWeekly(closes, highs, lows, timestamps)
    const wkSig = tfSignal(wk.closes, wk.highs, wk.lows)
    const stDir = shortTermDir(closes)

    let grade = null
    if (signal !== 'NO TRADE') {
      const abs     = Math.abs(dyConf)
      const wkAlign = wkSig.dir === dySig.dir
      const stAlign = stDir    === dySig.dir
      if (abs >= 0.85 && wkAlign && stAlign)         grade = 'A+'
      else if (abs >= 0.70 && (wkAlign || stAlign))  grade = 'A'
      else if (abs >= 0.60)                          grade = 'B'
      else                                           grade = 'C'
    }

    const pctChange = n >= 2
      ? +((closes[n - 1] - closes[n - 2]) / closes[n - 2] * 100).toFixed(2)
      : null

    const todayVol = volumes[n - 1] ?? 0
    const sliceVol = volumes.slice(-21, -1)
    const avgVol   = sliceVol.length
      ? sliceVol.reduce((a, b) => a + b, 0) / sliceVol.length
      : 0
    const volSpike = avgVol > 0 ? +(todayVol / avgVol).toFixed(2) : null

    const rsiVal = calcRSI(closes)
    const adxR   = calcADX(highs, lows, closes)

    return {
      ticker:    symbol,
      signal,
      score:     Math.round(50 + dyConf * 50),
      rawConf:   dyConf,
      grade,
      weekly:    wkSig.dir as ScanResult['weekly'],
      daily:     dySig.dir as ScanResult['daily'],
      shortTerm: stDir     as ScanResult['shortTerm'],
      pctChange,
      volSpike,
      rsi:       rsiVal != null ? Math.round(rsiVal) : null,
      adx:       adxR   != null ? Math.round(adxR.adx) : null,
      price:     closes[n - 1] != null ? +closes[n - 1].toFixed(2) : null,
      bull:      dySig.bull,
      bear:      dySig.bear,
      sparkline: closes.slice(-10),
      stage:     detectStage(closes, ema30s),
      rsVsSpy:   calcRS(closes, spyReturn),
      tightness: calcTightness(highs, lows),
      ok:        true,
    }
  } catch (e) {
    return { ticker: symbol, ok: false, error: e.message }
  }
}

// Scans in batches of 3; calls onResult(batch) after each batch for streaming UI.
export async function runScanner(
  tickers: string[],
  onProgress: (done: number, total: number) => void,
  onResult?: (batch: ScanRow[]) => void,
): Promise<ScanRow[]> {
  // Fetch SPY 12-week return first — used as RS baseline for every ticker
  let spyReturn: number | null = null
  try {
    const spy = await fetchDaily('SPY')
    const sc  = spy.closes
    const sn  = sc.length
    if (sn >= 62) spyReturn = (sc[sn - 1] - sc[sn - 61]) / sc[sn - 61]
  } catch {}

  const results = []
  const BATCH   = 3
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch        = tickers.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map(t => scanTicker(t, spyReturn)))
    results.push(...batchResults)
    onResult?.(batchResults)
    onProgress(Math.min(i + BATCH, tickers.length), tickers.length)
    if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 200))
  }
  return results
}
