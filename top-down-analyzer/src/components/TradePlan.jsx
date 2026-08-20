import { useMemo, useState } from 'react'
import { bsPrice, calcGreeks } from '../utils/fetchOptions'
import './TradePlan.css'

const f2 = v => (v != null && !isNaN(v)) ? (+v).toFixed(2) : '—'
const f0 = v => (v != null && !isNaN(v)) ? Math.abs(Math.round(+v)).toLocaleString() : '—'

export default function TradePlan({
  ticker, currentPrice, direction, rec, qty,
  fibLevels, atr, pullbackData,
  swingResult, orbRetest,
  ivData, historicalVol, tradeScore,
}) {
  const [logged, setLogged] = useState(false)

  // ── Derive option math inputs before any early returns (hooks must be unconditional) ──
  const isCall  = direction === 'CALL'
  const sigma   = (ivData?.atmIV != null ? ivData.atmIV / 100 : null) ?? historicalVol ?? 0.30
  const T       = rec ? Math.max(0.01, rec.dte / 365) : 0.01
  const K       = rec?.strike ?? 0

  const greeks = useMemo(
    () => (currentPrice && K > 0 && T > 0 && sigma > 0)
      ? calcGreeks(currentPrice, K, T, sigma, isCall)
      : null,
    [currentPrice, K, T, sigma, isCall]
  )

  // ── Early exits (after all hooks) ────────────────────────────────────────
  if (!currentPrice || !direction || direction === 'NO TRADE' || !rec) return null

  const dirColor  = isCall ? '#10b981' : '#ef4444'
  const rootBg    = isCall ? '#010e06' : '#0e0101'
  const rootBdr   = isCall ? '#063d28' : '#5a1010'

  // ── Entry trigger state ───────────────────────────────────────────────────
  const swingFull  = (isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT') && swingResult?.confirmed === true
  const orbOk      = ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
  const swingWatch = swingResult?.signal === 'WATCH'
  const orbForming = ['BREAK', 'RETEST'].includes(orbRetest?.signal)
  const tState = (swingFull || orbOk) ? 'GO' : (swingWatch || orbForming) ? 'WATCH' : 'WAIT'

  const triggerText =
    tState === 'GO'
      ? (orbOk ? `ORB ${orbRetest.signal} confirmed — ENTER NOW` : '4H 2-bar rule met — ENTER NOW')
      : tState === 'WATCH'
        ? (orbForming ? `ORB ${orbRetest.signal} forming — await ENTER signal` : '4H 1-bar formed — wait for second close')
        : 'No entry trigger yet — wait for all 3 Gates'
  const triggerColor = tState === 'GO' ? dirColor : tState === 'WATCH' ? '#f59e0b' : '#3a5070'
  const triggerDot   = tState === 'GO' ? '●' : tState === 'WATCH' ? '◑' : '○'

  // ── Stop price (EMA-based, ATR fallback) ──────────────────────────────────
  const { e8, e15, e65 } = pullbackData ?? {}
  const stopCands = []
  if (e15 != null && (isCall ? e15 < currentPrice : e15 > currentPrice))
    stopCands.push({ label: '15 EMA', price: +e15.toFixed(2) })
  if (e8 != null && (isCall ? e8 < currentPrice : e8 > currentPrice))
    stopCands.push({ label: '8 EMA',  price: +e8.toFixed(2)  })
  if (e65 != null && (isCall ? e65 < currentPrice : e65 > currentPrice))
    stopCands.push({ label: '65 EMA', price: +e65.toFixed(2) })
  const atrStop = atr != null
    ? +(isCall ? currentPrice - 1.5 * atr : currentPrice + 1.5 * atr).toFixed(2)
    : null
  const stopPx    = stopCands[0]?.price ?? atrStop
  const stopLabel = stopCands[0]?.label ?? (atr != null ? '1.5× ATR' : null)

  // ── Target price (first Fib extension on correct side) ────────────────────
  const extCands = (fibLevels?.extensions ?? [])
    .filter(ext => ext.extension && (isCall ? ext.price > currentPrice : ext.price < currentPrice))
  const targetPx    = extCands[0]?.price != null ? +extCands[0].price.toFixed(2) : null
  const targetLabel = extCands[0]?.label ?? null

  if (!stopPx && !targetPx) return null

  // ── Option price at each scenario ─────────────────────────────────────────
  const optStop   = stopPx   != null ? bsPrice(stopPx,   K, T, sigma, isCall) : null
  const optEntry  = rec.premium
  const optTarget = targetPx != null ? bsPrice(targetPx, K, T, sigma, isCall) : null

  // Stock R:R
  const rr = (stopPx != null && targetPx != null && Math.abs(currentPrice - stopPx) > 0)
    ? +(Math.abs(targetPx - currentPrice) / Math.abs(currentPrice - stopPx)).toFixed(1)
    : null

  // ── Option exit levels ────────────────────────────────────────────────────
  const stopPrem50   = +(optEntry * 0.50).toFixed(2)
  const profitPrem50 = +(optEntry * 1.50).toFixed(2)
  const daysBeforeExpiry = Math.max(0, rec.dte - 7)
  const timeExitStr  = (() => {
    const d = new Date()
    d.setDate(d.getDate() + daysBeforeExpiry)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })()

  // ── Vega / IV crush warning ────────────────────────────────────────────────
  const ivRank       = ivData?.ivRank
  const showVegaWarn = ivRank != null && ivRank > 60 && greeks?.vega != null
  // Impact of a 10-point IV drop, per contract (vega is per 1% per share)
  const vegaDrop10   = greeks != null ? Math.abs(greeks.vega * 10 * 100) : null

  // ── Log to signal journal ──────────────────────────────────────────────────
  function handleLog() {
    const entry = {
      id:          Date.now(),
      date:        new Date().toISOString(),
      ticker,
      direction,
      score:       tradeScore?.score ?? null,
      stockPrice:  currentPrice,
      strike:      rec.strike,
      expiry:      rec.expDate,
      premium:     rec.premium,
      qty:         qty ?? 1,
      dte:         rec.dte,
      result:      'OPEN',
      exitPremium: null,
      notes:       '',
    }
    try {
      const existing = JSON.parse(localStorage.getItem('tdsa-signal-journal') || '[]')
      existing.unshift(entry)
      localStorage.setItem('tdsa-signal-journal', JSON.stringify(existing))
      setLogged(true)
      setTimeout(() => setLogged(false), 2500)
    } catch {}
  }

  return (
    <div className="tp-root" style={{ borderColor: rootBdr, background: rootBg }}>

      {/* ── Header ── */}
      <div className="tp-header">
        <div className="tp-header-left">
          <span className="tp-eyebrow">TRADE PLAN</span>
          <span className="tp-name" style={{ color: dirColor }}>
            {ticker} · {isCall ? '▲ BUY CALLS' : '▼ BUY PUTS'}
          </span>
        </div>
        <button
          className={`tp-log-btn${logged ? ' tp-log-done' : ''}`}
          style={{ borderColor: logged ? '#10b981' : dirColor, color: logged ? '#10b981' : dirColor }}
          onClick={handleLog}
          disabled={logged}
        >
          {logged ? '✓ Logged' : 'Log Trade'}
        </button>
      </div>

      {/* ── Entry trigger ── */}
      <div className="tp-trigger" style={{ color: triggerColor }}>
        <span className="tp-trigger-dot">{triggerDot}</span>
        <span className="tp-trigger-text">{triggerText}</span>
      </div>

      {/* ── 3-column scenario grid ── */}
      <div className="tp-grid">

        {/* STOP column */}
        <div className="tp-gcol tp-gcol-stop">
          <div className="tp-gcol-hdr">STOP</div>
          {stopPx != null ? (
            <>
              <div className="tp-gcol-stock" style={{ color: '#ef4444' }}>${f2(stopPx)}</div>
              <div className="tp-gcol-sub">{stopLabel}</div>
            </>
          ) : (
            <div className="tp-gcol-stock" style={{ color: '#3a5070' }}>—</div>
          )}
          <div className="tp-gcol-rule" />
          <div className="tp-gcol-opt-lbl">Option at stop</div>
          {optStop != null ? (
            <>
              <div className="tp-gcol-opt" style={{ color: '#ef4444' }}>${f2(optStop)}</div>
              <div className="tp-gcol-pct" style={{ color: '#ef4444' }}>
                {((optStop - optEntry) / optEntry * 100).toFixed(0)}%
              </div>
              {qty > 0 && (
                <div className="tp-gcol-dollar" style={{ color: '#ef4444' }}>
                  −${f0((optEntry - optStop) * 100 * qty)}
                </div>
              )}
            </>
          ) : (
            <div className="tp-gcol-opt" style={{ color: '#3a5070' }}>—</div>
          )}
        </div>

        {/* ENTRY column */}
        <div className="tp-gcol tp-gcol-entry">
          <div className="tp-gcol-hdr">ENTRY</div>
          <div className="tp-gcol-stock">${f2(currentPrice)}</div>
          <div className="tp-gcol-sub">at market</div>
          <div className="tp-gcol-rule" />
          <div className="tp-gcol-opt-lbl">Option now</div>
          <div className="tp-gcol-opt">${f2(optEntry)}</div>
          <div className="tp-gcol-pct" style={{ color: '#4a6888' }}>per share</div>
          {qty > 0 && (
            <div className="tp-gcol-dollar">
              ${f0(optEntry * 100 * qty)} total
            </div>
          )}
        </div>

        {/* TARGET column */}
        <div className="tp-gcol tp-gcol-target">
          <div className="tp-gcol-hdr">TARGET</div>
          {targetPx != null ? (
            <>
              <div className="tp-gcol-stock" style={{ color: '#10b981' }}>${f2(targetPx)}</div>
              <div className="tp-gcol-sub">
                {targetLabel}
                {rr != null && (
                  <> · <span style={{ color: rr >= 2 ? '#10b981' : '#f59e0b' }}>{rr}:1 R</span></>
                )}
              </div>
            </>
          ) : (
            <div className="tp-gcol-stock" style={{ color: '#3a5070' }}>—</div>
          )}
          <div className="tp-gcol-rule" />
          <div className="tp-gcol-opt-lbl">Option at target</div>
          {optTarget != null ? (
            <>
              <div className="tp-gcol-opt" style={{ color: '#10b981' }}>${f2(optTarget)}</div>
              <div className="tp-gcol-pct" style={{ color: '#10b981' }}>
                +{((optTarget - optEntry) / optEntry * 100).toFixed(0)}%
              </div>
              {qty > 0 && (
                <div className="tp-gcol-dollar" style={{ color: '#10b981' }}>
                  +${f0((optTarget - optEntry) * 100 * qty)}
                </div>
              )}
            </>
          ) : (
            <div className="tp-gcol-opt" style={{ color: '#3a5070' }}>—</div>
          )}
        </div>

      </div>{/* /tp-grid */}

      {/* ── Full Greeks row ── */}
      {greeks && (
        <div className="tp-greeks">
          <span className="tp-greek" title="Delta — option value change per $1 move in the stock">
            <span className="tp-glbl">Δ</span>{greeks.delta.toFixed(2)}
          </span>
          <span className="tp-gsep">·</span>
          <span className="tp-greek" title="Gamma — rate of Delta change per $1 stock move; larger Gamma = faster acceleration">
            <span className="tp-glbl">Γ</span>{greeks.gamma.toFixed(4)}
          </span>
          <span className="tp-gsep">·</span>
          <span className="tp-greek" title="Theta — premium lost to time decay each calendar day, per contract">
            <span className="tp-glbl">Θ</span>−${(Math.abs(greeks.theta) * 100).toFixed(2)}/day
          </span>
          <span className="tp-gsep">·</span>
          <span className="tp-greek" title="Vega — premium change per 1% shift in implied volatility, per contract">
            <span className="tp-glbl">ν</span>
            {greeks.vega >= 0 ? '+' : ''}${(greeks.vega * 100).toFixed(2)}/1% IV
          </span>
        </div>
      )}

      {/* ── IV crush warning ── */}
      {showVegaWarn && (
        <div className="tp-vega-warn">
          <span className="tp-vw-icon">⚠</span>
          <span className="tp-vw-text">
            <strong>IV Rank {Math.round(ivRank)} — premium is elevated.</strong>{' '}
            A 10-point IV drop would reduce your option by ~${Math.round(vegaDrop10).toLocaleString()} per contract.
            Consider a spread to cap Vega exposure.
          </span>
        </div>
      )}

      {/* ── Exit rules ── */}
      <div className="tp-exit">
        <div className="tp-exit-title">EXIT RULES</div>
        <div className="tp-exit-rules">
          <div className="tp-exit-rule">
            <span className="tp-xdot" style={{ color: '#ef4444' }}>●</span>
            <span>
              <strong>Stop −50%</strong> — exit if premium ≤ ${f2(stopPrem50)}
              {qty > 0 && ` · −$${f0((optEntry - stopPrem50) * 100 * qty)} at stop`}
            </span>
          </div>
          <div className="tp-exit-rule">
            <span className="tp-xdot" style={{ color: '#10b981' }}>●</span>
            <span>
              <strong>Profit +50%</strong> — exit or trail if premium ≥ ${f2(profitPrem50)}
              {qty > 0 && ` · +$${f0((profitPrem50 - optEntry) * 100 * qty)}`}
            </span>
          </div>
          <div className="tp-exit-rule">
            <span className="tp-xdot" style={{ color: '#6b7280' }}>●</span>
            <span>
              <strong>Time exit</strong> — close by {timeExitStr}
              {daysBeforeExpiry > 0 ? ` (${daysBeforeExpiry}d before expiry)` : ' (DTE ≤ 7 — exit now)'}
            </span>
          </div>
        </div>
      </div>

    </div>
  )
}
