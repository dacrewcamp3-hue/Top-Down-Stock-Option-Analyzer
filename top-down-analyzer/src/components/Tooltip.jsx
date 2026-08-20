import { useState, useRef } from 'react'
import './Tooltip.css'

export default function Tooltip({ text, children }) {
  const [pos, setPos] = useState(null)
  const ref = useRef(null)

  function show() {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const left = Math.min(r.left, window.innerWidth - 252)
    setPos({ top: r.bottom + 6, left: Math.max(4, left) })
  }

  function hide() { setPos(null) }

  return (
    <span
      className="tt-host"
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos && text && (
        <span
          className="tt-bubble"
          role="tooltip"
          style={{ top: pos.top, left: pos.left }}
        >
          {text}
        </span>
      )}
    </span>
  )
}
