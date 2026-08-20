// PaperTray — Webull-style one-touch paper trading
// No manual entry: direction comes from signal, strike/expiry auto-selected,
// size auto-calculated by 2% risk rule. Uses live chain pricing when available.

import { useState, useMemo, useEffect } from 'react'
import { calcGreeks } from '../utils/fetchOptions'
import './PaperTray.css'

const SK = { cash: 'pt-cash', start: 'pt-start', pos: 'pt-pos', hist: 'pt-hist' }
const DEFAULT_CASH = 25000
const MAX_HIST = 50

function load(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def } catch { return def }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
function $$(n, d = 2) {
  if (n == null || isNaN(n)) return '—'
  return (+n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d })
}
function showPct(n) {
  if (n == null || isNaN(n)) return ''
  const s = (+n * 100).toFixed(1)
  return `${+s >= 0 ? '+' : ''}${s}%`
}
function plColor(n) { return +n >= 0 ? '#10b981' : '#ef4444' }

function optPrice(S, K, T, iv, isCall) {
  if (!S || !K || T <= 0 || !iv || iv <= 0) return 0
  const g = calcGreeks(S, K, Math.max(0.001, T), Math.min(iv, 4), isCall)
  return g?.price ?? 0
}
function daysToExp(isoDate) {
  return Math.max(0, (new Date(isoDate).getTime() - Date.now()) / 86400000)
}

// Third-Friday standard monthly expiries
function nextExpiries(count = 6) {
  const res = []
  const today = new Date()
  for (let m = 0; res.length < count; m++) {
    const mo = new Date(today.getFullYear(), today.getMonth() + m, 1)
    let fri = 0; const d = new Date(mo)
    while (fri < 3) {
      if (d.getDay() === 5) fri++
      if (fri < 3) d.setDate(d.getDate() + 1)
    }
    const iso = d.toISOString().slice(0, 10)
    if (new Date(iso) > today) res.push(iso)
  }
  return res
}
function roundStrike(S) {
  if (!S) return 0
  const step = S < 20 ? 0.5 : S < 50 ? 1 : S < 200 ? 5 : 10
  return Math.round(S / step) * step
}

// Build suggestion from live chain (preferred) or Black-Scholes fallback
function buildRec(ticker, currentPrice, signal, ivData, optionsChain, cash) {
  if (!ticker || !currentPrice || !signal || signal === 'NO TRADE' || !cash) return null

  const isCall  = signal === 'CALL'
  const iv      = (ivData?.atmIV ?? 30) / 100
  let expiry    = null
  let strike    = roundStrike(currentPrice)
  let premium   = null
  let bid       = null
  let ask       = null
  let isLive    = false

  // ── Live chain path ────────────────────────────────────────────────────────
  if (optionsChain?.contracts && optionsChain?.expirationDates?.length) {
    const nowSec = Date.now() / 1000
    const candidates = [...optionsChain.expirationDates]
      .filter(ts => {
        const dte = (ts - nowSec) / 86400
        return dte >= 21 && dte <= 90
      })
      .sort((a, b) => a - b)

    for (const expTs of candidates) {
      const bucket = optionsChain.contracts[expTs]
      const legs   = isCall ? (bucket?.calls ?? []) : (bucket?.puts ?? [])
      const valid  = legs.filter(c => c.bid > 0 && c.ask > c.bid && c.oi >= 10)
      if (!valid.length) continue

      // Find closest to ATM
      const best = valid.reduce((b, c) =>
        Math.abs(c.strike - currentPrice) < Math.abs(b.strike - currentPrice) ? c : b
      )
      strike  = best.strike
      bid     = +(best.bid).toFixed(2)
      ask     = +(best.ask).toFixed(2)
      premium = +((bid + ask) / 2).toFixed(2)
      expiry  = new Date(expTs * 1000).toISOString().slice(0, 10)
      isLive  = true
      break
    }
  }

  // ── Black-Scholes fallback ─────────────────────────────────────────────────
  if (!expiry) {
    const nexts = nextExpiries()
    expiry = nexts.find(e => daysToExp(e) >= 21) ?? nexts[0]
  }
  if (!expiry) return null
  if (premium == null) {
    const T = daysToExp(expiry) / 365
    premium = +(optPrice(currentPrice, strike, T, iv, isCall).toFixed(2))
  }
  if (premium <= 0) return null

  // 2% risk rule — stop at −50% premium
  const riskBudget = cash * 0.02
  const riskPerContract = premium * 100 * 0.5
  const contracts  = Math.max(1, Math.floor(riskBudget / riskPerContract))
  const totalCost  = +(premium * 100 * contracts).toFixed(2)

  return { isCall, optType: isCall ? 'call' : 'put', ticker, strike, expiry, contracts, premium, totalCost, iv, bid, ask, isLive }
}

