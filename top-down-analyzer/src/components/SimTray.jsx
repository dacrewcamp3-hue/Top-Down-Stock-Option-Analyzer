import { useState } from 'react'
import { bsPrice } from '../utils/fetchOptions'
import './SimTray.css'

const f2 = v => (v != null && !isNaN(v)) ? (+v).toFixed(2) : '—'

function daysUntil(expDateStr) {
  if (!expDateStr) return 0
  return Math.max(0, Math.ceil((new Date(expDateStr) - new Date()) / 86400000))
}

function reprice(trade, stockPrice, sigma) {
  const dte = daysUntil(trade.expDate)
  if (dte <= 0) return 0
  return bsPrice(stockPrice, trade.strike, dte / 365, sigma ?? trade.sigma, trade.isCall)
}

function pnl(entryPremium, exitPremium, contracts) {
  if (exitPremium == null) return null
  return (exitPremium - entryPremium) * 100 * contracts
}

// ── Summary strip ─────────────────────────────────────────────────────────────
function SummaryStrip({ trades, currentPrice, currentSigma, loadedTicker }) {
  const closed = trades.filter(t => t.status === 'closed')
  const open   = trades.filter(t => t.status === 'open')

  const closedPnls = closed.map(t => pnl(t.entryPremium, t.exitPremium, t.contracts))
  const totalClosed = closedPnls.reduce((a, b) => a + (b ?? 0), 0)

  const livePnls = open
    .filter(t => t.ticker === loadedTicker && currentPrice)
    .map(t => pnl(t.entryPremium, reprice(t, currentPrice, currentSigma), t.contracts))

  const totalLive = livePnls.reduce((a, b) => a + (b ?? 0), 0)
  const total = totalClosed + totalLive

  const wins = closedPnls.filter(p => p != null && p > 0).length
  const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : null

  const totalColor = total >= 0 ? '#10b981' : '#ef4444'

  return (
    <div className="sim-summary">
      <div className="sim-stat" data-tip="Total P&L — combined realized gains/losses from all closed trades, plus live mark-to-market on open positions for the currently loaded ticker.">
        <span className="sim-stat-lbl">Total P&amp;L</span>
        <span className="sim-stat-val" style={{ color: trades.length ? totalColor : '#3a5070' }}>
          {trades.length ? `${total >= 0 ? '+' : ''}$${Math.abs(total).toFixed(0)}` : '—'}
        </span>
      </div>
      <div className="sim-stat-div" />
      <div className="sim-stat" data-tip="Win Rate — percentage of closed sim trades that ended profitable. A healthy options win rate is 50–65%+ when combined with good reward-to-risk ratios.">
        <span className="sim-stat-lbl">Win Rate</span>
        <span className="sim-stat-val" style={{ color: winRate != null ? (winRate >= 50 ? '#10b981' : '#ef4444') : '#3a5070' }}>
          {winRate != null ? `${winRate}%` : '—'}
        </span>
      </div>
      <div className="sim-stat-div" />
      <div className="sim-stat" data-tip="Open positions — number of sim trades you currently have active. Each position is tracked against the exit plan stages.">
        <span className="sim-stat-lbl">Open</span>
        <span className="sim-stat-val">{open.length}</span>
      </div>
      <div className="sim-stat-div" />
      <div className="sim-stat" data-tip="Closed trades — number of sim trades you've exited. Review your results in the performance tab to identify patterns in your decision-making.">
        <span className="sim-stat-lbl">Closed</span>
        <span className="sim-stat-val">{closed.length}</span>
      </div>
    </div>
  )
}

