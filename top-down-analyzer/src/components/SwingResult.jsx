import RiskPanel from './RiskPanel'
import './SwingResult.css'

const SIGNAL_CFG = {
  LONG:  { color: '#10b981', bg: '#011c10', border: '#064d2a', label: 'LONG ENTRY' },
  EXIT:  { color: '#ef4444', bg: '#1c0101', border: '#4d0606', label: 'EXIT' },
  WATCH: { color: '#f59e0b', bg: '#1a1000', border: '#4d2f00', label: 'WATCH' },
}

function BarDot({ value }) {
  if (!value) return <span className="bar-dot empty" />
  return <span className={`bar-dot ${value}`}>{value === 'above' ? '▲' : '▼'}</span>
}

function fmt(price) {
  if (price === null || price === undefined || isNaN(price)) return '—'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Timing Intelligence helpers ───────────────────────────────────────────────
function fhEmaSeries(arr, period) {
  if (!arr || arr.length < period) return []
  const k = 2 / (period + 1)
  const out = Array(period - 1).fill(null)
  let v = arr.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(v)
  for (let i = period; i < arr.length; i++) { v = arr[i] * k + v * (1 - k); out.push(v) }
  return out
}

// 1. Bar Quality Score — body/range ratio, size vs ATR, volume vs 20-day avg
function computeBarQuality(fourHBars) {
  if (!fourHBars) return null
  const { closes, highs, lows, volumes } = fourHBars
  const n = closes.length
  if (n < 22) return null
  let atrSum = 0
  for (let i = n - 14; i < n; i++) {
    const pc = closes[i - 1] ?? closes[i]
    atrSum += Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc))
  }
  const atr = atrSum / 14
  const volAvg = volumes.slice(n - 20, n).reduce((a, b) => a + b, 0) / 20
  const scoreBar = i => {
    const range     = highs[i] - lows[i]
    const bodySize  = Math.abs(closes[i] - (closes[i - 1] ?? closes[i]))
    const bodyRatio = range > 0 ? bodySize / range : 0
    const sizeVsAtr = atr > 0 ? range / atr : 0
    const volRatio  = volAvg > 0 ? volumes[i] / volAvg : 0
    let score = 0
    if (bodyRatio > 0.6) score += 2; else if (bodyRatio > 0.3) score += 1
    if (sizeVsAtr > 1.2) score += 2; else if (sizeVsAtr > 0.7) score += 1
    if (volRatio  > 1.5) score += 2; else if (volRatio  > 0.8) score += 1
    return {
      score,
      label: score >= 5 ? 'STRONG' : score >= 3 ? 'MODERATE' : 'WEAK',
      bodyRatio: Math.round(bodyRatio * 100),
      sizeVsAtr: Math.round(sizeVsAtr * 100) / 100,
      volRatio:  Math.round(volRatio  * 100) / 100,
    }
  }
  return { last: scoreBar(n - 1), prev: n >= 2 ? scoreBar(n - 2) : null }
}

// 2. EMA5 Slope Gate — slope as %/bar over last 5 intervals
function computeEma5Slope(fourHBars) {
  if (!fourHBars) return null
  const { closes } = fourHBars
  if (closes.length < 15) return null
  const series = fhEmaSeries(closes, 5)
  const valid  = series.filter(v => v != null)
  if (valid.length < 6) return null
  const last6 = valid.slice(-6)
  let totalPct = 0
  for (let i = 1; i < last6.length; i++) totalPct += (last6[i] - last6[i - 1]) / last6[i - 1] * 100
  const slopePctPerBar = totalPct / (last6.length - 1)
  const absSlope = Math.abs(slopePctPerBar)
  return {
    slopePctPerBar: Math.round(slopePctPerBar * 1000) / 1000,
    label: absSlope >= 0.20 ? 'STEEP' : absSlope >= 0.10 ? 'MODERATE' : 'FLAT',
    reliable: absSlope >= 0.10,
    direction: slopePctPerBar >= 0 ? 'up' : 'down',
    ema5: valid[valid.length - 1],
  }
}

// 3. Trend Age Counter — bars since EMAs first aligned in current direction
function computeTrendAge(fourHBars, signal) {
  if (!fourHBars || !signal || signal === 'WATCH') return null
  const { closes } = fourHBars
  if (closes.length < 10) return null
  const ema5 = fhEmaSeries(closes, 5)
  const isLong = signal === 'LONG'
  let age = 0
  for (let i = closes.length - 1; i >= 0; i--) {
    if (ema5[i] == null) break
    const above = closes[i] > ema5[i]
    if ((isLong && above) || (!isLong && !above)) age++
    else break
  }
  const phase = age <= 2 ? 'forming' : age <= 7 ? 'early' : age <= 14 ? 'mid' : 'late'
  return { age, phase }
}

// 4. Missed Entry Detector — price >3% from EMA5 = window closed
function computeMissedEntry(fourHBars, currentPrice, signal) {
  if (!fourHBars || !currentPrice || !signal || signal === 'WATCH') return null
  const { closes } = fourHBars
  if (closes.length < 10) return null
  const series = fhEmaSeries(closes, 5)
  const ema5   = series[series.length - 1]
  if (ema5 == null) return null
  const pctFrom = ((currentPrice - ema5) / ema5) * 100
  if (Math.abs(pctFrom) <= 3) return { missed: false, pctFrom: Math.round(pctFrom * 100) / 100, ema5 }
  return {
    missed: true,
    pctFrom: Math.round(pctFrom * 100) / 100,
    ema5: Math.round(ema5 * 100) / 100,
    reentryHigh: Math.round(ema5 * 1.015 * 100) / 100,
    reentryLow:  Math.round(ema5 * 0.985 * 100) / 100,
  }
}

// 5. Flip Recency — bars since RSI/MACD last changed direction
function computeFlipRecency(fourHBars) {
  if (!fourHBars) return null
  const { closes } = fourHBars
  const n = closes.length
  if (n < 40) return null
  const ema12s = fhEmaSeries(closes, 12)
  const ema26s = fhEmaSeries(closes, 26)
  const macdVals = []
  for (let i = 0; i < n; i++) {
    if (ema12s[i] != null && ema26s[i] != null) macdVals.push(ema12s[i] - ema26s[i])
  }
  const signalS = fhEmaSeries(macdVals, 9)
  const histS   = macdVals.map((m, i) => signalS[i] != null ? m - signalS[i] : null)
  let macdBars = 0
  const lastH = histS[histS.length - 1]
  if (lastH != null) {
    for (let i = histS.length - 2; i >= 0; i--) {
      if (histS[i] == null) break
      if ((lastH > 0) === (histS[i] > 0)) macdBars++
      else break
    }
  }
  let rsiArr = []
  if (n >= 15) {
    let avgG = 0, avgL = 0
    for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i-1]; if (d > 0) avgG += d; else avgL -= d }
    avgG /= 14; avgL /= 14
    for (let i = 14; i < n; i++) {
      const d = closes[i] - closes[i-1]
      avgG = (avgG * 13 + Math.max(d, 0)) / 14
      avgL = (avgL * 13 + Math.max(-d, 0)) / 14
      rsiArr.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL))
    }
  }
  let rsiBars = 0
  if (rsiArr.length > 1) {
    const lr = rsiArr[rsiArr.length - 1]
    for (let i = rsiArr.length - 2; i >= 0; i--) {
      if ((lr >= 50) === (rsiArr[i] >= 50)) rsiBars++
      else break
    }
  }
  const lbl = b => b <= 3 ? 'FRESH' : b <= 9 ? 'MODERATE' : 'STALE'
  return {
    macd: { bars: macdBars, label: lbl(macdBars), positive: lastH != null && lastH > 0 },
    rsi:  { bars: rsiBars,  label: lbl(rsiBars),  above50: rsiArr.length > 0 && rsiArr[rsiArr.length - 1] >= 50 },
  }
}

// 6. ADX History — last 5 values for sparkline
function computeAdxHistory(fourHBars) {
  if (!fourHBars) return null
  const { closes, highs, lows } = fourHBars
  const n = closes.length
  if (n < 60) return null
  const p = 14
  const trs = [], pdms = [], mdms = []
  for (let i = 1; i < n; i++) {
    const hd = highs[i] - highs[i-1], ld = lows[i-1] - lows[i]
    trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])))
    pdms.push(hd > ld && hd > 0 ? hd : 0)
    mdms.push(ld > hd && ld > 0 ? ld : 0)
  }
  const ws = arr => {
    let v = arr.slice(0,p).reduce((a,b)=>a+b,0)/p, out=[v]
    for (let i=p; i<arr.length; i++) { v=(v*(p-1)+arr[i])/p; out.push(v) }
    return out
  }
  const sTR=ws(trs), sPDM=ws(pdms), sMDM=ws(mdms)
  const dx=sTR.map((tr,i)=>{
    if(!tr) return 0
    const pdi=(sPDM[i]/tr)*100, mdi=(sMDM[i]/tr)*100, s=pdi+mdi
    return s===0?0:(Math.abs(pdi-mdi)/s)*100
  })
  if (dx.length < p) return null
  const adxS = ws(dx)
  const vals  = adxS.slice(-5).map(v => Math.round(v*10)/10)
  return { values: vals, trend: vals[4]>vals[0]?'rising':'falling', slope: Math.round((vals[4]-vals[3])*10)/10 }
}

// 7. Pre-Signal Readiness Score — 0-100 when WATCH/no signal
function computeReadinessScore(rsiSignal, adxSignal, maStack, weeklyAlign, vwapSignal, ema5Slope, trendAge) {
  const checks = [
    { name: 'Weekly bias bullish',     pass: weeklyAlign?.signal === 'BULLISH' || weeklyAlign?.signal === 'STRONG BULLISH', pts: 20 },
    { name: 'Daily MA stack bullish',  pass: maStack?.signal === 'BULLISH', pts: 20 },
    { name: 'RSI above 44',            pass: rsiSignal?.above44 === true, pts: 15 },
    { name: 'ADX ≥ 21 (trend exists)', pass: (adxSignal?.adx ?? 0) >= 21, pts: 15 },
    { name: 'Price above VWAP',        pass: vwapSignal?.aboveVwap === true, pts: 15 },
    { name: 'EMA5 slope active',       pass: ema5Slope?.reliable === true, pts: 10 },
    { name: 'Trend not late-cycle',    pass: !trendAge || trendAge.phase !== 'late', pts: 5 },
  ]
  const score = checks.filter(c => c.pass).reduce((s, c) => s + c.pts, 0)
  return { score, checks }
}

// 8. Position Health — multi-indicator exit warning system
function computePositionHealth(rsiSignal, adxSignal, vwapSignal, volumeSpike, ema5Slope) {
  if (!rsiSignal && !adxSignal) return null
  const warns = []
  let score = 100
  const rsi = rsiSignal?.rsi ?? 0
  if (rsi > 70) { warns.push({ icon: '🔴', text: 'RSI overbought — exit risk rising', sev: 'high' }); score -= 20 }
  else if (rsi > 60) { warns.push({ icon: '⚠', text: 'RSI elevated — watch for divergence', sev: 'low' }); score -= 5 }
  if (adxSignal?.adxRising === false && (adxSignal?.adx ?? 0) >= 21) {
    warns.push({ icon: '↘', text: 'ADX rolling over — trend strength fading', sev: 'medium' }); score -= 20
  }
  if ((adxSignal?.adx ?? 21) < 21) {
    warns.push({ icon: '▽', text: 'ADX < 21 — trend losing steam', sev: 'high' }); score -= 25
  }
  if (volumeSpike?.lowVolume === true) {
    warns.push({ icon: '↓', text: 'Volume contracting — conviction fading', sev: 'medium' }); score -= 15
  }
  if (ema5Slope?.label === 'FLAT') {
    warns.push({ icon: '—', text: 'EMA5 flat — momentum stalling', sev: 'medium' }); score -= 15
  }
  if (vwapSignal?.aboveVwap === false) {
    warns.push({ icon: '↓', text: 'Price below VWAP — losing institutional support', sev: 'high' }); score -= 25
  }
  score = Math.max(0, score)
  const h = score >= 80 ? 'HEALTHY' : score >= 60 ? 'CAUTION' : score >= 40 ? 'WEAKENING' : 'EXIT NOW'
  return { score, health: h, warnings: warns }
}

