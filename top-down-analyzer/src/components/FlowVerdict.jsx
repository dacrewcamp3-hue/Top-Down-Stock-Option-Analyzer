import './FlowVerdict.css'

// Shared top-level flow verdict strip for the Options Flow and Live Flow sub-tabs.
// Rolls every ticker's call vs put premium into one net directional read (#2),
// stamps the data's freshness in ET (#6), and labels it honestly as a delayed,
// derived snapshot — not a live exchange tape (#1).

function fmtPrem(n) {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

function fmtClockET(d) {
  if (d == null) return null
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return null
  return dt.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'America/New_York',
  })
}

export function FlowVerdict({ sentiment = {}, contractCount = 0, updatedAt = null, live = false }) {
  const entries  = Object.values(sentiment)
  const callPrem = entries.reduce((s, v) => s + (v.callPrem ?? 0), 0)
  const putPrem  = entries.reduce((s, v) => s + (v.putPrem  ?? 0), 0)
  const total    = callPrem + putPrem
  if (total <= 0) return null

  // Premium-weighted net bias — dollars committed, not raw contract counts.
  const callPct = Math.round(callPrem / total * 100)
  let dir, label
  if (callPct >= 58)      { dir = 'bull'; label = 'FLOW LEANS BULLISH' }
  else if (callPct <= 42) { dir = 'bear'; label = 'FLOW LEANS BEARISH' }
  else                    { dir = 'flat'; label = 'FLOW IS BALANCED'   }

  const stamp = fmtClockET(updatedAt)

  return (
    <div className={`fv-strip fv-${dir}`}>
      <div className="fv-main">
        <span className="fv-verdict">{label}</span>
        <div className="fv-bar" title={`Calls ${fmtPrem(callPrem)} · Puts ${fmtPrem(putPrem)} (premium-weighted)`}>
          <div className="fv-bar-call" style={{ width: `${callPct}%` }} />
          <div className="fv-bar-put"  style={{ width: `${100 - callPct}%` }} />
        </div>
        <span className="fv-pct">{callPct}% calls</span>
      </div>

      <div className="fv-chips">
        <span className="fv-chip">
          <span className="fv-chip-lbl">Call $</span>
          <span className="fv-chip-val fv-call">{fmtPrem(callPrem)}</span>
        </span>
        <span className="fv-chip">
          <span className="fv-chip-lbl">Put $</span>
          <span className="fv-chip-val fv-put">{fmtPrem(putPrem)}</span>
        </span>
        <span className="fv-chip">
          <span className="fv-chip-lbl">Unusual</span>
          <span className="fv-chip-val">{contractCount}</span>
        </span>
      </div>

      <div className="fv-foot">
        {stamp && (
          <span className="fv-fresh">
            <span className={`fv-dot${live ? ' fv-dot-live' : ''}`} />
            {live ? 'updated' : 'as of'} {stamp} ET
          </span>
        )}
        <span
          className="fv-note"
          title="Yahoo options quotes are delayed (~15 min) and aggregated per session. This is a derived read of unusual call/put premium — not a live exchange time-and-sales tape."
        >
          delayed · derived
        </span>
      </div>
    </div>
  )
}
