import './SectorRotation.css'

export default function SectorRotation({ sectors, loading }) {
  if (loading) return (
    <div className="sr-root">
      <div className="sr-title">SECTOR ROTATION</div>
      <div className="sr-loading">Loading sector data…</div>
    </div>
  )
  if (!sectors?.length) return (
    <div className="sr-root">
      <div className="sr-title">SECTOR ROTATION</div>
      <div className="sr-loading">No sector data — fetch breadth to populate.</div>
    </div>
  )

  const maxAbs = Math.max(...sectors.map(s => Math.abs(s.chg20d ?? 0)), 1)

  return (
    <div className="sr-root">
      <div className="sr-header">
        <span className="sr-title">SECTOR ROTATION</span>
        <span className="sr-subtitle">20-day % change · sorted by performance · momentum arrows = 5d vs prior 5d</span>
        <span className="sr-legend">
          <span className="sr-leg-pip sr-leg-bull" />leading
          <span className="sr-leg-pip sr-leg-bear" />lagging
        </span>
      </div>

      <div className="sr-list">
        {sectors.map((s, i) => {
          const pos     = (s.chg20d ?? 0) >= 0
          const barPct  = Math.abs(s.chg20d ?? 0) / maxAbs * 100
          const clr     = pos ? '#10b981' : '#ef4444'
          const rank    = pos ? `#${i + 1}` : null

          // Momentum: compare chg5d (recent 5 days) vs prior 5d (chg10d - chg5d ≈ older 5d)
          let momentumArrow = null
          if (s.chg5d != null && s.chg10d != null) {
            const recent5  = s.chg5d
            const prior5   = s.chg10d - s.chg5d
            const accel    = recent5 - prior5
            if      (accel >  1.5) momentumArrow = { sym: '↑↑', color: '#10b981', tip: `Accelerating: recent 5d ${recent5 > 0 ? '+' : ''}${recent5.toFixed(1)}% vs prior 5d ${prior5 > 0 ? '+' : ''}${prior5.toFixed(1)}%` }
            else if (accel >  0.5) momentumArrow = { sym: '↑',  color: '#34d399', tip: `Improving: recent 5d ${recent5 > 0 ? '+' : ''}${recent5.toFixed(1)}% vs prior 5d ${prior5 > 0 ? '+' : ''}${prior5.toFixed(1)}%` }
            else if (accel < -1.5) momentumArrow = { sym: '↓↓', color: '#ef4444', tip: `Decelerating: recent 5d ${recent5 > 0 ? '+' : ''}${recent5.toFixed(1)}% vs prior 5d ${prior5 > 0 ? '+' : ''}${prior5.toFixed(1)}%` }
            else if (accel < -0.5) momentumArrow = { sym: '↓',  color: '#f87171', tip: `Fading: recent 5d ${recent5 > 0 ? '+' : ''}${recent5.toFixed(1)}% vs prior 5d ${prior5 > 0 ? '+' : ''}${prior5.toFixed(1)}%` }
            else                   momentumArrow = { sym: '→',  color: '#6b7280', tip: `Steady: recent 5d ${recent5 > 0 ? '+' : ''}${recent5.toFixed(1)}% vs prior 5d ${prior5 > 0 ? '+' : ''}${prior5.toFixed(1)}%` }
          }

          return (
            <div key={s.etf} className="sr-row">
              <div className="sr-meta">
                <span className="sr-etf">{s.etf}</span>
                <span className="sr-name">{s.name}</span>
              </div>
              <div className="sr-bar-wrap">
                <div
                  className="sr-bar"
                  style={{ width: `${barPct}%`, background: clr, opacity: pos ? 0.75 : 0.55 }}
                />
              </div>
              <span className="sr-chg" style={{ color: clr }}>
                {pos ? '+' : ''}{s.chg20d?.toFixed(1) ?? '—'}%
              </span>
              <span
                className="sr-momentum"
                style={{ color: momentumArrow?.color ?? 'transparent' }}
                title={momentumArrow?.tip ?? ''}
              >
                {momentumArrow?.sym ?? ''}
              </span>
              <div className="sr-pips">
                {s.above15ema != null && (
                  <span
                    className="sr-pip"
                    style={{ color: s.above15ema ? '#10b981' : '#ef4444', background: s.above15ema ? '#011c10' : '#1a0505' }}
                    title="Above 15 EMA"
                  >15</span>
                )}
                {s.above65ema != null && (
                  <span
                    className="sr-pip"
                    style={{ color: s.above65ema ? '#10b981' : '#ef4444', background: s.above65ema ? '#011c10' : '#1a0505' }}
                    title="Above 65 EMA"
                  >65</span>
                )}
              </div>
              {rank && <span className="sr-rank">{rank}</span>}
            </div>
          )
        })}
      </div>

      <div className="sr-footer">
        Leading sectors get institutional money first — look for individual stocks in the top 3 sectors for highest-probability setups.
        Momentum arrows show whether a sector is accelerating (↑↑) or fading (↓↓) over the last 5 days vs the prior 5 days.
      </div>
    </div>
  )
}
