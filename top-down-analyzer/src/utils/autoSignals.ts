// Converts raw OHLCV data into the bull/bear/neutral signals each field expects.
// Returns partial state objects that can be merged directly into React state.

import type { BarData, Direction } from '../types'
import {
  calcEMA, calcEMASeries, calcRSI, calcMACD, calcADX,
  calcSessionVWAP,
  detectTrend, detectStructure, detectKeyLevel, detectVolume, detectEntryTrigger,
} from './indicators'

function deriveField(fieldId, bars) {
  const { opens, highs, lows, closes, volumes } = bars
  if (closes.length < 14) return null

  const ema20Series = calcEMASeries(closes, 20)
  const ema20 = ema20Series[ema20Series.length - 1]
  const last = closes[closes.length - 1]

  switch (fieldId) {
    case 'trend':
      return detectTrend(closes, ema20Series)

    case 'structure':
      return detectStructure(highs, lows)

    case 'priceVsEMA': {
      const ema30 = calcEMA(closes, 30)
      if (ema30 == null) return null
      if (last > ema30) return 'bull'
      if (last < ema30) return 'bear'
      return 'neutral'
    }

    case 'rsi': {
      const rsi = calcRSI(closes)
      if (rsi == null) return null
      if (rsi >= 44) return 'bull'   // above entry threshold — get in
      if (rsi >= 30) return 'bear'   // 30–44: bear territory
      return 'neutral'               // under 30: extreme oversold, may bounce
    }

    case 'macd': {
      const m = calcMACD(closes)
      if (!m) return null
      // Cross: MACD (money) crossed above Gunline (signal line) = bull
      //        MACD crossed below Gunline = bear
      if (m.prevHistogram != null) {
        if (m.prevHistogram <= 0 && m.histogram > 0) return 'bull'
        if (m.prevHistogram >= 0 && m.histogram < 0) return 'bear'
      }
      // No fresh cross — still report current side so the signal stays active
      if (m.histogram > 0) return 'bull'
      if (m.histogram < 0) return 'bear'
      return 'neutral'
    }

    case 'keyLevel':
      return detectKeyLevel(last, highs, lows)

    case 'volume':
      return detectVolume(volumes)

    case 'entryTrigger':
      return detectEntryTrigger(opens, closes)

    case 'adx': {
      const result = calcADX(highs, lows, closes)
      if (!result) return null
      const { adx, plusDI, minusDI } = result
      if (adx >= 21 && plusDI >= 21) return 'bull'
      if (adx >= 21 && minusDI >= 21) return 'bear'
      return 'neutral'  // ADX < 21 = trend too weak
    }

    case 'ema8Cross': {
      if (closes.length < 10) return null
      const ema8Series = calcEMASeries(closes, 8)
      const n = closes.length
      const lastAbove = closes[n - 1] > ema8Series[n - 1]
      const prevAbove = closes[n - 2] > ema8Series[n - 2]
      if (lastAbove && prevAbove)   return 'bull'  // 2 bars closed above 8 EMA
      if (!lastAbove && !prevAbove) return 'bear'  // 2 bars closed below 8 EMA
      return 'neutral'                             // only 1 bar — not confirmed yet
    }

    case 'priceVsVWAP': {
      const vwap = calcSessionVWAP(bars)
      if (vwap == null) return null
      if (last > vwap) return 'bull'
      if (last < vwap) return 'bear'
      return 'neutral'
    }

    case 'orbBreak': {
      const { timestamps } = bars
      if (!timestamps || timestamps.length < 2) return null

      // Find the first bar of the current trading session.
      // A gap > 1 hour between consecutive bars marks the overnight boundary.
      let sessionStart = 0
      for (let i = timestamps.length - 1; i > 0; i--) {
        if (timestamps[i] - timestamps[i - 1] > 3600) {
          sessionStart = i
          break
        }
      }

      const orbHigh = highs[sessionStart]
      const orbLow  = lows[sessionStart]

      if (orbHigh == null || orbLow == null) return null
      if (last > orbHigh) return 'bull'  // broke above opening range high
      if (last < orbLow)  return 'bear'  // broke below opening range low

      // Inside range — 8 EMA 2-bar cross-and-close is the entry/exit trigger
      if (closes.length < 10) return 'neutral'
      const ema8s = calcEMASeries(closes, 8)
      const n = closes.length
      const aboveLast = closes[n - 1] > ema8s[n - 1]
      const abovePrev = closes[n - 2] > ema8s[n - 2]
      if (aboveLast && abovePrev)   return 'bull'
      if (!aboveLast && !abovePrev) return 'bear'
      return 'neutral'
    }

    default:
      return null
  }
}

// ── Confluence tab (TIMEFRAMES) ──────────────────────────────────────────────

export function deriveConfluenceSignals(tfDataMap, timeframes) {
  const newStates = {}
  for (const tf of timeframes) {
    newStates[tf.id] = {}
    const bars = tfDataMap[tf.id]
    if (!bars) continue
    for (const field of tf.fields) {
      newStates[tf.id][field.id] = deriveField(field.id, bars)
    }
  }
  return newStates
}

// ── Swing tab (4H 8 EMA system) ─────────────────────────────────────────────

// Auto-detects whether the last two 4H bars closed above or below the 8 EMA
export function derive4HSwingSignals(fourHBars) {
  if (!fourHBars) return {}
  const { closes } = fourHBars
  if (closes.length < 8) return {}

  const ema8 = calcEMASeries(closes, 8)
  const n = closes.length

  return {
    fourHSignal: {
      lastBar: closes[n - 1] > ema8[n - 1] ? 'above' : 'below',
      prevBar: closes[n - 2] > ema8[n - 2] ? 'above' : 'below',
    },
  }
}

