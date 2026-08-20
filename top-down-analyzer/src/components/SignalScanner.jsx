import { useState, useCallback, useEffect, useRef } from 'react'
import { scanSignals } from '../utils/fetchQuickSignal'
import { UNIVERSE } from '../utils/runScanner'
import { playTone } from '../utils/audioAlerts'
import './SignalScanner.css'

const SIG_COLOR = { CALL: '#10b981', PUT: '#ef4444', 'NO TRADE': '#4a6888', 'NO DATA': '#3a5070', ERROR: '#3a5070' }
const SIG_BG    = { CALL: '#052010', PUT: '#140508', 'NO TRADE': '#060c18', 'NO DATA': '#060c18', ERROR: '#060c18' }

// ORB badge config — bull direction (or no break yet)
const ORB_BULL = {
  ENTER:      { label: '▲ ENTER',   color: '#10b981', bg: '#051810' },
  RETEST:     { label: '◉ RETEST',  color: '#f59e0b', bg: '#1a1000' },
  RECAPTURED: { label: '▲ RECAP',   color: '#34d399', bg: '#051810' },
  BREAK:      { label: '↑ BREAK',   color: '#60a5fa', bg: '#04101c' },
  INSIDE:     { label: '— INSIDE',  color: '#2a4060', bg: 'transparent' },
  FAILED:     { label: '✕ FAILED',  color: '#4a6380', bg: 'transparent' },
  LOST:       { label: '↓ LOST',    color: '#ef4444', bg: 'transparent' },
}
// ORB badge config — bear direction
const ORB_BEAR = {
  ENTER:      { label: '▼ ENTER',   color: '#ef4444', bg: '#140508' },
  RETEST:     { label: '◉ RETEST',  color: '#f59e0b', bg: '#1a1000' },
  RECAPTURED: { label: '▼ RECAP',   color: '#f87171', bg: '#140508' },
  BREAK:      { label: '↓ BREAK',   color: '#60a5fa', bg: '#04101c' },
}

function OrbBadge({ orb }) {
  if (!orb) return <span className="ss-orb-dim">—</span>
  const map = (orb.breakDir === 'bear' && ORB_BEAR[orb.signal]) ? ORB_BEAR : ORB_BULL
  const cfg = map[orb.signal] ?? ORB_BULL['INSIDE']
  return (
    <span className="ss-orb-badge" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.color + '40' }}>
      {cfg.label}
    </span>
  )
}

function ScoreBar({ score }) {
  const pct = Math.max(0, Math.min(100, score))
  const col = pct >= 63 ? '#10b981' : pct <= 37 ? '#ef4444' : '#4a6888'
  return (
    <div className="ss-bar-wrap">
      <div className="ss-bar-fill" style={{ width: `${pct}%`, background: col }} />
    </div>
  )
}

function ResultRow({ r, onLoad }) {
  const sigCol = SIG_COLOR[r.signal] ?? '#4a6888'
  const sigBg  = SIG_BG[r.signal]   ?? '#060c18'
  return (
    <div className={`ss-row${r.error ? ' ss-row-err' : ''}`} onClick={() => !r.error && onLoad?.(r.ticker)}>
      <span className="ss-ticker">{r.ticker}</span>
      <OrbBadge orb={r.orb} />
      <span className="ss-sig-badge" style={{ color: sigCol, background: sigBg }}>{r.signal}</span>
      <div className="ss-score-wrap">
        <ScoreBar score={r.score} />
        <span className="ss-score-num">{r.score}%</span>
      </div>
      <div className="ss-metrics">
        <span className="ss-metric">
          <span className="ss-metric-l">WRSI</span>
          <span className={`ss-metric-v${r.wRSI > 50 ? ' ss-green' : ' ss-red'}`}>{r.wRSI?.toFixed(0) ?? '—'}</span>
        </span>
        <span className="ss-metric">
          <span className="ss-metric-l">DRSI</span>
          <span className={`ss-metric-v${r.dRSI > 50 ? ' ss-green' : ' ss-red'}`}>{r.dRSI?.toFixed(0) ?? '—'}</span>
        </span>
        <span className="ss-metric">
          <span className="ss-metric-l">AVG VOL</span>
          <span className={`ss-metric-v${(r.avgVol ?? 0) >= 10_000_000 ? ' ss-green' : ' ss-vol-low'}`}>
            {r.avgVol != null
              ? r.avgVol >= 1_000_000 ? `${(r.avgVol / 1_000_000).toFixed(1)}M` : `${(r.avgVol / 1_000).toFixed(0)}K`
              : '—'}
          </span>
        </span>
      </div>
      {r.cyclePhase
        ? <span className="ss-cycle" style={{ color: r.cycleColor }}>{r.cyclePhase}</span>
        : <span />
      }
      <span className="ss-price">${r.price?.toFixed(2) ?? '—'}</span>
    </div>
  )
}

