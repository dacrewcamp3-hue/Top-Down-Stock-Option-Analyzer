import { useState } from 'react'
import { scanUnusualFlow } from '../utils/runFlowScanner'
import { UNIVERSE } from '../utils/runScanner'
import './FlowScanner.css'

const f2 = v => v != null ? (+v).toFixed(2) : '—'

// ── Sentiment strip ───────────────────────────────────────────────────────────
function SentimentStrip({ sentiment }) {
  const entries = Object.entries(sentiment)
  if (!entries.length) return null

  return (
    <div className="fl-sentiment">
      <div className="fl-sent-label">Call / Put Volume Ratio by Ticker</div>
      <div className="fl-sent-rows">
        {entries.map(([sym, s]) => {
          const total = s.callVol + s.putVol
          if (!total) return null
          const callPct = Math.round((s.callVol / total) * 100)
          const isBull  = callPct >= 60
          const isBear  = callPct <= 40
          const barClr  = isBull ? '#10b981' : isBear ? '#ef4444' : '#6b7280'
          return (
            <div key={sym} className="fl-sent-row">
              <span className="fl-sent-sym">{sym}</span>
              <div className="fl-sent-bar-wrap">
                <div className="fl-sent-bar-fill" style={{ width: `${callPct}%`, background: barClr }} />
              </div>
              <span className="fl-sent-pct" style={{ color: barClr }}>{callPct}% calls</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Single flow row ───────────────────────────────────────────────────────────
function FlowRow({ flow, onLoad }) {
  const isCall  = flow.type === 'CALL'
  const typeClr = isCall ? '#10b981' : '#ef4444'

  return (
    <div className={`fl-row fl-row-${isCall ? 'call' : 'put'}`}>
      <div className="fl-row-left">
        <span className="fl-row-ticker" onClick={() => onLoad?.(flow.ticker)}>
          {flow.ticker}
        </span>
        <span className="fl-row-type" style={{ color: typeClr }}>{flow.type}</span>
        <span className="fl-row-contract">
          ${flow.strike} · {flow.expDate} · {flow.daysToExp}d
        </span>
        <span className={`fl-row-bias ${flow.bias === 'SPEC' ? 'fl-spec' : 'fl-hedge'}`}>
          {flow.bias === 'SPEC'
            ? (isCall ? 'Bullish Bet' : 'Bearish Bet')
            : 'Hedge / Cover'}
        </span>
      </div>

      <div className="fl-row-right">
        <div className="fl-metric">
          <span className="fl-metric-lbl">Premium</span>
          <span className="fl-metric-val">${f2(flow.premium)}</span>
        </div>
        <div className="fl-metric">
          <span className="fl-metric-lbl">Volume</span>
          <span className="fl-metric-val">{flow.volume.toLocaleString()}</span>
        </div>
        <div className="fl-metric">
          <span className="fl-metric-lbl">OI</span>
          <span className="fl-metric-val">{flow.oi.toLocaleString()}</span>
        </div>
        <div className="fl-metric">
          <span className="fl-metric-lbl">Vol/OI</span>
          <span className="fl-metric-val" style={{ color: flow.flowColor }}>
            {flow.volOI}×
          </span>
        </div>
        <div className="fl-metric">
          <span className="fl-metric-lbl">IV</span>
          <span className="fl-metric-val">{flow.iv != null ? `${flow.iv}%` : '—'}</span>
        </div>
        <div className="fl-metric fl-metric-prem">
          <span className="fl-metric-lbl">$ Flow</span>
          <span className="fl-metric-val fl-prem-val">{flow.totalPremFmt}</span>
        </div>
        <span className="fl-flow-badge" style={{ color: flow.flowColor, borderColor: flow.flowColor }}>
          {flow.flowType}
        </span>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function FlowScanner({ onLoadTicker }) {
  const [tickers,  setTickers]  = useState(UNIVERSE)
  const [input,    setInput]    = useState('')
  const [status,   setStatus]   = useState('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [flows,    setFlows]    = useState([])
  const [sentiment, setSentiment] = useState({})
  const [fetchErrors, setFetchErrors] = useState(0)
  const [filter,   setFilter]   = useState('all')  // all | call | put

  function handleAdd() {
    const syms = input.toUpperCase().split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    if (syms.length) setTickers(prev => [...new Set([...prev, ...syms])])
    setInput('')
  }

  async function handleScan() {
    if (status === 'running') return
    setStatus('running')
    setProgress({ done: 0, total: tickers.length })
    setFlows([])
    setSentiment({})
    setFetchErrors(0)
    try {
      const { flows: f, sentiment: s, errors: e } = await scanUnusualFlow(tickers, (done, total) =>
        setProgress({ done, total })
      )
      setFlows(f)
      setSentiment(s)
      setFetchErrors(e ?? 0)
    } catch (_) {}
    setStatus('done')
  }

  const pct      = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const visible  = flows.filter(f => filter === 'all' || f.type.toLowerCase() === filter)
  const callFlow = flows.filter(f => f.type === 'CALL')
  const putFlow  = flows.filter(f => f.type === 'PUT')
  const topCall  = callFlow.reduce((m, f) => f.totalPrem > (m?.totalPrem ?? 0) ? f : m, null)
  const topPut   = putFlow.reduce((m, f)  => f.totalPrem > (m?.totalPrem ?? 0) ? f : m, null)

  return (
    <div className="fl-root">
      <div className="fl-header">
        <div className="fl-header-left">
          <span className="fl-header-title">Unusual Options Flow</span>
          <span className="fl-header-sub">
            Flags contracts where volume spikes relative to open interest — signals institutions or large traders positioning
          </span>
        </div>
        <button
          className="fl-scan-btn"
          onClick={handleScan}
          disabled={status === 'running' || !tickers.length}
        >
          {status === 'running' ? `Scanning… ${pct}%` : `Scan ${tickers.length} Tickers`}
        </button>
      </div>

      {status === 'running' && (
        <div className="fl-progress-wrap">
          <div className="fl-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* Ticker management */}
      <div className="fl-tickers-panel">
        <div className="fl-tickers-head">
          <span className="fl-panel-lbl">Tickers · {tickers.length}</span>
          <div className="fl-add-row">
            <input
              className="fl-add-input"
              value={input}
              placeholder="Add tickers e.g. AAPL GME"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button className="fl-add-btn" onClick={handleAdd}>Add</button>
          </div>
        </div>
        <div className="fl-pills">
          {tickers.map(t => (
            <span key={t} className="fl-pill">
              {t}
              <button className="fl-pill-rm" onClick={() => setTickers(p => p.filter(x => x !== t))}>×</button>
            </span>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="fl-explainer">
        <span className="fl-exp-head">What makes it "unusual"?</span>
        <span className="fl-exp-row">
          <span className="fl-exp-badge" style={{ color: '#f59e0b', borderColor: '#f59e0b' }}>SWEEP</span>
          Vol/OI ≥ 2× — someone bought more contracts than exist, aggressively taking all available supply
        </span>
        <span className="fl-exp-row">
          <span className="fl-exp-badge" style={{ color: '#60a5fa', borderColor: '#60a5fa' }}>HEAVY</span>
          Vol/OI ≥ 1× — total daily volume exceeded all open contracts
        </span>
        <span className="fl-exp-row">
          <span className="fl-exp-badge" style={{ color: '#a0c0dc', borderColor: '#a0c0dc' }}>ACTIVE</span>
          Vol/OI ≥ 0.5× — half the open interest traded in one session
        </span>
      </div>

      {/* Top movers when done */}
      {status === 'done' && flows.length > 0 && (
        <>
          <div className="fl-top-cards">
            {topCall && (
              <div className="fl-top-card fl-top-call">
                <span className="fl-top-lbl">Biggest CALL Flow</span>
                <span className="fl-top-ticker">{topCall.ticker}</span>
                <span className="fl-top-contract">${topCall.strike} {topCall.expDate}</span>
                <span className="fl-top-prem" style={{ color: '#10b981' }}>{topCall.totalPremFmt}</span>
                <span className="fl-top-flow" style={{ color: topCall.flowColor }}>{topCall.flowType} · {topCall.volOI}× Vol/OI</span>
              </div>
            )}
            {topPut && (
              <div className="fl-top-card fl-top-put">
                <span className="fl-top-lbl">Biggest PUT Flow</span>
                <span className="fl-top-ticker">{topPut.ticker}</span>
                <span className="fl-top-contract">${topPut.strike} {topPut.expDate}</span>
                <span className="fl-top-prem" style={{ color: '#ef4444' }}>{topPut.totalPremFmt}</span>
                <span className="fl-top-flow" style={{ color: topPut.flowColor }}>{topPut.flowType} · {topPut.volOI}× Vol/OI</span>
              </div>
            )}
            <div className="fl-top-card fl-top-neutral">
              <span className="fl-top-lbl">Unusual Contracts</span>
              <span className="fl-top-big">{flows.length}</span>
              <span className="fl-top-sub">
                {callFlow.length} calls · {putFlow.length} puts
              </span>
            </div>
          </div>

          <SentimentStrip sentiment={sentiment} />

          {/* Filter bar */}
          <div className="fl-filter-bar">
            {['all', 'call', 'put'].map(f => (
              <button
                key={f}
                className={`fl-filter-btn${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? `All (${flows.length})` : f === 'call' ? `Calls (${callFlow.length})` : `Puts (${putFlow.length})`}
              </button>
            ))}
          </div>

          {/* Flow table */}
          <div className="fl-flows">
            {visible.length === 0 && (
              <div className="fl-no-results">No unusual {filter} flow found for these tickers.</div>
            )}
            {visible.map((f, i) => (
              <FlowRow key={i} flow={f} onLoad={onLoadTicker} />
            ))}
          </div>
        </>
      )}

      {status === 'done' && flows.length === 0 && (
        <div className="fl-empty">
          <div className="fl-empty-icon">{fetchErrors === tickers.length ? '⚠️' : '📭'}</div>
          <div className="fl-empty-title">
            {fetchErrors === tickers.length ? 'Options data unavailable' : 'No unusual flow found'}
          </div>
          <div className="fl-empty-sub">
            {fetchErrors === tickers.length
              ? `All ${tickers.length} tickers failed to load options chains — the data feed may require the dev server to be running, or Yahoo Finance may be temporarily blocking requests. Try again in a moment.`
              : fetchErrors > 0
                ? `${tickers.length - fetchErrors} of ${tickers.length} tickers scanned — ${fetchErrors} failed to load. No unusual activity found in the successful results. Try scanning during market hours when live volume is present.`
                : 'No contracts cleared the unusual threshold. Options flow data is most meaningful during market hours (9:30–16:00 ET) when volume is actively updating.'
            }
          </div>
        </div>
      )}

      {status === 'idle' && (
        <div className="fl-empty">
          <div className="fl-empty-icon">🌊</div>
          <div className="fl-empty-title">Options flow scanner</div>
          <div className="fl-empty-sub">
            Hit <strong>Scan</strong> to check {tickers.length} tickers for unusual call and put activity.
            Works best during market hours — volume data updates in real time.
          </div>
        </div>
      )}
    </div>
  )
}
