// Full multi-expiry options chain fetch.
// Computes net Gamma Exposure (GEX) per strike, IV term structure, and P/C ratios.
// Uses the same Yahoo Finance proxy as fetchTicker.js.

import { calcGreeks, fmtExpDate } from './fetchOptions'

const OPTIONS_BASE = '/yf-api/v7/finance/options'

// Wraps fetch with a single auto-retry on 401/403.
// The Vite proxy's proxyRes handler clears the stale crumb on 401, so a brief
// delay ensures ensureCrumb() fires for the retry and injects a fresh crumb.
async function yfFetch(url) {
  const r = await fetch(url)
  if (!r.ok && (r.status === 401 || r.status === 403)) {
    await new Promise(res => setTimeout(res, 900))
    return fetch(url)
  }
  return r
}

// Filters strikes to ±30% of spot and sorts ascending
function filterStrikes(gexMap, S) {
  return Object.keys(gexMap)
    .map(Number)
    .filter(k => k >= S * 0.70 && k <= S * 1.30)
    .sort((a, b) => a - b)
}

// Accumulate GEX from one expiry block into the shared map
function accumulateGEX(gexMap, expiry, S) {
  const now = Date.now()
  const T = Math.max(1 / 365, (expiry.expirationDate * 1000 - now) / (365 * 86400000))

  for (const c of (expiry.calls ?? [])) {
    if (!c.impliedVolatility || c.impliedVolatility <= 0 || !c.openInterest || !c.strike) continue
    const g = calcGreeks(S, c.strike, T, Math.min(c.impliedVolatility, 4), true)
    if (!g) continue
    gexMap[c.strike] = (gexMap[c.strike] ?? 0) + g.gamma * c.openInterest * 100 * S
  }

  for (const p of (expiry.puts ?? [])) {
    if (!p.impliedVolatility || p.impliedVolatility <= 0 || !p.openInterest || !p.strike) continue
    const g = calcGreeks(S, p.strike, T, Math.min(p.impliedVolatility, 4), false)
    if (!g) continue
    // Put GEX is negative — MMs hedging short puts sells into price drops (destabilising)
    gexMap[p.strike] = (gexMap[p.strike] ?? 0) - g.gamma * p.openInterest * 100 * S
  }
}

// Build term-structure entry for one expiry block
function termEntry(expiry, S) {
  const now = Date.now()
  const dte = Math.round((expiry.expirationDate * 1000 - now) / 86400000)
  if (dte <= 0) return null

  const calls = expiry.calls ?? []
  const puts  = expiry.puts  ?? []

  const atmCall = calls
    .filter(c => c.impliedVolatility > 0 && c.openInterest > 0)
    .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0]
  const atmPut = puts
    .filter(p => p.impliedVolatility > 0 && p.openInterest > 0)
    .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0]

  const callIV = atmCall?.impliedVolatility ?? 0
  const putIV  = atmPut?.impliedVolatility  ?? 0
  const rawIV = callIV > 0 && putIV > 0
    ? (callIV + putIV) / 2
    : (callIV || putIV)
  if (rawIV <= 0) return null

  const totalCallOI  = calls.reduce((s, c) => s + (c.openInterest ?? 0), 0)
  const totalPutOI   = puts .reduce((s, p) => s + (p.openInterest ?? 0), 0)
  const totalCallVol = calls.reduce((s, c) => s + (c.volume ?? 0), 0)
  const totalPutVol  = puts .reduce((s, p) => s + (p.volume ?? 0), 0)

  // Positive skew = calls more expensive than puts = bullish demand
  // Negative skew = puts more expensive = bearish hedging / downside protection
  const ivSkewRaw = callIV > 0 && putIV > 0 ? callIV - putIV : null

  return {
    dte,
    expDate:     fmtExpDate(expiry.expirationDate, { month: 'short', day: 'numeric' }),
    iv:          +(rawIV * 100).toFixed(1),
    callIV:      callIV > 0 ? +(callIV * 100).toFixed(1) : null,
    putIV:       putIV  > 0 ? +(putIV  * 100).toFixed(1) : null,
    ivSkew:      ivSkewRaw != null ? +(ivSkewRaw * 100).toFixed(2) : null,
    pcOI:        totalCallOI  > 0 ? +(totalPutOI  / totalCallOI ).toFixed(2) : null,
    pcVol:       totalCallVol > 0 ? +(totalPutVol / totalCallVol).toFixed(2) : null,
    totalCallOI, totalPutOI, totalCallVol, totalPutVol,
  }
}

