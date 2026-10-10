import React, { useState, useEffect, useRef } from 'react'
import { generateRecommendations, bsPrice, calcGreeks } from '../utils/fetchOptions'
import { getUpcomingEvents } from '../utils/economicCalendar'
import GEXChart from './GEXChart'
import OptionsPnlGraph from './OptionsPnlGraph'
import './OptionsChain.css'

// ── Formatters ────────────────────────────────────────────────────────────────
const f0 = v => (v != null && !isNaN(v)) ? (+v).toFixed(0) : '—'
const f2 = v => (v != null && !isNaN(v)) ? (+v).toFixed(2) : '—'
const f4 = v => (v != null && !isNaN(v)) ? (+v).toFixed(4) : '—'
const fD = v => v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : '—'

// ── Conviction config ─────────────────────────────────────────────────────────
const CONVICTION = {
  conservative: { label: 'Conservative', delta: 0.35, color: '#6a90b0' },
  standard:     { label: 'Standard',     delta: 0.47, color: '#f59e0b' },
  aggressive:   { label: 'Aggressive',   delta: 0.62, color: '#ef4444' },
}

// ── IV-adaptive budget ────────────────────────────────────────────────────────
// When IV is expensive, we automatically reduce position sizing.
// When IV is cheap, we allow a slight size-up.
function ivBudget(maxRisk, ivRank) {
  if (ivRank == null) return { budget: maxRisk, note: null, warn: false }
  if (ivRank > 60) return {
    budget: maxRisk * 0.6,
    note:   `IV rank ${Math.round(ivRank)} — premium expensive, sized down 40%`,
    warn:   true,
  }
  if (ivRank < 30) return {
    budget: maxRisk * 1.2,
    note:   `IV rank ${Math.round(ivRank)} — premium cheap, slight size-up`,
    warn:   false,
  }
  return { budget: maxRisk, note: null, warn: false }
}

// ── Edge decay helper ─────────────────────────────────────────────────────────
function computeEdgeDecay(monthlyBreakdown, allTimeWinRate) {
  if (!monthlyBreakdown?.length) return { freshWR: null, allTimeWR: (allTimeWinRate ?? 50) / 100 }
  const sorted = [...monthlyBreakdown].sort((a, b) => {
    const ka = `${a.year}-${String(a.month).padStart(2,'0')}`
    const kb = `${b.year}-${String(b.month).padStart(2,'0')}`
    return ka < kb ? -1 : 1
  })
  const last3       = sorted.slice(-3)
  const totalTrades = last3.reduce((s, m) => s + m.count, 0)
  const totalWins   = last3.reduce((s, m) => s + m.wins,  0)
  if (totalTrades < 3) return { freshWR: null, allTimeWR: (allTimeWinRate ?? 50) / 100 }
  return { freshWR: totalWins / totalTrades, allTimeWR: (allTimeWinRate ?? 50) / 100 }
}

// ── Move distribution from backtest trades ────────────────────────────────────
function computeMoveDistribution(trades) {
  if (!trades?.length) return null
  const buckets = [
    { lo: -Infinity, hi: -10, label: '< −10%' },
    { lo: -10,       hi: -5,  label: '−10→−5%' },
    { lo: -5,        hi: 0,   label: '−5→0%' },
    { lo: 0,         hi: 5,   label: '0→+5%' },
    { lo: 5,         hi: 10,  label: '+5→+10%' },
    { lo: 10,        hi: Infinity, label: '> +10%' },
  ]
  const counts = buckets.map(() => 0)
  for (const t of trades) {
    for (let i = 0; i < buckets.length; i++) {
      if (t.gain >= buckets[i].lo && t.gain < buckets[i].hi) { counts[i]++; break }
    }
  }
  return buckets.map((b, i) => ({
    ...b,
    count: counts[i],
    pct:   Math.round(counts[i] / trades.length * 100),
  }))
}

// ── Median bars held (winning trades) ────────────────────────────────────────
function computeMedianBarsHeld(trades) {
  if (!trades?.length) return null
  const held = trades.filter(t => t.barsHeld != null).map(t => t.barsHeld).sort((a, b) => a - b)
  if (!held.length) return null
  return held[Math.floor(held.length / 2)]
}

// ── Multi-factor position sizing ──────────────────────────────────────────────
function computeMultiFactorBudget(maxRisk, ivRank, wyckoffData, backtestResult) {
  let mult = 1.0
  const factors = []

  // 1 — IV rank
  if (ivRank != null) {
    if (ivRank > 60) {
      mult *= 0.60
      factors.push({ name: 'High IV', detail: `rank ${Math.round(ivRank)}`, adj: 0.60, warn: true })
    } else if (ivRank < 30) {
      mult *= 1.20
      factors.push({ name: 'Low IV',  detail: `rank ${Math.round(ivRank)}`, adj: 1.20, warn: false })
    }
  }

  // 2 — Wyckoff range quality (0–1)
  const rq = wyckoffData?.rangeQuality
  if (rq != null) {
    const qMult = +(0.60 + rq * 0.60).toFixed(2)   // 0.60 @ rq=0 … 1.20 @ rq=1
    mult *= qMult
    factors.push({ name: 'Range quality', detail: `${Math.round(rq * 100)}%`, adj: qMult, warn: qMult < 0.75 })
  }

  // 3 — Edge freshness (last-3-month win rate vs all-time)
  if (backtestResult?.monthlyBreakdown?.length >= 3) {
    const { freshWR, allTimeWR } = computeEdgeDecay(backtestResult.monthlyBreakdown, backtestResult.winRate)
    if (freshWR != null && allTimeWR > 0) {
      const ratio = freshWR / allTimeWR
      if (ratio < 0.65) {
        mult *= 0.55
        factors.push({ name: 'Edge fading', detail: `${Math.round(freshWR * 100)}% recent vs ${Math.round(allTimeWR * 100)}% all-time`, adj: 0.55, warn: true })
      } else if (ratio > 1.25) {
        mult *= 1.10
        factors.push({ name: 'Hot streak', detail: `${Math.round(freshWR * 100)}% recent`, adj: 1.10, warn: false })
      }
    }
  }

  // 4 — Wyckoff spring/trend confirmation bonus
  if (wyckoffData?.spring?.confirmed && wyckoffData?.trendContext === 'UPTREND') {
    mult *= 1.10
    factors.push({ name: 'Spring + uptrend', detail: 'Wyckoff confirmed', adj: 1.10, warn: false })
  } else if (wyckoffData?.utad?.confirmed && wyckoffData?.trendContext === 'DOWNTREND') {
    mult *= 1.10
    factors.push({ name: 'UTAD + downtrend', detail: 'Wyckoff confirmed', adj: 1.10, warn: false })
  }

  const budget = maxRisk * Math.min(1.50, Math.max(0.20, mult))
  return { budget, mult: +mult.toFixed(2), factors, warn: factors.some(f => f.warn) }
}

// ── Grade × Regime conditional probability matrix ─────────────────────────────
function computeGradeRegime(trades) {
  if (!trades?.length) return null
  const grades  = ['A+', 'A', 'B']
  const regimes = ['bull', 'bear']
  const matrix  = {}
  for (const g of grades) {
    matrix[g] = {}
    for (const r of regimes) {
      const sub = trades.filter(t => t.grade === g && t.regime === r)
      if (!sub.length) { matrix[g][r] = null; continue }
      const wins = sub.filter(t => t.optWin)
      matrix[g][r] = {
        count:   sub.length,
        winRate: Math.round(wins.length / sub.length * 100),
        avgGain: +(sub.reduce((s, t) => s + t.optGainPct, 0) / sub.length).toFixed(1),
      }
    }
  }
  return matrix
}

// ── Historical optimal strike ─────────────────────────────────────────────────
function computeHistoricalStrike(trades, direction, currentPrice) {
  if (!trades?.length || !currentPrice) return null
  const wins      = trades.filter(t => t.win && t.signal === direction)
  if (!wins.length) return null
  const sorted    = wins.map(t => t.gain).sort((a, b) => a - b)
  const p25       = sorted[Math.floor(sorted.length * 0.25)]
  const p50       = sorted[Math.floor(sorted.length * 0.50)]
  const p75       = sorted[Math.floor(sorted.length * 0.75)]
  const optStrike = direction === 'CALL'
    ? Math.round(currentPrice * (1 + p50 / 100))
    : Math.round(currentPrice * (1 - p50 / 100))
  return { p25: +p25.toFixed(1), p50: +p50.toFixed(1), p75: +p75.toFixed(1), optStrike, wins: wins.length }
}

// ── Max Pain — strike where total option holder loss is maximized ─────────────
function calcMaxPain(contracts) {
  if (!contracts) return null
  const allCalls = [], allPuts = []
  for (const bucket of Object.values(contracts)) {
    for (const c of (bucket.calls ?? [])) allCalls.push(c)
    for (const p of (bucket.puts  ?? [])) allPuts.push(p)
  }
  if (!allCalls.length && !allPuts.length) return null
  const strikeSet = new Set([...allCalls.map(c => c.strike), ...allPuts.map(p => p.strike)])
  const strikes   = [...strikeSet].sort((a, b) => a - b)
  let minVal = Infinity, maxPainK = null
  for (const X of strikes) {
    let total = 0
    for (const c of allCalls) total += Math.max(0, X - c.strike) * (c.oi ?? 0)
    for (const p of allPuts)  total += Math.max(0, p.strike - X) * (p.oi ?? 0)
    if (total < minVal) { minVal = total; maxPainK = X }
  }
  return maxPainK
}

// ── Master Signal Warnings ────────────────────────────────────────────────────
function MasterSignalWarnings({ masterSignal }) {
  if (!masterSignal?.conflicts?.length) return null
  const blockMsg = masterSignal.blockReason

  return (
    <div style={{
      background: blockMsg ? '#0e0101' : '#080600',
      border: `1px solid ${blockMsg ? '#7f1d1d' : '#4d3000'}`,
      borderRadius: 8, padding: '10px 14px', marginBottom: 0,
    }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2,
        color: blockMsg ? '#ef4444' : '#f59e0b', textTransform: 'uppercase', marginBottom: 6 }}>
        {blockMsg ? '⛔ Signal Blocked' : '⚠ Signal Warnings'}
      </div>
      {blockMsg && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 5 }}>
          {blockMsg}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {masterSignal.conflicts.map((c, i) => (
          <div key={i} style={{ fontSize: 10, color: '#b0a070', lineHeight: 1.5 }}>
            · {c}
          </div>
        ))}
      </div>
      {masterSignal.confidence != null && !blockMsg && (
        <div style={{ fontSize: 9, color: '#4a6a8a', marginTop: 6 }}>
          Signal confidence: <span style={{
            fontWeight: 800,
            color: masterSignal.confidence >= 70 ? '#10b981'
                 : masterSignal.confidence >= 45 ? '#f59e0b'
                 : '#ef4444'
          }}>{masterSignal.confidence}/100</span>
        </div>
      )}
    </div>
  )
}

// ── Options Regime Classifier ─────────────────────────────────────────────────
function OptionsRegimeClassifier({ ivData, optionsChain, direction }) {
  if (!ivData && !optionsChain) return null

  const ivRank = ivData?.ivRank ?? null
  const ts     = optionsChain?.termStructure ?? []
  const lean   = optionsChain?.ivLean
  const gex    = optionsChain?.totalNetGEX
  const pcoi   = optionsChain?.aggregatePCOI

  const tsShape = (() => {
    if (ts.length < 2) return null
    const near = ts[0]?.iv, far = ts[ts.length - 1]?.iv
    if (near == null || far == null) return null
    return near > far * 1.05 ? 'backwardation' : far > near * 1.05 ? 'contango' : 'flat'
  })()

  let regime, color, bg, border, icon, meaning, action

  if (ivRank != null && ivRank > 70) {
    regime  = 'IV CRUSH RISK'
    color   = '#ef4444'
    bg      = '#0e0101'
    border  = '#7f1d1d'
    icon    = '⚠'
    meaning = `IV Rank ${Math.round(ivRank)} — options are historically expensive. Premium buyers are overpaying.`
    action  = 'Use spreads to cap your debit. Avoid naked long options until IV rank drops below 50.'
  } else if (gex != null && gex < -500000000) {
    regime  = 'NEGATIVE GAMMA REGIME'
    color   = '#f59e0b'
    bg      = '#0a0700'
    border  = '#78350f'
    icon    = '⚡'
    meaning = `Dealers are SHORT gamma (${(gex / 1e9).toFixed(1)}B). They must buy when price rises and sell when it falls — amplifying every move.`
    action  = 'Moves can be violent in either direction. Options premiums expand fast. Size down, use defined risk.'
  } else if (tsShape === 'backwardation') {
    regime  = 'VOLATILITY FEAR SPIKE'
    color   = '#ef4444'
    bg      = '#0e0101'
    border  = '#7f1d1d'
    icon    = '🔴'
    meaning = 'Near-term IV is higher than long-term IV. The market is pricing an imminent event or shock.'
    action  = 'Short-dated options are expensive. Buy longer DTE to avoid the fear premium. Consider waiting for the event to pass.'
  } else if (ivRank != null && ivRank < 20) {
    const isPrime = (direction === 'CALL' && lean?.dir === 'bull')
                 || (direction === 'PUT'  && lean?.dir === 'bear')
    regime  = isPrime ? 'IDEAL BUY CONDITIONS' : 'IV CHEAP — GOOD ENTRY WINDOW'
    color   = '#10b981'
    bg      = '#010e07'
    border  = '#065f46'
    icon    = '✓'
    meaning = `IV Rank ${Math.round(ivRank)} — options are historically cheap. You are not overpaying for premium.`
    action  = 'This is a favorable environment for buying directional options. Standard sizing applies.'
  } else if (tsShape === 'contango' && ivRank != null && ivRank < 45) {
    regime  = 'NORMAL CONDITIONS'
    color   = '#60a5fa'
    bg      = '#020810'
    border  = '#1e3456'
    icon    = '◉'
    meaning = 'Term structure is in normal contango. IV rank is moderate. No unusual pricing anomalies.'
    action  = 'Standard option buying strategy applies. Use the recommended DTE and conviction tier.'
  } else if (lean?.dir === 'bull' && lean?.strength === 'strong') {
    regime  = 'CALL SKEW ELEVATED'
    color   = '#a78bfa'
    bg      = '#070410'
    border  = '#4c1d95'
    icon    = '△'
    meaning = 'Call options carry significantly higher IV than puts. The market is pricing a bullish move or squeeze.'
    action  = 'Calls are relatively expensive. Put buyers get better pricing. Bullish bias confirmed by skew.'
  } else if (lean?.dir === 'bear' && lean?.strength === 'strong') {
    regime  = 'PUT SKEW ELEVATED'
    color   = '#f472b6'
    bg      = '#0e0108'
    border  = '#831843'
    icon    = '▽'
    meaning = 'Put options carry significantly higher IV than calls — the classic "fear premium." Hedging demand is elevated.'
    action  = 'Puts are relatively expensive. If buying puts, prefer spreads. Calls may be a better value play.'
  } else {
    regime  = 'BALANCED MARKET'
    color   = '#f59e0b'
    bg      = '#080600'
    border  = '#78350f'
    icon    = '—'
    meaning = `IV Rank ${ivRank != null ? Math.round(ivRank) : 'N/A'} — neutral conditions. No strong pricing anomaly detected.`
    action  = 'No regime edge in either direction. Focus on signal quality and position sizing.'
  }

  return (
    <div style={{
      background: bg, border: `1px solid ${border}`,
      borderRadius: 10, padding: '12px 16px', marginBottom: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: '#2a4060', textTransform: 'uppercase' }}>Options Regime</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: color,
              background: `${color}15`, border: `1px solid ${color}40`,
              borderRadius: 4, padding: '1px 7px',
            }}>{icon} {regime}</span>
          </div>
          <div style={{ fontSize: 12, color: '#b0c4d8', lineHeight: 1.6, marginBottom: 5 }}>{meaning}</div>
          <div style={{ fontSize: 11, color: color, fontWeight: 700, lineHeight: 1.5 }}>→ {action}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
          {ivRank != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a6a8a' }}>
              <span>IV Rank</span>
              <span style={{ fontWeight: 800, color: ivRank > 60 ? '#ef4444' : ivRank < 25 ? '#10b981' : '#f59e0b' }}>{Math.round(ivRank)}/100</span>
            </div>
          )}
          {tsShape && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a6a8a' }}>
              <span>Term Structure</span>
              <span style={{ fontWeight: 800, color: tsShape === 'backwardation' ? '#ef4444' : tsShape === 'contango' ? '#10b981' : '#f59e0b', textTransform: 'capitalize' }}>{tsShape}</span>
            </div>
          )}
          {lean?.dir && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a6a8a' }}>
              <span>IV Skew</span>
              <span style={{ fontWeight: 800, color: lean.dir === 'bull' ? '#10b981' : lean.dir === 'bear' ? '#ef4444' : '#f59e0b', textTransform: 'capitalize' }}>
                {lean.strength === 'strong' ? 'Strong ' : ''}{lean.dir}
              </span>
            </div>
          )}
          {gex != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a6a8a' }}>
              <span>GEX</span>
              <span style={{ fontWeight: 800, color: gex >= 0 ? '#10b981' : '#ef4444' }}>
                {gex >= 0 ? '+' : ''}{(gex / 1e9).toFixed(1)}B
              </span>
            </div>
          )}
          {pcoi != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a6a8a' }}>
              <span>P/C OI</span>
              <span style={{ fontWeight: 800, color: pcoi < 0.75 ? '#10b981' : pcoi > 1.3 ? '#ef4444' : '#f59e0b' }}>{pcoi.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Expected Move Visualizer ──────────────────────────────────────────────────
function ExpectedMoveVisualizer({ currentPrice, sigma, ivData }) {
  if (!currentPrice || !sigma) return null

  const DAILY_VOL = sigma / Math.sqrt(252)

  const horizons = [
    { label: '1 Week',  days: 7  },
    { label: '2 Weeks', days: 14 },
    { label: '1 Month', days: 30 },
    { label: '45 Days', days: 45 },
  ]

  const moves = horizons.map(h => {
    const move1s = currentPrice * DAILY_VOL * Math.sqrt(h.days)
    const move2s = move1s * 2
    return {
      ...h,
      move1s,
      move2s,
      lo1: currentPrice - move1s,
      hi1: currentPrice + move1s,
      lo2: currentPrice - move2s,
      hi2: currentPrice + move2s,
      pct1s: (move1s / currentPrice * 100),
    }
  })

  const iv = ivData?.atmIV ?? (sigma * 100)

  return (
    <div style={{
      background: '#030a14', border: '1px solid #0e1e30',
      borderRadius: 10, padding: '12px 16px', marginBottom: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: '#2a4060', textTransform: 'uppercase' }}>Expected Move</span>
          <span style={{ fontSize: 10, color: '#4a6a8a', marginLeft: 8 }}>from options-implied volatility ({iv.toFixed(1)}% IV)</span>
        </div>
        <div style={{ fontSize: 10, color: '#2a4060' }}>
          68% probability = 1σ · 95% probability = 2σ
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {moves.map(m => (
          <div key={m.label} style={{
            background: '#060d18', borderRadius: 8, padding: '10px 12px',
            border: '1px solid #0e1e30',
          }}>
            <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 6 }}>{m.label.toUpperCase()}</div>
            <div style={{ marginBottom: 5 }}>
              <div style={{ fontSize: 8, color: '#2a4060', marginBottom: 2 }}>68% chance stays between</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#60a5fa' }}>
                ${m.lo1.toFixed(2)} – ${m.hi1.toFixed(2)}
              </div>
              <div style={{ fontSize: 10, color: '#4a6a8a' }}>±{m.pct1s.toFixed(1)}%</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: '#2a4060', marginBottom: 2 }}>95% chance stays between</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#2a4060' }}>
                ${m.lo2.toFixed(2)} – ${m.hi2.toFixed(2)}
              </div>
              <div style={{ fontSize: 10, color: '#1a3050' }}>±{(m.pct1s * 2).toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: '#1a3050', marginTop: 8, lineHeight: 1.5 }}>
        These ranges are calculated from the options market's own implied volatility — not a price target.
        A 1σ range means the market is pricing a 68% probability that price stays inside those bounds over that timeframe.
        Wide ranges = high uncertainty. Narrow ranges = low volatility environment.
      </div>
    </div>
  )
}