// ── Position card ─────────────────────────────────────────────────────────────
function PositionCard({ trade, currentPrice, currentSigma, loadedTicker, onClose, onScaleIn }) {
  const [adding, setAdding]         = useState(false)
  const [addQty, setAddQty]         = useState('')
  const [addPrem, setAddPrem]       = useState('')
  const isLive     = trade.status === 'open' && trade.ticker === loadedTicker && currentPrice
  const nowPremium = isLive ? reprice(trade, currentPrice, currentSigma) : null
  const tradePnl   = trade.status === 'closed'
    ? pnl(trade.entryPremium, trade.exitPremium, trade.contracts)
    : (nowPremium != null ? pnl(trade.entryPremium, nowPremium, trade.contracts) : null)

  // Threshold detection for open live positions
  const pctPnl       = (isLive && nowPremium != null) ? (nowPremium - trade.entryPremium) / trade.entryPremium : null
  const stopHit      = pctPnl != null && pctPnl <= -0.40
  const breakevenHit = pctPnl != null && pctPnl >= 0.50 && pctPnl < 1.00
  const houseHit     = pctPnl != null && pctPnl >= 1.00
  const trailStop    = (houseHit && nowPremium != null) ? +(nowPremium * 0.75).toFixed(2) : null
  const autoStop     = trade.closeReason === 'stop-40pct'

  // Exit plan step tracker
  const closedPct    = (trade.status === 'closed' && trade.exitPremium != null)
    ? (trade.exitPremium - trade.entryPremium) / trade.entryPremium : null
  const stepReached  = trade.closeReason === 'stop-40pct' ? 0
    : pctPnl    != null ? (pctPnl    >= 1.00 ? 4 : pctPnl    >= 0.50 ? 2 : 1)
    : closedPct != null ? (closedPct >= 1.00 ? 4 : closedPct >= 0.50 ? 2 : 1)
    : 1
  const stepDotClr   = stepReached === 0 ? '#ef4444' : stepReached >= 4 ? '#10b981' : stepReached >= 2 ? '#38bdf8' : '#4a6380'
  const stepLabel    = stepReached === 0 ? 'Stopped out'
    : stepReached >= 4 ? 'Step 4/4 — Trailing'
    : stepReached >= 2 ? 'Step 2/4 — Breakeven locked'
    : 'Step 1/4 — Watching stop'

  // Scale-in state
  const hasLegs     = trade.legs && trade.legs.length > 1
  const t2Remaining = trade.plannedContracts != null ? trade.plannedContracts - trade.contracts : 0
  const canScaleIn  = trade.status === 'open' && !stopHit

  const handleOpenAdd = () => {
    setAddQty(t2Remaining > 0 ? String(t2Remaining) : '1')
    setAddPrem(nowPremium != null ? f2(nowPremium) : '')
    setAdding(true)
  }
  const handleConfirmAdd = () => {
    const qty  = parseInt(addQty)
    const prem = parseFloat(addPrem)
    if (!qty || qty < 1 || !prem || prem <= 0) return
    onScaleIn?.(trade.id, qty, prem)
    setAdding(false)
  }

  const typeClr  = trade.isCall ? '#10b981' : '#ef4444'
  const typeBg   = stopHit ? '#1a0000' : trade.isCall ? '#001a0d' : '#1a0000'
  const typeBord = stopHit ? '#7f1010' : houseHit ? '#b45309' : trade.isCall ? '#064e2e' : '#6b0000'
  const pnlColor = tradePnl == null ? '#6b8099' : tradePnl >= 0 ? '#10b981' : '#ef4444'

  const fmtDate = iso => iso
    ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="sim-card" style={{ background: typeBg, borderColor: typeBord }}>

      {/* ── Stop hit alert ── */}
      {stopHit && (
        <div className="sim-alert sim-alert-stop">
          <span className="sim-alert-icon">⛔</span>
          <div className="sim-alert-body">
            <span className="sim-alert-title">STOP LOSS HIT — CLOSE NOW</span>
            <span className="sim-alert-detail">
              Premium down {(pctPnl * 100).toFixed(0)}% from entry (${f2(trade.entryPremium)} → ~${f2(nowPremium)}).
              Rule: cut all contracts at −40%. Every dollar past this point is a rule violation.
            </span>
          </div>
        </div>
      )}

      {/* ── Breakeven alert ── */}
      {breakevenHit && !stopHit && (
        <div className="sim-alert sim-alert-breakeven">
          <span className="sim-alert-icon">🔒</span>
          <div className="sim-alert-body">
            <span className="sim-alert-title">MOVE STOP TO BREAKEVEN</span>
            <span className="sim-alert-detail">
              Premium up {(pctPnl * 100).toFixed(0)}% — raise your stop to ${f2(trade.entryPremium)} (entry price).
              All contracts still working. You cannot lose now.
            </span>
          </div>
        </div>
      )}

      {/* ── House money alert ── */}
      {houseHit && !stopHit && (
        <div className="sim-alert sim-alert-house">
          <span className="sim-alert-icon">🏦</span>
          <div className="sim-alert-body">
            <span className="sim-alert-title">HOUSE MONEY — SELL {Math.ceil(trade.contracts / 2)} CONTRACT{Math.ceil(trade.contracts / 2) !== 1 ? 'S' : ''} NOW</span>
            <span className="sim-alert-detail">
              Premium up {(pctPnl * 100).toFixed(0)}%. Sell {Math.ceil(trade.contracts / 2)} of {trade.contracts} contracts
              to recover your full cost. Trail remaining {trade.contracts - Math.ceil(trade.contracts / 2)} free contract{trade.contracts - Math.ceil(trade.contracts / 2) !== 1 ? 's' : ''} at 25% below running high.
            </span>
          </div>
        </div>
      )}

      {/* ── Auto-stop badge ── */}
      {autoStop && (
        <div className="sim-alert sim-alert-autoclosed">
          <span className="sim-alert-icon">✂</span>
          <span className="sim-alert-title">AUTO-CLOSED AT −40% STOP</span>
        </div>
      )}

      <div className="sim-card-head">
        <span className="sim-card-ticker" style={{ color: typeClr }}>{trade.ticker}</span>
        <span className="sim-card-type" style={{ color: typeClr }}>{trade.isCall ? 'CALL' : 'PUT'}</span>
        <span className="sim-card-contract">${trade.strike} · {trade.expDate}</span>
        {trade.grade && <span className="sim-card-grade">Grade {trade.grade}</span>}
        {trade.label && <span className="sim-card-label">{trade.label}</span>}
        {trade.status === 'open' && t2Remaining > 0 && (
          <span className="sim-t2-badge">T2 +{t2Remaining}</span>
        )}
        {trade.status === 'open' && hasLegs && t2Remaining <= 0 && (
          <span className="sim-scaled-badge">SCALED IN</span>
        )}
        {trade.status === 'closed' && <span className="sim-closed-badge">CLOSED</span>}
        <span className="sim-step-dots"
          data-tip={`Exit plan progress — ${stepLabel}. 4 stages: ① Stop −40% (cut all) → ② Breakeven +50% (move stop to entry) → ③ House +100% (sell half, recover cost) → ④ Trail 25% (let winners run free). Filled dots = stages reached.`}>
          {[1,2,3,4].map(n => {
            const filled = stepReached === 0 ? n === 1 : n <= stepReached
            return <span key={n} style={{ color: filled ? stepDotClr : '#1e2d45' }}>●</span>
          })}
        </span>
      </div>

      {/* ── Scale-in inline form ── */}
      {adding && (
        <div className="sim-scale-form">
          <span className="sim-scale-form-label">Add contracts (T{(trade.legs?.length ?? 1) + 1})</span>
          <input
            className="sim-scale-input"
            type="number"
            min="1"
            placeholder="qty"
            value={addQty}
            onChange={e => setAddQty(e.target.value)}
          />
          <span className="sim-scale-form-at">@</span>
          <input
            className="sim-scale-input"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="premium"
            value={addPrem}
            onChange={e => setAddPrem(e.target.value)}
          />
          <button className="sim-scale-confirm" onClick={handleConfirmAdd}>Add</button>
          <button className="sim-scale-cancel" onClick={() => setAdding(false)}>✕</button>
        </div>
      )}

      <div className="sim-card-body">
        {hasLegs ? (
          trade.legs.map((leg, i) => (
            <div className="sim-row" key={i}>
              <span className="sim-row-lbl" style={{ color: i === 0 ? '#4a6380' : '#38bdf8', width: 28 }}>
                T{i + 1}
              </span>
              <span className="sim-row-val">
                ${f2(leg.premium)}/sh &nbsp;·&nbsp; {leg.contracts} contract{leg.contracts !== 1 ? 's' : ''}
                &nbsp;·&nbsp; {fmtDate(leg.at)}
              </span>
            </div>
          ))
        ) : (
          <div className="sim-row">
            <span className="sim-row-lbl">Entry</span>
            <span className="sim-row-val">
              ${f2(trade.entryStockPrice)} stock &nbsp;·&nbsp; ${f2(trade.entryPremium)}/sh
              &nbsp;·&nbsp; {fmtDate(trade.entryAt)}
            </span>
          </div>
        )}
        {hasLegs && (
          <div className="sim-row">
            <span className="sim-row-lbl">Avg</span>
            <span className="sim-row-val" style={{ color: '#a0c0dc', fontWeight: 700 }}>
              ${f2(trade.entryPremium)}/sh blended &nbsp;·&nbsp; {trade.contracts} total contracts
            </span>
          </div>
        )}

        {isLive && nowPremium != null && (
          <div className="sim-row">
            <span className="sim-row-lbl">Now</span>
            <span className="sim-row-val">
              ${f2(currentPrice)} stock &nbsp;·&nbsp; ~${f2(nowPremium)}/sh (BS est.)
              {pctPnl != null && (
                <span style={{ color: pctPnl >= 0 ? '#10b981' : '#ef4444', marginLeft: 6, fontWeight: 700 }}>
                  {pctPnl >= 0 ? '+' : ''}{(pctPnl * 100).toFixed(0)}%
                </span>
              )}
            </span>
          </div>
        )}

        {trailStop && (
          <div className="sim-row">
            <span className="sim-row-lbl">Trail</span>
            <span className="sim-row-val" style={{ color: '#10b981' }}>
              Stop at ${f2(trailStop)}/sh &nbsp;·&nbsp; 25% below ~${f2(nowPremium)} (free contracts)
            </span>
          </div>
        )}

        {trade.status === 'open' && !isLive && (
          <div className="sim-row sim-row-stale">
            <span className="sim-row-lbl">P&amp;L</span>
            <span className="sim-row-val">Load {trade.ticker} for live estimate</span>
          </div>
        )}

        {trade.status === 'closed' && (
          <div className="sim-row">
            <span className="sim-row-lbl">Exit</span>
            <span className="sim-row-val">
              ${f2(trade.exitStockPrice)} stock &nbsp;·&nbsp; ${f2(trade.exitPremium)}/sh
              &nbsp;·&nbsp; {fmtDate(trade.exitAt)}
              {trade.closeReason === 'stop-40pct' && <span style={{ color: '#ef4444', marginLeft: 6 }}>AUTO-STOP</span>}
              {trade.closeReason === 'expired'    && <span style={{ color: '#6b7280', marginLeft: 6 }}>EXPIRED</span>}
            </span>
          </div>
        )}
      </div>

      <div className="sim-card-footer">
        <span className="sim-pnl" style={{ color: pnlColor }}>
          {tradePnl != null
            ? `${tradePnl >= 0 ? '+' : ''}$${Math.abs(tradePnl).toFixed(0)} · ${trade.contracts} contract${trade.contracts !== 1 ? 's' : ''}`
            : trade.status === 'open' ? 'P&L pending price data' : '—'
          }
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {canScaleIn && !adding && (
            <button className="sim-scale-btn" onClick={handleOpenAdd}>
              Scale In{t2Remaining > 0 ? ` (T2 ·${t2Remaining})` : ''}
            </button>
          )}
          {trade.status === 'open' && (
            <button
              className={`sim-close-btn${stopHit ? ' sim-close-btn-urgent' : ''}`}
              onClick={() => onClose(
                trade.id,
                nowPremium ?? trade.entryPremium,
                currentPrice ?? trade.entryStockPrice
              )}
            >
              {stopHit ? '⛔ Close Now' : 'Close Trade'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function SimTray({ trades, onClose, onClear, onScaleIn, currentPrice, currentSigma, loadedTicker }) {
  const open   = trades.filter(t => t.status === 'open')
  const closed = [...trades.filter(t => t.status === 'closed')].reverse()

  if (trades.length === 0) return (
    <div className="sim-empty">
      <div className="sim-empty-icon">🧪</div>
      <div className="sim-empty-title">No sim trades yet</div>
      <div className="sim-empty-sub">
        Head to the <strong>Options</strong> tab, load a ticker, and click{' '}
        <strong>Paper Trade</strong> on any recommendation card to log it here.
        The sim will reprice your position in real time as the stock price updates.
      </div>
    </div>
  )

  return (
    <div className="sim-root">
      <div className="sim-header">
        <div className="sim-header-left">
          <span className="sim-header-title">Sim Tray</span>
          <span className="sim-header-sub">
            Paper trading — verify app signals without real money
          </span>
        </div>
        {closed.length > 0 && (
          <button className="sim-clear-btn" onClick={onClear}>Clear History</button>
        )}
      </div>

      <SummaryStrip
        trades={trades}
        currentPrice={currentPrice}
        currentSigma={currentSigma}
        loadedTicker={loadedTicker}
      />

      {open.length > 0 && (
        <section className="sim-section">
          <div className="sim-section-lbl">Open Positions</div>
          {open.map(t => (
            <PositionCard
              key={t.id}
              trade={t}
              currentPrice={currentPrice}
              currentSigma={currentSigma}
              loadedTicker={loadedTicker}
              onClose={onClose}
              onScaleIn={onScaleIn}
            />
          ))}
        </section>
      )}

      {closed.length > 0 && (
        <section className="sim-section">
          <div className="sim-section-lbl">Closed Trades</div>
          {closed.map(t => (
            <PositionCard
              key={t.id}
              trade={t}
              currentPrice={currentPrice}
              currentSigma={currentSigma}
              loadedTicker={loadedTicker}
              onClose={onClose}
            />
          ))}
        </section>
      )}
    </div>
  )
}
