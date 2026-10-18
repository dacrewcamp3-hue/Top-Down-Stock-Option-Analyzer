import { useMemo, useState, useRef, useEffect } from 'react'
import { calcSMC } from '../utils/indicators'
import { useEmaNames } from '../utils/emaNames'
import './PriceChart.css'

// SVG layout constants
const VW    = 900
const PH    = 290   // price area height
const VH    = 55    // volume area height
const GAP   = 10    // gap between price and volume
const RSI_H   = 50
const RSI_GAP = 6
const RSI_Y   = PH + GAP + VH + RSI_GAP
const TOTAL   = RSI_Y + RSI_H + 24
const PL = 58, PR = 78, PT = 8   // PR extended to house the volume profile

// Right-side volume profile geometry
const PROF_X = VW - PR + 2   // left edge of profile column (824)
const PROF_W = 70             // profile bar width

// Empty bar slots on the right so the last candle never looks "cut off"
const FUTURE_BARS  = 6
const PROFILE_BINS = 30

function calcEMA(prices, period) {
  if (prices.length < period) return prices.map(() => null)
  const k = 2 / (period + 1)
  const result = new Array(period - 1).fill(null)
  let e = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  result.push(e)
  for (let i = period; i < prices.length; i++) {
    e = prices[i] * k + e * (1 - k)
    result.push(e)
  }
  return result
}

function calcHeikinAshi(opens, highs, lows, closes) {
  const n   = closes.length
  const haO = new Float64Array(n)
  const haH = new Float64Array(n)
  const haL = new Float64Array(n)
  const haC = new Float64Array(n)
  haC[0] = (opens[0] + highs[0] + lows[0] + closes[0]) / 4
  haO[0] = (opens[0] + closes[0]) / 2
  haH[0] = highs[0]
  haL[0] = lows[0]
  for (let i = 1; i < n; i++) {
    haC[i] = (opens[i] + highs[i] + lows[i] + closes[i]) / 4
    haO[i] = (haO[i - 1] + haC[i - 1]) / 2
    haH[i] = Math.max(highs[i], haO[i], haC[i])
    haL[i] = Math.min(lows[i], haO[i], haC[i])
  }
  return { haO, haH, haL, haC }
}

// Detect pullbacks vs retracements within a trend (price relative to EMA 65).
//   PULLBACK   — shallow counter-trend move that stays above EMA 15 (23–38% depth).
//                Brief pause. Low-risk add-to-position opportunity in the trend direction.
//   RETRACE    — deeper counter-trend move that reaches/crosses EMA 15 (38–62% depth).
//                More significant pause. Still within the trend but requires patience.
//   REVERSAL   — NOT detected here. Would be price breaking EMA 65 and staying there.
// Requires 2+ consecutive counter-trend bars to filter single-bar noise.
function detectPullbacksRetracements(c, h, l, e5, e15, e65) {
  const results = []
  const n = c.length
  let inCounter = false
  let counterBars = 0
  let counterExtreme = null
  let counterExtremeIdx = -1
  let trendKind = null

  for (let i = 1; i < n; i++) {
    if (e5[i] == null || e15[i] == null || e65[i] == null) { inCounter = false; counterBars = 0; continue }
    const isBull = c[i] > e65[i]
    const isBear = c[i] < e65[i]

    if (isBull) {
      const isCounter = c[i] < e5[i]
      if (isCounter) {
        if (!inCounter || trendKind !== 'bull') {
          inCounter = true; trendKind = 'bull'; counterBars = 1
          counterExtreme = l[i]; counterExtremeIdx = i
        } else {
          counterBars++
          if (l[i] < counterExtreme) { counterExtreme = l[i]; counterExtremeIdx = i }
        }
      } else if (inCounter && trendKind === 'bull') {
        if (counterBars >= 2) {
          const kind = counterExtreme <= e15[counterExtremeIdx] ? 'retrace' : 'pullback'
          results.push({ kind, trend: 'bull', idx: counterExtremeIdx })
        }
        inCounter = false; counterBars = 0
      } else { inCounter = false; counterBars = 0 }
    } else if (isBear) {
      const isCounter = c[i] > e5[i]
      if (isCounter) {
        if (!inCounter || trendKind !== 'bear') {
          inCounter = true; trendKind = 'bear'; counterBars = 1
          counterExtreme = h[i]; counterExtremeIdx = i
        } else {
          counterBars++
          if (h[i] > counterExtreme) { counterExtreme = h[i]; counterExtremeIdx = i }
        }
      } else if (inCounter && trendKind === 'bear') {
        if (counterBars >= 2) {
          const kind = counterExtreme >= e15[counterExtremeIdx] ? 'retrace' : 'pullback'
          results.push({ kind, trend: 'bear', idx: counterExtremeIdx })
        }
        inCounter = false; counterBars = 0
      } else { inCounter = false; counterBars = 0 }
    } else { inCounter = false; counterBars = 0 }
  }
  return results
}

function calcRSI(prices, period = 14) {
  const result = new Array(prices.length).fill(null)
  if (prices.length < period + 1) return result
  let gainSum = 0, lossSum = 0
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1]
    if (d > 0) gainSum += d; else lossSum -= d
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1]
    const g = d > 0 ? d : 0
    const l = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

