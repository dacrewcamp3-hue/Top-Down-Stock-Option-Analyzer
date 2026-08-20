import { useState, useEffect } from 'react'
import './MarketPulse.css'

// Always compare against Eastern Time — US market hours are ET regardless of where the user is.
// toLocaleString with timeZone rewrites the date values so getHours/getMinutes return ET.
function getMarketStatus() {
  const et  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const min = et.getHours() * 60 + et.getMinutes()
  if (day === 0 || day === 6) return { label: 'CLOSED',    color: '#4a6888' }
  if (min < 4 * 60)           return { label: 'CLOSED',    color: '#4a6888' }
  if (min < 9 * 60 + 30)     return { label: 'PRE-MKT',   color: '#f59e0b' }
  if (min < 16 * 60)          return { label: 'OPEN',      color: '#10b981' }
  if (min < 20 * 60)          return { label: 'AFTER-HRS', color: '#f59e0b' }
  return                              { label: 'CLOSED',    color: '#4a6888' }
}

const VERDICT_STYLE = {
  'FAVORABLE':      { color: '#10b981', bg: '#011c10' },
  'LEANING BULLISH':{ color: '#34d399', bg: '#011c10' },
  'MIXED':          { color: '#f59e0b', bg: '#1a1000' },
  'LEANING BEARISH':{ color: '#f87171', bg: '#1a0505' },
  'HOSTILE':        { color: '#ef4444', bg: '#1a0505' },
  'UNKNOWN':        { color: '#4a6888', bg: '#0a1020' },
}

const VIX_COLOR = v =>
  !v       ? '#4a6888'
  : v < 15 ? '#10b981'
  : v < 20 ? '#34d399'
  : v < 25 ? '#f59e0b'
  : v < 30 ? '#f97316'
  :           '#ef4444'

export default function MarketPulse({ breadthData, vixData }) {
  const [status, setStatus] = useState(getMarketStatus)

  // Re-evaluate every 60 seconds so the pill flips automatically at open/close
  useEffect(() => {
    const id = setInterval(() => setStatus(getMarketStatus()), 60_000)
    return () => clearInterval(id)
  }, [])

  const spy     = breadthData?.spy
  const trin    = breadthData?.trin
  const hl      = breadthData?.hl
  const verdict = breadthData?.verdict ?? 'UNKNOWN'
  const vs      = VERDICT_STYLE[verdict] ?? VERDICT_STYLE['UNKNOWN']

  const vix      = vixData?.current
  const vixColor = VIX_COLOR(vix)
  const vixArrow = vixData?.rising ? '↑' : '↓'

  return (
    <div className="mp-bar">
      {/* Market open/close status */}
      <div className="mp-cell mp-status">
        <span className="mp-dot" style={{ background: status.color }} />
        <span className="mp-val" style={{ color: status.color }}>{status.label}</span>
      </div>

      <div className="mp-div" />

      {/* SPY position */}
      {spy ? (
        <div className="mp-cell">
          <span className="mp-lbl">SPY</span>
          <span className="mp-val">${spy.price?.toFixed(2) ?? '—'}</span>
          <div className="mp-ema-row">
            <span className={`mp-ema-pip ${spy.above15 ? 'bull' : 'bear'}`} title="Above 15 EMA">15</span>
            <span className={`mp-ema-pip ${spy.above65 ? 'bull' : 'bear'}`} title="Above 65 EMA">65</span>
            <span className={`mp-ema-pip ${spy.above200 ? 'bull' : 'bear'}`} title="Above 200 EMA">200</span>
          </div>
        </div>
      ) : (
        <div className="mp-cell">
          <span className="mp-lbl">SPY</span>
          <span className="mp-val mp-dim">—</span>
        </div>
      )}

      <div className="mp-div" />

      {/* VIX */}
      <div className="mp-cell">
        <span className="mp-lbl">VIX</span>
        {vix != null ? (
          <>
            <span className="mp-val" style={{ color: vixColor }}>{vix.toFixed(1)}</span>
            <span className="mp-vix-arrow" style={{ color: vixColor }}>{vixArrow}</span>
            <span className="mp-badge" style={{ color: vixColor, borderColor: vixColor + '55' }}>
              {vixData?.level ?? ''}
            </span>
          </>
        ) : (
          <span className="mp-val mp-dim">—</span>
        )}
      </div>

      <div className="mp-div" />

      {/* Breadth verdict */}
      <div className="mp-cell">
        <span className="mp-lbl">BREADTH</span>
        <span className="mp-badge"
          style={{ color: vs.color, borderColor: vs.color + '55', background: vs.bg }}>
          {verdict}
        </span>
      </div>

      <div className="mp-div" />

      {/* TRIN */}
      <div className="mp-cell">
        <span className="mp-lbl">TRIN</span>
        {trin ? (
          <>
            <span className="mp-val" style={{ color: trin.bullish ? '#10b981' : '#ef4444' }}>
              {trin.value}
            </span>
            <span className="mp-sub">{trin.label}</span>
          </>
        ) : (
          <span className="mp-val mp-dim">—</span>
        )}
      </div>

      <div className="mp-div" />

      {/* New highs vs lows */}
      <div className="mp-cell">
        <span className="mp-lbl">52W H/L</span>
        {hl ? (
          <>
            <span className="mp-val" style={{ color: hl.bullish ? '#10b981' : '#ef4444' }}>
              {hl.highs}<span className="mp-dim">/{hl.lows ?? 0}</span>
            </span>
            {hl.ratio != null && (
              <span className="mp-sub">{hl.ratio}:1</span>
            )}
          </>
        ) : (
          <span className="mp-val mp-dim">—</span>
        )}
      </div>

      {/* IWM small-cap tag */}
      {breadthData?.iwm && (
        <>
          <div className="mp-div" />
          <div className="mp-cell">
            <span className="mp-lbl">IWM</span>
            <div className="mp-ema-row">
              <span className={`mp-ema-pip ${breadthData.iwm.above15 ? 'bull' : 'bear'}`} title="Above 15 EMA">15</span>
              <span className={`mp-ema-pip ${breadthData.iwm.above65 ? 'bull' : 'bear'}`} title="Above 65 EMA">65</span>
              <span className={`mp-ema-pip ${breadthData.iwm.above200 ? 'bull' : 'bear'}`} title="Above 200 EMA">200</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
