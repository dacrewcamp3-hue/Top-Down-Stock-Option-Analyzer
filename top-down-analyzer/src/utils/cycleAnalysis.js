// Intermediate cycle analysis — 3 to 6 month cycles on weekly bars.
// Weekly data arrives oldest→newest (index 0 = oldest, n-1 = most recent).

function calcEMA(prices, period) {
  const k = 2 / (period + 1)
  let ema = prices[0]
  return prices.map(p => (ema = p * k + ema * (1 - k)))
}

function calcRSIWeekly(prices, period = 14) {
  const n = prices.length
  if (n < period + 2) return new Array(n).fill(50)
  const rsi = new Array(period).fill(50)
  const changes = []
  for (let i = 1; i < n; i++) changes.push(prices[i] - prices[i - 1])
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += -changes[i]
  }
  avgGain /= period; avgLoss /= period
  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss
  rsi.push(+(100 - 100 / (1 + rs0)).toFixed(1))
  for (let i = period; i < changes.length; i++) {
    const g = changes[i] > 0 ? changes[i] : 0
    const l = changes[i] < 0 ? -changes[i] : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    rsi.push(+(100 - 100 / (1 + rs)).toFixed(1))
  }
  return rsi
}

// Find the most recent confirmed cycle trough scanning backward from end.
// A trough must be a local minimum. RSI threshold is relaxed to avoid missing
// stocks that base at moderately oversold levels (e.g. biotech / small-cap).
function findTrough(closes, rsi, n) {
  // Pass 1: strict — local min AND rsi < 50, within last 52 bars
  for (let i = n - 4; i >= Math.max(4, n - 52); i--) {
    const isLocalMin =
      closes[i] < closes[i - 1] &&
      closes[i] < closes[i - 2] &&
      closes[i] < closes[i + 1] &&
      closes[i] < closes[i + 2]
    if (isLocalMin && rsi[i] < 52) return i
  }
  // Pass 2: relaxed — local min without RSI gate (picks up basing patterns)
  for (let i = n - 4; i >= Math.max(4, n - 52); i--) {
    const isLocalMin =
      closes[i] < closes[i - 1] &&
      closes[i] < closes[i - 2] &&
      closes[i] < closes[i + 1] &&
      closes[i] < closes[i + 2]
    if (isLocalMin) return i
  }
  // Fallback: lowest weekly close in last 30 bars
  let minIdx = n - 4
  for (let i = n - 4; i >= Math.max(0, n - 30); i--) {
    if (closes[i] < closes[minIdx]) minIdx = i
  }
  return minIdx
}

const PHASE_META = {
  ACCUMULATION: {
    color:  '#d97706',
    badge:  '#78350f',
    action: 'WATCH TO ENTER',
    hint:   'The cycle is starting. Price has come off the cycle low and RSI is recovering. This is where institutional money starts quietly building positions. Look for your top-down CALL signal to enter before the move accelerates. The best option entries happen here — before everyone sees it.',
  },
  MARKUP: {
    color:  '#10b981',
    badge:  '#065f46',
    action: 'IN PLAY — HOLD OR ENTER',
    hint:   'The cycle is running. Trend has momentum. A+ and A grade setups are valid here — take them when the confluence fires. Follow your grade-adaptive exits, don\'t bail early out of fear, and don\'t chase if you\'ve missed the entry. The next pullback to the 13-week EMA is your second chance.',
  },
  DISTRIBUTION: {
    color:  '#f97316',
    badge:  '#7c2d12',
    action: 'TIGHTEN STOPS — TAKE PROFITS',
    hint:   'The cycle is maturing. Risk is rising relative to reward. If you\'re in a winning trade, consider locking in partial profits. Do not add new long exposure here. RSI divergence or extended time above the 13-week EMA signals the cycle is topping. The move isn\'t over — but the easy money is.',
  },
  MARKDOWN: {
    color:  '#ef4444',
    badge:  '#7f1d1d',
    action: 'EXIT LONGS — WATCH FOR PUTS',
    hint:   'The cycle has turned. The structural edge is now with put buyers. Avoid buying calls until the next trough forms — a weekly close below the 13-week EMA with RSI under 48, followed by a base and reversal. Your next big entry comes after this phase completes. Patience here is a position.',
  },
}

// Phase → timeline segment boundaries (fraction of 0-1 bar)
const PHASE_SEGMENTS = {
  ACCUMULATION: [0.00, 0.15],
  MARKUP:       [0.15, 0.65],
  DISTRIBUTION: [0.65, 0.85],
  MARKDOWN:     [0.85, 1.00],
}

