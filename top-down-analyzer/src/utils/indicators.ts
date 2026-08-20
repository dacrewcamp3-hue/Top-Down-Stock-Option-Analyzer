// Pure indicator calculation functions.
// All return null when there is insufficient data rather than throwing.

import type { ADXResult, MACDResult, VWAPResult, VolumeSpike, BarData } from '../types'

// ADX (14) with +DI and -DI — "21 Savage" rule: ADX≥21 and +DI≥21 = bull, -DI≥21 = bear
export function calcADX(highs: number[], lows: number[], closes: number[], period = 14): ADXResult | null {
  const n = highs.length
  if (n < period * 2) return null

  const trs = [], plusDMs = [], minusDMs = []
  for (let i = 1; i < n; i++) {
    const hiDiff = highs[i] - highs[i - 1]
    const loDiff = lows[i - 1] - lows[i]
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ))
    plusDMs.push(hiDiff > loDiff && hiDiff > 0 ? hiDiff : 0)
    minusDMs.push(loDiff > hiDiff && loDiff > 0 ? loDiff : 0)
  }

  // Wilder (RMA) smoothing — seed with SMA of first `period` bars, then apply
  // prev*(period-1)/period + current/period.  This matches ADX(14,14) as defined
  // by Wilder and implemented by TradingView / most platforms, keeping all output
  // values in the same 0-100 range as the inputs (critical for ADX).
  const wilderSmooth = arr => {
    let v = arr.slice(0, period).reduce((a, b) => a + b, 0) / period
    const out = [v]
    for (let i = period; i < arr.length; i++) {
      v = (v * (period - 1) + arr[i]) / period
      out.push(v)
    }
    return out
  }

  const smTR  = wilderSmooth(trs)
  const smPDM = wilderSmooth(plusDMs)
  const smMDM = wilderSmooth(minusDMs)

  const dxArr = smTR.map((tr, i) => {
    if (tr === 0) return 0
    const pDI = (smPDM[i] / tr) * 100
    const mDI = (smMDM[i] / tr) * 100
    const sum = pDI + mDI
    return sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100
  })
  if (dxArr.length < period) return null

  const smDX = wilderSmooth(dxArr)
  const m    = smTR.length - 1
  const tr   = smTR[m]

  const lastAdx = smDX[smDX.length - 1]
  const prevAdx = smDX.length > 1 ? smDX[smDX.length - 2] : lastAdx
  return {
    adx:      Math.round(lastAdx * 10) / 10,
    plusDI:   Math.round((tr === 0 ? 0 : (smPDM[m] / tr) * 100) * 10) / 10,
    minusDI:  Math.round((tr === 0 ? 0 : (smMDM[m] / tr) * 100) * 10) / 10,
    adxRising: lastAdx > prevAdx,
    adxSlope:  +(lastAdx - prevAdx).toFixed(2),
  }
}

export function calcEMASeries(closes: number[], period: number): (number | null)[] {
  if (closes.length < period) return new Array(closes.length).fill(null)
  const k = 2 / (period + 1)
  const result = new Array(period - 1).fill(null)
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  result.push(ema)
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

export function calcEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  const series = calcEMASeries(closes, period)
  return series[series.length - 1]
}

// MA Stack: 8, 15, 30, 65, 200 EMAs — 200 = outer ring, 30 = midfield (final decision), 8 = entry/exit
export function calcMAStack(closes) {
  if (!closes || closes.length < 8) return null
  const price = closes[closes.length - 1]

  // Compute full series for 200 and 65 to enable cross detection
  const ema200Series = calcEMASeries(closes, 200)
  const ema65Series  = calcEMASeries(closes, 65)

  const mas: Array<{
    period: number; val: number | null; role: string; label: string; note: string
    above?: boolean; pctFrom?: number
  }> = [
    { period: 200, val: ema200Series[ema200Series.length - 1], role: 'outer',    label: '200', note: 'Most Bullish · Outer Ring' },
    { period: 65,  val: ema65Series[ema65Series.length - 1],   role: 'strong',   label: '65',  note: 'Trend Strength' },
    { period: 30,  val: calcEMA(closes, 30), role: 'midfield', label: '30',  note: 'Midfield · Final Decision' },
    { period: 15,  val: calcEMA(closes, 15), role: 'minor',    label: '15',  note: 'Momentum' },
    { period: 8,   val: calcEMA(closes, 8),  role: 'entry',    label: '8',   note: 'Entry / Exit Only' },
  ]

  let bullCount = 0, bearCount = 0, validCount = 0
  for (const ma of mas) {
    if (ma.val != null) {
      ma.above = price > ma.val
      ma.pctFrom = ((price - ma.val) / ma.val) * 100
      if (ma.above) bullCount++; else bearCount++
      validCount++
    }
  }

  const ema30   = mas.find(m => m.period === 30)
  const above30 = ema30?.val != null ? price > ema30.val : null

  // Golden Cross: EMA 65 crosses above EMA 200 (shorter MA above longer MA = bullish)
  // Death Cross:  EMA 65 crosses below EMA 200 (shorter MA below longer MA = bearish)
  const ema200 = mas[0].val
  const ema65  = mas[1].val
  const goldenState = ema200 != null && ema65 != null ? ema65 > ema200 : null

  let crossType = null, crossBarsAgo = null
  if (ema200 != null && ema65 != null) {
    const len = Math.min(ema200Series.length, ema65Series.length)
    for (let i = len - 1; i > 0; i--) {
      const c200 = ema200Series[i], c65 = ema65Series[i]
      const p200 = ema200Series[i - 1], p65 = ema65Series[i - 1]
      if (c200 == null || c65 == null || p200 == null || p65 == null) continue
      const was65Above = p65 > p200
      const now65Above = c65 > c200
      if (was65Above !== now65Above) {
        crossBarsAgo = (len - 1) - i
        crossType    = now65Above ? 'golden' : 'death'
        break
      }
    }
  }

  const emaSeparation = ema200 != null && ema65 != null
    ? +((ema200 - ema65) / ema65 * 100).toFixed(2)
    : null

  return {
    price, mas, bullCount, bearCount, validCount, above30,
    signal: above30 === null ? 'NEUTRAL' : above30 ? 'BULLISH' : 'BEARISH',
    goldenState, crossType, crossBarsAgo, ema200, ema65, emaSeparation,
  }
}

export function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) gains += d; else losses -= d
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
  }
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

// Full RSI series — same Wilder smoothing as calcRSI, but returns every bar
function calcRSISeries(closes, period = 14) {
  if (closes.length < period + 1) return new Array(closes.length).fill(null)
  const result = new Array(period).fill(null)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return result
}

// RSI(14) + EMA(20) signal line with cross detection for swing entry rules:
//   Bullish: RSI crosses above EMA(20)  OR  RSI crosses above 44
//   Bearish: RSI crosses below 43       OR  RSI crosses below EMA(20)
export function calcSwingRSI(closes) {
  if (!closes || closes.length < 36) return null
  const rsiSeries = calcRSISeries(closes, 14)
  const validRsi = rsiSeries.filter(v => v !== null)
  if (validRsi.length < 22) return null

  const ema20 = calcEMASeries(validRsi, 20)
  const n = validRsi.length
  const curRsi  = validRsi[n - 1]
  const prevRsi = validRsi[n - 2]
  const curEma  = ema20[n - 1]
  const prevEma = ema20[n - 2]
  if (curEma === null || prevEma === null) return null

  const crossAboveEma = prevRsi < prevEma && curRsi >= curEma
  const crossAbove44  = prevRsi < 44       && curRsi >= 44
  const crossBelow43  = prevRsi > 43       && curRsi <= 43
  const crossBelowEma = prevRsi > prevEma  && curRsi <= curEma

  const bullTriggers = []
  if (crossAboveEma) bullTriggers.push('Crossed above EMA(20)')
  if (crossAbove44)  bullTriggers.push('Crossed above 44')

  const bearTriggers = []
  if (crossBelow43)  bearTriggers.push('Crossed below 43')
  if (crossBelowEma) bearTriggers.push('Crossed below EMA(20)')

  let signal = 'NEUTRAL'
  let triggers = []
  if (bullTriggers.length > 0 && bearTriggers.length === 0) {
    signal = 'BULLISH'; triggers = bullTriggers
  } else if (bearTriggers.length > 0) {
    signal = 'BEARISH'; triggers = bearTriggers
  }

  return {
    rsi:     Math.round(curRsi  * 10) / 10,
    prevRsi: Math.round(prevRsi * 10) / 10,
    ema20:   Math.round(curEma  * 10) / 10,
    signal,
    triggers,
    aboveEma: curRsi > curEma,
    above44:  curRsi > 44,
    below43:  curRsi < 43,
    crossAboveEma,
    crossAbove44,
    crossBelow43,
    crossBelowEma,
  }
}

