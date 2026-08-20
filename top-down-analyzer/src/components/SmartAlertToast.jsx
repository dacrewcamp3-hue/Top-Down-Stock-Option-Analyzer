import { useState, useEffect, useRef } from 'react'
import './SmartAlertToast.css'

const AUTO_DISMISS_MS = 20_000   // 20 seconds

// ── Time-of-day context ───────────────────────────────────────────────────────
function getSessionWarning() {
  try {
    const fmt   = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
    })
    const parts = fmt.formatToParts(new Date())
    const h = parseInt(parts.find(p => p.type === 'hour').value, 10)
    const m = parseInt(parts.find(p => p.type === 'minute').value, 10)
    const et = h * 60 + m
    if (et >= 570 && et < 600) return 'OPEN BELL — high fakeout risk, wait for 10 AM'   // 9:30-10:00
    if (et >= 930 && et < 960) return 'CLOSING HOUR — avoid new entries after 3:30 PM'  // 3:30-4:00
  } catch {}
  return null
}

// ── Direction color helpers ───────────────────────────────────────────────────
function dirColor(dir) {
  if (dir === 'CALL') return '#10b981'
  if (dir === 'PUT')  return '#ef4444'
  return '#60a5fa'
}
function dirBg(dir) {
  if (dir === 'CALL') return '#011a0c'
  if (dir === 'PUT')  return '#1a0000'
  return '#060f1c'
}

// ── Score color ───────────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 65) return '#10b981'
  if (score >= 42) return '#f59e0b'
  return '#ef4444'
}

// ── Type label & color ────────────────────────────────────────────────────────
const TYPE_META = {
  signal:   { label: 'SIGNAL',    color: '#10b981' },
  warning:  { label: 'WARNING',   color: '#f97316' },
  info:     { label: 'INFO',      color: '#60a5fa' },
  cycle:    { label: 'CYCLE',     color: '#d97706' },
  earnings: { label: 'EARNINGS',  color: '#a855f7' },
  orb:      { label: 'ORB BREAK', color: '#f59e0b' },
  ema8:     { label: 'EMA CROSS', color: '#60a5fa' },
  price:    { label: 'PRICE HIT', color: '#c084fc' },
}

