// Options P&L vs underlying price — two curves:
//   Solid  = payoff at expiry (intrinsic only)
//   Dashed = mark-to-market at current DTE via Black-Scholes

import { useMemo } from 'react'
import { bsPrice } from '../utils/fetchOptions'

const fSign = v => (v >= 0 ? '+' : '') + (+v).toFixed(2)
const fDol  = v => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0)

export default function OptionsPnlGraph({ S, K, T, sigma, isCall, premium, contracts = 1 }) {
  const pts = useMemo(() => {
    if (!S || !K || !sigma || !premium || premium <= 0) return null
    const STEPS = 120
    const lo = S * 0.65
    const hi = S * 1.35
    const out = []
    for (let i = 0; i <= STEPS; i++) {
      const p = lo + (hi - lo) * i / STEPS
      const expiryPnl  = ((isCall ? Math.max(0, p - K) : Math.max(0, K - p)) - premium) * 100 * contracts
      const currentPnl = T > 0.001
        ? (bsPrice(p, K, T, sigma, isCall) - premium) * 100 * contracts
        : expiryPnl
      out.push({ p, expiryPnl, currentPnl })
    }
    return out
  }, [S, K, T, sigma, isCall, premium, contracts])

  if (!pts) return null

  const W = 560, H = 190
  const PL = 54, PR = 16, PT = 16, PB = 34
  const iW = W - PL - PR
  const iH = H - PT - PB

  const lo = pts[0].p
  const hi = pts[pts.length - 1].p
  const allV = pts.flatMap(d => [d.expiryPnl, d.currentPnl])
  const rawMin = Math.min(...allV)
  const rawMax = Math.max(...allV)
  const span  = rawMax - rawMin || premium * 100 * contracts
  const minV  = rawMin - span * 0.08
  const maxV  = rawMax + span * 0.08

  const xs = p => PL + (p - lo) / (hi - lo) * iW
  const ys = v => PT + (1 - (v - minV) / (maxV - minV)) * iH
  const y0 = ys(0)

  const toPath = key => pts.map((d, i) =>
    `${i === 0 ? 'M' : 'L'}${xs(d.p).toFixed(1)},${ys(d[key]).toFixed(1)}`
  ).join(' ')

  const exPath  = toPath('expiryPnl')
  const curPath = toPath('currentPnl')

  const be     = isCall ? K + premium : K - premium
  const curMk  = T > 0.001
    ? (bsPrice(S, K, T, sigma, isCall) - premium) * 100 * contracts
    : ((isCall ? Math.max(0, S - K) : Math.max(0, K - S)) - premium) * 100 * contracts
  const maxLoss = -premium * 100 * contracts

  const col    = isCall ? '#10b981' : '#ef4444'
  const colFad = isCall ? '#34d399' : '#f87171'

  // y-axis ticks
  const yTicks = []
  const nTicks = 5
  for (let i = 0; i <= nTicks; i++) {
    yTicks.push(minV + (maxV - minV) * i / nTicks)
  }

  // x-axis ticks (5 points)
  const xTicks = [lo, lo + (hi - lo) * 0.25, S, lo + (hi - lo) * 0.75, hi]

  return (
    <div className="pnlg-root">
      <div className="pnlg-head">
        <span className="pnlg-title">P&amp;L vs Price</span>
        <div className="pnlg-stats">
          <span className="pnlg-stat" style={{ color: curMk >= 0 ? '#10b981' : '#ef4444' }}>
            Now {fDol(curMk)}
          </span>
          <span className="pnlg-stat pnlg-sep" />
          <span className="pnlg-stat">BE&nbsp;${be.toFixed(2)}</span>
          <span className="pnlg-stat pnlg-sep" />
          <span className="pnlg-stat" style={{ color: '#ef4444' }}>Max Loss {fDol(maxLoss)}</span>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="pnlg-svg">
        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <line key={i} x1={PL} y1={ys(v).toFixed(1)} x2={W - PR} y2={ys(v).toFixed(1)}
            stroke="#0d1e32" strokeWidth="1" />
        ))}

        {/* Zero line */}
        {y0 >= PT && y0 <= PT + iH && (
          <line x1={PL} y1={y0.toFixed(1)} x2={W - PR} y2={y0.toFixed(1)}
            stroke="#243550" strokeWidth="1.5" />
        )}

        {/* Breakeven vertical */}
        {be >= lo && be <= hi && (
          <>
            <line x1={xs(be).toFixed(1)} y1={PT} x2={xs(be).toFixed(1)} y2={PT + iH}
              stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="3,3" />
            <text x={xs(be).toFixed(1)} y={PT + iH + 27} textAnchor="middle"
              fill="#f59e0b" fontSize="8.5" fontFamily="monospace">BE</text>
          </>
        )}

        {/* Strike vertical */}
        <line x1={xs(K).toFixed(1)} y1={PT} x2={xs(K).toFixed(1)} y2={PT + iH}
          stroke="#374151" strokeWidth="0.8" strokeDasharray="2,3" />

        {/* Current price vertical */}
        <line x1={xs(S).toFixed(1)} y1={PT} x2={xs(S).toFixed(1)} y2={PT + iH}
          stroke="#3b82f6" strokeWidth="0.8" strokeDasharray="3,3" />

        {/* Today curve (dashed) */}
        <path d={curPath} fill="none" stroke={colFad} strokeWidth="1.5" strokeDasharray="5,3" />

        {/* Expiry curve (solid) */}
        <path d={exPath} fill="none" stroke={col} strokeWidth="2.2" />

        {/* Y axis labels */}
        {yTicks.map((v, i) => (
          <text key={i} x={PL - 4} y={ys(v) + 4} textAnchor="end"
            fill="#3a5070" fontSize="9" fontFamily="monospace">
            {v >= 0 ? '+' : ''}{Math.round(v)}
          </text>
        ))}

        {/* X axis labels */}
        {xTicks.map((p, i) => (
          <text key={i} x={xs(p).toFixed(1)} y={PT + iH + 14} textAnchor="middle"
            fill="#3a5070" fontSize="9" fontFamily="monospace">
            {p.toFixed(0)}
          </text>
        ))}

        {/* Labels: S and K */}
        <text x={xs(S).toFixed(1)} y={PT - 3} textAnchor="middle" fill="#60a5fa" fontSize="8.5" fontWeight="700">S</text>
        <text x={xs(K).toFixed(1)} y={PT - 3} textAnchor="middle" fill="#6b7280" fontSize="8.5">K</text>

        {/* Legend */}
        <line x1={W - 110} y1={PT + 8} x2={W - 92} y2={PT + 8} stroke={col} strokeWidth="2.2" />
        <text x={W - 88} y={PT + 12} fill="#7a9ab8" fontSize="8.5" fontFamily="sans-serif">At Expiry</text>
        <line x1={W - 110} y1={PT + 21} x2={W - 92} y2={PT + 21} stroke={colFad} strokeWidth="1.5" strokeDasharray="4,3" />
        <text x={W - 88} y={PT + 25} fill="#7a9ab8" fontSize="8.5" fontFamily="sans-serif">Today</text>
      </svg>
    </div>
  )
}