function fmtVol(v) {
  if (!v) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`
  return v.toString()
}

function fmtPx(p) {
  if (!p && p !== 0) return '—'
  if (p >= 1000) return `${(p / 1000).toFixed(2)}K`
  if (p < 1)     return p.toFixed(3)
  return p.toFixed(2)
}

const PAT_DESC = {
  // Adam & Eve Double Tops
  'Adam & Adam Top':       'Two sharp-spike peaks at the same resistance — both breakout attempts were instantly rejected. Powerful bearish reversal; the sharpness of both peaks signals decisive seller control.',
  'Adam & Eve Top':        'Sharp spike first peak, then a rounded broad distribution top — the classic double top. Institutional selling detected on the second, wider top. High-conviction bearish reversal on neckline break.',
  'Eve & Adam Top':        'Rounded first peak followed by a sharp rejection spike — sellers aggressively defended resistance on the second test. Bearish reversal; the spike confirms the level is defended.',
  'Eve & Eve Top':         'Both peaks are broad and rounded — a prolonged distribution zone. Slower to resolve but confirms a ceiling. Bearish on neckline break with volume.',
  // Adam & Eve Double Bottoms
  'Adam & Adam Bottom':    'Two sharp V-shaped spike lows at the same support — sellers tried twice and buyers crushed them both times. Explosive bullish reversal potential, especially on capitulation volume.',
  'Adam & Eve Bottom':     'Sharp spike first low, then a broad rounded accumulation base — the textbook double bottom. Buyers absorbed all supply on the second, wider bottom. High-conviction bullish reversal on neckline break.',
  'Eve & Adam Bottom':     'Rounded first trough, then a sharp downward rejection — buyers aggressively defended support on the second test. Bullish reversal; the spike signals institutional buying at the level.',
  'Eve & Eve Bottom':      'Both troughs are broad and rounded — a long accumulation base. The longer the base, the stronger the eventual breakout. Bullish on neckline break; patience rewarded.',
  'Head & Shoulders':      'Three peaks: left shoulder, higher head, lower right shoulder. Classic bearish top — bearish if neckline breaks.',
  'Inv. Head & Shoulders': 'Three troughs: left shoulder, lower head, higher right shoulder. Classic bullish bottom — bullish on neckline break.',
  'Ascending Triangle':    'Flat resistance with rising support — buyers pressing up into a decision point. Bullish breakout expected.',
  'Descending Triangle':   'Flat support with falling resistance — sellers pressing down into a decision point. Bearish breakdown expected.',
  'Symmetrical Triangle':  'Converging trendlines with no directional bias — expect a breakout in the direction of the prior trend.',
  'Rising Wedge':          'Both highs and lows rising but converging — buyers weakening. Typically resolves with a sharp bearish breakdown.',
  'Falling Wedge':         'Both highs and lows falling but converging — sellers weakening. Typically resolves with a bullish breakout.',
  'Rectangle':             'Price consolidating in a horizontal band — neither side in control. Breakout direction usually continues prior trend.',
  'Bull Pennant':          'Sharp pole up then tight triangular consolidation — momentum pause before continuation. Expect breakout higher.',
  'Bear Pennant':          'Sharp pole down then tight triangular consolidation — momentum pause before continuation. Expect breakdown lower.',
}

const TF_DEFAULT_BARS = { W: 52, D: 80, '4H': 60, '1H': 30, '15M': 40, '5M': 48 }

export default function PriceChart({
  closes, highs, lows, opens, volumes, timestamps,
  orbHigh, orbLow, fibLevels, title, timeframe = 'D',
  showPreMarket = false,
  prevDayClose = null,
  swingTargets = [],
  gammaFlip = null,
  callWall = null,
  putWall = null,
  maxPain = null,
  spyCloses = null,
  tfAlignment = null,
  vixData = null,
  verdict = null,
  flowSentiment = null,
  gapClass = null,
}) {
  const emaNames = useEmaNames()

  const [barCount,   setBarCount]   = useState(() => TF_DEFAULT_BARS[timeframe] ?? 80)
  const [panOffset,  setPanOffset]  = useState(0)
  const [crosshair,  setCrosshair]  = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [tooltip,    setTooltip]    = useState(null)
  const [drawTool,      setDrawTool]      = useState('none')  // 'none'|'hline'|'trend'|'erase'
  const [drawings,      setDrawings]      = useState({})       // keyed by `${title}-${timeframe}`
  const [draftLine,     setDraftLine]     = useState(null)     // in-progress trendline {x1,y1,x2,y2}
  const [showEntryEmas, setShowEntryEmas] = useState(true)     // EMA 5, 15, 30
  const [showTrendEmas, setShowTrendEmas] = useState(true)     // EMA 65, 200
  const [showFib,       setShowFib]       = useState(true)     // Fibonacci levels
  const [showRSI,         setShowRSI]         = useState(false)    // RSI sub-panel
  const [showAllPatterns, setShowAllPatterns] = useState(false)    // all patterns vs. ≥75% win-rate only
  const [useHA,         setUseHA]         = useState(true)
  const [anchoredVwaps, setAnchoredVwaps] = useState([])  // [{anchorIdx, color, label}]
  const [showRS,        setShowRS]        = useState(false)
  const [showSweeps,    setShowSweeps]    = useState(false)
  const [showOBs,       setShowOBs]       = useState(false)
  const [showTools,     setShowTools]     = useState(false)

  const svgRef         = useRef(null)
  const userClosedRSI  = useRef(false)
  const barCountRef    = useRef(TF_DEFAULT_BARS[timeframe] ?? 80)
  const totalBarsRef   = useRef(0)
  const dragFracRef    = useRef(0)
  const wheelAccRef    = useRef(0)
  const wheelRafRef    = useRef(null)
  const panAccRef      = useRef(0)
  const panRafRef      = useRef(null)

  // Design system — 3 font sizes, 2 stroke weights, semantic color palette
  const DS = {
    fs:  { sm: 7, md: 8.5, lg: 10.5 },
    sw:  { thin: 0.8, thick: 1.8 },
    col: {
      bull:    '#10b981',   // green — bullish signals ONLY
      bear:    '#ef4444',   // red — bearish signals ONLY
      caution: '#f59e0b',   // amber — caution/confluence/neutral ONLY
      info:    '#60a5fa',   // blue — informational/price labels
      dim:     '#2a4060',   // muted — watermarks, secondary labels
      grid:    '#0b1c2e',
      bg:      '#040b16',
    },
  }

  useEffect(() => { barCountRef.current = barCount }, [barCount])

  const totalBars = closes?.length ?? 0
  useEffect(() => { totalBarsRef.current = totalBars }, [totalBars])

  // When pre-market is enabled, widen the bar window so today's early bars are visible.
  // Only expands — never shrinks — so a user who already zoomed out keeps their view.
  const PM_BAR_COUNTS = { '5M': 150, '15M': 55, '1H': 30 }
  useEffect(() => {
    if (!showPreMarket) return
    const target = PM_BAR_COUNTS[timeframe]
    if (!target) return
    setBarCount(prev => Math.max(prev, target))
    setPanOffset(0)
  }, [showPreMarket, timeframe])

  // Non-passive wheel — rAF-throttled so trackpad fires one setState per frame
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      wheelAccRef.current += e.deltaY
      if (wheelRafRef.current) return
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null
        const acc   = wheelAccRef.current
        wheelAccRef.current = 0
        const curr  = barCountRef.current
        const total = totalBarsRef.current
        // 5% per 100 deltaY, capped at 12% per frame so fast scrolls stay controlled
        const gestureUnits = Math.abs(acc) / 100
        const step = Math.max(1, Math.min(
          Math.ceil(curr * 0.12),
          Math.ceil(gestureUnits * curr * 0.05)
        ))
        setBarCount(acc < 0
          ? Math.max(15, curr - step)
          : Math.min(total, curr + step)
        )
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current)
    }
  }, [])

  const curKey   = `${title}-${timeframe}`
  const curLines = drawings[curKey] ?? []

  const d = useMemo(() => {
    if (!closes?.length || !highs?.length || !lows?.length || !opens?.length) return null
    const n      = closes.length
    const clamp  = Math.max(0, Math.min(panOffset, Math.max(0, n - barCount)))
    const endIdx = n - clamp
    const s      = Math.max(0, endIdx - barCount)
    const nb     = endIdx - s
    if (nb < 2) return null

    // Heikin-Ashi — computed from full history so HA open is properly seeded
    const ha = calcHeikinAshi(opens, highs, lows, closes)
    const c  = useHA ? Array.from(ha.haC.slice(s, endIdx)) : Array.from(closes.slice(s, endIdx))
    const h  = useHA ? Array.from(ha.haH.slice(s, endIdx)) : Array.from(highs.slice(s, endIdx))
    const l  = useHA ? Array.from(ha.haL.slice(s, endIdx)) : Array.from(lows.slice(s, endIdx))
    const o  = useHA ? Array.from(ha.haO.slice(s, endIdx)) : Array.from(opens.slice(s, endIdx))
    const v  = (volumes    ?? []).slice(s, endIdx)
    const ts = (timestamps ?? []).slice(s, endIdx)

    // EMAs seeded from full history so values are stable regardless of zoom window
    const e5   = calcEMA(closes, 5).slice(s, endIdx)
    const e15  = calcEMA(closes, 15).slice(s, endIdx)
    const e30  = calcEMA(closes, 30).slice(s, endIdx)
    const e65  = calcEMA(closes, 65).slice(s, endIdx)
    const e200 = calcEMA(closes, 200).slice(s, endIdx)

    // Range with ATR-based padding so candles never crowd the top/bottom edges
    const rawMin = Math.min(...l)
    const rawMax = Math.max(...h)
    const atrPad = (rawMax - rawMin) * 0.07
    const priceMin = rawMin - atrPad
    const priceMax = rawMax + atrPad
    const volMax   = Math.max(...v, 1)

    const pw = VW - PL - PR
    const ph = PH - PT

    // totalSlots includes FUTURE_BARS so the last candle has breathing room on the right
    const totalSlots = nb + FUTURE_BARS
    const xOf = i => PL + (i + 0.5) / totalSlots * pw
    const yOf = p => PT + (1 - (p - priceMin) / (priceMax - priceMin)) * ph
    const cyOf = y => Math.max(PT, Math.min(PH, y))
    const bw   = Math.max(1.5, pw / totalSlots * 0.60)

    const toPoints = arr =>
      arr.map((val, i) => `${xOf(i).toFixed(1)},${yOf(val).toFixed(1)}`).join(' ')

    // Y-axis ticks (8 levels for better resolution)
    const yTicks = Array.from({ length: 8 }, (_, i) => {
      const p = priceMin + (priceMax - priceMin) * (i / 7)
      return { p, y: yOf(p) }
    })

    // X-axis labels — strategy varies by timeframe
    const isIntraday = timeframe === '4H' || timeframe === '1H' || timeframe === '15M' || timeframe === '5M'
    const isHighFreq = timeframe === '15M' || timeframe === '5M'

    // Minimum pixel gap between label centers (prevents stacking at any zoom level)
    const MIN_LABEL_PX = 54

    // Pre-market bar detection — used for visual overlays and dimming
    const preMarketSet = new Set()
    const sessionOpens = []  // first regular-session bar per day (9:30 AM ET)
    if (isIntraday) {
      const etFmt = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/New_York',
      })
      let prevDayKey = null, sessionOpenFound = false
      ts.forEach((t, i) => {
        if (!t) return
        const parts = etFmt.formatToParts(new Date(t * 1000))
        const rawH  = parseInt(parts.find(p => p.type === 'hour').value, 10)
        const m     = parseInt(parts.find(p => p.type === 'minute').value, 10)
        const etH   = rawH === 24 ? 0 : rawH
        const etMin = etH * 60 + m
        const dk    = new Date(t * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        if (dk !== prevDayKey) { prevDayKey = dk; sessionOpenFound = false }
        if (etMin < 570) {
          preMarketSet.add(i)
        } else if (!sessionOpenFound) {
          sessionOpens.push({ i, x: xOf(i) })
          sessionOpenFound = true
        }
      })
    }

    // Build raw candidate labels, then filter to MIN_LABEL_PX spacing
    const xLabelCandidates = []

    if (!isIntraday) {
      // Daily / Weekly: month boundaries; year boundaries get "Jan '25" style
      let lastMonth = -1, lastYear = -1
      ts.forEach((t, i) => {
        if (!t || i === 0 || i >= nb - 1) return
        const dt = new Date(t * 1000)
        const mo = dt.getUTCMonth(), yr = dt.getUTCFullYear()
        if (mo !== lastMonth) {
          const isNewYear = yr !== lastYear
          const label = isNewYear
            ? dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
            : dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
          xLabelCandidates.push({ x: xOf(i), label, isPrimary: isNewYear || mo === 0 })
          lastMonth = mo
          if (isNewYear) lastYear = yr
        }
      })
    } else if (isHighFreq) {
      // 15M / 5M: day boundaries show date ("Mon Dec 5"), hour boundaries show time ("10:00")
      const hasPre = preMarketSet.size > 0
      const etFmtT = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/New_York',
      })
      const etFmtD = new Intl.DateTimeFormat('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        timeZone: 'America/New_York',
      })
      let lastHourKey = null, lastDayKey = null
      ts.forEach((t, i) => {
        if (!t || i === 0 || i >= nb - 1) return
        const d      = new Date(t * 1000)
        const parts  = etFmtT.formatToParts(d)
        const rawH   = parseInt(parts.find(p => p.type === 'hour').value, 10)
        const m      = parseInt(parts.find(p => p.type === 'minute').value, 10)
        const etH    = rawH === 24 ? 0 : rawH
        const etMin  = etH * 60 + m
        const minMn  = hasPre ? 240 : 570
        if (etMin < minMn || etMin >= 960) return
        const dk     = d.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        const hKey   = `${dk}-${etH}`
        const newDay = dk !== lastDayKey
        if (newDay) {
          xLabelCandidates.push({ x: xOf(i), label: etFmtD.format(d), isPrimary: true })
          lastDayKey = dk; lastHourKey = hKey
        } else if (hKey !== lastHourKey) {
          xLabelCandidates.push({ x: xOf(i), label: `${etH}:${m.toString().padStart(2, '0')}`, isPrimary: false })
          lastHourKey = hKey
        }
      })
    } else {
      // 4H / 1H: day boundaries; month transitions show full "Dec 5", others show day number only
      let lastDay = -1, lastMonth = -1
      ts.forEach((t, i) => {
        if (!t || i === 0 || i >= nb - 1) return
        const dt  = new Date(t * 1000)
        const day = dt.getDate(), mo = dt.getMonth()
        if (day !== lastDay) {
          const isNewMonth = mo !== lastMonth
          const label = isNewMonth
            ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : String(day)
          xLabelCandidates.push({ x: xOf(i), label, isPrimary: isNewMonth })
          lastDay = day
          if (isNewMonth) lastMonth = mo
        }
      })
    }

    // Filter candidates: enforce minimum pixel gap between accepted labels
    const xLabels = []
    let lastAcceptedX = -Infinity
    for (const c of xLabelCandidates) {
      if (c.x - lastAcceptedX >= MIN_LABEL_PX) {
        xLabels.push(c)
        lastAcceptedX = c.x
      }
    }

    // Separator lines — week boundaries for daily/weekly, day boundaries for intraday
    const weekSeps = []
    if (!isIntraday) {
      ts.forEach((t, i) => {
        if (!t || i === 0) return
        const day     = new Date(t * 1000).getDay()
        const prevDay = new Date(ts[i - 1] * 1000).getDay()
        if (day <= prevDay) weekSeps.push(xOf(i) - pw / totalSlots / 2)
      })
    } else {
      ts.forEach((t, i) => {
        if (!t || i === 0) return
        const d0 = new Date(t * 1000).getDate()
        const d1 = new Date(ts[i - 1] * 1000).getDate()
        if (d0 !== d1) weekSeps.push(xOf(i) - pw / totalSlots / 2)
      })
    }

    // Volume SMA-20 points for the average line
    const VOL_SMA = 20
    const volAvgPoints = v.map((_, i) => {
      const start = Math.max(0, i - VOL_SMA + 1)
      const slice = v.slice(start, i + 1)
      const avg   = slice.reduce((a, b) => a + b, 0) / slice.length
      const barH  = (avg / volMax) * VH
      return `${xOf(i).toFixed(1)},${(PH + GAP + VH - barH).toFixed(1)}`
    })
    // Numeric volume average per bar — gates all candlestick signal callouts
    const volAvgArr = v.map((_, i) => {
      const start = Math.max(0, i - VOL_SMA + 1)
      const slice = v.slice(start, i + 1)
      return slice.reduce((a, b) => a + b, 0) / slice.length
    })

    // ── VWAP (typical price × volume weighted) ────────────────────────────────
    // Resets each ET calendar day on intraday timeframes; cumulative on D/W
    const vwapArr = new Array(nb).fill(null)
    {
      let cumTPV = 0, cumVol = 0, lastDayKey = null
      for (let i = 0; i < nb; i++) {
        if (isIntraday && ts[i]) {
          const dk = new Date(ts[i] * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
          if (dk !== lastDayKey) { cumTPV = 0; cumVol = 0; lastDayKey = dk }
        }
        const tp = (highs[s + i] + lows[s + i] + closes[s + i]) / 3   // real OHLC, not HA
        cumTPV += tp * (v[i] || 0)
        cumVol += v[i] || 0
        vwapArr[i] = cumVol > 0 ? cumTPV / cumVol : null
      }
    }
    // Pre-compute VWAP as SVG polyline segments (each intraday day = its own segment)
    const vwapSegments = []
    {
      let seg = []
      for (let i = 0; i < nb; i++) {
        const val = vwapArr[i]
        if (val == null || val < priceMin || val > priceMax) {
          if (seg.length > 1) vwapSegments.push(seg.join(' '))
          seg = []; continue
        }
        if (isIntraday && i > 0 && ts[i] && ts[i - 1]) {
          const dk0 = new Date(ts[i - 1] * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
          const dk1 = new Date(ts[i]     * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
          if (dk0 !== dk1) { if (seg.length > 1) vwapSegments.push(seg.join(' ')); seg = [] }
        }
        seg.push(`${xOf(i).toFixed(1)},${yOf(val).toFixed(1)}`)
      }
      if (seg.length > 1) vwapSegments.push(seg.join(' '))
    }

    // Detect if the last bar is today
    const today = new Date()
    const lastTs = ts[nb - 1]
    const isToday = lastTs
      ? new Date(lastTs * 1000).toDateString() === today.toDateString()
      : false

    // ── Reversal patterns ────────────────────────────────────────────────────
    const pxRange   = priceMax - priceMin
    const bodyOf    = i => Math.abs(c[i] - o[i])
    const midOf     = i => (c[i] + o[i]) / 2
    const isBull    = i => c[i] >= o[i]
    const upShadow  = i => isBull(i) ? h[i] - c[i] : h[i] - o[i]
    const dnShadow  = i => isBull(i) ? o[i] - l[i] : c[i] - l[i]
    const barRange  = i => h[i] - l[i]

    const rawReversals = []
    for (let i = 1; i < nb - 1; i++) {
      // Volume gate — no signal without at least 1.2× the 20-bar average volume
      if (volAvgArr[i] > 0 && v[i] < volAvgArr[i] * 1.2) continue
      const b0 = bodyOf(i), b1 = bodyOf(i - 1)
      const r0 = barRange(i), r1 = barRange(i - 1)
      const us0 = upShadow(i), ds0 = dnShadow(i)
      const lb = Math.max(0, i - 6)
      const prevLows  = l.slice(lb, i - 1)
      const prevHighs = h.slice(lb, i - 1)
      const recentLow  = prevLows.length  ? Math.min(...prevLows)  : l[i - 1]
      const recentHigh = prevHighs.length ? Math.max(...prevHighs) : h[i - 1]

      // ── Two-bar patterns ──────────────────────────────────────────────────
      // Bullish Engulfing
      if (!isBull(i - 1) && isBull(i) && o[i] <= c[i - 1] && c[i] >= o[i - 1] &&
          b0 >= b1 * 0.8 && l[i - 1] <= recentLow * 1.012) {
        rawReversals.push({ kind: 'bull', label: '↑Eng', name: 'Bullish Engulfing', candles: 2, rate: 63,
          desc: 'A large green candle fully engulfs the prior red candle — sellers are exhausted and bulls seize control. Strongest near a key support level after a downtrend.',
          x: xOf(i), yMark: yOf(Math.min(l[i], l[i - 1])) + 10 })
      }
      // Bearish Engulfing
      if (isBull(i - 1) && !isBull(i) && o[i] >= c[i - 1] && c[i] <= o[i - 1] &&
          b0 >= b1 * 0.8 && h[i - 1] >= recentHigh * 0.988) {
        rawReversals.push({ kind: 'bear', label: '↓Eng', name: 'Bearish Engulfing', candles: 2, rate: 63,
          desc: 'A large red candle fully engulfs the prior green candle — buyers exhausted and bears take over. Most reliable near resistance after an uptrend.',
          x: xOf(i), yMark: yOf(Math.max(h[i], h[i - 1])) - 10 })
      }
      // Bullish Harami (inside bar, bull)
      if (!isBull(i - 1) && isBull(i) && b1 > 0 && b0 < b1 * 0.6 &&
          Math.min(o[i], c[i]) > Math.min(o[i - 1], c[i - 1]) &&
          Math.max(o[i], c[i]) < Math.max(o[i - 1], c[i - 1]) &&
          l[i - 1] <= recentLow * 1.012) {
        rawReversals.push({ kind: 'bull', label: '↑Hrm', name: 'Bullish Harami', candles: 2, rate: 53,
          desc: 'A small bullish candle forms completely inside the body of the prior bearish candle — indecision after a downtrend. Watch for the next candle to confirm direction.',
          x: xOf(i), yMark: yOf(Math.min(l[i], l[i - 1])) + 10 })
      }
      // Bearish Harami (inside bar, bear)
      if (isBull(i - 1) && !isBull(i) && b1 > 0 && b0 < b1 * 0.6 &&
          Math.min(o[i], c[i]) > Math.min(o[i - 1], c[i - 1]) &&
          Math.max(o[i], c[i]) < Math.max(o[i - 1], c[i - 1]) &&
          h[i - 1] >= recentHigh * 0.988) {
        rawReversals.push({ kind: 'bear', label: '↓Hrm', name: 'Bearish Harami', candles: 2, rate: 53,
          desc: 'A small bearish candle forms completely inside the prior bullish candle — buyers losing momentum near resistance. Needs bearish confirmation next bar.',
          x: xOf(i), yMark: yOf(Math.max(h[i], h[i - 1])) - 10 })
      }
      // Tweezer Bottom
      if (Math.abs(l[i] - l[i - 1]) < pxRange * 0.004 && !isBull(i - 1) && isBull(i) &&
          l[i - 1] <= recentLow * 1.01 && r0 > 0 && r1 > 0) {
        rawReversals.push({ kind: 'bull', label: '↑Twz', name: 'Tweezer Bottom', candles: 2, rate: 58,
          desc: 'Two candles with nearly identical lows — sellers tried twice to push lower and failed both times. Strong support signal, especially after a trend.',
          x: xOf(i), yMark: yOf(Math.min(l[i], l[i - 1])) + 10 })
      }
      // Tweezer Top
      if (Math.abs(h[i] - h[i - 1]) < pxRange * 0.004 && isBull(i - 1) && !isBull(i) &&
          h[i - 1] >= recentHigh * 0.99 && r0 > 0 && r1 > 0) {
        rawReversals.push({ kind: 'bear', label: '↓Twz', name: 'Tweezer Top', candles: 2, rate: 58,
          desc: 'Two candles with nearly identical highs — buyers tried twice to break through and failed both times. Strong resistance signal after an uptrend.',
          x: xOf(i), yMark: yOf(Math.max(h[i], h[i - 1])) - 10 })
      }
      // Dark Cloud Cover
      if (isBull(i - 1) && !isBull(i) && b1 > pxRange * 0.005 &&
          o[i] > h[i - 1] && c[i] < midOf(i - 1) && c[i] > l[i - 1] &&
          h[i - 1] >= recentHigh * 0.988) {
        rawReversals.push({ kind: 'bear', label: '↓DC', name: 'Dark Cloud Cover', candles: 2, rate: 66,
          desc: 'Bearish candle gaps up above prior high but closes below the prior bull midpoint — bulls trapped at the top, sellers take control.',
          x: xOf(i), yMark: yOf(Math.max(h[i], h[i - 1])) - 10 })
      }
      // Piercing Line
      if (!isBull(i - 1) && isBull(i) && b1 > pxRange * 0.005 &&
          o[i] < l[i - 1] && c[i] > midOf(i - 1) && c[i] < o[i - 1] &&
          l[i - 1] <= recentLow * 1.012) {
        rawReversals.push({ kind: 'bull', label: '↑PL', name: 'Piercing Line', candles: 2, rate: 66,
          desc: 'Bullish candle gaps down below prior low but closes above the prior bear midpoint — bears trapped at the bottom, buyers take control.',
          x: xOf(i), yMark: yOf(Math.min(l[i], l[i - 1])) + 10 })
      }

      // ── Single-bar patterns ───────────────────────────────────────────────
      // Hammer (at lows) / Hanging Man (at highs)
      if (r0 > pxRange * 0.002 && b0 > 0 && ds0 >= 2 * b0 && us0 <= 0.5 * b0) {
        if (l[i] <= recentLow * 1.01) {
          rawReversals.push({ kind: 'bull', label: '↑Ham', name: 'Hammer', candles: 1, rate: 60,
            desc: 'Long lower wick with small body near the top — buyers pushed back strongly after sellers drove price down. A classic bullish reversal signal at support.',
            x: xOf(i), yMark: yOf(l[i]) + 10 })
        } else if (h[i] >= recentHigh * 0.99) {
          rawReversals.push({ kind: 'bear', label: '↓HM', name: 'Hanging Man', candles: 1, rate: 56,
            desc: 'Hammer shape at the top of an uptrend — intraday selling pressure appeared and was recovered. A warning that momentum may be weakening. Needs bearish confirmation.',
            x: xOf(i), yMark: yOf(h[i]) - 10 })
        }
      }
      // Inverted Hammer (at lows) / Shooting Star (at highs)
      if (r0 > pxRange * 0.002 && b0 > 0 && us0 >= 2 * b0 && ds0 <= 0.5 * b0) {
        if (l[i] <= recentLow * 1.01) {
          rawReversals.push({ kind: 'bull', label: '↑IH', name: 'Inverted Hammer', candles: 1, rate: 55,
            desc: 'Long upper wick with small body near the bottom — buyers showed intraday strength at lows. Needs bullish confirmation next bar.',
            x: xOf(i), yMark: yOf(l[i]) + 10 })
        } else if (h[i] >= recentHigh * 0.99) {
          rawReversals.push({ kind: 'bear', label: '↓SS', name: 'Shooting Star', candles: 1, rate: 59,
            desc: 'Long upper wick with small body near the bottom after an uptrend — buyers pushed high but sellers dominated the close. Strong bearish reversal signal near resistance.',
            x: xOf(i), yMark: yOf(h[i]) - 10 })
        }
      }
      // Doji variants
      if (r0 > pxRange * 0.002 && b0 <= r0 * 0.06) {
        if (ds0 >= r0 * 0.6 && us0 <= r0 * 0.1 && l[i] <= recentLow * 1.01) {
          // Dragonfly Doji — buyers recovered everything, bullish at lows
          rawReversals.push({ kind: 'bull', label: '↑DD', name: 'Dragonfly Doji', candles: 1, rate: 61,
            desc: 'Open, high, and close all near the top of the range — sellers drove price down hard but buyers recovered everything. Strong bullish reversal signal at support.',
            x: xOf(i), yMark: yOf(l[i]) + 10 })
        } else if (us0 >= r0 * 0.6 && ds0 <= r0 * 0.1 && h[i] >= recentHigh * 0.99) {
          // Gravestone Doji — sellers recovered everything, bearish at highs
          rawReversals.push({ kind: 'bear', label: '↓GD', name: 'Gravestone Doji', candles: 1, rate: 61,
            desc: 'Open, low, and close all near the bottom of the range — buyers pushed price high but sellers took back everything. Strong bearish reversal signal at resistance.',
            x: xOf(i), yMark: yOf(h[i]) - 10 })
        } else if (us0 >= r0 * 0.2 && ds0 >= r0 * 0.2) {
          // Standard Doji — indecision, only mark after a clear move
          const lb3 = Math.max(0, i - 3)
          const prior3bull = c[i - 1] > c[Math.max(0, i - 2)] && c[i - 1] > c[lb3]
          const prior3bear = c[i - 1] < c[Math.max(0, i - 2)] && c[i - 1] < c[lb3]
          if (prior3bull && h[i] >= recentHigh * 0.99) {
            rawReversals.push({ kind: 'bear', label: '↓Doji', name: 'Doji', candles: 1, rate: 54,
              desc: 'Open and close almost equal after an uptrend — buyers and sellers are balanced. Indecision at a high is a warning sign. Watch the next candle for direction.',
              x: xOf(i), yMark: yOf(h[i]) - 10 })
          } else if (prior3bear && l[i] <= recentLow * 1.01) {
            rawReversals.push({ kind: 'bull', label: '↑Doji', name: 'Doji', candles: 1, rate: 54,
              desc: 'Open and close almost equal after a downtrend — buyers stepped in to match sellers. Indecision at a low suggests the decline may be exhausting.',
              x: xOf(i), yMark: yOf(l[i]) + 10 })
          }
        }
      }

      // ── Three-bar patterns ────────────────────────────────────────────────
      if (i >= 2) {
        const b2 = bodyOf(i - 2), range2 = h[i - 2] - l[i - 2]
        const lb2 = Math.max(0, i - 8)
        const farLow  = l.slice(lb2, i - 2).length ? Math.min(...l.slice(lb2, i - 2)) : l[i - 2]
        const farHigh = h.slice(lb2, i - 2).length ? Math.max(...h.slice(lb2, i - 2)) : h[i - 2]

        // Morning Star
        const bigBody = b2 > range2 * 0.45
        const doji    = bodyOf(i - 1) <= b2 * 0.45
        if (!isBull(i - 2) && bigBody && doji && isBull(i) && c[i] > midOf(i - 2) && l[i - 2] <= farLow * 1.015) {
          rawReversals.push({ kind: 'bull', label: '↑Morn', name: 'Morning Star', candles: 3, rate: 78,
            desc: 'Strong bearish candle → indecision → bullish close above midpoint. A three-candle bottom: fear peaks, uncertainty appears, then buyers confirm the reversal.',
            x: xOf(i - 1), yMark: Math.max(yOf(l[i - 2]), yOf(l[i - 1]), yOf(l[i])) + 10 })
        }
        // Evening Star
        if (isBull(i - 2) && bigBody && doji && !isBull(i) && c[i] < midOf(i - 2) && h[i - 2] >= farHigh * 0.985) {
          rawReversals.push({ kind: 'bear', label: '↓Eve', name: 'Evening Star', candles: 3, rate: 78,
            desc: 'Strong bullish candle → indecision → bearish close below midpoint. A three-candle top: euphoria peaks, uncertainty appears, then sellers confirm the reversal.',
            x: xOf(i - 1), yMark: Math.min(yOf(h[i - 2]), yOf(h[i - 1]), yOf(h[i])) - 10 })
        }
        // Three White Soldiers
        if (isBull(i) && isBull(i - 1) && isBull(i - 2) &&
            c[i] > c[i - 1] && c[i - 1] > c[i - 2] &&
            o[i] >= l[i - 1] && o[i] <= h[i - 1] &&
            b0 > pxRange * 0.004 && b1 > pxRange * 0.004 && b2 > pxRange * 0.004) {
          rawReversals.push({ kind: 'bull', label: '↑3W', name: 'Three White Soldiers', candles: 3, rate: 83,
            desc: 'Three consecutive large bullish candles, each closing higher — a powerful show of sustained buying pressure. One of the strongest bullish momentum signals.',
            x: xOf(i - 1), yMark: Math.max(yOf(l[i - 2]), yOf(l[i - 1]), yOf(l[i])) + 10 })
        }
        // Three Black Crows
        if (!isBull(i) && !isBull(i - 1) && !isBull(i - 2) &&
            c[i] < c[i - 1] && c[i - 1] < c[i - 2] &&
            o[i] <= h[i - 1] && o[i] >= l[i - 1] &&
            b0 > pxRange * 0.004 && b1 > pxRange * 0.004 && b2 > pxRange * 0.004) {
          rawReversals.push({ kind: 'bear', label: '↓3C', name: 'Three Black Crows', candles: 3, rate: 83,
            desc: 'Three consecutive large bearish candles, each closing lower — a powerful show of sustained selling pressure. One of the strongest bearish momentum signals.',
            x: xOf(i - 1), yMark: Math.min(yOf(h[i - 2]), yOf(h[i - 1]), yOf(h[i])) - 10 })
        }
      }
    }

    // Dedup: if multiple patterns land on the same x, keep the highest-rated one
    const xBestMap = new Map()
    for (const r of rawReversals) {
      const key = `${r.kind}:${r.x.toFixed(1)}`
      if (!xBestMap.has(key) || r.rate > xBestMap.get(key).rate) xBestMap.set(key, r)
    }
    const reversals = Array.from(xBestMap.values())
    // Annotate each reversal with its bar index and volume ratio (for visual intensity)
    reversals.forEach(r => {
      r.barI = Math.max(0, Math.min(nb - 1, Math.round((r.x - PL) * totalSlots / pw - 0.5)))
      r.volRatio = volAvgArr[r.barI] > 0 ? +(v[r.barI] / volAvgArr[r.barI]).toFixed(1) : 1
    })
    const signalBarSet = new Set(reversals.map(r => r.barI))

    // ── Gap bands (unfilled) — use REAL OHLCV, not HA (HA smooths away true gaps) ──
    const gapBands = []
    for (let i = 1; i < nb; i++) {
      const rL  = lows[s + i],      rH  = highs[s + i]
      const prL = lows[s + i - 1],  prH = highs[s + i - 1]
      if (rL > prH) {   // gap up: today's low above yesterday's high
        const realLows = lows.slice(s + i + 1, s + nb)
        const filled   = realLows.some(lv => lv <= prH)
        if (!filled) {
          const y1 = yOf(rL), y2 = yOf(prH)
          if (y1 > PT && y2 < PH)
            gapBands.push({ type: 'up', gapTop: rL, gapBot: prH, y1, y2, size: rL - prH })
        }
      }
      if (rH < prL) {   // gap down: today's high below yesterday's low
        const realHighs = highs.slice(s + i + 1, s + nb)
        const filled    = realHighs.some(hv => hv >= prL)
        if (!filled) {
          const y1 = yOf(prL), y2 = yOf(rH)
          if (y1 > PT && y2 < PH)
            gapBands.push({ type: 'down', gapTop: prL, gapBot: rH, y1, y2, size: prL - rH })
        }
      }
    }

    // ── EMA 5 two-bar cross signals — entry & exit markers ───────────────────
    const ema5Crosses = []
    for (let i = 2; i < nb; i++) {
      const aboveCurr = c[i]     > e5[i]
      const abovePrev = c[i - 1] > e5[i - 1]
      const above2    = c[i - 2] > e5[i - 2]
      // Require confirming bar to have at least average volume
      const crossVolOk = volAvgArr[i] <= 0 || v[i] >= volAvgArr[i]

      if (aboveCurr && abovePrev && !above2 && crossVolOk) {
        // 2-bar confirmed bull: both bars above EMA 5, previous was below → ENTRY
        const yBase = yOf(Math.min(l[i - 1], l[i]))
        ema5Crosses.push({
          kind: 'bull', i,
          xa: xOf(i - 1), xb: xOf(i),
          ya: yOf(l[i - 1]), yb: yOf(l[i]),
          label: 'ENTRY ↑',
          labelY: Math.min(yBase + 22, PH - 2),
        })
      } else if (!aboveCurr && !abovePrev && above2 && crossVolOk) {
        // 2-bar confirmed bear: both bars below EMA 5, previous was above → EXIT
        const yBase = yOf(Math.max(h[i - 1], h[i]))
        ema5Crosses.push({
          kind: 'bear', i,
          xa: xOf(i - 1), xb: xOf(i),
          ya: yOf(h[i - 1]), yb: yOf(h[i]),
          label: 'EXIT ↓',
          labelY: Math.max(yBase - 12, PT + 2),
        })
      }
    }

    // ── Pullback / Retracement markers ──────────────────────────────────────
    const pullbackMarkers = detectPullbacksRetracements(c, h, l, e5, e15, e65)

    // ── Golden Cross / Death Cross (EMA 65 × EMA 200) ────────────────────────
    const goldDeathCrosses = []
    for (let i = 1; i < nb; i++) {
      if (!e65[i] || !e200[i] || !e65[i - 1] || !e200[i - 1]) continue
      const aboveNow  = e65[i]     > e200[i]
      const abovePrev = e65[i - 1] > e200[i - 1]
      if (!abovePrev && aboveNow) {
        const cy = yOf((e65[i] + e200[i]) / 2)
        goldDeathCrosses.push({ kind: 'golden', i, x: xOf(i), crossY: Math.max(PT + 4, Math.min(PH - 4, cy)) })
      } else if (abovePrev && !aboveNow) {
        const cy = yOf((e65[i] + e200[i]) / 2)
        goldDeathCrosses.push({ kind: 'death', i, x: xOf(i), crossY: Math.max(PT + 4, Math.min(PH - 4, cy)) })
      }
    }

    // ── Trend strength from current EMA alignment ────────────────────────────
    const te5 = e5[nb - 1], te15 = e15[nb - 1], te30 = e30[nb - 1], te65 = e65[nb - 1], te200 = e200[nb - 1]
    let alignScore = 0
    if (te5  && te15  && te5  > te15)  alignScore++
    if (te15 && te30  && te15 > te30)  alignScore++
    if (te30 && te65  && te30 > te65)  alignScore++
    if (te65 && te200 && te65 > te200) alignScore++
    const trendState = {
      isGolden: !!(te65 && te200 && te65 > te200),
      alignScore,
      label: alignScore === 4 ? 'STRONG BULL' : alignScore === 3 ? 'BULL TREND'
           : alignScore === 0 ? 'STRONG BEAR' : alignScore === 1 ? 'BEAR TREND' : 'NEUTRAL',
      col: alignScore >= 3 ? '#10b981' : alignScore === 0 ? '#ef4444' : alignScore <= 1 ? '#ef4444' : '#60a5fa',
    }

    // ── Volume spike markers (≥2× the 20-bar average) ────────────────────────
    const VOL_SPIKE_MULT = 2.0
    const volSpikes = []
    for (let i = 1; i < nb; i++) {
      const start = Math.max(0, i - 20)
      const slice = v.slice(start, i)
      const avg   = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0
      if (avg > 0 && v[i] >= avg * VOL_SPIKE_MULT) {
        const barH = (v[i] / volMax) * VH
        volSpikes.push({ i, x: xOf(i), vol: v[i], mult: +(v[i] / avg).toFixed(1),
          vy: PH + GAP + VH - barH })
      }
    }

    // ── VWAP cross signals (intraday only — 2-bar cross: last 2 closes on same side, prev on other) ───
    const vwapCrosses = []
    if (isIntraday) {
      for (let i = 2; i < nb; i++) {
        const vwMinus2 = vwapArr[i - 2], vw0 = vwapArr[i - 1], vw1 = vwapArr[i]
        if (!vwMinus2 || !vw0 || !vw1) continue
        // Volume gate: require at least average volume on the confirming bar
        if (volAvgArr[i] > 0 && v[i] < volAvgArr[i] * 0.85) continue
        const prevPrevAbove = c[i - 2] > vwMinus2
        const prevAbove     = c[i - 1] > vw0
        const currAbove     = c[i]     > vw1
        // 2-bar bull cross: bar[i-2] below, bar[i-1] and bar[i] both above
        if (!prevPrevAbove && prevAbove && currAbove) {
          vwapCrosses.push({ kind: 'bull', i, x: xOf(i), y: cyOf(yOf(vw1)), label: '▲ VWAP' })
        // 2-bar bear cross: bar[i-2] above, bar[i-1] and bar[i] both below
        } else if (prevPrevAbove && !prevAbove && !currAbove) {
          vwapCrosses.push({ kind: 'bear', i, x: xOf(i), y: cyOf(yOf(vw1)), label: '▼ VWAP' })
        }
      }
    }

    // ── Prior Day High/Low (intraday timeframes only) ─────────────────────────
    let prevDayH = null, prevDayL = null
    const isIntraTF = ['15M', '5M', '1H', '4H'].includes(timeframe)
    if (isIntraTF && ts.length > 1) {
      const dayGroups = {}
      ts.forEach((t, i) => {
        if (!t) return
        const dk = new Date(t * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        if (!dayGroups[dk]) dayGroups[dk] = []
        dayGroups[dk].push(i)
      })
      const days = Object.keys(dayGroups)
      if (days.length >= 2) {
        const prevIdxs = dayGroups[days[days.length - 2]]
        const pdh = Math.max(...prevIdxs.map(i => highs[s + i]))   // real high, not HA
        const pdl = Math.min(...prevIdxs.map(i => lows[s + i]))    // real low, not HA
        if (pdh > priceMin && pdh < priceMax) prevDayH = pdh
        if (pdl > priceMin && pdl < priceMax) prevDayL = pdl
      }
    }

    // ── Smart Money Concepts (BOS, CHoCH, Sweeps, FVGs) ─────────────────────
    const rH = highs.slice(s, endIdx)
    const rL = lows.slice(s, endIdx)
    const rC = closes.slice(s, endIdx)
    const smcData = calcSMC(rH, rL, rC, timeframe)

    // ── ATR 14 (Wilder's smoothing) — real OHLCV, not Heikin-Ashi ─────────────
    const ATR_P = 14
    let atr14 = null
    if (nb >= ATR_P + 2) {
      let atrVal = 0
      for (let i = 1; i <= ATR_P; i++) {
        atrVal += Math.max(rH[i] - rL[i], Math.abs(rH[i] - rC[i - 1]), Math.abs(rL[i] - rC[i - 1]))
      }
      atrVal /= ATR_P
      for (let i = ATR_P + 1; i < nb; i++) {
        const tr = Math.max(rH[i] - rL[i], Math.abs(rH[i] - rC[i - 1]), Math.abs(rL[i] - rC[i - 1]))
        atrVal = (atrVal * (ATR_P - 1) + tr) / ATR_P
      }
      atr14 = atrVal
    }

    // ── Major S/R Zones (4H and 1H only — pivot clusters tested 2+ times) ──────
    const srZones = []
    if ((timeframe === '4H' || timeframe === '1H') && rH.length >= 15) {
      const win = 5
      const tol = 0.003
      const pivH = [], pivL = []
      for (let i = win; i < rH.length - win; i++) {
        if (rH.slice(i - win, i).every(v => v <= rH[i]) && rH.slice(i + 1, i + win + 1).every(v => v <= rH[i]))
          pivH.push(rH[i])
        if (rL.slice(i - win, i).every(v => v >= rL[i]) && rL.slice(i + 1, i + win + 1).every(v => v >= rL[i]))
          pivL.push(rL[i])
      }
      const clusterPivots = (pivots, kind) => {
        const sorted = [...pivots].sort((a, b) => a - b)
        let grp = []
        const flush = () => {
          if (grp.length >= 2) {
            const avg = grp.reduce((s, x) => s + x, 0) / grp.length
            const spread = Math.max(grp[grp.length - 1] - grp[0], avg * tol * 1.5)
            srZones.push({ kind, price: avg, top: avg + spread / 2, bot: avg - spread / 2, touches: grp.length })
          }
          grp = []
        }
        for (let i = 0; i < sorted.length; i++) {
          if (grp.length === 0 || Math.abs(sorted[i] - grp[0]) / grp[0] < tol * 4) grp.push(sorted[i])
          else { flush(); grp = [sorted[i]] }
        }
        flush()
      }
      clusterPivots(pivH, 'resistance')
      clusterPivots(pivL, 'support')
      srZones.sort((a, b) => b.touches - a.touches)
      srZones.splice(6)
    }

    // ── Volume profile (price-at-volume histogram) ───────────────────────────
    // Distribute each bar's volume across its full high-low range
    const priceRange = priceMax - priceMin
    const profBins = new Array(PROFILE_BINS).fill(0)
    for (let i = 0; i < nb; i++) {
      const vol = v[i] || 0
      if (!vol || priceRange <= 0) continue
      const loIdx = Math.max(0, Math.min(PROFILE_BINS - 1, Math.floor((l[i] - priceMin) / priceRange * PROFILE_BINS)))
      const hiIdx = Math.max(0, Math.min(PROFILE_BINS - 1, Math.floor((h[i] - priceMin) / priceRange * PROFILE_BINS)))
      const spread = Math.max(1, hiIdx - loIdx + 1)
      const volPerBin = vol / spread
      for (let b = loIdx; b <= hiIdx; b++) profBins[b] += volPerBin
    }
    const profMax = Math.max(...profBins, 1)
    const profAvg = profBins.reduce((a, b) => a + b, 0) / PROFILE_BINS
    const pocIdx  = profBins.indexOf(Math.max(...profBins))
    // Value Area (70% of volume)
    let vaLo = pocIdx, vaHi = pocIdx
    let vaVol = profBins[pocIdx]
    const profTotal = profBins.reduce((a, b) => a + b, 0)
    const va70 = profTotal * 0.70
    while (vaVol < va70 && (vaLo > 0 || vaHi < PROFILE_BINS - 1)) {
      const addLo = vaLo > 0               ? profBins[vaLo - 1] : 0
      const addHi = vaHi < PROFILE_BINS - 1 ? profBins[vaHi + 1] : 0
      if (addHi >= addLo) { vaHi++; vaVol += profBins[vaHi] }
      else                { vaLo--; vaVol += profBins[vaLo] }
    }
    const vahPrice = priceMin + (vaHi + 1) * priceRange / PROFILE_BINS
    const valPrice = priceMin + vaLo * priceRange / PROFILE_BINS
    const lvnThresh = profAvg * 0.25

    // ── RSI 14 (seeded from full history so values are stable regardless of zoom) ────
    const rsiArr = calcRSI(closes).slice(s, endIdx)

    // ── EMA ribbon segments (shaded fill between E8 and E30) ──────────────────
    const ribbonSegs = []
    {
      let segFrom = null, segKind = null
      for (let i = 0; i < nb; i++) {
        if (e5[i] == null || e15[i] == null || e30[i] == null) {
          if (segFrom !== null) { ribbonSegs.push({ from: segFrom, to: i - 1, kind: segKind }); segFrom = null }
          continue
        }
        const k = (e5[i] > e15[i] && e15[i] > e30[i]) ? 'bull'
                : (e5[i] < e15[i] && e15[i] < e30[i]) ? 'bear' : 'neutral'
        if (segFrom === null) { segFrom = i; segKind = k }
        else if (k !== segKind) {
          ribbonSegs.push({ from: segFrom, to: i - 1, kind: segKind })
          segFrom = i; segKind = k
        }
      }
      if (segFrom !== null) ribbonSegs.push({ from: segFrom, to: nb - 1, kind: segKind })
    }

    // ── Pre-market High / Low (only when pre-market bars are visible) ─────────
    let pmHigh = null, pmLow = null
    if (preMarketSet.size > 0) {
      for (const i of preMarketSet) {
        if (i >= 0 && i < nb) {
          if (pmHigh == null || h[i] > pmHigh) pmHigh = h[i]
          if (pmLow  == null || l[i] < pmLow)  pmLow  = l[i]
        }
      }
    }

    // ── Order Blocks (SMC completion) ─────────────────────────────────────────
    // Bullish OB: last bearish candle before a strong bullish impulse (≥1.5× avg range)
    // Bearish OB: last bullish candle before a strong bearish impulse
    const orderBlocks = []
    if (nb >= 5) {
      const avgRange = Array.from({length: nb}, (_, i) => h[i] - l[i])
        .reduce((a, b) => a + b, 0) / nb
      for (let i = 1; i < nb - 2; i++) {
        const impulseH = Math.max(h[i+1], h[i+2])
        const impulseL = Math.min(l[i+1], l[i+2])
        const impulseRange = impulseH - impulseL
        if (impulseRange < avgRange * 1.5) continue
        const isBullImpulse = c[i+2] > c[i]   // strong up move after bar i
        const isBearImpulse = c[i+2] < c[i]   // strong down move after bar i
        const isBarBear = c[i] < o[i]          // bar i is bearish
        const isBarBull = c[i] >= o[i]         // bar i is bullish
        if (isBullImpulse && isBarBear) {
          // Bullish OB: bearish bar before big up move
          const topP  = Math.max(o[i], c[i])
          const botP  = Math.min(o[i], c[i])
          if (topP > priceMin && botP < priceMax) {
            orderBlocks.push({ kind: 'bull', i, top: topP, bot: botP, x: xOf(i) })
          }
        } else if (isBearImpulse && isBarBull) {
          // Bearish OB: bullish bar before big down move
          const topP  = Math.max(o[i], c[i])
          const botP  = Math.min(o[i], c[i])
          if (topP > priceMin && botP < priceMax) {
            orderBlocks.push({ kind: 'bear', i, top: topP, bot: botP, x: xOf(i) })
          }
        }
      }
    }

    // ── RSI Divergences ────────────────────────────────────────────────────────
    // Bull div: price makes lower low, RSI makes higher low (upside reversal signal)
    // Bear div: price makes higher high, RSI makes lower high (downside reversal signal)
    const rsiDivs = []
    const lookback = 8
    if (nb > lookback * 2) {
      // Find local swing highs/lows in price and RSI
      for (let i = lookback; i < nb - 1; i++) {
        const rsiV = rsiArr[i]
        if (rsiV == null) continue
        // Bear divergence: price higher high, RSI lower high
        const isHigh = h[i] >= Math.max(...h.slice(Math.max(0,i-4), i), ...h.slice(i+1, Math.min(nb,i+4)))
        if (isHigh) {
          for (let j = Math.max(lookback, i - 30); j < i - lookback; j++) {
            const rsiJ = rsiArr[j]
            if (rsiJ == null) continue
            const isHighJ = h[j] >= Math.max(...h.slice(Math.max(0,j-4), j), ...h.slice(j+1, Math.min(nb,j+4)))
            if (!isHighJ) continue
            if (h[i] > h[j] && rsiV < rsiJ - 3) {
              rsiDivs.push({ kind: 'bear', iA: j, iB: i, pA: h[j], pB: h[i], rsiA: rsiJ, rsiB: rsiV })
              break
            }
          }
        }
        // Bull divergence: price lower low, RSI higher low
        const isLow = l[i] <= Math.min(...l.slice(Math.max(0,i-4), i), ...l.slice(i+1, Math.min(nb,i+4)))
        if (isLow) {
          for (let j = Math.max(lookback, i - 30); j < i - lookback; j++) {
            const rsiJ = rsiArr[j]
            if (rsiJ == null) continue
            const isLowJ = l[j] <= Math.min(...l.slice(Math.max(0,j-4), j), ...l.slice(j+1, Math.min(nb,j+4)))
            if (!isLowJ) continue
            if (l[i] < l[j] && rsiV > rsiJ + 3) {
              rsiDivs.push({ kind: 'bull', iA: j, iB: i, pA: l[j], pB: l[i], rsiA: rsiJ, rsiB: rsiV })
              break
            }
          }
        }
      }
    }

    // ── RS Line (vs SPY, daily only) ──────────────────────────────────────────
    // Normalized to 100 at the start of the visible window. Secondary axis on RSI scale.
    const rsLinePoints = []
    if (spyCloses?.length && (timeframe === 'D' || timeframe === 'W')) {
      const spySlice = spyCloses.slice(s, endIdx)
      const firstTicker = c[0], firstSpy = spySlice[0]
      if (firstTicker && firstSpy) {
        // Map to the right side (mini overlay on volume area), normalized
        for (let i = 0; i < nb; i++) {
          const spy = spySlice[i]
          if (!spy || !c[i]) continue
          const rel = (c[i] / firstTicker) / (spy / firstSpy)
          // Normalize to fit in volume area: rel ~1.0 is mid, ±20% spans the area
          const relClamped = Math.max(0.75, Math.min(1.25, rel))
          const ry = PH + GAP + VH - ((relClamped - 0.75) / 0.50) * VH
          rsLinePoints.push(`${xOf(i).toFixed(1)},${ry.toFixed(1)}`)
        }
      }
    }

    // ── Key Level Confluence Zones ────────────────────────────────────────────
    // When 3+ levels cluster within 0.3% of each other, flag the zone
    const confluenceZones = []
    {
      const allLevels = []
      const tol = 0.003
      // Collect all active levels with names
      if (orbHigh != null) allLevels.push({ p: orbHigh, name: 'ORH' })
      if (orbLow  != null) allLevels.push({ p: orbLow,  name: 'ORL' })
      if (prevDayH != null) allLevels.push({ p: prevDayH, name: 'PDH' })
      if (prevDayL != null) allLevels.push({ p: prevDayL, name: 'PDL' })
      if (gammaFlip != null) allLevels.push({ p: gammaFlip, name: 'γFlip' })
      if (callWall  != null) allLevels.push({ p: callWall,  name: 'CWall' })
      if (putWall   != null) allLevels.push({ p: putWall,   name: 'PWall' })
      if (maxPain   != null) allLevels.push({ p: maxPain,   name: 'MaxP' })
      // Add EMA levels
      const lastE65  = e65[nb-1],  lastE200 = e200[nb-1]
      const lastVwap = vwapArr[nb-1]
      if (lastE65  != null) allLevels.push({ p: lastE65,  name: 'E65'  })
      if (lastE200 != null) allLevels.push({ p: lastE200, name: 'E200' })
      if (lastVwap != null) allLevels.push({ p: lastVwap, name: 'VWAP' })
      // Fibonacci levels
      if (fibLevels) {
        Object.entries(fibLevels).forEach(([k, v]) => {
          if (typeof v === 'number') allLevels.push({ p: v, name: k })
        })
      }
      // S/R zones
      srZones.forEach(z => allLevels.push({ p: z.price, name: z.kind === 'resistance' ? 'Res' : 'Sup' }))

      // Cluster: find groups within tol
      const used = new Set()
      for (let i = 0; i < allLevels.length; i++) {
        if (used.has(i)) continue
        const group = [allLevels[i]]
        used.add(i)
        for (let j = i + 1; j < allLevels.length; j++) {
          if (used.has(j)) continue
          if (Math.abs(allLevels[j].p - allLevels[i].p) / allLevels[i].p < tol * 4) {
            group.push(allLevels[j])
            used.add(j)
          }
        }
        if (group.length >= 3) {
          const avgP = group.reduce((s, x) => s + x.p, 0) / group.length
          if (avgP > priceMin && avgP < priceMax) {
            confluenceZones.push({
              price: avgP,
              names: group.map(g => g.name).join(' · '),
              count: group.length,
              y: yOf(avgP),
            })
          }
        }
      }
    }

    // ── Anchored VWAPs ────────────────────────────────────────────────────────
    const anchoredVwapLines = anchoredVwaps.map(({ anchorIdx }) => {
      const pts = []
      let cumTPV = 0, cumVol = 0
      for (let i = anchorIdx; i < nb; i++) {
        const ri = s + i
        const tp = (highs[ri] + lows[ri] + closes[ri]) / 3
        cumTPV += tp * (v[i] || 0)
        cumVol += v[i] || 0
        if (cumVol > 0) {
          const avwap = cumTPV / cumVol
          if (avwap > priceMin && avwap < priceMax) {
            pts.push(`${xOf(i).toFixed(1)},${yOf(avwap).toFixed(1)}`)
          }
        }
      }
      return pts.length > 1 ? pts.join(' ') : null
    })

    return { c, h, l, o, v, ts, nb, s, e5, e15, e30, e65, e200, vwapArr, vwapSegments,
      priceMin, priceMax, volMax, pw, ph, xOf, yOf, bw, toPoints,
      yTicks, xLabels, weekSeps, reversals, gapBands, smcData, isToday, totalSlots,
      profBins, profMax, pocIdx, priceRange, volAvgPoints, ema5Crosses,
      volSpikes, prevDayH, prevDayL, vwapCrosses,
      goldDeathCrosses, trendState,
      vahPrice, valPrice, vaLo, vaHi, lvnThresh, profAvg,
      preMarketSet, sessionOpens, rsiArr, srZones, atr14, pmHigh, pmLow,
      orderBlocks, rsiDivs, rsLinePoints, confluenceZones, anchoredVwapLines }
  }, [closes, highs, lows, opens, volumes, timestamps, barCount, panOffset, timeframe, useHA, spyCloses, anchoredVwaps])

  // RSI auto-open: when divergences are detected and user hasn't manually closed RSI
  useEffect(() => {
    if (!d?.rsiDivs?.length) return
    if (!userClosedRSI.current) {
      setShowRSI(true)
    }
  }, [d?.rsiDivs?.length])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse handlers ────────────────────────────────────────────────────────
  function svgCoords(e) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: (e.clientX - rect.left) * (VW / rect.width),
      y: (e.clientY - rect.top)  * (TOTAL / rect.height),
    }
  }

  function yToPrice(y) {
    if (!d) return null
    return d.priceMin + (PH - y) / (PH - PT) * (d.priceMax - d.priceMin)
  }

  function handleChartClick(e) {
    if (!d || drawTool === 'none' || drawTool === 'trend') return
    const pos = svgCoords(e)
    if (!pos) return

    if (drawTool === 'hline') {
      const price = yToPrice(pos.y)
      if (price == null || price < d.priceMin || price > d.priceMax) return
      setDrawings(prev => ({
        ...prev,
        [curKey]: [...(prev[curKey] ?? []), { type: 'hline', price, color: '#60a5fa' }]
      }))
    }

    if (drawTool === 'erase') {
      const tol = 8
      setDrawings(prev => {
        const lines = prev[curKey] ?? []
        const yClick = pos.y
        const xClick = pos.x
        const idx = lines.findIndex(ln => {
          if (ln.type === 'hline') {
            const ly = d.yOf(ln.price)
            return Math.abs(ly - yClick) < tol
          }
          if (ln.type === 'trend') {
            const dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1
            const len2 = dx * dx + dy * dy
            if (len2 === 0) return false
            const t = Math.max(0, Math.min(1, ((xClick - ln.x1) * dx + (yClick - ln.y1) * dy) / len2))
            const px = ln.x1 + t * dx, py = ln.y1 + t * dy
            return Math.hypot(xClick - px, yClick - py) < tol
          }
          return false
        })
        if (idx === -1) return prev
        return { ...prev, [curKey]: lines.filter((_, i) => i !== idx) }
      })
    }
  }

  function handleMouseMove(e) {
    if (!d || !svgRef.current) return

    if (drawTool === 'trend' && draftLine) {
      const pos = svgCoords(e)
      if (pos) setDraftLine(prev => prev ? { ...prev, x2: pos.x, y2: pos.y } : null)
      return
    }

    const rect = svgRef.current.getBoundingClientRect()

    if (isDragging) {
      const pwScreen = rect.width * ((VW - PL - PR) / VW)
      const barPx    = pwScreen / d.nb
      dragFracRef.current += -e.movementX / barPx
      const delta = Math.trunc(dragFracRef.current)
      if (delta !== 0) {
        dragFracRef.current -= delta
        panAccRef.current += delta
        if (!panRafRef.current) {
          panRafRef.current = requestAnimationFrame(() => {
            panRafRef.current = null
            const acc = panAccRef.current
            panAccRef.current = 0
            if (acc !== 0) {
              const maxPan = Math.max(0, totalBarsRef.current - barCountRef.current)
              setPanOffset(p => Math.max(0, Math.min(p + acc, maxPan)))
            }
          })
        }
      }
      return
    }

    const sx = (e.clientX - rect.left) * (VW / rect.width)
    const sy = (e.clientY - rect.top)  * (TOTAL / rect.height)

    if (sx >= PL && sx <= VW - PR && sy >= PT && sy <= PH) {
      const raw = (sx - PL) / d.pw * d.totalSlots - 0.5
      const bi  = Math.max(0, Math.min(Math.round(raw), d.nb - 1))
      setCrosshair({ bi, sx: d.xOf(bi), sy })
    } else {
      setCrosshair(null)
    }
  }

  function handleMouseDown(e) {
    if (e.button !== 0) return

    // Shift+click: anchor a VWAP from this bar
    if (e.shiftKey && drawTool === 'none') {
      const pos = svgCoords(e)
      if (pos && d) {
        const raw = (pos.x - PL) / d.pw * d.totalSlots - 0.5
        const bi  = Math.max(0, Math.min(Math.round(raw), d.nb - 1))
        const AVWAP_COLORS = ['#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fb923c']
        setAnchoredVwaps(prev => {
          if (prev.length >= 5) return prev  // max 5 anchors
          return [...prev, { anchorIdx: bi, color: AVWAP_COLORS[prev.length % AVWAP_COLORS.length] }]
        })
      }
      e.preventDefault()
      return
    }

    if (drawTool === 'trend') {
      const pos = svgCoords(e)
      if (!pos) return
      setDraftLine({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y })
      e.preventDefault()
      return
    }
    if (drawTool === 'hline' || drawTool === 'erase') {
      // onClick handles these; don't initiate a pan drag
      e.preventDefault()
      return
    }
    dragFracRef.current = 0
    setIsDragging(true)
    e.preventDefault()
  }

  function handleMouseUp(e) {
    if (drawTool === 'trend' && draftLine) {
      const pos = svgCoords(e)
      if (pos) {
        const dist = Math.hypot(pos.x - draftLine.x1, pos.y - draftLine.y1)
        if (dist > 10) {
          setDrawings(prev => ({
            ...prev,
            [curKey]: [...(prev[curKey] ?? []), {
              type: 'trend', x1: draftLine.x1, y1: draftLine.y1,
              x2: pos.x, y2: pos.y, color: '#60a5fa'
            }]
          }))
        }
      }
      setDraftLine(null)
      return
    }
    setIsDragging(false)
    dragFracRef.current = 0
    panAccRef.current   = 0
    if (panRafRef.current) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null }
  }
  function handleMouseLeave() {
    setCrosshair(null)
    setIsDragging(false)
    setDraftLine(null)
    dragFracRef.current = 0
    panAccRef.current   = 0
    if (panRafRef.current) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null }
  }

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  const zoomIn    = () => setBarCount(p => Math.max(15, Math.round(p * 0.65)))
  const zoomOut   = () => setBarCount(p => Math.min(totalBars, Math.round(p * 1.5)))
  const zoomReset = () => { setBarCount(TF_DEFAULT_BARS[timeframe] ?? 80); setPanOffset(0) }
  const goLive    = () => setPanOffset(0)

  if (!closes?.length) return (
    <div className="pc-wrap pc-empty">Load a ticker to see the price chart.</div>
  )
  if (!d) return <div className="pc-wrap pc-empty">Not enough price bars to render chart.</div>

  const { c, h, l, o, v, ts, nb, e5, e15, e30, e65, e200, vwapArr, vwapSegments,
    xOf, yOf, bw, toPoints, yTicks, xLabels, weekSeps, reversals, gapBands, smcData, isToday,
    profBins, profMax, pocIdx, priceRange, volAvgPoints, ema5Crosses,
    volSpikes, prevDayH, prevDayL, vwapCrosses,
    goldDeathCrosses, trendState,
    preMarketSet, sessionOpens, rsiArr, srZones, atr14, pmHigh, pmLow,
    orderBlocks, rsiDivs, rsLinePoints, confluenceZones, anchoredVwapLines } = d

  // High-confidence filter: show only patterns with ≥75% win rate by default
  const displayReversals = showAllPatterns ? reversals : reversals.filter(r => r.rate >= 75)
  const signalBarSet = new Set(displayReversals.map(r => r.barI))

  // Use real closes (not Heikin-Ashi) for the price label and day-change % so the chart
  // topbar matches the app header and trading platforms. HA prices (c[]) are only for drawing.
  const isIntraTf  = ['4H', '1H', '15M', '5M'].includes(timeframe)
  const endIdx     = d.s + nb
  const lastClose  = closes[endIdx - 1]    // real close of the last visible bar (for chart line position)
  // Topbar price always shows the most recent close in the dataset (not affected by scroll/pan)
  const topClose   = closes[closes.length - 1]
  const topBase    = (isIntraTf && prevDayClose != null)
    ? prevDayClose
    : (closes.length >= 2 ? closes[closes.length - 2] : null)
  const dayChange  = topBase ? ((topClose - topBase) / topBase * 100) : 0
  const priceColor = dayChange >= 0 ? '#00c77a' : '#ff4d4d'
  const lastCloseY = yOf(lastClose)
  const lastBarX   = xOf(nb - 1)

  const hov = crosshair && crosshair.bi >= 0 && crosshair.bi < nb ? (() => {
    const i  = crosshair.bi
    const ri = d.s + i   // index into the full (non-sliced) real OHLCV arrays
    // Show real OHLCV (not Heikin-Ashi) so hover prices match broker data
    const rO = opens[ri],  rH = highs[ri],  rL = lows[ri],  rC = closes[ri]
    const bull = rC >= rO
    const chg  = ri > 0 ? (rC - closes[ri - 1]) / closes[ri - 1] * 100 : 0
    return {
      i, o: rO, h: rH, l: rL, c: rC, v: v[i], ts: ts[i], bull, chg,
      e5:   e5[i]      ?? null,
      e15:  e15[i]     ?? null,
      e30:  e30[i]     ?? null,
      e65:  e65[i]     ?? null,
      e200: e200[i]    ?? null,
      vwap: vwapArr[i] ?? null,
      rsi:  rsiArr[i]  ?? null,
    }
  })() : null

  const crosshairPx = crosshair
    ? d.priceMin + (1 - (crosshair.sy - PT) / d.ph) * (d.priceMax - d.priceMin)
    : null

  const fibLines = fibLevels
    ? Object.entries(fibLevels)
        .filter(([, p]) => p > d.priceMin && p < d.priceMax)
        .map(([label, p]) => ({ label, p, y: yOf(p) }))
    : []

  const { bos, choch, sweeps, fvgs } = smcData ?? { bos: [], choch: [], sweeps: [], fvgs: [] }
  const showSMC = ['4H', '1H', '15M', '5M'].includes(timeframe)
  const isLive   = panOffset === 0

  // OHLCV display — uses hovered bar when crosshair is active, otherwise the last visible bar
  const dispO    = hov ? hov.o : opens[endIdx - 1]
  const dispH    = hov ? hov.h : highs[endIdx - 1]
  const dispL    = hov ? hov.l : lows[endIdx - 1]
  const dispC    = hov ? hov.c : closes[endIdx - 1]
  const dispV    = hov ? hov.v : d.v[nb - 1]
  const dispBull = dispC >= dispO
  const dispChg  = hov ? hov.chg : dayChange
  const dispTs   = hov ? hov.ts : ts[nb - 1]
  const dispTimeLabel = dispTs
    ? (() => {
        const dt = new Date(dispTs * 1000)
        return isIntraTf
          ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
          : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'America/New_York' })
      })()
    : null

  // ── Label collision guard ─────────────────────────────────────────────────────
  // Registers all horizontal price-level labels in priority order.
  // Lower-priority labels whose Y falls within 9px of a claimed slot are suppressed
  // (the line still renders; only the text pill is hidden).
  const labelGuard = (() => {
    const GAP = 9
    const claimed = []
    const tryAdd = y => {
      if (y < PT || y > PH) return false
      if (claimed.some(cy => Math.abs(cy - y) < GAP)) return false
      claimed.push(y)
      return true
    }
    // P1 — ORB (intraday anchor — always wins)
    if (orbHigh != null) tryAdd(yOf(orbHigh))
    if (orbLow  != null) tryAdd(yOf(orbLow))
    // P2 — Swing targets
    swingTargets?.forEach(p => { if (p != null) tryAdd(yOf(p)) })
    // P3 — GEX options levels
    ;[gammaFlip, callWall, putWall, maxPain].forEach(p => { if (p != null) tryAdd(yOf(p)) })
    // P4 — Prior-day / pre-market levels
    ;[prevDayH, prevDayL, pmHigh, pmLow].forEach(p => { if (p != null) tryAdd(yOf(p)) })
    // P5 — S/R zones
    srZones.forEach(z => tryAdd(yOf(z.price)))
    // P6 — Fibonacci retracements
    fibLines.forEach(f => tryAdd(f.y))
    // P7 — Confluence zone markers
    confluenceZones.forEach(z => tryAdd(z.y))
    // P8 — Gap band labels (lowest priority — informational only)
    gapBands.forEach(g => tryAdd((g.y1 + g.y2) / 2))
    const claimedSet = new Set(claimed.map(y => (+y).toFixed(1)))
    return y => claimedSet.has((+y).toFixed(1))
  })()

  return (
    <div className="pc-wrap" style={{ position: 'relative' }}>

      {/* ── Command Bar ── single row replacing topbar + OHLCV */}
      <div className="pc-topbar" style={{ padding: '6px 12px', minHeight: 38, gap: 6, flexWrap: 'nowrap' }}>
        <span className="pc-title">
          {title || 'Chart'}{' '}
          <span className="pc-tf-badge">{timeframe}</span>
          {showPreMarket && preMarketSet?.has(nb - 1) && (
            <span style={{ fontSize: 9, fontWeight: 800, color: '#3b82f6', background: '#0a1e36',
              border: '1px solid #1e3a5f', borderRadius: 3, padding: '1px 4px', marginLeft: 4,
              letterSpacing: '0.4px', verticalAlign: 'middle' }}>PRE</span>
          )}
        </span>

        <span className="pc-price" style={{ color: priceColor }}>${fmtPx(topClose)}</span>
        <span className={`pc-chg${dayChange >= 0 ? ' pc-green' : ' pc-red'}`}
          title={showPreMarket && preMarketSet?.has(nb - 1)
            ? 'Pre-market change vs prior session close'
            : 'Change vs prior session close'}>
          {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)}%
        </span>

        {/* Trend verdict — replaces the entire pc-legend */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          padding: '2px 8px', borderRadius: 4,
          background: `${trendState.col}14`, border: `1px solid ${trendState.col}40`,
        }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: trendState.col, letterSpacing: '0.4px' }}>
            {trendState.label}
          </span>
          <span style={{ fontSize: 9, color: `${trendState.col}99`, fontWeight: 700 }}>
            {trendState.alignScore}/4
          </span>
          {verdict && (() => {
            const regCol = verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH' ? '#10b981'
              : verdict === 'HOSTILE' || verdict === 'BEARISH' ? '#ef4444'
              : verdict === 'HIGH VIX' ? '#f59e0b' : '#60a5fa'
            return (
              <>
                <span style={{ color: '#1a3050', fontSize: 8 }}>·</span>
                <span style={{ fontSize: 9, color: regCol, fontWeight: 700 }}>{verdict}</span>
              </>
            )
          })()}
          {vixData?.vix != null && (
            <>
              <span style={{ color: '#1a3050', fontSize: 8 }}>·</span>
              <span style={{ fontSize: 9, fontWeight: 700,
                color: vixData.vix > 25 ? '#ef4444' : vixData.vix < 18 ? '#10b981' : '#f59e0b' }}>
                VIX {vixData.vix.toFixed(1)}
              </span>
            </>
          )}
        </div>

        {/* Right cluster: compact OHLCV + ⚙ + PRO + zoom */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, fontFamily: 'monospace', fontSize: 10 }}>
            {dispTimeLabel && <span style={{ color: '#3a5a7a', fontSize: 9 }}>{dispTimeLabel}</span>}
            <span><span style={{ color: '#2a4a6a', fontSize: 8.5, fontWeight: 700 }}>O</span>{' '}<span style={{ color: '#8ab0cc' }}>${dispO != null ? fmtPx(dispO) : '—'}</span></span>
            <span><span style={{ color: '#2a4a6a', fontSize: 8.5, fontWeight: 700 }}>H</span>{' '}<span style={{ color: '#10b981' }}>${dispH != null ? fmtPx(dispH) : '—'}</span></span>
            <span><span style={{ color: '#2a4a6a', fontSize: 8.5, fontWeight: 700 }}>L</span>{' '}<span style={{ color: '#ef4444' }}>${dispL != null ? fmtPx(dispL) : '—'}</span></span>
            <span><span style={{ color: '#2a4a6a', fontSize: 8.5, fontWeight: 700 }}>C</span>{' '}<span style={{ color: dispBull ? '#10b981' : '#ef4444' }}>${dispC != null ? fmtPx(dispC) : '—'}</span></span>
            <span style={{ color: '#4a6888' }}>{fmtVol(dispV)}</span>
            <span style={{ color: dispChg >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>{dispChg >= 0 ? '+' : ''}{dispChg.toFixed(2)}%</span>
          </div>

          <button title={showTools ? 'Close tools panel' : 'Tools & overlays'}
            onClick={() => setShowTools(v => !v)}
            style={{
              background: showTools ? '#0e1e36' : 'transparent',
              border: `1px solid ${showTools ? '#3b82f6' : '#1e2d45'}`,
              color: showTools ? '#60a5fa' : '#3a5a7a',
              borderRadius: 4, padding: '2px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 700,
            }}>⚙</button>


          <div className="pc-zoom-ctrl" style={{ marginLeft: 0 }}>
            {!isLive && (
              <button className="pc-zbtn pc-zbtn-live" onClick={goLive}
                title="Jump to most recent bars">LIVE →</button>
            )}
            <button className="pc-zbtn" onClick={zoomIn}  title="Zoom in (or scroll up)">+</button>
            <span className="pc-zcnt">{nb}{timeframe === 'W' ? 'w' : timeframe === 'D' ? 'd' : timeframe === '4H' || timeframe === '1H' ? 'h' : 'm'}</span>
            <button className="pc-zbtn" onClick={zoomOut} title="Zoom out (or scroll down)">−</button>
            <button className="pc-zbtn pc-zbtn-reset" onClick={zoomReset} title="Reset to default view">⟳</button>
          </div>
        </div>
      </div>

      {/* ── Floating Tools Panel — shown when ⚙ is active ── */}
      {showTools && (
        <div style={{
          position: 'absolute', top: 42, right: 12, zIndex: 200,
          background: '#020c18', border: '1px solid #1e3a5f', borderRadius: 6,
          padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 5,
          minWidth: 200, maxWidth: 340, boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
        }}>
          {[
            { id: 'hline', icon: '—', tip: 'Horizontal line — click chart to place' },
            { id: 'trend', icon: '╱', tip: 'Trendline — click + drag' },
            { id: 'erase', icon: '✕', tip: 'Eraser — click a line to delete' },
          ].map(t => (
            <button key={t.id} title={t.tip}
              onClick={() => setDrawTool(prev => prev === t.id ? 'none' : t.id)}
              style={{
                background: drawTool === t.id ? '#1e3a5f' : 'transparent',
                border: `1px solid ${drawTool === t.id ? '#3b82f6' : '#1e2d45'}`,
                color: drawTool === t.id ? '#60a5fa' : '#3a5a7a',
                borderRadius: 4, padding: '2px 8px', fontSize: 13,
                cursor: 'pointer', fontWeight: 700, lineHeight: 1.4,
              }}>{t.icon}</button>
          ))}
          <span style={{ width: '100%', height: 1, background: '#0e1e30', margin: '2px 0' }} />
          <button title="Toggle entry EMAs (5 · 15 · 30)" onClick={() => setShowEntryEmas(v => !v)} style={{
            background: showEntryEmas ? '#0c1e10' : 'transparent',
            border: `1px solid ${showEntryEmas ? '#10b981' : '#1e2d45'}`,
            color: showEntryEmas ? '#10b981' : '#3a5a7a',
            borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
          }}>E-Fast</button>
          <button title="Toggle trend EMAs (65 · 200)" onClick={() => setShowTrendEmas(v => !v)} style={{
            background: showTrendEmas ? '#12100a' : 'transparent',
            border: `1px solid ${showTrendEmas ? '#eab308' : '#1e2d45'}`,
            color: showTrendEmas ? '#eab308' : '#3a5a7a',
            borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
          }}>E-Trend</button>
          {fibLines.length > 0 && (
            <button title="Toggle Fibonacci levels" onClick={() => setShowFib(v => !v)} style={{
              background: showFib ? '#110e00' : 'transparent',
              border: `1px solid ${showFib ? '#c8a830' : '#1e2d45'}`,
              color: showFib ? '#c8a830' : '#3a5a7a',
              borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
            }}>Fib</button>
          )}
          <button title="Toggle RSI sub-panel" onClick={() => {
            setShowRSI(v => {
              if (v) userClosedRSI.current = true
              else   userClosedRSI.current = false
              return !v
            })
          }} style={{
            background: showRSI ? '#060d1a' : 'transparent',
            border: `1px solid ${showRSI ? '#60a5fa' : '#1e2d45'}`,
            color: showRSI ? '#60a5fa' : '#3a5a7a',
            borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
          }}>RSI</button>
          <button title={useHA ? 'Heikin-Ashi active — click for OHLC' : 'OHLC active — click for Heikin-Ashi'}
            onClick={() => setUseHA(v => !v)} style={{
              background: useHA ? '#0a0a1e' : 'transparent',
              border: `1px solid ${useHA ? '#6366f1' : '#1e2d45'}`,
              color: useHA ? '#818cf8' : '#3a5a7a',
              borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
            }}>HA</button>
          {spyCloses?.length > 0 && (
            <button title="Relative Strength vs SPY" onClick={() => setShowRS(v => !v)} style={{
              background: showRS ? '#0e1205' : 'transparent',
              border: `1px solid ${showRS ? '#84cc16' : '#1e2d45'}`,
              color: showRS ? '#a3e635' : '#3a5a7a',
              borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
            }}>RS</button>
          )}
          {anchoredVwaps.length > 0 && (
            <button title="Clear anchored VWAPs" onClick={() => setAnchoredVwaps([])} style={{
              background: 'transparent', border: '1px solid #1e2d45', color: '#a78bfa',
              borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
            }}>A-VWAP ✕</button>
          )}
          <button title={showAllPatterns ? 'All patterns — click for ★ only' : 'High-confidence (≥75%) — click for all'}
            onClick={() => setShowAllPatterns(v => !v)} style={{
              background: showAllPatterns ? '#0e0e1a' : 'transparent',
              border: `1px solid ${showAllPatterns ? '#a78bfa' : '#1e2d45'}`,
              color: showAllPatterns ? '#a78bfa' : '#3a5a7a',
              borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
            }}>Pats {showAllPatterns ? 'All' : '★'}</button>
          <span style={{ width: '100%', height: 1, background: '#0e1e30', margin: '2px 0' }} />
          <button title="SMC liquidity sweeps (on/off)" onClick={() => setShowSweeps(v => !v)} style={{
            background: showSweeps ? '#100e1a' : 'transparent',
            border: `1px solid ${showSweeps ? '#a78bfa' : '#1e2d45'}`,
            color: showSweeps ? '#a78bfa' : '#3a5a7a',
            borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
          }}>Sweeps</button>
          <button title="SMC order blocks (on/off)" onClick={() => setShowOBs(v => !v)} style={{
            background: showOBs ? '#0a1118' : 'transparent',
            border: `1px solid ${showOBs ? '#22d3ee' : '#1e2d45'}`,
            color: showOBs ? '#22d3ee' : '#3a5a7a',
            borderRadius: 4, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 800,
          }}>Blks</button>
          {curLines.length > 0 && (
            <button onClick={() => setDrawings(prev => ({ ...prev, [curKey]: [] }))} style={{
              background: 'transparent', border: '1px solid #1e2d45', color: '#3a5a7a',
              borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
            }}>Clear Lines</button>
          )}
          {drawTool !== 'none' && (
            <div style={{ width: '100%', fontSize: 9, color: '#3a5a7a', paddingTop: 3 }}>
              {drawTool === 'hline' ? 'Click chart to place line' :
               drawTool === 'trend' ? 'Click + drag to draw trendline' : 'Click line to erase'}
            </div>
          )}
        </div>
      )}

      {/* ── Insight banner — surfaces key signals automatically ── */}
      {d?.rsiDivs?.length > 0 && (() => {
        const latest = d.rsiDivs[d.rsiDivs.length - 1]
        const isBull = latest.kind === 'bull'
        const col    = isBull ? '#10b981' : '#ef4444'
        const bg     = isBull ? '#030f09' : '#0f0303'
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 12px', background: bg,
            borderBottom: `1px solid ${col}22`,
          }}>
            <span style={{
              fontSize: 8, fontWeight: 900, color: col,
              letterSpacing: '0.5px', opacity: 0.9,
            }}>
              {isBull ? '↑ RSI BULL DIVERGENCE' : '↓ RSI BEAR DIVERGENCE'}
            </span>
            <span style={{ fontSize: 7.5, color: '#2a4060', fontWeight: 600 }}>
              {isBull
                ? 'Price made a lower low — RSI made a higher low. Potential reversal upward.'
                : 'Price made a higher high — RSI made a lower high. Potential reversal downward.'}
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: 7.5, color: col, fontWeight: 700, opacity: 0.7,
              cursor: 'pointer', padding: '1px 5px',
            }}
              onClick={() => { userClosedRSI.current = true; setShowRSI(false) }}
              title="Dismiss"
            >✕</span>
          </div>
        )
      })()}

      {/* ── SVG chart ── */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${TOTAL}`}
        className="pc-svg"
        style={{ cursor: isDragging ? 'grabbing' : 'crosshair', userSelect: 'none' }}
        onClick={handleChartClick}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {/* Price area background */}
        <rect x={PL} y={PT} width={VW - PL - PR} height={PH - PT} fill="#040b16" rx="2" />

        {/* HA mode badge — top-left of chart, confirms candle type */}
        {useHA && (
          <g pointerEvents="none">
            <rect x={PL + 4} y={PT + 4} width={22} height={10} rx="3"
              fill="#050e1c" stroke="#1e3a5f" strokeWidth="0.8" opacity="0.88" />
            <text x={PL + 15} y={PT + 11.5} textAnchor="middle"
              fontSize="6" fill="#2a5080" fontWeight="800" letterSpacing="0.4">HA</text>
          </g>
        )}

        {/* Volume area background */}
        <rect x={PL} y={PH + GAP} width={VW - PL - PR} height={VH} fill="#030912" rx="1" />

        {/* Weekly separator lines */}
        {weekSeps.map((x, i) => (
          <line key={`ws-${i}`}
            x1={x} y1={PT} x2={x} y2={PH + GAP + VH}
            stroke="#0c1d2e" strokeWidth="0.8" />
        ))}

        {/* Horizontal price grid */}
        {yTicks.map(({ p, y }) => (
          <g key={p}>
            <line x1={PL} y1={y} x2={VW - PR} y2={y}
              stroke="#0b1c2e" strokeWidth="0.6" />
            <text x={PL - 5} y={y + 3.5} textAnchor="end" fontSize="9" fill="#4a6a8a" fontWeight="600">
              {p >= 1000 ? `${(p / 1000).toFixed(2)}K` : p.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Gap bands — Tier 3 context: faint background only */}
        {gapBands.map((g, i) => {
          const col   = g.type === 'up' ? '#10b981' : '#ef4444'
          const bandH = Math.max(2, g.y2 - g.y1)
          return (
            <g key={`gap-${i}`}>
              <rect x={PL} y={g.y1} width={VW - PL - PR} height={bandH}
                fill={col} opacity="0.05" />
              <line x1={PL} y1={g.y1} x2={VW - PR} y2={g.y1}
                stroke={col} strokeWidth="0.7" strokeDasharray="6,4" opacity="0.38" />
              <line x1={PL} y1={g.y2} x2={VW - PR} y2={g.y2}
                stroke={col} strokeWidth="0.7" strokeDasharray="6,4" opacity="0.38" />
              {labelGuard((g.y1 + g.y2) / 2) && (
                <text x={PL + 6} y={(g.y1 + g.y2) / 2 + 3.5}
                  textAnchor="start" fontSize="7" fill={col} opacity="0.38" fontWeight="700">
                  {`GAP${g.type === 'up' ? '↑' : '↓'} $${g.size.toFixed(2)}`}
                  {gapClass?.type ? `  · ${gapClass.type}` : ''}
                </text>
              )}
            </g>
          )
        })}

        {/* ── Pre-market background + session open separator ── */}
        {showPreMarket && preMarketSet.size > 0 && (() => {
          // Group consecutive pre-market indices into per-day spans
          const spans = []
          let spanStart = null, spanEnd = null, spanDay = null
          const sorted = [...preMarketSet].sort((a, b) => a - b)
          sorted.forEach((i, idx) => {
            const dk = ts[i] ? new Date(ts[i] * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : null
            if (spanStart === null || dk !== spanDay) {
              if (spanStart !== null) spans.push({ first: spanStart, last: spanEnd, day: spanDay })
              spanStart = i; spanEnd = i; spanDay = dk
            } else {
              spanEnd = i
            }
            if (idx === sorted.length - 1) spans.push({ first: spanStart, last: spanEnd, day: spanDay })
          })
          return (
            <>
              {spans.map((sp, si) => {
                const x1 = xOf(sp.first) - bw / 2
                const x2 = xOf(sp.last)  + bw / 2
                const w  = Math.max(1, x2 - x1)
                return (
                  <g key={`pm-bg-${si}`} pointerEvents="none">
                    <rect x={x1} y={PT} width={w} height={PH + GAP + VH - PT}
                      fill="#061220" fillOpacity="0.65" />
                    <text x={x1 + w / 2} y={PT + 10}
                      textAnchor="middle" fontSize="6.5" fill="#3b6ea5" fontWeight="800" opacity="0.75">
                      PRE
                    </text>
                  </g>
                )
              })}
              {sessionOpens.map(({ i, x }) => (
                <line key={`so-${i}`}
                  x1={x - bw / 2} y1={PT} x2={x - bw / 2} y2={PH + GAP + VH}
                  stroke="#3b82f6" strokeWidth="0.9" strokeDasharray="4,3" opacity="0.45"
                  pointerEvents="none" />
              ))}
            </>
          )
        })()}

        {/* ── Opening Range time columns (15M & 5M) — behind everything ── */}
        {(timeframe === '15M' || timeframe === '5M') && (() => {
          const etFmt = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit', minute: '2-digit', hour12: false,
          })
          const daySpans = {}
          ts.forEach((t, i) => {
            if (!t) return
            const parts = etFmt.formatToParts(new Date(t * 1000))
            const rawH  = parseInt(parts.find(p => p.type === 'hour').value,   10)
            const m     = parseInt(parts.find(p => p.type === 'minute').value, 10)
            const etH   = rawH === 24 ? 0 : rawH
            const etMin = etH * 60 + m
            if (etMin < 570 || etMin >= 600) return  // 9:30–9:59 ET only
            const dayKey = new Date(t * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
            if (!daySpans[dayKey]) daySpans[dayKey] = { first: i, last: i }
            else daySpans[dayKey].last = i
          })
          return Object.values(daySpans).map((span, i) => {
            const x1 = xOf(span.first) - bw / 2
            const x2 = xOf(span.last)  + bw / 2
            return (
              <g key={`or-col-${i}`} pointerEvents="none">
                <rect x={x1} y={PT} width={x2 - x1} height={PH - PT}
                  fill="#f59e0b" fillOpacity="0.09" />
                <rect x={x1} y={PT} width={x2 - x1} height={PH - PT}
                  fill="none" stroke="#f59e0b" strokeWidth="0.6" strokeOpacity="0.25" />
                {/* "OR" label at top of first-day column only */}
                {i === 0 && (
                  <text x={(x1 + x2) / 2} y={PT + 9}
                    textAnchor="middle" fontSize="7" fill="#f59e0b" fontWeight="800" opacity="0.55">
                    OR
                  </text>
                )}
              </g>
            )
          })
        })()}

        {/* Fibonacci levels — Tier 3 context: very thin, muted */}
        {showFib && fibLines.map(({ label, p, y }) => (
          <g key={label}>
            <line x1={PL} y1={y} x2={VW - PR} y2={y}
              stroke="#c8a830" strokeWidth="0.6" strokeDasharray="4,5" opacity="0.35" />
            {labelGuard(y) && (
              <text x={PL + 5} y={y - 2}
                textAnchor="start" fontSize="6.5" fill="#8a6e20" fontWeight="700" opacity="0.40">{label}</text>
            )}
          </g>
        ))}

        {/* Timeframe label watermark inside chart — anchored top-left so it's always readable */}
        <text x={PL + 8} y={PT + 16}
          fontSize="13" fill="#1a3050" fontWeight="900"
          letterSpacing="0.8" opacity="1.0" pointerEvents="none">
          {timeframe}
        </text>

        {/* ── Prior Day High / Low — Tier 2: reference weight, not dominant ── */}
        {prevDayH != null && (() => {
          const y = yOf(prevDayH)
          if (y < PT || y > PH) return null
          return (
            <g pointerEvents="none">
              <line x1={PL} y1={y} x2={VW - PR} y2={y}
                stroke="#f97316" strokeWidth="1.0" strokeDasharray="6,4" opacity="0.65" />
              {labelGuard(y) && (
                <text x={VW - PR - 33} y={y - 1} textAnchor="middle"
                  fontSize="6.5" fill="#f97316" fontWeight="700" opacity="0.65">
                  PDH {fmtPx(prevDayH)}
                </text>
              )}
            </g>
          )
        })()}
        {prevDayL != null && (() => {
          const y = yOf(prevDayL)
          if (y < PT || y > PH) return null
          return (
            <g pointerEvents="none">
              <line x1={PL} y1={y} x2={VW - PR} y2={y}
                stroke="#38bdf8" strokeWidth="1.0" strokeDasharray="6,4" opacity="0.65" />
              {labelGuard(y) && (
                <text x={VW - PR - 33} y={y + 8} textAnchor="middle"
                  fontSize="6.5" fill="#38bdf8" fontWeight="700" opacity="0.65">
                  PDL {fmtPx(prevDayL)}
                </text>
              )}
            </g>
          )
        })()}

        {/* ── Opening Range — Tier 1: solid bold lines, dominant presence ── */}
        {(() => {
          const hasH = orbHigh != null && orbHigh > d.priceMin && orbHigh < d.priceMax
          const hasL = orbLow  != null && orbLow  > d.priceMin && orbLow  < d.priceMax
          if (!hasH && !hasL) return null
          const yH = hasH ? yOf(orbHigh) : PT
          const yL = hasL ? yOf(orbLow)  : PH
          return (
            <g pointerEvents="none">
              {/* Amber fill between high and low */}
              {hasH && hasL && (
                <rect x={PL} y={yH} width={VW - PR - PL} height={Math.max(1, yL - yH)}
                  fill="#f59e0b" fillOpacity="0.09" />
              )}
              {/* OR High — solid, thick, unmissable */}
              {hasH && (
                <>
                  <line x1={PL} y1={yH} x2={VW - PR} y2={yH}
                    stroke="#f59e0b" strokeWidth="2.2" opacity="1.0" />
                  <rect x={VW - PR - 76} y={yH - 11} width={74} height={14} rx="2"
                    fill="#120d00" stroke="#f59e0b" strokeWidth="0.6" opacity="0.96" />
                  <text x={VW - PR - 6} y={yH - 1}
                    textAnchor="end" fontSize="8.5" fill="#f59e0b" fontWeight="900" letterSpacing="0.3">
                    ORH  ${fmtPx(orbHigh)}
                  </text>
                </>
              )}
              {/* OR Low — solid, thick, unmissable */}
              {hasL && (
                <>
                  <line x1={PL} y1={yL} x2={VW - PR} y2={yL}
                    stroke="#f59e0b" strokeWidth="2.2" opacity="1.0" />
                  <rect x={VW - PR - 76} y={yL} width={74} height={14} rx="2"
                    fill="#120d00" stroke="#f59e0b" strokeWidth="0.6" opacity="0.96" />
                  <text x={VW - PR - 6} y={yL + 10}
                    textAnchor="end" fontSize="8.5" fill="#f59e0b" fontWeight="900" letterSpacing="0.3">
                    ORL  ${fmtPx(orbLow)}
                  </text>
                </>
              )}
            </g>
          )
        })()}

        {/* ── 15M Swing Targets (T1–T5) — Tier 1: bold, T1 most prominent ── */}
        {swingTargets?.length > 0 && (() => {
          const tColors = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#86efac']
          const visible = swingTargets.slice(0, 5).filter(px => px > d.priceMin && px < d.priceMax)
          if (!visible.length) return null
          return (
            <g pointerEvents="none">
              {swingTargets.slice(0, 5).map((tPx, idx) => {
                if (tPx < d.priceMin || tPx > d.priceMax) return null
                const y   = yOf(tPx)
                const col = tColors[idx] || '#10b981'
                const sw  = idx === 0 ? 2.0 : idx === 1 ? 1.6 : 1.2
                const op  = idx === 0 ? 0.95 : idx === 1 ? 0.82 : 0.65
                return (
                  <g key={`st-${idx}`}>
                    <line x1={PL} y1={y} x2={VW - PR} y2={y}
                      stroke={col} strokeWidth={sw} strokeDasharray="6,4" opacity={op} />
                    <rect x={VW - PR - 72} y={y - 9} width={70} height={12} rx="2"
                      fill="#020d06" stroke={col} strokeWidth="0.5" opacity={op} />
                    <text x={VW - PR - 6} y={y} textAnchor="end"
                      fontSize={idx === 0 ? 8 : 7.5} fill={col} fontWeight={idx === 0 ? '900' : '800'} opacity={op}>
                      T{idx + 1}  ${fmtPx(tPx)}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })()}

        {/* ── Pre-market High / Low — Tier 2: reference, not dominant ── */}
        {showPreMarket && (pmHigh != null || pmLow != null) && (
          <g pointerEvents="none">
            {pmHigh != null && pmHigh > d.priceMin && pmHigh < d.priceMax && (
              <g>
                <line x1={PL} y1={yOf(pmHigh)} x2={VW - PR} y2={yOf(pmHigh)}
                  stroke="#60a5fa" strokeWidth="1.0" strokeDasharray="3,5" opacity="0.60" />
                {labelGuard(yOf(pmHigh)) && (
                  <text x={VW - PR - 5} y={yOf(pmHigh) - 2} textAnchor="end"
                    fontSize="7" fill="#60a5fa" fontWeight="700" opacity="0.60">
                    PMH  ${fmtPx(pmHigh)}
                  </text>
                )}
              </g>
            )}
            {pmLow != null && pmLow > d.priceMin && pmLow < d.priceMax && (
              <g>
                <line x1={PL} y1={yOf(pmLow)} x2={VW - PR} y2={yOf(pmLow)}
                  stroke="#93c5fd" strokeWidth="1.0" strokeDasharray="3,5" opacity="0.60" />
                {labelGuard(yOf(pmLow)) && (
                  <text x={VW - PR - 5} y={yOf(pmLow) + 9} textAnchor="end"
                    fontSize="7" fill="#93c5fd" fontWeight="700" opacity="0.60">
                    PML  ${fmtPx(pmLow)}
                  </text>
                )}
              </g>
            )}
          </g>
        )}

        {/* ── 5M Sniper Entry Signals — EMA 5 touch after ORB break ── */}
        {timeframe === '5M' && orbHigh != null && orbLow != null && (() => {
          const lastClose = d.c[nb - 1]
          const isBull = lastClose != null && lastClose > orbHigh
          const signals = []
          let orbBroken = false
          for (let i = 1; i < nb; i++) {
            const e5v = d.e5[i], e5p = d.e5[i - 1]
            if (e5v == null || e5p == null) continue
            if (!orbBroken) {
              if (isBull ? d.c[i] > orbHigh : d.c[i] < orbLow) orbBroken = true
              continue
            }
            if (isBull) {
              // Wick touched within 0.15% of EMA 5, close still above EMA 5 and above ORH
              if (d.l[i] <= e5v * 1.0015 && d.c[i] > e5v && d.c[i] > orbHigh) {
                signals.push({ i, kind: 'bull' })
              }
            } else {
              if (d.h[i] >= e5v * 0.9985 && d.c[i] < e5v && d.c[i] < orbLow) {
                signals.push({ i, kind: 'bear' })
              }
            }
          }
          if (!signals.length) return null
          return (
            <g pointerEvents="none">
              {signals.map(({ i, kind }, idx) => {
                const cx  = xOf(i)
                const col = kind === 'bull' ? '#10b981' : '#ef4444'
                const tipY = kind === 'bull' ? yOf(d.l[i]) + 14 : yOf(d.h[i]) - 14
                const pts = kind === 'bull'
                  ? `${cx},${tipY - 7} ${cx - 5},${tipY} ${cx + 5},${tipY}`
                  : `${cx},${tipY + 7} ${cx - 5},${tipY} ${cx + 5},${tipY}`
                return (
                  <g key={`snp-${idx}`}>
                    <polygon points={pts} fill={col} opacity="0.92" />
                    <text x={cx} y={kind === 'bull' ? tipY + 9 : tipY - 3}
                      textAnchor="middle" fontSize="6" fill={col} fontWeight="900" letterSpacing="0.2">
                      SNIPE
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })()}

        {/* ── GEX levels — Tier 1, options-derived: long dashes, left tick, ◆ label ── */}
        {[
          { price: gammaFlip, label: 'γ FLIP',    color: '#f59e0b' },
          { price: callWall,  label: 'CALL WALL', color: '#ef4444' },
          { price: putWall,   label: 'PUT WALL',  color: '#10b981' },
          { price: maxPain,   label: 'MAX PAIN',  color: '#a855f7' },
        ].map(({ price, label, color }) => {
          if (price == null) return null
          const gy  = yOf(price)
          if (gy < PT + 2 || gy > PH - 2) return null
          const lblW = label.length * 5.8 + 36
          return (
            <g key={label} pointerEvents="none">
              {/* Wide glow — options levels have a soft halo */}
              <line x1={PL} y1={gy} x2={VW - PR} y2={gy}
                stroke={color} strokeWidth="5" opacity="0.05" />
              {/* Main line — long dashes distinguish options from price levels */}
              <line x1={PL} y1={gy} x2={VW - PR} y2={gy}
                stroke={color} strokeWidth="1.6" strokeDasharray="10,4" opacity="0.88" />
              {/* Left-edge tick mark */}
              <rect x={PL} y={gy - 3} width={3} height={7} rx="1"
                fill={color} opacity="0.92" />
              {/* Label badge — LEFT side (visual differentiator from price levels on right) */}
              <rect x={PL + 6} y={gy - 10} width={lblW} height={12} rx="2"
                fill="#050d1a" stroke={color} strokeWidth="0.6" opacity="0.94" />
              <text x={PL + 11} y={gy} fontSize="7.5" fill={color} fontWeight="800" letterSpacing="0.2">
                ◆ {label}  ${fmtPx(price)}
              </text>
            </g>
          )
        })}

        {/* ── Major S/R Zones (4H and 1H only) — Tier 3: faint fill, thin borders ── */}
        {srZones.map((z, i) => {
          const isRes = z.kind === 'resistance'
          const col   = isRes ? '#ef4444' : '#10b981'
          const fill  = isRes ? '#ef44440d' : '#10b9810d'
          const topY  = yOf(Math.min(z.top, d.priceMax))
          const botY  = yOf(Math.max(z.bot, d.priceMin))
          const zoneH = Math.max(2, botY - topY)
          const clampTop = Math.max(PT, topY)
          const clampH   = Math.min(zoneH, PH - clampTop)
          if (topY > PH || botY < PT || clampH <= 0) return null
          return (
            <g key={`sr-${i}`} pointerEvents="none">
              <rect x={PL} y={clampTop} width={VW - PL - PR} height={clampH} fill={fill} />
              <line x1={PL} y1={topY} x2={VW - PR} y2={topY}
                stroke={col} strokeWidth="0.8" strokeDasharray="5,4" opacity="0.45" />
              <line x1={PL} y1={botY} x2={VW - PR} y2={botY}
                stroke={col} strokeWidth="0.5" strokeDasharray="4,4" opacity="0.25" />
              {labelGuard(yOf(z.price)) && (
                <text x={VW - PR - 34} y={clampTop + 7} textAnchor="middle"
                  fontSize="6.5" fill={col} fontWeight="700" opacity="0.45">
                  {isRes ? 'RES' : 'SUP'} {fmtPx(z.price)}
                </text>
              )}
            </g>
          )
        })}


        {/* ── Liquidity Sweeps (pro mode only) ── */}
        {showSMC && showSweeps && sweeps.map((sw, i) => {
          if (sw.i < 0 || sw.i >= nb) return null
          const x1   = xOf(Math.max(0, sw.swingI))
          const x2   = xOf(sw.i)
          const y    = yOf(sw.level)
          const col  = sw.kind === 'bull' ? '#a78bfa' : '#a78bfa'
          const lbW  = 38, lbH = 10
          const lbX  = Math.max(PL, Math.min(VW - PR - lbW, x2 - lbW / 2))
          const lbY  = sw.kind === 'bull' ? y - lbH - 3 : y + 3
          return (
            <g key={`sw-${i}`} pointerEvents="none">
              <line x1={x1} y1={y} x2={x2} y2={y}
                stroke={col} strokeWidth="1.4" strokeDasharray="4,3" opacity="0.90" />
              <circle cx={x2} cy={y} r="3" fill={col} opacity="0.95" />
              <rect x={lbX} y={lbY} width={lbW} height={lbH} rx="2"
                fill="#0d0f1a" stroke={col} strokeWidth="0.8" opacity="0.92" />
              <text x={lbX + lbW / 2} y={lbY + lbH - 2} textAnchor="middle"
                fontSize="6.5" fill={col} fontWeight="800" letterSpacing="0.3">SWEEP</text>
            </g>
          )
        })}

        {/* ── BOS (Break of Structure) — last 3 in pro, most recent only in simple ── */}
        {showSMC && bos.slice(-3).map((b, i) => {
          if (b.i < 0 || b.i >= nb) return null
          const x1  = xOf(Math.max(0, b.swingI))
          const x2  = xOf(b.i)
          const y   = yOf(b.level)
          const col = b.kind === 'bull' ? '#10b981' : '#ef4444'
          const lbW = 28, lbH = 10
          const lbX = Math.max(PL, Math.min(VW - PR - lbW, x2 - lbW / 2))
          const lbY = b.kind === 'bull' ? y - lbH - 3 : y + 3
          return (
            <g key={`bos-${i}`} pointerEvents="none">
              <line x1={x1} y1={y} x2={x2} y2={y}
                stroke={col} strokeWidth="1.8" opacity="0.95" />
              <rect x={lbX} y={lbY} width={lbW} height={lbH} rx="2"
                fill="#0d0f1a" stroke={col} strokeWidth="0.9" opacity="0.95" />
              <text x={lbX + lbW / 2} y={lbY + lbH - 2} textAnchor="middle"
                fontSize="6.5" fill={col} fontWeight="900" letterSpacing="0.3">
                {b.kind === 'bull' ? '↑ BOS' : '↓ BOS'}
              </text>
            </g>
          )
        })}

        {/* ── CHoCH (Change of Character) — last 3 in pro, most recent only in simple ── */}
        {showSMC && choch.slice(-3).map((ch, i) => {
          if (ch.i < 0 || ch.i >= nb) return null
          const x1  = xOf(Math.max(0, ch.swingI))
          const x2  = xOf(ch.i)
          const y   = yOf(ch.level)
          const col = ch.kind === 'bull' ? '#10b981' : '#ef4444'
          const lbW = 42, lbH = 10
          const lbX = Math.max(PL, Math.min(VW - PR - lbW, x2 - lbW / 2))
          const lbY = ch.kind === 'bull' ? y - lbH - 3 : y + 3
          return (
            <g key={`choch-${i}`} pointerEvents="none">
              <line x1={x1} y1={y} x2={x2} y2={y}
                stroke={col} strokeWidth="1.4" strokeDasharray="5,3" opacity="0.88" />
              <rect x={lbX} y={lbY} width={lbW} height={lbH} rx="2"
                fill="#0d0f1a" stroke={col} strokeWidth="0.8" opacity="0.92" />
              <text x={lbX + lbW / 2} y={lbY + lbH - 2} textAnchor="middle"
                fontSize="6.5" fill={col} fontWeight="800" letterSpacing="0.3">
                {ch.kind === 'bull' ? '↑ CHoCH' : '↓ CHoCH'}
              </text>
            </g>
          )
        })}


        {/* ── Order Blocks (SMC: institutional footprints — pro mode only) ── */}
        {showSMC && showOBs && (() => {
          const bullOBs = orderBlocks.filter(ob => ob.kind === 'bull').slice(-4)
          const bearOBs = orderBlocks.filter(ob => ob.kind === 'bear').slice(-4)
          return [...bullOBs, ...bearOBs].map((ob, i) => {
            const col  = ob.kind === 'bull' ? '#22d3ee' : '#fb923c'
            const topY = yOf(Math.min(ob.top, d.priceMax))
            const botY = yOf(Math.max(ob.bot, d.priceMin))
            const zH   = Math.max(2, botY - topY)
            if (topY > PH || botY < PT) return null
            return (
              <rect key={`ob-${i}`} x={PL} y={topY} width={VW - PL - PR} height={zH}
                fill={col} fillOpacity="0.05" stroke={col} strokeWidth="0.7"
                strokeDasharray="3,2" opacity="0.55" pointerEvents="none" />
            )
          })
        })()}

        {/* ── Confluence zones — all in pro; within 0.5% of price in simple ── */}
        {confluenceZones.filter(z => Math.abs(z.price - topClose) / topClose < 0.02).map((z, i) => {
          const zy = z.y
          if (zy < PT + 2 || zy > PH - 2) return null
          return (
            <g key={`conf-${i}`} pointerEvents="none">
              <line x1={PL} y1={zy} x2={VW - PR} y2={zy}
                stroke="#c07a00" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.30" />
              {labelGuard(zy) && (
                <text x={VW - PR - 3} y={zy - 2} textAnchor="end"
                  fontSize="6" fill="#c07a00" fontWeight="700" opacity="0.50">
                  {z.names}
                </text>
              )}
            </g>
          )
        })}

        {/* EMA 200 — rendered first (bottom layer); always visible in simple mode */}
        {showTrendEmas && (
          <polyline points={toPoints(e200)} fill="none" stroke="#eab308" strokeWidth="2.0"
            strokeLinejoin="round" opacity="0.9" />
        )}

        {/* VWAP — dashed white, one segment per session on intraday */}
        {vwapSegments.map((pts, si) => (
          <polyline key={`vwap-${si}`} points={pts}
            fill="none" stroke="#ffffff" strokeWidth="2.0"
            strokeDasharray="5,3" strokeLinejoin="round" opacity="0.95" />
        ))}

        {/* ── Anchored VWAPs (Shift+click to add) ── */}
        {anchoredVwapLines.map((pts, i) => {
          if (!pts) return null
          const col = anchoredVwaps[i]?.color ?? '#f59e0b'
          return (
            <g key={`avwap-${i}`} pointerEvents="none">
              <polyline points={pts} fill="none" stroke={col}
                strokeWidth="1.6" strokeDasharray="5,3" strokeLinejoin="round" opacity="0.88" />
              <text x={VW - PR - 3} y={parseFloat(pts.split(' ').pop().split(',')[1]) + 4}
                textAnchor="end" fontSize="6.5" fill={col} fontWeight="800" opacity="0.8">
                A-VWAP
              </text>
            </g>
          )
        })}

        {/* ── VWAP cross markers — volume-confirmed price × VWAP crossings ── */}
        {vwapCrosses.map((vc, i) => {
          const col  = vc.kind === 'bull' ? '#10b981' : '#ef4444'
          const badgeW = 40, badgeH = 11
          const raw  = vc.kind === 'bull' ? vc.y - badgeH - 5 : vc.y + 5
          const by   = Math.max(PT + 1, Math.min(PH - badgeH - 1, raw))
          const bx   = Math.max(PL + 1, Math.min(VW - PR - badgeW - 1, vc.x - badgeW / 2))
          return (
            <g key={`vwapx-${i}`} pointerEvents="none">
              <line x1={vc.x} y1={vc.y} x2={vc.x} y2={vc.kind === 'bull' ? by + badgeH : by}
                stroke={col} strokeWidth="1.2" strokeDasharray="2,2" opacity="0.9" />
              <circle cx={vc.x} cy={vc.y} r="3.5"
                fill={col} opacity="0.85" stroke="#ffffff" strokeWidth="0.7" />
              <rect x={bx} y={by} width={badgeW} height={badgeH} rx="2.5"
                fill="#06101e" stroke={col} strokeWidth="0.9" opacity="0.92" />
              <text x={bx + badgeW / 2} y={by + badgeH - 2.5}
                textAnchor="middle" fontSize="6.5" fill={col} fontWeight="800" letterSpacing="0.2">
                {vc.label}
              </text>
            </g>
          )
        })}

        {/* EMA 65 — always visible in simple mode, toggle-gated in pro mode */}
        {showTrendEmas && (
          <polyline points={toPoints(e65)} fill="none" stroke="#a855f7" strokeWidth="2.0" strokeLinejoin="round" />
        )}

        {/* EMA 30 — pro mode only */}
        {showEntryEmas && (
          <polyline points={toPoints(e30)} fill="none" stroke="#06b6d4" strokeWidth="1.8" strokeLinejoin="round" />
        )}

        {/* EMA 15 — pro mode only */}
        {showEntryEmas && (
          <polyline points={toPoints(e15)} fill="none" stroke="#84cc16" strokeWidth="1.8" strokeLinejoin="round" />
        )}

        {/* EMA 5 — pro mode only */}
        {showEntryEmas && (
          <polyline points={toPoints(e5)} fill="none" stroke="#f472b6" strokeWidth="2.2" strokeLinejoin="round" />
        )}

        {/* ── Signal column glows (volume-confirmed reversal bars) ── */}
        {displayReversals.map((r, i) => {
          const col = r.kind === 'bull' ? '#10b981' : '#ef4444'
          const intensity = r.volRatio >= 2.0 ? 0.10 : r.volRatio >= 1.5 ? 0.07 : 0.05
          return (
            <rect key={`sigcol-${i}`}
              x={xOf(r.barI) - bw / 2 - 2} y={PT}
              width={bw + 4} height={PH - PT}
              fill={col} fillOpacity={intensity} rx="1" pointerEvents="none" />
          )
        })}

        {/* ── Pattern arrows — all ≥75% win-rate, recency-first, volume-scaled ── */}
        {(() => {
          // Sort oldest → newest so the most recent renders on top
          const shown = [...displayReversals].sort((a, b) => a.barI - b.barI)
          return shown.map((r, i) => {
            const col   = r.kind === 'bull' ? '#10b981' : '#ef4444'
            const cx    = r.x
            const cy    = Math.max(PT + 20, Math.min(PH - 20, r.yMark))
            // Volume confirmation — scale arrow by conviction
            const scale = r.volRatio >= 2.0 ? 1.45 : r.volRatio >= 1.5 ? 1.2 : r.volRatio < 0.8 ? 0.75 : 1.0
            const sz    = Math.round(7 * scale)   // half-width of triangle base
            const ht    = Math.round(11 * scale)  // triangle height
            const fs    = Math.max(6, Math.round(6.5 * scale))
            const sw    = +(1.5 * scale).toFixed(1)
            const op    = r.volRatio < 0.8 ? 0.50 : 0.95
            // Strip the directional ↑/↓ prefix — shape carries the direction
            const abbr  = r.label.replace(/^[↑↓]/, '')

            if (r.kind === 'bull') {
              const pts = `${cx},${cy - ht} ${cx - sz},${cy} ${cx + sz},${cy}`
              return (
                <g key={`pat-${i}`} style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => setTooltip({
                    clientX: e.clientX, clientY: e.clientY,
                    name: r.name, kind: r.kind, candles: r.candles,
                    rate: r.rate, desc: r.desc, volRatio: r.volRatio,
                  })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <polygon points={pts} fill={col} fillOpacity="0.18"
                    stroke={col} strokeWidth={sw} opacity={op} />
                  <text x={cx} y={cy + 9} textAnchor="middle"
                    fontSize={fs} fill={col} fontWeight="900"
                    opacity={op} pointerEvents="none" letterSpacing="0.2">
                    {abbr}
                  </text>
                </g>
              )
            } else {
              const pts = `${cx},${cy + ht} ${cx - sz},${cy} ${cx + sz},${cy}`
              return (
                <g key={`pat-${i}`} style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => setTooltip({
                    clientX: e.clientX, clientY: e.clientY,
                    name: r.name, kind: r.kind, candles: r.candles,
                    rate: r.rate, desc: r.desc, volRatio: r.volRatio,
                  })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <polygon points={pts} fill={col} fillOpacity="0.18"
                    stroke={col} strokeWidth={sw} opacity={op} />
                  <text x={cx} y={cy - 4} textAnchor="middle"
                    fontSize={fs} fill={col} fontWeight="900"
                    opacity={op} pointerEvents="none" letterSpacing="0.2">
                    {abbr}
                  </text>
                </g>
              )
            }
          })
        })()}

        {/* ── Candles ── */}
        {c.map((cv, i) => {
          const ov      = o[i] ?? cv
          const bull    = cv >= ov
          const col     = bull ? '#00c77a' : '#ff4d4d'
          const wickCol = bull ? '#00a865' : '#cc3333'
          const bodyTop = yOf(Math.max(cv, ov))
          const bodyH   = Math.max(1, yOf(Math.min(cv, ov)) - bodyTop)
          const cx      = xOf(i)
          const isPre   = showPreMarket && preMarketSet.has(i)
          return (
            <g key={i}>
              <line x1={cx} y1={yOf(h[i])} x2={cx} y2={yOf(l[i])}
                stroke={wickCol} strokeWidth="1.2" opacity={isPre ? 0.35 : 1.0} />
              <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH}
                fill={col} opacity={isPre ? 0.45 : 1.0} rx="0.5" />
            </g>
          )
        })}

        {/* ── Volume profile (right column) ── */}
        <rect x={PROF_X} y={PT} width={PROF_W} height={PH - PT}
          fill="#020810" opacity="0.9" />
        <text x={PROF_X + PROF_W / 2} y={PT + 9}
          textAnchor="middle" fontSize="6" fill="#1e3050" fontWeight="700" letterSpacing="0.5">
          VOL PROFILE
        </text>
        {profBins.map((vol, binIdx) => {
          const { vahPrice: vah, valPrice: val, pocIdx: poc, lvnThresh, profAvg } = d
          const isPoc  = binIdx === poc
          const inVA   = binIdx >= d.vaLo && binIdx <= d.vaHi
          const isLVN  = vol < lvnThresh
          const isHVN  = vol >= profAvg * 1.6
          const barW   = (vol / profMax) * PROF_W
          const binH   = (PH - PT) / PROFILE_BINS
          const binY   = PH - (binIdx + 1) * binH
          const fill   = isPoc ? '#facc15' : isHVN ? '#0e7490' : isLVN ? '#1a0808' : inVA ? '#1e4060' : '#0e2030'
          const op     = isPoc ? 1.00 : isHVN ? 0.85 : isLVN ? 0.55 : inVA ? 0.70 : 0.50
          return (
            <rect key={`vp-${binIdx}`}
              x={PROF_X} y={binY + 0.3}
              width={Math.max(isLVN ? 1 : 0, barW)}
              height={Math.max(0.5, binH - 0.6)}
              fill={fill} opacity={op}
            />
          )
        })}

        {/* LVN desert bands across main chart — faint red shading */}
        {profBins.map((vol, binIdx) => {
          if (vol >= d.lvnThresh) return null
          const binH  = (PH - PT) / PROFILE_BINS
          const binY  = PH - (binIdx + 1) * binH
          return (
            <rect key={`lvn-${binIdx}`} pointerEvents="none"
              x={PL} y={binY} width={PROF_X - PL} height={Math.max(0.5, binH)}
              fill="#300808" opacity="0.12" />
          )
        })}

        {/* HVN "NEXT WALL" — nearest high-volume node above current price */}
        {(() => {
          if (!profBins?.length || !d.profAvg) return null
          const hvnThresh = d.profAvg * 1.6
          const curPx = closes[closes.length - 1] ?? 0
          const refPx = orbHigh != null ? Math.max(orbHigh, curPx) : curPx
          if (refPx <= 0) return null
          // Find lowest HVN bin strictly above our reference price
          let wallPrice = null
          for (let i = 0; i < profBins.length; i++) {
            if (profBins[i] < hvnThresh) continue
            const binMid = d.priceMin + (i + 0.5) * priceRange / PROFILE_BINS
            if (binMid > refPx) { wallPrice = binMid; break }
          }
          if (wallPrice == null) return null
          const wallY = yOf(wallPrice)
          if (wallY < PT + 2 || wallY > PH - 2) return null
          return (
            <g pointerEvents="none">
              <line x1={PL} y1={wallY} x2={PROF_X} y2={wallY}
                stroke="#0e7490" strokeWidth="1.2" strokeDasharray="2,4" opacity="0.70" />
              <rect x={VW - PR - 80} y={wallY - 9} width={78} height={11} rx="2"
                fill="#020c18" opacity="0.85" />
              <text x={VW - PR - 5} y={wallY} textAnchor="end" fontSize="7" fill="#0e7490" fontWeight="900">
                NEXT WALL  ${fmtPx(wallPrice)}
              </text>
            </g>
          )
        })()}

        {/* VAH line */}
        {(() => {
          const vahY = yOf(d.vahPrice)
          if (vahY < PT + 2 || vahY > PH - 2) return null
          return (
            <g pointerEvents="none">
              <line x1={PL} y1={vahY} x2={PROF_X + PROF_W} y2={vahY}
                stroke="#10b981" strokeWidth="1.1" strokeDasharray="3,4" opacity="0.85" />
              <text x={PROF_X + 2} y={vahY - 1.5}
                fontSize="6" fill="#10b981" fontWeight="800" opacity="1.0">VAH</text>
            </g>
          )
        })()}

        {/* VAL line */}
        {(() => {
          const valY = yOf(d.valPrice)
          if (valY < PT + 2 || valY > PH - 2) return null
          return (
            <g pointerEvents="none">
              <line x1={PL} y1={valY} x2={PROF_X + PROF_W} y2={valY}
                stroke="#ef4444" strokeWidth="1.1" strokeDasharray="3,4" opacity="0.85" />
              <text x={PROF_X + 2} y={valY - 1.5}
                fontSize="6" fill="#ef4444" fontWeight="800" opacity="1.0">VAL</text>
            </g>
          )
        })()}

        {/* Point of Control line extending across the chart */}
        {(() => {
          const pocPrice = d.priceMin + (pocIdx + 0.5) * priceRange / PROFILE_BINS
          const pocY = yOf(pocPrice)
          if (pocY < PT + 2 || pocY > PH - 2) return null
          return (
            <g pointerEvents="none">
              <line x1={PL} y1={pocY} x2={PROF_X + PROF_W} y2={pocY}
                stroke="#facc15" strokeWidth="1.2" strokeDasharray="2,5" opacity="0.90" />
              <text x={PROF_X + 2} y={pocY - 2}
                fontSize="6.5" fill="#facc15" fontWeight="900" opacity="1.0">POC</text>
            </g>
          )
        })()}

        {/* ── Live price line at last close ── */}
        {lastCloseY > PT && lastCloseY < PH && (
          <g pointerEvents="none">
            <line x1={PL} y1={lastCloseY} x2={VW - PR} y2={lastCloseY}
              stroke={priceColor} strokeWidth="1.2" strokeDasharray="3,4" opacity="0.9" />
          </g>
        )}

        {atr14 != null && (
          <g pointerEvents="none">
            <text x={VW - PR - 3} y={PH - 4}
              textAnchor="end" fontSize="7.5" fill="#475569" fontWeight="700">
              ATR {fmtPx(atr14)}
            </text>
          </g>
        )}

        {/* Reversal column glows — subtle background, no text badges */}

        {/* ── EMA 5 two-bar cross markers (entry/exit signals) ── */}
        {ema5Crosses.map((sig, i) => {
          const col    = sig.kind === 'bull' ? '#10b981' : '#ef4444'
          const shadow = sig.kind === 'bull' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'
          const barSpan = Math.abs(sig.xb - sig.xa) + bw * 2.2
          const bandX   = sig.xa - bw * 1.1

          // Circles sit below wick (bull) or above wick (bear), anchored tightly to each bar
          const circleR = 6.5
          const bullYa  = Math.min(sig.ya + circleR + 2, PH - circleR - 1)
          const bullYb  = Math.min(sig.yb + circleR + 2, PH - circleR - 1)
          const bearYa  = Math.max(sig.ya - circleR - 2, PT + circleR + 1)
          const bearYb  = Math.max(sig.yb - circleR - 2, PT + circleR + 1)
          const cya = sig.kind === 'bull' ? bullYa : bearYa
          const cyb = sig.kind === 'bull' ? bullYb : bearYb

          return (
            <g key={`ema5x-${i}`} pointerEvents="none">
              {/* Translucent band behind both bars */}
              <rect x={bandX} y={PT} width={barSpan} height={PH - PT}
                fill={shadow} rx="2" />

              {/* Connector line between the two circles */}
              <line x1={sig.xa} y1={cya} x2={sig.xb} y2={cyb}
                stroke={col} strokeWidth="1.2" strokeDasharray="2,2" opacity="0.5" />

              {/* Setup bar (i-1) — open dashed ring */}
              <circle cx={sig.xa} cy={cya} r={circleR}
                fill="none" stroke={col} strokeWidth="1.4" strokeDasharray="3,2" opacity="0.6" />

              {/* Confirming bar (i) — solid ring + inner dot */}
              <circle cx={sig.xb} cy={cyb} r={circleR}
                fill={col} fillOpacity="0.18" stroke={col} strokeWidth="2" opacity="0.95" />
              <circle cx={sig.xb} cy={cyb} r="2.5" fill={col} opacity="0.9" />

              {/* ENTRY / EXIT label */}
              <text
                x={sig.xb}
                y={sig.kind === 'bull' ? sig.labelY + 2 : sig.labelY - 2}
                textAnchor="middle"
                fontSize="7"
                fontWeight="900"
                fill={col}
                letterSpacing="0.4"
                opacity="0.9"
              >
                {sig.label}
              </text>
            </g>
          )
        })}

        {/* Pullback/Retracement detection kept for internal use; badges removed for chart clarity */}

        {/* ── Golden Cross / Death Cross — EMA 65 × EMA 200 ── */}
        {goldDeathCrosses.map((gc, i) => {
          const isGolden  = gc.kind === 'golden'
          const lineCol   = isGolden ? '#facc15' : '#ef4444'
          const bgCol     = isGolden ? '#1a1200' : '#1a0505'
          const label     = isGolden ? '★ GOLDEN ×' : '✖ DEATH ×'
          const badgeW    = 70
          const badgeH    = 14
          // Badge: golden at top of chart, death at bottom (so they don't overlap)
          const badgeY    = isGolden ? PT + 2 : PH - badgeH - 2
          const badgeX    = Math.max(PL + 1, Math.min(VW - PR - badgeW - 1, gc.x - badgeW / 2))
          return (
            <g key={`gdc-${i}`} pointerEvents="none">
              {/* Vertical line spanning full price area */}
              <line x1={gc.x} y1={PT} x2={gc.x} y2={PH}
                stroke={lineCol} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.45" />
              {/* Dot at the EMA intersection point */}
              <circle cx={gc.x} cy={gc.crossY} r="4.5"
                fill={lineCol} opacity="0.9" stroke="#000" strokeWidth="0.8" />
              <circle cx={gc.x} cy={gc.crossY} r="2"
                fill="#000" opacity="0.7" />
              {/* Badge label */}
              <rect x={badgeX} y={badgeY} width={badgeW} height={badgeH} rx="3"
                fill={bgCol} stroke={lineCol} strokeWidth="1.1" />
              <text x={badgeX + badgeW / 2} y={badgeY + badgeH - 3.5}
                textAnchor="middle" fontSize="7.8" fill={lineCol} fontWeight="900" letterSpacing="0.3">
                {label}
              </text>
            </g>
          )
        })}

        {/* ── Trend strength badge (bottom-left corner, away from golden/death cross) ── */}
        {(() => {
          const bw2 = 86, bh = 26
          const bx  = PL + 2
          const by  = PH - bh - 4
          const col = trendState.col
          const crossLabel = trendState.isGolden ? '★ GOLDEN CROSS' : '✖ DEATH CROSS'
          const crossCol   = trendState.isGolden ? '#facc15' : '#f87171'
          const bars = [0, 1, 2, 3].map(n => n < trendState.alignScore ? col : '#1e3456')
          return (
            <g pointerEvents="none">
              <rect x={bx} y={by} width={bw2} height={bh} rx="3"
                fill="#020912" stroke={col} strokeWidth="0.9" fillOpacity="0.95" />
              {/* Top line: cross type */}
              <text x={bx + bw2 / 2} y={by + 9.5}
                textAnchor="middle" fontSize="7" fill={crossCol} fontWeight="900" letterSpacing="0.2">
                {crossLabel}
              </text>
              {/* Bottom line: alignment label + strength bars */}
              <text x={bx + 6} y={by + 21} fontSize="7" fill={col} fontWeight="700">
                {trendState.label}
              </text>
              {bars.map((c2, n) => (
                <rect key={n} x={bx + bw2 - 7 - n * 9} y={by + 15} width={7} height={7} rx="1.5"
                  fill={c2} />
              ))}
            </g>
          )
        })()}

        {/* ── Volume Y-axis ticks (max and midpoint) ── */}
        {[1, 0.5].map(frac => {
          const vy  = PH + GAP + VH * (1 - frac)
          const vol = d.volMax * frac
          return (
            <g key={`vtick-${frac}`} pointerEvents="none">
              <line x1={PL - 4} y1={vy} x2={PL} y2={vy} stroke="#1e3456" strokeWidth="0.7" />
              <text x={PL - 6} y={vy + 3.2} textAnchor="end" fontSize="7.5" fill="#2e5070" fontWeight="600">
                {fmtVol(vol)}
              </text>
            </g>
          )
        })}

        {/* ── Volume bars ── */}
        {v.map((vv, i) => {
          const bull     = c[i] >= (o[i] ?? c[i])
          const barH     = Math.max(1, (vv / d.volMax) * VH)
          const isSignal = signalBarSet.has(i)
          const isPre    = showPreMarket && preMarketSet.has(i)
          return (
            <rect key={i}
              x={xOf(i) - bw / 2} y={PH + GAP + VH - barH}
              width={bw} height={barH}
              fill={bull ? '#00c77a' : '#ff4d4d'}
              opacity={isPre ? 0.22 : isSignal ? 0.85 : 0.38}
            />
          )
        })}

        {/* Volume average line (SMA-20) */}
        {d.volAvgPoints.length > 1 && (
          <polyline
            points={d.volAvgPoints.join(' ')}
            fill="none" stroke="#64748b" strokeWidth="1.6" opacity="0.95"
            strokeLinejoin="round"
          />
        )}

        {/* ── Relative Strength vs SPY (pro mode only) ── */}
        {showRS && rsLinePoints.length > 1 && (
          <g pointerEvents="none">
            <polyline points={rsLinePoints.join(' ')} fill="none"
              stroke="#a3e635" strokeWidth="1.8" strokeLinejoin="round" opacity="0.85" />
            <text x={PL + 6} y={PH + GAP + 12} fontSize="7" fill="#a3e635" fontWeight="800" opacity="0.75">
              RS vs SPY
            </text>
            {/* Zero line (rel = 1.0) */}
            {(() => {
              const zeroY = PH + GAP + VH - (0.25 / 0.50) * VH
              return <line x1={PL} y1={zeroY} x2={VW - PR} y2={zeroY}
                stroke="#a3e635" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.30" />
            })()}
          </g>
        )}

        {/* Volume spike callouts (pro mode only) */}
        {volSpikes.map((sp, i) => (
          <g key={`vspike-${i}`} pointerEvents="none">
            <rect x={sp.x - 10} y={sp.vy - 12} width={20} height={10} rx="2"
              fill="#0e1420" stroke="#64748b" strokeWidth="0.8" opacity="0.9" />
            <text x={sp.x} y={sp.vy - 4} textAnchor="middle" fontSize="6.5" fill="#94a3b8" fontWeight="800">
              {sp.mult}×
            </text>
          </g>
        ))}

        {/* X-axis separator */}
        <line x1={PL} y1={PH + GAP - 1} x2={VW - PR} y2={PH + GAP - 1}
          stroke="#0e1e30" strokeWidth="0.5" />

        {/* ── RSI sub-panel ── */}
        {showRSI && (() => {
          const yRSI = v => RSI_Y + (1 - Math.max(0, Math.min(100, v)) / 100) * RSI_H
          const y70  = yRSI(70), y30 = yRSI(30)

          // Overbought (RSI > 70) fill segments
          const obPolys = []
          let obSeg = null
          rsiArr.forEach((v, i) => {
            if (v != null && v >= 70) {
              if (!obSeg) obSeg = { xs: [], rsiYs: [] }
              obSeg.xs.push(xOf(i)); obSeg.rsiYs.push(yRSI(v))
            } else if (obSeg) { obPolys.push(obSeg); obSeg = null }
          })
          if (obSeg) obPolys.push(obSeg)

          // Oversold (RSI < 30) fill segments
          const osPolys = []
          let osSeg = null
          rsiArr.forEach((v, i) => {
            if (v != null && v <= 30) {
              if (!osSeg) osSeg = { xs: [], rsiYs: [] }
              osSeg.xs.push(xOf(i)); osSeg.rsiYs.push(yRSI(v))
            } else if (osSeg) { osPolys.push(osSeg); osSeg = null }
          })
          if (osSeg) osPolys.push(osSeg)

          const rsiPts = rsiArr
            .map((v, i) => v != null ? `${xOf(i).toFixed(1)},${yRSI(v).toFixed(1)}` : null)
            .filter(Boolean).join(' ')

          const lastRSI = [...rsiArr].reverse().find(v => v != null)
          const rsiCol = lastRSI == null ? '#60a5fa'
            : lastRSI >= 70 ? '#ef4444' : lastRSI <= 30 ? '#10b981' : '#60a5fa'

          return (
            <>
              {/* Panel background + top separator */}
              <rect x={PL} y={RSI_Y} width={VW - PL - PR} height={RSI_H} fill="#030810" />
              <line x1={PL} y1={RSI_Y} x2={VW - PR} y2={RSI_Y} stroke="#0e1e30" strokeWidth="0.8" />

              {/* Grid lines at 70, 50, 30 */}
              <line x1={PL} y1={y70} x2={VW - PR} y2={y70}
                stroke="#2a1010" strokeWidth="0.7" strokeDasharray="4,3" />
              <line x1={PL} y1={yRSI(50)} x2={VW - PR} y2={yRSI(50)}
                stroke="#0e1a28" strokeWidth="0.6" />
              <line x1={PL} y1={y30} x2={VW - PR} y2={y30}
                stroke="#0a2010" strokeWidth="0.7" strokeDasharray="4,3" />

              {/* Y-axis level labels */}
              {[{ v: 70, col: '#7f1d1d' }, { v: 50, col: '#1e3456' }, { v: 30, col: '#064e35' }].map(({ v, col }) => (
                <text key={v} x={PL - 4} y={yRSI(v) + 3.5} textAnchor="end"
                  fontSize="7.5" fill={col} fontWeight="600">{v}</text>
              ))}

              {/* Overbought fills (RSI line → 70 line, red) */}
              {obPolys.map((seg, i) => {
                const fwd = seg.xs.map((x, j) => `${x.toFixed(1)},${seg.rsiYs[j].toFixed(1)}`).join(' ')
                const rev = [...seg.xs].reverse().map(x => `${x.toFixed(1)},${y70.toFixed(1)}`).join(' ')
                return <polygon key={`ob-${i}`} points={`${fwd} ${rev}`}
                  fill="#ef4444" opacity="0.20" pointerEvents="none" />
              })}

              {/* Oversold fills (30 line → RSI line, green) */}
              {osPolys.map((seg, i) => {
                const fwd = seg.xs.map(x => `${x.toFixed(1)},${y30.toFixed(1)}`).join(' ')
                const rev = [...seg.xs].reverse().map((x, ri) =>
                  `${x.toFixed(1)},${[...seg.rsiYs].reverse()[ri].toFixed(1)}`).join(' ')
                return <polygon key={`os-${i}`} points={`${fwd} ${rev}`}
                  fill="#10b981" opacity="0.20" pointerEvents="none" />
              })}

              {/* RSI line */}
              {rsiPts && (
                <polyline points={rsiPts} fill="none" stroke={rsiCol}
                  strokeWidth="1.6" strokeLinejoin="round" opacity="0.9" />
              )}

              {/* ── RSI Divergences ── */}
              {rsiDivs.map((div, i) => {
                const col   = div.kind === 'bull' ? '#10b981' : '#ef4444'
                const yRSIA = yRSI(div.rsiA), yRSIB = yRSI(div.rsiB)
                const xA = xOf(div.iA), xB = xOf(div.iB)
                const priceYA = yOf(div.kind === 'bull' ? l[div.iA] : h[div.iA])
                const priceYB = yOf(div.kind === 'bull' ? l[div.iB] : h[div.iB])
                const labelY  = div.kind === 'bull' ? yRSIB + 9 : yRSIB - 3
                return (
                  <g key={`rdiv-${i}`} pointerEvents="none">
                    {/* Faint price-area divergence line */}
                    <line x1={xA} y1={priceYA} x2={xB} y2={priceYB}
                      stroke={col} strokeWidth="0.9" strokeDasharray="4,2" opacity="0.30" />
                    {/* RSI-panel divergence line */}
                    <line x1={xA} y1={yRSIA} x2={xB} y2={yRSIB}
                      stroke={col} strokeWidth="1.3" strokeDasharray="4,2" opacity="0.75" />
                    {/* Endpoint dots */}
                    <circle cx={xA} cy={yRSIA} r="2" fill={col} opacity="0.70" />
                    <circle cx={xB} cy={yRSIB} r="2.5" fill={col} stroke="#0d1f33" strokeWidth="0.7" opacity="0.85" />
                    {/* Tiny inline label — no background box */}
                    <text x={xB + 3} y={labelY} fontSize="6" fill={col} fontWeight="700" opacity="0.75">
                      {div.kind === 'bull' ? '↑div' : '↓div'}
                    </text>
                  </g>
                )
              })}

              {/* "RSI 14" watermark */}
              <text x={PL + 6} y={RSI_Y + 10} fontSize="8" fill="#1a3050"
                fontWeight="800" letterSpacing="0.3" pointerEvents="none">RSI 14</text>

              {/* Current RSI value badge on right */}
              {lastRSI != null && (() => {
                const ry = Math.max(RSI_Y + 2, Math.min(RSI_Y + RSI_H - 10, yRSI(lastRSI) - 4))
                return (
                  <g pointerEvents="none">
                    <rect x={VW - PR + 2} y={ry} width={PR - 4} height={10} rx="2" fill="#040a14" />
                    <text x={VW - PR + 2 + (PR - 4) / 2} y={ry + 7.5}
                      textAnchor="middle" fontSize="7.5" fill={rsiCol} fontWeight="800">
                      {lastRSI.toFixed(1)}
                    </text>
                  </g>
                )
              })()}

              {/* RSI crosshair readout */}
              {crosshair && hov?.rsi != null && (() => {
                const ry  = yRSI(hov.rsi)
                const col = hov.rsi >= 70 ? '#ef4444' : hov.rsi <= 30 ? '#10b981' : '#60a5fa'
                return (
                  <g pointerEvents="none">
                    <circle cx={crosshair.sx} cy={ry} r="3.5"
                      fill={col} stroke="#ffffff" strokeWidth="0.8" opacity="0.9" />
                    <rect x={1} y={ry - 7} width={PL - 3} height={13} rx="2"
                      fill="#0f172a" opacity="0.88" />
                    <text x={PL - 5} y={ry + 3.5} textAnchor="end"
                      fontSize="8" fill={col} fontWeight="700">
                      {hov.rsi.toFixed(1)}
                    </text>
                  </g>
                )
              })()}
            </>
          )
        })()}

        {/* X-axis date labels */}
        {xLabels.map(({ x, label, isPrimary }, i) => (
          <g key={i} pointerEvents="none">
            {/* Separator line through volume area */}
            <line x1={x} y1={PH + GAP} x2={x} y2={PH + GAP + VH}
              stroke={isPrimary ? '#182e48' : '#0c1c2e'} strokeWidth={isPrimary ? 0.8 : 0.5} />
            {/* Tick mark below RSI panel */}
            <line x1={x} y1={RSI_Y + RSI_H + 1} x2={x} y2={RSI_Y + RSI_H + (isPrimary ? 6 : 4)}
              stroke={isPrimary ? '#2a4a6a' : '#182438'} strokeWidth={isPrimary ? 1.2 : 0.8} />
            {/* Label text */}
            <text x={x} y={RSI_Y + RSI_H + (isPrimary ? 15 : 14)}
              textAnchor="middle"
              fontSize={isPrimary ? 8.5 : 7.5}
              fill={isPrimary ? '#6a8aaa' : '#3a5a74'}
              fontWeight={isPrimary ? 700 : 600}
              letterSpacing="0.2">
              {label}
            </text>
          </g>
        ))}

        {/* "TODAY" badge under the last bar when viewing live */}
        {isToday && isLive && (
          <g>
            <rect x={lastBarX - 17} y={PH + GAP + 1} width={34} height={11} rx="2"
              fill="#1e3a6e" opacity="0.88" />
            <text x={lastBarX} y={PH + GAP + 9.5}
              textAnchor="middle" fontSize="7" fill="#60a5fa" fontWeight="800" letterSpacing="0.5">
              TODAY
            </text>
          </g>
        )}

        {/* ── User drawings ── */}
        {curLines.map((ln, i) => {
          if (ln.type === 'hline') {
            const y = d.yOf(ln.price)
            if (y < PT || y > PH) return null
            return (
              <g key={`dl-${i}`} style={{ cursor: drawTool === 'erase' ? 'pointer' : 'default' }}
                onClick={drawTool === 'erase' ? () => setDrawings(prev => ({ ...prev, [curKey]: curLines.filter((_, j) => j !== i) })) : undefined}>
                <line x1={PL} y1={y} x2={VW - PR} y2={y}
                  stroke={ln.color} strokeWidth="1.2" strokeDasharray="6,3" opacity="0.85" />
                <rect x={VW - PR - 54} y={y - 9} width={52} height={13} rx="2" fill="#040b16" opacity="0.9" />
                <text x={VW - PR - 5} y={y} textAnchor="end" fontSize="8" fill={ln.color} fontWeight="700">
                  ${ln.price.toFixed(2)}
                </text>
              </g>
            )
          }
          if (ln.type === 'trend') {
            return (
              <g key={`dl-${i}`} style={{ cursor: drawTool === 'erase' ? 'pointer' : 'default' }}
                onClick={drawTool === 'erase' ? () => setDrawings(prev => ({ ...prev, [curKey]: curLines.filter((_, j) => j !== i) })) : undefined}>
                <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                  stroke={ln.color} strokeWidth="1.4" opacity="0.8" />
                <circle cx={ln.x1} cy={ln.y1} r="3" fill={ln.color} opacity="0.7" />
                <circle cx={ln.x2} cy={ln.y2} r="3" fill={ln.color} opacity="0.7" />
              </g>
            )
          }
          return null
        })}
        {/* In-progress trendline draft */}
        {draftLine && (
          <line x1={draftLine.x1} y1={draftLine.y1} x2={draftLine.x2} y2={draftLine.y2}
            stroke="#60a5fa" strokeWidth="1.2" strokeDasharray="4,3" opacity="0.6" pointerEvents="none" />
        )}

        {/* ── Crosshair (always on top) ── */}
        {crosshair && (() => {
          // Build EMA label list for collision avoidance
          const emaInfo = [
            { val: hov?.e5,   col: '#f472b6', name: 'E5'   },
            { val: hov?.e15,  col: '#84cc16', name: 'E15'  },
            { val: hov?.e30,  col: '#06b6d4', name: 'E30'  },
            { val: hov?.e65,  col: '#a855f7', name: 'E65'  },
            { val: hov?.e200, col: '#eab308', name: 'E200' },
            { val: hov?.vwap, col: '#ffffff', name: 'VWAP' },
          ].filter(e => e.val != null && e.val > d.priceMin && e.val < d.priceMax)

          const MIN_GAP = 13
          const lbls = emaInfo
            .map(e => ({ ...e, dotY: yOf(e.val), labelY: yOf(e.val) }))
            .sort((a, b) => a.labelY - b.labelY)
          for (let i = 1; i < lbls.length; i++) {
            if (lbls[i].labelY - lbls[i - 1].labelY < MIN_GAP)
              lbls[i].labelY = lbls[i - 1].labelY + MIN_GAP
          }

          return (
            <g pointerEvents="none">
              <line x1={crosshair.sx} y1={PT} x2={crosshair.sx} y2={RSI_Y + RSI_H}
                stroke="#60a5fa" strokeWidth="0.7" strokeDasharray="4,3" opacity="0.45" />
              <line x1={PL} y1={crosshair.sy} x2={VW - PR} y2={crosshair.sy}
                stroke="#60a5fa" strokeWidth="0.7" strokeDasharray="4,3" opacity="0.45" />

              {/* Price crosshair label */}
              {crosshairPx != null && (
                <>
                  <rect x={1} y={crosshair.sy - 8} width={PL - 3} height={15} rx="2.5" fill="#1a3454" />
                  <text x={PL - 5} y={crosshair.sy + 3.8}
                    textAnchor="end" fontSize="8.5" fill="#93c5fd" fontWeight="700">
                    {fmtPx(crosshairPx)}
                  </text>
                </>
              )}

              {/* Candle center dot */}
              {hov && (
                <circle cx={crosshair.sx} cy={yOf(hov.c)} r="3.5"
                  fill={hov.bull ? '#00c77a' : '#ff4d4d'}
                  stroke="#ffffff" strokeWidth="0.8" opacity="0.95" />
              )}

              {/* EMA dots on the line + Y-axis labels */}
              {hov && lbls.map(({ val, col, name, dotY, labelY }) => (
                <g key={name}>
                  {/* Dot on the EMA line */}
                  <circle cx={crosshair.sx} cy={dotY} r="3.8"
                    fill={col} stroke="#0f172a" strokeWidth="1" opacity="0.92" />
                  {/* Connector tick from label to dot position */}
                  {Math.abs(labelY - dotY) > 1 && (
                    <line x1={PL - 3} y1={dotY} x2={PL - 1} y2={dotY}
                      stroke={col} strokeWidth="0.6" opacity="0.5" />
                  )}
                  {/* Y-axis label background */}
                  <rect x={1} y={labelY - 7} width={PL - 3} height={13} rx="2" fill="#0f172a" opacity="0.88" />
                  <rect x={1} y={labelY - 7} width={2.5} height={13} rx="1" fill={col} />
                  {/* Label text */}
                  <text x={PL - 5} y={labelY + 3.5}
                    textAnchor="end" fontSize="7.5" fill={col} fontWeight="700">
                    {name} {fmtPx(val)}
                  </text>
                </g>
              ))}

              {/* Cursor timestamp pill at bottom — time-frame and session aware */}
              {hov?.ts && (() => {
                const dt     = new Date(hov.ts * 1000)
                const isIntra = timeframe !== 'W' && timeframe !== 'D'
                let label, session = '', pillStroke = '#1e3f6e', pillText = '#60a5fa'

                if (timeframe === 'W') {
                  label = `Wk ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}`
                } else if (timeframe === 'D') {
                  label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                } else {
                  // All times and session detection in ET (America/New_York)
                  // so the label is always market-clock correct regardless of user's local timezone
                  const tsMs  = hov.ts * 1000
                  const dtObj = new Date(tsMs)
                  const ET    = 'America/New_York'

                  const dateStr = dtObj.toLocaleDateString('en-US', {
                    timeZone: ET, month: 'short', day: 'numeric'
                  })
                  // 12-hour display time (e.g. "9:30 AM", "2:15 PM")
                  const timeDisp = dtObj.toLocaleTimeString('en-US', {
                    timeZone: ET, hour: 'numeric', minute: '2-digit', hour12: true
                  })
                  // 24-hour ET components for session detection
                  const t24 = dtObj.toLocaleTimeString('en-US', {
                    timeZone: ET, hour: '2-digit', minute: '2-digit', hour12: false
                  })
                  const [rawHr, etMin] = t24.split(':').map(Number)
                  const etHr = rawHr === 24 ? 0 : rawHr   // guard against "24:xx" edge

                  if (etHr < 9 || (etHr === 9 && etMin < 30)) {
                    session = 'PRE'; pillStroke = '#ca8a04'; pillText = '#facc15'
                  } else if (etHr >= 16) {
                    session = 'AH'; pillStroke = '#c2410c'; pillText = '#fb923c'
                  }

                  label = session
                    ? `${dateStr}  ${timeDisp} ET · ${session}`
                    : `${dateStr}  ${timeDisp} ET`
                }

                const rw = isIntra ? (session ? 114 : 96) : 76
                const ty = RSI_Y + RSI_H + 14
                const cx = Math.max(PL + rw / 2 + 2, Math.min(VW - PR - rw / 2 - 2, crosshair.sx))
                return (
                  <g>
                    <rect x={cx - rw / 2} y={ty - 9} width={rw} height={13} rx="2.5" fill="#0d1f33" />
                    <rect x={cx - rw / 2} y={ty - 9} width={rw} height={13} rx="2.5"
                      fill="none" stroke={pillStroke} strokeWidth="0.8" />
                    <text x={cx} y={ty + 1.5} textAnchor="middle"
                      fontSize="8.5" fill={pillText} fontWeight="700">
                      {label}
                    </text>
                  </g>
                )
              })()}
            </g>
          )
        })()}
      </svg>

      {/* ── TF Alignment Footer ── */}
      {tfAlignment && (() => {
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', background: '#020709',
            borderTop: '1px solid #081420',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {[
                { tf: 'W', bars: tfAlignment?.W },
                { tf: 'D', bars: tfAlignment?.D },
                { tf: '4H', bars: tfAlignment?.['4H'] },
                { tf: '1H', bars: tfAlignment?.['1H'] },
                { tf: '15M', bars: tfAlignment?.['15M'] },
              ].map(({ tf, bars }) => {
                if (!bars) return null
                const isActive = tf === timeframe
                return (
                  <div key={tf} style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: isActive ? 1 : 0.38 }}>
                    <span style={{ fontSize: 8.5, color: '#354f6a', fontWeight: 600 }}>{tf}</span>
                    <span style={{
                      fontSize: 8.5, fontWeight: 800, color: bars.col,
                      borderBottom: isActive ? `1.5px solid ${bars.col}` : 'none',
                      paddingBottom: 1, letterSpacing: '0.2px',
                    }}>{bars.label}</span>
                  </div>
                )
              })}
            </div>
            <span style={{ width: 1, background: '#0e1e2e', alignSelf: 'stretch', margin: '1px 2px' }} />
            {verdict && (() => {
              const regCol = verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH' ? '#10b981'
                : verdict === 'HOSTILE' || verdict === 'BEARISH' ? '#ef4444'
                : verdict === 'HIGH VIX' ? '#f59e0b' : '#60a5fa'
              return <span style={{ fontSize: 8.5, color: regCol, fontWeight: 700, opacity: 0.85 }}>{verdict}</span>
            })()}
            {flowSentiment && (() => {
              const total = (flowSentiment.callPrem ?? 0) + (flowSentiment.putPrem ?? 0)
              if (total < 25000) return null
              const callRatio = (flowSentiment.callPrem ?? 0) / total
              const isBull = callRatio > 0.55, isBear = callRatio < 0.45
              if (!isBull && !isBear) return null
              const flowCol = isBull ? '#10b981' : '#ef4444'
              const flowLbl = isBull ? `CALL ${Math.round(callRatio * 100)}%` : `PUT ${Math.round((1 - callRatio) * 100)}%`
              return <span style={{ fontSize: 8.5, color: flowCol, fontWeight: 700, opacity: 0.85 }}>· {flowLbl}</span>
            })()}
            {vixData?.vix != null && (
              <span style={{ fontSize: 8.5, fontWeight: 700, opacity: 0.7,
                color: vixData.vix > 25 ? '#ef4444' : vixData.vix < 18 ? '#4a7a5a' : '#8a6a30' }}>
                · VIX {vixData.vix.toFixed(1)}
              </span>
            )}
          </div>
        )
      })()}

      {/* ── Hover tooltip (fixed position) ── */}
      {tooltip && (() => {
        const left = Math.min(tooltip.clientX + 16, window.innerWidth - 252)
        const top  = Math.max(tooltip.clientY - 130, 8)

        if (tooltip.pat) {
          const { pat } = tooltip
          const kindLabel = pat.kind === 'bull' ? 'Bullish' : pat.kind === 'bear' ? 'Bearish' : 'Neutral'
          return (
            <div className="pc-rev-tooltip" style={{ position: 'fixed', left, top, zIndex: 9999, pointerEvents: 'none', width: 244 }}>
              <div className="pc-tt-head" style={{ color: pat.col }}>{pat.type}</div>
              <div className="pc-tt-sub">Chart pattern<span className="pc-tt-kind" style={{ color: pat.col }}> · {kindLabel}</span></div>
              <div className="pc-tt-desc">{PAT_DESC[pat.type] ?? 'Strong chart pattern detected.'}</div>
              <div className="pc-tt-rate-row">
                <span className="pc-tt-rate-lbl">Strength score</span>
                <span className="pc-tt-rate-val" style={{ color: pat.col }}>{pat.score}</span>
              </div>
            </div>
          )
        }

        return (
          <div className="pc-rev-tooltip" style={{ position: 'fixed', left, top, zIndex: 9999, pointerEvents: 'none' }}>
            <div className="pc-tt-head" style={{ color: tooltip.kind === 'bull' ? '#10b981' : '#ef4444' }}>
              {tooltip.name}
            </div>
            <div className="pc-tt-sub">
              {tooltip.candles}-candle reversal
              <span className="pc-tt-kind" style={{ color: tooltip.kind === 'bull' ? '#10b981' : '#ef4444' }}>
                {tooltip.kind === 'bull' ? ' · Bullish' : ' · Bearish'}
              </span>
            </div>
            <div className="pc-tt-desc">{tooltip.desc}</div>
            <div className="pc-tt-rate-row">
              <span className="pc-tt-rate-lbl">Historical success rate</span>
              <span className="pc-tt-rate-val" style={{ color: tooltip.kind === 'bull' ? '#10b981' : '#ef4444' }}>
                ~{tooltip.rate}%
              </span>
            </div>
            {tooltip.volRatio != null && (
              <div className="pc-tt-rate-row">
                <span className="pc-tt-rate-lbl">Volume vs avg</span>
                <span className="pc-tt-rate-val" style={{ color: '#94a3b8' }}>
                  {tooltip.volRatio}× avg
                </span>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