// ── Trade Ticket ─────────────────────────────────────────────────────────────
function TradeTicket({ rec, currentPrice, signal, ticker, cash, onExecute }) {
  const [qty, setQty] = useState(rec?.contracts ?? 1)

  // Sync qty when recommendation changes (new ticker / signal)
  useEffect(() => {
    if (rec?.contracts != null) setQty(rec.contracts)
  }, [rec?.contracts, rec?.strike, rec?.expiry])

  if (!ticker) {
    return (
      <div className="pt-ticket-empty">
        Load a ticker from the Analyze tab — the trade will auto-fill instantly.
      </div>
    )
  }

  if (signal === 'NO TRADE' || !rec) {
    return (
      <div className="pt-ticket-empty">
        <strong>NO TRADE</strong> — wait for CALL or PUT confluence before entering.
      </div>
    )
  }

  const qty_    = Math.max(1, qty)
  const cost    = +(rec.premium * 100 * qty_).toFixed(2)
  const maxRisk = +(cost * 0.5).toFixed(2)
  const dte     = Math.round(daysToExp(rec.expiry))
  const be      = rec.isCall ? rec.strike + rec.premium : rec.strike - rec.premium

  return (
    <div className={`pt-ticket${rec.isCall ? ' pt-ticket-call' : ' pt-ticket-put'}`}>

      {/* Direction + ticker header */}
      <div className="pt-ticket-head">
        <span className={`pt-ticket-badge${rec.isCall ? ' badge-call' : ' badge-put'}`}>
          {signal}
        </span>
        <span className="pt-ticket-sym">{ticker}</span>
        <span className="pt-ticket-mktprice">${currentPrice?.toFixed(2)}</span>
        <span className="pt-ticket-rule">auto-sized · 2% rule</span>
      </div>

      {/* Position line */}
      <div className="pt-ticket-posline">
        <span className="pt-ticket-strike">${rec.strike}</span>
        <span className="pt-ticket-opttype">{rec.optType.toUpperCase()}</span>
        <span className="pt-ticket-sep">·</span>
        <span className="pt-ticket-expiry">exp {rec.expiry}</span>
        <span className={`pt-ticket-dte${dte <= 14 ? ' dte-warn' : ''}`}>{dte}d</span>
      </div>

      {/* Live pricing */}
      <div className="pt-ticket-pricing">
        {rec.isLive ? (
          <div className="pt-live-row">
            <span className="pt-live-dot">●</span>
            <span className="pt-live-lbl">LIVE</span>
            <span className="pt-live-ba">bid ${rec.bid?.toFixed(2)} / ask ${rec.ask?.toFixed(2)}</span>
            <span className="pt-live-mid">mid <strong>${rec.premium.toFixed(2)}/sh</strong></span>
          </div>
        ) : (
          <div className="pt-bs-row">
            <span className="pt-bs-val">est. ~${rec.premium.toFixed(2)}/sh</span>
            <span className="pt-bs-note"> · Black-Scholes estimate</span>
          </div>
        )}
      </div>

      {/* Contracts stepper */}
      <div className="pt-ticket-qty-row">
        <span className="pt-qty-lbl">Contracts</span>
        <div className="pt-stepper">
          <button className="pt-step" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
          <span className="pt-step-val">{qty_}</span>
          <button className="pt-step" onClick={() => setQty(q => q + 1)}>+</button>
        </div>
      </div>

      {/* Cost summary */}
      <div className="pt-ticket-costs">
        <div className="pt-cost-pill">
          <span className="pt-cost-k">Cost</span>
          <span className="pt-cost-v">{$$(cost)}</span>
        </div>
        <div className="pt-cost-pill">
          <span className="pt-cost-k">Max risk</span>
          <span className="pt-cost-v" style={{ color: '#ef4444' }}>{$$(maxRisk)}</span>
        </div>
        <div className="pt-cost-pill">
          <span className="pt-cost-k">Break-even</span>
          <span className="pt-cost-v">${be.toFixed(2)}</span>
        </div>
        <div className="pt-cost-pill pt-cost-avail">
          <span className="pt-cost-k">Cash</span>
          <span className="pt-cost-v" style={{ color: cost > cash ? '#ef4444' : undefined }}>
            {$$(cash)}
          </span>
        </div>
      </div>

      {cost > cash && (
        <div className="pt-err">Insufficient cash — need {$$(cost)}, have {$$(cash)}</div>
      )}

      <button
        className={`pt-execute${rec.isCall ? ' exec-call' : ' exec-put'}`}
        disabled={cost > cash}
        onClick={() => onExecute(rec, qty_)}
      >
        ⚡ Paper Trade · {$$(cost)}
      </button>
    </div>
  )
}

