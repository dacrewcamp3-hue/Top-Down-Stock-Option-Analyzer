import { useState, useEffect, useCallback } from 'react'
import './PlaybookPanel.css'

// ── Regime detection ─────────────────────────────────────────────────────────
function detectRegime(vixData, breadthData) {
  const vix     = vixData?.current ?? null
  const verdict = breadthData?.verdict ?? 'UNKNOWN'
  const spy     = breadthData?.spy
  if (!vix && verdict === 'UNKNOWN') return 'UNKNOWN'
  if (vix > 30 || verdict === 'HOSTILE') return 'BEAR'
  if (vix > 22 || verdict === 'LEANING BEARISH') return 'DEFENSIVE'
  if (spy?.above200 === false && spy?.above65 === false) return 'DEFENSIVE'
  if (vix != null && vix < 18 && (verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH')) return 'BULL'
  return 'NEUTRAL'
}

// ── ETF Playbooks ─────────────────────────────────────────────────────────────
const PLAYBOOKS = {
  BULL: {
    color: '#10b981', bg: '#011c10', border: '#065f46',
    label: 'BULL RUN',
    tagline: 'Market is in bull mode. Play the trend — buy dips to EMA 15 (Dad), not breakouts.',
    play: [
      { ticker: 'QQQ',  name: 'Nasdaq 100',          mult: '1×',  role: 'Core',     col: '#10b981',
        entry: 'Dip to Dad (EMA 15) while Sister (EMA 5) is rising and price is above Mom (EMA 65). DCA monthly regardless.',
        exit:  'Close below Brothers (EMA 30) — trim. Close below Mom (EMA 65) — exit entirely.',
        opt: { structure: 'Long Call', dte: '21–30', note: 'Buy dip entries. ATM call at the EMA 15 touch. Let the trend carry it.' } },
      { ticker: 'TQQQ', name: '3× Bull Nasdaq',       mult: '3×',  role: 'Leverage', col: '#34d399', risk: true,
        entry: 'High conviction only. Sister above Dad above Brothers — all three rising. Confirm QQQ above all 5 EMAs. Max 5% position.',
        exit:  'QQQ closes below Brothers (EMA 30) — exit immediately. No second chances.',
        opt: { structure: 'Call Debit Spread', dte: '14–21', note: 'Spread limits decay on 3× product. Buy ATM / sell +5% OTM. Defined risk only.' } },
      { ticker: 'SPY',  name: 'S&P 500',              mult: '1×',  role: 'Core',     col: '#6ee7b7',
        entry: 'DCA approach — fixed monthly amount on schedule regardless of price.',
        exit:  'SPY below Mom (EMA 65) — start trimming. SPY below Grandma (EMA 200) — full exit.',
        opt: { structure: 'Long Call', dte: '30–45', note: 'Longer DTE for trend continuation. ATM to slightly OTM. Sell half at +50% gain.' } },
      { ticker: 'UPRO', name: '3× Bull S&P 500',      mult: '3×',  role: 'Leverage', col: '#a7f3d0', risk: true,
        entry: 'Same as TQQQ but smoother — 500 stocks vs 100. SPY above all 5 EMAs stacked bull. Max 5%.',
        exit:  'SPY closes below Brothers (EMA 30) — exit. Grandma break = full regime change, out immediately.',
        opt: { structure: 'Call Debit Spread', dte: '14–21', note: 'Defined risk mandatory on 3× ETF. ATM / +5% OTM spread.' } },
      { ticker: 'SOXL', name: '3× Bull Semiconductors', mult: '3×', role: 'Leverage', col: '#d1fae5', risk: true,
        entry: 'Semis lead tech higher. NVDA and AMD both above EMA 65 (Mom). SOXX above all EMAs. Max 3%.',
        exit:  'SOXX index closes below EMA 30 — exit. Chip sector moves violently on news. Always use a stop.',
        opt: { structure: 'Call Debit Spread', dte: '14–21', note: 'Semis are volatile — wider spread ATM / +8% OTM. Small size.' } },
    ],
    avoid: ['SQQQ', 'SPXS', 'TZA', 'SDOW', 'SH', 'PSQ'],
    rules: [
      { icon: 'EMA',  rule: 'Entry confirmation: Sister (8) above Dad (15) above Brothers (30) — all rising = aligned bull momentum.' },
      { icon: 'DIP',  rule: 'Buy the dip to EMA 15 (Dad) or EMA 30 (Brothers), not breakouts to new highs.' },
      { icon: '5%',   rule: 'Max 5% in any single leveraged ETF. They decay hard in sideways or choppy markets.' },
      { icon: 'CUT',  rule: 'Exit leveraged positions the moment price closes below EMA 30 (Brothers). No second-guessing.' },
    ],
    optRegimeNote: 'BULL regime favors long calls and call debit spreads. Buy premium on EMA dips. Sell half at +50–100% and let the rest run.',
  },

  BEAR: {
    color: '#ef4444', bg: '#1a0505', border: '#7f1d1d',
    label: 'BEAR MARKET',
    tagline: 'Market is in bear mode. Inverse ETFs and defensive positioning only. Cash is a position.',
    play: [
      { ticker: 'SQQQ', name: '3× Bear Nasdaq',       mult: '3×',  role: 'Inverse',   col: '#ef4444', risk: true,
        entry: 'QQQ below Grandma (EMA 200) with VIX above 25. Enter on BOUNCE FAILURE — retest EMA 30 from below and gets rejected. Max 5%.',
        exit:  'QQQ closes above Mom (EMA 65) — exit immediately. VIX above 35 = do not chase.',
        opt: { structure: 'Call Debit Spread', dte: '14–21', note: 'Buy SQQQ call spread on bounce failures. ATM / +5% OTM. SQQQ already 3× — spread is mandatory.' } },
      { ticker: 'SPXS', name: '3× Bear S&P 500',      mult: '3×',  role: 'Inverse',   col: '#f87171', risk: true,
        entry: 'SPY below Grandma (EMA 200) and breadth HOSTILE. Enter on failed retest of EMA 30 as resistance. Max 5%.',
        exit:  'SPY reclaims Mom (EMA 65) on a daily close — exit immediately. Regime change signal.',
        opt: { structure: 'Call Debit Spread', dte: '14–21', note: 'Same approach as SQQQ — buy call spread on bounces. Defined risk only.' } },
      { ticker: 'TZA',  name: '3× Bear Russell 2000', mult: '3×',  role: 'Inverse',   col: '#fca5a5', risk: true,
        entry: 'IWM below all 5 EMAs with breadth HOSTILE. Small caps lead everything down. Max 3%.',
        exit:  'IWM reclaims EMA 30 on a close. Small caps also lead recoveries — exit fast when they turn.',
        opt: { structure: 'Call Debit Spread', dte: '14–21', note: 'Small caps volatile — wide spread ATM / +8% OTM. Small size mandatory.' } },
      { ticker: 'SH',   name: 'Inverse S&P 500 (1×)', mult: '-1×', role: 'Hedge',     col: '#fed7aa',
        entry: 'Safer bear play — no leverage decay. Better for multi-day positions or as a hedge on your long portfolio.',
        exit:  'SPY reclaims Grandma (EMA 200) — bear thesis over. Exit SH immediately.',
        opt: { structure: 'Long Call', dte: '30–45', note: '1× inverse — standard long call is fine. Less decay risk than leveraged products.' } },
      { ticker: 'GLD',  name: 'Gold ETF',              mult: '1×',  role: 'Safe Haven', col: '#fbbf24',
        entry: 'Fear trade. Hold 5-10% as insurance. Enter any time in BEAR regime.',
        exit:  'VIX falls below 18 and SPY reclaims EMA 65 — trim gold, rotate back toward equities.',
        opt: { structure: 'Long Call', dte: '30–45', note: 'Gold moves slowly — longer DTE avoids theta burn. ATM call. Do not spread your hedge.' } },
    ],
    avoid: ['QQQ', 'TQQQ', 'UPRO', 'SOXL', 'SPY long positions'],
    rules: [
      { icon: 'WAIT', rule: 'Enter inverse ETFs on BOUNCE FAILURES — when price retests EMA 30 from below and fails to hold.' },
      { icon: 'VIX',  rule: 'VIX above 35 = do not chase inverse ETFs. Extreme fear creates violent reversals.' },
      { icon: 'CASH', rule: 'Cash is a position. In a bear market, sometimes the right play is no play at all.' },
      { icon: 'CUT',  rule: 'Exit ALL inverse ETFs the moment SPY reclaims EMA 65 on a daily close. Regime is changing.' },
    ],
    optRegimeNote: 'BEAR regime: buy put debit spreads on SPY/QQQ bounces. VIX elevated = options expensive — prefer spreads over naked puts. Sell half at +50% quickly.',
  },

  DEFENSIVE: {
    color: '#f97316', bg: '#1a0800', border: '#7c2d12',
    label: 'DEFENSIVE MODE',
    tagline: 'Elevated risk — no leverage. Rotate to defensive sectors, hold cash, wait for clarity.',
    play: [
      { ticker: 'XLV',  name: 'Healthcare',         mult: '1×', role: 'Defensive', col: '#ec4899',
        entry: 'XLV above EMA 65 (Mom). Non-cyclical — people need medicine in every recession.',
        exit:  'Regime clears to BULL (VIX below 18, breadth FAVORABLE) — rotate back to QQQ and growth.',
        opt: { structure: 'Cash-Secured Put (sell)', dte: '21–30', note: 'Sell -4% OTM puts for income. Gets you long XLV cheaper if assigned — which is fine here.' } },
      { ticker: 'XLU',  name: 'Utilities',          mult: '1×', role: 'Defensive', col: '#f9a8d4',
        entry: 'Utilities above EMA 30 (Brothers). Pricing power and recurring dividends = stability.',
        exit:  'When XLK (Tech) starts outperforming — market rotating back to growth. Trim utilities.',
        opt: { structure: 'Cash-Secured Put (sell)', dte: '21–30', note: 'Sell -3% OTM puts. Low volatility = tighter strike still earns decent premium.' } },
      { ticker: 'XLP',  name: 'Consumer Staples',   mult: '1×', role: 'Defensive', col: '#fbcfe8',
        entry: 'P&G, Costco, Walmart. XLP above EMA 30 is the entry condition.',
        exit:  'Market regime clears to BULL. Consumer discretionary (XLY) leading = rotate out of staples.',
        opt: { structure: 'Cash-Secured Put (sell)', dte: '21–30', note: 'Income play. Stable premium on staples. Similar to XLU approach.' } },
      { ticker: 'GLD',  name: 'Gold ETF',           mult: '1×', role: 'Hedge',     col: '#fbbf24',
        entry: '5-10% position as insurance. VIX rising and breadth deteriorating = add to gold.',
        exit:  'VIX falls below 18 and SPY reclaims EMA 65. Fear fading — gold peaks as confidence returns.',
        opt: { structure: 'Long Call', dte: '30–45', note: 'Own calls outright — do not sell against your hedge. Longer DTE avoids burn.' } },
      { ticker: 'SCHD', name: 'Dividend ETF',       mult: '1×', role: 'Income',    col: '#f59e0b',
        entry: 'Income in any regime. DRIP on. Quarterly dividends keep compounding regardless of market direction.',
        exit:  'Never fully exit SCHD — permanent foundation layer. Only trim to rebalance allocation.',
        opt: { structure: 'Covered Call (sell)', dte: '21–30', note: 'Sell +3–4% OTM calls on your SCHD position. Collect income while holding the dividend.' } },
    ],
    avoid: ['TQQQ', 'SOXL', 'UPRO', 'SQQQ', 'SPXS', 'any 3× leveraged ETF'],
    rules: [
      { icon: 'ZERO', rule: 'Zero leveraged ETFs in DEFENSIVE regime. Volatility decay destroys leveraged positions in uncertain markets.' },
      { icon: 'CASH', rule: 'Raise cash by trimming your most aggressive positions down to core long-term sizes.' },
      { icon: 'DRIP', rule: 'Keep SCHD and dividend ETFs running with DRIP on. Income keeps compounding in any regime.' },
      { icon: 'WAIT', rule: 'Wait for VIX below 20 AND SPY reclaiming Grandma (EMA 200) before rotating back to growth ETFs.' },
    ],
    optRegimeNote: 'DEFENSIVE regime: sell premium — cash-secured puts on XLV/XLU/XLP to earn income while waiting. Covered calls on any equity you\'re holding long.',
  },

  NEUTRAL: {
    color: '#f59e0b', bg: '#1a1000', border: '#78350f',
    label: 'MIXED MARKET',
    tagline: 'Mixed signals — DCA into core ETFs, no leverage, wait for direction clarity from the EMA stack.',
    play: [
      { ticker: 'SPY',  name: 'S&P 500',      mult: '1×', role: 'Core',   col: '#f59e0b',
        entry: 'DCA fixed monthly amount on schedule. Mixed market is exactly why you hold the foundation.',
        exit:  'SPY below Mom (EMA 65) — reduce. SPY below Grandma (EMA 200) — reassess everything.',
        opt: { structure: 'Iron Condor', dte: '21–30', note: 'Sell premium while market decides. Profit if SPY stays in its current range. ±3–4% OTM wings.' } },
      { ticker: 'QQQ',  name: 'Nasdaq 100',   mult: '1×', role: 'Core',   col: '#fbbf24',
        entry: 'Hold existing position. Add on dips to EMA 65 only after Sister (EMA 5) has turned upward.',
        exit:  'QQQ below Grandma (EMA 200) — cut exposure. Shift to SCHD and defensive until regime clears.',
        opt: { structure: 'Iron Condor', dte: '21–30', note: 'Collect theta in choppy regime. Do not buy directional options — no trend to ride.' } },
      { ticker: 'SCHD', name: 'Dividend ETF', mult: '1×', role: 'Income', col: '#fde68a',
        entry: 'All-weather income position. DCA monthly. DRIP on.',
        exit:  'Never fully exit. SCHD is a permanent foundation — only trim to rebalance.',
        opt: { structure: 'Covered Call (sell)', dte: '21–30', note: 'Generate income while holding. Sell +3% OTM calls. Rinse and repeat monthly.' } },
      { ticker: 'VIG',  name: 'Dividend Growth ETF', mult: '1×', role: 'Income', col: '#fef3c7',
        entry: 'Growing dividends = financially strong companies. Resilient in mixed markets. Pair with SCHD.',
        exit:  'Only trim to rebalance. VIG is a core long-term hold across all regimes.',
        opt: { structure: 'Covered Call (sell)', dte: '21–30', note: 'Same approach as SCHD. Sell covered calls to earn while the market consolidates.' } },
    ],
    avoid: ['Any 3× leveraged ETF in either direction — wait for the regime to declare itself'],
    rules: [
      { icon: 'DCA',    rule: 'Dollar-cost average into SPY and QQQ on a fixed monthly schedule. Do not try to time the dip.' },
      { icon: 'ZERO',   rule: 'No leverage in NEUTRAL regime. Wait for a clear EMA stack alignment before adding risk.' },
      { icon: 'INCOME', rule: 'Dividend income from SCHD keeps compounding regardless. Reinvest every dividend automatically.' },
      { icon: 'ROTATE', rule: 'Check the Sectors tab — which sector is outperforming SPY? Tilt 10–15% toward that leadership.' },
    ],
    optRegimeNote: 'NEUTRAL regime: sell premium — iron condors on SPY/QQQ, covered calls on your holdings. Avoid buying directional options; no trend = theta decay kills you.',
  },

  UNKNOWN: {
    color: '#4a6888', bg: '#0a1020', border: '#1e3456',
    label: 'DATA LOADING',
    tagline: 'Fetch breadth data to unlock the regime playbook and ETF recommendations.',
    play: [], avoid: [],
    rules: [
      { icon: '→', rule: 'Go to Scanner → Market Scan → click Refresh Breadth to load the current regime and unlock this playbook.' },
    ],
    optRegimeNote: null,
  },
}

// ── Sector universe ───────────────────────────────────────────────────────────
const SECTOR_ETFS = ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLI', 'XLC', 'XLU', 'XLP']
const SECTOR_NAME = { XLK: 'Tech', XLF: 'Finance', XLV: 'Health', XLE: 'Energy', XLY: 'Cons. Disc', XLI: 'Industrial', XLC: 'Comm.', XLU: 'Utilities', XLP: 'Staples' }

const MOVER_UNIVERSE = [
  'SPY', 'QQQ', 'IWM',
  'TQQQ', 'SQQQ', 'UPRO', 'SPXS', 'SOXL', 'TZA',
  'XLV', 'XLU', 'XLP', 'XLK', 'XLF', 'XLE', 'XLY', 'XLI', 'XLC',
  'GLD', 'SCHD', 'VXX',
  'NVDA', 'AAPL', 'MSFT', 'META', 'TSLA', 'AMZN',
]

// ── Intelligence helpers ──────────────────────────────────────────────────────

function getRegimeTrigger(regime, vixData, breadthData) {
  const vix     = vixData?.current
  const verdict = breadthData?.verdict ?? ''
  const spy     = breadthData?.spy
  switch (regime) {
    case 'BULL':
      return `VIX ${vix?.toFixed(1) ?? '—'} (below 18) + ${verdict} breadth + SPY above all EMAs`
    case 'BEAR':
      if (vix != null && vix > 30) return `VIX ${vix.toFixed(1)} crossed the 30 threshold`
      if (verdict === 'HOSTILE')   return `Breadth HOSTILE — market internals deteriorated`
      return `VIX ${vix?.toFixed(1) ?? '—'} + ${verdict} breadth`
    case 'DEFENSIVE':
      if (spy?.above200 === false && spy?.above65 === false) return `SPY below EMA 65 and EMA 200 — structural breakdown`
      if (vix != null && vix > 22) return `VIX ${vix.toFixed(1)} crossed the 22 threshold`
      return `${verdict} breadth + elevated volatility`
    case 'NEUTRAL':
      return `Mixed signals — VIX ${vix?.toFixed(1) ?? '—'} in middle range + ${verdict} breadth`
    default: return null
  }
}

function getRegimeStability(regime, vixData, breadthData) {
  const vix = vixData?.current
  if (vix == null) return []
  const spy = breadthData?.spy
  const qq  = breadthData?.qq
  const items = []

  if (regime === 'BULL') {
    const buf = +(22 - vix).toFixed(1)
    items.push({ label: `VIX buffer to DEFENSIVE (22)`, value: `${buf} pts`, warn: buf < 2.5, color: buf < 2.5 ? '#f59e0b' : '#10b981' })
    if (qq?.above65 != null) items.push({ label: 'QQQ above Mom (EMA 65)', value: qq.above65 ? 'HOLDING' : 'BROKEN', warn: !qq.above65, color: qq.above65 ? '#10b981' : '#ef4444' })
    if (spy?.above15 != null) items.push({ label: 'SPY above Dad (EMA 15)', value: spy.above15 ? 'YES' : 'NO', warn: !spy.above15, color: spy.above15 ? '#10b981' : '#f59e0b' })
  } else if (regime === 'DEFENSIVE') {
    const buf = +(30 - vix).toFixed(1)
    items.push({ label: `VIX buffer to BEAR (30)`, value: `${buf} pts`, warn: buf < 3, color: buf < 3 ? '#ef4444' : '#f59e0b' })
    if (spy?.above200 != null) items.push({ label: 'SPY above Grandma (EMA 200)', value: spy.above200 ? 'HOLDING' : 'BROKEN', warn: !spy.above200, color: spy.above200 ? '#f59e0b' : '#ef4444' })
  } else if (regime === 'BEAR') {
    if (spy?.above200 != null) items.push({ label: 'SPY reclaim EMA 200?', value: spy.above200 ? '⚠ RECLAIMED — reassess' : 'Still below', warn: !!spy.above200, color: spy.above200 ? '#f59e0b' : '#ef4444' })
    if (spy?.above65 != null)  items.push({ label: 'SPY reclaim EMA 65?', value: spy.above65 ? '⚠ RECLAIMED — exit shorts' : 'Still below', warn: !!spy.above65, color: spy.above65 ? '#f59e0b' : '#ef4444' })
  } else if (regime === 'NEUTRAL') {
    const toBull = +(vix - 18).toFixed(1)
    const toDef  = +(22 - vix).toFixed(1)
    items.push({ label: 'VIX above BULL threshold (18)', value: `+${toBull} pts`, warn: false, color: '#f59e0b' })
    items.push({ label: 'VIX buffer to DEFENSIVE (22)', value: `${toDef} pts`, warn: toDef < 1.5, color: toDef < 1.5 ? '#ef4444' : '#f59e0b' })
  }
  return items
}

function getEntryMet(ticker, breadthData) {
  const qq  = breadthData?.qq
  const spy = breadthData?.spy
  const map = {
    'QQQ':  qq  ? !!(qq.above65)                            : null,
    'TQQQ': qq  ? !!(qq.above200 && qq.above65 && qq.above15) : null,
    'SPY':  spy ? !!(spy.above65)                           : null,
    'UPRO': spy ? !!(spy.above200 && spy.above65 && spy.above15) : null,
    'SOXL': qq  ? !!(qq.above200 && qq.above65)             : null,
    'SQQQ': qq  ? !!(qq && !qq.above200 && !qq.above65)     : null,
    'SPXS': spy ? !!(spy && !spy.above200 && !spy.above65)  : null,
    'TZA':  spy ? !!(spy && !spy.above65)                   : null,
    'SH':   spy ? !!(spy && !spy.above200)                  : null,
    'GLD': true, 'SCHD': true, 'VIG': true,
    'XLV': null, 'XLU': null, 'XLP': null,
  }
  return ticker in map ? map[ticker] : null
}

function computeStrikeRange(price, structure) {
  if (!price) return null
  const p = price
  switch (structure) {
    case 'Iron Condor':          return `$${Math.round(p * 0.96)} put / $${Math.round(p * 1.04)} call`
    case 'Call Debit Spread':    return `$${Math.round(p)} / $${Math.round(p * 1.05)} calls`
    case 'Long Call':            return `~$${Math.round(p)} (ATM)`
    case 'Long Put':             return `~$${Math.round(p)} (ATM)`
    case 'Cash-Secured Put (sell)': return `Sell ~$${Math.round(p * 0.96)} put`
    case 'Covered Call (sell)':  return `Sell ~$${Math.round(p * 1.03)} call`
    default:                     return null
  }
}

function buildConfluence(regime, gapResults, flowSentiment) {
  if (!gapResults?.length && !Object.keys(flowSentiment ?? {}).length) return []
  const isBull = regime === 'BULL' || regime === 'NEUTRAL'
  const isBear = regime === 'BEAR'
  if (!isBull && !isBear) return []

  const candidates = {}

  ;(gapResults ?? []).forEach(r => {
    const isUp    = r.gapPct > 0
    const aligned = (isBull && isUp) || (isBear && !isUp)
    if (!aligned) return
    const gc = r.gapClass ?? {}
    const gapScore = gc.type === 'BREAKAWAY' || gc.type === 'BREAKDOWN' ? 3
      : gc.type === 'CONTINUATION' ? 2
      : gc.type === 'EARNINGS' ? 2 : 0
    if (gapScore === 0) return
    candidates[r.ticker] ??= { ticker: r.ticker, score: 0, signals: [], gapData: null, flowData: null }
    candidates[r.ticker].score    += gapScore
    candidates[r.ticker].gapData   = r
    candidates[r.ticker].signals.push({
      label:  gc.type ?? 'GAP',
      detail: `${isUp ? '+' : ''}${r.gapPct.toFixed(1)}%`,
      color:  isUp ? '#10b981' : '#ef4444',
    })
  })

  Object.entries(flowSentiment ?? {}).forEach(([ticker, s]) => {
    const total = (s.callPrem ?? 0) + (s.putPrem ?? 0)
    if (total < 25_000) return
    const callRatio = (s.callPrem ?? 0) / total
    const flowBull  = callRatio > 0.60
    const flowBear  = callRatio < 0.40
    if (isBull && !flowBull) return
    if (isBear && !flowBear) return
    candidates[ticker] ??= { ticker, score: 0, signals: [], gapData: null, flowData: null }
    candidates[ticker].score    += 2
    candidates[ticker].flowData  = s
    candidates[ticker].signals.push({
      label:  flowBull ? `${Math.round(callRatio * 100)}% CALL FLOW` : `${Math.round((1 - callRatio) * 100)}% PUT FLOW`,
      detail: total >= 1_000_000 ? `$${(total / 1_000_000).toFixed(1)}M` : `$${Math.round(total / 1_000)}K`,
      color:  flowBull ? '#10b981' : '#ef4444',
    })
  })

  return Object.values(candidates)
    .filter(c => c.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
}

// ── Mover fetch ───────────────────────────────────────────────────────────────
async function fetchMover(ticker) {
  try {
    const res  = await fetch(`/yf-api/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`)
    if (!res.ok) return null
    const json = await res.json()
    const r    = json.chart?.result?.[0]
    if (!r) return null
    const q      = r.indicators?.quote?.[0] ?? {}
    const closes = (q.close  ?? []).filter(v => v != null)
    const vols   = q.volume  ?? []
    const n      = closes.length
    if (n < 2) return null
    const price   = closes[n - 1]
    const prevC   = closes[n - 2]
    const chg     = price - prevC
    const chgPct  = (chg / prevC) * 100
    const todVol  = vols[n - 1] ?? 0
    const avgVols = vols.slice(Math.max(0, n - 5), n - 1).filter(v => v != null)
    const avgVol  = avgVols.length ? avgVols.reduce((a, b) => a + b, 0) / avgVols.length : todVol
    const volRatio = avgVol > 0 ? todVol / avgVol : 1
    return { ticker, price: +price.toFixed(2), chg: +chg.toFixed(2), chgPct: +chgPct.toFixed(2), volRatio: +volRatio.toFixed(1) }
  } catch { return null }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PlaybookPanel({ breadthData, vixData, watchlist, gapResults, flowSentiment, onLoadTicker }) {
  const [movers,        setMovers]        = useState(null)
  const [moversLoading, setMoversLoading] = useState(false)
  const [lastFetched,   setLastFetched]   = useState(null)
  const [openPlay,      setOpenPlay]      = useState(null)
  const [moverView,     setMoverView]     = useState('gainers')

  const regime  = detectRegime(vixData, breadthData)
  const pb      = PLAYBOOKS[regime]
  const playSet = new Set(pb.play.map(e => e.ticker))

  const vix     = vixData?.current
  const verdict = breadthData?.verdict ?? 'UNKNOWN'
  const spy     = breadthData?.spy
  const qq      = breadthData?.qq
  const iwm     = breadthData?.iwm

  const regimeTrigger   = getRegimeTrigger(regime, vixData, breadthData)
  const stabilityItems  = getRegimeStability(regime, vixData, breadthData)
  const confluence      = buildConfluence(regime, gapResults, flowSentiment)

  const fetchMovers = useCallback(async () => {
    setMoversLoading(true)
    try {
      const results = await Promise.allSettled(MOVER_UNIVERSE.map(fetchMover))
      const data = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean)
        .sort((a, b) => b.chgPct - a.chgPct)
      setMovers(data)
      setLastFetched(new Date())
    } finally { setMoversLoading(false) }
  }, [])

  useEffect(() => { fetchMovers() }, [fetchMovers])

  // Sector tilt: rsProxy = sector chgPct - SPY chgPct
  const spyChg      = movers?.find(m => m.ticker === 'SPY')?.chgPct ?? 0
  const sectorTilt  = SECTOR_ETFS
    .map(t => { const m = movers?.find(x => x.ticker === t); return m ? { ...m, rsProxy: +(m.chgPct - spyChg).toFixed(2) } : null })
    .filter(Boolean)
    .sort((a, b) => b.rsProxy - a.rsProxy)

  const gainers  = movers?.filter(m => m.chgPct > 0)  ?? []
  const losers   = movers?.filter(m => m.chgPct < 0).slice().reverse() ?? []
  const displayed = moverView === 'gainers' ? gainers : moverView === 'losers' ? losers : (movers ?? [])

  return (
    <div className="pp-root">

      {/* ── 1. Regime Banner ── */}
      <div className="pp-regime" style={{ background: pb.bg, borderColor: pb.border }}>
        <div className="pp-regime-left">
          <div className="pp-regime-eyebrow">Current Market Regime</div>
          <div className="pp-regime-label" style={{ color: pb.color }}>{pb.label}</div>
          <div className="pp-regime-tagline">{pb.tagline}</div>
          {regimeTrigger && (
            <div className="pp-regime-trigger">
              <span className="pp-regime-trigger-lbl">Triggered by:</span> {regimeTrigger}
            </div>
          )}
        </div>
        <div className="pp-regime-right">
          <div className="pp-regime-chips">
            {vix != null && (
              <div className="pp-chip">
                <div className="pp-chip-lbl">VIX</div>
                <div className="pp-chip-val" style={{ color: vix < 15 ? '#10b981' : vix < 22 ? '#f59e0b' : '#ef4444' }}>{vix.toFixed(1)}</div>
                <div className="pp-chip-sub">{vixData?.level ?? ''}</div>
              </div>
            )}
            {verdict !== 'UNKNOWN' && (
              <div className="pp-chip">
                <div className="pp-chip-lbl">BREADTH</div>
                <div className="pp-chip-val" style={{ fontSize: 9, color: verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH' ? '#10b981' : verdict === 'HOSTILE' || verdict === 'LEANING BEARISH' ? '#ef4444' : '#f59e0b' }}>{verdict}</div>
              </div>
            )}
            {spy && (
              <div className="pp-chip">
                <div className="pp-chip-lbl">SPY</div>
                <div className="pp-chip-val">${spy.price?.toFixed(0) ?? '—'}</div>
                <div className="pp-ema-pips">
                  <span className={`pp-ema-pip ${spy.above200 ? 'bull' : 'bear'}`} title="EMA 200 — Grandma">G</span>
                  <span className={`pp-ema-pip ${spy.above65  ? 'bull' : 'bear'}`} title="EMA 65 — Mom">M</span>
                  <span className={`pp-ema-pip ${spy.above15  ? 'bull' : 'bear'}`} title="EMA 15 — Dad">D</span>
                </div>
              </div>
            )}
            {qq && (
              <div className="pp-chip">
                <div className="pp-chip-lbl">QQQ</div>
                <div className="pp-chip-val">${qq.price?.toFixed(0) ?? '—'}</div>
                <div className="pp-ema-pips">
                  <span className={`pp-ema-pip ${qq.above200 ? 'bull' : 'bear'}`} title="EMA 200 — Grandma">G</span>
                  <span className={`pp-ema-pip ${qq.above65  ? 'bull' : 'bear'}`} title="EMA 65 — Mom">M</span>
                  <span className={`pp-ema-pip ${qq.above15  ? 'bull' : 'bear'}`} title="EMA 15 — Dad">D</span>
                </div>
              </div>
            )}
            {iwm && (
              <div className="pp-chip">
                <div className="pp-chip-lbl">IWM</div>
                <div className="pp-chip-val">${iwm.price?.toFixed(0) ?? '—'}</div>
                <div className="pp-ema-pips">
                  <span className={`pp-ema-pip ${iwm.above200 ? 'bull' : 'bear'}`} title="EMA 200 — Grandma">G</span>
                  <span className={`pp-ema-pip ${iwm.above65  ? 'bull' : 'bear'}`} title="EMA 65 — Mom">M</span>
                  <span className={`pp-ema-pip ${iwm.above15  ? 'bull' : 'bear'}`} title="EMA 15 — Dad">D</span>
                </div>
              </div>
            )}
          </div>
          {/* Regime stability */}
          {stabilityItems.length > 0 && (
            <div className="pp-stability">
              {stabilityItems.map((s, i) => (
                <div key={i} className="pp-stab-item">
                  <span className="pp-stab-label">{s.label}</span>
                  <span className="pp-stab-val" style={{ color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Sector Leadership Strip ── */}
      {sectorTilt.length > 0 && (
        <div className="pp-section pp-sectors-section">
          <div className="pp-section-hdr">
            <div>
              <div className="pp-section-title">Sector Leadership — Today vs SPY</div>
              <div className="pp-section-sub">RS = today's return minus SPY's return. Green = outperforming, red = lagging. {regime === 'NEUTRAL' ? 'Tilt 10–15% toward the leading sector.' : ''}</div>
            </div>
          </div>
          <div className="pp-sector-strip">
            {sectorTilt.map(s => {
              const pos   = s.rsProxy >= 0
              const strong = Math.abs(s.rsProxy) >= 0.5
              return (
                <div key={s.ticker} className="pp-sector-chip" onClick={() => onLoadTicker?.(s.ticker)}>
                  <span className="pp-sc-ticker">{s.ticker}</span>
                  <span className="pp-sc-name">{SECTOR_NAME[s.ticker] ?? ''}</span>
                  <span className="pp-sc-rs" style={{ color: pos ? (strong ? '#10b981' : '#34d399') : (strong ? '#ef4444' : '#f87171') }}>
                    {pos ? '+' : ''}{s.rsProxy.toFixed(2)}%
                  </span>
                  <span className="pp-sc-chg" style={{ color: s.chgPct >= 0 ? '#4a8a68' : '#8a4a4a' }}>
                    {s.chgPct >= 0 ? '+' : ''}{s.chgPct.toFixed(2)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 3. Confluence Board ── */}
      <div className="pp-section">
        <div className="pp-section-hdr">
          <div>
            <div className="pp-section-title">Today's Confluence Board</div>
            <div className="pp-section-sub">
              Tickers where multiple signals converge: gap type + options flow direction both align with the current regime.
              {!gapResults?.length && !Object.keys(flowSentiment ?? {}).length && ' Run the Gap Scanner and visit the Live Flow tab to populate this board.'}
            </div>
          </div>
        </div>

        {confluence.length > 0 ? (
          <div className="pp-confluence-grid">
            {confluence.map(c => {
              const isUp  = (c.gapData?.gapPct ?? 0) >= 0 || regime === 'BULL' || regime === 'NEUTRAL'
              const score = c.score
              const tier  = score >= 5 ? 'HIGH' : score >= 3 ? 'MED' : 'LOW'
              const tierColor = tier === 'HIGH' ? '#f59e0b' : tier === 'MED' ? '#60a5fa' : '#4a6888'
              return (
                <div
                  key={c.ticker}
                  className="pp-conf-card"
                  style={{ borderColor: tierColor + '60' }}
                  onClick={() => onLoadTicker?.(c.ticker)}
                >
                  <div className="pp-conf-top">
                    <span className="pp-conf-ticker" style={{ color: isUp ? '#10b981' : '#ef4444' }}>{c.ticker}</span>
                    <span className="pp-conf-tier" style={{ color: tierColor, borderColor: tierColor + '60' }}>{tier} CONV.</span>
                  </div>
                  <div className="pp-conf-signals">
                    {c.signals.map((s, i) => (
                      <span key={i} className="pp-conf-signal" style={{ color: s.color }}>
                        {s.label} <span className="pp-conf-detail">{s.detail}</span>
                      </span>
                    ))}
                  </div>
                  {c.gapData?.orFormed && c.gapData?.orHigh != null && (
                    <div className="pp-conf-or">
                      OR: <strong>${c.gapData.orLow?.toFixed(2)}–${c.gapData.orHigh?.toFixed(2)}</strong> · click to analyze →
                    </div>
                  )}
                  {!c.gapData?.orFormed && c.gapData && (
                    <div className="pp-conf-or">Gap {c.gapData.gapPct > 0 ? '+' : ''}{c.gapData.gapPct.toFixed(1)}% · click to analyze →</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="pp-conf-empty">
            {(regime === 'BULL' || regime === 'BEAR')
              ? 'No high-confluence plays found yet. Run the Gap Scanner and let the Live Flow tab load to populate this board.'
              : 'Confluence board is most useful in BULL or BEAR regime. In mixed markets, focus on the ETF Playbook below.'}
          </div>
        )}
      </div>

      {/* ── 4. ETF Playbook ── */}
      {pb.play.length > 0 && (
        <div className="pp-section">
          <div className="pp-section-hdr">
            <div>
              <div className="pp-section-title">ETF Playbook — What to Play Right Now</div>
              <div className="pp-section-sub">Tap any ETF for entry signal, exit rules, condition status, and options setup. G = Grandma (EMA 200) · M = Mom (EMA 65) · D = Dad (EMA 15)</div>
            </div>
          </div>

          {pb.optRegimeNote && (
            <div className="pp-opt-regime-note">
              <span className="pp-opt-regime-lbl">OPTIONS APPROACH</span>
              <span className="pp-opt-regime-txt">{pb.optRegimeNote}</span>
            </div>
          )}

          <div className="pp-play-list">
            {pb.play.map(etf => {
              const isOpen   = openPlay === etf.ticker
              const entryMet = getEntryMet(etf.ticker, breadthData)
              const mover    = movers?.find(m => m.ticker === etf.ticker)
              const strikeRange = computeStrikeRange(mover?.price, etf.opt?.structure)

              return (
                <div
                  key={etf.ticker}
                  className={`pp-play-card${isOpen ? ' pp-play-open' : ''}`}
                  style={{ borderLeftColor: etf.col }}
                  onClick={() => setOpenPlay(isOpen ? null : etf.ticker)}
                >
                  <div className="pp-play-top">
                    <div className="pp-play-ticker" style={{ color: etf.col }}>{etf.ticker}</div>
                    <div className="pp-play-meta">
                      <div className="pp-play-name">{etf.name}</div>
                      <div className="pp-play-badges">
                        <span className="pp-play-role">{etf.role}</span>
                        <span className="pp-play-mult">{etf.mult}</span>
                        {etf.risk && <span className="pp-play-risk">HIGH RISK</span>}
                        {entryMet === true  && <span className="pp-entry-met">✓ READY</span>}
                        {entryMet === false && <span className="pp-entry-wait">✗ WAIT</span>}
                      </div>
                    </div>
                    {mover && (
                      <span className="pp-play-price" style={{ color: mover.chgPct >= 0 ? '#10b981' : '#ef4444' }}>
                        ${mover.price.toFixed(2)}
                        <span className="pp-play-chg"> {mover.chgPct >= 0 ? '+' : ''}{mover.chgPct.toFixed(2)}%</span>
                      </span>
                    )}
                    <span className="pp-play-arrow" style={{ color: etf.col }}>{isOpen ? '▲' : '▼'}</span>
                  </div>

                  {isOpen && (
                    <div className="pp-play-detail">
                      <div className="pp-play-row">
                        <span className="pp-play-lbl pp-entry-lbl">ENTRY</span>
                        <span className="pp-play-txt">{etf.entry}</span>
                      </div>
                      <div className="pp-play-row">
                        <span className="pp-play-lbl pp-exit-lbl">EXIT</span>
                        <span className="pp-play-txt">{etf.exit}</span>
                      </div>
                      {etf.opt && (
                        <div className="pp-opt-panel">
                          <div className="pp-opt-hdr">OPTIONS SETUP</div>
                          <div className="pp-opt-grid">
                            <div className="pp-opt-cell">
                              <span className="pp-opt-lbl">Structure</span>
                              <span className="pp-opt-val" style={{ color: pb.color }}>{etf.opt.structure}</span>
                            </div>
                            <div className="pp-opt-cell">
                              <span className="pp-opt-lbl">DTE</span>
                              <span className="pp-opt-val">{etf.opt.dte} days</span>
                            </div>
                            {strikeRange && (
                              <div className="pp-opt-cell">
                                <span className="pp-opt-lbl">Strike</span>
                                <span className="pp-opt-val" style={{ color: '#60a5fa' }}>{strikeRange}</span>
                              </div>
                            )}
                          </div>
                          <div className="pp-opt-note">{etf.opt.note}</div>
                        </div>
                      )}
                      {etf.risk && (
                        <div className="pp-risk-note">
                          Leveraged ETF — only enter with high conviction and a pre-set exit price. Size ≤5%. Never add to a losing position.
                        </div>
                      )}
                      {onLoadTicker && (
                        <button
                          className="pp-load-btn"
                          style={{ borderColor: etf.col, color: etf.col }}
                          onClick={e => { e.stopPropagation(); onLoadTicker(etf.ticker) }}
                        >
                          Analyze {etf.ticker} →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {pb.avoid.length > 0 && (
            <div className="pp-avoid">
              <span className="pp-avoid-lbl">AVOID IN THIS REGIME:</span>
              <div className="pp-avoid-tags">
                {pb.avoid.map((t, i) => <span key={i} className="pp-avoid-tag">{t}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 5. Regime Rules ── */}
      <div className="pp-section">
        <div className="pp-section-hdr">
          <div className="pp-section-title">Rules for This Regime</div>
        </div>
        <div className="pp-rules-grid">
          {pb.rules.map((r, i) => (
            <div key={i} className="pp-rule" style={{ borderLeftColor: pb.color }}>
              <div className="pp-rule-icon" style={{ color: pb.color }}>{r.icon}</div>
              <div className="pp-rule-text">{r.rule}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 6. Market Movers ── */}
      <div className="pp-section">
        <div className="pp-section-hdr">
          <div>
            <div className="pp-section-title">Market Movers — Today</div>
            <div className="pp-section-sub">
              {lastFetched
                ? `Updated ${lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${MOVER_UNIVERSE.length} symbols`
                : 'ETFs, sector rotation, and market leaders'}
            </div>
          </div>
          <button className="pp-refresh-btn" onClick={fetchMovers} disabled={moversLoading}>
            {moversLoading ? '…' : '↻ Refresh'}
          </button>
        </div>

        <div className="pp-mover-toggle">
          {[['gainers', 'Gainers'], ['losers', 'Losers'], ['all', 'All']].map(([v, lbl]) => (
            <button key={v} className={`pp-mv-btn${moverView === v ? ' active' : ''}`} onClick={() => setMoverView(v)}>{lbl}</button>
          ))}
        </div>

        {moversLoading && <div className="pp-movers-loading">Fetching prices…</div>}

        {!moversLoading && movers && (
          <div className="pp-movers-list">
            {displayed.map(m => {
              const isGain     = m.chgPct >= 0
              const col        = isGain ? '#10b981' : '#ef4444'
              const unusualVol = m.volRatio >= 2.0
              const highVol    = m.volRatio >= 1.5 && !unusualVol
              const inPlaybook = playSet.has(m.ticker)
              return (
                <div key={m.ticker} className="pp-mover-row" onClick={() => onLoadTicker?.(m.ticker)} title={`Click to analyze ${m.ticker}`}>
                  <span className="pp-mover-ticker">
                    {m.ticker}
                    {inPlaybook && <span className="pp-mover-pb" title="In current regime playbook" style={{ color: pb.color }}>●</span>}
                  </span>
                  <span className="pp-mover-price">${m.price.toFixed(2)}</span>
                  <span className="pp-mover-pct" style={{ color: col }}>{isGain ? '+' : ''}{m.chgPct.toFixed(2)}%</span>
                  <span className="pp-mover-chg" style={{ color: col }}>{isGain ? '+' : ''}{m.chg.toFixed(2)}</span>
                  {unusualVol && <span className="pp-mover-vol pp-vol-unusual">{m.volRatio.toFixed(1)}× vol</span>}
                  {highVol    && <span className="pp-mover-vol pp-vol-high">{m.volRatio.toFixed(1)}× vol</span>}
                </div>
              )
            })}
          </div>
        )}

        {!moversLoading && movers && movers.length === 0 && (
          <div className="pp-movers-empty">No price data available. Market may be closed.</div>
        )}
      </div>

    </div>
  )
}
