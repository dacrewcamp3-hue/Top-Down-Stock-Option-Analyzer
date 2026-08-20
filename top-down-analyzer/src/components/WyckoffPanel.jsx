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
        <span style={{ color }}>
          {pct.toFixed(1)}% buying pressure
        </span>
        <span style={{ color: '#10b981', fontWeight: 700 }}>All Buying</span>
      </div>
    </div>
  )
}

/* ─── Phase map chips ─────────────────────────────────────────────────────── */
const ACCUM_SEQUENCE = [
  { id: 'phase-a',      label: 'Phase A' },
  { id: 'sc-ar',        label: 'SC / AR' },
  { id: 'secondary-test', label: 'ST' },
  { id: 'SPRING',       label: 'Spring' },
  { id: 'sos',          label: 'SOS' },
  { id: 'lps',          label: 'LPS' },
  { id: 'MARKUP',       label: 'Markup' },
]

const DISTRIB_SEQUENCE = [
  { id: 'phase-a',      label: 'Phase A' },
  { id: 'bc-ar',        label: 'BC / AR' },
  { id: 'secondary-test', label: 'ST' },
  { id: 'UTAD',         label: 'UTAD' },
  { id: 'sow',          label: 'SOW' },
  { id: 'lpsy',         label: 'LPSY' },
  { id: 'MARKDOWN',     label: 'Markdown' },
]

