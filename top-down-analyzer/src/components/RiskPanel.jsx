import { useState, useEffect } from 'react'
import './RiskPanel.css'

function getPatternInfo(patterns, hsPatterns, swingSignal) {
  const db  = patterns?.doubleBottom
  const dt  = patterns?.doubleTop
  const hs  = hsPatterns?.headAndShoulders
  const ihs = hsPatterns?.inverseHAndS

  const bullList = [
    db  && { stop: db.neckline - (db.neckline - db.trough2) * 0.1, target: db.target,  type: 'DOUBLE BOTTOM',        bull: true },
    ihs && { stop: ihs.neckline * 0.98,                             target: ihs.target, type: 'INV. HEAD & SHOULDERS', bull: true },
  ].filter(Boolean)

  const bearList = [
    dt  && { stop: dt.neckline + (dt.peak2 - dt.neckline) * 0.1,  target: dt.target,  type: 'DOUBLE TOP',        bull: false },
    hs  && { stop: hs.neckline * 1.02,                             target: hs.target,  type: 'HEAD & SHOULDERS',  bull: false },
  ].filter(Boolean)

  const swingBull = swingSignal === 'LONG'
  const swingBear = swingSignal === 'EXIT'

  if (swingBull) {
    if (bullList.length > 0) return { ...bullList[0], conflict: false }
    if (bearList.length > 0) return { ...bearList[0], conflict: true }
  }
  if (swingBear) {
    if (bearList.length > 0) return { ...bearList[0], conflict: false }
    if (bullList.length > 0) return { ...bullList[0], conflict: true }
  }
  // No swing signal yet — show first available pattern
  return (bullList[0] ?? bearList[0] ?? null)
}

export default function RiskPanel({ patterns, hsPatterns, currentPrice, grade, onLogTrade, swingSignal }) {
  const [accountSize, setAccountSize] = useState(() => {
    try { return +localStorage.getItem('rp_account') || 25000 } catch { return 25000 }
  })
  const [riskPct, setRiskPct] = useState(() => {
    try { return +localStorage.getItem('rp_risk_pct') || 1.0 } catch { return 1.0 }
  })

  useEffect(() => { try { localStorage.setItem('rp_account',  accountSize) } catch {} }, [accountSize])
  useEffect(() => { try { localStorage.setItem('rp_risk_pct', riskPct)     } catch {} }, [riskPct])

  const info = getPatternInfo(patterns, hsPatterns, swingSignal)
  if (!info || !currentPrice) return null

  const { stop: stopPrice, target: targetPrice, type: patternType, bull, conflict } = info
  const riskPerShare = Math.abs(currentPrice - stopPrice)
  const maxRisk      = accountSize * (riskPct / 100)
  const shares       = riskPerShare > 0 ? Math.min(Math.round(maxRisk / riskPerShare), 99999) : 0
  const targetDist   = Math.abs(targetPrice - currentPrice)
  const rrRatio      = riskPerShare > 0 ? +(targetDist / riskPerShare).toFixed(2) : 0

  const dirColor = bull ? '#10b981' : '#ef4444'
  const rrColor  = rrRatio >= 2 ? '#10b981' : rrRatio >= 1.5 ? '#f59e0b' : '#ef4444'

  function handleLog() {
    onLogTrade?.({
      id: Date.now(),
      date: new Date().toISOString().slice(0, 10),
      action: bull ? 'BUY CALLS' : 'BUY PUTS',
      pattern: patternType,
      grade: grade?.grade ?? '—',
      entryPrice: +currentPrice.toFixed(2),
      stopPrice: +stopPrice.toFixed(2),
      targetPrice: +targetPrice.toFixed(2),
      rrRatio,
      shares,
      maxRisk: +maxRisk.toFixed(2),
      notes: '',
      exitDate: null, exitPrice: null, pnl: null, result: null,
    })
  }

  return (
    <div className="risk-panel">
      <div className="risk-panel-head">
        <span className="risk-panel-title">RISK MANAGEMENT</span>
        <span className="risk-pattern-tag" style={{ color: dirColor }}>
          {bull ? '▲' : '▼'} {patternType}
        </span>
      </div>

      {conflict ? (
        <div className="risk-conflict">
          <span className="risk-conflict-icon">⚠</span>
          <div className="risk-conflict-body">
            <span className="risk-conflict-title">Pattern conflicts with swing signal — do not trade</span>
            <span className="risk-conflict-sub">
              {bull
                ? `${patternType} is a bullish reversal pattern, but the 4H swing signal says EXIT. Wait for the swing to turn LONG before entering calls.`
                : `${patternType} is a bearish reversal pattern, but the 4H swing signal says LONG. Wait for the swing to turn EXIT before entering puts.`}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="risk-inputs-row">
            <div className="risk-input-group">
              <label className="risk-input-label">Account $</label>
              <input
                className="risk-input"
                type="number"
                min="0"
                value={accountSize}
                onChange={e => setAccountSize(Math.max(0, +e.target.value))}
              />
            </div>
            <div className="risk-input-group">
              <label className="risk-input-label">Risk %</label>
              <input
                className="risk-input risk-input-small"
                type="number"
                step="0.1"
                min="0.1"
                max="5"
                value={riskPct}
                onChange={e => setRiskPct(Math.min(5, Math.max(0.1, +e.target.value)))}
              />
            </div>
          </div>

          <div className="risk-calc-grid">
            <div className="risk-cell">
              <span className="risk-cell-label">Entry</span>
              <span className="risk-cell-val">${currentPrice.toFixed(2)}</span>
            </div>
            <div className="risk-cell">
              <span className="risk-cell-label">Stop</span>
              <span className="risk-cell-val" style={{ color: '#ef4444' }}>${stopPrice.toFixed(2)}</span>
            </div>
            <div className="risk-cell">
              <span className="risk-cell-label">Target</span>
              <span className="risk-cell-val" style={{ color: '#10b981' }}>${targetPrice.toFixed(2)}</span>
            </div>
            <div className="risk-cell">
              <span className="risk-cell-label">R:R</span>
              <span className="risk-cell-val" style={{ color: rrColor }}>{rrRatio}:1</span>
            </div>
            <div className="risk-cell">
              <span className="risk-cell-label">Max Risk</span>
              <span className="risk-cell-val">${maxRisk.toFixed(0)}</span>
            </div>
            <div className="risk-cell">
              <span className="risk-cell-label">Shares</span>
              <span className="risk-cell-val">{shares.toLocaleString()}</span>
            </div>
          </div>

          <div className="risk-options-row">
            <span className="risk-opt-label">Options</span>
            <span className="risk-opt-dte">30–60 DTE</span>
            <span className="risk-opt-delta" style={{ color: dirColor }}>
              {bull ? '0.40–0.55Δ call' : '0.40–0.55Δ put'}
            </span>
          </div>

          {onLogTrade && (
            <button className="risk-log-btn" onClick={handleLog}>
              + Log Trade
            </button>
          )}
        </>
      )}
    </div>
  )
}
