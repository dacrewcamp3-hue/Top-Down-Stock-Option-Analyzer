import './WyckoffPanel.css'

/* ─── Color helpers ──────────────────────────────────────────────────────── */
function signalColor(signal, phase) {
  if (phase === 'SPRING') return '#f59e0b'
  if (phase === 'UTAD')   return '#ef4444'
  if (signal === 'BULLISH') return '#10b981'
  if (signal === 'BEARISH') return '#ef4444'
  return '#6b7280'
}

function confidenceLabel(confidence) {
  if (confidence === 'high')   return 'HIGH CONFIDENCE'
  if (confidence === 'medium') return 'MEDIUM CONFIDENCE'
  return 'LOW CONFIDENCE'
}

function fmt(n) {
  if (n == null || !isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return `$${n.toFixed(2)}`
}

function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function pctChange(from, to) {
  if (!from || !to) return null
  return ((to - from) / from) * 100
}

function fmtVol(v) {
  if (v == null) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`
  return v.toLocaleString()
}

/* ─── Trading-range position bar ─────────────────────────────────────────── */
function RangeBar({ rangeHigh, rangeLow, currentClose }) {
  const clamped = Math.max(rangeLow, Math.min(rangeHigh, currentClose))
  const span    = rangeHigh - rangeLow
  const pct     = span > 0 ? ((clamped - rangeLow) / span) * 100 : 50

  return (
    <div className="wy-rangebar-wrap">
      <div className="wy-rangebar-track">
        <div className="wy-rangebar-fill" style={{ width: `${pct}%` }} />
        <div className="wy-rangebar-dot"  style={{ left: `${pct}%` }} />
      </div>
      <div className="wy-rangebar-labels">
        <span className="wy-rangebar-lo">{fmt(rangeLow)}</span>
        <span className="wy-rangebar-pos">{pct.toFixed(0)}% of range</span>
        <span className="wy-rangebar-hi">{fmt(rangeHigh)}</span>
      </div>
    </div>
  )
}

/* ─── Buying-pressure bar ─────────────────────────────────────────────────── */
function PressureBar({ buyingPressure }) {
  const pct   = Math.max(0, Math.min(100, buyingPressure * 100))
  const color = pct > 55 ? '#10b981' : pct < 45 ? '#ef4444' : '#6b7280'

  return (
    <div className="wy-pbar-wrap">
      <div className="wy-pbar-track">
        <div className="wy-pbar-fill" style={{ width: `${pct}%`, background: color }} />
        <div className="wy-pbar-midline" />
      </div>
      <div className="wy-pbar-labels">
        <span style={{ color: '#ef4444', fontWeight: 700 }}>All Selling</span>
        <span style={{ color }}>{pct.toFixed(1)}% buying pressure</span>
        <span style={{ color: '#10b981', fontWeight: 700 }}>All Buying</span>
      </div>
    </div>
  )
}

/* ─── Phase map chips ─────────────────────────────────────────────────────── */
const ACCUM_SEQUENCE = [
  { id: 'phase-a',        label: 'Phase A' },
  { id: 'sc-ar',          label: 'SC / AR' },
  { id: 'secondary-test', label: 'ST' },
  { id: 'SPRING',         label: 'Spring' },
  { id: 'sos',            label: 'SOS' },
  { id: 'lps',            label: 'LPS' },
  { id: 'MARKUP',         label: 'Markup' },
]

const DISTRIB_SEQUENCE = [
  { id: 'phase-a',        label: 'Phase A' },
  { id: 'bc-ar',          label: 'BC / AR' },
  { id: 'secondary-test', label: 'ST' },
  { id: 'UTAD',           label: 'UTAD' },
  { id: 'sow',            label: 'SOW' },
  { id: 'lpsy',           label: 'LPSY' },
  { id: 'MARKDOWN',       label: 'Markdown' },
]

const PHASE_TO_CHIP = {
  MARKUP:       'MARKUP',
  MARKDOWN:     'MARKDOWN',
  SPRING:       'SPRING',
  UTAD:         'UTAD',
  ACCUMULATION: 'phase-a',
  DISTRIBUTION: 'phase-a',
  RANGING:      null,
}

function PhaseMap({ phase, signal }) {
  const isBearish  = signal === 'BEARISH'
  const sequence   = isBearish ? DISTRIB_SEQUENCE : ACCUM_SEQUENCE
  const color      = signalColor(signal, phase)
  const activeChip = PHASE_TO_CHIP[phase] ?? null

  return (
    <div className="wy-phasemap">
      {sequence.map((step, idx) => {
        const isActive = activeChip != null && step.id === activeChip
        return (
          <div key={step.id} className="wy-phasemap-row">
            <div
              className={`wy-chip${isActive ? ' wy-chip-active' : ''}`}
              style={isActive ? { borderColor: color, color } : {}}
            >
              {step.label}
            </div>
            {idx < sequence.length - 1 && (
              <div className="wy-phasemap-arrow">→</div>
            )}
          </div>
        )
      })}
      {activeChip == null && (
        <div className="wy-phasemap-waiting">
          No dominant phase yet — waiting for a Spring, UTAD, or breakout to define direction.
        </div>
      )}
    </div>
  )
}

/* ─── Trading rules per phase ─────────────────────────────────────────────── */
const TRADING_RULES = {
  MARKUP: {
    color: '#10b981',
    rule: 'Breakout confirmed above the trading range. Trend-following entries are valid. Buy calls or long debit spreads. Use the former range high as your support reference. Trail stops as price extends.',
  },
  MARKDOWN: {
    color: '#ef4444',
    rule: 'Breakdown confirmed below the trading range. Do not buy calls. Trade puts, bear call spreads, or go to cash. The path of least resistance is lower until a new accumulation range forms.',
  },
  SPRING: {
    color: '#f59e0b',
    rule: 'Spring confirmed — this is the entry. Buy at the close of the spring bar or on the first pullback to range low. Stop below the spring low. Target: range high and beyond.',
  },
  UTAD: {
    color: '#ef4444',
    rule: 'UTAD confirmed — this is the short entry. Sell at the close of the UTAD bar or on the first rally back to range high. Stop above the UTAD high. Target: range low and below.',
  },
  ACCUMULATION: {
    color: '#10b981',
    rule: 'Accumulation in progress. Stage in cautiously — small call positions or long stock near range low with stops below. Wait for a Spring or a breakout above range high before adding full size.',
  },
  DISTRIBUTION: {
    color: '#ef4444',
    rule: 'Distribution in progress. Reduce or eliminate long exposure. Avoid new call positions. Stage small put positions near range high. Wait for a UTAD or breakdown below range low to go full size.',
  },
  RANGING: {
    color: '#6b7280',
    rule: 'No clear phase yet. The market is balanced. Preserve capital and wait for a Spring, UTAD, or confirmed directional break before initiating a trade. Patience is the edge here.',
  },
}

/* ─── Trend Context Pill ─────────────────────────────────────────────────── */
function TrendPill({ trendContext }) {
  const cfg = {
    UPTREND:   { color: '#10b981', bg: '#00150a', border: '#064e2e', label: '↑ UPTREND' },
    DOWNTREND: { color: '#ef4444', bg: '#150000', border: '#6b0000', label: '↓ DOWNTREND' },
    NEUTRAL:   { color: '#6b7280', bg: '#0f1623', border: '#1e2d45', label: '→ NEUTRAL' },
  }
  const { color, bg, border, label } = cfg[trendContext] ?? cfg.NEUTRAL
  return (
    <span
      className="wy-trend-pill"
      style={{ color, background: bg, borderColor: border }}
      title="50-EMA slope on daily closes. Spring/UTAD confidence is boosted when trend context aligns."
    >
      {label}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════════════════════════════ */
export default function WyckoffPanel({ wyckoff, ticker }) {
  if (!wyckoff) {
    return (
      <div className="wy-empty">
        Load a ticker to see Wyckoff phase analysis.
      </div>
    )
  }

  const {
    phase, signal, confidence, description,
    rangeHigh, rangeLow, rangeSize,
    buyingPressure,
    spring, utad,
    sellingClimax, buyingClimax,
    lpsZone,
    trendContext,
    volContracting, volContraction,
    rangeTouches, rangeDuration, rangeQuality,
    targets,
    potentialMoveUp, potentialMoveDown,
    currentClose,
    currentVolRatio,
    avgVol,
    atr,
  } = wyckoff

  const color = signalColor(signal, phase)
  const rule  = TRADING_RULES[phase] ?? TRADING_RULES.RANGING

  const upPct   = pctChange(currentClose, potentialMoveUp)
  const downPct = pctChange(currentClose, potentialMoveDown)

  return (
    <div className="wy-root">

      {/* ── Header ── */}
      <div className="wy-header">
        <div className="wy-header-left">
          <span className="wy-eyebrow" data-tip="Wyckoff Method: A 100-year-old institutional trading framework. It maps how 'smart money' accumulate or distribute large positions in trading ranges, then engineer breakouts.">WYCKOFF PHASE ANALYSIS</span>
          <span className="wy-phase-name" style={{ color }}>
            {phase}
            {ticker ? <span className="wy-ticker-suffix"> — {ticker}</span> : null}
          </span>
        </div>
        <div className="wy-badges">
          <TrendPill trendContext={trendContext ?? 'NEUTRAL'} />
          <span
            className="wy-signal-badge"
            style={{ background: `${color}22`, color, borderColor: `${color}55` }}
          >
            {signal}
          </span>
          <span className="wy-conf-badge">
            {confidenceLabel(confidence)}
          </span>
        </div>
      </div>

      {/* ── Phase description ── */}
      <div className="wy-desc-card" style={{ borderLeftColor: color }}>
        <p className="wy-desc-text">{description}</p>
      </div>

      {/* ── Trading Range card ── */}
      <div className="wy-card">
        <div className="wy-card-title" data-tip="Trading Range: The horizontal consolidation zone detected via cluster analysis (not raw max/min). Earnings spikes and one-bar outliers are filtered out. Touch count shows how many times price tested each boundary.">TRADING RANGE</div>
        <div className="wy-range-stats">
          <div className="wy-rs">
            <span className="wy-rs-label">Range High</span>
            <span className="wy-rs-val wy-green">{fmt(rangeHigh)}</span>
          </div>
          <div className="wy-rs">
            <span className="wy-rs-label">Range Low</span>
            <span className="wy-rs-val wy-red">{fmt(rangeLow)}</span>
          </div>
          <div className="wy-rs">
            <span className="wy-rs-label">Range Size</span>
            <span className="wy-rs-val">{fmt(rangeSize)}</span>
          </div>
          <div className="wy-rs">
            <span className="wy-rs-label">Current Close</span>
            <span className="wy-rs-val" style={{ color }}>{fmt(currentClose)}</span>
          </div>
          <div className="wy-rs">
            <span className="wy-rs-label">Duration (bars)</span>
            <span className="wy-rs-val">{rangeDuration}</span>
          </div>
          <div className="wy-rs">
            <span className="wy-rs-label">Boundary Touches</span>
            <span className="wy-rs-val">{rangeTouches}</span>
          </div>
          <div className="wy-rs">
            <span className="wy-rs-label">Range Quality</span>
            <span className="wy-rs-val" style={{ color: rangeQuality > 0.6 ? '#10b981' : rangeQuality > 0.3 ? '#f59e0b' : '#ef4444' }}>
              {(rangeQuality * 100).toFixed(0)}%
            </span>
          </div>
          {atr != null && (
            <div className="wy-rs">
              <span className="wy-rs-label">ATR</span>
              <span className="wy-rs-val">{fmt(atr)}</span>
            </div>
          )}
        </div>
        <RangeBar rangeHigh={rangeHigh} rangeLow={rangeLow} currentClose={currentClose} />
      </div>

      {/* ── Phase A: SC/BC cards ── */}
      {sellingClimax && (
        <div className="wy-sc-card">
          <div className="wy-sc-title" data-tip="Selling Climax (SC): Phase A event. A panic-selling bar with 2× average volume, a wide range (>1.3× ATR), and a close in the bottom 30% of the bar. SC marks the exhaustion of supply — the last desperate sellers. It defines the bottom of the potential accumulation range.">
            PHASE A EVENT — SELLING CLIMAX (SC)
          </div>
          <div className="wy-event-grid">
            <div className="wy-eg-row">
              <span className="wy-eg-label">SC Low (supply climax)</span>
              <span className="wy-eg-val wy-red">{fmt(sellingClimax.low)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">SC High</span>
              <span className="wy-eg-val">{fmt(sellingClimax.high)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">SC Close (weak bar)</span>
              <span className="wy-eg-val wy-gold">{fmt(sellingClimax.close)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Volume Ratio vs Avg</span>
              <span className="wy-eg-val wy-red">{sellingClimax.volRatio}× — CLIMAX VOLUME</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Close Position in Bar</span>
              <span className="wy-eg-val">{(sellingClimax.closePos * 100).toFixed(0)}% from low (supply dominant)</span>
            </div>
          </div>
          <div className="wy-event-note wy-event-note-neutral">
            SC detected: peak panic selling visible in the range. This defines Phase A — the floor where smart money begins absorbing supply.
          </div>
        </div>
      )}

      {buyingClimax && (
        <div className="wy-bc-card">
          <div className="wy-bc-title" data-tip="Buying Climax (BC): Phase A event in a distribution range. A euphoric buying bar with 2× average volume, wide range (>1.3× ATR), and a close in the top 70%+ of the bar. BC marks the exhaustion of demand — the last desperate buyers chasing price. It defines the ceiling of the distribution range.">
            PHASE A EVENT — BUYING CLIMAX (BC)
          </div>
          <div className="wy-event-grid">
            <div className="wy-eg-row">
              <span className="wy-eg-label">BC High (demand climax)</span>
              <span className="wy-eg-val wy-green">{fmt(buyingClimax.high)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">BC Low</span>
              <span className="wy-eg-val">{fmt(buyingClimax.low)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">BC Close (strong bar)</span>
              <span className="wy-eg-val wy-gold">{fmt(buyingClimax.close)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Volume Ratio vs Avg</span>
              <span className="wy-eg-val wy-green">{buyingClimax.volRatio}× — CLIMAX VOLUME</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Close Position in Bar</span>
              <span className="wy-eg-val">{(buyingClimax.closePos * 100).toFixed(0)}% from low (demand dominant)</span>
            </div>
          </div>
          <div className="wy-event-note wy-event-note-bear">
            BC detected: peak euphoric buying visible in the range. This defines Phase A — the ceiling where smart money begins distributing supply into demand.
          </div>
        </div>
      )}

      {/* ── Spring card ── */}
      {spring && (
        <div className="wy-spring-card">
          <div className="wy-spring-title" data-tip="Spring: The highest-confidence long entry in the Wyckoff method. Price briefly violated the trading range's support low then reversed and closed back above it. Quality filters: penetration limited to 30% of range size, next-bar confirmation tracked.">
            FALSE BREAKDOWN DETECTED — SPRING
          </div>
          <div className="wy-event-grid">
            <div className="wy-eg-row">
              <span className="wy-eg-label">Range Low (support)</span>
              <span className="wy-eg-val">{fmt(spring.rangeLow)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Spring Low (penetration)</span>
              <span className="wy-eg-val wy-red">{fmt(spring.low)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Penetration Depth</span>
              <span className="wy-eg-val">{fmt(spring.penetration)} ({((spring.penetration / (rangeSize || 1)) * 100).toFixed(0)}% of range)</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Recovered To (close)</span>
              <span className="wy-eg-val wy-gold">{fmt(spring.recoveredTo)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Volume Ratio vs Avg</span>
              <span className={`wy-eg-val${spring.isLowVolume ? ' wy-gold' : ''}`}>
                {spring.volRatio}×{spring.isLowVolume ? ' — LOW VOL (ideal)' : ' — WATCH'}
              </span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Next-Bar Confirmation</span>
              <span className={`wy-eg-val${spring.confirmed ? ' wy-green' : ' wy-red'}`}>
                {spring.confirmed ? '✓ CONFIRMED — next bar closed higher' : '✗ UNCONFIRMED — wait for follow-through'}
              </span>
            </div>
          </div>
          <div className="wy-event-note wy-event-note-bull">
            Buy action: Enter at or near the recovery close. Stop below the spring low at {fmt(spring.low)}.
            {spring.confirmed ? ' Confirmation received — full-size entry valid.' : ' Wait for a high-volume up bar before entering.'}
          </div>
        </div>
      )}

      {/* ── UTAD card ── */}
      {utad && (
        <div className="wy-utad-card">
          <div className="wy-utad-title" data-tip="UTAD (Upthrust After Distribution): Price spiked above the trading range's resistance high then reversed back inside. Quality filters: penetration limited to 30% of range size, next-bar confirmation tracked.">
            FALSE BREAKOUT DETECTED — UTAD
          </div>
          <div className="wy-event-grid">
            <div className="wy-eg-row">
              <span className="wy-eg-label">Range High (resistance)</span>
              <span className="wy-eg-val">{fmt(utad.rangeHigh)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">UTAD High (penetration)</span>
              <span className="wy-eg-val wy-green">{fmt(utad.high)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Penetration Depth</span>
              <span className="wy-eg-val">{fmt(utad.penetration)} ({((utad.penetration / (rangeSize || 1)) * 100).toFixed(0)}% of range)</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Failed At (close)</span>
              <span className="wy-eg-val wy-red">{fmt(utad.failedAt)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Volume Ratio vs Avg</span>
              <span className={`wy-eg-val${utad.isHighVolume ? ' wy-red' : ''}`}>
                {utad.volRatio}×{utad.isHighVolume ? ' — HIGH VOL (confirmed rejection)' : ' — WATCH'}
              </span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Next-Bar Confirmation</span>
              <span className={`wy-eg-val${utad.confirmed ? ' wy-red' : ' wy-gold'}`}>
                {utad.confirmed ? '✓ CONFIRMED — next bar closed lower' : '✗ UNCONFIRMED — wait for follow-through'}
              </span>
            </div>
          </div>
          <div className="wy-event-note wy-event-note-bear">
            Sell action: Enter puts or bear spreads at or near the failure close. Stop above the UTAD high at {fmt(utad.high)}.
            {utad.confirmed ? ' Confirmation received — full-size short valid.' : ' Wait for a high-volume down bar before entering.'}
          </div>
        </div>
      )}

      {/* ── LPS Zone (post-MARKUP) ── */}
      {lpsZone && (
        <div className="wy-lps-card">
          <div className="wy-lps-title" data-tip="LPS (Last Point of Support): After a markup breakout, price often pulls back toward the former range high — now acting as support. This pullback-to-support is the re-entry opportunity on the right side of the move.">
            LPS RE-ENTRY ZONE DETECTED
          </div>
          <div className="wy-event-grid">
            <div className="wy-eg-row">
              <span className="wy-eg-label">Former Range High (now support)</span>
              <span className="wy-eg-val wy-green">{fmt(lpsZone.support)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Recent Pullback Low</span>
              <span className="wy-eg-val wy-gold">{fmt(lpsZone.low)}</span>
            </div>
          </div>
          <div className="wy-event-note wy-event-note-bull">
            {lpsZone.note}. Add calls or long entries on the bounce from this level. Stop below {fmt(lpsZone.support)}.
          </div>
        </div>
      )}

      {/* ── Cause & Effect — Multi-tier ── */}
      <div className="wy-card">
        <div className="wy-card-title">CAUSE &amp; EFFECT — PROJECTED TARGETS</div>
        <p className="wy-ce-intro">
          Three-tier targets: T1 = ATR×3 (conservative), T2 = range×1.0 (standard), T3 = range×1.5 (extended).
          {targets?.upHVN || targets?.downHVN ? ' HVN = High Volume Node from price profile (natural friction point).' : ''}
        </p>
        {(signal === 'BULLISH' || signal === 'NEUTRAL') && targets && (
          <div className="wy-ce-targets">
            <div className="wy-ce-row wy-ce-bull">
              <div className="wy-ce-tier-grid">
                <div className="wy-ce-tier">
                  <span className="wy-ce-tier-lbl">T1 (ATR×3)</span>
                  <span className="wy-ce-tier-price wy-green">{fmt(targets.upT1)}</span>
                  <span className="wy-ce-tier-pct wy-green">{fmtPct(pctChange(currentClose, targets.upT1))}</span>
                </div>
                <div className="wy-ce-tier">
                  <span className="wy-ce-tier-lbl">T2 (range×1.0)</span>
                  <span className="wy-ce-tier-price wy-green">{fmt(targets.upT2)}</span>
                  <span className="wy-ce-tier-pct wy-green">{fmtPct(pctChange(currentClose, targets.upT2))}</span>
                </div>
                <div className="wy-ce-tier">
                  <span className="wy-ce-tier-lbl">T3 (range×1.5)</span>
                  <span className="wy-ce-tier-price wy-green">{fmt(targets.upT3)}</span>
                  <span className="wy-ce-tier-pct wy-green">{fmtPct(pctChange(currentClose, targets.upT3))}</span>
                </div>
                {targets.upHVN && (
                  <div className="wy-ce-tier wy-ce-hvn">
                    <span className="wy-ce-tier-lbl">HVN (resistance)</span>
                    <span className="wy-ce-tier-price wy-gold">{fmt(targets.upHVN)}</span>
                    <span className="wy-ce-tier-pct wy-gold">{fmtPct(pctChange(currentClose, targets.upHVN))}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {(signal === 'BEARISH' || signal === 'NEUTRAL') && targets && (
          <div className="wy-ce-targets">
            <div className="wy-ce-row wy-ce-bear">
              <div className="wy-ce-tier-grid">
                <div className="wy-ce-tier">
                  <span className="wy-ce-tier-lbl">T1 (ATR×3)</span>
                  <span className="wy-ce-tier-price wy-red">{fmt(targets.downT1)}</span>
                  <span className="wy-ce-tier-pct wy-red">{fmtPct(pctChange(currentClose, targets.downT1))}</span>
                </div>
                <div className="wy-ce-tier">
                  <span className="wy-ce-tier-lbl">T2 (range×1.0)</span>
                  <span className="wy-ce-tier-price wy-red">{fmt(targets.downT2)}</span>
                  <span className="wy-ce-tier-pct wy-red">{fmtPct(pctChange(currentClose, targets.downT2))}</span>
                </div>
                <div className="wy-ce-tier">
                  <span className="wy-ce-tier-lbl">T3 (range×1.5)</span>
                  <span className="wy-ce-tier-price wy-red">{fmt(targets.downT3)}</span>
                  <span className="wy-ce-tier-pct wy-red">{fmtPct(pctChange(currentClose, targets.downT3))}</span>
                </div>
                {targets.downHVN && (
                  <div className="wy-ce-tier wy-ce-hvn">
                    <span className="wy-ce-tier-lbl">HVN (support)</span>
                    <span className="wy-ce-tier-price wy-gold">{fmt(targets.downHVN)}</span>
                    <span className="wy-ce-tier-pct wy-gold">{fmtPct(pctChange(currentClose, targets.downHVN))}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Volume Footprint ── */}
      <div className="wy-card">
        <div className="wy-card-title" data-tip="Volume Footprint: Volume contraction (declining volume in second half of range vs first half) is a key Wyckoff sign that supply/demand is exhausting. Vol Contraction% shows how much volume has dried up.">VOLUME FOOTPRINT</div>
        <div className="wy-vol-row">
          <div className="wy-vr">
            <span className="wy-vr-label">Range Avg Volume</span>
            <span className="wy-vr-val">{fmtVol(avgVol)}</span>
          </div>
          <div className="wy-vr">
            <span className="wy-vr-label">Current Bar vs Avg</span>
            <span className={`wy-vr-val${currentVolRatio > 1.5 ? ' wy-green' : currentVolRatio > 1.2 ? ' wy-green' : currentVolRatio < 0.8 ? ' wy-red' : ''}`}>
              {currentVolRatio}×
              {currentVolRatio > 1.5 ? ' — SPIKE' : currentVolRatio > 1.2 ? ' — ELEVATED' : currentVolRatio < 0.8 ? ' — LOW' : ' — NORMAL'}
            </span>
          </div>
          <div className="wy-vr">
            <span className="wy-vr-label">Vol Contraction</span>
            <span className={`wy-vr-val${volContracting ? ' wy-gold' : ''}`}>
              {volContracting
                ? `${(volContraction * 100).toFixed(0)}% — DRYING UP ✓`
                : `${(Math.abs(volContraction) * 100).toFixed(0)}% ${volContraction < 0 ? 'expansion' : 'stable'}`}
            </span>
          </div>
        </div>
        <div className="wy-pbar-label" data-tip="Buying Pressure: Percentage of total range volume that occurred on up-close bars. Above 55% = buyers dominating (accumulation). Below 45% = sellers dominating (distribution).">Buying Pressure</div>
        <PressureBar buyingPressure={buyingPressure} />
        <div className="wy-pbar-note">
          {buyingPressure > 0.55
            ? 'Majority of range volume occurred on up-close bars. Institutional accumulation signature.'
            : buyingPressure < 0.45
            ? 'Majority of range volume occurred on down-close bars. Institutional distribution signature.'
            : 'Volume split is roughly even between up and down bars. No dominant pressure detected.'}
          {volContracting ? ' Volume is contracting — drying-up supply/demand consistent with phase completion.' : ''}
        </div>
      </div>

      {/* ── Phase Map ── */}
      <div className="wy-card">
        <div className="wy-card-title" data-tip="Wyckoff Sequence: The typical order of events as institutions build or unwind a position. The highlighted chip shows the estimated current stage.">
          {signal === 'BEARISH' ? 'DISTRIBUTION SEQUENCE' : 'ACCUMULATION SEQUENCE'}
        </div>
        <p className="wy-phasemap-intro">
          {signal === 'BEARISH'
            ? 'Wyckoff distribution unfolds from a buying climax through the UTAD to markdown.'
            : 'Wyckoff accumulation unfolds from a selling climax through the Spring to markup.'}
        </p>
        <PhaseMap phase={phase} signal={signal} />
      </div>

      {/* ── Trading Rule ── */}
      <div className="wy-rule" style={{ borderLeftColor: rule.color }}>
        <div className="wy-rule-label" style={{ color: rule.color }}>TRADING RULE</div>
        <div className="wy-rule-text" style={{ color: rule.color }}>{rule.rule}</div>
      </div>

    </div>
  )
}