export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): MACDResult | null {
  const ema12 = calcEMASeries(closes, fast)
  const ema26 = calcEMASeries(closes, slow)

  const macdValues = []
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] != null && ema26[i] != null) macdValues.push(ema12[i] - ema26[i])
  }
  if (macdValues.length < signal) return null

  const signalSeries = calcEMASeries(macdValues, signal)
  const n = macdValues.length
  const lastMACD = macdValues[n - 1]
  const lastSig = signalSeries[n - 1]
  return {
    macd: lastMACD,
    signal: lastSig,
    histogram: lastMACD - lastSig,
    prevHistogram: n > 1 ? macdValues[n - 2] - signalSeries[n - 2] : null,
  }
}

// EMA slope over `lookback` bars — positive slope = bull
export function detectTrend(closes, emaSeries, lookback = 5) {
  const last = emaSeries[emaSeries.length - 1]
  const prev = emaSeries[emaSeries.length - 1 - lookback]
  if (last == null || prev == null || prev === 0) return null
  const pct = (last - prev) / prev
  if (pct > 0.002) return 'bull'
  if (pct < -0.002) return 'bear'
  return 'neutral'
}

// Compare recent vs prior half of lookback window
export function detectStructure(highs, lows, lookback = 20) {
  if (highs.length < lookback) return null
  const h = highs.slice(-lookback)
  const l = lows.slice(-lookback)
  const mid = Math.floor(lookback / 2)
  const recentHigh = Math.max(...h.slice(mid))
  const priorHigh  = Math.max(...h.slice(0, mid))
  const recentLow  = Math.min(...l.slice(mid))
  const priorLow   = Math.min(...l.slice(0, mid))
  if (recentHigh > priorHigh && recentLow > priorLow) return 'bull'
  if (recentHigh < priorHigh && recentLow < priorLow) return 'bear'
  return 'neutral'
}

// Within `threshold` of the range high = near resistance (bear), low = near support (bull)
const FIB_RATIOS = [
  { label: '0%',    ratio: 0,     key: false },
  { label: '23.6%', ratio: 0.236, key: false },
  { label: '38.2%', ratio: 0.382, key: true  },
  { label: '50%',   ratio: 0.5,   key: true  },
  { label: '61.8%', ratio: 0.618, key: true  },
  { label: '78.6%', ratio: 0.786, key: true  },
  { label: '88.6%', ratio: 0.886, key: true  },
  { label: '100%',  ratio: 1.0,   key: false },
]

// Returns Fibonacci retracement levels from the most significant peak/trough
// in the lookback window of daily OHLCV data.
export function calcFibonacci(highs, lows, closes, lookback = 120) {
  if (!highs || highs.length < 10) return null
  const h = highs.slice(-lookback)
  const l = lows.slice(-lookback)

  let peakIdx = 0, peak = h[0]
  for (let i = 1; i < h.length; i++) {
    if (h[i] > peak) { peak = h[i]; peakIdx = i }
  }

  let troughIdx = 0, trough = l[0]
  for (let i = 1; i < l.length; i++) {
    if (l[i] < trough) { trough = l[i]; troughIdx = i }
  }

  const range = peak - trough
  if (range <= 0) return null

  // Uptrend: trough formed first, then peak → retracement goes down from peak
  // Downtrend: peak formed first, then trough → retracement goes up from trough
  const isUptrend = troughIdx < peakIdx
  const currentPrice = closes[closes.length - 1]

  // Standard charting convention:
  // Uptrend  → anchor 0% at trough (swing low), 100% at peak (swing high)
  // Downtrend → anchor 0% at peak  (swing high), 100% at trough (swing low)
  const levels = FIB_RATIOS.map(r => ({
    label: r.label,
    ratio: r.ratio,
    price: isUptrend
      ? trough + range * r.ratio   // 0% = trough (bottom), 100% = peak (top)
      : peak   - range * r.ratio,  // 0% = peak  (top),    100% = trough (bottom)
    key: r.key,
  }))

  // Sort by price descending for display (always shows high → low)
  const byPrice = [...levels].sort((a, b) => b.price - a.price)

  // Find which zone current price sits in
  let currentZone = -1
  for (let i = 0; i < byPrice.length - 1; i++) {
    if (currentPrice <= byPrice[i].price && currentPrice >= byPrice[i + 1].price) {
      currentZone = i
      break
    }
  }

  // 2-bar cross signals using the last 3 daily closes.
  // Standard convention: uptrend 78.6% = near peak (high level); 38.2% = lower support.
  // Uptrend:   losing 78.6% (dropping from near-peak) = trim/exit warning
  //            reclaiming 38.2% (bouncing off lower support) = possible entry
  // Downtrend: losing 38.2% (falling through lower bounce level) = trim/exit
  //            reclaiming 78.6% (bouncing to near-high) = possible entry
  const level786 = levels.find(lv => lv.label === '78.6%')?.price ?? null
  const level382 = levels.find(lv => lv.label === '38.2%')?.price ?? null
  const nc = closes.length

  const crossBelow786 = nc >= 3 && level786 != null
    && closes[nc - 1] < level786
    && closes[nc - 2] < level786
    && closes[nc - 3] >= level786

  const crossAbove382 = nc >= 3 && level382 != null
    && closes[nc - 1] > level382
    && closes[nc - 2] > level382
    && closes[nc - 3] <= level382

  // Fibonacci extensions — project targets beyond the swing (take-profit levels)
  // Uptrend: targets above peak; Downtrend: targets below trough
  const extensions = [
    {
      label: '127.2%', key: true, extension: true,
      price: isUptrend ? peak + range * 0.272 : trough - range * 0.272,
    },
    {
      label: '161.8%', key: true, extension: true,
      price: isUptrend ? peak + range * 0.618 : trough - range * 0.618,
    },
  ]

  return {
    peak, trough, range, isUptrend, currentPrice, levels, byPrice, currentZone,
    level786, level382, crossBelow786, crossAbove382, extensions,
  }
}

// Average True Range (Wilder's smoothing) — measures volatility in dollar terms
export function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  const n = closes.length
  if (n < period + 1) return null
  const trs = []
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i]  - lows[i],
      Math.abs(highs[i]  - closes[i - 1]),
      Math.abs(lows[i]   - closes[i - 1])
    )
    trs.push(tr)
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
  }
  return +atr.toFixed(4)
}

export function detectKeyLevel(close, highs, lows, lookback = 50, threshold = 0.02) {
  const h = highs.slice(-lookback)
  const l = lows.slice(-lookback)
  const rangeHigh = Math.max(...h)
  const rangeLow  = Math.min(...l)
  const fromHigh = (rangeHigh - close) / close
  const fromLow  = (close - rangeLow)  / close
  if (fromLow  < threshold) return 'bull'
  if (fromHigh < threshold) return 'bear'
  return 'neutral'
}

// Last bar volume vs prior N-bar average
export function detectVolume(volumes, avgPeriod = 20) {
  if (volumes.length < avgPeriod + 1) return null
  const last = volumes[volumes.length - 1]
  const avg = volumes.slice(-avgPeriod - 1, -1).reduce((a, b) => a + b, 0) / avgPeriod
  if (avg === 0) return null
  if (last > avg * 1.5) return 'bull'
  if (last < avg * 0.7) return 'bear'
  return 'neutral'
}

