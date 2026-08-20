import { useState, useCallback, useEffect } from 'react'
import './SignalJournal.css'

const STORAGE_KEY = 'tdsa-signal-journal'

const f2 = v => (v != null && !isNaN(v)) ? (+v).toFixed(2) : '—'

function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}

function saveEntries(entries) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) }
  catch {}
}

function plPct(entry) {
  if (entry.exitPremium == null || entry.premium == null || entry.premium === 0) return null
  return (entry.exitPremium - entry.premium) / entry.premium * 100
}

function plDollar(entry) {
  const pct = plPct(entry)
  if (pct == null) return null
  return (entry.exitPremium - entry.premium) * 100 * (entry.qty ?? 1)
}

function fmtDate(isoStr) {
  try {
    return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '—' }
}

// ── Stats bar ────────────────────────────────────────────────────────────────
function StatsBar({ entries }) {
  const closed = entries.filter(e => e.result !== 'OPEN')
  const wins   = closed.filter(e => e.result === 'WIN').length
  const losses = closed.filter(e => e.result === 'LOSS').length

  const closedWithPL = closed.filter(e => plPct(e) != null)
  const avgPLPct = closedWithPL.length > 0
    ? closedWithPL.reduce((sum, e) => sum + plPct(e), 0) / closedWithPL.length
    : null

  const winRate = closed.length > 0 ? (wins / closed.length * 100).toFixed(0) : null

  return (
    <div className="sj-stats">
      <div className="sj-stat">
        <span className="sj-stat-val">{entries.length}</span>
        <span className="sj-stat-lbl">Total Signals</span>
      </div>
      <div className="sj-stat-sep" />
      <div className="sj-stat">
        <span className="sj-stat-val">{closed.length}</span>
        <span className="sj-stat-lbl">Closed</span>
      </div>
      <div className="sj-stat-sep" />
      <div className="sj-stat">
        <span className="sj-stat-val" style={{ color: winRate != null ? '#10b981' : '#3a5070' }}>
          {winRate != null ? `${winRate}%` : '—'}
        </span>
        <span className="sj-stat-lbl">Win Rate</span>
      </div>
      <div className="sj-stat-sep" />
      <div className="sj-stat">
        <span className="sj-stat-val" style={{
          color: avgPLPct == null ? '#3a5070' : avgPLPct >= 0 ? '#10b981' : '#ef4444'
        }}>
          {avgPLPct != null ? `${avgPLPct >= 0 ? '+' : ''}${avgPLPct.toFixed(0)}%` : '—'}
        </span>
        <span className="sj-stat-lbl">Avg P&amp;L</span>
      </div>
      <div className="sj-stat-sep" />
      <div className="sj-stat">
        <span className="sj-stat-val" style={{ color: '#10b981' }}>{wins}</span>
        <span className="sj-stat-lbl">Wins</span>
      </div>
      <div className="sj-stat-sep" />
      <div className="sj-stat">
        <span className="sj-stat-val" style={{ color: '#ef4444' }}>{losses}</span>
        <span className="sj-stat-lbl">Losses</span>
      </div>
    </div>
  )
}

