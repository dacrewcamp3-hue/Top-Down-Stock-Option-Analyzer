import { useState } from 'react'
import './StockTradePlan.css'

const f2  = v => v != null ? (+v).toFixed(2) : '—'
const f0  = v => v != null ? Math.round(+v).toLocaleString() : '—'

const SHARE_KEY    = 'tdsa_share_size'
const DAY_PNL_KEY  = 'tdsa_day_pnl'
const DAY_DATE_KEY = 'tdsa_day_date'

function todayStr() { return new Date().toISOString().slice(0, 10) }

function loadDayPnl() {
  try {
    const date = localStorage.getItem(DAY_DATE_KEY)
    if (date !== todayStr()) return 0
    return +(localStorage.getItem(DAY_PNL_KEY) || 0)
  } catch { return 0 }
}

function saveDayPnl(val) {
  try {
    localStorage.setItem(DAY_DATE_KEY, todayStr())
    localStorage.setItem(DAY_PNL_KEY, String(val))
  } catch {}
}

// ── Machine status ─────────────────────────────────────────────────────────────
function MachineStatus({ dayPnl, dailyGoal, dailyLimit, direction, ticker }) {
  const goalHit  = dailyGoal > 0 && dayPnl >= dailyGoal
  const limitHit = dailyLimit > 0 && dayPnl <= -dailyLimit
  const off      = goalHit || limitHit

  const bg     = off ? (goalHit ? '#011a0c' : '#1a0101') : '#090f1a'
  const border = off ? (goalHit ? '#10b981' : '#ef4444') : '#1e2d45'
  const color  = off ? (goalHit ? '#10b981' : '#ef4444') : '#4a6888'
  const status = goalHit ? '✓ GOAL HIT — MACHINE OFF' : limitHit ? '✗ LOSS LIMIT — MACHINE OFF' : '● MACHINE ON'
  const sub    = goalHit
    ? `You made $${f0(dayPnl)} today. Shut it down. Tomorrow is another day.`
    : limitHit
    ? `You lost $${f0(Math.abs(dayPnl))} today. Shut it down before you go deeper.`
    : direction && direction !== 'NO TRADE' && ticker
    ? `${ticker} ${direction} setup loaded. Execute your plan.`
    : 'Load a ticker. Get a signal. Execute your plan.'

  return (
    <div className="stp-machine" style={{ background: bg, borderColor: border }}>
      <div className="stp-machine-row">
        <span className="stp-machine-status" style={{ color }}>{status}</span>
        <span className="stp-machine-pnl" style={{ color: dayPnl >= 0 ? '#10b981' : '#ef4444' }}>
          Today: {dayPnl >= 0 ? '+' : ''}${f0(dayPnl)}
        </span>
        <span className="stp-machine-goal" style={{ color: '#3a5070' }}>
          / goal ${f0(dailyGoal)}
        </span>
      </div>
      {dailyGoal > 0 && (
        <div className="stp-day-bar-wrap">
          <div className="stp-day-bar-track">
            <div
              className="stp-day-bar-fill"
              style={{
                width: `${Math.min(100, Math.max(0, (dayPnl / dailyGoal) * 100))}%`,
                background: dayPnl < 0 ? '#ef4444' : goalHit ? '#10b981' : '#3b82f6',
              }}
            />
          </div>
          <span className="stp-day-bar-sub">{sub}</span>
        </div>
      )}
    </div>
  )
}

// ── Trade calculator ───────────────────────────────────────────────────────────
function TradeCalc({ entryPx, stopPx, riskPx, targetPrices, stopLabel, entryLabel, hasOR, direction, shares }) {
  if (!entryPx || !direction || direction === 'NO TRADE' || shares <= 0) return null
  const isCall   = direction === 'CALL'
  const dirColor = isCall ? '#10b981' : '#ef4444'
  const dirBg    = isCall ? '#011208' : '#120202'
  const dirBord  = isCall ? '#065f46' : '#7f1d1d'

  const [t1Px, t2Px, t3Px, t4Px, t5Px] = targetPrices
  const sh20    = Math.round(shares * 0.20)
  const maxRisk = +(shares * riskPx).toFixed(0)

  const gain  = px => +Math.abs(px - entryPx).toFixed(2)
  const pctOf = px => ((Math.abs(px - entryPx) / entryPx) * 100).toFixed(1)

  // Cumulative P&L at each staged exit (20% at each level)
  const t1P = sh20 * gain(t1Px)
  const t2P = t1P + sh20 * gain(t2Px)
  const t3P = t2P + sh20 * gain(t3Px)
  const t4P = t3P + sh20 * gain(t4Px)
  const t5T = t4P + sh20 * gain(t5Px)

  const rr = n => maxRisk > 0 ? (n / maxRisk).toFixed(1) : null
  const rr1 = rr(t1P); const rr2 = rr(t2P); const rr3 = rr(t3P)
  const rr4 = rr(t4P); const rr5 = rr(t5T)

  return (
    <div className="stp-calc" style={{ borderColor: dirBord, background: dirBg }}>

      {/* ── Header ── */}
      <div className="stp-calc-header">
        <span className="stp-calc-title">TRADE CALCULATOR</span>
        <span className="stp-calc-entry" style={{ color: hasOR ? dirColor : '#4a6888' }}>
          {entryLabel} · {shares.toLocaleString()} sh · ${f0(entryPx * shares)} total
        </span>
        <span className="stp-calc-dir" style={{ color: dirColor }}>
          {isCall ? '▲ LONG' : '▼ SHORT'}
        </span>
      </div>

      {/* ── 5-target grid: STOP | T1 | T2 | T3 | T4 ── */}
      <div className="stp-grid">

        {/* STOP */}
        <div className="stp-col stp-col-stop">
          <div className="stp-col-hdr">STOP</div>
          <div className="stp-col-price" style={{ color: '#ef4444' }}>${f2(stopPx)}</div>
          <div className="stp-col-pct"   style={{ color: '#ef4444' }}>{stopLabel}</div>
          <div className="stp-col-pct"   style={{ color: '#ef4444' }}>−${f2(riskPx)}/sh</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Exit ALL</div>
          <div className="stp-col-pnl" style={{ color: '#ef4444' }}>−${f0(maxRisk)}</div>
        </div>

        {/* T1 */}
        <div className="stp-col stp-col-t1" style={{ borderColor: `${dirColor}30` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T1</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t1Px)}</div>
          <div className="stp-col-pct"   style={{ color: dirColor }}>+{pctOf(t1Px)}%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ stop to ${f2(entryPx)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t1P)}</div>
          {rr1 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr1}:1</div>}
        </div>

        {/* T2 */}
        <div className="stp-col stp-col-t2" style={{ borderColor: `${dirColor}28` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T2</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t2Px)}</div>
          <div className="stp-col-pct"   style={{ color: dirColor }}>+{pctOf(t2Px)}%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ trail to ${f2(t1Px)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t2P)}</div>
          {rr2 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr2}:1</div>}
        </div>

        {/* T3 */}
        <div className="stp-col stp-col-t3" style={{ borderColor: `${dirColor}20` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T3</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t3Px)}</div>
          <div className="stp-col-pct"   style={{ color: dirColor }}>+{pctOf(t3Px)}%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ trail to ${f2(t2Px)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t3P)}</div>
          {rr3 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr3}:1</div>}
        </div>

        {/* T4 */}
        <div className="stp-col stp-col-t4" style={{ borderColor: `${dirColor}18` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T4</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t4Px)}</div>
          <div className="stp-col-pct"   style={{ color: dirColor }}>+{pctOf(t4Px)}%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ trail to ${f2(t3Px)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t4P)}</div>
          {rr4 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr4}:1</div>}
        </div>

      </div>

      {/* ── T5 runner note ── */}
      <div className="stp-trail-row">
        <span className="stp-trail-label">T5 / RUNNER (20%)</span>
        <span className="stp-trail-body">
          Remaining {sh20} shares trail with a moving stop — raise it as price extends.
          At ${f2(t5Px)} (+{pctOf(t5Px)}%) your cumulative gain hits +${f0(t5T)} ({rr5}:1 R:R).
        </span>
      </div>

      {/* ── R:R summary bar ── */}
      <div className="stp-rr-row">
        <div className="stp-rr-item">
          <span className="stp-rr-lbl">RISK</span>
          <span className="stp-rr-val" style={{ color: '#ef4444' }}>−${f0(maxRisk)}</span>
        </div>
        <div className="stp-rr-arrow">→</div>
        <div className="stp-rr-item">
          <span className="stp-rr-lbl">T1</span>
          <span className="stp-rr-val" style={{ color: dirColor }}>+${f0(t1P)}</span>
          {rr1 && <span className="stp-rr-ratio" style={{ color: dirColor }}>{rr1}:1</span>}
        </div>
        <div className="stp-rr-arrow">→</div>
        <div className="stp-rr-item">
          <span className="stp-rr-lbl">T2</span>
          <span className="stp-rr-val" style={{ color: dirColor }}>+${f0(t2P)}</span>
          {rr2 && <span className="stp-rr-ratio" style={{ color: dirColor }}>{rr2}:1</span>}
        </div>
        <div className="stp-rr-arrow">→</div>
        <div className="stp-rr-item">
          <span className="stp-rr-lbl">T3</span>
          <span className="stp-rr-val" style={{ color: dirColor }}>+${f0(t3P)}</span>
          {rr3 && <span className="stp-rr-ratio" style={{ color: dirColor }}>{rr3}:1</span>}
        </div>
        <div className="stp-rr-arrow">→</div>
        <div className="stp-rr-item">
          <span className="stp-rr-lbl">T4</span>
          <span className="stp-rr-val" style={{ color: dirColor }}>+${f0(t4P)}</span>
          {rr4 && <span className="stp-rr-ratio" style={{ color: dirColor }}>{rr4}:1</span>}
        </div>
        <div className="stp-rr-arrow">→</div>
        <div className="stp-rr-item">
          <span className="stp-rr-lbl">T5</span>
          <span className="stp-rr-val" style={{ color: dirColor }}>+${f0(t5T)}</span>
          {rr5 && <span className="stp-rr-ratio" style={{ color: dirColor }}>{rr5}:1</span>}
        </div>
      </div>
    </div>
  )
}

