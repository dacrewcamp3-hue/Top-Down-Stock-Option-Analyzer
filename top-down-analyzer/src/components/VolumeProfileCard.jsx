import './VolumeProfileCard.css'

function pct(price, ref) { return (((price - ref) / ref) * 100).toFixed(1) }
function fmtPx(p)        { return p >= 1000 ? p.toFixed(0) : p.toFixed(2) }

function FastMoveZone({ zone, dir, currentPrice }) {
  const isUp    = dir === 'up'
  const distPct = Math.abs((zone.midPrice - currentPrice) / currentPrice * 100).toFixed(1)
  const color   = isUp ? '#10b981' : '#ef4444'
  const bg      = isUp ? '#011c0e' : '#1c0101'
  const border  = isUp ? '#064e35' : '#7f1d1d'

  return (
    <div className="vpc-zone" style={{ background: bg, borderColor: border }}>
      <div className="vpc-zone-dir" style={{ color }}>
        {isUp ? '▲ FAST MOVE UP' : '▼ FAST MOVE DOWN'}
      </div>
      <div className="vpc-zone-range">
        ${fmtPx(zone.lo)} – ${fmtPx(zone.hi)}
      </div>
      <div className="vpc-zone-meta">
        <span className="vpc-zone-pct" style={{ color }}>{isUp ? '+' : ''}{pct(zone.midPrice, currentPrice)}% away</span>
        <span className="vpc-zone-gap">{zone.gapPct}% gap</span>
      </div>
      <div className="vpc-zone-note">
        Volume desert — {isUp ? 'bulls break above' : 'bears break below'} and price accelerates with minimal friction
      </div>
    </div>
  )
}

// Mini horizontal bar chart of the full volume profile
function ProfileBars({ profile, poc, vah, val, currentPrice }) {
  const chartH = 180
  const chartW = '100%'
  const n      = profile.length
  const barH   = chartH / n

  return (
    <div className="vpc-bars-wrap">
      <svg width="100%" height={chartH} style={{ display: 'block', overflow: 'visible' }}>
        {profile.map((bin, i) => {
          const y   = chartH - (i + 1) * barH
          const w   = bin.pct   // 0–1
          let fill = bin.isPOC ? '#facc15'
                   : bin.isHVN ? '#0e7490'
                   : bin.isLVN ? '#1a0808'
                   : bin.inVA  ? '#1e4060'
                   : '#0e2030'
          const opacity = bin.isLVN ? 0.7 : 1

          return (
            <rect
              key={i}
              x="0"
              y={y + 0.3}
              width={`${w * 82}%`}
              height={Math.max(0.8, barH - 0.6)}
              fill={fill}
              opacity={opacity}
              rx="1"
            />
          )
        })}

        {/* VAH line */}
        {(() => {
          const vahPct = (vah - profile[0].priceLo) / (profile[profile.length - 1].priceHi - profile[0].priceLo)
          const y      = chartH - vahPct * chartH
          return <line x1="0" y1={y} x2="90%" y2={y} stroke="#10b981" strokeWidth="0.8" strokeDasharray="2,3" opacity="0.7" />
        })()}

        {/* VAL line */}
        {(() => {
          const valPct = (val - profile[0].priceLo) / (profile[profile.length - 1].priceHi - profile[0].priceLo)
          const y      = chartH - valPct * chartH
          return <line x1="0" y1={y} x2="90%" y2={y} stroke="#ef4444" strokeWidth="0.8" strokeDasharray="2,3" opacity="0.7" />
        })()}

        {/* Current price line */}
        {(() => {
          const pMin = profile[0].priceLo
          const pMax = profile[profile.length - 1].priceHi
          const cpPct = (currentPrice - pMin) / (pMax - pMin)
          const y     = chartH - cpPct * chartH
          return <line x1="0" y1={y} x2="90%" y2={y} stroke="#60a5fa" strokeWidth="1.2" opacity="0.9" />
        })()}
      </svg>

      {/* Y-axis labels */}
      <div className="vpc-bars-labels">
        <span className="vpc-bars-hi">${fmtPx(profile[profile.length - 1].priceHi)}</span>
        <span className="vpc-bars-poc" title="Point of Control">POC ${fmtPx(poc)}</span>
        <span className="vpc-bars-lo">${fmtPx(profile[0].priceLo)}</span>
      </div>
    </div>
  )
}