// ── GEX Strike Bars (compact) ─────────────────────────────────────────────────
function GEXStripCompact({ optionsChain, currentPrice }) {
  if (!optionsChain?.contracts?.length || !currentPrice) return null

  const byStrike = {}
  for (const c of optionsChain.contracts) {
    if (!c.strike) continue
    const sk = c.strike
    if (!byStrike[sk]) byStrike[sk] = { strike: sk, net: 0 }
    const gexContrib = (c.gamma ?? 0) * (c.openInterest ?? 0) * 100 * currentPrice * currentPrice * 0.01
    if (c.type === 'call') byStrike[sk].net += gexContrib
    else                   byStrike[sk].net -= gexContrib
  }

  const rows = Object.values(byStrike)
    .filter(r => Math.abs(r.net) > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 8)

  if (!rows.length) return null

  const maxAbs = Math.max(...rows.map(r => Math.abs(r.net)))
  if (maxAbs === 0) return null

  rows.sort((a, b) => a.strike - b.strike)

  const keyStrikes = [
    optionsChain.callWall,
    optionsChain.putWall,
    optionsChain.maxPain,
  ].filter(Boolean)

  return (
    <div style={{
      background: '#030a14', border: '1px solid #0e1e30',
      borderRadius: 10, padding: '12px 16px', marginBottom: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: '#2a4060', textTransform: 'uppercase' }}>GEX by Strike</span>
          <span style={{ fontSize: 10, color: '#4a6a8a', marginLeft: 8 }}>Dealer gamma exposure — where price gets pinned or amplified</span>
        </div>
        <div style={{ fontSize: 9, color: '#2a4060' }}>
          <span style={{ color: '#10b981' }}>■</span> Long gamma (stabilizing){'  '}
          <span style={{ color: '#ef4444' }}>■</span> Short gamma (amplifying)
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(r => {
          const isPos   = r.net >= 0
          const barPct  = Math.abs(r.net) / maxAbs * 100
          const isCur   = Math.abs(r.strike - currentPrice) / currentPrice < 0.005
          const col     = isPos ? '#10b981' : '#ef4444'
          const label   = (() => {
            if (r.strike === optionsChain.callWall) return 'CALL WALL'
            if (r.strike === optionsChain.putWall)  return 'PUT WALL'
            if (r.strike === optionsChain.maxPain)  return 'MAX PAIN'
            return null
          })()

          return (
            <div key={r.strike} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: isCur ? '#030f20' : 'transparent',
              borderRadius: 4, padding: '2px 4px',
            }}>
              <div style={{ width: 54, fontSize: 11, fontWeight: 700,
                color: isCur ? '#60a5fa' : '#4a6a8a', textAlign: 'right', flexShrink: 0 }}>
                ${r.strike}
                {isCur && <span style={{ fontSize: 8, color: '#60a5fa', marginLeft: 3 }}>←</span>}
              </div>
              <div style={{ flex: 1, height: 14, background: '#0a1520', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                {isPos ? (
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%',
                    width: `${barPct}%`, background: `${col}66`, borderRadius: 3 }} />
                ) : (
                  <div style={{ position: 'absolute', right: 0, top: 0, height: '100%',
                    width: `${barPct}%`, background: `${col}66`, borderRadius: 3 }} />
                )}
              </div>
              <div style={{ width: 80, fontSize: 9, color: col, fontWeight: 700, flexShrink: 0 }}>
                {isPos ? '+' : ''}{(r.net / 1e6).toFixed(0)}M
                {label && <span style={{ fontSize: 8, color: '#2a4060', marginLeft: 4 }}>{label}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ fontSize: 10, color: '#1a3050', marginTop: 8, lineHeight: 1.5 }}>
        Positive GEX (green): dealers are long gamma here — they buy dips and sell rips, acting as a stabilizer.
        Negative GEX (red): dealers are short gamma — they must buy when price rises and sell when it falls, amplifying moves.
        The strike with the most positive GEX is a gravitational pin level.
      </div>
    </div>
  )
}

