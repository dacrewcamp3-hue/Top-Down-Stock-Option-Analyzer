// Filters historical backtest trades by conditions matching the current setup,
// then returns the options win rate for that conditional subset.
// Requires runBacktest.js trades (which include adxLevel per trade).

const GRADE_RANK = { 'A+': 3, 'A': 2, 'B': 1 }

/**
 * @param {Array}  trades    - trade records from runBacktest()
 * @param {object} conditions
 *   direction  'CALL' | 'PUT'
 *   grade      'A+' | 'A' | 'B' | null
 *   adxLevel   'strong' | 'moderate' | 'weak' | null
 * @returns null if insufficient data, otherwise:
 *   { total, wins, losses, winRate, avgWin, avgLoss, conditions }
 */
export function calcConditionalWinRate(trades, { direction, grade, adxLevel }) {
  if (!trades?.length || !direction) return null

  const gradeMin = GRADE_RANK[grade] ?? 1

  const filtered = trades.filter(t => {
    if (t.signal !== direction)                              return false
    if ((GRADE_RANK[t.grade] ?? 0) < gradeMin)             return false
    if (adxLevel === 'strong'   && t.adxLevel !== 'strong') return false
    if (adxLevel === 'moderate' && t.adxLevel === 'weak')   return false
    return true
  })

  if (filtered.length < 3) return null

  const wins    = filtered.filter(t => t.optWin)
  const losses  = filtered.filter(t => !t.optWin)
  const winRate = Math.round(wins.length / filtered.length * 100)

  const avgWin  = wins.length
    ? wins.reduce((s, t) => s + t.optGainPct, 0) / wins.length
    : 0
  const avgLoss = losses.length
    ? losses.reduce((s, t) => s + t.optGainPct, 0) / losses.length
    : 0

  return {
    total:    filtered.length,
    wins:     wins.length,
    losses:   losses.length,
    winRate,
    avgWin:   +avgWin.toFixed(1),
    avgLoss:  +avgLoss.toFixed(1),
    conditions: { direction, grade, adxLevel },
  }
}
