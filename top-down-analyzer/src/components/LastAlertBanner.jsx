import { useState, useEffect } from 'react'
import './LastAlertBanner.css'

const STORAGE_KEY = 'tdsa-alerts'

const TYPE_COLOR = {
  signal:   '#10b981',
  warning:  '#f97316',
  info:     '#60a5fa',
  cycle:    '#d97706',
  earnings: '#a855f7',
}
const TYPE_LABEL = {
  signal:   'SIGNAL',
  warning:  'WARNING',
  info:     'INFO',
  cycle:    'CYCLE',
  earnings: 'EARNINGS',
}

function getMostRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return list.length > 0 ? list[0] : null
  } catch { return null }
}

function whenStr(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function LastAlertBanner({ onLoadTicker }) {
  const [alert,  setAlert]  = useState(getMostRecent)
  const [hidden, setHidden] = useState(false)
  const [flash,  setFlash]  = useState(false)
  const [, setTick] = useState(0)

  // Subscribe to the alert bus — receives every new alert in real-time
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Bus may not exist yet if AlertCenter hasn't mounted — wait for it
    const trySubscribe = () => {
      if (!window.__tdAlertBus) return false
      const handler = incoming => {
        setAlert(incoming)
        setHidden(false)
        setFlash(true)
        setTimeout(() => setFlash(false), 900)
      }
      window.__tdAlertBus.listeners.push(handler)
      return () => {
        window.__tdAlertBus.listeners = window.__tdAlertBus.listeners.filter(f => f !== handler)
      }
    }
    // Try immediately; if bus isn't ready, retry once after 200ms
    const unsub = trySubscribe()
    if (unsub) return unsub
    const t = setTimeout(() => trySubscribe(), 200)
    return () => clearTimeout(t)
  }, [])

  // Refresh "X ago" every 30 s without re-reading localStorage
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!alert || hidden) return null

  const col   = TYPE_COLOR[alert.type] ?? '#60a5fa'
  const label = TYPE_LABEL[alert.type] ?? 'ALERT'

  return (
    <div className={`lab-root${flash ? ' lab-flash' : ''}`} style={{ borderLeftColor: col }}>

      {/* Left: type badge */}
      <div className="lab-type" style={{ color: col, borderColor: `${col}55` }}>{label}</div>

      {/* Center: title · body (body truncates) */}
      <div className="lab-center">
        <span className="lab-title">{alert.title}</span>
        {alert.body && (
          <>
            <span className="lab-sep">·</span>
            <span className="lab-body">{alert.body}</span>
          </>
        )}
      </div>

      {/* Right: time · load · dismiss */}
      <div className="lab-right">
        <span className="lab-time">{whenStr(alert.ts)}</span>
        {alert.ticker && onLoadTicker && (
          <button
            className="lab-load"
            style={{ color: col, borderColor: `${col}55` }}
            onClick={() => onLoadTicker(alert.ticker)}
          >
            Analyze {alert.ticker} →
          </button>
        )}
        <button className="lab-close" onClick={() => setHidden(true)} title="Dismiss">×</button>
      </div>

    </div>
  )
}
