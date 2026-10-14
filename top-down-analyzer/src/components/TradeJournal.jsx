import { useState, useRef, useEffect } from 'react'
import './TradeJournal.css'

const STORAGE_KEY = 'tj_notes_v2'

// ── Options trade card with signal snapshot + close flow ──────────────────────
function OptionsTradeCard({ note, onUpdate, onDelete }) {
  const snap = note.tradeSnap
  const [closing, setClosing]         = useState(false)
  const [exitPremium, setExitPremium] = useState('')

  if (!snap) return null

  function saveClose() {
    const exitVal = parseFloat(exitPremium)
    if (isNaN(exitVal) || exitVal < 0) return
    const entry   = snap.premium ?? 0
    const qty     = snap.qty     ?? 1
    const pnlPerContract = (exitVal - entry) * 100
    const totalPnl       = pnlPerContract * qty
    const pctReturn      = entry > 0 ? ((exitVal - entry) / entry) * 100 : 0
    const updated = {
      ...note,
      tradeSnap: {
        ...snap,
        exit: {
          premium:         exitVal,
          date:            new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          pnlPerContract,
          totalPnl,
          pctReturn,
        },
      },
    }
    onUpdate(updated)
    setClosing(false)
    setExitPremium('')
  }

  const exit = snap.exit
  const isWin = exit ? exit.totalPnl >= 0 : null
  const sig   = snap.signalState

  return (
    <div style={{
      background: '#080f1a', border: '1px solid #1e3a5f',
      borderRadius: 6, padding: 10, fontSize: 10,
    }}>
      {/* Trade header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          background: snap.direction === 'CALL' ? '#064e3b' : '#450a0a',
          color: snap.direction === 'CALL' ? '#34d399' : '#fca5a5',
          padding: '1px 7px', borderRadius: 3, fontWeight: 900, letterSpacing: 1,
        }}>{snap.direction}</span>
        <span style={{ color: '#93c5fd', fontWeight: 700 }}>
          ${snap.strike} · {snap.expDate} · {snap.dte}d DTE
        </span>
        <span style={{ color: '#6b7280' }}>
          {snap.qty} contract{snap.qty !== 1 ? 's' : ''} @ ${(snap.premium ?? 0).toFixed(2)}/sh
        </span>
        {snap.isQuickPlay && (
          <span style={{ color: '#f59e0b', fontSize: 9, fontWeight: 700 }}>⚡ QUICK PLAY</span>
        )}
        {exit && (
          <span style={{
            marginLeft: 'auto', fontWeight: 800,
            color: isWin ? '#10b981' : '#ef4444',
          }}>
            {isWin ? '✓' : '✗'} {isWin ? '+' : ''}${exit.totalPnl.toFixed(0)} ({exit.pctReturn > 0 ? '+' : ''}{exit.pctReturn.toFixed(1)}%)
          </span>
        )}
      </div>

      {/* Signal snapshot at entry */}
      {sig && (
        <div style={{
          background: '#0a1628', border: '1px solid #1e3a5f',
          borderRadius: 4, padding: '6px 8px', marginBottom: 6,
        }}>
          <div style={{ color: '#4b7ab5', fontWeight: 700, fontSize: 9, letterSpacing: 1, marginBottom: 3 }}>
            📊 SIGNAL AT ENTRY
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#93c5fd' }}>
            <span>Direction: <strong style={{ color: sig.direction === 'CALL' ? '#34d399' : sig.direction === 'PUT' ? '#fca5a5' : '#6b7280' }}>{sig.direction ?? '—'}</strong></span>
            <span>Confidence: <strong style={{ color: (sig.confidence ?? 0) >= 70 ? '#10b981' : (sig.confidence ?? 0) >= 55 ? '#f59e0b' : '#ef4444' }}>{sig.confidence ?? '?'}/100</strong></span>
            <span>TF Score: <strong>{sig.tfScore ?? '?'}/5</strong></span>
            {sig.blocked && <span style={{ color: '#ef4444' }}>⛔ BLOCKED — {sig.blockReason ?? 'see analysis'}</span>}
            {sig.conflicts?.length ? <span style={{ color: '#f59e0b' }}>⚠ Conflicts: {sig.conflicts.join(', ')}</span> : <span style={{ color: '#10b981' }}>✓ No conflicts</span>}
          </div>
        </div>
      )}

      {/* Post-mortem if closed */}
      {exit && (
        <div style={{
          background: isWin ? '#011a0d' : '#1a0000',
          border: `1px solid ${isWin ? '#065f46' : '#7f1d1d'}`,
          borderRadius: 4, padding: '5px 8px', marginBottom: 6,
          color: isWin ? '#34d399' : '#fca5a5', fontWeight: 600,
        }}>
          Closed {exit.date} · Exit ${exit.premium.toFixed(2)} vs Entry ${(snap.premium ?? 0).toFixed(2)} ·{' '}
          {isWin ? '+' : ''}${exit.pnlPerContract.toFixed(0)}/contract · {isWin ? '+' : ''}{exit.pctReturn.toFixed(1)}% return
        </div>
      )}

      {/* Close trade flow */}
      {!exit && (
        closing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ color: '#6b7280' }}>Exit premium ($/sh):</span>
            <input
              value={exitPremium}
              onChange={e => setExitPremium(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveClose()}
              placeholder={`e.g. ${((snap.premium ?? 1) * 2).toFixed(2)}`}
              style={{
                width: 80, background: '#0d1117', border: '1px solid #374151',
                borderRadius: 3, color: '#e5e7eb', fontSize: 10, padding: '2px 6px',
              }}
              autoFocus
            />
            <button onClick={saveClose} style={{
              background: '#065f46', border: 'none', borderRadius: 3,
              color: '#34d399', fontSize: 9, fontWeight: 700, padding: '2px 8px', cursor: 'pointer',
            }}>Save</button>
            <button onClick={() => setClosing(false)} style={{
              background: 'none', border: '1px solid #374151', borderRadius: 3,
              color: '#6b7280', fontSize: 9, padding: '2px 6px', cursor: 'pointer',
            }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setClosing(true)} style={{
            background: 'none', border: '1px solid #1e3a5f', borderRadius: 3,
            color: '#60a5fa', fontSize: 9, fontWeight: 700, padding: '2px 10px', cursor: 'pointer',
          }}>📋 Close This Trade</button>
        )
      )}
    </div>
  )
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
const hasSpeech = !!SpeechRecognition

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') }
  catch { return [] }
}

