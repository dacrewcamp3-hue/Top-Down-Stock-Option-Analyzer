import { useState, useEffect, useRef, useCallback } from 'react'
import { scanUnusualFlow } from '../utils/runFlowScanner'
import './FlowTape.css'

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function fmtPrem(n) {
  if (!n) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

const FLOW_COLOR = {
  SWEEP: '#f59e0b',
  HEAVY: '#60a5fa',
  ACTIVE:'#7a9ab8',
  ELEV:  '#4a6888',
}

const POLL_MS = 45_000

function printKey(f) {
  return `${f.ticker}|${f.type}|${f.strike}|${f.expDate}`
}

function flowTip(flowType, contractType) {
  const isCall = contractType === 'CALL'
  switch (flowType) {
    case 'SWEEP':
      return isCall
        ? 'BULLISH — Trader swept CALL options across every exchange at once, paying any price to fill fast. Maximum urgency. Someone is betting this stock goes up — now.'
        : 'BEARISH — Trader swept PUT options across every exchange at once, paying any price to fill fast. Maximum urgency. Someone is betting this stock drops — now.'
    case 'HEAVY':
      return isCall
        ? 'BULLISH — CALL volume already exceeds open interest. That means new money is opening fresh positions, not recycling old ones. Strong directional conviction to the upside.'
        : 'BEARISH — PUT volume already exceeds open interest. New money opening fresh short positions. Strong directional conviction to the downside.'
    case 'ACTIVE':
      return isCall
        ? 'MILD BULLISH LEAN — CALL activity is elevated above normal. Not a blaring alarm, but worth watching. Multiple ACTIVE prints on the same ticker often precede something bigger.'
        : 'MILD BEARISH LEAN — PUT activity is elevated above normal. Not a blaring alarm, but worth watching. Multiple ACTIVE prints on the same ticker often precede something bigger.'
    case 'ELEV':
      return isCall
        ? 'SLIGHTLY ELEVATED — More CALL trading than usual but below the unusual threshold. Watch for follow-through.'
        : 'SLIGHTLY ELEVATED — More PUT trading than usual but below the unusual threshold. Watch for follow-through.'
    default:
      return null
  }
}

export default function FlowTape({ watchlist }) {
  const [tape,     setTape]     = useState([])
  const [status,   setStatus]   = useState('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const seenRef  = useRef(new Set())
  const initRef  = useRef(false)

  const tickers = [...new Set((watchlist ?? []).map(w => w.ticker))].filter(Boolean)

  const poll = useCallback(async () => {
    if (tickers.length === 0) return
    setStatus('scanning')
    setProgress({ done: 0, total: tickers.length })
    try {
      const { flows } = await scanUnusualFlow(tickers, (done, total) => {
        setProgress({ done, total })
      })

      const now = Date.now()
      const isFirst = !initRef.current

      if (isFirst) {
        initRef.current = true
        const initial = flows.slice(0, 60).map(f => ({ ...f, _ts: now, _isNew: false, _key: printKey(f) }))
        seenRef.current = new Set(flows.map(printKey))
        setTape(initial)
        setStatus('live')
        return
      }

      const newPrints = flows
        .filter(f => !seenRef.current.has(printKey(f)))
        .map(f => ({ ...f, _ts: now, _isNew: true, _key: printKey(f) }))

      seenRef.current = new Set(flows.map(printKey))

      if (newPrints.length > 0) {
        setTape(prev => {
          const updated = [...newPrints, ...prev.map(p => ({ ...p, _isNew: false }))].slice(0, 80)
          return updated
        })
      }

      setStatus('live')
    } catch (err) {
      console.warn('[FlowTape]', err.message)
      setStatus('live')
    }
  }, [tickers.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tickers.length === 0) return
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [poll])

  const isEmpty  = tape.length === 0 && status !== 'scanning'
  const scanning = status === 'scanning'

  return (
    <div className="ft-root">
      <div className="ft-header">
        <span className="ft-title">LIVE FLOW TAPE</span>
        {scanning ? (
          <span className="ft-status ft-scanning">
            <span className="ft-scan-spinner" />
            Scanning {progress.done}/{progress.total}
          </span>
        ) : status === 'live' ? (
          <span className="ft-status ft-live">
            <span className="ft-live-dot" />LIVE · refreshes every 45s
          </span>
        ) : null}
        <span className="ft-ticker-count">{tickers.length} tickers</span>
      </div>

      <div className="ft-col-hdr">
        <span style={{ width: 60 }}>TIME</span>
        <span style={{ width: 54 }}>TICKER</span>
        <span style={{ width: 42 }}>TYPE</span>
        <span style={{ width: 60 }}>STRIKE</span>
        <span style={{ width: 72 }}>EXP</span>
        <span style={{ width: 52 }}>VOL</span>
        <span style={{ width: 52 }}>OI</span>
        <span style={{ width: 52 }}>V/OI</span>
        <span style={{ width: 72 }}>PREMIUM</span>
        <span style={{ width: 80 }}>TOTAL $</span>
        <span style={{ width: 50 }}>FLOW</span>
        <span style={{ width: 44 }}>BIAS</span>
      </div>

      <div className="ft-list">
        {isEmpty && (
          <div className="ft-empty">
            {tickers.length === 0
              ? 'Add tickers to your watchlist to start the flow tape.'
              : 'No unusual flow detected in the current watchlist.'}
          </div>
        )}

        {scanning && tape.length === 0 && (
          <div className="ft-empty ft-loading">
            Scanning {tickers.join(', ')} for unusual activity…
          </div>
        )}

        {tape.map((f, i) => {
          const isCall = f.type === 'CALL'
          const typeCol = isCall ? '#00c77a' : '#ff4d4d'
          const flowCol = FLOW_COLOR[f.flowType] ?? '#4a6888'
          const tip = flowTip(f.flowType, f.type)

          return (
            <div
              key={`${f._key}-${i}`}
              className={`ft-row${f._isNew ? ' ft-new' : ''}`}
            >
              <span className="ft-cell ft-time">{fmtTime(f._ts)}</span>
              <span className="ft-cell ft-ticker">{f.ticker}</span>
              <span className="ft-cell ft-type" style={{ color: typeCol }}>
                {f.type}
              </span>
              <span className="ft-cell ft-strike">${f.strike}</span>
              <span className="ft-cell ft-exp">{f.expDate}</span>
              <span className="ft-cell ft-num">{f.volume?.toLocaleString()}</span>
              <span className="ft-cell ft-num ft-muted">{f.oi?.toLocaleString()}</span>
              <span className="ft-cell ft-num" style={{ color: f.volOI >= 1 ? '#f59e0b' : '#7a9ab8' }}>
                {f.volOI?.toFixed(2)}x
              </span>
              <span className="ft-cell ft-num">${f.premium?.toFixed(2)}</span>
              <span className="ft-cell ft-prem" style={{ color: f.totalPrem >= 500_000 ? '#f59e0b' : '#7a9ab8' }}>
                {fmtPrem(f.totalPrem)}
              </span>
              <span
                className="ft-cell ft-flow"
                style={{ color: flowCol, borderColor: flowCol + '55', cursor: tip ? 'help' : 'default' }}
                title={tip ?? undefined}
              >
                {f.flowType}
              </span>
              <span className="ft-cell ft-bias" style={{ color: f.inTheMoney ? '#6b7280' : '#60a5fa' }}>
                {f.bias}
              </span>
            </div>
          )
        })}
      </div>

      <div className="ft-legend">
        <span><span style={{ color: '#f59e0b' }}>SWEEP</span> Vol/OI ≥ 2×</span>
        <span><span style={{ color: '#60a5fa' }}>HEAVY</span> Vol/OI ≥ 1×</span>
        <span><span style={{ color: '#7a9ab8' }}>ACTIVE</span> Vol/OI ≥ 0.5×</span>
        <span><span style={{ color: '#60a5fa' }}>SPEC</span> = OTM directional bet</span>
        <span><span style={{ color: '#6b7280' }}>HEDGE</span> = in-the-money (protective)</span>
      </div>
    </div>
  )
}
