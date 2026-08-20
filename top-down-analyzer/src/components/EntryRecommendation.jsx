import { CALL_THRESHOLD, PUT_THRESHOLD } from '../utils/analyzeEntry'
import { useEmaNames } from '../utils/emaNames'
import './EntryRecommendation.css'

const SIGNAL_CLASS = { CALL: 'call', PUT: 'put', 'NO TRADE': 'no-trade' }

function fmt(price) {
  if (price == null || isNaN(price)) return '—'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── 5-Min OR Break & Retest ───────────────────────────────────────────────────
const ORB_CFG = {
  INSIDE:      { color: '#6b7280', bg: '#0f1623', border: '#1e2d45', icon: '○', label: 'Inside Opening Range',  sub: 'Price is between ORH and ORL — no break yet. Play moving averages: 8 EMA 2-bar cross-and-close on the 5M chart for intraday entries.' },
  BREAK:       { color: '#60a5fa', bg: '#0a1424', border: '#1e3a5f', icon: '→', label: 'OR Level Broken',       sub: 'ORH/ORL broken on 5M — wait for price to pull back and retest the broken level before entering.' },
  RETEST:      { color: '#f59e0b', bg: '#1a1000', border: '#92400e', icon: '◎', label: 'Retest in Progress',    sub: 'Price is touching the break level — this is the retest bar. Wait for the NEXT 5M bar to open AND close on the break side before entering.' },
  ENTER:       { color: '#10b981', bg: '#011c10', border: '#065f46', icon: '✓', label: 'BREAK & RETEST CONFIRMED', sub: 'Retest held — next 5M bar opened and closed above ORH (bull) or below ORL (bear). Take position or add to existing.' },
  RECAPTURED:  { color: '#34d399', bg: '#011c10', border: '#047857', icon: '↑', label: 'Level Recaptured',      sub: '15M bar reclosed above ORH (bull) / below ORL (bear) after a dip. Level is regained — valid re-entry or add to position.' },
  LOST:        { color: '#f59e0b', bg: '#1a1000', border: '#92400e', icon: '~', label: 'Level Lost',            sub: 'Both 5M and 15M closed back through the break level — setup is compromised. Wait for a recapture before adding.' },
  FAILED:      { color: '#ef4444', bg: '#1c0101', border: '#7f1d1d', icon: '✗', label: 'Retest Failed',         sub: 'Price collapsed back inside the opening range after the break — setup is invalid. Stand aside.' },
}

const EMA8_CFG = {
  bull:    { color: '#10b981', bg: '#011c10', border: '#065f46', icon: '↑', label: '2 Bars Above 8 EMA — Bull Entry', sub: 'Two consecutive 5-min bars closed above the 8 EMA — take the long' },
  bear:    { color: '#ef4444', bg: '#1c0101', border: '#7f1d1d', icon: '↓', label: '2 Bars Below 8 EMA — Bear Entry', sub: 'Two consecutive 5-min bars closed below the 8 EMA — take the short' },
  neutral: { color: '#f59e0b', bg: '#1a1000', border: '#92400e', icon: '◌', label: 'Cross Forming — Wait',            sub: 'Need 2 consecutive bars on the same side of the 8 EMA before entering' },
}

function OrbSteps({ signal }) {
  const breakDone   = ['BREAK', 'RETEST', 'ENTER', 'RECAPTURED', 'LOST'].includes(signal)
  const retestDone  = ['ENTER', 'RECAPTURED'].includes(signal)
  const retestFail  = signal === 'FAILED'
  const enterDone   = ['ENTER', 'RECAPTURED'].includes(signal)

  const stepCfg = (done, fail, active) => ({
    color: fail ? '#ef4444' : done ? '#10b981' : active ? '#f59e0b' : '#2a3d59',
    bg:    fail ? '#1c0101' : done ? '#011c10' : active ? '#1a1000' : 'transparent',
    bord:  fail ? '#7f1d1d' : done ? '#065f46' : active ? '#4d3000' : '#1e2d45',
    icon:  fail ? '✗' : done ? '✓' : '○',
  })

  const steps = [
    { label: 'BREAK',  ...stepCfg(breakDone,  false,      !breakDone) },
    { label: 'RETEST', ...stepCfg(retestDone, retestFail, breakDone && !retestDone && !retestFail) },
    { label: 'ENTER',  ...stepCfg(enterDone,  false,      retestDone && !enterDone) },
  ]

  return (
    <div className="orb-steps">
      {steps.map((s, i) => (
        <div key={s.label} className="orb-step-unit">
          {i > 0 && <div className="orb-step-connector" style={{ background: steps[i - 1].color === '#10b981' ? '#065f46' : '#1e2d45' }} />}
          <div className="orb-step" style={{ background: s.bg, borderColor: s.bord }}>
            <span className="orb-step-icon" style={{ color: s.color }}>{s.icon}</span>
            <span className="orb-step-label" style={{ color: s.color }}>{s.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function OrbRetestPanel({ data }) {
  const emaNames = useEmaNames()
  const e8n      = emaNames[8]
  const rawCfg   = ORB_CFG[data.signal] ?? ORB_CFG.INSIDE
  const cfg      = data.signal === 'INSIDE'
    ? { ...rawCfg, sub: `Price is between ORH and ORL — no break yet. Play moving averages: ${e8n} (EMA 8) 2-bar cross-and-close on the 5M chart for intraday entries.` }
    : rawCfg
  const isBull   = data.breakDir === 'bull'
  const isBear   = data.breakDir === 'bear'
  const isInside = data.signal === 'INSIDE'
  const pctSign  = data.pctFromLevel >= 0 ? '+' : ''
  const ema8Cfg  = isInside ? (EMA8_CFG[data.ema8Signal] ?? EMA8_CFG.neutral) : null

  return (
    <div className="orb-panel">
      <div className="orb-panel-title">15M Opening Range · 5M Break &amp; Retest</div>
      <div className="orb-panel-sub">Range set by the first 15M candle · entries timed on 5M</div>
      <OrbSteps signal={data.signal} />

      {/* OR levels — always shown */}
      <div className="orb-levels">
        <div className="orb-level-row">
          <span className="orb-level-lbl">OR High</span>
          <span className="orb-level-price">${fmt(data.orHigh)}</span>
          {isBull ? <span className="orb-level-tag bull">↑ break level</span>
                  : <span className="orb-level-tag neutral">bull target</span>}
        </div>
        <div className="orb-level-row">
          <span className="orb-level-lbl">OR Low</span>
          <span className="orb-level-price">${fmt(data.orLow)}</span>
          {isBear ? <span className="orb-level-tag bear">↓ break level</span>
                  : <span className="orb-level-tag neutral">bear target</span>}
        </div>
        <div className="orb-level-row orb-range-row">
          <span className="orb-level-lbl">OR Range</span>
          <span className="orb-level-price">${fmt(data.orHigh - data.orLow)}</span>
          <span className="orb-level-tag neutral">
            {(((data.orHigh - data.orLow) / data.orLow) * 100).toFixed(2)}% wide
          </span>
        </div>
      </div>

      {/* Status signal */}
      <div className="orb-signal" style={{ background: cfg.bg, borderColor: cfg.border }}>
        <span className="orb-signal-icon" style={{ color: cfg.color }}>{cfg.icon}</span>
        <div className="orb-signal-body">
          <span className="orb-signal-label" style={{ color: cfg.color }}>
            {data.breakDir ? `${isBull ? '↑ BULL' : '↓ BEAR'} · ` : ''}{cfg.label}
          </span>
          <span className="orb-signal-sub">{cfg.sub}</span>
        </div>
      </div>

      {/* Inside OR: play moving averages (8 EMA 2-bar cross-and-close) */}
      {isInside && ema8Cfg && (
        <>
          <div className="orb-section-label">Inside Range — Play Moving Averages</div>
          <div className="orb-signal" style={{ background: ema8Cfg.bg, borderColor: ema8Cfg.border }}>
            <span className="orb-signal-icon" style={{ color: ema8Cfg.color }}>{ema8Cfg.icon}</span>
            <div className="orb-signal-body">
              <span className="orb-signal-label" style={{ color: ema8Cfg.color }}>{ema8Cfg.label}</span>
              <span className="orb-signal-sub">{ema8Cfg.sub}</span>
            </div>
          </div>
        </>
      )}

      {/* Current price row */}
      {data.breakDir && (
        <div className="orb-current">
          <span className="orb-cur-lbl">Current</span>
          <span className="orb-cur-price">${fmt(data.lastClose)}</span>
          <span className="orb-cur-pct" style={{ color: cfg.color }}>
            {pctSign}{data.pctFromLevel}% {isBull ? 'above ORH' : 'below ORL'}
          </span>
        </div>
      )}
      {isInside && (
        <div className="orb-current">
          <span className="orb-cur-lbl">Current</span>
          <span className="orb-cur-price">${fmt(data.lastClose)}</span>
          <span className="orb-cur-pct" style={{ color: '#4a6380' }}>
            {data.pctFromHigh}% below ORH · {data.pctFromLow}% above ORL
          </span>
        </div>
      )}
    </div>
  )
}

// SVG arc from score s1 to s2 on a 0-100 gauge (left=0, top=50, right=100)
function arcPath(s1, s2, cx, cy, r) {
  if (s1 >= s2) return ''
  const angle = s => Math.PI - (s / 100) * Math.PI
  const pt    = s => ({
    x: (cx + r * Math.cos(angle(s))).toFixed(2),
    y: (cy - r * Math.sin(angle(s))).toFixed(2),
  })
  const p1 = pt(s1), p2 = pt(s2)
  const large = (s2 - s1) > 50 ? 1 : 0
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`
}

function Odometer({ score, signal }) {
  const cx = 100, cy = 104, r = 82, sw = 10

  const pt = s => {
    const a = Math.PI - (s / 100) * Math.PI
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) }
  }

  const needle   = pt(Math.max(0, Math.min(100, score)))
  const sigColor = signal === 'CALL' ? '#10b981' : signal === 'PUT' ? '#ef4444' : '#6b7280'
  const hasScore = score !== 50 || signal !== 'NO TRADE'

  const tickMark = s => {
    const a  = Math.PI - (s / 100) * Math.PI
    const r1 = r - sw / 2 - 2
    const r2 = r + sw / 2 + 2
    return {
      x1: (cx + r1 * Math.cos(a)).toFixed(2), y1: (cy - r1 * Math.sin(a)).toFixed(2),
      x2: (cx + r2 * Math.cos(a)).toFixed(2), y2: (cy - r2 * Math.sin(a)).toFixed(2),
    }
  }
  const t20 = tickMark(20)
  const t80 = tickMark(80)

  return (
    <div className="odometer-wrap">
      <svg viewBox="0 0 200 152" className="odometer-svg">

        {/* Zone backgrounds */}
        <path d={arcPath(0,  20, cx, cy, r)} fill="none" stroke="#2a0606" strokeWidth={sw} />
        <path d={arcPath(20, 40, cx, cy, r)} fill="none" stroke="#1a0808" strokeWidth={sw} />
        <path d={arcPath(40, 60, cx, cy, r)} fill="none" stroke="#0f1420" strokeWidth={sw} />
        <path d={arcPath(60, 80, cx, cy, r)} fill="none" stroke="#081a0c" strokeWidth={sw} />
        <path d={arcPath(80,100, cx, cy, r)} fill="none" stroke="#051e0a" strokeWidth={sw} />

        {/* Threshold marks (PUT=20, CALL=80) */}
        <line {...t20} stroke="#4a1a1a" strokeWidth="1.5" />
        <line {...t80} stroke="#0d3a1a" strokeWidth="1.5" />

        {/* Active fill up to current score */}
        {hasScore && score > 0 && (
          <path
            d={arcPath(0, Math.min(score, 100), cx, cy, r)}
            fill="none"
            stroke={sigColor}
            strokeWidth={sw - 3}
            strokeLinecap="round"
            opacity="0.9"
          />
        )}

        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={needle.x.toFixed(2)} y2={needle.y.toFixed(2)}
          stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="4.5" fill="#e2e8f0" />
        <circle cx={cx} cy={cy} r="2.5" fill="#0f1623" />

        {/* Zone labels */}
        <text x="6"   y="108" className="odo-zone-label bear">PUT</text>
        <text x="194" y="108" className="odo-zone-label bull" textAnchor="end">CALL</text>
        <text x="100" y="14"  className="odo-zone-label mid"  textAnchor="middle">50</text>

        {/* Threshold value labels */}
        <text x="30"  y="74"  className="odo-tick-label bear">20</text>
        <text x="170" y="74"  className="odo-tick-label bull" textAnchor="end">80</text>

        {/* Score — integrated inside the arc, below pivot */}
        <text
          x="100" y="130"
          textAnchor="middle"
          fontSize="34"
          fontWeight="900"
          letterSpacing="-1"
          fill={sigColor}
        >
          {Math.round(score)}
        </text>
        <text x="100" y="146" textAnchor="middle" fontSize="9" fontWeight="600" fill="#2a3d59">
          / 100
        </text>
      </svg>
    </div>
  )
}

function IVPanel({ data }) {
  const rankColor = data.ivRank >= 50 ? '#f59e0b' : '#60a5fa'
  return (
    <div className="iv-panel">
      <div className="iv-panel-title">Implied Volatility</div>
      <div className="iv-rows">
        <div className="iv-row">
          <span className="iv-lbl">ATM IV</span>
          <span className="iv-val">{data.atmIV}%</span>
        </div>
        {data.ivRank != null ? (
          <>
            <div className="iv-row">
              <span className="iv-lbl">IV Rank</span>
              <span className="iv-val" style={{ color: rankColor }}>{data.ivRank}</span>
              <div className="iv-bar-wrap">
                <div className="iv-bar" style={{ width: `${data.ivRank}%`, background: rankColor }} />
              </div>
            </div>
            {data.ivPct != null && (
              <div className="iv-row">
                <span className="iv-lbl">IV Pct</span>
                <span className="iv-val" style={{ color: rankColor }}>{data.ivPct}th</span>
              </div>
            )}
            <div className="iv-note">
              {data.ivRank >= 50
                ? 'IV elevated — selling premium has the edge'
                : 'IV compressed — buying premium has the edge'}
            </div>
          </>
        ) : (
          <div className="iv-row">
            <span className="iv-lbl">IV Rank</span>
            <span className="iv-pending">Building history ({data.samples}/5 days needed)</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Gate status pill ──────────────────────────────────────────────────────────
function GateRow({ weeklyGate, dailyGate, signal, swingResult, orbRetest, vwapSignal }) {
  if (signal === 'NO TRADE') return null
  if (!weeklyGate && !dailyGate) return null

  const emaNames = useEmaNames()
  const e8n      = emaNames[8]   // e.g. "Sister"
  const isCall   = signal === 'CALL'

  const cfg = {
    pass:    { color: '#10b981', icon: '✓', text: 'PASS'      },
    partial: { color: '#f59e0b', icon: '◑', text: 'FORMING'   },
    fail:    { color: '#ef4444', icon: '✗', text: 'BLOCKED'   },
    neutral: { color: '#3a5070', icon: '—', text: 'NO DATA'   },
  }

  // Gate 3 — Entry Trigger (mirrors GateLock in TradeBrief)
  // swingFull = 2-bar confirmed (LONG/EXIT). swingPartial = 1-bar WATCH in correct direction.
  const swingFull     = isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT'
  const swingPartial  = swingResult?.signal === 'WATCH' && (
    isCall ? swingResult?.lastBar === 'above' : swingResult?.lastBar === 'below'
  )
  const orbConfirmed  = ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
  const orbInProgress = ['BREAK', 'RETEST'].includes(orbRetest?.signal)
  const vwapCross     = isCall ? vwapSignal?.crossAbove === true : vwapSignal?.crossBelow === true
  const g3Full        = swingFull || orbConfirmed
  const g3Part        = !g3Full && (swingPartial || vwapCross || orbInProgress)
  const gate3         = g3Full ? 'pass' : g3Part ? 'partial' : 'neutral'

  const wCfg  = cfg[weeklyGate] ?? cfg.neutral
  const dCfg  = cfg[dailyGate]  ?? cfg.neutral
  const g3Cfg = cfg[gate3]

  const blocked = weeklyGate === 'fail' || dailyGate === 'fail'

  const g3Tip = g3Full
    ? (orbConfirmed
        ? `Gate 3: ORB ${orbRetest.signal === 'RECAPTURED' ? 'recaptured & confirmed' : 'break & retest confirmed (ENTER)'} — execute with defined risk.`
        : `Gate 3: 4H 2-bar ${e8n} (EMA 8) rule confirmed — entry signal active.`)
    : g3Part
      ? (orbInProgress
          ? (orbRetest?.signal === 'BREAK'
              ? 'Gate 3: ORB broken — wait for price to pull back and retest the level (RETEST → ENTER).'
              : 'Gate 3: ORB retest forming — wait for the next bar to open and close on the break side (ENTER signal).')
          : swingPartial
            ? `Gate 3: 4H 1-bar ${isCall ? 'above' : 'below'} ${e8n} (EMA 8) — wait for a second bar to close on the same side.`
            : 'Gate 3: VWAP 2-bar cross forming — watch for 4H bar confirm.')
      : `Gate 3: No entry trigger yet. Need 4H 2-bar ${e8n} (EMA 8) cross, confirmed ORB entry (ENTER signal), or VWAP 2-bar cross.`

  return (
    <div className={`rec-gate-row${blocked ? ' rec-gate-blocked' : ''}`}>
      <span className="rec-gate-item"
        data-tip="Gate 1 — Weekly Direction: The weekly chart must be net bullish (more bull signals than bear across all weekly fields). If blocked, the weekly is net bearish — you're trading against the largest institutional money flows. Skip the trade.">
        <span className="rec-gate-lbl">WEEKLY</span>
        <span style={{ color: wCfg.color }}>{wCfg.icon} {wCfg.text}</span>
      </span>
      <span className="rec-gate-sep">·</span>
      <span className="rec-gate-item"
        data-tip="Gate 2 — Daily Momentum: The daily chart must be net bullish (more daily bull signals than bear signals). Any combination of aligned daily indicators satisfies the gate — it is not individually gated on MACD, ADX, or EMA. Blocked = the daily is net against the signal direction.">
        <span className="rec-gate-lbl">DAILY</span>
        <span style={{ color: dCfg.color }}>{dCfg.icon} {dCfg.text}</span>
      </span>
      <span className="rec-gate-sep">·</span>
      <span className="rec-gate-item" data-tip={g3Tip}>
        <span className="rec-gate-lbl">ENTRY</span>
        <span style={{ color: g3Cfg.color }}>{g3Cfg.icon} {g3Cfg.text}</span>
      </span>
      {blocked && <span className="rec-gate-warn-text">— skip this trade</span>}
    </div>
  )
}

// ── Blocker / "what to watch" section ────────────────────────────────────────
function BlockerList({ topBlockers, signal, gateBlocked, targetDir }) {
  if (!topBlockers?.length) return null

  const heading = gateBlocked
    ? 'GATE — FIX FIRST'
    : signal !== 'NO TRADE'
    ? 'NEEDS TO CONFIRM'
    : 'WAITING ON'

  return (
    <div className="rec-blockers">
      <div className="rec-blockers-title">{heading}</div>
      <div className="rec-blockers-list">
        {topBlockers.map((b, i) => (
          <div key={i} className={`rec-blocker-item${b.against ? ' rec-blocker-against' : ''}`}>
            <span className="rec-blocker-tf">{b.tf}</span>
            <span className="rec-blocker-field">{b.field}</span>
            {b.against && (
              <span className="rec-blocker-dir">
                {b.current === 'bull' ? '▲' : '▼'}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="rec-blockers-sub">
        {gateBlocked
          ? 'Higher TF structure is against the signal — wait for directors to align'
          : signal !== 'NO TRADE'
          ? `These signals would push confidence higher toward ${signal}`
          : `Signals the ${targetDir === 'bull' ? 'bull' : 'bear'} side needs to fire`
        }
      </div>
    </div>
  )
}

function SignalExplainer({ signal, gateBlocked, weeklyGate, dailyGate, gate3, confluence, totalSignals, totalBull, totalBear }) {
  const emaNames = useEmaNames()
  const e8n      = emaNames[8]
  if (totalSignals === 0) return null

  if (gateBlocked) {
    const blockedTFs = [
      weeklyGate === 'fail' && 'Weekly',
      dailyGate  === 'fail' && 'Daily',
    ].filter(Boolean).join(' & ')
    return (
      <div className="rec-explainer rec-explainer-blocked">
        <span className="rec-explainer-head">What This Means</span>
        <span className="rec-explainer-body">
          The {blockedTFs} chart is pointing the wrong way. Even if shorter timeframes look good, trading against the big picture lowers your odds — wait for the directors to align first.
        </span>
      </div>
    )
  }

  const allGreen  = gate3 === 'pass'
  const g3Forming = gate3 === 'partial'

  if (signal === 'CALL') return (
    <div className="rec-explainer rec-explainer-bull">
      <span className="rec-explainer-head">
        {allGreen ? '✓ All Gates Green — Execute Now · CALL' : 'What This Means · CALL'}
      </span>
      <span className="rec-explainer-body">
        {Math.round(Math.abs(confluence) * 100)}% of signals point up across {totalSignals} timeframe{totalSignals !== 1 ? 's' : ''}.{' '}
        {allGreen
          ? 'All 3 gates are green. Size your position, confirm your stop, and execute. Buy CALL options — you profit when price moves higher.'
          : g3Forming
            ? `Gates 1 & 2 cleared. Gate 3 is forming — wait for 4H 2nd bar close above ${e8n} (EMA 8), confirmed ORB entry (ENTER signal), or VWAP 2-bar cross above before entering.`
            : `Buy CALL options — you profit when price moves higher. Wait for Gate 3: 4H 2-bar close above ${e8n} (EMA 8), confirmed ORB entry (ENTER signal), or VWAP 2-bar cross above.`}
      </span>
    </div>
  )

  if (signal === 'PUT') return (
    <div className="rec-explainer rec-explainer-bear">
      <span className="rec-explainer-head">
        {allGreen ? '✓ All Gates Green — Execute Now · PUT' : 'What This Means · PUT'}
      </span>
      <span className="rec-explainer-body">
        {Math.round(Math.abs(confluence) * 100)}% of signals point down across {totalSignals} timeframe{totalSignals !== 1 ? 's' : ''}.{' '}
        {allGreen
          ? 'All 3 gates are green. Size your position, confirm your stop, and execute. Buy PUT options — you profit when price moves lower.'
          : g3Forming
            ? `Gates 1 & 2 cleared. Gate 3 is forming — wait for 4H 2nd bar close below ${e8n} (EMA 8), confirmed ORB entry (ENTER signal), or VWAP 2-bar cross below before entering.`
            : `Buy PUT options — you profit when price moves lower. Wait for Gate 3: 4H 2-bar close below ${e8n} (EMA 8), confirmed ORB entry (ENTER signal), or VWAP 2-bar cross below.`}
      </span>
    </div>
  )

  return (
    <div className="rec-explainer">
      <span className="rec-explainer-head">What This Means · NO TRADE</span>
      <span className="rec-explainer-body">
        {totalSignals < 3
          ? `Only ${totalSignals} of 3 minimum signals filled — add more timeframe data to get a clear direction.`
          : `${totalBull} signal${totalBull !== 1 ? 's' : ''} point up, ${totalBear} point down — too mixed to take a position. Sit out until one side clearly dominates.`
        }
      </span>
    </div>
  )
}

export default function EntryRecommendation({ result, ticker, orbRetest, ivData, regimeBlocked, swingResult, vwapSignal }) {
  const {
    signal, confluence, totalBull, totalBear, totalSignals, breakdown,
    weeklyGate, dailyGate, gateBlocked, topBlockers, targetDir,
  } = result
  const score  = 50 + confluence * 50  // map -1..1 → 0..100

  // Gate 3 — mirrors GateRow logic so SignalExplainer can reflect exact gate status
  const isCall        = signal === 'CALL'
  const swingFull     = isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT'
  const swingPartial  = swingResult?.signal === 'WATCH' && (
    isCall ? swingResult?.lastBar === 'above' : swingResult?.lastBar === 'below'
  )
  const orbConfirmed  = ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
  const orbInProgress = ['BREAK', 'RETEST'].includes(orbRetest?.signal)
  const vwapCross     = isCall ? vwapSignal?.crossAbove === true : vwapSignal?.crossBelow === true
  const g3Full        = swingFull || orbConfirmed
  const g3Part        = !g3Full && (swingPartial || vwapCross || orbInProgress)
  const gate3         = g3Full ? 'pass' : g3Part ? 'partial' : 'neutral'

  return (
    <div className="rec-card">

      {/* Regime block — hard stop when VIX > 28 and weekly is bearish on a CALL signal */}
      {regimeBlocked && (
        <div className="rec-regime-block">
          <span className="rec-regime-icon">⛔</span>
          <div className="rec-regime-body">
            <span className="rec-regime-title">HIGH RISK — DO NOT BUY CALLS</span>
            <span className="rec-regime-sub">
              VIX is above 28 and the weekly chart is bearish. Even if short-term signals look bullish,
              the macro environment is hostile to longs — you'd be swimming against institutional money.
              Wait for VIX to drop below 22, or the weekly to turn bullish, before buying calls.
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="rec-header">
        <div className="rec-ticker-row">
          <span className="rec-ticker-label">Confluence Odometer</span>
          {ticker && <span className="rec-ticker-symbol">{ticker.toUpperCase()}</span>}
        </div>

        <Odometer score={score} signal={signal} />

        <div className={`rec-signal ${SIGNAL_CLASS[signal]}${gateBlocked ? ' rec-signal-gated' : ''}`}>
          {gateBlocked ? '⛔ ' : ''}{signal}
        </div>

        {totalSignals >= 3 ? (
          <div className="rec-sub">
            {Math.round(Math.abs(confluence) * 100)}% {confluence >= 0 ? 'bullish' : 'bearish'} · {totalSignals} signals
          </div>
        ) : (
          <div className="rec-sub muted">
            {totalSignals} of 3 min signals filled
          </div>
        )}

        <GateRow
          weeklyGate={weeklyGate}
          dailyGate={dailyGate}
          signal={signal}
          swingResult={swingResult}
          orbRetest={orbRetest}
          vwapSignal={vwapSignal}
        />
        <SignalExplainer
          signal={signal}
          gateBlocked={gateBlocked}
          weeklyGate={weeklyGate}
          dailyGate={dailyGate}
          gate3={gate3}
          confluence={confluence}
          totalSignals={totalSignals}
          totalBull={totalBull}
          totalBear={totalBear}
        />
      </div>

      {/* Body */}
      <div className="rec-body">

        {/* Blocker analysis — what to watch next */}
        {totalSignals > 0 && (
          <BlockerList
            topBlockers={topBlockers}
            signal={signal}
            gateBlocked={gateBlocked}
            targetDir={targetDir}
          />
        )}

        {/* Per-TF breakdown */}
        {breakdown.some(b => b.answered > 0) && (
          <div className="breakdown">
            <div className="breakdown-title">Timeframe Breakdown</div>
            {breakdown.map((b, idx) => {
              const tfTotal    = b.bull + b.bear
              const tfBullPct  = tfTotal === 0 ? 0 : (b.bull / tfTotal) * 100
              const tfBearPct  = tfTotal === 0 ? 0 : (b.bear / tfTotal) * 100
              const netDir     = b.bull > b.bear ? 'bull' : b.bear > b.bull ? 'bear' : null
              const isDirector = b.id === 'weekly' || b.id === 'daily'
              const prevId     = breakdown[idx - 1]?.id
              const prevIsDir  = prevId === 'weekly' || prevId === 'daily'
              const showDirHdr = isDirector && idx === 0
              const showExecHdr = !isDirector && (idx === 0 || prevIsDir)
              return (
                <div key={b.id}>
                  {showDirHdr  && <div className="breakdown-group-label">DIRECTORS</div>}
                  {showExecHdr && <div className="breakdown-group-label breakdown-group-exec">EXECUTORS</div>}
                  <div className={`breakdown-row${isDirector ? ' breakdown-director' : ''}`}>
                    <span className="breakdown-tf">{b.shortLabel}</span>
                    <div className="breakdown-bar-track">
                      <div className="breakdown-center" />
                      {b.bear > 0 && (
                        <div className="breakdown-bar bear-fill"
                          style={{ width: `${tfBearPct / 2}%`, right: '50%' }} />
                      )}
                      {b.bull > 0 && (
                        <div className="breakdown-bar bull-fill"
                          style={{ width: `${tfBullPct / 2}%`, left: '50%' }} />
                      )}
                    </div>
                    <span className="breakdown-score">
                      {b.answered > 0 ? (
                        <>
                          <span className="bull-text">{b.bull > 0 ? b.bull : ''}</span>
                          {b.bull > 0 && b.bear > 0 && <span className="sep"> / </span>}
                          <span className="bear-text">{b.bear > 0 ? b.bear : ''}</span>
                          {b.answered === 0 && '—'}
                        </>
                      ) : '—'}
                    </span>
                    {netDir
                      ? <span className={`breakdown-net ${netDir}`}>{netDir === 'bull' ? '▲' : '▼'}</span>
                      : <span className="breakdown-net neutral">—</span>
                    }
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {totalSignals === 0 && (
          <div className="rec-empty">
            Load a ticker or fill in signals — the odometer will move.
          </div>
        )}

        {totalSignals > 0 && totalSignals < 3 && (
          <div className="rec-hint">
            Need {3 - totalSignals} more signal{3 - totalSignals !== 1 ? 's' : ''} before CALL / PUT fires.
          </div>
        )}

        <div className="odo-thresholds">
          <span className="odo-thresh-bear">≤ 20 = PUT</span>
          <span className="odo-thresh-mid">21–79 = NO TRADE</span>
          <span className="odo-thresh-bull">≥ 80 = CALL</span>
        </div>
        <div className="odo-threshold-note">
          The needle sweeps based on how many signals agree across timeframes.
          A CALL or PUT only fires when strong agreement exists — middle = wait.
        </div>

        {orbRetest
          ? <OrbRetestPanel data={orbRetest} />
          : (
            <div className="orb-panel">
              <div className="orb-panel-title">5-Min Entry · OR Break &amp; Retest</div>
              <div className="orb-no-data">
                No intraday data — load during market hours for live 5-min ORB signals
              </div>
            </div>
          )
        }

        {ivData && <IVPanel data={ivData} />}
      </div>
    </div>
  )
}
