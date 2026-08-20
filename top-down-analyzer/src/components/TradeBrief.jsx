// TradeBrief — single-screen trade summary that surfaces every key output
// without requiring the user to visit multiple tabs.

import { useMemo, useState, useEffect, useRef } from 'react'
import { generateRecommendations, generateSpreads } from '../utils/fetchOptions'
import { classifyPullback, calcATR } from '../utils/indicators'
import { useEmaNames } from '../utils/emaNames'
import { runBacktest } from '../utils/runBacktest'
import { calcConditionalWinRate } from '../utils/calcConditionalWinRate'
import { getUpcomingEvents } from '../utils/economicCalendar'
import VerdictPanel from './VerdictPanel'
import TradePlan from './TradePlan'
import ExitPlan from './ExitPlan'
import './TradeBrief.css'

const f2 = v => (v != null && !isNaN(v)) ? (+v).toFixed(2) : '—'
const f0 = v => (v != null && !isNaN(v)) ? Math.round(+v).toLocaleString() : '—'

// ── Score arc (SVG gauge) ────────────────────────────────────────────────────
function ScoreArc({ score, color }) {
  const R = 36, cx = 50, cy = 52
  const sweep = 220  // degrees total arc
  const start = -110 // degrees from top (offset so arc goes bottom-left to bottom-right)

  function polarXY(deg) {
    const rad = ((deg - 90) * Math.PI) / 180
    return { x: cx + R * Math.cos(rad), y: cy + R * Math.sin(rad) }
  }
  function arcPath(fromDeg, toDeg) {
    const s = polarXY(fromDeg)
    const e = polarXY(toDeg)
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
  }

  const filledDeg = (score / 100) * sweep

  return (
    <svg width="100" height="84" viewBox="0 0 100 84" className="tb-arc-svg">
      <path d={arcPath(start, start + sweep)} fill="none" stroke="#1e2d45" strokeWidth="7" strokeLinecap="round" />
      {score > 0 && (
        <path d={arcPath(start, start + filledDeg)} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
      )}
      <text x={cx} y={cy + 5} textAnchor="middle" fill="#e2e8f0" fontSize="22" fontWeight="800" fontFamily="monospace">{score}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="#3a5070" fontSize="8" fontFamily="monospace">/ 100</text>
    </svg>
  )
}

