import { useState, useEffect } from 'react'
import { fetchEarningsHistory } from '../utils/fetchEarnings'
import './EarningsMode.css'

// Black-Scholes d1/d2
function bsD(S, K, r, sigma, T) {
  const sqT = Math.sqrt(T)
  const d1  = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqT)
  const d2  = d1 - sigma * sqT
  return { d1, d2 }
}
function normCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))))
  return x >= 0 ? 1 - p : p
}
function bsCall(S, K, r, sigma, T) {
  if (T <= 0) return Math.max(0, S - K)
  const { d1, d2 } = bsD(S, K, r, sigma, T)
  return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
}
function bsPut(S, K, r, sigma, T) {
  if (T <= 0) return Math.max(0, K - S)
  const { d1, d2 } = bsD(S, K, r, sigma, T)
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1)
}

function fmtDate(d) {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function EarningsRow({ e }) {
  const bull  = e.priceMove != null && e.priceMove >= 0
  const moveColor = e.priceMove == null ? '#3a5070'
    : e.priceMove >= 0 ? '#10b981' : '#ef4444'
  const surprise  = e.surprise != null
  const beat      = surprise && e.surprise >= 0

  return (
    <div className="em-hist-row">
      <span className="em-hist-date">{fmtDate(e.date)}</span>
      <span className="em-hist-qtr">{e.quarter}</span>
      <div className="em-hist-eps">
        <span className="em-hist-act">{e.epsActual?.toFixed(2) ?? '—'}</span>
        <span className="em-hist-est">est {e.epsEstimate?.toFixed(2) ?? '—'}</span>
      </div>
      {surprise != null && (
        <span className={`em-hist-surp${beat ? ' em-beat' : ' em-miss'}`}>
          {beat ? '▲' : '▼'} {Math.abs(e.surprise * 100).toFixed(1)}%
        </span>
      )}
      <span className="em-hist-move" style={{ color: moveColor }}>
        {e.priceMove != null ? `${e.priceMove >= 0 ? '+' : ''}${e.priceMove}%` : '—'}
      </span>
    </div>
  )
}

export default function EarningsMode({ ticker, currentPrice, ivData, dailyCloses, dailyTimestamps }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [fetchErr, setFetchErr] = useState(null)
  const [strDTE,  setStrDTE]  = useState('30')

  useEffect(() => {
    if (!ticker) return
    setData(null)
    setFetchErr(null)
    setLoading(true)
    fetchEarningsHistory(ticker, dailyCloses, dailyTimestamps)
      .then(result => {
        if (result) {
          setData(result)
        } else {
          setFetchErr('Yahoo Finance returned no earnings data for this ticker.')
        }
      })
      .catch(err => setFetchErr(err.message))
      .finally(() => setLoading(false))
  }, [ticker])   // intentionally exclude dailyCloses/dailyTimestamps — they arrive async

  if (!ticker)   return <div className="em-empty">Load a ticker to see earnings analysis.</div>
  if (loading)   return <div className="em-empty">Loading earnings data for {ticker}…</div>
  if (fetchErr)  return (
    <div className="em-empty" style={{ color: '#9a5050' }}>
      Earnings data unavailable for {ticker}.<br />
      <span style={{ fontSize: 11, color: '#3a5070', marginTop: 6, display: 'block' }}>{fetchErr}</span>
    </div>
  )
  if (!data)     return <div className="em-empty">Earnings data unavailable for {ticker}.</div>

  const { history, nextDate, dteToNext, avgMove, bullPct, trailingEPS, forwardPE, pegRatio, shortFloat } = data

  // Straddle pricing
  const S     = currentPrice ?? 100
  const K     = S                              // ATM
  const r     = 0.05                           // risk-free rate
  const sigma = ivData?.atmIV != null ? ivData.atmIV / 100 : (avgMove ? avgMove / 100 * 2 : 0.30)
  const dte   = Math.max(1, parseInt(strDTE) || 30)
  const T     = dte / 365

  const callPx   = bsCall(S, K, r, sigma, T)
  const putPx    = bsPut(S, K, r, sigma, T)
  const straddle = callPx + putPx
  const beUp     = S + straddle
  const beDn     = S - straddle
  const implMove = sigma * Math.sqrt(T) * 0.8   // rough implied-move estimate
  const implMovePct = +(implMove * 100).toFixed(1)

  // Expected move from straddle premium
  const straddlePct = +(straddle / S * 100).toFixed(1)

  // Historical vs implied
  const histVsImpl = avgMove && straddlePct
    ? (avgMove > straddlePct ? 'CHEAP (hist > impl)' : 'EXPENSIVE (hist < impl)')
    : null

  const daysLabel = dteToNext != null
    ? dteToNext <= 0 ? 'TODAY / AFTER CLOSE'
      : dteToNext === 1 ? 'TOMORROW'
      : `${dteToNext} days away`
    : null

  const urgency = dteToNext != null && dteToNext <= 14

  return (
    <div className="em-root">
      {/* Header */}
      <div className="em-header">
        <div className="em-header-left">
          <span className="em-ticker">{ticker}</span>
          <span className="em-subtitle">Earnings Analysis</span>
        </div>
        {nextDate && (
          <div className={`em-next-badge${urgency ? ' em-urgent' : ''}`}>
            <span className="em-next-label">Next Earnings</span>
            <span className="em-next-date">{fmtDate(nextDate)}</span>
            {daysLabel && <span className="em-next-dte">{daysLabel}</span>}
          </div>
        )}
      </div>

      {/* Earnings warning */}
      {urgency && (
        <div className="em-warn">
          ⚠ Earnings within {dteToNext} day{dteToNext !== 1 ? 's' : ''}. Any option expiring after this date becomes a volatility bet — your directional edge disappears.
          Use a defined-risk spread or close before earnings if you're in a single-leg position.
        </div>
      )}

      {/* Key stats */}
      <div className="em-stats">
        {avgMove != null && (
          <div className="em-stat">
            <span className="em-stat-l">Avg Earnings Move</span>
            <span className="em-stat-v">±{avgMove}%</span>
            <span className="em-stat-s">last {history.filter(e => e.priceMove != null).length} qtrs</span>
          </div>
        )}
        {bullPct != null && (
          <div className="em-stat">
            <span className="em-stat-l">Bull Reactions</span>
            <span className={`em-stat-v${bullPct >= 60 ? ' em-green' : bullPct <= 40 ? ' em-red' : ''}`}>{bullPct}%</span>
            <span className="em-stat-s">of quarters up</span>
          </div>
        )}
        {trailingEPS != null && (
          <div className="em-stat">
            <span className="em-stat-l">Trailing EPS</span>
            <span className="em-stat-v">${trailingEPS.toFixed(2)}</span>
          </div>
        )}
        {forwardPE != null && (
          <div className="em-stat">
            <span className="em-stat-l">Forward P/E</span>
            <span className="em-stat-v">{forwardPE.toFixed(1)}×</span>
          </div>
        )}
        {pegRatio != null && (
          <div className="em-stat">
            <span className="em-stat-l">PEG Ratio</span>
            <span className={`em-stat-v${pegRatio < 1 ? ' em-green' : pegRatio > 2 ? ' em-red' : ''}`}>{pegRatio.toFixed(2)}</span>
            <span className="em-stat-s">{pegRatio < 1 ? 'undervalued' : pegRatio > 2 ? 'expensive' : 'fair'}</span>
          </div>
        )}
        {shortFloat != null && (
          <div className="em-stat">
            <span className="em-stat-l">Short Float</span>
            <span className={`em-stat-v${shortFloat > 0.15 ? ' em-red' : ''}`}>
              {(shortFloat * 100).toFixed(1)}%
            </span>
            <span className="em-stat-s">{shortFloat > 0.15 ? 'high — squeeze risk' : ''}</span>
          </div>
        )}
      </div>

      {/* Straddle pricer */}
      <div className="em-straddle">
        <div className="em-straddle-title">ATM Straddle Pricer</div>
        <div className="em-straddle-sub">
          Black-Scholes pricing at current stock price. Use this to evaluate whether options are pricing a large enough move before earnings.
        </div>

        <div className="em-straddle-controls">
          <div className="em-straddle-ctrl">
            <span className="em-ctrl-label">Stock price</span>
            <span className="em-ctrl-val">${S.toFixed(2)}</span>
          </div>
          <div className="em-straddle-ctrl">
            <span className="em-ctrl-label">IV used</span>
            <span className="em-ctrl-val">{(sigma * 100).toFixed(1)}%</span>
            <span className="em-ctrl-note">{ivData?.atmIV != null ? 'live ATM IV' : 'estimated from hist move'}</span>
          </div>
          <div className="em-straddle-ctrl">
            <span className="em-ctrl-label">DTE</span>
            <div className="em-dte-input-wrap">
              <input
                className="em-dte-input"
                type="number"
                min="1"
                max="365"
                value={strDTE}
                onChange={e => setStrDTE(e.target.value)}
              />
              <span className="em-ctrl-note">days</span>
            </div>
          </div>
        </div>

        <div className="em-straddle-results">
          <div className="em-str-block em-str-call">
            <span className="em-str-label">Call Premium</span>
            <span className="em-str-val">${callPx.toFixed(2)}</span>
          </div>
          <div className="em-str-block em-str-put">
            <span className="em-str-label">Put Premium</span>
            <span className="em-str-val">${putPx.toFixed(2)}</span>
          </div>
          <div className="em-str-block em-str-total">
            <span className="em-str-label">Straddle Cost</span>
            <span className="em-str-val em-str-big">${straddle.toFixed(2)}</span>
            <span className="em-str-sub">{straddlePct}% of stock price</span>
          </div>
        </div>

        <div className="em-breakeven">
          <div className="em-be-row">
            <span className="em-be-label">Break-even Up</span>
            <span className="em-be-val em-green">${beUp.toFixed(2)}</span>
            <span className="em-be-pct em-green">+{straddlePct}%</span>
          </div>
          <div className="em-be-row">
            <span className="em-be-label">Break-even Down</span>
            <span className="em-be-val em-red">${beDn.toFixed(2)}</span>
            <span className="em-be-pct em-red">-{straddlePct}%</span>
          </div>
          {histVsImpl && (
            <div className="em-hist-vs-impl">
              <span className="em-hvi-label">Straddle vs historical move</span>
              <span className={`em-hvi-val${histVsImpl.startsWith('CHEAP') ? ' em-green' : ' em-orange'}`}>
                {histVsImpl}
              </span>
              <span className="em-hvi-note">
                Avg historical move: ±{avgMove}% · Straddle prices: ±{straddlePct}%
              </span>
            </div>
          )}
        </div>

        <div className="em-straddle-rule">
          <span className="em-rule-icon">⚡</span>
          <span className="em-rule-text">
            If the straddle costs MORE than the average historical move — options are overpriced relative to the expected move.
            Selling spreads or using defined-risk structures may be more efficient than buying the straddle outright.
            If it costs LESS — options are cheap relative to history. The market may be underpricing this event.
          </span>
        </div>
      </div>

      {/* History table */}
      {history.length > 0 && (
        <div className="em-history">
          <div className="em-history-title">Quarterly Earnings History</div>
          <div className="em-hist-hdr">
            <span>Date</span>
            <span>Period</span>
            <span>EPS</span>
            <span>Surprise</span>
            <span>Stock Move</span>
          </div>
          {history.slice(0, 8).map((e, i) => <EarningsRow key={i} e={e} />)}
        </div>
      )}
    </div>
  )
}
