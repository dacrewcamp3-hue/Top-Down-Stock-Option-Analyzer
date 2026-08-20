import { useState, useRef, useEffect, useCallback } from 'react'
import { UNIVERSE, SECTOR_ETFS, SECTOR_STOCKS, runScanner } from '../utils/runScanner'
import './Scanner.css'

const SCAN_CACHE_KEY = 'tdsa-scanner-results'

function loadCache() {
  try {
    const raw = localStorage.getItem(SCAN_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function isMarketOpen() {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const etStr = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [h, m] = etStr.split(':').map(Number)
  const etMin  = h * 60 + m
  return etMin >= 570 && etMin < 960
}

function sortResults(arr, col, dir) {
  return [...arr].sort((a, b) => {
    if (!a.ok && !b.ok) return 0
    if (!a.ok) return 1
    if (!b.ok) return -1
    const gradeRank = { 'A+': 4, A: 3, B: 2, C: 1 }
    const sigRank   = { CALL: 2, PUT: 1, 'NO TRADE': 0 }
    let av, bv
    switch (col) {
      case 'ticker':    av = a.ticker;                    bv = b.ticker;                    break
      case 'price':     av = a.price     ?? -Infinity;   bv = b.price     ?? -Infinity;   break
      case 'pctChange': av = a.pctChange ?? -Infinity;   bv = b.pctChange ?? -Infinity;   break
      case 'signal':    av = sigRank[a.signal]  ?? 0;   bv = sigRank[b.signal]  ?? 0;   break
      case 'grade':     av = gradeRank[a.grade] ?? 0;   bv = gradeRank[b.grade] ?? 0;   break
      case 'volSpike':  av = a.volSpike  ?? -Infinity;   bv = b.volSpike  ?? -Infinity;   break
      case 'rsi':       av = a.rsi       ?? -Infinity;   bv = b.rsi       ?? -Infinity;   break
      default:          av = Math.abs(a.rawConf ?? 0);   bv = Math.abs(b.rawConf ?? 0);   break
    }
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return dir === 'asc' ? av - bv : bv - av
  })
}

async function fetchATMIV(ticker, price) {
  try {
    const res = await fetch(`/yf-api/v7/finance/options/${encodeURIComponent(ticker)}`)
    if (!res.ok) return null
    const json = await res.json()
    const chain = json?.optionChain?.result?.[0]?.options?.[0]
    if (!chain) return null
    const all = [...(chain.calls ?? []), ...(chain.puts ?? [])]
    const atm = all
      .filter(o => o.impliedVolatility > 0)
      .sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))
    if (!atm.length) return null
    return Math.round(atm[0].impliedVolatility * 100)
  } catch { return null }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SignalBadge({ signal }) {
  const cfg = {
    CALL:       { color: '#10b981', bg: '#001a0d', border: '#064e2e' },
    PUT:        { color: '#ef4444', bg: '#1a0000', border: '#6b0000' },
    'NO TRADE': { color: '#6b7280', bg: '#0f1623', border: '#1e2d45' },
  }[signal] ?? { color: '#6b7280', bg: '#0f1623', border: '#1e2d45' }
  return (
    <span className="sc-badge" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
      {signal}
    </span>
  )
}

function ScoreBar({ score, tight = false }) {
  const pct = Math.max(0, Math.min(100, score ?? 50))
  const clr = pct >= 65 ? '#10b981' : pct <= 35 ? '#ef4444' : '#6b7280'
  return (
    <div className="sc-score-wrap">
      <div className="sc-score-track">
        <div className="sc-score-fill" style={{ width: `${pct}%`, background: clr }} />
      </div>
      <span className="sc-score-num" style={{ color: clr }}>{score}</span>
      {tight && <span className="sc-tight-dot" title="Tight setup — price coiling, potential breakout forming">↟</span>}
    </div>
  )
}

function StageBadge({ stage, signal }) {
  if (!stage) return <span style={{ color: '#2a4060', fontSize: '11px' }}>—</span>
  const ideal = (signal === 'CALL' && stage === 'S2') || (signal === 'PUT' && stage === 'S4')
  const cfg = {
    S1: { color: '#60a5fa', border: '#1a3a60', bg: '#04101c' },
    S2: { color: '#10b981', border: '#064e2e', bg: '#011209' },
    S3: { color: '#f59e0b', border: '#7a4400', bg: '#1a0d00' },
    S4: { color: '#ef4444', border: '#6b0000', bg: '#160202' },
  }[stage]
  return (
    <span className="sc-stage-badge" style={{ color: cfg.color, borderColor: cfg.border, background: cfg.bg }}>
      {stage}{ideal && <span className="sc-stage-star">★</span>}
    </span>
  )
}

function TFMatrix({ weekly, daily, shortTerm }) {
  const dot = (dir, label) => {
    const bg = dir === 'bull' ? '#10b981' : dir === 'bear' ? '#ef4444' : '#2a4060'
    return (
      <div key={label} className="sc-tf-col">
        <span className="sc-tf-dot" style={{ background: bg }} />
        <span className="sc-tf-lbl">{label}</span>
      </div>
    )
  }
  return (
    <div className="sc-tf-matrix">
      {dot(weekly,    'WK')}
      {dot(daily,     'DY')}
      {dot(shortTerm, 'ST')}
    </div>
  )
}

function GradeBadge({ grade }) {
  if (!grade) return <span className="sc-td" style={{ color: '#2a4060' }}>—</span>
  const clr = { 'A+': '#10b981', A: '#34d399', B: '#f59e0b', C: '#6b7280' }[grade] ?? '#6b7280'
  return <span className="sc-grade" style={{ color: clr, borderColor: clr }}>{grade}</span>
}

function SortTH({ label, col, sortCol, sortDir, onSort, tip }) {
  const active = sortCol === col
  const arrow  = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  return (
    <span
      className={`sc-th-sort${active ? ' sc-th-active' : ''}`}
      onClick={() => onSort(col)}
      data-tip={tip}
    >
      {label}{arrow}
    </span>
  )
}

function SectorHeatmap({ sectorData, scanning }) {
  if (scanning && !sectorData.length) {
    return (
      <div className="sc-heatmap">
        <span className="sc-heatmap-lbl">Sector Pulse — scanning…</span>
        <div className="sc-heatmap-cells">
          {SECTOR_ETFS.map(s => (
            <div key={s.ticker} className="sc-hm-cell sc-hm-neutral sc-hm-loading">
              <span className="sc-hm-ticker">{s.ticker}</span>
              <span className="sc-hm-label">{s.label}</span>
              <span className="sc-hm-sig">…</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (!sectorData.length) return null

  const callCount = sectorData.filter(r => r.ok && r.signal === 'CALL').length
  const putCount  = sectorData.filter(r => r.ok && r.signal === 'PUT').length

  return (
    <div className="sc-heatmap">
      <div className="sc-heatmap-head">
        <span className="sc-heatmap-lbl">Sector Pulse</span>
        <span className="sc-heatmap-tally">
          <span style={{ color: '#10b981' }}>{callCount} bull</span>
          {' · '}
          <span style={{ color: '#ef4444' }}>{putCount} bear</span>
          {' · '}
          <span style={{ color: '#6b7280' }}>{sectorData.length - callCount - putCount} mixed</span>
        </span>
      </div>
      <div className="sc-heatmap-cells">
        {SECTOR_ETFS.map(({ ticker, label }) => {
          const r   = sectorData.find(x => x.ticker === ticker)
          const sig = r?.ok ? r.signal : null
          const cls = sig === 'CALL' ? 'sc-hm-bull' : sig === 'PUT' ? 'sc-hm-bear' : 'sc-hm-neutral'
          return (
            <div key={ticker} className={`sc-hm-cell ${cls}`}>
              <span className="sc-hm-ticker">{ticker}</span>
              <span className="sc-hm-label">{label}</span>
              <span className="sc-hm-sig">
                {sig ?? (r ? '—' : '…')}
              </span>
              {r?.ok && (
                <div className="sc-hm-tf">
                  {[
                    { dir: r.weekly,    lbl: 'W' },
                    { dir: r.daily,     lbl: 'D' },
                    { dir: r.shortTerm, lbl: 'S' },
                  ].map(({ dir, lbl }) => (
                    <span
                      key={lbl}
                      className="sc-hm-dot"
                      style={{ background: dir === 'bull' ? '#10b981' : dir === 'bear' ? '#ef4444' : '#2a4060' }}
                      title={`${lbl}: ${dir}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SectorLeaders({ sectorData, results, onLoadTicker }) {
  const gradeClr = g => ({ 'A+': '#10b981', A: '#34d399', B: '#f59e0b', C: '#6b7280' }[g] ?? '#6b7280')

  const activeSectors = SECTOR_ETFS
    .map(({ ticker, label }) => {
      const sr = sectorData.find(r => r.ticker === ticker)
      if (!sr?.ok || sr.signal === 'NO TRADE') return null
      const sectorDir = sr.signal === 'CALL' ? 'bull' : 'bear'
      const memberSet = new Set(SECTOR_STOCKS[ticker] ?? [])
      const stocks = results
        .filter(r => r.ok && memberSet.has(r.ticker))
        .sort((a, b) => {
          const aMatch = a.daily === sectorDir ? 1 : 0
          const bMatch = b.daily === sectorDir ? 1 : 0
          if (bMatch !== aMatch) return bMatch - aMatch
          const gradeN = { 'A+': 4, A: 3, B: 2, C: 1 }
          const ag = gradeN[a.grade] ?? 0
          const bg = gradeN[b.grade] ?? 0
          if (bg !== ag) return bg - ag
          return Math.abs(b.rawConf ?? 0) - Math.abs(a.rawConf ?? 0)
        })
        .slice(0, 6)
      return { ticker, label, signal: sr.signal, sectorDir, stocks }
    })
    .filter(Boolean)

  if (!activeSectors.length) return null

  return (
    <div className="sc-leaders">
      <div className="sc-leaders-title">SECTOR LEADERS</div>
      <div className="sc-leaders-sectors">
        {activeSectors.map(({ ticker, label, signal, sectorDir, stocks }) => {
          const isBull = signal === 'CALL'
          const accent = isBull ? '#10b981' : '#ef4444'
          return (
            <div key={ticker} className={`sc-ls-sector ${isBull ? 'sc-ls-bull' : 'sc-ls-bear'}`}>
              <div className="sc-ls-head">
                <span className="sc-ls-etf">{ticker}</span>
                <span className="sc-ls-label">{label}</span>
                <span className="sc-ls-sig" style={{ color: accent }}>
                  {isBull ? '▲ CALL' : '▼ PUT'}
                </span>
              </div>
              {stocks.length === 0 ? (
                <div className="sc-ls-empty">No CALL/PUT stocks scanned in this sector</div>
              ) : (
                <div className="sc-ls-stocks">
                  {stocks.map(r => {
                    const aligned = r.daily === sectorDir
                    const pctClr  = r.pctChange == null ? '#3a5070'
                      : r.pctChange > 0 ? '#10b981'
                      : r.pctChange < 0 ? '#ef4444' : '#6b7280'
                    return (
                      <button
                        key={r.ticker}
                        className={`sc-ls-stock${aligned ? ' sc-ls-aligned' : ''}`}
                        onClick={() => onLoadTicker?.(r.ticker)}
                        title={`Load ${r.ticker} in the analyzer`}
                      >
                        <span className="sc-ls-ticker">{r.ticker}</span>
                        {r.grade && (
                          <span className="sc-ls-grade" style={{ color: gradeClr(r.grade), borderColor: gradeClr(r.grade) }}>
                            {r.grade}
                          </span>
                        )}
                        {r.pctChange != null && (
                          <span className="sc-ls-pct" style={{ color: pctClr }}>
                            {r.pctChange > 0 ? '+' : ''}{r.pctChange}%
                          </span>
                        )}
                        <span className="sc-ls-sig-dot" style={{ color: r.signal === 'CALL' ? '#10b981' : '#ef4444' }}>
                          {r.signal === 'CALL' ? '▲' : '▼'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Top Setups ────────────────────────────────────────────────────────────────

function convictionRank(r) {
  const gradeN = { 'A+': 4, A: 3, B: 2, C: 1 }[r.grade] ?? 0
  return gradeN * 100 + Math.abs(r.rawConf ?? 0) * 100
}

function TopSetups({ results, onLoadAndBrief }) {
  if (!onLoadAndBrief || !results?.length) return null

  const gradeClr = g => ({ 'A+': '#10b981', A: '#34d399', B: '#f59e0b', C: '#6b7280' }[g] ?? '#6b7280')

  const callSetups = results
    .filter(r => r.ok && r.signal === 'CALL')
    .sort((a, b) => convictionRank(b) - convictionRank(a))
    .slice(0, 3)

  const putSetups = results
    .filter(r => r.ok && r.signal === 'PUT')
    .sort((a, b) => convictionRank(b) - convictionRank(a))
    .slice(0, 3)

  if (!callSetups.length && !putSetups.length) return null

  const card = (r, isCall) => (
    <button
      key={r.ticker}
      className="sc-top-card"
      style={{ borderColor: isCall ? '#065f46' : '#7f1d1d', background: isCall ? '#011209' : '#130202' }}
      onClick={() => onLoadAndBrief(r.ticker)}
    >
      <div className="sc-top-card-head">
        <span className="sc-top-ticker">{r.ticker}</span>
        {r.grade && (
          <span className="sc-top-grade" style={{ color: gradeClr(r.grade), borderColor: gradeClr(r.grade) }}>
            {r.grade}
          </span>
        )}
        <span className="sc-top-signal" style={{ color: isCall ? '#10b981' : '#ef4444' }}>
          {isCall ? '▲ CALL' : '▼ PUT'}
        </span>
      </div>
      <div className="sc-top-stats">
        {r.price   != null && <span>${r.price}</span>}
        {r.rsi     != null && <span>RSI {r.rsi}</span>}
        {r.adx     != null && <span>ADX {r.adx}</span>}
        {r.volSpike > 1.4  && <span style={{ color: '#f59e0b' }}>{r.volSpike}× vol</span>}
      </div>
      <div className="sc-top-action">ANALYZE IN BRIEF →</div>
    </button>
  )

  return (
    <div className="sc-top-wrap">
      <div className="sc-top-title">TOP SETUPS — HIGHEST CONVICTION</div>
      <div className="sc-top-columns">
        {callSetups.length > 0 && (
          <div className="sc-top-group">
            <div className="sc-top-group-label" style={{ color: '#10b981' }}>BULLISH CALLS</div>
            <div className="sc-top-cards">
              {callSetups.map(r => card(r, true))}
            </div>
          </div>
        )}
        {putSetups.length > 0 && (
          <div className="sc-top-group">
            <div className="sc-top-group-label" style={{ color: '#ef4444' }}>BEARISH PUTS</div>
            <div className="sc-top-cards">
              {putSetups.map(r => card(r, false))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

const GRADE_RANK = { 'A+': 4, A: 3, B: 2, C: 1 }

export default function Scanner({ onLoadTicker, onLoadAndBrief }) {
  const initCache = useRef(loadCache())

  const [status,        setStatus]        = useState(() => initCache.current?.results?.length ? 'done' : 'idle')
  const [progress,      setProgress]      = useState({ done: 0, total: 0 })
  const [results,       setResults]       = useState(() => initCache.current?.results ?? [])
  const [sectorResults, setSectorResults] = useState(() => initCache.current?.sectorResults ?? [])
  const [scannedCount,  setScannedCount]  = useState(() => initCache.current?.results?.length ? UNIVERSE.length : 0)
  const [sortCol,       setSortCol]       = useState('score')
  const [sortDir,       setSortDir]       = useState('desc')
  const [autoRefresh,   setAutoRefresh]   = useState(0)
  const [lastScanAt,    setLastScanAt]    = useState(() => initCache.current?.at ? new Date(initCache.current.at) : null)
  const [changedSet,    setChangedSet]    = useState(new Set())

  // Filters
  const [filterGrade,     setFilterGrade]     = useState('ALL')
  const [filterSignal,    setFilterSignal]    = useState('ALL')
  const [filterSector,    setFilterSector]    = useState('ALL')
  const [filterVolSpike,  setFilterVolSpike]  = useState(false)
  const [filterBestStage, setFilterBestStage] = useState(false)
  const [filterTight,     setFilterTight]     = useState(false)

  // IV enrichment
  const [ivMap,     setIvMap]     = useState({})
  const [ivLoading, setIvLoading] = useState(false)

  const prevSigRef   = useRef({})
  const autoTimerRef = useRef(null)
  const scanFnRef    = useRef(null)
  const resultsRef   = useRef(results)
  const freshScanRef = useRef(false)

  useEffect(() => { resultsRef.current = results }, [results])

  function handleSort(col) {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); return prev }
      setSortDir('desc')
      return col
    })
  }

  const handleScan = useCallback(async () => {
    if (status === 'running') return
    setStatus('running')
    setResults([])
    setSectorResults([])
    setChangedSet(new Set())
    setScannedCount(0)
    setIvMap({})

    const allResults = []
    const allSectors = []
    const sectorSet  = new Set(SECTOR_ETFS.map(s => s.ticker))
    const allTickers = [...SECTOR_ETFS.map(s => s.ticker), ...UNIVERSE]
    setProgress({ done: 0, total: allTickers.length })

    const newPrev = {}

    await runScanner(
      allTickers,
      (done, total) => {
        setProgress({ done, total })
        const universeDone = Math.max(0, done - SECTOR_ETFS.length)
        setScannedCount(universeDone)
      },
      (batch) => {
        const sRows = batch.filter(r => sectorSet.has(r.ticker))
        const mRows = batch.filter(r => !sectorSet.has(r.ticker) && r.ok && r.signal !== 'NO TRADE')
        if (sRows.length) {
          allSectors.push(...sRows)
          setSectorResults(prev => [...prev, ...sRows])
        }
        if (mRows.length) {
          allResults.push(...mRows)
          mRows.forEach(r => { newPrev[r.ticker] = r.signal })
          setResults(prev => [...prev, ...mRows])
        }
      }
    )

    const changed = new Set()
    Object.entries(newPrev).forEach(([ticker, sig]) => {
      const prev = prevSigRef.current[ticker]
      if (prev !== undefined && prev !== sig) changed.add(ticker)
    })
    setChangedSet(changed)
    prevSigRef.current = newPrev

    setScannedCount(UNIVERSE.length)
    const at = new Date()
    setLastScanAt(at)
    freshScanRef.current = true
    setStatus('done')

    try {
      localStorage.setItem(SCAN_CACHE_KEY, JSON.stringify({
        results: allResults,
        sectorResults: allSectors,
        at: at.toISOString(),
      }))
    } catch {}
  }, [status])

  scanFnRef.current = handleScan

  // Auto-refresh
  useEffect(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current)
    if (autoRefresh === 0) return
    autoTimerRef.current = setInterval(() => {
      if (isMarketOpen() && scanFnRef.current) scanFnRef.current()
    }, autoRefresh * 60_000)
    return () => clearInterval(autoTimerRef.current)
  }, [autoRefresh])

  // IV enrichment — runs only after a fresh scan (not on cache load)
  useEffect(() => {
    if (status !== 'done' || !freshScanRef.current) return
    freshScanRef.current = false
    const list = resultsRef.current.filter(r => r.ok && r.price != null)
    if (!list.length) return

    let cancelled = false
    setIvLoading(true)

    async function enrich() {
      for (const r of list) {
        if (cancelled) break
        const iv = await fetchATMIV(r.ticker, r.price)
        if (!cancelled && iv != null) setIvMap(prev => ({ ...prev, [r.ticker]: iv }))
        if (!cancelled) await new Promise(res => setTimeout(res, 200))
      }
      if (!cancelled) setIvLoading(false)
    }
    enrich()
    return () => { cancelled = true }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ────────────────────────────────────────────────────────
  const pct        = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const calls      = results.filter(r => r.signal === 'CALL')
  const puts       = results.filter(r => r.signal === 'PUT')
  const marketOpen = isMarketOpen()
  const sorted     = sortResults(results, sortCol, sortDir)

  // Filter logic
  const minGradeRank   = filterGrade === 'ALL' ? 0 : (GRADE_RANK[filterGrade] ?? 0)
  const sectorStockSet = filterSector !== 'ALL' ? new Set(SECTOR_STOCKS[filterSector] ?? []) : null
  const filtered = sorted.filter(r => {
    if (!r.ok) return true
    if (minGradeRank > 0 && (GRADE_RANK[r.grade] ?? 0) < minGradeRank) return false
    if (filterSignal !== 'ALL' && r.signal !== filterSignal) return false
    if (sectorStockSet && !sectorStockSet.has(r.ticker)) return false
    if (filterVolSpike  && (r.volSpike == null || r.volSpike < 1.5)) return false
    if (filterBestStage && r.stage !== (r.signal === 'CALL' ? 'S2' : 'S4')) return false
    if (filterTight     && (r.tightness == null || r.tightness > 0.65)) return false
    return true
  })

  const hasFilters = filterGrade !== 'ALL' || filterSignal !== 'ALL' || filterSector !== 'ALL' ||
                     filterVolSpike || filterBestStage || filterTight

  const lastScanLabel = (() => {
    if (!lastScanAt) return null
    const isToday = lastScanAt.toDateString() === new Date().toDateString()
    const time = lastScanAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return isToday ? time : lastScanAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time
  })()

  return (
    <div className="sc-root">
      {/* ── Header ── */}
      <div className="sc-header">
        <div className="sc-header-left">
          <span className="sc-header-title">Market Scanner</span>
          <span className="sc-header-sub">
            Screens {UNIVERSE.length} stocks for CALL/PUT signals · only triggered setups appear · sector pulse
          </span>
        </div>
        <div className="sc-header-right">
          <div className="sc-ar-row">
            <span className="sc-ar-lbl">Auto-refresh</span>
            <div className="sc-ar-btns">
              {[0, 5, 10, 15].map(v => (
                <button
                  key={v}
                  className={`sc-ar-btn${autoRefresh === v ? ' active' : ''}`}
                  onClick={() => setAutoRefresh(v)}
                >
                  {v === 0 ? 'Off' : `${v}m`}
                </button>
              ))}
            </div>
            {autoRefresh > 0 && (
              <span className={`sc-market-pill ${marketOpen ? 'open' : 'closed'}`}>
                {marketOpen ? 'Market Open' : 'Market Closed'}
              </span>
            )}
          </div>
          {lastScanLabel && (
            <span className="sc-last-scan">Last scan: {lastScanLabel}</span>
          )}
          <button
            className="sc-scan-btn"
            onClick={handleScan}
            disabled={status === 'running'}
          >
            {status === 'running'
              ? `Scanning… ${pct}%`
              : 'Scan the Market'}
          </button>
        </div>
      </div>

      {/* ── Progress ── */}
      {status === 'running' && (
        <div className="sc-progress-wrap">
          <div className="sc-progress-bar" style={{ width: `${pct}%` }} />
          <span className="sc-progress-label">
            {progress.done} / {progress.total} checked · {results.length} setup{results.length !== 1 ? 's' : ''} found
          </span>
        </div>
      )}

      {/* ── Sector heatmap ── */}
      {(status === 'done' || status === 'running') && (
        <SectorHeatmap sectorData={sectorResults} scanning={status === 'running'} />
      )}

      {/* ── Sector leaders ── */}
      {status === 'done' && (
        <SectorLeaders sectorData={sectorResults} results={results} onLoadTicker={onLoadTicker} />
      )}

      {/* ── Live results during scan ── */}
      {status === 'running' && results.length > 0 && (
        <div className="sc-live-banner">
          <span style={{ color: '#10b981' }}>{calls.length} CALL</span>
          {' · '}
          <span style={{ color: '#ef4444' }}>{puts.length} PUT</span>
          {' · '}
          <span style={{ color: '#4a6380' }}>signals found so far — results appear as each stock is checked</span>
        </div>
      )}

      {/* ── Results ── */}
      {(status === 'done' || (status === 'running' && results.length > 0)) && results.length > 0 && (
        <>
          {/* Summary strip */}
          {status === 'done' && (
            <div className="sc-summary">
              <div className="sc-sum-stat">
                <span className="sc-sum-lbl" data-tip="CALL Setups: Tickers where all or most timeframes are aligned bullish — weekly, daily, and short-term pointing up. These are your candidates for buying call options or entering stock long positions.">CALL Setups</span>
                <span className="sc-sum-val" style={{ color: '#10b981' }}>{calls.length}</span>
              </div>
              <div className="sc-stat-div" />
              <div className="sc-sum-stat">
                <span className="sc-sum-lbl" data-tip="PUT Setups: Tickers where timeframes are aligned bearish — the market structure is breaking down. These are your candidates for buying put options or avoiding long positions.">PUT Setups</span>
                <span className="sc-sum-val" style={{ color: '#ef4444' }}>{puts.length}</span>
              </div>
              <div className="sc-stat-div" />
              <div className="sc-sum-stat">
                <span className="sc-sum-lbl" data-tip="A+ Setups: Tickers scoring 80% or higher on the swing checklist — the highest-conviction setups in today's scan. These are the only ones that qualify for full position size. Quality over quantity.">A+ Setups</span>
                <span className="sc-sum-val" style={{ color: '#10b981' }}>
                  {results.filter(r => r.grade === 'A+').length}
                </span>
              </div>
              <div className="sc-stat-div" />
              <div className="sc-sum-stat">
                <span className="sc-sum-lbl" data-tip="Stocks Scanned: Total tickers checked from the market universe in this scan run.">Scanned</span>
                <span className="sc-sum-val" style={{ color: '#4a6380' }}>{scannedCount}</span>
              </div>
              {changedSet.size > 0 && (
                <>
                  <div className="sc-stat-div" />
                  <div className="sc-sum-stat">
                    <span className="sc-sum-lbl" data-tip="Signal Changes: Tickers that flipped their signal since your last scan run. Highlighted in the table with a NEW badge. These are worth reviewing immediately as momentum may be accelerating.">Signal Changes</span>
                    <span className="sc-sum-val" style={{ color: '#f59e0b' }}>{changedSet.size}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Top Setups */}
          {status === 'done' && <TopSetups results={results} onLoadAndBrief={onLoadAndBrief} />}

          {/* ── Filter bar ── */}
          {status === 'done' && (
            <div className="sc-filter-bar">
              <div className="sc-filter-group">
                <span className="sc-filter-lbl">Grade</span>
                {[['ALL', 'All'], ['A+', 'A+'], ['A', '≥A'], ['B', '≥B']].map(([val, label]) => (
                  <button
                    key={val}
                    className={`sc-filter-btn${filterGrade === val ? ' active' : ''}`}
                    onClick={() => setFilterGrade(val)}
                  >{label}</button>
                ))}
              </div>
              <div className="sc-filter-group">
                <span className="sc-filter-lbl">Signal</span>
                {[['ALL', 'All'], ['CALL', 'CALL'], ['PUT', 'PUT']].map(([val, label]) => (
                  <button
                    key={val}
                    className={`sc-filter-btn${filterSignal === val ? ' active' : ''}`}
                    onClick={() => setFilterSignal(val)}
                  >{label}</button>
                ))}
              </div>
              <div className="sc-filter-group">
                <span className="sc-filter-lbl">Sector</span>
                <select
                  className="sc-filter-select"
                  value={filterSector}
                  onChange={e => setFilterSector(e.target.value)}
                >
                  <option value="ALL">All Sectors</option>
                  {SECTOR_ETFS.map(s => (
                    <option key={s.ticker} value={s.ticker}>{s.ticker} — {s.label}</option>
                  ))}
                </select>
              </div>
              <label className="sc-filter-check">
                <input
                  type="checkbox"
                  checked={filterVolSpike}
                  onChange={e => setFilterVolSpike(e.target.checked)}
                />
                Vol ≥1.5×
              </label>
              <label className="sc-filter-check sc-filter-check-accent" title="Show only stocks in Stage 2 for CALL signals or Stage 4 for PUT signals — the ideal Weinstein stage for the trade direction.">
                <input
                  type="checkbox"
                  checked={filterBestStage}
                  onChange={e => setFilterBestStage(e.target.checked)}
                />
                Best Stage ★
              </label>
              <label className="sc-filter-check sc-filter-check-accent" title="Show only stocks where the 5-day price range is compressed below 65% of the 20-day average range — coiling setups that tend to resolve with a sharp move.">
                <input
                  type="checkbox"
                  checked={filterTight}
                  onChange={e => setFilterTight(e.target.checked)}
                />
                Tight Setup
              </label>
              {hasFilters && (
                <button className="sc-filter-clear" onClick={() => {
                  setFilterGrade('ALL')
                  setFilterSignal('ALL')
                  setFilterSector('ALL')
                  setFilterVolSpike(false)
                  setFilterBestStage(false)
                  setFilterTight(false)
                }}>Clear</button>
              )}
              <span className="sc-filter-count">
                {hasFilters ? `${filtered.length} / ${results.length}` : results.length} setups
              </span>
              {ivLoading && <span className="sc-iv-loading">IV loading…</span>}
            </div>
          )}

          {/* Table */}
          <div className="sc-table-wrap">
            <div className="sc-thead">
              <SortTH label="Ticker"   col="ticker"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortTH label="Price"    col="price"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortTH label="Chg%"     col="pctChange" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} tip="% Change: How much the stock has moved today vs. yesterday's close." />
              <SortTH label="Signal"   col="signal"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} tip="Signal: CALL = bullish confluence across weekly/daily/short-term. PUT = bearish alignment." />
              <span className="sc-th-nosort" data-tip="Timeframe Dots (Weekly · Daily · Short-Term): Green = bullish bias, red = bearish, gray = neutral.">WK·DY·ST</span>
              <SortTH label="Grade"    col="grade"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} tip="Setup Grade: A+ = 80%+ conditions passing. A = 65%+. B = 50%+. C = below 50%." />
              <span className="sc-th-nosort" data-tip="Weinstein Stage: S2 (green ★) = uptrend — ideal for CALL. S4 (red ★) = downtrend — ideal for PUT. S1 = basing. S3 = topping. Only trade Stage 2 CALLs and Stage 4 PUTs.">Stage</span>
              <SortTH label="Score"    col="score"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} tip="Confluence Score: 0–100 showing how aligned the technical picture is. Above 65 = strong directional bias. Blue dot = setup is coiling tight (5-day range &lt; 65% of normal)." />
              <SortTH label="VolSpike" col="volSpike"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} tip="Volume Spike: Today's volume vs. 20-day average. 2× = twice normal activity." />
              <span className="sc-th-nosort" data-tip="Relative Strength vs SPY: 12-week return minus SPY's 12-week return. Positive = outperforming the market. Stocks with high RS tend to continue outperforming — this is often what breaks out first.">RS</span>
              <SortTH label="RSI"      col="rsi"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} tip="RSI (Relative Strength Index): Momentum on a 0–100 scale. Above 50 = bullish. Below 50 = bearish." />
              <span />
            </div>

            {filtered.map(r => {
              const isChanged = changedSet.has(r.ticker)
              const rowCls = [
                'sc-row',
                r.ok ? (r.signal === 'CALL' ? 'sc-row-bull' : r.signal === 'PUT' ? 'sc-row-bear' : '') : 'sc-row-err',
                isChanged ? 'sc-row-changed' : '',
              ].filter(Boolean).join(' ')

              const pctClr = r.pctChange == null ? '#3a5070'
                : r.pctChange > 0 ? '#10b981'
                : r.pctChange < 0 ? '#ef4444'
                : '#6b7280'

              const volClr = r.volSpike == null ? '#3a5070'
                : r.volSpike >= 2.0 ? '#f59e0b'
                : r.volSpike >= 1.5 ? '#60a5fa'
                : '#6b7280'

              const rsiClr = r.rsi != null
                ? (r.rsi >= 44 ? '#10b981' : r.rsi >= 30 ? '#f59e0b' : '#6b7280')
                : '#3a5070'

              return (
                <div key={r.ticker} className={rowCls}>
                  <span className="sc-td sc-td-ticker">
                    {r.ticker}
                    {isChanged && <span className="sc-new-badge">NEW</span>}
                  </span>
                  <span className="sc-td">{r.price != null ? `$${r.price}` : '—'}</span>
                  <span className="sc-td" style={{ color: pctClr, fontWeight: 600 }}>
                    {r.pctChange != null ? `${r.pctChange > 0 ? '+' : ''}${r.pctChange}%` : '—'}
                  </span>
                  <span className="sc-td">
                    {r.ok ? <SignalBadge signal={r.signal} /> : <span className="sc-td-err">Error</span>}
                  </span>
                  <span className="sc-td">
                    {r.ok
                      ? <TFMatrix weekly={r.weekly} daily={r.daily} shortTerm={r.shortTerm} />
                      : '—'}
                  </span>
                  <span className="sc-td">
                    <GradeBadge grade={r.grade} />
                  </span>
                  <span className="sc-td">
                    <StageBadge stage={r.stage} signal={r.signal} />
                  </span>
                  <span className="sc-td sc-td-score">
                    {r.ok ? <ScoreBar score={r.score ?? 50} tight={r.tightness != null && r.tightness <= 0.65} /> : '—'}
                  </span>
                  <span className="sc-td" style={{ color: volClr, fontWeight: r.volSpike >= 1.5 ? 600 : 400 }}>
                    {r.volSpike != null ? `${r.volSpike}×` : '—'}
                  </span>
                  <span className="sc-td" style={{
                    color: r.rsVsSpy == null ? '#2a4060'
                      : r.rsVsSpy > 8  ? '#10b981'
                      : r.rsVsSpy > 2  ? '#34d399'
                      : r.rsVsSpy > -2 ? '#f59e0b'
                      : '#ef4444',
                    fontWeight: Math.abs(r.rsVsSpy ?? 0) > 5 ? 700 : 400,
                    fontSize: '11px',
                  }}>
                    {r.rsVsSpy != null ? `${r.rsVsSpy > 0 ? '+' : ''}${r.rsVsSpy}pp` : '—'}
                  </span>
                  <span className="sc-td" style={{ color: rsiClr }}>
                    {r.rsi ?? '—'}
                  </span>
                  <span className="sc-td">
                    {r.ok && onLoadTicker && (
                      <button className="sc-load-btn" onClick={() => onLoadTicker(r.ticker)}>Load</button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── No setups found ── */}
      {status === 'done' && results.length === 0 && (
        <div className="sc-idle">
          <div className="sc-idle-icon">🔍</div>
          <div className="sc-idle-text">
            No CALL or PUT setups found across {scannedCount} stocks scanned.
            <br />
            The market may be in a mixed or consolidating phase — no strong directional confluence today.
          </div>
        </div>
      )}

      {/* ── Idle ── */}
      {status === 'idle' && (
        <div className="sc-idle">
          <div className="sc-idle-icon">🔭</div>
          <div className="sc-idle-text">
            Hit <strong>Scan the Market</strong> to screen {UNIVERSE.length} stocks for active setups.
            <br />
            Only CALL and PUT signals appear — the market tells you where to look.
          </div>
        </div>
      )}
    </div>
  )
}
