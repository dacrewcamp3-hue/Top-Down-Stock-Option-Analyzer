// Option recommendations via Black-Scholes math.
// No external options API — uses current price + volatility to synthesize actionable trades.

// ── Math core ─────────────────────────────────────────────────────────────────
function normCDF(x) {
  const t    = 1 / (1 + 0.2316419 * Math.abs(x))
  const d    = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const cdf  = 1 - d * poly
  return x >= 0 ? cdf : 1 - cdf
}

function normPDF(x) {
  return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
}

// Black-Scholes price (per share)
export function bsPrice(S, K, T, sigma, isCall, r = 0.045) {
  if (!S || !K || T <= 0 || sigma <= 0) return 0
  const sqrtT = Math.sqrt(T)
  const d1    = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2    = d1 - sigma * sqrtT
  const eRT   = Math.exp(-r * T)
  return isCall
    ? S * normCDF(d1) - K * eRT * normCDF(d2)
    : K * eRT * normCDF(-d2) - S * normCDF(-d1)
}

// Full Greeks + probITM (per-share; theta per calendar day; vega & rho per 1% change)
export function calcGreeks(S, K, T, sigma, isCall, r = 0.045) {
  if (!S || !K || T <= 0 || sigma <= 0 || sigma > 5) return null
  const sqrtT = Math.sqrt(T)
  const d1    = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2    = d1 - sigma * sqrtT
  const nd1   = normPDF(d1)
  const eRT   = Math.exp(-r * T)
  return {
    delta:   isCall ? normCDF(d1) : normCDF(d1) - 1,
    gamma:   nd1 / (S * sigma * sqrtT),
    theta:   (isCall
      ? -S * nd1 * sigma / (2 * sqrtT) - r * K * eRT * normCDF(d2)
      : -S * nd1 * sigma / (2 * sqrtT) + r * K * eRT * normCDF(-d2)
    ) / 365,
    vega:    S * sqrtT * nd1 / 100,
    rho:     (isCall ? K * T * eRT * normCDF(d2) : -K * T * eRT * normCDF(-d2)) / 100,
    probITM: isCall ? normCDF(d2) : normCDF(-d2),
  }
}

// ── Historical volatility (30-day annualised) ─────────────────────────────────
export function calcHistoricalVol(closes) {
  if (!closes || closes.length < 15) return 0.30
  const recent  = closes.slice(-31)
  const returns = []
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > 0 && recent[i - 1] > 0) {
      returns.push(Math.log(recent[i] / recent[i - 1]))
    }
  }
  if (returns.length < 10) return 0.30
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance * 252)
}

// ── Timezone-safe expiry date formatter ──────────────────────────────────────
// Yahoo Finance expiry timestamps are midnight UTC. Converting with new Date(ts*1000)
// in US timezones (UTC-4 to UTC-8) shifts the date one day earlier. Always format
// with timeZone:'UTC' so the displayed date matches the actual expiry Friday.
export function fmtExpDate(unixSec, opts = { month: 'short', day: 'numeric', year: '2-digit' }) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' })
    .format(new Date(unixSec * 1000))
}

