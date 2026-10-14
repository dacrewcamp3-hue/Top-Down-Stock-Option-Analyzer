import { useState, useMemo, useEffect } from 'react'
import './SPXGrowth.css'

// ── Educational tooltip wrapper ──────────────────────────────────────────────
function Tip({ children, text, wide, up }) {
  return (
    <span className={`spx-tip${wide ? ' spx-tip-wide' : ''}${up ? ' spx-tip-up' : ''}`}>
      {children}
      <span className="spx-tip-box">{text}</span>
    </span>
  )
}

// ── S&P 500 annual total returns (price + dividends reinvested), 1986–2026 ──
const SP500_ANNUAL = [
  { year: 1986, ret: 18.67 },
  { year: 1987, ret:  5.25 },
  { year: 1988, ret: 16.61 },
  { year: 1989, ret: 31.69 },
  { year: 1990, ret: -3.10 },
  { year: 1991, ret: 30.47 },
  { year: 1992, ret:  7.62 },
  { year: 1993, ret: 10.08 },
  { year: 1994, ret:  1.32 },
  { year: 1995, ret: 37.58 },
  { year: 1996, ret: 22.96 },
  { year: 1997, ret: 33.36 },
  { year: 1998, ret: 28.58 },
  { year: 1999, ret: 21.04 },
  { year: 2000, ret: -9.10 },
  { year: 2001, ret:-11.89 },
  { year: 2002, ret:-22.10 },
  { year: 2003, ret: 28.68 },
  { year: 2004, ret: 10.88 },
  { year: 2005, ret:  4.91 },
  { year: 2006, ret: 15.79 },
  { year: 2007, ret:  5.49 },
  { year: 2008, ret:-37.00 },
  { year: 2009, ret: 26.46 },
  { year: 2010, ret: 15.06 },
  { year: 2011, ret:  2.11 },
  { year: 2012, ret: 16.00 },
  { year: 2013, ret: 32.39 },
  { year: 2014, ret: 13.69 },
  { year: 2015, ret:  1.38 },
  { year: 2016, ret: 11.96 },
  { year: 2017, ret: 21.83 },
  { year: 2018, ret: -4.38 },
  { year: 2019, ret: 31.49 },
  { year: 2020, ret: 18.40 },
  { year: 2021, ret: 28.71 },
  { year: 2022, ret:-18.11 },
  { year: 2023, ret: 26.29 },
  { year: 2024, ret: 25.02 },
  { year: 2025, ret: -1.50, est: true },
  { year: 2026, ret:  6.00, est: true },
]

// US CPI annual inflation rates, 1986–2026 (2025–2026 estimated)
const CPI_ANNUAL = [
  { year: 1986, inf: 1.91 },
  { year: 1987, inf: 3.66 },
  { year: 1988, inf: 4.08 },
  { year: 1989, inf: 4.83 },
  { year: 1990, inf: 5.40 },
  { year: 1991, inf: 4.21 },
  { year: 1992, inf: 3.01 },
  { year: 1993, inf: 2.99 },
  { year: 1994, inf: 2.56 },
  { year: 1995, inf: 2.83 },
  { year: 1996, inf: 2.93 },
  { year: 1997, inf: 2.34 },
  { year: 1998, inf: 1.55 },
  { year: 1999, inf: 2.19 },
  { year: 2000, inf: 3.38 },
  { year: 2001, inf: 2.83 },
  { year: 2002, inf: 1.59 },
  { year: 2003, inf: 2.27 },
  { year: 2004, inf: 2.68 },
  { year: 2005, inf: 3.39 },
  { year: 2006, inf: 3.24 },
  { year: 2007, inf: 2.85 },
  { year: 2008, inf: 3.84 },
  { year: 2009, inf: -0.36 },
  { year: 2010, inf: 1.64 },
  { year: 2011, inf: 3.16 },
  { year: 2012, inf: 2.07 },
  { year: 2013, inf: 1.46 },
  { year: 2014, inf: 1.62 },
  { year: 2015, inf: 0.12 },
  { year: 2016, inf: 1.26 },
  { year: 2017, inf: 2.13 },
  { year: 2018, inf: 2.44 },
  { year: 2019, inf: 1.81 },
  { year: 2020, inf: 1.23 },
  { year: 2021, inf: 4.70 },
  { year: 2022, inf: 8.00 },
  { year: 2023, inf: 4.12 },
  { year: 2024, inf: 2.90 },
  { year: 2025, inf: 2.50, est: true },
  { year: 2026, inf: 2.20, est: true },
]

const CPI_MAP = Object.fromEntries(CPI_ANNUAL.map(d => [d.year, d.inf]))

const CRASH_NOTES = {
  1990: 'Gulf War recession — S&P dropped ~20% peak to trough.',
  2000: 'Dot-com bubble peak — internet stocks had been wildly overvalued.',
  2001: 'Dot-com crash continued + September 11 market shock.',
  2002: 'Dot-com crash bottom — 3-year total S&P drop was ~49%.',
  2008: 'The Great Financial Crisis — housing bubble collapse, banks failed. S&P dropped ~57% peak to trough.',
  2018: 'Fed rate hike fears — market dropped ~20% in Q4 then fully recovered by April 2019.',
  2022: 'Post-COVID inflation spike — Fed raised rates aggressively. S&P dropped ~25%.',
  2025: 'Tariff shock (Liberation Day) — S&P fell ~18% in weeks, recovered by summer 2025.',
}

