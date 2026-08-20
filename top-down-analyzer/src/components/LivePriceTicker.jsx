import { useState, useEffect, useRef } from 'react'

// Smart price formatter: 3 decimal places for sub-$1, 2 for everything else
function fmtPrice(p) {
  if (p == null) return '—'
  if (p < 1)    return p.toFixed(3)
  if (p < 10)   return p.toFixed(2)
  if (p >= 1000) return p.toFixed(0)
  return p.toFixed(2)
}

// Displays the current price and day-change% in the app header.
// `changePct` is Yahoo Finance's pre-computed regularMarketChangePercent — most accurate source.
// Falls back to computing from currentPrice vs prevDayClose if changePct isn't available.
export default function LivePriceTicker({ currentPrice, prevDayClose, changePct }) {
  const [flash,       setFlash]       = useState(null)  // 'up' | 'down' | null
  const flashTimerRef = useRef(null)
  const prevPriceRef  = useRef(null)

  // Flash green/red whenever the underlying data refreshes (new ticker or auto-reload)
  useEffect(() => {
    if (currentPrice == null) return
    if (prevPriceRef.current !== null && prevPriceRef.current !== currentPrice) {
      const dir = currentPrice > prevPriceRef.current ? 'up' : 'down'
      setFlash(dir)
      clearTimeout(flashTimerRef.current)
      flashTimerRef.current = setTimeout(() => setFlash(null), 700)
    }
    prevPriceRef.current = currentPrice
    return () => clearTimeout(flashTimerRef.current)
  }, [currentPrice])

  if (!currentPrice) return null

  // Use Yahoo's direct changePct if available — avoids rounding errors from S - change arithmetic.
  // Fall back to computing from prevDayClose for stocks without an active options chain.
  const displayPct = changePct != null
    ? changePct
    : (prevDayClose != null ? (currentPrice - prevDayClose) / prevDayClose * 100 : null)

  const up = displayPct != null ? displayPct >= 0 : null

  return (
    <div className={`lpt${flash ? ` lpt-flash-${flash}` : ''}`}>
      <span className="lpt-price">${fmtPrice(currentPrice)}</span>
      {displayPct != null && (
        <span className={`lpt-change${up ? ' lpt-up' : ' lpt-dn'}`}>
          {up ? '+' : ''}{displayPct.toFixed(2)}%
        </span>
      )}
      <span className="lpt-delay" title="Yahoo Finance data is approximately 15 minutes delayed during market hours">~15m</span>
      <span className="lpt-dot" title="Updates on each reload" />
    </div>
  )
}
