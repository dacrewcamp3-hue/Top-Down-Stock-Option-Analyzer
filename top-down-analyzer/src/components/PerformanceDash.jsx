import { useMemo, useState } from 'react'
import './PerformanceDash.css'

const f2 = v => v != null ? (+v).toFixed(2) : '—'

// ── Monthly P&L bar chart ─────────────────────────────────────────────────────
function MonthlyChart({ monthly }) {
  if (!monthly?.length) return null

  const W = 680, H = 160
  const PAD = { t: 12, r: 12, b: 40, l: 56 }
  const iW  = W - PAD.l - PAD.r
  const iH  = H - PAD.t - PAD.b

  const maxAbs = Math.max(...monthly.map(m => Math.abs(m.pl)), 1)
  const midY   = PAD.t + iH / 2
  const barW   = Math.max(4, Math.floor(iW / monthly.length) - 2)
  const xOf    = i => PAD.l + (i / monthly.length) * iW + (iW / monthly.length - barW) / 2
  const scale  = (iH / 2) / maxAbs

  return (
    <div className="pd-chart-wrap">
      <div className="pd-chart-label">Monthly P&L</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pd-svg" preserveAspectRatio="xMidYMid meet">
        {/* Zero line */}
        <line x1={PAD.l} x2={W - PAD.r} y1={midY} y2={midY} stroke="#2a4060" strokeWidth="1" />

        {monthly.map((m, i) => {
          const h    = Math.max(1, Math.abs(m.pl) * scale)
          const pos  = m.pl >= 0
          const y    = pos ? midY - h : midY
          const clr  = pos ? '#10b981' : '#ef4444'
          const cx   = xOf(i) + barW / 2
          return (
            <g key={m.label}>
              <rect x={xOf(i)} y={y} width={barW} height={h} fill={clr} opacity="0.85" />
              <text x={cx} y={H - PAD.b + 14} fill="#4a6380" fontSize="8"
                fontFamily="monospace" textAnchor="middle">{m.label}</text>
              {Math.abs(m.pl) >= maxAbs * 0.15 && (
                <text x={cx} y={pos ? y - 3 : y + h + 9}
                  fill={clr} fontSize="8" fontFamily="monospace" textAnchor="middle">
                  {pos ? '+' : ''}{m.pl >= 1000 ? (m.pl / 1000).toFixed(1) + 'k' : m.pl.toFixed(0)}
                </text>
              )}
            </g>
          )
        })}

        {/* Y-axis label */}
        <text x={PAD.l - 4} y={midY + 4} fill="#4a6380" fontSize="8"
          fontFamily="monospace" textAnchor="end">0</text>
      </svg>
    </div>
  )
}