// ── 5-Min OR Break & Retest ───────────────────────────────────────────────────
// Detects the 15-min Opening Range, whether price broke it on 5-min bars,
// and whether price has come back to retest the broken level.
export function calcORBreakRetest(bars5m, bars15m) {
  if (!bars5m || !bars15m) return null
  const { opens: o5, closes: c5, highs: h5, lows: l5, timestamps: ts5 } = bars5m
  const { highs: h15, lows: l15, closes: c15, timestamps: ts15 } = bars15m
  if (!ts5 || !ts15 || c5.length < 3) return null

  // ── Step 1: find the first two 15m bars of today's session (= first 30 min) ──
  // Threshold >14400s (4 hrs) — catches overnight gaps (17.5+ hrs) but not trading halts
  let si15 = 0
  for (let i = ts15.length - 1; i > 0; i--) {
    if (ts15[i] - ts15[i - 1] > 14400) { si15 = i; break }
  }
  // Use both bar[si15] and bar[si15+1] to form the 30-minute opening range
  const ei15   = Math.min(si15 + 1, ts15.length - 1)
  const orHigh = Math.max(h15[si15], h15[ei15])
  const orLow  = Math.min(l15[si15], l15[ei15])
  if (!orHigh || !orLow || orHigh <= orLow) return null

  // ── Step 2: find first 5m bar of today's session ──
  let si5 = 0
  for (let i = ts5.length - 1; i > 0; i--) {
    if (ts5[i] - ts5[i - 1] > 14400) { si5 = i; break }
  }

  // ── Step 3: detect first OR break on 5m close ──
  let breakDir = null
  let breakIdx = -1
  for (let i = si5; i < c5.length; i++) {
    if (breakDir === null && c5[i] > orHigh) { breakDir = 'bull'; breakIdx = i; break }
    if (breakDir === null && c5[i] < orLow)  { breakDir = 'bear'; breakIdx = i; break }
  }

  if (!breakDir) {
    const lastClose = c5[c5.length - 1]
    // Inside range — 8 EMA 2-bar cross-and-close is the entry/exit guide
    let ema8Signal = 'neutral'
    if (c5.length >= 10) {
      const ema8s = calcEMASeries(c5, 8)
      const n = c5.length
      const aboveLast = c5[n - 1] > ema8s[n - 1]
      const abovePrev = c5[n - 2] > ema8s[n - 2]
      if (aboveLast && abovePrev)    ema8Signal = 'bull'
      else if (!aboveLast && !abovePrev) ema8Signal = 'bear'
    }
    return {
      orHigh, orLow, breakDir: null,
      lastClose,
      pctFromHigh: +((orHigh - lastClose) / orHigh * 100).toFixed(2),
      pctFromLow:  +((lastClose - orLow)  / orLow  * 100).toFixed(2),
      signal: 'INSIDE',
      ema8Signal,
    }
  }

  const level    = breakDir === 'bull' ? orHigh : orLow
  // Tolerance: 0.25% of break level or 10% of OR range, whichever is smaller
  const tolerance = Math.min(level * 0.0025, (orHigh - orLow) * 0.25)

  // ── Step 4: detect retest after break ──
  // Rule: after break, price must pull back to the level (retest bar).
  // Entry requires the bar AFTER the retest to OPEN and CLOSE on the break side —
  // the retest bar itself is never the entry bar.
  let retestIdx       = -1
  let retestConfirmed = false
  let retestFailed    = false

  for (let i = breakIdx + 1; i < c5.length; i++) {
    const inZone = breakDir === 'bull'
      ? l5[i] <= level + tolerance  // low dipped back near ORH
      : h5[i] >= level - tolerance  // high bounced back near ORL

    if (inZone && retestIdx === -1) {
      retestIdx = i
      continue  // this is the retest/touch bar — skip; wait for NEXT bar
    }

    if (retestIdx !== -1) {
      // Confirmed: the bar AFTER the retest must OPEN and CLOSE on the break side
      if (breakDir === 'bull' && o5[i] > level && c5[i] > level) { retestConfirmed = true; break }
      if (breakDir === 'bear' && o5[i] < level && c5[i] < level) { retestConfirmed = true; break }
      // Failed: price closed back through the break level (back inside the opening range)
      if (breakDir === 'bull' && c5[i] < level)  { retestFailed = true; break }
      if (breakDir === 'bear' && c5[i] > level)  { retestFailed = true; break }
    }
  }

  const lastClose = c5[c5.length - 1]
  const pctFromLevel = +((lastClose - level) / level * 100).toFixed(2)

  // ── Step 5: determine signal ──
  let signal = 'BREAK'  // broke but no retest yet
  if (retestFailed)    signal = 'FAILED'
  else if (retestConfirmed) {
    const stillHolding = breakDir === 'bull' ? lastClose > level : lastClose < level
    if (stillHolding) {
      signal = 'ENTER'
    } else {
      // 5m close lost the level — check if the most recent 15m bar recaptured it
      const last15Close = c15[c15.length - 1]
      const recaptured  = breakDir === 'bull' ? last15Close > level : last15Close < level
      signal = recaptured ? 'RECAPTURED' : 'LOST'
    }
  } else if (retestIdx !== -1) signal = 'RETEST'  // currently in the retest zone

  return {
    orHigh, orLow,
    breakDir,
    level,
    tolerance: +tolerance.toFixed(3),
    retestDetected:  retestIdx !== -1,
    retestConfirmed,
    retestFailed,
    lastClose,
    pctFromLevel,
    signal,
    // signal meanings:
    // INSIDE      = price still within OR, no break yet
    // BREAK       = broke out, no retest yet — wait
    // RETEST      = currently pulling back to level — watch closely
    // ENTER       = retest confirmed + 5m holding above/below level
    // RECAPTURED  = 5m dipped below level but 15m bar reclosed above — re-entry
    // LOST        = retest confirmed but 5m and 15m both below/above level
    // FAILED      = retest failed, price collapsed back through OR
  }
}

// ── Pullback vs Retracement Classifier ───────────────────────────────────────
// Classifies where current price sits on the pullback-to-reversal spectrum.
// Uses Fibonacci anchors from calcFibonacci + EMA positioning + volume character.
export function classifyPullback(fibLevels, bars) {
  if (!fibLevels || !bars) return null
  const { peak, trough, range, isUptrend, currentPrice } = fibLevels
  if (peak == null || trough == null || range == null || range <= 0) return null

  const { closes, volumes } = bars
  if (!closes || closes.length < 20) return null
  const n = closes.length
  const cur = currentPrice ?? closes[n - 1]

  // 0% = at the swing extreme (no pullback), 100% = fully reversed to opposite extreme
  let retracePct = isUptrend
    ? ((peak - cur) / range) * 100
    : ((cur - trough) / range) * 100
  retracePct = Math.max(-5, Math.min(105, retracePct))

  const e8Arr  = calcEMASeries(closes, 8)
  const e15Arr = calcEMASeries(closes, 15)
  const e65Arr = calcEMASeries(closes, 65)
  const e8  = e8Arr[n - 1]
  const e15 = e15Arr[n - 1]
  const e65 = e65Arr[n - 1]
  const holds8  = isUptrend ? cur >= e8  : cur <= e8
  const holds15 = isUptrend ? cur >= e15 : cur <= e15
  const holds65 = isUptrend ? cur >= e65 : cur <= e65
  const emaSupport = holds8 ? '8' : holds15 ? '15' : holds65 ? '65' : null

  // Volume character: recent 5-bar average vs prior 15-bar average
  const recent5 = volumes.slice(-5).filter(v => v > 0)
  const prior15 = volumes.slice(-20, -5).filter(v => v > 0)
  const avgRec  = recent5.length  ? recent5.reduce((a, b) => a + b, 0) / recent5.length  : 0
  const avgPri  = prior15.length  ? prior15.reduce((a, b) => a + b, 0) / prior15.length  : avgRec
  const volRatio = avgPri > 0 ? avgRec / avgPri : 1
  const volumeSignal = volRatio < 0.70 ? 'DECLINING' : volRatio > 1.40 ? 'SURGE' : 'ELEVATED'

  let type, label, color, actionLabel, actionColor, description

  if (retracePct <= 0) {
    type = 'TRENDING'; label = 'AT EXTREME'; color = '#60a5fa'
    actionLabel = 'WAIT FOR PULLBACK'; actionColor = '#60a5fa'
    description = `Price is at or beyond the swing ${isUptrend ? 'high' : 'low'} — momentum is strong but there is no pullback entry yet. Wait for price to pull back to a Fibonacci level (ideally 23.6–38.2%) before entering. Chasing here risks buying the top of the move.`
  } else if (retracePct < 23.6) {
    type = 'MICRO'; label = 'MICRO PULLBACK'; color = '#10b981'
    actionLabel = 'HIGHEST CONVICTION'; actionColor = '#10b981'
    description = `Only ${retracePct.toFixed(0)}% retraced — a micro pullback inside a powerful trend. ${holds8 ? 'The 8 EMA is still intact, confirming strong momentum.' : 'Testing the 8 EMA area.'} ${volumeSignal === 'DECLINING' ? 'Volume drying up on the dip — no distribution pressure, institutions are holding.' : ''} Aggressive traders may enter here; conservative traders look for a 2-bar close confirmation.`
  } else if (retracePct < 38.2) {
    type = 'TIGHT'; label = 'TIGHT PULLBACK'; color = '#34d399'
    actionLabel = holds15 ? 'WATCH FOR ENTRY' : 'WAIT — EMA TEST'
    actionColor = holds15 ? '#34d399' : '#f59e0b'
    description = `${retracePct.toFixed(0)}% pullback into the 23.6–38.2% Fibonacci zone. ${isUptrend ? 'Bulls' : 'Bears'} remain in clear control. ${holds8 ? 'The 8 EMA is holding as support.' : holds15 ? 'The 15 EMA is providing support — a classic continuation entry zone.' : 'No EMA support yet; wait for a 2-bar reclaim before entering.'} ${volumeSignal === 'DECLINING' ? 'Volume declining on the dip confirms no distribution pressure.' : ''}`
  } else if (retracePct < 50) {
    type = 'NORMAL'; label = 'NORMAL PULLBACK'; color = '#a3e635'
    actionLabel = holds15 ? 'PRIME ENTRY ZONE' : 'WAIT FOR CONFIRM'
    actionColor = holds15 ? '#a3e635' : '#f59e0b'
    description = `${retracePct.toFixed(0)}% pullback into the 38.2–50% zone — the most common healthy correction depth. ${holds15 ? 'The 15 EMA is holding: this is the textbook buy-the-dip level in a trending market.' : holds65 ? 'The 15 EMA has been broken but the 65 EMA is intact. Wait for a 15 EMA reclaim before entering.' : 'Both the 15 and 65 EMAs lost. Stand aside until structure recovers.'} ${volumeSignal === 'DECLINING' ? 'Volume declining — institutions are not selling this dip.' : volumeSignal === 'SURGE' ? 'Volume surge on the pullback — wait for confirmation before entering.' : ''}`
  } else if (retracePct < 61.8) {
    type = 'DEEP'; label = 'DEEP PULLBACK'; color = '#f59e0b'
    actionLabel = holds65 ? 'CAUTION — CONFIRM FIRST' : 'STAND ASIDE'
    actionColor = '#f59e0b'
    description = `${retracePct.toFixed(0)}% — a deep pullback approaching the critical 61.8% Fibonacci level. ${holds65 ? 'The 65 EMA is the last major support. Only enter on a strong 2-bar close back above the 15 EMA.' : 'The 65 EMA has been broken — trend momentum is severely weakened.'} ${volumeSignal === 'SURGE' ? 'Elevated volume suggests possible distribution — high risk for continuation.' : ''} This depth requires extra patience and confirmation before entry.`
  } else if (retracePct < 78.6) {
    type = 'RETRACEMENT'; label = 'RETRACEMENT'; color = '#f97316'
    actionLabel = 'AVOID — WAIT FOR STRUCTURE'; actionColor = '#f97316'
    description = `${retracePct.toFixed(0)}% — this is a full retracement, not a simple pullback. Price has given back the majority of the recent ${isUptrend ? 'rally' : 'decline'} and the trend structure is in question. ${volumeSignal === 'SURGE' ? 'Volume surge confirms institutional repositioning is underway.' : ''} Do not trade in the original direction. Wait for a new base and 50 EMA reclaim with conviction before reconsidering.`
  } else {
    type = 'REVERSAL'
    label = retracePct > 100 ? 'STRUCTURE BREAK' : 'POTENTIAL REVERSAL'
    color = '#ef4444'; actionLabel = 'DO NOT ENTER'; actionColor = '#ef4444'
    description = retracePct > 100
      ? `Price has broken ${isUptrend ? 'below the prior swing low' : 'above the prior swing high'} — the trend structure has reversed. The original thesis is invalidated. Wait for an entirely new base and confirmed change of character before re-entering.`
      : `${retracePct.toFixed(0)}% retraced — price has nearly fully reversed the prior ${isUptrend ? 'rally' : 'decline'}. This is not a pullback; it is a potential reversal. Do not trade in the original direction until a new structure forms.`
  }

  return {
    type, label, color, actionLabel, actionColor, description,
    retracePct: +retracePct.toFixed(1),
    isUptrend,
    emaSupport, holds8, holds15, holds65,
    e8:  e8  != null ? +e8.toFixed(2)  : null,
    e15: e15 != null ? +e15.toFixed(2) : null,
    e65: e65 != null ? +e65.toFixed(2) : null,
    volumeSignal, volRatio: +volRatio.toFixed(2),
    peak, trough, range,
  }
}

