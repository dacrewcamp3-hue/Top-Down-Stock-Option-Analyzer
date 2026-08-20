import { useState } from 'react'
import { generateRecommendations, bsPrice, calcGreeks } from '../utils/fetchOptions'
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

// ── Direction bar ─────────────────────────────────────────────────────────────
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
  const msg    = r < 30
    ? 'Premium is cheap — good time to buy options, sizing up slightly'
    : r < 60
    ? 'Premium is moderate — enter with standard sizing'
    : 'Premium is costly — sizing reduced 40% · consider waiting for IV to drop'
  return (
    <div className="opt-iv-bar" style={{ background: bg, borderColor: bord }}>
      <div className="opt-iv-left">
        <span className="opt-iv-status" style={{ color: clr }}>{status}</span>
        <span className="opt-iv-msg">{msg}</span>
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
function PnLScenarios({ rec, currentPrice, qty }) {
  const { strike, dte, premium, isCall, sigma: sig } = rec
  const T    = dte / 365
  const qtyN = Math.max(1, qty)

  const scenarios = isCall
    ? [-0.10, -0.05, 0, +0.05, +0.10, +0.15]
    : [+0.10, +0.05, 0, -0.05, -0.10, -0.15]

  return (
    <div className="opt-pnl-wrap">
      <div className="opt-pnl-header">
        <span className="opt-pnl-title">P&amp;L Scenarios — Primary Pick</span>
        <span className="opt-pnl-sub">{qtyN} contract{qtyN > 1 ? 's' : ''} · {dte} days to expiry</span>
      </div>
      <div className="opt-pnl-table">
        <div className="opt-pnl-row opt-pnl-hdr">
          <span>Stock Move</span>
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

          return (
            <div key={pct} className={`opt-pnl-row${isCurrent ? ' opt-pnl-current' : ''}${isWin ? ' opt-pnl-win' : ' opt-pnl-loss'}`}>
              <span style={{ color: pct > 0 ? '#10b981' : pct < 0 ? '#ef4444' : '#a0c0dc', fontWeight: 600 }}>
                {pct >= 0 ? '+' : ''}{(pct * 100).toFixed(0)}%
                {isCurrent && <span className="opt-pnl-now"> TODAY</span>}
              </span>
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
      </div>
    </div>
  )
}

// ── Strike Comparison Strip ───────────────────────────────────────────────────
function StrikeComparison({ rec, currentPrice, ticker }) {
  if (!rec || !currentPrice) return null
  const { strike: kRec, dte, isCall, sigma: sig } = rec
  const T   = dte / 365
  const S   = currentPrice

  const inc = S < 10 ? 0.5 : S < 25 ? 1 : S < 75 ? 2.5 : S < 500 ? 5 : 10
  const strikes = [-2, -1, 0, 1, 2]
    .map(i => Math.round((kRec + i * inc) / inc) * inc)
    .filter(k => k > 0)

  return (
    <div className="opt-strikes-wrap">
      <div className="opt-strikes-header">
        <span className="opt-strikes-title">Nearby Strikes — {rec.expDate}</span>
        <span className="opt-strikes-sub">{ticker} {isCall ? 'CALL' : 'PUT'} · pick based on your risk tolerance</span>
      </div>
      <div className="opt-strikes-table">
        <div className="opt-st-row opt-st-hdr">
          <span>Strike</span>
          <span>Premium</span>
          <span>Delta</span>
          <span>Break-Even</span>
          <span>Prob ITM</span>
          <span>$/Contract</span>
        </div>
        {strikes.map(K => {
          const prem  = bsPrice(S, K, T, sig, isCall)
          const g     = calcGreeks(S, K, T, sig, isCall)
          if (!g) return null
          const be    = isCall ? K + prem : K - prem
          const isRec = K === kRec
          const isITM = isCall ? K < S : K > S

          return (
            <div key={K} className={`opt-st-row${isRec ? ' opt-st-rec' : ''}${isITM ? ' opt-st-itm' : ''}`}>
              <span className="opt-st-strike">
                <span style={{ color: isRec ? '#f59e0b' : isITM ? '#60a5fa' : '#a0c0dc' }}>
                  ${K % 1 === 0 ? K.toFixed(0) : K.toFixed(2)}
                </span>
                {isRec && <span className="opt-st-badge">OUR PICK</span>}
                {isITM && !isRec && <span className="opt-st-itm-tag">ITM</span>}
              </span>
              <span>${prem.toFixed(2)}</span>
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
        <span> = strike already in the money</span>
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

// ── Pre-entry Checklist ───────────────────────────────────────────────────────
function EntryChecklist({ direction, conflict, adxSignal, earningsDate, ivData, setupGrade }) {
  if (!direction) return null
  const daysToEarnings = earningsDate
    ? Math.round((earningsDate.getTime() - Date.now()) / 86400000)
    : null

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
  ]
  const pass = items.filter(i => i.ok).length

  return (
    <div className="opt-checklist">
      <div className="opt-checklist-header">
        <span className="opt-checklist-title">PRE-ENTRY CHECKLIST</span>
        <span className="opt-checklist-score" style={{ color: pass === 5 ? '#10b981' : pass >= 3 ? '#f59e0b' : '#ef4444' }}>
          {pass}/5
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
function RecCard({ rec, ticker, maxRisk, currentPrice, ivRank, isQuickPlay, sigma, grade, adxSignal }) {
  if (!rec) return null
  const { label, dte, expDate, strike, premium, contractCost, isCall } = rec

  const mainClr = isCall ? '#10b981' : '#ef4444'
  const bg      = isCall ? '#001a0d' : '#1a0000'
  const bord    = isCall ? '#064e2e' : '#6b0000'

  // IV-adaptive sizing
  const { budget, note: ivNote, warn: ivWarn } = ivBudget(maxRisk, ivRank)
  const qty      = contractCost > 0 ? Math.floor(budget / contractCost) : 0
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

      {ivWarn && (
        <div className="opt-iv-size-warn">
          ⚠ IV expensive (rank {Math.round(ivRank)}) — position sized down to 60% of budget · ${f0(budget)} effective budget
        </div>
      )}

      {qty < 1 && (
        <div className="opt-over-budget">
          ⚠ 1 contract ≈ ${f0(contractCost)} · exceeds ${f0(budget)} budget · increase risk % in Analyze → Timing → Risk Panel
        </div>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="opt-exp-note">
        Hover column headers for definitions · Call side shown · longer DTE = more time premium but also more time decay risk
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function OptionsChain({
  ticker, currentPrice, historicalVol, swingResult, confluenceResult,
  setupGrade, patterns, hsPatterns, ivData, lastUpdated,
  earningsDate, adxSignal, optionsChain, chainFetchDone, onRetryChain,
}) {
  const [conviction,    setConviction]    = useState('standard')
  const [optionsView,   setOptionsView]   = useState('recommendations')  // 'recommendations' | 'structure'

  const accountSize = +(localStorage.getItem('rp_account')  || 25000)
  const riskPct     = +(localStorage.getItem('rp_risk_pct') || 1.0)
  const maxRisk     = accountSize * (riskPct / 100)

  const swingSignal = swingResult?.signal
  const cfSignal    = confluenceResult?.signal

  let direction = null
  if      (swingSignal === 'LONG') direction = 'CALL'
  else if (swingSignal === 'EXIT') direction = 'PUT'
  else if (cfSignal === 'CALL')    direction = 'CALL'
  else if (cfSignal === 'PUT')     direction = 'PUT'

  const conflict = (swingSignal === 'LONG' && cfSignal === 'PUT') ||
                   (swingSignal === 'EXIT' && cfSignal === 'CALL')

  // Prefer market IV from Yahoo Finance quote; fall back to historical vol
  const sigma      = ivData?.atmIV != null ? ivData.atmIV / 100 : (historicalVol ?? 0.30)
  const sigmaLabel = ivData?.atmIV != null
    ? `Market IV ${(+ivData.atmIV).toFixed(1)}%`
    : `30d HVol ${(sigma * 100).toFixed(1)}%`

  const patternTarget = direction === 'CALL'
    ? (patterns?.doubleBottom?.target ?? hsPatterns?.inverseHAndS?.target ?? null)
    : (patterns?.doubleTop?.target    ?? hsPatterns?.headAndShoulders?.target ?? null)

  const ivRank = ivData?.ivRank ?? null

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
        <ExpiryCompare optionsChain={optionsChain} currentPrice={currentPrice} sigma={sigma} />
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
        setupGrade={setupGrade}   // full object — DirBar uses setupGrade.grade internally
        swingSignal={swingSignal}
        cfSignal={cfSignal}
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

      <IVRankBanner ivData={ivData} />

      <MarketSentimentStrip optionsChain={optionsChain} currentPrice={currentPrice} />

      {/* Chain status banners */}
      {chainFetchDone && optionsChain?.empty && (
        <div className="opt-chain-noopt">
          <span className="opt-chain-icon">✕</span>
          <div>
            <div className="opt-chain-noopt-title">No options listed for {ticker}</div>
            <div className="opt-chain-noopt-sub">
              This ticker has no active options on Yahoo Finance — it may be an OTC stock,
              micro-cap, or a security that does not support options trading.
              Recommendations below use Black-Scholes math and are for educational reference only —
              verify that options are actually available at your broker before placing any order.
            </div>
          </div>
        </div>
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
        </div>
      )}

      <EarningsWarning earningsDate={earningsDate} recs={recs} />

      <SpreadAlert ivRank={ivRank} direction={direction} currentPrice={currentPrice} sigma={sigma} recs={recs} />

      <EntryChecklist
        direction={conflict ? null : direction}
        conflict={conflict}
        adxSignal={adxSignal}
        earningsDate={earningsDate}
        ivData={ivData}
        setupGrade={setupGrade}
      />

      {direction && !conflict && (
        <ConvictionBar conviction={conviction} onChange={setConviction} />
      )}

      {conflict && (
        <div className="opt-conflict-note">
          ⚠ Signals conflict — Timing says {swingSignal === 'LONG' ? 'go long' : 'exit/short'} but Signals (confluence) says {cfSignal}.
          Both must agree before entering any option position.
        </div>
      )}

      {recs && (
        <>
          {/* Quick play — appears only on A / A+ setups */}
          {recs.quickPlay && (
            <div className="opt-quickplay-section">
              <div className="opt-quickplay-header">
                ⚡ QUICK PLAY ACTIVATED · {setupGrade?.grade} GRADE · HIGH GAMMA · CONFIRM 4H SIGNAL FIRST
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
                isQuickPlay
              />
            </div>
          )}

          {/* Primary + Extended side by side */}
          <div className="opt-picks-row">
            <RecCard
              rec={recs.primary}
              ticker={ticker}
              maxRisk={maxRisk}
              currentPrice={currentPrice}
              ivRank={ivRank}
              sigma={sigma}
              grade={setupGrade}
              adxSignal={adxSignal}
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
            />
          </div>

          {/* P&L scenario table — primary pick */}
          {recs.primary && (() => {
            const { budget } = ivBudget(maxRisk, ivRank)
            const qty = recs.primary.contractCost > 0
              ? Math.floor(budget / recs.primary.contractCost)
              : 0
            return (
              <PnLScenarios
                rec={recs.primary}
                currentPrice={currentPrice}
                qty={qty}
              />
            )
          })()}

          {/* Strike comparison — primary expiry */}
          {recs.primary && (
            <StrikeComparison
              rec={recs.primary}
              currentPrice={currentPrice}
              ticker={ticker}
            />
          )}

          {/* P&L curve — primary pick */}
          {recs.primary && recs.primary.strike && recs.primary.dte > 0 && (() => {
            const { budget } = ivBudget(maxRisk, ivRank)
            const qty     = recs.primary.contractCost > 0 ? Math.floor(budget / recs.primary.contractCost) : 1
            const premium = recs.primary.contractCost / 100  // per share
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

          <div className="opt-disclaimer">
            {recs?.primary?.isLive
              ? `ℹ Premiums sourced from live bid/ask mid-price (${sigmaLabel}). Greeks use per-contract implied volatility. Verify on your broker before placing any order.`
              : `ℹ Premiums are Black-Scholes theoretical estimates using ${sigmaLabel}. Actual market prices will differ — verify on your broker before placing any order.`
            }
            {chainTimestamps?.length
              ? ' Expiry dates are real Yahoo Finance dates — expirations match your broker.'
              : ' Expiry dates are estimated (3rd Friday of each month) — actual expirations may differ.'
            }
            {setupGrade && ` DTE floors are grade-adaptive: ${setupGrade.grade} grade uses ${
              setupGrade.grade === 'A+' ? '25' : setupGrade.grade === 'A' ? '30'
              : setupGrade.grade === 'B' ? '38' : '48'
            }d minimum.`}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