// ── Pattern state ─────────────────────────────────────────────────────────────
function getPatternState(p, currentPrice) {
  if (!p) return 'FORMING'
  if (!p.confirmed || currentPrice == null) return 'FORMING'
  const { neckline, target } = p
  const isTop = p.type === 'DOUBLE TOP' || p.type === 'HEAD & SHOULDERS'
  const zone  = neckline * 0.02
  if (isTop) {
    if (currentPrice > neckline + zone) return 'FAILED'
    if (currentPrice > neckline - zone) return 'NECKLINE_RETEST'
    if (currentPrice <= target)         return 'TARGET_REACHED'
    return 'ACTIVE'
  } else {
    if (currentPrice < neckline - zone) return 'FAILED'
    if (currentPrice < neckline + zone) return 'NECKLINE_RETEST'
    if (currentPrice >= target)         return 'TARGET_REACHED'
    return 'ACTIVE'
  }
}

function patternStateStyle(state) {
  switch (state) {
    case 'NECKLINE_RETEST': return { color: '#f59e0b', bg: '#1a1000', border: '#4d3000', label: '⚡ RE-ENTRY ZONE' }
    case 'TARGET_REACHED':  return { color: '#10b981', bg: '#011c10', border: '#065f46', label: '✓ TARGET HIT' }
    case 'FAILED':          return { color: '#ef4444', bg: '#1c0101', border: '#7f1d1d', label: '✗ FAILED' }
    case 'ACTIVE':          return { color: '#4a90c4', bg: '#04182e', border: '#1e3d5c', label: '↠ IN PLAY' }
    default:                return { color: '#f59e0b', bg: '#1a1000', border: '#4d3000', label: '⋯ FORMING' }
  }
}

function getPatternAction(state, isTop, neckline, target) {
  const neck = `$${fmt(neckline)}`
  const tgt  = `$${fmt(target)}`
  switch (state) {
    case 'FORMING':
      return isTop
        ? { text: `Wait — watch for close below ${neck}`, sub: 'Neckline not broken yet · do not enter early', color: '#f59e0b' }
        : { text: `Wait — watch for close above ${neck}`, sub: 'Neckline not broken yet · do not enter early', color: '#f59e0b' }
    case 'ACTIVE':
      return isTop
        ? { text: `Enter puts · neckline broke at ${neck}`, sub: `Stop above ${neck} · measured target ${tgt}`, color: '#ef4444' }
        : { text: `Enter calls · neckline broke at ${neck}`, sub: `Stop below ${neck} · measured target ${tgt}`, color: '#10b981' }
    case 'NECKLINE_RETEST':
      return isTop
        ? { text: `Re-entry zone · watch for rejection at ${neck}`, sub: 'Wait for bearish candle off neckline before entering puts', color: '#f59e0b' }
        : { text: `Re-entry zone · watch for bounce off ${neck}`, sub: 'Wait for bullish candle off neckline before entering calls', color: '#f59e0b' }
    case 'TARGET_REACHED':
      return { text: `Target hit at ${tgt} · take profit`, sub: 'Full exit or trail stop tight to lock in gains', color: '#10b981' }
    case 'FAILED':
      return isTop
        ? { text: 'Pattern failed · exit immediately', sub: `Price reclaimed ${neck} from above · pattern invalidated`, color: '#ef4444' }
        : { text: 'Pattern failed · exit immediately', sub: `Price reclaimed ${neck} from below · pattern invalidated`, color: '#ef4444' }
    default:
      return null
  }
}

// ── Action banner ─────────────────────────────────────────────────────────────
const ACTION_MAP = {
  'LONG-A+': { text: 'Buy calls · Full size',              sub: 'All systems go — max conviction' },
  'LONG-A':  { text: 'Buy calls · Half size',              sub: 'Strong setup — scale in carefully' },
  'LONG-B':  { text: 'Wait · More confirmation needed',    sub: 'Bias is long but not enough aligned yet' },
  'LONG-C':  { text: 'Skip · Stay in cash',                sub: 'Too many conflicts — no trade' },
  'EXIT-A+': { text: 'Close longs + Buy puts · Full size', sub: 'High conviction reversal — flip bearish' },
  'EXIT-A':  { text: 'Close longs + Small puts · Half size', sub: 'Exit confirmed — small put position' },
  'EXIT-B':  { text: 'Trim longs · Don\'t flip yet',       sub: 'Reduce exposure — not strong enough to short' },
  'EXIT-C':  { text: 'Watch only · Weak exit signal',      sub: 'Hold and monitor — signal is thin' },
}

function ActionBanner({ signal, grade }) {
  if (!signal || !grade) return null
  const key    = `${signal}-${grade.grade}`
  const action = ACTION_MAP[key]
  if (!action) return null
  return (
    <div className="swing-action-banner" style={{ background: grade.bg, borderColor: grade.border }}>
      <div className="action-banner-label">PLAY IT LIKE THIS</div>
      <div className="action-banner-text" style={{ color: grade.color }}>{action.text}</div>
      <div className="action-banner-sub">{action.sub}</div>
    </div>
  )
}

// ── VIX warning ───────────────────────────────────────────────────────────────
function VixBanner({ vix }) {
  if (!vix || vix.level === 'NORMAL' || vix.level === 'LOW') return null
  const isHigh  = vix.level === 'HIGH' || vix.level === 'EXTREME'
  const color   = isHigh ? '#ef4444' : '#f59e0b'
  const bg      = isHigh ? '#1c0101' : '#1a1000'
  const border  = isHigh ? '#7f1d1d' : '#4d3000'
  const msg = vix.level === 'EXTREME' ? 'Options extremely expensive — use spreads, not naked longs'
    : vix.level === 'HIGH' ? 'Options expensive — reduce position size or use spreads'
    : 'IV elevated — watch premium cost on entries'
  return (
    <div className="vix-banner" style={{ background: bg, borderColor: border }}>
      <span className="vix-banner-val" style={{ color }}>⚡ VIX {vix.current} · {vix.level}</span>
      <span className="vix-banner-msg">{msg}</span>
    </div>
  )
}

// ── IV Rank strip ─────────────────────────────────────────────────────────────
function IvRankStrip({ data }) {
  if (!data) return null
  const { atmIV, ivRank, ivPct, samples } = data
  let verdict, vColor, vBg, vBord
  if (ivRank == null || samples < 5) {
    verdict = 'BUILDING IV HISTORY'; vColor = '#4a6380'; vBg = '#0f1623'; vBord = '#1e2d45'
  } else if (ivRank < 25) {
    verdict = 'OPTIONS CHEAP · BUY PREMIUM'; vColor = '#10b981'; vBg = '#011c10'; vBord = '#065f46'
  } else if (ivRank < 50) {
    verdict = 'IV NORMAL'; vColor = '#4a90c4'; vBg = '#04182e'; vBord = '#1e3d5c'
  } else if (ivRank < 75) {
    verdict = 'IV ELEVATED · SIZE DOWN'; vColor = '#f59e0b'; vBg = '#1a1000'; vBord = '#4d3000'
  } else {
    verdict = 'OPTIONS EXPENSIVE · USE SPREADS'; vColor = '#ef4444'; vBg = '#1c0101'; vBord = '#7f1d1d'
  }
  return (
    <div className="iv-strip" style={{ borderColor: vBord, background: vBg }}>
      <div className="iv-strip-main">
        <span className="iv-strip-label">IV RANK</span>
        <span className="iv-strip-rank" style={{ color: vColor }}>{ivRank != null ? ivRank : '—'}</span>
        <span className="iv-strip-atm">ATM {atmIV}%</span>
        {ivPct != null && <span className="iv-strip-pct">· {ivPct}th pct</span>}
        <span className="iv-strip-verdict" style={{ color: vColor }}>{verdict}</span>
      </div>
      {samples > 0 && samples < 30 && (
        <div className="iv-strip-samples">{samples} day{samples !== 1 ? 's' : ''} of history — needs 30+ for accuracy</div>
      )}
    </div>
  )
}

// ── RSI compact card ──────────────────────────────────────────────────────────
function RsiCard({ data, volumeSpike }) {
  const { rsi, ema20, signal, triggers, aboveEma, above44, below43 } = data
  const MIN = 30, MAX = 80
  const pct    = v => `${Math.min(Math.max(((v - MIN) / (MAX - MIN)) * 100, 0), 100)}%`
  const color  = signal === 'BULLISH' ? '#10b981' : signal === 'BEARISH' ? '#ef4444' : '#6b7280'
  const bg     = signal === 'BULLISH' ? '#011c10' : signal === 'BEARISH' ? '#1c0101' : '#0f1623'
  const border = signal === 'BULLISH' ? '#065f46' : signal === 'BEARISH' ? '#7f1d1d' : '#1e2d45'
  const hasCross = triggers.length > 0
  const ctx = aboveEma && above44 ? 'Above 44 & EMA ✓' : below43 ? 'Below 43' : aboveEma ? 'Above EMA · watch 44' : 'Below EMA · watch 43'
  return (
    <div className="sc-card">
      <div className="sc-head">
        <span className="sc-name" data-tip="RSI (Relative Strength Index): Measures buying vs. selling pressure on a 0–100 scale. Above 44 = buyers in control. Below 43 = sellers. The EMA(20) line is a signal line — when RSI crosses above it, momentum is shifting bullish.">RSI 14</span>
        <span className="sc-badge" style={{ color, background: bg, borderColor: border }}>{signal}</span>
      </div>
      <div className="sc-big" style={{ color }}>{rsi.toFixed(1)}</div>
      <div className="sc-sub">EMA {ema20.toFixed(1)}</div>
      <div className="sc-gauge-track">
        <div className="sc-gauge-zone" style={{ left: pct(43), width: `calc(${pct(44)} - ${pct(43)})` }} />
        <div className="sc-gauge-ema"  style={{ left: pct(ema20) }} />
        <div className="sc-gauge-pip"  style={{ left: pct(rsi), background: color }} />
      </div>
      <div className="sc-alert-line" style={{ color: hasCross ? color : '#3a4d60' }}>
        {hasCross ? `${signal === 'BULLISH' ? '↑' : '↓'} ${triggers[0]}` : ctx}
      </div>
      {volumeSpike && (
        <div className="sc-vol" style={{ color: volumeSpike.spike ? '#f59e0b' : volumeSpike.lowVolume ? '#4a6380' : '#3a4d60' }}>
          {volumeSpike.spike ? `⚡ ${volumeSpike.ratio}× vol` : volumeSpike.lowVolume ? `↓ ${volumeSpike.ratio}× vol` : `vol ${volumeSpike.ratio}×`}
        </div>
      )}
    </div>
  )
}