// ── Position Row ─────────────────────────────────────────────────────────────
function PositionRow({ pos, currentPrice, loadedTicker, signal, onClose }) {
  let mktVal = 0, costBasis = 0

  if (pos.type === 'option') {
    costBasis = pos.avgPremium * 100 * pos.contracts
    if (currentPrice && pos.ticker === loadedTicker) {
      const T = daysToExp(pos.expiry) / 365
      const p = optPrice(currentPrice, pos.strike, T, pos.iv, pos.optType === 'call')
      mktVal = p * 100 * pos.contracts
    } else {
      mktVal = costBasis
    }
  } else {
    costBasis = pos.avgCost * pos.shares
    mktVal = currentPrice && pos.ticker === loadedTicker
      ? pos.side === 'long'
        ? currentPrice * pos.shares
        : pos.avgCost * pos.shares * 2 - currentPrice * pos.shares
      : costBasis
  }

  const pl      = mktVal - costBasis
  const plPct   = costBasis > 0 ? pl / costBasis : 0
  const liveData = currentPrice && pos.ticker === loadedTicker
  const dte      = pos.type === 'option' ? Math.ceil(daysToExp(pos.expiry)) : null
  const dteDanger = dte != null && dte <= 7
  const signalFlipped = pos.type === 'option' && signal && pos.ticker === loadedTicker &&
    ((pos.optType === 'call' && signal === 'PUT') || (pos.optType === 'put' && signal === 'CALL'))

  return (
    <div className={`pt-pos-row${signalFlipped ? ' pt-pos-flipped' : ''}`}>
      {signalFlipped && (
        <div className="pt-flip-warn">⚠ Signal reversed to {signal} — consider closing</div>
      )}
      <div className="pt-pos-main">
        <span className="pt-pos-sym">{pos.ticker}</span>
        {pos.type === 'option' ? (
          <span className="pt-pos-desc">
            {pos.contracts}× ${pos.strike} {pos.optType.toUpperCase()} {pos.expiry.slice(5)}
          </span>
        ) : (
          <span className="pt-pos-desc">{pos.shares}sh {pos.side}</span>
        )}
        {dte != null && (
          <span className="pt-pos-dte" style={{ color: dteDanger ? '#ef4444' : '#6b7280' }}>
            DTE {dte}d
          </span>
        )}
        <span className="pt-pos-cost">cost {$$(costBasis)}</span>
        {!liveData && <span className="pt-pos-stale">load {pos.ticker} to mark</span>}
      </div>
      <div className="pt-pos-right">
        <span className="pt-pos-mkt">{$$(mktVal)}</span>
        <span className="pt-pos-pl" style={{ color: plColor(pl) }}>
          {$$(pl)} <span className="pt-pos-pct">({showPct(plPct)})</span>
        </span>
        <button className="pt-close-btn" onClick={() => onClose(pos.id, mktVal, pl)}>Close</button>
      </div>
    </div>
  )
}

