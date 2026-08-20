import './AlignmentMatrix.css'

// All signal columns — every field that contributes to the bull/bear score
// is visible here so the badge count is fully auditable from the display.
const COLS = [
  { id: 'trend',        label: 'TREND'  },
  { id: 'structure',    label: 'STRUCT' },
  { id: 'priceVsEMA',  label: '30EMA'  },
  { id: 'rsi',          label: 'RSI'   },
  { id: 'macd',         label: 'MACD'  },
  { id: 'adx',          label: 'ADX'   },
  { id: 'ema8Cross',    label: 'EMA8'  },
  { id: 'orbBreak',     label: 'ORB'   },
  { id: 'volume',       label: 'VOL'   },
  { id: 'priceVsVWAP',  label: 'VWAP'  },
  { id: 'entryTrigger', label: 'ENTRY' },
  { id: 'keyLevel',     label: 'LEVEL' },
]

function SignalCell({ value, hasField }) {
  if (!hasField) return <span className="mx-cell mx-na">—</span>
  if (!value || value === 'neutral') return <span className="mx-cell mx-neutral">○</span>
  return <span className={`mx-cell mx-${value}`}>●</span>
}

function GatePill({ label, gate }) {
  const cfg = {
    pass:    { color: '#10b981', bg: '#001a0d', bord: '#064e2e', icon: '✓', text: 'PASS'     },
    fail:    { color: '#ef4444', bg: '#1a0000', bord: '#6b0000', icon: '✗', text: 'BLOCKED'  },
    bull:    { color: '#10b981', bg: '#001a0d', bord: '#1e3d2a', icon: '▲', text: 'BULL'     },
    bear:    { color: '#ef4444', bg: '#1a0000', bord: '#3d1e1e', icon: '▼', text: 'BEAR'     },
    neutral: { color: '#4a6380', bg: '#0f1623', bord: '#1e2d45', icon: '—', text: 'NO DATA'  },
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
    color = '#f59e0b'; bg = '#100900'; border = '#78400e'
    detail = `${callTFs}/${total} timeframes are bullish-aligned — the crowd is fully positioned long. When everyone is in, upside is limited and any reversal hits harder. Require A+ grade for new CALL entries. Tighten stops.`
  } else if (putTFs >= 5) {
    signal = 'CROWDED SHORT'; icon = '⚠'
    color = '#f59e0b'; bg = '#100900'; border = '#78400e'
    detail = `${putTFs}/${total} timeframes are bearish-aligned — maximum short exposure in the crowd. Short squeeze conditions possible. Use defined-risk spreads for puts rather than naked long puts.`
  } else if (callTFs <= 1 && total >= 4) {
    signal = 'CAPITULATION ZONE'; icon = '⚡'
    color = '#10b981'; bg = '#010f06'; border = '#065f46'
    detail = `Only ${callTFs}/${total} timeframes show bullish alignment — the crowd is exiting. This is Warren Buffett's accumulation window. Be greedy when others are fearful. Watch for a reversal signal before entering.`
  } else if (putTFs <= 1 && total >= 4) {
    signal = 'SQUEEZE WATCH'; icon = '⚡'
    color = '#10b981'; bg = '#010f06'; border = '#065f46'
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

function TFSignalBadge({ bull, bear, answered }) {
  if (answered === 0) return <span className="mx-no-data">—</span>
  const bullPct = bull / answered
  const bearPct = bear / answered
  const tfSig   = bullPct >= 0.60 ? 'CALL' : bearPct >= 0.60 ? 'PUT' : null
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
        {bull > 0 && <span className="mx-score-bull" style={{ color: bullPct >= 0.60 ? '#10b981' : '#4a6380' }}>{bull}▲</span>}
        {bear > 0 && <span className="mx-score-bear" style={{ color: bearPct >= 0.60 ? '#ef4444' : '#4a6380' }}>{bear}▼</span>}
      </span>
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
                <th key={c.id} className="mx-th">{c.label}</th>
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
                    <TFSignalBadge bull={bull} bear={bear} answered={answered} />
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
