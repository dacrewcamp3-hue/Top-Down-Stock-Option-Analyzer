import './AlignmentMatrix.css'

// All signal columns — every field that contributes to the bull/bear score
// is visible here so the badge count is fully auditable from the display.
const COLS = [
  { id: 'trend',        label: 'TREND',  tip: 'Trend direction — higher highs & higher lows (bull) or lower highs & lower lows (bear) on this timeframe' },
  { id: 'structure',    label: 'STRUCT', tip: 'Market structure — clean trending structure vs. choppy/sideways' },
  { id: 'priceVsEMA',  label: '30EMA',  tip: 'Price vs the 30 EMA — above = bulls control the midfield, below = bears' },
  { id: 'rsi',          label: 'RSI',    tip: 'RSI momentum — above its signal line & 44 (bull) or below 43 (bear)' },
  { id: 'macd',         label: 'MACD',   tip: 'MACD line vs signal line — momentum direction' },
  { id: 'adx',          label: 'ADX',    tip: 'Trend strength — ADX ≥ 21 with the correct DI leading' },
  { id: 'ema8Cross',    label: 'EMA5',   tip: 'Price vs the 5 EMA — the fast momentum line (the 2-bar entry rule)' },
  { id: 'orbBreak',     label: 'ORB',    tip: 'Opening-range breakout — broke & held above ORH (bull) or below ORL (bear)' },
  { id: 'volume',       label: 'VOL',    tip: 'Volume confirmation — above-average volume supporting the move' },
  { id: 'priceVsVWAP',  label: 'VWAP',   tip: 'Price above (bull) or below (bear) the volume-weighted average price' },
  { id: 'entryTrigger', label: 'ENTRY',  tip: 'Entry trigger fired on this timeframe' },
  { id: 'keyLevel',     label: 'LEVEL',  tip: 'Price reclaimed / holding a key support (bull) or resistance (bear) level' },
]

function SignalCell({ value, hasField }) {
  if (!hasField) return <span className="mx-cell mx-na">—</span>
  if (!value || value === 'neutral') return <span className="mx-cell mx-neutral">○</span>
  return <span className={`mx-cell mx-${value}`}>●</span>
}

function GatePill({ label, gate }) {
  const cfg = {
    pass:    { color: 'var(--clr-bull)', bg: 'var(--clr-bull-bg)', bord: 'var(--clr-bull-bdr)', icon: '✓', text: 'PASS'     },
    fail:    { color: 'var(--clr-bear)', bg: 'var(--clr-bear-bg)', bord: 'var(--clr-bear-bdr)', icon: '✗', text: 'BLOCKED'  },
    bull:    { color: 'var(--clr-bull)', bg: 'var(--clr-bull-bg)', bord: '#1e3d2a',             icon: '▲', text: 'BULL'     },
    bear:    { color: 'var(--clr-bear)', bg: 'var(--clr-bear-bg)', bord: '#3d1e1e',             icon: '▼', text: 'BEAR'     },
    neutral: { color: 'var(--text-muted)', bg: 'var(--surface-card)', bord: 'var(--border)',   icon: '—', text: 'NO DATA'  },
  }
  const c = cfg[gate] ?? cfg.neutral
  return (
    <div className="mx-gate-pill" style={{ background: c.bg, borderColor: c.bord }}>
      <span className="mx-gate-label">{label}</span>
      <span className="mx-gate-icon" style={{ color: c.color }}>{c.icon}</span>
      <span className="mx-gate-status" style={{ color: c.color }}>{c.text}</span>
    </div>
  )
}