const AUTO_REFRESH_SEC = 300  // 5 minutes

export default function SignalScanner({ watchlist = [], onLoadTicker }) {
  // Always scan the full market preset + any watchlist additions (merged, deduped)
  const defaultList = [...new Set([...UNIVERSE, ...watchlist.map(w => w.ticker)])]

  const [tickers,     setTickers]     = useState(defaultList)
  const [input,       setInput]       = useState('')
  const [status,      setStatus]      = useState('idle')
  const [progress,    setProgress]    = useState({ done: 0, total: 0 })
  const [results,     setResults]     = useState([])
  const [filter,      setFilter]      = useState('orb')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [countdown,   setCountdown]   = useState(null)

  const statusRef   = useRef('idle')
  const tickersRef  = useRef(tickers)
  const autoScanned = useRef(false)
  const timerRef    = useRef(null)

  useEffect(() => { statusRef.current  = status  }, [status])
  useEffect(() => { tickersRef.current = tickers }, [tickers])

  // Core scan function — always reads latest tickers via ref
  const runScan = useCallback(async () => {
    if (statusRef.current === 'running') return
    const list = tickersRef.current
    if (!list.length) return
    setStatus('running')
    statusRef.current = 'running'
    setResults([])
    setProgress({ done: 0, total: list.length })

    const res = await scanSignals(list, (done, total) => setProgress({ done, total }))
    setResults(res)
    setStatus('done')
    statusRef.current = 'done'

    // Notification for actionable ORB setups or strong swing signals
    const alerts = res.filter(r =>
      r.orb?.signal === 'ENTER' || r.orb?.signal === 'RETEST' ||
      (r.signal === 'CALL' && r.score >= 75) ||
      (r.signal === 'PUT'  && r.score <= 25)
    )
    if (alerts.length) {
      playTone('scan')
      if (Notification.permission === 'granted') {
        new Notification('Top-Down Analyzer — Signal Alert', {
          body: `Setups: ${alerts.map(r => r.ticker).join(', ')}`,
          icon: '/favicon.ico',
        })
      }
    }
  }, [])

  // Auto-scan on mount — no click required
  useEffect(() => {
    if (!autoScanned.current && tickers.length > 0) {
      autoScanned.current = true
      runScan()
    }
  }, []) // eslint-disable-line

  // Auto-refresh countdown — every 5 minutes
  useEffect(() => {
    clearInterval(timerRef.current)
    if (!autoRefresh) { setCountdown(null); return }

    setCountdown(AUTO_REFRESH_SEC)
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          runScan()
          return AUTO_REFRESH_SEC
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [autoRefresh, runScan])

  function addTickers() {
    const syms = input.toUpperCase().split(/[\s,]+/).filter(Boolean)
    if (syms.length) setTickers(prev => [...new Set([...prev, ...syms])])
    setInput('')
  }

  function removeTicker(t) {
    setTickers(prev => prev.filter(x => x !== t))
    setResults(prev => prev.filter(r => r.ticker !== t))
  }

  const pct      = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0
  const orbSetups = results.filter(r =>
    r.orb?.signal === 'ENTER' || r.orb?.signal === 'RETEST' || r.orb?.signal === 'RECAPTURED'
  )
  const calls = results.filter(r => r.signal === 'CALL')
  const puts  = results.filter(r => r.signal === 'PUT')

  const visible = filter === 'orb'  ? orbSetups
    : filter === 'CALL' ? calls
    : filter === 'PUT'  ? puts
    : results

  const fmtCountdown = s => s != null
    ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    : null

  return (
    <div className="ss-root">

      {/* Header */}
      <div className="ss-header">
        <div className="ss-header-left">
          <span className="ss-title">Signal Scanner</span>
          <span className="ss-sub">
            {tickers.length} tickers · 15m ORB + weekly/daily trend · click any row to analyze
          </span>
        </div>
        <div className="ss-header-right">
          {Notification.permission === 'default' && (
            <button className="ss-notif-btn" onClick={() => Notification.requestPermission()}>🔔 Alerts</button>
          )}
          {Notification.permission === 'granted' && (
            <span className="ss-notif-on">🔔</span>
          )}
          <button
            className={`ss-refresh-toggle${autoRefresh ? ' ss-refresh-on' : ''}`}
            onClick={() => setAutoRefresh(v => !v)}
            title="Toggle 5-minute auto-refresh"
          >
            ↺ {autoRefresh && countdown != null ? fmtCountdown(countdown) : 'Auto'}
          </button>
          <button
            className={`ss-scan-btn${status === 'running' ? ' ss-scanning' : ''}`}
            onClick={runScan}
            disabled={status === 'running' || tickers.length === 0}
          >
            {status === 'running' ? `${pct}%` : '↺ Scan'}
          </button>
        </div>
      </div>

      {/* Ticker chips */}
      <div className="ss-ticker-list">
        {tickers.map(t => (
          <span key={t} className="ss-chip">
            {t}
            <button className="ss-chip-rm" onClick={() => removeTicker(t)}>×</button>
          </span>
        ))}
      </div>

      {/* Add ticker */}
      <div className="ss-controls">
        <input
          className="ss-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTickers()}
          placeholder="Add tickers: AAPL TSLA NVDA"
        />
        <button className="ss-add-btn" onClick={addTickers}>Add</button>
      </div>

      {/* Progress bar */}
      {status === 'running' && (
        <div className="ss-progress-wrap">
          <div className="ss-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* Filter tabs */}
      {results.length > 0 && (
        <div className="ss-summary">
          <button
            className={`ss-filter-btn ss-filter-orb${filter === 'orb' ? ' active' : ''}`}
            onClick={() => setFilter('orb')}
          >
            ORB Setups {orbSetups.length > 0 && `(${orbSetups.length})`}
          </button>
          <button
            className={`ss-filter-btn${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({results.length})
          </button>
          <button
            className={`ss-filter-btn ss-filter-call${filter === 'CALL' ? ' active' : ''}`}
            onClick={() => setFilter('CALL')}
          >
            CALL ({calls.length})
          </button>
          <button
            className={`ss-filter-btn ss-filter-put${filter === 'PUT' ? ' active' : ''}`}
            onClick={() => setFilter('PUT')}
          >
            PUT ({puts.length})
          </button>
        </div>
      )}

      {/* Results */}
      {visible.length > 0 && (
        <div className="ss-results">
          <div className="ss-results-hdr">
            <span>Ticker</span>
            <span>15m ORB</span>
            <span>Trend</span>
            <span>Bull Score</span>
            <span>Indicators</span>
            <span>Cycle</span>
            <span>Price</span>
          </div>
          {visible.map(r => (
            <ResultRow key={r.ticker} r={r} onLoad={onLoadTicker} />
          ))}
        </div>
      )}

      {/* Empty states */}
      {results.length > 0 && visible.length === 0 && filter === 'orb' && (
        <div className="ss-empty">
          No active ORB setups right now — market may be in pre-market, or all tickers are still inside the opening range.
          Try <strong>All</strong> to see the full trend signals.
        </div>
      )}
      {status === 'done' && results.length === 0 && (
        <div className="ss-empty">No results returned. Check your ticker list or network.</div>
      )}
      {status === 'running' && (
        <div className="ss-idle">
          Scanning {progress.done} / {progress.total} tickers for 15m ORB + trend signals…
        </div>
      )}
      {status === 'idle' && (
        <div className="ss-idle">
          Fetching signals for {tickers.length} tickers — ORB setups appear when the market is open and price breaks the opening range.
        </div>
      )}

    </div>
  )
}
