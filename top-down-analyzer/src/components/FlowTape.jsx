import { useState, useEffect, useRef, useCallback } from 'react'
import { scanUnusualFlow } from '../utils/runFlowScanner'
import './FlowTape.css'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
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
        ? 'BULLISH — CALL volume already exceeds open interest. New money opening fresh positions, not recycling old ones. Strong directional conviction to the upside.'
        : 'BEARISH — PUT volume already exceeds open interest. New money opening fresh short positions. Strong directional conviction to the downside.'
    case 'ACTIVE':
      return isCall
        ? 'MILD BULLISH LEAN — CALL activity is elevated above normal. Multiple ACTIVE prints on the same ticker often precede something bigger.'
        : 'MILD BEARISH LEAN — PUT activity is elevated above normal. Multiple ACTIVE prints on the same ticker often precede something bigger.'
    case 'ELEV':
      return isCall
        ? 'SLIGHTLY ELEVATED — More CALL trading than usual but below the unusual threshold. Watch for follow-through.'
        : 'SLIGHTLY ELEVATED — More PUT trading than usual but below the unusual threshold. Watch for follow-through.'
    default: return null
  }
}

// ── Intelligence helpers ──────────────────────────────────────────────────────

function getConviction(f) {
  const { totalPrem, daysToExp, pctOTM, intent, inTheMoney } = f
  if (
    totalPrem >= 500_000 &&
    daysToExp >= 14 &&
    (inTheMoney || Math.abs(pctOTM ?? 99) < 5) &&
    intent === 'OPENING'
  ) return 'INSTITUTIONAL'
  if (totalPrem >= 75_000 && daysToExp >= 5 && intent !== 'CLOSING')
    return 'SWING'
  return 'SPEC'
}

function getFlowConfluence(f, sentiment) {
  const s = sentiment[f.ticker]
  if (!s) return null
  const total = (s.callPrem ?? 0) + (s.putPrem ?? 0)
  if (total < 25_000) return null
  const callRatio = (s.callPrem ?? 0) / total
  if (callRatio > 0.60) return f.type === 'CALL' ? 'CONFIRM' : 'DIVERGE'
  if (callRatio < 0.40) return f.type === 'PUT'  ? 'CONFIRM' : 'DIVERGE'
  return null
}

