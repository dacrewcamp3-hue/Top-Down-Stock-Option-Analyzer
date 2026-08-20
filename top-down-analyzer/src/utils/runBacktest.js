// Replays weekly + daily confluence rules over historical data.
// Uses the same indicator math as the live app — what fires today also fired historically.
//
// Improvements over v1:
//  1. Earnings skip — options spanning an estimated earnings date are excluded
//  2. Grade-adaptive exits — scans bar-by-bar for TP/SL instead of fixed lookforward
//  3. VRP-adjusted entry IV — HV × 1.20 to approximate real option market pricing
//  4. Completed weekly bars only — prevents incomplete current-week data from biasing signals
//  5. Compounded equity curve — multiplicative P&L, not additive
//  6. Low-sample warning when < 20 trades (statistical confidence floor)
//  7. Scale-out simulation — 50% at +100%, 50% at full grade TP (computed in same pass)
//  8. Per-grade stats — win rate and EV broken down by A+/A/B

import { calcEMASeries, calcRSI, calcMACD, calcADX } from './indicators'
import { bsPrice } from './fetchOptions'

// ── Week key ──────────────────────────────────────────────────────────────────
function getWeekKey(unixSec) {
  const d    = new Date(unixSec * 1000)
  const jan1 = new Date(d.getFullYear(), 0, 1)
  const wk   = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)
  return `${d.getFullYear()}-${String(wk).padStart(2, '0')}`
}

// ── Daily → Weekly resample ───────────────────────────────────────────────────
function resampleWeekly(timestamps, opens, highs, lows, closes) {
  const map = new Map()
  for (let i = 0; i < timestamps.length; i++) {
    const key = getWeekKey(timestamps[i])
    if (!map.has(key)) {
      map.set(key, { ts: timestamps[i], key, o: opens[i], h: highs[i], l: lows[i], c: closes[i] })
    } else {
      const w = map.get(key)
      w.h = Math.max(w.h, highs[i])
      w.l = Math.min(w.l, lows[i])
      w.c = closes[i]
    }
  }
  const rows = [...map.values()].sort((a, b) => a.ts - b.ts)
  return {
    timestamps: rows.map(r => r.ts),
    weekKeys:   rows.map(r => r.key),
    opens:      rows.map(r => r.o),
    highs:      rows.map(r => r.h),
    lows:       rows.map(r => r.l),
    closes:     rows.map(r => r.c),
  }
}

// ── Rolling annualised HV (log-return σ × √252) ───────────────────────────────
function rollingHV(closes, endIdx, n = 20) {
  const start   = Math.max(1, endIdx - n + 1)
  const returns = []
  for (let i = start; i <= endIdx; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0)
      returns.push(Math.log(closes[i] / closes[i - 1]))
  }
  if (returns.length < 5) return 0.30
  const mean     = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  return Math.max(0.10, Math.sqrt(variance * 252))
}

// ── Confluence score [-1, +1] — mirrors the live daily indicator panel ────────
function confluenceAt(closes, highs, lows) {
  const n = closes.length
  if (n < 50) return 0

  let bull = 0, bear = 0

  const ema30s = calcEMASeries(closes, 30)
  if (ema30s[n - 1] != null) {
    closes[n - 1] > ema30s[n - 1] ? bull++ : bear++
  }

  const rsi = calcRSI(closes)
  if (rsi != null) {
    if (rsi >= 44) bull++
    else if (rsi >= 30) bear++
  }

  const m = calcMACD(closes)
  if (m) { m.histogram > 0 ? bull++ : bear++ }

  const adx = calcADX(highs, lows, closes)
  if (adx && adx.adx >= 21) {
    adx.plusDI >= 21 ? bull++ : (adx.minusDI >= 21 ? bear++ : null)
  }

  if (n >= 10) {
    const ema8s = calcEMASeries(closes, 8)
    const la = closes[n - 1] > ema8s[n - 1]
    const pa = closes[n - 2] > ema8s[n - 2]
    if (la && pa)   bull++
    if (!la && !pa) bear++
  }

  const total = bull + bear
  if (total < 3) return 0
  return (bull - bear) / total
}