function saveNotes(notes) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)) } catch {}
}

export default function TradeJournal() {
  const [notes,     setNotes]     = useState(loadNotes)
  const [text,      setText]      = useState('')
  const [ticker,    setTicker]    = useState('')
  const [open,      setOpen]      = useState(false)
  const [listening, setListening] = useState(false)
  const [micError,  setMicError]  = useState(null)

  const recognizerRef = useRef(null)
  const committedRef  = useRef('') // text that has been finalized by the recognizer

  function startListening() {
    if (!hasSpeech) return
    setMicError(null)

    const rec = new SpeechRecognition()
    rec.continuous     = true
    rec.interimResults = true
    rec.lang           = 'en-US'

    // Snapshot current textarea content so dictation appends to it
    committedRef.current = text

    rec.onstart = () => setListening(true)

    rec.onresult = (e) => {
      let finalChunk = ''
      let interimChunk = ''

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          finalChunk += t
        } else {
          interimChunk += t
        }
      }

      if (finalChunk) {
        // Add a space between words if needed
        const sep = committedRef.current && !committedRef.current.endsWith(' ') ? ' ' : ''
        committedRef.current = committedRef.current + sep + finalChunk
      }

      // Show committed + live interim in the textarea
      const sep = committedRef.current && interimChunk && !committedRef.current.endsWith(' ') ? ' ' : ''
      setText(committedRef.current + sep + interimChunk)
    }

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setMicError('Microphone access denied — allow mic permission in your browser settings, then try again.')
      } else if (e.error === 'no-speech') {
        setMicError('No speech detected. Make sure your microphone is working and try again.')
      } else if (e.error !== 'aborted') {
        setMicError(`Dictation error: ${e.error}`)
      }
      setListening(false)
    }

    rec.onend = () => {
      // Commit whatever was accumulated and strip trailing interim
      setText(committedRef.current)
      setListening(false)
    }

    recognizerRef.current = rec
    rec.start()
  }

  function stopListening() {
    recognizerRef.current?.stop()
    recognizerRef.current = null
  }

  function toggleMic() {
    if (listening) {
      stopListening()
    } else {
      startListening()
    }
  }

  // Stop recognition if the form closes or the component unmounts
  useEffect(() => {
    return () => { recognizerRef.current?.abort() }
  }, [])

  function addNote() {
    if (!text.trim()) return
    stopListening()
    const entry = {
      id:     Date.now().toString(),
      date:   new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      ticker: ticker.trim().toUpperCase(),
      text:   text.trim(),
    }
    const updated = [entry, ...notes]
    setNotes(updated)
    saveNotes(updated)
    setText('')
    setTicker('')
    committedRef.current = ''
    setOpen(false)
  }

  function deleteNote(id) {
    const updated = notes.filter(n => n.id !== id)
    setNotes(updated)
    saveNotes(updated)
  }

  function updateNote(updatedNote) {
    const updated = notes.map(n => n.id === updatedNote.id ? updatedNote : n)
    setNotes(updated)
    saveNotes(updated)
  }

  function handleCancel() {
    stopListening()
    setText('')
    setTicker('')
    committedRef.current = ''
    setMicError(null)
    setOpen(false)
  }

  return (
    <div className="tj-root">
      <div className="tj-header">
        <div className="tj-header-left">
          <span className="tj-title">TRADE JOURNAL</span>
          <span className="tj-sub">Write your thoughts — why you took the trade, what you saw, why you exited</span>
        </div>
        <button className="tj-add-btn" onClick={open ? handleCancel : () => setOpen(true)}>
          {open ? '✕ Cancel' : '+ New Entry'}
        </button>
      </div>

      {open && (
        <div className="tj-form">
          <input
            className="tj-ticker-input"
            placeholder="Ticker (optional — e.g. NVDA)"
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            maxLength={10}
          />

          <div className="tj-textarea-wrap">
            <textarea
              className={`tj-textarea${listening ? ' tj-textarea-listening' : ''}`}
              placeholder="Write your thoughts — why you took this trade, what you see in the chart, your plan, or why you closed it. Or click the mic and speak."
              value={text}
              onChange={e => {
                setText(e.target.value)
                committedRef.current = e.target.value
              }}
              rows={7}
              autoFocus
            />
            {hasSpeech && (
              <button
                className={`tj-mic-btn${listening ? ' tj-mic-listening' : ''}`}
                onClick={toggleMic}
                type="button"
                data-tip={listening
                  ? 'Recording — speak naturally. Click to stop. Words appear as you speak and are saved when you stop.'
                  : 'Talk-to-text — click and speak. Your words are transcribed directly into the journal entry. Works in Chrome and Edge.'}
                aria-label={listening ? 'Stop dictation' : 'Start voice dictation'}
              >
                {listening ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-1 17.93V21h-2a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.07A8.001 8.001 0 0 0 20 11a1 1 0 0 0-2 0 6 6 0 0 1-12 0 1 1 0 0 0-2 0 8.001 8.001 0 0 0 7 7.93z"/>
                  </svg>
                )}
              </button>
            )}
          </div>

          {listening && (
            <div className="tj-mic-status">
              <span className="tj-mic-dot" />
              Listening — speak naturally. Click the stop button when done.
            </div>
          )}

          {micError && (
            <div className="tj-mic-error">{micError}</div>
          )}

          {!hasSpeech && open && (
            <div className="tj-mic-unsupported">
              Voice dictation requires Chrome or Edge. Type your entry below.
            </div>
          )}

          <div className="tj-form-actions">
            <button
              className="tj-save-btn"
              onClick={addNote}
              disabled={!text.trim()}
            >
              Save Entry
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 && !open && (
        <div className="tj-empty">
          No journal entries yet. Click <strong>+ New Entry</strong> to write your first trade thought. The best traders write down why they entered and why they exited — it builds pattern recognition over time.
        </div>
      )}

      <div className="tj-entries">
        {notes.map(n => (
          <div key={n.id} className="tj-entry">
            <div className="tj-entry-header">
              <div className="tj-entry-meta">
                {n.ticker && <span className="tj-entry-ticker">{n.ticker}</span>}
                <span className="tj-entry-date">{n.date}</span>
                {n.tradeSnap && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: '#60a5fa',
                    background: '#0c1e38', border: '1px solid #1e3a5f',
                    borderRadius: 3, padding: '1px 5px',
                  }}>OPTIONS LOG</span>
                )}
                {n.tradeSnap?.exit && (
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    color: n.tradeSnap.exit.totalPnl >= 0 ? '#10b981' : '#ef4444',
                    background: n.tradeSnap.exit.totalPnl >= 0 ? '#011a0d' : '#1a0000',
                    border: `1px solid ${n.tradeSnap.exit.totalPnl >= 0 ? '#065f46' : '#7f1d1d'}`,
                    borderRadius: 3, padding: '1px 5px',
                  }}>
                    {n.tradeSnap.exit.totalPnl >= 0 ? '✓ CLOSED WIN' : '✗ CLOSED LOSS'}
                  </span>
                )}
              </div>
              <button className="tj-del-btn" onClick={() => deleteNote(n.id)} title="Delete entry">✕</button>
            </div>
            {n.tradeSnap ? (
              <OptionsTradeCard note={n} onUpdate={updateNote} onDelete={deleteNote} />
            ) : (
              <p className="tj-entry-text">{n.text}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
