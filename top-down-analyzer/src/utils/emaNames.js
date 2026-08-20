import { useState, useEffect } from 'react'

export const EMA_DEFAULTS = { 8: 'Sister', 15: 'Dad', 30: 'Brothers', 65: 'Mom', 200: 'Grandma' }
const LS_KEY = 'ema_custom_names'

export function getEmaNames() {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
    return { ...EMA_DEFAULTS, ...stored }
  } catch { return { ...EMA_DEFAULTS } }
}

export function setEmaName(ema, name) {
  try {
    const trimmed = (name ?? '').trim()
    const current = getEmaNames()
    // If blank, fall back to default for that EMA
    const updated = { ...current, [ema]: trimmed || EMA_DEFAULTS[ema] }
    localStorage.setItem(LS_KEY, JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent('ema-names-changed', { detail: updated }))
  } catch {}
}

export function resetEmaNames() {
  try {
    localStorage.removeItem(LS_KEY)
    window.dispatchEvent(new CustomEvent('ema-names-changed', { detail: { ...EMA_DEFAULTS } }))
  } catch {}
}

// React hook — subscribe to live changes across components
export function useEmaNames() {
  const [names, setNames] = useState(getEmaNames)
  useEffect(() => {
    const handler = e => setNames(e.detail)
    window.addEventListener('ema-names-changed', handler)
    return () => window.removeEventListener('ema-names-changed', handler)
  }, [])
  return names
}
