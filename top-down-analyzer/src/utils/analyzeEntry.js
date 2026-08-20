// Returns a recommendation object based on filled-in timeframe signals.
// Confluence is the weighted ratio of bull vs bear signals (-1 to +1).
// Thresholds: >= 0.60 → CALL, <= -0.60 → PUT, between → NO TRADE.
// Minimum 3 directional signals required before any recommendation fires.

export const CALL_THRESHOLD = 0.60
export const PUT_THRESHOLD = -0.60
export const MIN_SIGNALS = 3

// Priority order for blocker analysis — trend and entry signals matter most
const PRIORITY_FIELDS  = ['trend', 'ema8Cross', 'priceVsEMA', 'adx', 'rsi', 'structure', 'macd']
const PRIORITY_LABELS  = {
  trend: 'Trend', ema8Cross: 'EMA8 Cross', priceVsEMA: 'EMA30',
  adx: 'ADX', rsi: 'RSI', structure: 'Structure', macd: 'MACD',
}

export function analyzeEntry(tfStates, timeframes) {
  let totalBull = 0
  let totalBear = 0
  const breakdown = []

  for (const tf of timeframes) {
    let tfBull = 0
    let tfBear = 0
    let answered = 0

    for (const field of tf.fields) {
      const value = tfStates[tf.id]?.[field.id]
      if (!value || value === 'neutral') continue
      answered++
      if (value === 'bull') tfBull += tf.weight
      else if (value === 'bear') tfBear += tf.weight
    }

    totalBull += tfBull
    totalBear += tfBear

    breakdown.push({
      id: tf.id,
      label: tf.label,
      shortLabel: tf.shortLabel,
      weight: tf.weight,
      bull: tfBull,
      bear: tfBear,
      answered,
      total: tf.fields.length,
    })
  }

  const totalWeighted = totalBull + totalBear
  const totalSignals  = breakdown.reduce((sum, b) => sum + b.answered, 0)
  const confluence    = totalWeighted === 0 ? 0 : (totalBull - totalBear) / totalWeighted

  let signal = 'NO TRADE'
  if (totalSignals >= MIN_SIGNALS) {
    if (confluence >= CALL_THRESHOLD) signal = 'CALL'
    else if (confluence <= PUT_THRESHOLD) signal = 'PUT'
  }

  // ── Gate check ────────────────────────────────────────────────────────────
  // Weekly and daily are directors — if either is net against the signal, gate blocks entry.
  const weeklyBD = breakdown.find(b => b.id === 'weekly')
  const dailyBD  = breakdown.find(b => b.id === 'daily')

  function gateStatus(bd, sig) {
    if (!bd || bd.answered === 0) return 'neutral'
    const net = bd.bull - bd.bear
    // Strict gate: directors must be definitively aligned, not just tied or neutral
    if (sig === 'CALL') return net > 0 ? 'pass' : 'fail'
    if (sig === 'PUT')  return net < 0 ? 'pass' : 'fail'
    // NO TRADE: show which way director is leaning
    return net > 0 ? 'bull' : net < 0 ? 'bear' : 'neutral'
  }

  const weeklyGate  = gateStatus(weeklyBD, signal)
  const dailyGate   = gateStatus(dailyBD,  signal)
  const gateBlocked = weeklyGate === 'fail' || dailyGate === 'fail'

  // ── Blocker analysis ──────────────────────────────────────────────────────
  // Find the highest-impact signals that are missing or fighting direction.
  // Used by EntryRecommendation to show "Waiting on / Needs to confirm".
  const targetDir = signal === 'CALL' ? 'bull'
    : signal === 'PUT'  ? 'bear'
    : totalBull >= totalBear ? 'bull' : 'bear'

  const blockers = []
  for (const tf of timeframes) {
    for (const field of tf.fields) {
      if (!PRIORITY_FIELDS.includes(field.id)) continue
      const val      = tfStates[tf.id]?.[field.id]
      if (val === targetDir) continue                  // already aligned — skip
      const rank     = PRIORITY_FIELDS.length - PRIORITY_FIELDS.indexOf(field.id)
      const against  = val && val !== 'neutral'         // actively pointing wrong way
      blockers.push({
        tf:        tf.shortLabel,
        field:     PRIORITY_LABELS[field.id] || field.id,
        current:   val || null,
        against,
        priority:  rank * tf.weight * (against ? 2.0 : 0.7),
      })
    }
  }

  const topBlockers = blockers
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4)

  return {
    signal,
    totalBull,
    totalBear,
    totalSignals,
    confluence,
    breakdown,
    weeklyGate,
    dailyGate,
    gateBlocked,
    topBlockers,
    targetDir,
  }
}