// ── Individual entry row ─────────────────────────────────────────────────────
function EntryRow({ entry, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [exitInput, setExitInput] = useState(entry.exitPremium != null ? String(entry.exitPremium) : '')

  // Keep input in sync when exitPremium is updated by parent (e.g. after marking outcome)
  useEffect(() => {
    setExitInput(entry.exitPremium != null ? String(entry.exitPremium) : '')
  }, [entry.exitPremium])

  const pct    = plPct(entry)
  const dollar = plDollar(entry)
  const isCall = entry.direction === 'CALL'

  const dirColor = isCall ? '#10b981' : '#ef4444'

  const resultColor = entry.result === 'WIN' ? '#10b981'
    : entry.result === 'LOSS'              ? '#ef4444'
    : '#3a5070'

  function markResult(result) {
    const exitVal = parseFloat(exitInput)
    onUpdate(entry.id, {
      result,
      exitPremium: !isNaN(exitVal) ? exitVal : entry.exitPremium,
    })
    setExpanded(false)
  }

  function markOpen() {
    onUpdate(entry.id, { result: 'OPEN', exitPremium: null })
    setExitInput('')
    setExpanded(false)
  }

  return (
    <div className={`sj-row${expanded ? ' sj-row-open' : ''}`}>
      {/* ── Summary row ── */}
      <div className="sj-row-summary" onClick={() => setExpanded(v => !v)}>

        <span className="sj-col-date">{fmtDate(entry.date)}</span>

        <span className="sj-col-ticker">
          <span className="sj-ticker-sym">${entry.ticker}</span>
        </span>

        <span className="sj-col-dir" style={{ color: dirColor }}>
          {isCall ? '▲ CALL' : '▼ PUT'}
        </span>

        <span className="sj-col-score">
          {entry.score != null
            ? <span className="sj-score-chip" style={{ borderColor: entry.score >= 60 ? '#10b981' : '#f59e0b', color: entry.score >= 60 ? '#10b981' : '#f59e0b' }}>{entry.score}</span>
            : <span className="sj-score-chip" style={{ borderColor: '#2a4060', color: '#3a5070' }}>—</span>
          }
        </span>

        <span className="sj-col-option">
          ${entry.strike} · {entry.expiry} · {entry.dte}d
        </span>

        <span className="sj-col-pl">
          {pct != null
            ? <span style={{ color: pct >= 0 ? '#10b981' : '#ef4444', fontWeight: 800 }}>
                {pct >= 0 ? '+' : ''}{pct.toFixed(0)}%
              </span>
            : <span style={{ color: '#3a5070' }}>—</span>
          }
        </span>

        <span className="sj-col-status">
          <span className="sj-status-chip" style={{ borderColor: `${resultColor}50`, color: resultColor }}>
            {entry.result}
          </span>
        </span>

        <span className="sj-expand-arrow" style={{ color: '#2a4060' }}>
          {expanded ? '▲' : '▾'}
        </span>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="sj-detail">
          <div className="sj-detail-grid">
            <div className="sj-detail-item">
              <span className="sj-dl">Entry Date</span>
              <span className="sj-dv">{new Date(entry.date).toLocaleDateString()}</span>
            </div>
            <div className="sj-detail-item">
              <span className="sj-dl">Stock at Entry</span>
              <span className="sj-dv">${f2(entry.stockPrice)}</span>
            </div>
            <div className="sj-detail-item">
              <span className="sj-dl">Strike / Expiry</span>
              <span className="sj-dv">${entry.strike} {isCall ? 'CALL' : 'PUT'} · {entry.expiry}</span>
            </div>
            <div className="sj-detail-item">
              <span className="sj-dl">Entry Premium</span>
              <span className="sj-dv">${f2(entry.premium)}/sh</span>
            </div>
            <div className="sj-detail-item">
              <span className="sj-dl">Qty</span>
              <span className="sj-dv">{entry.qty} contract{entry.qty !== 1 ? 's' : ''}</span>
            </div>
            <div className="sj-detail-item">
              <span className="sj-dl">Cost</span>
              <span className="sj-dv">${(entry.premium * 100 * entry.qty).toLocaleString()}</span>
            </div>
            {entry.exitPremium != null && (
              <>
                <div className="sj-detail-item">
                  <span className="sj-dl">Exit Premium</span>
                  <span className="sj-dv">${f2(entry.exitPremium)}/sh</span>
                </div>
                <div className="sj-detail-item">
                  <span className="sj-dl">P&amp;L</span>
                  <span className="sj-dv" style={{ color: (dollar ?? 0) >= 0 ? '#10b981' : '#ef4444', fontWeight: 800 }}>
                    {dollar >= 0 ? '+' : ''}${Math.abs(Math.round(dollar)).toLocaleString()}
                    {' '}({pct >= 0 ? '+' : ''}{pct.toFixed(0)}%)
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Mark outcome */}
          <div className="sj-mark-section">
            <div className="sj-mark-label">Mark Outcome</div>
            <div className="sj-mark-row">
              <div className="sj-exit-input-wrap">
                <span className="sj-exit-input-prefix">Exit $</span>
                <input
                  className="sj-exit-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="exit premium/sh"
                  value={exitInput}
                  onChange={e => setExitInput(e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
              </div>
              <button className="sj-mark-btn sj-win" onClick={() => markResult('WIN')}>
                ✓ Win
              </button>
              <button className="sj-mark-btn sj-loss" onClick={() => markResult('LOSS')}>
                ✗ Loss
              </button>
              {entry.result !== 'OPEN' && (
                <button className="sj-mark-btn sj-reopen" onClick={markOpen}>
                  ↺ Reopen
                </button>
              )}
            </div>
          </div>

          <button className="sj-delete-btn" onClick={() => onDelete(entry.id)}>
            Delete entry
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────
export default function SignalJournal() {
  const [entries, setEntries] = useState(loadEntries)
  const [filter, setFilter] = useState('ALL')  // ALL | OPEN | WIN | LOSS | CALL | PUT

  const refresh = useCallback(() => setEntries(loadEntries()), [])

  function updateEntry(id, patch) {
    setEntries(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...patch } : e)
      saveEntries(next)
      return next
    })
  }

  function deleteEntry(id) {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id)
      saveEntries(next)
      return next
    })
  }

  const FILTER_OPTS = ['ALL', 'OPEN', 'WIN', 'LOSS', 'CALL', 'PUT']

  const filtered = entries.filter(e => {
    if (filter === 'ALL')   return true
    if (filter === 'OPEN')  return e.result === 'OPEN'
    if (filter === 'WIN')   return e.result === 'WIN'
    if (filter === 'LOSS')  return e.result === 'LOSS'
    if (filter === 'CALL')  return e.direction === 'CALL'
    if (filter === 'PUT')   return e.direction === 'PUT'
    return true
  })

  if (entries.length === 0) {
    return (
      <div className="sj-root">
        <div className="sj-empty">
          <div className="sj-empty-title">No signals logged yet</div>
          <div className="sj-empty-sub">
            Load a ticker, get a CALL or PUT signal, then click{' '}
            <strong>Log Trade</strong> in the Trade Plan to record it here.
            Track your win rate and average P&amp;L over time.
          </div>
          <button className="sj-refresh-btn" onClick={refresh}>↺ Refresh</button>
        </div>
      </div>
    )
  }

  return (
    <div className="sj-root">

      {/* ── Stats bar ── */}
      <StatsBar entries={entries} />

      {/* ── Filter row ── */}
      <div className="sj-filter-row">
        {FILTER_OPTS.map(f => (
          <button
            key={f}
            className={`sj-filter-btn${filter === f ? ' sj-filter-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="sj-refresh-btn" onClick={refresh} title="Re-read from storage">
          ↺ Refresh
        </button>
      </div>

      {/* ── Table header ── */}
      <div className="sj-table-hdr">
        <span className="sj-col-date">Date</span>
        <span className="sj-col-ticker">Ticker</span>
        <span className="sj-col-dir">Direction</span>
        <span className="sj-col-score">Score</span>
        <span className="sj-col-option">Strike · Exp · DTE</span>
        <span className="sj-col-pl">P&amp;L %</span>
        <span className="sj-col-status">Status</span>
        <span style={{ width: 16 }} />
      </div>

      {/* ── Entries ── */}
      <div className="sj-entries">
        {filtered.length === 0 ? (
          <div className="sj-no-results">No entries match this filter.</div>
        ) : (
          filtered.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onUpdate={updateEntry}
              onDelete={deleteEntry}
            />
          ))
        )}
      </div>

    </div>
  )
}