// Fetch one expiry block by its Unix timestamp
async function fetchExpiry(ticker, ts) {
  const r = await yfFetch(`${OPTIONS_BASE}/${encodeURIComponent(ticker)}?date=${ts}`)
  if (!r.ok) return null
  const j = await r.json()
  const opts = j?.optionChain?.result?.[0]?.options?.[0]
  if (!opts || (!opts.calls?.length && !opts.puts?.length)) return null
  return { ...opts, expirationDate: ts }
}

export async function fetchOptionsChain(ticker) {
  try {
    const baseRes = await yfFetch(`${OPTIONS_BASE}/${encodeURIComponent(ticker)}`)
    if (!baseRes.ok) return null
    const baseJson = await baseRes.json()
    const root = baseJson.optionChain?.result?.[0]
    if (!root) return null

    const S = root.quote?.regularMarketPrice
    if (!S) return null
    const quoteChange    = root.quote?.regularMarketChange ?? null
    // Yahoo's own pre-computed %, authoritative — avoids rounding errors in S - change
    const quoteChangePct = root.quote?.regularMarketChangePercent ?? null
    // Derive prevClose from Yahoo's own %, not from S - change (more accurate for low-price stocks)
    const quotePrevClose = quoteChangePct != null
      ? +(S / (1 + quoteChangePct / 100)).toFixed(4)
      : (quoteChange != null ? +(S - quoteChange).toFixed(4) : null)

    const expirationDates = root.expirationDates ?? []
    if (!expirationDates.length) return null

    // First expiry: try inline data first; if empty (stale crumb = Yahoo returns options:[])
    // immediately retry with an explicit ?date= request (crumb plugin re-injects crumb on that too)
    let firstExp = null
    const inlineOpts = root.options?.[0]
    if (inlineOpts?.calls?.length || inlineOpts?.puts?.length) {
      firstExp = { ...inlineOpts, expirationDate: expirationDates[0] }
    } else {
      // Base fetch returned empty options — fallback to explicit date fetch
      firstExp = await fetchExpiry(ticker, expirationDates[0]).catch(() => null)
    }

    // Fetch up to 4 more expiries in parallel
    const extraTs      = expirationDates.slice(1, 5)
    const extraResults = await Promise.allSettled(extraTs.map(ts => fetchExpiry(ticker, ts)))

    const allExpiries = [
      firstExp,
      ...extraResults.map(r => r.status === 'fulfilled' ? r.value : null),
    ].filter(Boolean)

    // Return a partial result even with only 1 expiry (better than null)
    if (!allExpiries.length) return { S, quotePrevClose, quoteChangePct, empty: true }

    // ── Per-expiry contract map (used by recommendation engine) ───────────────
    // Keyed by expirationDate Unix timestamp. Only liquid contracts (bid > 0) are kept.
    const contracts = {}
    for (const exp of allExpiries) {
      const ts = exp.expirationDate
      contracts[ts] = {
        calls: (exp.calls ?? [])
          .filter(c => c.strike > 0 && c.bid > 0)
          .map(c => ({
            strike: c.strike,
            bid:    +((c.bid  ?? 0).toFixed(2)),
            ask:    +((c.ask  ?? c.bid ?? 0).toFixed(2)),
            iv:     (c.impliedVolatility > 0 && c.impliedVolatility < 5) ? c.impliedVolatility : 0,
            oi:     c.openInterest ?? 0,
            vol:    c.volume       ?? 0,
          }))
          .sort((a, b) => a.strike - b.strike),
        puts: (exp.puts ?? [])
          .filter(p => p.strike > 0 && p.bid > 0)
          .map(p => ({
            strike: p.strike,
            bid:    +((p.bid  ?? 0).toFixed(2)),
            ask:    +((p.ask  ?? p.bid ?? 0).toFixed(2)),
            iv:     (p.impliedVolatility > 0 && p.impliedVolatility < 5) ? p.impliedVolatility : 0,
            oi:     p.openInterest ?? 0,
            vol:    p.volume       ?? 0,
          }))
          .sort((a, b) => a.strike - b.strike),
      }
    }

    // ── Max Pain + Call Wall + Put Wall ───────────────────────────────────────
    // Aggregate open interest per strike across ALL expiries
    const callOIMap = {}, putOIMap = {}
    for (const exp of allExpiries) {
      for (const c of (exp.calls ?? [])) {
        if (c.strike > 0 && (c.openInterest ?? 0) > 0)
          callOIMap[c.strike] = (callOIMap[c.strike] ?? 0) + c.openInterest
      }
      for (const p of (exp.puts ?? [])) {
        if (p.strike > 0 && (p.openInterest ?? 0) > 0)
          putOIMap[p.strike] = (putOIMap[p.strike] ?? 0) + p.openInterest
      }
    }
    const mpStrikes = [...new Set([...Object.keys(callOIMap), ...Object.keys(putOIMap)])]
      .map(Number).sort((a, b) => a - b)
    let maxPain = null
    if (mpStrikes.length) {
      let minPain = Infinity
      for (const K of mpStrikes) {
        let pain = 0
        for (const K2 of mpStrikes) {
          if (K2 < K) pain += (callOIMap[K2] ?? 0) * (K - K2) * 100
          if (K2 > K) pain += (putOIMap[K2]  ?? 0) * (K2 - K) * 100
        }
        if (pain < minPain) { minPain = pain; maxPain = K }
      }
    }
    const callWallEntry = Object.entries(callOIMap).sort(([,a],[,b]) => b - a)[0]
    const putWallEntry  = Object.entries(putOIMap ).sort(([,a],[,b]) => b - a)[0]
    const callWall    = callWallEntry ? +callWallEntry[0] : null
    const putWall     = putWallEntry  ? +putWallEntry[0]  : null
    const callWallOI  = callWallEntry ? callWallEntry[1]  : null
    const putWallOI   = putWallEntry  ? putWallEntry[1]   : null

    // ── Unusual Options Activity ──────────────────────────────────────────────
    const uoaList = []
    for (const exp of allExpiries) {
      const dte = Math.round((exp.expirationDate - Date.now() / 1000) / 86400)
      if (dte < 0) continue
      for (const c of (exp.calls ?? [])) {
        const vol = c.volume ?? 0; const oi = c.openInterest ?? 0
        if (vol >= 500 && oi > 0 && vol >= oi * 3)
          uoaList.push({ type: 'call', strike: c.strike, volume: vol, oi, ratio: +(vol / oi).toFixed(1), dte, pctFromSpot: +((c.strike - S) / S * 100).toFixed(1) })
      }
      for (const p of (exp.puts ?? [])) {
        const vol = p.volume ?? 0; const oi = p.openInterest ?? 0
        if (vol >= 500 && oi > 0 && vol >= oi * 3)
          uoaList.push({ type: 'put', strike: p.strike, volume: vol, oi, ratio: +(vol / oi).toFixed(1), dte, pctFromSpot: +((p.strike - S) / S * 100).toFixed(1) })
      }
    }
    const unusualActivity = uoaList.sort((a, b) => b.ratio - a.ratio).slice(0, 5)

    // ── GEX ────────────────────────────────────────────────────────────────────
    const gexMap = {}
    for (const exp of allExpiries) accumulateGEX(gexMap, exp, S)

    const strikes   = filterStrikes(gexMap, S)
    const gexData   = strikes.map(k => ({ strike: k, gex: gexMap[k] ?? 0 }))
    const maxAbsGEX = gexData.reduce((m, d) => Math.max(m, Math.abs(d.gex)), 1)

    // Gamma flip: strike where net GEX changes sign (interpolated)
    let gammaFlip = null
    for (let i = 1; i < gexData.length; i++) {
      const a = gexData[i - 1], b = gexData[i]
      if (Math.sign(a.gex) !== Math.sign(b.gex)) {
        const t = Math.abs(a.gex) / (Math.abs(a.gex) + Math.abs(b.gex))
        gammaFlip = +(a.strike + t * (b.strike - a.strike)).toFixed(2)
        break
      }
    }
    // Fallback: use the strike with smallest |GEX| as approximate flip
    if (!gammaFlip && gexData.length) {
      gammaFlip = gexData.reduce(
        (best, d) => Math.abs(d.gex) < Math.abs(best.gex) ? d : best
      ).strike
    }
    if (!gammaFlip) gammaFlip = S

    const totalNetGEX = gexData.reduce((s, d) => s + d.gex, 0)

    // ── Term structure ─────────────────────────────────────────────────────────
    const termStructure = allExpiries.map(e => termEntry(e, S)).filter(Boolean)

    // ── Aggregate P/C across all expiries ──────────────────────────────────────
    let totCallOI = 0, totPutOI = 0, totCallVol = 0, totPutVol = 0
    for (const exp of allExpiries) {
      for (const c of (exp.calls ?? [])) { totCallOI += c.openInterest ?? 0; totCallVol += c.volume ?? 0 }
      for (const p of (exp.puts  ?? [])) { totPutOI  += p.openInterest ?? 0; totPutVol  += p.volume ?? 0 }
    }

    return {
      S,
      quotePrevClose,   // prevClose derived from Yahoo's own changePct — most accurate source
      quoteChangePct,   // Yahoo's pre-computed regularMarketChangePercent — use directly in UI
      gexData,
      gammaFlip,
      totalNetGEX,
      maxAbsGEX,
      termStructure,
      expirationDates,   // raw Yahoo Finance Unix timestamps — used to snap recs to real expiries
      expiryCount: allExpiries.length,
      aggregatePCOI:  totCallOI  > 0 ? +(totPutOI  / totCallOI ).toFixed(2) : null,
      aggregatePCVol: totCallVol > 0 ? +(totPutVol / totCallVol).toFixed(2) : null,
      totalCallOI: totCallOI, totalPutOI: totPutOI,
      totalCallVol: totCallVol, totalPutVol: totPutVol,
      // IV lean from near-term expiry skew + aggregate flow
      ivLean: (() => {
        const near = termStructure[0]
        const pcv  = totCallVol > 0 ? totPutVol / totCallVol : null
        const skew = near?.ivSkew ?? null
        if (pcv == null && skew == null) return null
        // Skew: positive = calls pricier = bullish demand, negative = puts pricier = bearish hedge
        const skewBull = skew != null && skew > 0.5
        const skewBear = skew != null && skew < -0.5
        const flowBull = pcv != null && pcv < 0.75
        const flowBear = pcv != null && pcv > 1.30
        if (skewBull && flowBull) return { dir: 'bull', strength: 'strong',  pcv, skew }
        if (skewBear && flowBear) return { dir: 'bear', strength: 'strong',  pcv, skew }
        if (skewBull || flowBull) return { dir: 'bull', strength: 'mild',    pcv, skew }
        if (skewBear || flowBear) return { dir: 'bear', strength: 'mild',    pcv, skew }
        return { dir: 'neutral', strength: 'neutral', pcv, skew }
      })(),
      contracts,         // per-expiry liquid contract map used by recommendation engine
      maxPain,           // strike where options writers pay out the least (price gravity level)
      callWall, callWallOI, // highest aggregate call OI strike (resistance)
      putWall,  putWallOI,  // highest aggregate put OI strike (support)
      unusualActivity,   // strikes with volume >= 3× OI and >= 500 vol today
    }
  } catch (err) {
    console.warn('[fetchOptionsChain]', err.message)
    return null
  }
}
