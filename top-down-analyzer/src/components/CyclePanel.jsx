import './CyclePanel.css'

// Phase segments as % of the 26-week cycle timeline bar
const SEGMENTS = [
  { id: 'ACCUMULATION', label: 'Accumulation', widthPct: 15, color: '#78350f', activeColor: '#d97706' },
  { id: 'MARKUP',       label: 'Markup',       widthPct: 50, color: '#064e2e', activeColor: '#10b981' },
  { id: 'DISTRIBUTION', label: 'Distribution', widthPct: 20, color: '#7c2d12', activeColor: '#f97316' },
  { id: 'MARKDOWN',     label: 'Markdown',     widthPct: 15, color: '#450a0a', activeColor: '#ef4444' },
]

function fmt(n) {
  if (n == null || !isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${n.toFixed(2)}`
}

function fmtDate(d) {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CycleTimeline({ phasePct, phase, cycleLow, peakClose, currentClose, currentEMA13 }) {
  const dotLeft = `${Math.min(98, phasePct * 100).toFixed(1)}%`

  // Price to show inside each segment
  const segPrices = {
    ACCUMULATION: cycleLow   ?? null,
    MARKUP:       currentEMA13 ?? null,
    DISTRIBUTION: peakClose  ?? null,
    MARKDOWN:     phase === 'MARKDOWN' ? currentClose : null,
  }

  return (
    <div className="cp-timeline-wrap">
      <div className="cp-timeline-track">
        {SEGMENTS.map(s => (
          <div
            key={s.id}
            className={`cp-seg${s.id === phase ? ' cp-seg-active' : ''}`}
            style={{
              width: `${s.widthPct}%`,
              background: s.id === phase ? s.activeColor : s.color,
            }}
          >
            {segPrices[s.id] != null && (
              <span className="cp-seg-price">{fmt(segPrices[s.id])}</span>
            )}
            <span className="cp-seg-label">{s.label}</span>
          </div>
        ))}
        <div className="cp-dot" style={{ left: dotLeft }}>
          <div className="cp-dot-inner" />
          <div className="cp-dot-label">
            {currentClose != null ? fmt(currentClose) : 'NOW'}
          </div>
        </div>
      </div>
      <div className="cp-timeline-axis">
        <span>Cycle Low</span>
        <span>Now · {fmt(currentClose)}</span>
        <span>Week 26</span>
      </div>
    </div>
  )
}

export default function CyclePanel({ cycle, ticker }) {
  if (!ticker) {
    return (
      <div className="cp-empty">
        Load a ticker to see its intermediate cycle phase and entry timing.
      </div>
    )
  }
  if (!cycle) {
    return (
      <div className="cp-empty">
        Not enough weekly data to compute cycle phase. Try a major US equity with at least 30 weeks of history.
      </div>
    )
  }

  const {
    phase, phaseColor, phaseBadge, phaseAction, phaseHint,
    weeksIntoCycle, phasePct,
    cycleLow, cycleDate,
    peakClose, weeksAtPeak,
    pctFromCycLow, pctFromPeak,
    currentClose, currentRSI, currentEMA13, currentEMA26,
    priceBelowEMA13,
    rsiDiv, rsiDivNote,
    rsiBullDiv, rsiBullDivNote,
    w52High, w52Low, w52Pct,
  } = cycle

  const cycleLen = 26
  const weeksLeft = Math.max(0, cycleLen - weeksIntoCycle)
  const isExtended = weeksIntoCycle > cycleLen

  return (
    <div className="cp-root">
      {/* ── Header ── */}
      <div className="cp-header">
        <div className="cp-header-left">
          <span className="cp-ticker">{ticker}</span>
          <span className="cp-subtitle">Intermediate Cycle — 3 to 6 Month Window</span>
        </div>
        <div className="cp-phase-badge" style={{ background: phaseBadge, color: phaseColor }}>
          {phase}
        </div>
      </div>

      {/* ── Phase action bar ── */}
      <div className="cp-action-bar" style={{ borderColor: phaseColor }}>
        <span className="cp-action-label" style={{ color: phaseColor }}>{phaseAction}</span>
        <span className="cp-action-weeks">
          Week {weeksIntoCycle} of ~{cycleLen}
          {isExtended && <span className="cp-extended"> — EXTENDED CYCLE</span>}
          {!isExtended && ` — est. ${weeksLeft} week${weeksLeft !== 1 ? 's' : ''} remaining`}
        </span>
      </div>

      {/* ── Timeline ── */}
      <CycleTimeline
        phasePct={phasePct} phase={phase}
        cycleLow={cycleLow} peakClose={peakClose}
        currentClose={currentClose} currentEMA13={currentEMA13}
      />

      {/* ── RSI Divergence signals ── */}
      {rsiDiv && (
        <div className="cp-rsi-warn">
          <span className="cp-rsi-warn-title">⚠ RSI Bearish Divergence Detected</span>
          <span className="cp-rsi-warn-body">{rsiDivNote}</span>
          <span className="cp-rsi-warn-imp">
            This is a classic distribution signal — price making new highs while momentum weakens.
            Tighten stops on existing positions. Do not initiate new long trades.
          </span>
        </div>
      )}
      {rsiBullDiv && (
        <div className="cp-rsi-bull-div">
          <span className="cp-rsi-bull-title">⚡ RSI Bullish Divergence Detected</span>
          <span className="cp-rsi-bull-body">{rsiBullDivNote}</span>
          <span className="cp-rsi-bull-imp">
            This is the strongest early-cycle signal — institutional accumulation is absorbing supply
            at a level where retail is still selling. This is where the next markup leg originates.
            Watch for a weekly close above the 13W EMA to confirm the cycle turn.
          </span>
        </div>
      )}

      {/* ── Stats grid ── */}
      <div className="cp-stats">
        <div className="cp-stat">
          <span className="cp-stat-label">Cycle Low</span>
          <span className="cp-stat-val">{fmt(cycleLow)}</span>
          <span className="cp-stat-sub">{cycleDate ? fmtDate(cycleDate) : '—'}</span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-label">From Cycle Low</span>
          <span className={`cp-stat-val${pctFromCycLow >= 0 ? ' cp-green' : ' cp-red'}`}>
            {pctFromCycLow >= 0 ? '+' : ''}{pctFromCycLow}%
          </span>
          <span className="cp-stat-sub">current vs trough</span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-label">Cycle Peak</span>
          <span className="cp-stat-val">{peakClose ? fmt(peakClose) : '—'}</span>
          <span className="cp-stat-sub">
            {weeksAtPeak != null ? `Week ${weeksAtPeak}` : 'not yet in'}
          </span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-label">From Peak</span>
          <span className={`cp-stat-val${pctFromPeak == null ? '' : pctFromPeak >= 0 ? ' cp-green' : ' cp-red'}`}>
            {pctFromPeak != null ? `${pctFromPeak >= 0 ? '+' : ''}${pctFromPeak}%` : '—'}
          </span>
          <span className="cp-stat-sub">current vs cycle high</span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-label">Weekly RSI</span>
          <span className={`cp-stat-val${currentRSI >= 60 ? ' cp-green' : currentRSI <= 40 ? ' cp-red' : ' cp-neutral'}`}>
            {currentRSI.toFixed(1)}
          </span>
          <span className="cp-stat-sub">
            {currentRSI >= 70 ? 'Overbought' : currentRSI <= 30 ? 'Oversold' : currentRSI >= 55 ? 'Bullish' : currentRSI <= 45 ? 'Bearish' : 'Neutral'}
          </span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-label">13W EMA</span>
          <span className={`cp-stat-val${!priceBelowEMA13 ? ' cp-green' : ' cp-red'}`}>
            {fmt(currentEMA13)}
          </span>
          <span className="cp-stat-sub">
            Price {priceBelowEMA13 ? 'below ↓' : 'above ↑'}
          </span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-label">26W EMA</span>
          <span className={`cp-stat-val${currentClose >= currentEMA26 ? ' cp-green' : ' cp-red'}`}>
            {fmt(currentEMA26)}
          </span>
          <span className="cp-stat-sub">
            Price {currentClose < currentEMA26 ? 'below ↓' : 'above ↑'}
          </span>
        </div>
        <div className="cp-stat">
          <span className="cp-stat-label">52W Position</span>
          <span className="cp-stat-val cp-neutral">{w52Pct}%</span>
          <span className="cp-stat-sub">
            {fmt(w52Low)} — {fmt(w52High)}
          </span>
        </div>
      </div>

      {/* ── Phase guidance ── */}
      <div className="cp-guidance" style={{ borderColor: phaseColor }}>
        <div className="cp-guidance-eyebrow" style={{ color: phaseColor }}>What this means for your trades</div>
        <div className="cp-guidance-body">{phaseHint}</div>
      </div>

      {/* ── All four phases explained ── */}
      <div className="cp-phases-wrap">
        <div className="cp-phases-title">How to Read the Cycle</div>
        <div className="cp-phases">
          {[
            {
              id: 'ACCUMULATION',
              label: 'Accumulation',
              color: '#d97706',
              weeks: 'Weeks 0–4',
              desc: 'Price near the cycle low. RSI recovering from below 50. Institutional buyers are entering quietly. Volume may be light but the selling pressure has exhausted. This is the highest risk-to-reward entry window — before the crowd arrives.',
            },
            {
              id: 'MARKUP',
              label: 'Markup',
              color: '#10b981',
              weeks: 'Weeks 4–17',
              desc: 'Price is above the 13-week EMA and trending. RSI is 50+. Momentum is confirmed. This is the window where your confluence signals fire with the most validity. Enter on A+ and A grade setups, hold through the grade-adaptive exit.',
            },
            {
              id: 'DISTRIBUTION',
              label: 'Distribution',
              color: '#f97316',
              weeks: 'Weeks 17–22',
              desc: 'The cycle is maturing. Price may still be making new highs, but RSI divergence or weakening breadth signals a top forming. Smart money is selling into strength here. Tighten stops, take partial profits, and do not add new longs.',
            },
            {
              id: 'MARKDOWN',
              label: 'Markdown',
              color: '#ef4444',
              weeks: 'Weeks 22–26+',
              desc: 'Price has broken below the 13-week EMA. RSI is sub-50. The cycle has turned. Calls are now low-probability trades. Patience — the next Accumulation phase is coming. The cycle always repeats.',
            },
          ].map(p => (
            <div key={p.id} className={`cp-phase-card${phase === p.id ? ' cp-phase-card-active' : ''}`} style={{ borderColor: phase === p.id ? p.color : undefined }}>
              <div className="cp-phase-card-hdr">
                <span className="cp-phase-card-dot" style={{ background: p.color }} />
                <span className="cp-phase-card-name" style={{ color: phase === p.id ? p.color : undefined }}>{p.label}</span>
                <span className="cp-phase-card-weeks">{p.weeks}</span>
              </div>
              <p className="cp-phase-card-desc">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Cycle rule ── */}
      <div className="cp-rule">
        <span className="cp-rule-icon">⚡</span>
        <span className="cp-rule-text">
          The cycle is your entry and exit context — not a standalone signal. A CALL signal fired in Markup carries full weight. The same signal fired in Distribution carries reduced weight. In Markdown, wait for the next Accumulation phase before buying calls.
        </span>
      </div>
    </div>
  )
}
