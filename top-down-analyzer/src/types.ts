// ── Core OHLCV bar structure ───────────────────────────────────────────────────
// Returned by fetchYFChart / fetchAllTimeframes / appendTodayBars.
// All arrays are parallel: index i in timestamps matches index i in all other arrays.
export interface BarData {
  timestamps: number[]
  opens:      number[]
  highs:      number[]
  lows:       number[]
  closes:     number[]
  volumes:    number[]
  prevClose?: number | null
}

// ── All-timeframes payload (return of fetchAllTimeframes) ─────────────────────
export interface AllTimeframes {
  weekly:    BarData
  daily:     BarData
  '4h':      BarData | null
  '1h':      BarData | null
  '15m':     BarData | null
  '5m':      BarData | null
  spy:       BarData | null
  vix:       VixData | null
  sectorETF: SectorETFData | null
}

// ── VIX data ──────────────────────────────────────────────────────────────────
// Returned inside AllTimeframes.vix.
// Use `.current` for the VIX level — NOT `.vix`.
export interface VixData {
  current: number          // current VIX level (today's close)
  rising:  boolean         // true if current > 5-day-ago close
  level:   'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME'
  pct52:   number          // 0-100 where current sits in the 52-week range
  low52:   number
  high52:  number
}

// ── Sector ETF context ────────────────────────────────────────────────────────
export interface SectorETFData {
  sector: string
  etf:    string
  closes: number[]
}

// ── Scanner result ────────────────────────────────────────────────────────────
// Return of scanTicker() in runScanner.js.
export interface ScanResult {
  ticker:    string
  ok:        true
  signal:    'CALL' | 'PUT' | 'NO TRADE'
  score:     number                          // 0–100
  rawConf:   number                          // -1 to +1
  grade:     'A+' | 'A' | 'B' | 'C' | null
  weekly:    'bull' | 'bear' | 'neutral'
  daily:     'bull' | 'bear' | 'neutral'
  shortTerm: 'bull' | 'bear' | 'neutral'
  pctChange: number | null
  volSpike:  number | null
  rsi:       number | null
  adx:       number | null
  price:     number | null
  bull:      number
  bear:      number
  sparkline: number[]
  stage:     'S1' | 'S2' | 'S3' | 'S4' | null
  rsVsSpy:   number | null
  tightness: number | null
}

export interface ScanError {
  ticker: string
  ok:     false
  error:  string
}

export type ScanRow = ScanResult | ScanError

// ── Indicator return types ────────────────────────────────────────────────────

export interface ADXResult {
  adx:       number
  plusDI:    number
  minusDI:   number
  adxRising: boolean
  adxSlope:  number
}

export interface MACDResult {
  macd:          number
  signal:        number
  histogram:     number
  prevHistogram: number | null
}

export interface VolumeSpike {
  last:        number
  avg:         number
  ratio:       number
  spike:       boolean
  strongSpike: boolean
  lowVolume:   boolean
}

export interface VWAPResult {
  vwap:       number
  price:      number
  pctFrom:    number
  crossAbove: boolean
  crossBelow: boolean
  period:     number
  aboveVwap:  boolean
}

export type Direction = 'bull' | 'bear' | 'neutral'

// ── Options chain recommendation ──────────────────────────────────────────────
// Used in OptionsChain.jsx — recs is an object, NOT an array.
// Access recs.primary, NOT recs[0].
export interface Recommendations {
  primary:   Recommendation | null
  secondary: Recommendation | null
  [key: string]: Recommendation | null | undefined
}

export interface Recommendation {
  type:        'CALL' | 'PUT'
  strike:      number
  expiry:      string
  premium:     number
  breakeven:   number
  maxRisk:     number
  targetGain:  number
  confidence:  number
  rationale:   string[]
}