// ── VWAP 2-bar cross card ──────────────────────────────────────────────────────
function VwapCrossCard({ data }) {
  const { crossAbove, crossBelow, aboveVwap, vwap, pctFrom, period } = data
  const hasCross  = crossAbove || crossBelow
  const signal    = crossAbove ? 'BULLISH' : crossBelow ? 'BEARISH' : aboveVwap ? 'ABOVE' : 'BELOW'
  const color     = crossAbove ? '#10b981' : crossBelow ? '#ef4444' : aboveVwap ? '#4a90c4' : '#6b7280'
  const bg        = crossAbove ? '#011c10' : crossBelow ? '#1c0101' : aboveVwap ? '#04182e' : '#0f1623'
  const border    = crossAbove ? '#065f46' : crossBelow ? '#7f1d1d' : aboveVwap ? '#1e3d5c' : '#1e2d45'
  const pctSign   = pctFrom >= 0 ? '+' : ''
  return (
    <div className="sc-card">
      <div className="sc-head">
        <span className="sc-name" data-tip="VWAP (Volume Weighted Average Price): The average price weighted by volume — the 'fair price' institutions use as a benchmark. Price above VWAP = buyers willing to pay up. Below = sellers pushing it down. A 2-bar cross signals a momentum shift.">VWAP {period}D</span>
        <span className="sc-badge" style={{ color, background: bg, borderColor: border }}>{signal}</span>
      </div>
      <div className="sc-big" style={{ color }}>{aboveVwap ? '↑' : '↓'}</div>
      <div className="sc-sub">${fmt(vwap)}</div>
      <div className="sc-alert-line" style={{ color: hasCross ? color : '#3a4d60' }}>
        {hasCross
          ? `${crossAbove ? '↑' : '↓'} 2 bars ${crossAbove ? 'above' : 'below'}`
          : `${pctSign}${pctFrom.toFixed(2)}% from VWAP`}
      </div>
    </div>
  )
}

// ── ADX panel ─────────────────────────────────────────────────────────────────
function AdxPanel({ data }) {
  const { adx, plusDI, minusDI, adxRising, adxSlope } = data
  const trending = adx >= 21
  const isBull   = trending && plusDI  >= 21
  const isBear   = trending && minusDI >= 21
  const signal   = isBull ? 'BULL' : isBear ? 'BEAR' : 'WEAK'
  const color    = isBull ? '#10b981' : isBear ? '#ef4444' : '#6b7280'
  const bg       = isBull ? '#011c10' : isBear ? '#1c0101' : '#0f1623'
  const border   = isBull ? '#065f46' : isBear ? '#7f1d1d' : '#1e2d45'
  const strength = adx >= 50 ? 'EXTREME' : adx >= 36 ? 'STRONG' : adx >= 28 ? 'TRENDING' : adx >= 21 ? 'MILD' : adx >= 15 ? 'WEAK' : 'NO TREND'
  const strengthColor = adx >= 36 ? '#10b981' : adx >= 28 ? '#4a90c4' : adx >= 21 ? '#f59e0b' : '#6b7280'
  const BAR_MAX = 60
  const ValRow = ({ label, val, above, barColor, checkColor, tip }) => (
    <div className="adx-val-row">
      <span className="adx-val-lbl" style={{ color: barColor }} data-tip={tip || undefined}>{label}</span>
      <span className="adx-val-num" style={{ color: above ? barColor : '#4a6380' }}>{val.toFixed(1)}</span>
      <div className="adx-val-track">
        <div className="adx-val-fill" style={{ width: `${Math.min(val, BAR_MAX) / BAR_MAX * 100}%`, background: barColor, opacity: above ? 1 : 0.35 }} />
        <div className="adx-val-21" />
      </div>
      <span className="adx-val-check" style={{ color: above ? checkColor : '#2a3d59' }}>
        {above ? `≥21 ✓` : val < 21 ? `${val.toFixed(1)} ✗` : '—'}
      </span>
    </div>
  )
  return (
    <div className="swing-adx-panel">
      <div className="adx-panel-head">
        <span className="adx-panel-title" data-tip="ADX (Average Directional Index): Measures how strong a trend is — not the direction, just the strength. Our rule: ADX must be 21 or above before we trust a trend signal. Below 21 = the stock is chopping sideways, not trending. Above 36 = strong trend, hold with conviction.">ADX · 21 SAVAGE</span>
        <span className="adx-panel-badge" style={{ color, background: bg, borderColor: border }}>{signal}</span>
        <span className="adx-panel-strength" style={{ color: strengthColor }}>{strength}</span>
        <span className="adx-panel-slope" style={{ color: adxRising ? '#10b981' : '#ef4444' }}>
          {adxRising ? '↑ rising' : '↓ fading'}
          {adxSlope != null && <span className="adx-slope-delta"> ({adxSlope > 0 ? '+' : ''}{adxSlope})</span>}
        </span>
      </div>
      <div className="adx-val-rows">
        <ValRow label="ADX" val={adx}     above={trending} barColor={trending ? '#4a90c4' : '#3a4d60'} checkColor="#4a90c4" tip="ADX strength: 21+ = real trend, 28+ = trending well, 36+ = strong, 50+ = extreme momentum. Below 21 = no trend — stay flat." />
        <ValRow label="+DI" val={plusDI}  above={plusDI  >= 21} barColor={isBull ? '#10b981' : plusDI  >= 21 ? '#34d399' : '#3a5c48'} checkColor="#10b981" tip="+DI (Plus Directional Indicator): Measures the strength of upward moves. Above 21 = buyers are actively pushing price higher. When +DI is above −DI with ADX ≥ 21, the uptrend is confirmed." />
        <ValRow label="−DI" val={minusDI} above={minusDI >= 21} barColor={isBear ? '#ef4444' : minusDI >= 21 ? '#f87171' : '#5c3a3a'} checkColor="#ef4444" tip="−DI (Minus Directional Indicator): Measures the strength of downward moves. Above 21 = sellers are actively pushing price lower. When −DI is above +DI with ADX ≥ 21, the downtrend is confirmed." />
      </div>
      <div className="adx-panel-verdict" style={{ color: (isBull || isBear) ? color : '#3a4d60' }}>
        {isBull  ? '↑ ADX≥21 & +DI≥21 — uptrend confirmed'
        : isBear ? '↓ ADX≥21 & −DI≥21 — downtrend confirmed'
        : trending ? 'ADX≥21 but DI gap too small — wait'
        : 'ADX<21 · no trend · stay out'}
      </div>
    </div>
  )
}

// ── Relative Strength strip ────────────────────────────────────────────────────
function RsStrip({ data }) {
  const { rs, rsShort, tickerReturn, spyReturn, signal } = data
  const isStrong = signal === 'STRONG BULL' || signal === 'STRONG BEAR'
  const isBull   = signal === 'STRONG BULL' || signal === 'BULL'
  const color    = isBull ? '#10b981' : signal === 'NEUTRAL' ? '#6b7280' : '#ef4444'
  const bg       = isBull ? '#011c10' : signal === 'NEUTRAL' ? '#0f1623' : '#1c0101'
  const border   = isBull ? '#065f46' : signal === 'NEUTRAL' ? '#1e2d45' : '#7f1d1d'
  return (
    <div className="swing-rs-strip">
      <div className="rs-strip-main">
        <span className="rs-strip-label" data-tip="Relative Strength vs SPY: How much this stock has outperformed (positive) or underperformed (negative) the S&P 500 over 20 days. Stocks with strong RS tend to keep leading — institutions are picking this stock over the market average.">RS vs SPY · 20D</span>
        <span className="rs-strip-badge" style={{ color, background: bg, borderColor: border }}>
          {isStrong ? '★ ' : ''}{signal}
        </span>
        <span className="rs-strip-score" style={{ color }}>{rs >= 0 ? '+' : ''}{rs}%</span>
      </div>
      <div className="rs-strip-sub">
        <span>Ticker {tickerReturn >= 0 ? '+' : ''}{tickerReturn}%</span>
        <span className="rs-sep">vs</span>
        <span>SPY {spyReturn >= 0 ? '+' : ''}{spyReturn}%</span>
        {isStrong && <span className="rs-edge" style={{ color }}>· {isBull ? 'institutions accumulating' : 'smart money distributing'}</span>}
      </div>
    </div>
  )
}