// Last candle direction + simple engulfing check
export function detectEntryTrigger(opens, closes) {
  const n = closes.length
  if (n < 2) return null
  const lC = closes[n - 1], lO = opens[n - 1]
  const pC = closes[n - 2], pO = opens[n - 2]
  // Bullish engulfing
  if (lC > lO && pC < pO && lC > pO && lO < pC) return 'bull'
  // Bearish engulfing
  if (lC < lO && pC > pO && lC < pO && lO > pC) return 'bear'
  // Simple candle direction
  if (lC > lO) return 'bull'
  if (lC < lO) return 'bear'
  return 'neutral'
}

// Intraday session VWAP — resets each day using timestamps (overnight gap > 4 hrs).
export function calcSessionVWAP(bars: BarData): number | null {
  const { highs, lows, closes, volumes, timestamps } = bars
  if (!timestamps || closes.length < 2) return null
  let si = 0
  for (let i = timestamps.length - 1; i > 0; i--) {
    if (timestamps[i] - timestamps[i - 1] > 14400) { si = i; break }
  }
  let tpv = 0, vol = 0
  for (let i = si; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3
    const v  = volumes[i] ?? 0
    tpv += tp * v
    vol += v
  }
  return vol > 0 ? tpv / vol : null
}

// 20-day rolling VWAP — typical price × volume, summed over the period.
// Returns vwap price, % from current price, position, and 2-bar cross signal.
export function calcVWAP(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): VWAPResult | null {
  const n = closes.length
  if (n < period + 3 || !volumes || volumes.length < period + 3) return null

  let sumTPV = 0, sumVol = 0
  for (let i = n - period; i < n; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3
    sumTPV += tp * (volumes[i] || 0)
    sumVol += (volumes[i] || 0)
  }
  if (sumVol === 0) return null

  const vwap  = sumTPV / sumVol
  const price = closes[n - 1]
  const pctFrom = ((price - vwap) / vwap) * 100

  // 2-bar cross: last 2 closes on one side, bar before on the other
  const c1 = closes[n - 1], c2 = closes[n - 2], c3 = closes[n - 3]
  const crossAbove = c1 > vwap && c2 > vwap && c3 <= vwap
  const crossBelow = c1 < vwap && c2 < vwap && c3 >= vwap

  return { vwap, price, pctFrom, crossAbove, crossBelow, period, aboveVwap: price > vwap }
}

// ── Double Top sub-type stats ──────────────────────────────────────────────────
// Big M double top: two peaks near the same price with an unusually tall left-side ascent (≥15% rise before Peak 1).
export const BIG_M_STATS = {
  perfRankBull:  { rank: 8,  of: 36 },
  failRateBull:  14,
  avgDropBull:   17,
  pullbackBull:  67,
  targetMetBull: 55,
  volumeBull:   'downward',
  perfRankBear:  { rank: 10, of: 19 },
  failRateBear:  8,
  avgDropBear:   22,
  pullbackBear:  63,
  targetMetBear: 58,
  volumeBear:   'downward',
  trendContext: {
    bull: 'Short-term bearish reversal',
    bear: 'Short-term bearish reversal',
  },
  note: 'Unusually tall left-side ascent (≥15% before Peak 1) — mirror of Big W',
}

// Adam & Eve double top: left peak narrow/spiked (Adam), right peak wide/rounded (Eve).
export const TOP_ADAM_EVE_STATS = {
  perfRankBull:  { rank: 10, of: 36 },
  failRateBull:  21,   // % breakeven failure
  avgDropBull:   16,   // average drop after neckline break
  pullbackBull:  64,   // % with pullback to neckline
  targetMetBull: 54,   // % meeting price target
  volumeBull:   'downward',
  trendContext: {
    bull: 'Short-term bearish reversal',
    bear: null,
  },
  note: 'First peak is a narrow, pointed spike (Adam) · second peak is wide and rounded (Eve)',
}

// Adam & Adam double top: both peaks narrow, pointed spikes.
export const TOP_ADAM_ADAM_STATS = {
  perfRankBull:  { rank: 19, of: 36 },
  failRateBull:  25,
  avgDropBull:   15,
  pullbackBull:  64,
  targetMetBull: 64,
  volumeBull:   'downward',
  trendContext: {
    bull: 'Short-term bearish reversal',
    bear: null,
  },
  note: 'Both peaks are narrow, pointed spikes (Adam & Adam)',
}

// Eve & Adam double top: left peak wide/rounded (Eve), right peak narrow/spiked (Adam).
export const TOP_EVE_ADAM_STATS = {
  perfRankBull:  { rank: 16, of: 36 },
  failRateBull:  21,
  avgDropBull:   15,
  pullbackBull:  64,
  targetMetBull: 55,
  volumeBull:   'upward',
  trendContext: {
    bull: 'Short-term bearish reversal',
    bear: null,
  },
  note: 'Left peak wide and rounded (Eve) · right peak narrow and spiked (Adam) · volume trends up (unusual)',
}

// Eve & Eve double top: both peaks wide, rounded domes.
export const TOP_EVE_EVE_STATS = {
  perfRankBull:  { rank: 12, of: 36 },
  failRateBull:  20,
  avgDropBull:   16,
  pullbackBull:  65,
  targetMetBull: 43,
  volumeBull:   'downward',
  trendContext: {
    bull: 'Short-term bearish reversal',
    bear: null,
  },
  note: 'Both peaks wide and rounded — gradual, dome-shaped turns at the highs',
}