function getRegimeCtx(vixData, verdict) {
  const vix       = vixData?.current ?? null
  if (!vix && !verdict) return null
  const favorable = verdict === 'FAVORABLE'    || verdict === 'LEANING BULLISH'
  const hostile   = verdict === 'HOSTILE'      || verdict === 'LEANING BEARISH'
  const vixHigh   = vix != null && vix > 25
  const vixLow    = vix != null && vix < 18

  if (hostile && vixHigh) return {
    label: 'HOSTILE REGIME', color: '#ef4444', bg: '#0e0101', border: '#7f1d1d',
    note: 'Fade CALL sweeps — regime favors downside. Only SWEEP PUT + HEAVY PUT OPENING prints align with conditions.',
  }
  if (hostile) return {
    label: 'BEARISH REGIME', color: '#f87171', bg: '#0e0101', border: '#6b0000',
    note: 'Call flow is likely trapping longs. Focus on put sweeps with INSTITUTIONAL or SWING conviction.',
  }
  if (favorable && vixLow) return {
    label: 'FAVORABLE REGIME', color: '#10b981', bg: '#01100a', border: '#065f46',
    note: 'CALL sweeps follow through at highest rate. Trust INSTITUTIONAL OPENING CONFIRM prints — these are your best entries.',
  }
  if (favorable) return {
    label: 'LEANING BULLISH', color: '#34d399', bg: '#01100a', border: '#047857',
    note: 'Call sweeps working. DIVERGE put prints are likely hedging activity, not directional reversal signals.',
  }
  if (vixHigh) return {
    label: 'HIGH VIX', color: '#f59e0b', bg: '#0f0900', border: '#4d3800',
    note: 'Elevated volatility — heavy put flow may be institutional hedging. Weight CONVICTION tier heavily. Reduce size 50%.',
  }
  return {
    label: 'NEUTRAL REGIME', color: '#60a5fa', bg: '#040e1c', border: '#1a3a6e',
    note: 'Trade SWEEP + INSTITUTIONAL OPENING prints only. Skip SPEC and ELEV flow until regime clarifies.',
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FlowRegimeBanner({ vixData, verdict }) {
  const ctx = getRegimeCtx(vixData, verdict)
  if (!ctx) return null
  return (
    <div className="ft-regime" style={{ background: ctx.bg, borderColor: ctx.border }}>
      <span className="ft-regime-label" style={{ color: ctx.color }}>{ctx.label}</span>
      {vixData?.current != null && (
        <span className="ft-regime-vix" style={{ color: ctx.color }}>
          VIX {vixData.current.toFixed(1)}
        </span>
      )}
      <span className="ft-regime-note">{ctx.note}</span>
    </div>
  )
}

function SentimentStrip({ sentiment }) {
  const tickers = Object.keys(sentiment).filter(t => {
    const s = sentiment[t]
    return ((s.callPrem ?? 0) + (s.putPrem ?? 0)) >= 25_000
  })
  if (!tickers.length) return null

  tickers.sort((a, b) => {
    const sa = sentiment[a], sb = sentiment[b]
    return ((sb.callPrem ?? 0) + (sb.putPrem ?? 0)) - ((sa.callPrem ?? 0) + (sa.putPrem ?? 0))
  })

  return (
    <div className="ft-sentiment">
      <span className="ft-sentiment-label">FLOW BALANCE</span>
      <div className="ft-sentiment-chips">
        {tickers.slice(0, 8).map(t => {
          const s     = sentiment[t]
          const total = (s.callPrem ?? 0) + (s.putPrem ?? 0)
          const callPct = Math.round((s.callPrem ?? 0) / total * 100)
          const putPct  = 100 - callPct
          const bullish = callPct > 54
          const bearish = putPct  > 54
          return (
            <div key={t} className="ft-sent-chip">
              <span className="ft-sent-ticker">{t}</span>
              <div className="ft-sent-bar" title={`Calls: ${fmtPrem(s.callPrem)} · Puts: ${fmtPrem(s.putPrem)}`}>
                <div className="ft-sent-call" style={{ width: `${callPct}%` }} />
                <div className="ft-sent-put"  style={{ width: `${putPct}%` }}  />
              </div>
              <span
                className="ft-sent-pct"
                style={{ color: bullish ? '#10b981' : bearish ? '#ef4444' : '#4a6888' }}
              >
                {bullish ? `${callPct}%C` : bearish ? `${putPct}%P` : 'BAL'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function FlowTape({ watchlist, vixData, verdict }) {
  const [tape,      setTape]      = useState([])
  const [sentiment, setSentiment] = useState({})
  const [status,    setStatus]    = useState('idle')
  const [progress,  setProgress]  = useState({ done: 0, total: 0 })
  const seenRef = useRef(new Set())
  const initRef = useRef(false)

  const tickers = [...new Set((watchlist ?? []).map(w => w.ticker))].filter(Boolean)

  const poll = useCallback(async () => {
    if (tickers.length === 0) return
    setStatus('scanning')
    setProgress({ done: 0, total: tickers.length })
    try {
      const { flows, sentiment: sent } = await scanUnusualFlow(tickers, (done, total) => {
        setProgress({ done, total })
      })

      setSentiment(sent ?? {})

      const now     = Date.now()
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

  // Repeat counter: how many same-ticker + same-type prints exist in the tape
  const repeatCounts = {}
  tape.forEach(f => {
    const k = `${f.ticker}|${f.type}`
    repeatCounts[k] = (repeatCounts[k] || 0) + 1
  })

  const isEmpty  = tape.length === 0 && status !== 'scanning'
  const scanning = status === 'scanning'
  const pct      = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div className="ft-root">

      {/* Header */}
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

      {/* Regime banner */}
      <FlowRegimeBanner vixData={vixData} verdict={verdict} />

      {/* Progress bar */}
      {scanning && (
        <div className="ft-progress-wrap">
          <div className="ft-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* Sentiment strip */}
      {Object.keys(sentiment).length > 0 && (
        <SentimentStrip sentiment={sentiment} />
      )}

      {/* Column headers */}
      <div className="ft-col-hdr">
        <span className="ft-h-time">TIME</span>
        <span className="ft-h-ticker">TICKER</span>
        <span className="ft-h-type">TYPE</span>
        <span className="ft-h-strike">STRIKE</span>
        <span className="ft-h-dte">DTE</span>
        <span className="ft-h-voi">V/OI</span>
        <span className="ft-h-prem">TOTAL $</span>
        <span className="ft-h-flow">FLOW</span>
        <span className="ft-h-intent">INTENT</span>
        <span className="ft-h-conv">CONVICTION</span>
        <span className="ft-h-conf">CONFLUENCE</span>
      </div>

      {/* Tape list */}
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
          const isCall     = f.type === 'CALL'
          const typeCol    = isCall ? '#00c77a' : '#ff4d4d'
          const flowCol    = FLOW_COLOR[f.flowType] ?? '#4a6888'
          const tip        = flowTip(f.flowType, f.type)
          const conviction = getConviction(f)
          const confluence = getFlowConfluence(f, sentiment)
          const repeatKey  = `${f.ticker}|${f.type}`
          const repeatCt   = repeatCounts[repeatKey] || 1

          const dteColor  = (f.daysToExp ?? 99) <= 7
            ? '#f59e0b'
            : (f.daysToExp ?? 99) <= 30
              ? '#7a9ab8'
              : '#60a5fa'

          const dteTip = (f.daysToExp ?? 99) <= 7
            ? 'Same-week expiry — speculative urgency, lottery-ticket bet'
            : (f.daysToExp ?? 99) <= 30
              ? 'Swing trade timeframe (8–30 DTE)'
              : 'Institutional timeframe (30+ DTE)'

          const intentColor = f.intent === 'OPENING'
            ? (isCall ? '#10b981' : '#ef4444')
            : f.intent === 'CLOSING' ? '#6b7280'
            : '#4a6888'

          const convColor = conviction === 'INSTITUTIONAL' ? '#f59e0b'
            : conviction === 'SWING' ? '#60a5fa'
            : '#2a3a52'

          const convTip = conviction === 'INSTITUTIONAL'
            ? `Large $ (${fmtPrem(f.totalPrem)}), ${f.daysToExp}+ DTE, near-money OPENING — institutional positioning`
            : conviction === 'SWING'
              ? `Mid-size premium, multi-day DTE — swing trade timeframe`
              : `Short DTE or OTM — speculative retail-style bet`

          const confColor = confluence === 'CONFIRM' ? '#10b981'
            : confluence === 'DIVERGE' ? '#ef4444'
            : '#2a4060'

          const confTip = confluence === 'CONFIRM'
            ? `This ${f.type} print CONFIRMS the dominant flow direction for ${f.ticker} today`
            : confluence === 'DIVERGE'
              ? `DIVERGE — this ${f.type} print is going against the dominant flow for ${f.ticker}. Watch for reversal.`
              : 'Balanced flow — no dominant direction to confirm or diverge from'

          return (
            <div key={`${f._key}-${i}`} className={`ft-row${f._isNew ? ' ft-new' : ''}`}>

              <span className="ft-cell ft-time">{fmtTime(f._ts)}</span>

              <span className="ft-cell ft-ticker">
                {f.ticker}
                {repeatCt >= 2 && (
                  <span
                    className="ft-repeat"
                    style={{ color: isCall ? '#10b981' : '#ef4444' }}
                    title={`${repeatCt} ${f.type} prints on ${f.ticker} this session — building conviction`}
                  >
                    {repeatCt}×
                  </span>
                )}
              </span>

              <span className="ft-cell ft-type" style={{ color: typeCol }}>{f.type}</span>

              <span className="ft-cell ft-strike">${f.strike}</span>

              <span className="ft-cell ft-dte" style={{ color: dteColor }} title={dteTip}>
                {f.daysToExp ?? '?'}d
              </span>

              <span className="ft-cell ft-num" style={{ color: f.volOI >= 1 ? '#f59e0b' : '#7a9ab8' }}>
                {f.volOI?.toFixed(2)}×
              </span>

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

              <span
                className="ft-cell ft-intent"
                style={{ color: intentColor }}
                title={
                  f.intent === 'OPENING'
                    ? 'Paid the ask — initiating buyer opening a new position (aggression)'
                    : f.intent === 'CLOSING'
                      ? 'Hit the bid — closing/selling an existing position (unwinding)'
                      : 'Mid-market fill — ambiguous direction'
                }
              >
                {f.intent}
              </span>

              <span
                className="ft-cell ft-conviction"
                style={{ color: convColor }}
                title={convTip}
              >
                {conviction}
              </span>

              <span
                className="ft-cell ft-confluence"
                style={{ color: confColor }}
                title={confTip}
              >
                {confluence ?? '—'}
              </span>

            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="ft-legend">
        <span><span style={{ color: '#f59e0b' }}>SWEEP</span> Vol/OI ≥ 2×</span>
        <span><span style={{ color: '#60a5fa' }}>HEAVY</span> Vol/OI ≥ 1×</span>
        <span><span style={{ color: '#7a9ab8' }}>ACTIVE</span> Vol/OI ≥ 0.5×</span>
        <span><span style={{ color: '#f59e0b' }}>INSTITUTIONAL</span> $500K+ · 14+ DTE · near-money OPENING</span>
        <span><span style={{ color: '#10b981' }}>CONFIRM</span> Print aligns with dominant ticker flow</span>
        <span><span style={{ color: '#ef4444' }}>DIVERGE</span> Print opposes dominant ticker flow — watch for reversal</span>
        <span><span style={{ color: '#7a9ab8' }}>2×</span> Repeat prints — building conviction</span>
      </div>

    </div>
  )
}