// ── Grade breakdown ───────────────────────────────────────────────────────────
function GradeBreakdown({ byGrade }) {
  if (!Object.keys(byGrade).length) return null
  const grades = ['A+', 'A', 'B', 'C']
  const clrs   = { 'A+': '#10b981', 'A': '#34d399', 'B': '#f59e0b', 'C': '#6b7280' }

  return (
    <div className="pd-grade-wrap">
      <div className="pd-section-title" data-tip="Setup Grade: The letter grade assigned when you entered the trade based on how many conditions were passing. A+ = 80%+ conditions met = full size. A = 65%+ = half size. B = 50%+ = minimal size. C = below 50% = ideally skipped. This breakdown shows whether your grade discipline is translating into better win rates.">Win Rate by Setup Grade</div>
      <div className="pd-grade-grid">
        {grades.map(g => {
          const data = byGrade[g]
          if (!data) return (
            <div key={g} className="pd-grade-card pd-grade-empty">
              <span className="pd-grade-lbl" style={{ color: clrs[g] }}>Grade {g}</span>
              <span className="pd-grade-val">—</span>
              <span className="pd-grade-sub">No trades</span>
            </div>
          )
          const wr = data.total > 0 ? Math.round(data.wins / data.total * 100) : 0
          return (
            <div key={g} className="pd-grade-card">
              <span className="pd-grade-lbl" style={{ color: clrs[g] }}>Grade {g}</span>
              <span className="pd-grade-val" style={{ color: wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444' }}>
                {wr}%
              </span>
              <span className="pd-grade-sub">{data.wins}W / {data.total - data.wins}L · {data.total} trades</span>
              <span className="pd-grade-pl" style={{ color: data.pl >= 0 ? '#10b981' : '#ef4444' }}>
                {data.pl >= 0 ? '+' : ''}${data.pl.toFixed(0)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Direction breakdown ───────────────────────────────────────────────────────
function DirectionBreakdown({ byDir }) {
  const dirs = ['CALL', 'PUT']
  const clrs = { CALL: '#10b981', PUT: '#ef4444' }
  if (!byDir.CALL && !byDir.PUT) return null
  return (
    <div className="pd-section-wrap">
      <div className="pd-section-title">Win Rate by Direction</div>
      <div className="pd-dir-grid">
        {dirs.map(d => {
          const data = byDir[d]
          if (!data) return (
            <div key={d} className="pd-dir-card pd-grade-empty">
              <span className="pd-grade-lbl" style={{ color: clrs[d] }}>{d}</span>
              <span className="pd-grade-val">—</span>
              <span className="pd-grade-sub">No trades</span>
            </div>
          )
          const wr = data.total > 0 ? Math.round(data.wins / data.total * 100) : 0
          return (
            <div key={d} className="pd-dir-card">
              <span className="pd-grade-lbl" style={{ color: clrs[d] }}>{d}</span>
              <span className="pd-grade-val" style={{ color: wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444' }}>
                {wr}%
              </span>
              <span className="pd-grade-sub">{data.wins}W / {data.total - data.wins}L · {data.total} trades</span>
              <span className="pd-grade-pl" style={{ color: data.pl >= 0 ? '#10b981' : '#ef4444' }}>
                {data.pl >= 0 ? '+' : ''}${data.pl.toFixed(0)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Score band breakdown ──────────────────────────────────────────────────────
function ScoreBandBreakdown({ byScore }) {
  const bands = ['85+', '75–84', '65–74', '50–64']
  const clrs  = { '85+': '#10b981', '75–84': '#34d399', '65–74': '#f59e0b', '50–64': '#6b7280' }
  const hasAny = bands.some(b => byScore[b])
  if (!hasAny) return null
  return (
    <div className="pd-section-wrap">
      <div className="pd-section-title">Win Rate by Signal Score</div>
      <div className="pd-grade-grid">
        {bands.map(b => {
          const data = byScore[b]
          if (!data) return (
            <div key={b} className="pd-grade-card pd-grade-empty">
              <span className="pd-grade-lbl" style={{ color: clrs[b] }}>Score {b}</span>
              <span className="pd-grade-val">—</span>
              <span className="pd-grade-sub">No trades</span>
            </div>
          )
          const wr = data.total > 0 ? Math.round(data.wins / data.total * 100) : 0
          return (
            <div key={b} className="pd-grade-card">
              <span className="pd-grade-lbl" style={{ color: clrs[b] }}>Score {b}</span>
              <span className="pd-grade-val" style={{ color: wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444' }}>
                {wr}%
              </span>
              <span className="pd-grade-sub">{data.wins}W / {data.total - data.wins}L · {data.total} trades</span>
              <span className="pd-grade-pl" style={{ color: data.pl >= 0 ? '#10b981' : '#ef4444' }}>
                {data.pl >= 0 ? '+' : ''}${data.pl.toFixed(0)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Time-of-day breakdown ─────────────────────────────────────────────────────
function TimeOfDayBreakdown({ byTime }) {
  const slots = [
    { key: 'open',   label: 'Open  9:30–10:00', color: '#f59e0b' },
    { key: 'morning',label: 'Morning 10:00–11:30', color: '#34d399' },
    { key: 'midday', label: 'Midday  11:30–2:00', color: '#6b7280' },
    { key: 'aftnoon',label: 'Afternoon 2:00–4:00', color: '#60a5fa' },
  ]
  const hasAny = slots.some(s => byTime[s.key])
  if (!hasAny) return null
  return (
    <div className="pd-section-wrap">
      <div className="pd-section-title">Win Rate by Time of Entry</div>
      <div className="pd-time-list">
        {slots.map(({ key, label, color }) => {
          const data = byTime[key]
          if (!data) return null
          const wr = data.total > 0 ? Math.round(data.wins / data.total * 100) : 0
          const wrColor = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'
          return (
            <div key={key} className="pd-time-row">
              <span className="pd-time-label" style={{ color }}>{label}</span>
              <div className="pd-time-bar-wrap">
                <div className="pd-time-bar" style={{ width: `${wr}%`, background: wrColor }} />
              </div>
              <span className="pd-time-wr" style={{ color: wrColor }}>{wr}%</span>
              <span className="pd-time-sub">{data.wins}W/{data.total - data.wins}L</span>
              <span className="pd-time-pl" style={{ color: data.pl >= 0 ? '#10b981' : '#ef4444' }}>
                {data.pl >= 0 ? '+' : ''}${data.pl.toFixed(0)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Day of week breakdown ─────────────────────────────────────────────────────
function DayOfWeekBreakdown({ byDow }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const clrs = { Mon: '#60a5fa', Tue: '#34d399', Wed: '#f59e0b', Thu: '#a78bfa', Fri: '#f87171' }
  const hasAny = days.some(d => byDow[d])
  if (!hasAny) return null
  return (
    <div className="pd-section-wrap">
      <div className="pd-section-title" data-tip="Day of Week: Which days of the week you perform best. Some traders are consistently profitable Mon–Tue when institutional flow is predictable, then struggle Wed–Thu when volume thins. Knowing your best day helps you be most aggressive when it matters.">Win Rate by Day of Week</div>
      <div className="pd-time-list">
        {days.map(day => {
          const data = byDow[day]
          if (!data) return null
          const wr = data.total > 0 ? Math.round(data.wins / data.total * 100) : 0
          const wrColor = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'
          return (
            <div key={day} className="pd-time-row">
              <span className="pd-time-label" style={{ color: clrs[day] }}>{day}</span>
              <div className="pd-time-bar-wrap">
                <div className="pd-time-bar" style={{ width: `${wr}%`, background: wrColor }} />
              </div>
              <span className="pd-time-wr" style={{ color: wrColor }}>{wr}%</span>
              <span className="pd-time-sub">{data.wins}W/{data.total - data.wins}L</span>
              <span className="pd-time-pl" style={{ color: data.pl >= 0 ? '#10b981' : '#ef4444' }}>
                {data.pl >= 0 ? '+' : ''}${data.pl.toFixed(0)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function timeSlot(t) {
  const timeStr = t.date || t.entryTime || t.exitDate || ''
  if (!timeStr) return null
  const d = new Date(timeStr)
  if (isNaN(d.getTime())) return null
  const et  = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const min = et.getHours() * 60 + et.getMinutes()
  if (min < 9 * 60 + 30)  return null
  if (min < 10 * 60)       return 'open'
  if (min < 11 * 60 + 30)  return 'morning'
  if (min < 14 * 60)       return 'midday'
  if (min < 16 * 60)       return 'aftnoon'
  return null
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function PerformanceDash({ journal }) {
  const stats = useMemo(() => {
    const journalClosed = (journal ?? []).filter(t => t.exitDate && t.pnl != null)

    if (!journalClosed.length) return null

    const jWins  = journalClosed.filter(t => t.result === 'WIN').length
    const jTotal = journalClosed.length
    const jPL    = journalClosed.reduce((s, t) => s + t.pnl, 0)
    const jAvgRR = journalClosed.filter(t => t.result === 'WIN' && t.rrRatio)
      .reduce((s, t, _, a) => s + t.rrRatio / a.length, 0)

    const totalWR = jTotal > 0 ? Math.round(jWins / jTotal * 100) : 0

    const best  = journalClosed.reduce((b, t) => t.pnl > (b?.pnl ?? -Infinity) ? t : b, null)
    const worst = journalClosed.reduce((w, t) => t.pnl < (w?.pnl ??  Infinity) ? t : w, null)

    // ── Streak computation ─────────────────────────────────────────────────
    const sorted = [...journalClosed].sort((a, b) =>
      (a.exitDate ?? '').localeCompare(b.exitDate ?? '')
    )
    let curStreak = 0, curStreakType = null
    let longestWin = 0, longestLoss = 0
    let runStreak = 0, runType = null
    for (const t of sorted) {
      const isWin = t.result === 'WIN'
      const thisType = isWin ? 'W' : 'L'
      if (runType === thisType) {
        runStreak++
      } else {
        if (runType === 'W') longestWin  = Math.max(longestWin,  runStreak)
        else if (runType === 'L') longestLoss = Math.max(longestLoss, runStreak)
        runType = thisType; runStreak = 1
      }
    }
    if (runType === 'W') longestWin  = Math.max(longestWin,  runStreak)
    else if (runType === 'L') longestLoss = Math.max(longestLoss, runStreak)
    curStreak = runStreak; curStreakType = runType

    const monthMap = {}
    for (const t of journalClosed) {
      const key = (t.date || t.exitDate)?.slice(0, 7)
      if (!key) continue
      const label = new Date(key + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      if (!monthMap[key]) monthMap[key] = { label, pl: 0 }
      monthMap[key].pl += t.pnl
    }
    const monthly = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)

    const byGrade = {}
    for (const t of journalClosed) {
      const g = t.grade ?? 'C'
      if (!byGrade[g]) byGrade[g] = { wins: 0, total: 0, pl: 0 }
      byGrade[g].total++
      if (t.result === 'WIN') byGrade[g].wins++
      byGrade[g].pl += t.pnl
    }

    // ── Direction breakdown (CALL vs PUT)
    const byDir = {}
    for (const t of journalClosed) {
      const d = (t.direction ?? t.signal ?? '').toUpperCase()
      if (d !== 'CALL' && d !== 'PUT') continue
      if (!byDir[d]) byDir[d] = { wins: 0, total: 0, pl: 0 }
      byDir[d].total++
      if (t.result === 'WIN') byDir[d].wins++
      byDir[d].pl += t.pnl
    }

    // ── Score band breakdown
    const byScore = {}
    function scoreBand(s) {
      if (!s) return null
      if (s >= 85) return '85+'
      if (s >= 75) return '75–84'
      if (s >= 65) return '65–74'
      if (s >= 50) return '50–64'
      return null
    }
    for (const t of journalClosed) {
      const band = scoreBand(t.score ?? t.signalScore)
      if (!band) continue
      if (!byScore[band]) byScore[band] = { wins: 0, total: 0, pl: 0 }
      byScore[band].total++
      if (t.result === 'WIN') byScore[band].wins++
      byScore[band].pl += t.pnl
    }

    // ── Time of day breakdown
    const byTime = {}
    for (const t of journalClosed) {
      const slot = timeSlot(t)
      if (!slot) continue
      if (!byTime[slot]) byTime[slot] = { wins: 0, total: 0, pl: 0 }
      byTime[slot].total++
      if (t.result === 'WIN') byTime[slot].wins++
      byTime[slot].pl += t.pnl
    }

    // ── Day of week breakdown
    const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    const byDow = {}
    for (const t of journalClosed) {
      const dateStr = t.date || t.entryDate || t.exitDate || ''
      if (!dateStr) continue
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) continue
      // Use ET so date-only strings (parsed as UTC midnight) don't shift to the previous day
      const etDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const dow = etDate.getDay()
      if (dow < 1 || dow > 5) continue
      const lbl = DOW_LABELS[dow - 1]
      if (!byDow[lbl]) byDow[lbl] = { wins: 0, total: 0, pl: 0 }
      byDow[lbl].total++
      if (t.result === 'WIN') byDow[lbl].wins++
      byDow[lbl].pl += t.pnl
    }

    return {
      jTotal, jWins, jPL, jAvgRR,
      totalPL: jPL, totalW: jWins, totalTr: jTotal, totalWR,
      best, worst, monthly, byGrade, byDir, byScore, byTime, byDow,
      curStreak, curStreakType, longestWin, longestLoss,
    }
  }, [journal])

  if (!stats) return (
    <div className="pd-root">
      <div className="pd-empty">
        <div className="pd-empty-icon">📈</div>
        <div className="pd-empty-text">No closed trades yet</div>
        <div className="pd-empty-sub">
          Log trades in the Journal tab and close them with an exit price to see performance analytics.
        </div>
      </div>
    </div>
  )

  const [copied, setCopied] = useState(false)
  const plColor = v => v >= 0 ? '#10b981' : '#ef4444'

  function handleCopyStats() {
    const wr    = stats.totalWR
    const pl    = stats.totalPL
    const rr    = stats.jAvgRR
    const streak = stats.curStreakType ? `${stats.curStreakType === 'W' ? '🔥' : '❄'} ${stats.curStreak} ${stats.curStreakType === 'W' ? 'win' : 'loss'} streak` : ''
    const text = [
      `📊 My Trading Stats — Top-Down Analyzer`,
      `─────────────────────────────`,
      `Win Rate: ${wr}%  (${stats.totalW}W / ${stats.totalTr - stats.totalW}L · ${stats.totalTr} trades)`,
      `Total P&L: ${pl >= 0 ? '+' : ''}$${pl.toFixed(0)}`,
      rr > 0 ? `Avg R:R on Wins: ${rr.toFixed(2)}:1` : '',
      streak,
      `─────────────────────────────`,
      `via Top-Down Analyzer · ${new Date().toLocaleDateString()}`,
    ].filter(Boolean).join('\n')

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    })
  }

  return (
    <div className="pd-root">

      {/* Top-line summary */}
      <div className="pd-summary">
        <div className="pd-sum-cell pd-sum-main">
          <span className="pd-sum-lbl" data-tip="P&L (Profit and Loss): Total dollar gain or loss across all closed trades. What matters most is whether this grows consistently — not whether individual trades win or lose. Focus on process, and the P&L follows.">Total P&L</span>
          <span className="pd-sum-val" style={{ color: plColor(stats.totalPL) }}>
            {stats.totalPL >= 0 ? '+' : ''}${stats.totalPL.toFixed(0)}
          </span>
        </div>
        <div className="pd-sum-div" />
        <div className="pd-sum-cell">
          <span className="pd-sum-lbl" data-tip="Win Rate: The percentage of closed trades that were profitable. In a well-structured system with 2:1+ R:R, even a 40% win rate is profitable long-term — your winners just need to average more than your losers. Track this alongside R:R together, not in isolation.">Win Rate</span>
          <span className="pd-sum-val"
            style={{ color: stats.totalWR >= 55 ? '#10b981' : stats.totalWR >= 45 ? '#f59e0b' : '#ef4444' }}>
            {stats.totalWR}%
          </span>
          <span className="pd-sum-sub">{stats.totalW}W / {stats.totalTr - stats.totalW}L · {stats.totalTr} trades</span>
        </div>
        <div className="pd-sum-div" />
        {stats.jAvgRR > 0 && (
          <>
            <div className="pd-sum-div" />
            <div className="pd-sum-cell">
              <span className="pd-sum-lbl" data-tip="Average R:R on winning trades: How many dollars you made per dollar risked when you won. A 2:1 average means your winners were twice the size of your potential loss. The higher this number, the more forgiving the system is of a lower win rate.">Avg R:R (wins)</span>
              <span className="pd-sum-val">{stats.jAvgRR.toFixed(2)}:1</span>
            </div>
          </>
        )}
        {stats.curStreakType && (
          <>
            <div className="pd-sum-div" />
            <div className="pd-sum-cell">
              <span className="pd-sum-lbl" data-tip="Win/Loss Streak: Consecutive wins (🔥) or losses (❄) in your most recent trades. Three losses in a row is your signal to cut position size in half — conditions may have changed or your execution needs a reset. Three wins running means the system is aligned — don't deviate, don't oversize.">Current Streak</span>
              <span className="pd-streak-val" style={{ color: stats.curStreakType === 'W' ? '#10b981' : '#ef4444' }}>
                {stats.curStreakType === 'W' ? '🔥' : '❄'} {stats.curStreak}{stats.curStreakType}
              </span>
              <span className="pd-sum-sub">
                Best W: {stats.longestWin} · Best L: {stats.longestLoss}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Share Stats */}
      <div className="pd-share-row">
        <span className="pd-share-hint">Share your progress — copy your stats to paste anywhere.</span>
        <button
          className="pd-share-btn"
          onClick={handleCopyStats}
          style={{ background: copied ? '#065f46' : '#10b981' }}
        >
          {copied ? '✓ Copied!' : '↗ Copy My Stats'}
        </button>
      </div>

      {/* Best / Worst */}
      {(stats.best || stats.worst) && (
        <div className="pd-extremes">
          {stats.best && (
            <div className="pd-extreme pd-best">
              <span className="pd-ex-lbl">Best Trade</span>
              <span className="pd-ex-val" style={{ color: '#10b981' }}>
                +${(stats.best.pnl ?? stats.best.pl).toFixed(0)}
              </span>
              <span className="pd-ex-sub">{stats.best.ticker ?? '—'}</span>
            </div>
          )}
          {stats.worst && (
            <div className="pd-extreme pd-worst">
              <span className="pd-ex-lbl">Worst Trade</span>
              <span className="pd-ex-val" style={{ color: '#ef4444' }}>
                ${(stats.worst.pnl ?? stats.worst.pl).toFixed(0)}
              </span>
              <span className="pd-ex-sub">{stats.worst.ticker ?? '—'}</span>
            </div>
          )}
        </div>
      )}

      {/* Monthly chart */}
      {stats.monthly.length >= 2 && <MonthlyChart monthly={stats.monthly} />}

      {/* Grade breakdown */}
      <GradeBreakdown byGrade={stats.byGrade} />

      {/* Direction breakdown */}
      <DirectionBreakdown byDir={stats.byDir} />

      {/* Score band breakdown */}
      <ScoreBandBreakdown byScore={stats.byScore} />

      {/* Time of day */}
      <TimeOfDayBreakdown byTime={stats.byTime} />

      {/* Day of week */}
      <DayOfWeekBreakdown byDow={stats.byDow} />

      {/* Coaching: what the numbers say */}
      <div className="pd-tips">
        <div className="pd-section-title">What the numbers say</div>
        {stats.totalWR < 45 && (
          <div className="pd-tip pd-tip-warn">
            Win rate below 45% — review your entry criteria. You need win rate × avg win &gt; (1–WR) × avg loss to stay profitable.
          </div>
        )}
        {stats.byGrade['A+'] && stats.byGrade['C'] &&
          stats.byGrade['A+'].wins / stats.byGrade['A+'].total >
          stats.byGrade['C'].wins / stats.byGrade['C'].total + 0.10 && (
          <div className="pd-tip pd-tip-info">
            A+ setups are outperforming C setups. Consider filtering to A/A+ only — it may improve your overall edge.
          </div>
        )}
        {stats.byDir['CALL'] && stats.byDir['PUT'] && (() => {
          const cWR = stats.byDir['CALL'].wins / stats.byDir['CALL'].total
          const pWR = stats.byDir['PUT'].wins  / stats.byDir['PUT'].total
          if (Math.abs(cWR - pWR) > 0.12) return (
            <div className="pd-tip pd-tip-info">
              {cWR > pWR
                ? `Your CALL trades win ${Math.round(cWR * 100)}% vs ${Math.round(pWR * 100)}% on PUTs. You may have an edge trading with the broader trend — consider reducing PUT frequency.`
                : `Your PUT trades win ${Math.round(pWR * 100)}% vs ${Math.round(cWR * 100)}% on CALLs. Bearish setups are working better for you right now.`}
            </div>
          )
          return null
        })()}
        {stats.byTime.midday && stats.byTime.morning &&
          stats.byTime.midday.total >= 3 &&
          stats.byTime.midday.wins / stats.byTime.midday.total <
          stats.byTime.morning.wins / stats.byTime.morning.total - 0.15 && (
          <div className="pd-tip pd-tip-warn">
            Your midday trades (11:30–2:00) underperform morning trades by a significant margin. Consider stopping trading after 11:30 AM — this is the institutional "lunch hour" where volatility dries up and setups fail more often.
          </div>
        )}
        {stats.byScore['85+'] && stats.byScore['65–74'] &&
          stats.byScore['85+'].total >= 2 &&
          stats.byScore['85+'].wins / stats.byScore['85+'].total >
          stats.byScore['65–74'].wins / stats.byScore['65–74'].total + 0.10 && (
          <div className="pd-tip pd-tip-info">
            High-score signals (85+) are converting significantly better than moderate signals. Focus on waiting for score 75+ setups — be more selective, not more active.
          </div>
        )}
        {stats.totalWR >= 55 && stats.totalPL >= 0 && (
          <div className="pd-tip pd-tip-good">
            Positive P&L with {stats.totalWR}% win rate. Your system is working — focus on consistent execution and position sizing.
          </div>
        )}
      </div>
    </div>
  )
}
