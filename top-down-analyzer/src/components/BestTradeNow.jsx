import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchQuickSignal } from '../utils/fetchQuickSignal'
import './BestTradeNow.css'

export default function BestTradeNow({ watchlist, onLoadTicker, currentTicker }) {
  const [results, setResults]   = useState([])
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState(null)
  const [scanErr,  setScanErr]  = useState(null)
  const hasScanned = useRef(false)

  const scan = useCallback(async () => {
    if (!watchlist?.length || scanning) return
    setScanning(true)
    setScanErr(null)
    try {
      const promises = watchlist.map(w =>
        fetchQuickSignal(w.ticker).catch(e => ({ ticker: w.ticker, error: true }))
      )
      const raw  = await Promise.all(promises)
      const hits = raw.filter(r => r != null && !r.error && (r.signal === 'CALL' || r.signal === 'PUT'))

      const ranked = [...hits].sort((a, b) => {
        // Strength = distance from 50. CALL strength = score, PUT strength = 100 - score.
        const aStr = a.signal === 'CALL' ? a.score : 100 - a.score
        const bStr = b.signal === 'CALL' ? b.score : 100 - b.score
        return bStr - aStr
      })

      setResults(ranked.slice(0, 3))
      setLastScan(new Date())
      if (!ranked.length) setScanErr('No strong setups found')
    } catch {
      setScanErr('Scan failed — check connection')
    } finally {
      setScanning(false)
    }
  }, [watchlist, scanning])

  // Auto-scan on first render if watchlist exists
  useEffect(() => {
    if (watchlist?.length && !hasScanned.current) {
      hasScanned.current = true
      scan()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist?.length])

  if (!watchlist?.length) return null

  return (
    <div className="btn-root">
      <div className="btn-header">
        <span className="btn-title">BEST TRADE NOW</span>
        <div className="btn-header-right">
          {lastScan && (
            <span className="btn-scan-time">
              {lastScan.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            className={`btn-scan-btn${scanning ? ' btn-scanning' : ''}`}
            onClick={scan}
            disabled={scanning}
          >
            {scanning ? <span className="btn-spin" /> : '↻ Rescan'}
          </button>
        </div>
      </div>

      {scanning && !results.length && (
        <div className="btn-loading">
          <span className="btn-spin btn-spin-lg" />
          Scanning {watchlist.length} ticker{watchlist.length !== 1 ? 's' : ''} for strongest setup…
        </div>
      )}

      {!scanning && scanErr && !results.length && (
        <div className="btn-empty">{scanErr} — add tickers to your watchlist first.</div>
      )}

      {results.length > 0 && (
        <div className="btn-results">
          {results.map((r, i) => {
            const isCall    = r.signal === 'CALL'
            const isCurrent = r.ticker === currentTicker
            const strength  = isCall ? r.score : 100 - r.score
            const dirColor  = isCall ? '#10b981' : '#ef4444'
            const dirBg     = isCall ? '#01140a' : '#130105'

            return (
              <div
                key={r.ticker}
                className={`btn-result${i === 0 ? ' btn-result-top' : ''}`}
                style={{ borderLeftColor: dirColor, background: i === 0 ? dirBg : undefined }}
              >
                <div className="btn-rank-col">
                  <span className="btn-rank" style={{ color: i === 0 ? dirColor : '#4a6888' }}>
                    #{i + 1}
                  </span>
                  {i === 0 && (
                    <span className="btn-top-badge" style={{ color: dirColor, borderColor: `${dirColor}40` }}>
                      BEST
                    </span>
                  )}
                </div>

                <div className="btn-body">
                  <div className="btn-top-row">
                    <span className="btn-ticker">{r.ticker}</span>
                    <span className="btn-signal" style={{ color: dirColor }}>
                      {isCall ? '▲' : '▼'} {r.signal}
                    </span>
                    <span className="btn-score-pill" style={{ color: dirColor, borderColor: `${dirColor}40` }}>
                      {r.score}/100
                    </span>
                    <div
                      className="btn-bar-track"
                      title={`Signal strength ${strength}%`}
                    >
                      <div
                        className="btn-bar-fill"
                        style={{ width: `${strength}%`, background: dirColor }}
                      />
                    </div>
                  </div>
                  <div className="btn-detail-row">
                    {r.price  != null && <span>Price ${r.price.toFixed(2)}</span>}
                    {r.wRSI   != null && <span>wRSI {r.wRSI.toFixed(0)}</span>}
                    {r.dRSI   != null && <span>dRSI {r.dRSI.toFixed(0)}</span>}
                    {r.pct52  != null && <span>{r.pct52 >= 0 ? '+' : ''}{r.pct52.toFixed(1)}% 52wk</span>}
                    {r.cyclePhase      && <span className="btn-phase" style={{ color: r.cycleColor ?? '#6b7280' }}>{r.cyclePhase}</span>}
                  </div>
                </div>

                <div className="btn-action-col">
                  {isCurrent
                    ? <span className="btn-loaded-badge">LOADED</span>
                    : (
                      <button
                        className="btn-load-btn"
                        style={{ color: dirColor, borderColor: `${dirColor}40` }}
                        onClick={() => onLoadTicker(r.ticker)}
                      >
                        LOAD THIS
                      </button>
                    )
                  }
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="btn-footer">
        Scores from quick signal scan (8 checks across weekly + daily). Full analysis loads when you click a ticker.
      </div>
    </div>
  )
}