// ── Score breakdown tooltip ──────────────────────────────────────────────────
function ScoreBreakdown({ breakdown }) {
  if (!breakdown?.length) return null
  return (
    <div className="tb-breakdown">
      {breakdown.map(b => {
        const isPenalty = b.score < 0
        const barWidth  = isPenalty ? `${(Math.abs(b.score) / b.max) * 100}%` : `${(b.score / b.max) * 100}%`
        const barColor  = isPenalty ? '#ef4444' : undefined
        return (
          <div key={b.label} className="tb-bkd-row" data-tip={`${b.label}: ${b.score > 0 ? '+' : ''}${b.score} out of ${b.max} points. ${b.note}`}>
            <span className="tb-bkd-label" style={isPenalty ? { color: '#ef4444' } : undefined}>{b.label}</span>
            <div className="tb-bkd-bar-track">
              <div
                className="tb-bkd-bar-fill"
                style={{ width: barWidth, opacity: b.score !== 0 ? 1 : 0.2, background: barColor }}
              />
            </div>
            <span className="tb-bkd-pts" style={isPenalty ? { color: '#ef4444' } : undefined}>{b.score}/{b.max}</span>
            <span className="tb-bkd-note">{b.note}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Pre-market go/no-go checklist ────────────────────────────────────────────
function PreMarketCheck({ tradeScore, vixData, ivData, earningsDate, regimeBlocked, confluenceResult, swingResult }) {
  const score  = tradeScore?.score ?? 0
  const signal = confluenceResult?.signal
  if (!signal) return null

  const checks = []

  // 1. VIX / regime
  if (regimeBlocked) {
    checks.push({ id: 'regime', st: 'no', label: 'HIGH RISK — NO CALLS', detail: 'VIX >28 + weekly bearish — macro hostile to longs' })
  } else if (vixData?.current > 28) {
    checks.push({ id: 'vix', st: 'no', label: `VIX ${vixData.current.toFixed(0)} — TOO HIGH`, detail: 'Market fear is extreme — PUTs only or stand aside' })
  } else if (vixData?.current > 20) {
    checks.push({ id: 'vix', st: 'caution', label: `VIX ${vixData.current.toFixed(0)} — ELEVATED`, detail: 'Market is nervous — reduce position size 20–30%' })
  } else if (vixData?.current) {
    checks.push({ id: 'vix', st: 'go', label: `VIX ${vixData.current.toFixed(0)} — CALM`, detail: 'Market fear is low — good conditions for buying options' })
  } else {
    checks.push({ id: 'vix', st: 'caution', label: 'VIX UNKNOWN', detail: 'Treat as elevated — no macro data available' })
  }

  // 2. IV conditions
  if (ivData?.ivRank != null) {
    const r = ivData.ivRank
    if (r > 60)      checks.push({ id: 'iv', st: 'caution', label: `IV RANK ${Math.round(r)} — EXPENSIVE`, detail: 'Use spread or cut size 40%' })
    else if (r > 35) checks.push({ id: 'iv', st: 'caution', label: `IV RANK ${Math.round(r)} — MODERATE`,  detail: 'Standard sizing' })
    else             checks.push({ id: 'iv', st: 'go',      label: `IV RANK ${Math.round(r)} — CHEAP`,     detail: 'Good conditions to buy premium' })
  }

  // 3. Earnings proximity
  if (earningsDate) {
    const d = Math.round((earningsDate.getTime() - Date.now()) / 86400000)
    if (d > 0 && d <= 14)      checks.push({ id: 'earn', st: 'no',      label: `EARNINGS IN ${d}d`, detail: 'Close before event or use defined-risk spread' })
    else if (d > 0 && d <= 30) checks.push({ id: 'earn', st: 'caution', label: `EARNINGS IN ${d}d`, detail: 'Choose expiry that clears the date' })
    else                        checks.push({ id: 'earn', st: 'go',      label: 'NO EARNINGS THREAT', detail: 'No catalyst risk within 30 days' })
  }

  // 4. Trade score gate
  if (score >= 60)      checks.push({ id: 'score', st: 'go',      label: `SCORE ${score} — CONFIRMED`,  detail: 'Signal quality sufficient — proceed' })
  else if (score >= 42) checks.push({ id: 'score', st: 'caution', label: `SCORE ${score} — DEVELOPING`, detail: 'Wait for ≥60 or reduce size significantly' })
  else if (score > 0)   checks.push({ id: 'score', st: 'no',      label: `SCORE ${score} — TOO WEAK`,   detail: 'Do not enter — minimum score of 60 required' })

  // 5. Entry timing alignment
  const sw = swingResult?.signal
  if (signal !== 'NO TRADE') {
    const aligned = (signal === 'CALL' && sw === 'LONG') || (signal === 'PUT' && sw === 'EXIT')
    if (aligned && swingResult?.confirmed)
      checks.push({ id: 'align', st: 'go',      label: 'ENTRY CONFIRMED',    detail: `${signal} + 4H fully confirmed — entry signal active` })
    else if (aligned)
      checks.push({ id: 'align', st: 'caution', label: 'ENTRY FORMING',      detail: '4H 1-bar forming — wait for second bar close' })
    else
      checks.push({ id: 'align', st: 'caution', label: 'WAITING FOR TIMING', detail: `Direction ${signal} — 4H entry not yet triggered` })
  }

  const hasNo      = checks.some(c => c.st === 'no')
  const hasCaution = checks.some(c => c.st === 'caution')
  const verdict    = hasNo ? 'NO TRADE' : hasCaution ? 'CAUTION' : 'GO'
  const vc    = { 'NO TRADE': '#ef4444', 'CAUTION': '#f59e0b', 'GO': '#10b981' }[verdict]
  const vbg   = { 'NO TRADE': '#130303', 'CAUTION': '#120d01', 'GO': '#01120a' }[verdict]
  const vbord = { 'NO TRADE': '#3d0808', 'CAUTION': '#4d3800', 'GO': '#064e2e' }[verdict]

  return (
    <div className="tb-premarket" style={{ background: vbg, borderColor: vbord }}>
      <div className="tb-pm-head">
        <span className="tb-pm-title">PRE-MARKET CHECK</span>
        <span className="tb-pm-verdict" style={{ color: vc }}>{verdict}</span>
      </div>
      <div className="tb-pm-checks">
        {checks.map(c => {
          const dot   = c.st === 'go' ? '●' : c.st === 'caution' ? '◐' : '○'
          const color = c.st === 'go' ? '#10b981' : c.st === 'caution' ? '#f59e0b' : '#ef4444'
          return (
            <div key={c.id} className="tb-pm-row">
              <span className="tb-pm-dot" style={{ color }}>{dot}</span>
              <span className="tb-pm-label" style={{ color }}>{c.label}</span>
              <span className="tb-pm-detail">{c.detail}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Key price levels ─────────────────────────────────────────────────────────
function KeyLevels({ fibLevels, orbRetest, currentPrice, direction }) {
  if (!fibLevels && !orbRetest) return null
  const isCall = direction === 'CALL'

  const levels = []

  if (orbRetest?.orHigh) levels.push({ label: 'OR High', value: orbRetest.orHigh, type: 'orb' })
  if (orbRetest?.orLow)  levels.push({ label: 'OR Low',  value: orbRetest.orLow,  type: 'orb' })

  if (fibLevels) {
    if (fibLevels.ret618 != null) levels.push({ label: 'Fib 61.8% Ret.', value: fibLevels.ret618, type: 'ret' })
    if (fibLevels.ret382 != null) levels.push({ label: 'Fib 38.2% Ret.', value: fibLevels.ret382, type: 'ret' })
    if (fibLevels.ext100 != null) levels.push({ label: 'Fib 1.0 Ext.',   value: fibLevels.ext100, type: 'ext' })
    if (fibLevels.ext618 != null) levels.push({ label: 'Fib 1.618 Ext.', value: fibLevels.ext618, type: 'ext' })
  }

  if (!levels.length) return null

  // Sort: closest to current price first
  if (currentPrice) levels.sort((a, b) => Math.abs(a.value - currentPrice) - Math.abs(b.value - currentPrice))

  return (
    <div className="tb-levels-grid">
      <div className="tb-section-title">KEY LEVELS</div>
      {levels.slice(0, 5).map((lv, i) => {
        const pctAway = currentPrice ? ((lv.value - currentPrice) / currentPrice * 100) : null
        const isTarget = isCall ? lv.value > (currentPrice ?? 0) : lv.value < (currentPrice ?? 0)
        return (
          <div key={i} className="tb-level-row">
            <span className="tb-level-label" style={lv.type === 'orb' ? { color: '#f59e0b' } : undefined}>
              {lv.label}
            </span>
            <span className="tb-level-price">${f2(lv.value)}</span>
            {pctAway != null && (
              <span className={`tb-level-pct${isTarget ? ' tb-level-target' : ' tb-level-support'}`}>
                {pctAway >= 0 ? '+' : ''}{pctAway.toFixed(1)}%
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── NO TRADE verdict card ────────────────────────────────────────────────────
function NoTradeCard({ vixData, ivData, confluenceResult }) {
  const bull    = confluenceResult?.totalBull ?? 0
  const bear    = confluenceResult?.totalBear ?? 0
  const vixHigh = vixData?.current != null && vixData.current > 25
  const ivHigh  = ivData?.ivRank != null && ivData.ivRank > 60

  const reasons = []
  if (bull > bear) reasons.push(`Bull signals lead ${bull}/${bear} — not strong enough for a CALL yet`)
  else if (bear > bull) reasons.push(`Bear signals lead ${bear}/${bull} — not strong enough for a PUT yet`)
  else if (bull === bear && bull > 0) reasons.push(`Signals tied ${bull}/${bear} — no directional edge`)
  else reasons.push('Confluence not aligned across timeframes')
  if (vixHigh) reasons.push(`VIX ${vixData.current.toFixed(1)} — elevated market risk, options are priced for fear`)
  if (ivHigh)  reasons.push(`IV Rank ${ivData.ivRank.toFixed(0)} — buying premium here means paying up`)

  const waitFor = bull > bear ? 'stronger bullish confluence (add 1–2 more timeframes)' : bear > bull ? 'stronger bearish confluence across timeframes' : 'a clear directional break'

  return (
    <div className="tb-notrade-card">
      <div className="tb-notrade-head">
        <span className="tb-notrade-icon">◼</span>
        <div>
          <div className="tb-notrade-title">CASH IS A POSITION</div>
          <div className="tb-notrade-sub">No setup meets the entry criteria right now</div>
        </div>
      </div>
      <div className="tb-notrade-reasons">
        {reasons.map((r, i) => (
          <div key={i} className="tb-notrade-reason">
            <span className="tb-notrade-dash">—</span>
            <span>{r}</span>
          </div>
        ))}
      </div>
      <div className="tb-notrade-rule">
        Wait for {waitFor}. Forcing a trade costs more than sitting out.
        No losing trades is a winning session.
      </div>
    </div>
  )
}

// ── Signal history from sim trades ───────────────────────────────────────────
function SignalHistory({ ticker, direction }) {
  const history = useMemo(() => {
    if (!ticker || !direction) return null
    let ptHist
    try { ptHist = JSON.parse(localStorage.getItem('pt-hist') || '[]') } catch { return null }
    if (!ptHist.length) return null

    const isCall   = direction === 'CALL'
    const relevant = ptHist.filter(t =>
      t.ticker === ticker &&
      t.type   === 'option' &&
      t.optType === (isCall ? 'call' : 'put') &&
      t.closePl != null
    )
    if (!relevant.length) return null

    const wins  = relevant.filter(t => t.closePl > 0).length
    const total = relevant.length
    const avgPL = relevant.reduce((s, t) => s + t.closePl, 0) / total

    return { wins, losses: total - wins, total, avgPL }
  }, [ticker, direction])

  if (!history) return null

  const winRate = history.total > 0 ? (history.wins / history.total * 100).toFixed(0) : 0
  const isPos   = history.avgPL >= 0

  return (
    <div className="tb-history">
      <div className="tb-section-title">SIGNAL HISTORY · {ticker} {direction}S</div>
      <div className="tb-history-row">
        <span className="tb-hist-stat">
          <span className="tb-hist-n">{history.total}</span> paper trades closed
        </span>
        <span className="tb-hist-sep">·</span>
        <span className="tb-hist-stat" style={{ color: '#10b981' }}>{history.wins}W</span>
        <span className="tb-hist-sep">/</span>
        <span className="tb-hist-stat" style={{ color: '#ef4444' }}>{history.losses}L</span>
        <span className="tb-hist-sep">·</span>
        <span className="tb-hist-stat">{winRate}% win rate</span>
        <span className="tb-hist-sep">·</span>
        <span className="tb-hist-stat" style={{ color: isPos ? '#10b981' : '#ef4444' }}>
          avg {isPos ? '+' : ''}${history.avgPL.toFixed(0)}/trade
        </span>
      </div>
      <div className="tb-history-note">
        From your Paper Trade history for this ticker and direction.
        {history.wins / history.total < 0.4 && ' Win rate below 40% — review your entry timing.'}
      </div>
    </div>
  )
}

// ── Spread Recommendation ────────────────────────────────────────────────────
function SpreadRec({ spreads, direction, ticker }) {
  if (!spreads || !direction || direction === 'NO TRADE') return null
  const { recommended, expDate, dte: dteVal, ivRank, debit, credit, ironCondor } = spreads

  // Don't show if outright is already the best choice (low IV rank)
  if (recommended === 'outright') return null

  const f0 = v => v?.toLocaleString() ?? '—'
  const f2 = v => v != null ? v.toFixed(2) : '—'

  const isCall = direction === 'CALL'

  const WhyBadge = () => (
    <div className="tb-spread-why">
      {recommended === 'debit' && (
        <>
          <span className="tb-spread-why-title">WHY A SPREAD?</span>
          {' '}IV Rank {ivRank != null ? Math.round(ivRank) : '?'} — premium is moderately priced. A debit spread costs
          {debit ? ` $${f0(debit.costPerContract)} vs $${f0(Math.round((debit.costPerContract / (1 - debit.maxProfit / (debit.maxProfit + debit.netCost))))).toLocaleString()} outright` : ' less'}, with capped upside but also capped max loss.
        </>
      )}
      {recommended === 'credit' && (
        <>
          <span className="tb-spread-why-title">WHY A SPREAD?</span>
          {' '}IV Rank {ivRank != null ? Math.round(ivRank) : '?'} — options are expensive right now. Instead of paying high premium,
          you collect it. You profit as long as the stock doesn't cross your breakeven.
        </>
      )}
      {recommended === 'ironCondor' && (
        <>
          <span className="tb-spread-why-title">WHY AN IRON CONDOR?</span>
          {' '}IV Rank {ivRank != null ? Math.round(ivRank) : '?'} — premium is elevated and there's no clear directional edge.
          An iron condor collects premium from both sides and profits if the stock stays in a range.
        </>
      )}
    </div>
  )

  return (
    <div className="tb-spread-root">
      <div className="tb-spread-header">
        <span className="tb-spread-title">
          {recommended === 'debit'      ? (isCall ? 'DEBIT CALL SPREAD' : 'DEBIT PUT SPREAD')
         : recommended === 'credit'     ? (isCall ? 'BULL PUT SPREAD'   : 'BEAR CALL SPREAD')
         : 'IRON CONDOR'}
        </span>
        <span className="tb-spread-exp">{expDate} · {dteVal}d</span>
        <span className={`tb-spread-badge ${recommended === 'credit' || recommended === 'ironCondor' ? 'tb-spread-badge-credit' : ''}`}>
          {recommended === 'credit' || recommended === 'ironCondor' ? 'SELL PREMIUM' : 'REDUCE COST'}
        </span>
      </div>

      <WhyBadge />

      {recommended === 'debit' && debit && (
        <div className="tb-spread-body">
          <div className="tb-spread-legs">
            <div className="tb-spread-leg tb-leg-buy">
              <span className="tb-leg-action">BUY</span>
              <span className="tb-leg-desc">{ticker} ${debit.buyStrike} {debit.buyType} @ ~${f2(debit.maxLoss / 1)}</span>
            </div>
            <div className="tb-spread-leg tb-leg-sell">
              <span className="tb-leg-action">SELL</span>
              <span className="tb-leg-desc">{ticker} ${debit.sellStrike} {debit.buyType} @ ~${f2(debit.netCost - debit.maxLoss / 1)}</span>
            </div>
          </div>
          <div className="tb-spread-metrics">
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Net Cost</span>
              <span className="tb-sm-val tb-sm-cost">${f0(debit.costPerContract)} / contract</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Max Profit</span>
              <span className="tb-sm-val tb-sm-profit">+${f0(debit.maxProfitPerContract)} / contract</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Max Loss</span>
              <span className="tb-sm-val tb-sm-loss">−${f0(debit.costPerContract)} / contract</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Breakeven</span>
              <span className="tb-sm-val">${f2(debit.breakEven)} ({debit.bePct.toFixed(1)}% away)</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Reward : Risk</span>
              <span className="tb-sm-val">{debit.profitRatio}:1</span>
            </div>
          </div>
        </div>
      )}

      {recommended === 'credit' && credit && (
        <div className="tb-spread-body">
          <div className="tb-spread-legs">
            <div className="tb-spread-leg tb-leg-sell">
              <span className="tb-leg-action">SELL</span>
              <span className="tb-leg-desc">{ticker} ${credit.sellStrike} {credit.sellType} — collect premium</span>
            </div>
            <div className="tb-spread-leg tb-leg-buy">
              <span className="tb-leg-action">BUY</span>
              <span className="tb-leg-desc">{ticker} ${credit.buyStrike} {credit.sellType} — cap max loss</span>
            </div>
          </div>
          <div className="tb-spread-metrics">
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Credit Collected</span>
              <span className="tb-sm-val tb-sm-profit">+${f0(credit.creditPerContract)} / contract</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Max Loss</span>
              <span className="tb-sm-val tb-sm-loss">−${f0(credit.maxLossPerContract)} / contract</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Breakeven</span>
              <span className="tb-sm-val">${f2(credit.breakEven)} ({credit.bePct.toFixed(1)}% away)</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Profit if wrong by</span>
              <span className="tb-sm-val">{credit.bePct.toFixed(1)}% — stock has {credit.bePct.toFixed(1)}% of buffer</span>
            </div>
          </div>
        </div>
      )}

      {recommended === 'ironCondor' && ironCondor && (
        <div className="tb-spread-body">
          <div className="tb-spread-legs">
            <div className="tb-spread-leg tb-leg-sell">
              <span className="tb-leg-action">SELL</span>
              <span className="tb-leg-desc">${ironCondor.putSellStrike} PUT · ${ironCondor.callSellStrike} CALL</span>
            </div>
            <div className="tb-spread-leg tb-leg-buy">
              <span className="tb-leg-action">BUY</span>
              <span className="tb-leg-desc">${ironCondor.putBuyStrike} PUT · ${ironCondor.callBuyStrike} CALL</span>
            </div>
          </div>
          <div className="tb-spread-metrics">
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Credit Collected</span>
              <span className="tb-sm-val tb-sm-profit">+${f0(ironCondor.creditPerContract)} / contract</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Max Loss</span>
              <span className="tb-sm-val tb-sm-loss">−${f0(ironCondor.maxLossPerContract)} / contract</span>
            </div>
            <div className="tb-spread-metric">
              <span className="tb-sm-lbl">Profit Zone</span>
              <span className="tb-sm-val">${ironCondor.putSellStrike} – ${ironCondor.callSellStrike}</span>
            </div>
          </div>
        </div>
      )}

      <div className="tb-spread-note">
        {recommended === 'debit' && 'Spread caps your max profit in exchange for lower cost and defined max loss. Good when you believe in direction but want to limit risk.'}
        {recommended === 'credit' && 'Credit spread means you receive money upfront. You profit as long as the stock stays on the right side of your breakeven. You do NOT need the stock to move — just stay put or go slightly your way.'}
        {recommended === 'ironCondor' && 'Iron condor is a non-directional strategy. You profit from time passing, not from the stock moving. Ideal in high-IV, choppy markets. Max profit if stock expires between your short strikes.'}
      </div>
    </div>
  )
}

// ── Macro Regime Layer ───────────────────────────────────────────────────────
// SPY 200-day EMA position + market breadth → Bull / Bear / Late Cycle / Recovery
function computeMacroRegime(breadthData) {
  if (!breadthData?.spy) return null
  const { spy, vix: vd, bullPts = 0, bearPts = 0, total = 0 } = breadthData
  if (spy.above200 == null) return null

  const breadthBull = total > 0 && bullPts >= bearPts
  const vixHigh     = (vd?.current ?? 0) > 22

  if (spy.above200 && breadthBull && !vixHigh) {
    return {
      label: 'BULL REGIME', color: '#10b981', bg: '#010f06', border: '#065f46',
      note:  `SPY is above its 200-day EMA with ${bullPts}/${total} breadth signals bullish. Full macro tailwind — CALL signals carry maximum weight.`,
      action: 'FULL WEIGHT ON CALLS',
    }
  }
  if (!spy.above200 && !breadthBull) {
    return {
      label: 'BEAR REGIME', color: '#ef4444', bg: '#120000', border: '#7f1d1d',
      note:  `SPY is below its 200-day EMA with ${bearPts}/${total} breadth signals bearish. Structural headwind — CALLs require A+ grade only. PUTs have the structural edge.`,
      action: 'A+ CALLS ONLY · PUTS FAVORED',
    }
  }
  if (spy.above200 && !breadthBull) {
    return {
      label: 'LATE CYCLE', color: '#f97316', bg: '#0e0600', border: '#7c2d12',
      note:  `SPY is above the 200-day EMA but ${bearPts}/${total} breadth signals are weakening — distribution phase. Tighten stops, reduce size, avoid new longs at highs.`,
      action: 'TIGHTEN STOPS · REDUCE SIZE',
    }
  }
  return {
    label: 'RECOVERY WATCH', color: '#f59e0b', bg: '#0e0800', border: '#78350f',
    note:  `SPY is below the 200-day EMA but ${bullPts}/${total} breadth signals are recovering — possible cycle bottom forming. Light sizing until 200-EMA is reclaimed.`,
    action: 'ACCUMULATION WINDOW · LIGHT SIZE',
  }
}

function MacroRegime({ breadthData }) {
  const r = computeMacroRegime(breadthData)
  if (!r) return null
  return (
    <div className="tb-macro" style={{ background: r.bg, borderColor: r.border }}>
      <div className="tb-macro-head">
        <span className="tb-macro-label">MACRO REGIME</span>
        <span className="tb-macro-badge" style={{ color: r.color, borderColor: `${r.color}50` }}>{r.label}</span>
        <span className="tb-macro-action" style={{ color: r.color }}>{r.action}</span>
      </div>
      <p className="tb-macro-note">{r.note}</p>
    </div>
  )
}

// ── Fear & Greed Index ───────────────────────────────────────────────────────
// Weighted composite: VIX pct52 + IV Rank + weekly RSI (inverted) + breadth (inverted).
// 0 = extreme greed (be fearful), 100 = extreme fear (Buffett accumulation zone).
function computeFearGreed({ breadthData, ivData, cycleData }) {
  const pts = []

  if (breadthData?.vix?.pct52 != null)
    pts.push({ score: breadthData.vix.pct52, w: 30 })

  if (ivData?.ivRank != null)
    pts.push({ score: ivData.ivRank, w: 20 })

  if (cycleData?.currentRSI != null)
    pts.push({ score: Math.max(0, Math.min(100, 100 - cycleData.currentRSI)), w: 20 })

  if ((breadthData?.total ?? 0) > 0)
    pts.push({ score: 100 - (breadthData.bullPts / breadthData.total * 100), w: 30 })

  if (!pts.length) return null

  const wTotal = pts.reduce((s, p) => s + p.w, 0)
  const score  = Math.round(pts.reduce((s, p) => s + p.score * p.w, 0) / wTotal)

  if      (score >= 80) return { score, zone: 'EXTREME FEAR',  color: '#10b981', action: 'BUFFETT GREED ZONE — the crowd is panicking. Historically the strongest accumulation window for call buyers. Fear is your edge.' }
  else if (score >= 60) return { score, zone: 'FEAR',          color: '#34d399', action: 'Market is fearful. CALL signals fired in fear carry above-average historical reliability — confidence on confluence.' }
  else if (score >= 40) return { score, zone: 'NEUTRAL',       color: '#60a5fa', action: 'Balanced sentiment. No macro sentiment override — follow the technical signals at face value.' }
  else if (score >= 20) return { score, zone: 'GREED',         color: '#f59e0b', action: 'Crowd is getting greedy. Tighten stops on CALLs. Require stronger confirmation before entering new positions.' }
  else                  return { score, zone: 'EXTREME GREED', color: '#ef4444', action: 'BUFFETT FEAR ZONE — be fearful when others are greedy. Leverage is building. PUT bias or stand aside until fear returns.' }
}

const FG_ZONE_LABELS = [
  { label: 'EXTREME GREED', color: '#ef4444' },
  { label: 'GREED',         color: '#f59e0b' },
  { label: 'NEUTRAL',       color: '#60a5fa' },
  { label: 'FEAR',          color: '#34d399' },
  { label: 'EXTREME FEAR',  color: '#10b981' },
]

function FearGreedMeter({ breadthData, ivData, cycleData }) {
  const fg = computeFearGreed({ breadthData, ivData, cycleData })
  if (!fg) return null

  return (
    <div className="tb-fg">
      <div className="tb-fg-head">
        <span className="tb-fg-title">FEAR &amp; GREED INDEX</span>
        <span className="tb-fg-zone" style={{ color: fg.color }}>{fg.zone}</span>
        <span className="tb-fg-score" style={{ color: fg.color }}>{fg.score}</span>
      </div>
      <div className="tb-fg-bar-wrap">
        <div className="tb-fg-track">
          <div className="tb-fg-needle" style={{ left: `${fg.score}%`, background: fg.color, boxShadow: `0 0 8px ${fg.color}80` }} />
        </div>
        <div className="tb-fg-labels">
          {FG_ZONE_LABELS.map(z => (
            <span key={z.label} style={{ color: z.color }}>{z.label}</span>
          ))}
        </div>
      </div>
      <p className="tb-fg-action">{fg.action}</p>
    </div>
  )
}

// ── Unlock Gate — 3-stage gamified trade unlock ──────────────────────────────
function GateLock({ direction, confluenceResult, weeklyAlign, swingResult, orbRetest, adxSignal, vwapSignal }) {
  if (!direction || direction === 'NO TRADE') return null

  const emaNames = useEmaNames()
  const e8n      = emaNames[8]
  const e15n     = emaNames[15]
  const isCall   = direction === 'CALL'

  // Gate 1 — Weekly structure
  const wSignal = weeklyAlign?.signal
  const wOk     = isCall ? wSignal === 'BULLISH' : wSignal === 'BEARISH'
  const wPartial = wSignal === 'MIXED'
  const g1State  = wOk ? 'open' : wPartial ? 'partial' : 'locked'
  const g1Label  = wOk ? (isCall ? 'BULLISH' : 'BEARISH') : wSignal ?? 'LOADING'
  const g1Sub    = wOk
    ? `${e8n}/${e15n} aligned ${isCall ? 'above' : 'below'} weekly`
    : wPartial ? 'Mixed weekly bias — caution' : `Weekly ${wSignal ?? 'not loaded'}`

  // Gate 2 — Daily momentum
  const dailyOk  = confluenceResult?.dailyGate === 'pass'
  const adxAlign = adxSignal != null
    ? (isCall ? adxSignal.plusDI > adxSignal.minusDI : adxSignal.minusDI > adxSignal.plusDI)
    : null
  const adxStrong = adxSignal?.adx >= 21
  const g2Full   = dailyOk && adxAlign && adxStrong
  const g2Part   = dailyOk || (adxAlign && adxStrong)
  const g2State  = g2Full ? 'open' : g2Part ? 'partial' : 'locked'
  const g2Label  = g2Full ? 'CONFIRMED' : g2Part ? 'FORMING' : 'NOT MET'
  const g2Sub    = dailyOk
    ? (adxStrong && adxAlign ? `Daily gate ✓ · ADX ${adxSignal.adx.toFixed(0)} trending` : `Daily gate ✓ · ADX weak`)
    : (adxAlign && adxStrong ? `ADX ${adxSignal?.adx.toFixed(0)} aligned · daily gate pending` : 'Daily signals not aligned')

  // Gate 3 — Entry trigger
  // swingFull = 2-bar confirmed. swingPartial = 1-bar WATCH in the right direction.
  const swingFull     = isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT'
  const swingPartial  = swingResult?.signal === 'WATCH' && (
    isCall ? swingResult?.lastBar === 'above' : swingResult?.lastBar === 'below'
  )
  const orbConfirmed  = ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
  const orbInProgress = ['BREAK', 'RETEST'].includes(orbRetest?.signal)
  const vwapCross     = isCall ? (vwapSignal?.crossAbove === true) : (vwapSignal?.crossBelow === true)
  const g3Full        = swingFull || orbConfirmed
  const g3Part        = !g3Full && (swingPartial || vwapCross || orbInProgress)
  const g3State       = g3Full ? 'open' : g3Part ? 'partial' : 'locked'
  const g3Label       = g3Full ? 'TRIGGERED' : g3Part ? 'PARTIAL' : 'WAITING'
  const g3Sub         = g3Full
    ? (orbConfirmed
        ? `ORB ${orbRetest.signal === 'RECAPTURED' ? 'recaptured & confirmed' : 'break & retest confirmed'}`
        : '4H 2-bar rule satisfied')
    : g3Part
      ? (orbInProgress
          ? (orbRetest?.signal === 'BREAK' ? 'ORB broken — wait for retest' : 'ORB retest forming — wait for ENTER')
          : swingPartial ? '4H 1-bar — wait for second close' : 'VWAP 2-bar cross — watch for 4H confirm')
      : 'No 4H trigger or ORB confirmation yet'

  const allOpen  = g1State === 'open' && g2State === 'open' && g3State === 'open'
  const anyOpen  = g1State === 'open' || g2State === 'open' || g3State === 'open'

  const G_OPEN    = { color: '#10b981', bg: '#011c10', border: '#065f46', icon: '✓' }
  const G_PARTIAL = { color: '#f59e0b', bg: '#1a1000', border: '#78400e', icon: '◑' }
  const G_LOCKED  = { color: '#374151', bg: '#0a0d15', border: '#1e2d45', icon: '○' }
  const gStyle = s => s === 'open' ? G_OPEN : s === 'partial' ? G_PARTIAL : G_LOCKED

  const dirColor  = isCall ? '#10b981' : '#ef4444'
  const trackColor = allOpen ? '#10b981' : anyOpen ? '#f59e0b' : '#1e2d45'

  return (
    <div className="gl-root">
      <div className="gl-header">
        <span className="gl-title">TRADE GATES</span>
        <span className="gl-verdict" style={{
          color: allOpen ? dirColor : anyOpen ? '#f59e0b' : '#4a6380',
        }}>
          {allOpen ? (isCall ? '▲ TRADE UNLOCKED — BUY CALLS' : '▼ TRADE UNLOCKED — BUY PUTS')
           : anyOpen ? 'IN PROGRESS — CONDITIONS FORMING'
           : 'LOCKED — WAIT FOR ALIGNMENT'}
        </span>
      </div>

      <div className="gl-gates">
        {[
          { num: '1', name: 'WEEKLY',  state: g1State, label: g1Label, sub: g1Sub, tip: 'Gate 1 — Weekly Structure: The weekly chart must be net bullish (more bull signals than bear). RSI ≥ 44 is the momentum threshold. If locked, you are trading against institutional money — no entries.' },
          { num: '2', name: 'DAILY',   state: g2State, label: g2Label, sub: g2Sub, tip: 'Gate 2 — Daily Momentum: The daily chart must be net bullish (more daily bull signals than bear signals). Any combination of aligned daily indicators satisfies this gate. Locked = the daily is net against the signal direction.' },
          { num: '3', name: 'ENTRY',   state: g3State, label: g3Label, sub: g3Sub, tip: `Gate 3 — Entry Trigger: The intraday go-signal. TRIGGERED when: 2 consecutive 4H bars close on the right side of ${e8n} (EMA 8), OR an ORB ENTER/RECAPTURED signal confirms. PARTIAL (forming) when: 4H 1-bar in direction, ORB BREAK/RETEST in progress, or VWAP 2-bar cross. All three gates green = TRADE UNLOCKED.` },
        ].map((g, i) => {
          const s = gStyle(g.state)
          return (
            <div key={g.num} className="gl-gate-wrap">
              <div className="gl-gate" style={{ background: s.bg, borderColor: s.border }}>
                <div className="gl-gate-top">
                  <span className="gl-gate-num" style={{ color: s.color }}>GATE {g.num}</span>
                  <span className="gl-gate-icon" style={{ color: s.color }}>{s.icon}</span>
                </div>
                <div className="gl-gate-name" title={g.tip}>{g.name}</div>
                <div className="gl-gate-label" style={{ color: s.color }}>{g.label}</div>
                <div className="gl-gate-sub">{g.sub}</div>
              </div>
              {i < 2 && (
                <div className="gl-connector">
                  <div className="gl-connector-line" style={{ background: trackColor }} />
                  <span className="gl-connector-arrow" style={{ color: trackColor }}>→</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {allOpen && (
        <div className="gl-unlocked-banner" style={{ color: dirColor, borderColor: `${dirColor}40`, background: isCall ? '#011a0c' : '#1a010c' }}>
          All 3 gates clear — entry conditions met. Execute with defined risk.
        </div>
      )}
    </div>
  )
}

// ── Signal Intelligence panel ────────────────────────────────────────────────
function SignalIntel({
  confluenceResult, swingResult, cycleData, dailyBars,
  insiderData, earningsDate, sectorRS, weeklyAlign,
  tradeScore, shortInterest, onNavigate,
}) {
  const pvq = useMemo(() => {
    const c = dailyBars?.closes, v = dailyBars?.volumes
    if (!c || c.length < 10 || !v) return null
    const n = c.length
    const avg = arr => arr.reduce((s, x) => s + x, 0) / arr.length
    return {
      priceUp: avg(c.slice(n - 5)) > avg(c.slice(n - 10, n - 5)),
      volUp:   avg(v.slice(n - 5)) > avg(v.slice(n - 10, n - 5)),
    }
  }, [dailyBars])

  const direction      = tradeScore?.direction
  const confSignal     = confluenceResult?.signal
  const confBull       = confluenceResult?.totalBull ?? 0
  const confBear       = confluenceResult?.totalBear ?? 0
  const swingSignal    = swingResult?.signal
  const swingConf      = swingResult?.confirmed
  const cyclePhase     = cycleData?.phase
  const insiderVerdict = insiderData?.sentiment?.verdict
  const buyCount       = insiderData?.sentiment?.openBuys?.length ?? 0
  const sellCount      = insiderData?.sentiment?.openSells?.length ?? 0
  const earningsDays   = earningsDate ? Math.round((earningsDate.getTime() - Date.now()) / 86400000) : null
  const stockVsSector  = sectorRS?.stockVsSector?.signal
  const weeklySignal   = weeklyAlign?.signal

  const G = '#10b981', A = '#f59e0b', R = '#ef4444', D = '#4a6888'
  const GB = '#01120a', AB = '#0f0900', RB = '#130305', DB = '#070d18'

  const signals = [
    {
      key: 'confluence', label: 'CONFLUENCE', view: 'confluence',
      value:  confSignal === 'CALL' ? 'BUY CALLS' : confSignal === 'PUT' ? 'BUY PUTS' : confSignal === 'NO TRADE' ? 'NO TRADE' : '—',
      detail: confSignal ? `${confBull}B / ${confBear}Be` : 'Load ticker',
      color:  confSignal === 'CALL' ? G : confSignal === 'PUT' ? R : D,
      bg:     confSignal === 'CALL' ? GB : confSignal === 'PUT' ? RB : DB,
      dot:    confSignal === 'CALL' ? '▲' : confSignal === 'PUT' ? '▼' : '●',
    },
    {
      key: 'swing', label: 'TIMING', view: 'swing',
      value:  swingSignal ?? 'WAITING',
      detail: swingSignal ? (swingConf ? '4H fully confirmed' : '1-bar — wait for 2nd close') : 'No entry trigger yet',
      color:  swingSignal === 'LONG' ? G : swingSignal === 'EXIT' ? A : D,
      bg:     swingSignal === 'LONG' ? GB : swingSignal === 'EXIT' ? AB : DB,
      dot:    swingSignal === 'LONG' ? '▲' : swingSignal === 'EXIT' ? '▼' : '●',
    },
    {
      key: 'cycle', label: 'CYCLE PHASE', view: 'chart',
      value:  cyclePhase ?? '—',
      detail: cycleData?.phaseAction ?? (cycleData ? '' : 'Load chart'),
      color:  cyclePhase === 'MARKUP' ? G : cyclePhase === 'MARKDOWN' ? R : cyclePhase ? A : D,
      bg:     cyclePhase === 'MARKUP' ? GB : cyclePhase === 'MARKDOWN' ? RB : cyclePhase ? AB : DB,
      dot:    cyclePhase === 'MARKUP' ? '▲' : cyclePhase === 'MARKDOWN' ? '▼' : '●',
    },
    {
      key: 'pv', label: 'PRICE + VOLUME', view: 'chart',
      value:  pvq ? (pvq.priceUp && pvq.volUp ? '↑ P + ↑ V' : !pvq.priceUp && !pvq.volUp ? '↓ P + ↓ V' : pvq.priceUp ? '↑ P + ↓ V' : '↓ P + ↑ V') : '—',
      detail: pvq ? (pvq.priceUp && pvq.volUp ? 'Expansion — buyers in control' : !pvq.priceUp && !pvq.volUp ? 'Contraction — selling exhausting' : pvq.priceUp ? 'Weak up move — low conviction' : 'Distribution — selling into strength') : 'Load chart',
      color:  pvq ? (pvq.priceUp && pvq.volUp ? G : !pvq.priceUp && !pvq.volUp ? A : pvq.priceUp ? A : R) : D,
      bg:     pvq ? (pvq.priceUp && pvq.volUp ? GB : !pvq.priceUp && !pvq.volUp ? AB : pvq.priceUp ? AB : RB) : DB,
      dot:    pvq ? (pvq.priceUp ? '▲' : '▼') : '●',
    },
    {
      key: 'insider', label: 'INSIDER ACTIVITY', view: 'insider',
      value:  insiderVerdict ?? (insiderData ? 'UNKNOWN' : '—'),
      detail: !insiderVerdict ? 'Load insider tab'
            : ['BULLISH','LEAN BULLISH'].includes(insiderVerdict) ? `${buyCount} open-market buy${buyCount !== 1 ? 's' : ''}`
            : ['BEARISH','CAUTIOUS'].includes(insiderVerdict)     ? `${sellCount} open-market sell${sellCount !== 1 ? 's' : ''}`
            : insiderVerdict === 'MIXED' ? `${buyCount}B / ${sellCount}S mixed` : 'No discretionary trades',
      color:  insiderVerdict === 'BULLISH' ? G : insiderVerdict === 'LEAN BULLISH' ? '#34d399'
            : insiderVerdict === 'BEARISH' ? R : insiderVerdict === 'CAUTIOUS' ? A
            : insiderVerdict === 'MIXED'   ? A : D,
      bg:     ['BULLISH','LEAN BULLISH'].includes(insiderVerdict) ? GB : ['BEARISH','CAUTIOUS'].includes(insiderVerdict) ? RB : insiderVerdict === 'MIXED' ? AB : DB,
      dot:    ['BULLISH','LEAN BULLISH'].includes(insiderVerdict) ? '●' : ['BEARISH','CAUTIOUS'].includes(insiderVerdict) ? '●' : '●',
    },
    {
      key: 'earnings', label: 'EARNINGS RISK', view: 'earnings',
      value:  earningsDays != null ? (earningsDays > 0 ? `${earningsDays}d AWAY` : earningsDays === 0 ? 'TODAY' : `${Math.abs(earningsDays)}d AGO`) : '—',
      detail: earningsDays == null ? 'No date loaded'
            : earningsDays > 0 && earningsDays <= 7   ? 'Critical — close or use spread'
            : earningsDays > 0 && earningsDays <= 14  ? 'Caution — choose expiry carefully'
            : earningsDays > 0 && earningsDays <= 30  ? 'Monitor — plan exit before event'
            : earningsDays > 0                         ? 'Safe — no near-term catalyst'
            : 'Event already passed',
      color:  earningsDays == null ? D : earningsDays > 0 && earningsDays <= 14 ? R : earningsDays > 0 && earningsDays <= 30 ? A : G,
      bg:     earningsDays == null ? DB : earningsDays > 0 && earningsDays <= 14 ? RB : earningsDays > 0 && earningsDays <= 30 ? AB : GB,
      dot:    earningsDays != null && earningsDays > 0 && earningsDays <= 14 ? '⚠' : '●',
    },
    {
      key: 'sector', label: 'SECTOR RS', view: 'confluence',
      value:  stockVsSector ?? '—',
      detail: sectorRS ? `vs ${sectorRS.etf ?? 'sector ETF'}` : 'Load confluence',
      color:  ['BULL','STRONG BULL'].includes(stockVsSector) ? G : ['BEAR','STRONG BEAR'].includes(stockVsSector) ? R : stockVsSector ? A : D,
      bg:     ['BULL','STRONG BULL'].includes(stockVsSector) ? GB : ['BEAR','STRONG BEAR'].includes(stockVsSector) ? RB : DB,
      dot:    ['BULL','STRONG BULL'].includes(stockVsSector) ? '▲' : ['BEAR','STRONG BEAR'].includes(stockVsSector) ? '▼' : '●',
    },
    {
      key: 'weekly', label: 'WEEKLY TREND', view: 'confluence',
      value:  weeklySignal ?? '—',
      detail: weeklySignal === 'BULLISH' ? 'Above weekly EMA — uptrend' : weeklySignal === 'BEARISH' ? 'Below weekly EMA — downtrend' : weeklySignal === 'NEUTRAL' ? 'No clear weekly bias' : 'Load confluence',
      color:  weeklySignal === 'BULLISH' ? G : weeklySignal === 'BEARISH' ? R : weeklySignal === 'NEUTRAL' ? A : D,
      bg:     weeklySignal === 'BULLISH' ? GB : weeklySignal === 'BEARISH' ? RB : DB,
      dot:    weeklySignal === 'BULLISH' ? '▲' : weeklySignal === 'BEARISH' ? '▼' : '●',
    },
  ]

  // ── Short interest card (full-width, 9th) ───────────────────────────────────
  const si       = shortInterest
  const siPct    = si?.shortPct     // fraction, e.g. 0.045
  const siDtc    = si?.daysToCover
  const siMom    = si?.mom          // fraction MoM change
  const siSqueeze = si?.squeeze

  let siValue  = '—'
  let siDetail = 'Load ticker to fetch'
  let siColor  = D
  let siBg     = DB
  let siDot    = '●'
  let siSubtag = null

  if (si) {
    const pctStr = siPct != null ? `${(siPct * 100).toFixed(1)}% of Float` : '—'
    const dtcStr = siDtc != null ? ` · ${siDtc.toFixed(1)}d to cover` : ''
    siValue  = pctStr
    siDetail = dtcStr.trim()
    if (siMom != null) {
      const momStr = `${siMom >= 0 ? '+' : ''}${(siMom * 100).toFixed(1)}% MoM`
      siDetail = `${dtcStr.trim()}${dtcStr ? '  ·  ' : ''}${momStr} short interest`
    }
    if (si.settleDate) siDetail += `${siDetail ? '  ·  ' : ''}as of ${si.settleDate}`

    if (siSqueeze) {
      siColor  = '#f59e0b'
      siBg     = AB
      siDot    = '⚡'
      siSubtag = 'SQUEEZE POTENTIAL — high short % + high days-to-cover'
    } else if (siPct != null && siPct >= 0.20) {
      siColor  = R; siBg = RB; siDot = '▼'
    } else if (siPct != null && siPct >= 0.10) {
      siColor  = A; siBg = AB; siDot = '●'
    } else if (siPct != null) {
      siColor  = G; siBg = GB; siDot = '▲'
    }
  }

  const bullCount = signals.filter(s => s.color === G || s.color === '#34d399').length
  const bearCount = signals.filter(s => s.color === R).length
  const warnCount = signals.filter(s => s.color === A).length
  const total     = signals.length

  const squeezeConflict = direction === 'PUT' && siSqueeze
  const squeezeFuel     = direction === 'CALL' && siSqueeze

  let narrative = ''
  if (!direction || direction === 'NO TRADE') {
    narrative = `${bullCount} of ${total} signals lean bullish, ${bearCount} bearish — no directional edge yet. Wait for confluence across timeframes.`
  } else if (direction === 'CALL') {
    const base = bullCount >= 5
      ? `${bullCount}/${total} signals confirm bullish bias.${bearCount > 0 ? ` ${bearCount} conflict${bearCount > 1 ? 's' : ''} — monitor closely.` : ' High-conviction CALL setup.'}`
      : `CALL signal present but only ${bullCount}/${total} sources confirm.${warnCount > 0 ? ` ${warnCount} caution flag${warnCount > 1 ? 's' : ''}.` : ''} Consider reducing size.`
    narrative = squeezeFuel
      ? `${base} ⚡ Squeeze fuel: ${(siPct*100).toFixed(1)}% float short — short covering adds upside momentum to your call.`
      : base
  } else {
    const base = bearCount >= 5
      ? `${bearCount}/${total} signals confirm bearish bias.${bullCount > 0 ? ` ${bullCount} counter-signal${bullCount > 1 ? 's' : ''} — watch closely.` : ' High-conviction PUT setup.'}`
      : `PUT signal present but only ${bearCount}/${total} sources confirm.${warnCount > 0 ? ` ${warnCount} caution flag${warnCount > 1 ? 's' : ''}.` : ''} Consider reducing size.`
    narrative = squeezeConflict
      ? `⚠ SQUEEZE CONFLICT: ${base} Short data shows ${(siPct*100).toFixed(1)}% float short (${siDtc?.toFixed(1)}d to cover) — a forced short-covering event would move violently against your put. Use a spread and size down.`
      : base
  }

  return (
    <div className="tb-sigintel">
      <div className="tb-sigintel-header">
        <span className="tb-sigintel-title">Signal Intelligence</span>
        <span className="tb-sigintel-sub">All sources — click any card to drill in</span>
      </div>
      <div className="tb-sigintel-grid">
        {signals.map(sig => (
          <button
            key={sig.key}
            className="tb-sig-card"
            style={{ background: sig.bg, borderColor: sig.color + '30' }}
            onClick={() => onNavigate?.(sig.view)}
          >
            <div className="tb-sig-top">
              <span className="tb-sig-label">{sig.label}</span>
              <span className="tb-sig-arrow" style={{ color: sig.color }}>→</span>
            </div>
            <div className="tb-sig-value" style={{ color: sig.color }}>
              <span className="tb-sig-dot">{sig.dot}</span>
              {sig.value}
            </div>
            <div className="tb-sig-detail">{sig.detail}</div>
          </button>
        ))}

        {/* Short Interest — full-width 9th card */}
        <button
          className="tb-sig-card tb-sig-card-wide"
          style={{ background: siBg, borderColor: siColor + '30' }}
          onClick={() => onNavigate?.('insider')}
        >
          <div className="tb-sig-top">
            <span className="tb-sig-label">SHORT INTEREST</span>
            <span className="tb-sig-arrow" style={{ color: siColor }}>→ Insider tab</span>
          </div>
          <div className="tb-sig-value" style={{ color: siColor }}>
            <span className="tb-sig-dot">{siDot}</span>
            {siValue}
            {siSqueeze && <span className="tb-sig-squeeze">⚡ SQUEEZE WATCH</span>}
          </div>
          {siDetail && <div className="tb-sig-detail">{siDetail}</div>}
          {siSubtag && <div className="tb-sig-subtag" style={{ color: siColor }}>{siSubtag}</div>}
        </button>
      </div>
      <div className="tb-sigintel-narrative">{narrative}</div>
    </div>
  )
}


// ── Pullback / Retracement Meter ─────────────────────────────────────────────
const PB_DIVIDERS  = [23.6, 38.2, 50, 61.8, 78.6]
const PB_FIB_LABELS = [0, 23.6, 38.2, 50, 61.8, 78.6, 100]
const PB_ZONES = [
  { center: 11.8, label: 'MICRO',    color: '#0e5e36' },
  { center: 30.9, label: 'TIGHT',    color: '#1a7a42' },
  { center: 44.1, label: 'NORMAL',   color: '#5a7018' },
  { center: 55.9, label: 'DEEP',     color: '#8a5c10' },
  { center: 70.2, label: 'RETRACE',  color: '#8a3c10' },
  { center: 89.3, label: 'REVERSAL', color: '#7a1a1a' },
]

function PullbackMeter({ pullbackData }) {
  if (!pullbackData) return null
  const {
    retracePct, label, color, actionLabel, actionColor,
    description, emaSupport, volumeSignal, isUptrend,
  } = pullbackData

  const pos = Math.max(0, Math.min(100, retracePct))

  return (
    <div className="pb-root">
      <div className="pb-header">
        <span className="pb-title">MOVE CLASSIFIER</span>
        <span className="pb-badge" style={{ color, borderColor: `${color}50`, background: `${color}18` }}>
          {label}
        </span>
        <span className="pb-action" style={{ color: actionColor }}>{actionLabel}</span>
      </div>

      <div className="pb-bar-section">
        <div className="pb-track">
          <div className="pb-track-bg" />
          <div className="pb-track-fill" style={{ width: `${pos}%` }} />
          {PB_DIVIDERS.map(p => <div key={p} className="pb-divider" style={{ left: `${p}%` }} />)}
          <div className="pb-needle" style={{ left: `${pos}%`, background: color, boxShadow: `0 0 7px ${color}90` }} />
        </div>
        <div className="pb-fib-row">
          {PB_FIB_LABELS.map(p => (
            <span key={p} className="pb-fib-lbl" style={{
              left: `${p}%`,
              transform: p === 0 ? 'none' : p === 100 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}>
              {p === 0 ? '0%' : p === 100 ? '100%' : p}
            </span>
          ))}
        </div>
        <div className="pb-zones-row">
          {PB_ZONES.map(({ center, label: zl, color: zc }) => (
            <span key={zl} className="pb-zone-name" style={{ left: `${center}%`, color: zc }}>{zl}</span>
          ))}
        </div>
      </div>

      <p className="pb-description">{description}</p>

      <div className="pb-pills">
        <span className="pb-pill">
          <span className="pb-pill-lbl">RETRACED</span>
          <span className="pb-pill-val" style={{ color }}>{retracePct.toFixed(1)}%</span>
        </span>
        <span className="pb-pill">
          <span className="pb-pill-lbl">VOL ON DIP</span>
          <span className="pb-pill-val" style={{
            color: volumeSignal === 'DECLINING' ? '#10b981' : volumeSignal === 'SURGE' ? '#ef4444' : '#f59e0b'
          }}>{volumeSignal}</span>
        </span>
        <span className="pb-pill">
          <span className="pb-pill-lbl">EMA SUPPORT</span>
          <span className="pb-pill-val" style={{ color: emaSupport ? '#10b981' : '#ef4444' }}>
            {emaSupport ? `${emaSupport} EMA` : 'NONE'}
          </span>
        </span>
        <span className="pb-pill">
          <span className="pb-pill-lbl">TREND</span>
          <span className="pb-pill-val" style={{ color: isUptrend ? '#10b981' : '#ef4444' }}>
            {isUptrend ? '↑ UP' : '↓ DOWN'}
          </span>
        </span>
      </div>
    </div>
  )
}

// ── Share Setup Modal ────────────────────────────────────────────────────────
function buildGateStatus(shareData) {
  const { direction, weeklyAlign, confluenceResult, swingResult, orbRetest, vwapSignal } = shareData
  const isCall    = direction === 'CALL'
  const wSig      = weeklyAlign?.signal ?? '—'
  const dailyOk   = confluenceResult?.dailyGate === 'pass'
  const g3Fire    = (isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT') && swingResult?.confirmed
  const orbOk     = ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
  const orbPart   = ['BREAK', 'RETEST'].includes(orbRetest?.signal)
  const swingPart = swingResult?.signal === 'WATCH' && (isCall ? swingResult?.lastBar === 'above' : swingResult?.lastBar === 'below')
  const vwapX     = isCall ? vwapSignal?.crossAbove : vwapSignal?.crossBelow
  return {
    g1: wSig === (isCall ? 'BULLISH' : 'BEARISH') ? 'open' : wSig === 'MIXED' ? 'partial' : 'locked',
    g2: dailyOk ? 'open' : 'locked',
    g3: (g3Fire || orbOk) ? 'open' : (swingPart || vwapX || orbPart) ? 'partial' : 'locked',
  }
}

function buildShareText({ ticker, direction, setupGrade, tradeScore, adxSignal, vwapSignal, rec, qty, ...rest }) {
  const { g1, g2, g3 } = buildGateStatus({ direction, ...rest })
  const grade  = setupGrade?.grade ?? '—'
  const score  = tradeScore?.score ?? '—'
  const label  = tradeScore?.label ?? ''
  const isCall = direction === 'CALL'

  const gLabel = s => s === 'open' ? '✓ OPEN' : s === 'partial' ? '◑ PARTIAL' : '○ LOCKED'

  const lines = [
    `📊 $${ticker} — ${isCall ? 'BUY CALLS' : 'BUY PUTS'} | Grade: ${grade}`,
    `Trade Score: ${score}/100${label ? ` — ${label}` : ''}`,
    '',
    `  ① WEEKLY DIRECTION   ${gLabel(g1)}`,
    `  ② DAILY MOMENTUM     ${gLabel(g2)}`,
    `  ③ ENTRY TRIGGER      ${gLabel(g3)}`,
  ]

  if (adxSignal?.adx) lines.push(`\nADX: ${adxSignal.adx.toFixed(0)} (${adxSignal.adx >= 21 ? 'trend confirmed' : 'weak — caution'})`)
  if (vwapSignal) {
    const vs = vwapSignal.crossAbove ? '↑ cross above VWAP' : vwapSignal.crossBelow ? '↓ cross below VWAP' : vwapSignal.aboveVwap ? 'above VWAP' : 'below VWAP'
    lines.push(`VWAP: ${vs}`)
  }
  if (rec) {
    lines.push('')
    lines.push(`Option: $${ticker} $${rec.strike % 1 === 0 ? rec.strike.toFixed(0) : rec.strike} ${direction}`)
    lines.push(`  ${rec.expDate} · ${rec.dte}d · Δ${rec.delta.toFixed(2)} · ~$${rec.premium.toFixed(2)}/sh`)
    if (qty > 0) lines.push(`  Size: ${qty} contract${qty > 1 ? 's' : ''} at 1% risk`)
  }
  lines.push('')
  lines.push(g3 === 'locked'
    ? '⏳ Waiting for Gate 3 — do not enter yet.'
    : '⚡ Entry conditions forming — execute with defined risk only.')
  lines.push(`\nvia Top-Down Analyzer · ${new Date().toLocaleDateString()}`)
  return lines.join('\n')
}

function buildTweetText({ ticker, direction, setupGrade, tradeScore, rec, ...rest }) {
  const { g1, g2, g3 } = buildGateStatus({ direction, ...rest })
  const isCall = direction === 'CALL'
  const emoji  = s => s === 'open' ? '✅' : s === 'partial' ? '🔶' : '⭕'
  const parts  = [
    `$${ticker} ${isCall ? '▲ BUY CALLS' : '▼ BUY PUTS'} · Grade ${setupGrade?.grade ?? '—'} · Score ${tradeScore?.score ?? '—'}/100`,
    '',
    `${emoji(g1)} Weekly  ${emoji(g2)} Daily  ${emoji(g3)} Entry`,
  ]
  if (rec) parts.push(`\nOption: $${rec.strike % 1 === 0 ? rec.strike.toFixed(0) : rec.strike}${direction === 'CALL' ? 'C' : 'P'} · ${rec.dte}d · Δ${rec.delta.toFixed(2)}`)
  parts.push(g3 === 'locked' ? '\n⏳ Waiting for Gate 3.' : '\n⚡ Entry conditions met — defined risk only.')
  parts.push('\n#TopDownAnalysis #Options #StockMarket')
  return parts.join('\n')
}

function ShareModal({ onClose, ...shareData }) {
  const [copied, setCopied] = useState(false)
  const { ticker, direction, setupGrade, tradeScore, adxSignal, rec } = shareData
  const { g1, g2, g3 } = buildGateStatus(shareData)
  const isCall    = direction === 'CALL'
  const dirColor  = isCall ? '#10b981' : '#ef4444'
  const dirBg     = isCall ? 'linear-gradient(135deg, #020f07 0%, #011a0c 100%)' : 'linear-gradient(135deg, #0f0204 0%, #1a0108 100%)'
  const allOpen   = g1 === 'open' && g2 === 'open' && g3 === 'open'
  const canShare  = typeof navigator.share === 'function'

  function handleCopy() {
    navigator.clipboard.writeText(buildShareText(shareData)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    })
  }

  function handleTweet() {
    const t = encodeURIComponent(buildTweetText(shareData))
    window.open(`https://twitter.com/intent/tweet?text=${t}`, '_blank', 'noopener,noreferrer')
  }

  function handleNativeShare() {
    navigator.share({
      title: `$${ticker} ${isCall ? 'BUY CALLS' : 'BUY PUTS'} — Top-Down Analyzer`,
      text:  buildShareText(shareData),
    }).catch(() => {})
  }

  const gateRows = [
    { num: '①', label: 'Weekly Direction',  status: g1 },
    { num: '②', label: 'Daily Momentum',    status: g2 },
    { num: '③', label: 'Entry Trigger',     status: g3 },
  ]
  const statusMeta = {
    open:    { label: 'OPEN',    color: '#10b981', icon: '✓' },
    partial: { label: 'PARTIAL', color: '#f59e0b', icon: '◑' },
    locked:  { label: 'LOCKED',  color: '#4a5568', icon: '○' },
  }

  return (
    <div className="tb-share-overlay" onClick={onClose}>
      <div className="tb-share-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="tb-share-modal-header">
          <span className="tb-share-modal-title">Share Setup</span>
          <button className="tb-share-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Signal card */}
        <div className="tb-share-card" style={{ background: dirBg, borderColor: `${dirColor}30` }}>

          {/* Top: direction badge + grade */}
          <div className="tb-share-card-top">
            <div className="tb-share-dir-badge" style={{ background: `${dirColor}18`, borderColor: `${dirColor}50`, color: dirColor }}>
              <span className="tb-share-dir-arrow">{isCall ? '▲' : '▼'}</span>
              <span className="tb-share-dir-text">BUY {direction}S</span>
            </div>
            {setupGrade?.grade && (
              <div className="tb-share-grade-badge" style={{ background: `${dirColor}15`, borderColor: `${dirColor}45`, color: dirColor }}>
                {setupGrade.grade}
              </div>
            )}
          </div>

          {/* Ticker */}
          <div className="tb-share-ticker">${ticker}</div>

          {/* Score bar */}
          {tradeScore && (
            <div className="tb-share-score-block">
              <div className="tb-share-score-row">
                <span className="tb-share-score-label">Trade Score</span>
                <span className="tb-share-score-num" style={{ color: tradeScore.color }}>{tradeScore.score}</span>
                <span className="tb-share-score-denom">/100</span>
                <span className="tb-share-score-tag" style={{ color: tradeScore.color }}>{tradeScore.label}</span>
              </div>
              <div className="tb-share-score-bar-track">
                <div
                  className="tb-share-score-bar-fill"
                  style={{ width: `${Math.min(100, tradeScore.score)}%`, background: tradeScore.color }}
                />
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="tb-share-divider" style={{ borderColor: `${dirColor}18` }} />

          {/* Gates */}
          <div className="tb-share-gates">
            {gateRows.map(g => {
              const m = statusMeta[g.status]
              return (
                <div key={g.num} className="tb-share-gate-row">
                  <span className="tb-share-gate-num">{g.num}</span>
                  <span className="tb-share-gate-label">{g.label}</span>
                  <span className="tb-share-gate-status" style={{ color: m.color }}>
                    <span className="tb-share-gate-icon">{m.icon}</span>
                    {m.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Option detail (if available) */}
          {rec && (
            <>
              <div className="tb-share-divider" style={{ borderColor: `${dirColor}18` }} />
              <div className="tb-share-option-row">
                <span className="tb-share-option-label">Option</span>
                <div className="tb-share-option-pills">
                  <span className="tb-share-pill" style={{ color: dirColor, borderColor: `${dirColor}35` }}>
                    ${rec.strike % 1 === 0 ? rec.strike.toFixed(0) : rec.strike} {direction === 'CALL' ? 'C' : 'P'}
                  </span>
                  <span className="tb-share-pill">{rec.dte}d</span>
                  <span className="tb-share-pill">Δ{rec.delta.toFixed(2)}</span>
                  <span className="tb-share-pill">~${rec.premium.toFixed(2)}/sh</span>
                  {adxSignal?.adx && (
                    <span className="tb-share-pill" style={{ color: adxSignal.adx >= 21 ? '#10b981' : '#f59e0b' }}>
                      ADX {adxSignal.adx.toFixed(0)}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="tb-share-divider" style={{ borderColor: `${dirColor}18` }} />

          {/* Status line */}
          <div className="tb-share-status-line" style={{ color: allOpen ? dirColor : '#f59e0b' }}>
            {allOpen ? '⚡ All gates open — execute with defined risk only.' : '⏳ Forming — wait for all gates before entering.'}
          </div>

          {/* Attribution */}
          <div className="tb-share-attribution">
            via Top-Down Analyzer · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>

        {/* Action buttons */}
        <div className="tb-share-actions">
          <button className="tb-share-action-btn tb-share-tweet-btn" onClick={handleTweet}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63Zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            Share on X
          </button>
          {canShare && (
            <button className="tb-share-action-btn tb-share-native-btn" onClick={handleNativeShare}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              Share
            </button>
          )}
          <button
            className={`tb-share-action-btn tb-share-copy-btn${copied ? ' tb-share-copied' : ''}`}
            onClick={handleCopy}
          >
            {copied
              ? <><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!</>
              : <><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Text</>
            }
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Risk Sizing Prompt ────────────────────────────────────────────────────────
function RiskPrompt({ direction, allGatesOpen, onNavigate }) {
  if (!direction || direction === 'NO TRADE') return null
  const isCall = direction === 'CALL'
  const clr    = allGatesOpen ? (isCall ? '#10b981' : '#ef4444') : '#f59e0b'
  const bg     = allGatesOpen ? (isCall ? '#011a0c' : '#1a010c') : '#120c01'
  const border = allGatesOpen ? (isCall ? '#065f46' : '#7f1d1d') : '#4d3800'

  return (
    <div className="tb-risk-prompt" style={{ borderColor: border, background: bg }}>
      <span className="tb-rp-icon" style={{ color: clr }}>{allGatesOpen ? '⚡' : '⏳'}</span>
      <div className="tb-rp-body">
        <span className="tb-rp-title" style={{ color: clr }}>
          {allGatesOpen ? 'All gates open — size your position before executing' : 'Conditions forming — set your position size now while you wait'}
        </span>
        <span className="tb-rp-sub">
          {allGatesOpen
            ? 'Risk Panel shows exactly how many shares/contracts fit your account at 1% risk. Never enter without sizing first.'
            : 'Use the Risk Panel (Swing tab → Risk) to calculate max shares/contracts before gates fully open.'}
        </span>
      </div>
      <button className="tb-rp-btn" style={{ color: clr, borderColor: `${clr}40` }} onClick={() => onNavigate?.('swing')}>
        Risk Panel →
      </button>
    </div>
  )
}

// ── Trade Thesis (plain-English narrative) ───────────────────────────────────
function generateThesis({ ticker, direction, confluenceResult, tradeScore, weeklyAlign, swingResult, adxSignal, vwapSignal, ivData, setupGrade }) {
  if (!ticker || !direction || direction === 'NO TRADE') return null

  const isCall = direction === 'CALL'
  const lines  = []

  const score      = tradeScore?.score ?? 0
  const scoreLabel = tradeScore?.label ?? ''
  lines.push(`${ticker} is printing a ${isCall ? 'bullish' : 'bearish'} setup with a ${score}/100 setup score${scoreLabel ? ` (${scoreLabel})` : ''}.`)

  const totalBull = confluenceResult?.totalBull ?? 0
  const totalBear = confluenceResult?.totalBear ?? 0
  const totalSigs = totalBull + totalBear
  if (totalSigs > 0) {
    const majority = isCall ? totalBull : totalBear
    const minority = isCall ? totalBear : totalBull
    lines.push(
      majority >= Math.ceil(totalSigs * 0.75)
        ? `${majority} of ${totalSigs} signals across all timeframes confirm the ${direction} bias — high-conviction confluence.`
        : minority === 0
          ? `${majority} of ${totalSigs} signals are ${isCall ? 'bullish' : 'bearish'} with no opposing signals.`
          : `${majority} of ${totalSigs} signals lean ${isCall ? 'bullish' : 'bearish'}, but ${minority} counter-signal${minority > 1 ? 's' : ''} remain — size accordingly.`
    )
  }

  if (weeklyAlign?.signal) {
    const aligned = isCall ? weeklyAlign.signal === 'BULLISH' : weeklyAlign.signal === 'BEARISH'
    lines.push(
      aligned
        ? `The weekly trend is ${weeklyAlign.signal.toLowerCase()}, giving this trade the director-level tailwind it needs.`
        : `The weekly is ${weeklyAlign.signal.toLowerCase()} — a structural headwind. Only take this trade if 4H and daily strongly confirm.`
    )
  }

  if (confluenceResult?.dailyGate) {
    lines.push(confluenceResult.dailyGate === 'pass'
      ? 'Daily gate is clear — the directional bias holds on the intermediate timeframe.'
      : 'Daily gate is not yet confirmed — wait for the daily to align before executing.'
    )
  }

  if (adxSignal?.adx != null) {
    const adxVal = adxSignal.adx.toFixed(0)
    if (adxSignal.adx >= 25)
      lines.push(`ADX at ${adxVal}${adxSignal.adxRising ? '↑' : ''} confirms a strong directional trend, not sideways chop.`)
    else if (adxSignal.adx >= 20)
      lines.push(`ADX at ${adxVal} indicates a moderate trend — valid, but not powerfully directional; tighten stops.`)
    else
      lines.push(`ADX at ${adxVal} is below 20 — price action is choppy. Consider waiting for trend to develop before entering.`)
  }

  if (swingResult?.confirmed) {
    lines.push('The 4-hour swing layer has confirmed the signal, marking this as a high-quality execution window.')
  } else if (swingResult?.signal) {
    lines.push(`4-hour is signaling ${swingResult.signal.toLowerCase()} but confirmation is still pending — consider a partial entry.`)
  }

  if (vwapSignal?.label) {
    lines.push(`Price is currently ${vwapSignal.label.toLowerCase()}.`)
  }

  if (ivData?.ivRank != null) {
    const ivr = Math.round(ivData.ivRank)
    if (ivr > 70)
      lines.push(`IV rank is elevated at ${ivr}% — options are expensive. Use spreads rather than naked longs to keep premium cost in check.`)
    else if (ivr < 30)
      lines.push(`IV rank is low at ${ivr}% — options are cheap. Long premium strategies have a pricing edge here.`)
    else
      lines.push(`IV rank is moderate at ${ivr}% — standard sizing applies.`)
  }

  if (setupGrade?.grade) {
    const gradeDetail = setupGrade.grade.startsWith('A')
      ? 'Top-tier setup — use full planned size.'
      : setupGrade.grade === 'B'
        ? 'Good setup — standard sizing is appropriate.'
        : 'Lower-grade setup — reduce size or wait for a cleaner entry.'
    lines.push(`Overall setup grade: ${setupGrade.grade}. ${gradeDetail}`)
  }

  return lines.join(' ')
}

function TradeThesis({ ticker, direction, confluenceResult, tradeScore, weeklyAlign, swingResult, adxSignal, vwapSignal, ivData, setupGrade }) {
  const text = generateThesis({ ticker, direction, confluenceResult, tradeScore, weeklyAlign, swingResult, adxSignal, vwapSignal, ivData, setupGrade })
  if (!text) return null
  const isCall = direction === 'CALL'
  const col    = isCall ? '#10b981' : '#ef4444'
  return (
    <div className="tb-thesis" style={{ borderLeftColor: col }}>
      <div className="tb-thesis-head">
        <span className="tb-thesis-label" style={{ color: col }}>TRADE THESIS</span>
        <span className="tb-thesis-dir" style={{ color: col }}>{isCall ? '▲ CALL' : '▼ PUT'}</span>
      </div>
      <p className="tb-thesis-text">{text}</p>
    </div>
  )
}

// ── Economic Calendar Panel ───────────────────────────────────────────────────
const RISK_META = {
  extreme: { color: '#ef4444', bg: '#130203', border: '#7f1d1d', label: 'EXTREME RISK' },
  high:    { color: '#f97316', bg: '#140800', border: '#7c2d12', label: 'HIGH RISK'    },
  moderate:{ color: '#f59e0b', bg: '#120c01', border: '#78350f', label: 'CAUTION'      },
  monitor: { color: '#60a5fa', bg: '#040d1a', border: '#1e3a5f', label: 'MONITOR'      },
  clear:   { color: '#10b981', bg: '#011a0c', border: '#065f46', label: 'MACRO CLEAR'  },
}
const TYPE_COLOR = { FOMC: '#f97316', CPI: '#f59e0b', NFP: '#60a5fa', GDP: '#a78bfa', PPI: '#94a3b8' }

function EconCalendarPanel() {
  const events   = getUpcomingEvents(21)
  const topRisk  = events.length === 0 ? 'clear'
    : events.some(e => e.riskLevel === 'extreme') ? 'extreme'
    : events.some(e => e.riskLevel === 'high')    ? 'high'
    : events.some(e => e.riskLevel === 'moderate')? 'moderate'
    : 'monitor'

  const meta = RISK_META[topRisk]
  const show = events.slice(0, 4)

  const advice = topRisk === 'extreme'
    ? 'FOMC decision within 5 days. Volatility spikes before and after. Reduce position size 50%+ or stand aside entirely.'
    : topRisk === 'high'
    ? 'Major macro event within 10 days. Options pricing reflects event risk — expect IV expansion then crush. Size down.'
    : topRisk === 'moderate'
    ? 'Macro event within 2 weeks. Plan your option expiry to clear the date. Avoid holding positions through the release.'
    : topRisk === 'monitor'
    ? 'Macro events on the horizon — monitor. No immediate action required.'
    : 'No major macro events in the next 21 days. Clean environment for technical setups.'

  return (
    <div className="tb-econ" style={{ background: meta.bg, borderColor: meta.border }}
      data-tip="Economic Calendar — major US macro events that move the market. FOMC (Fed rate decisions) and CPI (inflation reports) cause the largest single-day moves in options prices. Holding through these events without a plan is speculation, not trading."
    >
      <div className="tb-econ-head">
        <span className="tb-econ-title">MACRO CALENDAR</span>
        <span className="tb-econ-badge" style={{ color: meta.color, borderColor: `${meta.color}40` }}>
          {meta.label}
        </span>
      </div>
      {show.length > 0 ? (
        <div className="tb-econ-events">
          {show.map((e, i) => (
            <div key={i} className="tb-econ-event"
              data-tip={`${e.label} — ${e.daysAway === 0 ? 'TODAY' : `in ${e.daysAway} day${e.daysAway === 1 ? '' : 's'}`}. ${e.type === 'FOMC' ? 'Fed rate decision — market-wide volatility. Options IV spikes before, crushes after. Avoid new positions same-day.' : e.type === 'CPI' ? 'Inflation report — biggest single-number market mover. Miss vs. expectation causes outsized moves.' : e.type === 'NFP' ? 'Non-Farm Payrolls — labor data moves rate expectations and SPY. High-uncertainty open.' : e.type === 'GDP' ? 'GDP advance estimate — quarterly growth number. Lower impact than FOMC/CPI but still moves sectors.' : 'Producer prices — signals pipeline inflation. Can move sectors and rate expectations.'}`}
            >
              <span className="tb-econ-type" style={{ color: TYPE_COLOR[e.type] ?? '#9ca3af' }}>{e.type}</span>
              <span className="tb-econ-label">{e.label}</span>
              <span className="tb-econ-date">{e.date}</span>
              <span className="tb-econ-days"
                style={{ color: e.daysAway <= 3 ? '#ef4444' : e.daysAway <= 7 ? '#f97316' : '#4a6888' }}>
                {e.daysAway === 0 ? 'TODAY' : `${e.daysAway}d`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="tb-econ-clear">No major events in the next 21 days — clean macro environment.</div>
      )}
      <div className="tb-econ-advice" style={{ color: meta.color }}>{advice}</div>
    </div>
  )
}

// ── Conditional Win Rate ──────────────────────────────────────────────────────
function ConditionalWinRate({ condWinRate, condWinLoading, direction, setupGrade, adxSignal }) {
  if (!direction || direction === 'NO TRADE') return null

  const adxLevel = adxSignal?.adx >= 25 ? 'strong' : adxSignal?.adx >= 21 ? 'moderate' : 'weak'
  const condLabel = [
    direction,
    setupGrade?.grade ? `Grade ${setupGrade.grade}+` : null,
    adxLevel === 'strong' ? 'ADX strong' : adxLevel === 'moderate' ? 'ADX moderate' : null,
  ].filter(Boolean).join(' · ')

  if (condWinLoading) {
    return (
      <div className="tb-cwr tb-cwr-loading">
        <span className="tb-cwr-spinner" />
        <span className="tb-cwr-load-text">Analyzing 2yr historical patterns for {direction}…</span>
      </div>
    )
  }

  if (!condWinRate) return null

  const isGood = condWinRate.winRate >= 55
  const color  = condWinRate.winRate >= 65 ? '#10b981'
               : condWinRate.winRate >= 55 ? '#34d399'
               : condWinRate.winRate >= 45 ? '#f59e0b'
               : '#ef4444'
  const bg     = condWinRate.winRate >= 55 ? '#011a0c' : condWinRate.winRate >= 45 ? '#120c01' : '#120205'
  const border = condWinRate.winRate >= 55 ? '#065f46' : condWinRate.winRate >= 45 ? '#78350f' : '#7f1d1d'

  return (
    <div className="tb-cwr" style={{ background: bg, borderColor: border }}
      data-tip={`Conditional Win Rate — filtered from the last 2 years of historical signals matching: ${condLabel}. Options win rate = the % of those signals where the recommended option was profitable. Sample: ${condWinRate.total} trades. The larger the sample, the more statistically meaningful. Under 10 trades, use as directional context only.`}
    >
      <div className="tb-cwr-head">
        <span className="tb-cwr-title">HISTORICAL PROBABILITY</span>
        <span className="tb-cwr-conditions">{condLabel}</span>
      </div>
      <div className="tb-cwr-body">
        <div className="tb-cwr-rate" style={{ color }}>
          {condWinRate.winRate}<span className="tb-cwr-pct">%</span>
        </div>
        <div className="tb-cwr-meta">
          <div className="tb-cwr-stat">
            <span className="tb-cwr-stat-label">Win Rate</span>
            <span className="tb-cwr-stat-val" style={{ color }}>{condWinRate.wins}W / {condWinRate.losses}L</span>
          </div>
          <div className="tb-cwr-stat">
            <span className="tb-cwr-stat-label">Sample</span>
            <span className="tb-cwr-stat-val">{condWinRate.total} signals{condWinRate.total < 10 ? ' ⚠ small' : ''}</span>
          </div>
          <div className="tb-cwr-stat">
            <span className="tb-cwr-stat-label">Avg Win</span>
            <span className="tb-cwr-stat-val" style={{ color: '#10b981' }}>+{condWinRate.avgWin}%</span>
          </div>
          <div className="tb-cwr-stat">
            <span className="tb-cwr-stat-label">Avg Loss</span>
            <span className="tb-cwr-stat-val" style={{ color: '#ef4444' }}>{condWinRate.avgLoss}%</span>
          </div>
        </div>
      </div>
      <div className="tb-cwr-note">
        {condWinRate.winRate >= 65
          ? `Strong edge under these conditions — ${condWinRate.winRate}% options win rate confirms the setup quality.`
          : condWinRate.winRate >= 55
          ? `Positive edge — ${condWinRate.winRate}% win rate under these conditions. Trade full planned size.`
          : condWinRate.winRate >= 45
          ? `Marginal edge — ${condWinRate.winRate}% win rate. Consider reducing size until conditions improve.`
          : `Below 50% historically under these conditions. Look for a better setup or wait for ADX/grade to improve.`}
      </div>
    </div>
  )
}

// ── Wyckoff Conflict / Alignment Banner ──────────────────────────────────────
const PHASE_CONFLICT_TEXT = {
  MARKDOWN:     'Price is in a confirmed MARKDOWN phase — institutions are distributing (selling). Bullish signals inside a markdown are dead-cat bounces within a larger downtrend, not trend entries.',
  DISTRIBUTION: 'Price is in DISTRIBUTION — smart money is offloading longs, not adding. A CALL signal here means fighting the institutional hand. Bounces are short-lived.',
  UTAD:         'UTAD (Upthrust After Distribution) detected — this is a false breakout above the distribution range. CALLs here are extremely high risk; the move is a bull trap by design.',
  ACCUMULATION: 'Price is in ACCUMULATION — institutions are building long positions near lows. A PUT signal here fights the structural base forming. Shorting accumulation zones has a poor historical success rate.',
  SPRING:       'SPRING phase detected — a bullish shakeout of weak hands after accumulation. A PUT signal here fights a high-probability bullish structural confirmation.',
  MARKUP:       'Price is in a confirmed MARKUP phase — institutions are in control of the uptrend. A PUT signal here is a counter-trend bet against the dominant structure.',
}

const PHASE_ALIGN_TEXT = {
  MARKUP:       'MARKUP — institutional uptrend confirmed. CALL direction has full structural backing.',
  MARKDOWN:     'MARKDOWN — institutional downtrend confirmed. PUT direction has full structural backing.',
  SPRING:       'SPRING — bullish shakeout complete. CALL direction aligns with the high-probability Wyckoff re-entry.',
  UTAD:         'UTAD — bearish false breakout confirmed. PUT direction aligns with the structural signal.',
  ACCUMULATION: 'ACCUMULATION — base-building phase. CALL direction aligns with the expected markup ahead.',
  DISTRIBUTION: 'DISTRIBUTION — topping phase. PUT direction aligns with the expected markdown ahead.',
  RANGING:      'RANGING — no structural edge yet.',
}

function WyckoffConflictBanner({ wyckoff, direction }) {
  if (!wyckoff?.signal || !direction || direction === 'NO TRADE') return null

  const isCall  = direction === 'CALL'
  const wSig    = wyckoff.signal   // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  const phase   = wyckoff.phase    // 'MARKUP' | 'MARKDOWN' | 'SPRING' | 'UTAD' | 'ACCUMULATION' | 'DISTRIBUTION' | 'RANGING'
  const conf    = wyckoff.confidence  // 'high' | 'medium' | 'low'

  const conflict = (isCall && wSig === 'BEARISH') || (!isCall && wSig === 'BULLISH')
  const aligns   = (isCall && wSig === 'BULLISH') || (!isCall && wSig === 'BEARISH')

  if (!conflict && !aligns) return null

  if (aligns) {
    const alignText = PHASE_ALIGN_TEXT[phase] ?? `${phase} phase aligns with ${direction} direction.`
    return (
      <div className="tb-wyckoff-align"
        data-tip={`Wyckoff structural analysis confirms your ${direction} direction. Phase: ${phase}${conf ? ` (${conf} confidence)` : ''}. ${alignText}`}
      >
        <span className="tb-wyckoff-align-icon">✓</span>
        <span className="tb-wyckoff-align-label">Wyckoff Confirms</span>
        <span className="tb-wyckoff-align-phase">{phase}</span>
        {conf && conf !== 'low' && <span className="tb-wyckoff-align-phase" style={{ opacity: 0.7 }}>{conf}</span>}
        <span className="tb-wyckoff-align-text">{alignText}</span>
      </div>
    )
  }

  // Conflict
  const bodyText = PHASE_CONFLICT_TEXT[phase] ?? `Wyckoff shows ${phase} — structural ${wSig.toLowerCase()} conflicts with your ${direction} signal.`

  return (
    <div className="tb-wyckoff-conflict"
      data-tip={`Wyckoff phase: ${phase} (${wSig}${conf ? `, ${conf} confidence` : ''}). This structural phase opposes your ${direction} signal direction. This does not mean the trade is wrong — it means the risk is higher. Counter-trend trades require stricter entry criteria.`}
    >
      <div className="tb-wyckoff-conflict-head">
        <span className="tb-wyckoff-conflict-icon">⚠</span>
        <span className="tb-wyckoff-conflict-title">Wyckoff Structure Conflict</span>
        <span className="tb-wyckoff-conflict-pill">{phase}</span>
        <span className="tb-wyckoff-conflict-vs">vs</span>
        <span className="tb-wyckoff-conflict-pill tb-wyckoff-conflict-dir">{direction}</span>
        {conf && <span className="tb-wyckoff-conflict-conf">{conf} confidence</span>}
      </div>
      <p className="tb-wyckoff-conflict-body">{bodyText}</p>
      <div className="tb-wyckoff-conflict-rules">
        <span className="tb-wyckoff-rule">↘ Cut size 30–50%</span>
        <span className="tb-wyckoff-rule">Require all 3 gates open</span>
        <span className="tb-wyckoff-rule">Tight stop — no wiggle room</span>
        <span className="tb-wyckoff-rule">Target nearest resistance only</span>
      </div>
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────
// ── Smart Money Composite Card ───────────────────────────────────────────────
// Aggregates: options market lean (IV skew/P-C ratio), insider sentiment,
// volume footprint vs POC, and dark pool volume signature.
// No new API calls — built entirely from data already in props.
function SmartMoneyCard({ optionsChain, insiderData, volumeSpike, volumeProfile, direction }) {
  const signals = []

  // 1. Options market lean (IV skew + put/call volume ratio)
  const ivLean = optionsChain?.ivLean
  if (ivLean && ivLean.dir !== 'neutral') {
    const bull = ivLean.dir === 'bull'
    signals.push({
      label: 'OPTIONS MARKET',
      value: bull ? 'CALL FLOW' : 'PUT FLOW',
      detail: `${ivLean.strength === 'strong' ? 'Strong' : 'Mild'} ${bull ? 'bullish' : 'bearish'} options demand${ivLean.pcv != null ? ` · P/C Vol ${ivLean.pcv.toFixed(2)}` : ''}${ivLean.skew != null ? ` · IV Skew ${ivLean.skew > 0 ? '+' : ''}${ivLean.skew.toFixed(1)}%` : ''}`,
      color: bull ? '#10b981' : '#ef4444',
      score: ivLean.strength === 'strong' ? 2 : 1,
      direction: bull ? 'bull' : 'bear',
    })
  } else {
    signals.push({ label: 'OPTIONS MARKET', value: 'NEUTRAL', detail: 'No strong directional lean in options pricing', color: '#4e6a88', score: 0, direction: 'neutral' })
  }

  // 2. Insider sentiment (net 90-day)
  if (insiderData) {
    const netBuy = (insiderData.buys90d ?? 0) - (insiderData.sells90d ?? 0)
    const ins = netBuy > 0
      ? { value: 'NET BUYING', detail: `${insiderData.buys90d} insider buy transaction${insiderData.buys90d !== 1 ? 's' : ''} in 90 days — corporate insiders are adding`, color: '#10b981', score: 2, direction: 'bull' }
      : netBuy < 0
        ? { value: 'NET SELLING', detail: `${insiderData.sells90d} insider sell transaction${insiderData.sells90d !== 1 ? 's' : ''} in 90 days — insiders reducing exposure`, color: '#f59e0b', score: -1, direction: 'bear' }
        : { value: 'NO ACTIVITY', detail: 'No insider transactions in past 90 days', color: '#4e6a88', score: 0, direction: 'neutral' }
    signals.push({ label: 'INSIDER FLOW', ...ins })
  }

  // 3. Volume footprint vs Point of Control
  if (volumeProfile && volumeProfile.poc && volumeProfile.currentPrice) {
    const { poc, vah, val, currentPrice: cp } = volumeProfile
    const atPOC     = Math.abs(cp - poc) / poc < 0.015       // within 1.5% of POC
    const abovePOC  = cp > poc
    const inVA      = cp >= val && cp <= vah

    let vpValue, vpDetail, vpColor, vpScore, vpDir
    if (atPOC) {
      vpValue  = 'AT POC — HIGH PROB ENTRY'
      vpDetail = `Price at Point of Control $${poc.toFixed(2)} — highest institutional volume node. Expect support (for CALL) or resistance (for PUT) here.`
      vpColor  = direction === 'CALL' ? '#10b981' : '#ef4444'
      vpScore  = 2
      vpDir    = direction === 'CALL' ? 'bull' : 'bear'
    } else if (abovePOC && !inVA) {
      vpValue  = 'ABOVE VALUE AREA'
      vpDetail = `Price $${cp.toFixed(2)} extended above value area ($${vah.toFixed(2)}). Pullback to VAH or POC = better entry.`
      vpColor  = '#f59e0b'
      vpScore  = 0
      vpDir    = 'neutral'
    } else if (!abovePOC && !inVA) {
      vpValue  = 'BELOW VALUE AREA'
      vpDetail = `Price $${cp.toFixed(2)} below value area ($${val.toFixed(2)}). Rejection at VAL = PUT signal zone.`
      vpColor  = '#ef4444'
      vpScore  = 1
      vpDir    = 'bear'
    } else {
      vpValue  = inVA ? 'INSIDE VALUE AREA' : (abovePOC ? 'ABOVE POC' : 'BELOW POC')
      vpDetail = `Price relative to POC $${poc.toFixed(2)} · ${abovePOC ? 'Bulls in control' : 'Bears in control'}`
      vpColor  = abovePOC ? '#34d399' : '#ef4444'
      vpScore  = 1
      vpDir    = abovePOC ? 'bull' : 'bear'
    }
    signals.push({ label: 'VOLUME FOOTPRINT', value: vpValue, detail: vpDetail, color: vpColor, score: vpScore, direction: vpDir })
  }

  // 4. Dark Pool signature (abnormal volume without catalyst = institutional accumulation/distribution)
  if (volumeSpike) {
    const { ratio, spike } = volumeSpike
    if (spike && ratio != null) {
      const isDark = ratio >= 2.5
      signals.push({
        label: 'VOLUME SIGNATURE',
        value: isDark ? 'DARK POOL SIGNAL' : 'ELEVATED VOLUME',
        detail: `${ratio.toFixed(1)}× average volume${isDark ? ' — institutional-level activity without obvious catalyst. Dark pool participation likely.' : ' — above-normal volume confirms conviction behind current move.'}`,
        color: isDark ? '#f59e0b' : '#60a5fa',
        score: isDark ? 2 : 1,
        direction: 'confirming',
      })
    }
  }

  if (signals.length === 0) return null

  // Compute composite score
  const bullSignals = signals.filter(s => s.direction === 'bull').length
  const bearSignals = signals.filter(s => s.direction === 'bear').length
  const totalScored = signals.filter(s => s.direction !== 'neutral' && s.direction !== 'confirming').length
  const netScore    = signals.reduce((a, s) => a + (s.direction === 'bull' ? s.score : s.direction === 'bear' ? -s.score : 0), 0)

  let compositeLabel, compositeColor, compositeBg
  if (netScore >= 3)       { compositeLabel = 'SMART MONEY BULLISH'; compositeColor = '#10b981'; compositeBg = '#021a0d' }
  else if (netScore >= 1)  { compositeLabel = 'LEANING BULLISH';     compositeColor = '#34d399'; compositeBg = '#011a0d' }
  else if (netScore <= -2) { compositeLabel = 'SMART MONEY BEARISH'; compositeColor = '#ef4444'; compositeBg = '#1a0000' }
  else if (netScore <= -1) { compositeLabel = 'LEANING BEARISH';     compositeColor = '#f97316'; compositeBg = '#1a0800' }
  else                     { compositeLabel = 'MIXED / NEUTRAL';      compositeColor = '#6b7280'; compositeBg = '#0a1020' }

  const matches = direction && direction !== 'NO TRADE'
    ? signals.filter(s => (direction === 'CALL' && s.direction === 'bull') || (direction === 'PUT' && s.direction === 'bear')).length
    : 0
  const conflicts = direction && direction !== 'NO TRADE'
    ? signals.filter(s => (direction === 'CALL' && s.direction === 'bear') || (direction === 'PUT' && s.direction === 'bull')).length
    : 0

  return (
    <div className="tb-sm-card" style={{ borderColor: `${compositeColor}40`, background: compositeBg }}>
      <div className="tb-sm-header">
        <div className="tb-sm-title-row">
          <span className="tb-sm-eyebrow">SMART MONEY ANALYSIS</span>
          <span className="tb-sm-composite" style={{ color: compositeColor }}>{compositeLabel}</span>
        </div>
        {direction && direction !== 'NO TRADE' && (
          <div className="tb-sm-align-row">
            <span className="tb-sm-align-item" style={{ color: '#10b981' }}>{matches} confirming your {direction}</span>
            {conflicts > 0 && <span className="tb-sm-align-sep">·</span>}
            {conflicts > 0 && <span className="tb-sm-align-item" style={{ color: '#f59e0b' }}>{conflicts} conflicting</span>}
          </div>
        )}
      </div>
      <div className="tb-sm-signals">
        {signals.map((sig, i) => (
          <div key={i} className="tb-sm-row" style={{ borderLeftColor: sig.color }}>
            <div className="tb-sm-row-top">
              <span className="tb-sm-row-label">{sig.label}</span>
              <span className="tb-sm-row-value" style={{ color: sig.color }}>{sig.value}</span>
            </div>
            <div className="tb-sm-row-detail">{sig.detail}</div>
          </div>
        ))}
      </div>
      {conflicts > 0 && direction && direction !== 'NO TRADE' && (
        <div className="tb-sm-conflict-note">
          {conflicts} signal{conflicts > 1 ? 's' : ''} conflict{conflicts === 1 ? 's' : ''} with your {direction} direction — size down until resolved.
        </div>
      )}
    </div>
  )
}

// ── Top Risk Warning (Devil's Advocate) ─────────────────────────────────────
function TopRiskWarning({ direction, tradeScore, ivData, earningsDate, rec, optionsChain, currentPrice, atr }) {
  if (!direction || direction === 'NO TRADE' || !tradeScore?.score) return null

  const isCall = direction === 'CALL'
  const risks  = []

  const earnDays  = earningsDate ? Math.round((earningsDate.getTime() - Date.now()) / 86400000) : null
  const ivRank    = ivData?.ivRank
  const flipPrice = optionsChain?.gammaFlip
  const aboveFlip = flipPrice != null && currentPrice != null && currentPrice > flipPrice

  if (earnDays != null && earnDays > 0 && earnDays <= 7)
    risks.push({ sev: 5, label: `EARNINGS IN ${earnDays}d — IV CRUSH RISK`, detail: `Options lose 30-60% of value the morning after earnings even if the stock moves your way. Close before the report or switch to a defined-risk spread.` })

  if (rec?.wideSpread && rec.spreadPct != null)
    risks.push({ sev: 4, label: `ILLIQUID OPTION — ${rec.spreadPct.toFixed(0)}% BID-ASK SPREAD`, detail: `You give up ${rec.spreadPct.toFixed(0)}% on entry and again on exit. Use a limit order at the mid-price ($${f2(rec.bid != null && rec.ask != null ? (rec.bid + rec.ask) / 2 : rec.premium)}), or select a higher-OI strike.` })

  if (ivRank != null && ivRank >= 75)
    risks.push({ sev: 3, label: `IV RANK ${Math.round(ivRank)} — OPTIONS ARE EXPENSIVE`, detail: `You're paying near-peak premium. A debit spread cuts your cost 40-60% and removes the premium-decay headwind. Consider the spread structure.` })

  if (flipPrice != null && isCall && aboveFlip)
    risks.push({ sev: 3, label: `PINNING REGIME — PRICE ABOVE GEX FLIP $${f2(flipPrice)}`, detail: `Dealers are long gamma here, selling into every uptick and buying every dip — this actively suppresses your call's upside. Spreads outperform outright calls in pinning regimes.` })

  if (flipPrice != null && !isCall && !aboveFlip)
    risks.push({ sev: 2, label: `EXPLOSIVE REGIME — SHARP REVERSALS POSSIBLE`, detail: `Below the gamma flip, dealers amplify moves in both directions. A sudden catalyst or short squeeze can spike violently against your put. Size down and use defined risk.` })

  if (rec && atr && atr > 0) {
    const thetaDay   = Math.abs(rec.theta) * 100
    const deltaDay   = atr * Math.abs(rec.delta) * 100
    if (thetaDay > deltaDay * 0.9)
      risks.push({ sev: 2, label: `THETA RACE — DECAY OUTPACING EXPECTED DAILY GAIN`, detail: `Theta: $${thetaDay.toFixed(0)}/day. Delta gain at 1 ATR (${f2(atr)}): $${deltaDay.toFixed(0)}/day. The stock must move decisively within the first ${Math.max(3, Math.floor(rec.dte / 4))} days or decay wins.` })
  }

  if (tradeScore.score < 65)
    risks.push({ sev: 1, label: `DEVELOPING SETUP — SCORE ${tradeScore.score}/100`, detail: `Score below 65 means confluence is incomplete. Wait for 65+ before entering full size, or cut position to 50% until the setup strengthens.` })

  if (!risks.length) return null
  const top = risks.reduce((a, b) => b.sev > a.sev ? b : a)

  const isCritical = top.sev >= 4
  const bgColor    = isCritical ? '#140303' : '#0f0900'
  const bdColor    = isCritical ? '#5a1a1a' : '#4d3000'
  const txColor    = isCritical ? '#ef4444' : '#f59e0b'

  return (
    <div className="tb-top-risk" style={{ background: bgColor, borderColor: bdColor }}>
      <div className="tb-top-risk-head">
        <span className="tb-top-risk-icon" style={{ color: txColor }}>⚠</span>
        <span className="tb-top-risk-tag">TOP RISK</span>
        <span className="tb-top-risk-label" style={{ color: txColor }}>{top.label}</span>
      </div>
      <div className="tb-top-risk-detail">{top.detail}</div>
    </div>
  )
}

// ── Gamma Regime ─────────────────────────────────────────────────────────────
function GammaRegimeCard({ optionsChain, currentPrice, direction }) {
  const flipPrice = optionsChain?.gammaFlip
  if (flipPrice == null || !currentPrice || !direction || direction === 'NO TRADE') return null

  const aboveFlip   = currentPrice > flipPrice
  const pctFromFlip = ((currentPrice - flipPrice) / flipPrice * 100).toFixed(1)
  const isCall      = direction === 'CALL'

  const regime = aboveFlip ? 'PINNING' : 'EXPLOSIVE'
  const color  = aboveFlip ? '#f59e0b' : '#10b981'
  const bg     = aboveFlip ? '#0e0900' : '#011208'
  const border = aboveFlip ? '#4d3000' : '#065f46'

  const implication = aboveFlip && isCall
    ? 'Dealers long gamma — sell into strength, buy dips. Dampens upside momentum. Debit spread preferred.'
    : aboveFlip && !isCall
    ? 'Dealers long gamma — buying into weakness slows drops. Puts face dealer headwind. Use spread.'
    : !aboveFlip && isCall
    ? 'Dealers short gamma — amplify moves in both directions. Outright calls benefit when momentum holds.'
    : 'Dealers short gamma — sells can cascade. Outright puts benefit from accelerating moves downward.'

  return (
    <div className="tb-gamma-regime" style={{ background: bg, borderColor: border }}>
      <div className="tb-gr-row">
        <span className="tb-gr-label">GAMMA REGIME</span>
        <span className="tb-gr-value" style={{ color }}>{regime}</span>
        <span className="tb-gr-flip">GEX Flip ${f2(flipPrice)}</span>
        <span className="tb-gr-dist" style={{ color }}>{aboveFlip ? '+' : ''}{pctFromFlip}% from flip</span>
      </div>
      <div className="tb-gr-detail">{implication}</div>
    </div>
  )
}

// ── Theta Race ───────────────────────────────────────────────────────────────
function ThetaRaceCard({ rec, atr, currentPrice, fibLevels, direction }) {
  if (!rec || !atr || atr <= 0 || !currentPrice || !direction || direction === 'NO TRADE') return null

  const isCall     = direction === 'CALL'
  const thetaDay   = Math.abs(rec.theta) * 100       // $/day/contract
  const deltaDay   = atr * Math.abs(rec.delta) * 100 // $/day/contract at 1 ATR move
  const winning    = deltaDay >= thetaDay
  const ratio      = thetaDay > 0 ? deltaDay / thetaDay : 0

  const t1         = isCall
    ? (fibLevels?.ext100 ?? currentPrice + atr * 2)
    : (fibLevels?.ext100 ?? currentPrice - atr * 2)
  const moveNeeded = Math.abs(t1 - currentPrice)
  const daysToT1   = +(moveNeeded / atr).toFixed(1)
  const totalDecay = +(daysToT1 * thetaDay).toFixed(0)

  const color  = winning ? '#10b981' : '#f59e0b'
  const bg     = winning ? '#011208' : '#0e0900'
  const border = winning ? '#065f46' : '#4d3000'

  return (
    <div className="tb-theta-race" style={{ background: bg, borderColor: border }}>
      <div className="tb-tr-head">
        <span className="tb-tr-title">THETA RACE</span>
        <span className="tb-tr-verdict" style={{ color }}>{winning ? `WINNING · ${ratio.toFixed(1)}× COVERED` : `WATCH · ${ratio.toFixed(2)}× COVERED`}</span>
      </div>
      <div className="tb-tr-rows">
        <div className="tb-tr-row">
          <span className="tb-tr-lbl">Daily decay</span>
          <span className="tb-tr-val" style={{ color: '#ef4444' }}>−${thetaDay.toFixed(0)}/contract/day</span>
        </div>
        <div className="tb-tr-row">
          <span className="tb-tr-lbl">ATR delta gain</span>
          <span className="tb-tr-val" style={{ color: '#10b981' }}>+${deltaDay.toFixed(0)}/contract at 1 ATR ({f2(atr)}/day)</span>
        </div>
        <div className="tb-tr-row">
          <span className="tb-tr-lbl">Days to T1 at ATR</span>
          <span className="tb-tr-val">~{daysToT1}d — total decay: −${totalDecay}/contract</span>
        </div>
      </div>
      <div className="tb-tr-note">
        {winning
          ? `Daily ATR gain covers theta ${ratio.toFixed(1)}× — the trade has room to develop at a normal pace.`
          : `Decay exceeds expected daily gain. Move must start in the first ${Math.max(3, Math.ceil(rec.dte / 4))} days. Don't hold a static position — cut if no momentum by then.`
        }
      </div>
    </div>
  )
}

// ── Options Levels + UOA ─────────────────────────────────────────────────────
function OptionsLevelsCard({ optionsChain, currentPrice, direction }) {
  if (!optionsChain || !currentPrice) return null
  const { maxPain, callWall, callWallOI, putWall, putWallOI, unusualActivity } = optionsChain
  if (maxPain == null && callWall == null && putWall == null && !unusualActivity?.length) return null

  const isCall = direction === 'CALL'
  const fK = v => v != null ? (v % 1 === 0 ? (+v).toFixed(0) : (+v).toFixed(2)) : '—'
  const fOI = v => v != null ? (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v}`) : null

  const levels = []
  if (callWall != null) levels.push({ label: 'Call Wall', value: callWall, oi: callWallOI, color: '#ef4444', note: 'peak call OI — hard resistance' })
  if (putWall  != null) levels.push({ label: 'Put Wall',  value: putWall,  oi: putWallOI,  color: '#10b981', note: 'peak put OI — hard support'   })
  if (maxPain  != null) levels.push({ label: 'Max Pain',  value: maxPain,  oi: null,       color: '#f59e0b', note: 'options writers\' gravity target' })
  levels.sort((a, b) => b.value - a.value)

  return (
    <div className="tb-opt-levels">
      <div className="tb-section-title">OPTIONS LEVELS</div>
      {levels.map((lv, i) => {
        const pct = ((lv.value - currentPrice) / currentPrice * 100)
        const pctSign = pct >= 0 ? '+' : ''
        const isFav = isCall ? pct > 0 : pct < 0
        return (
          <div key={i} className="tb-opt-level-row">
            <span className="tb-opt-level-label" style={{ color: lv.color }}>{lv.label}</span>
            <span className="tb-opt-level-price">${fK(lv.value)}</span>
            {lv.oi != null && <span className="tb-opt-level-oi">{fOI(lv.oi)} OI</span>}
            <span className={`tb-opt-level-pct ${isFav ? 'tb-level-target' : 'tb-level-support'}`}>
              {pctSign}{pct.toFixed(1)}%
            </span>
            <span className="tb-opt-level-note">{lv.note}</span>
          </div>
        )
      })}

      {unusualActivity?.length > 0 && (
        <>
          <div className="tb-uoa-title">UNUSUAL ACTIVITY TODAY</div>
          {unusualActivity.map((u, i) => {
            const sign = u.pctFromSpot >= 0 ? '+' : ''
            const uColor = u.type === 'call' ? '#60a5fa' : '#f87171'
            return (
              <div key={i} className="tb-uoa-row">
                <span className="tb-uoa-type" style={{ color: uColor }}>{u.type.toUpperCase()}</span>
                <span className="tb-uoa-strike">${u.strike % 1 === 0 ? u.strike.toFixed(0) : u.strike.toFixed(2)}</span>
                <span className="tb-uoa-dte">{u.dte}d</span>
                <span className="tb-uoa-vol">{u.volume >= 1000 ? `${(u.volume / 1000).toFixed(1)}K` : u.volume} vol</span>
                <span className="tb-uoa-ratio">{u.ratio}× OI</span>
                <span className="tb-uoa-spot" style={{ color: uColor }}>{sign}{u.pctFromSpot}% from spot</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

export default function TradeBrief({
  ticker,
  currentPrice,
  tradeScore,
  confluenceResult,
  swingResult,
  setupGrade,
  ivData,
  historicalVol,
  adxSignal,
  fibLevels,
  orbRetest,
  earningsDate,
  vixData,
  weeklyAlign,
  insiderData,
  sectorRS,
  regimeBlocked,
  lastUpdated,
  isEnriching,
  cycleData,
  dailyBars,
  shortInterest,
  breadthData,
  breadthLoading,
  vwapSignal,
  onNavigate,
  onRefreshBreadth,
  optionsChain,
  volumeSpike,
  volumeProfile,
  wyckoff,
}) {
  // Compute recommended option + spread suggestion
  const { rec, qty, spreads } = useMemo(() => {
    if (!currentPrice || !tradeScore?.direction || tradeScore.direction === 'NO TRADE') return {}
    const sigma   = ivData?.atmIV != null ? ivData.atmIV / 100 : (historicalVol ?? 0.30)
    const ivRank  = ivData?.ivRank ?? null
    const recs    = generateRecommendations(currentPrice, sigma, tradeScore.direction, 'standard', {
      setupGrade:    setupGrade?.grade ?? null,
      ivRank,
      chainTimestamps: optionsChain?.expirationDates ?? null,
      liveContracts:   optionsChain?.contracts       ?? null,
    })
    if (!recs?.primary) return {}

    const accountSize = +(localStorage.getItem('rp_account')  || 25000)
    const riskPct     = +(localStorage.getItem('rp_risk_pct') || 1.0)
    const maxRisk     = accountSize * (riskPct / 100)
    const ivAdj       = ivRank != null && ivRank > 60 ? 0.6 : 1.0
    const budget      = maxRisk * ivAdj
    const qty         = recs.primary.contractCost > 0 ? Math.floor(budget / recs.primary.contractCost) : 0

    let spreads = null
    try {
      spreads = generateSpreads(currentPrice, sigma, tradeScore.direction, ivRank, setupGrade?.grade ?? null)
    } catch (e) {
      // spreads are optional — don't crash the brief
    }

    return { rec: recs.primary, qty, spreads }
  }, [currentPrice, tradeScore?.direction, ivData, historicalVol, setupGrade, optionsChain])

  const pullbackData = useMemo(() => {
    if (!fibLevels || !dailyBars) return null
    try { return classifyPullback(fibLevels, dailyBars) }
    catch { return null }
  }, [fibLevels, dailyBars])

  const atr = useMemo(() => {
    if (!dailyBars?.highs || !dailyBars?.lows || !dailyBars?.closes) return null
    try { return calcATR(dailyBars.highs, dailyBars.lows, dailyBars.closes, 14) }
    catch { return null }
  }, [dailyBars])

  const [showShare, setShowShare] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [quickMode, setQuickMode] = useState(false)

  // ── Conditional Win Rate: run backtest in background when ticker+direction change ──
  const [condWinRate, setCondWinRate]       = useState(null)
  const [condWinLoading, setCondWinLoading] = useState(false)
  const btAbortRef = useRef(false)

  useEffect(() => {
    const dir = tradeScore?.direction
    if (!ticker || !dir || dir === 'NO TRADE') { setCondWinRate(null); setCondWinLoading(false); return }
    btAbortRef.current = false
    setCondWinLoading(true)
    setCondWinRate(null)
    runBacktest(ticker, 10, false)
      .then(result => {
        if (btAbortRef.current) return
        const adxLvl = adxSignal?.adx >= 25 ? 'strong' : adxSignal?.adx >= 21 ? 'moderate' : 'weak'
        const cwr = calcConditionalWinRate(result.trades, { direction: dir, grade: setupGrade?.grade, adxLevel: adxLvl })
        setCondWinRate(cwr)
      })
      .catch(() => {})
      .finally(() => { if (!btAbortRef.current) setCondWinLoading(false) })
    return () => { btAbortRef.current = true }
  }, [ticker, tradeScore?.direction])

  const direction   = tradeScore?.direction
  const isCall      = direction === 'CALL'
  const signalGated = tradeScore?.score != null && tradeScore.score > 0 && tradeScore.score < 55 && direction !== 'NO TRADE'

  const allGatesOpen = useMemo(() => {
    if (!direction || direction === 'NO TRADE') return false
    const wOk     = isCall ? weeklyAlign?.signal === 'BULLISH' : weeklyAlign?.signal === 'BEARISH'
    const dailyOk = confluenceResult?.dailyGate === 'pass'
    const g3Full  = ((isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT') && swingResult?.confirmed === true) || ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
    return wOk && dailyOk && g3Full
  }, [direction, isCall, weeklyAlign, confluenceResult, swingResult, orbRetest])

  if (!ticker) {
    return (
      <div className="tb-empty">
        <div className="tb-empty-title">Enter a ticker and click Load</div>
        <div className="tb-empty-sub">
          Your full trade brief — signal, recommended option, exit plan, and risk factors — appears here the moment data loads.
        </div>
      </div>
    )
  }

  const timeStr = lastUpdated?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="tb-root">

      {showShare && (
        <ShareModal
          onClose={() => setShowShare(false)}
          ticker={ticker}
          direction={direction}
          setupGrade={setupGrade}
          tradeScore={tradeScore}
          weeklyAlign={weeklyAlign}
          swingResult={swingResult}
          adxSignal={adxSignal}
          vwapSignal={vwapSignal}
          orbRetest={orbRetest}
          rec={rec}
          qty={qty}
          confluenceResult={confluenceResult}
        />
      )}

      {/* ── Verdict Panel: GO / WAIT / NO ── */}
      <VerdictPanel
        ticker={ticker}
        direction={direction}
        tradeScore={tradeScore}
        confluenceResult={confluenceResult}
        swingResult={swingResult}
        orbRetest={orbRetest}
        weeklyAlign={weeklyAlign}
        adxSignal={adxSignal}
        regimeBlocked={regimeBlocked}
        earningsDate={earningsDate}
        vixData={vixData}
        currentPrice={currentPrice}
        fibLevels={fibLevels}
        setupGrade={setupGrade}
        allGatesOpen={allGatesOpen}
        ivData={ivData}
        breadthData={breadthData}
      />

      {/* ── Header: score + signal ── */}
      <div className="tb-header" style={{ borderColor: tradeScore?.border ?? '#1e2d45', background: tradeScore?.bg ?? '#0a0f1a' }}>

        <div className="tb-header-left">
          <div className="tb-ticker-row">
            <span className="tb-ticker">{ticker}</span>
            {currentPrice && <span className="tb-price">${f2(currentPrice)}</span>}
            {isEnriching && <span className="tb-enriching">enriching…</span>}
          </div>
          {lastUpdated && <div className="tb-updated">Last updated {timeStr}</div>}

          {direction && direction !== 'NO TRADE' ? (
            <div className="tb-signal-row">
              <span className={`tb-signal-arrow ${isCall ? 'tb-bull' : 'tb-bear'}`}>{isCall ? '▲' : '▼'}</span>
              <span className={`tb-signal-label ${isCall ? 'tb-bull' : 'tb-bear'}`}
                data-tip={isCall
                  ? 'BUY CALLS — the top-down analysis finds the weekly and daily timeframes both pointing up. This is a bullish signal. Consider buying call options on this ticker.'
                  : 'BUY PUTS — the top-down analysis finds the weekly and daily timeframes both pointing down. This is a bearish signal. Consider buying put options on this ticker.'
                }>
                BUY {direction}S
              </span>
              <span className="tb-signal-detail"
                data-tip="Bull signals vs Bear signals across all timeframes scored 0–100. Grade = how many of the 10+ technical checks pass (A+ = 80%+, A = 65%+, B = 50%+, C = below 50%). ADX = trend strength — above 21 means a real trend exists, not just chop.">
                {confluenceResult?.totalBull ?? 0}B / {confluenceResult?.totalBear ?? 0}Be
                {setupGrade && ` · Grade ${setupGrade.grade}`}
                {adxSignal && ` · ADX ${adxSignal.adx.toFixed(0)}${adxSignal.adxRising ? '↑' : ''}`}
                {swingResult?.confirmed && ' · 4H confirmed'}
              </span>
              <button
                className="tb-share-btn"
                onClick={() => setShowShare(true)}
                title="Share this setup"
              >
                ↗ Share Setup
              </button>
            </div>
          ) : (
            <div className="tb-signal-row">
              <span className="tb-signal-label tb-neutral"
                data-tip="NO TRADE — the weekly and daily timeframes do not agree on direction. Trading without clear multi-timeframe confluence is guessing, not trading. Wait for the signals to align before risking capital.">
                NO TRADE
              </span>
              <span className="tb-signal-detail">Signals not aligned — wait for confluence across timeframes</span>
            </div>
          )}
        </div>

        <div className="tb-header-right"
          data-tip="Trade Score — 0 to 100. Weighted composite of confluence, weekly alignment, RSI, ADX trend strength, MA stack, setup grade, IV conditions, volume, sector RS, insider flow, squeeze risk, and Wyckoff structural alignment. A conflict between Wyckoff phase and signal direction deducts up to 8 pts — it's a counter-trend flag, not a disqualifier. ≥78 = Strong · ≥60 = Confirmed · ≥42 = Developing · ≥20 = Weak.">
          {tradeScore && (
            <>
              <ScoreArc score={tradeScore.score} color={tradeScore.color} />
              <div className="tb-score-label" style={{ color: tradeScore.color }}>{tradeScore.label}</div>
            </>
          )}
        </div>
      </div>

      {/* ── Trade Gates (critical — right after header, not buried below explanatory text) ── */}
      <GateLock
        direction={direction}
        confluenceResult={confluenceResult}
        weeklyAlign={weeklyAlign}
        swingResult={swingResult}
        orbRetest={orbRetest}
        adxSignal={adxSignal}
        vwapSignal={vwapSignal}
      />

      {/* ── Wyckoff conflict / alignment banner ── */}
      <WyckoffConflictBanner wyckoff={wyckoff} direction={direction} />

      {/* ── Economic Calendar — macro event risk before any position decision ── */}
      <EconCalendarPanel />

      {/* ── Top Risk Warning (devil's advocate — most important risk, before you enter) ── */}
      {!signalGated && (
        <TopRiskWarning
          direction={direction}
          tradeScore={tradeScore}
          ivData={ivData}
          earningsDate={earningsDate}
          rec={rec}
          optionsChain={optionsChain}
          currentPrice={currentPrice}
          atr={atr}
        />
      )}

      {/* ── Recommended option (surfaces immediately after gates — the whole point of GO) ── */}
      {!signalGated && rec && (
        <div className={`tb-option-card ${isCall ? 'tb-card-bull' : 'tb-card-bear'}`}>
          <div className="tb-option-title">RECOMMENDED OPTION</div>
          <div className="tb-option-main">
            <span className="tb-option-name">
              {ticker} ${rec.strike % 1 === 0 ? rec.strike.toFixed(0) : rec.strike.toFixed(2)} {isCall ? 'CALL' : 'PUT'}
            </span>
            <span className="tb-option-exp" data-tip="DTE (Days to Expiration): Calendar days until this option expires worthless if out of the money. We use 21+ days to give the trade time to work. Inside 7 days, time decay (theta) can triple — buying weekly options is like renting a room that costs 3× more every day you stay.">{rec.expDate} · {rec.dte}d</span>
          </div>
          <div className="tb-option-stats">
            <span
              className={rec.isLive ? 'tb-opt-live' : undefined}
              title={rec.isLive ? 'Live bid/ask mid-price from the options chain' : 'Black-Scholes theoretical estimate — verify on your broker'}
            >
              {rec.isLive ? '● live mid' : 'est.'} <strong>{rec.isLive ? '' : '~'}${f2(rec.premium)}/sh</strong>
              {rec.isLive && rec.bid != null && (
                <span className="tb-opt-bidask"> bid ${f2(rec.bid)} / ask ${f2(rec.ask)}</span>
              )}
            </span>
            <span>·</span>
            <span>{qty > 0 ? <><strong>{qty} contract{qty > 1 ? 's' : ''}</strong> = ${f0(qty * rec.contractCost)}</> : `$${f0(rec.contractCost)}/contract`}</span>
            <span>·</span>
            <span data-tip="Delta (Δ): How much the option price moves for every $1 the stock moves. A delta of 0.50 means the option gains $50 per contract for each $1 move in your favor. We target 0.35–0.65 for balanced leverage.">Δ {rec.delta.toFixed(2)}</span>
            <span>·</span>
            <span data-tip="Theta (Θ): The dollar amount your option loses to time decay every single day — even if the stock doesn't move. This is the cost of holding the option. It accelerates in the final 7 days, which is why we stay 21+ DTE.">Θ −${(rec.theta * 100).toFixed(2)}/day</span>
            <span>·</span>
            <span data-tip="Probability In-The-Money: The statistical chance this option expires with value, based on implied volatility. Roughly mirrors delta. 50% = at the money. Our 0.35–0.65 delta target puts you in the 35%–65% probability range.">{(rec.probITM * 100).toFixed(0)}% prob ITM</span>
            {rec.spreadPct != null && (
              <>
                <span>·</span>
                <span
                  className={rec.wideSpread ? 'tb-spread-wide' : 'tb-spread-ok'}
                  data-tip="Bid-ask spread as % of mid-price. Under 10% = liquid (green). Over 20% = wide (red) — you give up that % immediately on entry and again on exit. Always use limit orders at the mid-price."
                >
                  {rec.spreadPct.toFixed(1)}% spread{rec.wideSpread ? ' ⚠' : ''}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Gamma Regime + Theta Race (execution quality — right after the option card) ── */}
      {!signalGated && rec && (
        <>
          <GammaRegimeCard optionsChain={optionsChain} currentPrice={currentPrice} direction={direction} />
          <ThetaRaceCard rec={rec} atr={atr} currentPrice={currentPrice} fibLevels={fibLevels} direction={direction} />
        </>
      )}

      {/* ── Spread recommendation ── */}
      {!signalGated && spreads && (
        <SpreadRec spreads={spreads} direction={direction} ticker={ticker} />
      )}

      {/* ── Trade Plan: entry trigger, STOP/ENTRY/TARGET table, Greeks, exit rules ── */}
      {!signalGated && rec && (
        <TradePlan
          ticker={ticker}
          currentPrice={currentPrice}
          direction={direction}
          rec={rec}
          qty={qty}
          fibLevels={fibLevels}
          atr={atr}
          pullbackData={pullbackData}
          swingResult={swingResult}
          orbRetest={orbRetest}
          ivData={ivData}
          historicalVol={historicalVol}
          tradeScore={tradeScore}
        />
      )}

      {/* ── Structured Exit Plan — 3-level stop/target calculated before entering ── */}
      {!signalGated && direction && direction !== 'NO TRADE' && (
        <ExitPlan
          currentPrice={currentPrice}
          direction={direction}
          atr={atr}
          fibLevels={fibLevels}
          volumeProfile={volumeProfile}
          tradeScore={tradeScore}
        />
      )}

      {!signalGated && !rec && direction && direction !== 'NO TRADE' && (
        <div className="tb-option-placeholder">
          {isEnriching
            ? 'Loading IV data to price the recommended option…'
            : 'Load a ticker with a clear signal to see the recommended option here.'
          }
        </div>
      )}

      {/* ── Risk sizing prompt ── */}
      <RiskPrompt direction={direction} allGatesOpen={allGatesOpen} onNavigate={onNavigate} />

      {/* ── NO TRADE verdict ── */}
      {direction === 'NO TRADE' && !signalGated && (
        <NoTradeCard
          vixData={vixData}
          ivData={ivData}
          confluenceResult={confluenceResult}
        />
      )}

      {/* ── Signal gate: score too weak ── */}
      {signalGated && (
        <div className="tb-gate-block">
          <div className="tb-gate-icon">⏸</div>
          <div className="tb-gate-body">
            <div className="tb-gate-title">SIGNAL TOO WEAK — NO RECOMMENDATION</div>
            <div className="tb-gate-detail">
              Trade Score {tradeScore.score}/100 is below the 55-point entry threshold.
              The direction ({direction}) is present but confluence is not strong enough.
              Wait for the score to reach 55, strengthen the setup, or find a ticker with better alignment.
            </div>
            <div className="tb-gate-bar-wrap">
              <div className="tb-gate-bar-track">
                <div className="tb-gate-bar-fill" style={{ width: `${tradeScore.score}%`, background: tradeScore.color }} />
                <div className="tb-gate-bar-threshold" style={{ left: '55%' }} />
              </div>
              <span className="tb-gate-bar-label">{tradeScore.score} · need 55</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Squeeze conflict warning ── */}
      {!isCall && shortInterest?.squeeze && (
        <div className="tb-squeeze-warn">
          <div className="tb-squeeze-warn-head">
            <span className="tb-squeeze-warn-icon">⚡</span>
            <span className="tb-squeeze-warn-title">SQUEEZE RISK — PUT SIGNAL CONFLICTS WITH SHORT DATA</span>
          </div>
          <div className="tb-squeeze-warn-body">
            <strong>{shortInterest.shortPct != null ? `${(shortInterest.shortPct * 100).toFixed(1)}%` : '?'} of the float is short</strong>
            {shortInterest.daysToCover != null && <> with <strong>{shortInterest.daysToCover.toFixed(1)} days to cover</strong></>}.
            {' '}A catalyst — earnings beat, news, or simply a price squeeze — can force short sellers to cover simultaneously, sending the stock violently higher against your put.
          </div>
          <div className="tb-squeeze-warn-actions">
            <span className="tb-squeeze-action-item">⟶ Use a spread (defined risk) instead of a naked put</span>
            <span className="tb-squeeze-action-item">⟶ Size down — 50% of normal position or less</span>
            <span className="tb-squeeze-action-item">⟶ Check earnings date — avoid holding through events</span>
            {shortInterest.mom != null && shortInterest.mom > 0.05 && (
              <span className="tb-squeeze-action-item">⟶ Short interest is rising (+{(shortInterest.mom * 100).toFixed(1)}% MoM) — crowded, but squeeze risk increases</span>
            )}
          </div>
        </div>
      )}

      {/* ── Macro Regime + Fear & Greed (context layer — below action items) ── */}
      <MacroRegime breadthData={breadthData} />
      <FearGreedMeter breadthData={breadthData} ivData={ivData} cycleData={cycleData} />

      {/* ── Quick Mode toggle ── */}
      <div className="tb-quickmode-row">
        <button
          className={`tb-quickmode-btn${quickMode ? ' tb-quickmode-on' : ''}`}
          onClick={() => setQuickMode(v => !v)}
          title={quickMode ? 'Show full analysis with explanations' : 'Collapse explanatory text — data only'}
        >
          {quickMode ? '▶ Show Details' : '◀ Quick Mode'}
        </button>
      </div>

      {/* ── Trade Thesis (hidden in Quick Mode) ── */}
      {!quickMode && (
        <TradeThesis
          ticker={ticker}
          direction={direction}
          confluenceResult={confluenceResult}
          tradeScore={tradeScore}
          weeklyAlign={weeklyAlign}
          swingResult={swingResult}
          adxSignal={adxSignal}
          vwapSignal={vwapSignal}
          ivData={ivData}
          setupGrade={setupGrade}
        />
      )}

      {/* ── Score breakdown (hidden in Quick Mode) ── */}
      {!quickMode && tradeScore?.breakdown && (
        <>
          <button className="tb-breakdown-toggle" onClick={() => setShowBreakdown(v => !v)}>
            Score Breakdown {showBreakdown ? '▲' : '▾'}
          </button>
          {showBreakdown && <ScoreBreakdown breakdown={tradeScore.breakdown} />}
        </>
      )}

      {/* ── Conditional Win Rate — historical probability under current conditions ── */}
      <ConditionalWinRate
        condWinRate={condWinRate}
        condWinLoading={condWinLoading}
        direction={direction}
        setupGrade={setupGrade}
        adxSignal={adxSignal}
      />

      {/* ── Key levels ── */}
      <KeyLevels
        fibLevels={fibLevels}
        orbRetest={orbRetest}
        currentPrice={currentPrice}
        direction={direction}
      />

      {/* ── Options Levels: Max Pain, Call Wall, Put Wall, UOA ── */}
      <OptionsLevelsCard optionsChain={optionsChain} currentPrice={currentPrice} direction={direction} />

      {/* ── Pullback vs Retracement Classifier ── */}
      <PullbackMeter pullbackData={pullbackData} />

      {/* ── Signal Intelligence ── */}
      <SignalIntel
        confluenceResult={confluenceResult}
        swingResult={swingResult}
        cycleData={cycleData}
        dailyBars={dailyBars}
        insiderData={insiderData}
        earningsDate={earningsDate}
        sectorRS={sectorRS}
        weeklyAlign={weeklyAlign}
        tradeScore={tradeScore}
        shortInterest={shortInterest}
        onNavigate={onNavigate}
      />

      {/* ── Smart Money Analysis ── */}
      <SmartMoneyCard
        optionsChain={optionsChain}
        insiderData={insiderData}
        volumeSpike={volumeSpike}
        volumeProfile={volumeProfile}
        direction={direction}
      />

      {/* ── Signal history (feedback loop from paper trades) ── */}
      <SignalHistory ticker={ticker} direction={direction} />

    </div>
  )
}
