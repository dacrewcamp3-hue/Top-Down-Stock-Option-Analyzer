import { useState, useEffect } from 'react'

// ── Daily Loss Guard ──────────────────────────────────────────────────────────
export function DailyLossGuard() {
  const [trades,       setTrades]       = useState([])
  const [budget,       setBudget]       = useState(500)
  const [editBudget,   setEditBudget]   = useState(false)
  const [budgetInput,  setBudgetInput]  = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(null)
  const [now,          setNow]          = useState(Date.now())

  useEffect(() => {
    function load() {
      try {
        const notes  = JSON.parse(localStorage.getItem('tj_notes_v2') ?? '[]')
        const today  = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        setTrades(notes.filter(n => n.date === today && n.tradeSnap))
      } catch {}
      try {
        const b = parseFloat(localStorage.getItem('dlg_budget') ?? '500')
        setBudget(isNaN(b) ? 500 : b)
      } catch {}
      try {
        const cd = parseInt(localStorage.getItem('dlg_cooldown_until') ?? '0')
        setCooldownUntil(cd > Date.now() ? cd : null)
      } catch {}
    }
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const totalDeployed  = trades.reduce((sum, n) => sum + (n.tradeSnap?.totalCost ?? 0), 0)
  const pctUsed        = budget > 0 ? totalDeployed / budget : 0
  const cooldownActive = cooldownUntil && now < cooldownUntil
  const secsLeft       = cooldownActive ? Math.ceil((cooldownUntil - now) / 1000) : 0
  const minsLeft       = Math.floor(secsLeft / 60)
  const secsRem        = secsLeft % 60

  const weeklyCount = (() => {
    try {
      const notes  = JSON.parse(localStorage.getItem('tj_notes_v2') ?? '[]')
      const cutoff = Date.now() - 7 * 86400000
      return notes.filter(n => n.tradeSnap && parseInt(n.id) > cutoff).length
    } catch { return 0 }
  })()

  function declareLoss() {
    const until = Date.now() + 30 * 60 * 1000
    setCooldownUntil(until)
    try { localStorage.setItem('dlg_cooldown_until', String(until)) } catch {}
  }
  function clearCooldown() {
    setCooldownUntil(null)
    try { localStorage.removeItem('dlg_cooldown_until') } catch {}
  }
  function saveBudget() {
    const v = parseFloat(budgetInput)
    if (!isNaN(v) && v > 0) {
      setBudget(v)
      try { localStorage.setItem('dlg_budget', String(v)) } catch {}
    }
    setEditBudget(false)
  }

  const standDown = cooldownActive || pctUsed >= 1.0
  const caution   = !standDown && (pctUsed >= 0.5 || weeklyCount >= 10)

  if (!standDown && !caution && trades.length === 0) return null

  const pctBar = Math.min(100, Math.round(pctUsed * 100))
  const barClr = pctUsed >= 1.0 ? '#ef4444' : pctUsed >= 0.5 ? '#f97316' : '#f59e0b'

  return (
    <div style={{
      background: standDown ? '#0f0000' : '#100500',
      borderTop: `1px solid ${standDown ? '#ef4444' : '#f97316'}`,
      borderBottom: `1px solid ${standDown ? '#ef4444' : '#f97316'}`,
      padding: '6px 16px', fontSize: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{
          background: standDown ? '#ef4444' : '#f97316', color: '#000',
          fontWeight: 900, fontSize: 10, padding: '2px 8px',
          borderRadius: 4, letterSpacing: '0.5px', flexShrink: 0,
        }}>
          {cooldownActive ? `⏱ COOL-DOWN ${minsLeft}:${String(secsRem).padStart(2,'0')}` : standDown ? '⛔ DAILY LIMIT HIT' : '⚠ DAILY CAUTION'}
        </div>

        <div style={{ color: standDown ? '#fca5a5' : '#fdba74', fontWeight: 600 }}>
          {cooldownActive
            ? 'Trading locked — cool-down in progress. Step away from the screen.'
            : `$${totalDeployed.toFixed(0)} of $${budget} daily budget · ${trades.length} trade${trades.length !== 1 ? 's' : ''} today`
          }
          {weeklyCount >= 10 && !cooldownActive && ` · ${weeklyCount} trades this week — consider tightening`}
        </div>

        {/* Budget bar */}
        {!cooldownActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 60, height: 4, background: '#1f2937', borderRadius: 2 }}>
              <div style={{ width: `${pctBar}%`, height: '100%', background: barClr, borderRadius: 2 }} />
            </div>
            <span style={{ color: barClr, fontWeight: 700 }}>{pctBar}%</span>
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {cooldownActive ? (
            <button onClick={clearCooldown} style={{
              background: 'none', border: '1px solid #4b5563', borderRadius: 3,
              color: '#9ca3af', fontSize: 9, padding: '1px 6px', cursor: 'pointer',
            }}>End Early</button>
          ) : !standDown ? (
            <button onClick={declareLoss} style={{
              background: 'none', border: '1px solid #ef4444', borderRadius: 3,
              color: '#ef4444', fontSize: 9, padding: '1px 6px', cursor: 'pointer',
            }}>Declare Loss → 30m cool-down</button>
          ) : null}
          {editBudget ? (
            <span style={{ display: 'flex', gap: 4 }}>
              <input
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveBudget()}
                placeholder={String(budget)}
                style={{
                  width: 60, background: '#0d1117', border: '1px solid #374151',
                  borderRadius: 3, color: '#e5e7eb', fontSize: 10, padding: '1px 4px',
                }}
                autoFocus
              />
              <button onClick={saveBudget} style={{
                background: '#1d4ed8', border: 'none', borderRadius: 3,
                color: '#fff', fontSize: 9, padding: '1px 6px', cursor: 'pointer',
              }}>Save</button>
            </span>
          ) : (
            <button onClick={() => { setBudgetInput(String(budget)); setEditBudget(true) }} style={{
              background: 'none', border: '1px solid #374151', borderRadius: 3,
              color: '#6b7280', fontSize: 9, padding: '1px 6px', cursor: 'pointer',
            }}>Set Limit</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Market-condition banner helpers ───────────────────────────────────────────
function buildReason(vix, trin, verdict) {
  const parts = []
  if (vix > 35) parts.push(`VIX ${vix.toFixed(1)} — market crisis level`)
  else if (vix > 28) parts.push(`VIX ${vix.toFixed(1)} — elevated fear`)
  else if (vix > 22) parts.push(`VIX ${vix.toFixed(1)} — above normal`)
  if (trin > 2.0) parts.push(`TRIN ${trin.toFixed(2)} — panic selling`)
  else if (trin > 1.5) parts.push(`TRIN ${trin.toFixed(2)} — heavy selling pressure`)
  if (verdict === 'HOSTILE') parts.push('market breadth HOSTILE')
  else if (verdict === 'LEANING BEARISH') parts.push('breadth leaning bearish')
  return parts.join(' · ') || 'Elevated market risk'
}

export default function StandDownBanner({ breadthData, vixData }) {
  const vix     = vixData?.current ?? breadthData?.vix?.current ?? 0
  const trin    = breadthData?.trin?.value ?? 0
  const verdict = breadthData?.verdict ?? ''

  const isHostile   = verdict === 'HOSTILE' || verdict === 'LEANING BEARISH'
  const isVixCrisis = vix > 35
  const isVixHigh   = vix > 28
  const isPanicTRIN = trin > 2.0
  const isElevTRIN  = trin > 1.5

  const standDown = isVixCrisis || isPanicTRIN || (isVixHigh && isHostile)
  const reduceExposure = !standDown && (isVixHigh || (isElevTRIN && isHostile) || (isHostile && vix > 24))
  const caution = !standDown && !reduceExposure && (vix > 22 || isHostile || isElevTRIN)

  if (!standDown && !reduceExposure && !caution) return null

  if (standDown) {
    return (
      <>
        <style>{`
          @keyframes standdown-pulse {
            0%, 100% { border-top-color: #ef4444; border-bottom-color: #ef4444; }
            50% { border-top-color: #7f1d1d; border-bottom-color: #7f1d1d; }
          }
        `}</style>
        <div style={{
          background: '#0f0000',
          borderTop: '2px solid #ef4444',
          borderBottom: '2px solid #ef4444',
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          animation: 'standdown-pulse 2s ease-in-out infinite',
        }}>
          <div style={{
            background: '#ef4444', color: '#000',
            fontWeight: 900, fontSize: 11, padding: '3px 10px',
            borderRadius: 4, letterSpacing: '1px', flexShrink: 0,
          }}>⛔ STAND DOWN</div>
          <div style={{ fontSize: 11, color: '#fca5a5', fontWeight: 700 }}>
            {buildReason(vix, trin, verdict)}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: '#7f1d1d' }}>
            Sit on hands. Protect capital. Wait for conditions to normalize.
          </div>
        </div>
      </>
    )
  }

  if (reduceExposure) {
    return (
      <div style={{
        background: '#100500',
        borderTop: '1px solid #f97316',
        borderBottom: '1px solid #f97316',
        padding: '6px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          background: '#f97316', color: '#000',
          fontWeight: 900, fontSize: 10, padding: '2px 8px',
          borderRadius: 4, letterSpacing: '0.5px', flexShrink: 0,
        }}>⚠ REDUCE EXPOSURE</div>
        <div style={{ fontSize: 10, color: '#fdba74', fontWeight: 600 }}>
          {buildReason(vix, trin, verdict)}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#78350f' }}>
          Half normal size only. Widen stops. No new swing positions.
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: '#080500',
      borderBottom: '1px solid #d97706',
      padding: '4px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        border: '1px solid #d97706', color: '#d97706',
        fontWeight: 800, fontSize: 10, padding: '1px 8px',
        borderRadius: 4, letterSpacing: '0.4px', flexShrink: 0,
      }}>⚡ CAUTION</div>
      <div style={{ fontSize: 10, color: '#92400e', fontWeight: 600 }}>
        {buildReason(vix, trin, verdict)}
      </div>
    </div>
  )
}
