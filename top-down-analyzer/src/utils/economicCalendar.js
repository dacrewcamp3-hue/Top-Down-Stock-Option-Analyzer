// Major US macro events — FOMC, CPI, NFP, PPI, GDP.
// Dates sourced from Federal Reserve, BLS, and BEA published schedules.
// NFP is computed algorithmically (first Friday of each month).

// ── FOMC decision dates (day 2 of 2-day meeting, announcement ~2pm ET) ──────
const FOMC = [
  '2025-01-29','2025-03-19','2025-05-07','2025-06-18',
  '2025-07-30','2025-09-17','2025-10-29','2025-12-10',
  '2026-01-28','2026-03-18','2026-04-29','2026-06-17',
  '2026-07-29','2026-09-16','2026-10-28','2026-12-09',
]

// ── CPI release dates (BLS Consumer Price Index, ~8:30am ET) ─────────────────
const CPI = [
  '2025-01-15','2025-02-12','2025-03-12','2025-04-10',
  '2025-05-13','2025-06-11','2025-07-15','2025-08-12',
  '2025-09-10','2025-10-15','2025-11-12','2025-12-10',
  '2026-01-14','2026-02-11','2026-03-11','2026-04-10',
  '2026-05-12','2026-06-10','2026-07-14','2026-08-12',
  '2026-09-10','2026-10-14','2026-11-12','2026-12-09',
]

// ── PPI release dates (BLS Producer Price Index, ~8:30am ET) ─────────────────
const PPI = [
  '2025-01-14','2025-02-13','2025-03-13','2025-04-11',
  '2025-05-15','2025-06-12','2025-07-16','2025-08-13',
  '2025-09-11','2025-10-16','2025-11-13','2025-12-11',
  '2026-01-15','2026-02-12','2026-03-12','2026-04-11',
  '2026-05-13','2026-06-11','2026-07-15','2026-08-13',
  '2026-09-11','2026-10-15','2026-11-13','2026-12-10',
]

// ── GDP advance estimate dates (BEA, ~28 days after quarter end) ─────────────
const GDP = [
  '2025-01-30','2025-04-30','2025-07-30','2025-10-29',
  '2026-01-28','2026-04-29','2026-07-29','2026-10-28',
]

// ── NFP: first Friday of each month (computed, not hardcoded) ─────────────────
function firstFriday(year, month) {
  const d = new Date(Date.UTC(year, month, 1))
  const offset = (5 - d.getUTCDay() + 7) % 7
  d.setUTCDate(1 + offset)
  return d.toISOString().slice(0, 10)
}

function generateNFP(fromYear, toYear) {
  const out = []
  for (let y = fromYear; y <= toYear; y++)
    for (let m = 0; m < 12; m++)
      out.push(firstFriday(y, m))
  return out
}

const NFP = generateNFP(2025, 2026)

// ── Build master event list ───────────────────────────────────────────────────
const ALL_EVENTS = [
  ...FOMC.map(d => ({ date: d, type: 'FOMC', label: 'Fed Rate Decision',       impact: 'extreme'  })),
  ...CPI.map(d  => ({ date: d, type: 'CPI',  label: 'CPI Inflation Report',     impact: 'high'     })),
  ...NFP.map(d  => ({ date: d, type: 'NFP',  label: 'Jobs Report (NFP)',         impact: 'high'     })),
  ...GDP.map(d  => ({ date: d, type: 'GDP',  label: 'GDP Advance Estimate',      impact: 'high'     })),
  ...PPI.map(d  => ({ date: d, type: 'PPI',  label: 'PPI Producer Price Index',  impact: 'moderate' })),
].sort((a, b) => a.date.localeCompare(b.date))

/**
 * Returns upcoming macro events within `lookAheadDays` from today.
 * Each event: { date, type, label, impact, daysAway, riskLevel }
 * riskLevel: 'extreme' | 'high' | 'moderate' | 'monitor'
 */
export function getUpcomingEvents(lookAheadDays = 30) {
  const now      = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const cutStr   = new Date(now.getTime() + lookAheadDays * 86400000).toISOString().slice(0, 10)

  return ALL_EVENTS
    .filter(e => e.date >= todayStr && e.date <= cutStr)
    .map(e => {
      const daysAway = Math.round((new Date(e.date + 'T12:00:00Z') - now) / 86400000)
      const riskLevel =
        e.impact === 'extreme' && daysAway <= 5  ? 'extreme'
      : e.impact === 'extreme' && daysAway <= 14 ? 'high'
      : e.impact === 'high'    && daysAway <= 3  ? 'high'
      : e.impact === 'high'    && daysAway <= 10 ? 'moderate'
      : 'monitor'
      return { ...e, daysAway, riskLevel }
    })
}

/**
 * Returns the single highest risk level from events in the next `days` window.
 */
export function getCalendarRisk(days = 7) {
  const evts = getUpcomingEvents(days)
  if (evts.some(e => e.riskLevel === 'extreme')) return 'extreme'
  if (evts.some(e => e.riskLevel === 'high'))    return 'high'
  if (evts.some(e => e.riskLevel === 'moderate'))return 'moderate'
  if (evts.some(e => e.riskLevel === 'monitor')) return 'monitor'
  return 'clear'
}
