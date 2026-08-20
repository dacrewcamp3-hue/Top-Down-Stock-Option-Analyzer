import { useState, useEffect, useRef } from 'react'
import './AlertCenter.css'

// Persistent alert log in localStorage
const STORAGE_KEY = 'tdsa-alerts'
const MAX_ALERTS  = 50

function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
function saveAlerts(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ALERTS))) } catch {}
}

// Singleton alert bus — other components call window.__tdAlert(alert) to push an alert
// without needing a React context. The AlertCenter subscribes to this bus.
if (typeof window !== 'undefined' && !window.__tdAlertBus) {
  window.__tdAlertBus = { listeners: [] }
}

export function pushAlert({ title, body, type = 'info', ticker = null, ...extra }) {
  const alert = { id: Date.now(), ts: Date.now(), title, body, type, ticker, read: false, ...extra }
  const stored = loadAlerts()
  saveAlerts([alert, ...stored])
  // Notify all listeners
  if (window.__tdAlertBus) window.__tdAlertBus.listeners.forEach(fn => fn(alert))
  // Browser notification (if permission granted)
  if (Notification.permission === 'granted') {
    try { new Notification(`Top-Down: ${title}`, { body, icon: '/favicon.ico' }) } catch {}
  }
  return alert
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)  return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const TYPE_COLOR = { signal: '#10b981', warning: '#f97316', info: '#60a5fa', cycle: '#d97706', earnings: '#a855f7' }

function AlertItem({ alert, onDismiss, onLoad }) {
  const col = TYPE_COLOR[alert.type] ?? '#60a5fa'
  return (
    <div className={`ac-item${alert.read ? ' ac-read' : ''}`} style={{ borderLeftColor: col }}>
      <div className="ac-item-top">
        <span className="ac-item-title" style={{ color: col }}>{alert.title}</span>
        <span className="ac-item-time">{timeAgo(alert.ts)}</span>
      </div>
      <div className="ac-item-body">{alert.body}</div>
      <div className="ac-item-actions">
        {alert.ticker && (
          <button className="ac-load-btn" onClick={() => onLoad?.(alert.ticker)}>
            Load {alert.ticker}
          </button>
        )}
        <button className="ac-dismiss-btn" onClick={() => onDismiss(alert.id)}>Dismiss</button>
      </div>
    </div>
  )
}

export default function AlertCenter({ onLoadTicker }) {
  const [open,    setOpen]    = useState(false)
  const [alerts,  setAlerts]  = useState(loadAlerts)
  const [perm,    setPerm]    = useState(Notification.permission)
  const panelRef = useRef(null)

  // Subscribe to alert bus
  useEffect(() => {
    const handler = () => setAlerts(loadAlerts())
    window.__tdAlertBus.listeners.push(handler)
    return () => {
      window.__tdAlertBus.listeners = window.__tdAlertBus.listeners.filter(f => f !== handler)
    }
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function requestPerm() {
    Notification.requestPermission().then(p => setPerm(p))
  }

  function dismiss(id) {
    const updated = alerts.filter(a => a.id !== id)
    saveAlerts(updated)
    setAlerts(updated)
  }

  function clearAll() {
    saveAlerts([])
    setAlerts([])
  }

  function markAllRead() {
    const updated = alerts.map(a => ({ ...a, read: true }))
    saveAlerts(updated)
    setAlerts(updated)
  }

  function handleOpen() {
    setOpen(o => !o)
    // Mark all as read when panel opens
    if (!open) {
      const updated = alerts.map(a => ({ ...a, read: true }))
      saveAlerts(updated)
      setAlerts(updated)
    }
  }

  const unread = alerts.filter(a => !a.read).length

  return (
    <div className="ac-root" ref={panelRef}>
      <button className="ac-bell-btn" onClick={handleOpen} title="Alert Center">
        🔔
        {unread > 0 && <span className="ac-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="ac-panel">
          <div className="ac-panel-header">
            <span className="ac-panel-title">Alert Center</span>
            <div className="ac-panel-actions">
              {alerts.length > 0 && (
                <button className="ac-clear-btn" onClick={clearAll}>Clear all</button>
              )}
            </div>
          </div>

          {perm !== 'granted' && (
            <div className="ac-perm-bar">
              <span>Enable browser notifications to receive alerts when away from the app.</span>
              <button className="ac-perm-btn" onClick={requestPerm}>Enable</button>
            </div>
          )}

          {perm === 'granted' && (
            <div className="ac-perm-on">🔔 Browser notifications active</div>
          )}

          {alerts.length === 0 && (
            <div className="ac-empty">No alerts yet. Alerts fire when signals change, cycle phase shifts, or earnings approach.</div>
          )}

          <div className="ac-list">
            {alerts.map(a => (
              <AlertItem
                key={a.id}
                alert={a}
                onDismiss={dismiss}
                onLoad={ticker => { onLoadTicker?.(ticker); setOpen(false) }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