// ── Earnings history fetch ────────────────────────────────────────────────────
async function fetchEarningsHistory(ticker) {
  try {
    const res = await fetch(
      `/yf-api/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=earningsHistory`
    )
    if (!res.ok) return []
    const json    = await res.json()
    const history = json.quoteSummary?.result?.[0]?.earningsHistory?.history ?? []

    const dates = history
      .map(h => h.quarter?.raw)
      .filter(Boolean)
      .map(raw => {
        const d = new Date(raw * 1000)
        d.setDate(d.getDate() + 35)
        return d.getTime() / 1000
      })

    if (dates.length === 0) return []

    const cutoff  = Date.now() / 1000 - 2 * 365 * 86400
    let earliest  = Math.min(...dates)
    while (earliest > cutoff) {
      earliest -= 91 * 86400
      dates.push(earliest)
    }

    return dates
  } catch {
    return []
  }
}

// ── Grade from confluence strength ────────────────────────────────────────────
function gradeFromConf(absConf) {
  if (absConf >= 0.85) return 'A+'
  if (absConf >= 0.72) return 'A'
  return 'B'
}

// ── Grade-adaptive exit thresholds (options premium change) ───────────────────
const GRADE_EXITS = {
  'A+': { tp: 2.00, sl: -0.35 },
  'A':  { tp: 1.50, sl: -0.40 },
  'B':  { tp: 1.00, sl: -0.45 },
}

// ── Commission / slippage constants ──────────────────────────────────────────
const STOCK_SLIP_PCT = 0.0010
const OPT_SLIP_PCT   = 0.02
const OPT_COMMISSION = 1.30

// ── Spread width (tick increment × 2) ────────────────────────────────────────
function spreadInc(price) {
  if (price < 10)  return 0.5
  if (price < 25)  return 1
  if (price < 75)  return 2.5
  if (price < 200) return 5
  if (price < 500) return 10
  return 25
}

// ── Bar-by-bar debit spread exit scan ────────────────────────────────────────
// Prices both legs each bar using rolling HV (no VRP), so the VRP paid at entry
// evaporates naturally — capturing the real IV crush effect on the spread.
// The short leg partially offsets the long leg's vega loss, which is the core
// advantage of a spread in high-IV environments.
function findSpreadExit(closes, entryBar, K, Kshort, isCall, spreadDebit, spreadWidth, grade, DTE, withCommission) {
  const exits   = GRADE_EXITS[grade]
  const maxBars = Math.min(DTE - 1, closes.length - entryBar - 2)

  const reSpread = (barIdx, dteRemaining) => {
    const S  = closes[barIdx]
    const hv = rollingHV(closes, barIdx)
    const iv = Math.max(0.12, hv)
    const T  = Math.max(0, dteRemaining)
    const longVal  = T > 0.004 ? bsPrice(S, K, T, iv, isCall) : Math.max(0, isCall ? S - K : K - S)
    const shortVal = T > 0.004 ? bsPrice(S, Kshort, T, iv, isCall) : Math.max(0, isCall ? S - Kshort : Kshort - S)
    return Math.max(0, longVal - shortVal)
  }

  const toGainFrac = spreadValue => {
    const p = withCommission
      ? Math.max(0, spreadValue * (1 - OPT_SLIP_PCT) - OPT_COMMISSION / 100)
      : spreadValue
    return spreadDebit > 0.01 ? (p - spreadDebit) / spreadDebit : -1
  }

  // TP fires at grade's target % of debit OR 90% of max spread value, whichever comes first
  const tpValue = Math.min(spreadDebit * (1 + exits.tp), spreadWidth * 0.90)

  for (let j = 1; j <= maxBars; j++) {
    const dteLeft = (DTE - j) / 365
    const val     = reSpread(entryBar + j, dteLeft)
    const ret     = spreadDebit > 0.01 ? (val - spreadDebit) / spreadDebit : -1

    if (val >= tpValue) {
      return { gainFrac: toGainFrac(val), barsHeld: j, hitTP: true, hitSL: false }
    }
    if (ret <= exits.sl) {
      return { gainFrac: toGainFrac(val), barsHeld: j, hitTP: false, hitSL: true }
    }
  }

  // Time exit: same 15% IV crush on underlying HV
  const defaultJ  = Math.min(10, maxBars)
  const barFin    = Math.min(entryBar + defaultJ, closes.length - 1)
  const Sfin      = closes[barFin]
  const hvFin     = rollingHV(closes, barFin)
  const ivFin     = Math.max(0.12, hvFin * 0.85)
  const dteFin    = Math.max(0, (DTE - defaultJ) / 365)
  const longFin   = dteFin > 0.004 ? bsPrice(Sfin, K, dteFin, ivFin, isCall) : Math.max(0, isCall ? Sfin - K : K - Sfin)
  const shortFin  = dteFin > 0.004 ? bsPrice(Sfin, Kshort, dteFin, ivFin, isCall) : Math.max(0, isCall ? Sfin - Kshort : Kshort - Sfin)
  const valFin    = Math.max(0, longFin - shortFin)
  return { gainFrac: toGainFrac(valFin), barsHeld: defaultJ, hitTP: false, hitSL: false }
}

