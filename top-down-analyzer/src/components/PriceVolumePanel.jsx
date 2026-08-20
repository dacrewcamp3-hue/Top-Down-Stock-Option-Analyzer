import './PriceVolumePanel.css'

// The 4 price-volume relationships, their meaning, and trading implication
const QUADS = {
  upHigh: {
    priceDir: '↑', volDir: '↑',
    priceLabel: 'PRICE UP', volLabel: 'VOLUME UP',
    kind: 'bull',
    conclusion: 'Uptrend supported by volume',
    action: 'Look for long entries',
    tip: 'When price rises AND volume rises, institutions are participating. The move is genuine. This is the highest-conviction environment to buy calls.',
  },
  upLow: {
    priceDir: '↑', volDir: '↓',
    priceLabel: 'PRICE UP', volLabel: 'VOLUME DOWN',
    kind: 'warn',
    conclusion: 'Uptrend not supported by volume',
    action: 'Exit long entry upon further sign of reversal',
    tip: 'Price rising on declining volume is a warning. The move may be running out of buyers. Hold existing longs cautiously — exit if you see a bearish reversal signal.',
  },
  downHigh: {
    priceDir: '↓', volDir: '↑',
    priceLabel: 'PRICE DOWN', volLabel: 'VOLUME UP',
    kind: 'bear',
    conclusion: 'Downtrend supported by volume',
    action: 'Look for short entries',
    tip: 'Price falling AND volume rising means sellers are in control with conviction. This is the highest-conviction environment to buy puts.',
  },
  downLow: {
    priceDir: '↓', volDir: '↓',
    priceLabel: 'PRICE DOWN', volLabel: 'VOLUME DOWN',
    kind: 'warn',
    conclusion: 'Downtrend not supported by volume',
    action: 'Exit short entry upon further sign of reversal',
    tip: 'Price falling on declining volume suggests sellers are exhausted. The downtrend may be losing steam. Hold shorts cautiously — exit if you see a bullish reversal signal.',
  },
}

const KIND_COLOR = { bull: '#10b981', bear: '#ef4444', warn: '#f59e0b' }
const KIND_BG    = { bull: '#01120a', bear: '#130303', warn: '#120d01' }
const KIND_BORD  = { bull: '#065f46', bear: '#7f1d1d', warn: '#4d3800' }

// Average of an array
const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0

function tfUnit(chartTf) {
  if (chartTf === 'W')   return 'week'
  if (chartTf === '4H')  return '4H bar'
  if (chartTf === '1H')  return 'hour'
  if (chartTf === '15M') return '15M bar'
  if (chartTf === '5M')  return '5M bar'
  return 'day'  // 'D' or unknown
}