// ── Scaling rules ──────────────────────────────────────────────────────────────
function ScalingRules({ entryPx, stopPx, riskPx, targetPrices, stopLabel, direction, shares }) {
  if (!entryPx || !direction || direction === 'NO TRADE' || shares <= 0) return null
  const isCall = direction === 'CALL'
  const [t1Px, t2Px, t3Px, t4Px, t5Px] = targetPrices
  const sh20   = Math.round(shares * 0.20)
  const pctOf  = px => ((Math.abs(px - entryPx) / entryPx) * 100).toFixed(1)

  const rules = [
    {
      num: 1, color: '#3b82f6',
      action: `Stop set at $${f2(stopPx)} (${stopLabel}) — DO NOT MOVE IT DOWN`,
      detail: `Place a hard stop order at $${f2(stopPx)} before the trade is live. If price closes below on the 5M chart, exit all ${shares.toLocaleString()} shares immediately — no second-guessing.`,
    },
    {
      num: 2, color: '#f59e0b',
      action: `T1 — $${f2(t1Px)} (+${pctOf(t1Px)}%): sell ${sh20} shares (20%), move stop to $${f2(entryPx)}`,
      detail: `15M swing target hit. Sell 20% and move your stop from $${f2(stopPx)} to $${f2(entryPx)} (your breakout entry). You can no longer lose on this trade.`,
    },
    {
      num: 3, color: '#f59e0b',
      action: `T2 — $${f2(t2Px)} (+${pctOf(t2Px)}%): sell ${sh20} shares (20%), trail stop to $${f2(t1Px)}`,
      detail: `Second 15M swing target hit. Sell another 20%. Trail your stop up to $${f2(t1Px)}. Worst case from here: you lock in T1 profit on the remainder.`,
    },
    {
      num: 4, color: '#10b981',
      action: `T3 — $${f2(t3Px)} (+${pctOf(t3Px)}%): sell ${sh20} shares (20%), trail stop to $${f2(t2Px)}`,
      detail: `Third 15M swing target hit. Sell another 20%. Move the trail stop to $${f2(t2Px)}. You have now sold 60% of your position with compounding locked profits.`,
    },
    {
      num: 5, color: '#10b981',
      action: `T4 — $${f2(t4Px)} (+${pctOf(t4Px)}%): sell ${sh20} shares (20%), trail stop to $${f2(t3Px)}`,
      detail: `Fourth 15M swing target hit. Sell another 20%. Trail stop moves to $${f2(t3Px)}. Only the T5 runner remains — it cannot give back more than one stop increment of profit.`,
    },
    {
      num: 6, color: '#10b981',
      action: `T5 / RUNNER — $${f2(t5Px)} (+${pctOf(t5Px)}%): final ${sh20} shares, trail with a moving stop`,
      detail: `Let the final shares run as far as the 5M structure allows. Use a trailing stop that moves up automatically. At $${f2(t5Px)} your total gain on the position is maximized — close if price shows a 5M lower high.`,
    },
  ]

  return (
    <div className="stp-rules">
      <div className="stp-rules-title">SCALING RULES — NEVER DEVIATE MID-TRADE</div>
      {rules.map(r => (
        <div key={r.num} className="stp-rule-row">
          <div className="stp-rule-num" style={{ background: `${r.color}18`, borderColor: `${r.color}40`, color: r.color }}>
            {r.num}
          </div>
          <div className="stp-rule-body">
            <div className="stp-rule-action" style={{ color: r.color }}>{r.action}</div>
            <div className="stp-rule-detail">{r.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Stock + Option Coordination ────────────────────────────────────────────────
function CoordinationPanel({ entryPx, stopPx, riskPx, targetPrices, direction, shares, rec }) {
  if (!entryPx || !direction || direction === 'NO TRADE') return null
  const isCall = direction === 'CALL'

  const delta   = rec?.delta   != null ? Math.abs(rec.delta)   : 0.45
  const premium = rec?.premium != null ? rec.premium           : null
  const hasLive = rec != null && rec.premium != null

  const [t1Px, t2Px, t3Px, t4Px, t5Px] = targetPrices
  const stopDist  = riskPx

  const optChg  = move => +(move * delta).toFixed(2)
  const optPct  = (move, label) => {
    const dollarChg = optChg(move)
    if (premium) return { dollar: dollarChg, pct: (dollarChg / premium * 100).toFixed(0), label }
    return { dollar: dollarChg, pct: null, label }
  }

  const optStop25DistApprox = premium ? +(premium * 0.25 / delta).toFixed(2) : null
  const optStop25Px = optStop25DistApprox
    ? +(isCall ? entryPx - optStop25DistApprox : entryPx + optStop25DistApprox).toFixed(2)
    : null

  const pctOf = px => ((Math.abs(px - entryPx) / entryPx) * 100).toFixed(1)

  const stopChg = optPct(-stopDist, 'STOP')
  const t1Chg   = optPct(Math.abs(t1Px - entryPx), 'T1')
  const t2Chg   = optPct(Math.abs(t2Px - entryPx), 'T2')
  const t3Chg   = optPct(Math.abs(t3Px - entryPx), 'T3')
  const t4Chg   = optPct(Math.abs(t4Px - entryPx), 'T4')
  const t5Chg   = optPct(Math.abs(t5Px - entryPx), 'T5')

  const rows = [
    {
      label: 'STOP', stockPx: stopPx,
      move: `−${pctOf(stopPx)}%  (−$${f2(stopDist)})`, moveColor: '#ef4444',
      stockAction: 'EXIT all shares immediately',
      optPct:   stopChg.pct ? `≈ −${Math.abs(+stopChg.pct)}%` : `≈ −$${f2(Math.abs(stopChg.dollar))}/sh`,
      optAction: 'EXIT all contracts — thesis wrong', optColor: '#ef4444',
      rule: 'Stock stop and option stop fire TOGETHER. Do not wait for the option to hit −25% separately.',
    },
    {
      label: 'T1', stockPx: t1Px,
      move: `+${pctOf(t1Px)}%  (+$${f2(Math.abs(t1Px - entryPx))})`, moveColor: '#10b981',
      stockAction: 'Sell 20% of shares — stop → breakeven',
      optPct:   t1Chg.pct ? `≈ +${t1Chg.pct}%` : `≈ +$${f2(t1Chg.dollar)}/sh`,
      optAction: 'HOLD all contracts — just warming up', optColor: '#f59e0b',
      rule: `Option has only moved ~${t1Chg.pct ? Math.abs(+t1Chg.pct) + '%' : 'slightly'} at T1. The stock is at breakeven — let the option run.`,
    },
    {
      label: 'T2', stockPx: t2Px,
      move: `+${pctOf(t2Px)}%  (+$${f2(Math.abs(t2Px - entryPx))})`, moveColor: '#10b981',
      stockAction: 'Sell 20% — trail stop to T1',
      optPct:   t2Chg.pct ? `≈ +${t2Chg.pct}%` : `≈ +$${f2(t2Chg.dollar)}/sh`,
      optAction: 'Sell 25% of contracts — lock in early partial', optColor: '#10b981',
      rule: `Option is up ~${t2Chg.pct ? Math.abs(+t2Chg.pct) + '%' : 'meaningfully'}. Take 25% off the option position to lock real dollars.`,
    },
    {
      label: 'T3', stockPx: t3Px,
      move: `+${pctOf(t3Px)}%  (+$${f2(Math.abs(t3Px - entryPx))})`, moveColor: '#10b981',
      stockAction: 'Sell 20% — trail stop to T2',
      optPct:   t3Chg.pct ? `≈ +${t3Chg.pct}%` : `≈ +$${f2(t3Chg.dollar)}/sh`,
      optAction: 'Sell 25% more contracts — option near +50% TP zone', optColor: '#10b981',
      rule: `Option at ~${t3Chg.pct ? Math.abs(+t3Chg.pct) + '%' : 'strong gains'} — nearing the +50% target. Sell another 25%.`,
    },
    {
      label: 'T4', stockPx: t4Px,
      move: `+${pctOf(t4Px)}%  (+$${f2(Math.abs(t4Px - entryPx))})`, moveColor: '#10b981',
      stockAction: 'Sell 20% — trail stop to T3',
      optPct:   t4Chg.pct ? `≈ +${t4Chg.pct}%` : `≈ +$${f2(t4Chg.dollar)}/sh`,
      optAction: 'Sell 25% more contracts — book the bulk', optColor: '#10b981',
      rule: `Option up ~${t4Chg.pct ? Math.abs(+t4Chg.pct) + '%' : 'significantly'}. Sell another 25%. You now have 75% of option profits locked.`,
    },
    {
      label: 'T5', stockPx: t5Px,
      move: `+${pctOf(t5Px)}%  (+$${f2(Math.abs(t5Px - entryPx))})`, moveColor: '#10b981',
      stockAction: 'Trail final 20% with moving stop',
      optPct:   t5Chg.pct ? `≈ +${t5Chg.pct}%` : `≈ +$${f2(t5Chg.dollar)}/sh`,
      optAction: 'EXIT all remaining contracts — full option profit taken', optColor: '#10b981',
      rule: `At T5 the option has returned maximum gains. Close the entire option position. Let the stock runner capture anything beyond with zero option risk.`,
    },
  ]

  return (
    <div className="stp-coord">
      <div className="stp-coord-header">
        <span className="stp-coord-title">STOCK + OPTION COORDINATION</span>
        <span className="stp-coord-sub">One set of 15M structural levels governs both positions</span>
      </div>

      <div className="stp-coord-explainer">
        <div className="stp-coord-exp-row">
          <span className="stp-coord-exp-lbl">Entry level</span>
          <span className="stp-coord-exp-val">${f2(entryPx)} — execute on 5M close through this level</span>
          <span className="stp-coord-exp-note">5M execution</span>
        </div>
        <div className="stp-coord-exp-row">
          <span className="stp-coord-exp-lbl">Stock stop</span>
          <span className="stp-coord-exp-val">${f2(stopPx)} — ${f2(riskPx)}/sh risk</span>
          <span className="stp-coord-exp-note">OR structure</span>
        </div>
        <div className="stp-coord-exp-row">
          <span className="stp-coord-exp-lbl">Option stop</span>
          <span className="stp-coord-exp-val">
            −25% of premium
            {optStop25Px && ` ≈ stock at $${f2(optStop25Px)} (−${f2(optStop25DistApprox)})`}
            {!hasLive && ' (estimated at 0.45Δ)'}
          </span>
          <span className="stp-coord-exp-note">premium-based</span>
        </div>
        <div className="stp-coord-exp-rule">
          The stock stop fires first on most setups. Use it as the trigger for BOTH.
          {optStop25Px && (
            <> If the option loses 25% of its value <em>before</em> the stock reaches ${f2(stopPx)},
            that is an IV crush or theta signal — exit the option anyway.</>
          )}
          {!hasLive && ' Load a ticker for exact numbers based on the live contract.'}
        </div>
      </div>

      <div className="stp-coord-table">
        {rows.map((r, i) => (
          <div key={i} className={`stp-coord-row${i === 0 ? ' stp-coord-stop-row' : ''}`}>
            <div className="stp-coord-level">
              <div className="stp-coord-price" style={{ color: r.moveColor }}>${f2(r.stockPx)}</div>
              <div className="stp-coord-move"  style={{ color: r.moveColor }}>{r.move}</div>
            </div>
            <div className="stp-coord-actions">
              <div className="stp-coord-act-row">
                <span className="stp-coord-act-tag stp-coord-tag-stock">STOCK</span>
                <span className="stp-coord-act-text">{r.stockAction}</span>
              </div>
              <div className="stp-coord-act-row">
                <span className="stp-coord-act-tag stp-coord-tag-option">OPTION</span>
                <span className="stp-coord-act-pct" style={{ color: r.optColor }}>{r.optPct}</span>
                <span className="stp-coord-act-text" style={{ color: r.optColor }}>{r.optAction}</span>
              </div>
              <div className="stp-coord-rule-text">{r.rule}</div>
            </div>
          </div>
        ))}
      </div>

      {!hasLive && (
        <div className="stp-coord-note">
          Option % estimates use 0.45Δ (standard target). Load a ticker with IV data for exact contract numbers.
        </div>
      )}
    </div>
  )
}

// ── 5 retail mistakes ──────────────────────────────────────────────────────────
function RetailMistakes() {
  const [open, setOpen] = useState(false)

  const mistakes = [
    {
      num: 1,
      mistake: 'No stop orders',
      fix: 'Every single trade has a stop loss set before you enter. No exceptions. No "I\'ll watch it." Set the order.',
    },
    {
      num: 2,
      mistake: 'Averaging into losing trades',
      fix: 'The stock moved against you — that means you are wrong. Adding shares to a losing position is doubling down on being wrong. Get out. Find a better trade.',
    },
    {
      num: 3,
      mistake: 'Turning winners into losers',
      fix: 'At T1, move your stop to breakeven. Once you do that, this trade cannot lose. Never let a winning trade become a loss.',
    },
    {
      num: 4,
      mistake: 'Turning winning days into losing days',
      fix: 'You hit your daily goal. You are green. The right move is to stop. Every extra trade you take when you\'re up risks giving it all back.',
    },
    {
      num: 5,
      mistake: 'Not knowing when to turn off the machine',
      fix: 'Two rules govern your day: goal hit → machine off. Loss limit hit → machine off. Trading when emotional or chasing losses destroys accounts.',
    },
  ]

  return (
    <div className="stp-mistakes">
      <button className="stp-mistakes-toggle" onClick={() => setOpen(v => !v)}>
        <span className="stp-mistakes-icon">⚠</span>
        <span className="stp-mistakes-title">THE 5 MISTAKES RETAIL TRADERS MAKE</span>
        <span className="stp-mistakes-arrow">{open ? '▲' : '▾'}</span>
      </button>
      {open && (
        <div className="stp-mistakes-body">
          {mistakes.map(m => (
            <div key={m.num} className="stp-mistake-row">
              <div className="stp-mistake-num">#{m.num}</div>
              <div className="stp-mistake-content">
                <div className="stp-mistake-label">{m.mistake}</div>
                <div className="stp-mistake-fix">→ {m.fix}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Streak helpers ─────────────────────────────────────────────────────────────
const STREAK_KEY = 'tdsa_trade_streak'
function loadStreak() { try { return JSON.parse(localStorage.getItem(STREAK_KEY) || '[]') } catch { return [] } }
function saveStreak(arr) { try { localStorage.setItem(STREAK_KEY, JSON.stringify(arr.slice(-15))) } catch {} }
function getStreakStats(history) {
  if (!history.length) return { streak: 0, type: null, sizeMult: 1.0, msg: '' }
  const cur = history[history.length - 1]
  let streak = 1
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i] === cur) streak++
    else break
  }
  if (cur === 'L') {
    const m = streak >= 4 ? 0.50 : streak >= 3 ? 0.65 : streak >= 2 ? 0.75 : 0.90
    const msg = streak >= 4 ? 'DANGER ZONE: 4+ consecutive losses. Go to cash. The machine is broken right now.'
              : streak >= 3 ? 'Three in a row. Half size only. Your judgment is compromised by losses.'
              : 'Two consecutive losses. Reduce size 25%. Trade defensively.'
    return { streak, type: 'L', sizeMult: m, msg, color: streak >= 3 ? '#ef4444' : '#f59e0b' }
  }
  return {
    streak, type: 'W', sizeMult: 1.0, color: '#10b981',
    msg: streak >= 3 ? 'Three straight wins — maintain size. Winning streaks end. Do NOT upsize out of overconfidence.' : ''
  }
}

// ── Time-of-day window ─────────────────────────────────────────────────────────
function getTimeWindow() {
  const now = new Date()
  const t   = now.getHours() * 60 + now.getMinutes()
  if (t < 570) return { key: 'pre',   label: 'PRE-MARKET',       color: '#4a6888', bg: '#07111e', border: '#1a2d45', mult: 0,    note: 'Market not open. Review your plan, set alerts.' }
  if (t < 615) return { key: 'prime', label: 'PRIME WINDOW',     color: '#10b981', bg: '#01120a', border: '#065f46', mult: 1.0,  note: '9:31–10:15 AM — highest OR breakout follow-through. Full size on volume-confirmed setups.' }
  if (t < 690) return { key: 'sec',   label: 'SECONDARY WINDOW', color: '#34d399', bg: '#011a0e', border: '#047857', mult: 0.9,  note: '10:15–11:30 AM — still works. A/A+ setups only, standard size.' }
  if (t < 840) return { key: 'chop',  label: 'CHOP ZONE',        color: '#f59e0b', bg: '#0f0900', border: '#4d3800', mult: 0.5,  note: '11:30 AM–2:00 PM — OR breakouts fail at 2× normal rate. Reduce size 50% or skip entirely.' }
  if (t < 930) return { key: 'power', label: 'POWER HOUR',       color: '#60a5fa', bg: '#06111e', border: '#1a3a6e', mult: 0.75, note: '2:00–3:30 PM — institutional accumulation window. Only trade with the day\'s dominant trend.' }
  if (t < 960) return { key: 'eod',   label: 'END OF DAY',       color: '#a78bfa', bg: '#0a0718', border: '#4c1d95', mult: 0.6,  note: '3:30–4:00 PM — directional continuation only. Take profits fast. Spreads widen.' }
  return             { key: 'after', label: 'AFTER HOURS',       color: '#4a6888', bg: '#07111e', border: '#1a2d45', mult: 0,    note: 'Market closed. Plan tomorrow\'s setups.' }
}

// ── 1. Time Window Band ────────────────────────────────────────────────────────
function TimeWindowBand() {
  const tw = getTimeWindow()
  return (
    <div className="stp-timewin" style={{ background: tw.bg, borderColor: tw.border }}>
      <span className="stp-timewin-dot" style={{ background: tw.color }} />
      <span className="stp-timewin-label" style={{ color: tw.color }}>{tw.label}</span>
      <span className="stp-timewin-note">{tw.note}</span>
    </div>
  )
}

// ── 2. Volume Confirm Gate ─────────────────────────────────────────────────────
function VolumeConfirmGate({ volumeSpike }) {
  if (!volumeSpike) return null
  const ratio = +(volumeSpike.ratio ?? 1)
  const confirmed = ratio >= 1.5
  const weak      = ratio >= 0.9 && ratio < 1.5
  const color = confirmed ? '#10b981' : weak ? '#f59e0b' : '#ef4444'
  const icon  = confirmed ? '✓' : weak ? '~' : '✗'
  const label = confirmed ? 'VOLUME CONFIRMED' : weak ? 'VOLUME WEAK' : 'LOW VOLUME — WAIT'
  const note  = confirmed
    ? `${ratio.toFixed(1)}× average — breakout has institutional participation. Proceed with plan.`
    : weak
    ? `${ratio.toFixed(1)}× average — borderline. Wait for the next bar to confirm or reduce size 30%.`
    : `${ratio.toFixed(1)}× average — thin volume. High failure rate. Do NOT enter full size. Wait for volume to appear or skip this setup.`
  return (
    <div className="stp-volgate" style={{ borderColor: color, background: confirmed ? '#01120a' : weak ? '#0f0900' : '#130305' }}>
      <span className="stp-volgate-icon" style={{ color }}>{icon}</span>
      <span className="stp-volgate-label" style={{ color }}>{label}</span>
      <span className="stp-volgate-note">{note}</span>
    </div>
  )
}

// ── 3. Breakout Quality Grade ──────────────────────────────────────────────────
function BreakoutQualityGrade({ volumeSpike, adxSignal, earningsDays, shares }) {
  const tw       = getTimeWindow()
  const volRatio = +(volumeSpike?.ratio ?? 1)
  const adx      = +(adxSignal?.adx ?? 0)
  const rising   = adxSignal?.adxRising ?? false

  // Time window score (0-25)
  const twPts = tw.key === 'prime' ? 25 : tw.key === 'sec' ? 16 : tw.key === 'power' ? 8 : tw.key === 'chop' ? 0 : tw.key === 'eod' ? 5 : 0
  // Volume score (0-35)
  const volPts = volRatio >= 2.5 ? 35 : volRatio >= 2.0 ? 28 : volRatio >= 1.5 ? 20 : volRatio >= 1.0 ? 10 : 0
  // ADX score (0-25)
  const adxPts = adx >= 35 && rising ? 25 : adx >= 30 ? 20 : adx >= 25 ? 14 : adx >= 20 ? 7 : 0
  // Combo bonus (0-10)
  const bonusPts = (tw.key === 'prime' && volRatio >= 1.5 ? 6 : 0) + (adx >= 28 && volRatio >= 1.5 ? 4 : 0)
  // Earnings deduction
  const earningsDed = earningsDays != null && earningsDays >= 0
    ? (earningsDays <= 2 ? 20 : earningsDays <= 5 ? 10 : earningsDays <= 7 ? 5 : 0)
    : 0

  const score = Math.max(0, Math.min(100, twPts + volPts + adxPts + bonusPts - earningsDed))
  const grade = score >= 82 ? 'A+' : score >= 66 ? 'A' : score >= 48 ? 'B' : 'C'
  const sizeMult = score >= 82 ? 1.0 : score >= 66 ? 0.85 : score >= 48 ? 0.65 : 0.40
  const gc = score >= 82 ? '#10b981' : score >= 66 ? '#34d399' : score >= 48 ? '#f59e0b' : '#ef4444'
  const adjShares = shares > 0 ? Math.round(shares * sizeMult) : null

  const factors = [
    { label: tw.label, pts: twPts, good: twPts >= 16 ? true : twPts >= 8 ? null : false },
    { label: `Volume ${volRatio.toFixed(1)}×`, pts: volPts, good: volPts >= 20 ? true : volPts >= 10 ? null : false },
    { label: `ADX ${adx}${rising ? ' ↑' : ''}`, pts: adxPts, good: adxPts >= 14 ? true : adxPts >= 7 ? null : false },
    ...(earningsDed > 0 ? [{ label: `Earnings in ${earningsDays}d`, pts: -earningsDed, good: false }] : []),
  ]

  return (
    <div className="stp-grade" style={{ borderColor: gc, background: score >= 66 ? '#011a0e' : score >= 48 ? '#100900' : '#130305' }}>
      <div className="stp-grade-left">
        <div className="stp-grade-letter" style={{ color: gc }}>{grade}</div>
        <div className="stp-grade-score">{score}/100</div>
      </div>
      <div className="stp-grade-mid">
        <div className="stp-grade-title">OR BREAKOUT QUALITY</div>
        <div className="stp-grade-factors">
          {factors.map((f, i) => (
            <span key={i} className="stp-grade-factor"
              style={{ color: f.good === true ? '#10b981' : f.good === false ? '#ef4444' : '#f59e0b' }}>
              {f.good === true ? '✓' : f.good === false ? '✗' : '~'} {f.label}
            </span>
          ))}
        </div>
      </div>
      {adjShares != null && (
        <div className="stp-grade-right">
          <div className="stp-grade-size-lbl">RECOMMENDED SIZE</div>
          <div className="stp-grade-size-val" style={{ color: gc }}>{adjShares.toLocaleString()} sh</div>
          <div className="stp-grade-size-sub">{(sizeMult * 100).toFixed(0)}% of base</div>
        </div>
      )}
    </div>
  )
}

// ── 4. Option Level Reverse Matrix ─────────────────────────────────────────────
function OptionReverseMatrix({ rec, entryPx, direction }) {
  if (!rec?.premium || !rec?.delta || !entryPx || !direction || direction === 'NO TRADE') return null
  const isCall  = direction === 'CALL'
  const premium = +rec.premium
  const delta   = Math.abs(+rec.delta)
  if (premium <= 0 || delta <= 0) return null
  const dc = isCall ? '#10b981' : '#ef4444'

  const levels = [25, 50, 75, 100].map(pct => {
    const optMove   = +(premium * pct / 100).toFixed(2)
    const stockMove = +(optMove / delta).toFixed(2)
    const stockPx   = +(isCall ? entryPx + stockMove : entryPx - stockMove).toFixed(2)
    const optVal    = +(premium + optMove).toFixed(2)
    return { pct, stockMove, stockPx, optVal }
  })

  return (
    <div className="stp-optmatrix" style={{ borderColor: `${dc}40` }}>
      <div className="stp-optmatrix-head">
        <span className="stp-optmatrix-title">OPTION EXIT LEVELS</span>
        <span className="stp-optmatrix-sub">${f2(premium)} premium · {(delta * 100).toFixed(0)}Δ → what stock price = what option gain</span>
      </div>
      <div className="stp-optmatrix-grid">
        {levels.map(lv => (
          <div key={lv.pct} className="stp-optmatrix-cell" style={{ borderColor: `${dc}25` }}>
            <div className="stp-optmatrix-pct" style={{ color: dc }}>+{lv.pct}%</div>
            <div className="stp-optmatrix-optval">${f2(lv.optVal)}</div>
            <div className="stp-optmatrix-arrow">↓ needs stock at</div>
            <div className="stp-optmatrix-stk" style={{ color: dc }}>${f2(lv.stockPx)}</div>
            <div className="stp-optmatrix-move">({isCall ? '+' : '−'}${f2(lv.stockMove)} move)</div>
          </div>
        ))}
      </div>
      <div className="stp-optmatrix-note">
        These are your true option profit anchors. When the stock reaches the price in each column, your option is up that percentage.
        Use these alongside T1–T5 — they often don't line up, and the option exit comes first.
      </div>
    </div>
  )
}

// ── 5. Resistance Friction Map ─────────────────────────────────────────────────
function ResistanceFrictionMap({ targetPrices, fibLevels, dailyBars, direction }) {
  if (!targetPrices?.length) return null
  const ZONE = 0.28
  const levels = []

  const len = dailyBars?.highs?.length ?? 0
  if (len >= 2) {
    const pdH = +dailyBars.highs[len - 2]
    const pdL = +dailyBars.lows[len - 2]
    if (pdH > 0) levels.push({ price: pdH, label: 'Prev Day High' })
    if (pdL > 0) levels.push({ price: pdL, label: 'Prev Day Low' })
  }
  if (fibLevels && typeof fibLevels === 'object') {
    Object.entries(fibLevels).forEach(([k, v]) => {
      if (typeof v === 'number' && v > 0) levels.push({ price: v, label: `Fib ${k}` })
    })
  }
  if (!levels.length) return null

  const labels = ['T1','T2','T3','T4','T5']
  const rows = targetPrices.slice(0, 5).map((px, i) => ({
    label: labels[i],
    price: px,
    hits:  levels.filter(lv => Math.abs(lv.price - px) <= ZONE),
  }))
  if (!rows.some(r => r.hits.length > 0)) return null

  return (
    <div className="stp-friction">
      <div className="stp-friction-title">RESISTANCE FRICTION MAP</div>
      {rows.map((r, i) => (
        <div key={i} className={`stp-friction-row${r.hits.length ? ' stp-friction-warn' : ''}`}>
          <div className="stp-friction-left">
            <span className="stp-friction-lbl">{r.label}</span>
            <span className="stp-friction-px">${f2(r.price)}</span>
          </div>
          <div className="stp-friction-right">
            {r.hits.length > 0 ? (
              <>
                <span className="stp-friction-alert">
                  ⚠ {r.hits.map(lv => `${lv.label} $${f2(lv.price)}`).join(' · ')}
                </span>
                <span className="stp-friction-advice">Take partials here — don't hold through major levels</span>
              </>
            ) : (
              <span className="stp-friction-clear">✓ clear path</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── 6. Streak Calibration ──────────────────────────────────────────────────────
function StreakCalibration({ shares, tradeStreak, onLogResult, onClearStreak }) {
  const stats     = getStreakStats(tradeStreak)
  const adjShares = shares > 0 ? Math.round(shares * stats.sizeMult) : null
  const hasStreak = tradeStreak.length > 0
  const borderClr = stats.type === 'L' ? stats.color : '#065f46'
  const bg        = stats.type === 'L' ? (stats.streak >= 3 ? '#130305' : '#0f0900') : '#01120a'

  return (
    <div className="stp-streak" style={{ background: bg, borderColor: borderClr }}>
      <div className="stp-streak-head">
        <span className="stp-streak-title">STREAK CALIBRATION</span>
        <div className="stp-streak-pips">
          {tradeStreak.slice(-10).map((r, i) => (
            <span key={i} className="stp-streak-pip"
              style={{ background: r === 'W' ? '#10b981' : '#ef4444' }}
              title={r === 'W' ? 'Win' : 'Loss'} />
          ))}
        </div>
        <button className="stp-streak-clear-btn" onClick={onClearStreak} title="Clear streak">↺</button>
      </div>
      {hasStreak ? (
        <div className="stp-streak-body">
          <span className="stp-streak-run" style={{ color: stats.color }}>
            {stats.streak} consecutive {stats.type === 'W' ? 'win' : 'loss'}{stats.streak !== 1 ? 's' : ''}
          </span>
          {stats.sizeMult < 1 && adjShares != null && (
            <span className="stp-streak-adj">
              → Calibrated: <strong style={{ color: stats.color }}>{adjShares} shares</strong> ({(stats.sizeMult * 100).toFixed(0)}% of base)
            </span>
          )}
          {stats.msg && <div className="stp-streak-msg" style={{ color: stats.color }}>{stats.msg}</div>}
        </div>
      ) : (
        <div className="stp-streak-empty">No trades logged yet — log W/L after each trade to auto-calibrate your size.</div>
      )}
      <div className="stp-streak-log">
        <span className="stp-streak-log-lbl">Log result:</span>
        <button className="stp-streak-btn stp-streak-w" onClick={() => onLogResult('W')}>W WIN</button>
        <button className="stp-streak-btn stp-streak-l" onClick={() => onLogResult('L')}>L LOSS</button>
      </div>
    </div>
  )
}

// ── 7. Theta Urgency Clock ─────────────────────────────────────────────────────
function ThetaUrgencyClock({ rec }) {
  if (!rec?.premium || !rec?.dte) return null
  const premium = +rec.premium
  const dte     = +rec.dte
  if (premium <= 0 || dte <= 0) return null

  // Theta estimate: ~40% of premium decays over life of option, distributed by sqrt(T)
  // Per day (simplified): theta_day ≈ 0.5 * premium / dte
  const thetaDay    = +(premium * 0.5 / dte).toFixed(3)
  const thetaHour   = +(thetaDay / 6.5).toFixed(2)
  const theta5Min   = +(thetaDay / 78).toFixed(3)
  const urgency     = thetaHour > 0.50 ? 'HIGH' : thetaHour > 0.18 ? 'MODERATE' : 'LOW'
  const uc          = urgency === 'HIGH' ? '#ef4444' : urgency === 'MODERATE' ? '#f59e0b' : '#4a6888'
  const ubg         = urgency === 'HIGH' ? '#130305' : urgency === 'MODERATE' ? '#0f0900' : '#07111e'

  return (
    <div className="stp-theta" style={{ borderColor: uc, background: ubg }}>
      <div className="stp-theta-head" style={{ color: uc }}>⏱ THETA DRAIN — {urgency} URGENCY · DTE {dte}d</div>
      <div className="stp-theta-body">
        <div className="stp-theta-stat">
          <span className="stp-theta-lbl">Per 5-min bar</span>
          <span className="stp-theta-val" style={{ color: uc }}>~−${theta5Min}</span>
        </div>
        <div className="stp-theta-stat">
          <span className="stp-theta-lbl">Per hour</span>
          <span className="stp-theta-val" style={{ color: uc }}>~−${f2(thetaHour)}</span>
        </div>
        <div className="stp-theta-stat">
          <span className="stp-theta-lbl">Per day</span>
          <span className="stp-theta-val" style={{ color: uc }}>~−${f2(thetaDay)}</span>
        </div>
      </div>
      <div className="stp-theta-note">
        {urgency === 'HIGH'
          ? `This option loses ${f2(thetaHour)}/hour while the stock consolidates. If price doesn't break through entry within 15–20 minutes of the open, close the option — theta is destroying your edge.`
          : urgency === 'MODERATE'
          ? `Moderate decay. Set an entry window — if the breakout hasn't triggered within 45 minutes, close the option and re-evaluate.`
          : `Low theta pressure (${f2(thetaHour)}/hr). This option can wait for proper volume confirmation without significant cost.`}
      </div>
    </div>
  )
}

// ── 8. Free Trade Mode Panel ───────────────────────────────────────────────────
function FreeTradeModePanel({ t1Hit, onActivate, onReset, direction, entryPx, rec }) {
  const isCall = direction === 'CALL'
  const dc = isCall ? '#10b981' : '#ef4444'

  if (!t1Hit) {
    return (
      <div className="stp-ftm stp-ftm-dormant">
        <div className="stp-ftm-dormant-body">
          <span className="stp-ftm-dormant-lbl">FREE TRADE MODE</span>
          <span className="stp-ftm-dormant-sub">Activate after stock reaches T1 and you have moved your stop to breakeven</span>
        </div>
        <button className="stp-ftm-activate-btn" onClick={onActivate} style={{ borderColor: dc, color: dc }}>
          ✓ T1 HIT — Mark It
        </button>
      </div>
    )
  }

  return (
    <div className="stp-ftm stp-ftm-active" style={{ borderColor: '#10b981' }}>
      <div className="stp-ftm-banner">
        <div className="stp-ftm-banner-left">
          <div className="stp-ftm-active-title">FREE TRADE MODE — THIS TRADE CANNOT LOSE</div>
          <div className="stp-ftm-active-sub">
            Stop is at breakeven ${f2(entryPx)}. You are playing with the market's money.
          </div>
        </div>
        <button className="stp-ftm-reset-btn" onClick={onReset}>Reset</button>
      </div>
      <div className="stp-ftm-rules">
        <div className="stp-ftm-rule">
          <span className="stp-ftm-rule-num">1</span>
          <span>Stop holds at <strong>${f2(entryPx)}</strong>. Do not tighten it — let the trade breathe to T2.</span>
        </div>
        <div className="stp-ftm-rule">
          <span className="stp-ftm-rule-num">2</span>
          <span><strong>Option: let it run.</strong> Gamma accelerates in your favor past T1. You are no longer managing for protection — you are managing for maximum extraction.</span>
        </div>
        <div className="stp-ftm-rule">
          <span className="stp-ftm-rule-num">3</span>
          <span>Mindset shift: from <em>protect the trade</em> → <em>trail the trade</em>. Every stop move from here locks in more profit, never less.</span>
        </div>
        {rec?.premium != null && (
          <div className="stp-ftm-rule">
            <span className="stp-ftm-rule-num">4</span>
            <span>Option entry: ${f2(rec.premium)}. Take 50% off contracts when option hits +75% (≈ ${f2(+(+rec.premium * 1.75).toFixed(2))}). Let the rest run to T3/T4.</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function StockTradePlan({ currentPrice, direction, ticker, rec, orbRetest, swingTargets,
  volumeSpike, adxSignal, fibLevels, dailyBars, ivData, earningsDate }) {
  const [shareInput, setShareInput] = useState(() => {
    try { return localStorage.getItem(SHARE_KEY) ?? '100' } catch { return '100' }
  })
  const [dayPnl, setDayPnl]       = useState(() => loadDayPnl())
  const [quickAmt, setQuickAmt]   = useState('')
  const [tradeStreak, setTradeStreak] = useState(loadStreak)
  const [t1Hit, setT1Hit]         = useState(false)

  const shares     = Math.max(0, Math.round(parseFloat(shareInput) || 0))
  const dailyGoal  = shares * 1
  const dailyLimit = dailyGoal

  // Earnings proximity
  const earningsDays = earningsDate
    ? Math.round((new Date(earningsDate) - new Date()) / 86400000)
    : null

  function handleShareChange(v) {
    setShareInput(v)
    try { localStorage.setItem(SHARE_KEY, v) } catch {}
  }
  function addPnl(amt) {
    const next = +(dayPnl + amt).toFixed(2)
    setDayPnl(next); saveDayPnl(next); setQuickAmt('')
  }
  function resetDay() { setDayPnl(0); saveDayPnl(0) }
  function logStreak(result) {
    const next = [...tradeStreak, result]
    setTradeStreak(next); saveStreak(next)
  }
  function clearStreak() { setTradeStreak([]); saveStreak([]) }

  // ── OR-anchored entry, stop, and 5 targets ───────────────────────────────────
  const isCall    = direction === 'CALL'
  const orHigh    = orbRetest?.orHigh ?? null
  const orLow     = orbRetest?.orLow  ?? null
  const hasOR     = orHigh != null && orLow != null && currentPrice != null

  const fallback1 = currentPrice ? +(currentPrice * 0.01).toFixed(2) : 1

  // Entry: the level traders watch on the 5M chart to snipe the breakout/breakdown
  const entryPx    = hasOR
    ? +(isCall ? orHigh : orLow).toFixed(2)
    : (currentPrice ?? 0)
  const entryLabel = hasOR
    ? (isCall ? `5M entry above ORH $${(+orHigh).toFixed(2)}` : `5M entry below ORL $${(+orLow).toFixed(2)}`)
    : 'Entry (OR not yet set)'

  // Stop: opposite boundary of the 30-min Opening Range
  const stopPx    = hasOR
    ? +(isCall ? orLow : orHigh).toFixed(2)
    : (currentPrice ? +(isCall ? currentPrice - fallback1 : currentPrice + fallback1).toFixed(2) : 0)
  const stopLabel = hasOR ? (isCall ? '30M ORL' : '30M ORH') : '1% fallback'

  // Risk per share = ORH − ORL (the full opening range)
  const riskPx = +Math.abs(entryPx - stopPx).toFixed(2)

  // 5 targets: 15M swing peaks/troughs above/below the OR (pre-computed in App.jsx)
  const step = riskPx > 0 ? riskPx : fallback1
  const buildTargets = (raw) => {
    const result = [...(raw ?? [])]
    while (result.length < 5) {
      const last = result.length > 0 ? result[result.length - 1] : entryPx
      result.push(+(isCall ? last + step : last - step).toFixed(2))
    }
    return result.slice(0, 5)
  }
  const targetPrices = buildTargets(swingTargets?.length ? swingTargets : [])

  return (
    <div className="stp-root">

      {/* 1. Time Window Band */}
      <TimeWindowBand />

      {/* 2. Volume Confirm Gate */}
      <VolumeConfirmGate volumeSpike={volumeSpike} />

      {/* Header */}
      <div className="stp-header">
        <span className="stp-header-title">STOCK TRADE PLAN</span>
        <span className="stp-header-sub">
          {hasOR
            ? `30M OR: $${(+orLow).toFixed(2)} — $${(+orHigh).toFixed(2)} · 15M structure · 5M execution`
            : 'Stocks and options move together — trade both sides of every setup'}
        </span>
      </div>

      {/* OR status banner */}
      {hasOR && (
        <div className="stp-or-banner" style={{
          background: isCall ? '#021208' : '#120202',
          border: `1px solid ${isCall ? '#065f46' : '#7f1d1d'}`,
          borderRadius: 8, padding: '8px 14px', marginBottom: 10,
          display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ color: '#4a6888', fontSize: 11, fontWeight: 700, letterSpacing: '0.8px' }}>30M OPENING RANGE</span>
          <span style={{ color: '#10b981', fontWeight: 700 }}>ORH ${(+orHigh).toFixed(2)}</span>
          <span style={{ color: '#ef4444', fontWeight: 700 }}>ORL ${(+orLow).toFixed(2)}</span>
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>Range ${(+(orHigh - orLow)).toFixed(2)}</span>
          <span style={{ color: isCall ? '#10b981' : '#ef4444', fontWeight: 800, marginLeft: 'auto' }}>
            {isCall ? '▲ BREAK ABOVE ORH — TARGET RESISTANCES' : '▼ BREAK BELOW ORL — TARGET SUPPORTS'}
          </span>
        </div>
      )}

      {/* 3. Breakout Quality Grade */}
      <BreakoutQualityGrade
        volumeSpike={volumeSpike}
        adxSignal={adxSignal}
        earningsDays={earningsDays}
        shares={shares}
      />

      {/* Share size + daily plan setup */}
      <div className="stp-setup-row">
        <label className="stp-setup-label">
          Share size
          <input
            className="stp-share-input"
            type="number"
            min="1"
            step="100"
            value={shareInput}
            onChange={e => handleShareChange(e.target.value)}
          />
        </label>
        <div className="stp-daily-summary">
          <span className="stp-daily-goal-lbl">Daily goal:</span>
          <span className="stp-daily-goal-val">${f0(dailyGoal)}</span>
          <span className="stp-daily-sep">·</span>
          <span className="stp-daily-goal-lbl">Loss limit:</span>
          <span className="stp-daily-goal-val" style={{ color: '#ef4444' }}>−${f0(dailyLimit)}</span>
          <span className="stp-daily-sep">·</span>
          <span className="stp-daily-note">$1/share/day</span>
        </div>
      </div>

      {/* 6. Streak Calibration */}
      <StreakCalibration
        shares={shares}
        tradeStreak={tradeStreak}
        onLogResult={logStreak}
        onClearStreak={clearStreak}
      />

      {/* Machine status */}
      <MachineStatus
        dayPnl={dayPnl}
        dailyGoal={dailyGoal}
        dailyLimit={dailyLimit}
        direction={direction}
        ticker={ticker}
      />

      {/* Quick P&L logger */}
      <div className="stp-pnl-row">
        <span className="stp-pnl-lbl">Log trade result:</span>
        <input
          className="stp-pnl-input"
          type="number"
          placeholder="±amount"
          value={quickAmt}
          onChange={e => setQuickAmt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && quickAmt) addPnl(+quickAmt) }}
        />
        <button className="stp-pnl-btn stp-pnl-win"  onClick={() => { if (quickAmt) addPnl( Math.abs(+quickAmt)) }} disabled={!quickAmt}>+ WIN</button>
        <button className="stp-pnl-btn stp-pnl-loss" onClick={() => { if (quickAmt) addPnl(-Math.abs(+quickAmt)) }} disabled={!quickAmt}>− LOSS</button>
        <button className="stp-pnl-reset" onClick={resetDay}>Reset day</button>
      </div>

      {/* 7. Theta Urgency Clock */}
      <ThetaUrgencyClock rec={rec} />

      {/* Trade calculator */}
      <TradeCalc
        entryPx={entryPx} stopPx={stopPx} riskPx={riskPx}
        targetPrices={targetPrices} stopLabel={stopLabel} entryLabel={entryLabel}
        hasOR={hasOR} direction={direction} shares={shares}
        currentPrice={currentPrice}
      />

      {/* 4. Option Level Reverse Matrix */}
      <OptionReverseMatrix rec={rec} entryPx={entryPx} direction={direction} />

      {/* 5. Resistance Friction Map */}
      <ResistanceFrictionMap
        targetPrices={targetPrices}
        fibLevels={fibLevels}
        dailyBars={dailyBars}
        direction={direction}
      />

      {/* 8. Free Trade Mode Panel */}
      <FreeTradeModePanel
        t1Hit={t1Hit}
        onActivate={() => setT1Hit(true)}
        onReset={() => setT1Hit(false)}
        direction={direction}
        entryPx={entryPx}
        rec={rec}
      />

      {/* Scaling rules */}
      <ScalingRules
        entryPx={entryPx} stopPx={stopPx} riskPx={riskPx}
        targetPrices={targetPrices} stopLabel={stopLabel}
        direction={direction} shares={shares}
      />

      {/* Stock + Option coordination */}
      <CoordinationPanel
        entryPx={entryPx} stopPx={stopPx} riskPx={riskPx}
        targetPrices={targetPrices}
        direction={direction} shares={shares} rec={rec}
      />

      {/* 5 retail mistakes */}
      <RetailMistakes />

    </div>
  )
}
