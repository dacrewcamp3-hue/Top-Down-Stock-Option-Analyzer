import './ExitPlan.css'

const f2 = v => v != null ? (+v).toFixed(2) : '—'
const pct = (val, ref) => ref ? ((val - ref) / ref * 100).toFixed(1) : null

function pctLabel(val, ref, isCall) {
  const p = pct(val, ref)
  if (p == null) return ''
  const n = parseFloat(p)
  const arrow = n >= 0 ? '↑' : '↓'
  return `${arrow}${Math.abs(n).toFixed(1)}%`
}

function computePlan({ currentPrice, direction, atr, fibLevels, volumeProfile }) {
  if (!currentPrice || !direction || direction === 'NO TRADE') return null
  const isCall = direction === 'CALL'

  // ── Stop Loss — 1.5× ATR from current price ─────────────────────────────
  let stop = null, stopNote = ''
  if (atr != null && atr > 0) {
    stop     = isCall ? currentPrice - atr * 1.5 : currentPrice + atr * 1.5
    stopNote = `1.5× ATR (${f2(atr)}) ${isCall ? 'below' : 'above'} entry`
  }

  // ── Collect all Fib levels and filter to correct side ───────────────────
  const allFib = [
    fibLevels?.ext100  != null ? { val: fibLevels.ext100,  label: 'Fib 1.0 Ext.'    } : null,
    fibLevels?.ext618  != null ? { val: fibLevels.ext618,  label: 'Fib 1.618 Ext.'  } : null,
    fibLevels?.ret382  != null ? { val: fibLevels.ret382,  label: 'Fib 38.2% Ret.'  } : null,
    fibLevels?.ret618  != null ? { val: fibLevels.ret618,  label: 'Fib 61.8% Ret.'  } : null,
  ].filter(Boolean)

  const targets = isCall
    ? allFib.filter(f => f.val > currentPrice).sort((a, b) => a.val - b.val)
    : allFib.filter(f => f.val < currentPrice).sort((a, b) => b.val - a.val)

  // Fill missing targets from volume profile or ATR multiples
  if (targets.length === 0 && volumeProfile?.vah != null && isCall && volumeProfile.vah > currentPrice)
    targets.push({ val: volumeProfile.vah, label: 'Volume Area High (VAH)' })
  if (targets.length === 0 && volumeProfile?.val != null && !isCall && volumeProfile.val < currentPrice)
    targets.push({ val: volumeProfile.val, label: 'Volume Area Low (VAL)' })

  // ATR fallback if still no targets
  if (targets.length < 2 && atr != null && atr > 0) {
    const t1 = isCall ? currentPrice + atr * 2 : currentPrice - atr * 2
    const t2 = isCall ? currentPrice + atr * 4 : currentPrice - atr * 4
    if (targets.length === 0) targets.push({ val: t1, label: '2× ATR target' })
    targets.push({ val: t2, label: '4× ATR target' })
  }

  const target1 = targets[0] ?? null
  const target2 = targets[1] ?? targets[0] ?? null

  // ── Risk / Reward ────────────────────────────────────────────────────────
  const riskDist = stop != null ? Math.abs(currentPrice - stop) : null
  const rr1 = riskDist && target1 ? (Math.abs(target1.val - currentPrice) / riskDist).toFixed(1) : null
  const rr2 = riskDist && target2 ? (Math.abs(target2.val - currentPrice) / riskDist).toFixed(1) : null

  // ── Dollar risk at 1% account size ──────────────────────────────────────
  const account    = +(localStorage.getItem('rp_account')  || 25000)
  const riskPctPre = +(localStorage.getItem('rp_risk_pct') || 1.0)
  const maxRisk    = account * (riskPctPre / 100)
  const shares     = riskDist && riskDist > 0 ? Math.floor(maxRisk / riskDist) : null

  return { stop, stopNote, target1, target2, rr1, rr2, riskDist, maxRisk, shares, account, isCall }
}