// Map detected phase names → the chip ID they correspond to in the sequence
const PHASE_TO_CHIP = {
  MARKUP:       'MARKUP',
  MARKDOWN:     'MARKDOWN',
  SPRING:       'SPRING',
  UTAD:         'UTAD',
  ACCUMULATION: 'phase-a',   // detected accumulation = Phase A/B of the Wyckoff scheme
  DISTRIBUTION: 'phase-a',   // detected distribution = Phase A/B of the distribution scheme
  RANGING:      null,         // no active step — waiting for phase to develop
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

/* ═══════════════════════════════════════════════════════════════════════════
   Main component
   ═══════════════════════════════════════════════════════════════════════════ */
export default function WyckoffPanel({ wyckoff, ticker }) {
  /* ── Empty state ── */
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
    potentialMoveUp, potentialMoveDown,
    currentClose,
    currentVolRatio,
    avgVol,
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
          <span className="wy-eyebrow" data-tip="Wyckoff Method: A 100-year-old institutional trading framework developed by Richard Wyckoff. It maps how 'smart money' (institutions) accumulate or distribute large positions in trading ranges, then engineer breakouts. The four key phases: Accumulation (institutions quietly buying) → Markup (price rises) → Distribution (institutions selling) → Markdown (price falls).">WYCKOFF PHASE ANALYSIS</span>
          <span className="wy-phase-name" style={{ color }}>
            {phase}
            {ticker ? <span className="wy-ticker-suffix"> — {ticker}</span> : null}
          </span>
        </div>
        <div className="wy-badges">
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
        <div className="wy-card-title" data-tip="Trading Range: The horizontal consolidation zone where price has been bouncing between a support low and a resistance high. Wyckoff theory says institutions use this range to quietly accumulate or distribute large positions without moving price too far. The wider the range and longer it lasts, the more 'cause' is built — and the larger the eventual move when price breaks out.">TRADING RANGE</div>
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
        </div>
        <RangeBar rangeHigh={rangeHigh} rangeLow={rangeLow} currentClose={currentClose} />
      </div>

      {/* ── Spring card ── */}
      {spring && (
        <div className="wy-spring-card">
          <div className="wy-spring-title" data-tip="Spring: The highest-confidence long entry in the Wyckoff method. Price briefly violated the trading range's support low (flushing out weak holders), then reversed and closed back ABOVE it — rejecting the breakdown. This 'shakeout' absorbs the final selling pressure. Low volume on the violation is ideal: it means sellers couldn't press their advantage, supply is exhausted. The Spring often precedes Markup.">FALSE BREAKDOWN DETECTED — SPRING</div>
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
              <span className="wy-eg-label">Recovered To (close)</span>
              <span className="wy-eg-val wy-gold">{fmt(spring.recoveredTo)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Volume Ratio vs Avg</span>
              <span className={`wy-eg-val${spring.isLowVolume ? ' wy-gold' : ''}`}>
                {spring.volRatio}x
                {spring.isLowVolume ? ' — LOW VOL (ideal)' : ' — WATCH'}
              </span>
            </div>
          </div>
          <div className="wy-event-note wy-event-note-bull">
            Buy action: Enter at or near the recovery close. Stop below the spring low at {fmt(spring.low)}.
            A low-volume spring is the highest-quality Wyckoff long entry.
          </div>
        </div>
      )}

      {/* ── UTAD card ── */}
      {utad && (
        <div className="wy-utad-card">
          <div className="wy-utad-title" data-tip="UTAD (Upthrust After Distribution): The distribution analog of the Spring — and the highest-confidence short entry in Wyckoff. Price spiked above the trading range's resistance high (triggering breakout buyers), then reversed and closed back BELOW it — a bull trap. The failed breakout absorbs the last remaining buying pressure. High volume on the spike confirms that supply overwhelmed demand. A UTAD often precedes Markdown.">FALSE BREAKOUT DETECTED — UTAD</div>
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
              <span className="wy-eg-label">Failed At (close)</span>
              <span className="wy-eg-val wy-red">{fmt(utad.failedAt)}</span>
            </div>
            <div className="wy-eg-row">
              <span className="wy-eg-label">Volume Ratio vs Avg</span>
              <span className={`wy-eg-val${utad.isHighVolume ? ' wy-red' : ''}`}>
                {utad.volRatio}x
                {utad.isHighVolume ? ' — HIGH VOL (confirmed rejection)' : ' — WATCH'}
              </span>
            </div>
          </div>
          <div className="wy-event-note wy-event-note-bear">
            Sell action: Enter puts or bear spreads at or near the failure close. Stop above the UTAD high at {fmt(utad.high)}.
            A high-volume rejection is the highest-quality Wyckoff short entry.
          </div>
        </div>
      )}

      {/* ── Cause & Effect ── */}
      <div className="wy-card">
        <div className="wy-card-title">CAUSE &amp; EFFECT — PROJECTED MOVE</div>
        <p className="wy-ce-intro">
          Wyckoff projects the next move based on the width of the trading range.
          The wider the base or top, the larger the expected move.
        </p>
        <div className="wy-ce-targets">
          {(signal === 'BULLISH' || signal === 'NEUTRAL') && (
            <div className="wy-ce-row wy-ce-bull">
              <div className="wy-ce-dir">UPSIDE TARGET</div>
              <div className="wy-ce-price wy-green">{fmt(potentialMoveUp)}</div>
              <div className="wy-ce-pct wy-green">
                {upPct != null ? fmtPct(upPct) : '—'} from current
              </div>
              <div className="wy-ce-formula">
                rangeHigh ({fmt(rangeHigh)}) + range × 1.5 ({fmt(rangeSize * 1.5)})
              </div>
            </div>
          )}
          {(signal === 'BEARISH' || signal === 'NEUTRAL') && (
            <div className="wy-ce-row wy-ce-bear">
              <div className="wy-ce-dir">DOWNSIDE TARGET</div>
              <div className="wy-ce-price wy-red">{fmt(potentialMoveDown)}</div>
              <div className="wy-ce-pct wy-red">
                {downPct != null ? fmtPct(downPct) : '—'} from current
              </div>
              <div className="wy-ce-formula">
                rangeLow ({fmt(rangeLow)}) − range × 1.5 ({fmt(rangeSize * 1.5)})
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Volume Footprint ── */}
      <div className="wy-card">
        <div className="wy-card-title" data-tip="Volume Footprint: Wyckoff puts enormous importance on volume because institutions can't hide their activity in volume data. High volume on up bars = accumulation (buying). High volume on down bars = distribution (selling). Low volume on a test of support = Spring potential. This section shows where volume pressure is concentrated.">VOLUME FOOTPRINT</div>
        <div className="wy-vol-row">
          <div className="wy-vr">
            <span className="wy-vr-label">20-Bar Avg Volume</span>
            <span className="wy-vr-val">
              {avgVol >= 1_000_000
                ? `${(avgVol / 1_000_000).toFixed(1)}M`
                : avgVol >= 1_000
                ? `${(avgVol / 1_000).toFixed(0)}K`
                : avgVol?.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="wy-vr">
            <span className="wy-vr-label">Current Bar vs Avg</span>
            <span className={`wy-vr-val${currentVolRatio > 1.5 ? ' wy-green' : currentVolRatio > 1.2 ? ' wy-green' : currentVolRatio < 0.8 ? ' wy-red' : ''}`}>
              {currentVolRatio}×
              {currentVolRatio > 1.5 ? ' — SPIKE' : currentVolRatio > 1.2 ? ' — ELEVATED' : currentVolRatio < 0.8 ? ' — LOW' : ' — NORMAL'}
            </span>
          </div>
        </div>
        <div className="wy-pbar-label" data-tip="Buying Pressure: The percentage of total range volume that occurred on up-close bars (bars where the close was higher than the prior close). Above 55% = buyers are dominant — accumulation signature. Below 45% = sellers are dominant — distribution signature. This is the core Wyckoff volume analysis tool.">Buying Pressure</div>
        <PressureBar buyingPressure={buyingPressure} />
        <div className="wy-pbar-note">
          {buyingPressure > 0.55
            ? 'Majority of range volume occurred on up-close bars. Institutional accumulation signature.'
            : buyingPressure < 0.45
            ? 'Majority of range volume occurred on down-close bars. Institutional distribution signature.'
            : 'Volume split is roughly even between up and down bars. No dominant pressure detected.'}
        </div>
      </div>

      {/* ── Phase Map ── */}
      <div className="wy-card">
        <div className="wy-card-title" data-tip="Wyckoff Sequence: The typical order of events as institutions build or unwind a position. Accumulation: Phase A (selling climax) → SC/AR (supply absorbed) → Secondary Test → Spring (final shakeout) → SOS (sign of strength) → LPS (last point of support) → Markup. Distribution mirrors this in reverse, ending with a UTAD and Markdown. The highlighted chip shows the estimated current stage.">
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