// ── Crowd / Contrarian Signal ────────────────────────────────────────────────
// Fires when 5+ of 6 TFs are one-sided (crowded) or ≤1 (capitulation/squeeze).
function CrowdSignal({ tfStates, timeframes }) {
  const tfs = timeframes.map(tf => {
    const vals = tfStates[tf.id] || {}
    const bull = tf.fields.filter(f => vals[f.id] === 'bull').length
    const bear = tf.fields.filter(f => vals[f.id] === 'bear').length
    return { bull, bear, answered: bull + bear }
  }).filter(t => t.answered > 0)

  if (tfs.length < 3) return null

  const callTFs = tfs.filter(t => t.bull > t.bear).length
  const putTFs  = tfs.filter(t => t.bear > t.bull).length
  const total   = tfs.length

  let signal = null, color, bg, border, icon, detail

  if (callTFs >= 5) {
    signal = 'CROWDED LONG'; icon = '⚠'
    color = 'var(--clr-warn)'; bg = '#100900'; border = '#78400e'
    detail = `${callTFs}/${total} timeframes are bullish-aligned — the crowd is fully positioned long. When everyone is in, upside is limited and any reversal hits harder. Require A+ grade for new CALL entries. Tighten stops.`
  } else if (putTFs >= 5) {
    signal = 'CROWDED SHORT'; icon = '⚠'
    color = 'var(--clr-warn)'; bg = '#100900'; border = '#78400e'
    detail = `${putTFs}/${total} timeframes are bearish-aligned — maximum short exposure in the crowd. Short squeeze conditions possible. Use defined-risk spreads for puts rather than naked long puts.`
  } else if (callTFs <= 1 && total >= 4) {
    signal = 'CAPITULATION ZONE'; icon = '⚡'
    color = 'var(--clr-bull)'; bg = '#010f06'; border = '#065f46'
    detail = `Only ${callTFs}/${total} timeframes show bullish alignment — the crowd is exiting. This is Warren Buffett's accumulation window. Be greedy when others are fearful. Watch for a reversal signal before entering.`
  } else if (putTFs <= 1 && total >= 4) {
    signal = 'SQUEEZE WATCH'; icon = '⚡'
    color = 'var(--clr-bull)'; bg = '#010f06'; border = '#065f46'
    detail = `Only ${putTFs}/${total} timeframes show bearish alignment — bears are fully trapped. Short squeeze conditions present. CALL signals fired here carry above-average historical conviction.`
  }

  if (!signal) return null

  return (
    <div className="mx-crowd" style={{ background: bg, borderColor: border }}>
      <span className="mx-crowd-icon" style={{ color }}>{icon}</span>
      <div className="mx-crowd-body">
        <span className="mx-crowd-signal" style={{ color }}>{signal}</span>
        <span className="mx-crowd-detail">{detail}</span>
      </div>
    </div>
  )
}

function TFSignalBadge({ bull, bear, answered, fieldsCount }) {
  if (answered === 0) return <span className="mx-no-data">—</span>
  const bullPct = bull / answered
  const bearPct = bear / answered
  const tfSig   = bullPct >= 0.60 ? 'CALL' : bearPct >= 0.60 ? 'PUT' : null
  const total   = fieldsCount || answered
  return (
    <div className="mx-sig-wrap">
      {tfSig ? (
        <span className={`mx-sig-badge mx-sig-${tfSig === 'CALL' ? 'call' : 'put'}`}>
          {tfSig === 'CALL' ? '▲' : '▼'} {tfSig}
        </span>
      ) : (
        <span className="mx-sig-badge mx-sig-wait">WAIT</span>
      )}
      <span className="mx-sig-counts">
        {bull > 0 && <span className="mx-score-bull" style={{ color: bullPct >= 0.60 ? 'var(--clr-bull)' : 'var(--text-muted)' }}>{bull}▲</span>}
        {bear > 0 && <span className="mx-score-bear" style={{ color: bearPct >= 0.60 ? 'var(--clr-bear)' : 'var(--text-muted)' }}>{bear}▼</span>}
      </span>
      <span className="mx-tally" title={`${bull} bull · ${bear} bear · ${Math.max(0, total - answered)} neutral of ${total}`}>
        <span className="mx-tally-bull" style={{ width: `${(bull / total) * 100}%` }} />
        <span className="mx-tally-bear" style={{ width: `${(bear / total) * 100}%` }} />
      </span>
    </div>
  )
}

