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

// ── Market helpers ────────────────────────────────────────────────────────────

function computeCorrelationRegime(vixVal, vixRising) {
  if (vixVal == null) return null
  if (vixVal > 28)                return { label: 'HIGH CORRELATION',   color: '#ef4444', bg: '#130305', desc: 'Risk-off: stocks moving together. Individual signals lose predictive power — macro direction dominates. Reduce position size on all setups.' }
  if (vixVal > 22)                return { label: 'ELEVATED CORRELATION', color: '#f59e0b', bg: '#0f0900', desc: 'Moderate correlation risk. Top-down signals still work but expect more false positives. Weight macro regime over individual setup quality.' }
  if (vixVal < 16 && !vixRising)  return { label: 'LOW CORRELATION',    color: '#10b981', bg: '#01120a', desc: "Stock pickers' market — individual signals are most predictive. Technical analysis and top-down confluence perform best here." }
  return                                  { label: 'MODERATE CORRELATION', color: '#60a5fa', bg: '#06111e', desc: 'Normal market conditions. Individual signals are reliable. Run standard position sizes.' }
}

function computeGammaRegime(vixVal, vixRising) {
  if (vixVal == null) return null
  if (vixVal < 15)                       return { label: 'POSITIVE GAMMA',    color: '#10b981', bg: '#01120a', tag: 'Pinning', desc: 'Dealers are long gamma — they buy dips and sell rips, suppressing volatility. Mean-reversion dominates. Directional options face headwinds; spreads perform better.' }
  if (vixVal < 20 && !vixRising)         return { label: 'POSITIVE GAMMA',    color: '#34d399', bg: '#01120a', tag: 'Mild Pin', desc: 'Low VIX environment. Markets tend to pin and chop. Directional moves are slower. Prefer near-the-money options over OTM.' }
  if (vixVal > 22 && vixRising)          return { label: 'NEGATIVE GAMMA',    color: '#ef4444', bg: '#130305', tag: 'Explosive', desc: 'Dealers are short gamma — they sell dips and buy rips, amplifying volatility. Directional moves go farther and faster. Long options benefit from gamma acceleration.' }
  if (vixVal > 20)                       return { label: 'TRANSITIONING',     color: '#f59e0b', bg: '#0f0900', tag: 'Mixed', desc: 'Gamma regime is transitioning. Vol is elevated but directional. Watch VIX direction — rising means moves accelerate, falling means reversion.' }
  return                                          { label: 'NEUTRAL GAMMA',    color: '#60a5fa', bg: '#06111e', tag: 'Neutral', desc: 'No strong gamma regime signal. Normal directional option behavior.' }
}

