import './MarketBreadth.css'

// ── Market Environment / Breadth Panel ──────────────────────────────────────
// Shows whether the broad market backdrop favors pressing or sitting on hands.
// All data is from Yahoo Finance (NYSE A/D, TRIN, new highs/lows, SPY/QQQ/IWM EMA).

const VERDICT_CFG = {
  FAVORABLE:      { color: '#10b981', bg: '#01120a', border: '#065f46', icon: '▲', label: 'FAVORABLE' },
  'LEANING BULLISH': { color: '#34d399', bg: '#01120a', border: '#047857', icon: '↑', label: 'LEANING BULLISH' },
  MIXED:          { color: '#f59e0b', bg: '#100900', border: '#4d3800', icon: '◐', label: 'MIXED' },
  'LEANING BEARISH': { color: '#f87171', bg: '#130305', border: '#7f1d1d', icon: '↓', label: 'LEANING BEARISH' },
  HOSTILE:        { color: '#ef4444', bg: '#130305', border: '#7f1d1d', icon: '▼', label: 'HOSTILE' },
  UNKNOWN:        { color: '#4a6888', bg: '#070d18', border: '#1a2d45', icon: '?', label: 'LOADING…' },
}

function IndexTile({ data }) {
  if (!data) return null
  const health = data.healthScore  // 0-3
  const clr = health === 3 ? '#10b981' : health === 2 ? '#34d399' : health === 1 ? '#f59e0b' : '#ef4444'
  const bars = [
    { lbl: '15d', ok: data.above15,  tip: 'Above 15-day EMA = short-term momentum up. Below = short-term trend weakening.' },
    { lbl: '65d', ok: data.above65,  tip: 'Above 65-day EMA = medium-term trend intact. Below = caution on new longs.' },
    { lbl: '200d', ok: data.above200, tip: 'Above 200-day EMA = primary bull trend. Below = bear territory. Most institutions only buy calls above the 200-day.' },
  ]
  return (
    <div className="mb-idx">
      <div className="mb-idx-label">{data.label}</div>
      <div className="mb-idx-price" style={{ color: clr }}>${data.price?.toFixed(0)}</div>
      {data.chg20 != null && (
        <div className="mb-idx-chg" style={{ color: data.chg20 >= 0 ? '#10b981' : '#ef4444' }}>
          {data.chg20 >= 0 ? '+' : ''}{data.chg20}% (20d)
        </div>
      )}
      <div className="mb-idx-emas">
        {bars.map(b => b.ok != null && (
          <span key={b.lbl} className="mb-ema-dot"
            style={{ background: b.ok ? '#10b981' : '#ef4444' }}
            title={b.tip}>
            {b.lbl}
          </span>
        ))}
      </div>
    </div>
  )
}

function BreadthRow({ label, value, bull, detail, tip }) {
  const dot = bull === true ? '●' : bull === false ? '●' : '◐'
  const clr = bull === true ? '#10b981' : bull === false ? '#ef4444' : '#f59e0b'
  return (
    <div className="mb-row" data-tip={tip}>
      <span className="mb-row-dot" style={{ color: clr }}>{dot}</span>
      <span className="mb-row-label">{label}</span>
      <span className="mb-row-value" style={{ color: clr }}>{value}</span>
      {detail && <span className="mb-row-detail">{detail}</span>}
    </div>
  )
}

