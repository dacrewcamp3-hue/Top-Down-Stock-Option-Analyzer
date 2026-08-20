import React, { useState, useEffect, useRef } from 'react'
import { runBacktest } from '../utils/runBacktest'
import './Backtest.css'

// ── Equity curve SVG ──────────────────────────────────────────────────────────
function EquityCurve({ curve, trades }) {
  if (!curve || curve.length < 2) return null

  const W = 600, H = 160, PAD = { t: 12, r: 12, b: 28, l: 44 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const equities  = curve.map(p => p.equity)
  const minEq     = Math.min(...equities, 95)
  const maxEq     = Math.max(...equities, 105)
  const range     = maxEq - minEq || 10

  const xOf = i => PAD.l + (i / (curve.length - 1)) * innerW
  const yOf = v => PAD.t + (1 - (v - minEq) / range) * innerH

  const linePts = curve.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.equity).toFixed(1)}`).join(' ')
  const gridLines = [100, 110, 120, 90, 80].filter(v => v >= minEq - 5 && v <= maxEq + 5)
  const lastColor = equities[equities.length - 1] >= 100 ? '#10b981' : '#ef4444'

  return (
    <div className="bt-curve-wrap">
      <div className="bt-curve-label">Equity Curve · starts at 100</div>
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
            <text x={PAD.l - 6} y={yOf(v) + 4} className="bt-axis-lbl" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <polygon
          points={`${PAD.l},${PAD.t + innerH} ${linePts} ${W - PAD.r},${PAD.t + innerH}`}
          fill={lastColor}
          opacity="0.06"
        />
        <polyline
          points={linePts}
          fill="none"
          stroke={lastColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {trades.map((t, i) => (
          <circle
            key={i}
            cx={xOf(i).toFixed(1)}
            cy={yOf(curve[i]?.equity ?? 100).toFixed(1)}
            r="3"
            fill={t.win ? '#10b981' : '#ef4444'}
          />
        ))}
        {trades
          .filter((_, i) => i === 0 || i === trades.length - 1 || i % Math.max(1, Math.floor(trades.length / 5)) === 0)
          .map((t, _, arr) => {
            const idx = trades.indexOf(t)
            return (
              <text key={idx} x={xOf(idx)} y={H - 6} className="bt-axis-lbl" textAnchor="middle">
                {t.date}
              </text>
            )
          })
        }
      </svg>
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
        <span className="bt-stat-lbl" data-tip="Stock Win Rate: The percentage of historical signals that resulted in a profitable move within your forward window. Above 55% is strong. Remember: win rate alone isn't the full picture — a 45% win rate with large average wins still beats a 65% win rate with tiny gains.">Win Rate</span>
        <span className="bt-stat-val" style={{ color: winColor }}>{result.winRate}%</span>
        <span className="bt-stat-sub">{result.totalWins}/{result.totalTrades} trades</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Avg Move: The average price change across all signals, both wins and losses, measured over the forward hold window. Positive means the typical signal ended in the expected direction.">Avg Move</span>
        <span className="bt-stat-val" style={{ color: result.avgGain >= 0 ? '#10b981' : '#ef4444' }}>
          {result.avgGain >= 0 ? '+' : ''}{result.avgGain}%
        </span>
        <span className="bt-stat-sub">per signal · {result.lookforward}d hold</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Avg Win: The average % gain on trades that closed profitably. Compare this to Avg Loss — if your wins average +8% but losses average -4%, you have a 2:1 edge even at a 50% win rate.">Avg Win</span>
        <span className="bt-stat-val" style={{ color: '#10b981' }}>+{result.avgWin}%</span>
        <span className="bt-stat-sub">when right</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Avg Loss: The average % loss on trades that didn't work out. Ideally this is smaller than your Avg Win — that gives you positive expected value even if you're not always right.">Avg Loss</span>
        <span className="bt-stat-val" style={{ color: '#ef4444' }}>{result.avgLoss}%</span>
        <span className="bt-stat-sub">when wrong</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Compounded Return: The total % return if you reinvested profits into every signal over the 2-year backtest period. This is the compound growth effect — early wins make later wins bigger, so it's not just the sum of individual trades.">Compounded Return</span>
        <span className="bt-stat-val" style={{ color: rtnColor }}>
          {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn}%
        </span>
        <span className="bt-stat-sub">full 2-year period</span>
      </div>
      <div className="bt-stat-div" />
      <div className="bt-stat">
        <span className="bt-stat-lbl" data-tip="Max Consecutive Losses: The longest losing streak in the backtest. This is your worst-case drawdown scenario — every system has one. If this number is 4 or more, you need a rule to cut size during losing streaks so you don't blow your account before the edge returns.">Max Cons. Loss</span>
        <span className="bt-stat-val" style={{ color: result.maxConsecLoss >= 4 ? '#ef4444' : '#f59e0b' }}>
          {result.maxConsecLoss}
        </span>
        <span className="bt-stat-sub">in a row</span>
      </div>
    </div>
  )
}

// ── Spread vs Outright comparison ────────────────────────────────────────────
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
  const ivRescuePct = ivCrushCount > 0 ? Math.round(ivSavedCount / ivCrushCount * 100) : 0
  const costSavingsPct = avgCostRatio != null ? Math.round((1 - avgCostRatio) * 100) : null
  const spreadBetter = evSp > evOut

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
            <span
              className={`bt-svs-val${spBetter === true ? ' bt-svs-better' : spBetter === false ? ' bt-svs-worse' : ''}${highlight ? ' bt-svs-hl' : ''}`}
            >{sp}</span>
          </React.Fragment>
        ))}
      </div>

      <div className={`bt-svs-verdict ${spreadBetter ? 'bt-svs-v-spread' : 'bt-svs-v-out'}`}>
        {spreadBetter
          ? `⚡ DEBIT SPREAD wins on this ticker — higher EV per trade. Use the spread, especially when IV is elevated at entry.`
          : `📊 OUTRIGHT OPTION wins on this ticker — higher EV per trade. IV crush wasn't a dominant drag. Buy naked options and manage the position.`}
      </div>

      {ivCrushCount > 0 && ivSavedCount > 0 && (
        <div className="bt-svs-rescue">
          <strong>IV Crush Recovery:</strong>{' '}
          {ivCrushCount} historical trades were directionally correct but the outright option still lost (IV crush).
          The debit spread would have <strong>turned {ivSavedCount} ({ivRescuePct}%) of those losers into winners</strong>{' '}
          by selling off the excess IV on the short leg — neutralizing the crush that ate the long leg.
        </div>
      )}

      {ivCrushCount > 0 && ivSavedCount === 0 && (
        <div className="bt-svs-rescue bt-svs-rescue-none">
          The spread didn't rescue any IV crush trades here — even with the hedge, the underlying didn't move enough
          to overcome the cost and time decay. Avoid new entries when IV is elevated on this ticker.
        </div>
      )}
    </div>
  )
}