// ── Direction bar ─────────────────────────────────────────────────────────────
// ── Green Light Protocol ──────────────────────────────────────────────────────
// Unified go/no-go banner — checks all conditions before entry.
function GreenLightProtocol({ masterSignal, ivData, earningsDate, recs }) {
  if (!masterSignal) return null

  const now    = new Date()
  const etMin  = (now.getUTCHours() * 60 + now.getUTCMinutes() - 300 + 1440) % 1440
  const marketOpen = etMin >= 570 && etMin < 960        // 9:30am–4:00pm ET

  const inNoiseWin = marketOpen && ((etMin >= 570 && etMin < 600) || (etMin >= 930 && etMin < 960))  // 9:30-10, 3:30-4
  const events     = getUpcomingEvents(3)
  const hasCalRisk = events.some(e => ['FOMC', 'CPI'].includes(e.type) && e.daysAway <= 2)
  const ivRank     = ivData?.ivRank ?? null
  const ivOk       = ivRank == null || ivRank < 60
  const sigOk      = !masterSignal.blocked && !!masterSignal.direction
  const confOk     = (masterSignal.confidence ?? 0) >= 55
  const tfOk       = (masterSignal.tfScore    ?? 0) >= 3
  const earningsOk = !earningsDate || !recs?.primary
    ? true
    : Math.ceil((new Date(earningsDate) - now) / 86400000) > recs.primary.dte

  const checks = [
    { label: 'Signal not blocked',             ok: sigOk,        critical: true  },
    { label: `Confidence ≥55 (${masterSignal.confidence ?? '?'})`, ok: confOk, critical: false },
    { label: `TFs ≥3/4 (${masterSignal.tfScore ?? 0}/4)`,         ok: tfOk,   critical: false },
    { label: ivRank != null ? `IV rank <60 (${Math.round(ivRank)})` : 'IV rank unknown', ok: ivOk, critical: false },
    { label: 'No FOMC/CPI within 2 days',       ok: !hasCalRisk,  critical: true  },
    { label: inNoiseWin ? 'In noise window ⚠' : 'Outside noise window', ok: !inNoiseWin, critical: false },
    { label: 'No earnings in DTE window',        ok: earningsOk,   critical: true  },
  ]

  const hardFails  = checks.filter(c => c.critical && !c.ok)
  const totalFails = checks.filter(c => !c.ok)
  const allClear   = totalFails.length === 0

  const color  = allClear ? '#10b981' : hardFails.length ? '#ef4444' : '#f59e0b'
  const bg     = allClear ? '#001a0d' : hardFails.length ? '#1a0000' : '#100800'
  const border = allClear ? '#065f46' : hardFails.length ? '#7f1d1d' : '#78350f'
  const label  = !marketOpen
    ? (allClear ? '📋 PRE-MARKET PLAN — conditions clear' : hardFails.length ? '📋 PRE-MARKET PLAN — hard blocks present' : '📋 PRE-MARKET PLAN — review cautions before open')
    : (allClear ? '🟢 CLEARED TO ENTER' : hardFails.length ? '🔴 DO NOT ENTER' : '🟡 PROCEED WITH CAUTION')

  return (
    <div style={{ background: bg, border: `2px solid ${border}`, borderRadius: 8, padding: '10px 14px', margin: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.8, color }}>{label}</span>
        {totalFails.length > 0 && (
          <span style={{ fontSize: 10, color: '#64748b' }}>
            {totalFails.length} condition{totalFails.length > 1 ? 's' : ''} not met
          </span>
        )}
        {allClear && (
          <span style={{ fontSize: 10, color: '#065f46' }}>
            {marketOpen ? 'All conditions aligned — execute your plan.' : 'All conditions favorable — ready for market open.'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {checks.map((c, i) => (
          <span key={i} style={{
            fontSize: 9, padding: '2px 7px', borderRadius: 3, fontWeight: 600,
            background: c.ok ? '#011a0d' : '#1a0000',
            color:      c.ok ? '#10b981' : '#ef4444',
            border:     `1px solid ${c.ok ? '#065f46' : '#7f1d1d'}`,
          }}>
            {c.ok ? '✓' : '✗'} {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function SeverityDivider({ emoji, label, color, borderColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 6px' }}>
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
        color, padding: '2px 8px', background: 'rgba(0,0,0,0.5)',
        borderRadius: 3, border: `1px solid ${borderColor}`, whiteSpace: 'nowrap',
      }}>
        {emoji} {label}
      </span>
      <div style={{ flex: 1, height: 1, background: borderColor, opacity: 0.35 }} />
    </div>
  )
}

function SignalSummaryBar({ masterSignal, direction, conflict, sigmaLabel }) {
  if (!masterSignal && !direction && !conflict) return null
  const blocked  = masterSignal?.blocked || conflict
  const dir      = masterSignal?.direction ?? direction
  const conf     = masterSignal?.confidence
  const tfScore  = masterSignal?.tfScore
  const reason   = masterSignal?.blockReason

  const dirColor  = blocked ? '#ef4444' : dir === 'CALL' ? '#10b981' : dir === 'PUT' ? '#ef4444' : '#64748b'
  const dirBg     = blocked ? '#1a0000' : dir === 'CALL' ? '#001a0d' : dir === 'PUT' ? '#1a0000' : '#0a0f1a'
  const dirBorder = blocked ? '#7f1d1d' : dir === 'CALL' ? '#065f46' : dir === 'PUT' ? '#7f1d1d' : '#1e2d45'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
      padding: '7px 12px', margin: '6px 0 4px',
      background: dirBg, border: `1px solid ${dirBorder}`, borderRadius: 6,
      fontSize: 11,
    }}>
      <span style={{
        fontWeight: 800, fontSize: 12, letterSpacing: 1.2, color: dirColor,
        padding: '2px 10px', background: 'rgba(0,0,0,0.35)', borderRadius: 4,
        border: `1px solid ${dirBorder}`,
      }}>
        {blocked ? 'BLOCKED' : dir ?? 'NO TRADE'}
      </span>
      {conf != null && (
        <span style={{ color: conf >= 70 ? '#10b981' : conf >= 45 ? '#f59e0b' : '#ef4444' }}>
          {conf}/100 confidence
        </span>
      )}
      {tfScore != null && dir && (
        <>
          <span style={{ color: '#334155' }}>·</span>
          <span style={{ color: '#64748b' }}>{tfScore}/4 TFs aligned</span>
        </>
      )}
      {sigmaLabel && (
        <>
          <span style={{ color: '#334155' }}>·</span>
          <span style={{ color: '#475569' }}>{sigmaLabel}</span>
        </>
      )}
      {reason && (
        <>
          <span style={{ color: '#334155' }}>·</span>
          <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 700 }}>{reason}</span>
        </>
      )}
    </div>
  )
}

function DirBar({ direction, conflict, ticker, currentPrice, setupGrade, swingSignal, cfSignal }) {
  if (conflict) return (
    <div className="opt-dir-bar opt-dir-conflict">
      <span className="opt-dir-icon">⚠</span>
      <div className="opt-dir-body">
        <span className="opt-dir-label">CONFLICTED SIGNALS — DO NOT TRADE</span>
        <span className="opt-dir-sub">
          Timing says {swingSignal === 'LONG' ? 'go long' : swingSignal === 'EXIT' ? 'exit/short' : swingSignal} but Signals say {cfSignal} · wait for alignment before entering any option
        </span>
      </div>
    </div>
  )
  if (!direction) return (
    <div className="opt-dir-bar opt-dir-wait">
      <span className="opt-dir-icon">◷</span>
      <div className="opt-dir-body">
        <span className="opt-dir-label">NO SIGNAL YET</span>
        <span className="opt-dir-sub">Load a ticker to generate directional signals — recommendations appear automatically</span>
      </div>
    </div>
  )
  const isBull = direction === 'CALL'
  const clr    = isBull ? '#10b981' : '#ef4444'
  const bg     = isBull ? '#001a0d' : '#1a0000'
  const bord   = isBull ? '#064e2e' : '#6b0000'
  return (
    <div className="opt-dir-bar" style={{ background: bg, borderColor: bord }}>
      <span className="opt-dir-arrow" style={{ color: clr }}>{isBull ? '▲' : '▼'}</span>
      <div className="opt-dir-body">
        <span className="opt-dir-label" style={{ color: clr }}>BUY {direction}S · {ticker}</span>
        <span className="opt-dir-sub">
          ${f2(currentPrice)}
          {setupGrade && ` · Setup Grade ${setupGrade.grade}`}
          {swingSignal && ` · Timing: ${swingSignal === 'LONG' ? 'Entry triggered' : swingSignal === 'EXIT' ? 'Exit signal' : swingSignal}`}
          {cfSignal && cfSignal !== 'NO TRADE' && ` · Signals: ${cfSignal}`}
        </span>
      </div>
    </div>
  )
}

// ── IV rank banner ────────────────────────────────────────────────────────────
function IVRankBanner({ ivData }) {
  if (!ivData) return null
  const atm = ivData.atmIV != null ? (+ivData.atmIV).toFixed(1) : null
  if (ivData.ivRank == null) {
    if (!atm) return null
    return (
      <div className="opt-iv-bar" style={{ background: '#090d18', borderColor: '#1e2d45' }}>
        <div className="opt-iv-left">
          <span className="opt-iv-status" style={{ color: '#6a90b0' }}>IV DATA</span>
          <span className="opt-iv-msg">IV rank unavailable — need 5+ trading days of history</span>
        </div>
        <div className="opt-iv-right">
          <span className="opt-iv-atm">Market IV <strong>{atm}%</strong></span>
        </div>
      </div>
    )
  }
  const r    = ivData.ivRank
  const clr  = r < 30 ? '#10b981' : r < 60 ? '#f59e0b' : '#ef4444'
  const bg   = r < 30 ? '#001a0d' : r < 60 ? '#1a0f00' : '#1a0000'
  const bord = r < 30 ? '#064e2e' : r < 60 ? '#4d3000' : '#6b0000'
  const status = r < 30 ? 'IV CHEAP' : r < 60 ? 'IV MODERATE' : 'IV EXPENSIVE'
  return (
    <div className="opt-iv-bar" style={{ background: bg, borderColor: bord }}>
      <div className="opt-iv-left">
        <span className="opt-iv-status" style={{ color: clr }}>{status}</span>
      </div>
      <div className="opt-iv-right">
        {atm && <span className="opt-iv-atm">Market IV <strong>{atm}%</strong></span>}
        <span className="opt-iv-rank" style={{ color: clr }} data-tip="IV Rank: Where current Implied Volatility sits relative to its own 52-week range. 0 = cheapest IV of the year (best time to buy options). 100 = most expensive IV of the year (options are inflated — size down or wait). Below 30 is ideal for buying, above 60 means you're overpaying.">Rank {r}</span>
        {ivData.ivPct != null && <span className="opt-iv-pct">{ivData.ivPct}th pct</span>}
        <span className="opt-iv-samples">{ivData.samples}d hist</span>
      </div>
    </div>
  )
}

// ── Conviction toggle ─────────────────────────────────────────────────────────
function ConvictionBar({ conviction, onChange }) {
  return (
    <div className="opt-conviction-bar">
      <span className="opt-conv-label" data-tip="Conviction Level: How strongly you believe in this setup. Controls which Delta (moneyness) is targeted. Conservative (Δ0.35) = further out-of-the-money, cheaper premium, needs a larger stock move to profit. Standard (Δ0.45) = balanced. Aggressive (Δ0.62) = near the money, more expensive but responds immediately to stock movement. Only go Aggressive on A+ grade setups.">CONVICTION</span>
      {Object.entries(CONVICTION).map(([key, cfg]) => (
        <button
          key={key}
          className={`opt-conv-btn${conviction === key ? ' active' : ''}`}
          style={conviction === key ? { borderColor: cfg.color, color: cfg.color } : undefined}
          onClick={() => onChange(key)}
        >
          {cfg.label}
          <span className="opt-conv-delta"> Δ{cfg.delta}</span>
        </button>
      ))}
      <span className="opt-conv-note">
        Delta = how much the option moves per $1 stock move. Conservative (Δ0.35) = cheaper, needs bigger move. Aggressive (Δ0.62) = more expensive, responds faster.
      </span>
    </div>
  )
}

// ── Metric cell ───────────────────────────────────────────────────────────────
function Metric({ label, value, color, sub, subColor }) {
  return (
    <div className="opt-metric">
      <span className="opt-metric-lbl">{label}</span>
      <span className="opt-metric-val" style={color ? { color } : undefined}>{value}</span>
      {sub && <span className="opt-metric-sub" style={subColor ? { color: subColor } : undefined}>{sub}</span>}
    </div>
  )
}

// ── Greeks — compact single row ───────────────────────────────────────────────
function GreeksBar({ rec, highlightGamma = false }) {
  if (!rec) return null
  const { delta, gamma, theta, vega, probITM, premium, dte } = rec
  const deltaAbs   = Math.abs(delta ?? 0)
  const deltaOk    = deltaAbs >= 0.35 && deltaAbs <= 0.65
  const thetaDay   = Math.abs((theta ?? 0) * 100)
  const thetaPct   = premium > 0 ? thetaDay / (premium * 100) * 100 : 0
  const vegaAmt    = (vega ?? 0) * 100
  const nearExp    = dte <= 14
  const gammaTier  = !gamma ? 'LOW' : Math.abs(gamma) >= 0.05 ? 'HIGH' : Math.abs(gamma) >= 0.015 ? 'MOD' : 'LOW'
  const thetaLevel = thetaPct >= 3 ? 'fast' : thetaPct >= 1.2 ? 'moderate' : 'slow'

  return (
    <div className="opt-greeks-compact">
      <div className="opt-gkc-item">
        <span className="opt-gkc-sym" data-tip="Delta (Δ): How much the option price moves per $1 the stock moves. Δ0.50 means the option gains $50 per $1 stock move (100 shares per contract). Sweet spot for directional buyers: 0.35–0.65. ✓ means you're in the ideal range.">Δ</span>
        <span className="opt-gkc-val" style={{ color: deltaOk ? '#10b981' : '#f59e0b' }}>
          {fD(delta)}{deltaOk ? ' ✓' : ''}
        </span>
        <span className="opt-gkc-sub">${(deltaAbs * 100).toFixed(0)}/contract per $1</span>
      </div>
      <div className="opt-gkc-div" />
      <div className="opt-gkc-item">
        <span className="opt-gkc-sym" data-tip="Gamma (Γ): How fast your Delta changes as the stock moves. HIGH gamma near expiry means your position responds faster — powerful when right, dangerous when wrong. ⚡ = expiry within 14 days — expect wild swings in delta.">Γ</span>
        <span className="opt-gkc-val" style={{ color: gammaTier === 'HIGH' ? '#ef4444' : gammaTier === 'MOD' ? '#f59e0b' : '#6a90b0' }}>
          {gammaTier}{nearExp ? ' ⚡' : ''}{highlightGamma ? ' ★' : ''}
        </span>
        <span className="opt-gkc-sub">{f4(gamma)}</span>
      </div>
      <div className="opt-gkc-div" />
      <div className="opt-gkc-item">
        <span className="opt-gkc-sym" style={{ fontStyle: 'normal' }} data-tip="Vega (V): How much your option gains or loses per 1% change in Implied Volatility (IV). HIGH vega = your trade is very sensitive to changes in IV. Buy options when IV is low (IV Rank &lt;30) so rising IV works in your favor.">V</span>
        <span className="opt-gkc-val">+${vegaAmt.toFixed(2)}/1% IV</span>
        <span className="opt-gkc-sub">{vegaAmt >= 15 ? 'HIGH' : vegaAmt >= 6 ? 'MOD' : 'LOW'} vega</span>
      </div>
      <div className="opt-gkc-div" />
      <div className="opt-gkc-item">
        <span className="opt-gkc-sym" data-tip="Theta (Θ): Daily time decay cost. Every single day, this much dollar value bleeds out of your option — regardless of whether the stock moves. Accelerates exponentially as expiration approaches. 'fast' decay means the clock is working against you.">Θ</span>
        <span className="opt-gkc-val" style={{ color: thetaLevel === 'fast' ? '#ef4444' : thetaLevel === 'moderate' ? '#f59e0b' : '#10b981' }}>
          −${thetaDay.toFixed(2)}/day
        </span>
        <span className="opt-gkc-sub">{thetaPct.toFixed(1)}%/day · {thetaLevel}</span>
      </div>
      <div className="opt-gkc-div" />
      <div className="opt-gkc-item">
        <span className="opt-gkc-sym" data-tip="Probability ITM: The market-implied odds that this option expires in-the-money, derived from current IV and time to expiration. Above 50% means you're statistically on the favorable side. Options near 50% (Δ≈0.50) have the highest sensitivity to stock movement.">P</span>
        <span className="opt-gkc-val" style={{ color: probITM > 0.5 ? '#10b981' : '#6a90b0' }}>
          {(probITM * 100).toFixed(0)}%
        </span>
        <span className="opt-gkc-sub">prob ITM</span>
      </div>
    </div>
  )
}

// ── Scale-In Plan — compact ───────────────────────────────────────────────────
function ScaleInPlan({ qty, currentPrice, rec }) {
  if (!rec || qty < 1) return null
  const qtyN = Math.max(1, qty)
  const { premium, isCall } = rec
  const t1      = Math.ceil(qtyN / 2)
  const t2      = qtyN - t1
  const trigger = currentPrice ? +((isCall ? currentPrice * 1.01 : currentPrice * 0.99)).toFixed(2) : null
  const t2Max   = +(premium * 1.25).toFixed(2)

  return (
    <div className="opt-scale-compact">
      <span className="opt-scale-compact-title">SCALE-IN</span>
      {qtyN === 1
        ? <span>Single contract — enter in full at signal confirmation.</span>
        : <>
            <span><strong>T1:</strong> Buy {t1} now at signal</span>
            <span className="opt-scale-sep">·</span>
            <span><strong>T2:</strong> Add {t2} if {isCall ? 'above' : 'below'} ${trigger ?? '1% move'} and prem &lt; ${t2Max}</span>
          </>
      }
    </div>
  )
}

// ── Exit Plan — compact 4-cell grid ──────────────────────────────────────────
function ExitPlan({ rec, currentPrice, qty, setupGrade, adxSignal }) {
  const { premium, delta, isCall } = rec
  const qtyN       = Math.max(1, qty)
  const single     = qtyN === 1
  const stopPrem   = +(premium * 0.75).toFixed(2)
  const bePrem     = +(premium * 1.50).toFixed(2)
  const housePrem  = +(premium * 2.00).toFixed(2)
  const stopTotal  = (premium * 0.25 * 100 * qtyN).toFixed(0)
  const houseSell  = Math.ceil(qtyN / 2)
  const houseKeep  = qtyN - houseSell

  const beMove     = (bePrem - premium) / Math.abs(delta ?? 0.45)
  const houseMove  = (housePrem - premium) / Math.abs(delta ?? 0.45)
  const beStock    = currentPrice ? +((isCall ? currentPrice + beMove   : currentPrice - beMove)).toFixed(2)   : null
  const houseStock = currentPrice ? +((isCall ? currentPrice + houseMove : currentPrice - houseMove)).toFixed(2) : null

  return (
    <div className="opt-exit-compact">
      <div className="opt-exit-compact-title">EXIT PLAN</div>
      <div className="opt-exit-compact-grid">
        <div className="opt-exit-cell opt-exit-cell-stop">
          <span className="opt-exit-cell-num">1</span>
          <span className="opt-exit-cell-label">STOP −25%</span>
          <span className="opt-exit-cell-price">${stopPrem}/sh</span>
          <span className="opt-exit-cell-note">Close all · −${(+stopTotal).toLocaleString()}</span>
        </div>
        <div className="opt-exit-cell opt-exit-cell-be">
          <span className="opt-exit-cell-num">2</span>
          <span className="opt-exit-cell-label">BE +50%</span>
          <span className="opt-exit-cell-price">${bePrem}/sh</span>
          <span className="opt-exit-cell-note">
            Raise stop to entry{beStock ? ` · stk ~$${beStock}` : ''}
          </span>
        </div>
        <div className="opt-exit-cell opt-exit-cell-house">
          <span className="opt-exit-cell-num">3</span>
          <span className="opt-exit-cell-label">HOUSE +100%</span>
          <span className="opt-exit-cell-price">${housePrem}/sh</span>
          <span className="opt-exit-cell-note">
            {single
              ? 'Take full profit or raise stop'
              : `Sell ${houseSell} · ${houseKeep} free${houseStock ? ` · stk ~$${houseStock}` : ''}`
            }
          </span>
        </div>
        <div className="opt-exit-cell opt-exit-cell-trail">
          <span className="opt-exit-cell-num">4</span>
          <span className="opt-exit-cell-label">TRAIL 25%</span>
          <span className="opt-exit-cell-price">high × 75%</span>
          <span className="opt-exit-cell-note">
            {single ? 'Optional — raise stop to entry' : `${houseKeep} free contract${houseKeep > 1 ? 's' : ''} trail`}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Earnings warning ───────────────────────────────────────────────────────────
function EarningsWarning({ earningsDate, recs }) {
  if (!earningsDate) return null
  const daysAway = Math.round((earningsDate.getTime() - Date.now()) / 86400000)
  if (daysAway < 0 || daysAway > 60) return null

  const recList = recs ? [recs.primary, recs.extended, recs.quickPlay].filter(Boolean) : []
  const spansEarnings = recList.some(r => r.dte >= daysAway)
  if (!spansEarnings && daysAway > 21) return null

  const dateStr  = earningsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const critical = daysAway <= 14
  const clr      = critical ? '#ef4444' : '#f59e0b'
  const bg       = critical ? '#1a0202' : '#1a1000'
  const bord     = critical ? '#7f1d1d' : '#b45309'

  return (
    <div className="opt-earnings-warn" style={{ background: bg, borderColor: bord }}>
      <span className="opt-earnings-icon" style={{ color: clr }}>⚠</span>
      <div className="opt-earnings-body">
        <span className="opt-earnings-title" style={{ color: clr }}>
          EARNINGS {dateStr} · {daysAway}d away
        </span>
        <span className="opt-earnings-sub">
          {spansEarnings
            ? `One or more recommended expirations fall AFTER earnings. Single-leg options through an earnings event become a volatility bet, not a directional one — your technical edge disappears. Either close before ${dateStr} or use a defined-risk spread.`
            : `Earnings within 3 weeks. Monitor your position and consider closing before ${dateStr} to avoid event risk.`
          }
        </span>
      </div>
    </div>
  )
}

// ── High-IV debit spread suggestion ──────────────────────────────────────────
function SpreadAlert({ ivRank, direction, currentPrice, sigma, recs }) {
  if (!ivRank || ivRank <= 45 || !direction || !currentPrice) return null
  const isCall     = direction === 'CALL'
  const S          = currentPrice
  const iv         = sigma ?? 0.30

  // Use primary rec strike/dte if available, otherwise estimate
  const primaryRec = recs?.primary
  const inc        = S < 10 ? 0.5 : S < 25 ? 1 : S < 75 ? 2.5 : S < 500 ? 5 : 10
  const longK      = primaryRec?.strike ?? (Math.round(S / inc) * inc)
  const dte        = primaryRec?.dte ?? 21
  const T          = dte / 365
  const shortK     = isCall ? longK + inc * 2 : longK - inc * 2
  const width      = Math.abs(shortK - longK)
  const spreadType = isCall ? 'Bull Call Spread' : 'Bear Put Spread'

  const outrightPrem = bsPrice(S, longK, T, iv, isCall)
  const shortPrem    = bsPrice(S, shortK, T, iv, isCall)
  const debit        = Math.max(0, outrightPrem - shortPrem)
  const maxGain      = width - debit
  const savingsPct   = outrightPrem > 0.01 ? Math.round((1 - debit / outrightPrem) * 100) : null
  const severity     = ivRank >= 70 ? 'VERY HIGH' : ivRank >= 55 ? 'HIGH' : 'ELEVATED'

  return (
    <div className="opt-spread-alert">
      <div className="opt-spread-title">
        {severity} IV (Rank {Math.round(ivRank)}) — CONSIDER A DEBIT SPREAD
      </div>
      <div className="opt-spread-body">
        <p className="opt-spread-text">
          When IV is elevated, you're overpaying for the option's "fear premium." If IV drops after you enter —
          even if the stock moves your way — the option can still lose value (IV crush). A <strong>{spreadType}</strong>{' '}
          sells the excess IV against you, cutting your cost{savingsPct != null ? ` by ~${savingsPct}%` : ' by 30–60%'}{' '}
          and making the trade far more resilient to an IV drop.
        </p>
        <div className="opt-spread-example">
          <span className="opt-spread-eg-lbl">Estimated structure · {dte}d to expiry</span>
          <div className="opt-spread-pricing">
            <div className="opt-spread-price-row">
              <span className="opt-spread-price-lbl">Outright {isCall ? 'call' : 'put'} (${longK})</span>
              <span className="opt-spread-price-val">${outrightPrem.toFixed(2)} / share · ${(outrightPrem * 100).toFixed(0)}/contract</span>
            </div>
            <div className="opt-spread-price-row opt-spread-short-row">
              <span className="opt-spread-price-lbl">Sell ${shortK} {isCall ? 'call' : 'put'} (OTM hedge)</span>
              <span className="opt-spread-price-val">−${shortPrem.toFixed(2)} / share</span>
            </div>
            <div className="opt-spread-price-row opt-spread-net-row">
              <span className="opt-spread-price-lbl">Net debit (what you pay)</span>
              <span className="opt-spread-price-val opt-spread-net-val">${debit.toFixed(2)} / share · ${(debit * 100).toFixed(0)}/contract</span>
            </div>
          </div>
          <span className="opt-spread-eg-note">
            Max risk = ${debit.toFixed(2)} (debit paid) · Max gain = ${maxGain.toFixed(2)} (${width} spread − debit) · Capped upside, lower cost
          </span>
        </div>
      </div>
    </div>
  )
}

// ── P&L Scenario Table ────────────────────────────────────────────────────────
function PnLScenarios({ rec, currentPrice, qty, backtestResult }) {
  const { strike, dte, premium, isCall, sigma: sig } = rec
  const T    = dte / 365
  const qtyN = Math.max(1, qty)

  const scenarios = isCall
    ? [-0.10, -0.05, 0, +0.05, +0.10, +0.15]
    : [+0.10, +0.05, 0, -0.05, -0.10, -0.15]

  // Build move distribution from backtest trades for frequency column
  const moveDist = backtestResult?.trades?.length
    ? computeMoveDistribution(backtestResult.trades)
    : null

  // Map each scenario pct to the closest distribution bucket
  const getFreq = pct => {
    if (!moveDist) return null
    const pctVal = pct * 100
    // Each scenario pct maps to the bucket that contains it
    for (const b of moveDist) {
      if (pctVal >= b.lo && pctVal < b.hi) return b
    }
    // Edge: exactly at the last hi
    if (pctVal >= moveDist[moveDist.length - 1].hi) return moveDist[moveDist.length - 1]
    return null
  }

  return (
    <div className="opt-pnl-wrap">
      <div className="opt-pnl-header">
        <span className="opt-pnl-title">P&amp;L Scenarios — Primary Pick</span>
        <span className="opt-pnl-sub">{qtyN} contract{qtyN > 1 ? 's' : ''} · {dte} days to expiry</span>
        {moveDist && <span className="opt-pnl-freq-note">· Historical freq. column from {backtestResult.trades.length} backtest trades</span>}
      </div>
      <div className={`opt-pnl-table${moveDist ? ' opt-pnl-table-freq' : ''}`}>
        <div className="opt-pnl-row opt-pnl-hdr">
          <span>Stock Move</span>
          {moveDist && <span>Hist. Freq.</span>}
          <span>Stock Price</span>
          <span>Value Now (est.)</span>
          <span>At Expiry</span>
          <span>P&amp;L / Contract</span>
          <span>Total P&amp;L</span>
        </div>
        {scenarios.map(pct => {
          const sNew      = currentPrice * (1 + pct)
          const nowVal    = bsPrice(sNew, strike, T, sig, isCall)
          const intrinsic = isCall
            ? Math.max(0, sNew - strike)
            : Math.max(0, strike - sNew)
          const plPer     = (intrinsic - premium) * 100
          const plTotal   = plPer * qtyN
          const isWin     = plPer > 0
          const isCurrent = pct === 0
          const freq      = getFreq(pct)

          return (
            <div key={pct} className={`opt-pnl-row${isCurrent ? ' opt-pnl-current' : ''}${isWin ? ' opt-pnl-win' : ' opt-pnl-loss'}`}>
              <span style={{ color: pct > 0 ? '#10b981' : pct < 0 ? '#ef4444' : '#a0c0dc', fontWeight: 600 }}>
                {pct >= 0 ? '+' : ''}{(pct * 100).toFixed(0)}%
                {isCurrent && <span className="opt-pnl-now"> TODAY</span>}
              </span>
              {moveDist && (
                <span className="opt-pnl-freq" title={`${freq?.count ?? 0} of ${backtestResult.trades.length} trades landed in this range`}>
                  {freq
                    ? <><span className="opt-pnl-freq-bar" style={{ width: `${Math.min(100, freq.pct * 2)}px`, opacity: 0.6 + freq.pct / 100 * 0.4 }} />{freq.pct}%</>
                    : '—'
                  }
                </span>
              )}
              <span>${sNew.toFixed(2)}</span>
              <span>${nowVal.toFixed(2)}</span>
              <span style={{ color: intrinsic > 0 ? '#a0c0dc' : '#4a6380' }}>
                {intrinsic > 0 ? `$${intrinsic.toFixed(2)}` : '$0.00 ✕'}
              </span>
              <span style={{ color: isWin ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                {plPer >= 0 ? '+' : ''}${plPer.toFixed(0)}
              </span>
              <span style={{ color: isWin ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                {plTotal >= 0 ? '+' : ''}${plTotal.toFixed(0)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="opt-pnl-footnote">
        "Value Now" uses Black-Scholes with full time remaining — useful if you plan to exit before expiry.
        "At Expiry" is the intrinsic value on expiration day.
        {moveDist && ' "Hist. Freq." shows how often past trades landed in each move bucket.'}
      </div>
    </div>
  )
}

// ── Strike Comparison Strip ───────────────────────────────────────────────────
function StrikeComparison({ rec, currentPrice, ticker, liveContracts }) {
  if (!rec || !currentPrice) return null
  const { strike: kRec, dte, isCall, sigma: sig, expTimestamp, premium: recPremium } = rec
  const T = dte / 365
  const S = currentPrice

  // ── Build the strike list from the live chain if available ──────────────────
  // Find the chain bucket for this expiry (timestamp tolerance ±1 day)
  let chainRows = []
  if (liveContracts && expTimestamp) {
    const keys    = Object.keys(liveContracts).map(Number)
    const matchTs = keys.find(k => Math.abs(k - expTimestamp) < 86400)
    if (matchTs != null) {
      const side = liveContracts[matchTs]?.[isCall ? 'calls' : 'puts'] ?? []
      if (side.length > 0) {
        // Sort ascending by strike, find the recommended index, take ±2 neighbours
        const sorted = [...side].sort((a, b) => a.strike - b.strike)
        let idx = sorted.findIndex(c => Math.abs(c.strike - kRec) < 0.001)
        // If exact match not found, insert a sentinel at the closest position
        if (idx === -1) idx = sorted.findIndex(c => c.strike > kRec)
        if (idx === -1) idx = sorted.length
        const lo = Math.max(0, idx - 2)
        const hi = Math.min(sorted.length, idx + 3)
        chainRows = sorted.slice(lo, hi).map(c => ({
          K:      c.strike,
          mid:    +((c.bid + c.ask) / 2).toFixed(2),
          bid:    c.bid,
          ask:    c.ask,
          oi:     c.oi,
          isLive: true,
        }))
      }
    }
  }

  // Fall back to BS-generated strikes if no live chain data for this expiry
  const useLive = chainRows.length > 0
  let strikeRows
  if (useLive) {
    strikeRows = chainRows
  } else {
    const inc = S < 10 ? 0.5 : S < 25 ? 1 : S < 75 ? 2.5 : S < 500 ? 5 : 10
    strikeRows = [-2, -1, 0, 1, 2]
      .map(i => Math.round((kRec + i * inc) / inc) * inc)
      .filter(k => k > 0)
      .map(K => ({ K, mid: null, bid: null, ask: null, oi: null, isLive: false }))
  }

  return (
    <div className="opt-strikes-wrap">
      <div className="opt-strikes-header">
        <span className="opt-strikes-title">
          Nearby Strikes — {rec.expDate}
          {useLive
            ? <span className="opt-strikes-live-badge">● LIVE</span>
            : <span className="opt-strikes-est-badge">◌ EST.</span>
          }
        </span>
        <span className="opt-strikes-sub">{ticker} {isCall ? 'CALL' : 'PUT'} · same expiry as the primary recommendation above</span>
      </div>
      <div className="opt-strikes-table">
        <div className="opt-st-row opt-st-hdr">
          <span>Strike</span>
          <span>{useLive ? 'Market Price' : 'Est. Premium'}</span>
          <span>Delta</span>
          <span>Break-Even</span>
          <span>Prob ITM</span>
          <span>$/Contract</span>
        </div>
        {strikeRows.map(({ K, mid, bid, ask, oi, isLive: rowLive }) => {
          const isRec = Math.abs(K - kRec) < 0.001
          // For the recommended strike: always use rec.premium (matches the card exactly)
          const prem  = isRec ? recPremium : (rowLive && mid != null ? mid : bsPrice(S, K, T, sig, isCall))
          const g     = calcGreeks(S, K, T, sig, isCall)
          if (!g || prem == null || prem <= 0) return null
          const be    = isCall ? K + prem : K - prem
          const isITM = isCall ? K < S : K > S

          return (
            <div key={K} className={`opt-st-row${isRec ? ' opt-st-rec' : ''}${isITM ? ' opt-st-itm' : ''}`}>
              <span className="opt-st-strike">
                <span style={{ color: isRec ? '#f59e0b' : isITM ? '#60a5fa' : '#a0c0dc' }}>
                  ${K % 1 === 0 ? K.toFixed(0) : K.toFixed(2)}
                </span>
                {isRec && <span className="opt-st-badge">OUR PICK</span>}
                {isITM && !isRec && <span className="opt-st-itm-tag">ITM</span>}
                {rowLive && !isRec && bid != null && (
                  <span className="opt-st-live-dot" title={`Bid $${bid} · Ask $${ask}${oi ? ` · OI ${oi}` : ''}`}>●</span>
                )}
              </span>
              <span style={{ color: isRec ? '#f59e0b' : undefined }}>
                ${prem.toFixed(2)}
                {isRec && rec.bid != null && (
                  <span className="opt-st-bid-ask"> ({rec.bid}–{rec.ask})</span>
                )}
              </span>
              <span style={{ color: Math.abs(g.delta) >= 0.35 && Math.abs(g.delta) <= 0.65 ? '#10b981' : '#6b8099' }}>
                {Math.abs(g.delta).toFixed(2)}
              </span>
              <span>${be.toFixed(2)}</span>
              <span style={{ color: g.probITM > 0.5 ? '#10b981' : '#6b7280' }}>
                {(g.probITM * 100).toFixed(0)}%
              </span>
              <span>${(prem * 100).toFixed(0)}</span>
            </div>
          )
        })}
      </div>
      <div className="opt-strikes-legend">
        <span>Delta 0.35–0.65 highlighted green = sweet spot for buyers</span>
        <span className="opt-st-itm-tag" style={{ marginLeft: 8 }}>ITM</span>
        <span> = in the money</span>
        {useLive && <span style={{ marginLeft: 12, color: '#4a6888', fontSize: 11 }}>● live bid/ask data</span>}
        {!useLive && <span style={{ marginLeft: 12, color: '#6a5010', fontSize: 11 }}>premiums are Black-Scholes estimates</span>}
      </div>
    </div>
  )
}

// ── Market Sentiment Strip ────────────────────────────────────────────────────
function MarketSentimentStrip({ optionsChain, currentPrice }) {
  if (!optionsChain || optionsChain.empty) return null
  const { aggregatePCOI, aggregatePCVol, ivLean, contracts, totalCallOI, totalPutOI } = optionsChain
  const maxPain    = calcMaxPain(contracts)
  const painDiff   = maxPain != null && currentPrice ? ((maxPain - currentPrice) / currentPrice * 100) : null
  const pcoiColor  = aggregatePCOI == null ? '#6a90b0'
    : aggregatePCOI < 0.75 ? '#10b981' : aggregatePCOI > 1.3 ? '#ef4444' : '#f59e0b'
  const pcoiLabel  = aggregatePCOI == null ? '—'
    : aggregatePCOI < 0.75 ? 'Call flow' : aggregatePCOI > 1.3 ? 'Put flow' : 'Balanced'
  const leanColor  = ivLean?.dir === 'bull' ? '#10b981' : ivLean?.dir === 'bear' ? '#ef4444' : '#f59e0b'
  const leanText   = ivLean ? `${ivLean.strength === 'strong' ? 'Strong ' : ''}${ivLean.dir === 'bull' ? 'Bullish' : ivLean.dir === 'bear' ? 'Bearish' : 'Neutral'}` : null

  return (
    <div className="opt-sentiment-strip">
      <span className="opt-sent-title">OPTIONS FLOW</span>
      <div className="opt-sent-row">
        {aggregatePCOI != null && (
          <div className="opt-sent-item">
            <span className="opt-sent-lbl" data-tip="Put/Call OI Ratio: Total put open interest divided by call open interest across all expirations. Above 1.0 = more puts than calls outstanding (bearish sentiment or heavy hedging). Below 0.7 = heavy call positioning (bullish). Below 0.5 = extreme call euphoria — can signal a contrarian top.">P/C OI</span>
            <span className="opt-sent-val" style={{ color: pcoiColor }}>{aggregatePCOI.toFixed(2)}</span>
            <span className="opt-sent-sub" style={{ color: pcoiColor }}>{pcoiLabel}</span>
          </div>
        )}
        {aggregatePCVol != null && (
          <div className="opt-sent-item">
            <span className="opt-sent-lbl" data-tip="Put/Call Volume Ratio: Today's put volume divided by call volume. Measures current-day order flow sentiment. Above 1.3 = aggressive put buying (bearish). Below 0.75 = aggressive call buying (bullish). Unlike OI, volume reflects what's happening right now.">P/C Vol</span>
            <span className="opt-sent-val">{aggregatePCVol.toFixed(2)}</span>
            <span className="opt-sent-sub">{aggregatePCVol < 0.75 ? 'Call buying' : aggregatePCVol > 1.3 ? 'Put buying' : 'Mixed'}</span>
          </div>
        )}
        {maxPain != null && (
          <div className="opt-sent-item">
            <span className="opt-sent-lbl" data-tip="Max Pain: The strike price where option market makers (who took the other side of retail trades) would profit most if the stock expired there — where total open interest dollar value for buyers is minimized. Price tends to drift toward Max Pain as expiration approaches. If current price is far above Max Pain, there's downward gravitational pull. Far below = upward pull.">Max Pain</span>
            <span className="opt-sent-val">${maxPain}</span>
            <span className="opt-sent-sub" style={{ color: painDiff != null ? (Math.abs(painDiff) < 2 ? '#10b981' : '#f59e0b') : '#6a90b0' }}>
              {painDiff != null ? `${painDiff >= 0 ? '+' : ''}${painDiff.toFixed(1)}% from price` : '—'}
            </span>
          </div>
        )}
        {ivLean && (
          <div className="opt-sent-item">
            <span className="opt-sent-lbl" data-tip="IV Lean (Volatility Skew): Whether the options market is pricing more fear or greed. Bullish lean = call options carry higher IV than equidistant puts — the crowd is paying up for upside. Bearish lean = puts are more expensive (normal for most stocks — investors hedge more than speculate). Skew shows the percentage IV difference.">IV Lean</span>
            <span className="opt-sent-val" style={{ color: leanColor }}>{leanText}</span>
            <span className="opt-sent-sub">
              {ivLean.skew != null ? `skew ${ivLean.skew > 0 ? '+' : ''}${ivLean.skew.toFixed(1)}%` : ''}
            </span>
          </div>
        )}
        {totalCallOI > 0 && totalPutOI > 0 && (
          <div className="opt-sent-item opt-sent-oi-bar">
            <span className="opt-sent-lbl" data-tip="Open Interest Split: The percentage breakdown of total open contracts — calls vs. puts. Heavy call OI = speculative bullish bets or covered call selling. Heavy put OI = protective hedging or bearish speculation. Neither alone is bullish or bearish — context matters (who is buying vs. selling these contracts).">OI Split</span>
            <div className="opt-sent-oi-track">
              <div className="opt-sent-oi-call" style={{ width: `${(totalCallOI / (totalCallOI + totalPutOI) * 100).toFixed(0)}%` }} />
              <div className="opt-sent-oi-put" style={{ width: `${(totalPutOI / (totalCallOI + totalPutOI) * 100).toFixed(0)}%` }} />
            </div>
            <span className="opt-sent-sub">
              C {(totalCallOI / (totalCallOI + totalPutOI) * 100).toFixed(0)}% · P {(totalPutOI / (totalCallOI + totalPutOI) * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── IV Term Structure mini-chart ──────────────────────────────────────────────
function TermStructureChart({ termStructure }) {
  if (!termStructure?.length || termStructure.length < 2) return null
  const pts   = termStructure.slice(0, 6)
  const ivs   = pts.map(p => p.iv)
  const minIV = Math.min(...ivs), maxIV = Math.max(...ivs)
  const range = maxIV - minIV || 1
  const W = 300, H = 64, PL = 6, PR = 6, PT = 14, PB = 18
  const iW = W - PL - PR, iH = H - PT - PB
  const xOf = i => PL + (pts.length > 1 ? (i / (pts.length - 1)) * iW : iW / 2)
  const yOf = iv => PT + (1 - (iv - minIV) / range) * iH
  const isBack = ivs[0] > ivs[ivs.length - 1]
  const clr    = isBack ? '#ef4444' : '#10b981'
  const pathD  = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)} ${yOf(p.iv).toFixed(1)}`).join(' ')

  return (
    <div className="opt-ts-wrap">
      <div className="opt-ts-header">
        <span className="opt-ts-title">IV TERM STRUCTURE</span>
        <span className="opt-ts-badge" style={{ color: clr }}>
          {isBack ? 'BACKWARDATION — near expiry IV elevated' : 'CONTANGO — normal'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="opt-ts-svg" style={{ width: '100%', height: H }}>
        <path d={pathD} fill="none" stroke={clr} strokeWidth="1.5" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={xOf(i)} cy={yOf(p.iv)} r="2.5" fill={clr} />
            <text x={xOf(i)} y={H - 3} textAnchor="middle" fill="#3a5070" fontSize="7.5">{p.expDate}</text>
            <text x={xOf(i)} y={yOf(p.iv) - 5} textAnchor="middle" fill={clr} fontSize="7.5">{p.iv}%</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Edge Decay Banner ─────────────────────────────────────────────────────────
function EdgeDecayBanner({ monthlyBreakdown, allTimeWinRate }) {
  if (!monthlyBreakdown?.length) return null
  const { freshWR, allTimeWR } = computeEdgeDecay(monthlyBreakdown, allTimeWinRate)
  if (freshWR == null) return null
  const ratio = freshWR / Math.max(0.01, allTimeWR)
  if (ratio >= 0.80) return null   // edge is healthy — no banner needed

  const pctFresh = Math.round(freshWR * 100)
  const pctAll   = Math.round(allTimeWR * 100)
  const severe   = ratio < 0.50

  return (
    <div className={`opt-edge-decay ${severe ? 'opt-edge-decay-severe' : ''}`}>
      <span className="opt-edge-icon">⚠</span>
      <div className="opt-edge-body">
        <span className="opt-edge-title">
          {severe ? 'EDGE SIGNIFICANTLY DEGRADED' : 'EDGE WEAKENING — REDUCE SIZE'}
        </span>
        <span className="opt-edge-sub">
          Last 3 months: <strong>{pctFresh}%</strong> win rate vs{' '}
          <strong>{pctAll}%</strong> all-time — signal quality has dropped{' '}
          <strong>{Math.round((1 - ratio) * 100)}%</strong>.
          {severe
            ? ' Consider pausing new entries until the edge recovers above historical baseline.'
            : ' Size down to 50–60% of normal until win rate recovers.'}
        </span>
      </div>
    </div>
  )
}

// ── GEX-based structure recommendation ────────────────────────────────────────
function GEXStructureRec({ totalNetGEX, direction }) {
  if (totalNetGEX == null || !direction) return null
  const isBull  = direction === 'CALL'
  const isPos   = totalNetGEX > 0
  const absGEX  = Math.abs(totalNetGEX)
  // Positive GEX = dealers long gamma = they pin price = range-bound
  // Negative GEX = dealers short gamma = they amplify moves = explosive
  const regime  = isPos ? 'pinning' : 'explosive'
  const suggest = isPos ? 'DEBIT SPREAD' : 'NAKED LONG OPTION'
  const why     = isPos
    ? 'Positive GEX: market makers are long gamma — they sell into rallies and buy dips, keeping price in a range. Naked options will bleed theta in choppy conditions. A spread caps your theta exposure.'
    : 'Negative GEX: market makers are short gamma — they must buy when price rises (or sell when it falls), amplifying moves. A naked option gives you full convexity to ride the acceleration.'

  const clr  = isPos ? '#f59e0b' : '#10b981'
  const bg   = isPos ? '#1a1000' : '#001a0d'
  const bord = isPos ? '#b45309' : '#065f46'

  return (
    <div className="opt-gex-rec" style={{ background: bg, borderColor: bord }}>
      <div className="opt-gex-rec-header">
        <span className="opt-gex-rec-label" style={{ color: clr }}>GEX REGIME: {regime.toUpperCase()}</span>
        <span className="opt-gex-rec-suggest" style={{ color: clr }}>→ PREFER {suggest}</span>
      </div>
      <p className="opt-gex-rec-why">{why}</p>
    </div>
  )
}

// ── Theta decay calendar vs median backtest hold ───────────────────────────────
function ThetaCalendar({ rec, sigma, currentPrice, medianHold }) {
  if (!rec || !currentPrice || !sigma) return null
  const { strike, dte, isCall } = rec
  if (!strike || !dte) return null

  const days  = [1, 3, 5, 7, 10, 14, 21].filter(d => d < dte)
  const entry = rec.premium

  return (
    <div className="opt-theta-cal">
      <div className="opt-theta-cal-title">
        Theta Decay Calendar — option value at <em>current</em> stock price as time passes
        {medianHold != null && (
          <span className="opt-theta-cal-hold"> · Median backtest exit: {medianHold}d</span>
        )}
      </div>
      <div className="opt-theta-cal-grid">
        <span className="opt-theta-hdr">Day</span>
        <span className="opt-theta-hdr">Option value</span>
        <span className="opt-theta-hdr">P&amp;L / share</span>
        <span className="opt-theta-hdr">% of premium</span>
        {days.map(d => {
          const T     = Math.max(0, (dte - d) / 365)
          const val   = T > 0.004
            ? bsPrice(currentPrice, strike, T, sigma, isCall)
            : Math.max(0, isCall ? currentPrice - strike : strike - currentPrice)
          const pl    = (val - entry) * 100
          const pct   = entry > 0 ? Math.round((val / entry - 1) * 100) : 0
          const isPin = medianHold != null && d === days.find(x => x >= medianHold)
          const clr   = pl >= 0 ? '#10b981' : '#ef4444'
          return (
            <React.Fragment key={d}>
              <span className={`opt-theta-cell opt-theta-day${isPin ? ' opt-theta-pin' : ''}`}>
                {d}d{isPin ? ' ◀' : ''}
              </span>
              <span className="opt-theta-cell">${val.toFixed(2)}</span>
              <span className="opt-theta-cell" style={{ color: clr }}>{pl >= 0 ? '+' : ''}${pl.toFixed(0)}</span>
              <span className="opt-theta-cell" style={{ color: clr }}>{pct >= 0 ? '+' : ''}{pct}%</span>
            </React.Fragment>
          )
        })}
      </div>
      <div className="opt-theta-cal-note">
        At current stock price ${f2(currentPrice)} — assumes no stock movement, isolating pure time decay.
        {medianHold != null && ` ◀ marks your historical median exit day (${medianHold}d).`}
      </div>
    </div>
  )
}

// ── Historical strike hint ─────────────────────────────────────────────────────
function HistoricalStrikeHint({ trades, currentPrice, direction, recStrike }) {
  if (!trades?.length || !currentPrice || !direction) return null
  const hs = computeHistoricalStrike(trades, direction, currentPrice)
  if (!hs) return null

  const isBull    = direction === 'CALL'
  const diffPct   = recStrike ? +((hs.optStrike - recStrike) / recStrike * 100).toFixed(1) : null
  const aligned   = diffPct != null && Math.abs(diffPct) <= 3

  return (
    <div className="opt-hist-strike">
      <div className="opt-hs-title">Historical Strike Calibration — based on {hs.wins} winning {direction}s</div>
      <div className="opt-hs-grid">
        <div className="opt-hs-cell">
          <span className="opt-hs-lbl">p25 win move</span>
          <span className="opt-hs-val" style={{ color: '#10b981' }}>{isBull ? '+' : '−'}{hs.p25}%</span>
          <span className="opt-hs-sub">conservative exit</span>
        </div>
        <div className="opt-hs-cell">
          <span className="opt-hs-lbl">Median win move</span>
          <span className="opt-hs-val" style={{ color: '#10b981' }}>{isBull ? '+' : '−'}{hs.p50}%</span>
          <span className="opt-hs-sub">typical winner</span>
        </div>
        <div className="opt-hs-cell">
          <span className="opt-hs-lbl">p75 win move</span>
          <span className="opt-hs-val" style={{ color: '#10b981' }}>{isBull ? '+' : '−'}{hs.p75}%</span>
          <span className="opt-hs-sub">extended run</span>
        </div>
        <div className="opt-hs-cell">
          <span className="opt-hs-lbl">Optimal strike</span>
          <span className="opt-hs-val" style={{ color: '#f59e0b' }}>${hs.optStrike}</span>
          <span className="opt-hs-sub">at median move</span>
        </div>
      </div>
      {recStrike && (
        <div className={`opt-hs-verdict ${aligned ? 'opt-hs-aligned' : 'opt-hs-delta'}`}>
          {aligned
            ? `✓ Current rec ($${recStrike}) is within 3% of the historically optimal strike — well placed.`
            : `Current rec $${recStrike} vs historical optimal $${hs.optStrike} (${diffPct > 0 ? '+' : ''}${diffPct}%). ${
                Math.abs(diffPct) > 8
                  ? 'Consider a strike closer to $' + hs.optStrike + ' — it sits at the median winning move target.'
                  : 'Small divergence — either strike is reasonable.'
              }`
          }
        </div>
      )}
    </div>
  )
}

// ── Grade × Regime conditional probability matrix ─────────────────────────────
function GradeRegimeMatrix({ trades }) {
  const matrix = computeGradeRegime(trades)
  if (!matrix) return null

  const grades  = ['A+', 'A', 'B'].filter(g => Object.values(matrix[g] ?? {}).some(Boolean))
  if (!grades.length) return null

  const gradeColors = { 'A+': '#10b981', 'A': '#f59e0b', 'B': '#6b7280' }

  return (
    <div className="opt-grm-wrap">
      <div className="opt-grm-title">Conditional Win Rate — Options · Grade × Market Regime</div>
      <div className="opt-grm-sub">
        Shows historical options win rate broken down by setup quality AND whether SPY was in a bull or bear regime at signal time.
        The regime where your edge is strongest tells you WHEN to size up.
      </div>
      <div className="opt-grm-grid" style={{ gridTemplateColumns: `72px repeat(${grades.length}, 1fr)` }}>
        <span className="opt-grm-hdr" />
        {grades.map(g => (
          <span key={g} className="opt-grm-hdr" style={{ color: gradeColors[g] }}>{g}</span>
        ))}
        {['bull', 'bear'].map(regime => (
          <React.Fragment key={regime}>
            <span className="opt-grm-regime">
              {regime === 'bull' ? '📈 Bull' : '📉 Bear'}
            </span>
            {grades.map(g => {
              const cell = matrix[g]?.[regime]
              if (!cell) return <span key={g} className="opt-grm-cell opt-grm-empty">—</span>
              const clr = cell.winRate >= 60 ? '#10b981' : cell.winRate >= 45 ? '#f59e0b' : '#ef4444'
              return (
                <span key={g} className="opt-grm-cell" title={`${cell.count} trades · avg ${cell.avgGain >= 0 ? '+' : ''}${cell.avgGain}%`}>
                  <span className="opt-grm-wr" style={{ color: clr }}>{cell.winRate}%</span>
                  <span className="opt-grm-count">{cell.count}t</span>
                </span>
              )
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="opt-grm-note">
        Hover cells for trade count and avg gain · size up when both grade AND regime align with history
      </div>
    </div>
  )
}

// ── Pre-entry Checklist ───────────────────────────────────────────────────────
function EntryChecklist({ direction, conflict, adxSignal, earningsDate, ivData, setupGrade, wyckoffData, backtestResult }) {
  if (!direction) return null
  const daysToEarnings = earningsDate
    ? Math.round((earningsDate.getTime() - Date.now()) / 86400000)
    : null

  // Edge decay check
  const edgeDecayInfo = backtestResult?.monthlyBreakdown?.length
    ? computeEdgeDecay(backtestResult.monthlyBreakdown, backtestResult.winRate ?? 0)
    : null
  const edgeFading = edgeDecayInfo?.freshWR != null
    && (edgeDecayInfo.freshWR / Math.max(0.01, edgeDecayInfo.allTimeWR)) < 0.80

  // Wyckoff trend alignment
  const wyTrend      = wyckoffData?.trendContext   // 'UPTREND'|'DOWNTREND'|'NEUTRAL'
  const wyAligned    = direction === 'CALL'
    ? wyTrend === 'UPTREND'
    : direction === 'PUT'
      ? wyTrend === 'DOWNTREND'
      : wyTrend == null  // no data = neutral pass

  const items = [
    {
      label:  'No signal conflict',
      ok:     !conflict,
      detail: conflict ? 'Signals disagree — wait for alignment' : 'Swing + Confluence aligned',
      tip:    'Signal Alignment: Your Swing (timing) indicator and Confluence (multi-timeframe signals) must agree on direction. If one says CALL and the other says PUT, the market is sending mixed messages — entering now is gambling, not trading.',
    },
    {
      label:  'ADX > 20',
      ok:     adxSignal?.adx != null && adxSignal.adx >= 20,
      detail: adxSignal?.adx != null ? `ADX ${adxSignal.adx.toFixed(1)}` : 'Unavailable',
      tip:    'ADX (Average Directional Index): Measures how strong the current trend is, on a 0–100 scale. Below 20 = choppy, directionless market — options suffer from low follow-through. Above 20 = trend has enough momentum to carry your position. Above 30 = strong trend.',
    },
    {
      label:  'Grade A or better',
      ok:     setupGrade?.grade === 'A+' || setupGrade?.grade === 'A',
      detail: setupGrade?.grade ?? 'No grade',
      tip:    'Setup Grade: How many technical conditions are passing out of the full scanner checklist. A+ (80%+) and A (65%+) grades mean the setup is well-supported across multiple indicators. B and C grade setups have too many conditions failing — wait for a higher-quality entry.',
    },
    {
      label:  'Earnings > 14d',
      ok:     daysToEarnings == null || daysToEarnings > 14,
      detail: daysToEarnings != null ? `${daysToEarnings}d away` : 'No date',
      tip:    'Earnings Risk: If earnings are within 14 days, Implied Volatility will likely spike into the report and then crush immediately after — destroying your option premium. Avoid buying options into earnings unless you specifically want to trade the event. The IV crush after earnings can wipe out profits even when the stock moves in your direction.',
    },
    {
      label:  'IV rank < 60',
      ok:     ivData?.ivRank == null || ivData.ivRank < 60,
      detail: ivData?.ivRank != null ? `Rank ${Math.round(ivData.ivRank)}` : 'Unavailable',
      tip:    'IV Rank: Where current Implied Volatility sits in its 52-week range. Above 60 means options are historically expensive — you\'re paying inflated premium. At IV Rank 60+, the risk/reward of buying options is skewed against you. Wait for IV to compress, or reduce your size significantly.',
    },
    {
      label:  'Wyckoff trend aligned',
      ok:     wyTrend == null || wyAligned,
      detail: wyTrend
        ? `${wyTrend}${wyAligned ? ' ✓' : ' — misaligned'}`
        : 'No Wyckoff data',
      tip:    'Wyckoff Trend Context: The market structure detected by Wyckoff analysis. If you\'re buying CALLs but the Wyckoff structure shows DOWNTREND (distribution/markdown), the supply/demand context is against you. Align your option direction with the Wyckoff trend for higher-probability trades.',
    },
    {
      label:  'Edge not fading',
      ok:     edgeDecayInfo == null || edgeDecayInfo.freshWR == null || !edgeFading,
      detail: edgeDecayInfo?.freshWR != null
        ? `Last 3m: ${Math.round(edgeDecayInfo.freshWR * 100)}% vs ${Math.round(edgeDecayInfo.allTimeWR * 100)}% all-time`
        : 'No backtest data',
      tip:    'Edge Freshness: Compares the win rate of this signal over the last 3 months vs all-time. If recent win rate has dropped significantly, the edge may be degrading due to changed market conditions. A fading edge means normal sizing is risky — reduce position size until the signal proves itself again.',
    },
  ]
  const total = items.length
  const pass  = items.filter(i => i.ok).length

  return (
    <div className="opt-checklist">
      <div className="opt-checklist-header">
        <span className="opt-checklist-title">PRE-ENTRY CHECKLIST</span>
        <span className="opt-checklist-score" style={{ color: pass === total ? '#10b981' : pass >= Math.ceil(total * 0.6) ? '#f59e0b' : '#ef4444' }}>
          {pass}/{total}
        </span>
      </div>
      <div className="opt-checklist-items">
        {items.map((item, i) => (
          <div key={i} className={`opt-check-item${item.ok ? ' opt-check-ok' : ' opt-check-fail'}`}>
            <span className="opt-check-icon">{item.ok ? '✓' : '✗'}</span>
            <span className="opt-check-label" data-tip={item.tip}>{item.label}</span>
            <span className="opt-check-detail">{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Recommendation card ───────────────────────────────────────────────────────
function RecCard({ rec, ticker, maxRisk, currentPrice, ivRank, isQuickPlay, sigma, grade, adxSignal, wyckoffData, backtestResult, onLog }) {
  if (!rec) return null
  const { label, dte, expDate, strike, premium, contractCost, isCall } = rec

  const mainClr = isCall ? '#10b981' : '#ef4444'
  const bg      = isCall ? '#001a0d' : '#1a0000'
  const bord    = isCall ? '#064e2e' : '#6b0000'

  // Multi-factor adaptive sizing (replaces simple ivBudget)
  const mfBudget  = computeMultiFactorBudget(maxRisk, ivRank, wyckoffData, backtestResult)
  const budget    = mfBudget.budget
  const ivNote    = mfBudget.mult < 1.0
  const ivWarn    = mfBudget.warn
  const qty       = contractCost > 0 ? Math.floor(budget / contractCost) : 0
  const totalCost = qty > 0 ? qty * contractCost : null

  // Pattern target clearance
  let patternSection = null
  if (rec.patternTarget != null) {
    const cleared = rec.patternClearance != null && rec.patternClearance > 0
    const clrAmt  = rec.patternClearance != null ? Math.abs(rec.patternClearance) : null
    patternSection = (
      <Metric
        label="Pattern Target"
        value={`$${f2(rec.patternTarget)}`}
        color={cleared ? '#10b981' : '#f59e0b'}
        sub={clrAmt != null
          ? cleared
            ? `✓ BE clears target by $${f2(clrAmt)}`
            : `⚠ BE short of target by $${f2(clrAmt)}`
          : undefined
        }
        subColor={cleared ? '#10b981' : '#f59e0b'}
      />
    )
  }

  // Est. gain if pattern target hit
  let gainSection = null
  if (rec.patternTarget && currentPrice && rec.delta && qty >= 1) {
    const move = Math.abs(rec.patternTarget - currentPrice)
    const gain = move * Math.abs(rec.delta) * 100 * qty
    gainSection = (
      <Metric label="Est. Gain @ Target" value={`+$${f0(gain)}`} color="#10b981" />
    )
  }

  return (
    <div
      className={`opt-pick-card${isQuickPlay ? ' opt-quick-card' : ''}`}
      style={{ background: bg, borderColor: isQuickPlay ? '#92400e' : bord }}
    >
      <div className="opt-pick-head">
        <span
          className="opt-pick-badge"
          style={{ color: isQuickPlay ? '#f59e0b' : mainClr }}
        >
          {label}
        </span>
        <span
          className="opt-source-badge"
          title={rec.isLive ? 'Premium is real bid/ask mid-price from the live chain' : 'Premium is a Black-Scholes estimate'}
          style={{
            background: rec.isLive ? '#003d1a' : '#1a1200',
            color:      rec.isLive ? '#10b981' : '#8a7020',
            border:     `1px solid ${rec.isLive ? '#065f46' : '#4d3a00'}`,
          }}
        >
          {rec.isLive ? '● LIVE' : '◌ EST.'}
        </span>
        <span className="opt-rec-type" style={{ color: mainClr }}>{isCall ? 'CALL' : 'PUT'}</span>
      </div>

      {isQuickPlay && (
        <div className="opt-quick-note">
          High-gamma swing play · near ATM (Δ0.45) · {dte} days · verify 4H confirmation before entering
        </div>
      )}

      {rec.chainChecked && !rec.isLive && (
        <div className="opt-chain-warn">
          ⚠ No liquid contract found near target delta — chain was checked but nothing tradeable met the threshold.
          Prices are theoretical estimates. Verify at your broker before trading.
        </div>
      )}

      <div className="opt-pick-main-row">
        <span className="opt-pick-strike" style={{ color: mainClr }}>
          {ticker} ${f0(strike)}
        </span>
        <div className="opt-pick-expinfo">
          <span className="opt-pick-expdate">{expDate}</span>
          <span className="opt-pick-dte">{dte} days</span>
        </div>
      </div>

      <div className="opt-pick-grid">
        <Metric
          label={rec.isLive ? 'Market Premium' : 'Est. Premium'}
          value={`${rec.isLive ? '' : '~'}$${f2(premium)}/sh`}
          color={mainClr}
          sub={rec.isLive && rec.bid != null
            ? `Bid $${f2(rec.bid)} · Ask $${f2(rec.ask)} · $${f0(contractCost)}/contract`
            : `~$${f0(contractCost)}/contract`
          }
        />
        <Metric
          label="Break Even"
          value={`$${f2(rec.breakEven)}`}
          sub={`${isCall ? '+' : '-'}${f2(rec.bePct)}% move needed`}
        />
        <Metric
          label={`Exp Move (${dte}d)`}
          value={`±$${f2(rec.expMove)}`}
          sub={`±${f2(rec.expMovePct)}% 1σ by expiry`}
        />
        <Metric
          label="Prob ITM"
          value={`${(rec.probITM * 100).toFixed(0)}%`}
          color={rec.probITM > 0.5 ? '#10b981' : '#6a90b0'}
          sub="at expiration"
        />
        {qty >= 1
          ? (
            <Metric
              label="Position Size"
              value={`${qty} contract${qty > 1 ? 's' : ''}`}
              color={mainClr}
              sub={`$${f0(totalCost)} total cost${ivNote ? ' (IV adj.)' : ''}`}
            />
          ) : (
            <Metric
              label="Min Cost"
              value={`$${f0(contractCost)}`}
              color="#f59e0b"
              sub="1 contract (over budget)"
            />
          )
        }
        {gainSection ?? patternSection ?? (
          rec.isLive && rec.oi != null
            ? <Metric
                label="Open Interest"
                value={rec.oi.toLocaleString()}
                color="#6a90b0"
                sub={rec.contractVol != null
                  ? `${rec.contractVol.toLocaleString()} vol today · IV ${(rec.sigma * 100).toFixed(1)}%`
                  : `IV ${(rec.sigma * 100).toFixed(1)}%`
                }
              />
            : <Metric
                label="Vol Used"
                value={`${(rec.sigma * 100).toFixed(1)}%`}
                color="#6a90b0"
                sub="annualised"
              />
        )}
      </div>

      {/* Show est. gain AND pattern clearance when both are meaningful */}
      {gainSection && patternSection && (
        <div className="opt-pick-grid" style={{ marginTop: -2 }}>
          {patternSection}
        </div>
      )}

      {/* Wide spread warning */}
      {rec.wideSpread && rec.spreadPct != null && (
        <div className="opt-chain-warn" style={{ background: '#1a0a00', borderColor: '#7c3000', color: '#f59e0b' }}>
          ⚠ Wide bid/ask spread ({rec.spreadPct.toFixed(1)}%) — you'll give up {rec.spreadPct.toFixed(0)}% on entry.
          Use a limit order at the mid-price. Consider a tighter-spread expiry or nearby strike.
        </div>
      )}

      {/* GEX wall alert */}
      {rec.gexWall?.isHeadwind && (
        <div className="opt-chain-warn" style={{ background: '#0d0d1a', borderColor: '#3730a3', color: '#818cf8' }}>
          ⚡ GEX wall at ${rec.gexWall.strike} — high dealer gamma concentration between entry and strike.
          Market makers will hedge against this move, which may slow price action at this level.
        </div>
      )}

      <ScaleInPlan qty={qty} currentPrice={currentPrice} rec={rec} />

      <ExitPlan rec={rec} currentPrice={currentPrice} qty={qty} setupGrade={typeof grade === 'object' ? grade : null} adxSignal={adxSignal} />

      <GreeksBar rec={rec} highlightGamma={isQuickPlay} />

      {/* Multi-factor sizing breakdown */}
      {mfBudget.factors.length > 0 && (
        <div className="opt-mf-size-wrap">
          <div className="opt-mf-size-title">Position Sizing Factors</div>
          <div className="opt-mf-size-rows">
            {mfBudget.factors.map((f, i) => (
              <div key={i} className={`opt-mf-size-row${f.warn ? ' opt-mf-warn' : ''}`}>
                <span className="opt-mf-name">{f.name}</span>
                <span className="opt-mf-detail">{f.detail}</span>
                <span className="opt-mf-adj" style={{ color: f.adj < 1 ? '#ef4444' : f.adj > 1 ? '#10b981' : '#6a90b0' }}>
                  {f.adj < 1 ? '↓' : f.adj > 1 ? '↑' : '='} ×{f.adj.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="opt-mf-size-result">
            Net multiplier <strong style={{ color: mfBudget.mult < 0.8 ? '#ef4444' : mfBudget.mult > 1.05 ? '#10b981' : '#a0c0dc' }}>×{mfBudget.mult.toFixed(2)}</strong>
            {' '}→ effective budget <strong>${f0(budget)}</strong>
            {' of '}${f0(maxRisk)} base
          </div>
        </div>
      )}

      {ivWarn && (
        <div className="opt-iv-size-warn">
          ⚠ Position scaled down to {Math.round(mfBudget.mult * 100)}% of budget — see sizing factors above
        </div>
      )}

      {qty < 1 && (
        <div className="opt-over-budget">
          ⚠ 1 contract ≈ ${f0(contractCost)} · exceeds ${f0(budget)} effective budget · increase risk % in Analyze → Timing → Risk Panel
        </div>
      )}

      {onLog && (
        <button
          onClick={() => onLog({
            timestamp:    new Date().toISOString(),
            ticker,
            direction:    rec.isCall ? 'CALL' : 'PUT',
            label:        rec.label,
            strike:       rec.strike,
            expDate:      rec.expDate,
            dte:          rec.dte,
            premium:      rec.premium,
            contractCost: rec.contractCost,
            qty,
            totalCost,
            isLive:       !!rec.isLive,
            isQuickPlay:  !!isQuickPlay,
          })}
          style={{
            width: '100%', marginTop: 10,
            padding: '7px 0', cursor: 'pointer',
            background: '#080f1a', border: '1px solid #1e3a5f',
            borderRadius: 5, color: '#60a5fa',
            fontSize: 10, fontWeight: 800, letterSpacing: 1,
          }}
        >
          📋 LOG THIS TRADE
        </button>
      )}

    </div>
  )
}

// ── Price + timestamp strip ───────────────────────────────────────────────────
function PriceStrip({ ticker, currentPrice, sigma, sigmaLabel, lastUpdated }) {
  if (!currentPrice) return null
  const time = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null
  return (
    <div className="opt-price-strip">
      <span className="opt-price-ticker">{ticker}</span>
      <span className="opt-price-val">${f2(currentPrice)}</span>
      <span className="opt-price-vol">{sigmaLabel}</span>
      {time && (
        <span className="opt-price-ts">
          <span className="opt-price-ts-dot" />
          synced {time}
        </span>
      )}
    </div>
  )
}

// ── Plain-English next-step hint ─────────────────────────────────────────────
function SignalHint({ direction, conflict }) {
  if (conflict) return (
    <div className="opt-hint">
      Swing and Confluence are pointing in opposite directions — do not trade until both agree.
    </div>
  )
  if (!direction) return (
    <div className="opt-hint">
      Load a ticker to see your signal. Recommended strikes and expirations appear automatically.
    </div>
  )
  const isBull = direction === 'CALL'
  return (
    <div className={`opt-hint opt-hint-${isBull ? 'bull' : 'bear'}`}>
      {isBull
        ? 'All signals agree: buy CALL options. You make money when the stock goes up. Scroll down to pick your strike and expiration date.'
        : 'All signals agree: buy PUT options. You make money when the stock goes down. Scroll down to pick your strike and expiration date.'
      }
    </div>
  )
}

// ── Expiration comparison table ───────────────────────────────────────────────
function ExpiryCompare({ optionsChain, currentPrice, sigma }) {
  if (!optionsChain || !currentPrice) return (
    <div className="opt-exp-empty">Load a ticker with a live options chain to see expiration comparison.</div>
  )
  const { expirationDates, contracts, termStructure } = optionsChain
  if (!expirationDates?.length || !contracts) return (
    <div className="opt-exp-empty">Options chain data unavailable — retry the chain fetch.</div>
  )

  const S = currentPrice
  const rows = expirationDates.slice(0, 5).map((ts, i) => {
    const bucket = contracts[ts]
    const tsItem = termStructure?.[i]
    if (!bucket || !tsItem || tsItem.dte <= 0) return null

    const dte = tsItem.dte
    const T   = dte / 365
    const iv  = tsItem.iv ? tsItem.iv / 100 : sigma

    const atmCall = (bucket.calls ?? [])
      .filter(c => c.bid > 0)
      .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0]
    const atmPut = (bucket.puts ?? [])
      .filter(p => p.bid > 0)
      .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))[0]

    const callMid = atmCall ? (atmCall.bid + atmCall.ask) / 2 : null
    const putMid  = atmPut  ? (atmPut.bid  + atmPut.ask)  / 2 : null

    const callG = atmCall ? calcGreeks(S, atmCall.strike, T, iv, true)  : null
    const putG  = atmPut  ? calcGreeks(S, atmPut.strike,  T, iv, false) : null

    const callFillPct = (atmCall && callMid && callMid > 0)
      ? +((atmCall.ask - atmCall.bid) / callMid * 100).toFixed(1)
      : null
    const putFillPct  = (atmPut && putMid && putMid > 0)
      ? +((atmPut.ask  - atmPut.bid)  / putMid  * 100).toFixed(1)
      : null

    return {
      expDate:       tsItem.expDate,
      dte,
      callStrike:    atmCall?.strike ?? null,
      putStrike:     atmPut?.strike  ?? null,
      callMid,
      putMid,
      callDelta:     callG?.delta  ?? null,
      callTheta:     callG?.theta  ?? null,
      callVega:      callG?.vega   ?? null,
      putDelta:      putG?.delta   ?? null,
      callBreakeven: (atmCall && callMid) ? atmCall.strike + callMid : null,
      putBreakeven:  (atmPut  && putMid)  ? atmPut.strike  - putMid  : null,
      iv:            tsItem.iv,
      callFillPct,
      putFillPct,
    }
  }).filter(Boolean)

  if (!rows.length) return <div className="opt-exp-empty">No expiration data available — chain may still be loading.</div>

  return (
    <div className="opt-exp-wrap">
      <div className="opt-exp-header">
        <span className="opt-exp-title" data-tip="Expiration Comparison: Shows the at-the-money (ATM) option for each available expiry. ATM = the strike closest to the current stock price. Compare cost, greeks, and breakeven across time horizons to decide which expiry best matches your trade duration and risk tolerance.">EXPIRATION COMPARISON</span>
        <span className="opt-exp-sub">ATM strike across expirations · {f2(S)} current price</span>
      </div>
      <div className="opt-exp-scroll">
        <table className="opt-exp-tbl">
          <thead>
            <tr>
              <th data-tip="Expiration date — when this contract expires.">Expiry</th>
              <th data-tip="Days to Expiration. Shorter DTE = cheaper but faster time decay. Longer DTE = more time, higher premium. Sweet spot for directional buyers: 21–45 DTE.">DTE</th>
              <th data-tip="Call Strike — the call option strike closest to the current stock price (at-the-money).">Call K</th>
              <th data-tip="Call Mid — midpoint of the bid/ask spread for the ATM call. Approximate cost per share; multiply by 100 for total contract cost.">Call $</th>
              <th data-tip="Put Mid — ATM put midpoint for reference. Higher than the call mid signals bearish skew.">Put $</th>
              <th data-tip="Call Delta (Δ) — how much the option moves per $1 the stock moves. ATM calls are near 0.50. The closer to 1.0, the more it acts like stock.">Call Δ</th>
              <th data-tip="Theta (Θ/day) — dollars of premium lost per calendar day from time decay. Accelerates dramatically inside 14 DTE. This is what you fight as a buyer.">Θ/day</th>
              <th data-tip="ATM Implied Volatility — the market's expected annualized move embedded in this expiry's prices. Compare across expirations to spot term structure anomalies.">IV</th>
              <th data-tip="Call Breakeven — stock price at expiration where the call trade breaks even (strike + premium paid). The stock must exceed this level by expiry.">B/E</th>
              <th data-tip="Fill Cost % — bid/ask spread as a percentage of the mid-price: (ask−bid)/mid×100. This is the edge you give up on entry. Below 5% = tight, liquid market. 10–20% = expect slippage. Above 20% = illiquid; use limit orders at mid and be prepared to not get filled. This silent cost destroys edge on options with wide spreads.">Fill%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={row.dte <= 14 ? 'opt-exp-row-near' : ''}>
                <td className="opt-exp-date">{row.expDate}</td>
                <td
                  className={`opt-exp-dte${row.dte <= 14 ? ' near' : ''}`}
                  data-tip={row.dte <= 14
                    ? `${row.dte} days to expiration — NEAR-TERM WARNING: theta decay is accelerating sharply. Every day costs you more premium than the day before. Only hold short-DTE options if you expect the move within days.`
                    : `${row.dte} days to expiration. ${row.dte >= 45 ? 'Plenty of time — decay is slow this far out, giving the trade room to develop.' : row.dte >= 21 ? 'Sweet spot for directional buyers — balanced between premium cost and time decay rate.' : 'Time decay is picking up — make sure your catalyst is imminent.'}`}
                >{row.dte}d</td>
                <td className="opt-exp-strike"
                  data-tip="ATM Strike — the option closest to the current stock price. This is where delta is near 0.50, meaning it moves roughly $50 per $1 stock move (per contract). Strike prices are standardized — the exact ATM will be the available strike nearest to spot."
                >{row.callStrike != null ? f2(row.callStrike) : '—'}</td>
                <td className="opt-exp-mid opt-exp-call"
                  data-tip={row.callMid != null
                    ? `Call mid: $${f2(row.callMid)} per share · $${(row.callMid * 100).toFixed(0)} per contract (100 shares). This is the approximate fill price — actual fill will be between bid and ask depending on liquidity and urgency.`
                    : 'Call mid unavailable — no liquid contracts at this expiry.'}
                >{row.callMid != null ? `$${f2(row.callMid)}` : '—'}</td>
                <td className="opt-exp-mid opt-exp-put"
                  data-tip={row.putMid != null
                    ? `Put mid: $${f2(row.putMid)} per share · $${(row.putMid * 100).toFixed(0)} per contract. If put premium is significantly higher than call premium, the market is paying a fear premium — puts are in demand as a hedge.`
                    : 'Put mid unavailable — no liquid contracts at this expiry.'}
                >{row.putMid  != null ? `$${f2(row.putMid)}`  : '—'}</td>
                <td className="opt-exp-delta"
                  data-tip={row.callDelta != null
                    ? `Call delta ${fD(row.callDelta)}: a $1 stock move = ~$${(row.callDelta * 100).toFixed(0)} gain/loss per contract. Delta near 0.50 = true ATM. As the stock rises, delta moves toward 1.0 and the option behaves more like stock.`
                    : 'Delta unavailable.'}
                >{row.callDelta != null ? fD(row.callDelta) : '—'}</td>
                <td className="opt-exp-theta"
                  data-tip={row.callTheta != null
                    ? `Theta $${(Math.abs(row.callTheta) * 100).toFixed(2)}/day: you lose this much premium per calendar day from time decay alone — even if the stock doesn't move. Over the weekend you lose 3 days of theta (Fri close → Mon open). This accelerates as expiry approaches.`
                    : 'Theta unavailable.'}
                >{row.callTheta != null ? `$${(Math.abs(row.callTheta) * 100).toFixed(2)}` : '—'}</td>
                <td className="opt-exp-iv"
                  data-tip={row.iv != null
                    ? `ATM IV ${row.iv}%: the market's implied annualized move for this expiry. Higher IV = market expects bigger swings = more expensive premium. Compare across expirations — if near-term IV is much higher than far-term, that's backwardation (unusual; often earnings-driven).`
                    : 'IV unavailable for this expiry.'}
                >{row.iv != null ? `${row.iv}%` : '—'}</td>
                <td className="opt-exp-be"
                  data-tip={row.callBreakeven != null
                    ? `Call breakeven: ${f2(row.callBreakeven)} — the stock must close ABOVE this price at expiration for the trade to profit. It equals strike (${row.callStrike != null ? f2(row.callStrike) : '?'}) + premium paid (${row.callMid != null ? f2(row.callMid) : '?'}). Any profit before expiry is pure momentum — you don't have to hold to expiry.`
                    : 'Breakeven unavailable.'}
                >{row.callBreakeven != null ? f2(row.callBreakeven) : '—'}</td>
                <td
                  className="opt-exp-fill"
                  data-tip={row.callFillPct != null
                    ? `Call fill cost: ${row.callFillPct}% — you give up ${row.callFillPct}% of premium just by crossing the spread. ${row.callFillPct > 20 ? 'DANGEROUS: Use a strict limit at mid-price.' : row.callFillPct > 10 ? 'Elevated: prefer limit orders.' : 'Acceptable.'}`
                    : 'Fill cost unavailable — no live bid/ask for this expiry.'}
                  style={{ color: row.callFillPct == null ? '#4a6380' : row.callFillPct > 20 ? '#ef4444' : row.callFillPct > 10 ? '#f59e0b' : '#10b981' }}
                >
                  {row.callFillPct != null ? `${row.callFillPct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="opt-exp-note">
        Hover column headers for definitions · Call side shown · Fill% = (ask−bid)/mid — the edge you surrender on entry
      </div>
    </div>
  )
}

// ── Breakeven Speed Check ─────────────────────────────────────────────────────
function BreakevenSpeed({ rec, currentPrice, backtestResult, direction }) {
  if (!rec || !currentPrice) return null

  const { strike, dte, premium, isCall, contractCost } = rec

  const bePricePerShare = premium != null ? premium : contractCost / 100
  const bePrice = isCall
    ? strike + bePricePerShare
    : strike - bePricePerShare

  const bePct = ((bePrice - currentPrice) / currentPrice) * 100
  const absBePct = Math.abs(bePct)

  const midPct = absBePct * 0.60

  const trades = backtestResult?.trades ?? []
  const relevantTrades = trades.filter(t => {
    const tradeDir = direction === 'CALL' ? t.pct > 0 : t.pct < 0
    return tradeDir
  })

  const hitBE   = relevantTrades.filter(t => Math.abs(t.pct ?? 0) >= absBePct / 100).length
  const hitHalf = relevantTrades.filter(t => Math.abs(t.pct ?? 0) >= midPct / 100).length
  const histFreq = relevantTrades.length > 0 ? (hitBE / relevantTrades.length * 100) : null
  const halfFreq = relevantTrades.length > 0 ? (hitHalf / relevantTrades.length * 100) : null

  const freqColor = histFreq == null ? '#4a6a8a'
    : histFreq >= 45 ? '#10b981'
    : histFreq >= 25 ? '#f59e0b'
    : '#ef4444'

  const verdict = histFreq == null ? null
    : histFreq >= 45 ? 'HISTORICALLY ACHIEVABLE'
    : histFreq >= 25 ? 'CHALLENGING BUT POSSIBLE'
    : 'RARELY ACHIEVED — HIGH BAR'

  const thetaPerDay = rec.theta != null ? Math.abs(rec.theta) * 100 : null

  return (
    <div style={{
      background: '#030a14', border: '1px solid #0e1e30',
      borderRadius: 10, padding: '14px 16px', marginBottom: 0,
    }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: '#2a4060', textTransform: 'uppercase', marginBottom: 10 }}>
        Breakeven Speed Check
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ background: '#060d18', borderRadius: 8, padding: '10px 12px', border: '1px solid #0e1e30' }}>
          <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>BREAKEVEN PRICE</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#e2e8f0' }}>${bePrice.toFixed(2)}</div>
          <div style={{ fontSize: 10, color: '#4a6a8a' }}>
            {bePct >= 0 ? '+' : ''}{bePct.toFixed(1)}% from ${currentPrice.toFixed(2)}
          </div>
        </div>
        <div style={{ background: '#060d18', borderRadius: 8, padding: '10px 12px', border: '1px solid #0e1e30' }}>
          <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>MOVE REQUIRED</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#e2e8f0' }}>{absBePct.toFixed(1)}%</div>
          <div style={{ fontSize: 10, color: '#4a6a8a' }}>in {dte} days to expiry</div>
        </div>
        {histFreq != null && (
          <div style={{ background: '#060d18', borderRadius: 8, padding: '10px 12px', border: `1px solid ${freqColor}33` }}>
            <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>HIST. FREQUENCY</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: freqColor }}>{histFreq.toFixed(0)}%</div>
            <div style={{ fontSize: 10, color: '#4a6a8a' }}>of past signals hit this</div>
          </div>
        )}
        {thetaPerDay != null && (
          <div style={{ background: '#060d18', borderRadius: 8, padding: '10px 12px', border: '1px solid #0e1e30' }}>
            <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>TIME COST</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#f59e0b' }}>${thetaPerDay.toFixed(2)}/day</div>
            <div style={{ fontSize: 10, color: '#4a6a8a' }}>theta decay per contract</div>
          </div>
        )}
      </div>

      {verdict && (
        <div style={{
          padding: '8px 12px',
          background: histFreq >= 45 ? '#010e07' : histFreq >= 25 ? '#080600' : '#0e0101',
          border: `1px solid ${freqColor}33`,
          borderRadius: 6, marginBottom: 8,
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: freqColor }}>{verdict}</span>
          <span style={{ fontSize: 10, color: '#4a6a8a', marginLeft: 8 }}>
            {histFreq != null && relevantTrades.length > 0
              ? `Based on ${relevantTrades.length} historical ${direction?.toLowerCase()} signals.`
              : ''}
          </span>
        </div>
      )}

      {halfFreq != null && (
        <div style={{ fontSize: 10, color: '#4a6a8a', lineHeight: 1.6 }}>
          <strong style={{ color: '#2a4060' }}>Early exit at 50% time:</strong>{' '}
          Only needs a ~{midPct.toFixed(1)}% move to be profitable if you exit before expiry.
          Historically achieved {halfFreq.toFixed(0)}% of the time.{' '}
          <span style={{ color: '#1a3050' }}>Rule of thumb: if your option doubles, sell half. Never hold to expiry unless you have to.</span>
        </div>
      )}

      {!trades.length && (
        <div style={{ fontSize: 10, color: '#1a3050', fontStyle: 'italic' }}>
          Run the Backtest tab to add historical frequency data to this calculator.
        </div>
      )}
    </div>
  )
}

// ── Optimal Expiry Selector ───────────────────────────────────────────────────
function OptimalExpirySelector({ optionsChain, currentPrice, sigma, direction, backtestResult }) {
  if (!currentPrice || !sigma) return null

  const trades = backtestResult?.trades ?? []

  const DTE_BUCKETS = [
    { label: '2 Weeks', dte: 14, desc: 'Fastest / cheapest. High theta risk.' },
    { label: '3 Weeks', dte: 21, desc: 'Minimum recommended DTE for directional plays.' },
    { label: '1 Month', dte: 30, desc: 'Standard entry DTE. Balanced cost vs. time.' },
    { label: '45 Days', dte: 45, desc: 'Sweet spot for most swing trades.' },
    { label: '2 Months', dte: 60, desc: 'More time, more cost. Best for lower-conviction setups.' },
  ]

  const approxPremium = (S, dte, sig) => {
    const T = dte / 365
    const move = S * sig * Math.sqrt(T)
    return Math.max(0.01, move * 0.4)
  }

  const winRateForDTE = dte => {
    if (!trades.length) return null
    const rel = trades.filter(t => (t.bars ?? 999) <= dte * 0.7)
    if (rel.length < 3) return null
    return rel.filter(t => t.win).length / rel.length * 100
  }

  const rows = DTE_BUCKETS.map(b => {
    const estCost = approxPremium(currentPrice, b.dte, sigma) * 100
    const wr      = winRateForDTE(b.dte)
    const theta   = estCost / b.dte
    const isBest  = b.dte >= 30 && b.dte <= 45
    return { ...b, estCost, wr, theta, isBest }
  })

  const hasHistData = rows.some(r => r.wr != null)

  return (
    <div style={{
      background: '#030a14', border: '1px solid #0e1e30',
      borderRadius: 10, padding: '14px 16px', marginTop: 12,
    }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: '#2a4060', textTransform: 'uppercase', marginBottom: 4 }}>
          Optimal Expiry Selector
        </div>
        <div style={{ fontSize: 11, color: '#4a6a8a' }}>
          Which expiration gives you the best balance of cost, time, and historical edge for this ticker?
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8 }}>
        {rows.map(r => (
          <div key={r.dte} style={{
            background: r.isBest ? '#010e07' : '#060d18',
            border: `1px solid ${r.isBest ? '#065f46' : '#0e1e30'}`,
            borderRadius: 8, padding: '10px 12px',
            position: 'relative',
          }}>
            {r.isBest && (
              <div style={{
                position: 'absolute', top: -1, right: -1,
                background: '#065f46', color: '#10b981',
                fontSize: 8, fontWeight: 800, padding: '2px 7px',
                borderRadius: '0 8px 0 6px', letterSpacing: 0.5,
              }}>SWEET SPOT</div>
            )}
            <div style={{ fontSize: 10, fontWeight: 800, color: r.isBest ? '#10b981' : '#e2e8f0', marginBottom: 6 }}>
              {r.label}
              <span style={{ fontSize: 9, color: '#2a4060', marginLeft: 4 }}>({r.dte}d)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: '#4a6a8a' }}>Est. cost</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#e2e8f0' }}>${r.estCost.toFixed(0)}/contract</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: '#4a6a8a' }}>Theta/day</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b' }}>-${r.theta.toFixed(2)}</span>
              </div>
              {r.wr != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: '#4a6a8a' }}>Hist. win rate</span>
                  <span style={{ fontSize: 10, fontWeight: 700,
                    color: r.wr >= 50 ? '#10b981' : r.wr >= 35 ? '#f59e0b' : '#ef4444'
                  }}>{r.wr.toFixed(0)}%</span>
                </div>
              )}
            </div>
            <div style={{ fontSize: 9, color: '#1a3050', marginTop: 6, lineHeight: 1.4 }}>{r.desc}</div>
          </div>
        ))}
      </div>

      {!hasHistData && (
        <div style={{ fontSize: 10, color: '#1a3050', marginTop: 10, fontStyle: 'italic' }}>
          Historical win rates by DTE appear here once you run the Backtest tab for this ticker.
        </div>
      )}

      <div style={{ fontSize: 10, color: '#1a3050', marginTop: 10, lineHeight: 1.6 }}>
        <strong style={{ color: '#2a4060' }}>General rule:</strong> 30–45 DTE is the sweet spot for most directional plays.
        You have enough time for the trade to work without paying excessive theta.
        Never buy options with less than 21 days unless you have an A+ grade setup with confirmed entry.
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function OptionsChain({
  ticker, currentPrice, historicalVol, swingResult, confluenceResult,
  setupGrade, patterns, hsPatterns, ivData, lastUpdated,
  earningsDate, adxSignal, optionsChain, chainFetchDone, onRetryChain,
  backtestResult, wyckoffData, masterSignal, onLogTrade,
}) {
  const [conviction,    setConviction]    = useState('standard')
  const convictionLockedRef = useRef(false)  // prevents auto-set from overriding user's click
  const [optionsView,   setOptionsView]   = useState('recommendations')  // 'recommendations' | 'structure'

  const accountSize = +(localStorage.getItem('rp_account')  || 25000)
  const riskPct     = +(localStorage.getItem('rp_risk_pct') || 1.0)
  const maxRisk     = accountSize * (riskPct / 100)

  const swingSignal = swingResult?.signal
  const cfSignal    = confluenceResult?.signal

  // masterSignal is the single source of truth for direction, conflict, and sigma.
  // Falls back to local computation if masterSignal is not yet available.
  const direction = masterSignal != null
    ? masterSignal.direction
    : (() => {
        if (swingSignal === 'LONG' || cfSignal === 'CALL') return 'CALL'
        if (swingSignal === 'EXIT' || cfSignal === 'PUT')  return 'PUT'
        return null
      })()

  const conflict = masterSignal != null
    ? masterSignal.blocked
    : ((swingSignal === 'LONG' && cfSignal === 'PUT') || (swingSignal === 'EXIT' && cfSignal === 'CALL'))

  // Use masterSignal sigma (best available, computed from live IV → 30d HVol → ticker-derived estimate)
  const sigma      = masterSignal?.sigma ?? (ivData?.atmIV != null ? ivData.atmIV / 100 : (historicalVol ?? 0.25))
  const sigmaLabel = masterSignal?.sigmaLabel ?? (ivData?.atmIV != null
    ? `Market IV ${(+ivData.atmIV).toFixed(1)}%`
    : `30d HVol ${(sigma * 100).toFixed(1)}%`)

  const patternTarget = direction === 'CALL'
    ? (patterns?.doubleBottom?.target ?? hsPatterns?.inverseHAndS?.target ?? null)
    : (patterns?.doubleTop?.target    ?? hsPatterns?.headAndShoulders?.target ?? null)

  const ivRank = ivData?.ivRank ?? null

  // ── Auto-Conviction: multi-factor formula ────────────────────────────────────
  // Reset manual lock when the ticker changes so auto-set applies to each new stock.
  useEffect(() => { convictionLockedRef.current = false }, [ticker])

  // Runs whenever signal quality, IV, Wyckoff, or backtest changes.
  // Skipped if the user has manually clicked a conviction level.
  useEffect(() => {
    if (convictionLockedRef.current) return  // user manually selected — don't override
    if (conflict || !direction) { setConviction('standard'); return }
    const conf    = masterSignal?.confidence ?? 0
    const tfScore = masterSignal?.tfScore    ?? 0
    const r       = ivRank ?? 50
    const wyPhase = (wyckoffData?.phase ?? '').toLowerCase()
    const wyckOk  = direction === 'CALL'
      ? wyPhase.includes('accumulation') || wyPhase.includes('markup')
      : direction === 'PUT'
      ? wyPhase.includes('distribution') || wyPhase.includes('markdown')
      : true
    const winRate = backtestResult?.winRate ?? 0
    if (conf < 55 || r > 60 || tfScore < 2) { setConviction('conservative'); return }
    if (conf >= 70 && tfScore >= 4 && r < 30 && wyckOk && winRate >= 0.60) { setConviction('aggressive'); return }
    setConviction('standard')
  }, [direction, conflict, masterSignal, ivRank, wyckoffData, backtestResult])

  // ── Smart Chain Refresh: price-drift tracking ─────────────────────────────────
  const chainFetchPriceRef  = useRef(null)
  const chainFetchTimeRef   = useRef(null)
  const [chainDriftPct, setChainDriftPct] = useState(null)
  const [refreshIn, setRefreshIn]         = useState(null)  // seconds to next auto-refresh

  // Record price when chain loads
  useEffect(() => {
    if (optionsChain && currentPrice) {
      chainFetchPriceRef.current = currentPrice
      chainFetchTimeRef.current  = Date.now()
      setChainDriftPct(null)
    }
  }, [optionsChain])

  // Price-drift watcher — trigger retry when price moves > 0.5%
  useEffect(() => {
    const fetchPrice = chainFetchPriceRef.current
    if (!fetchPrice || !currentPrice || !onRetryChain) return
    const drift = Math.abs(currentPrice - fetchPrice) / fetchPrice
    setChainDriftPct(drift > 0.001 ? +(drift * 100).toFixed(2) : null)
    if (drift > 0.005) {
      chainFetchPriceRef.current = currentPrice  // prevent repeat trigger
      onRetryChain()
    }
  }, [currentPrice])

  // 5-minute auto-refresh countdown + trigger during market hours
  useEffect(() => {
    if (!onRetryChain) return
    const INTERVAL = 5 * 60 * 1000
    const tick = () => {
      const elapsed = Date.now() - (chainFetchTimeRef.current ?? Date.now())
      const secs = Math.max(0, Math.ceil((INTERVAL - elapsed) / 1000))
      setRefreshIn(secs)
      if (elapsed >= INTERVAL) {
        const now = new Date()
        const etHour = (now.getUTCHours() * 60 + now.getUTCMinutes() - 300 + 1440) % 1440 / 60
        if (etHour >= 9.5 && etHour < 16) onRetryChain()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [onRetryChain, optionsChain])

  const chainTimestamps = optionsChain?.expirationDates ?? null

  const recs = currentPrice && direction && !conflict
    ? generateRecommendations(currentPrice, sigma, direction, conviction, {
        setupGrade:    setupGrade?.grade ?? null,
        patternTarget,
        ivRank,
        chainTimestamps,
        liveContracts: optionsChain?.contracts ?? null,
        gexData:       optionsChain?.gexData   ?? null,
      })
    : null

  if (!ticker) return (
    <div className="opt-empty">
      <div className="opt-empty-icon">📊</div>
      <div className="opt-empty-text">Enter a ticker and click Load</div>
      <div className="opt-empty-sub">
        Option recommendations generate instantly — no options chain download needed.
        Uses Black-Scholes math on historical volatility.
      </div>
    </div>
  )

  if (chainFetchDone && optionsChain?.empty) return (
    <div className="opt-empty">
      <div className="opt-empty-icon">🚫</div>
      <div className="opt-empty-text">No options available for {ticker}</div>
      <div className="opt-empty-sub">
        This ticker has no listed options on Yahoo Finance.<br />
        It may be an OTC stock, micro-cap, ETF, or index that does not support options trading.<br />
        Switch to the <strong>Stock Plan</strong> tab to trade shares directly.
      </div>
    </div>
  )

  return (
    <div className="opt-root">
      {/* Sub-view toggle */}
      <div className="sub-toggle" style={{ margin: '0 0 12px' }}>
        <button
          className={`sub-btn${optionsView === 'recommendations' ? ' active' : ''}`}
          onClick={() => setOptionsView('recommendations')}
        >Recommendations</button>
        <button
          className={`sub-btn${optionsView === 'structure' ? ' active' : ''}`}
          onClick={() => setOptionsView('structure')}
        >
          Market Structure
          {optionsChain && <span className="tab-badge" style={{ marginLeft: 4 }}>GEX</span>}
        </button>
        <button
          className={`sub-btn${optionsView === 'expiry' ? ' active' : ''}`}
          onClick={() => setOptionsView('expiry')}
          data-tip="Expiration Comparison: Side-by-side view of the same ATM strike across multiple expiration dates. Use this to choose your hold time — compare cost, delta, daily theta decay, and breakeven for each expiry. Shorter DTE = cheaper premium but faster time decay. 21–45 DTE is the sweet spot for directional buyers."
        >
          Expirations
          {optionsChain?.expirationDates?.length > 0 && (
            <span className="tab-badge" style={{ marginLeft: 4 }}>{optionsChain.expirationDates.length}</span>
          )}
        </button>
      </div>

      {/* Market Structure view — GEX, term structure, P/C */}
      {optionsView === 'structure' && (
        <>
          <GEXChart chain={optionsChain} ticker={ticker} currentPrice={currentPrice} onRetry={onRetryChain} />
          <TermStructureChart termStructure={optionsChain?.termStructure} />
        </>
      )}

      {/* Expiration comparison table */}
      {optionsView === 'expiry' && (
        <>
          <ExpiryCompare optionsChain={optionsChain} currentPrice={currentPrice} sigma={sigma} />
          <OptimalExpirySelector
            optionsChain={optionsChain}
            currentPrice={currentPrice}
            sigma={sigma}
            direction={conflict ? null : direction}
            backtestResult={backtestResult}
          />
        </>
      )}

      {/* Recommendations view */}
      {optionsView === 'recommendations' && (
      <>
      <PriceStrip
        ticker={ticker}
        currentPrice={currentPrice}
        sigma={sigma}
        sigmaLabel={sigmaLabel}
        lastUpdated={lastUpdated}
      />

      <DirBar
        direction={conflict ? null : direction}
        conflict={conflict}
        ticker={ticker}
        currentPrice={currentPrice}
        setupGrade={setupGrade}
        swingSignal={swingSignal}
        cfSignal={cfSignal}
      />

      {/* One-line master status bar — direction, confidence, TF score, vol, block reason */}
      <SignalSummaryBar
        masterSignal={masterSignal}
        direction={conflict ? null : direction}
        conflict={conflict}
        sigmaLabel={sigmaLabel}
      />

      <SignalHint direction={conflict ? null : direction} conflict={conflict} />

      <div className="opt-account-bar">
        <span className="opt-acct-item">Account <strong>${accountSize.toLocaleString()}</strong></span>
        <span className="opt-acct-sep">·</span>
        <span className="opt-acct-item">Risk <strong>{riskPct}%</strong></span>
        <span className="opt-acct-sep">·</span>
        <span className="opt-acct-item">Budget <strong>${maxRisk.toFixed(0)}</strong></span>
        {setupGrade && (
          <>
            <span className="opt-acct-sep">·</span>
            <span className="opt-acct-item">
              Grade: <strong style={{ color: setupGrade.color }}>{setupGrade.grade}</strong>
              <span style={{ color: '#3a5070', fontSize: 9 }}> → {
                setupGrade.grade === 'A+' ? '25d min DTE · quick play ON'
                : setupGrade.grade === 'A' ? '30d min DTE · quick play ON'
                : setupGrade.grade === 'B' ? '38d min DTE'
                : '48d min DTE'
              }</span>
            </span>
          </>
        )}
        <span className="opt-acct-note">Change risk % in Analyze → Timing → Risk Panel</span>
      </div>

      {/* ── Conviction — top of view so it controls the Picks below ── */}
      {direction && !conflict && (
        <>
          <div style={{ fontSize: 9, color: '#3a5070', marginBottom: 2, letterSpacing: 0.5 }}>
            CONVICTION — controls which delta (strike moneyness) is targeted · AUTO-SET · click to override
          </div>
          <ConvictionBar conviction={conviction} onChange={(key) => {
            convictionLockedRef.current = true
            setConviction(key)
          }} />
        </>
      )}

      {/* ── PICKS ───────────────────────────────────────────────────────────── */}
      {recs && (
        <>
          <SeverityDivider emoji="🎯" label="Picks" color="#6366f1" borderColor="#312e81" />
          <GEXStructureRec
            totalNetGEX={optionsChain?.totalNetGEX}
            direction={conflict ? null : direction}
          />
          <div className="opt-picks-row" style={recs.quickPlay ? { gridTemplateColumns: '1fr 1fr 1fr' } : undefined}>
            {recs.quickPlay && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div className="opt-quickplay-header" style={{ borderRadius: '6px 6px 0 0', marginBottom: 0 }}>
                  ⚡ QUICK PLAY · {setupGrade?.grade} GRADE · CONFIRM 4H FIRST
                </div>
                <RecCard
                  rec={recs.quickPlay}
                  ticker={ticker}
                  maxRisk={maxRisk}
                  currentPrice={currentPrice}
                  ivRank={ivRank}
                  sigma={sigma}
                  grade={setupGrade}
                  adxSignal={adxSignal}
                  wyckoffData={wyckoffData}
                  backtestResult={backtestResult}
                  onLog={onLogTrade}
                  isQuickPlay
                />
              </div>
            )}
            <RecCard
              rec={recs.primary}
              ticker={ticker}
              maxRisk={maxRisk}
              currentPrice={currentPrice}
              ivRank={ivRank}
              sigma={sigma}
              grade={setupGrade}
              adxSignal={adxSignal}
              wyckoffData={wyckoffData}
              backtestResult={backtestResult}
              onLog={onLogTrade}
            />
            <RecCard
              rec={recs.extended}
              ticker={ticker}
              maxRisk={maxRisk}
              currentPrice={currentPrice}
              ivRank={ivRank}
              sigma={sigma}
              grade={setupGrade}
              adxSignal={adxSignal}
              wyckoffData={wyckoffData}
              backtestResult={backtestResult}
              onLog={onLogTrade}
            />
          </div>
        </>
      )}

      {/* ── CRITICAL ────────────────────────────────────────────────────────── */}
      {/* Compute severity for OptionsRegimeClassifier so it renders in the right tier */}
      {(() => {
        const r   = ivRank
        const gex = optionsChain?.totalNetGEX
        const ts  = optionsChain?.termStructure ?? []
        const tsBack = ts.length >= 2
          ? (() => { const near = ts[0]?.iv, far = ts[ts.length - 1]?.iv; return near != null && far != null && near > far * 1.05 })()
          : false
        const regimeCritical = (r != null && r > 70) || (gex != null && gex < -500000000) || tsBack
        const regimeImportant = !regimeCritical && r != null && r < 20

        const hasCritical = conflict
          || !!(masterSignal?.blocked)
          || !!(masterSignal?.conflicts?.length > 0)
          || regimeCritical
          || !!earningsDate
          || (r != null && r > 60)

        return (
          <>
            {/* Green Light Protocol — goes between Picks and Critical */}
            <GreenLightProtocol
              masterSignal={masterSignal}
              ivData={ivData}
              earningsDate={earningsDate}
              recs={recs}
            />

            {hasCritical && (
              <SeverityDivider emoji="🔴" label="Critical — Read Before Trading" color="#ef4444" borderColor="#7f1d1d" />
            )}
            {conflict && (
              <div className="opt-conflict-note">
                ⚠ Signals conflict — Timing says {swingSignal === 'LONG' ? 'go long' : 'exit/short'} but Signals (confluence) says {cfSignal}.
                Both must agree before entering any option position.
              </div>
            )}
            <MasterSignalWarnings masterSignal={masterSignal} />
            {regimeCritical && (
              <OptionsRegimeClassifier ivData={ivData} optionsChain={optionsChain} direction={conflict ? null : direction} />
            )}
            <EarningsWarning earningsDate={earningsDate} recs={recs} />
            <SpreadAlert ivRank={ivRank} direction={direction} currentPrice={currentPrice} sigma={sigma} recs={recs} />

            {/* ── IMPORTANT ─────────────────────────────────────────────────── */}
            <SeverityDivider emoji="🟡" label="Important — Verify Before Entry" color="#f59e0b" borderColor="#78350f" />
            <EntryChecklist
              direction={conflict ? null : direction}
              conflict={conflict}
              adxSignal={adxSignal}
              earningsDate={earningsDate}
              ivData={ivData}
              setupGrade={setupGrade}
              wyckoffData={wyckoffData}
              backtestResult={backtestResult}
            />
            <EdgeDecayBanner
              monthlyBreakdown={backtestResult?.monthlyBreakdown}
              allTimeWinRate={backtestResult?.winRate ?? 0}
            />
            <IVRankBanner ivData={ivData} />
            {regimeImportant && (
              <OptionsRegimeClassifier ivData={ivData} optionsChain={optionsChain} direction={conflict ? null : direction} />
            )}
            {chainFetchDone && !optionsChain && (
              <div className="opt-chain-unavail">
                <span className="opt-chain-icon">↺</span>
                <div>
                  <div className="opt-chain-unavail-title">Live chain unavailable</div>
                  <div className="opt-chain-unavail-sub">
                    Expiration dates are estimated (3rd Friday each month) — actual available expirations
                    may differ. Premiums and strikes are Black-Scholes estimates.
                    Verify all details on your broker before placing any order.
                  </div>
                </div>
                {onRetryChain && (
                  <button className="opt-chain-retry-btn" onClick={onRetryChain}>Retry Chain</button>
                )}
              </div>
            )}
            {optionsChain && !optionsChain.empty && (
              <div className="opt-chain-ok">
                ✓ Live chain loaded · real expiry dates · {optionsChain.expiryCount ?? '?'} expiries
                {chainDriftPct != null && chainDriftPct >= 0.5 && (
                  <span style={{ color: '#f59e0b', marginLeft: 8 }}>
                    · ⚠ price drifted {chainDriftPct.toFixed(1)}% from chain fetch
                  </span>
                )}
                {refreshIn != null && (
                  <span style={{ color: '#3a5070', marginLeft: 8 }}>
                    · refresh in {Math.floor(refreshIn / 60)}:{String(refreshIn % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
            )}

            {/* ── CONTEXT ───────────────────────────────────────────────────── */}
            <SeverityDivider emoji="🟢" label="Context" color="#10b981" borderColor="#065f46" />
            <ExpectedMoveVisualizer currentPrice={currentPrice} sigma={sigma} ivData={ivData} />
            <MarketSentimentStrip optionsChain={optionsChain} currentPrice={currentPrice} />
            <GEXStripCompact optionsChain={optionsChain} currentPrice={currentPrice} />
            {recs?.primary && (
              <BreakevenSpeed rec={recs.primary} currentPrice={currentPrice} backtestResult={backtestResult} direction={conflict ? null : direction} />
            )}

            {/* ── ANALYSIS ──────────────────────────────────────────────────── */}
            {recs?.primary && (
              <>
                <SeverityDivider emoji="📊" label="Analysis" color="#94a3b8" borderColor="#334155" />
                <ThetaCalendar
                  rec={recs.primary}
                  sigma={sigma}
                  currentPrice={currentPrice}
                  medianHold={computeMedianBarsHeld(backtestResult?.trades ?? [])}
                />
                <HistoricalStrikeHint
                  trades={backtestResult?.trades}
                  currentPrice={currentPrice}
                  direction={conflict ? null : direction}
                  recStrike={recs.primary?.strike}
                />
                <GradeRegimeMatrix trades={backtestResult?.trades} />
                {(() => {
                  const mfb = computeMultiFactorBudget(maxRisk, ivRank, wyckoffData, backtestResult)
                  const qty = recs.primary.contractCost > 0
                    ? Math.floor(mfb.budget / recs.primary.contractCost)
                    : 0
                  return (
                    <PnLScenarios
                      rec={recs.primary}
                      currentPrice={currentPrice}
                      qty={qty}
                      backtestResult={backtestResult}
                    />
                  )
                })()}
                <StrikeComparison
                  rec={recs.primary}
                  currentPrice={currentPrice}
                  ticker={ticker}
                  liveContracts={optionsChain?.contracts}
                />
                {recs.primary.strike && recs.primary.dte > 0 && (() => {
                  const { budget } = ivBudget(maxRisk, ivRank)
                  const qty     = recs.primary.contractCost > 0 ? Math.floor(budget / recs.primary.contractCost) : 1
                  const premium = recs.primary.contractCost / 100
                  return (
                    <OptionsPnlGraph
                      S={currentPrice}
                      K={recs.primary.strike}
                      T={recs.primary.dte / 365}
                      sigma={sigma}
                      isCall={direction === 'CALL'}
                      premium={premium}
                      contracts={Math.max(1, qty)}
                    />
                  )
                })()}
              </>
            )}
          </>
        )
      })()}

      <div className="opt-disclaimer">
        {recs?.primary?.isLive
          ? `ℹ Premiums sourced from live bid/ask mid-price (${sigmaLabel}). Greeks use per-contract implied volatility. Verify on your broker before placing any order.`
          : `ℹ Premiums are Black-Scholes theoretical estimates using ${sigmaLabel}. Actual market prices will differ — verify on your broker before placing any order.`
        }
        {chainTimestamps?.length
          ? ' Expiry dates are real Yahoo Finance dates — expirations match your broker.'
          : ' Expiry dates are estimated (3rd Friday of each month) — actual expirations may differ.'
        }
        {recs?.primary && setupGrade && ` DTE floors are grade-adaptive: ${setupGrade.grade} grade uses ${
          setupGrade.grade === 'A+' ? '25' : setupGrade.grade === 'A' ? '30'
          : setupGrade.grade === 'B' ? '38' : '48'
        }d minimum.`}
      </div>
      </>
      )}
    </div>
  )
}
