// Fetches earnings history + next earnings date from Yahoo Finance quoteSummary.
// Splits into two parallel requests so a failure in one module doesn't block the other.

const SUMMARY_BASE = '/yf-api/v10/finance/quoteSummary'

async function yfSummary(ticker, modules) {
  const url = `${SUMMARY_BASE}/${encodeURIComponent(ticker)}?modules=${modules}`
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const err  = json.quoteSummary?.error
  if (err) throw new Error(err.description ?? 'Yahoo Finance error')
  const r = json.quoteSummary?.result?.[0]
  if (!r)  throw new Error('No result')
  return r
}

// Accepts a list of module group strings to try in order; returns first that works.
async function yfSummaryFirst(ticker, moduleGroups) {
  for (const mods of moduleGroups) {
    try {
      const r = await yfSummary(ticker, mods)
      return r
    } catch (_) {}
  }
  return null
}

function safeRaw(obj) {
  if (obj == null) return null
  if (typeof obj === 'number') return obj
  return obj.raw ?? null
}

export async function fetchEarningsHistory(ticker, dailyCloses, dailyTimestamps) {
  try {
    // Fetch two groups in parallel: calendar/stats (light) + history (heavier)
    const [calResult, histResult] = await Promise.allSettled([
      yfSummaryFirst(ticker, [
        'calendarEvents,defaultKeyStatistics',
        'calendarEvents',
        'defaultKeyStatistics',
      ]),
      yfSummaryFirst(ticker, [
        'earningsHistory',
        'earnings',
      ]),
    ])

    const cal  = calResult.status  === 'fulfilled' ? calResult.value  : null
    const hist = histResult.status === 'fulfilled' ? histResult.value : null

    // ── Next earnings date ────────────────────────────────────────────────────
    let nextRaw = null
    if (cal) {
      // calendarEvents.earnings.earningsDate is an array of {raw, fmt}
      const earningsDates = cal.calendarEvents?.earnings?.earningsDate ?? []
      nextRaw = safeRaw(earningsDates[0]) ?? null
    }

    // ── Key statistics ────────────────────────────────────────────────────────
    const ks        = cal?.defaultKeyStatistics ?? {}
    const trailingEPS = safeRaw(ks.trailingEps)
    const forwardPE   = safeRaw(ks.forwardPE)
    const pegRatio    = safeRaw(ks.pegRatio)
    const shortFloat  = safeRaw(ks.shortPercentOfFloat)

    // ── Earnings history ──────────────────────────────────────────────────────
    // Try earningsHistory.history first, fall back to earnings.earningsHistory.history
    let rawHistory = []
    if (hist) {
      rawHistory =
        hist.earningsHistory?.history ??
        hist.earnings?.earningsHistory?.history ??
        []
    }

    // Build enriched history — most-recent first
    const enriched = rawHistory
      .map(h => {
        // 'quarter.raw' is the quarter-end Unix timestamp (NOT the report date).
        // We search forward from quarter end to find the next bar with unusual volume
        // or the next bar ≥ 15 days after quarter end (typical report window).
        const quarterTs = safeRaw(h.quarter)
        const date      = quarterTs ? new Date(quarterTs * 1000) : null

        let priceMove = null
        if (quarterTs && dailyTimestamps?.length && dailyCloses?.length) {
          // Earnings are typically reported 2–8 weeks after quarter end.
          // Find all bars from quarter-end to quarter-end+90 days.
          const windowStart = quarterTs
          const windowEnd   = quarterTs + 90 * 86400

          // Look for the bar with the largest single-day move in that window —
          // that's most likely the earnings reaction day.
          let bestAbs = 0
          let bestMove = null
          for (let i = 1; i < dailyTimestamps.length; i++) {
            const ts = dailyTimestamps[i]
            if (ts < windowStart || ts > windowEnd) continue
            const prev = dailyCloses[i - 1]
            if (!prev || prev <= 0) continue
            const move = (dailyCloses[i] - prev) / prev * 100
            if (Math.abs(move) > bestAbs) {
              bestAbs  = Math.abs(move)
              bestMove = +move.toFixed(1)
            }
          }
          // Only use it if the biggest move is at least 1% (filters out normal trading days)
          if (bestAbs >= 1) priceMove = bestMove
        }

        return {
          date,
          quarter:     h.period ?? '',
          epsActual:   safeRaw(h.epsActual),
          epsEstimate: safeRaw(h.epsEstimate),
          surprise:    safeRaw(h.surprisePercent),
          priceMove,
        }
      })
      .filter(e => e.date != null)    // drop items with no date
      .reverse()                       // most recent first

    // ── Aggregated stats ──────────────────────────────────────────────────────
    const moves    = enriched.map(e => e.priceMove).filter(m => m != null)
    const avgMove  = moves.length
      ? +(moves.reduce((a, b) => a + Math.abs(b), 0) / moves.length).toFixed(1)
      : null
    const bullPct  = moves.length
      ? Math.round(moves.filter(m => m > 0).length / moves.length * 100)
      : null

    return {
      history:  enriched,
      nextTs:   nextRaw,
      nextDate: nextRaw ? new Date(nextRaw * 1000) : null,
      dteToNext: nextRaw
        ? Math.ceil((nextRaw * 1000 - Date.now()) / 86400000)
        : null,
      avgMove,
      bullPct,
      trailingEPS,
      forwardPE,
      pegRatio,
      shortFloat,
    }
  } catch (err) {
    console.warn('[EarningsMode] fetch failed:', err.message)
    return null
  }
}