// Eve & Eve double bottom stats (Bulkowski research).
// Both bottoms are wide, rounded — gradual accumulation zones, no sharp spikes.
export const EVE_EVE_STATS = {
  perfRankBull:  { rank: 5, of: 39 },
  failRateBull:  12,
  avgRiseBull:   50,
  pullbackBull:  65,
  targetMetBull: 65,
  volumeBull:   'downward',
  trendContext: {
    bull: 'Long-term bullish reversal',
    bear: null,
  },
  note: 'Both bottoms are wide, rounded valleys — gradual accumulation with no sharp spikes',
}

// Eve & Adam double bottom stats (Bulkowski research).
// Left bottom is wide/rounded (Eve), right bottom is narrow V-shaped spike (Adam).
export const EVE_ADAM_STATS = {
  perfRankBull:  { rank: 20, of: 39 },
  failRateBull:  12,
  avgRiseBull:   42,
  pullbackBull:  67,
  targetMetBull: 72,
  volumeBull:   'downward',
  trendContext: {
    bull: 'Long-term bullish reversal',
    bear: null,
  },
  note: 'Wide rounded left valley (Eve) followed by a narrow V-shaped right spike (Adam)',
}

// Adam & Eve double bottom stats (Bulkowski research).
// Left bottom is narrow V-shaped (Adam), right bottom is wide/rounded (Eve).
export const ADAM_EVE_STATS = {
  perfRankBull:  { rank: 17, of: 39 },
  failRateBull:  12,   // % breakeven failure
  avgRiseBull:   43,   // average rise after breakout
  pullbackBull:  67,   // % of formations with throwback to neckline
  targetMetBull: 69,   // % meeting price target
  volumeBull:   'downward',
  trendContext: {
    bull: 'Long-term bullish reversal',
    bear: null,
  },
  note: 'Narrow V-shaped left spike (Adam) followed by a wide rounded right valley (Eve)',
}

// Adam & Adam double bottom stats (Bulkowski research).
// Both bottoms are narrow, V-shaped / spiked — fast aggressive reversals at the lows.
// Detection: immediate neighbors (±1 bar) of each trough are ≥0.8% above the trough low.
export const ADAM_ADAM_STATS = {
  perfRankBull:  { rank: 26, of: 39 },
  failRateBull:  16,   // % breakeven failure
  avgRiseBull:   39,   // average rise after breakout
  pullbackBull:  67,   // % of formations with throwback to neckline
  targetMetBull: 73,   // % meeting price target
  volumeBull:   'downward',
  trendContext: {
    bull: 'Long-term bullish reversal',
    bear: null,
  },
  note: 'Both bottoms form narrow V-shaped spikes — sharp, fast reversals at the lows',
}

// Big W pattern performance stats (Bulkowski research).
// A Big W is a double bottom with an unusually tall left-side descent (≥15% drop before Bottom 1).
export const BIG_W_STATS = {
  perfRankBull:  { rank: 11, of: 39 },   // overall bullish performance rank (thepatternsite.com)
  failRateBull:  9,    // % breakeven failure in bull market
  failRateBear:  9,    // % breakeven failure in bear market
  avgRiseBull:   46,   // average rise after upside breakout (bull market)
  avgRiseBear:   30,   // average rise after upside breakout (bear market)
  pullbackBull:  64,   // % of formations with a pullback to neckline (bull mkt)
  pullbackBear:  66,   // % of formations with a pullback to neckline (bear mkt)
  targetMetBull: 74,   // % meeting price target (bull market)
  targetMetBear: 55,   // % meeting price target (bear market)
  volumeBull:   'downward',  // typical volume trend during pattern formation
  volumeBear:   'downward',
  trendContext: {
    bull: 'Continuation / consolidation within uptrend',
    bear: 'Long-term & short-term bullish reversal',
  },
}

