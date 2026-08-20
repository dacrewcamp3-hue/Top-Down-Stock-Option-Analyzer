import './GEXChart.css'

const f2 = v => v != null ? (+v).toFixed(2) : '—'
const fM = v => {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return v.toFixed(0)
}

// ── GEX histogram (net call-minus-put gamma exposure per strike) ──────────────
function GEXHistogram({ gexData, S, gammaFlip, maxAbsGEX }) {
  if (!gexData?.length) return null

  const W = 680, H = 210
  const PAD = { t: 16, r: 16, b: 48, l: 12 }
  const iW  = W - PAD.l - PAD.r
  const iH  = H - PAD.t - PAD.b

  const n      = gexData.length
  const barW   = Math.max(2, Math.floor(iW / n) - 1)
  const xOf    = i => PAD.l + (i / n) * iW + (iW / n - barW) / 2
  const midY   = PAD.t + iH / 2  // zero line
  const scale  = (iH / 2) / (maxAbsGEX || 1)

  // Show strike labels every Nth bar to prevent overlap
  const labelEvery = Math.max(1, Math.ceil(n / 10))

  // Convert strike to x position (for current price and flip lines)
  const strikes = gexData.map(d => d.strike)
  const sMin    = strikes[0], sMax = strikes[n - 1]
  const xAtPrice = p => PAD.l + ((p - sMin) / (sMax - sMin || 1)) * iW

  const flipX = gammaFlip != null ? xAtPrice(gammaFlip) : null
  const spotX = xAtPrice(S)

  return (
    <div className="gex-chart-wrap">
      <div className="gex-chart-label">
        Net Gamma Exposure · <span style={{ color: '#10b981' }}>green = call-dominated (stabilising)</span>
        {' / '}<span style={{ color: '#ef4444' }}>red = put-dominated (volatile)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="gex-svg" preserveAspectRatio="xMidYMid meet">

        {/* Zero baseline */}
        <line x1={PAD.l} x2={W - PAD.r} y1={midY} y2={midY}
          stroke="#2a4060" strokeWidth="1" />

        {/* GEX bars */}
        {gexData.map((d, i) => {
          const h   = Math.min(iH / 2 - 1, Math.abs(d.gex) * scale)
          const pos = d.gex >= 0
          const y   = pos ? midY - h : midY
          const clr = pos ? '#10b981' : '#ef4444'
          const isATM = Math.abs(d.strike - S) <= (sMax - sMin) / n
          return (
            <rect
              key={d.strike}
              x={xOf(i).toFixed(1)}
              y={y.toFixed(1)}
              width={barW}
              height={Math.max(1, h).toFixed(1)}
              fill={clr}
              opacity={isATM ? 1 : 0.75}
            />
          )
        })}

        {/* Gamma flip line */}
        {flipX != null && (
          <g>
            <line x1={flipX} x2={flipX} y1={PAD.t} y2={H - PAD.b + 6}
              stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="4 3" />
            <text x={flipX + 3} y={PAD.t + 11} fill="#60a5fa" fontSize="9" fontFamily="monospace">
              GEX FLIP ${f2(gammaFlip)}
            </text>
          </g>
        )}

        {/* Current price line */}
        <g>
          <line x1={spotX} x2={spotX} y1={PAD.t} y2={H - PAD.b + 6}
            stroke="#f59e0b" strokeWidth="1.5" />
          <text x={spotX + 3} y={PAD.t + 22} fill="#f59e0b" fontSize="9" fontFamily="monospace">
            SPOT ${f2(S)}
          </text>
        </g>

        {/* Strike labels on X axis */}
        {gexData.map((d, i) => {
          if (i % labelEvery !== 0 && i !== n - 1) return null
          const x = xOf(i) + barW / 2
          return (
            <text key={d.strike} x={x} y={H - PAD.b + 14}
              fill="#4a6380" fontSize="8" fontFamily="monospace" textAnchor="middle">
              {d.strike % 1 === 0 ? d.strike : d.strike.toFixed(1)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

// ── IV term structure (ATM IV vs DTE) ────────────────────────────────────────
function TermStructure({ termStructure }) {
  if (!termStructure?.length) return null

  const W = 680, H = 160
  const PAD = { t: 20, r: 20, b: 40, l: 48 }
  const iW  = W - PAD.l - PAD.r
  const iH  = H - PAD.t - PAD.b

  const dtes = termStructure.map(p => p.dte)
  const ivs  = termStructure.map(p => p.iv)
  const minDTE = 0, maxDTE = Math.max(...dtes, 30)
  const minIV  = Math.max(0, Math.min(...ivs) - 3)
  const maxIV  = Math.max(...ivs) + 3

  const xOf = dte => PAD.l + ((dte - minDTE) / (maxDTE - minDTE)) * iW
  const yOf = iv  => PAD.t + (1 - (iv  - minIV)  / (maxIV  - minIV))  * iH

  const pts = termStructure.map(p => `${xOf(p.dte).toFixed(1)},${yOf(p.iv).toFixed(1)}`).join(' ')

  // Is the term structure inverted? (near-term IV > far-term IV = event risk)
  const isInverted = ivs.length >= 2 && ivs[0] > ivs[ivs.length - 1]
  const lineColor  = isInverted ? '#f59e0b' : '#60a5fa'

  // Y grid
  const ivStep = Math.max(2, Math.round((maxIV - minIV) / 4))
  const gridIVs = []
  for (let v = Math.ceil(minIV / ivStep) * ivStep; v <= maxIV; v += ivStep) gridIVs.push(v)

  return (
    <div className="gex-term-wrap">
      <div className="gex-term-label">
        IV Term Structure — ATM implied volatility by expiration
        {isInverted && <span className="gex-term-inverted"> · INVERTED (event risk / earnings)</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="gex-svg" preserveAspectRatio="xMidYMid meet">

        {/* Grid lines */}
        {gridIVs.map(iv => (
          <g key={iv}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yOf(iv)} y2={yOf(iv)}
              stroke="#1a2535" strokeWidth="0.5" />
            <text x={PAD.l - 6} y={yOf(iv) + 4} fill="#4a6380" fontSize="9"
              fontFamily="monospace" textAnchor="end">{iv}%</text>
          </g>
        ))}

        {/* Area fill */}
        <polygon
          points={`${PAD.l},${PAD.t + iH} ${pts} ${W - PAD.r},${PAD.t + iH}`}
          fill={lineColor} opacity="0.06"
        />

        {/* Line */}
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />

        {/* Dots + labels */}
        {termStructure.map(p => (
          <g key={p.dte}>
            <circle cx={xOf(p.dte)} cy={yOf(p.iv)} r="3.5" fill={lineColor} />
            <text x={xOf(p.dte)} y={H - PAD.b + 14} fill="#4a6380" fontSize="8"
              fontFamily="monospace" textAnchor="middle">{p.expDate}</text>
            <text x={xOf(p.dte)} y={yOf(p.iv) - 7} fill={lineColor} fontSize="8"
              fontFamily="monospace" textAnchor="middle">{p.iv}%</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Put/Call ratios table ─────────────────────────────────────────────────────
function PCTable({ termStructure, aggregatePCOI, aggregatePCVol }) {
  if (!termStructure?.length) return null

  function pcColor(val) {
    if (val == null) return '#4a6380'
    if (val > 1.2) return '#ef4444'
    if (val < 0.7) return '#10b981'
    return '#f59e0b'
  }
  function pcLabel(val) {
    if (val == null) return '—'
    if (val > 1.2) return 'Bearish'
    if (val < 0.7) return 'Bullish'
    return 'Neutral'
  }

  return (
    <div className="gex-pc-wrap">
      <div className="gex-pc-title">Put / Call Ratios by Expiry</div>

      <div className="gex-pc-aggregate">
        <div className="gex-pc-agg-cell">
          <span className="gex-pc-agg-lbl">ALL EXPIRIES · P/C OI</span>
          <span className="gex-pc-agg-val" style={{ color: pcColor(aggregatePCOI) }}>
            {aggregatePCOI ?? '—'}
          </span>
          <span className="gex-pc-agg-note" style={{ color: pcColor(aggregatePCOI) }}>
            {pcLabel(aggregatePCOI)}
          </span>
        </div>
        <div className="gex-pc-agg-div" />
        <div className="gex-pc-agg-cell">
          <span className="gex-pc-agg-lbl">ALL EXPIRIES · P/C VOL</span>
          <span className="gex-pc-agg-val" style={{ color: pcColor(aggregatePCVol) }}>
            {aggregatePCVol ?? '—'}
          </span>
          <span className="gex-pc-agg-note" style={{ color: pcColor(aggregatePCVol) }}>
            {pcLabel(aggregatePCVol)}
          </span>
        </div>
      </div>

      <div className="gex-pc-table">
        <div className="gex-pc-row gex-pc-hdr">
          <span>Expiry</span>
          <span>DTE</span>
          <span>P/C OI</span>
          <span>Call OI</span>
          <span>Put OI</span>
          <span>P/C Vol</span>
          <span>Bias</span>
        </div>
        {termStructure.map(p => (
          <div key={p.expDate} className="gex-pc-row">
            <span>{p.expDate}</span>
            <span>{p.dte}d</span>
            <span style={{ color: pcColor(p.pcOI), fontWeight: 600 }}>{p.pcOI ?? '—'}</span>
            <span>{fM(p.totalCallOI)}</span>
            <span>{fM(p.totalPutOI)}</span>
            <span style={{ color: pcColor(p.pcVol) }}>{p.pcVol ?? '—'}</span>
            <span style={{ color: pcColor(p.pcOI), fontSize: 10 }}>{pcLabel(p.pcOI)}</span>
          </div>
        ))}
      </div>

      <div className="gex-pc-legend">
        <span className="gex-pc-leg gex-leg-bull">P/C &lt; 0.7 = more calls (bullish positioning)</span>
        <span className="gex-pc-leg gex-leg-bear">P/C &gt; 1.2 = more puts (bearish hedge / fear)</span>
        <span className="gex-pc-leg">0.7 – 1.2 = neutral</span>
      </div>
    </div>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function GEXSummary({ chain, ticker }) {
  const { S, gammaFlip, totalNetGEX, aggregatePCOI, aggregatePCVol, gexData } = chain
  const hasGEX = gexData?.length > 0

  const above = hasGEX ? S > gammaFlip : null
  const regimeColor  = !hasGEX ? '#4a6888' : above ? '#10b981' : '#ef4444'
  const regimeLabel  = !hasGEX ? 'GEX UNAVAILABLE'
    : above ? '+ GAMMA REGIME (stabilising)' : '− GAMMA REGIME (volatile)'
  const regimeDetail = !hasGEX
    ? 'No option contracts with open interest found. GEX requires at least one expiry with OI > 0 and valid IV.'
    : above
    ? 'Price is above the gamma flip — market makers are net long gamma. Expect mean-reversion and contained moves.'
    : 'Price is below the gamma flip — market makers are net short gamma. Expect trending moves and gap risk.'

  return (
    <div className="gex-summary" style={{ borderColor: regimeColor }}>
      <div className="gex-sum-left">
        <span className="gex-sum-ticker">{ticker}</span>
        <span className="gex-sum-regime" style={{ color: regimeColor }}>{regimeLabel}</span>
        <span className="gex-sum-detail">{regimeDetail}</span>
      </div>
      <div className="gex-sum-right">
        <div className="gex-sum-kv">
          <span className="gex-sum-k">Spot</span>
          <span className="gex-sum-v">${f2(S)}</span>
        </div>
        <div className="gex-sum-kv">
          <span className="gex-sum-k">GEX Flip</span>
          <span className="gex-sum-v" style={{ color: hasGEX ? '#60a5fa' : '#4a6888' }}>
            {hasGEX ? `$${f2(gammaFlip)}` : '—'}
          </span>
        </div>
        <div className="gex-sum-kv">
          <span className="gex-sum-k">Net GEX</span>
          <span className="gex-sum-v" style={{ color: hasGEX ? (totalNetGEX >= 0 ? '#10b981' : '#ef4444') : '#4a6888' }}>
            {hasGEX ? (totalNetGEX >= 0 ? '+' : '') + fM(totalNetGEX) : '—'}
          </span>
        </div>
        <div className="gex-sum-kv">
          <span className="gex-sum-k">P/C OI</span>
          <span className="gex-sum-v">{aggregatePCOI ?? '—'}</span>
        </div>
        <div className="gex-sum-kv">
          <span className="gex-sum-k">P/C Vol</span>
          <span className="gex-sum-v">{aggregatePCVol ?? '—'}</span>
        </div>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function GEXChart({ chain, ticker, currentPrice, onRetry }) {
  if (!chain || chain.empty) return (
    <div className="gex-empty">
      <div className="gex-empty-icon">Γ</div>
      <div className="gex-empty-text">Options chain unavailable</div>
      <div className="gex-empty-sub">
        {ticker
          ? `No options data loaded for ${ticker}. The session may have refreshed — click Retry to fetch a fresh chain.`
          : 'Load a ticker to see GEX, term structure, and put/call ratios.'
        }
      </div>
      {ticker && onRetry && (
        <button className="gex-retry-btn" onClick={onRetry}>
          ↺ Retry Options Chain
        </button>
      )}
    </div>
  )

  return (
    <div className="gex-root">
      <GEXSummary chain={chain} ticker={ticker} />

      <div className="gex-section-title">Gamma Exposure by Strike</div>
      <div className="gex-explainer">
        The gamma flip (blue line) is where dealer hedging switches from counter-trend (stabilising)
        to trend-following (amplifying). The largest bars are your key support / resistance walls.
      </div>
      <GEXHistogram
        gexData={chain.gexData}
        S={chain.S}
        gammaFlip={chain.gammaFlip}
        maxAbsGEX={chain.maxAbsGEX}
      />

      <div className="gex-section-title" style={{ marginTop: 24 }}>Volatility Term Structure</div>
      <div className="gex-explainer">
        Normal = front-month IV cheaper than back-month (upward slope).
        Inverted = near-term IV spiking — usually signals an event (earnings, FOMC, catalyst).
      </div>
      <TermStructure termStructure={chain.termStructure} />

      <div className="gex-section-title" style={{ marginTop: 24 }}>Put / Call Ratios</div>
      <PCTable
        termStructure={chain.termStructure}
        aggregatePCOI={chain.aggregatePCOI}
        aggregatePCVol={chain.aggregatePCVol}
      />

      <div className="gex-disclaimer">
        GEX computed from Yahoo Finance options data using Black-Scholes gamma. Assumes dealers are
        short calls / long puts (standard market-making convention). The gamma flip is an approximation
        — verify against live SpotGamma or GEX tools before trading around key levels.
      </div>
    </div>
  )
}