// ── Bar-by-bar options exit scan ──────────────────────────────────────────────
// Returns { gainFrac, barsHeld, hitTP, hitSL } where gainFrac is the fractional
// return on optEntry (e.g. 2.0 = +200%, -0.35 = -35%).
//
// When scaleOut=true, locks 50% at the +100% level then scans the remaining
// 50% for the full grade TP or SL. For B grade (TP=100%), scale-out has no
// effect (TP1 == TP2), so regular and scale-out results are identical for B.
function findOptionsExit(closes, entryBar, K, isCall, optEntry, grade, DTE, withCommission, scaleOut = false) {
  const exits    = GRADE_EXITS[grade]
  const maxBars  = Math.min(DTE - 1, closes.length - entryBar - 2)
  const canScale = scaleOut && exits.tp > 1.00   // only meaningful for A+ and A

  const rePrice = (barIdx, dteRemaining) => {
    const S  = closes[barIdx]
    const hv = rollingHV(closes, barIdx)
    const iv = Math.max(0.12, hv)
    return dteRemaining > 0.004
      ? bsPrice(S, K, dteRemaining, iv, isCall)
      : Math.max(0, isCall ? S - K : K - S)
  }

  // Convert a raw option price to gain fraction after applying exit commission
  const toGainFrac = price => {
    const p = withCommission
      ? Math.max(0, price * (1 - OPT_SLIP_PCT) - OPT_COMMISSION / 100)
      : price
    return optEntry > 0.01 ? (p - optEntry) / optEntry : -1
  }

  let scaledFrac = null   // gain fraction locked when first half exited at +100%

  for (let j = 1; j <= maxBars; j++) {
    const dte   = (DTE - j) / 365
    const price = rePrice(entryBar + j, dte)
    const ret   = optEntry > 0.01 ? (price - optEntry) / optEntry : -1

    // Scale-out: lock 50% at the +100% trigger point
    if (canScale && scaledFrac === null && ret >= 1.00) {
      scaledFrac = toGainFrac(price)
      continue  // keep scanning for remaining 50%
    }

    if (ret <= exits.sl) {
      const frac = toGainFrac(price)
      const gain = scaledFrac !== null ? 0.5 * scaledFrac + 0.5 * frac : frac
      return { gainFrac: gain, barsHeld: j, hitTP: false, hitSL: true }
    }

    if (ret >= exits.tp) {
      const frac = toGainFrac(price)
      const gain = scaledFrac !== null ? 0.5 * scaledFrac + 0.5 * frac : frac
      return { gainFrac: gain, barsHeld: j, hitTP: true, hitSL: false }
    }
  }

  // Time exit: close at 10 days with 15% IV crush applied
  const defaultJ = Math.min(10, maxBars)
  const dteFin   = Math.max(0, (DTE - defaultJ) / 365)
  const Sfin     = closes[Math.min(entryBar + defaultJ, closes.length - 1)]
  const hvFin    = rollingHV(closes, Math.min(entryBar + defaultJ, closes.length - 1))
  const ivFin    = Math.max(0.12, hvFin * 0.85)
  const priceFin = dteFin > 0.004
    ? bsPrice(Sfin, K, dteFin, ivFin, isCall)
    : Math.max(0, isCall ? Sfin - K : K - Sfin)
  const frac     = toGainFrac(priceFin)
  const gain     = scaledFrac !== null ? 0.5 * scaledFrac + 0.5 * frac : frac
  return { gainFrac: gain, barsHeld: defaultJ, hitTP: false, hitSL: false }
}

