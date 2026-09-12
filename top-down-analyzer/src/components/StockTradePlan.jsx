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

// ── Main export ────────────────────────────────────────────────────────────────
export default function StockTradePlan({ currentPrice, direction, ticker, rec, orbRetest, swingTargets }) {
  const [shareInput, setShareInput] = useState(() => {
    try { return localStorage.getItem(SHARE_KEY) ?? '100' } catch { return '100' }
  })
  const [dayPnl, setDayPnl] = useState(() => loadDayPnl())
  const [quickAmt, setQuickAmt] = useState('')

  const shares     = Math.max(0, Math.round(parseFloat(shareInput) || 0))
  const dailyGoal  = shares * 1
  const dailyLimit = dailyGoal

  function handleShareChange(v) {
    setShareInput(v)
    try { localStorage.setItem(SHARE_KEY, v) } catch {}
  }

  function addPnl(amt) {
    const next = +(dayPnl + amt).toFixed(2)
    setDayPnl(next)
    saveDayPnl(next)
    setQuickAmt('')
  }

  function resetDay() {
    setDayPnl(0)
    saveDayPnl(0)
  }

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

      {/* ── Header ── */}
      <div className="stp-header">
        <span className="stp-header-title">STOCK TRADE PLAN</span>
        <span className="stp-header-sub">
          {hasOR
            ? `30M OR: $${(+orLow).toFixed(2)} — $${(+orHigh).toFixed(2)} · 15M structure · 5M execution`
            : 'Stocks and options move together — trade both sides of every setup'}
        </span>
      </div>

      {/* ── OR status banner ── */}
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

      {/* ── Share size + daily plan setup ── */}
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

      {/* ── Machine status ── */}
      <MachineStatus
        dayPnl={dayPnl}
        dailyGoal={dailyGoal}
        dailyLimit={dailyLimit}
        direction={direction}
        ticker={ticker}
      />

      {/* ── Quick P&L logger ── */}
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
        <button className="stp-pnl-btn stp-pnl-win" onClick={() => { if (quickAmt) addPnl(Math.abs(+quickAmt)) }} disabled={!quickAmt}>+ WIN</button>
        <button className="stp-pnl-btn stp-pnl-loss" onClick={() => { if (quickAmt) addPnl(-Math.abs(+quickAmt)) }} disabled={!quickAmt}>− LOSS</button>
        <button className="stp-pnl-reset" onClick={resetDay}>Reset day</button>
      </div>

      {/* ── Trade calculator ── */}
      <TradeCalc
        entryPx={entryPx} stopPx={stopPx} riskPx={riskPx}
        targetPrices={targetPrices} stopLabel={stopLabel} entryLabel={entryLabel}
        hasOR={hasOR} direction={direction} shares={shares}
        currentPrice={currentPrice}
      />

      {/* ── Scaling rules ── */}
      <ScalingRules
        entryPx={entryPx} stopPx={stopPx} riskPx={riskPx}
        targetPrices={targetPrices} stopLabel={stopLabel}
        direction={direction} shares={shares}
      />

      {/* ── Stock + Option coordination ── */}
      <CoordinationPanel
        entryPx={entryPx} stopPx={stopPx} riskPx={riskPx}
        targetPrices={targetPrices}
        direction={direction} shares={shares} rec={rec}
      />

      {/* ── 5 retail mistakes ── */}
      <RetailMistakes />

    </div>
  )
}
