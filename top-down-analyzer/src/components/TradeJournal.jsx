import { useState, useRef, useEffect } from 'react'
import './TradeJournal.css'

const STORAGE_KEY = 'tj_notes_v2'

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
              </div>
              <button className="tj-del-btn" onClick={() => deleteNote(n.id)} title="Delete entry">✕</button>
            </div>
            <p className="tj-entry-text">{n.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