const BEAR_MARKETS = [
  { name: 'Black Monday',      start: '1987-08', end: '1987-12', recovery: '1989-07', drop: -33.5, months: 3,  recovMonths: 20 },
  { name: 'Gulf War',          start: '1990-07', end: '1990-10', recovery: '1991-02', drop: -19.9, months: 3,  recovMonths: 4  },
  { name: 'Dot-com Bust',      start: '2000-03', end: '2002-10', recovery: '2007-05', drop: -49.1, months: 31, recovMonths: 55 },
  { name: 'Great Fin. Crisis', start: '2007-10', end: '2009-03', recovery: '2013-03', drop: -56.8, months: 17, recovMonths: 48 },
  { name: 'Debt Ceiling',      start: '2011-04', end: '2011-10', recovery: '2012-02', drop: -21.6, months: 6,  recovMonths: 4  },
  { name: 'China/Oil',         start: '2015-07', end: '2016-02', recovery: '2016-07', drop: -14.2, months: 7,  recovMonths: 5  },
  { name: 'Fed Hike Fear',     start: '2018-09', end: '2018-12', recovery: '2019-04', drop: -19.8, months: 3,  recovMonths: 4  },
  { name: 'COVID Crash',       start: '2020-02', end: '2020-03', recovery: '2020-08', drop: -33.9, months: 1,  recovMonths: 5  },
  { name: 'Rate Hike Cycle',   start: '2022-01', end: '2022-10', recovery: '2024-01', drop: -25.4, months: 9,  recovMonths: 15 },
  { name: 'Tariff Shock',      start: '2025-02', end: '2025-04', recovery: '2025-07', drop: -18.2, months: 2,  recovMonths: 3  },
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const YEAR_MIN = 1986
const YEAR_MAX = 2026
const MIN_INVEST = 1000

// Module-level derived constants (static)
const SPX_YEARS      = SP500_ANNUAL.map(d => d.year)
const MATRIX_BUY_YRS = SPX_YEARS.slice(0, -1)   // 1986..2025
const MATRIX_SEL_YRS = SPX_YEARS.slice(1)        // 1987..2026

function fmtDollar(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${Math.round(n).toLocaleString()}`
}
function fmtMultiple(ratio) {
  if (ratio >= 10) return `${ratio.toFixed(0)}×`
  return `${ratio.toFixed(1)}×`
}

// ── Seasonality heatmap colors ───────────────────────────────────────────────
function retColor(v) {
  if (v == null) return '#0a1420'
  if (v >  4) return '#065f46'
  if (v >  1) return '#064e3b'
  if (v > -1) return '#1e2d3d'
  if (v > -4) return '#7f1d1d'
  return '#450a0a'
}
function retTextColor(v) {
  if (v == null) return '#1e3050'
  if (v >  1) return '#6ee7b7'
  if (v < -1) return '#fca5a5'
  return '#4a6a8a'
}

// ── Rolling return matrix colors ─────────────────────────────────────────────
function cagrColor(v) {
  if (v == null) return '#020609'
  if (v > 15) return '#034d25'
  if (v > 10) return '#0a3d2e'
  if (v >  5) return '#0a2d3d'
  if (v >= 0) return '#2d1a00'
  return '#3d0a0a'
}
function cagrTextColor(v) {
  if (v == null) return 'transparent'
  if (v > 15) return '#86efac'
  if (v > 10) return '#6ee7b7'
  if (v >  5) return '#67e8f9'
  if (v >= 0) return '#fbbf24'
  return '#fca5a5'
}

const PRESET_YEARS   = [1986, 1990, 1995, 2000, 2005, 2010, 2015, 2020]
const PRESET_AMOUNTS = [1000, 5000, 10000, 25000, 50000]
const CRASH_YEARS    = new Set(Object.keys(CRASH_NOTES).map(Number))
const yearPct        = y => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100

// ── Component ────────────────────────────────────────────────────────────────
export default function SPXGrowth({ ticker = null, dailyBars = null, spyDailyBars = null }) {

  // ── Existing state ───────────────────────────────────────────────────────
  const [startYear,  setStartYear]  = useState(1990)
  const [endYear,    setEndYear]    = useState(2026)
  const [investment, setInvestment] = useState(1000)
  const [customAmt,  setCustomAmt]  = useState('1000')
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const [mode,       setMode]       = useState('nominal')

  // ── New state ────────────────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState('growth')
  const [liveData,    setLiveData]    = useState(null)
  const [monthlyData, setMonthlyData] = useState(null)

  const changeStart = v => setStartYear(Math.min(+v, endYear - 1))
  const changeEnd   = v => setEndYear(Math.max(+v, startYear + 1))

  // ── Live data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    async function fetchLive() {
      try {
        const [spyRes, tnyRes] = await Promise.all([
          fetch('/yf-api/v10/finance/quoteSummary/SPY?modules=financialData,summaryDetail,defaultKeyStatistics,price'),
          fetch('/yf-api/v8/finance/chart/%5ETNX?range=5d&interval=1d'),
        ])
        const spyJson = await spyRes.json()
        const tnyJson = await tnyRes.json()

        const price    = spyJson?.quoteSummary?.result?.[0]?.price
        const summary  = spyJson?.quoteSummary?.result?.[0]?.summaryDetail
        const financial= spyJson?.quoteSummary?.result?.[0]?.financialData

        const currentPrice = price?.regularMarketPrice?.raw
        const prevClose    = price?.regularMarketPreviousClose?.raw
        const chg1d        = currentPrice && prevClose
          ? ((currentPrice - prevClose) / prevClose * 100)
          : null

        const ytdRes    = await fetch('/yf-api/v8/finance/chart/SPY?range=ytd&interval=1d')
        const ytdJson   = await ytdRes.json()
        const ytdCloses = ytdJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
        const ytdFirst  = ytdCloses.find(v => v != null)
        const ytdLast   = [...ytdCloses].reverse().find(v => v != null)
        const ytd       = ytdFirst && ytdLast ? ((ytdLast - ytdFirst) / ytdFirst * 100) : null

        const pe    = summary?.trailingPE?.raw ?? null
        const eps   = financial?.earningsPerShare?.raw ?? null
        const tnyCloses = tnyJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
        const tsy10y    = tnyCloses.filter(v => v != null).at(-1) ?? null

        setLiveData({ price: currentPrice, ytd, pe, eps, tsy10y, chg1d })
      } catch {}
    }
    fetchLive()
  }, [])

  // ── Monthly data fetch (seasonality) ────────────────────────────────────
  useEffect(() => {
    if (activePanel !== 'seasonality' || monthlyData) return
    setMonthlyData({ loading: true })
    fetch('/yf-api/v8/finance/chart/SPY?range=30y&interval=1mo&includePrePost=false')
      .then(r => r.json())
      .then(json => {
        const res = json?.chart?.result?.[0]
        if (!res) { setMonthlyData({ loading: false, byYearMonth: {} }); return }
        const ts     = res.timestamp ?? []
        const closes = res.indicators?.quote?.[0]?.close ?? []
        const byYM   = {}
        for (let i = 1; i < ts.length; i++) {
          if (closes[i] == null || closes[i-1] == null) continue
          const d   = new Date(ts[i] * 1000)
          const yr  = d.getUTCFullYear()
          const mon = d.getUTCMonth() + 1
          const ret = (closes[i] - closes[i-1]) / closes[i-1] * 100
          byYM[`${yr}-${mon}`] = +ret.toFixed(2)
        }
        setMonthlyData({ loading: false, byYearMonth: byYM })
      })
      .catch(() => setMonthlyData({ loading: false, byYearMonth: {} }))
  }, [activePanel, monthlyData])

  // ── Growth rows ──────────────────────────────────────────────────────────
  const growthRows = useMemo(() => {
    const rows = []
    let balance = investment
    for (const d of SP500_ANNUAL) {
      if (d.year < startYear || d.year > endYear) continue
      const prev      = balance
      const spxRet    = d.ret / 100
      const cpi       = (CPI_MAP[d.year] ?? 2.5) / 100
      const annualRet = mode === 'real'
        ? ((1 + spxRet) / (1 + cpi)) - 1
        : spxRet
      balance = balance * (1 + annualRet)
      rows.push({
        year:    d.year,
        nomRet:  d.ret,
        realRet: +((annualRet * 100).toFixed(2)),
        inf:     CPI_MAP[d.year] ?? 2.5,
        balance: Math.round(balance),
        delta:   Math.round(balance - prev),
        est:     !!d.est,
      })
    }
    return rows
  }, [startYear, endYear, investment, mode])

  // ── Rolling return matrix ────────────────────────────────────────────────
  const matrixData = useMemo(() => {
    const result = {}
    for (let si = 0; si < SPX_YEARS.length; si++) {
      for (let ei = si + 1; ei < SPX_YEARS.length; ei++) {
        const sy = SPX_YEARS[si], ey = SPX_YEARS[ei]
        let balance = 1
        for (let yi = si; yi < ei; yi++) {
          balance *= (1 + SP500_ANNUAL[yi].ret / 100)
        }
        const n    = ei - si
        const cagr = (Math.pow(balance, 1 / n) - 1) * 100
        result[`${sy}-${ey}`] = +cagr.toFixed(1)
      }
    }
    return result
  }, [])

  // ── Beta / correlation stats ─────────────────────────────────────────────
  const betaStats = useMemo(() => {
    if (!ticker || !dailyBars?.closes?.length || !spyDailyBars?.closes?.length) return null
    const tc = dailyBars.closes
    const sc = spyDailyBars.closes
    const paired = []
    for (let i = 1; i < Math.min(tc.length, sc.length); i++) {
      if (tc[i] == null || tc[i-1] == null || sc[i] == null || sc[i-1] == null) continue
      paired.push({
        tr: (tc[i] - tc[i-1]) / tc[i-1],
        sr: (sc[i] - sc[i-1]) / sc[i-1],
      })
    }
    if (paired.length < 20) return null
    const n    = paired.length
    const tAvg = paired.reduce((s, p) => s + p.tr, 0) / n
    const sAvg = paired.reduce((s, p) => s + p.sr, 0) / n
    let cov = 0, varS = 0, varT = 0
    for (const { tr, sr } of paired) {
      cov  += (tr - tAvg) * (sr - sAvg)
      varS += (sr - sAvg) ** 2
      varT += (tr - tAvg) ** 2
    }
    cov /= n; varS /= n; varT /= n
    const beta = varS > 0 ? cov / varS : null
    const corr = (varS > 0 && varT > 0) ? cov / Math.sqrt(varS * varT) : null
    const tFirst = tc.find(v => v != null)
    const tLast  = [...tc].reverse().find(v => v != null)
    const sFirst = sc.find(v => v != null)
    const sLast  = [...sc].reverse().find(v => v != null)
    const tickerReturn = tFirst && tLast ? (tLast - tFirst) / tFirst * 100 : null
    const spyReturn    = sFirst && sLast ? (sLast - sFirst) / sFirst * 100 : null
    const alpha = (tickerReturn != null && spyReturn != null && beta != null)
      ? tickerReturn - (beta * spyReturn) : null
    return { beta, corr, alpha, tickerReturn, spyReturn, n, sAvg, tAvg, scatterData: paired.slice(-252) }
  }, [ticker, dailyBars, spyDailyBars])

  // ── Growth panel derived ─────────────────────────────────────────────────
  const finalBalance = growthRows.at(-1)?.balance ?? investment
  const totalGain    = finalBalance - investment
  const multiple     = finalBalance / investment
  const years        = growthRows.length
  const cagr         = years > 1
    ? ((Math.pow(finalBalance / investment, 1 / years) - 1) * 100).toFixed(1)
    : null

  const W = 1000, H = 220
  const PAD = { top: 18, bottom: 30, left: 4, right: 4 }
  const innerW_svg = W - PAD.left - PAD.right
  const innerH_svg = H - PAD.top - PAD.bottom
  const maxBal   = Math.max(...growthRows.map(r => r.balance), investment * 1.05)
  const minBal   = Math.min(...growthRows.map(r => r.balance), investment * 0.95)
  const balRange = maxBal - minBal || 1
  const toX = i => PAD.left + (i / growthRows.length) * innerW_svg
  const toY = v => PAD.top + (1 - (v - minBal) / balRange) * innerH_svg
  const allPts = [
    { x: PAD.left, y: toY(investment) },
    ...growthRows.map((r, i) => ({ x: toX(i + 1), y: toY(r.balance) })),
  ]
  const lineD = allPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaD = `${lineD} L${PAD.left + innerW_svg},${PAD.top + innerH_svg} L${PAD.left},${PAD.top + innerH_svg} Z`
  const isReal      = mode === 'real'
  const accentColor = isReal ? '#a78bfa' : '#22c55e'
  const hRow        = hoveredIdx !== null ? growthRows[hoveredIdx] : null
  const displayRet  = r => isReal ? r.realRet : r.nomRet
  const handleAmtChange = v => {
    setCustomAmt(v)
    const parsed = parseInt(v, 10)
    if (!isNaN(parsed) && parsed >= MIN_INVEST) setInvestment(parsed)
  }
  const trackLeft  = yearPct(startYear)
  const trackRight = 100 - yearPct(endYear)

  // ── Bear markets sorted ──────────────────────────────────────────────────
  const sortedBears = [...BEAR_MARKETS].map(b => ({
    ...b,
    painScore: +(Math.abs(b.drop) / 10 * Math.sqrt(b.months)).toFixed(1),
  })).sort((a, b) => b.painScore - a.painScore)

  // ── Seasonality helpers ──────────────────────────────────────────────────
  const currentDate = new Date()
  const currentYear = currentDate.getFullYear()
  const currentMon  = currentDate.getMonth() + 1
  const seaYears    = []
  for (let y = 1994; y <= currentYear; y++) seaYears.push(y)
  const monthAvgs = MONTHS.map((_, mi) => {
    const mon  = mi + 1
    const vals = seaYears
      .map(y => monthlyData?.byYearMonth?.[`${y}-${mon}`])
      .filter(v => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })

  // ── Tabs config ──────────────────────────────────────────────────────────
  const TABS = [
    { id: 'growth',      label: 'Growth Calc'   },
    { id: 'seasonality', label: 'Seasonality'   },
    { id: 'bearmarkets', label: 'Bear Markets'  },
    { id: 'matrix',      label: 'Return Matrix' },
    { id: 'beta',        label: ticker ? `${ticker} Beta` : 'Ticker Beta' },
  ]

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="spx-container">

      {/* ── LIVE INTELLIGENCE BAR ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 20,
        padding: '8px 16px', background: '#020609',
        borderBottom: '1px solid #0a1820', flexWrap: 'wrap',
      }}>
        {liveData?.price != null && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, color: '#2a4060', fontWeight: 700 }}>SPY</span>
            <span style={{ fontSize: 16, color: '#e2e8f0', fontWeight: 800 }}>
              ${liveData.price.toFixed(2)}
            </span>
            {liveData.chg1d != null && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: liveData.chg1d >= 0 ? '#10b981' : '#ef4444',
              }}>
                {liveData.chg1d >= 0 ? '+' : ''}{liveData.chg1d.toFixed(2)}% today
              </span>
            )}
          </div>
        )}

        {liveData?.ytd != null && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>YTD</span>
            <span style={{
              fontSize: 14, fontWeight: 800,
              color: liveData.ytd >= 0 ? '#10b981' : '#ef4444',
            }}>
              {liveData.ytd >= 0 ? '+' : ''}{liveData.ytd.toFixed(1)}%
            </span>
          </div>
        )}

        {liveData?.pe != null && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>P/E</span>
            <span style={{
              fontSize: 14, fontWeight: 800,
              color: liveData.pe > 25 ? '#f59e0b' : liveData.pe > 20 ? '#60a5fa' : '#10b981',
            }}>
              {liveData.pe.toFixed(1)}&times;
            </span>
          </div>
        )}

        {liveData?.tsy10y != null && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>10Y TSY</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#60a5fa' }}>
              {liveData.tsy10y.toFixed(2)}%
            </span>
            {liveData.pe != null && (() => {
              const ey     = (1 / liveData.pe * 100)
              const spread = ey - liveData.tsy10y
              const col    = spread > 0 ? '#10b981' : '#ef4444'
              return (
                <span style={{ fontSize: 9, color: col, fontWeight: 600 }}>
                  EY spread {spread >= 0 ? '+' : ''}{spread.toFixed(2)}%
                </span>
              )
            })()}
          </div>
        )}

        {liveData?.pe != null && (
          <div style={{
            marginLeft: 8, padding: '4px 12px',
            background: liveData.pe > 25 ? '#1a0e00' : liveData.pe > 20 ? '#06111e' : '#01120a',
            border: `1px solid ${liveData.pe > 25 ? '#f59e0b33' : liveData.pe > 20 ? '#60a5fa33' : '#10b98133'}`,
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>VALUATION</div>
            <div style={{
              fontSize: 10, fontWeight: 800,
              color: liveData.pe > 25 ? '#f59e0b' : liveData.pe > 20 ? '#60a5fa' : '#10b981',
            }}>
              {liveData.pe > 28 ? 'STRETCHED' : liveData.pe > 22 ? 'ELEVATED' : liveData.pe > 17 ? 'FAIR' : 'CHEAP'}
            </div>
            <div style={{ fontSize: 8, color: '#2a4060' }}>Hist. avg ~18-21x</div>
          </div>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 8, color: '#1a3050' }}>
          Live via Yahoo Finance &middot; {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* ── TAB NAVIGATION ────────────────────────────────────────────── */}
      <div className="spx-panel-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`spx-panel-tab${activePanel === tab.id ? ' active' : ''}`}
            onClick={() => setActivePanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          PANEL: GROWTH CALCULATOR (existing)
         ══════════════════════════════════════════════════════════════════ */}
      {activePanel === 'growth' && (
        <div className="spx-root">

          {/* Header + mode toggle */}
          <div className="spx-header">
            <div className="spx-header-icon">📈</div>
            <div className="spx-header-text">
              <h2 className="spx-title">S&amp;P 500 Wealth Escalator</h2>
              <p className="spx-subtitle">
                Drag both handles to set your window — any span from <strong>1986 to August 2026</strong>.
                See what a simple S&amp;P 500 index investment would have grown to over that period.
              </p>
            </div>
            <div className="spx-mode-toggle">
              <Tip text="Shows raw dollar amounts — what your account statement would literally say. No math adjustments. Just the actual growth." wide up>
                <button className={`spx-mode-btn${!isReal ? ' active' : ''}`} onClick={() => setMode('nominal')}>
                  Nominal
                </button>
              </Tip>
              <Tip text="Shows real purchasing power. A dollar in 1990 bought way more than a dollar today. This strips inflation out so you can see what your gain actually means in terms of what you can BUY — not just the number on paper." wide up>
                <button className={`spx-mode-btn real${isReal ? ' active' : ''}`} onClick={() => setMode('real')}>
                  Inflation-Adj.
                </button>
              </Tip>
            </div>
          </div>

          {isReal && (
            <div className="spx-mode-note">
              <span className="spx-mode-note-icon">&#x2139;</span>
              <span>
                <strong>Inflation-adjusted (real) returns</strong> — each year's S&amp;P 500 gain is
                reduced by that year's CPI inflation rate. Result is in <strong>{startYear} purchasing-power dollars</strong>.
                Example: market up 10%, inflation 4% &rarr; real gain is only ~5.8%.
              </span>
            </div>
          )}

          {/* Dual-range year slider */}
          <div className="spx-ctrl-block">
            <div className="spx-ctrl-label">
              <Tip text="Slide the LEFT dot to pick your start year — when the investment was first made. Slide the RIGHT dot to pick when it ended." wide>
                Year Range <span className="spx-tip-icon">?</span>
              </Tip>
              &nbsp;
              <span className="spx-ctrl-val">{startYear}</span>
              <span className="spx-range-arrow"> → </span>
              <span className="spx-ctrl-val">{endYear}</span>
              <span className="spx-range-span"> ({years} yr{years !== 1 ? 's' : ''})</span>
            </div>
            <div className="spx-preset-row">
              <span className="spx-preset-label">Start:</span>
              {PRESET_YEARS.map(y => (
                <button key={y} className={`spx-pill${startYear === y ? ' active' : ''}`} onClick={() => changeStart(y)}>
                  {y}
                </button>
              ))}
            </div>
            <div className="spx-dual-wrap" style={{ '--track-left': `${trackLeft}%`, '--track-right': `${trackRight}%` }}>
              <div className="spx-dual-track"><div className="spx-dual-fill" /></div>
              <input type="range" min={YEAR_MIN} max={YEAR_MAX} step={1} value={startYear}
                onChange={e => changeStart(e.target.value)}
                className="spx-dual-input spx-dual-start"
                title={`Start year: ${startYear}`}
              />
              <input type="range" min={YEAR_MIN} max={YEAR_MAX} step={1} value={endYear}
                onChange={e => changeEnd(e.target.value)}
                className="spx-dual-input spx-dual-end"
                title={`End year: ${endYear}`}
              />
            </div>
            <div className="spx-range-labels"><span>{YEAR_MIN}</span><span>{YEAR_MAX}</span></div>
          </div>

          {/* Investment amount */}
          <div className="spx-ctrl-block">
            <div className="spx-ctrl-label">
              <Tip text="How much you invested at the start. You put it in once and never added to it — pure compound growth.">
                Initial Investment <span className="spx-tip-icon">?</span>
              </Tip>
            </div>
            <div className="spx-preset-row">
              {PRESET_AMOUNTS.map(a => (
                <button key={a} className={`spx-pill${investment === a ? ' active' : ''}`}
                  onClick={() => { setInvestment(a); setCustomAmt(a.toString()) }}>
                  ${a.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="spx-custom-row">
              <span className="spx-dollar-sign">$</span>
              <input type="number" min={MIN_INVEST} value={customAmt}
                onChange={e => handleAmtChange(e.target.value)}
                className="spx-custom-input" placeholder="Custom amount…" />
            </div>
          </div>

          {/* Result banner */}
          <div className={`spx-banner${isReal ? ' spx-banner-real' : ''}`}>
            <div className="spx-banner-main">
              <div className="spx-banner-label">
                <Tip text={`You put in ${fmtDollar(investment)} once and left it alone in an S&P 500 index fund — no adding, no selling, no timing the market. Just patience.`}>
                  {fmtDollar(investment)} invested in {startYear}
                  <span className="spx-tip-icon">?</span>
                </Tip>
                {' → '}
                {isReal && <span className="spx-banner-badge">real {startYear} $</span>}
              </div>
              <div className="spx-banner-value" style={{ color: accentColor }}>
                <Tip text={`What that one investment is worth in ${endYear}. The market did the work.`} wide>
                  {fmtDollar(finalBalance)}
                  <span className="spx-tip-icon" style={{ fontSize: '0.6em', verticalAlign: 'super' }}>?</span>
                </Tip>
              </div>
              <div className="spx-banner-sub">
                <Tip text={`Total profit above what you put in. ${fmtMultiple(multiple)} means every dollar turned into ${fmtMultiple(multiple)}.`}>
                  {totalGain >= 0 ? '+' : ''}{fmtDollar(Math.abs(totalGain))} gain &nbsp;&middot;&nbsp; {fmtMultiple(multiple)} your money
                  <span className="spx-tip-icon">?</span>
                </Tip>
                &nbsp;&middot;&nbsp;
                <Tip text={`Compound Annual Growth Rate — the average yearly speed of your investment.`}>
                  {cagr}% / yr CAGR <span className="spx-tip-icon">?</span>
                </Tip>
                {isReal && <span className="spx-banner-real-note"> after inflation</span>}
              </div>
            </div>
            <div className="spx-banner-years">{years} yr{years !== 1 ? 's' : ''} in market</div>
          </div>

          {/* Chart */}
          <div className="spx-chart-wrap">
            <div className="spx-chart-legend">
              <span className="spx-chart-legend-item">
                <span style={{ color: accentColor }}>&#x25AC;</span> Portfolio value
              </span>
              <Tip text="These dashed red lines mark years when the market had a major crash. Every one of them recovered." wide>
                <span className="spx-chart-legend-item spx-chart-legend-crash">
                  <span style={{ color: '#ef4444' }}>&#x254C;</span> Major crash year
                  <span className="spx-tip-icon">?</span>
                </span>
              </Tip>
            </div>
            {hRow && (
              <div className="spx-tooltip-box">
                <strong>{hRow.year}{hRow.est ? ' *' : ''}</strong>
                &nbsp;&middot;&nbsp;
                {CRASH_YEARS.has(hRow.year) && (
                  <span style={{ color: '#f97316', fontSize: '0.75em' }}>crash year &nbsp;</span>
                )}
                {isReal && <span style={{ color: '#f59e0b', fontSize: '0.75em' }}>CPI {hRow.inf.toFixed(1)}%&nbsp; </span>}
                <span className={displayRet(hRow) >= 0 ? 'pos' : 'neg'}>
                  {isReal ? 'Real' : 'S&P'} {displayRet(hRow) >= 0 ? '+' : ''}{displayRet(hRow).toFixed(2)}%
                </span>
                &nbsp;&middot;&nbsp; Balance: <strong>{fmtDollar(hRow.balance)}</strong>
                &nbsp;&middot;&nbsp;
                <span className={hRow.delta >= 0 ? 'pos' : 'neg'}>
                  {hRow.delta >= 0 ? '+' : '-'}{fmtDollar(Math.abs(hRow.delta))}
                </span>
                {CRASH_YEARS.has(hRow.year) && (
                  <div style={{ fontSize: '0.72em', color: '#94a3b8', marginTop: 3 }}>
                    {CRASH_NOTES[hRow.year]}
                  </div>
                )}
              </div>
            )}
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
              className="spx-svg" onMouseLeave={() => setHoveredIdx(null)}>
              <defs>
                <linearGradient id="spxFillNom" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#22c55e" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0.03" />
                </linearGradient>
                <linearGradient id="spxFillReal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              <path d={areaD} fill={isReal ? 'url(#spxFillReal)' : 'url(#spxFillNom)'} />
              {growthRows.map((r, i) =>
                CRASH_YEARS.has(r.year) ? (
                  <line key={r.year}
                    x1={toX(i + 1)} y1={PAD.top}
                    x2={toX(i + 1)} y2={PAD.top + innerH_svg}
                    stroke="#ef4444" strokeWidth="1" strokeOpacity="0.28" strokeDasharray="4 3" />
                ) : null
              )}
              <path d={lineD} fill="none" stroke={accentColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {growthRows.map((r, i) => (
                <rect key={r.year}
                  x={toX(i)} y={0}
                  width={innerW_svg / Math.max(growthRows.length, 1)} height={H}
                  fill="transparent" style={{ cursor: 'crosshair' }}
                  onMouseEnter={() => setHoveredIdx(i)} />
              ))}
              {hoveredIdx !== null && allPts[hoveredIdx + 1] && (
                <circle cx={allPts[hoveredIdx + 1].x} cy={allPts[hoveredIdx + 1].y}
                  r="5" fill={accentColor} stroke="#fff" strokeWidth="2" />
              )}
              {growthRows.map((r, i) =>
                r.year % 5 === 0 ? (
                  <text key={r.year} x={toX(i + 1)} y={H - 6}
                    textAnchor="middle" fontSize="13" fill="#6b7280">{r.year}</text>
                ) : null
              )}
            </svg>
          </div>

          {/* Year-by-year table */}
          <div className="spx-table-wrap">
            <table className="spx-table">
              <thead>
                <tr>
                  <th><Tip text="Each row is one calendar year." up>Year <span className="spx-tip-icon">?</span></Tip></th>
                  <th><Tip text="The S&P 500's total return that year." up wide>S&amp;P Return <span className="spx-tip-icon">?</span></Tip></th>
                  {isReal && <th><Tip text="Consumer Price Index — how much everyday prices rose that year." up wide>CPI <span className="spx-tip-icon">?</span></Tip></th>}
                  {isReal && <th><Tip text="Your real gain after inflation." up wide>Real Return <span className="spx-tip-icon">?</span></Tip></th>}
                  <th><Tip text="Your total account value at year end." up wide>Balance <span className="spx-tip-icon">?</span></Tip></th>
                  <th><Tip text="How many dollars you gained or lost in that single year." up wide>Year Gain / Loss <span className="spx-tip-icon">?</span></Tip></th>
                </tr>
              </thead>
              <tbody>
                <tr className="spx-start-row">
                  <td>{startYear} (start)</td>
                  <td>—</td>
                  {isReal && <td>—</td>}
                  {isReal && <td>—</td>}
                  <td><strong>{fmtDollar(investment)}</strong></td>
                  <td>—</td>
                </tr>
                {growthRows.map(r => (
                  <tr key={r.year}
                    className={[
                      displayRet(r) < 0 ? 'spx-neg-row' : '',
                      CRASH_YEARS.has(r.year) ? 'spx-crash-row' : '',
                    ].join(' ').trim()}
                    title={CRASH_YEARS.has(r.year) ? CRASH_NOTES[r.year] : undefined}
                  >
                    <td>
                      {r.year}
                      {CRASH_YEARS.has(r.year) && <span className="spx-crash-tag" title={CRASH_NOTES[r.year]}>crash</span>}
                      {r.est && <span className="spx-est-tag">est.</span>}
                    </td>
                    <td className={r.nomRet >= 0 ? 'pos' : 'neg'}>{r.nomRet >= 0 ? '+' : ''}{r.nomRet.toFixed(2)}%</td>
                    {isReal && <td className="spx-cpi-col">{r.inf.toFixed(1)}%</td>}
                    {isReal && <td className={r.realRet >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{r.realRet >= 0 ? '+' : ''}{r.realRet.toFixed(2)}%</td>}
                    <td><strong>{fmtDollar(r.balance)}</strong></td>
                    <td className={r.delta >= 0 ? 'pos' : 'neg'}>{r.delta >= 0 ? '+' : '-'}{fmtDollar(Math.abs(r.delta))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="spx-table-footer">
              <Tip text="2025 return is a partial-year estimate — final figure pending confirmation. 2026 is in progress and will update as the year plays out." wide>
                <span className="spx-footnote-inline">* estimated years <span className="spx-tip-icon">?</span></span>
              </Tip>
              <span className="spx-footnote-inline">&middot;</span>
              <Tip text="'Crash' years are major market downturns. Every one of them recovered." wide>
                <span className="spx-footnote-inline">crash = major drawdown <span className="spx-tip-icon">?</span></span>
              </Tip>
              <span className="spx-footnote-inline">&middot;</span>
              <span className="spx-footnote-inline">For educational use only.</span>
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          PANEL: SEASONALITY HEATMAP
         ══════════════════════════════════════════════════════════════════ */}
      {activePanel === 'seasonality' && (
        <div style={{ padding: '16px', overflowX: 'auto', maxWidth: 900, margin: '0 auto', width: '100%' }}>
          {/* Current month callout */}
          {(() => {
            const avg = monthAvgs[currentMon - 1]
            const thisYear = monthlyData?.byYearMonth?.[`${currentYear}-${currentMon}`]
            if (avg == null) return null
            const col = avg >= 0 ? '#10b981' : '#ef4444'
            return (
              <div style={{
                padding: '8px 14px', marginBottom: 16,
                background: avg >= 0 ? '#030f09' : '#0f0303',
                border: `1px solid ${col}33`, borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              }}>
                <div>
                  <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>
                    CURRENT MONTH &middot; {MONTHS[currentMon - 1].toUpperCase()}
                  </div>
                  <div style={{ fontSize: 13, color: col, fontWeight: 800 }}>
                    Historically {avg >= 0 ? '+' : ''}{avg.toFixed(2)}% avg since 1994
                  </div>
                </div>
                {thisYear != null && (
                  <div>
                    <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>THIS YEAR SO FAR</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: thisYear >= 0 ? '#10b981' : '#ef4444' }}>
                      {thisYear >= 0 ? '+' : ''}{thisYear.toFixed(2)}%
                    </div>
                  </div>
                )}
                <div style={{ marginLeft: 'auto', fontSize: 9, color: '#2a4060' }}>
                  September is historically worst (avg -0.7%) &middot; Q4 strongest
                </div>
              </div>
            )
          })()}

          {/* Monthly averages bar */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
            <div style={{ width: 36, flexShrink: 0 }} />
            {MONTHS.map((m, mi) => {
              const avg = monthAvgs[mi]
              const col = avg == null ? '#2a4060' : avg >= 0 ? '#10b981' : '#ef4444'
              return (
                <div key={m} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 7.5, color: '#2a4060', fontWeight: 700, marginBottom: 2 }}>{m}</div>
                  <div style={{ fontSize: 8.5, color: col, fontWeight: 800 }}>
                    {avg != null ? `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}%` : '—'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Heatmap grid */}
          {monthlyData?.loading ? (
            <div style={{ color: '#2a4060', padding: 32, textAlign: 'center' }}>
              Loading 30 years of monthly data…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {seaYears.slice().reverse().map(yr => (
                <div key={yr} style={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <div style={{
                    width: 36, fontSize: 8, color: '#2a4060', fontWeight: 700,
                    flexShrink: 0, textAlign: 'right', paddingRight: 6,
                  }}>
                    {yr}
                  </div>
                  {MONTHS.map((_, mi) => {
                    const mon = mi + 1
                    const v   = monthlyData?.byYearMonth?.[`${yr}-${mon}`]
                    const isCur = yr === currentYear && mon === currentMon
                    return (
                      <div key={mon}
                        title={v != null
                          ? `${MONTHS[mi]} ${yr}: ${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
                          : `${MONTHS[mi]} ${yr}: no data`}
                        style={{
                          flex: 1, height: 16, borderRadius: 2,
                          background: retColor(v),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          outline: isCur ? '1px solid #60a5fa' : 'none',
                          cursor: 'default',
                        }}
                      >
                        <span style={{ fontSize: 6, color: retTextColor(v), fontWeight: 700 }}>
                          {v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {!monthlyData && (
            <div style={{ color: '#2a4060', padding: 32, textAlign: 'center', fontSize: 13 }}>
              Loading monthly data…
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          PANEL: BEAR MARKET ANATOMY
         ══════════════════════════════════════════════════════════════════ */}
      {activePanel === 'bearmarkets' && (
        <div style={{ padding: '16px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
          <div style={{ fontSize: 11, color: '#4a6a8a', marginBottom: 16 }}>
            Every major S&amp;P 500 drawdown since 1987, ranked by Pain Score = (|drop|/10) &times; sqrt(months down).
          </div>

          {/* Current regime alert */}
          {liveData?.ytd != null && liveData.ytd < -10 && (() => {
            const ytdDrop = liveData.ytd
            const closest = [...BEAR_MARKETS].sort((a, b) =>
              Math.abs(Math.abs(a.drop) - Math.abs(ytdDrop)) - Math.abs(Math.abs(b.drop) - Math.abs(ytdDrop))
            )[0]
            const similar = BEAR_MARKETS.filter(b => Math.abs(Math.abs(b.drop) - Math.abs(ytdDrop)) < 15)
            const medRecov = similar.length > 0
              ? Math.round(similar.map(b => b.recovMonths).sort((a,b) => a-b)[Math.floor(similar.length / 2)])
              : null
            return (
              <div style={{
                padding: '10px 14px', marginBottom: 16,
                background: '#1a0404', border: '1px solid #ef444433',
                borderRadius: 8,
              }}>
                <strong style={{ color: '#ef4444' }}>
                  SPY is currently {ytdDrop.toFixed(1)}% YTD.
                </strong>
                {' '}The closest historical analog is <strong style={{ color: '#f59e0b' }}>{closest?.name}</strong>
                {' '}({closest?.drop}% peak-to-trough).
                {medRecov != null && (
                  <> Median recovery from similar drawdowns: <strong style={{ color: '#10b981' }}>{medRecov} months</strong>.</>
                )}
              </div>
            )
          })()}

          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 60px 70px 70px 70px',
            gap: 8, padding: '6px 10px',
            background: '#030b14', borderRadius: 6,
            fontSize: 9, color: '#2a4060', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            marginBottom: 4,
          }}>
            <div>Event</div>
            <div>Peak-to-Trough Drop</div>
            <div style={{ textAlign: 'right' }}>Months</div>
            <div style={{ textAlign: 'right' }}>Recovery</div>
            <div style={{ textAlign: 'right' }}>Pain Score</div>
            <div style={{ textAlign: 'right' }}>Rank</div>
          </div>

          {sortedBears.map((b, rank) => (
            <div key={b.name} style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 60px 70px 70px 70px',
              gap: 8, padding: '8px 10px',
              background: rank % 2 === 0 ? '#030b14' : '#020609',
              borderRadius: 4, marginBottom: 2,
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 700 }}>{b.name}</div>
                <div style={{ fontSize: 9, color: '#2a4060' }}>{b.start} &rarr; {b.end}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: `${Math.abs(b.drop) / 56.8 * 100}%`,
                  height: 8, background: '#ef4444',
                  borderRadius: 2, flexShrink: 0,
                }} />
                <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  {b.drop.toFixed(1)}%
                </span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
                {b.months} mo
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: '#60a5fa', fontWeight: 700 }}>
                {b.recovMonths} mo
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: '#e2e8f0', fontWeight: 800 }}>
                {b.painScore.toFixed(1)}
              </div>
              <div style={{ textAlign: 'right', fontSize: 10, color: '#2a4060' }}>
                #{rank + 1}
              </div>
            </div>
          ))}

          <div style={{
            marginTop: 16, padding: '10px 14px',
            background: '#030f09', border: '1px solid #10b98133',
            borderRadius: 8, fontSize: 11, color: '#10b981',
          }}>
            Every single bear market on this list recovered to new all-time highs.
            The GFC took 48 months (4 years) — the longest recovery. The COVID crash took only 5 months.
            Time in market &gt; timing the market.
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          PANEL: ROLLING RETURN MATRIX
         ══════════════════════════════════════════════════════════════════ */}
      {activePanel === 'matrix' && (
        <div style={{ padding: '16px' }}>
          <div style={{ fontSize: 11, color: '#4a6a8a', marginBottom: 12 }}>
            CAGR for every buy year (column) &times; sell year (row) combination, using S&amp;P 500 annual returns 1986–2026.
            Hover any cell for details. Labels shown every 5 years.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 6 }}>
              <thead>
                <tr>
                  <th style={{
                    width: 30, padding: '2px 4px', textAlign: 'right',
                    fontSize: 7, color: '#2a4060', fontWeight: 700,
                    background: '#020609', position: 'sticky', left: 0, zIndex: 2,
                  }}>
                    Sell
                  </th>
                  {MATRIX_BUY_YRS.map(y => (
                    <th key={y} style={{
                      width: 18, minWidth: 18, padding: 0, textAlign: 'center',
                      fontSize: 6.5, color: y % 5 === 0 ? '#4a6a8a' : 'transparent',
                      fontWeight: 700, background: '#020609',
                    }}>
                      {y % 5 === 0 ? String(y).slice(2) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX_SEL_YRS.map(sy => (
                  <tr key={sy}>
                    <td style={{
                      padding: '0 4px 0 0', textAlign: 'right',
                      fontSize: 6.5,
                      color: (sy % 5 === 0 || sy === 2026) ? '#4a6a8a' : 'transparent',
                      fontWeight: 700, background: '#020609',
                      position: 'sticky', left: 0, zIndex: 1,
                    }}>
                      {(sy % 5 === 0 || sy === 2026) ? sy : ''}
                    </td>
                    {MATRIX_BUY_YRS.map(by => {
                      if (sy <= by) {
                        return <td key={by} style={{ background: '#020609', width: 18, height: 13, padding: 0 }} />
                      }
                      const holdYrs = sy - by
                      const cagr = matrixData[`${by}-${sy}`]
                      return (
                        <td key={by}
                          title={`Buy ${by} → Sell ${sy} (${holdYrs}y): ${cagr != null ? cagr.toFixed(1) + '% CAGR' : 'n/a'}`}
                          style={{
                            background: cagrColor(cagr),
                            width: 18, height: 13, padding: 0,
                            textAlign: 'center', cursor: 'default',
                          }}
                        >
                          {holdYrs >= 5 && cagr != null && (
                            <span style={{ color: cagrTextColor(cagr), fontSize: 5.5, fontWeight: 700, lineHeight: 1 }}>
                              {cagr.toFixed(0)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            {[
              { label: '>15% CAGR', bg: '#034d25', text: '#86efac' },
              { label: '10-15%',    bg: '#0a3d2e', text: '#6ee7b7' },
              { label: '5-10%',     bg: '#0a2d3d', text: '#67e8f9' },
              { label: '0-5%',      bg: '#2d1a00', text: '#fbbf24' },
              { label: '<0%',       bg: '#3d0a0a', text: '#fca5a5' },
            ].map(({ label, bg, text }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 10, background: bg, borderRadius: 2 }} />
                <span style={{ fontSize: 9, color: text }}>{label}</span>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 12, padding: '8px 14px',
            background: '#030f09', border: '1px solid #10b98133',
            borderRadius: 8, fontSize: 11, color: '#10b981',
          }}>
            Every cell with a buy year 5+ years before sell year is green or blue-green —
            time in market eliminates the risk of any single bad year.
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          PANEL: TICKER BETA vs SPX
         ══════════════════════════════════════════════════════════════════ */}
      {activePanel === 'beta' && (
        <div style={{ padding: '16px', maxWidth: 860, margin: '0 auto', width: '100%' }}>
          {!ticker && (
            <div style={{ color: '#2a4060', textAlign: 'center', padding: 40, fontSize: 13 }}>
              Enter a ticker symbol in the main search to see its beta vs. SPX.
            </div>
          )}

          {ticker && !betaStats && (
            <div style={{ color: '#2a4060', textAlign: 'center', padding: 40, fontSize: 13 }}>
              Insufficient daily price data to compute beta for {ticker}.
              Load at least 20 days of data in the main chart.
            </div>
          )}

          {betaStats && (() => {
            const { beta, corr, alpha, tickerReturn, spyReturn, sAvg, tAvg, scatterData } = betaStats

            // Scatter SVG setup
            const svgW = 300, svgH = 200
            const padL = 38, padR = 14, padT = 14, padB = 28
            const sInnerW = svgW - padL - padR
            const sInnerH = svgH - padT - padB

            const xVals = scatterData.map(p => p.sr * 100)
            const yVals = scatterData.map(p => p.tr * 100)
            const xMin  = Math.min(...xVals), xMax = Math.max(...xVals)
            const yMin  = Math.min(...yVals), yMax = Math.max(...yVals)
            const xPad  = (xMax - xMin) * 0.08 || 0.5
            const yPad  = (yMax - yMin) * 0.08 || 0.5
            const xLo   = xMin - xPad, xHi = xMax + xPad
            const yLo   = yMin - yPad, yHi = yMax + yPad

            const toSvgX = x => padL + ((x - xLo) / (xHi - xLo)) * sInnerW
            const toSvgY = y => padT + ((yHi - y) / (yHi - yLo)) * sInnerH

            const sAvgPct = sAvg * 100, tAvgPct = tAvg * 100
            const regY1   = tAvgPct + (beta ?? 0) * (xLo - sAvgPct)
            const regY2   = tAvgPct + (beta ?? 0) * (xHi - sAvgPct)

            const betaLabel = beta != null
              ? `${beta.toFixed(2)}x`
              : 'N/A'

            const betaColor = beta == null ? '#4a6a8a'
              : beta > 1.5 ? '#f59e0b'
              : beta < 0.8 ? '#60a5fa'
              : '#10b981'

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Stats row */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {/* Beta card */}
                  <div style={{
                    flex: '1 1 220px', padding: '14px 16px',
                    background: '#030b14', border: `1px solid ${betaColor}33`,
                    borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>BETA vs SPX</div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: betaColor, lineHeight: 1 }}>
                      {betaLabel}
                    </div>
                    <div style={{ fontSize: 11, color: '#4a6a8a', marginTop: 6, lineHeight: 1.5 }}>
                      {beta != null && beta > 1.5 && `Moves ~${beta.toFixed(1)}x the magnitude of SPX. A +1% SPX day → typically +${beta.toFixed(1)}% for ${ticker}.`}
                      {beta != null && beta >= 0.8 && beta <= 1.5 && `Moves in line with SPX (beta near 1). Tracks the market closely.`}
                      {beta != null && beta < 0.8 && beta >= 0 && `Low-beta defensive. Less sensitive to SPX macro swings.`}
                      {beta != null && beta < 0 && `Negative beta — tends to move opposite to SPX.`}
                    </div>
                  </div>

                  {/* Correlation card */}
                  <div style={{
                    flex: '1 1 160px', padding: '14px 16px',
                    background: '#030b14', border: '1px solid #60a5fa22',
                    borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>CORRELATION TO SPX</div>
                    {corr != null && (
                      <>
                        <div style={{ fontSize: 28, fontWeight: 800, color: '#60a5fa', lineHeight: 1 }}>
                          {corr.toFixed(2)}
                        </div>
                        <div style={{
                          marginTop: 6, height: 6, borderRadius: 3,
                          background: '#0a1820', overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${Math.abs(corr) * 100}%`, height: '100%',
                            background: corr > 0 ? '#60a5fa' : '#ef4444',
                            borderRadius: 3,
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: '#4a6a8a', marginTop: 4 }}>
                          {corr > 0.7 ? 'High correlation — tracks SPX closely' :
                           corr > 0.4 ? 'Moderate correlation to SPX' :
                           'Low correlation — more independent'}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Alpha card */}
                  <div style={{
                    flex: '1 1 160px', padding: '14px 16px',
                    background: '#030b14',
                    border: `1px solid ${alpha != null && alpha >= 0 ? '#10b98133' : '#ef444433'}`,
                    borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>ALPHA (vs SPX)</div>
                    {alpha != null && (
                      <>
                        <div style={{
                          fontSize: 28, fontWeight: 800, lineHeight: 1,
                          color: alpha >= 0 ? '#10b981' : '#ef4444',
                        }}>
                          {alpha >= 0 ? '+' : ''}{alpha.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 10, color: '#4a6a8a', marginTop: 6, lineHeight: 1.4 }}>
                          {alpha >= 0
                            ? `Outperformed SPX by ${alpha.toFixed(1)}% beyond what beta explains`
                            : `Underperformed SPX by ${Math.abs(alpha).toFixed(1)}% after adjusting for beta`}
                        </div>
                        <div style={{ fontSize: 9, color: '#1a3050', marginTop: 4 }}>
                          {ticker}: {tickerReturn != null ? `${tickerReturn >= 0 ? '+' : ''}${tickerReturn.toFixed(1)}%` : 'n/a'}
                          &nbsp;&middot;&nbsp;
                          SPY: {spyReturn != null ? `${spyReturn >= 0 ? '+' : ''}${spyReturn.toFixed(1)}%` : 'n/a'}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Scatter plot + options callout */}
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {/* SVG scatter */}
                  <div style={{ background: '#030b14', border: '1px solid #0a1820', borderRadius: 8, padding: 8, flexShrink: 0 }}>
                    <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>
                      DAILY RETURNS SCATTER &mdash; last {scatterData.length} days
                    </div>
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      style={{ width: svgW, height: svgH, display: 'block', maxWidth: '100%' }}
                    >
                      {/* Zero lines */}
                      <line x1={toSvgX(0)} y1={padT} x2={toSvgX(0)} y2={padT + sInnerH}
                        stroke="#1a3050" strokeWidth={1} />
                      <line x1={padL} y1={toSvgY(0)} x2={padL + sInnerW} y2={toSvgY(0)}
                        stroke="#1a3050" strokeWidth={1} />

                      {/* Axis labels */}
                      <text x={svgW / 2} y={svgH - 4} textAnchor="middle" fontSize={8} fill="#2a4060">
                        SPY daily return %
                      </text>
                      <text x={10} y={svgH / 2} textAnchor="middle" fontSize={8} fill="#2a4060"
                        transform={`rotate(-90, 10, ${svgH / 2})`}>
                        {ticker} %
                      </text>

                      {/* Regression line */}
                      {beta != null && (
                        <line
                          x1={toSvgX(xLo)} y1={Math.max(padT, Math.min(padT + sInnerH, toSvgY(regY1)))}
                          x2={toSvgX(xHi)} y2={Math.max(padT, Math.min(padT + sInnerH, toSvgY(regY2)))}
                          stroke="#60a5fa" strokeWidth={1.5} opacity={0.7}
                        />
                      )}

                      {/* Scatter dots */}
                      {scatterData.map((p, i) => {
                        const cx = toSvgX(p.sr * 100)
                        const cy = toSvgY(p.tr * 100)
                        if (cx < padL || cx > padL + sInnerW || cy < padT || cy > padT + sInnerH) return null
                        return (
                          <circle key={i} cx={cx} cy={cy} r={2.5}
                            fill={p.sr >= 0 ? '#10b981' : '#ef4444'}
                            opacity={0.6}
                          >
                            <title>{`SPY ${(p.sr * 100).toFixed(2)}% | ${ticker} ${(p.tr * 100).toFixed(2)}%`}</title>
                          </circle>
                        )
                      })}

                      {/* Tick labels X */}
                      {[-2, 0, 2].map(v => (
                        <text key={v} x={toSvgX(v)} y={padT + sInnerH + 12}
                          textAnchor="middle" fontSize={7} fill="#2a4060">
                          {v > 0 ? '+' : ''}{v}%
                        </text>
                      ))}
                    </svg>
                  </div>

                  {/* Options callout */}
                  <div style={{
                    flex: 1, padding: '14px 16px',
                    background: '#020912', border: '1px solid #60a5fa22',
                    borderRadius: 8, minWidth: 200,
                  }}>
                    <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 8 }}>
                      WHAT THIS MEANS FOR OPTIONS
                    </div>
                    {beta != null && beta > 1.5 && (
                      <div style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.6 }}>
                        <strong>High beta</strong> — options are more expensive (higher IV typical).
                        Prefer buying options on strong directional setups.
                        Moves can overshoot SPX signals — tighter stops, wider targets.
                      </div>
                    )}
                    {beta != null && beta >= 0.8 && beta <= 1.5 && (
                      <div style={{ fontSize: 12, color: '#60a5fa', lineHeight: 1.6 }}>
                        <strong>Market-tracking beta</strong> — options priced similarly to broad market.
                        SPX regime signals translate well.
                        Good for both buying and selling premium based on regime.
                      </div>
                    )}
                    {beta != null && beta < 0.8 && (
                      <div style={{ fontSize: 12, color: '#10b981', lineHeight: 1.6 }}>
                        <strong>Low-beta defensive</strong> — options are cheaper.
                        Good for selling premium. Less sensitive to SPX macro swings.
                        Focus on stock-specific catalysts more than market regime.
                      </div>
                    )}
                    {corr != null && corr < 0.4 && (
                      <div style={{ fontSize: 11, color: '#a78bfa', marginTop: 10, lineHeight: 1.5 }}>
                        <strong>Low correlation to SPX ({corr.toFixed(2)})</strong> — trades more independently.
                        Top-down SPX regime matters less here; focus on stock-specific catalysts.
                      </div>
                    )}
                    <div style={{ marginTop: 12, fontSize: 9, color: '#1a3050', lineHeight: 1.4 }}>
                      Based on {betaStats.n} days of aligned daily close data.
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}

    </div>
  )
}