// Double Top & Double Bottom detection using swing pivot analysis.
// timestamps = array of Unix seconds matching highs/lows/closes (optional but enables date display).
// Returns { doubleTop, doubleBottom } — each is null or a pattern object.
export function detectDoublePatterns(highs, lows, closes, timestamps = null, lookback = 150, swingPeriod = 5) {
  if (!highs || highs.length < swingPeriod * 2 + 10) return { doubleTop: null, doubleBottom: null }

  const start = Math.max(0, highs.length - lookback)
  const h  = highs.slice(start)
  const l  = lows.slice(start)
  const c  = closes.slice(start)
  const ts = timestamps ? timestamps.slice(start) : null
  const n  = h.length
  const currentPrice = c[n - 1]

  const fmtDate = unixSec => {
    if (!unixSec) return null
    return new Date(unixSec * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
    })
  }

  // True swing high: strictly highest in swingPeriod bars on each side
  const swingHighs = []
  for (let i = swingPeriod; i < n - swingPeriod; i++) {
    let ok = true
    for (let j = i - swingPeriod; j <= i + swingPeriod; j++) {
      if (j !== i && h[j] >= h[i]) { ok = false; break }
    }
    if (ok) swingHighs.push({ idx: i, price: h[i], date: fmtDate(ts?.[i]) })
  }

  // True swing low: strictly lowest in swingPeriod bars on each side
  const swingLows = []
  for (let i = swingPeriod; i < n - swingPeriod; i++) {
    let ok = true
    for (let j = i - swingPeriod; j <= i + swingPeriod; j++) {
      if (j !== i && l[j] <= l[i]) { ok = false; break }
    }
    if (ok) swingLows.push({ idx: i, price: l[i], date: fmtDate(ts?.[i]) })
  }

  const PRICE_TOL = 0.03  // peaks must be within 3% of each other
  const MIN_SEP   = 10    // at least 10 bars between peaks/troughs
  const MIN_DEPTH = 0.025 // neckline must be 2.5% away from peaks/troughs

  function scorePattern(priceDiff, depth, barsAgo) {
    const sim    = (1 - priceDiff / PRICE_TOL) * 40
    const dep    = Math.min(depth / 0.08, 1) * 35
    const recent = Math.max(0, 1 - barsAgo / 60) * 25
    return Math.round(sim + dep + recent)
  }

  // Adam bottom: true V-spike — ±1 avg ≥1.5% above trough AND ±2 avg ≥2.5% above trough.
  // Using two windows catches sharp spikes vs gradual rounding that ±1 alone misclassifies.
  function isNarrowBottom(arr, idx) {
    if (idx < 2 || idx >= arr.length - 2) return false
    const trough = arr[idx]
    const avg1   = (arr[idx - 1] + arr[idx + 1]) / 2
    const avg2   = (arr[idx - 2] + arr[idx + 2]) / 2
    return (avg1 - trough) / trough >= 0.015 && (avg2 - trough) / trough >= 0.025
  }

  // Adam top: true inverted V-spike — ±1 avg ≥1.5% below peak AND ±2 avg ≥2.5% below peak.
  function isNarrowTop(arr, idx) {
    if (idx < 2 || idx >= arr.length - 2) return false
    const peak = arr[idx]
    const avg1 = (arr[idx - 1] + arr[idx + 1]) / 2
    const avg2 = (arr[idx - 2] + arr[idx + 2]) / 2
    return (peak - avg1) / peak >= 0.015 && (peak - avg2) / peak >= 0.025
  }

  // ── Double Top (M pattern) ──
  let doubleTop = null
  for (let i = swingHighs.length - 1; i >= 1; i--) {
    const h2 = swingHighs[i]
    for (let j = i - 1; j >= 0; j--) {
      const h1 = swingHighs[j]
      if (h2.idx - h1.idx < MIN_SEP) continue

      const avgPeak   = (h1.price + h2.price) / 2
      const priceDiff = Math.abs(h1.price - h2.price) / avgPeak
      if (priceDiff > PRICE_TOL) continue

      const between = swingLows.filter(sl => sl.idx > h1.idx && sl.idx < h2.idx)
      if (between.length === 0) continue
      const neck = between.reduce((mn, sl) => sl.price < mn.price ? sl : mn)

      const depth = (avgPeak - neck.price) / avgPeak
      if (depth < MIN_DEPTH) continue

      const barsAgo   = n - 1 - h2.idx
      const confirmed = currentPrice < neck.price
      const target    = neck.price - (avgPeak - neck.price)
      const targetPct = +((neck.price - target) / neck.price * 100).toFixed(1)
      const strength  = scorePattern(priceDiff, depth, barsAgo)

      if (!doubleTop || strength > doubleTop.strength) {
        // Big M: check if the ascent BEFORE Peak 1 is unusually tall (≥15%)
        const priorLowsBefore1 = swingLows.filter(sl => sl.idx < h1.idx && h1.idx - sl.idx <= 60)
        let isBigM = false, leftSideRisePct = null
        if (priorLowsBefore1.length > 0) {
          const refLow      = priorLowsBefore1.reduce((mn, sl) => sl.price < mn.price ? sl : mn)
          leftSideRisePct   = +((h1.price - refLow.price) / refLow.price * 100).toFixed(1)
          isBigM            = leftSideRisePct >= 15
        }

        // Classify each peak: narrow spike (Adam) vs wide/rounded (Eve)
        // h1 = left/first peak, h2 = right/second peak (chronological order)
        const p1Narrow      = isNarrowTop(h, h1.idx)
        const p2Narrow      = isNarrowTop(h, h2.idx)
        const isAdamEveTop  = p1Narrow  && !p2Narrow   // left narrow (Adam) + right wide (Eve)
        const isEveAdamTop  = !p1Narrow && p2Narrow    // left wide (Eve) + right narrow (Adam)
        const isAdamAdamTop = p1Narrow  && p2Narrow    // both narrow spikes
        const isEveEveTop   = !p1Narrow && !p2Narrow   // both wide/rounded

        doubleTop = {
          type: 'DOUBLE TOP',
          peak1: h1.price,   peak1Date: h1.date,
          peak2: h2.price,   peak2Date: h2.date,
          avgPeak,
          neckline: neck.price, necklineDate: neck.date,
          target, targetPct, confirmed, barsAgo,
          priceDiff: +(priceDiff * 100).toFixed(2),
          depth: +(depth * 100).toFixed(1),
          strength,
          isBigM,
          leftSideRisePct,
          bigMStats: isBigM ? BIG_M_STATS : null,
          isAdamEveTop,
          topAdamEveStats:  isAdamEveTop  ? TOP_ADAM_EVE_STATS : null,
          isEveAdamTop,
          topEveAdamStats:  isEveAdamTop ? TOP_EVE_ADAM_STATS : null,
          isAdamAdamTop,
          topAdamAdamStats: isAdamAdamTop ? TOP_ADAM_ADAM_STATS : null,
          isEveEveTop,
          topEveEveStats:   isEveEveTop ? TOP_EVE_EVE_STATS : null,
        }
      }
    }
  }

  // ── Double Bottom (W pattern) ──
  let doubleBottom = null
  for (let i = swingLows.length - 1; i >= 1; i--) {
    const l2 = swingLows[i]
    for (let j = i - 1; j >= 0; j--) {
      const l1 = swingLows[j]
      if (l2.idx - l1.idx < MIN_SEP) continue

      const avgBottom  = (l1.price + l2.price) / 2
      const priceDiff  = Math.abs(l1.price - l2.price) / avgBottom
      if (priceDiff > PRICE_TOL) continue

      const between = swingHighs.filter(sh => sh.idx > l1.idx && sh.idx < l2.idx)
      if (between.length === 0) continue
      const neck = between.reduce((mx, sh) => sh.price > mx.price ? sh : mx)

      const depth = (neck.price - avgBottom) / neck.price
      if (depth < MIN_DEPTH) continue

      const barsAgo   = n - 1 - l2.idx
      const confirmed = currentPrice > neck.price
      const target    = neck.price + (neck.price - avgBottom)
      const targetPct = +((target - neck.price) / neck.price * 100).toFixed(1)
      const strength  = scorePattern(priceDiff, depth, barsAgo)

      if (!doubleBottom || strength > doubleBottom.strength) {
        // Big W: check if the descent BEFORE Bottom 1 is unusually tall (≥15%)
        const priorHighsBefore1 = swingHighs.filter(sh => sh.idx < l1.idx && l1.idx - sh.idx <= 60)
        let isBigW = false, leftSideDropPct = null
        if (priorHighsBefore1.length > 0) {
          const refHigh      = priorHighsBefore1.reduce((mx, sh) => sh.price > mx.price ? sh : mx)
          leftSideDropPct    = +((refHigh.price - l1.price) / refHigh.price * 100).toFixed(1)
          isBigW             = leftSideDropPct >= 15
        }

        // Classify each trough: narrow spike (Adam) vs wide/rounded (Eve)
        // l1 = left/first bottom, l2 = right/second bottom (chronological order)
        const b1Narrow   = isNarrowBottom(l, l1.idx)
        const b2Narrow   = isNarrowBottom(l, l2.idx)
        const isAdamAdam = b1Narrow  && b2Narrow    // left narrow + right narrow
        const isAdamEve  = b1Narrow  && !b2Narrow   // left narrow (Adam) + right wide (Eve)
        const isEveAdam  = !b1Narrow && b2Narrow    // left wide (Eve) + right narrow (Adam)
        const isEveEve   = !b1Narrow && !b2Narrow   // both wide/rounded

        doubleBottom = {
          type: 'DOUBLE BOTTOM',
          trough1: l1.price,   trough1Date: l1.date,
          trough2: l2.price,   trough2Date: l2.date,
          avgBottom,
          neckline: neck.price, necklineDate: neck.date,
          target, targetPct, confirmed, barsAgo,
          priceDiff: +(priceDiff * 100).toFixed(2),
          depth: +(depth * 100).toFixed(1),
          strength,
          isBigW,
          leftSideDropPct,
          bigWStats: isBigW ? BIG_W_STATS : null,
          isAdamAdam,
          adamAdamStats: isAdamAdam ? ADAM_ADAM_STATS : null,
          isAdamEve,
          adamEveStats:  isAdamEve  ? ADAM_EVE_STATS  : null,
          isEveAdam,
          eveAdamStats:  isEveAdam  ? EVE_ADAM_STATS  : null,
          isEveEve,
          eveEveStats:   isEveEve   ? EVE_EVE_STATS   : null,
        }
      }
    }
  }

  return { doubleTop, doubleBottom }
}

// ── Weekly alignment using weekly EMA 8 / EMA 15 ─────────────────────────────
export function calcWeeklyAlignment(closes, highs, lows) {
  const n = closes.length
  if (n < 16) return null
  const e8  = calcEMASeries(closes, 8)
  const e15 = calcEMASeries(closes, 15)
  const price    = closes[n - 1]
  const curEma8  = e8[n - 1]
  const curEma15 = e15[n - 1]
  if (curEma8 == null || curEma15 == null) return null
  const aboveEma8  = price > curEma8
  const aboveEma15 = price > curEma15
  const bullStack  = curEma8 > curEma15
  const signal = (aboveEma8 && aboveEma15 && bullStack) ? 'BULLISH'
    : (!aboveEma8 && !aboveEma15 && !bullStack) ? 'BEARISH' : 'MIXED'
  const weekTrend  = price > closes[Math.max(0, n - 3)] ? 'UP' : 'DOWN'
  const year52H = highs.length >= 52 ? Math.max(...highs.slice(-52)) : Math.max(...highs)
  const year52L = lows.length  >= 52 ? Math.min(...lows.slice(-52))  : Math.min(...lows)
  return {
    price: +price.toFixed(2), ema8: +curEma8.toFixed(2), ema15: +curEma15.toFixed(2),
    aboveEma8, aboveEma15, bullStack, signal, weekTrend,
    pctFromEma8:  +((price - curEma8)  / curEma8  * 100).toFixed(1),
    pctFromEma15: +((price - curEma15) / curEma15 * 100).toFixed(1),
    year52H: +year52H.toFixed(2), year52L: +year52L.toFixed(2),
    pctFrom52H: +((price - year52H) / year52H * 100).toFixed(1),
    pctFrom52L: +((price - year52L) / year52L * 100).toFixed(1),
  }
}