export function analyzeCycle(weekly) {
  const { closes, highs, lows, timestamps } = weekly
  const n = closes.length
  if (n < 30) return null

  const rsiAll   = calcRSIWeekly(closes, 14)
  const ema13All = calcEMA(closes, 13)
  const ema26All = calcEMA(closes, 26)

  const currentClose  = closes[n - 1]
  const currentRSI    = rsiAll[n - 1]
  const currentEMA13  = ema13All[n - 1]
  const currentEMA26  = ema26All[n - 1]

  // ── Trough (cycle start) ──────────────────────────────────────────────────
  const troughIdx      = findTrough(closes, rsiAll, n)
  const cycleLow       = closes[troughIdx]
  const cycleTs        = timestamps?.[troughIdx] ?? null
  const cycleDate      = cycleTs ? new Date(cycleTs * 1000) : null
  const weeksIntoCycle = n - 1 - troughIdx

  // ── Peak in this cycle window ─────────────────────────────────────────────
  let peakIdx = troughIdx, peakClose = cycleLow
  for (let i = troughIdx; i < n; i++) {
    if (closes[i] > peakClose) { peakClose = closes[i]; peakIdx = i }
  }
  const weeksAtPeak   = peakIdx > troughIdx ? peakIdx - troughIdx : null
  const pctFromCycLow = +((currentClose - cycleLow) / cycleLow * 100).toFixed(1)
  const pctFromPeak   = peakClose > cycleLow
    ? +((currentClose - peakClose) / peakClose * 100).toFixed(1)
    : null

  // ── Price vs EMA relationships ────────────────────────────────────────────
  const aboveEMA13 = currentClose > currentEMA13
  const aboveEMA26 = currentClose > currentEMA26
  // Within 3% of the 13W EMA — basing / consolidation zone
  const nearEMA13  = Math.abs(currentClose - currentEMA13) / currentEMA13 < 0.03

  const rsiAbove50 = currentRSI > 50
  const rsiAbove60 = currentRSI > 60
  const rsiAbove65 = currentRSI > 65

  // ── RSI Divergence (bearish — peak warning) ───────────────────────────────
  let rsiDiv = false
  let rsiDivNote = null
  if (weeksIntoCycle >= 8 && n >= 12) {
    const recentWindow = closes.slice(n - 5, n)
    const recentHigh   = Math.max(...recentWindow)
    const recentHiIdx  = closes.lastIndexOf(recentHigh)

    const prevWindow   = closes.slice(Math.max(troughIdx, n - 14), n - 5)
    if (prevWindow.length >= 3) {
      const prevHigh   = Math.max(...prevWindow)
      const prevHiIdx  = closes.slice(0, n - 5).lastIndexOf(prevHigh)
      if (recentHigh >= prevHigh * 0.97 && prevHiIdx >= 0) {
        const rsiAtRecent = rsiAll[recentHiIdx] ?? currentRSI
        const rsiAtPrev   = rsiAll[prevHiIdx]
        if (rsiAtRecent < rsiAtPrev - 5) {
          rsiDiv = true
          rsiDivNote = `Price made a new high at $${recentHigh.toFixed(2)} but RSI was ${rsiAtRecent.toFixed(0)} vs ${rsiAtPrev.toFixed(0)} at the prior high — momentum is fading into the new price high.`
        }
      }
    }
  }

  // ── RSI Bullish Divergence (trough signal) ────────────────────────────────
  let rsiBullDiv = false
  let rsiBullDivNote = null
  if (weeksIntoCycle <= 8 && n >= 12) {
    const recentWindow = closes.slice(n - 4, n)
    const recentLow    = Math.min(...recentWindow)
    const recentLowIdx = closes.lastIndexOf(recentLow)

    const prevWindow = closes.slice(Math.max(troughIdx, n - 14), n - 4)
    if (prevWindow.length >= 2) {
      const prevLow    = Math.min(...prevWindow)
      const prevLowIdx = closes.slice(0, n - 4).lastIndexOf(prevLow)
      if (recentLow <= prevLow * 1.02 && prevLowIdx >= 0) {
        const rsiAtRecent = rsiAll[recentLowIdx] ?? currentRSI
        const rsiAtPrev   = rsiAll[prevLowIdx]
        if (rsiAtRecent > rsiAtPrev + 5) {
          rsiBullDiv = true
          rsiBullDivNote = `Price made a new low at $${recentLow.toFixed(2)} but RSI was ${rsiAtRecent.toFixed(0)} vs ${rsiAtPrev.toFixed(0)} at the prior low — momentum is recovering despite lower prices. Classic accumulation signal at a cycle bottom.`
        }
      }
    }
  }

  // ── Phase classification ──────────────────────────────────────────────────
  //
  // PRIMARY driver: current technical state (price vs EMAs, RSI level).
  // Cycle age (weeksIntoCycle) is a secondary modifier, not a forcing condition.
  //
  // MARKDOWN requires CLEAR technical breakdown: price below BOTH EMAs with
  // RSI confirmed weak (< 48), OR RSI deeply oversold (< 40). A stock sitting
  // just below its 13W EMA with RSI near 50 is consolidating — not markdown.

  let phase

  // ── 1. Clear markdown: broken below both EMAs, RSI confirming weak
  if (!aboveEMA13 && !aboveEMA26 && currentRSI < 48) {
    phase = 'MARKDOWN'
  }

  // ── 2. Very weak RSI regardless of EMA position
  else if (currentRSI < 38) {
    phase = 'MARKDOWN'
  }

  // ── 3. Fresh off trough (last 3 weeks)
  else if (weeksIntoCycle <= 3) {
    phase = rsiAbove50 ? 'MARKUP' : 'ACCUMULATION'
  }

  // ── 4. Strong markup: above 13W EMA, RSI > 60
  else if (aboveEMA13 && rsiAbove60) {
    // Only call DISTRIBUTION on confirmed bearish RSI divergence late in cycle
    if (rsiDiv && weeksIntoCycle >= 14) phase = 'DISTRIBUTION'
    else phase = 'MARKUP'
  }

  // ── 5. Moderate markup: above 13W EMA, RSI 50-60
  else if (aboveEMA13 && rsiAbove50) {
    if (rsiDiv || weeksIntoCycle >= 22) phase = 'DISTRIBUTION'
    else phase = 'MARKUP'
  }

  // ── 6. Above 13W EMA but RSI slipping below 50 (early topping)
  else if (aboveEMA13 && !rsiAbove50) {
    // Early cycle with slipping RSI = basing/accumulation before markup confirms
    if (weeksIntoCycle <= 7) phase = 'ACCUMULATION'
    else phase = 'DISTRIBUTION'
  }

  // ── 7. Below 13W EMA but above 26W EMA (basing / potential new cycle start)
  //       Stock is between the two EMAs — consolidation, not a downtrend
  else if (!aboveEMA13 && aboveEMA26) {
    phase = currentRSI >= 44 ? 'ACCUMULATION' : 'MARKDOWN'
  }

  // ── 8. Below both EMAs but RSI is recovering (possible capitulation done)
  else if (!aboveEMA13 && !aboveEMA26 && currentRSI >= 48) {
    phase = 'ACCUMULATION'
  }

  // ── 9. Default: below both EMAs with ambiguous RSI
  else {
    phase = 'MARKDOWN'
  }

  // ── Override: confirmed fresh trough with recovering RSI → always accumulation
  if (weeksIntoCycle <= 3 && !rsiAbove50 && phase !== 'MARKDOWN') {
    phase = 'ACCUMULATION'
  }
  // ── Override: bullish divergence at trough = accumulation
  if (rsiBullDiv && phase === 'MARKDOWN') phase = 'ACCUMULATION'

  const meta = PHASE_META[phase]

  // ── phasePct: dot position on the timeline ────────────────────────────────
  // Clamp the time-based position to always stay within the phase's visual
  // segment — prevents the dot from appearing in the wrong section of the bar.
  const timeFraction = Math.min(1.0, weeksIntoCycle / 26)
  const [segStart, segEnd] = PHASE_SEGMENTS[phase]
  // Interpolate: early in cycle → toward seg start; late → toward seg end
  const segProgress = Math.max(segStart + 0.01, Math.min(segEnd - 0.01, timeFraction))
  // If timeFraction is outside the segment, anchor to segment center
  const phasePct = (timeFraction >= segStart && timeFraction <= segEnd)
    ? segProgress
    : (segStart + segEnd) / 2

  // ── 52-week context ───────────────────────────────────────────────────────
  const w52High = Math.max(...closes.slice(Math.max(0, n - 52)))
  const w52Low  = Math.min(...closes.slice(Math.max(0, n - 52)))
  const w52Pct  = w52High > w52Low
    ? +((currentClose - w52Low) / (w52High - w52Low) * 100).toFixed(0)
    : 50

  return {
    phase,
    phaseColor:   meta.color,
    phaseBadge:   meta.badge,
    phaseAction:  meta.action,
    phaseHint:    meta.hint,
    weeksIntoCycle,
    phasePct,
    cycleLow,
    cycleDate,
    peakClose,
    weeksAtPeak,
    pctFromCycLow,
    pctFromPeak,
    currentClose,
    currentRSI,
    currentEMA13,
    currentEMA26,
    aboveEMA13,
    aboveEMA26,
    priceBelowEMA13: !aboveEMA13,
    rsiDiv,
    rsiDivNote,
    rsiBullDiv,
    rsiBullDivNote,
    w52High,
    w52Low,
    w52Pct,
  }
}
