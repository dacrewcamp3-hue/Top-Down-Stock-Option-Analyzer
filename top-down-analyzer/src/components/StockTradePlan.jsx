import { useState, useMemo } from 'react'
import './StockTradePlan.css'

const f2  = v => v != null ? (+v).toFixed(2) : '—'
const f0  = v => v != null ? Math.round(+v).toLocaleString() : '—'
const pct = (v, ref) => ref ? ((v - ref) / ref * 100).toFixed(2) : null

const SHARE_KEY    = 'tdsa_share_size'
const DAY_PNL_KEY  = 'tdsa_day_pnl'
const DAY_DATE_KEY = 'tdsa_day_date'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

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

// ── Machine status ────────────────────────────────────────────────────────────
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

// ── Trade calculator ──────────────────────────────────────────────────────────
function TradeCalc({ currentPrice, direction, shares }) {
  if (!currentPrice || !direction || direction === 'NO TRADE' || shares <= 0) return null
  const isCall = direction === 'CALL'

  const s      = +(currentPrice * 0.01).toFixed(2)   // 1R = 1% of stock price
  const stopPx = +(isCall ? currentPrice - s : currentPrice + s).toFixed(2)
  const t1Px   = +(isCall ? currentPrice + s     : currentPrice - s).toFixed(2)   // +1%
  const t2Px   = +(isCall ? currentPrice + s * 2 : currentPrice - s * 2).toFixed(2)  // +2%
  const t3Px   = +(isCall ? currentPrice + s * 3 : currentPrice - s * 3).toFixed(2)  // +3%
  const t4Px   = +(isCall ? currentPrice + s * 4 : currentPrice - s * 4).toFixed(2)  // +4%
  const t5Px   = +(isCall ? currentPrice + s * 6 : currentPrice - s * 6).toFixed(2)  // +6% runner

  const sh20   = Math.round(shares * 0.20)   // 20% at each target
  const maxRisk = shares * s

  // Cumulative locked profit at each target
  const t1P = sh20 * s                    // 20% at +1%
  const t2P = t1P + sh20 * s * 2         // + 20% at +2%
  const t3P = t2P + sh20 * s * 3         // + 20% at +3%
  const t4P = t3P + sh20 * s * 4         // + 20% at +4%
  const t5T = t4P + sh20 * s * 6         // + 20% runner at +6%

  const rr = n => maxRisk > 0 ? (n / maxRisk).toFixed(1) : null
  const rr1 = rr(t1P); const rr2 = rr(t2P); const rr3 = rr(t3P)
  const rr4 = rr(t4P); const rr5 = rr(t5T)

  const dirColor = isCall ? '#10b981' : '#ef4444'
  const dirBg    = isCall ? '#011208' : '#120202'
  const dirBord  = isCall ? '#065f46' : '#7f1d1d'

  return (
    <div className="stp-calc" style={{ borderColor: dirBord, background: dirBg }}>

      {/* ── Header ── */}
      <div className="stp-calc-header">
        <span className="stp-calc-title">TRADE CALCULATOR</span>
        <span className="stp-calc-entry" style={{ color: '#4a6888' }}>
          Entry ${f2(currentPrice)} · {shares.toLocaleString()} sh · ${f0(currentPrice * shares)} total
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
          <div className="stp-col-pct" style={{ color: '#ef4444' }}>−1% (−${f2(s)}/sh)</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Exit ALL</div>
          <div className="stp-col-pnl" style={{ color: '#ef4444' }}>−${f0(maxRisk)}</div>
        </div>

        {/* T1 */}
        <div className="stp-col stp-col-t1" style={{ borderColor: `${dirColor}30` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T1</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t1Px)}</div>
          <div className="stp-col-pct" style={{ color: dirColor }}>+1%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ stop to ${f2(currentPrice)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t1P)}</div>
          {rr1 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr1}:1</div>}
        </div>

        {/* T2 */}
        <div className="stp-col stp-col-t2" style={{ borderColor: `${dirColor}28` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T2</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t2Px)}</div>
          <div className="stp-col-pct" style={{ color: dirColor }}>+2%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ trail to ${f2(t1Px)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t2P)}</div>
          {rr2 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr2}:1</div>}
        </div>

        {/* T3 */}
        <div className="stp-col stp-col-t3" style={{ borderColor: `${dirColor}20` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T3</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t3Px)}</div>
          <div className="stp-col-pct" style={{ color: dirColor }}>+3%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ trail to ${f2(t2Px)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t3P)}</div>
          {rr3 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr3}:1</div>}
        </div>

        {/* T4 */}
        <div className="stp-col stp-col-t4" style={{ borderColor: `${dirColor}18` }}>
          <div className="stp-col-hdr" style={{ color: dirColor }}>T4</div>
          <div className="stp-col-price" style={{ color: dirColor }}>${f2(t4Px)}</div>
          <div className="stp-col-pct" style={{ color: dirColor }}>+4%</div>
          <div className="stp-col-sep" />
          <div className="stp-col-action">Sell 20%<br /><span className="stp-col-subnote">→ trail to ${f2(t3Px)}</span></div>
          <div className="stp-col-pnl" style={{ color: dirColor }}>+${f0(t4P)}</div>
          {rr4 && <div className="stp-col-rr" style={{ color: dirColor }}>{rr4}:1</div>}
        </div>

      </div>

      {/* ── Runner note ── */}
      <div className="stp-trail-row">
        <span className="stp-trail-label">RUNNER (20%)</span>
        <span className="stp-trail-body">
          Remaining {sh20} shares trail with a moving stop — raise it as price extends.
          At {isCall ? '+' : '−'}6% (${f2(t5Px)}) your cumulative gain hits +${f0(t5T)} ({rr5}:1 R:R).
        </span>
      </div>

      {/* ── R:R summary bar ── */}
      <div className="stp-rr-row">
        <div className="stp-rr-item">
          <span className="stp-rr-lbl">MAX RISK</span>
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
          <span className="stp-rr-lbl">RUNNER</span>
          <span className="stp-rr-val" style={{ color: dirColor }}>+${f0(t5T)}</span>
          {rr5 && <span className="stp-rr-ratio" style={{ color: dirColor }}>{rr5}:1</span>}
        </div>
      </div>
    </div>
  )
}

