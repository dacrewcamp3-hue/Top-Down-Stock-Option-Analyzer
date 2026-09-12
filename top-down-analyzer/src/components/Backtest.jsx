import React, { useState, useEffect, useRef, useMemo } from 'react'
import { runBacktest } from '../utils/runBacktest'
import './Backtest.css'

// ── Equity curve SVG ──────────────────────────────────────────────────────────
function EquityCurve({ curve, trades, spyCurve, showApOnly }) {
  const filtered = useMemo(() => {
    if (!showApOnly) return { curve, trades }
    const t2 = trades.filter(t => t.grade === 'A+')
    let eq = 100
    const c2 = t2.map(t => {
      eq = +(eq * (1 + t.gain / 100)).toFixed(2)
      return { date: t.date, equity: eq }
    })
    return { curve: c2, trades: t2 }
  }, [curve, trades, showApOnly])

  const { curve: c, trades: t } = filtered

  if (!c || c.length < 2) return <div className="bt-curve-empty">Not enough A+ signals to plot.</div>

  const W = 600, H = 180, PAD = { t: 12, r: 12, b: 28, l: 44 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const equities = c.map(p => p.equity)
  const spyVals  = spyCurve?.map(p => p.equity) ?? []
  const allVals  = [...equities, ...spyVals]
  const minEq    = Math.min(...allVals, 95)
  const maxEq    = Math.max(...allVals, 105)
  const range    = maxEq - minEq || 10

  const xOf = (i, len) => PAD.l + (i / (len - 1)) * innerW
  const yOf = v  => PAD.t + (1 - (v - minEq) / range) * innerH

  const linePts = c.map((p, i) => `${xOf(i, c.length).toFixed(1)},${yOf(p.equity).toFixed(1)}`).join(' ')
  const spyPts  = spyCurve
    ? spyCurve.map((p, i) => `${xOf(i, spyCurve.length).toFixed(1)},${yOf(p.equity).toFixed(1)}`).join(' ')
    : null

  const gridLines = [80, 90, 100, 110, 120, 130, 150].filter(v => v >= minEq - 5 && v <= maxEq + 5)
  const lastEq    = equities[equities.length - 1]
  const lineColor = lastEq >= 100 ? '#10b981' : '#ef4444'

  const labelEvery = Math.max(1, Math.floor(t.length / 5))

  return (
    <div className="bt-curve-wrap">
      <div className="bt-curve-header">
        <div className="bt-curve-label">
          Equity Curve · starts at 100
          {showApOnly && <span className="bt-curve-badge">A+ Only</span>}
        </div>
        {spyCurve && (
          <div className="bt-curve-legend">
            <span className="bt-legend-dot" style={{ background: lineColor }} /> Strategy
            <span className="bt-legend-dot" style={{ background: '#60a5fa' }} /> SPY
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="bt-curve-svg" preserveAspectRatio="xMidYMid meet">
        {gridLines.map(v => (
          <g key={v}>
            <line
              x1={PAD.l} x2={W - PAD.r}
              y1={yOf(v)} y2={yOf(v)}
              stroke={v === 100 ? '#2a4060' : '#1a2535'}
              strokeWidth={v === 100 ? 1 : 0.5}
              strokeDasharray={v === 100 ? '4 3' : '2 4'}
            />
            <text x={PAD.l - 6} y={yOf(v) + 4} className="bt-axis-lbl" textAnchor="end">{v}</text>
          </g>
        ))}

        {/* SPY benchmark line */}
        {spyPts && (
          <polyline
            points={spyPts}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="1"
            strokeDasharray="3 2"
            opacity="0.7"
          />
        )}

        {/* Strategy fill + line */}
        <polygon
          points={`${PAD.l},${PAD.t + innerH} ${linePts} ${W - PAD.r},${PAD.t + innerH}`}
          fill={lineColor}
          opacity="0.06"
        />
        <polyline
          points={linePts}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Trade dots */}
        {t.map((tr, i) => (
          <circle
            key={i}
            cx={xOf(i, c.length).toFixed(1)}
            cy={yOf(c[i]?.equity ?? 100).toFixed(1)}
            r="3"
            fill={tr.win ? '#10b981' : '#ef4444'}
          />
        ))}

        {/* Date labels */}
        {t
          .filter((_, i) => i === 0 || i === t.length - 1 || i % labelEvery === 0)
          .map((tr) => {
            const idx = t.indexOf(tr)
            return (
              <text key={idx} x={xOf(idx, c.length)} y={H - 6} className="bt-axis-lbl" textAnchor="middle">
                {tr.date}
              </text>
            )
          })}
      </svg>
    </div>
  )
}

// ── Monte Carlo simulation (client-side) ──────────────────────────────────────
function MonteCarlo({ trades }) {
  const result = useMemo(() => {
    if (!trades?.length || trades.length < 5) return null
    const N = 600
    const gains = trades.map(t => t.gain)
    const n     = gains.length
    const allCurves = []

    for (let s = 0; s < N; s++) {
      const shuffled = [...gains].sort(() => Math.random() - 0.5)
      let eq = 100
      const curve = shuffled.map(g => { eq = +(eq * (1 + g / 100)).toFixed(2); return eq })
      allCurves.push(curve)
    }

    // At each position, collect the distribution of equity values
    const p10 = [], p25 = [], p50 = [], p75 = [], p90 = []
    for (let i = 0; i < n; i++) {
      const vals = allCurves.map(c => c[i]).sort((a, b) => a - b)
      const pct  = f => vals[Math.floor(f * vals.length)]
      p10.push(pct(0.10))
      p25.push(pct(0.25))
      p50.push(pct(0.50))
      p75.push(pct(0.75))
      p90.push(pct(0.90))
    }

    // Final equity distribution
    const finals = allCurves.map(c => c[n - 1]).sort((a, b) => a - b)
    const probProfit   = Math.round(finals.filter(v => v >= 100).length / N * 100)
    const probDrawdown = Math.round(finals.filter(v => v < 80).length  / N * 100)

    return { p10, p25, p50, p75, p90, n, finals, probProfit, probDrawdown }
  }, [trades])

  if (!result) return null

  const W = 600, H = 160, PAD = { t: 12, r: 12, b: 20, l: 44 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const { p10, p50, p90, n, finals, probProfit, probDrawdown } = result

  const allVals = [...p10, ...p90]
  const minV = Math.min(...allVals, 80)
  const maxV = Math.max(...allVals, 120)
  const range = maxV - minV || 10

  const xOf = i => PAD.l + (i / (n - 1)) * innerW
  const yOf = v => PAD.t + (1 - (v - minV) / range) * innerH

  const pts10 = p10.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
  const pts50 = p50.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
  const pts90 = p90.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
  const bandPts = [
    ...p90.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`),
    ...[...p10].reverse().map((v, i) => `${xOf(n - 1 - i).toFixed(1)},${yOf(v).toFixed(1)}`),
  ].join(' ')

  const finalsSorted = [...finals].sort((a, b) => a - b)
  const histMin = finalsSorted[0], histMax = finalsSorted[finalsSorted.length - 1]
  const HW = 220, HH = 60
  const bins = 20
  const bucketSize = (histMax - histMin) / bins || 1
  const counts = new Array(bins).fill(0)
  for (const v of finals) {
    const b = Math.min(bins - 1, Math.floor((v - histMin) / bucketSize))
    counts[b]++
  }
  const maxCount = Math.max(...counts)

  return (
    <div className="bt-mc-wrap">
      <div className="bt-mc-title">Monte Carlo Simulation · 600 shuffled runs · same {n} trades</div>
      <div className="bt-mc-subtitle">Randomizes trade order to reveal path-dependency risk</div>

      <svg viewBox={`0 0 ${W} ${H}`} className="bt-curve-svg" preserveAspectRatio="xMidYMid meet">
        <polygon points={bandPts} fill="#3b82f6" opacity="0.10" />
        <polyline points={pts10} fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
        <polyline points={pts90} fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
        <polyline points={pts50} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
        <line x1={PAD.l} x2={W - PAD.r} y1={yOf(100)} y2={yOf(100)} stroke="#2a4060" strokeWidth={1} strokeDasharray="4 3" />
        <text x={PAD.l - 6} y={yOf(100) + 4} className="bt-axis-lbl" textAnchor="end">100</text>
        {[minV + range * 0.25, minV + range * 0.75].map(v => (
          <text key={v} x={PAD.l - 6} y={yOf(v) + 4} className="bt-axis-lbl" textAnchor="end">{Math.round(v)}</text>
        ))}
        <text x={xOf(0)}     y={H - 4} className="bt-axis-lbl" textAnchor="middle">Trade 1</text>
        <text x={xOf(n - 1)} y={H - 4} className="bt-axis-lbl" textAnchor="middle">Trade {n}</text>
      </svg>

      <div className="bt-mc-legend">
        <span><span className="bt-mc-swatch" style={{ background: '#10b981' }} />p90 (best 10%)</span>
        <span><span className="bt-mc-swatch" style={{ background: '#f59e0b' }} />Median</span>
        <span><span className="bt-mc-swatch" style={{ background: '#ef4444' }} />p10 (worst 10%)</span>
      </div>

      <div className="bt-mc-stats">
        <div className="bt-mc-stat">
          <span className="bt-mc-stat-lbl">Profitable (final &gt; 100)</span>
          <span className="bt-mc-stat-val" style={{ color: probProfit >= 60 ? '#10b981' : '#ef4444' }}>{probProfit}%</span>
        </div>
        <div className="bt-mc-stat">
          <span className="bt-mc-stat-lbl">Severe drawdown (&lt;80)</span>
          <span className="bt-mc-stat-val" style={{ color: probDrawdown > 20 ? '#ef4444' : '#10b981' }}>{probDrawdown}%</span>
        </div>
        <div className="bt-mc-stat">
          <span className="bt-mc-stat-lbl">Median final equity</span>
          <span className="bt-mc-stat-val">{result.p50[n - 1]?.toFixed(0)}</span>
        </div>
        <div className="bt-mc-stat">
          <span className="bt-mc-stat-lbl">Worst case (p10)</span>
          <span className="bt-mc-stat-val" style={{ color: '#ef4444' }}>{result.p10[n - 1]?.toFixed(0)}</span>
        </div>
      </div>

      {/* Final equity distribution histogram */}
      <div className="bt-mc-hist-wrap">
        <div className="bt-mc-hist-title">Final Equity Distribution across 600 runs</div>
        <svg viewBox={`0 0 ${HW} ${HH}`} className="bt-mc-hist-svg" preserveAspectRatio="xMidYMid meet">
          {counts.map((cnt, i) => {
            const x    = (i / bins) * HW
            const barW = HW / bins - 1
            const h    = maxCount > 0 ? (cnt / maxCount) * (HH - 10) : 0
            const val  = histMin + i * bucketSize
            const clr  = val >= 100 ? '#10b981' : '#ef4444'
            return <rect key={i} x={x} y={HH - 10 - h} width={barW} height={h} fill={clr} opacity="0.7" />
          })}
          <line x1={0} x2={HW} y1={HH - 10} y2={HH - 10} stroke="#1e2d45" strokeWidth={0.5} />
          {[histMin, 100, histMax].map(v => {
            const x = ((v - histMin) / (histMax - histMin)) * HW
            return (
              <text key={v} x={x} y={HH - 1} className="bt-axis-lbl" textAnchor="middle">
                {Math.round(v)}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ── Risk metrics (Sharpe / Sortino / Max Drawdown) ───────────────────────────
function RiskMetrics({ result }) {
  const { sharpe, sortino, maxDrawdown } = result
  if (sharpe == null && sortino == null && maxDrawdown == null) return null

  const sharpeColor  = sharpe  >= 1.0 ? '#10b981' : sharpe  >= 0.5 ? '#f59e0b' : '#ef4444'
  const sortinoColor = sortino >= 1.5 ? '#10b981' : sortino >= 0.8 ? '#f59e0b' : '#ef4444'
  const ddColor      = maxDrawdown >= -15 ? '#10b981' : maxDrawdown >= -25 ? '#f59e0b' : '#ef4444'

  return (
    <div className="bt-risk-wrap">
      <div className="bt-risk-title">Risk-Adjusted Performance</div>
      <div className="bt-risk-grid">
        <div className="bt-risk-cell">
          <span className="bt-risk-lbl" data-tip="Sharpe Ratio: Average return per unit of total risk (standard deviation). Above 1.0 is good, above 2.0 is excellent. Annualised based on signal frequency. Below 0.5 means the volatility of results is high relative to the returns.">Sharpe Ratio</span>
          <span className="bt-risk-val" style={{ color: sharpeColor }}>{sharpe ?? '—'}</span>
          <span className="bt-risk-sub">{sharpe >= 1.0 ? 'Good' : sharpe >= 0.5 ? 'Moderate' : 'Low'}</span>
        </div>
        <div className="bt-risk-div" />
        <div className="bt-risk-cell">
          <span className="bt-risk-lbl" data-tip="Sortino Ratio: Like Sharpe, but only penalizes for downside volatility (bad variance). Above 1.5 is excellent. This is more relevant for trading systems where you want to distinguish between good volatility (big wins) and bad volatility (big losses).">Sortino Ratio</span>
          <span className="bt-risk-val" style={{ color: sortinoColor }}>{sortino ?? '—'}</span>
          <span className="bt-risk-sub">{sortino >= 1.5 ? 'Excellent' : sortino >= 0.8 ? 'Acceptable' : 'Poor'}</span>
        </div>
        <div className="bt-risk-div" />
        <div className="bt-risk-cell">
          <span className="bt-risk-lbl" data-tip="Max Drawdown: The largest peak-to-trough equity decline in the backtest. This is your worst paper loss from a portfolio high to the next low before recovery. It defines the minimum account size you need to psychologically survive the system's worst period.">Max Drawdown</span>
          <span className="bt-risk-val" style={{ color: ddColor }}>{maxDrawdown}%</span>
          <span className="bt-risk-sub">peak to trough</span>
        </div>
      </div>
    </div>
  )
}

// ── Drawdown recovery log ─────────────────────────────────────────────────────
function DrawdownLog({ log }) {
  if (!log?.length) return (
    <div className="bt-dd-wrap">
      <div className="bt-dd-title">Drawdown Episodes</div>
      <div className="bt-dd-empty">No drawdowns deeper than 5% recorded.</div>
    </div>
  )

  return (
    <div className="bt-dd-wrap">
      <div className="bt-dd-title">Drawdown Episodes (&gt;5% depth)</div>
      <div className="bt-dd-table">
        <div className="bt-dd-thead">
          <span>Start</span>
          <span>Trough</span>
          <span>Depth</span>
          <span>Recovered</span>
        </div>
        {log.map((ep, i) => (
          <div key={i} className="bt-dd-row">
            <span className="bt-dd-cell">{ep.start}</span>
            <span className="bt-dd-cell">{ep.trough}</span>
            <span className="bt-dd-cell" style={{ color: ep.depth <= -20 ? '#ef4444' : '#f59e0b' }}>
              {ep.depth}%
            </span>
            <span className="bt-dd-cell" style={{ color: ep.recovered ? '#10b981' : '#6b7280' }}>
              {ep.recovered ?? 'Ongoing'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Monthly P&L heatmap ───────────────────────────────────────────────────────
function MonthlyHeatmap({ data }) {
  if (!data?.length) return null

  const years    = [...new Set(data.map(d => d.year))].sort()
  const months   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const maxAbs   = Math.max(...data.map(d => Math.abs(d.gain)), 1)
  const byKey    = {}
  for (const d of data) byKey[`${d.year}-${d.month}`] = d

  const cellColor = gain => {
    const intensity = Math.min(1, Math.abs(gain) / maxAbs)
    if (gain > 0)  return `rgba(16,185,129,${0.15 + intensity * 0.55})`
    if (gain < 0)  return `rgba(239,68,68,${0.15 + intensity * 0.55})`
    return 'transparent'
  }

  return (
    <div className="bt-heatmap-wrap">
      <div className="bt-heatmap-title">Monthly P&amp;L Heatmap · stock % gain averaged per month</div>
      <div className="bt-heatmap-grid" style={{ gridTemplateColumns: `52px ${months.map(() => '1fr').join(' ')}` }}>
        <span className="bt-hm-hdr" />
        {months.map(m => <span key={m} className="bt-hm-hdr">{m}</span>)}

        {years.map(yr => (
          <React.Fragment key={yr}>
            <span className="bt-hm-year">{yr}</span>
            {months.map((_, mi) => {
              const d = byKey[`${yr}-${mi + 1}`]
              return (
                <div
                  key={mi}
                  className="bt-hm-cell"
                  style={{ background: d ? cellColor(d.gain) : 'transparent' }}
                  title={d ? `${d.count} trades · avg ${d.gain >= 0 ? '+' : ''}${d.gain}% · ${d.wins}W/${d.count - d.wins}L` : ''}
                >
                  {d ? (
                    <span style={{ color: d.gain >= 0 ? '#10b981' : '#ef4444', fontSize: 9 }}>
                      {d.gain >= 0 ? '+' : ''}{d.gain}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="bt-heatmap-note">
        Color intensity = magnitude of avg gain/loss. Hover for trade count.
      </div>
    </div>
  )
}

// ── Market regime split ───────────────────────────────────────────────────────
function RegimeSplit({ regimeStats }) {
  if (!regimeStats) return null
  const { bull, bear } = regimeStats
  if (!bull && !bear) return null

  const fmt = (v, pos) => v != null ? `${pos && v >= 0 ? '+' : ''}${v}%` : '—'
  const col = (v, base = 0) => v == null ? '#6b7280' : v >= base ? '#10b981' : '#ef4444'

  const rows = [
    { label: 'Signals',  bull: bull?.count,   bear: bear?.count,   color: false },
    { label: 'Win Rate', bull: bull?.winRate,  bear: bear?.winRate,  unit: '%', base: 50 },
    { label: 'Avg Move', bull: bull?.avgGain,  bear: bear?.avgGain,  unit: '%', base: 0, pos: true },
    { label: 'Avg Win',  bull: bull?.avgWin,   bear: bear?.avgWin,   unit: '%', base: 0 },
    { label: 'Avg Loss', bull: bull?.avgLoss,  bear: bear?.avgLoss,  unit: '%', base: 0 },
  ]

  return (
    <div className="bt-regime-wrap">
      <div className="bt-regime-title">Signal Performance by Market Regime</div>
      <div className="bt-regime-sub">Regime = SPY above (bull) or below (bear) its 50-day SMA at signal date</div>
      <div className="bt-regime-grid">
        <span className="bt-rg-hdr" />
        <span className="bt-rg-hdr bt-rg-bull">📈 Bull (SPY &gt; 50-SMA)</span>
        <span className="bt-rg-hdr bt-rg-bear">📉 Bear (SPY &lt; 50-SMA)</span>
        {rows.map(({ label, bull: bv, bear: rv, unit, base, pos, color }) => (
          <React.Fragment key={label}>
            <span className="bt-rg-label">{label}</span>
            <span className="bt-rg-val" style={{ color: color === false ? '#94a3b8' : col(bv, base) }}>
              {bv != null ? (unit ? (pos && bv >= 0 ? '+' : '') + bv + unit : bv) : '—'}
            </span>
            <span className="bt-rg-val" style={{ color: color === false ? '#94a3b8' : col(rv, base) }}>
              {rv != null ? (unit ? (pos && rv >= 0 ? '+' : '') + rv + unit : rv) : '—'}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ── Window sensitivity table ──────────────────────────────────────────────────
function WindowSensitivity({ windowData }) {
  if (!windowData) return null
  const windows = [5, 10, 20]

  return (
    <div className="bt-wsens-wrap">
      <div className="bt-wsens-title">Forward Window Sensitivity — Stock Returns</div>
      <div className="bt-wsens-sub">Same signals, measured across all three hold windows simultaneously</div>
      <div className="bt-wsens-grid">
        <span className="bt-ws-hdr" />
        {windows.map(w => <span key={w} className="bt-ws-hdr">{w}d</span>)}
        {[
          { label: 'Win Rate',   key: 'winRate',     fmt: v => `${v}%`,                  col: v => v >= 55 ? '#10b981' : v >= 45 ? '#f59e0b' : '#ef4444' },
          { label: 'Avg Move',   key: 'avgGain',     fmt: v => `${v >= 0 ? '+' : ''}${v}%`, col: v => v >= 0 ? '#10b981' : '#ef4444' },
          { label: 'Avg Win',    key: 'avgWin',      fmt: v => `+${v}%`,                 col: () => '#10b981' },
          { label: 'Avg Loss',   key: 'avgLoss',     fmt: v => `${v}%`,                  col: () => '#ef4444' },
          { label: 'Total Rtn',  key: 'totalReturn', fmt: v => `${v >= 0 ? '+' : ''}${v}%`, col: v => v >= 0 ? '#10b981' : '#ef4444' },
        ].map(({ label, key, fmt, col }) => (
          <React.Fragment key={label}>
            <span className="bt-ws-label">{label}</span>
            {windows.map(w => {
              const v = windowData[w]?.[key]
              return (
                <span key={w} className="bt-ws-val" style={{ color: v != null ? col(v) : '#6b7280' }}>
                  {v != null ? fmt(v) : '—'}
                </span>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ── Low-sample warning ────────────────────────────────────────────────────────
function LowSampleWarning({ count }) {
  return (
    <div className="bt-low-sample">
      <span className="bt-low-sample-icon">⚠</span>
      <span>
        Only {count} signals fired over 2 years — too few for statistical confidence.
        Win rates need 30+ trades to be meaningful. Use these results for direction only.
      </span>
    </div>
  )
}

// ── Stock stats grid ──────────────────────────────────────────────────────────
function StatGrid({ result }) {
  const winColor = result.winRate >= 55 ? '#10b981' : result.winRate >= 45 ? '#f59e0b' : '#ef4444'
  const rtnColor = result.totalReturn >= 0 ? '#10b981' : '#ef4444'

  return (
    <div className="bt-stats">
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Stock Win Rate: The percentage of historical signals that resulted in a profitable move within your forward window. Above 55% is strong.">Win Rate</span>
        <span className="bt-stat-val" style={{ color: winColor }}>{result.winRate}%</span>
        <span className="bt-stat-sub">{result.totalWins}/{result.totalTrades} trades</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Avg Move: The average price change across all signals, both wins and losses, measured over the forward hold window.">Avg Move</span>
        <span className="bt-stat-val" style={{ color: result.avgGain >= 0 ? '#10b981' : '#ef4444' }}>
          {result.avgGain >= 0 ? '+' : ''}{result.avgGain}%
        </span>
        <span className="bt-stat-sub">per signal · {result.lookforward}d hold</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Avg Win: The average % gain on trades that closed profitably.">Avg Win</span>
        <span className="bt-stat-val" style={{ color: '#10b981' }}>+{result.avgWin}%</span>
        <span className="bt-stat-sub">when right</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Avg Loss: The average % loss on trades that didn't work out.">Avg Loss</span>
        <span className="bt-stat-val" style={{ color: '#ef4444' }}>{result.avgLoss}%</span>
        <span className="bt-stat-sub">when wrong</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Compounded Return: The total % return if you reinvested profits into every signal over the 2-year backtest period.">Compounded Return</span>
        <span className="bt-stat-val" style={{ color: rtnColor }}>
          {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn}%
        </span>
        <span className="bt-stat-sub">full 2-year period</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Max Consecutive Losses: The longest losing streak in the backtest.">Max Cons. Loss</span>
        <span className="bt-stat-val" style={{ color: result.maxConsecLoss >= 4 ? '#ef4444' : '#f59e0b' }}>
          {result.maxConsecLoss}
        </span>
        <span className="bt-stat-sub">in a row</span>
      </div>
    </div>
  )
}

// ── Spread vs Outright comparison ─────────────────────────────────────────────
function SpreadVsOutright({ result }) {
  const {
    optWinRate, avgOptGain, avgOptLoss,
    spWinRate,  spAvgWin,   spAvgLoss,
    ivCrushCount, ivSavedCount, totalTrades,
    avgCostRatio, spTpHits, spSlHits,
    tpHits, slHits,
  } = result

  if (spWinRate == null) return null

  const evOut = (optWinRate / 100) * (avgOptGain / 100) + (1 - optWinRate / 100) * (avgOptLoss / 100)
  const evSp  = (spWinRate  / 100) * (spAvgWin  / 100) + (1 - spWinRate  / 100) * (spAvgLoss / 100)
  const fmtEV = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  const ivRescuePct    = ivCrushCount > 0 ? Math.round(ivSavedCount / ivCrushCount * 100) : 0
  const costSavingsPct = avgCostRatio  != null ? Math.round((1 - avgCostRatio) * 100) : null
  const spreadBetter   = evSp > evOut

  return (
    <div className="bt-svs-root">
      <div className="bt-exit-label">Outright Option vs Debit Spread — Simulated on Same Signals</div>
      <div className="bt-svs-note">
        Spread = buy ATM strike + sell the next OTM strike (same expiry). Both legs repriced bar-by-bar using the same IV model.
        {costSavingsPct != null && ` Average cost reduction: ${costSavingsPct}% less capital at risk per trade.`}
      </div>
      <div className="bt-svs-grid">
        <span className="bt-svs-hdr" />
        <span className="bt-svs-hdr">Outright Option</span>
        <span className="bt-svs-hdr bt-svs-sp-hdr">Debit Spread</span>
        {[
          { label: 'Win Rate',       out: `${optWinRate}%`,            sp: `${spWinRate}%`,                      spBetter: spWinRate > optWinRate },
          { label: 'Avg Win',        out: `+${avgOptGain}%`,           sp: `+${spAvgWin}%`,                      spBetter: false, note: 'capped by spread width' },
          { label: 'Avg Loss',       out: `${avgOptLoss}%`,            sp: `${spAvgLoss}%`,                      spBetter: +spAvgLoss > +avgOptLoss },
          { label: 'EV / Trade',     out: fmtEV(evOut),                sp: fmtEV(evSp),                          spBetter: evSp > evOut, highlight: true },
          { label: 'TP Hits',        out: `${tpHits ?? 0}`,            sp: `${spTpHits ?? 0}`,                   spBetter: null },
          { label: 'SL Hits',        out: `${slHits ?? 0}`,            sp: `${spSlHits ?? 0}`,                   spBetter: (spSlHits ?? 0) < (slHits ?? 0) },
          { label: 'IV Crush Rescue',out: '0 rescued',                 sp: `${ivSavedCount} of ${ivCrushCount} rescued`, spBetter: ivSavedCount > 0 },
        ].map(({ label, out, sp, spBetter, highlight, note }) => (
          <React.Fragment key={label}>
            <span className={`bt-svs-label${highlight ? ' bt-svs-hl' : ''}`}>
              {label}
              {note && <span className="bt-svs-note-inline"> — {note}</span>}
            </span>
            <span className={`bt-svs-val${highlight ? ' bt-svs-hl' : ''}`}>{out}</span>
            <span className={`bt-svs-val${spBetter === true ? ' bt-svs-better' : spBetter === false ? ' bt-svs-worse' : ''}${highlight ? ' bt-svs-hl' : ''}`}>{sp}</span>
          </React.Fragment>
        ))}
      </div>
      <div className={`bt-svs-verdict ${spreadBetter ? 'bt-svs-v-spread' : 'bt-svs-v-out'}`}>
        {spreadBetter
          ? `⚡ DEBIT SPREAD wins on this ticker — higher EV per trade. Use the spread, especially when IV is elevated at entry.`
          : `📊 OUTRIGHT OPTION wins on this ticker — higher EV per trade. IV crush wasn't a dominant drag.`}
      </div>
      {ivCrushCount > 0 && ivSavedCount > 0 && (
        <div className="bt-svs-rescue">
          <strong>IV Crush Recovery:</strong>{' '}
          {ivCrushCount} historical trades were directionally correct but the outright option still lost.
          The debit spread would have <strong>turned {ivSavedCount} ({ivRescuePct}%) of those losers into winners</strong>.
        </div>
      )}
      {ivCrushCount > 0 && ivSavedCount === 0 && (
        <div className="bt-svs-rescue bt-svs-rescue-none">
          The spread didn't rescue any IV crush trades here. Avoid new entries when IV is elevated on this ticker.
        </div>
      )}
    </div>
  )
}

// ── Grade comparison ──────────────────────────────────────────────────────────
function GradeComparison({ gradeStats, totalTrades }) {
  if (!gradeStats) return null
  const grades = ['A+', 'A', 'B'].filter(g => gradeStats[g])
  if (grades.length < 1) return null

  const evOf = g => {
    const d = gradeStats[g]
    const wr = d.optWinRate / 100
    return (wr * (d.avgWin / 100) + (1 - wr) * (d.avgLoss / 100)) * 100
  }
  const evs = grades.map(evOf)
  const bestEV = Math.max(...evs)
  const bestGrade = grades[evs.indexOf(bestEV)]

  const rows = [
    { label: 'Signals',    fn: d => d.count,           fmt: v => v },
    { label: 'Win Rate',   fn: d => d.optWinRate,       fmt: v => `${v}%` },
    { label: 'Avg Win',    fn: d => d.avgWin,           fmt: v => `+${v}%` },
    { label: 'Avg Loss',   fn: d => d.avgLoss,          fmt: v => `${v}%` },
    { label: 'TP Hit',     fn: d => d.tpHits,           fmt: v => v },
    { label: 'SL Hit',     fn: d => d.slHits,           fmt: v => v },
    { label: 'EV / Trade', fn: (_, g) => evOf(g),      fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, isEV: true },
  ]

  return (
    <div className="bt-grade-cmp">
      <div className="bt-exit-label">Win Rate &amp; EV by Setup Grade — Options</div>
      <div className="bt-gcmp-grid" style={{ gridTemplateColumns: `120px ${grades.map(() => '1fr').join(' ')}` }}>
        <span className="bt-gcmp-cell bt-gcmp-hdr" />
        {grades.map(g => <span key={g} className="bt-gcmp-cell bt-gcmp-hdr bt-gcmp-grade-hdr">{g}</span>)}
        {rows.map(({ label, fn, fmt, isEV }) => (
          <>
            <span key={`lbl-${label}`} className="bt-gcmp-cell bt-gcmp-label">{label}</span>
            {grades.map((g, gi) => {
              const raw    = fn(gradeStats[g], g)
              const isBest = isEV && evs[gi] === bestEV
              const isWeak = isEV && evs[gi] < 20 && evs[gi] < bestEV
              return (
                <span key={`${label}-${g}`} className={`bt-gcmp-cell bt-gcmp-val${isBest ? ' bt-gcmp-best' : ''}${isWeak ? ' bt-gcmp-weak' : ''}`}>
                  {fmt(raw)}
                </span>
              )
            })}
          </>
        ))}
      </div>
      {gradeStats['B'] && evOf('B') < 20 && grades.length > 1 && (
        <div className="bt-grade-rec">
          ⚡ Skip B setups — EV is only {evOf('B').toFixed(1)}% vs {evOf(bestGrade).toFixed(1)}% for {bestGrade}.
        </div>
      )}
    </div>
  )
}

// ── Scale-out comparison ──────────────────────────────────────────────────────
function ScaleOutCompare({ result }) {
  const {
    optWinRate, avgOptGain, avgOptLoss,
    soWinRate,  soAvgWin,   soAvgLoss,
    totalTrades, tpHits, slHits, tpHitsSO, slHitsSO,
  } = result

  const evStd = (optWinRate / 100) * (avgOptGain / 100) + (1 - optWinRate / 100) * (avgOptLoss / 100)
  const evSO  = (soWinRate  / 100) * (soAvgWin   / 100) + (1 - soWinRate  / 100) * (soAvgLoss  / 100)
  const timeStd = totalTrades - (tpHits  ?? 0) - (slHits  ?? 0)
  const timeSO  = totalTrades - (tpHitsSO ?? 0) - (slHitsSO ?? 0)
  const fmtEV = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  const evDiff  = ((evSO - evStd) * 100).toFixed(1)
  const soBetter = evSO > evStd

  const rows = [
    { label: 'Options Win Rate', std: `${optWinRate}%`,    so: `${soWinRate}%`,    good: () => soWinRate > optWinRate },
    { label: 'Avg Win',          std: `+${avgOptGain}%`,   so: `+${soAvgWin}%`,    good: () => false },
    { label: 'Avg Loss',         std: `${avgOptLoss}%`,    so: `${soAvgLoss}%`,    good: () => soAvgLoss > avgOptLoss },
    { label: 'EV per Trade',     std: fmtEV(evStd),        so: fmtEV(evSO),        good: () => evSO > evStd, highlight: true },
    { label: 'TP Hits',          std: tpHits ?? 0,         so: tpHitsSO ?? 0,      good: null },
    { label: 'SL Hits',          std: slHits ?? 0,         so: slHitsSO ?? 0,      good: () => (slHitsSO ?? 0) < (slHits ?? 0) },
    { label: 'Time Exits',       std: timeStd,             so: timeSO,             good: null },
  ]

  return (
    <div className="bt-scaleout-cmp">
      <div className="bt-exit-label">Exit Strategy Comparison — Standard vs Scale-Out 50/50</div>
      <div className="bt-scmp-grid">
        <div className="bt-scmp-hdr-row">
          <span className="bt-scmp-label" />
          <span className="bt-scmp-col-hdr">Standard</span>
          <span className="bt-scmp-col-hdr bt-scmp-so-hdr">Scale-Out 50/50</span>
        </div>
        {rows.map(({ label, std, so, good, highlight }) => {
          const isBetter = good && good()
          return (
            <div key={label} className={`bt-scmp-row${highlight ? ' bt-scmp-row-hl' : ''}`}>
              <span className="bt-scmp-label">{label}</span>
              <span className="bt-scmp-val">{std}</span>
              <span className={`bt-scmp-val${isBetter ? ' bt-scmp-better' : ''}`}>{so}</span>
            </div>
          )
        })}
      </div>
      <div className={`bt-scaleout-verdict ${soBetter ? 'bt-so-win' : 'bt-so-neutral'}`}>
        {soBetter
          ? `⚡ Scale-Out improves EV by +${evDiff}% per trade. Lock 50% at +100%, let the rest run.`
          : `Hold for the full grade target. Standard exits generate more EV on this ticker (by ${Math.abs(+evDiff)}%).`
        }
      </div>
    </div>
  )
}

// ── Options simulation stats ──────────────────────────────────────────────────
function OptionsStats({ result }) {
  const { optWinRate, avgOptGain, avgOptLoss, ivCrushCount, ivCrushPct,
          totalTrades, tpHits, slHits, gradeCount, gradeStats,
          spWinRate, spAvgWin, spAvgLoss, ivSavedCount, avgCostRatio } = result
  const winClr   = optWinRate >= 50 ? '#10b981' : optWinRate >= 40 ? '#f59e0b' : '#ef4444'
  const spWinClr = (spWinRate ?? 0) >= 50 ? '#10b981' : (spWinRate ?? 0) >= 40 ? '#f59e0b' : '#ef4444'
  const timeExits    = totalTrades - (tpHits ?? 0) - (slHits ?? 0)
  const ivRescuePct  = ivCrushCount > 0 && ivSavedCount > 0 ? Math.round(ivSavedCount / ivCrushCount * 100) : 0
  const costSaving   = avgCostRatio != null ? Math.round((1 - avgCostRatio) * 100) : null

  return (
    <div className="bt-opts-wrap">
      <div className="bt-opts-title">Options P&amp;L Simulation — 21 DTE · ATM Strike · Grade-Adaptive Exits</div>
      <div className="bt-opts-note">
        Entry IV = rolling 20-day HV × 1.20 (includes the volatility risk premium real options carry).
        Exits scan bar-by-bar: A+ closes at +200% / −20%, A at +150% / −25%, B at +100% / −30%.
        Unresolved trades close at 10 days with 15% IV crush. Earnings windows excluded.
      </div>

      <div className="bt-opts-section-label">OUTRIGHT OPTION (naked long)</div>
      <div className="bt-stats">
        <div className="bt-stat">
          <span className="bt-stat-lbl">Options Win Rate</span>
          <span className="bt-stat-val" style={{ color: winClr }}>{optWinRate}%</span>
          <span className="bt-stat-sub">{totalTrades} signals</span>
        </div>
        <div className="bt-stat-div" />
        <div className="bt-stat">
          <span className="bt-stat-lbl">Avg Win</span>
          <span className="bt-stat-val" style={{ color: '#10b981' }}>+{avgOptGain}%</span>
          <span className="bt-stat-sub">on premium</span>
        </div>
        <div className="bt-stat-div" />
        <div className="bt-stat">
          <span className="bt-stat-lbl">Avg Loss</span>
          <span className="bt-stat-val" style={{ color: '#ef4444' }}>{avgOptLoss}%</span>
          <span className="bt-stat-sub">on premium</span>
        </div>
        <div className="bt-stat-div" />
        <div className="bt-stat">
          <span className="bt-stat-lbl">IV Crush Risk</span>
          <span className="bt-stat-val" style={{ color: ivCrushCount > 0 ? '#f59e0b' : '#10b981' }}>{ivCrushPct}%</span>
          <span className="bt-stat-sub">{ivCrushCount} right direction, option lost</span>
        </div>
      </div>

      {spWinRate != null && (
        <>
          <div className="bt-opts-section-label" style={{ marginTop: 14 }}>
            DEBIT SPREAD (buy ATM + sell OTM)
            {costSaving != null && <span className="bt-opts-section-sub"> · costs ~{costSaving}% less per trade</span>}
          </div>
          <div className="bt-stats">
            <div className="bt-stat">
              <span className="bt-stat-lbl">Spread Win Rate</span>
              <span className="bt-stat-val" style={{ color: spWinClr }}>{spWinRate}%</span>
              <span className="bt-stat-sub">{totalTrades} signals</span>
            </div>
            <div className="bt-stat-div" />
            <div className="bt-stat">
              <span className="bt-stat-lbl">Avg Win</span>
              <span className="bt-stat-val" style={{ color: '#10b981' }}>+{spAvgWin}%</span>
              <span className="bt-stat-sub">capped by width</span>
            </div>
            <div className="bt-stat-div" />
            <div className="bt-stat">
              <span className="bt-stat-lbl">Avg Loss</span>
              <span className="bt-stat-val" style={{ color: '#ef4444' }}>{spAvgLoss}%</span>
              <span className="bt-stat-sub">on debit paid</span>
            </div>
            <div className="bt-stat-div" />
            <div className="bt-stat">
              <span className="bt-stat-lbl">IV Crush Rescued</span>
              <span className="bt-stat-val" style={{ color: ivRescuePct >= 50 ? '#10b981' : ivRescuePct > 0 ? '#f59e0b' : '#6b7280' }}>
                {ivRescuePct > 0 ? `${ivRescuePct}%` : ivCrushCount > 0 ? '0%' : '—'}
              </span>
              <span className="bt-stat-sub">{ivSavedCount} of {ivCrushCount} saved</span>
            </div>
          </div>
        </>
      )}

      {tpHits != null && (
        <div className="bt-exit-breakdown">
          <div className="bt-exit-label">Exit Breakdown</div>
          {[
            { label: 'TP Hit',     cls: 'tp',   count: tpHits },
            { label: 'SL Hit',     cls: 'sl',   count: slHits },
            { label: 'Time Exit',  cls: 'time', count: timeExits },
          ].map(({ label, cls, count }) => (
            <div key={label} className="bt-exit-row">
              <span className={`bt-exit-type ${cls}`}>{label}</span>
              <div className="bt-exit-bar-track">
                <div className={`bt-exit-bar ${cls}`} style={{ width: `${totalTrades > 0 ? (count / totalTrades) * 100 : 0}%` }} />
              </div>
              <span className="bt-exit-count">{count}</span>
            </div>
          ))}
        </div>
      )}

      {gradeCount && (
        <div className="bt-grade-dist">
          <div className="bt-exit-label">Signal Grade Distribution</div>
          <div className="bt-grade-row">
            {Object.entries(gradeCount).map(([g, cnt]) => (
              <div key={g} className="bt-grade-cell">
                <span className="bt-grade-lbl">{g}</span>
                <span className="bt-grade-cnt">{cnt}</span>
                <span className="bt-grade-pct">{totalTrades > 0 ? Math.round(cnt / totalTrades * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SpreadVsOutright result={result} />
      {gradeStats && <GradeComparison gradeStats={gradeStats} totalTrades={totalTrades} />}
      <ScaleOutCompare result={result} />
    </div>
  )
}

// ── Kelly position sizer ──────────────────────────────────────────────────────
function KellySizer({ result, accountInput, setAccountInput }) {
  const acct   = parseFloat(String(accountInput).replace(/,/g, '')) || 0
  const stockK = result.kellyStock  ?? 0
  const optK   = result.kellyOptions ?? 0
  const stockD$ = acct > 0 && stockK > 0 ? Math.round(acct * stockK / 100) : null
  const optD$   = acct > 0 && optK   > 0 ? Math.round(acct * optK   / 100) : null

  return (
    <div className="bt-kelly-wrap">
      <div className="bt-kelly-head">
        <span className="bt-kelly-title" data-tip="Half-Kelly Criterion: Optimal % of your account to risk on each trade, given win rate and win/loss sizes. Halved to reduce ruin risk.">Position Sizing · Half-Kelly Criterion</span>
        <span className="bt-kelly-sub">Kelly f* = p − (1−p)/b · halved to reduce variance. Max risk per trade.</span>
      </div>
      <div className="bt-kelly-acct-row">
        <span className="bt-kelly-lbl">Account Size</span>
        <div className="bt-kelly-input-wrap">
          <span className="bt-kelly-sym">$</span>
          <input
            type="text"
            className="bt-kelly-input"
            value={accountInput}
            onChange={e => {
              setAccountInput(e.target.value)
              const n = parseFloat(e.target.value.replace(/,/g, ''))
              if (n > 0) localStorage.setItem('rp_account', String(n))
            }}
          />
        </div>
      </div>
      <div className="bt-kelly-grid">
        <div className="bt-kelly-cell">
          <span className="bt-kelly-cell-lbl">Stock Signals</span>
          <span className="bt-kelly-pct" style={{ color: stockK > 0 ? '#10b981' : '#6b7280' }}>
            {stockK > 0 ? `${stockK.toFixed(1)}%` : 'Insufficient data'}
          </span>
          {stockD$ != null && <span className="bt-kelly-dollar">${stockD$.toLocaleString()} per trade</span>}
          <span className="bt-kelly-note">{result.winRate}% win · +{result.avgWin}% / {result.avgLoss}%</span>
        </div>
        <div className="bt-kelly-div" />
        <div className="bt-kelly-cell">
          <span className="bt-kelly-cell-lbl">Options Trades</span>
          <span className="bt-kelly-pct" style={{ color: optK > 0 ? '#f59e0b' : '#6b7280' }}>
            {optK > 0 ? `${optK.toFixed(1)}%` : 'Insufficient data'}
          </span>
          {optD$ != null && <span className="bt-kelly-dollar">${optD$.toLocaleString()} per trade</span>}
          <span className="bt-kelly-note">{result.optWinRate}% opt win · IV crush included</span>
        </div>
      </div>
      <div className="bt-kelly-footnote">
        These are the mathematically optimal bet sizes from your historical signals.
        Never risk more than the Kelly number — the math breaks above that point.
      </div>
    </div>
  )
}

// ── Daily income calculator ───────────────────────────────────────────────────
function DailyIncomeCalc({ result, accountInput, setAccountInput, dailyTarget, setDailyTarget }) {
  const acct   = parseFloat(String(accountInput).replace(/,/g, '')) || 0
  const target = parseFloat(String(dailyTarget).replace(/,/g, '')) || 400

  const { optWinRate, avgOptGain, avgOptLoss, totalTrades, gradeStats, kellyOptions } = result
  const ev  = (optWinRate / 100) * (avgOptGain / 100) + (1 - optWinRate / 100) * (avgOptLoss / 100)
  const spd = totalTrades / (2 * 252)
  const evDay    = ev * spd
  const reqRisk  = evDay > 0.0001 ? target / evDay : null
  const reqAcct  = reqRisk != null ? reqRisk / 0.02 : null

  const kellyFrac    = (kellyOptions ?? 0) / 100
  const acctRisk     = acct * kellyFrac
  const expectedDay  = acctRisk * evDay

  const apG       = gradeStats?.['A+']
  const apEV      = apG ? (apG.optWinRate / 100) * (apG.avgWin / 100) + (1 - apG.optWinRate / 100) * (apG.avgLoss / 100) : null
  const apSPD     = apG ? apG.count / (2 * 252) : null
  const apEvDay   = (apEV != null && apSPD != null) ? apEV * apSPD : null
  const apReqRisk = apEvDay > 0.0001 ? target / apEvDay : null
  const apReqAcct = apReqRisk != null ? apReqRisk / 0.02 : null
  const overKelly = reqRisk != null && acct > 0 && reqRisk > acct * (kellyFrac || 0.02)

  return (
    <div className="bt-income-wrap">
      <div className="bt-kelly-head">
        <span className="bt-kelly-title">Daily Income Calculator</span>
        <span className="bt-kelly-sub">
          {totalTrades} signals over 2 years · {(spd * 252).toFixed(1)} per year avg
        </span>
      </div>
      <div className="bt-income-inputs">
        <div className="bt-kelly-input-wrap">
          <span className="bt-kelly-sym">Target</span>
          <span className="bt-kelly-sym">$</span>
          <input type="text" className="bt-kelly-input" value={dailyTarget} onChange={e => setDailyTarget(e.target.value)} placeholder="400" style={{ width: 70 }} />
          <span className="bt-kelly-sym">/ day</span>
        </div>
        <div className="bt-kelly-input-wrap">
          <span className="bt-kelly-sym">Account</span>
          <span className="bt-kelly-sym">$</span>
          <input type="text" className="bt-kelly-input" value={accountInput} onChange={e => { setAccountInput(e.target.value); const n = parseFloat(e.target.value.replace(/,/g, '')); if (n > 0) localStorage.setItem('rp_account', String(n)) }} style={{ width: 90 }} />
        </div>
      </div>

      <div className="bt-income-section">
        <div className="bt-income-section-title">ALL GRADES — What It Takes to Hit ${target.toLocaleString()}/Day</div>
        <div className="bt-income-grid">
          {[
            { lbl: 'EV per $1 Risked',       val: `$${ev.toFixed(3)}`,                sub: `${(ev * 100).toFixed(1)}% avg return`, color: ev > 0 ? '#10b981' : '#ef4444' },
            { lbl: 'Avg Signals / Day',       val: spd.toFixed(3),                    sub: `${(spd * 252).toFixed(1)} per year` },
            { lbl: 'Required Risk / Trade',   val: reqRisk  != null ? `$${Math.round(reqRisk).toLocaleString()}`  : 'N/A', sub: 'to average target/day', color: '#f59e0b' },
            { lbl: 'Account Needed (2% risk)',val: reqAcct  != null ? `$${Math.round(reqAcct).toLocaleString()}`  : 'N/A', sub: 'risking 2% per trade',  color: '#f59e0b' },
          ].map(({ lbl, val, sub, color }) => (
            <div key={lbl} className="bt-income-cell">
              <span className="bt-income-lbl">{lbl}</span>
              <span className="bt-income-val" style={{ color }}>{val}</span>
              <span className="bt-income-sub">{sub}</span>
            </div>
          ))}
        </div>
      </div>

      {apG && (
        <div className="bt-income-section bt-income-section-ap">
          <div className="bt-income-section-title">A+ ONLY — Fewer Trades, Higher EV Per Trade</div>
          <div className="bt-income-grid">
            {[
              { lbl: 'EV per $1 Risked',       val: apEV  != null ? `$${apEV.toFixed(3)}` : '—', sub: apEV  != null ? `${(apEV * 100).toFixed(1)}% avg return` : '', color: (apEV ?? 0) > 0 ? '#10b981' : '#ef4444' },
              { lbl: 'Avg Signals / Day',       val: apSPD != null ? apSPD.toFixed(3) : '—',      sub: apSPD != null ? `${(apSPD * 252).toFixed(1)} per year` : '' },
              { lbl: 'Required Risk / Trade',   val: apReqRisk != null ? `$${Math.round(apReqRisk).toLocaleString()}` : '—', sub: 'to average target/day', color: '#f59e0b' },
              { lbl: 'Account Needed (2% risk)',val: apReqAcct != null ? `$${Math.round(apReqAcct).toLocaleString()}` : '—', sub: 'risking 2% per trade',  color: '#f59e0b' },
            ].map(({ lbl, val, sub, color }) => (
              <div key={lbl} className="bt-income-cell">
                <span className="bt-income-lbl">{lbl}</span>
                <span className="bt-income-val" style={{ color }}>{val}</span>
                <span className="bt-income-sub">{sub}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {acct > 0 && (
        <div className="bt-income-section">
          <div className="bt-income-section-title">WITH YOUR ${acct.toLocaleString()} ACCOUNT</div>
          <div className="bt-income-reality">
            <div className="bt-income-reality-row">
              <span>Kelly-optimal risk / trade</span>
              <span style={{ color: '#f59e0b' }}>
                {kellyFrac > 0 ? `${(kellyFrac * 100).toFixed(1)}% = $${Math.round(acct * kellyFrac).toLocaleString()}` : 'Insufficient data'}
              </span>
            </div>
            <div className="bt-income-reality-row">
              <span>Expected daily income (Kelly sizing)</span>
              <span style={{ color: expectedDay > 0 ? '#10b981' : '#ef4444' }}>
                {expectedDay > 0.01 ? `~$${expectedDay.toFixed(2)}/day avg` : '< $0.01/day'}
              </span>
            </div>
            {reqAcct != null && acct < reqAcct && (
              <div className="bt-income-reality-row">
                <span>Gap to reach target-capable account</span>
                <span style={{ color: '#ef4444' }}>Need ${Math.round(reqAcct - acct).toLocaleString()} more</span>
              </div>
            )}
            {reqAcct != null && acct >= reqAcct && (
              <div className="bt-income-reality-row">
                <span>Account is large enough to target</span>
                <span style={{ color: '#10b981' }}>✓ ${target.toLocaleString()}/day is achievable at 2% risk</span>
              </div>
            )}
          </div>
          {overKelly && reqRisk != null && (
            <div className="bt-income-warning">
              ⚠ Hitting ${target.toLocaleString()}/day requires risking ${Math.round(reqRisk).toLocaleString()} per trade
              ({acct > 0 ? ((reqRisk / acct) * 100).toFixed(0) : '—'}% of account) — above Kelly. Grow the account to
              ${reqAcct != null ? Math.round(reqAcct).toLocaleString() : '—'} first.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Fee comparison ────────────────────────────────────────────────────────────
function FeeComparison({ result, accountInput }) {
  const acct        = parseFloat(String(accountInput).replace(/,/g, '')) || 0
  const totalReturn = result.totalReturn ?? 0
  if (acct <= 0 || totalReturn <= 0) return null

  const profit      = acct * (totalReturn / 100)
  const fundAUMFee  = acct * 0.04
  const fundPerfFee = profit * 0.20
  const totalFundFee  = fundAUMFee + fundPerfFee
  const pctExtracted  = ((totalFundFee / profit) * 100).toFixed(0)

  return (
    <div className="bt-fee-wrap">
      <div className="bt-fee-eyebrow">What You Kept by Managing Yourself</div>
      <div className="bt-fee-subtitle">
        Based on your {totalReturn >= 0 ? '+' : ''}{totalReturn}% backtest return on a ${acct.toLocaleString()} account over 2 years.
      </div>
      <div className="bt-fee-grid">
        <div className="bt-fee-col bt-fee-col-fund">
          <div className="bt-fee-col-title">Hedge Fund (2 &amp; 20)</div>
          <div className="bt-fee-row-group">
            <div className="bt-fee-row"><span>Your gross profit</span><span>${Math.round(profit).toLocaleString()}</span></div>
            <div className="bt-fee-row bt-fee-row-cost"><span>Management fee (2%/yr × 2)</span><span>−${Math.round(fundAUMFee).toLocaleString()}</span></div>
            <div className="bt-fee-row bt-fee-row-cost"><span>Performance fee (20% of profit)</span><span>−${Math.round(fundPerfFee).toLocaleString()}</span></div>
            <div className="bt-fee-row bt-fee-row-net"><span>What you'd walk away with</span><span>${Math.round(profit - totalFundFee).toLocaleString()}</span></div>
          </div>
          <div className="bt-fee-extracted">{pctExtracted}% of your profits extracted in fees</div>
        </div>
        <div className="bt-fee-col bt-fee-col-you">
          <div className="bt-fee-col-title">You (This System)</div>
          <div className="bt-fee-row-group">
            <div className="bt-fee-row"><span>Your gross profit</span><span>${Math.round(profit).toLocaleString()}</span></div>
            <div className="bt-fee-row"><span>Management fee</span><span className="bt-fee-zero">$0</span></div>
            <div className="bt-fee-row"><span>Performance fee</span><span className="bt-fee-zero">$0</span></div>
            <div className="bt-fee-row bt-fee-row-net bt-fee-row-net-you"><span>What you walk away with</span><span>${Math.round(profit).toLocaleString()}</span></div>
          </div>
          <div className="bt-fee-kept">You kept ${Math.round(totalFundFee).toLocaleString()} more</div>
        </div>
      </div>
      <div className="bt-fee-statement">
        A hedge fund would have collected ${Math.round(totalFundFee).toLocaleString()} of your profits — {pctExtracted}% of everything you made. That money stays with you when you run your own system.
      </div>
    </div>
  )
}

// ── Recent trades table ───────────────────────────────────────────────────────
function TradesTable({ trades, lookfwd }) {
  const recent = [...trades].reverse().slice(0, 20)
  return (
    <div className="bt-table-wrap">
      <div className="bt-table-label">Recent Signals ({Math.min(20, trades.length)} of {trades.length})</div>
      <div className="bt-table">
        <div className="bt-thead">
          <span>Date</span><span>Signal</span><span>Entry</span><span>Exit ({lookfwd}d)</span><span>Move</span><span>Result</span>
        </div>
        {recent.map((t, i) => (
          <div key={i} className={`bt-trow${t.win ? ' bt-win' : ' bt-loss'}`}>
            <span className="bt-td-date">{t.date}</span>
            <span className="bt-td-sig" style={{ color: t.signal === 'CALL' ? '#10b981' : '#ef4444' }}>
              {t.signal}
              {t.grade && <span style={{ fontSize: 9, color: '#4a6380', marginLeft: 4 }}>{t.grade}</span>}
            </span>
            <span className="bt-td">${t.entryPrice}</span>
            <span className="bt-td">${t.exitPrice}</span>
            <span className="bt-td" style={{ color: t.gain >= 0 ? '#10b981' : '#ef4444' }}>
              {t.gain >= 0 ? '+' : ''}{t.gain}%
            </span>
            <span className={`bt-td-result ${t.win ? 'bt-td-win' : 'bt-td-loss'}`}>{t.win ? 'WIN' : 'LOSS'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Backtest({ ticker, onResult }) {
  const [status,         setStatus]         = useState('idle')
  const [result,         setResult]         = useState(null)
  const [error,          setError]          = useState(null)
  const [lookfwd,        setLookfwd]        = useState(10)
  const [activeView,     setActiveView]     = useState('stock')
  const [withCommission, setWithCommission] = useState(false)
  const [showApOnly,     setShowApOnly]     = useState(false)
  const [accountInput,   setAccountInput]   = useState(
    () => localStorage.getItem('rp_account') || '25000'
  )
  const [dailyTarget,    setDailyTarget]    = useState('400')
  const [startDate,      setStartDate]      = useState('')
  const [endDate,        setEndDate]        = useState('')
  const runIdRef = useRef(0)

  async function doRun(sym, fwd, commission, dateRange = {}) {
    if (!sym) return
    const id = ++runIdRef.current
    setStatus('running')
    setResult(null)
    setError(null)
    try {
      const r = await runBacktest(sym, fwd, commission, dateRange)
      if (runIdRef.current !== id) return
      setResult(r)
      setStatus('done')
      onResult?.(r)
    } catch (e) {
      if (runIdRef.current !== id) return
      setError(e.message)
      setStatus('error')
    }
  }

  async function handleRun() {
    const dateRange = {}
    if (startDate) dateRange.startDate = startDate
    if (endDate)   dateRange.endDate   = endDate
    doRun(ticker, lookfwd, withCommission, dateRange)
  }

  useEffect(() => {
    if (ticker) doRun(ticker, lookfwd, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apCount = result?.trades?.filter(t => t.grade === 'A+').length ?? 0

  return (
    <div className="bt-root">
      <div className="bt-header">
        <div className="bt-header-left">
          <span className="bt-header-title">Backtest</span>
          <span className="bt-header-sub">
            Replays your weekly + daily confluence rules over 2 years of historical data
          </span>
        </div>
        <div className="bt-controls">
          <label className="bt-lfw-label" data-tip="Forward Window: How many trading days after the signal fires we measure the stock's performance.">
            Forward window
            <select className="bt-lfw-select" value={lookfwd} onChange={e => setLookfwd(+e.target.value)}>
              <option value={5}>5 days</option>
              <option value={10}>10 days</option>
              <option value={20}>20 days</option>
            </select>
          </label>
          <label className="bt-date-label">
            From
            <input type="date" className="bt-date-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label className="bt-date-label">
            To
            <input type="date" className="bt-date-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </label>
          <button
            className={`bt-commission-btn${withCommission ? ' active' : ''}`}
            onClick={() => setWithCommission(v => !v)}
            title="Apply realistic slippage + commission"
          >
            {withCommission ? '💸 Commissions ON' : 'Commissions OFF'}
          </button>
          <button
            className="bt-run-btn"
            onClick={handleRun}
            disabled={!ticker || status === 'running'}
          >
            {status === 'running' ? 'Running…' : `Backtest ${ticker || '—'}`}
          </button>
        </div>
      </div>

      {!ticker && (
        <div className="bt-empty">
          <div className="bt-empty-icon">📈</div>
          <div className="bt-empty-title">No ticker loaded</div>
          <div className="bt-empty-sub">Load a ticker from the Confluence tab first, then run the backtest.</div>
        </div>
      )}

      {status === 'running' && (
        <div className="bt-loading">
          <div className="bt-loading-spinner" />
          <span>Fetching 2 years of data and replaying signals…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="bt-error">
          <span className="bt-error-icon">⚠</span>
          {error}
        </div>
      )}

      {status === 'done' && result && result.totalTrades === 0 && (
        <div className="bt-empty">
          <div className="bt-empty-icon">🔍</div>
          <div className="bt-empty-title">No signals fired</div>
          <div className="bt-empty-sub">The confluence rules didn't reach the 60% threshold during the 2-year window.</div>
        </div>
      )}

      {status === 'done' && result && result.totalTrades > 0 && (
        <>
          {result.lowSampleWarning && <LowSampleWarning count={result.totalTrades} />}
          <div className="bt-method-note">
            Signal fires when weekly AND daily confluence ≥ 60% in the same direction (min 3 indicators).
            Entry at next bar open · stock exit at {lookfwd}-day close · options use grade-adaptive TP/SL.
            {(result.earningsSkipped ?? 0) > 0 && ` · ${result.earningsSkipped} signal${result.earningsSkipped !== 1 ? 's' : ''} skipped (estimated earnings window).`}
            {result?.withCommission && ' · Commissions & slippage applied.'}
          </div>

          <div className="bt-view-toggle">
            {[
              { id: 'stock',   label: 'Stock Returns' },
              { id: 'options', label: 'Options P&L' },
              { id: 'analytics', label: 'Analytics' },
            ].map(({ id, label }) => (
              <button
                key={id}
                className={`bt-view-btn${activeView === id ? ' active' : ''}`}
                onClick={() => setActiveView(id)}
                dangerouslySetInnerHTML={{ __html: label }}
              />
            ))}
          </div>

          {/* ── Stock Returns view ──────────────────────────────────────────── */}
          {activeView === 'stock' && (
            <>
              <RiskMetrics result={result} />
              <StatGrid result={result} />

              <div className="bt-curve-controls">
                <button
                  className={`bt-ap-toggle${showApOnly ? ' active' : ''}`}
                  onClick={() => setShowApOnly(v => !v)}
                  disabled={apCount < 2}
                  title="Show equity curve for A+ signals only vs all signals"
                >
                  {showApOnly ? `A+ Only (${apCount})` : `All Signals (${result.totalTrades})`}
                </button>
                {showApOnly && result.spyEquityCurve == null && (
                  <span className="bt-curve-note">SPY benchmark unavailable</span>
                )}
              </div>

              <EquityCurve
                curve={result.equityCurve}
                trades={result.trades}
                spyCurve={result.spyEquityCurve}
                showApOnly={showApOnly}
              />

              <TradesTable trades={result.trades} lookfwd={lookfwd} />
            </>
          )}

          {/* ── Options P&L view ───────────────────────────────────────────── */}
          {activeView === 'options' && (
            <OptionsStats result={result} />
          )}

          {/* ── Analytics view ─────────────────────────────────────────────── */}
          {activeView === 'analytics' && (
            <>
              <WindowSensitivity windowData={result.windowSensitivity} />
              <MonthlyHeatmap data={result.monthlyBreakdown} />
              <RegimeSplit regimeStats={result.regimeStats} />
              <DrawdownLog log={result.drawdownLog} />
              <MonteCarlo trades={result.trades} />
            </>
          )}

          <KellySizer result={result} accountInput={accountInput} setAccountInput={setAccountInput} />
          <DailyIncomeCalc
            result={result}
            accountInput={accountInput}
            setAccountInput={setAccountInput}
            dailyTarget={dailyTarget}
            setDailyTarget={setDailyTarget}
          />
          <FeeComparison result={result} accountInput={accountInput} />
        </>
      )}
    </div>
  )
}
