// Fetches short interest data from Yahoo Finance's quoteSummary API.
// Returns: shortPct, daysToCover, sharesShort, priorMonthShares, changeDir, squeezePotential
// Uses the existing /yf-api proxy (query1.finance.yahoo.com) — no extra proxy needed.
// Data is from FINRA twice-monthly settlement reports as redistributed by Yahoo.

const YF = '/yf-api'

function raw(obj) {
  return typeof obj === 'object' && obj !== null && 'raw' in obj ? obj.raw : obj
}

export async function fetchShortInterest(ticker) {
  if (!ticker) return null
  try {
    const url = `${YF}/v10/finance/quoteSummary/${encodeURIComponent(ticker.toUpperCase())}` +
      `?modules=defaultKeyStatistics`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()

    const stats = json?.quoteSummary?.result?.[0]?.defaultKeyStatistics
    if (!stats) return null

    const sharesShort  = raw(stats.sharesShort)           // total shares short
    const priorShares  = raw(stats.sharesShortPriorMonth) // prior settlement period
    const shortPct     = raw(stats.shortPercentOfFloat)   // 0.045 = 4.5%
    const daysToCover  = raw(stats.shortRatio)            // days to cover at avg volume
    const dateRaw      = raw(stats.dateShortInterest)     // unix timestamp
    const floatShares  = raw(stats.floatShares)

    if (sharesShort == null && shortPct == null) return null

    // Month-over-month change
    const mom = (sharesShort != null && priorShares != null && priorShares > 0)
      ? ((sharesShort - priorShares) / priorShares)  // e.g. 0.08 = +8%
      : null

    // Squeeze potential: high short pct + meaningful days to cover
    const pct = shortPct != null ? shortPct : 0
    const dtc = daysToCover != null ? daysToCover : 0
    const squeeze = pct >= 0.10 && dtc >= 3   // 10%+ float short + 3+ days to cover

    // Settle date from unix timestamp
    const settleDate = dateRaw ? new Date(dateRaw * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

    return {
      ticker:       ticker.toUpperCase(),
      sharesShort,
      priorShares,
      shortPct,          // fraction (0.045 = 4.5%)
      daysToCover,
      floatShares,
      mom,               // fraction (positive = shorts increasing)
      squeeze,           // boolean
      settleDate,
    }
  } catch {
    return null
  }
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function shortPctLabel(pct) {
  if (pct == null) return '—'
  return `${(pct * 100).toFixed(1)}%`
}

export function shortPctColor(pct) {
  if (pct == null) return '#4a6888'
  if (pct >= 0.20)  return '#ef4444'   // heavy — squeeze territory or real bearish bet
  if (pct >= 0.10)  return '#f59e0b'   // elevated
  return '#10b981'                      // low — not much short-side conviction
}

export function dtcColor(dtc) {
  if (dtc == null) return '#4a6888'
  if (dtc >= 5) return '#f59e0b'
  return '#10b981'
}

export function momLabel(mom) {
  if (mom == null) return null
  const sign = mom >= 0 ? '+' : ''
  return `${sign}${(mom * 100).toFixed(1)}% MoM`
}