// ── Main backtest ─────────────────────────────────────────────────────────────
export async function runBacktest(ticker, lookforward = 10, withCommission = false, { startDate, endDate } = {}) {
  const [chartRes, earningsDates] = await Promise.all([
    fetch(`/yf-api/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2y&includePrePost=false`),
    fetchEarningsHistory(ticker),
  ])

  if (!chartRes.ok) throw new Error(`Yahoo Finance returned HTTP ${chartRes.status}`)
  const json = await chartRes.json()
  const r    = json.chart?.result?.[0]
  if (!r) throw new Error(`No data for ${ticker}`)

  const ts   = r.timestamp ?? []
  const q    = r.indicators?.quote?.[0] ?? {}

  // Convert optional date-range strings to Unix seconds for filtering
  const startSec = startDate ? new Date(startDate).getTime() / 1000 : null
  const endSec   = endDate   ? new Date(endDate).getTime()   / 1000 : null

  const bars = ts
    .map((t, i) => ({ ts: t, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i] }))
    .filter(b => b.c != null && b.o != null)
    .filter(b => (startSec == null || b.ts >= startSec) && (endSec == null || b.ts <= endSec))

  const timestamps = bars.map(b => b.ts)
  const opens      = bars.map(b => b.o)
  const highs      = bars.map(b => b.h)
  const lows       = bars.map(b => b.l)
  const closes     = bars.map(b => b.c)
  const n          = closes.length

  const WARMUP = 100
  if (n < WARMUP + lookforward + 2) {
    throw new Error(`Not enough history — need ${WARMUP + lookforward + 2} bars, got ${n}`)
  }

  const weekly = resampleWeekly(timestamps, opens, highs, lows, closes)
  const OPT_DTE = 21

  const trades        = []
  let lastSignalBar   = -10
  let earningsSkipped = 0

  for (let i = WARMUP; i < n - lookforward - 1; i++) {
    if (i - lastSignalBar < 5) continue

    const dConf = confluenceAt(closes.slice(0, i + 1), highs.slice(0, i + 1), lows.slice(0, i + 1))
    if (Math.abs(dConf) < 0.60) continue

    const adxAtBar = calcADX(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1))
    const adxVal   = adxAtBar?.adx ?? 0
    const adxLevel = adxVal >= 25 ? 'strong' : adxVal >= 21 ? 'moderate' : 'weak'

    const currentWeekKey = getWeekKey(timestamps[i])
    const wEnd = weekly.weekKeys.findLastIndex(wk => wk < currentWeekKey)
    if (wEnd < 20) continue

    const wConf = confluenceAt(
      weekly.closes.slice(0, wEnd + 1),
      weekly.highs.slice(0, wEnd + 1),
      weekly.lows.slice(0, wEnd + 1),
    )
    if (Math.sign(wConf) !== Math.sign(dConf)) continue

    const entryTs      = timestamps[i]
    const optExpiryTs  = entryTs + OPT_DTE * 86400
    const nearEarnings = earningsDates.some(ed => ed >= entryTs && ed <= optExpiryTs)
    if (nearEarnings) { earningsSkipped++; continue }

    const dir   = dConf > 0 ? 'CALL' : 'PUT'
    const grade = gradeFromConf(Math.abs(dConf))
    const entry = opens[i + 1]
    const exit  = closes[i + lookforward]
    if (!entry || !exit) continue

    // ── Stock P&L ─────────────────────────────────────────────────────────────
    const effEntry = withCommission ? entry * (1 + STOCK_SLIP_PCT) : entry
    const effExit  = withCommission ? exit  * (1 - STOCK_SLIP_PCT) : exit
    const pctRaw   = (effExit - effEntry) / effEntry * 100
    const gain     = dir === 'CALL' ? pctRaw : -pctRaw

    // ── Options P&L — standard and scale-out computed in the same pass ────────
    const isCall      = dir === 'CALL'
    const K           = Math.round(entry)
    const T0          = OPT_DTE / 365
    const ivEntry     = Math.max(0.15, rollingHV(closes, i) * 1.20)
    const rawOptEntry = bsPrice(entry, K, T0, ivEntry, isCall)
    const optEntry    = withCommission ? rawOptEntry * (1 + OPT_SLIP_PCT) : rawOptEntry

    const regExit = findOptionsExit(closes, i + 1, K, isCall, optEntry, grade, OPT_DTE, withCommission, false)
    const soExit  = findOptionsExit(closes, i + 1, K, isCall, optEntry, grade, OPT_DTE, withCommission, true)

    const optGainPct   = regExit.gainFrac * 100
    const optGainPctSO = soExit.gainFrac * 100
    const optWin       = regExit.gainFrac > 0
    const optWinSO     = soExit.gainFrac > 0
    const stockRight   = isCall ? exit > entry : exit < entry
    const ivCrush      = stockRight && !optWin

    // ── Debit spread simulation ──────────────────────────────────────────────
    const sInc        = spreadInc(entry)
    const spreadWidth = sInc * 2
    const Kshort      = isCall ? K + spreadWidth : K - spreadWidth
    const rawLong     = bsPrice(entry, K, T0, ivEntry, isCall)
    const rawShort    = bsPrice(entry, Kshort, T0, ivEntry, isCall)
    const rawSpDebit  = Math.max(0, rawLong - rawShort)
    const spreadDebit = withCommission ? rawSpDebit * (1 + OPT_SLIP_PCT) : rawSpDebit

    const spExit      = spreadDebit > 0.01
      ? findSpreadExit(closes, i + 1, K, Kshort, isCall, spreadDebit, spreadWidth, grade, OPT_DTE, withCommission)
      : { gainFrac: -1, barsHeld: 0, hitTP: false, hitSL: false }

    const spreadGain  = spExit.gainFrac * 100
    const spreadWin   = spExit.gainFrac > 0
    const ivSaved     = ivCrush && spreadWin   // IV crushed the outright but spread survived

    trades.push({
      barIndex:     i,
      date:         new Date(timestamps[i] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
      signal:       dir,
      grade,
      adxLevel,
      entryPrice:   +entry.toFixed(2),
      exitPrice:    +exit.toFixed(2),
      gain:         +gain.toFixed(2),
      win:          gain > 0,
      confluence:   Math.round(Math.abs(dConf) * 100),
      optGainPct:   +optGainPct.toFixed(1),
      optGainPctSO: +optGainPctSO.toFixed(1),
      optWin,
      optWinSO,
      ivCrush,
      hitTP:        regExit.hitTP,
      hitSL:        regExit.hitSL,
      hitTPSO:      soExit.hitTP,
      hitSLSO:      soExit.hitSL,
      barsHeld:     regExit.barsHeld,
      // spread
      optEntry:     +rawOptEntry.toFixed(2),
      spreadDebit:  +rawSpDebit.toFixed(2),
      spreadWidth,
      spreadGain:   +spreadGain.toFixed(1),
      spreadWin,
      ivSaved,
      spHitTP:      spExit.hitTP,
      spHitSL:      spExit.hitSL,
    })

    lastSignalBar = i
  }

  if (trades.length === 0) {
    return { trades: [], winRate: null, avgGain: null, totalReturn: null, totalTrades: 0, earningsSkipped }
  }

  // ── Stock aggregate stats ─────────────────────────────────────────────────
  const wins    = trades.filter(t => t.win)
  const losses  = trades.filter(t => !t.win)
  const winRate = Math.round((wins.length / trades.length) * 100)
  const avgGain = trades.reduce((s, t) => s + t.gain, 0) / trades.length
  const avgWin  = wins.length   ? wins.reduce((s, t)   => s + t.gain, 0) / wins.length   : 0
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.gain, 0) / losses.length : 0

  let maxConsecLoss = 0, streak = 0
  for (const t of trades) {
    streak = t.win ? 0 : streak + 1
    maxConsecLoss = Math.max(maxConsecLoss, streak)
  }

  let eq = 100
  const equityCurve = trades.map(t => {
    eq = +(eq * (1 + t.gain / 100)).toFixed(2)
    return { date: t.date, equity: eq }
  })
  const totalReturn = +(eq - 100).toFixed(2)

  // ── Standard options aggregate stats ─────────────────────────────────────
  const optWins    = trades.filter(t => t.optWin)
  const optLosses  = trades.filter(t => !t.optWin)
  const optWinRate = Math.round((optWins.length / trades.length) * 100)
  const avgOptGain = optWins.length   ? optWins.reduce((s, t)   => s + t.optGainPct, 0) / optWins.length   : 0
  const avgOptLoss = optLosses.length ? optLosses.reduce((s, t) => s + t.optGainPct, 0) / optLosses.length : 0

  const ivCrushCount = trades.filter(t => t.ivCrush).length
  const ivCrushPct   = Math.round(ivCrushCount / trades.length * 100)
  const tpHits       = trades.filter(t => t.hitTP).length
  const slHits       = trades.filter(t => t.hitSL).length

  // ── Scale-out aggregate stats ─────────────────────────────────────────────
  const soWins    = trades.filter(t => t.optWinSO)
  const soLosses  = trades.filter(t => !t.optWinSO)
  const soWinRate = Math.round((soWins.length / trades.length) * 100)
  const soAvgWin  = soWins.length   ? soWins.reduce((s, t)   => s + t.optGainPctSO, 0) / soWins.length   : 0
  const soAvgLoss = soLosses.length ? soLosses.reduce((s, t) => s + t.optGainPctSO, 0) / soLosses.length : 0
  const tpHitsSO  = trades.filter(t => t.hitTPSO).length
  const slHitsSO  = trades.filter(t => t.hitSLSO).length

  // ── Debit spread aggregate stats ─────────────────────────────────────────
  const spWins      = trades.filter(t => t.spreadWin)
  const spLosses    = trades.filter(t => !t.spreadWin)
  const spWinRate   = Math.round(spWins.length / trades.length * 100)
  const spAvgWin    = spWins.length   ? spWins.reduce((s, t)   => s + t.spreadGain, 0) / spWins.length   : 0
  const spAvgLoss   = spLosses.length ? spLosses.reduce((s, t) => s + t.spreadGain, 0) / spLosses.length : 0
  const ivSavedCount  = trades.filter(t => t.ivSaved).length
  const spTpHits    = trades.filter(t => t.spHitTP).length
  const spSlHits    = trades.filter(t => t.spHitSL).length

  // Avg cost reduction: spread debit as % of outright premium
  const costRatios    = trades.filter(t => t.optEntry > 0 && t.spreadDebit > 0)
    .map(t => t.spreadDebit / t.optEntry)
  const avgCostRatio  = costRatios.length
    ? costRatios.reduce((s, r) => s + r, 0) / costRatios.length
    : null

  // Per-grade breakdown (options) ─────────────────────────────────────────
  const gradeStats = {}
  for (const g of ['A+', 'A', 'B']) {
    const gt = trades.filter(t => t.grade === g)
    if (!gt.length) continue
    const gW  = gt.filter(t => t.optWin)
    const gL  = gt.filter(t => !t.optWin)
    const gWR = Math.round(gW.length / gt.length * 100)
    const gAvgW = gW.length ? gW.reduce((s, t) => s + t.optGainPct, 0) / gW.length : 0
    const gAvgL = gL.length ? gL.reduce((s, t) => s + t.optGainPct, 0) / gL.length : 0
    gradeStats[g] = {
      count:      gt.length,
      optWinRate: gWR,
      avgWin:     +gAvgW.toFixed(1),
      avgLoss:    +gAvgL.toFixed(1),
      tpHits:     gt.filter(t => t.hitTP).length,
      slHits:     gt.filter(t => t.hitSL).length,
    }
  }

  // Grade distribution (for existing UI)
  const gradeCount = { 'A+': 0, 'A': 0, 'B': 0 }
  for (const t of trades) gradeCount[t.grade] = (gradeCount[t.grade] ?? 0) + 1

  // ── Half-Kelly sizing ─────────────────────────────────────────────────────
  const kellyStock = (() => {
    if (!wins.length || !losses.length) return 0
    const p = wins.length / trades.length
    const b = Math.abs(avgWin) / Math.max(0.01, Math.abs(avgLoss))
    return Math.max(0, (p - (1 - p) / b) / 2) * 100
  })()

  const kellyOptions = (() => {
    if (!optWins.length || !optLosses.length) return 0
    const p = optWins.length / trades.length
    const b = Math.abs(avgOptGain) / Math.max(1, Math.abs(avgOptLoss))
    return Math.max(0, (p - (1 - p) / b) / 2) * 100
  })()

  return {
    trades,
    totalTrades:   trades.length,
    totalWins:     wins.length,
    winRate,
    avgGain:       +avgGain.toFixed(2),
    avgWin:        +avgWin.toFixed(2),
    avgLoss:       +avgLoss.toFixed(2),
    totalReturn,
    maxConsecLoss,
    equityCurve,
    lookforward,
    // Standard options
    optWinRate,
    avgOptGain:    +avgOptGain.toFixed(1),
    avgOptLoss:    +avgOptLoss.toFixed(1),
    ivCrushCount,
    ivCrushPct,
    tpHits,
    slHits,
    gradeCount,
    // Scale-out options
    soWinRate,
    soAvgWin:      +soAvgWin.toFixed(1),
    soAvgLoss:     +soAvgLoss.toFixed(1),
    tpHitsSO,
    slHitsSO,
    // Per-grade breakdown
    gradeStats,
    // Debit spread simulation
    spWinRate,
    spAvgWin:      +spAvgWin.toFixed(1),
    spAvgLoss:     +spAvgLoss.toFixed(1),
    ivSavedCount,
    spTpHits,
    spSlHits,
    avgCostRatio:  avgCostRatio != null ? +avgCostRatio.toFixed(2) : null,
    // Misc
    kellyStock:    +kellyStock.toFixed(1),
    kellyOptions:  +kellyOptions.toFixed(1),
    withCommission,
    earningsSkipped,
    lowSampleWarning: trades.length < 20,
  }
}