// ── History Row ──────────────────────────────────────────────────────────────
function HistRow({ trade }) {
  const pl    = trade.closePl ?? 0
  const plPct = trade.totalCost > 0 ? pl / trade.totalCost : 0
  return (
    <div className="pt-hist-row">
      <span className="pt-hist-sym">{trade.ticker}</span>
      <span className="pt-hist-desc">
        {trade.type === 'option'
          ? `${trade.contracts}× $${trade.strike} ${trade.optType?.toUpperCase()} ${trade.expiry?.slice(5)}`
          : `${trade.shares}sh ${trade.side}`}
      </span>
      <span className="pt-hist-pl" style={{ color: plColor(pl) }}>{$$(pl)}</span>
      <span className="pt-hist-pct" style={{ color: plColor(plPct) }}>{showPct(plPct)}</span>
      <span className="pt-hist-date">{new Date(trade.closedAt).toLocaleDateString()}</span>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function PaperTray({ ticker, currentPrice, signal, ivData, optionsChain, onJournalEntry }) {
  const [cash,      setCash]      = useState(() => load(SK.cash,  DEFAULT_CASH))
  const [startCash]               = useState(() => {
    const s = load(SK.start, null)
    if (s != null) return s
    save(SK.start, DEFAULT_CASH); return DEFAULT_CASH
  })
  const [positions, setPositions] = useState(() => load(SK.pos,  []))
  const [history,   setHistory]   = useState(() => load(SK.hist, []))
  const [view,      setView]      = useState('trade')
  const [confirmReset, setConfirmReset] = useState(false)

  const rec = useMemo(
    () => buildRec(ticker, currentPrice, signal, ivData, optionsChain, cash),
    [ticker, signal, currentPrice, ivData, optionsChain, cash]
  )

  // Mark-to-market portfolio value
  const portfolioValue = useMemo(() => {
    let val = cash
    for (const pos of positions) {
      if (pos.type === 'option' && currentPrice && pos.ticker === ticker) {
        const T = daysToExp(pos.expiry) / 365
        val += optPrice(currentPrice, pos.strike, T, pos.iv, pos.optType === 'call') * 100 * pos.contracts
      } else if (pos.type === 'stock' && currentPrice && pos.ticker === ticker) {
        val += pos.side === 'long'
          ? currentPrice * pos.shares
          : pos.avgCost * pos.shares * 2 - currentPrice * pos.shares
      } else {
        val += pos.totalCost
      }
    }
    return val
  }, [cash, positions, currentPrice, ticker])

  const totalPL    = portfolioValue - startCash
  const totalPLPct = startCash > 0 ? totalPL / startCash : 0
  const wins       = history.filter(h => (h.closePl ?? 0) > 0).length
  const losses     = history.filter(h => (h.closePl ?? 0) <= 0).length
  const winRate    = wins + losses > 0 ? wins / (wins + losses) : null

  function openPosition(pos, cost) {
    const p2 = [...positions, pos]
    const c2 = cash - cost
    setPositions(p2); setCash(c2)
    save(SK.pos, p2); save(SK.cash, c2)
  }

  function executeAutoTrade(r, contractCount) {
    openPosition({
      id: uid(), type: 'option', optType: r.optType, ticker: r.ticker,
      strike: r.strike, expiry: r.expiry, contracts: contractCount,
      avgPremium: r.premium, iv: r.iv,
      openedAt: new Date().toISOString(), signal,
      totalCost: +(r.premium * 100 * contractCount).toFixed(2),
    }, r.premium * 100 * contractCount)
  }

  function closePosition(id, closeVal, closePl) {
    const pos = positions.find(p => p.id === id)
    if (!pos) return
    const p2 = positions.filter(p => p.id !== id)
    const c2 = cash + closeVal
    const h2 = [{ ...pos, closePl, closedAt: new Date().toISOString() }, ...history].slice(0, MAX_HIST)
    setPositions(p2); setCash(c2); setHistory(h2)
    save(SK.pos, p2); save(SK.cash, c2); save(SK.hist, h2)

    if (onJournalEntry && pos.type === 'option') {
      const pnl = +closePl.toFixed(2)
      onJournalEntry({
        id:          uid(),
        ticker:      pos.ticker,
        action:      pos.optType === 'call' ? 'BUY CALLS' : 'BUY PUTS',
        pattern:     `Paper · $${pos.strike} ${pos.optType.toUpperCase()} exp ${pos.expiry?.slice(5) ?? ''}`,
        grade:       pnl > 0 ? 'A' : 'B',
        date:        pos.openedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        entryPrice:  pos.avgPremium,
        stopPrice:   +(pos.avgPremium * 0.5).toFixed(2),
        targetPrice: +(pos.avgPremium * 2).toFixed(2),
        shares:      pos.contracts,
        maxRisk:     +(pos.totalCost * 0.5).toFixed(2),
        rrRatio:     pnl > 0 && pos.totalCost > 0 ? +(pnl / (pos.totalCost * 0.5)).toFixed(2) : 0,
        exitDate:    new Date().toISOString().slice(0, 10),
        exitPrice:   +(pos.avgPremium + pnl / (pos.contracts * 100)).toFixed(2),
        pnl,
        result:      pnl >= 0 ? 'WIN' : 'LOSS',
      })
    }
  }

  function resetAccount() {
    setPositions([]); setCash(DEFAULT_CASH); setHistory([])
    save(SK.pos, []); save(SK.cash, DEFAULT_CASH); save(SK.hist, [])
    save(SK.start, DEFAULT_CASH); setConfirmReset(false)
  }

  return (
    <div className="pt-root">

      {/* Account bar */}
      <div className="pt-account">
        <div className="pt-acct-kv">
          <span className="pt-acct-k">Portfolio</span>
          <span className="pt-acct-v">{$$(portfolioValue)}</span>
        </div>
        <div className="pt-acct-kv">
          <span className="pt-acct-k">Cash</span>
          <span className="pt-acct-v">{$$(cash)}</span>
        </div>
        <div className="pt-acct-kv">
          <span className="pt-acct-k">Total P&amp;L</span>
          <span className="pt-acct-v" style={{ color: plColor(totalPL) }}>
            {$$(totalPL)} <span className="pt-acct-pct">({showPct(totalPLPct)})</span>
          </span>
        </div>
        {winRate != null && (
          <div className="pt-acct-kv">
            <span className="pt-acct-k">Win Rate</span>
            <span className="pt-acct-v">
              {Math.round(winRate * 100)}%
              <span className="pt-acct-pct"> ({wins}W / {losses}L)</span>
            </span>
          </div>
        )}

        <div className="pt-acct-right">
          <div className="pt-toggle">
            <button className={`pt-tog${view === 'trade'   ? ' pt-on' : ''}`} onClick={() => setView('trade')}>Trade</button>
            <button className={`pt-tog${view === 'history' ? ' pt-on' : ''}`} onClick={() => setView('history')}>
              History{history.length > 0 ? ` (${history.length})` : ''}
            </button>
          </div>
          {!confirmReset ? (
            <button className="pt-reset-btn" onClick={() => setConfirmReset(true)} title="Reset paper account to $25,000">Reset</button>
          ) : (
            <span className="pt-confirm">
              Reset?&nbsp;
              <button onClick={resetAccount}>Yes</button>
              <button onClick={() => setConfirmReset(false)}>No</button>
            </span>
          )}
        </div>
      </div>

      {/* Trade view */}
      {view === 'trade' && (
        <>
          <TradeTicket
            rec={rec}
            currentPrice={currentPrice}
            signal={signal}
            ticker={ticker}
            cash={cash}
            onExecute={executeAutoTrade}
          />

          {positions.length > 0 && (
            <div className="pt-positions">
              <div className="pt-section-title">Open Positions ({positions.length})</div>
              {positions.map(pos => (
                <PositionRow
                  key={pos.id}
                  pos={pos}
                  currentPrice={currentPrice}
                  loadedTicker={ticker}
                  signal={signal}
                  onClose={closePosition}
                />
              ))}
            </div>
          )}

          {positions.length === 0 && !ticker && null}
        </>
      )}

      {/* History view */}
      {view === 'history' && (
        <div className="pt-history">
          {history.length === 0 ? (
            <div className="pt-empty">No closed trades yet.</div>
          ) : (
            <>
              <div className="pt-hist-hdr">
                <span>Symbol</span><span>Position</span>
                <span>P&amp;L</span><span>Return</span><span>Closed</span>
              </div>
              {history.map((h, i) => <HistRow key={h.id + i} trade={h} />)}
            </>
          )}
        </div>
      )}

    </div>
  )
}