// ── Scaling rules ─────────────────────────────────────────────────────────────
function ScalingRules({ currentPrice, direction, shares }) {
  if (!currentPrice || !direction || direction === 'NO TRADE' || shares <= 0) return null
  const isCall = direction === 'CALL'
  const s      = +(currentPrice * 0.01).toFixed(2)
  const stopPx = +(isCall ? currentPrice - s : currentPrice + s).toFixed(2)
  const t1Px   = +(isCall ? currentPrice + s     : currentPrice - s).toFixed(2)
  const t2Px   = +(isCall ? currentPrice + s * 2 : currentPrice - s * 2).toFixed(2)
  const t3Px   = +(isCall ? currentPrice + s * 3 : currentPrice - s * 3).toFixed(2)
  const t4Px   = +(isCall ? currentPrice + s * 4 : currentPrice - s * 4).toFixed(2)
  const sh20   = Math.round(shares * 0.20)

  const rules = [
    {
      num: 1, color: '#3b82f6',
      action: `Stop set at $${f2(stopPx)} — DO NOT MOVE IT DOWN`,
      detail: `Place a hard stop order at $${f2(stopPx)} before the trade is live. 1% below entry. If it hits, exit all ${shares.toLocaleString()} shares immediately — no second-guessing.`,
    },
    {
      num: 2, color: '#f59e0b',
      action: `T1 — $${f2(t1Px)}: sell ${sh20} shares (20%), move stop to $${f2(currentPrice)}`,
      detail: `Price reached +1%. Sell 20% and bank $${f0(sh20 * s)}. Move your stop from $${f2(stopPx)} to $${f2(currentPrice)} (breakeven). You can no longer lose on this trade.`,
    },
    {
      num: 3, color: '#f59e0b',
      action: `T2 — $${f2(t2Px)}: sell ${sh20} shares (20%), trail stop to $${f2(t1Px)}`,
      detail: `Price reached +2%. Sell another 20%. Trail your stop up to $${f2(t1Px)}. You are now risk-free — the worst case is you lock in T1 profit on the remainder.`,
    },
    {
      num: 4, color: '#10b981',
      action: `T3 — $${f2(t3Px)}: sell ${sh20} shares (20%), trail stop to $${f2(t2Px)}`,
      detail: `Price reached +3%. Sell another 20%. Move the trail stop up to $${f2(t2Px)}. You have now sold 60% of your position with compounding locked profits.`,
    },
    {
      num: 5, color: '#10b981',
      action: `T4 — $${f2(t4Px)}: sell ${sh20} shares (20%), trail stop to $${f2(t3Px)}`,
      detail: `Price reached +4%. Sell another 20%. Trail stop moves to $${f2(t3Px)}. Only the runner (final 20%) remains — it cannot give back more than one stop increment of profit.`,
    },
    {
      num: 6, color: '#10b981',
      action: `RUNNER — final ${sh20} shares: trail with a moving stop, no fixed target`,
      detail: `Let the final shares run as far as the move extends. Use a trailing stop that moves up automatically. There is no fixed exit — you ride until the market takes you out. The only rule: never let this runner give back more than T3 profit level.`,
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

// ── Stock + Option Coordination ───────────────────────────────────────────────
// Shows exactly what each stock price level means for the option position.
// The two exit systems use different percentages — this panel unifies them
// so one set of stock price levels governs both positions simultaneously.
function CoordinationPanel({ currentPrice, direction, shares, rec }) {
  if (!currentPrice || !direction || direction === 'NO TRADE') return null
  const isCall = direction === 'CALL'

  // Use live contract data when available; fall back to 0.45 delta / $2.00 premium
  const delta    = rec?.delta   != null ? Math.abs(rec.delta)   : 0.45
  const premium  = rec?.premium != null ? rec.premium           : null
  const hasLive  = rec != null && rec.premium != null

  const stopDist = +(currentPrice * 0.01).toFixed(2)
  const stopPx   = +(isCall ? currentPrice - stopDist : currentPrice + stopDist).toFixed(2)
  const t1Px     = +(isCall ? currentPrice + stopDist     : currentPrice - stopDist).toFixed(2)
  const t2Px     = +(isCall ? currentPrice + stopDist * 2 : currentPrice - stopDist * 2).toFixed(2)
  const t3Px     = +(isCall ? currentPrice + stopDist * 3 : currentPrice - stopDist * 3).toFixed(2)
  const t4Px     = +(isCall ? currentPrice + stopDist * 4 : currentPrice - stopDist * 4).toFixed(2)
  const t5Px     = +(isCall ? currentPrice + stopDist * 6 : currentPrice - stopDist * 6).toFixed(2)

  // Option premium change at each stock level using delta approximation
  const optChangePx = move => +(move * delta).toFixed(2)
  const optPctStr   = (move, label) => {
    const dollarChg = optChangePx(move)
    if (premium) {
      const pctChg = (dollarChg / premium * 100).toFixed(0)
      return { dollar: dollarChg, pct: pctChg, label }
    }
    return { dollar: dollarChg, pct: null, label }
  }

  // Stock price at which option loses 25% of premium
  const optStop25DistApprox = premium ? +(premium * 0.25 / delta).toFixed(2) : null
  const optStop25Px = optStop25DistApprox
    ? +(isCall ? currentPrice - optStop25DistApprox : currentPrice + optStop25DistApprox).toFixed(2)
    : null

  const stopChg = optPctStr(-stopDist, 'STOP')
  const t1Chg   = optPctStr(+stopDist, 'T1')
  const t2Chg   = optPctStr(+stopDist * 2, 'T2')
  const t3Chg   = optPctStr(+stopDist * 3, 'T3')
  const t4Chg   = optPctStr(+stopDist * 4, 'T4')
  const t5Chg   = optPctStr(+stopDist * 6, 'RUNNER')

  const rows = [
    {
      label:       'STOP',
      stockPx:     stopPx,
      move:        `−1%  (−$${f2(stopDist)})`,
      moveColor:   '#ef4444',
      stockAction: 'EXIT all shares immediately',
      optPct:      stopChg.pct ? `≈ −${Math.abs(+stopChg.pct)}%` : `≈ −$${f2(Math.abs(stopChg.dollar))}/sh`,
      optAction:   'EXIT all contracts — thesis wrong',
      optColor:    '#ef4444',
      rule:        'Stock stop and option stop fire TOGETHER. Do not wait for the option to hit −25% separately.',
    },
    {
      label:       'T1',
      stockPx:     t1Px,
      move:        `+1%  (+$${f2(stopDist)})`,
      moveColor:   '#10b981',
      stockAction: 'Sell 20% of shares — stop → breakeven',
      optPct:      t1Chg.pct ? `≈ +${t1Chg.pct}%` : `≈ +$${f2(t1Chg.dollar)}/sh`,
      optAction:   'HOLD all contracts — just warming up',
      optColor:    '#f59e0b',
      rule:        `Option has only moved ~${t1Chg.pct ? Math.abs(+t1Chg.pct) + '%' : 'slightly'} at T1. The stock is at breakeven — let the option run. Do not exit early.`,
    },
    {
      label:       'T2',
      stockPx:     t2Px,
      move:        `+2%  (+$${f2(stopDist * 2)})`,
      moveColor:   '#10b981',
      stockAction: 'Sell 20% — trail stop to T1',
      optPct:      t2Chg.pct ? `≈ +${t2Chg.pct}%` : `≈ +$${f2(t2Chg.dollar)}/sh`,
      optAction:   `Sell 25% of contracts — lock in early partial`,
      optColor:    '#10b981',
      rule:        `Option is up ~${t2Chg.pct ? Math.abs(+t2Chg.pct) + '%' : 'meaningfully'}. Take 25% off the option position to lock real dollars. Keep the rest running with the stock.`,
    },
    {
      label:       'T3',
      stockPx:     t3Px,
      move:        `+3%  (+$${f2(stopDist * 3)})`,
      moveColor:   '#10b981',
      stockAction: 'Sell 20% — trail stop to T2',
      optPct:      t3Chg.pct ? `≈ +${t3Chg.pct}%` : `≈ +$${f2(t3Chg.dollar)}/sh`,
      optAction:   `Sell 25% more contracts — option near +50% TP zone`,
      optColor:    '#10b981',
      rule:        `Option at ~${t3Chg.pct ? Math.abs(+t3Chg.pct) + '%' : 'strong gains'} — nearing the +50% target. Sell another 25%. Half your option position is now booked.`,
    },
    {
      label:       'T4',
      stockPx:     t4Px,
      move:        `+4%  (+$${f2(stopDist * 4)})`,
      moveColor:   '#10b981',
      stockAction: 'Sell 20% — trail stop to T3',
      optPct:      t4Chg.pct ? `≈ +${t4Chg.pct}%` : `≈ +$${f2(t4Chg.dollar)}/sh`,
      optAction:   'Sell 25% more contracts — book the bulk',
      optColor:    '#10b981',
      rule:        `Option up ~${t4Chg.pct ? Math.abs(+t4Chg.pct) + '%' : 'significantly'}. Sell another 25%. You now have 75% of option profits locked. One runner contract remains.`,
    },
    {
      label:       'RUNNER',
      stockPx:     t5Px,
      move:        `+6%  (+$${f2(stopDist * 6)})`,
      moveColor:   '#10b981',
      stockAction: 'Trail final 20% with moving stop',
      optPct:      t5Chg.pct ? `≈ +${t5Chg.pct}%` : `≈ +$${f2(t5Chg.dollar)}/sh`,
      optAction:   'EXIT all remaining contracts — full option profit taken',
      optColor:    '#10b981',
      rule:        `At +6% the option has likely returned ${t5Chg.pct ? Math.abs(+t5Chg.pct) + '%+' : 'maximum gains'}. Close the entire option position. Let the stock runner capture anything beyond with zero option risk.`,
    },
  ]

  return (
    <div className="stp-coord">
      <div className="stp-coord-header">
        <span className="stp-coord-title">STOCK + OPTION COORDINATION</span>
        <span className="stp-coord-sub">One set of price levels governs both positions</span>
      </div>

      {/* Why percentages differ */}
      <div className="stp-coord-explainer">
        <div className="stp-coord-exp-row">
          <span className="stp-coord-exp-lbl">Stock stop</span>
          <span className="stp-coord-exp-val">−1% of stock price (${f2(stopDist)} on a ${f2(currentPrice)} stock)</span>
          <span className="stp-coord-exp-note">structure-based, exact</span>
        </div>
        <div className="stp-coord-exp-row">
          <span className="stp-coord-exp-lbl">Option stop</span>
          <span className="stp-coord-exp-val">
            −25% of premium
            {optStop25Px && ` ≈ stock at $${f2(optStop25Px)} (−${f2(optStop25DistApprox)})`}
            {!hasLive && ' (estimated at 0.45Δ)'}
          </span>
          <span className="stp-coord-exp-note">premium-based, looser</span>
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

      {/* Coordination table */}
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

// ── 5 retail mistakes ─────────────────────────────────────────────────────────
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

// ── Main export ───────────────────────────────────────────────────────────────
export default function StockTradePlan({ currentPrice, direction, ticker, rec }) {
  const [shareInput, setShareInput] = useState(() => {
    try { return localStorage.getItem(SHARE_KEY) ?? '100' } catch { return '100' }
  })
  const [dayPnl, setDayPnl] = useState(() => loadDayPnl())
  const [quickAmt, setQuickAmt] = useState('')

  const shares     = Math.max(0, Math.round(parseFloat(shareInput) || 0))
  const dailyGoal  = shares * 1    // $1/share per day target
  const dailyLimit = dailyGoal     // symmetric loss limit

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

  return (
    <div className="stp-root">

      {/* ── Header ── */}
      <div className="stp-header">
        <span className="stp-header-title">STOCK TRADE PLAN</span>
        <span className="stp-header-sub">Stocks and options move together — trade both sides of every setup</span>
      </div>

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
      <TradeCalc currentPrice={currentPrice} direction={direction} shares={shares} />

      {/* ── Scaling rules ── */}
      <ScalingRules currentPrice={currentPrice} direction={direction} shares={shares} />

      {/* ── Stock + Option coordination ── */}
      <CoordinationPanel currentPrice={currentPrice} direction={direction} shares={shares} rec={rec} />

      {/* ── 5 retail mistakes ── */}
      <RetailMistakes />

    </div>
  )
}