// Convert a UTC unix timestamp to a local Date object at local midnight
// (used so DTE calculations and date comparisons work correctly)
export function tsToLocalDate(unixSec) {
  const d = new Date(unixSec * 1000)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// ── Standard monthly expiration dates (3rd Friday of each month) ──────────────
function thirdFriday(year, month) {
  const firstDay     = new Date(year, month, 1).getDay()
  const firstFriDate = ((5 - firstDay + 7) % 7) + 1
  return new Date(year, month, firstFriDate + 14)
}

function getMonthlyExpirations(count = 24) {
  const now  = new Date()
  const exps = []
  for (let m = 0; m <= count; m++) {
    const d   = new Date(now.getFullYear(), now.getMonth() + m, 1)
    const exp = thirdFriday(d.getFullYear(), d.getMonth())
    if (exp > now) exps.push(exp)
  }
  return exps
}

// Build a sorted list of Date objects from real chain expiry Unix timestamps.
// Uses tsToLocalDate so DTE math stays in local time (same as getMonthlyExpirations).
function chainDatesToExpiries(chainTimestamps) {
  const now = new Date()
  return chainTimestamps
    .map(ts => tsToLocalDate(ts))
    .filter(d => d > now)
    .sort((a, b) => a - b)
}

// ── Find a real liquid contract closest to the target delta ──────────────────
// Returns the contract with enriched fields (mid, spreadPct, actualIV, greeks)
// or null if liveContracts is unavailable or no usable contract is found.
function findLiveContract(liveContracts, expTimestamp, S, T, isCall, targetDelta, r = 0.045) {
  if (!liveContracts || !expTimestamp) return null
  const keys    = Object.keys(liveContracts).map(Number)
  const matchTs = keys.find(k => Math.abs(k - expTimestamp) < 86400)
  if (matchTs == null) return null
  const bucket  = liveContracts[matchTs]
  const legs    = isCall ? (bucket?.calls ?? []) : (bucket?.puts ?? [])

  let pool = legs.filter(c => c.bid > 0 && c.oi >= 100)
  if (!pool.length) pool = legs.filter(c => c.bid > 0)
  if (!pool.length) return null

  let best = null, bestErr = Infinity
  for (const c of pool) {
    if (!c.iv || c.iv <= 0) continue
    const g = calcGreeks(S, c.strike, T, c.iv, isCall, r)
    if (!g) continue
    const err = Math.abs(Math.abs(g.delta) - targetDelta)
    if (err < bestErr) {
      bestErr  = err
      const mid = (c.bid + c.ask) / 2
      const spreadPct = mid > 0 ? (c.ask - c.bid) / mid * 100 : 999
      best = { ...c, ...g, mid: +mid.toFixed(2), spreadPct: +spreadPct.toFixed(1), wideSpread: spreadPct > 20, actualIV: c.iv }
    }
  }
  return best
}

// ── Find the strike that produces a given target delta ────────────────────────
function strikeForDelta(S, T, sigma, isCall, targetDelta, r = 0.045) {
  const inc = S < 10 ? 0.5 : S < 25 ? 1 : S < 75 ? 2.5 : S < 500 ? 5 : 10
  const atm = Math.round(S / inc) * inc
  let bestK = atm, bestErr = Infinity
  for (let i = -50; i <= 50; i++) {
    const K = atm + i * inc
    if (K <= 0) continue
    const g   = calcGreeks(S, K, T, sigma, isCall, r)
    if (!g) continue
    const err = Math.abs(Math.abs(g.delta) - targetDelta)
    if (err < bestErr) { bestErr = err; bestK = K }
  }
  return bestK
}

// ── Conviction delta map ──────────────────────────────────────────────────────
const CONVICTION_DELTA = { conservative: 0.35, standard: 0.47, aggressive: 0.62 }

// ── Grade-based primary DTE floors ───────────────────────────────────────────
// A+/A: shorter DTE — high confidence, take the leverage
// B/C:  longer DTE — give the trade more time to develop
const GRADE_PRIMARY_DTE = { 'A+': 25, 'A': 30, 'B': 38, 'C': 48 }

// ── Build one recommendation ──────────────────────────────────────────────────
// expTimestamp: Unix seconds for the expiry (used to match liveContracts bucket)
// liveContracts: per-expiry contract map from fetchOptionsChain, or null for B-S fallback
function makeRec(label, S, sigma, isCall, expDate, expTimestamp, targetDelta, patternTarget, r = 0.045, liveContracts = null) {
  const dte  = Math.round((expDate.getTime() - Date.now()) / 86400000)
  if (dte <= 0) return null
  const T    = dte / 365

  const live   = findLiveContract(liveContracts, expTimestamp, S, T, isCall, targetDelta, r)
  const K      = live ? live.strike : strikeForDelta(S, T, sigma, isCall, targetDelta, r)
  const ivUsed = live ? live.actualIV : sigma
  const g      = live
    ? { delta: live.delta, gamma: live.gamma, theta: live.theta, vega: live.vega, rho: live.rho, probITM: live.probITM }
    : calcGreeks(S, K, T, sigma, isCall, r)
  if (!g) return null
  const prem = live ? live.mid : bsPrice(S, K, T, sigma, isCall, r)
  const be   = isCall ? K + prem : K - prem
  const fmt  = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })

  let patternClearance = null
  if (patternTarget != null) {
    patternClearance = isCall
      ? patternTarget - be
      : be - patternTarget
  }

  return {
    label,
    dte,
    expDate:          fmt,
    strike:           K,
    premium:          +prem.toFixed(2),
    contractCost:     Math.round(prem * 100),
    isCall,
    delta:            g.delta,
    gamma:            g.gamma,
    theta:            g.theta,
    vega:             g.vega,
    rho:              g.rho,
    probITM:          g.probITM,
    sigma:            ivUsed,
    expMove:          S * ivUsed * Math.sqrt(T),
    expMovePct:       ivUsed * Math.sqrt(T) * 100,
    breakEven:        be,
    bePct:            Math.abs(be - S) / S * 100,
    targetDelta,
    patternTarget,
    patternClearance,
    isLive:           !!live,
    bid:              live?.bid         ?? null,
    ask:              live?.ask         ?? null,
    oi:               live?.oi          ?? null,
    contractVol:      live?.vol         ?? null,
    spreadPct:        live?.spreadPct   ?? null,
    wideSpread:       live?.wideSpread  ?? false,
    gexWall:          null,
  }
}

