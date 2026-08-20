// 4H 8 EMA swing trade signal logic.
// Primary rule: 2 consecutive 4H bars close above 8 EMA = LONG ENTRY
//               2 consecutive 4H bars close below 8 EMA = EXIT
// Secondary:    2 daily closes above/below 20D VWAP confirms or flags the signal.
// Trend filter and market conditions generate warnings but don't block the signal.

export function analyzeSwing(catStates, categories, vwapSignal = null) {
  const s4h    = catStates.fourHSignal     ?? {}
  const trend  = catStates.trendFilter     ?? {}
  const market = catStates.marketConditions ?? {}
  const risk   = catStates.riskSetup       ?? {}

  const lastBar = s4h.lastBar  // 'above' | 'below' | null
  const prevBar = s4h.prevBar  // 'above' | 'below' | null

  // Count consecutive bars above / below
  const barsAbove = [lastBar, prevBar].filter(v => v === 'above').length
  const barsBelow = [lastBar, prevBar].filter(v => v === 'below').length

  let signal = null
  let confirmed = false

  if (barsAbove === 2) { signal = 'LONG';  confirmed = true  }
  else if (barsBelow === 2) { signal = 'EXIT';  confirmed = true  }
  else if (barsAbove === 1) { signal = 'WATCH'; confirmed = false }
  else if (barsBelow === 1) { signal = 'WATCH'; confirmed = false }

  // Trend alignment check
  const daily  = trend.dailyTrend
  const weekly = trend.weeklyTrend

  const warnings = []

  if (signal === 'LONG') {
    if (daily === 'bear')  warnings.push('Daily trend is bearish — consider waiting')
    if (weekly === 'bear') warnings.push('Weekly trend is bearish — higher risk trade')
    if (market.marketState === 'bear') warnings.push('Market in downtrend — avoid long entries')
  }
  if (signal === 'EXIT') {
    if (daily === 'bull')  warnings.push('Daily trend is bullish — may be a temporary dip')
    if (weekly === 'bull') warnings.push('Weekly trend is bullish — watch for reversal')
  }
  if (risk.rrRatio === 'below2') {
    warnings.push('Risk/Reward below 2:1 — wait for a better setup')
  }
  if (risk.stopPlacement === 'unclear') {
    warnings.push('No clear stop level — define your stop before entering')
  }

  // VWAP 2-bar cross confirmation / conflict
  const vwapCrossAbove = vwapSignal?.crossAbove ?? false
  const vwapCrossBelow = vwapSignal?.crossBelow ?? false
  const vwapAbove      = vwapSignal?.aboveVwap  ?? null

  if (signal === 'LONG' && vwapCrossBelow) {
    warnings.push('VWAP conflict: 2 daily bars just crossed below VWAP — wait for VWAP reclaim')
  }
  if (signal === 'EXIT' && vwapCrossAbove) {
    warnings.push('VWAP conflict: 2 daily bars just crossed above VWAP — short side is fighting the VWAP')
  }
  if (signal === 'LONG' && vwapAbove === false && !vwapCrossAbove) {
    warnings.push('Price is below VWAP — a VWAP reclaim cross would strengthen this LONG signal')
  }
  if (signal === 'EXIT' && vwapAbove === true && !vwapCrossBelow) {
    warnings.push('Price is above VWAP — a VWAP breakdown cross would strengthen this EXIT signal')
  }

  const vwapAligned = (signal === 'LONG' && vwapCrossAbove) || (signal === 'EXIT' && vwapCrossBelow)

  const answeredCount = countAnswered(catStates, categories)

  return {
    signal,
    confirmed,
    barsAbove,
    barsBelow,
    lastBar,
    prevBar,
    warnings,
    answeredCount,
    vwapCrossAbove,
    vwapCrossBelow,
    vwapAligned,
  }
}

function countAnswered(catStates, categories) {
  let count = 0
  for (const cat of categories) {
    for (const field of cat.fields) {
      const val = catStates[cat.id]?.[field.id]
      if (val !== null && val !== undefined) count++
    }
  }
  return count
}