// ── Grade breakdown comparison ────────────────────────────────────────────────
function GradeComparison({ gradeStats, totalTrades }) {
  if (!gradeStats) return null
  const grades = ['A+', 'A', 'B'].filter(g => gradeStats[g])
  if (grades.length < 1) return null

  // Compute EV per trade (as % return on capital risked) for each grade
  const evOf = g => {
    const d  = gradeStats[g]
    const wr = d.optWinRate / 100
    return (wr * (d.avgWin / 100) + (1 - wr) * (d.avgLoss / 100)) * 100
  }
  const evs    = grades.map(evOf)
  const bestEV = Math.max(...evs)

  const rows = [
    { label: 'Signals',    fn: d => d.count,                    fmt: v => v },
    { label: 'Win Rate',   fn: d => d.optWinRate,               fmt: v => `${v}%` },
    { label: 'Avg Win',    fn: d => d.avgWin,                   fmt: v => `+${v}%` },
    { label: 'Avg Loss',   fn: d => d.avgLoss,                  fmt: v => `${v}%` },
    { label: 'TP Hit',     fn: d => d.tpHits,                   fmt: v => v },
    { label: 'SL Hit',     fn: d => d.slHits,                   fmt: v => v },
    { label: 'EV / Trade', fn: (d, g) => evOf(g),              fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, isEV: true, tip: 'EV (Expected Value) per Trade: The mathematical average outcome of taking this setup repeatedly. Calculated as: (Win Rate × Avg Win) + (Loss Rate × Avg Loss). A positive EV means the system makes money over many trades. A+ setups should have a higher EV — if they don\'t, your sizing rules need adjustment.' },
  ]

  const lowestEV = Math.min(...evs)
  const bestGrade = grades[evs.indexOf(bestEV)]

  return (
    <div className="bt-grade-cmp">
      <div className="bt-exit-label">Win Rate &amp; EV by Setup Grade — Options</div>
      <div className="bt-gcmp-grid" style={{ gridTemplateColumns: `120px ${grades.map(() => '1fr').join(' ')}` }}>
        {/* Header row */}
        <span className="bt-gcmp-cell bt-gcmp-hdr" />
        {grades.map(g => (
          <span key={g} className="bt-gcmp-cell bt-gcmp-hdr bt-gcmp-grade-hdr">{g}</span>
        ))}

        {rows.map(({ label, fn, fmt, isEV, tip }) => (
          <>
            <span key={`lbl-${label}`} className="bt-gcmp-cell bt-gcmp-label" data-tip={tip}>{label}</span>
            {grades.map((g, gi) => {
              const raw = fn(gradeStats[g], g)
              const isBest = isEV && evs[gi] === bestEV
              const isWeak = isEV && evs[gi] < 20 && evs[gi] < bestEV
              return (
                <span
                  key={`${label}-${g}`}
                  className={`bt-gcmp-cell bt-gcmp-val${isBest ? ' bt-gcmp-best' : ''}${isWeak ? ' bt-gcmp-weak' : ''}`}
                >
                  {fmt(raw)}
                </span>
              )
            })}
          </>
        ))}
      </div>

      {/* Recommendation */}
      {gradeStats['B'] && evOf('B') < 20 && grades.length > 1 && (
        <div className="bt-grade-rec">
          ⚡ Skip B setups — EV is only {evOf('B').toFixed(1)}% vs {evOf(bestGrade).toFixed(1)}% for {bestGrade}.
          Trade {grades.filter(g => evOf(g) >= 20).join(' and ')} only to maximise return per trade taken.
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

  const rows = [
    { label: 'Options Win Rate', std: `${optWinRate}%`,    so: `${soWinRate}%`,    good: v => soWinRate > optWinRate },
    { label: 'Avg Win',          std: `+${avgOptGain}%`,   so: `+${soAvgWin}%`,    good: () => false },  // lower avg win is expected with SO
    { label: 'Avg Loss',         std: `${avgOptLoss}%`,    so: `${soAvgLoss}%`,    good: () => soAvgLoss > avgOptLoss },
    { label: 'EV per Trade',     std: fmtEV(evStd),        so: fmtEV(evSO),        good: () => evSO > evStd, highlight: true },
    { label: 'TP Hits',          std: tpHits ?? 0,         so: tpHitsSO ?? 0,      good: null },
    { label: 'SL Hits',          std: slHits ?? 0,         so: slHitsSO ?? 0,      good: () => (slHitsSO ?? 0) < (slHits ?? 0) },
    { label: 'Time Exits',       std: timeStd,             so: timeSO,             good: null },
  ]

  const evDiff = ((evSO - evStd) * 100).toFixed(1)
  const soBetter = evSO > evStd

  return (
    <div className="bt-scaleout-cmp">
      <div className="bt-exit-label" data-tip="Scale-Out 50/50: Instead of exiting your entire position at one price target, you close HALF at the first target (locking in profit) and let the other half ride to a larger target. This reduces average win size but raises win rate and lowers the emotional pressure of watching a winning trade turn negative.">Exit Strategy Comparison — Standard vs Scale-Out 50/50</div>
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

// ── Options simulation stats ───────────────────────────────────────────────────
function OptionsStats({ result }) {
  const { optWinRate, avgOptGain, avgOptLoss, ivCrushCount, ivCrushPct,
          totalTrades, tpHits, slHits, gradeCount, gradeStats,
          spWinRate, spAvgWin, spAvgLoss, ivSavedCount, avgCostRatio } = result
  const winClr    = optWinRate >= 50 ? '#10b981' : optWinRate >= 40 ? '#f59e0b' : '#ef4444'
  const spWinClr  = (spWinRate ?? 0) >= 50 ? '#10b981' : (spWinRate ?? 0) >= 40 ? '#f59e0b' : '#ef4444'
  const timeExits = totalTrades - (tpHits ?? 0) - (slHits ?? 0)
  const ivRescuePct = ivCrushCount > 0 && ivSavedCount > 0
    ? Math.round(ivSavedCount / ivCrushCount * 100)
    : 0
  const costSaving = avgCostRatio != null ? Math.round((1 - avgCostRatio) * 100) : null

  return (
    <div className="bt-opts-wrap">
      <div className="bt-opts-title">Options P&L Simulation — 21 DTE · ATM Strike · Grade-Adaptive Exits</div>
      <div className="bt-opts-note">
        Entry IV = rolling 20-day HV × 1.20 (includes the volatility risk premium real options carry).
        Exits scan bar-by-bar: A+ closes at +200% / −35%, A at +150% / −40%, B at +100% / −45%.
        Unresolved trades close at 10 days with 15% IV crush. Earnings windows excluded.
        Debit Spread = buy ATM + sell next OTM strike same expiry — both legs repriced each bar.
      </div>

      {/* Outright stats */}
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
          <span className="bt-stat-lbl" title="IV Crush Risk: You're right on direction but IV drops, deflating your option's value. This is how often that happened in the backtest.">IV Crush Risk</span>
          <span className="bt-stat-val" style={{ color: ivCrushCount > 0 ? '#f59e0b' : '#10b981' }}>
            {ivCrushPct}%
          </span>
          <span className="bt-stat-sub">{ivCrushCount} right direction, option lost</span>
        </div>
      </div>

      {/* Debit spread stats */}
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
              <span className="bt-stat-lbl" title="IV Crush Recovery: Of the trades where direction was right but the outright option lost to IV, how many would the spread have rescued by selling the excess IV on the short leg.">IV Crush Rescued</span>
              <span className="bt-stat-val" style={{ color: ivRescuePct >= 50 ? '#10b981' : ivRescuePct > 0 ? '#f59e0b' : '#6b7280' }}>
                {ivRescuePct > 0 ? `${ivRescuePct}%` : ivCrushCount > 0 ? '0%' : '—'}
              </span>
              <span className="bt-stat-sub">{ivSavedCount} of {ivCrushCount} saved</span>
            </div>
          </div>
        </>
      )}

      {(tpHits != null) && (
        <div className="bt-exit-breakdown">
          <div className="bt-exit-label">Exit Breakdown</div>
          <div className="bt-exit-row">
            <span className="bt-exit-type tp">TP Hit</span>
            <div className="bt-exit-bar-track">
              <div className="bt-exit-bar tp" style={{ width: `${totalTrades > 0 ? (tpHits / totalTrades) * 100 : 0}%` }} />
            </div>
            <span className="bt-exit-count">{tpHits}</span>
          </div>
          <div className="bt-exit-row">
            <span className="bt-exit-type sl">SL Hit</span>
            <div className="bt-exit-bar-track">
              <div className="bt-exit-bar sl" style={{ width: `${totalTrades > 0 ? (slHits / totalTrades) * 100 : 0}%` }} />
            </div>
            <span className="bt-exit-count">{slHits}</span>
          </div>
          <div className="bt-exit-row">
            <span className="bt-exit-type time">Time Exit</span>
            <div className="bt-exit-bar-track">
              <div className="bt-exit-bar time" style={{ width: `${totalTrades > 0 ? (timeExits / totalTrades) * 100 : 0}%` }} />
            </div>
            <span className="bt-exit-count">{timeExits}</span>
          </div>
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

      {/* Full spread vs outright comparison panel */}
      <SpreadVsOutright result={result} />

      {/* Grade breakdown and scale-out comparison always shown in options view */}
      {gradeStats && <GradeComparison gradeStats={gradeStats} totalTrades={totalTrades} />}
      <ScaleOutCompare result={result} />
    </div>
  )
}

// ── Kelly position sizer ───────────────────────────────────────────────────────
function KellySizer({ result, accountInput, setAccountInput }) {
  const acct = parseFloat(String(accountInput).replace(/,/g, '')) || 0
  const stockK  = result.kellyStock  ?? 0
  const optK    = result.kellyOptions ?? 0
  const stockD$ = acct > 0 && stockK > 0 ? Math.round(acct * stockK / 100) : null
  const optD$   = acct > 0 && optK   > 0 ? Math.round(acct * optK   / 100) : null

  return (
    <div className="bt-kelly-wrap">
      <div className="bt-kelly-head">
        <span className="bt-kelly-title" data-tip="Half-Kelly Criterion: A mathematical formula (developed by John Kelly at Bell Labs) that calculates the optimal % of your account to risk on each trade, given your win rate and win/loss sizes. It's halved ('half-Kelly') to reduce the risk of ruin during bad streaks. Going above the Kelly number is proven to reduce long-run returns even when you win more.">Position Sizing · Half-Kelly Criterion</span>
        <span className="bt-kelly-sub">
          Kelly f* = p − (1−p)/b · halved to reduce variance. Max risk per trade.
        </span>
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
          {stockD$ != null && (
            <span className="bt-kelly-dollar">${stockD$.toLocaleString()} per trade</span>
          )}
          <span className="bt-kelly-note">
            {result.winRate}% win · +{result.avgWin}% / {result.avgLoss}%
          </span>
        </div>
        <div className="bt-kelly-div" />
        <div className="bt-kelly-cell">
          <span className="bt-kelly-cell-lbl">Options Trades</span>
          <span className="bt-kelly-pct" style={{ color: optK > 0 ? '#f59e0b' : '#6b7280' }}>
            {optK > 0 ? `${optK.toFixed(1)}%` : 'Insufficient data'}
          </span>
          {optD$ != null && (
            <span className="bt-kelly-dollar">${optD$.toLocaleString()} per trade</span>
          )}
          <span className="bt-kelly-note">
            {result.optWinRate}% opt win · IV crush included
          </span>
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

  // EV per dollar risked (decimal fraction)
  const ev  = (optWinRate / 100) * (avgOptGain / 100) + (1 - optWinRate / 100) * (avgOptLoss / 100)
  // Average signals per trading day over the 2-year backtest window
  const spd = totalTrades / (2 * 252)

  // Required risk per trade to average $target/day
  const evDay    = ev * spd   // EV per $1 risked, averaged across all days
  const reqRisk  = evDay > 0.0001 ? target / evDay : null
  const reqAcct  = reqRisk != null ? reqRisk / 0.02 : null   // at 2% risk cap

  // With current account at Kelly-optimal sizing
  const kellyFrac   = (kellyOptions ?? 0) / 100
  const acctRisk    = acct * kellyFrac
  const expectedDay = acctRisk * evDay

  // A+ only scenario
  const apG     = gradeStats?.['A+']
  const apEV    = apG
    ? (apG.optWinRate / 100) * (apG.avgWin / 100) + (1 - apG.optWinRate / 100) * (apG.avgLoss / 100)
    : null
  const apSPD   = apG ? apG.count / (2 * 252) : null
  const apEvDay = (apEV != null && apSPD != null) ? apEV * apSPD : null
  const apReqRisk = apEvDay > 0.0001 ? target / apEvDay : null
  const apReqAcct = apReqRisk != null ? apReqRisk / 0.02 : null

  const overKelly = reqRisk != null && acct > 0 && reqRisk > acct * (kellyFrac || 0.02)

  return (
    <div className="bt-income-wrap">
      <div className="bt-kelly-head">
        <span className="bt-kelly-title">Daily Income Calculator</span>
        <span className="bt-kelly-sub">
          {totalTrades} signals over 2 years · {(spd * 252).toFixed(1)} per year avg · {(spd).toFixed(4)} per trading day
        </span>
      </div>

      {/* Inputs */}
      <div className="bt-income-inputs">
        <div className="bt-kelly-input-wrap">
          <span className="bt-kelly-sym">Target</span>
          <span className="bt-kelly-sym">$</span>
          <input
            type="text"
            className="bt-kelly-input"
            value={dailyTarget}
            onChange={e => setDailyTarget(e.target.value)}
            placeholder="400"
            style={{ width: 70 }}
          />
          <span className="bt-kelly-sym">/ day</span>
        </div>
        <div className="bt-kelly-input-wrap">
          <span className="bt-kelly-sym">Account</span>
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
            style={{ width: 90 }}
          />
        </div>
      </div>

      {/* All-grades scenario */}
      <div className="bt-income-section">
        <div className="bt-income-section-title">ALL GRADES — What It Takes to Hit ${target.toLocaleString()}/Day</div>
        <div className="bt-income-grid">
          <div className="bt-income-cell">
            <span className="bt-income-lbl">EV per $1 Risked</span>
            <span className="bt-income-val" style={{ color: ev > 0 ? '#10b981' : '#ef4444' }}>
              ${ev.toFixed(3)}
            </span>
            <span className="bt-income-sub">{(ev * 100).toFixed(1)}% avg return on capital</span>
          </div>
          <div className="bt-income-cell">
            <span className="bt-income-lbl">Avg Signals / Day</span>
            <span className="bt-income-val">{spd.toFixed(3)}</span>
            <span className="bt-income-sub">{(spd * 252).toFixed(1)} per year</span>
          </div>
          <div className="bt-income-cell">
            <span className="bt-income-lbl">Required Risk / Trade</span>
            <span className="bt-income-val" style={{ color: '#f59e0b' }}>
              {reqRisk != null ? `$${Math.round(reqRisk).toLocaleString()}` : 'N/A'}
            </span>
            <span className="bt-income-sub">to average $target across all days</span>
          </div>
          <div className="bt-income-cell">
            <span className="bt-income-lbl">Account Needed (2% risk)</span>
            <span className="bt-income-val" style={{ color: '#f59e0b' }}>
              {reqAcct != null ? `$${Math.round(reqAcct).toLocaleString()}` : 'N/A'}
            </span>
            <span className="bt-income-sub">risking 2% per trade</span>
          </div>
        </div>
      </div>

      {/* A+ only scenario */}
      {apG && (
        <div className="bt-income-section bt-income-section-ap">
          <div className="bt-income-section-title">A+ ONLY — Fewer Trades, Higher EV Per Trade</div>
          <div className="bt-income-grid">
            <div className="bt-income-cell">
              <span className="bt-income-lbl">EV per $1 Risked</span>
              <span className="bt-income-val" style={{ color: (apEV ?? 0) > 0 ? '#10b981' : '#ef4444' }}>
                {apEV != null ? `$${apEV.toFixed(3)}` : '—'}
              </span>
              <span className="bt-income-sub">{apEV != null ? `${(apEV * 100).toFixed(1)}% avg return` : ''}</span>
            </div>
            <div className="bt-income-cell">
              <span className="bt-income-lbl">Avg Signals / Day</span>
              <span className="bt-income-val">{apSPD != null ? apSPD.toFixed(3) : '—'}</span>
              <span className="bt-income-sub">{apSPD != null ? `${(apSPD * 252).toFixed(1)} per year` : ''}</span>
            </div>
            <div className="bt-income-cell">
              <span className="bt-income-lbl">Required Risk / Trade</span>
              <span className="bt-income-val" style={{ color: '#f59e0b' }}>
                {apReqRisk != null ? `$${Math.round(apReqRisk).toLocaleString()}` : '—'}
              </span>
              <span className="bt-income-sub">to average $target/day</span>
            </div>
            <div className="bt-income-cell">
              <span className="bt-income-lbl">Account Needed (2% risk)</span>
              <span className="bt-income-val" style={{ color: '#f59e0b' }}>
                {apReqAcct != null ? `$${Math.round(apReqAcct).toLocaleString()}` : '—'}
              </span>
              <span className="bt-income-sub">risking 2% per trade</span>
            </div>
          </div>
        </div>
      )}

      {/* With current account */}
      {acct > 0 && (
        <div className="bt-income-section">
          <div className="bt-income-section-title">WITH YOUR ${acct.toLocaleString()} ACCOUNT</div>
          <div className="bt-income-reality">
            <div className="bt-income-reality-row">
              <span>Kelly-optimal risk / trade</span>
              <span style={{ color: '#f59e0b' }}>
                {kellyFrac > 0
                  ? `${(kellyFrac * 100).toFixed(1)}% = $${Math.round(acct * kellyFrac).toLocaleString()}`
                  : 'Insufficient data'}
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
                <span style={{ color: '#ef4444' }}>
                  Need ${Math.round(reqAcct - acct).toLocaleString()} more
                </span>
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
              ⚠ Hitting ${target.toLocaleString()}/day with this account requires risking
              ${Math.round(reqRisk).toLocaleString()} per trade
              ({acct > 0 ? ((reqRisk / acct) * 100).toFixed(0) : '—'}% of account) — well above your Kelly
              fraction. Oversizing above Kelly is guaranteed to blow up during the inevitable losing streak.
              Grow the account to ${reqAcct != null ? Math.round(reqAcct).toLocaleString() : '—'} first,
              then the math works in your favour.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Two-and-twenty fee comparison ────────────────────────────────────────────
function FeeComparison({ result, accountInput }) {
  const acct        = parseFloat(String(accountInput).replace(/,/g, '')) || 0
  const totalReturn = result.totalReturn ?? 0   // compounded % over 2 years
  if (acct <= 0 || totalReturn <= 0) return null

  const profit      = acct * (totalReturn / 100)
  // 2% AUM fee per year for 2 years (charged on average AUM, simplified)
  const fundAUMFee  = acct * 0.04
  // 20% performance fee on profits
  const fundPerfFee = profit * 0.20
  const totalFundFee = fundAUMFee + fundPerfFee
  const pctExtracted = ((totalFundFee / profit) * 100).toFixed(0)

  // What a standard 1% advisory account would cost
  const advisoryFee = acct * 0.02  // 1%/yr × 2 yrs

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
            <div className="bt-fee-row">
              <span>Your gross profit</span>
              <span>${Math.round(profit).toLocaleString()}</span>
            </div>
            <div className="bt-fee-row bt-fee-row-cost">
              <span>Management fee (2%/yr × 2)</span>
              <span>−${Math.round(fundAUMFee).toLocaleString()}</span>
            </div>
            <div className="bt-fee-row bt-fee-row-cost">
              <span>Performance fee (20% of profit)</span>
              <span>−${Math.round(fundPerfFee).toLocaleString()}</span>
            </div>
            <div className="bt-fee-row bt-fee-row-net">
              <span>What you'd walk away with</span>
              <span>${Math.round(profit - totalFundFee).toLocaleString()}</span>
            </div>
          </div>
          <div className="bt-fee-extracted">
            {pctExtracted}% of your profits extracted in fees
          </div>
        </div>

        <div className="bt-fee-col bt-fee-col-you">
          <div className="bt-fee-col-title">You (This System)</div>
          <div className="bt-fee-row-group">
            <div className="bt-fee-row">
              <span>Your gross profit</span>
              <span>${Math.round(profit).toLocaleString()}</span>
            </div>
            <div className="bt-fee-row">
              <span>Management fee</span>
              <span className="bt-fee-zero">$0</span>
            </div>
            <div className="bt-fee-row">
              <span>Performance fee</span>
              <span className="bt-fee-zero">$0</span>
            </div>
            <div className="bt-fee-row bt-fee-row-net bt-fee-row-net-you">
              <span>What you walk away with</span>
              <span>${Math.round(profit).toLocaleString()}</span>
            </div>
          </div>
          <div className="bt-fee-kept">
            You kept ${Math.round(totalFundFee).toLocaleString()} more
          </div>
        </div>
      </div>

      <div className="bt-fee-statement">
        A hedge fund would have collected ${Math.round(totalFundFee).toLocaleString()} of your profits over these 2 years — {pctExtracted}% of everything you made — just for executing a strategy you built and understand yourself. That money stays with you when you run your own system. Compounded over a decade, that difference is life-changing.
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
          <span>Date</span>
          <span>Signal</span>
          <span>Entry</span>
          <span>Exit ({lookfwd}d)</span>
          <span>Move</span>
          <span>Result</span>
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
            <span className={`bt-td-result ${t.win ? 'bt-td-win' : 'bt-td-loss'}`}>
              {t.win ? 'WIN' : 'LOSS'}
            </span>
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
          <label className="bt-lfw-label" data-tip="Forward Window: How many trading days after the signal fires we measure the stock's performance. 5 days = very short-term, next week. 10 days = two weeks out. 20 days = roughly one month. Choose the window that matches your typical hold time to see the most relevant win rate for your style.">
            Forward window
            <select
              className="bt-lfw-select"
              value={lookfwd}
              onChange={e => setLookfwd(+e.target.value)}
            >
              <option value={5}>5 days</option>
              <option value={10}>10 days</option>
              <option value={20}>20 days</option>
            </select>
          </label>
          <label className="bt-date-label" data-tip="Date Range: Optionally narrow the backtest to a specific window. Leave both blank to use the full 2-year history. The backtest needs at least 100 warm-up bars before the start date, so very short ranges may produce no signals.">
            From
            <input
              type="date"
              className="bt-date-input"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </label>
          <label className="bt-date-label" data-tip="End Date: The last date to include in the backtest. Leave blank to run through the most recent available trading day. Use with the Start Date to isolate specific market conditions — e.g., a bull run, a correction, or a volatile period.">
            To
            <input
              type="date"
              className="bt-date-input"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </label>
          <button
            className={`bt-commission-btn${withCommission ? ' active' : ''}`}
            onClick={() => setWithCommission(v => !v)}
            title="Apply realistic slippage (0.1%/leg) + $0.65/contract commission to both stock and options results"
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
          <div className="bt-empty-sub">
            Load a ticker from the Confluence tab first, then run the backtest to see how this setup performed historically.
          </div>
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
          <div className="bt-empty-sub">
            The weekly + daily confluence rules didn't reach the 60% threshold during the 2-year window. This ticker may trend sideways or the signals require a longer lookback.
          </div>
        </div>
      )}

      {status === 'done' && result && result.totalTrades > 0 && (
        <>
          {result.lowSampleWarning && <LowSampleWarning count={result.totalTrades} />}
          <div className="bt-method-note">
            Signal fires when weekly AND daily confluence ≥ 60% in the same direction (min 3 indicators).
            Entry at next bar open · stock exit at {lookfwd}-day close · options use grade-adaptive TP/SL.
            {(result.earningsSkipped ?? 0) > 0 && ` · ${result.earningsSkipped} signal${result.earningsSkipped !== 1 ? 's' : ''} skipped (estimated earnings window).`}
            {result?.withCommission && ' · Commissions & slippage applied (0.1%/leg stock · 2% slip + $1.30 options).'}
          </div>

          <div className="bt-view-toggle">
            <button
              className={`bt-view-btn${activeView === 'stock' ? ' active' : ''}`}
              onClick={() => setActiveView('stock')}
            >Stock Returns</button>
            <button
              className={`bt-view-btn${activeView === 'options' ? ' active' : ''}`}
              onClick={() => setActiveView('options')}
            >Options P&amp;L Simulation</button>
          </div>

          {activeView === 'stock' && (
            <>
              <StatGrid result={result} />
              <EquityCurve curve={result.equityCurve} trades={result.trades} />
              <TradesTable trades={result.trades} lookfwd={lookfwd} />
            </>
          )}

          {activeView === 'options' && (
            <OptionsStats result={result} />
          )}

          <KellySizer
            result={result}
            accountInput={accountInput}
            setAccountInput={setAccountInput}
          />

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