// ── Multi-leg spread recommendations ─────────────────────────────────────────
// Returns debit spread, credit spread, and iron condor structures.
// The `recommended` field tells the UI which to highlight based on IV rank:
//   ivRank < 30  → outright (don't change existing recommendation)
//   ivRank 30-59 → debit spread (reduce premium paid)
//   ivRank ≥ 60  → credit spread (sell expensive premium)
//   ivRank ≥ 65 + direction === 'NO TRADE' → iron condor
export function generateSpreads(currentPrice, sigma, direction, ivRank, setupGrade, chainTimestamps = null) {
  if (!currentPrice || currentPrice <= 0) return null
  const isDirectional = direction === 'CALL' || direction === 'PUT'
  const isCall = direction === 'CALL'
  const S   = currentPrice
  const vol = Math.max(0.05, Math.min(sigma || 0.30, 2.0))
  const r   = 0.045

  const exps = chainTimestamps?.length
    ? chainDatesToExpiries(chainTimestamps)
    : getMonthlyExpirations(24)
  const now  = Date.now()
  const getDTE = d => Math.round((d.getTime() - now) / 86400000)
  const primaryMin = GRADE_PRIMARY_DTE[setupGrade] ?? 33
  const exp = exps.find(d => getDTE(d) >= primaryMin) ?? null
  if (!exp) return null

  const dteVal = getDTE(exp)
  const T   = dteVal / 365
  const fmt = exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  const inc = S < 10 ? 0.5 : S < 25 ? 1 : S < 75 ? 2.5 : S < 500 ? 5 : 10

  let debit = null, credit = null, ironCondor = null

  if (isDirectional) {
    // ── Debit vertical ────────────────────────────────────────────────────────
    // Buy near-ATM, sell OTM 2 strikes away (same type as signal direction)
    const dlongK  = strikeForDelta(S, T, vol, isCall, 0.47, r)
    const dshortK = isCall ? dlongK + inc * 2 : dlongK - inc * 2
    const dlongP  = bsPrice(S, dlongK,  T, vol, isCall, r)
    const dshortP = bsPrice(S, dshortK, T, vol, isCall, r)
    const dCost   = Math.max(0.01, +(dlongP - dshortP).toFixed(2))
    const dWidth  = Math.abs(dshortK - dlongK)
    const dMaxPft = Math.max(0, +(dWidth - dCost).toFixed(2))
    const dBE     = isCall ? +(dlongK + dCost).toFixed(2) : +(dlongK - dCost).toFixed(2)
    debit = {
      label:    isCall ? 'CALL DEBIT SPREAD' : 'PUT DEBIT SPREAD',
      buyType:  isCall ? 'CALL' : 'PUT',
      buyStrike: dlongK, sellStrike: dshortK,
      netCost: dCost, maxProfit: dMaxPft, maxLoss: dCost,
      breakEven: dBE, spreadWidth: dWidth,
      costPerContract:      Math.round(dCost   * 100),
      maxProfitPerContract: Math.round(dMaxPft * 100),
      bePct: Math.abs(dBE - S) / S * 100,
      profitRatio: dMaxPft > 0 ? +(dMaxPft / dCost).toFixed(1) : 0,
    }

    // ── Credit vertical ───────────────────────────────────────────────────────
    // CALL signal → bull put spread (sell OTM put, buy further OTM put)
    // PUT signal  → bear call spread (sell OTM call, buy further OTM call)
    const cType    = !isCall  // credit spread uses the opposite option type
    const csellK   = strikeForDelta(S, T, vol, cType, 0.30, r)
    const cbuyK    = cType ? csellK + inc * 2 : csellK - inc * 2
    const csellP   = bsPrice(S, csellK, T, vol, cType, r)
    const cbuyP    = bsPrice(S, cbuyK,  T, vol, cType, r)
    const cCredit  = Math.max(0.01, +(csellP - cbuyP).toFixed(2))
    const cWidth   = Math.abs(csellK - cbuyK)
    const cMaxLoss = Math.max(0, +(cWidth - cCredit).toFixed(2))
    const cBE      = cType
      ? +(csellK + cCredit).toFixed(2)   // bear call: BE = short call + credit
      : +(csellK - cCredit).toFixed(2)   // bull put:  BE = short put - credit
    credit = {
      label:      isCall ? 'BULL PUT SPREAD' : 'BEAR CALL SPREAD',
      sellType:   cType ? 'CALL' : 'PUT',
      sellStrike: csellK, buyStrike: cbuyK,
      netCredit: cCredit, maxProfit: cCredit, maxLoss: cMaxLoss,
      breakEven: cBE, spreadWidth: cWidth,
      creditPerContract:  Math.round(cCredit   * 100),
      maxLossPerContract: Math.round(cMaxLoss  * 100),
      bePct: Math.abs(cBE - S) / S * 100,
    }
  }

  // ── Iron Condor ────────────────────────────────────────────────────────────
  // Sell OTM put spread + OTM call spread — profits from time decay in a range
  const ipSellK = strikeForDelta(S, T, vol, false, 0.25, r)
  const ipBuyK  = ipSellK - inc * 2
  const icSellK = strikeForDelta(S, T, vol, true,  0.25, r)
  const icBuyK  = icSellK + inc * 2
  const ipSellP = bsPrice(S, ipSellK, T, vol, false, r)
  const ipBuyP  = bsPrice(S, ipBuyK,  T, vol, false, r)
  const icSellP = bsPrice(S, icSellK, T, vol, true,  r)
  const icBuyP  = bsPrice(S, icBuyK,  T, vol, true,  r)
  const icNetCr = Math.max(0.01, +((ipSellP - ipBuyP) + (icSellP - icBuyP)).toFixed(2))
  const icWidth = Math.max(Math.abs(ipSellK - ipBuyK), Math.abs(icBuyK - icSellK))
  const icLoss  = Math.max(0, +(icWidth - icNetCr).toFixed(2))
  ironCondor = {
    putSellStrike: ipSellK, putBuyStrike: ipBuyK,
    callSellStrike: icSellK, callBuyStrike: icBuyK,
    profitZone: [ipSellK, icSellK],
    netCredit: icNetCr, maxLoss: icLoss,
    creditPerContract:  Math.round(icNetCr * 100),
    maxLossPerContract: Math.round(icLoss  * 100),
  }

  // ── Pick the recommended structure ────────────────────────────────────────
  let recommended = 'outright'
  if (ivRank == null) {
    recommended = isDirectional ? 'debit' : 'ironCondor'
  } else if (!isDirectional && ivRank >= 45) {
    recommended = 'ironCondor'
  } else if (ivRank >= 60) {
    recommended = 'credit'
  } else if (ivRank >= 30) {
    recommended = 'debit'
  }

  return { recommended, expDate: fmt, dte: dteVal, ivRank, debit, credit, ironCondor }
}