export default function VolumeProfileCard({ volumeProfile }) {
  if (!volumeProfile) return null
  const { poc, vah, val, lvnsAbove, lvnsBelow, currentPrice, lookback, profile } = volumeProfile
  if (!profile?.length) return null

  const abovePOC = currentPrice > poc
  const inVA     = currentPrice >= val && currentPrice <= vah
  const pocDist  = pct(poc, currentPrice)

  // Nearest LVN above and below
  const nearUp   = lvnsAbove[0]
  const nearDown = lvnsBelow[0]

  return (
    <div className="vpc-root">
      <div className="vpc-header">
        <div className="vpc-header-left">
          <span className="vpc-title">VOLUME PROFILE</span>
          <span className="vpc-sub">{lookback}-bar range · fast-move zones</span>
        </div>
        <div className="vpc-header-right">
          <span className="vpc-position-tag">
            {inVA ? 'Inside Value Area' : abovePOC ? 'Above POC' : 'Below POC'}
          </span>
        </div>
      </div>

      <div className="vpc-body">
        {/* Left: mini profile chart */}
        <div className="vpc-chart-col">
          <ProfileBars
            profile={profile}
            poc={poc}
            vah={vah}
            val={val}
            currentPrice={currentPrice}
          />
          <div className="vpc-legend">
            <span className="vpc-leg-item"><span className="vpc-leg-dot" style={{ background: '#facc15' }} />POC</span>
            <span className="vpc-leg-item"><span className="vpc-leg-dot" style={{ background: '#0e7490' }} />HVN</span>
            <span className="vpc-leg-item"><span className="vpc-leg-dot" style={{ background: '#1a0808' }} />LVN</span>
            <span className="vpc-leg-item"><span className="vpc-leg-dot" style={{ background: '#60a5fa' }} />Now</span>
          </div>
        </div>

        {/* Right: key levels + fast move zones */}
        <div className="vpc-info-col">
          {/* Key levels */}
          <div className="vpc-levels">
            <div className="vpc-level-row vpc-level-vah">
              <span className="vpc-level-lbl">VAH</span>
              <span className="vpc-level-val">${fmtPx(vah)}</span>
              <span className="vpc-level-dist">{pct(vah, currentPrice) > 0 ? '+' : ''}{pct(vah, currentPrice)}%</span>
            </div>
            <div className="vpc-level-row vpc-level-poc">
              <span className="vpc-level-lbl">POC</span>
              <span className="vpc-level-val">${fmtPx(poc)}</span>
              <span className="vpc-level-dist">{pocDist > 0 ? '+' : ''}{pocDist}%</span>
            </div>
            <div className="vpc-level-row vpc-level-val">
              <span className="vpc-level-lbl">VAL</span>
              <span className="vpc-level-val">${fmtPx(val)}</span>
              <span className="vpc-level-dist">{pct(val, currentPrice) > 0 ? '+' : ''}{pct(val, currentPrice)}%</span>
            </div>
            <div className="vpc-levels-note">
              {inVA
                ? 'Price inside value area — expect chop until breakout from VAH or breakdown from VAL'
                : abovePOC
                  ? 'Price above POC — bulls in control · POC acts as magnet if momentum fades'
                  : 'Price below POC — bears in control · POC acts as ceiling on bounces'}
            </div>
          </div>

          {/* Fast move zones */}
          <div className="vpc-fast-title">FAST-MOVE ZONES</div>
          <div className="vpc-zones">
            {nearUp && <FastMoveZone zone={nearUp} dir="up" currentPrice={currentPrice} />}
            {nearDown && <FastMoveZone zone={nearDown} dir="down" currentPrice={currentPrice} />}
            {!nearUp && !nearDown && (
              <div className="vpc-no-zones">No clear LVN deserts detected — price in a well-traded range</div>
            )}
          </div>
        </div>
      </div>

      <div className="vpc-explain">
        <strong>Point of Control (POC)</strong> — price level with the most volume traded.
        Acts as a magnet — price tends to revisit it.{' '}
        <strong>Volume deserts (LVN)</strong> — thin zones where almost no contracts traded.
        When price enters one, it moves fast with little resistance, either direction.
      </div>
    </div>
  )
}