export default function MarketBreadth({ data, isLoading, onRefresh }) {
  // Don't render until we have data or are actively loading
  if (!data && !isLoading) return null

  const verdict = data?.verdict ?? 'UNKNOWN'
  const cfg     = VERDICT_CFG[verdict] ?? VERDICT_CFG.UNKNOWN

  const { nyad, trin, hl, spy, qq, iwm, bullPts = 0, bearPts = 0, total = 0 } = data ?? {}

  const lastTime = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="mb-root" style={{ borderColor: cfg.border, background: cfg.bg }}>
      {/* Header */}
      <div className="mb-header">
        <div className="mb-header-left">
          <span className="mb-title">MARKET ENVIRONMENT</span>
          <span className="mb-sub">Is the broad market supporting your trade direction right now?</span>
        </div>
        <div className="mb-header-right">
          <div className="mb-verdict" style={{ color: cfg.color }}>
            <span className="mb-verdict-icon">{cfg.icon}</span>
            <span className="mb-verdict-label">{cfg.label}</span>
          </div>
          {total > 0 && (
            <div className="mb-score" title={`${bullPts} of ${total} market signals are bullish, ${bearPts} are bearish`}>
              <span style={{ color: '#10b981' }}>{bullPts} bull</span>
              {' / '}
              <span style={{ color: '#ef4444' }}>{bearPts} bear</span>
              <span className="mb-score-of"> of {total}</span>
            </div>
          )}
          <button className="mb-refresh" onClick={onRefresh} disabled={isLoading}
            title="Refresh breadth data">
            {isLoading ? '…' : '↺'}
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="mb-loading">Fetching NYSE breadth, index EMAs…</div>
      ) : (
        <>
          {/* Index EMA row */}
          <div className="mb-index-row-label">Colored dots = above (green) or below (red) that EMA — hover for details</div>
          <div className="mb-index-row">
            <IndexTile data={spy} />
            <IndexTile data={qq}  />
            <IndexTile data={iwm} />
          </div>

          {/* Breadth data rows */}
          <div className="mb-rows">
            {nyad && (
              <BreadthRow
                label="NYSE A/D Line"
                value={nyad.trend === 'rising' ? 'RISING' : nyad.trend === 'falling' ? 'FALLING' : 'FLAT'}
                bull={nyad.trend === 'rising' ? true : nyad.trend === 'falling' ? false : null}
                detail={nyad.value > 0 ? `+${Math.round(nyad.value).toLocaleString()} cumulative` : `${Math.round(nyad.value).toLocaleString()} cumulative`}
                tip="NYSE Advance-Decline Line: compares the number of advancing stocks to declining ones each day and adds them cumulatively. A rising A/D line means more stocks are going up than down — even if the headline index is held up by a few big stocks. A falling A/D line while the index holds up is a warning sign (divergence)."
              />
            )}
            {trin && (
              <BreadthRow
                label="TRIN (Arms Index)"
                value={trin.value.toFixed(2)}
                bull={trin.bullish}
                detail={trin.label}
                tip="TRIN (Arms Index): measures the ratio of advancing/declining stocks to advancing/declining volume. Below 1.0 = buyers are in control. Above 1.0 = sellers dominate. Above 2.0 = panic selling. Below 0.50 = euphoric buying. Use as a same-day sentiment gauge."
              />
            )}
            {hl && (
              <BreadthRow
                label="52-Wk Highs / Lows"
                value={`${hl.highs}H / ${hl.lows}L`}
                bull={hl.bullish}
                detail={hl.ratio != null ? `${hl.ratio}× more highs than lows` : null}
                tip="NYSE New 52-week Highs vs New Lows (5-day average): when more stocks are hitting new highs than new lows, the uptrend has broad participation. When new lows dominate, the market is in distribution regardless of what the index says."
              />
            )}
            {spy && (
              <BreadthRow
                label="SPY vs 200-day EMA"
                value={spy.above200 === true ? 'ABOVE' : spy.above200 === false ? 'BELOW' : '—'}
                bull={spy.above200}
                detail={spy.e200 ? `EMA200: $${spy.e200.toFixed(0)}` : null}
                tip="The S&P 500's position relative to its 200-day EMA is the single most-watched long-term trend indicator. Above = primary uptrend. Below = primary downtrend. Most institutional money only buys call options when SPY is above its 200-day. Below it, bear case is structurally favored."
              />
            )}
          </div>

          {/* Verdict interpretation */}
          <div className="mb-interpret" style={{ borderColor: cfg.border }}>
            {verdict === 'FAVORABLE' && (
              <>
                <strong>Market is behind you.</strong>{' '}
                More stocks are rising than falling, indexes are above their moving averages, and volatility is calm.
                Press CALL setups at full position size — the macro wind is at your back.
              </>
            )}
            {verdict === 'LEANING BULLISH' && (
              <>
                <strong>Mostly bullish, but not clean.</strong>{' '}
                Most signals lean up, but a few cracks exist. Use full size on your best CALL setups (A+ or A grade only),
                cut size in half on anything below that.
              </>
            )}
            {verdict === 'MIXED' && (
              <>
                <strong>No clear market direction.</strong>{' '}
                Bulls and bears are fighting each other across different indicators. Only trade A+ grade setups
                at reduced size — skip anything marginal until clarity returns.
              </>
            )}
            {verdict === 'LEANING BEARISH' && (
              <>
                <strong>Market is pulling back.</strong>{' '}
                More signals are weakening than strengthening. Favor PUT setups. Cut CALL position size by 50%
                and use tighter stops — the tide is turning against longs.
              </>
            )}
            {verdict === 'HOSTILE' && (
              <>
                <strong>Stay in cash or trade PUTs only.</strong>{' '}
                Breadth is deteriorating, indexes are under pressure, and shorts are in control.
                Do not buy CALL options in this environment — the macro headwind will fight your trade.
              </>
            )}
            {verdict === 'UNKNOWN' && (lastTime ? `Last refreshed ${lastTime} — click ↺ to update` : 'Click ↺ to load market breadth data. Check this before every trading session.')}
          </div>
        </>
      )}
    </div>
  )
}