// ── Main export ───────────────────────────────────────────────────────────────
// extras = { setupGrade, patternTarget, ivRank, chainTimestamps, liveContracts, gexData }
// liveContracts: per-expiry map from fetchOptionsChain.contracts
// gexData:       [{strike, gex}] array from fetchOptionsChain.gexData
export function generateRecommendations(currentPrice, sigma, direction, conviction = 'standard', extras = {}) {
  const {
    setupGrade = null, patternTarget = null, ivRank = null,
    chainTimestamps = null, liveContracts = null, gexData = null,
  } = extras

  if (!currentPrice || currentPrice <= 0 || !direction) return null

  const S      = currentPrice
  const vol    = Math.max(0.05, Math.min(sigma || 0.30, 2.0))
  const isCall = direction === 'CALL'
  const r      = 0.045
  const tDelta = CONVICTION_DELTA[conviction] ?? 0.47

  const exps = chainTimestamps?.length
    ? chainDatesToExpiries(chainTimestamps)
    : getMonthlyExpirations(24)
  const now  = Date.now()
  const dte  = d => Math.round((d.getTime() - now) / 86400000)

  // Build Date.getTime() → unix timestamp map so we can look up the right contracts bucket
  const expToTsMap = new Map()
  if (chainTimestamps?.length) {
    for (const ts of chainTimestamps) {
      expToTsMap.set(tsToLocalDate(ts).getTime(), ts)
    }
  }
  const expToTs = d => expToTsMap.get(d.getTime()) ?? null

  const primaryMin = GRADE_PRIMARY_DTE[setupGrade] ?? 33

  const isTopGrade = setupGrade === 'A+' || setupGrade === 'A'
  const quickExp   = isTopGrade
    ? (exps.find(d => dte(d) >= 10 && dte(d) <= 30) ?? null)
    : null

  const primaryExp = exps.find(d => dte(d) >= primaryMin && d !== quickExp) ?? null

  const extMin = primaryExp ? dte(primaryExp) + 20 : 55
  const extExp = exps.find(d => dte(d) >= extMin && d !== primaryExp && d !== quickExp) ?? null

  const primary = primaryExp
    ? makeRec('⭐ PRIMARY',    S, vol, isCall, primaryExp, expToTs(primaryExp), tDelta, patternTarget, r, liveContracts)
    : null
  const extended = extExp
    ? makeRec('📊 EXTENDED',  S, vol, isCall, extExp,     expToTs(extExp),     tDelta, patternTarget, r, liveContracts)
    : null
  const quickPlay = quickExp
    ? makeRec('⚡ QUICK PLAY', S, vol, isCall, quickExp,  expToTs(quickExp),   0.45,   patternTarget, r, liveContracts)
    : null

  // GEX wall check: flag if a significant GEX concentration sits between price and primary strike
  if (primary && gexData?.length) {
    const maxAbs = gexData.reduce((m, d) => Math.max(m, Math.abs(d.gex)), 1)
    const lo = Math.min(S, primary.strike)
    const hi = Math.max(S, primary.strike)
    const walls = gexData.filter(d => d.strike > lo && d.strike < hi && Math.abs(d.gex) >= maxAbs * 0.55)
    if (walls.length) {
      const top = walls.reduce((b, d) => Math.abs(d.gex) > Math.abs(b.gex) ? d : b)
      primary.gexWall = { strike: top.strike, gex: Math.round(top.gex), isHeadwind: true }
    }
  }

  return {
    primary,
    extended,
    quickPlay,
    direction,
    sigma:       vol,
    conviction,
    targetDelta: tDelta,
    setupGrade,
    ivRank,
  }
}
