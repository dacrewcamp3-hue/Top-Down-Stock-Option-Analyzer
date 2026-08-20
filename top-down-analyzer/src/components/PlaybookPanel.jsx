import { useState, useEffect, useCallback } from 'react'
import './PlaybookPanel.css'

// Same regime detection as NilGuide — single source of truth via shared logic
function detectRegime(vixData, breadthData) {
  const vix     = vixData?.current ?? null
  const verdict = breadthData?.verdict ?? 'UNKNOWN'
  const spy     = breadthData?.spy
  if (!vix && verdict === 'UNKNOWN') return 'UNKNOWN'
  if (vix > 30 || verdict === 'HOSTILE') return 'BEAR'
  if (vix > 22 || verdict === 'LEANING BEARISH') return 'DEFENSIVE'
  if (spy?.above200 === false && spy?.above65 === false) return 'DEFENSIVE'
  if (vix != null && vix < 18 && (verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH')) return 'BULL'
  return 'NEUTRAL'
}

// ── ETF Regime Playbooks ──────────────────────────────────────────────────────
const PLAYBOOKS = {
  BULL: {
    color: '#10b981', bg: '#011c10', border: '#065f46',
    label: 'BULL RUN',
    tagline: 'Market is in bull mode. Play the trend — buy dips to EMA 15 (Dad), not breakouts.',
    play: [
      { ticker: 'QQQ',  name: 'Nasdaq 100', mult: '1×', role: 'Core', col: '#10b981',
        entry: 'Dip to Dad (EMA 15) while Sister (EMA 8) is rising and price is above Mom (EMA 65). DCA monthly regardless.',
        exit:  'Close below Brothers (EMA 30) — trim. Close below Mom (EMA 65) — exit entirely.' },
      { ticker: 'TQQQ', name: '3× Bull Nasdaq', mult: '3×', role: 'Leverage', col: '#34d399', risk: true,
        entry: 'High conviction only. Sister above Dad above Brothers — all three rising. Confirm QQQ above all 5 EMAs. Max 5% position.',
        exit:  'QQQ closes below Brothers (EMA 30) — exit immediately. No second chances. Leveraged ETFs do not forgive hesitation.' },
      { ticker: 'SPY',  name: 'S&P 500', mult: '1×', role: 'Core', col: '#6ee7b7',
        entry: 'Broader than QQQ. 500 companies. DCA approach — fixed monthly amount on schedule regardless of price.',
        exit:  'SPY below Mom (EMA 65) — start trimming. SPY below Grandma (EMA 200) — regime has changed, full exit.' },
      { ticker: 'UPRO', name: '3× Bull S&P 500', mult: '3×', role: 'Leverage', col: '#a7f3d0', risk: true,
        entry: 'Same as TQQQ but smoother — 500 stocks vs 100. SPY above all 5 EMAs stacked bull. Max 5%.',
        exit:  'SPY closes below Brothers (EMA 30) — exit. Grandma (EMA 200) break = full regime change, out immediately.' },
      { ticker: 'SOXL', name: '3× Bull Semiconductors', mult: '3×', role: 'Leverage', col: '#d1fae5', risk: true,
        entry: 'Semis lead tech higher. NVDA and AMD both above EMA 65 (Mom). SOXX index above all EMAs. Max 3% — extreme volatility.',
        exit:  'SOXX index closes below EMA 30 — exit. Chip sector moves violently on news. Always use a stop.' },
    ],
    avoid: ['SQQQ', 'SPXS', 'TZA', 'SDOW', 'SH', 'PSQ'],
    rules: [
      { icon: 'EMA', rule: 'Entry confirmation: Sister (8) above Dad (15) above Brothers (30) — all rising = aligned bull momentum.' },
      { icon: 'DIP', rule: 'Buy the dip to EMA 15 (Dad) or EMA 30 (Brothers), not breakouts to new highs.' },
      { icon: '5%',  rule: 'Max 5% position in any single leveraged ETF. They decay hard in sideways or choppy markets.' },
      { icon: 'CUT', rule: 'Exit leveraged positions the moment price closes below EMA 30 (Brothers). No second-guessing.' },
    ],
  },

  BEAR: {
    color: '#ef4444', bg: '#1a0505', border: '#7f1d1d',
    label: 'BEAR MARKET',
    tagline: 'Market is in bear mode. Inverse ETFs and defensive positioning only. Cash is a position.',
    play: [
      { ticker: 'SQQQ', name: '3× Bear Nasdaq', mult: '3×', role: 'Inverse', col: '#ef4444', risk: true,
        entry: 'QQQ below Grandma (EMA 200) with VIX above 25. Enter on a BOUNCE FAILURE — price retests EMA 30 from below and gets rejected. Max 5%.',
        exit:  'QQQ closes above Mom (EMA 65) — exit immediately. VIX above 35 = do not chase, volatility spikes hurt inverse ETFs too.' },
      { ticker: 'SPXS', name: '3× Bear S&P 500', mult: '3×', role: 'Inverse', col: '#f87171', risk: true,
        entry: 'SPY below Grandma (EMA 200) and breadth HOSTILE. Enter on failed retest of EMA 30 as resistance. Max 5%.',
        exit:  'SPY reclaims Mom (EMA 65) on a daily close — exit immediately. That is a regime change signal.' },
      { ticker: 'TZA',  name: '3× Bear Russell 2000', mult: '3×', role: 'Inverse', col: '#fca5a5', risk: true,
        entry: 'IWM (small caps) below all 5 EMAs with breadth HOSTILE. Small caps lead everything down. Max 3% — highest volatility.',
        exit:  'IWM reclaims EMA 30 on a close. Small caps also lead recoveries — exit fast when they turn.' },
      { ticker: 'SH',   name: 'Inverse S&P 500 (1×)', mult: '-1×', role: 'Hedge', col: '#fed7aa',
        entry: 'Safer bear play — no leverage decay. Better for multi-day positions or as a hedge on your long portfolio.',
        exit:  'SPY reclaims Grandma (EMA 200) — bear thesis over. Exit SH immediately and reassess regime.' },
      { ticker: 'GLD',  name: 'Gold ETF', mult: '1×', role: 'Safe Haven', col: '#fbbf24',
        entry: 'Fear trade. Hold 5-10% as insurance. Gold rises when confidence in markets collapses. Enter any time in BEAR regime.',
        exit:  'VIX falls below 18 and SPY reclaims EMA 65 — fear is fading. Trim gold, rotate back toward equities.' },
    ],
    avoid: ['QQQ', 'TQQQ', 'UPRO', 'SOXL', 'SPY long positions'],
    rules: [
      { icon: 'WAIT', rule: 'Enter inverse ETFs on BOUNCE FAILURES — when price retests EMA 30 from below and fails to hold.' },
      { icon: 'VIX',  rule: 'VIX above 35 = do not chase inverse ETFs. Extreme fear creates violent reversals that can wipe positions.' },
      { icon: 'CASH', rule: 'Cash is a position. In a bear market, sometimes the right play is no play at all.' },
      { icon: 'CUT',  rule: 'Exit ALL inverse ETFs the moment SPY reclaims EMA 65 on a daily close. Regime is changing.' },
    ],
  },

  DEFENSIVE: {
    color: '#f97316', bg: '#1a0800', border: '#7c2d12',
    label: 'DEFENSIVE MODE',
    tagline: 'Elevated risk — no leverage. Rotate to defensive sectors, hold cash, wait for clarity.',
    play: [
      { ticker: 'XLV',  name: 'Healthcare', mult: '1×', role: 'Defensive', col: '#ec4899',
        entry: 'XLV above EMA 65 (Mom). Non-cyclical — people need medicine in every recession. Consistent outperformer in defensive regimes.',
        exit:  'Regime clears to BULL (VIX below 18, breadth FAVORABLE) — rotate back to QQQ and growth ETFs.' },
      { ticker: 'XLU',  name: 'Utilities', mult: '1×', role: 'Defensive', col: '#f9a8d4',
        entry: 'Utilities above EMA 30 (Brothers). Pricing power and recurring dividends = stability in volatility.',
        exit:  'When XLK (Tech) starts outperforming (check Sectors tab) — market is rotating back to growth. Trim utilities.' },
      { ticker: 'XLP',  name: 'Consumer Staples', mult: '1×', role: 'Defensive', col: '#fbcfe8',
        entry: 'P&G, Costco, Walmart. People buy basics in every economy. XLP above EMA 30 is the entry condition.',
        exit:  'Market regime clears to BULL. Consumer discretionary (XLY) leading = rotate out of staples.' },
      { ticker: 'GLD',  name: 'Gold ETF', mult: '1×', role: 'Hedge', col: '#fbbf24',
        entry: '5-10% position as insurance. VIX rising and breadth deteriorating = add to gold. Holds value when markets dont.',
        exit:  'VIX falls below 18 and SPY reclaims EMA 65 (Mom). Fear is fading — gold typically peaks as confidence returns.' },
      { ticker: 'SCHD', name: 'Dividend ETF', mult: '1×', role: 'Income', col: '#f59e0b',
        entry: 'Income in any regime. DRIP on. Quarterly dividends continue compounding regardless of market direction.',
        exit:  'Never fully exit SCHD — it is a permanent foundation layer. Only trim to rebalance portfolio allocation.' },
    ],
    avoid: ['TQQQ', 'SOXL', 'UPRO', 'SQQQ', 'SPXS', 'any 3× leveraged ETF'],
    rules: [
      { icon: 'ZERO', rule: 'Zero leveraged ETFs in DEFENSIVE regime. Volatility decay destroys leveraged positions in uncertain markets.' },
      { icon: 'CASH', rule: 'Raise cash by trimming your most aggressive positions down to core long-term sizes.' },
      { icon: 'DRIP', rule: 'Keep SCHD and dividend ETFs running with DRIP on. Income keeps compounding in any regime.' },
      { icon: 'WAIT', rule: 'Wait for VIX below 20 AND SPY reclaiming Grandma (EMA 200) before rotating back to growth ETFs.' },
    ],
  },

  NEUTRAL: {
    color: '#f59e0b', bg: '#1a1000', border: '#78350f',
    label: 'MIXED MARKET',
    tagline: 'Mixed signals — DCA into core ETFs, no leverage, wait for direction clarity from the EMA stack.',
    play: [
      { ticker: 'SPY',  name: 'S&P 500', mult: '1×', role: 'Core', col: '#f59e0b',
        entry: 'DCA fixed monthly amount on schedule. Mixed market is exactly why you hold the foundation — it runs on autopilot.',
        exit:  'SPY below Mom (EMA 65) — reduce. SPY below Grandma (EMA 200) — regime shifted, reassess everything.' },
      { ticker: 'QQQ',  name: 'Nasdaq 100', mult: '1×', role: 'Core', col: '#fbbf24',
        entry: 'Hold existing position. Add on dips to EMA 65 only after Sister (EMA 8) has turned upward from that level.',
        exit:  'QQQ below Grandma (EMA 200) — cut exposure. Shift to SCHD and defensive until regime clears.' },
      { ticker: 'SCHD', name: 'Dividend ETF', mult: '1×', role: 'Income', col: '#fde68a',
        entry: 'All-weather income position. DCA monthly. Dividends keep compounding in any regime. DRIP on.',
        exit:  'Never fully exit. SCHD is a permanent foundation position — only trim to rebalance allocation.' },
      { ticker: 'VIG',  name: 'Dividend Growth ETF', mult: '1×', role: 'Income', col: '#fef3c7',
        entry: 'Growing dividends = financially strong companies. Resilient in mixed markets. Pair with SCHD for income layer.',
        exit:  'Only trim to rebalance. VIG is a core long-term hold across all regimes.' },
    ],
    avoid: ['Any 3× leveraged ETF in either direction — wait for the regime to declare itself'],
    rules: [
      { icon: 'DCA',    rule: 'Dollar-cost average into SPY and QQQ on a fixed monthly schedule. Do not try to time the dip.' },
      { icon: 'ZERO',   rule: 'No leverage in NEUTRAL regime. Wait for a clear EMA stack alignment before adding risk.' },
      { icon: 'INCOME', rule: 'Dividend income from SCHD keeps compounding regardless. Reinvest every dividend automatically.' },
      { icon: 'ROTATE', rule: 'Check the Sectors tab — which sector is outperforming SPY? Tilt 10-15% toward that leadership.' },
    ],
  },

  UNKNOWN: {
    color: '#4a6888', bg: '#0a1020', border: '#1e3456',
    label: 'DATA LOADING',
    tagline: 'Fetch breadth data to unlock the regime playbook and ETF recommendations.',
    play: [],
    avoid: [],
    rules: [
      { icon: '→', rule: 'Go to Scanner → Market Scan → click Refresh Breadth to load the current regime and unlock this playbook.' },
    ],
  },
}

// ── Market movers — curated ETF + equity universe ─────────────────────────────
const MOVER_UNIVERSE = [
  // Regime ETFs (both directions)
  'SPY', 'QQQ', 'IWM',
  'TQQQ', 'SQQQ',
  'UPRO', 'SPXS',
  'SOXL', 'TZA',
  // Defensive + Income
  'XLV', 'XLU', 'XLP', 'GLD', 'SCHD', 'VXX',
  // Market leaders
  'NVDA', 'AAPL', 'MSFT', 'META', 'TSLA', 'AMZN',
]

async function fetchMover(ticker) {
  try {
    const url = `/yf-api/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const r = json.chart?.result?.[0]
    if (!r) return null
    const q      = r.indicators?.quote?.[0] ?? {}
    const closes = (q.close  ?? []).filter(v => v != null)
    const vols   = q.volume  ?? []
    const n      = closes.length
    if (n < 2) return null
    const price   = closes[n - 1]
    const prevC   = closes[n - 2]
    const chg     = price - prevC
    const chgPct  = (chg / prevC) * 100
    const todVol  = vols[n - 1] ?? 0
    const avgVols = vols.slice(Math.max(0, n - 5), n - 1).filter(v => v != null)
    const avgVol  = avgVols.length ? avgVols.reduce((a, b) => a + b, 0) / avgVols.length : todVol
    const volRatio = avgVol > 0 ? todVol / avgVol : 1
    return { ticker, price: +price.toFixed(2), chg: +chg.toFixed(2), chgPct: +chgPct.toFixed(2), volRatio: +volRatio.toFixed(1) }
  } catch { return null }
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PlaybookPanel({ breadthData, vixData, onLoadTicker }) {
  const [movers,        setMovers]        = useState(null)
  const [moversLoading, setMoversLoading] = useState(false)
  const [lastFetched,   setLastFetched]   = useState(null)
  const [openPlay,      setOpenPlay]      = useState(null)
  const [moverView,     setMoverView]     = useState('gainers') // 'gainers' | 'losers' | 'all'

  const regime = detectRegime(vixData, breadthData)
  const pb     = PLAYBOOKS[regime]

  const vix     = vixData?.current
  const verdict = breadthData?.verdict ?? 'UNKNOWN'
  const spy     = breadthData?.spy
  const qq      = breadthData?.qq
  const iwm     = breadthData?.iwm

  const fetchMovers = useCallback(async () => {
    setMoversLoading(true)
    try {
      const results = await Promise.allSettled(MOVER_UNIVERSE.map(fetchMover))
      const data = results
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean)
        .sort((a, b) => b.chgPct - a.chgPct)
      setMovers(data)
      setLastFetched(new Date())
    } finally {
      setMoversLoading(false)
    }
  }, [])

  useEffect(() => { fetchMovers() }, [fetchMovers])

  const gainers = movers?.filter(m => m.chgPct > 0) ?? []
  const losers  = movers?.filter(m => m.chgPct < 0).slice().reverse() ?? []
  const displayed = moverView === 'gainers' ? gainers : moverView === 'losers' ? losers : movers ?? []

  return (
    <div className="pp-root">

      {/* ── 1. Regime Banner ── */}
      <div className="pp-regime" style={{ background: pb.bg, borderColor: pb.border }}>
        <div className="pp-regime-left">
          <div className="pp-regime-eyebrow">Current Market Regime</div>
          <div className="pp-regime-label" style={{ color: pb.color }}>{pb.label}</div>
          <div className="pp-regime-tagline">{pb.tagline}</div>
        </div>
        <div className="pp-regime-chips">
          {vix != null && (
            <div className="pp-chip">
              <div className="pp-chip-lbl">VIX</div>
              <div className="pp-chip-val" style={{ color: vix < 15 ? '#10b981' : vix < 22 ? '#f59e0b' : '#ef4444' }}>{vix.toFixed(1)}</div>
              <div className="pp-chip-sub">{vixData?.level ?? ''}</div>
            </div>
          )}
          {verdict !== 'UNKNOWN' && (
            <div className="pp-chip">
              <div className="pp-chip-lbl">BREADTH</div>
              <div className="pp-chip-val" style={{
                fontSize: 9,
                color: verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH' ? '#10b981'
                      : verdict === 'HOSTILE' || verdict === 'LEANING BEARISH' ? '#ef4444' : '#f59e0b'
              }}>{verdict}</div>
            </div>
          )}
          {spy && (
            <div className="pp-chip">
              <div className="pp-chip-lbl">SPY</div>
              <div className="pp-chip-val">${spy.price?.toFixed(0) ?? '—'}</div>
              <div className="pp-ema-pips">
                <span className={`pp-ema-pip ${spy.above200 ? 'bull' : 'bear'}`} title="EMA 200 — Grandma">G</span>
                <span className={`pp-ema-pip ${spy.above65  ? 'bull' : 'bear'}`} title="EMA 65 — Mom">M</span>
                <span className={`pp-ema-pip ${spy.above15  ? 'bull' : 'bear'}`} title="EMA 15 — Dad">D</span>
              </div>
            </div>
          )}
          {qq && (
            <div className="pp-chip">
              <div className="pp-chip-lbl">QQQ</div>
              <div className="pp-chip-val">${qq.price?.toFixed(0) ?? '—'}</div>
              <div className="pp-ema-pips">
                <span className={`pp-ema-pip ${qq.above200 ? 'bull' : 'bear'}`} title="EMA 200 — Grandma">G</span>
                <span className={`pp-ema-pip ${qq.above65  ? 'bull' : 'bear'}`} title="EMA 65 — Mom">M</span>
                <span className={`pp-ema-pip ${qq.above15  ? 'bull' : 'bear'}`} title="EMA 15 — Dad">D</span>
              </div>
            </div>
          )}
          {iwm && (
            <div className="pp-chip">
              <div className="pp-chip-lbl">IWM</div>
              <div className="pp-chip-val">${iwm.price?.toFixed(0) ?? '—'}</div>
              <div className="pp-ema-pips">
                <span className={`pp-ema-pip ${iwm.above200 ? 'bull' : 'bear'}`} title="EMA 200 — Grandma">G</span>
                <span className={`pp-ema-pip ${iwm.above65  ? 'bull' : 'bear'}`} title="EMA 65 — Mom">M</span>
                <span className={`pp-ema-pip ${iwm.above15  ? 'bull' : 'bear'}`} title="EMA 15 — Dad">D</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 2. ETF Playbook ── */}
      {pb.play.length > 0 && (
        <div className="pp-section">
          <div className="pp-section-hdr">
            <div>
              <div className="pp-section-title">ETF Playbook — What to Play Right Now</div>
              <div className="pp-section-sub">Tap any ETF for entry signal, exit rules, and position sizing. G = Grandma (EMA 200) · M = Mom (EMA 65) · D = Dad (EMA 15)</div>
            </div>
          </div>

          <div className="pp-play-list">
            {pb.play.map(etf => {
              const isOpen = openPlay === etf.ticker
              return (
                <div
                  key={etf.ticker}
                  className={`pp-play-card${isOpen ? ' pp-play-open' : ''}`}
                  style={{ borderLeftColor: etf.col }}
                  onClick={() => setOpenPlay(isOpen ? null : etf.ticker)}
                >
                  <div className="pp-play-top">
                    <div className="pp-play-ticker" style={{ color: etf.col }}>{etf.ticker}</div>
                    <div className="pp-play-meta">
                      <div className="pp-play-name">{etf.name}</div>
                      <div className="pp-play-badges">
                        <span className="pp-play-role">{etf.role}</span>
                        <span className="pp-play-mult">{etf.mult}</span>
                        {etf.risk && <span className="pp-play-risk">HIGH RISK</span>}
                      </div>
                    </div>
                    <span className="pp-play-arrow" style={{ color: etf.col }}>{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {isOpen && (
                    <div className="pp-play-detail">
                      <div className="pp-play-row">
                        <span className="pp-play-lbl pp-entry-lbl">ENTRY</span>
                        <span className="pp-play-txt">{etf.entry}</span>
                      </div>
                      <div className="pp-play-row">
                        <span className="pp-play-lbl pp-exit-lbl">EXIT</span>
                        <span className="pp-play-txt">{etf.exit}</span>
                      </div>
                      {etf.risk && (
                        <div className="pp-risk-note">
                          Leveraged ETF — only enter with high conviction and a pre-set exit price. Size ≤5%. Never add to a losing position.
                        </div>
                      )}
                      {onLoadTicker && (
                        <button
                          className="pp-load-btn"
                          style={{ borderColor: etf.col, color: etf.col }}
                          onClick={e => { e.stopPropagation(); onLoadTicker(etf.ticker) }}
                        >
                          Analyze {etf.ticker} →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Avoid list */}
          {pb.avoid.length > 0 && (
            <div className="pp-avoid">
              <span className="pp-avoid-lbl">AVOID IN THIS REGIME:</span>
              <div className="pp-avoid-tags">
                {pb.avoid.map((t, i) => <span key={i} className="pp-avoid-tag">{t}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 3. Regime Rules ── */}
      <div className="pp-section">
        <div className="pp-section-hdr">
          <div className="pp-section-title">Rules for This Regime</div>
        </div>
        <div className="pp-rules-grid">
          {pb.rules.map((r, i) => (
            <div key={i} className="pp-rule" style={{ borderLeftColor: pb.color }}>
              <div className="pp-rule-icon" style={{ color: pb.color }}>{r.icon}</div>
              <div className="pp-rule-text">{r.rule}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4. Market Movers ── */}
      <div className="pp-section">
        <div className="pp-section-hdr">
          <div>
            <div className="pp-section-title">Market Movers — Today</div>
            <div className="pp-section-sub">
              {lastFetched
                ? `Updated ${lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${MOVER_UNIVERSE.length} symbols tracked`
                : 'Curated universe: market ETFs, leverage plays, leaders'}
            </div>
          </div>
          <button className="pp-refresh-btn" onClick={fetchMovers} disabled={moversLoading}>
            {moversLoading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {/* View toggle */}
        <div className="pp-mover-toggle">
          {[['gainers', 'Gainers'], ['losers', 'Losers'], ['all', 'All']].map(([v, lbl]) => (
            <button
              key={v}
              className={`pp-mv-btn${moverView === v ? ' active' : ''}`}
              onClick={() => setMoverView(v)}
            >{lbl}</button>
          ))}
        </div>

        {moversLoading && <div className="pp-movers-loading">Fetching prices…</div>}

        {!moversLoading && movers && (
          <div className="pp-movers-list">
            {displayed.map(m => {
              const isGain = m.chgPct >= 0
              const col    = isGain ? '#10b981' : '#ef4444'
              const sign   = isGain ? '+' : ''
              const unusualVol = m.volRatio >= 2.0
              const highVol    = m.volRatio >= 1.5 && !unusualVol
              return (
                <div
                  key={m.ticker}
                  className="pp-mover-row"
                  onClick={() => onLoadTicker?.(m.ticker)}
                  title={`Click to analyze ${m.ticker}`}
                >
                  <span className="pp-mover-ticker">{m.ticker}</span>
                  <span className="pp-mover-price">${m.price.toFixed(2)}</span>
                  <span className="pp-mover-pct" style={{ color: col }}>
                    {sign}{m.chgPct.toFixed(2)}%
                  </span>
                  <span className="pp-mover-chg" style={{ color: col }}>
                    {isGain ? '+' : ''}{m.chg.toFixed(2)}
                  </span>
                  {unusualVol && (
                    <span className="pp-mover-vol pp-vol-unusual" title={`Volume ${m.volRatio}× the 4-day average — unusual activity`}>
                      {m.volRatio.toFixed(1)}× vol
                    </span>
                  )}
                  {highVol && (
                    <span className="pp-mover-vol pp-vol-high" title={`Volume ${m.volRatio}× the 4-day average`}>
                      {m.volRatio.toFixed(1)}× vol
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!moversLoading && movers && movers.length === 0 && (
          <div className="pp-movers-empty">No price data available. Market may be closed.</div>
        )}
      </div>

    </div>
  )
}