function classifyPlaybook({ spy, qq, iwm, hl, nyad, trin, vixVal, vixRising }) {
  if (!spy) return null
  const above200 = spy.above200, above65 = spy.above65
  const adRising = nyad?.trend === 'rising', adFalling = nyad?.trend === 'falling'
  const hlBull = hl?.bullish, hlBear = hl != null && !hl.bullish
  const trinFear = trin?.value > 1.5
  const vixHigh = vixVal > 25, vixCompress = vixVal < 15 && !vixRising
  const smallCapLag = spy.above65 && iwm && !iwm.above65
  const techLead = qq && qq.above65 && iwm && !iwm.above65

  if (!above200 && vixHigh && trinFear)   return { name: 'CAPITULATION FLUSH',       color: '#ef4444', bg: '#130305', icon: '💧', dte: '7–14', strategy: 'Cash or short-dated PUTs. VIX spike creates IV crush risk — use spreads, not naked options. Look for bounce entries after TRIN > 2.', next: 'Watch for TRIN reversal below 1.0 and VIX peak.' }
  if (!above200 && adFalling && hlBear)   return { name: 'DISTRIBUTION PHASE',        color: '#f87171', bg: '#130305', icon: '📉', dte: '14–21', strategy: 'PUTs only on bounces to resistance. Market is in distribution — every rally is a selling opportunity for institutions.', next: 'Wait for SPY reclaim of 200-day EMA before considering CALLs.' }
  if (!above200)                          return { name: 'BEAR MARKET',               color: '#ef4444', bg: '#0e0205', icon: '🐻', dte: '14–21', strategy: 'PUTs on rallies to resistance levels. No CALL setups regardless of individual signal quality.', next: 'SPY must reclaim 200-day EMA to shift regime.' }
  if (above200 && !above65 && adRising)  return { name: 'BREADTH WASHOUT RECOVERY',  color: '#f59e0b', bg: '#0f0900', icon: '🔄', dte: '21–35', strategy: 'Early long entries on A+ setups only. Market is recovering — breadth is improving but price has not confirmed. Use wider stops.', next: 'SPY reclaim of 65-day EMA triggers bull regime.' }
  if (above200 && above65 && smallCapLag && !adRising) return { name: 'LATE-CYCLE MELT-UP',  color: '#f59e0b', bg: '#0f0900', icon: '🌡️', dte: '≤21', strategy: 'Take CALL profits early. Narrow breadth + small-cap lag = late distribution. Keep DTE short. This phase historically lasts 3–6 weeks before a volatility event.', next: 'Watch for A/D line turn or new lows expanding.' }
  if (above200 && above65 && vixCompress && adRising) return { name: 'GRIND-UP ACCUMULATION',  color: '#10b981', bg: '#01120a', icon: '📈', dte: '21–35', strategy: 'Full size on A/A+ CALL setups. Low vol + rising breadth = highest win-rate environment for directional options. Add to winners.', next: 'Maintain until VIX starts rising or A/D line turns.' }
  if (above200 && above65 && techLead)   return { name: 'TECH-LED BULL MARKET',       color: '#34d399', bg: '#01120a', icon: '🖥️', dte: '21–35', strategy: 'Full size on tech/growth CALL setups. Concentration risk — small caps lagging. Prioritize mega-cap and tech sector names.', next: 'Confirm small caps (IWM) recover before broadening exposure.' }
  if (above200 && above65 && adRising)   return { name: 'BROAD BULL EXPANSION',       color: '#10b981', bg: '#01120a', icon: '🚀', dte: '21–45', strategy: 'Best CALL environment. Rising breadth + all caps confirming. Run full size, longer DTE, higher delta strikes.', next: 'Monitor for breadth peak — when new highs stop expanding, trim.' }
  return null
}

function computeVolForward(vixVal, vixRising) {
  if (vixVal == null) return null
  if (vixVal < 13 && !vixRising) return { label: 'VOL SPIKE RISK', color: '#f59e0b', bg: '#0f0900', desc: `VIX ${vixVal.toFixed(1)} — extreme compression. Statistically, VIX this low has a high probability of spiking within 10–20 sessions. Avoid long-dated options; prefer spreads or short DTE.` }
  if (vixVal < 16 && !vixRising) return { label: 'VOL COMPRESSION', color: '#60a5fa', bg: '#06111e', desc: `VIX ${vixVal.toFixed(1)} — calm environment. Options are cheap to buy. IV crush risk is low. Good entry window for directional premium.` }
  if (vixVal > 25 && !vixRising) return { label: 'VOL PEAK WATCH', color: '#f59e0b', bg: '#0f0900', desc: `VIX ${vixVal.toFixed(1)} but not rising — may be peaking. Wait for VIX to turn down before buying calls aggressively; put premium remains elevated.` }
  if (vixVal > 25 && vixRising)  return { label: 'VOL EXPANDING', color: '#ef4444', bg: '#130305', desc: `VIX ${vixVal.toFixed(1)} and rising — options are getting expensive across the board. IV crush risk is HIGH if the catalyst resolves. Use spreads to limit vega exposure.` }
  if (vixVal > 18 && vixRising)  return { label: 'VOL RISING', color: '#f87171', bg: '#130305', desc: `VIX ${vixVal.toFixed(1)} and climbing — premium is expanding. Near-term options cost more each day. Enter now or wait for a VIX peak and reversal.` }
  return null
}

function computeBreadthDivergence({ spy, nyad, hl }) {
  if (!spy) return null
  const spyHolding = spy.above65
  const adFalling  = nyad?.trend === 'falling'
  const lowsDom    = hl && hl.lows > hl.highs
  if (!spyHolding) return null
  if (adFalling && lowsDom) return { level: 'SEVERE',   color: '#ef4444', desc: 'SPY above 65-day EMA but both the A/D line and new lows are diverging. This is a textbook distribution pattern — institutions are selling into strength. Historically precedes an index decline within 2–4 weeks.' }
  if (adFalling)            return { level: 'MODERATE', color: '#f59e0b', desc: 'SPY holding above 65-day EMA but the A/D line is falling. Fewer stocks are participating in the rally. Watch for new lows to expand — if they do, the divergence intensifies.' }
  if (lowsDom)              return { level: 'MODERATE', color: '#f59e0b', desc: 'More stocks hitting new 52-week lows than highs while SPY holds up. Market leadership is narrowing. Late-cycle warning — reduce CALL hold times.' }
  return null
}