export default function PriceVolumePanel({ closes, volumes, chartTf }) {
  if (!closes?.length || !volumes?.length || closes.length < 22) return null

  const unit = tfUnit(chartTf)
  const unitP = unit.endsWith('bar') ? `${unit}s` : `${unit}s`

  const n  = closes.length
  const LB = 20   // lookback for bar distribution

  // ── Trend determination ───────────────────────────────────────────────────
  // Price: 10-bar trend (current close vs 10 bars ago)
  const priceUp = closes[n - 1] > closes[Math.max(0, n - 11)]
  const priceChgPct = ((closes[n - 1] - closes[Math.max(0, n - 11)]) / closes[Math.max(0, n - 11)] * 100)

  // Volume: recent 5-bar average vs prior 15-bar average
  const recentVol = avg(volumes.slice(n - 5))
  const priorVol  = avg(volumes.slice(n - 20, n - 5))
  const volUp     = recentVol > priorVol
  const volChgPct = priorVol > 0 ? ((recentVol - priorVol) / priorVol * 100) : 0

  const activeKey = priceUp
    ? (volUp ? 'upHigh' : 'upLow')
    : (volUp ? 'downHigh' : 'downLow')

  const active = QUADS[activeKey]

  // ── 20-bar per-bar classification ─────────────────────────────────────────
  const baseAvgVol = avg(volumes.slice(n - LB))
  const counts = { upHigh: 0, upLow: 0, downHigh: 0, downLow: 0 }

  for (let i = n - LB; i < n; i++) {
    const barUp     = closes[i] >= (i > 0 ? closes[i - 1] : closes[i])
    const barHighVol = volumes[i] >= baseAvgVol
    const key = barUp
      ? (barHighVol ? 'upHigh' : 'upLow')
      : (barHighVol ? 'downHigh' : 'downLow')
    counts[key]++
  }

  // Confirming bars = bars that match the current trend direction
  const confirmKey = priceUp ? 'upHigh' : 'downHigh'
  const confirmPct = Math.round((counts[confirmKey] / LB) * 100)

  const activeColor = KIND_COLOR[active.kind]
  const activeBg    = KIND_BG[active.kind]
  const activeBord  = KIND_BORD[active.kind]

  // ── Quad card layout order: top-left=upHigh, top-right=upLow, etc. ───────
  const quadOrder = ['upHigh', 'upLow', 'downHigh', 'downLow']

  return (
    <div className="pvp-wrap">

      {/* Header */}
      <div className="pvp-header">
        <span className="pvp-title">PRICE-VOLUME RELATIONSHIP</span>
        <span className="pvp-period"
          data-tip="Measures whether the current price trend is being confirmed or denied by volume. Volume gives price direction its credibility — a move without volume support often reverses.">
          10-{unit} price · 5-{unit} volume vs 15-{unit} baseline
        </span>
      </div>

      {/* Active verdict */}
      <div className="pvp-verdict" style={{ background: activeBg, borderColor: activeBord }}
        data-tip={active.tip}>
        <div className="pvp-verdict-top">
          <div className="pvp-verdict-tags">
            <span className="pvp-tag" style={{ color: activeColor, borderColor: activeBord, background: `${activeColor}18` }}>
              {active.priceLabel}
            </span>
            <span className="pvp-verdict-plus">+</span>
            <span className="pvp-tag" style={{ color: activeColor, borderColor: activeBord, background: `${activeColor}18` }}>
              {active.volLabel}
            </span>
          </div>
          <span className="pvp-verdict-kind" style={{ color: activeColor }}>
            {active.kind === 'bull' ? 'CONFIRMED BULLISH' : active.kind === 'bear' ? 'CONFIRMED BEARISH' : 'DIVERGING'}
          </span>
        </div>
        <div className="pvp-verdict-conclusion">{active.conclusion}</div>
        <div className="pvp-verdict-action" style={{ color: activeColor }}>
          → {active.action}
        </div>
      </div>

      {/* 2×2 reference grid */}
      <div className="pvp-grid">
        {quadOrder.map(key => {
          const q        = QUADS[key]
          const isActive = key === activeKey
          const qColor   = KIND_COLOR[q.kind]
          const qBg      = isActive ? KIND_BG[q.kind]   : '#070d1c'
          const qBord    = isActive ? KIND_BORD[q.kind] : '#1a2e48'
          const barPct   = Math.round(counts[key] / LB * 100)

          return (
            <div key={key} className={`pvp-quad${isActive ? ' pvp-quad-active' : ''}`}
              style={{ background: qBg, borderColor: qBord }}
              data-tip={q.tip}>
              <div className="pvp-quad-labels">
                <span className="pvp-quad-dir" style={{ color: isActive ? qColor : '#3a5a7a' }}>
                  {q.priceDir} price · {q.volDir} vol
                </span>
                {isActive && <span className="pvp-quad-now" style={{ color: qColor }}>NOW</span>}
              </div>
              <div className="pvp-quad-conclusion" style={{ color: isActive ? '#b0cce0' : '#3a5a7a' }}>
                {q.conclusion}
              </div>
              <div className="pvp-quad-action" style={{ color: isActive ? qColor : '#2a4060' }}>
                {q.action}
              </div>
              {/* Mini bar showing how often this appeared in last 20 bars */}
              <div className="pvp-quad-bar-wrap">
                <div className="pvp-quad-bar-track">
                  <div className="pvp-quad-bar-fill"
                    style={{ width: `${barPct}%`, background: isActive ? qColor : '#1e3050' }} />
                </div>
                <span className="pvp-quad-bar-lbl" style={{ color: isActive ? qColor : '#2a4060' }}>
                  {counts[key]}/{LB} bars
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Supporting stats */}
      <div className="pvp-stats">
        <div className="pvp-stat"
          data-tip={`Price change over the last 10 ${unitP} — the medium-term direction used to determine whether we're in a price uptrend or downtrend.`}>
          <span className="pvp-stat-lbl">10-{unit} price change</span>
          <span className="pvp-stat-val" style={{ color: priceUp ? '#10b981' : '#ef4444' }}>
            {priceChgPct >= 0 ? '+' : ''}{priceChgPct.toFixed(1)}%
          </span>
        </div>
        <div className="pvp-stat"
          data-tip={`Recent 5-${unit} average volume versus the prior 15-${unit} average. Positive = volume is expanding (more participation). Negative = volume is contracting (less participation).`}>
          <span className="pvp-stat-lbl">Volume trend (5 vs prior 15 {unit}s)</span>
          <span className="pvp-stat-val" style={{ color: volUp ? '#10b981' : '#ef4444' }}>
            {volChgPct >= 0 ? '+' : ''}{volChgPct.toFixed(0)}%
          </span>
        </div>
        <div className="pvp-stat"
          data-tip={`Confirming bars: of the last 20 ${unitP}, ${counts[confirmKey]} closed in the ${priceUp ? 'Price Up + Volume Up' : 'Price Down + Volume Up'} zone — the highest-conviction quadrant for this direction. Higher = more consistent.`}>
          <span className="pvp-stat-lbl">{priceUp ? 'Vol-confirmed up bars' : 'Vol-confirmed down bars'}</span>
          <span className="pvp-stat-val" style={{ color: confirmPct >= 40 ? (priceUp ? '#10b981' : '#ef4444') : '#f59e0b' }}>
            {counts[confirmKey]}/{LB} ({confirmPct}%)
          </span>
        </div>
      </div>

    </div>
  )
}