export default function ExitPlan({ currentPrice, direction, atr, fibLevels, volumeProfile, tradeScore }) {
  const plan = computePlan({ currentPrice, direction, atr, fibLevels, volumeProfile })
  if (!plan) return null

  const { stop, stopNote, target1, target2, rr1, rr2, riskDist, maxRisk, shares, account, isCall } = plan
  if (!stop && !target1) return null

  const dirColor = isCall ? '#10b981' : '#ef4444'
  const dirBg    = isCall ? '#011a0c' : '#1a0205'
  const dirBord  = isCall ? '#065f46' : '#7f1d1d'

  return (
    <div className="ep-root" data-tip="Exit Plan — pre-calculated levels so you never make stop or target decisions under pressure. Stop Loss uses 1.5× ATR from entry. Target 1 is your 50% scale-out. Target 2 is the measured move full exit. Set these in your broker BEFORE you enter the trade.">
      <div className="ep-header">
        <span className="ep-title">EXIT PLAN</span>
        <span className="ep-dir" style={{ color: dirColor }}>{direction} · {isCall ? 'LONG' : 'SHORT'}</span>
        {rr1 && rr2 && (
          <span className="ep-rr" data-tip={`Risk/Reward: risking ${riskDist?.toFixed(2)} to make ${Math.abs(target1.val - currentPrice).toFixed(2)} (T1) or ${Math.abs(target2.val - currentPrice).toFixed(2)} (T2).`}>
            R:R {rr1}:1 → {rr2}:1
          </span>
        )}
      </div>

      <div className="ep-levels">
        {/* Entry reference */}
        <div className="ep-row ep-entry-row">
          <div className="ep-row-left">
            <span className="ep-level-badge ep-badge-entry">ENTRY</span>
            <span className="ep-level-label">Current Price</span>
          </div>
          <div className="ep-row-right">
            <span className="ep-price ep-price-entry">${f2(currentPrice)}</span>
          </div>
        </div>

        {/* Stop Loss */}
        {stop != null && (
          <div className="ep-row ep-stop-row" data-tip={`Stop Loss: ${stopNote}. If price closes below this level (for calls) or above (for puts), exit immediately — your thesis is wrong. At 1% risk on a $${account.toLocaleString()} account, max dollar loss is $${maxRisk.toFixed(0)}.`}>
            <div className="ep-row-left">
              <span className="ep-level-badge ep-badge-stop">STOP</span>
              <span className="ep-level-label">{stopNote}</span>
            </div>
            <div className="ep-row-right">
              <span className="ep-price ep-price-stop">${f2(stop)}</span>
              <span className="ep-pct-stop">{pctLabel(stop, currentPrice, isCall)}</span>
              {shares != null && shares > 0 && (
                <span className="ep-shares">{shares} sh · −${maxRisk.toFixed(0)} max</span>
              )}
            </div>
          </div>
        )}

        {/* Target 1 — 50% scale-out */}
        {target1 && (
          <div className="ep-row ep-t1-row" style={{ borderColor: `${dirColor}20` }} data-tip={`Target 1 — SELL 50% HERE. ${target1.label}. At this level, sell half your position and move your stop to breakeven. You are now playing with house money on the remaining half — no trade can turn into a loss from this point.`}>
            <div className="ep-row-left">
              <span className="ep-level-badge ep-badge-t1" style={{ background: `${dirColor}15`, borderColor: `${dirColor}40`, color: dirColor }}>T1 · 50%</span>
              <span className="ep-level-label">{target1.label}</span>
            </div>
            <div className="ep-row-right">
              <span className="ep-price" style={{ color: dirColor }}>${f2(target1.val)}</span>
              <span className="ep-pct" style={{ color: dirColor }}>{pctLabel(target1.val, currentPrice, isCall)}</span>
              {rr1 && <span className="ep-rr-chip" style={{ color: dirColor, borderColor: `${dirColor}30` }}>{rr1}:1 R:R</span>}
            </div>
          </div>
        )}

        {/* Target 2 — full exit */}
        {target2 && target2 !== target1 && (
          <div className="ep-row ep-t2-row" style={{ borderColor: `${dirColor}20` }} data-tip={`Target 2 — FULL EXIT. ${target2.label}. At this level, close the remaining position. This is the measured move target — the full expected range of the trade. Do not hold past this level hoping for more.`}>
            <div className="ep-row-left">
              <span className="ep-level-badge ep-badge-t2" style={{ background: `${dirColor}20`, borderColor: `${dirColor}50`, color: dirColor }}>T2 · FULL</span>
              <span className="ep-level-label">{target2.label}</span>
            </div>
            <div className="ep-row-right">
              <span className="ep-price" style={{ color: dirColor }}>${f2(target2.val)}</span>
              <span className="ep-pct" style={{ color: dirColor }}>{pctLabel(target2.val, currentPrice, isCall)}</span>
              {rr2 && <span className="ep-rr-chip" style={{ color: dirColor, borderColor: `${dirColor}30` }}>{rr2}:1 R:R</span>}
            </div>
          </div>
        )}
      </div>

      <div className="ep-rules">
        <div className="ep-rule" data-tip="The moment Target 1 is hit and you sell 50%, move your stop to your entry price. From this point you can no longer lose on this trade.">
          <span className="ep-rule-icon">①</span>
          When T1 hits — sell 50%, move stop to entry (breakeven lock)
        </div>
        <div className="ep-rule" data-tip="Let the remaining 50% run to Target 2 with zero pressure — it costs you nothing to hold.">
          <span className="ep-rule-icon">②</span>
          Remaining 50% rides free to T2 — no risk, no rush
        </div>
        <div className="ep-rule" data-tip="If the stop is hit before T1, exit the full position immediately. Do not average down. Do not wait for a bounce. The thesis is wrong — exit.">
          <span className="ep-rule-icon">③</span>
          Stop hit before T1 — close full position, no exceptions
        </div>
      </div>
    </div>
  )
}
