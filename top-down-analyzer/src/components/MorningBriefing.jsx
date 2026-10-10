import { useState, useEffect } from 'react'

export default function MorningBriefing({ breadthData, vixData, ticker, optionsChain, verdict }) {
  // ── Calendar fetch ──────────────────────────────────────────────────────────
  const [calendarEvents, setCalendarEvents] = useState([])
  const [calLoaded, setCalLoaded] = useState(false)

  useEffect(() => {
    fetch('/calendar-api')
      .then(r => r.json())
      .then(data => {
        // Filter to today's events
        const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
        const todayEvents = data.filter(e => {
          try {
            const evDate = new Date(e.date).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
            return evDate === today
          } catch { return false }
        })
        setCalendarEvents(todayEvents)
        setCalLoaded(true)
      })
      .catch(() => setCalLoaded(true))
  }, [])

  // ── Game plan state ─────────────────────────────────────────────────────────
  const [gamePlan, setGamePlan] = useState(() => {
    try {
      const todayKey = `gameplan-${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
      return localStorage.getItem(todayKey) ?? ''
    } catch { return '' }
  })

  const saveGamePlan = (val) => {
    setGamePlan(val)
    try {
      const todayKey = `gameplan-${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
      localStorage.setItem(todayKey, val)
    } catch {}
  }

  // ── Session time ────────────────────────────────────────────────────────────
  const etNow   = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const etDate  = new Date(etNow)
  const etHour  = etDate.getHours()
  const etMin   = etDate.getMinutes()
  const etTotal = etHour * 60 + etMin

  const sessionLabel =
    etTotal < 4 * 60        ? 'OVERNIGHT'
    : etTotal < 9 * 60 + 30 ? 'PRE-MARKET'
    : etTotal < 16 * 60     ? 'MARKET OPEN'
    : etTotal < 20 * 60     ? 'AFTER HOURS'
    : 'OVERNIGHT'

  const isPreMarket = etTotal < 9 * 60 + 30 && etTotal >= 4 * 60
  const minsToOpen  = isPreMarket ? (9 * 60 + 30 - etTotal) : null

  // ── Checklist ───────────────────────────────────────────────────────────────
  const checks = [
    {
      q: 'What is the market regime?',
      answer: breadthData?.verdict ?? 'Loading…',
      ok:   ['FAVORABLE', 'LEANING BULLISH'].includes(breadthData?.verdict),
      warn: ['MIXED'].includes(breadthData?.verdict),
      detail: breadthData?.verdict === 'FAVORABLE'
        ? 'Conditions favor directional trades. Full normal size.'
        : breadthData?.verdict === 'HOSTILE'
        ? 'Conditions are hostile. Consider sitting out or trading defensive.'
        : 'Mixed signals. Trade smaller, be selective.',
    },
    {
      q: 'What is VIX saying?',
      answer: vixData?.current != null
        ? `VIX ${vixData.current.toFixed(1)}`
        : breadthData?.vix?.current != null
        ? `VIX ${breadthData.vix.current.toFixed(1)}`
        : 'No data',
      ok:   (vixData?.current ?? breadthData?.vix?.current ?? 20) < 20,
      warn: (vixData?.current ?? breadthData?.vix?.current ?? 20) >= 20 &&
            (vixData?.current ?? breadthData?.vix?.current ?? 20) < 28,
      detail: (() => {
        const v = vixData?.current ?? breadthData?.vix?.current ?? 0
        if (v < 16) return 'Low fear — options are cheap, positive gamma environment, spreads favored.'
        if (v < 20) return 'Normal range. Standard position sizing.'
        if (v < 28) return 'Elevated. Reduce size 25%. Expect wider intraday swings.'
        return 'High fear. Half size max. Wide stops required or sit out.'
      })(),
    },
    {
      q: 'Is selling pressure extreme (TRIN)?',
      answer: breadthData?.trin?.value != null
        ? `TRIN ${breadthData.trin.value.toFixed(2)} — ${breadthData.trin.label}`
        : 'No data',
      ok:   (breadthData?.trin?.value ?? 1) < 1.2,
      warn: (breadthData?.trin?.value ?? 1) >= 1.2 && (breadthData?.trin?.value ?? 1) < 1.8,
      detail: (() => {
        const t = breadthData?.trin?.value ?? 1
        if (t < 0.8) return 'Strong buying. Favorable for CALL positions today.'
        if (t < 1.2) return 'Neutral TRIN. Normal conditions.'
        if (t < 2.0) return 'Selling pressure elevated. Favor PUTs or stay in cash.'
        return 'Panic selling. Do not trade against the tape.'
      })(),
    },
    {
      q: 'Is new high/low ratio healthy?',
      answer: breadthData?.hl?.highs != null
        ? `${breadthData.hl.highs} highs vs ${breadthData.hl.lows} lows`
        : 'No data',
      ok:   (breadthData?.hl?.highs ?? 0) > (breadthData?.hl?.lows ?? 0),
      warn: (breadthData?.hl?.highs ?? 0) === (breadthData?.hl?.lows ?? 1),
      detail: (() => {
        const h = breadthData?.hl?.highs ?? 0, l = breadthData?.hl?.lows ?? 0
        if (h > l * 2) return 'Healthy expansion — the majority of stocks are advancing. Broad participation.'
        if (h > l)     return 'More stocks making new highs than lows. Moderate breadth.'
        return 'More stocks making new lows. Narrow market or distribution phase.'
      })(),
    },
    {
      q: 'Any scheduled macro events today?',
      answer: calendarEvents?.length > 0
        ? `${calendarEvents.length} event${calendarEvents.length > 1 ? 's' : ''} scheduled`
        : 'No high-impact events today',
      ok:   !calendarEvents?.length,
      warn: calendarEvents?.length > 0,
      detail: calendarEvents?.length > 0
        ? `Caution: ${calendarEvents.map(e => e.title).join(', ')}. Reduce size or wait for the print before entering.`
        : 'Clear calendar. No scheduled disruptions.',
    },
  ]

  return (
    <div style={{ background: '#030810', minHeight: 400 }}>

      {/* ── Section A: Session Status Header ─────────────────────────────────── */}
      <div style={{
        padding: '10px 16px', background: '#020609',
        borderBottom: '1px solid #0a1820',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>SESSION</div>
          <div style={{
            fontSize: 13, fontWeight: 900,
            color: sessionLabel === 'MARKET OPEN' ? '#10b981'
                 : sessionLabel === 'PRE-MARKET'  ? '#f59e0b'
                 : '#2a4060'
          }}>{sessionLabel}</div>
        </div>
        {minsToOpen != null && (
          <div>
            <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>OPEN IN</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: '#f59e0b' }}>
              {Math.floor(minsToOpen / 60)}h {minsToOpen % 60}m
            </div>
          </div>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#1a3050' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      </div>

      {/* ── Section B: Pre-Market Checklist ──────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, padding: 16,
      }}>
        {checks.map((c, i) => {
          const col    = c.ok ? '#10b981' : c.warn ? '#f59e0b' : '#ef4444'
          const bg     = c.ok ? '#010e07' : c.warn ? '#0a0700' : '#0e0101'
          const border = c.ok ? '#065f46' : c.warn ? '#713f12' : '#7f1d1d'
          return (
            <div key={i} style={{
              background: bg, border: `1px solid ${border}`,
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>
                {`0${i + 1}`.slice(-2)}. {c.q}
              </div>
              <div style={{ fontSize: 13, color: col, fontWeight: 900, marginBottom: 4 }}>
                {c.answer}
              </div>
              <div style={{ fontSize: 10, color: '#4a6a8a', lineHeight: 1.5 }}>
                {c.detail}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Section C: Economic Calendar ─────────────────────────────────────── */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>
          TODAY'S ECONOMIC EVENTS (USD)
        </div>
        {!calLoaded ? (
          <div style={{ fontSize: 10, color: '#1a3050' }}>Loading calendar…</div>
        ) : calendarEvents.length === 0 ? (
          <div style={{
            padding: '10px 14px', background: '#010e07',
            border: '1px solid #065f46', borderRadius: 6,
            fontSize: 11, color: '#10b981', fontWeight: 700,
          }}>
            ✓ No high-impact USD events today — clear to trade normal size
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {calendarEvents.map((ev, i) => {
              const evTime  = new Date(ev.date)
              const now     = new Date()
              const minsAway = Math.round((evTime - now) / 60000)
              const isPast  = minsAway < 0
              const isSoon  = minsAway >= 0 && minsAway <= 30
              const col     = ev.impact === 'High' ? '#ef4444' : '#f59e0b'
              const timeStr = evTime.toLocaleTimeString('en-US', {
                timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit'
              })
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 12px', borderRadius: 6,
                  background: isSoon ? (ev.impact === 'High' ? '#1a0000' : '#100800') : '#08121e',
                  border: `1px solid ${isSoon ? col : '#0e1820'}`,
                  opacity: isPast ? 0.45 : 1,
                }}>
                  <div style={{
                    fontSize: 8, fontWeight: 900, color: col,
                    border: `1px solid ${col}44`, borderRadius: 3,
                    padding: '1px 5px', flexShrink: 0,
                  }}>{ev.impact?.toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700 }}>{ev.title}</div>
                    {(ev.forecast || ev.previous) && (
                      <div style={{ fontSize: 9, color: '#4a6a8a', marginTop: 2 }}>
                        {ev.forecast && `Forecast: ${ev.forecast}`}
                        {ev.forecast && ev.previous && '  ·  '}
                        {ev.previous && `Previous: ${ev.previous}`}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: isSoon ? col : '#4a6a8a', fontWeight: 700 }}>{timeStr} ET</div>
                    {!isPast && (
                      <div style={{ fontSize: 9, color: isSoon ? col : '#2a4060' }}>
                        {minsAway < 60
                          ? `in ${minsAway}m`
                          : `in ${Math.floor(minsAway / 60)}h ${minsAway % 60}m`}
                      </div>
                    )}
                    {isPast && <div style={{ fontSize: 9, color: '#2a4060' }}>released</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Section D: Today's Game Plan ─────────────────────────────────────── */}
      <div style={{ padding: '0 16px 20px' }}>
        <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>
          TODAY'S GAME PLAN
        </div>
        <textarea
          value={gamePlan}
          onChange={e => saveGamePlan(e.target.value)}
          placeholder={`Write your game plan for today before the open...

• What setups am I looking for?
• What levels am I watching?
• What would make me NOT trade today?
• Max loss limit for the day: $___`}
          style={{
            width: '100%', minHeight: 140, padding: '12px 14px',
            background: '#060d18', border: '1px solid #0e1e30',
            borderRadius: 8, color: '#cbd5e1', fontSize: 11,
            fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: 9, color: '#1a3050', marginTop: 4 }}>
          Auto-saved · resets each trading day
        </div>
      </div>

    </div>
  )
}
