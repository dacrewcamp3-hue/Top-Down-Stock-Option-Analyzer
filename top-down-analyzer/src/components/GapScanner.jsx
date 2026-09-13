import { useState, useEffect, useRef, useCallback } from 'react'
import { UNIVERSE } from '../utils/runScanner'
import './GapScanner.css'

const BASE    = '/yf-api/v8/finance/chart'
const BASE_QS = '/yf-api/v10/finance/quoteSummary'

function toETMin(tsMs) {
  const d   = new Date(tsMs)
  const str = d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

async function fetchEarningsFlag(ticker) {
  try {
    const res   = await fetch(`${BASE_QS}/${encodeURIComponent(ticker)}?modules=calendarEvents`)
    if (!res.ok) return false
    const json  = await res.json()
    const dates = json.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate ?? []
    if (!dates.length) return false
    const now        = Date.now()
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

    const dq       = dr.indicators?.quote?.[0] ?? {}
    const dailyBars = (dr.timestamp ?? [])
      .map((t, i) => ({
        ts: t,
        h:  dq.high?.[i],
        l:  dq.low?.[i],
        c:  dq.close?.[i],
        v:  dq.volume?.[i] ?? 0,
      }))
      .filter(b => b.c != null && b.h != null && b.l != null)
    if (dailyBars.length < 2) return null

    // Gate: ≥10M avg daily volume
    const _volSlice = dailyBars.slice(-21, -1)
    const _avgVol   = _volSlice.length
      ? _volSlice.reduce((s, b) => s + b.v, 0) / _volSlice.length
      : 0
    if (_avgVol < 10_000_000) return null

    const prevClose   = dailyBars[dailyBars.length - 1].c
    const prevDayHigh = dailyBars[dailyBars.length - 2]?.h ?? 0
    const prevDayLow  = dailyBars[dailyBars.length - 2]?.l ?? 0
    const tenDayHigh  = Math.max(...dailyBars.map(b => b.h))
    const tenDayLow   = Math.min(...dailyBars.map(b => b.l))

    const atrBars     = dailyBars.slice(-5)
    const avgRangePct = atrBars.reduce((s, b) => s + (b.h - b.l) / b.c, 0) / atrBars.length * 100

    const iq           = ir.indicators?.quote?.[0] ?? {}
    const intradayBars = (ir.timestamp ?? [])
      .map((t, i) => ({
        ts: t * 1000,
        h:  iq.high?.[i]   ?? iq.close?.[i],
        l:  iq.low?.[i]    ?? iq.close?.[i],
        c:  iq.close?.[i],
        v:  iq.volume?.[i] ?? 0,
      }))
      .filter(b => b.c != null)
    if (!intradayBars.length) return null

    const currentPrice = intradayBars[intradayBars.length - 1].c
    const preVol       = intradayBars.reduce((s, b) => s + b.v, 0)
    const gapPct       = +((currentPrice - prevClose) / prevClose * 100).toFixed(2)
    const atrMult      = avgRangePct > 0 ? +(Math.abs(gapPct) / avgRangePct).toFixed(1) : null

    // Opening Range: 9:30–10:00 AM ET (570–600 min)
    const orBars   = intradayBars.filter(b => { const m = toETMin(b.ts); return m >= 570 && m < 600 })
    const nowMin   = toETMin(Date.now())
    const orFormed = nowMin >= 600 && orBars.length >= 3
    const orHigh   = orBars.length ? +Math.max(...orBars.map(b => b.h)).toFixed(2) : null
    const orLow    = orBars.length ? +Math.min(...orBars.map(b => b.l)).toFixed(2) : null

    const earnings = await fetchEarningsFlag(ticker)

    return {
      ticker,
      prevClose:    +prevClose.toFixed(2),
      currentPrice: +currentPrice.toFixed(2),
      gapPct,
      preVol,
      avgVol:       Math.round(_avgVol),
      atrMult,
      earnings,
      prevDayHigh:  +prevDayHigh.toFixed(2),
      prevDayLow:   +prevDayLow.toFixed(2),
      tenDayHigh:   +tenDayHigh.toFixed(2),
      tenDayLow:    +tenDayLow.toFixed(2),
      orHigh,
      orLow,
      orFormed,
    }
  } catch { return null }
}

// ── Gap intelligence helpers ──────────────────────────────────────────────────

function classifyGap(r) {
  const { gapPct, atrMult, currentPrice, prevDayHigh, prevDayLow, tenDayHigh, tenDayLow, earnings } = r
  const isUp = gapPct > 0
  const am   = atrMult ?? 0

  if (earnings) return {
    type: 'EARNINGS', color: '#a855f7', bg: '#0d0718', border: '#4c1d95',
    play: 'WAIT FOR ORB',
    desc: 'Earnings-driven gap — wait for the 30-min OR to fully form, then trade the ORB breakout direction.',
  }
  if (isUp) {
    if (currentPrice > tenDayHigh) return {
      type: 'BREAKAWAY', color: '#10b981', bg: '#01120a', border: '#065f46',
      play: 'RIDE',
      desc: 'Gapping above the 10-day high — price is in new territory. Highest follow-through rate. Enter above ORH.',
    }
    if (currentPrice > prevDayHigh && am >= 1.5) return {
      type: 'CONTINUATION', color: '#34d399', bg: '#01120a', border: '#047857',
      play: 'RIDE',
      desc: 'Above prev-day high with meaningful size — trend continuation signal. Enter on ORH breakout.',
    }
    if (am < 1.2) return {
      type: 'COMMON', color: '#6b7280', bg: '#090f1a', border: '#1e2d45',
      play: 'FADE',
      desc: 'Small gap within normal daily range. ~70% probability of filling by 10:30 AM ET.',
    }
    return {
      type: 'INSIDE DAY', color: '#f59e0b', bg: '#0f0900', border: '#4d3800',
      play: 'WAIT FOR ORB',
      desc: 'Gap is within yesterday\'s range — lower conviction. Let OR form and trade the structural break.',
    }
  } else {
    if (currentPrice < tenDayLow) return {
      type: 'BREAKDOWN', color: '#ef4444', bg: '#130305', border: '#7f1d1d',
      play: 'RIDE',
      desc: 'Gapping below the 10-day low — structural breakdown. Highest follow-through rate. Enter below ORL.',
    }
    if (currentPrice < prevDayLow && am >= 1.5) return {
      type: 'CONTINUATION', color: '#f87171', bg: '#130305', border: '#6b0000',
      play: 'RIDE',
      desc: 'Below prev-day low with size — downtrend continuation. Enter on ORL breakdown.',
    }
    if (am < 1.2) return {
      type: 'COMMON', color: '#6b7280', bg: '#090f1a', border: '#1e2d45',
      play: 'FADE',
      desc: 'Small gap within normal daily range. ~70% probability of filling by 10:30 AM ET.',
    }
    return {
      type: 'INSIDE DAY', color: '#f59e0b', bg: '#0f0900', border: '#4d3800',
      play: 'WAIT FOR ORB',
      desc: 'Gap is within yesterday\'s range — lower conviction. Wait for OR structure before trading.',
    }
  }
}

function fillProb(r) {
  if (r.earnings) return 10
  const am = r.atrMult ?? 0
  if (am >= 2.5) return 12
  if (am >= 2.0) return 22
  if (am >= 1.5) return 40
  if (am >= 1.0) return 58
  return 74
}

function getRegimeContext(vixData, verdict) {
  const vix = vixData?.current ?? null
  if (!vix && !verdict) return null
  const favorable = verdict === 'FAVORABLE'      || verdict === 'LEANING BULLISH'
  const hostile   = verdict === 'HOSTILE'        || verdict === 'LEANING BEARISH'
  const vixHigh   = vix != null && vix > 25
  const vixLow    = vix != null && vix < 18

  if (hostile && vixHigh)  return { label: 'HOSTILE REGIME',   color: '#ef4444', bg: '#0e0101', border: '#7f1d1d', note: 'Gap-up plays are traps — regime favors fading all rallies. Only gap-down RIDE setups align with current conditions.' }
  if (hostile)             return { label: 'BEARISH REGIME',   color: '#f87171', bg: '#0e0101', border: '#6b0000', note: 'Gap-up breakouts likely fail. Focus on gap-down RIDE setups only.' }
  if (favorable && vixLow) return { label: 'FAVORABLE REGIME', color: '#10b981', bg: '#01100a', border: '#065f46', note: 'Gap-up Breakaway and Continuation plays follow through at highest rate. Full size on RIDE setups.' }
  if (favorable)           return { label: 'LEANING BULLISH',  color: '#34d399', bg: '#01100a', border: '#047857', note: 'Gap-up plays working. Standard size on RIDE setups. Fade only clearly common gaps.' }
  if (vixHigh)             return { label: 'HIGH VIX',         color: '#f59e0b', bg: '#0f0900', border: '#4d3800', note: 'Elevated volatility — gaps reverse sharply. Reduce all size 50% and widen stops by 1.5× the OR range.' }
  return                          { label: 'NEUTRAL REGIME',   color: '#60a5fa', bg: '#040e1c', border: '#1a3a6e', note: 'Trade Breakaway and Earnings gaps only. Skip common and inside-day gaps until regime clarifies.' }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GapRegimeBanner({ vixData, verdict }) {
  const ctx = getRegimeContext(vixData, verdict)
  if (!ctx) return null
  return (
    <div className="gs-regime" style={{ background: ctx.bg, borderColor: ctx.border }}>
      <span className="gs-regime-label" style={{ color: ctx.color }}>{ctx.label}</span>
      {vixData?.current != null && (
        <span className="gs-regime-vix" style={{ color: ctx.color }}>
          VIX {vixData.current.toFixed(1)}
        </span>
      )}
      <span className="gs-regime-note">{ctx.note}</span>
    </div>
  )
}

function GapIntelStrip({ r, gapClass, shareSize }) {
  const isUp     = r.gapPct > 0
  const fp       = fillProb(r)
  const playColor = gapClass.play === 'RIDE'
    ? (isUp ? '#10b981' : '#ef4444')
    : gapClass.play === 'FADE' ? '#f59e0b'
    : '#60a5fa'

  // ORB trade plan — only for non-FADE plays with OR data
  let orbPlan = null
  if (gapClass.play !== 'FADE' && r.orHigh != null && r.orLow != null) {
    const entry   = isUp ? r.orHigh : r.orLow
    const stop    = isUp ? r.orLow  : r.orHigh
    const riskPer = +Math.abs(entry - stop).toFixed(2)
    const t1      = +(isUp ? entry + riskPer     : entry - riskPer).toFixed(2)
    const t2      = +(isUp ? entry + riskPer * 2 : entry - riskPer * 2).toFixed(2)
    const t3      = +(isUp ? entry + riskPer * 3 : entry - riskPer * 3).toFixed(2)
    const riskDoll = shareSize > 0 ? Math.round(shareSize * riskPer)     : null
    const t1gain   = shareSize > 0 ? Math.round(shareSize * riskPer)     : null
    const t2gain   = shareSize > 0 ? Math.round(shareSize * riskPer * 2) : null
    orbPlan = { entry, stop, riskPer, t1, t2, t3, riskDoll, t1gain, t2gain }
  }

  return (
    <div className="gs-intel">
      <div className="gs-intel-left">
        <span className="gs-intel-type" style={{ color: gapClass.color, borderColor: gapClass.border, background: gapClass.bg }}>
          {gapClass.type}
        </span>
        <span className="gs-intel-play" style={{ color: playColor }}>
          {gapClass.play === 'RIDE' ? '↗ RIDE' : gapClass.play === 'FADE' ? '↩ FADE' : '⏳ WAIT FOR ORB'}
        </span>
        {gapClass.play === 'FADE' && (
          <span className="gs-intel-fill">fill prob {fp}%</span>
        )}
        <span className="gs-intel-desc">{gapClass.desc}</span>
      </div>

      {orbPlan && (
        <div className="gs-orb-plan" style={{ borderColor: playColor + '40' }}>
          {r.orFormed ? (
            <>
              <span className="gs-orb-label" style={{ color: playColor }}>
                {isUp ? '▲ CALL PLAN' : '▼ PUT PLAN'}
              </span>
              <span className="gs-orb-item">Entry <strong style={{ color: playColor }}>${orbPlan.entry.toFixed(2)}</strong></span>
              <span className="gs-orb-sep">·</span>
              <span className="gs-orb-item">Stop <strong style={{ color: '#ef4444' }}>${orbPlan.stop.toFixed(2)}</strong></span>
              <span className="gs-orb-sep">·</span>
              <span className="gs-orb-item">T1 <strong>${orbPlan.t1.toFixed(2)}</strong></span>
              <span className="gs-orb-sep">·</span>
              <span className="gs-orb-item">T2 <strong>${orbPlan.t2.toFixed(2)}</strong></span>
              <span className="gs-orb-sep">·</span>
              <span className="gs-orb-item">T3 <strong>${orbPlan.t3.toFixed(2)}</strong></span>
              {orbPlan.riskDoll != null && (
                <>
                  <span className="gs-orb-sep">·</span>
                  <span className="gs-orb-risk">Risk <strong style={{ color: '#ef4444' }}>${orbPlan.riskDoll}</strong></span>
                  <span className="gs-orb-sep">→</span>
                  <span className="gs-orb-gain" style={{ color: playColor }}>T1 +${orbPlan.t1gain} · T2 +${orbPlan.t2gain}</span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="gs-orb-label" style={{ color: '#3a5070' }}>OR FORMING</span>
              <span className="gs-orb-item">
                {isUp ? 'ORH' : 'ORL'} <strong style={{ color: playColor }}>
                  ${(isUp ? r.orHigh : r.orLow)?.toFixed(2) ?? '—'}
                </strong>
              </span>
              <span className="gs-orb-sep">·</span>
              <span className="gs-orb-item">
                {isUp ? 'ORL' : 'ORH'} <strong style={{ color: '#ef4444' }}>
                  ${(isUp ? r.orLow : r.orHigh)?.toFixed(2) ?? '—'}
                </strong>
              </span>
              {r.orHigh != null && r.orLow != null && (
                <>
                  <span className="gs-orb-sep">·</span>
                  <span className="gs-orb-item">Range ${(r.orHigh - r.orLow).toFixed(2)}</span>
                </>
              )}
              <span className="gs-orb-wait">Wait for 10:00 AM ET — enter on ORH/ORL break</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

const BATCH   = 5
const MIN_GAP = 0.75

export default function GapScanner({ watchlist = [], onLoadTicker, vixData, verdict }) {
  const defaultList = [...new Set([...UNIVERSE, ...watchlist.map(w => w.ticker)])]

  const shareSize = (() => {
    try { return Math.max(0, Math.round(parseFloat(localStorage.getItem('tdsa_share_size') || '100'))) }
    catch { return 100 }
  })()

  const [results, setResults] = useState([])
  const [status,  setStatus]  = useState('idle')
  const [prog,    setProg]    = useState({ done: 0, total: 0 })
  const [filter,  setFilter]  = useState('all')
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
            Pre-market gaps ≥ {MIN_GAP}% · {defaultList.length} tickers · ORB plan auto-computes after 10:00 AM ET
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

      <GapRegimeBanner vixData={vixData} verdict={verdict} />

      {status === 'running' && (
        <div className="gs-progress-wrap">
          <div className="gs-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {results.length > 0 && (
        <div className="gs-filters">
          {[['all', 'All'], ['bull', 'Gap Up'], ['bear', 'Gap Down']].map(([v, l]) => (
            <button
              key={v}
              className={`gs-filter${filter === v ? ' active' : ''}${v === 'bull' ? ' gs-f-bull' : v === 'bear' ? ' gs-f-bear' : ''}`}
              onClick={() => setFilter(v)}
            >
              {l} {v === 'all'
                ? `(${results.length})`
                : v === 'bull'
                  ? `(${results.filter(r => r.gapPct > 0).length})`
                  : `(${results.filter(r => r.gapPct < 0).length})`}
            </button>
          ))}
        </div>
      )}

      {visible.length > 0 && (
        <div className="gs-results">
          <div className="gs-hdr">
            <span>Ticker</span>
            <span>Gap</span>
            <span>ATR×</span>
            <span>Current</span>
            <span>Pre-Vol</span>
          </div>
          {visible.map(r => {
            const pos       = r.gapPct >= 0
            const atrColor  = r.atrMult == null ? '#3a5a7a'
              : r.atrMult >= 2   ? (pos ? '#10b981' : '#ef4444')
              : r.atrMult >= 1.2 ? '#f59e0b'
              : '#3a5a7a'
            const preVolPct = r.avgVol > 0 ? Math.round(r.preVol / r.avgVol * 100) : null
            const gapClass  = classifyGap(r)

            return (
              <div key={r.ticker} className="gs-item">
                <div className="gs-row" onClick={() => onLoadTicker?.(r.ticker)}>
                  <span className="gs-ticker">
                    {r.ticker}
                    {r.earnings && (
                      <span className="gs-earn-badge" title="Earnings within 3 days">E</span>
                    )}
                  </span>
                  <span className="gs-gap" style={{ color: pos ? '#10b981' : '#ef4444' }}>
                    <span className="gs-gap-arrow">{pos ? '▲' : '▼'}</span>
                    {pos ? '+' : ''}{r.gapPct.toFixed(2)}%
                  </span>
                  <span className="gs-atr" style={{ color: atrColor }}
                    title={`Gap is ${r.atrMult ?? '?'}× the 5-day average daily range`}>
                    {r.atrMult != null ? `${r.atrMult}×` : '—'}
                  </span>
                  <span className="gs-price" style={{ color: pos ? '#10b981' : '#ef4444' }}>
                    ${r.currentPrice.toFixed(2)}
                  </span>
                  <span className="gs-vol">
                    {r.preVol >= 1_000_000
                      ? `${(r.preVol / 1_000_000).toFixed(1)}M`
                      : r.preVol >= 1_000
                        ? `${(r.preVol / 1_000).toFixed(0)}K`
                        : r.preVol}
                    {preVolPct != null && (
                      <span
                        className="gs-vol-pct"
                        style={{ color: preVolPct >= 15 ? '#f59e0b' : '#2a4060' }}
                        title="Pre-market volume as % of 20-day average daily volume"
                      >
                        {' '}{preVolPct}%
                      </span>
                    )}
                  </span>
                </div>
                <GapIntelStrip r={r} gapClass={gapClass} shareSize={shareSize} />
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