// Auto-detects daily and weekly trend direction for the trend filter panel
export function derive4HSwingTrendSignals(daily: BarData | null, weekly: BarData | null) {
  if (!daily || !weekly) return {}
  const dailySeries  = calcEMASeries(daily.closes,  20)
  const weeklySeries = calcEMASeries(weekly.closes, 20)

  const map = { bull: 'bull', bear: 'bear', neutral: 'neutral' }
  const d = detectTrend(daily.closes,  dailySeries)
  const w = detectTrend(weekly.closes, weeklySeries)

  return {
    trendFilter: {
      dailyTrend:  d ? map[d] : null,
      weeklyTrend: w ? map[w] : null,
    },
  }
}

// ── Market conditions + risk setup (auto-fill for high risk tolerance) ───────

// spyBars: daily SPY OHLCV  |  fourHBars: aggregated 4H bars for the ticker
export function deriveMarketAndRisk(spyBars: BarData | null, fourHBars: BarData | null) {
  const result: Record<string, any> = {}

  // Market state from SPY 20 EMA slope
  if (spyBars && spyBars.closes.length >= 25) {
    const spySeries = calcEMASeries(spyBars.closes, 20)
    const marketTrend = detectTrend(spyBars.closes, spySeries)
    if (marketTrend) {
      result.marketConditions = { marketState: marketTrend }
    }
  }

  // Stop placement from 4H bar position vs 8 EMA
  if (fourHBars && fourHBars.closes.length >= 8) {
    const { closes } = fourHBars
    const ema8 = calcEMASeries(closes, 8)
    const n = closes.length
    const lastAbove = closes[n - 1] > ema8[n - 1]
    result.riskSetup = {
      stopPlacement: lastAbove ? 'below8ema' : 'above8ema',
      rrRatio: '2to1',  // high risk tolerance — accepts 2:1 minimum
    }
  }

  return result
}

// ── Legacy (kept for reference, no longer called) ────────────────────────────
export function deriveSwingSignals(daily) {
  const { closes, highs, lows } = daily
  if (closes.length < 30) return {}

  const last = closes[closes.length - 1]

  const ema200 = calcEMA(closes, 200)
  const ema65  = calcEMA(closes, 65)
  const ema15  = calcEMA(closes, 15)
  const ema30  = calcEMA(closes, 30)
  const rsi    = calcRSI(closes)

  const partial: Record<string, any> = {}

  // rsi → rsiLevel
  if (rsi != null) {
    if      (rsi < 35) partial.rsi = { rsiLevel: 'excellent' }
    else if (rsi < 45) partial.rsi = { rsiLevel: 'good' }
    else if (rsi < 60) partial.rsi = { rsiLevel: 'neutral' }
    else if (rsi < 70) partial.rsi = { rsiLevel: 'extended' }
    else               partial.rsi = { rsiLevel: 'overbought' }
  }

  // Moving averages
  const ma: Record<string, any> = {}

  if (ema200 != null) {
    const pct = (last - ema200) / ema200
    if      (pct >  0.02) ma.vs200ema = 'above'
    else if (pct > -0.02) ma.vs200ema = 'testing'
    else                  ma.vs200ema = 'below'
  }

  if (ema65 != null) {
    const pct = (last - ema65) / ema65
    if      (pct >  0.02)  ma.vs65ema = 'above'
    else if (pct > -0.03)  ma.vs65ema = 'testing'
    else                   ma.vs65ema = 'below'
  }

  if (ema15 != null) {
    const pct = (last - ema15) / ema15
    if      (pct >  0.02) ma.vs15ema = 'above'
    else if (pct > -0.02) ma.vs15ema = 'testing'
    else                  ma.vs15ema = 'below'
  }

  if (ema30 != null) {
    ma.ema30support = Math.abs(last - ema30) / ema30 < 0.03 ? 'yes' : 'no'
  }

  if (ema15 != null && ema30 != null && ema65 != null && ema200 != null) {
    const bullStack = ema15 > ema30 && ema30 > ema65 && ema65 > ema200
    const count = [ema15 > ema30, ema30 > ema65, ema65 > ema200].filter(Boolean).length
    if (bullStack)  ma.emaAlign = 'full'
    else if (count >= 2) ma.emaAlign = 'partial'
    else            ma.emaAlign = 'mixed'
  }

  if (Object.keys(ma).length > 0) partial.movingAverages = ma

  // EMA distance from 65
  if (ema65 != null) {
    const pctAbove = ((last - ema65) / ema65) * 100
    let distFrom65
    if      (pctAbove < 5)  distFrom65 = 'at'
    else if (pctAbove < 10) distFrom65 = 'slight'
    else if (pctAbove < 15) distFrom65 = 'extended'
    else                    distFrom65 = 'veryExtended'
    partial.emaDistance = { distFrom65 }
  }

  // Long-term trend direction (daily EMA slope as proxy)
  const ema20Series = calcEMASeries(closes, 20)
  const trendSignal = detectTrend(closes, ema20Series, 10)
  const structureSignal = detectStructure(highs, lows, 30)

  if (trendSignal != null) {
    let trendDir
    if      (trendSignal === 'bull' && structureSignal === 'bull') trendDir = 'strongUp'
    else if (trendSignal === 'bull') trendDir = 'mildUp'
    else if (trendSignal === 'neutral') trendDir = 'sideways'
    else    trendDir = 'downtrend'

    let priceAction
    if      (structureSignal === 'bull') priceAction = 'clean'
    else if (structureSignal === 'neutral') priceAction = 'mixed'
    else    priceAction = 'lhll'

    partial.longTermTrend = { trendDir, priceAction }
  }

  return partial
}
