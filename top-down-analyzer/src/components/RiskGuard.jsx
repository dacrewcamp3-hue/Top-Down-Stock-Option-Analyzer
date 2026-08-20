// RiskGuard — behavioral guardrails banner
// Reads directly from PaperTray's localStorage so it stays synced
// without any prop drilling. Refreshes every 30s alongside the ET clock.

import { useMemo, useState, useEffect } from 'react'
import './RiskGuard.css'

const DAILY_LOSS_LIMIT_PCT = 3.0
const MAX_POSITIONS = 4
const WIN_STREAK_WARN = 5
const LOSS_STREAK_STOP = 3

function getETMinutes() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
    }).formatToParts(new Date())
    const h = parseInt(parts.find(p => p.type === 'hour').value, 10)
    const m = parseInt(parts.find(p => p.type === 'minute').value, 10)
    return (h === 24 ? 0 : h) * 60 + m
  } catch { return null }
}
function readPtPos()  { try { return JSON.parse(localStorage.getItem('pt-pos')  || '[]') } catch { return [] } }
function readPtHist() { try { return JSON.parse(localStorage.getItem('pt-hist') || '[]') } catch { return [] } }

const SEV = {
  stop:    { bg: '#160303', border: '#7f1d1d', color: '#ef4444', icon: '⛔', borderL: '#ef4444' },
  warn:    { bg: '#150f00', border: '#92400e', color: '#f59e0b', icon: '⚠',  borderL: '#f59e0b' },
  caution: { bg: '#050d18', border: '#1e3a5f', color: '#60a5fa', icon: '◷',  borderL: '#3b82f6' },
}

export default function RiskGuard() {
  const [dismissed, setDismissed] = useState({})
  const [now,       setNow]       = useState(getETMinutes)
  const [ptPos,     setPtPos]     = useState(readPtPos)
  const [ptHist,    setPtHist]    = useState(readPtHist)

  useEffect(() => {
    const id = setInterval(() => {
      setNow(getETMinutes())
      setPtPos(readPtPos())
      setPtHist(readPtHist())
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const accountSize = +(localStorage.getItem('rp_account') || 25000)

  const warnings = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const result = []

    // 1. Open positions count (from PaperTray pt-pos)
    const openCount = ptPos.length
    if (openCount >= MAX_POSITIONS) {
      result.push({
        id: 'max-positions',
        severity: 'warn',
        title: `${openCount} OPEN POSITIONS — AT CAPACITY`,
        detail: `You have ${openCount} open paper trades, your maximum. If the market turns, all positions move against you simultaneously. Close a winner before adding another.`,
      })
    }

    // 2. Today's P&L from PaperTray closed trades (pt-hist)
    const todayClosed = ptHist.filter(t => t.closedAt?.slice(0, 10) === todayStr && t.closePl != null)
    if (todayClosed.length > 0) {
      const todayPL = todayClosed.reduce((s, t) => s + (t.closePl ?? 0), 0)
      const lossLimit = -(accountSize * DAILY_LOSS_LIMIT_PCT / 100)

      if (todayPL <= lossLimit) {
        result.push({
          id: 'daily-loss',
          severity: 'stop',
          title: 'DAILY LOSS LIMIT HIT — STOP TRADING',
          detail: `Down $${Math.abs(todayPL).toFixed(0)} today (limit: $${Math.abs(lossLimit).toFixed(0)} = ${DAILY_LOSS_LIMIT_PCT}% of $${accountSize.toLocaleString()} account). One bad day does not have to become a bad week. Close the app and come back tomorrow.`,
        })
      } else if (todayPL < 0 && todayPL > lossLimit * 0.6) {
        result.push({
          id: 'approaching-limit',
          severity: 'warn',
          title: `APPROACHING LIMIT — DOWN $${Math.abs(todayPL).toFixed(0)} TODAY`,
          detail: `Daily limit is $${Math.abs(lossLimit).toFixed(0)}. One more losing trade and your session is over. Tighten up or step away.`,
        })
      }
    }

    // 3. Win / loss streak from pt-hist
    const closedSorted = [...ptHist].sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''))
    let streak = 0, streakType = null
    for (let i = closedSorted.length - 1; i >= 0; i--) {
      const win  = (closedSorted[i].closePl ?? 0) > 0
      const type = win ? 'W' : 'L'
      if (streakType === null) { streakType = type; streak = 1 }
      else if (type === streakType) streak++
      else break
    }

    if (streakType === 'W' && streak >= WIN_STREAK_WARN) {
      result.push({
        id: 'win-streak',
        severity: 'caution',
        title: `${streak}-TRADE WIN STREAK — OVERCONFIDENCE ZONE`,
        detail: `Streaks feel like skill. They are partly conditions. Your next entry needs the same criteria as your first. Reduce size 25% as insurance against the inevitable miss.`,
      })
    }
    if (streakType === 'L' && streak >= LOSS_STREAK_STOP) {
      result.push({
        id: 'loss-streak',
        severity: 'stop',
        title: `${streak} CONSECUTIVE LOSSES — MANDATORY REVIEW`,
        detail: `Three losses in a row means conditions changed or your execution broke down. Stop now. Review the last ${streak} trades before entering another position.`,
      })
    }

    // 4. Time-of-day warnings
    if (now !== null) {
      if (now >= 9 * 60 + 30 && now < 10 * 60) {
        result.push({
          id: 'open-rush',
          severity: 'caution',
          title: 'MARKET OPEN (9:30–10 AM ET) — HIGH-NOISE WINDOW',
          detail: 'The first 30 minutes are overnight order flow clearing, not real price discovery. Spreads are wide, moves are exaggerated, and reversals are common. Wait until after 10:00 AM.',
        })
      } else if (now >= 15 * 60 + 30 && now < 16 * 60) {
        result.push({
          id: 'close-rush',
          severity: 'caution',
          title: 'MARKET CLOSE (3:30–4 PM ET) — MOC REBALANCE RISK',
          detail: 'Funds rebalancing at close can cause sharp, unpredictable reversals. Options theta also accelerates into close. Skip new entries unless you are closing a position.',
        })
      }
    }

    return result
  }, [ptPos, ptHist, accountSize, now])

  const visible = warnings.filter(w => !dismissed[w.id])
  if (!visible.length) return null

  return (
    <div className="rg-root">
      {visible.map(w => {
        const s = SEV[w.severity] ?? SEV.caution
        return (
          <div
            key={w.id}
            className="rg-item"
            style={{ background: s.bg, borderColor: s.border, borderLeftColor: s.color }}
          >
            <span className="rg-icon" style={{ color: s.color }}>{s.icon}</span>
            <div className="rg-body">
              <span className="rg-title" style={{ color: s.color }}>{w.title}</span>
              <span className="rg-detail">{w.detail}</span>
            </div>
            <button
              className="rg-dismiss"
              onClick={() => setDismissed(d => ({ ...d, [w.id]: true }))}
              title="Dismiss until next refresh"
            >✕</button>
          </div>
        )
      })}
    </div>
  )
}
