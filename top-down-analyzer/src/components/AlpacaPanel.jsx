import { useState, useEffect, useCallback } from 'react'
import './AlpacaPanel.css'

const API_BASE = '/alpaca-api'
const STORAGE  = { key: 'alpaca-key', secret: 'alpaca-secret' }

function loadCreds() {
  return {
    key:    localStorage.getItem(STORAGE.key)    ?? '',
    secret: localStorage.getItem(STORAGE.secret) ?? '',
  }
}
function saveCreds(k, s) {
  localStorage.setItem(STORAGE.key,    k)
  localStorage.setItem(STORAGE.secret, s)
}

function fmtMoney(n) {
  if (n == null) return '—'
  return (+n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
function fmtPct(n) {
  if (n == null) return ''
  const pct = (+n * 100).toFixed(2)
  return `${+pct >= 0 ? '+' : ''}${pct}%`
}

async function alpacaFetch(endpoint, creds, opts = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...opts,
    headers: {
      'APCA-API-KEY-ID':     creds.key,
      'APCA-API-SECRET-KEY': creds.secret,
      'Content-Type':        'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

function OrderForm({ creds, defaultSymbol, signal, onPlaced }) {
  const [sym,    setSym]    = useState(defaultSymbol ?? '')
  const [qty,    setQty]    = useState('1')
  const [side,   setSide]   = useState(signal === 'PUT' ? 'sell' : 'buy')
  const [type,   setType]   = useState('market')
  const [limit,  setLimit]  = useState('')
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState(null)
  const [ok,     setOk]     = useState(null)

  // Sync symbol and side when props change (ticker changes in parent)
  useEffect(() => { if (defaultSymbol) setSym(defaultSymbol) }, [defaultSymbol])
  useEffect(() => { setSide(signal === 'PUT' ? 'sell' : 'buy') }, [signal])

  async function submit(e) {
    e.preventDefault()
    if (!sym.trim() || !qty || !creds.key || !creds.secret) return
    setBusy(true); setErr(null); setOk(null)
    try {
      const body = {
        symbol:     sym.trim().toUpperCase(),
        qty:        qty,
        side,
        type,
        time_in_force: type === 'market' ? 'day' : 'gtc',
        ...(type === 'limit' && limit ? { limit_price: limit } : {}),
      }
      const order = await alpacaFetch('/v2/orders', creds, {
        method: 'POST',
        body:   JSON.stringify(body),
      })
      setOk(`Order ${order.id?.slice(0, 8)} submitted — ${order.status}`)
      onPlaced?.()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="alp-form" onSubmit={submit}>
      <div className="alp-form-title">Place Paper Order</div>

      <div className="alp-form-row">
        <div className="alp-field">
          <label className="alp-lbl">Symbol</label>
          <input
            className="alp-input alp-input-sm"
            value={sym}
            onChange={e => setSym(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="AAPL"
          />
        </div>
        <div className="alp-field">
          <label className="alp-lbl">Qty (shares)</label>
          <input
            className="alp-input alp-input-sm"
            type="number"
            min="1"
            step="1"
            value={qty}
            onChange={e => setQty(e.target.value)}
          />
        </div>
        <div className="alp-field">
          <label className="alp-lbl">Side</label>
          <div className="alp-toggle">
            <button type="button" className={`alp-tog-btn${side === 'buy'  ? ' alp-buy-on'  : ''}`} onClick={() => setSide('buy')}>BUY</button>
            <button type="button" className={`alp-tog-btn${side === 'sell' ? ' alp-sell-on' : ''}`} onClick={() => setSide('sell')}>SELL</button>
          </div>
        </div>
        <div className="alp-field">
          <label className="alp-lbl">Type</label>
          <div className="alp-toggle">
            <button type="button" className={`alp-tog-btn${type === 'market' ? ' active' : ''}`} onClick={() => setType('market')}>MKT</button>
            <button type="button" className={`alp-tog-btn${type === 'limit'  ? ' active' : ''}`} onClick={() => setType('limit')}>LMT</button>
          </div>
        </div>
        {type === 'limit' && (
          <div className="alp-field">
            <label className="alp-lbl">Limit price</label>
            <input
              className="alp-input alp-input-sm"
              type="number"
              min="0.01"
              step="0.01"
              value={limit}
              onChange={e => setLimit(e.target.value)}
              placeholder="0.00"
            />
          </div>
        )}
      </div>

      {err && <div className="alp-err">{err}</div>}
      {ok  && <div className="alp-ok">{ok}</div>}

      <button className="alp-submit-btn" type="submit" disabled={busy || !sym || !qty}>
        {busy ? 'Submitting…' : `Paper ${side.toUpperCase()} ${qty} ${sym || '—'}`}
      </button>
    </form>
  )
}

function PositionRow({ pos }) {
  const pl    = +pos.unrealized_pl
  const plPct = +pos.unrealized_plpc
  const isPos = pl >= 0
  return (
    <div className="alp-pos-row">
      <span className="alp-pos-sym">{pos.symbol}</span>
      <span className="alp-pos-qty">{pos.qty} {pos.side}</span>
      <div className="alp-pos-prices">
        <span className="alp-pos-cost">cost {fmtMoney(pos.avg_entry_price)}</span>
        <span className="alp-pos-cur">current {fmtMoney(pos.current_price)}</span>
      </div>
      <div className="alp-pos-pl" style={{ color: isPos ? '#10b981' : '#ef4444' }}>
        <span>{fmtMoney(pl)}</span>
        <span className="alp-pos-pct">{fmtPct(plPct)}</span>
      </div>
      <span className="alp-pos-mkt">{fmtMoney(pos.market_value)}</span>
    </div>
  )
}

function OrderRow({ ord }) {
  const statusColor = {
    filled:     '#10b981',
    canceled:   '#6b7280',
    rejected:   '#ef4444',
    new:        '#60a5fa',
    pending_new:'#60a5fa',
    partially_filled: '#f59e0b',
  }[ord.status] ?? '#6b7280'

  return (
    <div className="alp-ord-row">
      <span className="alp-ord-sym">{ord.symbol}</span>
      <span className={`alp-ord-side${ord.side === 'buy' ? ' alp-buy-txt' : ' alp-sell-txt'}`}>
        {ord.side.toUpperCase()}
      </span>
      <span className="alp-ord-qty">{ord.qty} @ {ord.type}</span>
      {ord.filled_avg_price && (
        <span className="alp-ord-fill">{fmtMoney(ord.filled_avg_price)}</span>
      )}
      <span className="alp-ord-status" style={{ color: statusColor }}>{ord.status}</span>
    </div>
  )
}

export default function AlpacaPanel({ ticker, signal }) {
  const [creds,     setCreds]     = useState(loadCreds)
  const [editing,   setEditing]   = useState(!loadCreds().key)
  const [draftKey,  setDraftKey]  = useState(loadCreds().key)
  const [draftSec,  setDraftSec]  = useState(loadCreds().secret)
  const [account,   setAccount]   = useState(null)
  const [positions, setPositions] = useState([])
  const [orders,    setOrders]    = useState([])
  const [loading,   setLoading]   = useState(false)
  const [acctErr,   setAcctErr]   = useState(null)

  function saveDraft() {
    saveCreds(draftKey.trim(), draftSec.trim())
    setCreds({ key: draftKey.trim(), secret: draftSec.trim() })
    setEditing(false)
  }

  const loadData = useCallback(async () => {
    if (!creds.key || !creds.secret) return
    setLoading(true); setAcctErr(null)
    try {
      const [acct, pos, ords] = await Promise.all([
        alpacaFetch('/v2/account',          creds),
        alpacaFetch('/v2/positions',         creds),
        alpacaFetch('/v2/orders?limit=10&status=all', creds),
      ])
      setAccount(acct)
      setPositions(Array.isArray(pos)  ? pos  : [])
      setOrders(Array.isArray(ords) ? ords : [])
    } catch (ex) {
      setAcctErr(ex.message)
    } finally {
      setLoading(false)
    }
  }, [creds])

  useEffect(() => { loadData() }, [loadData])

  const hasCreds = !!creds.key && !!creds.secret

  return (
    <div className="alp-root">

      {/* API key setup */}
      <div className="alp-creds-bar">
        <div className="alp-creds-left">
          <span className="alp-creds-title">Alpaca Paper Trading</span>
          <span className="alp-creds-sub">
            {hasCreds && !editing ? (
              <span className="alp-creds-ok">API key configured · paper account</span>
            ) : (
              'Enter your Alpaca paper-trading API credentials'
            )}
          </span>
        </div>
        <div className="alp-creds-right">
          {hasCreds && !editing && (
            <button className="alp-edit-btn" onClick={() => setEditing(true)}>Edit keys</button>
          )}
          <button className="alp-refresh-btn" onClick={loadData} disabled={loading || !hasCreds}>
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="alp-creds-form">
          <div className="alp-creds-info">
            Get free paper-trading API keys at alpaca.markets → Accounts → API Keys. Paper mode only — no real money.
          </div>
          <div className="alp-creds-row">
            <div className="alp-field">
              <label className="alp-lbl">API Key ID</label>
              <input
                className="alp-input"
                value={draftKey}
                onChange={e => setDraftKey(e.target.value)}
                placeholder="PK…"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="alp-field">
              <label className="alp-lbl">Secret Key</label>
              <input
                className="alp-input"
                type="password"
                value={draftSec}
                onChange={e => setDraftSec(e.target.value)}
                placeholder="secret…"
                autoComplete="off"
              />
            </div>
            <button
              className="alp-save-btn"
              onClick={saveDraft}
              disabled={!draftKey.trim() || !draftSec.trim()}
            >Save & Connect</button>
          </div>
        </div>
      )}

      {acctErr && (
        <div className="alp-err">
          {acctErr.includes('403') || acctErr.includes('401')
            ? 'Auth failed — check your API key and secret. Make sure you are using the Paper key, not the Live key.'
            : acctErr}
        </div>
      )}

      {!hasCreds && !editing && (
        <div className="alp-empty">
          <div className="alp-empty-icon">🏦</div>
          <div className="alp-empty-title">Connect Alpaca paper account</div>
          <div className="alp-empty-sub">
            Practice executing trades without real money. Track positions and test your method.
            <button className="alp-connect-btn" onClick={() => setEditing(true)}>Connect now</button>
          </div>
        </div>
      )}

      {hasCreds && account && (
        <>
          {/* Account summary */}
          <div className="alp-account">
            <div className="alp-acct-stat">
              <span className="alp-acct-l">Portfolio value</span>
              <span className="alp-acct-v">{fmtMoney(account.portfolio_value)}</span>
            </div>
            <div className="alp-acct-stat">
              <span className="alp-acct-l">Buying power</span>
              <span className="alp-acct-v">{fmtMoney(account.buying_power)}</span>
            </div>
            <div className="alp-acct-stat">
              <span className="alp-acct-l">Cash</span>
              <span className="alp-acct-v">{fmtMoney(account.cash)}</span>
            </div>
            <div className="alp-acct-stat">
              <span className="alp-acct-l">Day trade count</span>
              <span className={`alp-acct-v${+account.daytrade_count >= 3 ? ' alp-warn-txt' : ''}`}>
                {account.daytrade_count ?? '—'} / PDT: {account.pattern_day_trader ? 'YES' : 'NO'}
              </span>
            </div>
          </div>

          {/* Order form */}
          <OrderForm
            creds={creds}
            defaultSymbol={ticker}
            signal={signal}
            onPlaced={loadData}
          />

          {/* Positions */}
          {positions.length > 0 && (
            <div className="alp-section">
              <div className="alp-section-title">Open Positions ({positions.length})</div>
              <div className="alp-pos-hdr">
                <span>Symbol</span><span>Qty</span><span>Price</span><span>P&amp;L</span><span>Mkt Value</span>
              </div>
              {positions.map(p => <PositionRow key={p.asset_id} pos={p} />)}
            </div>
          )}

          {/* Recent orders */}
          {orders.length > 0 && (
            <div className="alp-section">
              <div className="alp-section-title">Recent Orders</div>
              {orders.map(o => <OrderRow key={o.id} ord={o} />)}
            </div>
          )}

          {positions.length === 0 && orders.length === 0 && (
            <div className="alp-no-activity">
              No open positions or recent orders. Place a paper trade above to start.
            </div>
          )}
        </>
      )}
    </div>
  )
}
