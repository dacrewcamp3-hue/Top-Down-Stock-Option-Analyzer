/* ═══════════════════════════════════════════════════════════════════════════
   wyckoff.js — Wyckoff phase detector from OHLCV bar arrays
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Detects the Wyckoff phase from arrays of OHLCV data.
 *
 * @param {number[]} highs   - Array of bar highs (oldest first)
 * @param {number[]} lows    - Array of bar lows
 * @param {number[]} closes  - Array of bar closes
 * @param {number[]} volumes - Array of bar volumes
 * @returns {object|null}    - Wyckoff analysis object, or null if insufficient data
 */
export function detectWyckoff(highs, lows, closes, volumes) {
  if (!closes || closes.length < 60) return null

  const len = closes.length

  // Use last 100 bars (or all available)
  const window = Math.min(100, len)
  const startIdx = len - window

  // Spring/UTAD are detected in the most recent 15 bars.
  // The trading range is established from [startIdx, len-15) so the event window
  // never contaminates the range high/low (a spring low can't become the range low).
  const EVENT_WINDOW = 15
  const rangeEnd = len - EVENT_WINDOW
  const rangeBars = {
    highs:   highs.slice(startIdx, rangeEnd),
    lows:    lows.slice(startIdx, rangeEnd),
    closes:  closes.slice(startIdx, rangeEnd),
    volumes: volumes.slice(startIdx, rangeEnd),
  }

  if (rangeBars.closes.length === 0) return null

  // ── Trading Range ─────────────────────────────────────────────────────────
  const rangeHigh = Math.max(...rangeBars.highs)
  const rangeLow  = Math.min(...rangeBars.lows)
  const rangeSize = rangeHigh - rangeLow

  // ── Average Volume (range bars) ───────────────────────────────────────────
  const totalRangeVol = rangeBars.volumes.reduce((s, v) => s + v, 0)
  const avgVol = totalRangeVol / rangeBars.volumes.length

  // ── Buying Pressure ───────────────────────────────────────────────────────
  // Sum of volume on bars that closed up (close > open proxy: close[i] > close[i-1])
  let buyVol = 0
  let totalVol = 0
  for (let i = startIdx; i < rangeEnd; i++) {
    const v = volumes[i]
    totalVol += v
    // Up-close bar: close above previous close (or above open if single-bar logic)
    if (i > 0 && closes[i] > closes[i - 1]) {
      buyVol += v
    }
  }
  const buyingPressure = totalVol > 0 ? buyVol / totalVol : 0.5

  // ── Recent event window (last 15 bars) ───────────────────────────────────
  const eventStart = len - EVENT_WINDOW

  // ── Spring Detection ──────────────────────────────────────────────────────
  // Spring: bar pokes below rangeLow then closes back above it.
  // Scan from most recent to oldest so we capture the LATEST spring.
  let spring = null
  for (let i = len - 1; i >= eventStart; i--) {
    if (lows[i] < rangeLow && closes[i] > rangeLow) {
      const volRatio = avgVol > 0 ? volumes[i] / avgVol : 1
      spring = {
        low:         lows[i],
        rangeLow,
        recoveredTo: closes[i],
        volRatio:    parseFloat(volRatio.toFixed(2)),
        isLowVolume: volRatio < 0.8,
        barIndex:    i,
      }
      break // capture the first spring found
    }
  }

  // ── UTAD Detection ────────────────────────────────────────────────────────
  // UTAD: bar pokes above rangeHigh then closes back below it.
  // Scan from most recent to oldest so we capture the LATEST UTAD.
  let utad = null
  for (let i = len - 1; i >= eventStart; i--) {
    if (highs[i] > rangeHigh && closes[i] < rangeHigh) {
      const volRatio = avgVol > 0 ? volumes[i] / avgVol : 1
      utad = {
        high:       highs[i],
        rangeHigh,
        failedAt:   closes[i],
        volRatio:   parseFloat(volRatio.toFixed(2)),
        isHighVolume: volRatio > 1.2,
        barIndex:   i,
      }
      break // capture the first UTAD found
    }
  }

  // ── Current bar metrics ───────────────────────────────────────────────────
  const currentClose    = closes[len - 1]
  const currentVolRatio = avgVol > 0
    ? parseFloat((volumes[len - 1] / avgVol).toFixed(2))
    : 1

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
    // Both events detected — conflicting signals, treat as neutral
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
    phase       = 'SPRING'
    signal      = 'BULLISH'
    confidence  = spring.isLowVolume ? 'high' : 'medium'
    description =
      'A Spring has been detected — price briefly violated the support boundary of the trading range ' +
      'then recovered back inside. This is the highest-confidence Wyckoff buy signal: the false breakdown ' +
      'flushed out weak longs, but demand stepped in and closed the bar back above range low. ' +
      (spring.isLowVolume
        ? 'Volume on the breakdown was BELOW average — the ideal Spring signature. Low volume means sellers could not press their advantage; supply is exhausted. High confidence.'
        : 'Volume was at or above average on the breakdown — a valid Spring but watch for a retest of the range low before committing full size. Confirm with a subsequent high-volume up bar (SOS).')
  } else if (utad) {
    phase       = 'UTAD'
    signal      = 'BEARISH'
    confidence  = utad.isHighVolume ? 'high' : 'medium'
    description =
      'A UTAD (Upthrust After Distribution) has been detected — price spiked above the resistance ' +
      'boundary of the trading range then reversed and closed back inside. This is the distribution analog ' +
      'of the Spring: a bull trap that absorbs the last remaining buying pressure before markdown begins. ' +
      (utad.isHighVolume
        ? 'Volume on the rejection was ABOVE average — a high-volume failure confirms that supply overwhelmed demand at the high. High confidence bearish signal.'
        : 'Volume was moderate on the failure — valid signal, but wait for a lower close on the following bar or a return to range high that fails again before committing full size.')
  } else if (buyingPressure > 0.55) {
    phase       = 'ACCUMULATION'
    signal      = 'BULLISH'
    confidence  = 'medium'
    description =
      'Price is inside the trading range and volume analysis shows buying pressure dominating — ' +
      `${(buyingPressure * 100).toFixed(0)}% of volume on the range bars occurred on up-close bars. ` +
      'Institutions are quietly absorbing supply at these levels without pushing price up yet. ' +
      'This is the setup phase before markup. Watch for a Spring or a decisive breakout above range high ' +
      'to confirm the next leg. Calls can be staged in cautiously with tight stops at range low.'
  } else if (buyingPressure < 0.45) {
    phase       = 'DISTRIBUTION'
    signal      = 'BEARISH'
    confidence  = 'medium'
    description =
      'Price is inside the trading range and volume analysis shows selling pressure dominating — ' +
      `${((1 - buyingPressure) * 100).toFixed(0)}% of volume on the range bars occurred on down-close bars. ` +
      'Smart money is offloading inventory into any rallies, keeping price capped at range high. ' +
      'This is the setup phase before markdown. Watch for a UTAD or a decisive breakdown below range low. ' +
      'Do not buy calls in this environment. Reduce long exposure and consider defensive positioning.'
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

  // ── Wyckoff Cause & Effect ────────────────────────────────────────────────
  const potentialMoveUp   = rangeHigh + rangeSize * 1.5
  const potentialMoveDown = rangeLow  - rangeSize * 1.5

  return {
    phase,
    signal,
    confidence,
    description,
    rangeHigh,
    rangeLow,
    rangeSize,
    buyingPressure: parseFloat(buyingPressure.toFixed(4)),
    spring,
    utad,
    potentialMoveUp:   parseFloat(potentialMoveUp.toFixed(2)),
    potentialMoveDown: parseFloat(potentialMoveDown.toFixed(2)),
    currentClose,
    avgVol: parseFloat(avgVol.toFixed(0)),
    currentVolRatio,
  }
}
