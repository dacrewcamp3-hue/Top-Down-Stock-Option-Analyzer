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
        <span className="sr-subtitle">20-day % change · sorted by performance</span>
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
          const bgClr   = pos ? '#052010' : '#140508'
          const rank    = pos ? `#${i + 1}` : null

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
      </div>
    </div>
  )
}