function computeRegimeMultiplier({ verdict, vixVal, vixRising, corrLabel, gammaLabel, divergence }) {
  let m = 1.0
  if (verdict === 'FAVORABLE')       m += 0.15
  else if (verdict === 'LEANING BULLISH') m += 0.08
  else if (verdict === 'MIXED')      m -= 0.10
  else if (verdict === 'LEANING BEARISH') m -= 0.20
  else if (verdict === 'HOSTILE')    m -= 0.35
  if (vixVal != null) {
    if (vixVal > 30) m -= 0.20
    else if (vixVal > 25) m -= 0.10
    else if (vixVal < 15 && !vixRising) m += 0.08
  }
  if (corrLabel?.includes('HIGH'))      m -= 0.15
  else if (corrLabel?.includes('LOW'))  m += 0.10
  if (gammaLabel?.includes('NEGATIVE')) m += 0.10
  else if (gammaLabel?.includes('POSITIVE') && !gammaLabel?.includes('MILD')) m -= 0.05
  if (divergence?.level === 'SEVERE')   m -= 0.20
  else if (divergence?.level === 'MODERATE') m -= 0.10
  return +Math.max(0.5, Math.min(1.4, m)).toFixed(2)
}

export default function MarketBreadth({ data, isLoading, onRefresh, vixData, tradeScore }) {
  // Don't render until we have data or are actively loading
  if (!data && !isLoading) return null

  const verdict = data?.verdict ?? 'UNKNOWN'
  const cfg     = VERDICT_CFG[verdict] ?? VERDICT_CFG.UNKNOWN

  const { nyad, trin, hl, spy, qq, iwm, bullPts = 0, bearPts = 0, total = 0 } = data ?? {}

  const vixVal    = vixData?.current ?? null
  const vixRising = vixData?.rising  ?? false

  // ── Regime computations ───────────────────────────────────────────────────
  const corrRegime  = computeCorrelationRegime(vixVal, vixRising)
  const gammaRegime = computeGammaRegime(vixVal, vixRising)
  const playbook    = classifyPlaybook({ spy, qq, iwm, hl, nyad, trin, vixVal, vixRising })
  const volForward  = computeVolForward(vixVal, vixRising)
  const divergence  = computeBreadthDivergence({ spy, nyad, hl })

  // Cross-asset: QQQ vs IWM as risk-on/off signal + concentration proxy
  const techAbove65  = qq?.above65  ?? false
  const smallAbove65 = iwm?.above65 ?? false
  const techAbove200 = qq?.above200 ?? false
  const smallAbove200= iwm?.above200 ?? false
  let crossAsset = null
  if (qq && iwm) {
    if (techAbove65 && smallAbove65)   crossAsset = { label: 'BROAD RISK-ON',        color: '#10b981', bg: '#01120a', desc: 'Both tech (QQQ) and small caps (IWM) are above their 65-day EMA — market participation is broad. The risk-on signal is confirmed. Full size on CALL setups.' }
    else if (techAbove65 && !smallAbove65) crossAsset = { label: 'NARROW RISK-ON',   color: '#f59e0b', bg: '#0f0900', desc: 'QQQ above 65-day EMA but IWM is lagging — only mega-cap and tech are driving gains. Concentration risk is elevated. Prefer large-cap setups over small/mid. Trim CALL size by 15–20%.' }
    else if (!techAbove65 && smallAbove65) crossAsset = { label: 'DEFENSIVE BROADENING', color: '#60a5fa', bg: '#06111e', desc: 'IWM holding but QQQ lagging — defensive rotation, not a tech-led risk-on move. Skeptical environment for tech CALLs. Watch QQQ reclaim of 65-day for confirmation.' }
    else crossAsset = { label: 'RISK-OFF',                color: '#ef4444', bg: '#130305', desc: 'Both QQQ and IWM below 65-day EMA — the broad market is in a risk-off regime. No CALL setups until at least one major index reclaims its 65-day EMA.' }
  }

  // Concentration risk: if SPY holding but IWM lagging materially
  const concentrationRisk = spy?.above65 && !smallAbove65
  const concentrationSev  = spy?.above200 && !smallAbove200

  // Regime multiplier
  const mult = computeRegimeMultiplier({
    verdict,
    vixVal,
    vixRising,
    corrLabel:  corrRegime?.label,
    gammaLabel: gammaRegime?.label,
    divergence,
  })
  const multClr   = mult >= 1.1 ? '#10b981' : mult <= 0.8 ? '#ef4444' : mult <= 0.9 ? '#f59e0b' : '#60a5fa'
  const multLabel = mult >= 1.2 ? 'PRESS IT'
                  : mult >= 1.0 ? 'STANDARD'
                  : mult >= 0.8 ? 'REDUCE'
                  : 'STEP ASIDE'
  const multDesc  = mult >= 1.2 ? 'Regime is favoring options buyers. All factors align — run full size or slightly more on A+ setups.'
                  : mult >= 1.0 ? 'Regime is neutral to slightly favorable. Standard position sizing applies.'
                  : mult >= 0.8 ? 'Elevated regime risk. Reduce contract count by the multiplier to preserve capital.'
                  : 'Regime is hostile to directional options. Cut size sharply or sit in cash until conditions improve.'

  const baseQty   = tradeScore?.breakdown?.qty ?? null

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

          {/* ── INTELLIGENCE SECTION ─────────────────────────────────────── */}
          <div className="mb-intel-section">
            <div className="mb-intel-header">REGIME INTELLIGENCE</div>

            {/* Row 1: Correlation + Gamma */}
            <div className="mb-intel-row">
              {corrRegime && (
                <div className="mb-intel-card" style={{ background: corrRegime.bg, borderColor: corrRegime.color }}>
                  <div className="mb-intel-card-top">
                    <span className="mb-intel-tag" style={{ color: corrRegime.color }}>CORRELATION</span>
                    <span className="mb-intel-badge" style={{ color: corrRegime.color, borderColor: corrRegime.color }}>{corrRegime.label}</span>
                  </div>
                  <div className="mb-intel-desc">{corrRegime.desc}</div>
                </div>
              )}
              {gammaRegime && (
                <div className="mb-intel-card" style={{ background: gammaRegime.bg, borderColor: gammaRegime.color }}>
                  <div className="mb-intel-card-top">
                    <span className="mb-intel-tag" style={{ color: gammaRegime.color }}>GAMMA REGIME</span>
                    <span className="mb-intel-badge" style={{ color: gammaRegime.color, borderColor: gammaRegime.color }}>{gammaRegime.tag}</span>
                  </div>
                  <div className="mb-intel-label" style={{ color: gammaRegime.color }}>{gammaRegime.label}</div>
                  <div className="mb-intel-desc">{gammaRegime.desc}</div>
                </div>
              )}
            </div>

            {/* Row 2: Cross-asset + Concentration */}
            {crossAsset && (
              <div className="mb-intel-card mb-intel-card-full" style={{ background: crossAsset.bg, borderColor: crossAsset.color }}>
                <div className="mb-intel-card-top">
                  <span className="mb-intel-tag" style={{ color: crossAsset.color }}>CROSS-ASSET SIGNAL</span>
                  <span className="mb-intel-badge" style={{ color: crossAsset.color, borderColor: crossAsset.color }}>{crossAsset.label}</span>
                </div>
                <div className="mb-intel-desc">{crossAsset.desc}</div>
                {concentrationRisk && (
                  <div className="mb-concentration-warn" style={{ borderColor: concentrationSev ? '#ef4444' : '#f59e0b', color: concentrationSev ? '#ef4444' : '#f59e0b' }}>
                    {concentrationSev
                      ? 'CONCENTRATION RISK: SPY above 200-day but IWM is not. The index is being carried by large-cap and mega-cap only. This divergence historically resolves with either small caps recovering or the index rolling over.'
                      : 'CONCENTRATION NOTE: SPY holding 65-day EMA but small caps (IWM) are lagging. Reduce small/mid-cap exposure. Large-cap and tech setups are preferred in this environment.'}
                  </div>
                )}
                {/* Leading vs Lagging split */}
                <div className="mb-lead-lag">
                  <span className="mb-lead-lag-label">LEADING:</span>
                  <span className="mb-lead-lag-item" style={{ color: hl?.bullish ? '#10b981' : '#ef4444' }}>
                    New Highs/Lows ({hl ? `${hl.highs}H/${hl.lows}L` : '—'})
                  </span>
                  <span className="mb-lead-lag-sep">·</span>
                  <span className="mb-lead-lag-item" style={{ color: nyad?.trend === 'rising' ? '#10b981' : nyad?.trend === 'falling' ? '#ef4444' : '#f59e0b' }}>
                    A/D Line ({nyad?.trend ?? '—'})
                  </span>
                  <span className="mb-lead-lag-sep ml">LAGGING:</span>
                  <span className="mb-lead-lag-item" style={{ color: spy?.above65 ? '#10b981' : '#ef4444' }}>
                    Price vs EMA (SPY {spy?.above65 ? '▲' : '▼'} 65d)
                  </span>
                </div>
              </div>
            )}

            {/* Breadth divergence detector */}
            {divergence && (
              <div className="mb-divergence" style={{ borderColor: divergence.color, background: divergence.color === '#ef4444' ? '#130305' : '#0f0900' }}>
                <div className="mb-divergence-head" style={{ color: divergence.color }}>
                  ⚠ BREADTH DIVERGENCE — {divergence.level}
                </div>
                <div className="mb-divergence-desc">{divergence.desc}</div>
              </div>
            )}

            {/* Playbook classifier */}
            {playbook && (
              <div className="mb-playbook" style={{ background: playbook.bg, borderColor: playbook.color }}>
                <div className="mb-playbook-head">
                  <span className="mb-playbook-icon">{playbook.icon}</span>
                  <div>
                    <div className="mb-playbook-name" style={{ color: playbook.color }}>WHERE IN THE PLAYBOOK: {playbook.name}</div>
                    <div className="mb-playbook-dte">Optimal DTE: <strong style={{ color: playbook.color }}>{playbook.dte} days</strong></div>
                  </div>
                </div>
                <div className="mb-playbook-strategy">{playbook.strategy}</div>
                <div className="mb-playbook-next">Next signal: {playbook.next}</div>
              </div>
            )}

            {/* Volatility regime prediction */}
            {volForward && (
              <div className="mb-vol-regime" style={{ background: volForward.bg, borderColor: volForward.color }}>
                <div className="mb-vol-regime-head" style={{ color: volForward.color }}>
                  VOL REGIME — {volForward.label}
                </div>
                <div className="mb-vol-regime-desc">{volForward.desc}</div>
              </div>
            )}

            {/* Regime-adaptive position sizing multiplier */}
            <div className="mb-mult-card" style={{ borderColor: multClr, background: mult >= 1.1 ? '#01120a' : mult <= 0.8 ? '#130305' : '#06111e' }}>
              <div className="mb-mult-head">
                <span className="mb-mult-title">REGIME SIZE MULTIPLIER</span>
                <span className="mb-mult-badge" style={{ color: multClr, borderColor: multClr }}>{multLabel}</span>
              </div>
              <div className="mb-mult-body">
                <div className="mb-mult-value" style={{ color: multClr }}>{mult}×</div>
                <div className="mb-mult-factors">
                  <div className="mb-mult-factor-row">
                    <span className="mb-mult-factor-lbl">Market verdict</span>
                    <span className="mb-mult-factor-val" style={{ color: cfg.color }}>{verdict}</span>
                  </div>
                  {corrRegime && (
                    <div className="mb-mult-factor-row">
                      <span className="mb-mult-factor-lbl">Correlation</span>
                      <span className="mb-mult-factor-val" style={{ color: corrRegime.color }}>{corrRegime.label}</span>
                    </div>
                  )}
                  {gammaRegime && (
                    <div className="mb-mult-factor-row">
                      <span className="mb-mult-factor-lbl">Gamma</span>
                      <span className="mb-mult-factor-val" style={{ color: gammaRegime.color }}>{gammaRegime.label}</span>
                    </div>
                  )}
                  {divergence && (
                    <div className="mb-mult-factor-row">
                      <span className="mb-mult-factor-lbl">Breadth divergence</span>
                      <span className="mb-mult-factor-val" style={{ color: divergence.color }}>{divergence.level}</span>
                    </div>
                  )}
                </div>
                {baseQty != null ? (
                  <div className="mb-mult-qty">
                    Base qty: <strong>{baseQty}</strong> contracts → Regime-adjusted: <strong style={{ color: multClr }}>{Math.max(1, Math.round(baseQty * mult))}</strong>
                  </div>
                ) : null}
              </div>
              <div className="mb-mult-desc">{multDesc}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
