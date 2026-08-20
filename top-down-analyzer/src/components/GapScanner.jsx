import { useState, useEffect, useRef, useCallback } from 'react'
import { UNIVERSE } from '../utils/runScanner'
import './GapScanner.css'

const BASE = '/yf-api/v8/finance/chart'

const BASE_QS = '/yf-api/v10/finance/quoteSummary'

async function fetchEarningsFlag(ticker) {
  try {
    const res  = await fetch(`${BASE_QS}/${encodeURIComponent(ticker)}?modules=calendarEvents`)
    if (!res.ok) return false
    const json = await res.json()
    const dates = json.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ?? []
    if (!dates.length) return false
    const now   = Date.now()
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000
    return dates.some(d => {
      const t = (d.raw ?? 0) * 1000
      return t > 0 && t - now < THREE_DAYS && t - now > -24 * 60 * 60 * 1000
    })
  } catch { return false }
}

async function fetchGapData(ticker) {
  try {
    const [dailyRes, intradayRes] = await Promise.all([
      fetch(`${BASE}/${encodeURIComponent(ticker)}?interval=1d&range=10d&includePrePost=false`),
      fetch(`${BASE}/${encodeURIComponent(ticker)}?interval=5m&range=1d&includePrePost=true`),
    ])
    if (!dailyRes.ok || !intradayRes.ok) return null

    const [dailyJson, intradayJson] = await Promise.all([dailyRes.json(), intradayRes.json()])

    const dr = dailyJson.chart?.result?.[0]
    const ir = intradayJson.chart?.result?.[0]
    if (!dr || !ir) return null

    const dq = dr.indicators?.quote?.[0] ?? {}
    const dailyBars = (dr.timestamp ?? [])
      .map((t, i) => ({ ts: t, o: dq.open?.[i], h: dq.high?.[i], l: dq.low?.[i], c: dq.close?.[i], v: dq.volume?.[i] ?? 0 }))
      .filter(b => b.c != null && b.h != null && b.l != null)
    if (dailyBars.length < 2) return null

    // Gate: require ≥10M avg daily volume
    const _volSlice = dailyBars.slice(-21, -1)
    const _avgVol   = _volSlice.length ? _volSlice.reduce((s, b) => s + b.v, 0) / _volSlice.length : 0
    if (_avgVol < 10_000_000) return null

    const prevClose = dailyBars[dailyBars.length - 1].c

    // 5-day ATR as avg (H-L) range %
    const atrBars = dailyBars.slice(-5)
    const avgRangePct = atrBars.reduce((s, b) => s + (b.h - b.l) / b.c, 0) / atrBars.length * 100

    const iq = ir.indicators?.quote?.[0] ?? {}
    const intradayBars = (ir.timestamp ?? [])
      .map((t, i) => ({ ts: t * 1000, c: iq.close?.[i], v: iq.volume?.[i] ?? 0 }))
      .filter(b => b.c != null)
    if (!intradayBars.length) return null

    const currentPrice = intradayBars[intradayBars.length - 1].c
    const preVol = intradayBars.reduce((s, b) => s + b.v, 0)
    const gapPct = +((currentPrice - prevClose) / prevClose * 100).toFixed(2)

    // ATR multiple — how large is this gap relative to the avg daily range
    const atrMult = avgRangePct > 0 ? +(Math.abs(gapPct) / avgRangePct).toFixed(1) : null

    // Earnings flag — fire and forget, don't block
    const earnings = await fetchEarningsFlag(ticker)

    return {
      ticker,
      prevClose:    +prevClose.toFixed(2),
      currentPrice: +currentPrice.toFixed(2),
      gapPct,
      preVol,
      atrMult,
      earnings,
    }
  } catch { return null }
}

const BATCH = 5
const MIN_GAP = 0.75   // %  — show any gap ≥ this magnitude

