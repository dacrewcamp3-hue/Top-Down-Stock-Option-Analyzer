import { useState, useEffect } from 'react'

// Reads data-tip="..." from any element in the DOM via event delegation.
// Add data-tip to any HTML element and this component handles the rest.
export default function GlobalTooltip() {
  const [tip, setTip] = useState(null)

  useEffect(() => {
    let current = null

    const show = (el, x, y) => {
      current = el
      setTip({ text: el.dataset.tip, x, y })
    }
    const hide = () => {
      current = null
      setTip(null)
    }
    const onOver = e => {
      const el = e.target.closest('[data-tip]')
      if (el === current) return
      if (!el) { hide(); return }
      show(el, e.clientX, e.clientY)
    }
    const onOut = e => {
      const toEl = e.relatedTarget?.closest?.('[data-tip]')
      if (!toEl) hide()
      else if (toEl !== current) show(toEl, e.clientX, e.clientY)
    }
    const onMove = e => {
      if (!current) return
      setTip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
    }

    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mouseout',  onOut,  true)
    document.addEventListener('mousemove', onMove, true)
    return () => {
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mouseout',  onOut,  true)
      document.removeEventListener('mousemove', onMove, true)
    }
  }, [])

  if (!tip) return null

  const left = Math.min(tip.x + 16, window.innerWidth - 272)
  const top  = Math.max(tip.y - 72, 8)

  return (
    <div className="gt-wrap" style={{ left, top }}>
      {tip.text}
    </div>
  )
}