// ── Single toast card ─────────────────────────────────────────────────────────
function ToastCard({ alert, onDismiss, onLoad }) {
  const [progress, setProgress] = useState(100)
  const [blinking, setBlinking] = useState(true)
  const startRef = useRef(Date.now())
  const rafRef   = useRef(null)

  // Progress bar countdown
  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - startRef.current
      const pct     = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100)
      setProgress(pct)
      if (pct > 0) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        onDismiss(alert.id)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [alert.id, onDismiss])

  // Stop blinking after 5 seconds
  useEffect(() => {
    const t = setTimeout(() => setBlinking(false), 5000)
    return () => clearTimeout(t)
  }, [])

  const meta       = TYPE_META[alert.type] ?? TYPE_META.info
  const dir        = alert.direction
  const score      = alert.score
  const timeWarn   = alert.timeWarning ?? getSessionWarning()
  const prevSig    = alert.prevSignal
  const bull       = alert.bull
  const bear       = alert.bear
  const hasTicker  = !!alert.ticker
  const scoreStr   = score != null ? `${score}/100` : null

  const accentColor = dir ? dirColor(dir) : meta.color
  const cardBg      = dir ? dirBg(dir)    : '#070d1c'

  return (
    <div
      className={`sat-card${blinking ? ' sat-blinking' : ''}`}
      style={{ borderColor: accentColor + '60', background: cardBg, boxShadow: `0 0 18px 0 ${accentColor}18` }}
    >
      {/* Auto-dismiss countdown bar */}
      <div className="sat-progress-track">
        <div
          className="sat-progress-bar"
          style={{ width: `${progress}%`, background: accentColor }}
        />
      </div>

      {/* Header row: pulsing LED + type label + time + dismiss */}
      <div className="sat-header">
        <div className="sat-header-left">
          <span
            className={`sat-led${blinking ? ' sat-led-pulse' : ''}`}
            style={{ background: accentColor, boxShadow: `0 0 7px ${accentColor}` }}
          />
          <span className="sat-type-label" style={{ color: meta.color }}>{meta.label}</span>
        </div>
        <div className="sat-header-right">
          <span className="sat-time">just now</span>
          <button className="sat-close" onClick={() => onDismiss(alert.id)}>×</button>
        </div>
      </div>

      {/* Ticker + direction + score */}
      {hasTicker && (
        <div className="sat-main-row">
          <span
            className={`sat-ticker${blinking ? ' sat-ticker-blink' : ''}`}
            style={{ color: accentColor }}
          >
            {alert.ticker}
          </span>
          {dir && dir !== 'NO TRADE' && (
            <span className="sat-direction" style={{ color: accentColor }}>
              {dir === 'CALL' ? '▲' : '▼'} {dir === 'CALL' ? 'BUY CALLS' : 'BUY PUTS'}
            </span>
          )}
          {dir === 'NO TRADE' && (
            <span className="sat-direction" style={{ color: '#6b7280' }}>NO TRADE</span>
          )}
          {scoreStr && (
            <span
              className="sat-score"
              style={{ color: scoreColor(score), borderColor: scoreColor(score) + '44' }}
            >
              {scoreStr}
            </span>
          )}
        </div>
      )}

      {/* What changed */}
      {prevSig && dir && (
        <div className="sat-change-row">
          <span className="sat-change-from" style={{ color: prevSig === 'CALL' ? '#10b981' : prevSig === 'PUT' ? '#ef4444' : '#6b7280' }}>
            {prevSig}
          </span>
          <span className="sat-change-arrow">→</span>
          <span className="sat-change-to" style={{ color: accentColor }}>{dir}</span>
        </div>
      )}

      {/* Signal context */}
      {(bull != null || alert.body) && (
        <div className="sat-body">
          {bull != null && bear != null && (
            <span className="sat-bull-bear">
              <span style={{ color: '#10b981' }}>{bull}B</span>
              {' / '}
              <span style={{ color: '#ef4444' }}>{bear}Be</span>
            </span>
          )}
          {alert.body && <span className="sat-body-text">{alert.body}</span>}
        </div>
      )}

      {/* Time-of-day warning */}
      {timeWarn && (
        <div className="sat-time-warn">
          <span className="sat-warn-icon">⚠</span>
          {timeWarn}
        </div>
      )}

      {/* Action button */}
      {hasTicker && onLoad && (
        <button
          className="sat-load-btn"
          style={{ color: accentColor, borderColor: accentColor + '44' }}
          onClick={() => { onLoad(alert.ticker); onDismiss(alert.id) }}
        >
          Analyze {alert.ticker} →
        </button>
      )}
    </div>
  )
}

// ── Main SmartAlertToast ──────────────────────────────────────────────────────
export default function SmartAlertToast({ onLoadTicker }) {
  const [toasts, setToasts] = useState([])

  // Subscribe to the alert bus
  useEffect(() => {
    const trySubscribe = () => {
      if (!window.__tdAlertBus) return false
      const handler = incoming => {
        setToasts(prev => {
          // Keep max 3 visible toasts, newest at top
          const next = [incoming, ...prev].slice(0, 3)
          return next
        })
      }
      window.__tdAlertBus.listeners.push(handler)
      return () => {
        window.__tdAlertBus.listeners =
          window.__tdAlertBus.listeners.filter(f => f !== handler)
      }
    }
    const unsub = trySubscribe()
    if (unsub) return unsub
    const t = setTimeout(() => trySubscribe(), 300)
    return () => clearTimeout(t)
  }, [])

  const dismiss = id => setToasts(prev => prev.filter(t => t.id !== id))

  if (!toasts.length) return null

  return (
    <div className="sat-stack">
      {toasts.map(t => (
        <ToastCard
          key={t.id}
          alert={t}
          onDismiss={dismiss}
          onLoad={onLoadTicker}
        />
      ))}
    </div>
  )
}