// ── Confluence Verdict — reads the matrix for you (synthesized top strip) ─────
export function ConfluenceVerdict({ confluenceResult, swingResult, orbRetest, lastUpdated, isEnriching }) {
  if (!confluenceResult?.signal) return null
  const sig    = confluenceResult.signal           // CALL / PUT / NO TRADE
  const isCall = sig === 'CALL'
  const isPut  = sig === 'PUT'
  const dirColor = isCall ? 'var(--clr-bull)' : isPut ? 'var(--clr-bear)' : 'var(--clr-neutral)'

  const g3 = ((isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT') && swingResult?.confirmed === true)
    || ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
  const gates = [
    { k: 'WEEKLY', ok: confluenceResult.weeklyGate === 'pass' },
    { k: 'DAILY',  ok: confluenceResult.dailyGate  === 'pass' },
    { k: 'TIMING', ok: !!g3 },
  ]
  const open = gates.filter(g => g.ok).length
  const conf = confluenceResult.confluence != null ? Math.round(Math.abs(confluenceResult.confluence) * 100) : null
  const bull = confluenceResult.totalBull
  const bear = confluenceResult.totalBear
  const timeStr = lastUpdated?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  let verdict, vColor
  if (sig === 'NO TRADE') { verdict = 'NO CONFLUENCE — stand aside'; vColor = 'var(--clr-neutral)' }
  else if (open === 3)              { verdict = `${sig} · ALL GATES OPEN`;       vColor = dirColor }
  else if (confluenceResult.gateBlocked) { verdict = `${sig} · HIGHER TF BLOCKS`; vColor = 'var(--clr-warn)' }
  else                              { verdict = `${sig} · ${open}/3 GATES`;       vColor = 'var(--clr-warn)' }

  return (
    <div className="mx-verdict" style={{ borderColor: `${isCall ? 'var(--clr-bull)' : isPut ? 'var(--clr-bear)' : 'var(--border)'}` }}>
      <div className="mx-verdict-top">
        <span className="mx-verdict-dir" style={{ color: vColor }}>{verdict}</span>
        {conf != null && sig !== 'NO TRADE' && (
          <span className="mx-verdict-conf">{conf}% {isPut ? 'bear' : 'bull'}-aligned</span>
        )}
        {bull != null && bear != null && (
          <span className="mx-verdict-tally"><b style={{ color: 'var(--clr-bull)' }}>{bull}▲</b> / <b style={{ color: 'var(--clr-bear)' }}>{bear}▼</b></span>
        )}
        <span className="mx-verdict-fresh">
          <span className={`mx-verdict-dot${isEnriching ? ' live' : ''}`} />
          {isEnriching ? 'updating…' : timeStr ? `as of ${timeStr}` : 'live'}
        </span>
      </div>
      <div className="mx-verdict-gates">
        {gates.map(g => (
          <span key={g.k} className={`mx-vgate ${g.ok ? 'ok' : 'no'}`}>
            <span className="mx-vgate-icon">{g.ok ? '✓' : '○'}</span>{g.k}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function AlignmentMatrix({ tfStates, timeframes, weeklyGate, dailyGate }) {
  const gateBlocked = weeklyGate === 'fail' || dailyGate === 'fail'

  return (
    <div className="mx-root">
      {/* Director gate row */}
      <div className="mx-gate-row">
        <span className="mx-gate-row-label">DIRECTOR GATES</span>
        <GatePill label="Weekly" gate={weeklyGate} />
        <GatePill label="Daily"  gate={dailyGate}  />
        {gateBlocked && (
          <span className="mx-gate-block-warn">
            ⛔ Higher TF is fighting the signal — stand aside until gates clear
          </span>
        )}
      </div>

      {/* Signal alignment table */}
      <div className="mx-table-wrap">
        <table className="mx-table">
          <thead>
            <tr>
              <th className="mx-th mx-th-tf"></th>
              {COLS.map(c => (
                <th key={c.id} className="mx-th" data-tip={c.tip}>{c.label}</th>
              ))}
              <th className="mx-th mx-th-score">SIGNAL</th>
            </tr>
          </thead>
          <tbody>
            {timeframes.map(tf => {
              const vals       = tfStates[tf.id] || {}
              const fieldSet   = new Set(tf.fields.map(f => f.id))
              const bull       = tf.fields.filter(f => vals[f.id] === 'bull').length
              const bear       = tf.fields.filter(f => vals[f.id] === 'bear').length
              const answered   = bull + bear
              const isDirector = tf.id === 'weekly' || tf.id === 'daily'

              return (
                <tr
                  key={tf.id}
                  className={`mx-row${isDirector ? ' mx-director-row' : ''}`}
                >
                  <td className="mx-td mx-td-tf">
                    <span className="mx-tf-badge">{tf.shortLabel}</span>
                    <span className="mx-tf-wt">×{tf.weight}</span>
                  </td>
                  {COLS.map(col => (
                    <td key={col.id} className="mx-td">
                      <SignalCell value={vals[col.id]} hasField={fieldSet.has(col.id)} />
                    </td>
                  ))}
                  <td className="mx-td mx-td-score">
                    <TFSignalBadge bull={bull} bear={bear} answered={answered} fieldsCount={tf.fields.length} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Legend */}
        <div className="mx-legend">
          <span className="mx-leg-bull">● bull</span>
          <span className="mx-leg-bear">● bear</span>
          <span className="mx-leg-neutral">○ neutral</span>
          <span className="mx-leg-na">— n/a</span>
          <span className="mx-leg-note">WK &amp; DY are director rows — they must align for a valid entry</span>
        </div>

        {/* Crowd / Contrarian signal */}
        <CrowdSignal tfStates={tfStates} timeframes={timeframes} />
      </div>
    </div>
  )
}
