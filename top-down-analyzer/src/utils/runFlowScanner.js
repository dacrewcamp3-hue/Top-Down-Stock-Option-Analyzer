// Unusual options flow scanner.
// Fetches the nearest-expiration options chain for each ticker via Yahoo Finance
// and flags contracts where volume is disproportionately high relative to open interest
// and/or where the total premium dollar amount is large.
//
// Signals that are genuinely unusual:
//   Vol/OI >= 1.0  → more contracts traded today than total open positions (sweep)
//   Vol/OI >= 0.5  → half the open interest turned over in one session (heavy flow)
//   Total premium >= $50K → meaningful dollar commitment, not retail noise

import { fmtExpDate } from './fetchOptions'

const OPTIONS_BASE = '/yf-api/v7/finance/options'

function fmtPrem(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

async function fetchChain(ticker) {
  const res  = await fetch(`${OPTIONS_BASE}/${encodeURIComponent(ticker)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const r    = json.optionChain?.result?.[0]
  if (!r) throw new Error('No options data')

  const price = r.quote?.regularMarketPrice
  const calls = r.options?.[0]?.calls ?? []
  const puts  = r.options?.[0]?.puts  ?? []

  return { price, calls, puts }
}

function classify(contract, stockPrice, isCall) {
  const { strike, volume, openInterest, impliedVolatility, lastPrice, expiration, inTheMoney } = contract
  if (!volume || volume < 50 || !lastPrice || lastPrice <= 0) return null

  const oi       = openInterest || 0
  const volOI    = oi > 0 ? volume / oi : volume   // high = unusual
  const totalPrem = volume * lastPrice * 100        // total $ premium

  // Must clear at least one unusual threshold
  const isUnusual = volOI >= 0.5 || (volume >= 500 && totalPrem >= 25_000)
  if (!isUnusual) return null

  const daysToExp = Math.max(0, Math.round((expiration - Date.now() / 1000) / 86400))
  const pctOTM    = isCall
    ? ((strike - stockPrice) / stockPrice * 100)
    : ((stockPrice - strike) / stockPrice * 100)

  // Flow type
  let flowType, flowColor
  if (volOI >= 2.0) {
    flowType = 'SWEEP'; flowColor = '#f59e0b'
  } else if (volOI >= 1.0) {
    flowType = 'HEAVY';  flowColor = '#60a5fa'
  } else if (volOI >= 0.5) {
    flowType = 'ACTIVE'; flowColor = '#a0c0dc'
  } else {
    flowType = 'ELEV';   flowColor = '#6b7280'
  }

  // Bias: OTM + no hedge context = directional speculation
  const bias = inTheMoney ? 'HEDGE' : 'SPEC'

  return {
    type:       isCall ? 'CALL' : 'PUT',
    strike,
    expDate:    fmtExpDate(expiration),
    daysToExp,
    iv:         impliedVolatility != null ? Math.round(impliedVolatility * 100) : null,
    volume,
    oi,
    volOI:      +Math.min(volOI, 99).toFixed(2),
    premium:    lastPrice,
    totalPrem,
    totalPremFmt: fmtPrem(totalPrem),
    pctOTM:     +pctOTM.toFixed(1),
    inTheMoney: !!inTheMoney,
    flowType,
    flowColor,
    bias,
    stockPrice,
    score:      totalPrem * (volOI >= 1 ? 2 : 1),  // sort key
  }
}

export async function scanUnusualFlow(tickers, onProgress) {
  const results   = []
  const sentiment = {}   // { [ticker]: { callVol, putVol, callPrem, putPrem } }
  let errors = 0

  for (let i = 0; i < tickers.length; i++) {
    const sym = tickers[i]
    try {
      const { price, calls, puts } = await fetchChain(sym)

      let callVol = 0, putVol = 0, callPrem = 0, putPrem = 0

      for (const c of calls) {
        callVol  += c.volume || 0
        callPrem += (c.volume || 0) * (c.lastPrice || 0) * 100
        const scored = classify(c, price, true)
        if (scored) results.push({ ...scored, ticker: sym })
      }
      for (const p of puts) {
        putVol  += p.volume || 0
        putPrem += (p.volume || 0) * (p.lastPrice || 0) * 100
        const scored = classify(p, price, false)
        if (scored) results.push({ ...scored, ticker: sym })
      }

      sentiment[sym] = { callVol, putVol, callPrem, putPrem, price }
    } catch (_) { errors++ }

    onProgress(i + 1, tickers.length)
    if (i < tickers.length - 1) await new Promise(r => setTimeout(r, 300))
  }

  results.sort((a, b) => b.score - a.score)
  return { flows: results, sentiment, errors }
}