// ── Sector RS strip ───────────────────────────────────────────────────────────
function SectorRsStrip({ data }) {
  if (!data || !data.stockVsSector) return null
  const { stockVsSector, sectorVsSpy, etf, sector } = data
  const svsColor = stockVsSector.signal.includes('BULL') ? '#10b981' : stockVsSector.signal.includes('BEAR') ? '#ef4444' : '#6b7280'
  const spyColor = sectorVsSpy?.signal?.includes('BULL') ? '#10b981' : sectorVsSpy?.signal?.includes('BEAR') ? '#ef4444' : '#6b7280'
  const bothBull = stockVsSector.signal.includes('BULL') && sectorVsSpy?.signal?.includes('BULL')
  const bothBear = stockVsSector.signal.includes('BEAR') && sectorVsSpy?.signal?.includes('BEAR')
  const verdict  = bothBull ? 'SECTOR MOMENTUM' : bothBear ? 'SECTOR WEAKNESS' : 'MIXED'
  const verdColor = bothBull ? '#10b981' : bothBear ? '#ef4444' : '#f59e0b'
  return (
    <div className="sector-strip">
      <div className="sector-strip-main">
        <span className="sector-strip-label" data-tip="Sector Relative Strength: Is this stock beating its sector ETF, and is the sector beating SPY? A stock outperforming its sector while the sector outperforms SPY = double confirmation that institutional money is rotating into exactly this space.">SECTOR RS</span>
        {sector && <span className="sector-strip-sector">{sector}</span>}
        <span className="sector-strip-verdict" style={{ color: verdColor }}>{verdict}</span>
      </div>
      <div className="sector-strip-rows">
        <div className="sector-row">
          <span className="sector-row-label">Stock vs {etf}</span>
          <span className="sector-row-rs" style={{ color: svsColor }}>{stockVsSector.rs >= 0 ? '+' : ''}{stockVsSector.rs}%</span>
          <span className="sector-row-sig" style={{ color: svsColor }}>{stockVsSector.signal}</span>
        </div>
        {sectorVsSpy && (
          <div className="sector-row">
            <span className="sector-row-label">{etf} vs SPY</span>
            <span className="sector-row-rs" style={{ color: spyColor }}>{sectorVsSpy.rs >= 0 ? '+' : ''}{sectorVsSpy.rs}%</span>
            <span className="sector-row-sig" style={{ color: spyColor }}>{sectorVsSpy.signal}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── VWAP strip ────────────────────────────────────────────────────────────────
function VwapStrip({ data, volumeSpike }) {
  const { vwap, pctFrom, crossAbove, crossBelow, aboveVwap, period } = data
  const hasCross   = crossAbove || crossBelow
  const posColor   = aboveVwap  ? '#10b981' : '#ef4444'
  const crossColor = crossAbove ? '#10b981' : '#ef4444'
  const crossBg    = crossAbove ? '#011c10' : '#1c0101'
  const crossBord  = crossAbove ? '#065f46' : '#7f1d1d'
  const pctSign    = pctFrom >= 0 ? '+' : ''
  return (
    <div className="swing-vwap-strip">
      <div className="vwap-strip-main">
        <span className="vwap-strip-label" data-tip="VWAP (Volume Weighted Average Price): The rolling 20-day average price, weighted by volume. Institutions use VWAP as a benchmark — if they're buying above it, they're paying up, meaning they believe more upside is coming. 2 daily closes above = buyers have taken control.">VWAP {period}D</span>
        <span className="vwap-strip-price">${fmt(vwap)}</span>
        <span className="vwap-strip-pct" style={{ color: posColor }}>{pctSign}{pctFrom.toFixed(2)}%</span>
        {volumeSpike?.spike && <span className="vwap-vol-flag">⚡ {volumeSpike.ratio}× vol</span>}
        <span className="vwap-strip-pos" style={{ color: posColor }}>{aboveVwap ? '↑ ABOVE' : '↓ BELOW'}</span>
      </div>
      {hasCross && (
        <div className="vwap-strip-alert" style={{ background: crossBg, borderColor: crossBord }}>
          <span style={{ color: crossColor, fontWeight: 800 }}>
            {crossAbove ? '↑ BUYERS STEPPING IN' : '↓ SELLERS STEPPING IN'}
          </span>
          <span className="vwap-strip-alert-desc">
            · 2 bars closed {crossAbove ? 'above' : 'below'} VWAP
            {volumeSpike?.spike ? ` · confirmed on ${volumeSpike.ratio}× volume` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

// ── MA Stack · S&R Ladder ────────────────────────────────────────────────────
const MA_META = {
  200: { color: '#d4a017', label: 'EMA 200' },
  65:  { color: '#4a90c4', label: 'EMA 65'  },
  30:  { color: '#f59e0b', label: 'EMA 30'  },
  15:  { color: '#8b7cf8', label: 'EMA 15'  },
  5:   { color: '#6b7280', label: 'EMA 5'   },
}

function MaStackPanel({ data, currentPrice: cpProp }) {
  const { mas, bullCount, validCount, signal, goldenState, crossType, crossBarsAgo, ema200, ema65, emaSeparation } = data
  const sigColor = signal === 'BULLISH' ? '#10b981' : signal === 'BEARISH' ? '#ef4444' : '#6b7280'
  const sigBg    = signal === 'BULLISH' ? '#011c10' : signal === 'BEARISH' ? '#1c0101' : '#0f1623'
  const sigBord  = signal === 'BULLISH' ? '#065f46' : signal === 'BEARISH' ? '#7f1d1d' : '#1e2d45'

  const valid   = mas.filter(m => m.val != null)
  // Derive current price from first valid MA if not passed directly
  const cp      = cpProp ?? (valid.length > 0 ? valid[0].val * (1 + valid[0].pctFrom / 100) : null)
  // Sort all MAs high → low so the ladder reads top = highest price
  const sorted  = [...valid].sort((a, b) => b.val - a.val)
  const resist  = sorted.filter(m => !m.above)  // price BELOW MA → resistance
  const support = sorted.filter(m => m.above)   // price ABOVE MA → support
  const allBull = resist.length === 0 && support.length > 0
  const allBear = support.length === 0 && resist.length > 0

  return (
    <div className="swing-ma-block">
      <div className="swing-block-title-row">
        <span className="swing-block-title" data-tip="MA Stack: The alignment of 5 EMAs — 8, 15, 30, 65, and 200. When all are stacked in order with price above all of them, the trend is clean and institutional. The 30 EMA is the midfield — above it, bulls own the range. Below it, bears do. Mixed EMAs = choppy, conflicted trend.">MA Stack · Support &amp; Resistance</span>
        <div className="ma-header-right">
          <span className="ma-above-count" style={{ color: sigColor }}>{bullCount}/{validCount}</span>
          <span className="ma-badge" style={{ color: sigColor, background: sigBg, borderColor: sigBord }}>{signal}</span>
        </div>
      </div>

      {(allBull || allBear) && (
        <div className="ma-stack-verdict" style={{ color: sigColor, background: sigBg, borderColor: sigBord }}>
          {allBull ? '↑ FULLY STACKED BULL — all MAs are support' : '↓ FULLY STACKED BEAR — all MAs are resistance'}
        </div>
      )}

      <div className="ma-sr-ladder">
        {resist.length > 0 && (
          <div className="ma-sr-zone ma-resist-zone">
            <div className="ma-sr-zone-lbl">RESISTANCE ↑</div>
            {resist.map((ma, i) => {
              const meta    = MA_META[ma.period]
              const nearest = i === resist.length - 1
              return (
                <div key={ma.period} className={`ma-sr-row${nearest ? ' ma-sr-nearest ma-sr-nearest-resist' : ''}`}>
                  <span className="ma-sr-period" style={{ color: meta.color }}>{meta.label}</span>
                  <span className="ma-sr-price">${fmt(ma.val)}</span>
                  <span className="ma-sr-dist" style={{ color: '#ef4444' }}>+{Math.abs(ma.pctFrom).toFixed(1)}%</span>
                  {nearest && <span className="ma-sr-tag">nearest</span>}
                </div>
              )
            })}
          </div>
        )}

        {cp != null && (
          <div className="ma-price-anchor">
            <div className="ma-price-anchor-line" />
            <span className="ma-price-anchor-val">${fmt(cp)}</span>
            <span className="ma-price-anchor-lbl">NOW</span>
            <div className="ma-price-anchor-line" />
          </div>
        )}

        {support.length > 0 && (
          <div className="ma-sr-zone ma-support-zone">
            <div className="ma-sr-zone-lbl">SUPPORT ↓</div>
            {support.map((ma, i) => {
              const meta    = MA_META[ma.period]
              const nearest = i === 0
              return (
                <div key={ma.period} className={`ma-sr-row${nearest ? ' ma-sr-nearest ma-sr-nearest-support' : ''}`}>
                  <span className="ma-sr-period" style={{ color: meta.color }}>{meta.label}</span>
                  <span className="ma-sr-price">${fmt(ma.val)}</span>
                  <span className="ma-sr-dist" style={{ color: '#10b981' }}>-{ma.pctFrom.toFixed(1)}%</span>
                  {nearest && <span className="ma-sr-tag">nearest</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Golden / Death Cross ── */}
      {goldenState !== null && ema200 != null && ema65 != null && (
        <>
          <div className="ma-cross-divider" />
          <div className="ma-cross-section">
            <div className="ma-cross-head">
              <span className="ma-cross-label">200 / 65 CROSS</span>
              <span
                className="ma-cross-badge"
                style={{
                  color:       goldenState ? '#10b981' : '#ef4444',
                  background:  goldenState ? '#011c10' : '#1c0101',
                  borderColor: goldenState ? '#065f46' : '#7f1d1d',
                }}
                data-tip={goldenState
                  ? 'Golden Cross: The 65 EMA crossed above the 200 EMA — a major long-term signal that a downtrend has ended and an uptrend is starting. Institutional money tends to flow in after this cross.'
                  : 'Death Cross: The 65 EMA crossed below the 200 EMA — a major long-term warning that an uptrend has ended and a downtrend is beginning. Institutional selling often accelerates after this cross.'}
              >
                {goldenState ? '↑ GOLDEN' : '↓ DEATH'}
              </span>
              {emaSeparation != null && (
                <span className="ma-cross-gap" style={{ color: goldenState ? '#10b981' : '#ef4444' }}>
                  {Math.abs(emaSeparation).toFixed(1)}% gap
                </span>
              )}
            </div>
            <div className="ma-cross-levels">
              <span className="ma-cross-ma-lbl" style={{ color: '#d4a017' }}>EMA 200</span>
              <span className="ma-cross-ma-val">${fmt(ema200)}</span>
              <span className="ma-cross-vs" style={{ color: goldenState ? '#10b981' : '#ef4444' }}>
                {goldenState ? '<' : '>'}
              </span>
              <span className="ma-cross-ma-lbl" style={{ color: '#4a90c4' }}>EMA 65</span>
              <span className="ma-cross-ma-val">${fmt(ema65)}</span>
            </div>
            {crossType != null && crossBarsAgo != null && (
              <div
                className="ma-cross-recency"
                style={{ color: crossBarsAgo <= 30 ? (crossType === 'golden' ? '#10b981' : '#ef4444') : '#4a6380' }}
              >
                {crossBarsAgo === 0
                  ? `⚡ ${crossType === 'golden' ? 'Golden' : 'Death'} cross happened today`
                  : crossBarsAgo <= 30
                    ? `⚡ ${crossType === 'golden' ? 'Golden' : 'Death'} cross ${crossBarsAgo}d ago — ${crossType === 'golden' ? 'trend just turned bull' : 'trend just turned bear'}`
                    : `Last ${crossType === 'golden' ? 'golden' : 'death'} cross ${crossBarsAgo}d ago`
                }
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Weekly alignment strip ────────────────────────────────────────────────────
function WeeklyAlignStrip({ data }) {
  if (!data) return null
  const { signal, ema5, ema15, weekTrend, pctFromEma5, pctFromEma15, year52H, year52L, pctFrom52H, pctFrom52L } = data
  const sigColor = signal === 'BULLISH' ? '#10b981' : signal === 'BEARISH' ? '#ef4444' : '#f59e0b'
  const sigBg    = signal === 'BULLISH' ? '#011c10' : signal === 'BEARISH' ? '#1c0101' : '#1a1000'
  const sigBord  = signal === 'BULLISH' ? '#065f46' : signal === 'BEARISH' ? '#7f1d1d' : '#4d3000'
  return (
    <div className="weekly-strip">
      <div className="weekly-strip-main">
        <span className="weekly-strip-label" data-tip="Weekly Bias: The highest-timeframe direction signal. This is Gate 1 — if the weekly is bearish, you don't take call entries no matter what the daily shows. The weekly trend represents the biggest institutional money flows. Trading with it puts the wind at your back.">WEEKLY BIAS</span>
        <span className="weekly-strip-sig" style={{ color: sigColor, background: sigBg, borderColor: sigBord }}>
          {weekTrend === 'UP' ? '↑' : '↓'} {signal}
        </span>
        <span className="weekly-strip-ema">
          <span style={{ color: '#8b7cf8' }}>W5</span> ${fmt(ema5)}
          <span style={{ color: pctFromEma5 >= 0 ? '#10b981' : '#ef4444' }}> {pctFromEma5 > 0 ? '+' : ''}{pctFromEma5}%</span>
        </span>
        <span className="weekly-strip-ema">
          <span style={{ color: '#d4a017' }}>W15</span> ${fmt(ema15)}
          <span style={{ color: pctFromEma15 >= 0 ? '#10b981' : '#ef4444' }}> {pctFromEma15 > 0 ? '+' : ''}{pctFromEma15}%</span>
        </span>
      </div>
      <div className="weekly-strip-range">
        <span>52W H ${fmt(year52H)} <span style={{ color: '#ef4444' }}>{pctFrom52H}%</span></span>
        <span className="weekly-range-sep">·</span>
        <span>52W L ${fmt(year52L)} <span style={{ color: '#10b981' }}>+{Math.abs(pctFrom52L)}%</span></span>
      </div>
    </div>
  )
}

// ── Double Bottom Guide ───────────────────────────────────────────────────────
const BOTTOM_GUIDE = [
  { key: 'isBigW',     label: 'Big W',      shape: 'Unusually tall left-side descent into twin bottoms', rank: '11/39', rise: 46,   fail: 9,  target: 74, pullback: 64, color: '#34d399', bg: '#011c10', bord: '#047857', note: 'Left-side descent ≥15% before Bottom 1 · works in bull & bear markets' },
  { key: 'isAdamAdam', label: 'Adam & Adam', shape: 'Both bottoms narrow, V-shaped spikes',               rank: '26/39', rise: 39,   fail: 16, target: 73, pullback: 67, color: '#fbbf24', bg: '#1a1000', bord: '#92400e', note: 'Bull market data only' },
  { key: 'isAdamEve',  label: 'Adam & Eve',  shape: 'Left narrow spike + right wide rounded valley',      rank: '17/39', rise: 43,   fail: 12, target: 69, pullback: 67, color: '#a78bfa', bg: '#130d1f', bord: '#5b21b6', note: 'Bull market data only' },
  { key: 'isEveAdam',  label: 'Eve & Adam',  shape: 'Left wide rounded valley + right narrow spike',      rank: '20/39', rise: 42,   fail: 12, target: 72, pullback: 67, color: '#fb7185', bg: '#1f0a0d', bord: '#9f1239', note: 'Bull market data only' },
  { key: 'isEveEve',   label: 'Eve & Eve',   shape: 'Both bottoms wide, rounded accumulation valleys',    rank: '5/39',  rise: 50,   fail: 12, target: 65, pullback: 65, color: '#38bdf8', bg: '#041420', bord: '#0369a1', note: 'Bull market only · highest avg rise of all double bottom types' },
]

function DoubleBottomGuide({ detected }) {
  return (
    <div className="pat-guide">
      <div className="pat-guide-header-row">
        <span className="pat-guide-title">DOUBLE BOTTOM · PATTERN GUIDE</span>
        <span className="pat-guide-src">Bulkowski · bull market</span>
      </div>
      <div className="pg-col-headers">
        <span className="pgc-name">Type &amp; Shape</span>
        <span className="pgc-num">Rank</span>
        <span className="pgc-num">Avg ↑</span>
        <span className="pgc-num">Target</span>
        <span className="pgc-num">Pullbk</span>
        <span className="pgc-num">Fail</span>
      </div>
      {BOTTOM_GUIDE.map(g => {
        const hit = !!detected?.[g.key]
        return (
          <div key={g.key} className={`pg-row${hit ? ' pg-row-hit' : ''}`} style={hit ? { background: g.bg, borderColor: g.bord } : {}}>
            <div className="pgc-name">
              <span className="pg-type-label" style={{ color: hit ? g.color : '#6b8099' }}>
                {g.label}{hit && <span className="pg-hit-check" style={{ color: g.color }}>✓</span>}
              </span>
              <span className="pg-type-shape">{g.shape}</span>
              {hit && g.note && <span className="pg-type-note">{g.note}</span>}
            </div>
            <span className="pgc-num" style={{ color: hit ? g.color   : '#4a6380' }}>{g.rank}</span>
            <span className="pgc-num" style={{ color: hit ? '#10b981' : '#4a6380' }}>+{g.rise}%</span>
            <span className="pgc-num" style={{ color: hit ? '#10b981' : '#4a6380' }}>{g.target}%</span>
            <span className="pgc-num" style={{ color: hit ? '#a0b4c8' : '#3a4d60' }}>{g.pullback}%</span>
            <span className="pgc-num" style={{ color: hit ? '#f59e0b' : '#3a4d60' }}>{g.fail}%</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Double Top Guide ──────────────────────────────────────────────────────────
const TOP_GUIDE = [
  { key: 'isBigM',        label: 'Big M',      shape: 'Two peaks near same price — unusually tall left-side ascent', rank: '8/36', drop: 17, bearDrop: 22, fail: 14, target: 55, pullback: 67, color: '#f97316', bg: '#1a0500', bord: '#9a3412', note: 'Bear mkt: rank 10/19 · avg drop −22% · bearish reversal valid in both bull & bear markets' },
  { key: 'isAdamEveTop',  label: 'Adam & Eve',  shape: 'Left narrow spike (Adam) + right wide rounded peak (Eve)',   rank: '10/36', drop: 16, fail: 21, target: 54, pullback: 64, color: '#fb923c', bg: '#1a0800', bord: '#c2410c', note: 'Bull market data only · short-term bearish reversal' },
  { key: 'isEveAdamTop',  label: 'Eve & Adam',  shape: 'Left wide rounded peak (Eve) + right narrow spike (Adam)',   rank: '16/36', drop: 15, fail: 21, target: 55, pullback: 64, color: '#f87171', bg: '#1c0202', bord: '#991b1b', note: 'Bull market only · vol trends UP (unusual) · short-term bearish reversal' },
  { key: 'isAdamAdamTop', label: 'Adam & Adam', shape: 'Both peaks narrow, pointed spikes',                          rank: '19/36', drop: 15, fail: 25, target: 64, pullback: 64, color: '#fbbf24', bg: '#1a1000', bord: '#92400e', note: 'Bull market data only · short-term bearish reversal' },
  { key: 'isEveEveTop',   label: 'Eve & Eve',   shape: 'Both peaks wide, rounded domes',                             rank: '12/36', drop: 16, fail: 20, target: 43, pullback: 65, color: '#c084fc', bg: '#130820', bord: '#6b21a8', note: 'Bull market only · short-term bearish reversal' },
]

function DoubleTopGuide({ detected }) {
  return (
    <div className="pat-guide pat-top-guide">
      <div className="pat-guide-header-row">
        <span className="pat-guide-title">DOUBLE TOP · PATTERN GUIDE</span>
        <span className="pat-guide-src">Bulkowski · bull market</span>
      </div>
      <div className="pg-col-headers">
        <span className="pgc-name">Type &amp; Shape</span>
        <span className="pgc-num">Rank</span>
        <span className="pgc-num">Avg ↓</span>
        <span className="pgc-num">Target</span>
        <span className="pgc-num">Pullbk</span>
        <span className="pgc-num">Fail</span>
      </div>
      {TOP_GUIDE.map(g => {
        const hit = !!detected?.[g.key]
        return (
          <div key={g.key} className={`pg-row${hit ? ' pg-row-hit' : ''}`} style={hit ? { background: g.bg, borderColor: g.bord } : {}}>
            <div className="pgc-name">
              <span className="pg-type-label" style={{ color: hit ? g.color : '#6b8099' }}>
                {g.label}{hit && <span className="pg-hit-check" style={{ color: g.color }}>✓</span>}
              </span>
              <span className="pg-type-shape">{g.shape}</span>
              {hit && g.note && <span className="pg-type-note">{g.note}</span>}
            </div>
            <span className="pgc-num" style={{ color: hit ? g.color   : '#4a6380' }}>{g.rank}</span>
            <span className="pgc-num">
              {hit && g.bearDrop ? (
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span style={{ color: '#ef4444', fontSize: 9 }}>bull</span>
                  <span style={{ color: '#ef4444' }}>−{g.drop}%</span>
                  <span style={{ color: '#f87171', fontSize: 9, marginTop: 2 }}>bear</span>
                  <span style={{ color: '#f87171' }}>−{g.bearDrop}%</span>
                </span>
              ) : (
                <span style={{ color: hit ? '#ef4444' : '#4a6380' }}>{g.drop != null ? `−${g.drop}%` : '—'}</span>
              )}
            </span>
            <span className="pgc-num" style={{ color: hit ? '#ef4444' : '#4a6380' }}>{g.target != null ? `${g.target}%` : '—'}</span>
            <span className="pgc-num" style={{ color: hit ? '#a0b4c8' : '#3a4d60' }}>{g.pullback != null ? `${g.pullback}%` : '—'}</span>
            <span className="pgc-num" style={{ color: hit ? '#f59e0b' : '#3a4d60' }}>{g.fail != null ? `${g.fail}%` : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Pattern Hero Card ─────────────────────────────────────────────────────────
function PatternHeroCard({ p, currentPrice }) {
  const isTop    = p.type === 'DOUBLE TOP'
  const patColor = isTop ? '#ef4444' : '#10b981'
  const patBord  = isTop ? '#7f1d1d' : '#065f46'
  const state    = getPatternState(p, currentPrice)
  const ss       = patternStateStyle(state)

  const subTypes = []
  if (!isTop) {
    if (p.isBigW)     subTypes.push({ label: 'BIG W',      color: '#34d399', stats: p.bigWStats })
    if (p.isAdamAdam) subTypes.push({ label: 'ADAM & ADAM', color: '#fbbf24', stats: p.adamAdamStats })
    if (p.isAdamEve)  subTypes.push({ label: 'ADAM & EVE',  color: '#a78bfa', stats: p.adamEveStats })
    if (p.isEveAdam)  subTypes.push({ label: 'EVE & ADAM',  color: '#fb7185', stats: p.eveAdamStats })
    if (p.isEveEve)   subTypes.push({ label: 'EVE & EVE',   color: '#38bdf8', stats: p.eveEveStats })
  } else {
    if (p.isBigM)        subTypes.push({ label: 'BIG M',      color: '#f97316', stats: p.bigMStats })
    if (p.isAdamEveTop)  subTypes.push({ label: 'ADAM & EVE', color: '#fb923c', stats: p.topAdamEveStats })
    if (p.isEveAdamTop)  subTypes.push({ label: 'EVE & ADAM', color: '#f87171', stats: p.topEveAdamStats })
    if (p.isAdamAdamTop) subTypes.push({ label: 'ADAM & ADAM', color: '#fbbf24', stats: p.topAdamAdamStats })
    if (p.isEveEveTop)   subTypes.push({ label: 'EVE & EVE',  color: '#c084fc', stats: p.topEveEveStats })
  }

  const primarySub   = subTypes.find(st => st.label !== 'BIG W' && st.label !== 'BIG M') ?? subTypes[0]
  const primaryStats = primarySub?.stats
  const subColor     = primarySub?.color ?? patColor
  const avgMove      = isTop ? primaryStats?.avgDropBull : primaryStats?.avgRiseBull

  // Neckline retest alert
  const isRetest = state === 'NECKLINE_RETEST'

  return (
    <div className="pat-hero" style={{ borderColor: isRetest ? '#f59e0b' : patBord }}>
      {isRetest && (
        <div className="pat-retest-alert">
          ⚡ NECKLINE RETEST — potential re-entry zone. Wait for bounce confirmation before entering.
        </div>
      )}
      <div className="pat-hero-head">
        <span className="pat-hero-icon" style={{ color: patColor }}>{isTop ? 'M' : 'W'}</span>
        <span className="pat-hero-typename" style={{ color: patColor }}
          data-tip={
            p.type === 'DOUBLE BOTTOM'
              ? 'Double Bottom (W): Price tests a low, bounces, retests the same low, then reverses higher. The peak between the two lows is the neckline. A close above the neckline confirms buyers are taking control.'
              : p.type === 'DOUBLE TOP'
              ? 'Double Top (M): Price tests a high, pulls back, retests the same high, then reverses lower. The dip between the two highs is the neckline. A close below the neckline confirms sellers are taking control.'
              : null
          }
        >{p.type}</span>
        <div className="pat-hero-badges">
          {subTypes.map(st => (
            <span key={st.label} className="pat-hero-badge" style={{ color: st.color, background: st.color + '18', borderColor: st.color + '55' }}>
              {st.label}
            </span>
          ))}
        </div>
        <span className="pat-hero-status" style={{ color: ss.color, background: ss.bg, borderColor: ss.border }}>
          {ss.label}
        </span>
      </div>

      {(() => {
        const action = getPatternAction(state, isTop, p.neckline, p.target)
        if (!action) return null
        return (
          <div className="pat-hero-action" style={{ borderColor: action.color + '55', background: action.color + '12' }}>
            <span className="pha-icon" style={{ color: action.color }}>▶</span>
            <div className="pha-body">
              <span className="pha-text" style={{ color: action.color }}>{action.text}</span>
              <span className="pha-sub">{action.sub}</span>
            </div>
          </div>
        )
      })()}

      {primaryStats && (
        <div className="pat-hero-stats">
          <div className="phs-cell">
            <span className="phs-label">RANK</span>
            <span className="phs-val" style={{ color: subColor }}>
              {primaryStats.perfRankBull.rank}<span className="phs-of">/{primaryStats.perfRankBull.of}</span>
            </span>
          </div>
          <div className="phs-divider" />
          <div className="phs-cell">
            <span className="phs-label">{isTop ? 'AVG DROP' : 'AVG RISE'}</span>
            <span className="phs-val" style={{ color: isTop ? '#ef4444' : '#10b981' }}>{isTop ? '−' : '+'}{avgMove}%</span>
          </div>
          <div className="phs-divider" />
          <div className="phs-cell">
            <span className="phs-label">HITS TARGET</span>
            <span className="phs-val">{primaryStats.targetMetBull}%</span>
          </div>
          <div className="phs-divider" />
          <div className="phs-cell">
            <span className="phs-label">FAIL RATE</span>
            <span className="phs-val" style={{ color: '#f59e0b' }}>{primaryStats.failRateBull}%</span>
          </div>
        </div>
      )}

      <div className="pat-hero-levels">
        {isTop ? (
          <>
            <div className="phl-row"><span className="phl-lbl">Peak 1</span><span className="phl-val">${fmt(p.peak1)}</span>{p.peak1Date && <span className="phl-date">{p.peak1Date}</span>}</div>
            <div className="phl-row"><span className="phl-lbl">Peak 2</span><span className="phl-val">${fmt(p.peak2)}</span>{p.peak2Date && <span className="phl-date">{p.peak2Date}</span>}</div>
          </>
        ) : (
          <>
            <div className="phl-row"><span className="phl-lbl">Bottom 1</span><span className="phl-val">${fmt(p.trough1)}</span>{p.trough1Date && <span className="phl-date">{p.trough1Date}</span>}</div>
            <div className="phl-row"><span className="phl-lbl">Bottom 2</span><span className="phl-val">${fmt(p.trough2)}</span>{p.trough2Date && <span className="phl-date">{p.trough2Date}</span>}</div>
          </>
        )}
        <div className="phl-row phl-neck">
          <span className="phl-lbl">Neckline</span>
          <span className="phl-val">${fmt(p.neckline)}</span>
          {p.necklineDate && <span className="phl-date">{p.necklineDate}</span>}
        </div>
        <div className="phl-row phl-tgt">
          <span className="phl-lbl" style={{ color: patColor }}>{isTop ? 'Target ↓' : 'Target ↑'}</span>
          <span className="phl-val" style={{ color: patColor }}>${fmt(p.target)}</span>
          <span className="phl-date" style={{ color: patColor }}>{isTop ? '−' : '+'}{p.targetPct}%</span>
        </div>
      </div>

      <div className="pat-hero-meta">
        <span>Δ {p.priceDiff}% match</span>
        <span className="phmeta-sep">·</span>
        <span>depth {p.depth}%</span>
        <span className="phmeta-sep">·</span>
        <span>{p.barsAgo === 0 ? 'today' : `${p.barsAgo}d ago`}</span>
        <span className="phmeta-sep">·</span>
        <span>score {p.strength}/100</span>
        {p.isBigW && <><span className="phmeta-sep">·</span><span style={{ color: '#34d399' }}>left drop {p.leftSideDropPct}%</span></>}
        {p.isBigM && <><span className="phmeta-sep">·</span><span style={{ color: '#f97316' }}>left rise {p.leftSideRisePct}%</span></>}
      </div>
    </div>
  )
}

// ── H&S Hero Card ─────────────────────────────────────────────────────────────
const HS_STATS  = { perfRank: { rank: 5, of: 36 }, avgDrop: 22, failRate: 27, targetMet: 63 }
const IHS_STATS = { perfRank: { rank: 5, of: 38 }, avgRise: 37, failRate:  4, targetMet: 74 }

function HAndSHeroCard({ p, currentPrice }) {
  const isTop    = p.type === 'HEAD & SHOULDERS'
  const patColor = isTop ? '#ef4444' : '#10b981'
  const patBord  = isTop ? '#7f1d1d' : '#065f46'
  const state    = getPatternState(p, currentPrice)
  const ss       = patternStateStyle(state)
  const stats    = isTop ? HS_STATS : IHS_STATS

  return (
    <div className="pat-hero" style={{ borderColor: patBord }}>
      <div className="pat-hero-head">
        <span className="pat-hero-icon" style={{ color: patColor, fontSize: 12 }}>{isTop ? 'H&S' : 'IHS'}</span>
        <span className="pat-hero-typename" style={{ color: patColor }}
          data-tip={isTop
            ? 'Head & Shoulders: Three peaks — left shoulder, higher head, right shoulder — with a neckline connecting the troughs. A close below the neckline confirms sellers have taken control. One of the most reliable bearish reversals.'
            : 'Inverse Head & Shoulders: Three troughs — left shoulder, lower head, right shoulder. A close above the neckline confirms buyers have stepped in. One of the highest-probability bullish reversal setups.'}
        >{p.type}</span>
        <span className="pat-hero-status" style={{ color: ss.color, background: ss.bg, borderColor: ss.border }}>
          {ss.label}
        </span>
      </div>

      {(() => {
        const action = getPatternAction(state, isTop, p.neckline, p.target)
        if (!action) return null
        return (
          <div className="pat-hero-action" style={{ borderColor: action.color + '55', background: action.color + '12' }}>
            <span className="pha-icon" style={{ color: action.color }}>▶</span>
            <div className="pha-body">
              <span className="pha-text" style={{ color: action.color }}>{action.text}</span>
              <span className="pha-sub">{action.sub}</span>
            </div>
          </div>
        )
      })()}

      <div className="pat-hero-stats">
        <div className="phs-cell">
          <span className="phs-label">RANK</span>
          <span className="phs-val" style={{ color: patColor }}>{stats.perfRank.rank}<span className="phs-of">/{stats.perfRank.of}</span></span>
        </div>
        <div className="phs-divider" />
        <div className="phs-cell">
          <span className="phs-label">{isTop ? 'AVG DROP' : 'AVG RISE'}</span>
          <span className="phs-val" style={{ color: isTop ? '#ef4444' : '#10b981' }}>
            {isTop ? '−' : '+'}{isTop ? stats.avgDrop : stats.avgRise}%
          </span>
        </div>
        <div className="phs-divider" />
        <div className="phs-cell">
          <span className="phs-label">HITS TARGET</span>
          <span className="phs-val">{stats.targetMet}%</span>
        </div>
        <div className="phs-divider" />
        <div className="phs-cell">
          <span className="phs-label">FAIL RATE</span>
          <span className="phs-val" style={{ color: '#f59e0b' }}>{stats.failRate}%</span>
        </div>
      </div>

      <div className="pat-hero-levels">
        <div className="phl-row"><span className="phl-lbl">Left Shoulder</span><span className="phl-val">${fmt(p.leftShoulder)}</span>{p.leftShoulderDate && <span className="phl-date">{p.leftShoulderDate}</span>}</div>
        <div className="phl-row"><span className="phl-lbl">Head</span><span className="phl-val">${fmt(p.head)}</span>{p.headDate && <span className="phl-date">{p.headDate}</span>}</div>
        <div className="phl-row"><span className="phl-lbl">Right Shoulder</span><span className="phl-val">${fmt(p.rightShoulder)}</span>{p.rightShoulderDate && <span className="phl-date">{p.rightShoulderDate}</span>}</div>
        <div className="phl-row phl-neck">
          <span className="phl-lbl">Neckline</span>
          <span className="phl-val">${fmt(p.neckline)}</span>
          {p.necklineDate && <span className="phl-date">{p.necklineDate}</span>}
        </div>
        <div className="phl-row phl-tgt">
          <span className="phl-lbl" style={{ color: patColor }}>{isTop ? 'Target ↓' : 'Target ↑'}</span>
          <span className="phl-val" style={{ color: patColor }}>${fmt(p.target)}</span>
          <span className="phl-date" style={{ color: patColor }}>{isTop ? '−' : '+'}{p.targetPct}%</span>
        </div>
      </div>

      <div className="pat-hero-meta">
        <span>Shoulders Δ {p.shoulderDiff}%</span>
        <span className="phmeta-sep">·</span>
        <span>depth {p.depth}%</span>
        <span className="phmeta-sep">·</span>
        <span>{p.barsAgo === 0 ? 'today' : `${p.barsAgo}d ago`}</span>
        <span className="phmeta-sep">·</span>
        <span>score {p.strength}/100</span>
      </div>
    </div>
  )
}

// ── Continuation Patterns ─────────────────────────────────────────────────────
function ContPatternPanel({ contPatterns }) {
  if (!contPatterns) return null
  const { bullFlag, bearFlag } = contPatterns
  if (!bullFlag && !bearFlag) return null
  const active = [
    bullFlag  && { ...bullFlag,  color: '#10b981', bg: '#011c10', bord: '#065f46' },
    bearFlag  && { ...bearFlag,  color: '#ef4444', bg: '#1c0101', bord: '#7f1d1d' },
  ].filter(Boolean)
  return (
    <div className="cont-panel">
      <div className="cont-panel-title">CONTINUATION PATTERNS</div>
      {active.map(p => (
        <div key={p.type} className="cont-card" style={{ borderColor: p.bord, background: p.bg }}>
          <div className="cont-card-head">
            <span className="cont-card-type" style={{ color: p.color }}
            data-tip={p.type === 'BULL FLAG'
              ? 'Bull Flag: A continuation pattern. Price makes a sharp move up (the pole), then pulls back in a tight, orderly range on declining volume (the flag). A breakout above the flag continues the original move. Target = pole length added to the breakout point.'
              : 'Bear Flag: A continuation pattern. Price drops sharply (the pole), then bounces in a tight, orderly range on declining volume (the flag). A breakdown below the flag continues the original drop. Target = pole length below the breakdown point.'}
          >{p.type}</span>
            <span className="cont-card-score">score {p.score}</span>
          </div>
          <div className="cont-card-stats">
            <span>Pole {p.poleMove}% · {p.poleBars}b</span>
            <span className="cont-sep">·</span>
            <span>Flag {p.consBars}b · {p.consRange}% range</span>
            {p.volDecline && <span className="cont-vol" style={{ color: '#10b981' }}>✓ vol declining</span>}
          </div>
          <div className="cont-card-levels">
            <span>Breakout <strong>${fmt(p.breakoutLevel)}</strong></span>
            <span className="cont-sep">·</span>
            <span>Target <strong style={{ color: p.color }}>${fmt(p.target)}</strong></span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Pattern Panel ─────────────────────────────────────────────────────────────
function PatternPanel({ data, hsPatterns, contPatterns, currentPrice }) {
  const { doubleTop, doubleBottom } = data
  const hasBottom = !!doubleBottom, hasTop = !!doubleTop
  const hasHS  = !!hsPatterns?.headAndShoulders, hasIHS = !!hsPatterns?.inverseHAndS
  const hasBF  = !!contPatterns?.bullFlag,        hasBearF = !!contPatterns?.bearFlag
  const hasAny = hasBottom || hasTop || hasHS || hasIHS

  return (
    <div className="swing-pattern-block">
      <div className="swing-block-title-row">
        <span className="swing-block-title" data-tip="Chart Patterns: Repeating price structures that signal reversals or continuations. Double Bottom (W) and Inverse H&S are bullish reversals. Double Top (M) and H&S are bearish reversals. Bull/Bear Flags are continuation patterns. All are confirmed when price closes beyond the neckline with volume.">Pattern Detection · Daily</span>
        <div className="pat-status-pills">
          {(hasBottom || hasIHS) && <span className="pat-pill pat-pill-bull">▲ BULLISH</span>}
          {(hasTop    || hasHS)  && <span className="pat-pill pat-pill-bear">▼ BEARISH</span>}
          {(hasBF || hasBearF)   && <span className="pat-pill pat-pill-cont">↠ CONT</span>}
          {!hasAny && !hasBF && !hasBearF && <span className="pat-pill pat-pill-none">NONE</span>}
        </div>
      </div>
      {hasBottom && <PatternHeroCard p={doubleBottom} currentPrice={currentPrice} />}
      {hasTop    && <PatternHeroCard p={doubleTop}    currentPrice={currentPrice} />}
      {hasIHS    && <HAndSHeroCard   p={hsPatterns.inverseHAndS}   currentPrice={currentPrice} />}
      {hasHS     && <HAndSHeroCard   p={hsPatterns.headAndShoulders} currentPrice={currentPrice} />}
      {(hasBF || hasBearF) && <ContPatternPanel contPatterns={contPatterns} />}
      {!hasAny && !hasBF && !hasBearF && (
        <div className="pat-none">No reversal patterns detected — chart shows clean structure</div>
      )}
      {hasBottom && <DoubleBottomGuide detected={doubleBottom} />}
      {hasTop    && <DoubleTopGuide    detected={doubleTop}    />}
    </div>
  )
}

// ── Fibonacci ──────────────────────────────────────────────────────────────────
function FibTable({ fib }) {
  const { byPrice, currentZone, currentPrice, peak, trough, isUptrend,
          crossBelow786, crossAbove382, level786, level382, extensions } = fib
  const currentAboveAll = currentPrice > byPrice[0].price
  const currentBelowAll = currentPrice < byPrice[byPrice.length - 1].price
  return (
    <div className="swing-fib-block">
      <div className="swing-block-title-row">
        <span className="swing-block-title" data-tip="Fibonacci Levels: Natural support and resistance zones based on the Golden Ratio. After a move, price commonly retraces to 38.2%, 50%, or 61.8% before continuing. The 78.6% level is the last major support — if it breaks, the trend is likely reversing. Extensions (127.2%, 161.8%) are profit targets beyond the swing.">Fibonacci</span>
        <span className={`fib-dir-tag ${isUptrend ? 'bull' : 'bear'}`}>{isUptrend ? '↑ UP' : '↓ DOWN'}</span>
      </div>
      <div className="fib-range-compact">
        <span>Peak <strong>${fmt(peak)}</strong></span>
        <span className="fib-range-sep">→</span>
        <span>Trough <strong>${fmt(trough)}</strong></span>
      </div>
      {(crossBelow786 || crossAbove382) && (
        <div className="fib-alerts">
          {crossBelow786 && <div className="fib-alert fib-alert-bear"><span>↓</span><div><strong>TRIM / EXIT</strong><span> · 2 bars below 78.6% (${fmt(level786)})</span></div></div>}
          {crossAbove382 && <div className="fib-alert fib-alert-bull"><span>↑</span><div><strong>POSSIBLE ENTRY</strong><span> · 2 bars above 38.2% (${fmt(level382)})</span></div></div>}
        </div>
      )}
      <div className="fib-levels">
        {isUptrend && extensions && extensions.slice().reverse().map(ext => (
          <div key={ext.label} className="fib-row-compact fib-ext">
            <span className="fib-ratio-compact">{ext.label}</span>
            <div className="fib-bar-compact"><div className="fib-bar-fill-compact" style={{ width: '100%' }} /></div>
            <span className="fib-price-compact">${fmt(ext.price)}</span>
            <span className="fib-ext-tag">target</span>
          </div>
        ))}
        {currentAboveAll && <div className="fib-price-marker"><span className="fib-marker-arrow">▶</span><span className="fib-marker-price">${fmt(currentPrice)}</span><span className="fib-marker-label">current</span></div>}
        {byPrice.map((lvl, i) => {
          const isMidfield = lvl.label === '50%', is886 = lvl.label === '88.6%', isKey = lvl.key
          const fillPct = lvl.ratio * 100
          return (
            <div key={lvl.label}>
              <div className={`fib-row-compact ${isMidfield ? 'fib-mid' : is886 ? 'fib-886' : isKey ? 'fib-key' : ''}`}>
                <span className="fib-ratio-compact">{lvl.label}{isMidfield && <span className="fib-mid-tag"> 50yd</span>}</span>
                <div className="fib-bar-compact"><div className="fib-bar-fill-compact" style={{ width: `${fillPct}%` }} /></div>
                <span className="fib-price-compact">${fmt(lvl.price)}</span>
                {isMidfield && <span style={{ fontSize: 11 }}>🏈</span>}
              </div>
              {!currentAboveAll && !currentBelowAll && i === currentZone && (
                <div className="fib-price-marker"><span className="fib-marker-arrow">▶</span><span className="fib-marker-price">${fmt(currentPrice)}</span><span className="fib-marker-label">current</span></div>
              )}
            </div>
          )
        })}
        {currentBelowAll && <div className="fib-price-marker"><span className="fib-marker-arrow">▶</span><span className="fib-marker-price">${fmt(currentPrice)}</span><span className="fib-marker-label">current</span></div>}
        {!isUptrend && extensions && extensions.map(ext => (
          <div key={ext.label} className="fib-row-compact fib-ext">
            <span className="fib-ratio-compact">{ext.label}</span>
            <div className="fib-bar-compact"><div className="fib-bar-fill-compact fib-ext-bar" style={{ width: '100%' }} /></div>
            <span className="fib-price-compact">${fmt(ext.price)}</span>
            <span className="fib-ext-tag">target</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Setup Grade Checklist ─────────────────────────────────────────────────────
function GradeChecklist({ grade }) {
  const { checks, passing, total, pct } = grade
  return (
    <div className="swing-grade-block">
      <div className="swing-block-title-row">
        <span className="swing-block-title" data-tip="Setup Grade (A+/A/B/C): How many swing entry conditions are passing right now. A+ (80%+) = all signals stacked = full position size. A (65%+) = half size. B (50%+) = wait for one more confirmation. C (below 50%) = the setup isn't ready — don't enter.">Setup Checklist</span>
        <span className="grade-summary" style={{ color: grade.color }}>{passing}/{total} ({pct}%)</span>
      </div>
      <div className="grade-checks">
        {checks.map((c, i) => (
          <div key={i} className={`grade-check ${c.pass ? 'pass' : 'fail'}`}>
            <span className="grade-check-icon">{c.pass ? '✓' : '✗'}</span>
            <span className="grade-check-name">{c.name}</span>
          </div>
        ))}
      </div>
      <div className="grade-rule">
        <span style={{ color: '#3a4d60' }}>A+ = full size · A = half size · B = wait · C = skip</span>
      </div>
    </div>
  )
}

// ── Bar Quality Badge ─────────────────────────────────────────────────────────
function BarQualityBadge({ barQuality }) {
  if (!barQuality) return null
  const { last, prev } = barQuality
  const qColor = q => q?.label === 'STRONG' ? '#10b981' : q?.label === 'MODERATE' ? '#f59e0b' : '#ef4444'
  return (
    <div className="bq-badge-wrap">
      <span className="bq-title">BAR QUALITY</span>
      {prev && (
        <span className="bq-item" style={{ color: qColor(prev) }}>
          PREV: {prev.label}
          <span className="bq-detail"> {prev.bodyRatio}% body · {prev.sizeVsAtr}× ATR · {prev.volRatio}× vol</span>
        </span>
      )}
      <span className="bq-item" style={{ color: qColor(last) }}>
        LAST: {last.label}
        <span className="bq-detail"> {last.bodyRatio}% body · {last.sizeVsAtr}× ATR · {last.volRatio}× vol</span>
      </span>
    </div>
  )
}

// ── EMA5 Slope Gauge ──────────────────────────────────────────────────────────
function Ema5SlopeGauge({ slopeData }) {
  if (!slopeData) return null
  const { label, slopePctPerBar, reliable, direction } = slopeData
  const color = label === 'STEEP' ? '#10b981' : label === 'MODERATE' ? '#f59e0b' : '#6b7280'
  return (
    <div className="ema5-slope-wrap">
      <span className="ema5-slope-label">EMA5 SLOPE</span>
      <span className="ema5-slope-val" style={{ color }}>{label}</span>
      <span className="ema5-slope-detail">
        {direction === 'up' ? '↑' : '↓'} {Math.abs(slopePctPerBar).toFixed(3)}%/bar
        {!reliable && <span className="ema5-slope-warn"> · flat — signal unreliable</span>}
      </span>
    </div>
  )
}

// ── Trend Age Bar ─────────────────────────────────────────────────────────────
function TrendAgeBar({ trendAge }) {
  if (!trendAge) return null
  const { age, phase } = trendAge
  const color    = phase === 'forming' ? '#6b7280' : phase === 'early' ? '#10b981' : phase === 'mid' ? '#4a90c4' : '#ef4444'
  const phaseStr = phase === 'forming' ? 'FORMING' : phase === 'early' ? 'EARLY TREND' : phase === 'mid' ? 'MID-TREND' : 'LATE CYCLE ⚠'
  return (
    <div className="trend-age-wrap">
      <span className="trend-age-label">TREND AGE</span>
      <span className="trend-age-val" style={{ color }}>{age} bars</span>
      <span className="trend-age-phase" style={{ color }}>{phaseStr}</span>
      {phase === 'late' && <span className="trend-age-warn">Trail stop tight — exhaustion risk</span>}
    </div>
  )
}

// ── Missed Entry Alert ────────────────────────────────────────────────────────
function MissedEntryAlert({ missedEntry, signal }) {
  if (!missedEntry?.missed) return null
  const { pctFrom, reentryLow, reentryHigh, ema5 } = missedEntry
  return (
    <div className="missed-entry-wrap">
      <div className="missed-entry-title">⚠ ENTRY WINDOW CLOSED</div>
      <div className="missed-entry-desc">
        Price is {Math.abs(pctFrom).toFixed(1)}% {pctFrom > 0 ? 'above' : 'below'} EMA5 (${fmt(ema5)}) — extended, do not chase
      </div>
      <div className="missed-entry-zone">
        Pullback re-entry zone: <strong>${fmt(reentryLow)} – ${fmt(reentryHigh)}</strong>
        <span className="missed-entry-note"> (EMA5 ±1.5%)</span>
      </div>
    </div>
  )
}

// ── Flip Recency Strip ────────────────────────────────────────────────────────
function FlipRecencyStrip({ flipRecency, adxSignal }) {
  if (!flipRecency && !adxSignal) return null
  const adxLabel = adxSignal ? (adxSignal.adxRising ? 'RISING' : 'FADING') : null
  const adxColor = adxSignal?.adxRising ? '#10b981' : '#ef4444'
  const bClass   = lbl => lbl === 'FRESH' ? 'fresh' : lbl === 'MODERATE' ? 'moderate' : 'stale'
  return (
    <div className="flip-recency-strip">
      <span className="flip-recency-title">FLIP RECENCY</span>
      {flipRecency?.rsi && (
        <div className="flip-recency-item">
          <span className="flip-recency-name">RSI:</span>
          <span className={`flip-recency-badge ${bClass(flipRecency.rsi.label)}`}>
            {flipRecency.rsi.label} {flipRecency.rsi.bars}b
          </span>
          <span style={{ fontSize: 10, color: flipRecency.rsi.above50 ? '#10b981' : '#ef4444' }}>
            {flipRecency.rsi.above50 ? '↑50' : '↓50'}
          </span>
        </div>
      )}
      {flipRecency?.macd && (
        <div className="flip-recency-item">
          <span className="flip-recency-name">MACD:</span>
          <span className={`flip-recency-badge ${bClass(flipRecency.macd.label)}`}>
            {flipRecency.macd.label} {flipRecency.macd.bars}b
          </span>
          <span style={{ fontSize: 10, color: flipRecency.macd.positive ? '#10b981' : '#ef4444' }}>
            {flipRecency.macd.positive ? '↑' : '↓'}
          </span>
        </div>
      )}
      {adxLabel && (
        <div className="flip-recency-item">
          <span className="flip-recency-name">ADX:</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: adxColor }}>{adxLabel}</span>
        </div>
      )}
    </div>
  )
}

// ── ADX Trajectory Sparkline ──────────────────────────────────────────────────
function AdxSparkline({ adxHistory }) {
  if (!adxHistory || adxHistory.values.length < 2) return null
  const { values, trend, slope } = adxHistory
  const min = Math.min(...values) - 1
  const max = Math.max(...values) + 1
  const range = max - min || 1
  const W = 80, H = 28
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - ((v - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const tColor = trend === 'rising' ? '#10b981' : '#ef4444'
  return (
    <div className="adx-spark-wrap">
      <span className="adx-spark-label">ADX TREND</span>
      <svg width={W} height={H} className="adx-spark-svg">
        <polyline points={pts} fill="none" stroke={tColor} strokeWidth="1.5" strokeLinejoin="round" />
        {values.map((v, i) => {
          const x = (i / (values.length - 1)) * W
          const y = H - ((v - min) / range) * H
          return <circle key={i} cx={x} cy={y} r="2.5" fill={tColor} />
        })}
      </svg>
      <div className="adx-spark-vals">
        {values.map((v, i) => <span key={i} className="adx-spark-num" style={{ color: i === values.length-1 ? tColor : '#4a6380' }}>{v}</span>)}
      </div>
      <span className="adx-spark-trend" style={{ color: tColor }}>
        {trend === 'rising' ? '↑ accelerating' : '↓ exhausting'} ({slope > 0 ? '+' : ''}{slope})
      </span>
    </div>
  )
}

// ── Pre-Signal Readiness Score ────────────────────────────────────────────────
function ReadinessScore({ readiness }) {
  if (!readiness) return null
  const { score, checks } = readiness
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444'
  const bg    = score >= 75 ? '#011c10' : score >= 50 ? '#1a1000' : '#1c0101'
  const bord  = score >= 75 ? '#065f46' : score >= 50 ? '#4d3000' : '#7f1d1d'
  const lbl   = score >= 75 ? 'NEAR READY' : score >= 50 ? 'BUILDING' : 'NOT READY'
  return (
    <div className="readiness-wrap" style={{ background: bg, borderColor: bord }}>
      <div className="readiness-head">
        <span className="readiness-title">PRE-SIGNAL READINESS</span>
        <span className="readiness-score" style={{ color }}>{score}/100</span>
        <span className="readiness-label" style={{ color }}>{lbl}</span>
      </div>
      <div className="readiness-checks">
        {checks.map((c, i) => (
          <div key={i} className="readiness-check">
            <span style={{ color: c.pass ? '#10b981' : '#2a3d59' }}>{c.pass ? '✓' : '○'}</span>
            <span className="readiness-check-name" style={{ color: c.pass ? '#a0b4c8' : '#3a4d60' }}>{c.name}</span>
            <span className="readiness-check-pts" style={{ color: c.pass ? color : '#3a4d60' }}>+{c.pts}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Position Health Meter ─────────────────────────────────────────────────────
function PositionHealthMeter({ health }) {
  if (!health) return null
  const { score, health: lbl, warnings } = health
  const color = lbl === 'HEALTHY' ? '#10b981' : lbl === 'CAUTION' ? '#f59e0b' : lbl === 'WEAKENING' ? '#f97316' : '#ef4444'
  const bg    = lbl === 'HEALTHY' ? '#011c10' : lbl === 'CAUTION' ? '#1a1000' : lbl === 'WEAKENING' ? '#1a0800' : '#1c0101'
  const bord  = lbl === 'HEALTHY' ? '#065f46' : lbl === 'CAUTION' ? '#4d3000' : lbl === 'WEAKENING' ? '#7c2d12' : '#7f1d1d'
  return (
    <div className="pos-health-wrap" style={{ borderColor: bord, background: bg }}>
      <div className="pos-health-head">
        <span className="pos-health-title">POSITION HEALTH</span>
        <span className="pos-health-score" style={{ color }}>{score}/100</span>
        <span className="pos-health-label" style={{ color, borderColor: bord }}>{lbl}</span>
      </div>
      <div className="pos-health-bar-track">
        <div className="pos-health-bar-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      {warnings.length > 0 && (
        <div className="pos-health-warns">
          {warnings.map((w, i) => (
            <div key={i} className={`pos-health-warn pos-health-warn-${w.sev}`}>
              <span>{w.icon}</span>
              <span>{w.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SwingResult({
  result, ticker, fibLevels, rsiSignal, adxSignal, maStack,
  patterns, vwapSignal, rsScore, volumeSpike, vixData, setupGrade,
  ivData, weeklyAlign, hsPatterns, contPatterns, sectorRS, currentPrice, onLogTrade,
  fourHBars, backtestResult,
}) {
  const { signal, confirmed, barsAbove, barsBelow, lastBar, prevBar, warnings } = result
  const cfg          = signal ? SIGNAL_CFG[signal] : null
  const confirmCount = confirmed ? 2 : (barsAbove > 0 || barsBelow > 0) ? 1 : 0
  const dailyBias    = maStack?.signal ?? null

  // ── 8 Timing Intelligence computations ────────────────────────────────────
  const barQuality  = computeBarQuality(fourHBars)
  const ema5Slope   = computeEma5Slope(fourHBars)
  const trendAge    = computeTrendAge(fourHBars, signal)
  const missedEntry = computeMissedEntry(fourHBars, currentPrice, signal)
  const flipRecency = computeFlipRecency(fourHBars)
  const adxHistory  = computeAdxHistory(fourHBars)
  const readiness   = (!signal || signal === 'WATCH')
    ? computeReadinessScore(rsiSignal, adxSignal, maStack, weeklyAlign, vwapSignal, ema5Slope, trendAge)
    : null
  const posHealth   = signal === 'LONG'
    ? computePositionHealth(rsiSignal, adxSignal, vwapSignal, volumeSpike, ema5Slope)
    : null

  return (
    <div className="swing-result">

      {/* ── Header ── */}
      <div className="swing-result-header">
        <div className="swing-eyebrow-row">
          <div className="swing-eyebrow-left">
            <span className="swing-eyebrow" data-tip="4H Swing Signal: Our primary entry/exit trigger. Two consecutive 4-hour bars closing above the 5 EMA = LONG entry. Two closing below = EXIT. One bar is not enough — it takes two consecutive closes to confirm the momentum shift and filter out false signals.">4H SWING</span>
            {ticker && <span className="swing-ticker">{ticker.toUpperCase()}</span>}
          </div>
          {dailyBias && (
            <span className={`daily-bias-tag daily-bias-${dailyBias.toLowerCase()}`}>
              DAILY {dailyBias}
            </span>
          )}
        </div>

        {cfg ? (
          <>
            <div className="swing-header-signal-row">
              <div className="swing-signal" style={{ color: cfg.color }}>{cfg.label}</div>
              {setupGrade && (
                <div className="swing-grade-badge" style={{ color: setupGrade.color, background: setupGrade.bg, borderColor: setupGrade.border }}>
                  {setupGrade.grade}
                </div>
              )}
            </div>
            <div className="swing-confirm-row">
              {[0, 1].map(i => (
                <div key={i} className={`swing-confirm-pip ${i < confirmCount ? 'filled' : 'empty'}`}
                  style={i < confirmCount ? { background: cfg.color } : {}} />
              ))}
              <span className="swing-confirm-text">{confirmCount}/2 bars confirmed</span>
            </div>
            <div className="swing-signal-desc" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
              {confirmed
                ? `2 consecutive 4H bars closed ${barsAbove === 2 ? 'above' : 'below'} 5 EMA`
                : `1 bar confirmed — waiting for next 4H close`}
            </div>
            <ActionBanner signal={signal} grade={setupGrade} />
            <MissedEntryAlert missedEntry={missedEntry} signal={signal} />
          </>
        ) : (
          <div className="swing-signal-empty">Fill in the 4H bars to get a signal</div>
        )}
      </div>

      {/* ── Setup Checklist — grade context right below the signal ── */}
      {setupGrade && <GradeChecklist grade={setupGrade} />}

      {/* ── Pre-signal readiness or active position health ── */}
      {readiness  && <ReadinessScore readiness={readiness} />}
      {posHealth  && <PositionHealthMeter health={posHealth} />}

      {/* ── VIX + IV ── */}
      {vixData && <VixBanner vix={vixData} />}
      <IvRankStrip data={ivData} />

      {/* ── Bar status ── */}
      {(lastBar || prevBar) && (
        <div className="swing-bars-block">
          <div className="swing-block-title">4H Bar Status</div>
          <div className="swing-bar-row">
            <BarDot value={lastBar} />
            <span className="swing-bar-label">Last bar</span>
            <span className={`swing-bar-val ${lastBar ?? 'empty'}`}>
              {lastBar === 'above' ? 'Above 5 EMA' : lastBar === 'below' ? 'Below 5 EMA' : '—'}
            </span>
          </div>
          <div className="swing-bar-row">
            <BarDot value={prevBar} />
            <span className="swing-bar-label">Prev bar</span>
            <span className={`swing-bar-val ${prevBar ?? 'empty'}`}>
              {prevBar === 'above' ? 'Above 5 EMA' : prevBar === 'below' ? 'Below 5 EMA' : '—'}
            </span>
          </div>
        </div>
      )}

      {/* ── Timing Intelligence ── */}
      {(ema5Slope || trendAge || barQuality) && (
        <div className="timing-intel-block">
          <div className="timing-intel-title">TIMING INTELLIGENCE · 4H</div>
          <Ema5SlopeGauge slopeData={ema5Slope} />
          <TrendAgeBar trendAge={trendAge} />
          {confirmed && <BarQualityBadge barQuality={barQuality} />}
        </div>
      )}

      {/* ── MOMENTUM ── */}
      {(rsiSignal || vwapSignal) && (
        <div className="swing-momentum-row">
          {rsiSignal  && <RsiCard data={rsiSignal} volumeSpike={volumeSpike} />}
          {vwapSignal && <VwapCrossCard data={vwapSignal} />}
        </div>
      )}
      {(rsiSignal || vwapSignal) && <FlipRecencyStrip flipRecency={flipRecency} adxSignal={adxSignal} />}
      {adxSignal && <AdxPanel data={adxSignal} />}
      {adxHistory && <AdxSparkline adxHistory={adxHistory} />}

      {/* ── TREND ── */}
      {maStack     && <MaStackPanel data={maStack} currentPrice={currentPrice} />}
      {weeklyAlign && <WeeklyAlignStrip data={weeklyAlign} />}
      {(rsScore || sectorRS) && (
        <div className="swing-rs-pair">
          {rsScore  && <RsStrip data={rsScore} />}
          {sectorRS && <SectorRsStrip data={sectorRS} />}
        </div>
      )}
      {vwapSignal && <VwapStrip data={vwapSignal} volumeSpike={volumeSpike} />}

      {/* ── PATTERN ── */}
      <PatternPanel
        data={patterns ?? { doubleTop: null, doubleBottom: null }}
        hsPatterns={hsPatterns}
        contPatterns={contPatterns}
        currentPrice={currentPrice}
      />

      {/* ── FIBONACCI ── */}
      {fibLevels && <FibTable fib={fibLevels} />}

      {/* ── RISK MANAGEMENT ── */}
      {currentPrice && (patterns?.doubleBottom || patterns?.doubleTop || hsPatterns?.headAndShoulders || hsPatterns?.inverseHAndS) && (
        <RiskPanel
          patterns={patterns}
          hsPatterns={hsPatterns}
          currentPrice={currentPrice}
          grade={setupGrade}
          onLogTrade={onLogTrade}
          swingSignal={signal}
        />
      )}

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <div className="swing-warnings-block">
          {warnings.map((w, i) => <div key={i} className="swing-warning-row"><span className="swing-warn-icon">⚠</span>{w}</div>)}
        </div>
      )}

      {/* ── Rules ── */}
      <div className="swing-rules-block">
        <div className="swing-rule bull"><span className="swing-rule-icon">↑</span><span><strong>LONG</strong> — 2 × 4H bars above 5 EMA</span></div>
        <div className="swing-rule bear"><span className="swing-rule-icon">↓</span><span><strong>EXIT</strong> — 2 × 4H bars below 5 EMA</span></div>
        <div className="swing-rule vwap"><span className="swing-rule-icon">≋</span><span><strong>VWAP</strong> — 2 daily closes above/below 20D VWAP confirms direction</span></div>
      </div>
    </div>
  )
}
