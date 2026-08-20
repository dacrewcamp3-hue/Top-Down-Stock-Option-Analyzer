import { useState, useEffect, useRef } from 'react'
import { fetchQuickSignal } from '../utils/fetchQuickSignal'
import './WatchlistBoard.css'

const GRADE_ORDER = { 'A+': 0, A: 1, B: 2, C: 3 }

function scoreGrade(score) {
  if (score >= 75) return { g: 'A+', color: '#10b981' }
  if (score >= 63) return { g: 'A',  color: '#34d399' }
  if (score >= 50) return { g: 'B',  color: '#f59e0b' }
  return { g: 'C', color: '#6b7280' }
}

function Bar52({ pct }) {
  const fill = Math.max(0, Math.min(100, pct ?? 50))
  const clr  = fill >= 70 ? '#10b981' : fill <= 30 ? '#ef4444' : '#f59e0b'
  return (
    <span className="wlb-bar-wrap">
      <span className="wlb-bar-track">
        <span className="wlb-bar-fill" style={{ width: `${fill}%`, background: clr }} />
      </span>
      <span className="wlb-bar-pct" style={{ color: clr }}>{fill}%</span>
    </span>
  )
}

const AUTO_REFRESH_MS = 5 * 60 * 1000  // 5 minutes

export default function WatchlistBoard({ watchlist, onLoadTicker }) {
  const [results,     setResults]     = useState([])
  const [scanning,    setScanning]    = useState(false)
  const [scannedAt,   setScannedAt]   = useState(null)
  const [sortKey,     setSortKey]     = useState('score')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [nextRefresh, setNextRefresh] = useState(null)  // timestamp
  const [newSignals,  setNewSignals]  = useState({})    // ticker → true when ORB upgraded
  const ranOnce    = useRef(false)
  const prevOrbRef = useRef({})

  async function scanAll() {
    if (!watchlist.length || scanning) return
    setScanning(true)
    const rows = await Promise.all(watchlist.map(w => fetchQuickSignal(w.ticker)))

    // Detect ORB upgrades since last scan
    const upgraded = {}
    const PRIORITY = { ENTER: 0, RETEST: 1, RECAPTURED: 2, BREAK: 3, INSIDE: 4 }
    rows.forEach(r => {
      const prev = prevOrbRef.current[r.ticker]
      const cur  = r.orb?.signal
      if (prev != null && cur != null) {
        const prevP = PRIORITY[prev] ?? 5
        const curP  = PRIORITY[cur]  ?? 5
        if (curP < prevP) upgraded[r.ticker] = true
      }
      if (cur) prevOrbRef.current[r.ticker] = cur
    })
    if (Object.keys(upgraded).length) {
      setNewSignals(prev => ({ ...prev, ...upgraded }))
      setTimeout(() => setNewSignals(prev => {
        const next = { ...prev }
        Object.keys(upgraded).forEach(t => delete next[t])
        return next
      }), 30_000)
    }

    setResults(rows)
    setScannedAt(new Date())
    setScanning(false)
  }

  useEffect(() => {
    if (watchlist.length && !ranOnce.current) {
      ranOnce.current = true
      scanAll()
    }
  }, [watchlist.length])

  // Auto-refresh every 5 minutes when enabled
  useEffect(() => {
    if (!autoRefresh) { setNextRefresh(null); return }
    const next = Date.now() + AUTO_REFRESH_MS
    setNextRefresh(next)
    const id = setInterval(() => { scanAll(); setNextRefresh(Date.now() + AUTO_REFRESH_MS) }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh, watchlist.length])

  if (!watchlist.length) {
    return (
      <div className="wlb-empty">
        <div className="wlb-empty-icon">📋</div>
        <div className="wlb-empty-title">No tickers on your watchlist</div>
        <div className="wlb-empty-sub">
          Load a ticker and use the + button in the watchlist bar to add it.
          Come back here before the market opens for a ranked signal scan.
        </div>
      </div>
    )
  }

  const sorted = [...results].sort((a, b) => {
    if (sortKey === 'score')  return b.score  - a.score
    if (sortKey === 'grade') {
      const ga = scoreGrade(a.score)
      const gb = scoreGrade(b.score)
      return (GRADE_ORDER[ga.g] ?? 9) - (GRADE_ORDER[gb.g] ?? 9)
    }
    if (sortKey === 'signal') {
      const order = { CALL: 0, PUT: 1, 'NO TRADE': 2, 'NO DATA': 3, ERROR: 4 }
      return (order[a.signal] ?? 9) - (order[b.signal] ?? 9)
    }
    if (sortKey === '52wk') return (b.pct52 ?? 50) - (a.pct52 ?? 50)
    if (sortKey === 'orb') {
      const p = s => ({ ENTER: 0, RETEST: 1, RECAPTURED: 2, BREAK: 3, INSIDE: 4 }[s] ?? 5)
      return p(a.orb?.signal) - p(b.orb?.signal)
    }
    return 0
  })

  return (
    <div className="wlb-root">
      <div className="wlb-header">
        <div>
          <div className="wlb-title">PRE-MARKET WATCHLIST</div>
          <div className="wlb-sub">
            {scannedAt
              ? `Scanned ${watchlist.length} ticker${watchlist.length !== 1 ? 's' : ''} · ${scannedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : `${watchlist.length} ticker${watchlist.length !== 1 ? 's' : ''} queued`
            }
            {autoRefresh && nextRefresh && (
              <span className="wlb-next-refresh">
                · next refresh {new Date(nextRefresh).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className={`wlb-auto-btn${autoRefresh ? ' wlb-auto-on' : ''}`}
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Auto-refresh ON — click to disable' : 'Enable auto-refresh every 5 min'}
          >
            {autoRefresh ? '⏱ Auto ON' : '⏱ Auto'}
          </button>
          <button
            className={`wlb-scan-btn${scanning ? ' wlb-scanning' : ''}`}
            onClick={scanAll}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : '↻ Scan All'}
          </button>
        </div>
      </div>

      {scanning && results.length === 0 ? (
        <div className="wlb-loading">
          Fetching weekly + daily signals for {watchlist.length} ticker{watchlist.length !== 1 ? 's' : ''}…
        </div>
      ) : results.length > 0 ? (
        <>
          <div className="wlb-legend">
            <span>Sort:</span>
            {[
              ['score',  'Score',  'Sort by Trade Score — highest conviction setups ranked first.'],
              ['signal', 'Signal', 'Sort by signal direction — CALLs first, then PUTs, then NO TRADE.'],
              ['grade',  'Grade',  'Sort by signal grade — A+ setups first, weakest last.'],
              ['52wk',   '52-Wk',  'Sort by 52-week position — price relative to its annual range.'],
              ['orb',    'ORB',    'Sort by ORB signal — ENTER and RETEST setups ranked first.'],
            ].map(([k, l, tip]) => (
              <button
                key={k}
                className={`wlb-sort-btn${sortKey === k ? ' active' : ''}`}
                onClick={() => setSortKey(k)}
                data-tip={tip}
              >{l}</button>
            ))}
          </div>

          <div className="wlb-grid">
            <div className="wlb-grid-head">
              <span data-tip="Rank — position in the current sort order. #1 = strongest by the selected column.">#</span>
              <span data-tip="Ticker — click any row to load that stock for full analysis.">TICKER</span>
              <span data-tip="Signal — multi-timeframe direction. CALL = bullish setup. PUT = bearish setup. NO TRADE = signals conflict or are too weak.">SIGNAL</span>
              <span data-tip="Trade Score (0–100) — composite signal strength. ≥75 = A+, ≥63 = A, ≥50 = B, below = C. Higher = stronger setup.">SCORE</span>
              <span data-tip="Grade — A+ = strongest setup (≥75 score), A = solid (63–74), B = moderate (50–62), C = weak or conflicting (below 50).">GRADE</span>
              <span data-tip="52-Week Position — where the price sits within its 52-week range. Far left = near annual low. Far right = near annual high.">52-WK POS</span>
              <span data-tip="Weekly RSI (14) — momentum on the weekly chart. ≥ 44 = weekly trend is bullish. 30–44 = bear zone. Below 30 = oversold.">W RSI</span>
              <span data-tip="Daily RSI (14) — momentum on the daily chart. ≥ 44 = bullish momentum. 30–44 = bear zone. Below 30 = oversold.">D RSI</span>
              <span data-tip="Intermediate Cycle Phase — the 3–6 month market cycle this stock is in. Accumulation/Expansion = good to buy. Distribution/Contraction = avoid or wait.">CYCLE</span>
              <span data-tip="Opening Range Breakout — ENTER: confirmed break + retest. RETEST: testing the level. BREAK: broken out, awaiting retest. RECAPTURED: level reclaimed after a loss. FAILED: retest reversed. INSIDE: no breakout yet.">ORB</span>
            </div>
            {sorted.map((r, i) => {
              const sigClr = r.signal === 'CALL' ? '#10b981' : r.signal === 'PUT' ? '#ef4444' : '#6b7280'
              const { g, color } = scoreGrade(r.score)
              const sigTip = r.signal === 'CALL'
                ? 'CALL — weekly and daily timeframes align bullishly. Consider buying call options.'
                : r.signal === 'PUT'
                  ? 'PUT — weekly and daily timeframes align bearishly. Consider buying put options.'
                  : 'NO TRADE — signals conflict or are too weak. Cash is a position — sit out.'
              const gradeTip = g === 'A+' ? 'A+ — strongest possible setup. All key conditions align.' : g === 'A' ? 'A — solid setup. Most conditions align.' : g === 'B' ? 'B — moderate setup. Some conditions align, some don\'t.' : 'C — weak or conflicting signals. Wait for better conditions.'
              const rsiWTip = r.wRSI != null ? `Weekly RSI: ${r.wRSI.toFixed(0)}. ${r.wRSI >= 44 ? 'Bullish zone — at or above the 44 threshold.' : r.wRSI >= 30 ? 'Bear zone — RSI 30–44.' : 'Oversold — below 30.'}` : 'Weekly RSI not available.'
              const rsiDTip = r.dRSI != null ? `Daily RSI: ${r.dRSI.toFixed(0)}. ${r.dRSI >= 44 ? 'Bullish momentum on the daily chart.' : r.dRSI >= 30 ? 'Bear zone — RSI 30–44.' : 'Oversold — below 30.'}` : 'Daily RSI not available.'
              const cycleTip = r.cyclePhase ? `Cycle phase: ${r.cyclePhase}. ${r.cyclePhase === 'Accumulation' ? 'Early buying phase — smart money is positioning.' : r.cyclePhase === 'Expansion' ? 'Uptrend phase — best time to hold calls.' : r.cyclePhase === 'Distribution' ? 'Late uptrend — risk is rising, consider taking profits.' : r.cyclePhase === 'Contraction' ? 'Downtrend phase — avoid calls, consider puts or cash.': 'Monitor for cycle direction.'}` : 'Cycle data not available.'
              return (
                <div key={r.ticker}
                  className={`wlb-row${newSignals[r.ticker] ? ' wlb-row-new' : ''}`}
                  onClick={() => onLoadTicker?.(r.ticker)}
                  data-tip={`${r.ticker} — click to load for full analysis.`}>
                  <span className="wlb-rank">{i + 1}</span>
                  <span className="wlb-ticker">{r.ticker}</span>
                  <span className="wlb-sig" style={{ color: sigClr }} data-tip={sigTip}>
                    {r.signal === 'CALL' ? '▲ CALL' : r.signal === 'PUT' ? '▼ PUT' : r.signal}
                  </span>
                  <span className="wlb-score" style={{ color }}
                    data-tip={`Quick Scan Score: ${r.score}% of checks passing. ${r.score >= 75 ? 'A+ — strong alignment across key filters.' : r.score >= 63 ? 'A — solid setup, most signals agree. CALL/PUT signal active.' : r.score >= 50 ? 'B — moderate setup, some signals missing.' : 'C — weak or conflicting signals. Wait for better conditions.'}`}>
                    {r.score}
                  </span>
                  <span className="wlb-grade" style={{ color, borderColor: color, background: `${color}18` }} data-tip={gradeTip}>{g}</span>
                  <span data-tip={`52-week position: ${r.pct52 ?? 50}%. ${(r.pct52 ?? 50) >= 70 ? 'Near annual highs — strong momentum or extended.' : (r.pct52 ?? 50) <= 30 ? 'Near annual lows — potential value or downtrend.' : 'Mid-range — no extreme positioning.'}`}>
                    <Bar52 pct={r.pct52} />
                  </span>
                  <span className="wlb-rsi" style={{ color: (r.wRSI ?? 0) >= 44 ? '#10b981' : '#ef4444' }} data-tip={rsiWTip}>
                    {r.wRSI != null ? r.wRSI.toFixed(0) : '—'}
                  </span>
                  <span className="wlb-rsi" style={{ color: (r.dRSI ?? 0) >= 44 ? '#10b981' : '#ef4444' }} data-tip={rsiDTip}>
                    {r.dRSI != null ? r.dRSI.toFixed(0) : '—'}
                  </span>
                  <span className="wlb-cycle" style={{ color: r.cycleColor ?? '#3a5a7a' }} data-tip={cycleTip}>
                    {r.cyclePhase ?? '—'}
                  </span>
                  {(() => {
                    const orbSig = r.orb?.signal
                    const orbClr = orbSig === 'ENTER'      ? '#10b981'
                                 : orbSig === 'RETEST'     ? '#f59e0b'
                                 : orbSig === 'RECAPTURED' ? '#34d399'
                                 : orbSig === 'BREAK'      ? '#60a5fa'
                                 : orbSig === 'FAILED'     ? '#ef4444'
                                 : '#3a5a7a'
                    const orbTip = orbSig === 'ENTER'      ? 'ENTER — confirmed ORB retest. High-probability entry signal.'
                                 : orbSig === 'RETEST'     ? 'RETEST — price is testing the ORB level. Watch for confirmation.'
                                 : orbSig === 'RECAPTURED' ? 'RECAPTURED — price reclaimed the ORB after losing it.'
                                 : orbSig === 'BREAK'      ? 'BREAK — broke the opening range but no retest yet.'
                                 : orbSig === 'INSIDE'     ? 'INSIDE — price is still within the opening range.'
                                 : orbSig === 'FAILED'     ? 'FAILED — breakout attempt reversed.'
                                 : 'ORB data not yet available.'
                    return (
                      <span className="wlb-orb" style={{ color: orbClr }} data-tip={orbTip}>
                        {orbSig ?? '—'}
                      </span>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}
