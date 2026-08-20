import { useState, useEffect, useRef, useCallback } from 'react'
import { playTone } from '../utils/audioAlerts'
import { pushAlert } from './AlertCenter'
import './PriceLevelAlerts.css'

const BASE = '/yf-api/v8/finance/chart'
const POLL_MS = 30_000  // 30 seconds

async function fetchPrice(ticker) {
  try {
    const res  = await fetch(`${BASE}/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`)
    if (!res.ok) return null
    const json = await res.json()
    const q    = json.chart?.result?.[0]?.indicators?.quote?.[0]
    const cs   = (json.chart?.result?.[0]?.timestamp ?? [])
      .map((_, i) => q?.close?.[i])
      .filter(v => v != null)
    return cs.length ? +cs[cs.length - 1].toFixed(2) : null
  } catch { return null }
}

let nextId = Date.now()

function loadAlerts() {
  try { return JSON.parse(localStorage.getItem('pla_alerts') ?? '[]') } catch { return [] }
}

function saveAlerts(alerts) {
  try { localStorage.setItem('pla_alerts', JSON.stringify(alerts)) } catch {}
}

export default function PriceLevelAlerts({ currentTicker, fibLevels, orbRetest }) {
  const [alerts,     setAlerts]     = useState(loadAlerts)
  const [ticker,     setTicker]     = useState('')
  const [price,      setPrice]      = useState('')
  const [direction,  setDirection]  = useState('above')
  const [livePrices, setLivePrices] = useState({})  // ticker → price
  const [polling,    setPolling]    = useState(true)
  const [toasts,     setToasts]     = useState([])   // floating in-app notifications
  const pollingRef   = useRef(true)
  const toastTimers  = useRef({})

  useEffect(() => { pollingRef.current = polling }, [polling])

  // Persist alerts to localStorage
  useEffect(() => { saveAlerts(alerts) }, [alerts])

  const addAlert = () => {
    const sym = ticker.trim().toUpperCase()
    const lvl = parseFloat(price)
    if (!sym || isNaN(lvl) || lvl <= 0) return
    setAlerts(prev => [...prev, {
      id:        ++nextId,
      ticker:    sym,
      price:     lvl,
      direction,
      triggered: false,
      addedAt:   new Date().toISOString(),
    }])
    setTicker('')
    setPrice('')
  }

  const addAlertDirect = (sym, lvl, dir) => {
    if (!sym || !lvl) return
    setAlerts(prev => {
      // Skip if the exact same alert already exists
      if (prev.some(a => a.ticker === sym && Math.abs(a.price - lvl) < 0.01)) return prev
      return [...prev, {
        id:        ++nextId,
        ticker:    sym,
        price:     +lvl.toFixed(2),
        direction: dir,
        triggered: false,
        addedAt:   new Date().toISOString(),
      }]
    })
  }

  // Build quick-add chips from Fib levels and ORB
  const quickLevels = []
  if (currentTicker && fibLevels) {
    const fibOrder = [
      ['0.0 (Low)',  fibLevels['0.0'],   'below'],
      ['23.6%',      fibLevels['23.6'],  'below'],
      ['38.2%',      fibLevels['38.2'],  'below'],
      ['50.0%',      fibLevels['50.0'],  'below'],
      ['61.8%',      fibLevels['61.8'],  'above'],
      ['78.6%',      fibLevels['78.6'],  'above'],
      ['100% (High)',fibLevels['100.0'], 'above'],
    ]
    for (const [label, lvl, dir] of fibOrder) {
      if (lvl != null && lvl > 0) quickLevels.push({ label, price: lvl, dir, kind: 'fib' })
    }
  }
  if (currentTicker && orbRetest?.orHigh) {
    quickLevels.push({ label: 'OR High', price: orbRetest.orHigh, dir: 'above', kind: 'orb' })
  }
  if (currentTicker && orbRetest?.orLow) {
    quickLevels.push({ label: 'OR Low',  price: orbRetest.orLow,  dir: 'below', kind: 'orb' })
  }

  const removeAlert = id => setAlerts(prev => prev.filter(a => a.id !== id))
  const resetAlert  = id => setAlerts(prev => prev.map(a => a.id === id ? { ...a, triggered: false } : a))
  const clearAll    = () => setAlerts([])

  // Auto-dismiss each toast individually 8 seconds after it appears
  useEffect(() => {
    const activeIds = new Set(toasts.map(t => t.id))
    // Clear timers for toasts that were already removed
    Object.keys(toastTimers.current).forEach(id => {
      if (!activeIds.has(Number(id))) {
        clearTimeout(toastTimers.current[id])
        delete toastTimers.current[id]
      }
    })
    // Start a timer for each new toast (no duplicate timers)
    toasts.forEach(toast => {
      if (!toastTimers.current[toast.id]) {
        toastTimers.current[toast.id] = setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== toast.id))
          delete toastTimers.current[toast.id]
        }, 8000)
      }
    })
  }, [toasts])

  // Polling: check all active alerts every 30 seconds
  const checkAlerts = useCallback(async () => {
    if (!pollingRef.current) return
    const active = alerts.filter(a => !a.triggered)
    if (!active.length) return

    // Dedupe tickers so we don't fetch the same ticker multiple times
    const tickers = [...new Set(active.map(a => a.ticker))]
    const prices  = await Promise.all(tickers.map(t => fetchPrice(t)))
    const priceMap = Object.fromEntries(tickers.map((t, i) => [t, prices[i]]))

    setLivePrices(prev => ({ ...prev, ...priceMap }))

    const trigList = []
    const now = new Date().toISOString()
    setAlerts(prev => prev.map(a => {
      if (a.triggered) return a
      const cur = priceMap[a.ticker]
      if (cur == null) return a
      const hit = a.direction === 'above' ? cur >= a.price : cur <= a.price
      if (hit) {
        trigList.push({ ...a, livePrice: cur })
        return { ...a, triggered: true, triggeredAt: now, livePrice: cur }
      }
      return a
    }))

    if (trigList.length) {
      playTone('price')

      // Rich AlertCenter notification — appears in the bell AND as browser notification
      trigList.forEach(a => {
        const live = a.livePrice
        const delta    = live != null ? live - a.price : 0
        const deltaPct = a.price > 0 ? (delta / a.price * 100) : 0
        const dir      = a.direction === 'above' ? '↑ Crossed ABOVE' : '↓ Crossed BELOW'
        const sign     = delta >= 0 ? '+' : ''
        pushAlert({
          title: `${a.ticker} — Price Alert`,
          body:  `${dir} $${a.price.toFixed(2)} · Live $${live?.toFixed(2) ?? '—'} (${sign}${deltaPct.toFixed(2)}%)`,
          type:  'signal',
          ticker: a.ticker,
        })
      })

      // Floating in-app toasts (up to 4 visible at once)
      setToasts(prev => [
        ...trigList.map(a => ({
          id:        `${a.id}_${Date.now()}`,
          ticker:    a.ticker,
          price:     a.price,
          livePrice: a.livePrice,
          direction: a.direction,
          at:        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })),
        ...prev,
      ].slice(0, 4))
    }
  }, [alerts])

  useEffect(() => {
    const id = setInterval(checkAlerts, POLL_MS)
    return () => clearInterval(id)
  }, [checkAlerts])

  const activeCount    = alerts.filter(a => !a.triggered).length
  const triggeredCount = alerts.filter(a => a.triggered).length

  return (
    <div className="pla-root">

      {/* ── Floating toasts — appears on every trigger ── */}
      {toasts.length > 0 && (
        <div className="pla-toast-stack">
          {toasts.map(t => {
            const delta    = t.livePrice != null ? t.livePrice - t.price : 0
            const deltaPct = t.price > 0 ? (delta / t.price * 100) : 0
            const sign     = delta >= 0 ? '+' : ''
            const isBull   = t.direction === 'above'
            return (
              <div key={t.id} className="pla-toast" style={{ borderColor: isBull ? '#10b981' : '#ef4444' }}>
                <div className="pla-toast-head">
                  <span className="pla-toast-ticker" style={{ color: isBull ? '#10b981' : '#ef4444' }}>{t.ticker}</span>
                  <span className="pla-toast-dir">{isBull ? '↑ Above' : '↓ Below'} ${t.price.toFixed(2)}</span>
                  <button className="pla-toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>×</button>
                </div>
                <div className="pla-toast-body">
                  Live <strong style={{ color: '#c4daf0' }}>${t.livePrice?.toFixed(2) ?? '—'}</strong>
                  <span style={{ color: delta >= 0 ? '#10b981' : '#ef4444', marginLeft: 6 }}>{sign}{deltaPct.toFixed(2)}%</span>
                  <span className="pla-toast-time">{t.at}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="pla-header">
        <div className="pla-header-left">
          <span className="pla-title">Price Level Alerts</span>
          <span className="pla-sub">
            {activeCount} active · {triggeredCount} triggered · checks every 30s
          </span>
        </div>
        <div className="pla-header-right">
          {Notification.permission === 'default' && (
            <button className="pla-notif-btn" onClick={() => Notification.requestPermission()}>
              Enable Notifications
            </button>
          )}
          {Notification.permission === 'granted' && (
            <span className="pla-notif-on">Notifications ON</span>
          )}
          <button
            className={`pla-poll-toggle${polling ? ' pla-poll-on' : ''}`}
            onClick={() => setPolling(v => !v)}
          >
            {polling ? '⏸ Pause' : '▶ Resume'}
          </button>
        </div>
      </div>

      {/* Quick Add — Fib + ORB chips */}
      {quickLevels.length > 0 && (
        <div className="pla-quick">
          <div className="pla-quick-label">Quick Add · {currentTicker} key levels</div>
          <div className="pla-quick-chips">
            {quickLevels.map((ql, i) => {
              const alreadySet = alerts.some(a => a.ticker === currentTicker && Math.abs(a.price - ql.price) < 0.01)
              return (
                <button
                  key={i}
                  className={`pla-chip${ql.kind === 'orb' ? ' pla-chip-orb' : ''} ${alreadySet ? 'pla-chip-set' : ''}`}
                  onClick={() => addAlertDirect(currentTicker, ql.price, ql.dir)}
                  disabled={alreadySet}
                  title={`Add ${ql.dir === 'above' ? '↑ above' : '↓ below'} $${ql.price.toFixed(2)}`}
                >
                  <span className="pla-chip-dir">{ql.dir === 'above' ? '↑' : '↓'}</span>
                  <span className="pla-chip-label">{ql.label}</span>
                  <span className="pla-chip-price">${ql.price.toFixed(2)}</span>
                  {alreadySet && <span className="pla-chip-check">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Add alert form */}
      <div className="pla-form">
        <input
          className="pla-input pla-ticker"
          placeholder="TICKER"
          maxLength={6}
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && addAlert()}
        />
        <select
          className="pla-select"
          value={direction}
          onChange={e => setDirection(e.target.value)}
        >
          <option value="above">Crosses Above</option>
          <option value="below">Crosses Below</option>
        </select>
        <input
          className="pla-input pla-price"
          placeholder="Price $"
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={e => setPrice(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addAlert()}
        />
        <button className="pla-add-btn" onClick={addAlert}>+ Add Alert</button>
      </div>

      {/* Alert list */}
      {alerts.length > 0 && (
        <div className="pla-list">
          <div className="pla-list-hdr">
            <span>Ticker</span>
            <span>Condition</span>
            <span>Live Price</span>
            <span>Status</span>
            <span />
          </div>
          {alerts.map(a => {
            const live    = livePrices[a.ticker]
            const dist    = live != null ? ((live - a.price) / a.price * 100) : null
            const distStr = dist != null ? `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%` : null
            return (
              <div key={a.id} className={`pla-row${a.triggered ? ' pla-triggered' : ''}`}>
                <span className="pla-row-ticker">{a.ticker}</span>
                <span className="pla-row-cond">
                  <span className="pla-dir">{a.direction === 'above' ? '↑ Above' : '↓ Below'}</span>
                  <span className="pla-level">${a.price.toFixed(2)}</span>
                </span>
                <span className="pla-row-live">
                  {live != null ? (
                    <>
                      <span style={{ color: '#8aacc8' }}>${live.toFixed(2)}</span>
                      {distStr && (
                        <span className="pla-dist" style={{ color: dist >= 0 ? '#10b981' : '#ef4444' }}>
                          {distStr}
                        </span>
                      )}
                    </>
                  ) : <span className="pla-dim">—</span>}
                </span>
                <span className="pla-row-status">
                  {a.triggered ? (
                    <span className="pla-hit-block">
                      <span className="pla-hit">TRIGGERED</span>
                      {a.livePrice != null && (
                        <span className="pla-hit-detail">@ ${a.livePrice.toFixed(2)}</span>
                      )}
                      {a.triggeredAt && (
                        <span className="pla-hit-time">
                          {new Date(a.triggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="pla-watching">WATCHING</span>
                  )}
                </span>
                <div className="pla-row-actions">
                  {a.triggered && (
                    <button className="pla-reset-btn" onClick={() => resetAlert(a.id)} title="Re-arm">↺</button>
                  )}
                  <button className="pla-rm-btn" onClick={() => removeAlert(a.id)} title="Remove">×</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {alerts.length === 0 && (
        <div className="pla-empty">
          No alerts set. Add a ticker and price level above — you'll get a browser notification when price crosses it.
        </div>
      )}

      {alerts.length > 0 && (
        <button className="pla-clear-btn" onClick={clearAll}>Clear All Alerts</button>
      )}
    </div>
  )
}