export default function GapScanner({ watchlist = [], onLoadTicker }) {
  const defaultList = [...new Set([...UNIVERSE, ...watchlist.map(w => w.ticker)])]

  const [results, setResults]   = useState([])
  const [status,  setStatus]    = useState('idle')
  const [prog,    setProg]      = useState({ done: 0, total: 0 })
  const [filter,  setFilter]    = useState('all')   // all | bull | bear
  const hasScanned = useRef(false)

  const runScan = useCallback(async () => {
    if (status === 'running') return
    setStatus('running')
    setResults([])
    setProg({ done: 0, total: defaultList.length })
    const all = []
    for (let i = 0; i < defaultList.length; i += BATCH) {
      const batch   = defaultList.slice(i, i + BATCH)
      const fetched = await Promise.all(batch.map(fetchGapData))
      fetched.forEach(r => r && all.push(r))
      setProg({ done: Math.min(i + BATCH, defaultList.length), total: defaultList.length })
    }
    const filtered = all
      .filter(r => Math.abs(r.gapPct) >= MIN_GAP)
      .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    setResults(filtered)
    setStatus('done')
  }, [status, defaultList])

  useEffect(() => {
    if (!hasScanned.current) { hasScanned.current = true; runScan() }
  }, []) // eslint-disable-line

  const visible = filter === 'bull' ? results.filter(r => r.gapPct > 0)
    : filter === 'bear' ? results.filter(r => r.gapPct < 0)
    : results

  const pct = prog.total > 0 ? Math.round(prog.done / prog.total * 100) : 0

  return (
    <div className="gs-root">
      <div className="gs-header">
        <div className="gs-header-left">
          <span className="gs-title">Gap Scanner</span>
          <span className="gs-sub">
            Pre-market gaps ≥ {MIN_GAP}% · {defaultList.length} tickers · click to analyze
          </span>
        </div>
        <button
          className={`gs-scan-btn${status === 'running' ? ' gs-scanning' : ''}`}
          onClick={runScan}
          disabled={status === 'running'}
        >
          {status === 'running' ? `${pct}%` : '↺ Scan'}
        </button>
      </div>

      {status === 'running' && (
        <div className="gs-progress-wrap">
          <div className="gs-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {results.length > 0 && (
        <div className="gs-filters">
          {[['all','All'], ['bull','Gap Up'], ['bear','Gap Down']].map(([v, l]) => (
            <button
              key={v}
              className={`gs-filter${filter === v ? ' active' : ''}${v === 'bull' ? ' gs-f-bull' : v === 'bear' ? ' gs-f-bear' : ''}`}
              onClick={() => setFilter(v)}
            >{l} {v === 'all' ? `(${results.length})` : v === 'bull' ? `(${results.filter(r => r.gapPct > 0).length})` : `(${results.filter(r => r.gapPct < 0).length})`}</button>
          ))}
        </div>
      )}

      {visible.length > 0 && (
        <div className="gs-results">
          <div className="gs-hdr">
            <span>Ticker</span>
            <span>Gap</span>
            <span>vs ATR</span>
            <span>Prev Close</span>
            <span>Current</span>
            <span>Pre Vol</span>
          </div>
          {visible.map(r => {
            const pos      = r.gapPct >= 0
            const atrColor = r.atrMult == null ? '#3a5a7a'
              : r.atrMult >= 2   ? (pos ? '#10b981' : '#ef4444')
              : r.atrMult >= 1.2 ? '#f59e0b'
              : '#3a5a7a'
            return (
              <div key={r.ticker} className="gs-row" onClick={() => onLoadTicker?.(r.ticker)}>
                <span className="gs-ticker">
                  {r.ticker}
                  {r.earnings && <span className="gs-earn-badge" title="Earnings within 3 days">E</span>}
                </span>
                <span className="gs-gap" style={{ color: pos ? '#10b981' : '#ef4444' }}>
                  <span className="gs-gap-arrow">{pos ? '▲' : '▼'}</span>
                  {pos ? '+' : ''}{r.gapPct.toFixed(2)}%
                </span>
                <span className="gs-atr" style={{ color: atrColor }}
                  title={`Gap is ${r.atrMult ?? '?'}× the 5-day average daily range`}>
                  {r.atrMult != null ? `${r.atrMult}×` : '—'}
                </span>
                <span className="gs-price gs-dim">${r.prevClose.toFixed(2)}</span>
                <span className="gs-price" style={{ color: pos ? '#10b981' : '#ef4444' }}>
                  ${r.currentPrice.toFixed(2)}
                </span>
                <span className="gs-vol">
                  {r.preVol >= 1_000_000
                    ? `${(r.preVol / 1_000_000).toFixed(1)}M`
                    : r.preVol >= 1_000
                      ? `${(r.preVol / 1_000).toFixed(0)}K`
                      : r.preVol}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {status === 'done' && results.length === 0 && (
        <div className="gs-empty">
          No gaps ≥ {MIN_GAP}% found right now. Gaps are most visible pre-market (4:00–9:30 AM ET) and at the open. Try scanning before 9:30 AM.
        </div>
      )}

      {status === 'running' && (
        <div className="gs-idle">Scanning {prog.done}/{prog.total} tickers for pre-market gaps…</div>
      )}
      {status === 'idle' && (
        <div className="gs-idle">Gap scanner ready — scan for tickers with significant pre-market moves.</div>
      )}
    </div>
  )
}
