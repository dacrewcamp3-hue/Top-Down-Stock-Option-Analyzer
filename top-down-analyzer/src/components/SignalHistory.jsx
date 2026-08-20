import { useMemo } from 'react'
import { calcSignalHistory } from '../utils/calcSignalHistory'
import './SignalHistory.css'

function WinBar({ rate, color, faded = false }) {
  if (rate == null) return <span style={{ color: '#3a5a7a' }}>—</span>
  const pct = Math.round(rate)
  return (
    <div className="sigh-winbar">
      <div className="sigh-winbar-track">
        <div className="sigh-winbar-fill" style={{ width: `${pct}%`, background: color, opacity: faded ? 0.4 : 1 }} />
      </div>
      <span className="sigh-winbar-pct" style={{ color: faded ? '#4a6a8a' : color }}>{pct}%</span>
    </div>
  )
}

function FilterPill({ label, blocked, total }) {
  if (!total) return null
  const pct = Math.round(blocked / total * 100)
  return (
    <div className="sigh-filter-pill" title={`${blocked} of ${total} signals blocked by ${label} filter`}>
      <span className="sigh-filter-name">{label}</span>
      <span className="sigh-filter-pct" style={{ color: pct > 40 ? '#f59e0b' : pct > 20 ? '#7a9ab8' : '#3a5a7a' }}>
        −{pct}%
      </span>
    </div>
  )
}

export default function SignalHistory({ closes, highs, lows, volumes, timestamps, ticker }) {
  const hist = useMemo(
    () => closes && closes.length >= 65
      ? calcSignalHistory(closes, timestamps, { highs, lows, volumes })
      : null,
    [closes, timestamps, highs, lows, volumes, ticker]
  )

  if (!closes) return (
    <div className="sigh-root">
      <div className="sigh-empty">Load a ticker to view EMA cross signal history.</div>
    </div>
  )
  if (!hist) return (
    <div className="sigh-root">
      <div className="sigh-empty">Insufficient history (need 65+ daily bars).</div>
    </div>
  )

  const {
    bullWinRate, bearWinRate, bullCount, bearCount,
    filtBullWinRate, filtBearWinRate, filtBullCount, filtBearCount,
    recent, winThreshold, lookForward, filterStats,
  } = hist

  const hasFiltered = filtBullCount > 0 || filtBearCount > 0

  return (
    <div className="sigh-root">
      <div className="sigh-header">
        <div className="sigh-title">EMA 15 / 30 CROSS SIGNAL HISTORY · {ticker}</div>
        <div className="sigh-meta">
          Looks forward {lookForward} trading days · win = ≥{winThreshold}% move in signal direction
        </div>
      </div>

      {/* Win rate comparison: raw vs filtered */}
      <div className="sigh-rate-grid">
        <div className="sigh-rate-block">
          <div className="sigh-rate-label">RAW (no filters)</div>
          <div className="sigh-rate-row">
            <span className="sigh-rate-tag sigh-rate-tag-bull">▲ BULL</span>
            <WinBar rate={bullWinRate} color="#10b981" faded />
            <span className="sigh-rate-count">({bullCount})</span>
          </div>
          <div className="sigh-rate-row">
            <span className="sigh-rate-tag sigh-rate-tag-bear">▼ BEAR</span>
            <WinBar rate={bearWinRate} color="#ef4444" faded />
            <span className="sigh-rate-count">({bearCount})</span>
          </div>
        </div>

        <div className="sigh-rate-arrow">→</div>

        <div className="sigh-rate-block sigh-rate-block-filtered">
          <div className="sigh-rate-label">FILTERED (all 4 gates)</div>
          <div className="sigh-rate-row">
            <span className="sigh-rate-tag sigh-rate-tag-bull">▲ BULL</span>
            {hasFiltered
              ? <WinBar rate={filtBullWinRate} color="#10b981" />
              : <span style={{ color: '#3a5a7a', fontSize: 11 }}>no data</span>}
            <span className="sigh-rate-count">({filtBullCount})</span>
          </div>
          <div className="sigh-rate-row">
            <span className="sigh-rate-tag sigh-rate-tag-bear">▼ BEAR</span>
            {hasFiltered
              ? <WinBar rate={filtBearWinRate} color="#ef4444" />
              : <span style={{ color: '#3a5a7a', fontSize: 11 }}>no data</span>}
            <span className="sigh-rate-count">({filtBearCount})</span>
          </div>
        </div>
      </div>

      {/* Filter rejection breakdown */}
      {filterStats && filterStats.total > 0 && (
        <div className="sigh-filters">
          <span className="sigh-filters-label">Blocked by:</span>
          <FilterPill label="Trend (EMA 65)" blocked={filterStats.trend}  total={filterStats.total} />
          <FilterPill label="ADX < 21"       blocked={filterStats.adx}    total={filterStats.total} />
          <FilterPill label="Volume"          blocked={filterStats.volume} total={filterStats.total} />
          <FilterPill label="RSI 44/56"       blocked={filterStats.rsi}   total={filterStats.total} />
          <span className="sigh-filters-pass">
            {filterStats.passed}/{filterStats.total} pass all gates
          </span>
        </div>
      )}

      {/* Recent signal table */}
      <div className="sigh-table-wrap">
        <div className="sigh-table-head sigh-table-head-7">
          <span>Date</span>
          <span>Signal</span>
          <span>Entry</span>
          <span>Best {lookForward}d</span>
          <span>Outcome</span>
          <span>Gates</span>
        </div>
        {[...recent].reverse().map((s, i) => {
          const dateStr = s.date
            ? s.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
            : '—'
          const moveColor = s.kind === 'bull'
            ? (s.bestPct >= 0 ? '#10b981' : '#ef4444')
            : (s.bestPct <= 0 ? '#10b981' : '#ef4444')
          return (
            <div key={i} className={`sigh-row sigh-row-7${s.pending ? ' sigh-row-pending' : ''}${s.passes === false ? ' sigh-row-filtered' : ''}`}>
              <span className="sigh-date">{dateStr}</span>
              <span className="sigh-kind" style={{ color: s.kind === 'bull' ? '#10b981' : '#ef4444' }}>
                {s.kind === 'bull' ? '▲ BULL' : '▼ BEAR'}
              </span>
              <span className="sigh-entry">${s.entry.toFixed(2)}</span>
              <span style={{ color: moveColor, fontFamily: 'monospace', fontSize: 12 }}>
                {s.bestPct >= 0 ? '+' : ''}{s.bestPct}%
              </span>
              <span className={`sigh-badge${s.pending ? ' sigh-badge-pending' : s.win ? ' sigh-badge-win' : ' sigh-badge-loss'}`}>
                {s.pending ? 'IN PROGRESS' : s.win ? 'WIN' : 'LOSS'}
              </span>
              <span title={s.passes === false ? 'Failed: trend/ADX/volume/RSI gate' : 'All gates passed'}>
                {s.passes === false
                  ? <span style={{ color: '#f59e0b', fontSize: 10 }}>✗ skip</span>
                  : <span style={{ color: '#10b981', fontSize: 10 }}>✓ all</span>}
              </span>
            </div>
          )
        })}
      </div>

      <div className="sigh-footer">
        {bullCount + bearCount} historical EMA 15/30 crosses · 4 gates: EMA 65 trend, ADX ≥ 21, volume ≥ 1.25×avg, RSI 44/56.
        Past results do not guarantee future performance.
      </div>
    </div>
  )
}