// ── Head & Shoulders / Inverse H&S detection (daily) ─────────────────────────
export function detectHAndS(highs, lows, closes, timestamps = null, lookback = 200) {
  if (!highs || highs.length < 30) return { headAndShoulders: null, inverseHAndS: null }
  const start = Math.max(0, highs.length - lookback)
  const h = highs.slice(start), l = lows.slice(start), c = closes.slice(start)
  const ts = timestamps?.slice(start)
  const n  = h.length
  const currentPrice = c[n - 1]
  const fmtDate = i => ts?.[i]
    ? new Date(ts[i] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
  const SP = 5
  const swingHighs = [], swingLows = []
  for (let i = SP; i < n - SP; i++) {
    let hi = true, lo = true
    for (let j = i - SP; j <= i + SP; j++) {
      if (j !== i) { if (h[j] >= h[i]) hi = false; if (l[j] <= l[i]) lo = false }
    }
    if (hi) swingHighs.push({ idx: i, price: h[i], date: fmtDate(i) })
    if (lo) swingLows.push({ idx: i, price: l[i], date: fmtDate(i) })
  }
  function scoreHS(diff, depth, barsAgo) {
    return Math.round((1 - diff) * 40 + Math.min(depth / 0.1, 1) * 35 + Math.max(0, 1 - barsAgo / 80) * 25)
  }
  // Regular H&S (bearish): left shoulder → head (highest) → right shoulder
  let headAndShoulders = null
  for (let i = swingHighs.length - 1; i >= 2; i--) {
    const rs = swingHighs[i], hd = swingHighs[i - 1], ls = swingHighs[i - 2]
    if (hd.price <= ls.price || hd.price <= rs.price) continue
    const shoulderDiff = Math.abs(ls.price - rs.price) / ((ls.price + rs.price) / 2)
    if (shoulderDiff > 0.15) continue
    if (hd.idx - ls.idx < 8 || rs.idx - hd.idx < 8) continue
    const lt = swingLows.filter(s => s.idx > ls.idx && s.idx < hd.idx)
    const rt = swingLows.filter(s => s.idx > hd.idx && s.idx < rs.idx)
    if (!lt.length || !rt.length) continue
    const ltLow = lt.reduce((mn, s) => s.price < mn.price ? s : mn)
    const rtLow = rt.reduce((mn, s) => s.price < mn.price ? s : mn)
    const neckline = (ltLow.price + rtLow.price) / 2
    const depth = (hd.price - neckline) / hd.price
    if (depth < 0.04) continue
    const target = neckline - (hd.price - neckline)
    const targetPct = +((neckline - target) / neckline * 100).toFixed(1)
    const confirmed = currentPrice < neckline
    const barsAgo = n - 1 - rs.idx
    const strength = scoreHS(shoulderDiff, depth, barsAgo)
    if (!headAndShoulders || strength > headAndShoulders.strength) {
      headAndShoulders = {
        type: 'HEAD & SHOULDERS',
        leftShoulder: +ls.price.toFixed(2), leftShoulderDate: ls.date,
        head: +hd.price.toFixed(2), headDate: hd.date,
        rightShoulder: +rs.price.toFixed(2), rightShoulderDate: rs.date,
        neckline: +neckline.toFixed(2), necklineDate: rtLow.date,
        target: +target.toFixed(2), targetPct,
        shoulderDiff: +(shoulderDiff * 100).toFixed(1),
        depth: +(depth * 100).toFixed(1),
        confirmed, barsAgo, strength,
      }
    }
  }
  // Inverse H&S (bullish)
  let inverseHAndS = null
  for (let i = swingLows.length - 1; i >= 2; i--) {
    const rs = swingLows[i], hd = swingLows[i - 1], ls = swingLows[i - 2]
    if (hd.price >= ls.price || hd.price >= rs.price) continue
    const shoulderDiff = Math.abs(ls.price - rs.price) / ((ls.price + rs.price) / 2)
    if (shoulderDiff > 0.15) continue
    if (hd.idx - ls.idx < 8 || rs.idx - hd.idx < 8) continue
    const lp = swingHighs.filter(s => s.idx > ls.idx && s.idx < hd.idx)
    const rp = swingHighs.filter(s => s.idx > hd.idx && s.idx < rs.idx)
    if (!lp.length || !rp.length) continue
    const ltHigh = lp.reduce((mx, s) => s.price > mx.price ? s : mx)
    const rtHigh = rp.reduce((mx, s) => s.price > mx.price ? s : mx)
    const neckline = (ltHigh.price + rtHigh.price) / 2
    const depth = (neckline - hd.price) / neckline
    if (depth < 0.04) continue
    const target = neckline + (neckline - hd.price)
    const targetPct = +((target - neckline) / neckline * 100).toFixed(1)
    const confirmed = currentPrice > neckline
    const barsAgo = n - 1 - rs.idx
    const strength = scoreHS(shoulderDiff, depth, barsAgo)
    if (!inverseHAndS || strength > inverseHAndS.strength) {
      inverseHAndS = {
        type: 'INV. HEAD & SHOULDERS',
        leftShoulder: +ls.price.toFixed(2), leftShoulderDate: ls.date,
        head: +hd.price.toFixed(2), headDate: hd.date,
        rightShoulder: +rs.price.toFixed(2), rightShoulderDate: rs.date,
        neckline: +neckline.toFixed(2), necklineDate: rtHigh.date,
        target: +target.toFixed(2), targetPct,
        shoulderDiff: +(shoulderDiff * 100).toFixed(1),
        depth: +(depth * 100).toFixed(1),
        confirmed, barsAgo, strength,
      }
    }
  }
  return { headAndShoulders, inverseHAndS }
}

// ── Bull / Bear Flag continuation pattern detection ───────────────────────────
export function detectContinuationPatterns(highs, lows, closes, volumes) {
  const n = closes.length
  if (n < 20) return { bullFlag: null, bearFlag: null }
  const LB = Math.min(40, n)
  const h = highs.slice(-LB), l = lows.slice(-LB), c = closes.slice(-LB), v = volumes.slice(-LB)
  const m = c.length
  function findFlag(bearish) {
    let best = null
    for (let poleEnd = m - 3; poleEnd >= 5; poleEnd--) {
      for (let poleStart = Math.max(0, poleEnd - 15); poleStart < poleEnd - 2; poleStart++) {
        const poleH = Math.max(...h.slice(poleStart, poleEnd + 1))
        const poleL = Math.min(...l.slice(poleStart, poleEnd + 1))
        const poleHeight = poleH - poleL
        const poleMove = poleHeight / poleL
        if (poleMove < 0.05) continue
        const isBullPole = c[poleEnd] > c[poleStart]
        if (bearish === isBullPole) continue
        const consStart = poleEnd + 1, consEnd = m - 1, consLen = consEnd - consStart
        if (consLen < 2) continue
        const consH = Math.max(...h.slice(consStart)), consL = Math.min(...l.slice(consStart))
        const consRange = (consH - consL) / Math.max(Math.abs(c[poleEnd]), 0.01)
        if (consRange > Math.min(poleMove * 0.5, 0.12)) continue
        const poleVol = v.slice(poleStart, poleEnd + 1).reduce((a, b) => a + b, 0) / (poleEnd - poleStart + 1)
        const consVol = v.slice(consStart).reduce((a, b) => a + b, 0) / Math.max(consLen, 1)
        const volDecline = consVol < poleVol * 0.85
        const s = poleMove * 80 + (volDecline ? 20 : 0) + (1 - consRange / 0.12) * 30 - consLen * 2
        if (!best || s > best.score) {
          best = {
            type: bearish ? 'BEAR FLAG' : 'BULL FLAG',
            poleMove: +(poleMove * 100).toFixed(1),
            poleBars: poleEnd - poleStart,
            consBars: consLen,
            consRange: +(consRange * 100).toFixed(1),
            volDecline,
            breakoutLevel: +(bearish ? consL : consH).toFixed(2),
            target: +(bearish ? (consL - poleHeight) : (consH + poleHeight)).toFixed(2),
            score: Math.round(s),
          }
        }
      }
    }
    return best
  }
  return { bullFlag: findFlag(false), bearFlag: findFlag(true) }
}

// Relative Strength vs a benchmark (SPY): composite of 10-day and 20-day outperformance.
// rs > 0 = ticker outperforming; rs < 0 = underperforming.
export function calcRelativeStrength(tickerCloses, benchCloses, shortPeriod = 10, longPeriod = 20) {
  if (!tickerCloses || !benchCloses) return null
  const tn = tickerCloses.length, bn = benchCloses.length
  if (tn < longPeriod + 1 || bn < longPeriod + 1) return null

  const tNow = tickerCloses[tn - 1]
  const bNow = benchCloses[bn - 1]

  const rsShort = ((tNow / tickerCloses[tn - 1 - shortPeriod] - 1) - (bNow / benchCloses[bn - 1 - shortPeriod] - 1)) * 100
  const rsLong  = ((tNow / tickerCloses[tn - 1 - longPeriod]  - 1) - (bNow / benchCloses[bn - 1 - longPeriod]  - 1)) * 100

  // Weighted composite: short period matters more (recent momentum)
  const rs = rsShort * 0.6 + rsLong * 0.4

  let signal = 'NEUTRAL'
  if (rs > 5)       signal = 'STRONG BULL'
  else if (rs > 2)  signal = 'BULL'
  else if (rs < -5) signal = 'STRONG BEAR'
  else if (rs < -2) signal = 'BEAR'

  return {
    rs:       +rs.toFixed(2),
    rsShort:  +rsShort.toFixed(2),
    rsLong:   +rsLong.toFixed(2),
    tickerReturn: +((tNow / tickerCloses[tn - 1 - longPeriod] - 1) * 100).toFixed(2),
    spyReturn:    +((bNow / benchCloses[bn - 1 - longPeriod]  - 1) * 100).toFixed(2),
    signal,
    shortPeriod, longPeriod,
  }
}

// ── Volume Profile / Point of Control / LVN ──────────────────────────────────
// Distributes each bar's volume across its full high-low range (not just close).
// Returns POC, Value Area (VAH/VAL at 70%), and LVN "fast-move" desert zones.
//
// numBuckets: price resolution — more buckets = finer granularity
// lookback:   how many bars to include (most-recent N bars)
export function calcVolumeProfile(highs, lows, closes, volumes, { numBuckets = 50, lookback = 60 } = {}) {
  if (!highs?.length || highs.length < 5) return null

  const n  = highs.length
  const lb = Math.min(n, lookback)
  const h  = highs.slice(-lb)
  const l  = lows.slice(-lb)
  const c  = closes.slice(-lb)
  const v  = volumes ? volumes.slice(-lb) : new Array(lb).fill(1)

  const priceMax   = Math.max(...h)
  const priceMin   = Math.min(...l)
  const priceRange = priceMax - priceMin
  if (priceRange <= 0) return null

  // Distribute each bar's volume uniformly across its price range buckets
  const bins = new Float64Array(numBuckets)
  for (let i = 0; i < h.length; i++) {
    const vol = v[i] || 0
    if (vol === 0) continue
    const loIdx = Math.max(0, Math.min(numBuckets - 1, Math.floor((l[i] - priceMin) / priceRange * numBuckets)))
    const hiIdx = Math.max(0, Math.min(numBuckets - 1, Math.floor((h[i] - priceMin) / priceRange * numBuckets)))
    const spread    = Math.max(1, hiIdx - loIdx + 1)
    const volPerBin = vol / spread
    for (let b = loIdx; b <= hiIdx; b++) bins[b] += volPerBin
  }

  const totalVol = bins.reduce((a, b) => a + b, 0)
  if (totalVol === 0) return null

  const maxVol = Math.max(...bins)
  const avgVol = totalVol / numBuckets

  // Point of Control
  let pocIdx = 0
  for (let i = 1; i < numBuckets; i++) if (bins[i] > bins[pocIdx]) pocIdx = i
  const poc = priceMin + (pocIdx + 0.5) * priceRange / numBuckets

  // Value Area — expand outward from POC until 70% of total volume is enclosed
  let vaLo = pocIdx, vaHi = pocIdx
  let vaVol = bins[pocIdx]
  const target70 = totalVol * 0.70
  while (vaVol < target70 && (vaLo > 0 || vaHi < numBuckets - 1)) {
    const addLo = vaLo > 0           ? bins[vaLo - 1] : 0
    const addHi = vaHi < numBuckets - 1 ? bins[vaHi + 1] : 0
    if (addHi >= addLo) { vaHi++; vaVol += bins[vaHi] }
    else                { vaLo--; vaVol += bins[vaLo] }
  }
  const vah = priceMin + (vaHi + 1) * priceRange / numBuckets
  const val = priceMin + vaLo * priceRange / numBuckets

  // LVN threshold: < 25% of average bin volume = desert zone
  // HVN threshold: > 160% of average bin volume = high traffic area
  const lvnThresh = avgVol * 0.25
  const hvnThresh = avgVol * 1.60

  // Build per-bin profile array
  const profile = Array.from({ length: numBuckets }, (_, i) => ({
    price:   priceMin + (i + 0.5) * priceRange / numBuckets,
    priceLo: priceMin + i         * priceRange / numBuckets,
    priceHi: priceMin + (i + 1)   * priceRange / numBuckets,
    vol:     bins[i],
    pct:     maxVol > 0 ? bins[i] / maxVol : 0,
    isPOC:   i === pocIdx,
    isLVN:   bins[i] < lvnThresh,
    isHVN:   bins[i] >= hvnThresh,
    inVA:    i >= vaLo && i <= vaHi,
  }))

  const currentPrice = c[c.length - 1]

  // Group consecutive LVN bins into zones; skip tiny ones (< 1.5% of range)
  const minZoneSize = priceRange * 0.015
  const lvnZones = []
  let inLVN = false, zoneStart = -1
  for (let i = 0; i <= numBuckets; i++) {
    const isLVN = i < numBuckets && profile[i].isLVN
    if (isLVN && !inLVN) { inLVN = true; zoneStart = i }
    else if (!isLVN && inLVN) {
      inLVN = false
      const lo  = priceMin + zoneStart * priceRange / numBuckets
      const hi  = priceMin + i         * priceRange / numBuckets
      if (hi - lo >= minZoneSize) {
        lvnZones.push({
          lo, hi,
          midPrice: (lo + hi) / 2,
          sizeAbs:  hi - lo,
          gapPct:   +((hi - lo) / currentPrice * 100).toFixed(1),
        })
      }
    }
  }

  return {
    poc,
    pocIdx,
    vah,
    val,
    vaLo,
    vaHi,
    totalVol,
    profile,
    lvnsAbove: lvnZones.filter(z => z.lo >= currentPrice).sort((a, b) => a.lo - b.lo),
    lvnsBelow: lvnZones.filter(z => z.hi <= currentPrice).sort((a, b) => b.hi - a.hi),
    lvnsAll:   lvnZones,
    currentPrice,
    priceMin,
    priceMax,
    priceRange,
    numBuckets,
    lookback: lb,
  }
}

// ── Smart Money Concepts ──────────────────────────────────────────────────────
// Computes BOS, CHoCH, Liquidity Sweeps, and Fair Value Gaps on visible bars.
// rH/rL/rC = real (non-Heikin-Ashi) highs, lows, closes for the visible window.
export function calcSMC(rH, rL, rC, timeframe = 'D') {
  const n = rH.length
  const lookback = ['W', 'D'].includes(timeframe) ? 5 : ['4H', '1H'].includes(timeframe) ? 4 : 3
  if (n < lookback * 2 + 5) return { bos: [], choch: [], sweeps: [], fvgs: [], swings: [] }

  // Step 1: swing highs and lows
  const swings = []
  for (let i = lookback; i < n - lookback; i++) {
    let isH = true, isL = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue
      if (rH[j] >= rH[i]) isH = false
      if (rL[j] <= rL[i]) isL = false
    }
    if (isH) swings.push({ i, kind: 'high', price: rH[i], broken: false })
    if (isL) swings.push({ i, kind: 'low',  price: rL[i], broken: false })
  }
  swings.sort((a, b) => a.i - b.i)

  // Step 2: BOS (structure continuation) and CHoCH (first opposing break)
  const bos = [], choch = []
  let structure = null
  const active = []
  let si = 0

  for (let i = 0; i < n; i++) {
    while (si < swings.length && swings[si].i + lookback <= i) active.push(swings[si++])
    for (const sw of active) {
      if (sw.broken) continue
      if (sw.kind === 'high' && rC[i] > sw.price) {
        sw.broken = true
        ;(structure === 'bear' ? choch : bos).push({ i, kind: 'bull', level: sw.price, swingI: sw.i })
        structure = 'bull'
      } else if (sw.kind === 'low' && rC[i] < sw.price) {
        sw.broken = true
        ;(structure === 'bull' ? choch : bos).push({ i, kind: 'bear', level: sw.price, swingI: sw.i })
        structure = 'bear'
      }
    }
  }

  // Step 3: liquidity sweeps — wick past swing level, close back inside
  const sweeps = []
  for (const sw of swings) {
    for (let i = sw.i + 1; i < n; i++) {
      if (sw.kind === 'high') {
        if (rC[i] > sw.price) break
        if (rH[i] > sw.price && rC[i] < sw.price) { sweeps.push({ i, kind: 'bear', level: sw.price, swingI: sw.i }); break }
      } else {
        if (rC[i] < sw.price) break
        if (rL[i] < sw.price && rC[i] > sw.price) { sweeps.push({ i, kind: 'bull', level: sw.price, swingI: sw.i }); break }
      }
    }
  }

  // Step 4: Fair Value Gaps — 3-candle imbalance zones
  const fvgs = []
  const minGapPct = 0.0008
  for (let i = 2; i < n; i++) {
    const minGap = ((rH[i] + rL[i]) / 2) * minGapPct
    if (rL[i] > rH[i - 2] && rL[i] - rH[i - 2] >= minGap) {
      const top = rL[i], bot = rH[i - 2]
      let fillI = null
      for (let j = i + 1; j < n; j++) { if (rL[j] <= top) { fillI = j; break } }
      fvgs.push({ startI: i, endI: fillI, top, bot, kind: 'bull' })
    }
    if (rH[i] < rL[i - 2] && rL[i - 2] - rH[i] >= minGap) {
      const top = rL[i - 2], bot = rH[i]
      let fillI = null
      for (let j = i + 1; j < n; j++) { if (rH[j] >= bot) { fillI = j; break } }
      fvgs.push({ startI: i, endI: fillI, top, bot, kind: 'bear' })
    }
  }

  return { bos, choch, sweeps, fvgs, swings }
}

// Volume of last bar vs 20-bar average. Returns ratio and spike flags.
export function calcVolumeSpike(volumes: number[], period = 20): VolumeSpike | null {
  if (!volumes || volumes.length < period + 1) return null
  const last = volumes[volumes.length - 1]
  const avg  = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period
  if (avg === 0) return null
  const ratio = last / avg
  return {
    last,
    avg:         Math.round(avg),
    ratio:       +ratio.toFixed(2),
    spike:       ratio >= 1.5,
    strongSpike: ratio >= 2.0,
    lowVolume:   ratio < 0.7,
  }
}
