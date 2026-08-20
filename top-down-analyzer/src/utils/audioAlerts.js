// Shared audio alert utility — uses Web Audio API (no external files).
// Reads the mute preference from localStorage so all components stay in sync
// with the sound toggle in App settings.

const NOTES = {
  call:  [523, 659, 784],   // C5-E5-G5 ascending — bullish
  put:   [784, 659, 523],   // G5-E5-C5 descending — bearish
  orb:   [880, 1046],       // A5-C6 — ORB break alert
  ema8:  [660, 880],        // E5-A5 — 8 EMA cross
  price: [1046, 880, 1046], // C6-A5-C6 — price level hit
  scan:  [523, 784],        // C5-G5 — scanner found setup
}

const STORAGE_KEY = 'tdsa-sound-on'

export function isSoundEnabled() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'false' } catch { return true }
}

export function setSoundEnabled(enabled) {
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false') } catch {}
}

export function playTone(type) {
  if (!isSoundEnabled()) return
  try {
    const ctx   = new (window.AudioContext || window.webkitAudioContext)()
    const notes = NOTES[type] ?? [440]

    const schedule = () => {
      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = freq
        osc.type = 'sine'
        const t = ctx.currentTime + i * 0.18
        gain.gain.setValueAtTime(0.25, t)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
        osc.start(t)
        osc.stop(t + 0.25)
      })
      setTimeout(() => ctx.close(), 2000)
    }

    // Browsers suspend AudioContext until a user gesture has occurred.
    // resume() is a no-op when already running, so it's safe to always call.
    if (ctx.state === 'suspended') {
      ctx.resume().then(schedule).catch(() => {})
    } else {
      schedule()
    }
  } catch {}
}
