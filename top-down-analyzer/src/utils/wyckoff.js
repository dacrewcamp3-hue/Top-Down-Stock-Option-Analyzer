/* ═══════════════════════════════════════════════════════════════════════════
   wyckoff.js — Enhanced Wyckoff phase detector (8-enhancement upgrade)
   ═══════════════════════════════════════════════════════════════════════════ */

export function detectWyckoff(highs, lows, closes, volumes) {
  if (!closes || closes.length < 60) return null

  const len        = closes.length
  const window     = Math.min(120, len)
  const startIdx   = len - window
  const EVENT_WINDOW = 15
  const rangeEnd   = len - EVENT_WINDOW

  // Slice range bars (exclude event window so a spring low can't pollute range low)
  const rangeHighs  = highs.slice(startIdx, rangeEnd)
  const rangeLows   = lows.slice(startIdx, rangeEnd)
  const rangeCloses = closes.slice(startIdx, rangeEnd)
  const rangeVols   = volumes.slice(startIdx, rangeEnd)
  const n           = rangeHighs.length

  if (n === 0) return null

  // ── 1. Intelligent Consolidation Range (cluster-based, strips outliers) ───
  const rawHigh = Math.max(...rangeHighs)
  const rawLow  = Math.min(...rangeLows)
  const rawSpan = rawHigh - rawLow

  if (rawSpan <= 0) return null

  const BUCKETS    = 20
  const bucketSize = rawSpan / BUCKETS
  const touchCount = new Array(BUCKETS).fill(0)

  for (let i = 0; i < n; i++) {
    const hb = Math.min(BUCKETS - 1, Math.floor((rangeHighs[i] - rawLow) / bucketSize))
    const lb = Math.max(0,            Math.floor((rangeLows[i]  - rawLow) / bucketSize))
    touchCount[hb]++
    touchCount[lb]++
  }

  const ranked = touchCount
    .map((cnt, i) => ({ cnt, i }))
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 5)

  const resistanceBuckets = ranked.filter(b => b.i >= BUCKETS * 0.6)
  const supportBuckets    = ranked.filter(b => b.i <= BUCKETS * 0.4)

  let rangeHigh, rangeLow

  if (resistanceBuckets.length > 0 && supportBuckets.length > 0) {
    const resBucket = resistanceBuckets.sort((a, b) => b.i - a.i)[0]
    const supBucket = supportBuckets.sort((a, b) => a.i - b.i)[0]
    rangeHigh = rawLow + (resBucket.i + 0.5) * bucketSize
    rangeLow  = rawLow + (supBucket.i + 0.5) * bucketSize
  } else {
    // Fallback: 95th/5th percentile strips single-bar spikes (earnings, etc.)
    const sortedHighs = [...rangeHighs].sort((a, b) => a - b)
    const sortedLows  = [...rangeLows].sort((a, b) => a - b)
    rangeHigh = sortedHighs[Math.min(Math.floor(n * 0.95), n - 1)]
    rangeLow  = sortedLows[Math.max(Math.floor(n * 0.05), 0)]
  }

  if (rangeHigh <= rangeLow) {
    rangeHigh = rawHigh
    rangeLow  = rawLow
  }

  const rangeSize = rangeHigh - rangeLow

  // Range quality: touch count and duration
  const touchThreshold = rangeSize * 0.05
  let highTouches = 0, lowTouches = 0
  for (let i = 0; i < n; i++) {
    if (rangeHighs[i] >= rangeHigh - touchThreshold) highTouches++
    if (rangeLows[i]  <= rangeLow  + touchThreshold) lowTouches++
  }
  const rangeTouches  = highTouches + lowTouches
  const rangeDuration = n
  const rangeQuality  = parseFloat((Math.min(1, (rangeTouches / 6) * (Math.min(n, 40) / 40))).toFixed(4))

  // ── Average Volume & ATR ──────────────────────────────────────────────────
  const totalRangeVol = rangeVols.reduce((s, v) => s + v, 0)
  const avgVol        = totalRangeVol / n

  let atrSum = 0
  for (let i = 1; i < n; i++) {
    atrSum += Math.max(
      rangeHighs[i] - rangeLows[i],
      Math.abs(rangeHighs[i] - rangeCloses[i - 1]),
      Math.abs(rangeLows[i]  - rangeCloses[i - 1])
    )
  }
  const atr = n > 1 ? atrSum / (n - 1) : rangeSize

  // ── 8. Declining Volume Gate (first-half vs second-half avg vol) ───────────
  const halfN       = Math.floor(n / 2)
  const avgFirst    = rangeVols.slice(0, halfN).reduce((s, v) => s + v, 0) / (halfN || 1)
  const avgSecond   = rangeVols.slice(halfN).reduce((s, v) => s + v, 0) / ((n - halfN) || 1)
  const volContraction = avgFirst > 0 ? (avgFirst - avgSecond) / avgFirst : 0
  const volContracting = volContraction > 0.10 // ≥10% volume decline = drying up

  // ── Buying Pressure (range bars) ─────────────────────────────────────────
  let buyVol = 0, totalVol = 0
  for (let i = startIdx; i < rangeEnd; i++) {
    totalVol += volumes[i]
    if (i > 0 && closes[i] > closes[i - 1]) buyVol += volumes[i]
  }
  const buyingPressure = totalVol > 0 ? buyVol / totalVol : 0.5

  // ── 3. Trend Context (50-EMA slope on daily closes) ───────────────────────
  const EMA_PERIOD = 50
  let trendContext      = 'NEUTRAL'
  let weeklyEmaSlope    = null
  if (closes.length >= EMA_PERIOD + 10) {
    const k = 2 / (EMA_PERIOD + 1)
    let ema = closes.slice(0, EMA_PERIOD).reduce((s, c) => s + c, 0) / EMA_PERIOD
    for (let i = EMA_PERIOD; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k)

    let emaPrev = closes.slice(0, EMA_PERIOD).reduce((s, c) => s + c, 0) / EMA_PERIOD
    const prevTarget = closes.length - 10
    for (let i = EMA_PERIOD; i < prevTarget; i++) emaPrev = closes[i] * k + emaPrev * (1 - k)

    weeklyEmaSlope = parseFloat((ema - emaPrev).toFixed(4))
    trendContext = weeklyEmaSlope > atr * 0.3 ? 'UPTREND'
                : weeklyEmaSlope < -atr * 0.3 ? 'DOWNTREND'
                : 'NEUTRAL'
  }

  // ── 2. SC/BC Detection (Phase A — high-vol wide bars at extremes) ─────────
  let sellingClimax = null, buyingClimax = null
  for (let i = 1; i < n; i++) {
    const barRange = rangeHighs[i] - rangeLows[i]
    const volRatio  = avgVol > 0 ? rangeVols[i] / avgVol : 1
    const closePos  = barRange > 0 ? (rangeCloses[i] - rangeLows[i]) / barRange : 0.5
    const isWideBar = barRange > atr * 1.3

    if (volRatio >= 2.0 && isWideBar) {
      if (closePos < 0.30 && !sellingClimax) {
        sellingClimax = {
          barIndex: startIdx + i,
          low:      parseFloat(rangeLows[i].toFixed(4)),
          high:     parseFloat(rangeHighs[i].toFixed(4)),
          close:    parseFloat(rangeCloses[i].toFixed(4)),
          volRatio: parseFloat(volRatio.toFixed(2)),
          closePos: parseFloat(closePos.toFixed(2)),
        }
      }
      if (closePos > 0.70 && !buyingClimax) {
        buyingClimax = {
          barIndex: startIdx + i,
          low:      parseFloat(rangeLows[i].toFixed(4)),
          high:     parseFloat(rangeHighs[i].toFixed(4)),
          close:    parseFloat(rangeCloses[i].toFixed(4)),
          volRatio: parseFloat(volRatio.toFixed(2)),
          closePos: parseFloat(closePos.toFixed(2)),
        }
      }
    }
  }

  // ── Current bar ───────────────────────────────────────────────────────────
  const currentClose    = closes[len - 1]
  const currentVolRatio = parseFloat((avgVol > 0 ? volumes[len - 1] / avgVol : 1).toFixed(2))

  // ── 4. Spring/UTAD Quality Filters ────────────────────────────────────────
  const rangeOldEnough = n >= 15
  const maxWickDepth   = rangeSize * 0.30 // penetration beyond 30% of range = likely real break

  let spring = null
  const eventStart = len - EVENT_WINDOW
  for (let i = len - 1; i >= eventStart; i--) {
    if (lows[i] < rangeLow && closes[i] > rangeLow) {
      const penetration = rangeLow - lows[i]
      if (!rangeOldEnough) continue
      if (penetration > maxWickDepth) continue

      const volRatio        = avgVol > 0 ? volumes[i] / avgVol : 1
      const hasConfirmation = i < len - 1 && closes[i + 1] > closes[i]
      spring = {
        low:          parseFloat(lows[i].toFixed(4)),
        rangeLow:     parseFloat(rangeLow.toFixed(4)),
        recoveredTo:  parseFloat(closes[i].toFixed(4)),
        volRatio:     parseFloat(volRatio.toFixed(2)),
        isLowVolume:  volRatio < 0.8,
        penetration:  parseFloat(penetration.toFixed(4)),
        confirmed:    hasConfirmation,
        barIndex:     i,
      }
      break
    }
  }

  let utad = null
  for (let i = len - 1; i >= eventStart; i--) {
    if (highs[i] > rangeHigh && closes[i] < rangeHigh) {
      const penetration = highs[i] - rangeHigh
      if (!rangeOldEnough) continue
      if (penetration > maxWickDepth) continue

      const volRatio        = avgVol > 0 ? volumes[i] / avgVol : 1
      const hasConfirmation = i < len - 1 && closes[i + 1] < closes[i]
      utad = {
        high:         parseFloat(highs[i].toFixed(4)),
        rangeHigh:    parseFloat(rangeHigh.toFixed(4)),
        failedAt:     parseFloat(closes[i].toFixed(4)),
        volRatio:     parseFloat(volRatio.toFixed(2)),
        isHighVolume: volRatio > 1.2,
        penetration:  parseFloat(penetration.toFixed(4)),
        confirmed:    hasConfirmation,
        barIndex:     i,
      }
      break
    }
  }

  // ── 5. LPS Zone Detection (post-MARKUP pullback to former range high) ──────
  let lpsZone = null
  if (currentClose > rangeHigh) {
    const pullbackLows   = lows.slice(len - 10)
    const pullbackCloses = closes.slice(len - 10)
    for (let i = 0; i < pullbackLows.length; i++) {
      const pct = (pullbackLows[i] - rangeHigh) / rangeSize
      if (pct >= -0.10 && pct <= 0.25 && pullbackCloses[i] > rangeHigh) {
        lpsZone = {
          low:     parseFloat(pullbackLows[i].toFixed(4)),
          support: parseFloat(rangeHigh.toFixed(4)),
          note:    'Former range high acting as new support — LPS re-entry zone',
        }
        break
      }
    }
  }

  // ── 6. Volume Profile / HVN (30-bucket VAP) ───────────────────────────────
  const allHighs = highs.slice(startIdx)
  const allLows  = lows.slice(startIdx)
  const allVols  = volumes.slice(startIdx)
  const profHigh = Math.max(...allHighs)
  const profLow  = Math.min(...allLows)
  const profSpan = profHigh - profLow

  let hvnAbove = null, hvnBelow = null
  if (profSpan > 0) {
    const PROF_BUCKETS    = 30
    const profBucketSize  = profSpan / PROF_BUCKETS
    const volAtPrice      = new Array(PROF_BUCKETS).fill(0)
    for (let i = 0; i < allHighs.length; i++) {
      const mid    = (allHighs[i] + allLows[i]) / 2
      const bucket = Math.min(PROF_BUCKETS - 1, Math.max(0, Math.floor((mid - profLow) / profBucketSize)))
      volAtPrice[bucket] += allVols[i]
    }
    const rhBucket  = Math.floor((rangeHigh - profLow) / profBucketSize)
    const rlBucket  = Math.floor((rangeLow  - profLow) / profBucketSize)
    let maxAbove = 0, maxBelow = 0
    for (let i = rhBucket + 1; i < PROF_BUCKETS; i++) {
      if (volAtPrice[i] > maxAbove) { maxAbove = volAtPrice[i]; hvnAbove = parseFloat((profLow + (i + 0.5) * profBucketSize).toFixed(2)) }
    }
    for (let i = 0; i < rlBucket; i++) {
      if (volAtPrice[i] > maxBelow) { maxBelow = volAtPrice[i]; hvnBelow = parseFloat((profLow + (i + 0.5) * profBucketSize).toFixed(2)) }
    }
  }

  // ── 7. Multi-tier C&E Targets ────────────────────────────────────────────
  const targets = {
    upT1:    parseFloat((rangeHigh + atr * 3).toFixed(2)),
    upT2:    parseFloat((rangeHigh + rangeSize * 1.0).toFixed(2)),
    upT3:    parseFloat((rangeHigh + rangeSize * 1.5).toFixed(2)),
    upHVN:   hvnAbove,
    downT1:  parseFloat((rangeLow - atr * 3).toFixed(2)),
    downT2:  parseFloat((rangeLow - rangeSize * 1.0).toFixed(2)),
    downT3:  parseFloat((rangeLow - rangeSize * 1.5).toFixed(2)),
    downHVN: hvnBelow,
  }

  // Legacy single targets (backward compat)
  const potentialMoveUp   = targets.upT2
  const potentialMoveDown = targets.downT2

  // ── Phase Determination ───────────────────────────────────────────────────
  let phase, signal, confidence, description

  if (currentClose > rangeHigh) {
    phase       = 'MARKUP'
    signal      = 'BULLISH'
    confidence  = 'high'
    description =
      'Price has broken out above the trading range on a confirmed close. ' +
      'This is Wyckoff markup — the campaign that was built during accumulation is now paying off. ' +
      'The crowd is chasing in; institutions are letting them push price higher. ' +
      'Trend-following entries are valid — use pullbacks to the former range high as your first support reference. ' +
      'Calls and long debit spreads are the primary vehicle. Trail stops as price extends.'
  } else if (currentClose < rangeLow) {
    phase       = 'MARKDOWN'
    signal      = 'BEARISH'
    confidence  = 'high'
    description =
      'Price has broken down below the trading range on a confirmed close. ' +
      'This is Wyckoff markdown — the distribution campaign has concluded and supply is overwhelming demand. ' +
      'Short-side plays dominate: puts, bear call spreads, or cash. ' +
      'Do not buy calls. The path of least resistance is lower until a new accumulation range forms at lower prices.'
  } else if (spring && utad) {
    phase       = 'RANGING'
    signal      = 'NEUTRAL'
    confidence  = 'low'
    description =
      'Both a Spring AND a UTAD have been detected in the recent event window. ' +
      'This is a conflicted signal — price has tested both boundaries of the trading range without ' +
      'a decisive commitment in either direction. The market is volatile and directionless. ' +
      'Do not trade until one side wins: a clean breakout above range high or a confirmed breakdown below range low ' +
      'will resolve the battle. Preserve capital and wait for clarity.'
  } else if (spring) {
    const trendBoost = trendContext === 'UPTREND'
    phase      = 'SPRING'
    signal     = 'BULLISH'
    confidence = (spring.isLowVolume && spring.confirmed && trendBoost) ? 'high'
               : (spring.isLowVolume || spring.confirmed) ? 'medium'
               : 'low'
    description =
      'A Spring has been detected — price briefly violated the support boundary of the trading range ' +
      'then recovered back inside. This is the highest-confidence Wyckoff buy signal: the false breakdown ' +
      'flushed out weak longs, but demand stepped in and closed the bar back above range low. ' +
      (spring.isLowVolume
        ? 'Volume on the breakdown was BELOW average — the ideal Spring signature. Low volume means sellers could not press their advantage; supply is exhausted. '
        : 'Volume was at or above average on the breakdown — a valid Spring but watch for a retest of the range low before committing full size. ') +
      (spring.confirmed
        ? 'Next bar confirmed the recovery. '
        : 'No next-bar confirmation yet — wait for a high-volume follow-through before entering. ') +
      (trendBoost ? 'Trend context is bullish (50 EMA rising), adding confirmation.' : '')
  } else if (utad) {
    const trendBoost = trendContext === 'DOWNTREND'
    phase      = 'UTAD'
    signal     = 'BEARISH'
    confidence = (utad.isHighVolume && utad.confirmed && trendBoost) ? 'high'
               : (utad.isHighVolume || utad.confirmed) ? 'medium'
               : 'low'
    description =
      'A UTAD (Upthrust After Distribution) has been detected — price spiked above the resistance ' +
      'boundary of the trading range then reversed and closed back inside. This is the distribution analog ' +
      'of the Spring: a bull trap that absorbs the last remaining buying pressure before markdown begins. ' +
      (utad.isHighVolume
        ? 'Volume on the rejection was ABOVE average — a high-volume failure confirms that supply overwhelmed demand at the high. '
        : 'Volume was moderate on the failure — valid signal, but wait for a lower close on the following bar. ') +
      (utad.confirmed
        ? 'Next bar confirmed the rejection. '
        : 'No next-bar confirmation yet. ') +
      (trendBoost ? 'Trend context is bearish (50 EMA falling), adding confirmation.' : '')
  } else if (buyingPressure > 0.55) {
    phase       = 'ACCUMULATION'
    signal      = 'BULLISH'
    confidence  = volContracting ? 'medium' : 'low'
    description =
      'Price is inside the trading range and volume analysis shows buying pressure dominating — ' +
      `${(buyingPressure * 100).toFixed(0)}% of volume on the range bars occurred on up-close bars. ` +
      'Institutions are quietly absorbing supply at these levels without pushing price up yet. ' +
      'This is the setup phase before markup. Watch for a Spring or a decisive breakout above range high ' +
      'to confirm the next leg. Calls can be staged in cautiously with tight stops at range low.' +
      (volContracting ? ' Volume is contracting (drying up) — a classic accumulation signature indicating supply exhaustion.' : '')
  } else if (buyingPressure < 0.45) {
    phase       = 'DISTRIBUTION'
    signal      = 'BEARISH'
    confidence  = volContracting ? 'medium' : 'low'
    description =
      'Price is inside the trading range and volume analysis shows selling pressure dominating — ' +
      `${((1 - buyingPressure) * 100).toFixed(0)}% of volume on the range bars occurred on down-close bars. ` +
      'Smart money is offloading inventory into any rallies, keeping price capped at range high. ' +
      'This is the setup phase before markdown. Watch for a UTAD or a decisive breakdown below range low. ' +
      'Do not buy calls in this environment. Reduce long exposure and consider defensive positioning.' +
      (volContracting ? ' Volume is contracting — demand is drying up, consistent with distribution completion.' : '')
  } else {
    phase       = 'RANGING'
    signal      = 'NEUTRAL'
    confidence  = 'low'
    description =
      'Price is inside the trading range and volume analysis shows a roughly balanced fight between ' +
      'buyers and sellers. No clear Wyckoff phase is dominant yet. This is a wait-and-see environment. ' +
      'Avoid initiating new directional trades until a Spring, UTAD, or confirmed breakout resolves ' +
      'the balance of power. Preserve capital.'
  }

  return {
    phase,
    signal,
    confidence,
    description,
    rangeHigh:      parseFloat(rangeHigh.toFixed(4)),
    rangeLow:       parseFloat(rangeLow.toFixed(4)),
    rangeSize:      parseFloat(rangeSize.toFixed(4)),
    buyingPressure: parseFloat(buyingPressure.toFixed(4)),
    spring,
    utad,
    sellingClimax,
    buyingClimax,
    lpsZone,
    trendContext,
    weeklyEmaSlope,
    volContracting,
    volContraction: parseFloat(volContraction.toFixed(4)),
    rangeTouches,
    rangeDuration,
    rangeQuality,
    targets,
    potentialMoveUp,
    potentialMoveDown,
    currentClose,
    avgVol:         parseFloat(avgVol.toFixed(0)),
    currentVolRatio,
    atr:            parseFloat(atr.toFixed(4)),
  }
}
