import { useEmaNames } from '../utils/emaNames'
import './VerdictPanel.css'

function fmt(price) {
  if (price == null || isNaN(price)) return '—'
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Catalyst row ─────────────────────────────────────────────────────────────
function CatalystRow({ color, label, value, detail }) {
  return (
    <div className="vp-catalyst-row" style={{ borderLeftColor: color }}>
      <div className="vp-catalyst-label" style={{ color }}>{label}</div>
      <div className="vp-catalyst-value">{value}</div>
      {detail && <div className="vp-catalyst-detail">{detail}</div>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VerdictPanel({
  ticker,
  direction,
  tradeScore,
  confluenceResult,
  swingResult,
  orbRetest,
  weeklyAlign,
  adxSignal,
  regimeBlocked,
  earningsDate,
  vixData,
  currentPrice,
  fibLevels,
  setupGrade,
  allGatesOpen,
  ivData,
  breadthData,
}) {
  const emaNames = useEmaNames()
  const e8n  = emaNames[8]
  const e15n = emaNames[15]

  const isCall = direction === 'CALL'
  const isPut  = direction === 'PUT'
  const score  = tradeScore?.score ?? 0
  const adx    = adxSignal?.adx != null ? Math.round(adxSignal.adx) : null
  const vix    = vixData?.current != null ? vixData.current.toFixed(1) : '—'

  // ── Days to earnings ────────────────────────────────────────────────────────
  const daysToEarnings = earningsDate
    ? Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24))
    : null

  // ── Verdict logic ────────────────────────────────────────────────────────────
  // NO overrides everything
  const isNo =
    direction === 'NO TRADE' ||
    regimeBlocked ||
    score < 42 ||
    breadthData?.verdict === 'HOSTILE'

  const isGo =
    !isNo &&
    (isCall || isPut) &&
    score >= 65 &&
    allGatesOpen === true &&
    !regimeBlocked &&
    breadthData?.verdict !== 'HOSTILE' &&
    (daysToEarnings === null || daysToEarnings > 7)

  const verdict = isNo ? 'NO' : isGo ? 'GO' : 'WAIT'

  // ── Verdict styling ──────────────────────────────────────────────────────────
  const VS = {
    GO:   { color: '#10b981', bg: '#011c0e', border: '#065f46' },
    WAIT: { color: '#f59e0b', bg: '#1a1000', border: '#78350f' },
    NO:   { color: '#ef4444', bg: '#1a0000', border: '#7f1d1d' },
  }
  const vs = VS[verdict]

  const goGlow = verdict === 'GO'
    ? '0 0 0 1px rgba(16,185,129,0.18), 0 0 18px 0 rgba(16,185,129,0.08)'
    : 'none'

  // ── Direction badge ──────────────────────────────────────────────────────────
  const dirStyle =
    direction === 'CALL' ? { color: '#10b981', bg: '#011c10', border: '#065f46' }
    : direction === 'PUT' ? { color: '#ef4444', bg: '#1c0101', border: '#7f1d1d' }
    : null

  // ── Score pill color ─────────────────────────────────────────────────────────
  const scoreColor =
    score >= 65 ? '#10b981'
    : score >= 42 ? '#f59e0b'
    : '#ef4444'

  // ── Why line ─────────────────────────────────────────────────────────────────
  let whyText = ''
  if (verdict === 'GO') {
    const adxPart = adx != null ? `, ADX ${adx} trending` : ''
    whyText = `All 3 gates open, score ${score}/100${adxPart} — setup meets every condition for entry.`
  } else if (verdict === 'WAIT') {
    const weeklyLocked = confluenceResult?.weeklyGate === 'fail'
    const dailyLocked  = confluenceResult?.dailyGate  === 'fail'
    const needDir      = isCall ? 'BULLISH' : 'BEARISH'
    if (weeklyLocked) {
      whyText = `Weekly gate locked — weekly structure is ${weeklyAlign?.signal ?? 'MIXED'}, need ${needDir} for ${direction} entry.`
    } else if (score < 65) {
      whyText = `Score ${score}/100 below the 65-point threshold — wait for confluence to strengthen.`
    } else if (dailyLocked) {
      whyText = `Daily gate locked — daily momentum is not aligned with ${direction} direction.`
    } else if (!allGatesOpen) {
      whyText = `Gate 3 not confirmed — wait for 4H entry trigger or ORB break and retest to complete.`
    } else if (daysToEarnings != null && daysToEarnings <= 7) {
      whyText = `Earnings in ${daysToEarnings}d — IV crush risk after the report. Wait until post-earnings clarity.`
    } else {
      whyText = 'Setup developing — not all conditions met for a confident entry. Wait for further alignment.'
    }
  } else {
    // NO
    if (regimeBlocked) {
      whyText = `Regime blocked — VIX ${vix} elevated with bearish weekly. No CALL trades until VIX drops below 28.`
    } else if (direction === 'NO TRADE') {
      whyText = 'No directional confluence — weekly and daily timeframes disagree. Sit out.'
    } else if (score < 42) {
      whyText = `Score ${score}/100 — setup too weak to trade. No trade until score exceeds 42.`
    } else if (breadthData?.verdict === 'HOSTILE') {
      whyText = 'Market breadth is HOSTILE — systemic headwind makes directional plays extremely risky. Stand aside.'
    }
  }

  // ── Entry plan (GO only) ─────────────────────────────────────────────────────
  let stopPrice = null
  let stopLabel = ''
  let targetPrice = null
  let targetLabel = ''
  let targetPct   = null

  if (verdict === 'GO' && currentPrice != null) {
    const rets = fibLevels?.retracements ?? []
    const exts = fibLevels?.extensions   ?? []

    if (isCall) {
      const below = rets.filter(r => r.price < currentPrice).sort((a, b) => b.price - a.price)
      stopPrice = below.length > 0 ? below[0].price : currentPrice * 0.98
      stopLabel = below.length > 0 ? below[0].label : '2% below entry'
      const above = exts.filter(e => e.price > currentPrice).sort((a, b) => a.price - b.price)
      if (above.length > 0) { targetPrice = above[0].price; targetLabel = above[0].label }
    } else {
      const above = rets.filter(r => r.price > currentPrice).sort((a, b) => a.price - b.price)
      stopPrice = above.length > 0 ? above[0].price : currentPrice * 1.02
      stopLabel = above.length > 0 ? above[0].label : '2% above entry'
      const below = exts.filter(e => e.price < currentPrice).sort((a, b) => b.price - a.price)
      if (below.length > 0) { targetPrice = below[0].price; targetLabel = below[0].label }
    }

    if (targetPrice != null) {
      targetPct = Math.abs(((targetPrice - currentPrice) / currentPrice) * 100).toFixed(1)
    }
  }

  // ── WAIT blockers ─────────────────────────────────────────────────────────────
  const blockers = []
  if (verdict === 'WAIT') {
    const weeklyLocked = confluenceResult?.weeklyGate === 'fail'
    const dailyLocked  = confluenceResult?.dailyGate  === 'fail'

    // Gate 3 (mirrors EntryRecommendation logic)
    const swingFull    = isCall ? swingResult?.signal === 'LONG' : swingResult?.signal === 'EXIT'
    const orbConfirmed = ['ENTER', 'RECAPTURED'].includes(orbRetest?.signal)
    const gate3Open    = swingFull || orbConfirmed

    if (weeklyLocked) {
      blockers.push(`Gate 1 locked — wait for weekly to reclaim ${e8n}/${e15n} on a daily close`)
    }
    if (dailyLocked) {
      blockers.push(`Gate 2 locked — daily momentum conflicts with ${direction}. Wait for daily structure to shift.`)
    }
    if (score < 65) {
      const bd = (tradeScore?.breakdown ?? [])
        .filter(b => b.max > 0)
        .map(b => ({ ...b, efficiency: b.score / b.max }))
        .sort((a, b) => a.efficiency - b.efficiency)
        .slice(0, 2)
        .map(b => b.label)
      const missing = bd.length > 0 ? bd.join(', ') : 'more confluence'
      blockers.push(`Score ${score} — need 65+. Currently missing: ${missing}`)
    }
    if (!gate3Open && !weeklyLocked && !dailyLocked) {
      blockers.push(`Gate 3 not confirmed — need 2 consecutive 4H bars on the same side of ${e8n}, or ORB break + retest`)
    }
    if (daysToEarnings != null && daysToEarnings <= 7) {
      blockers.push(`Earnings in ${daysToEarnings}d — do not enter before the report. Wait until after earnings.`)
    }
  }

  // ── Catalyst data ─────────────────────────────────────────────────────────────
  // Earnings
  let earningsColor = '#6b7280'
  let earningsValue = 'Earnings date not loaded'
  let earningsDetail = 'Verify the earnings date before entry.'
  if (daysToEarnings != null) {
    if (daysToEarnings <= 7) {
      earningsColor  = '#ef4444'
      earningsValue  = `EARNINGS IN ${daysToEarnings}d — DO NOT ENTER`
      earningsDetail = 'IV crush risk after the report will destroy option value regardless of direction.'
    } else if (daysToEarnings <= 21) {
      const dirMsg   = isCall ? 'could fuel upside if beat' : 'could accelerate downside if miss'
      earningsColor  = '#f59e0b'
      earningsValue  = `EARNINGS IN ${daysToEarnings}d — catalyst ${dirMsg}`
      earningsDetail = 'Size down 50% or use a spread. Close position before the report.'
    } else {
      earningsColor  = '#10b981'
      earningsValue  = `Earnings ${daysToEarnings}d away — safe DTE window`
      earningsDetail = 'No earnings risk this cycle.'
    }
  }

  // Market Regime / Breadth
  let breadthColor  = '#6b7280'
  let breadthValue  = 'Breadth not loaded'
  let breadthDetail = null
  const bv = breadthData?.verdict
  if (bv) {
    if (bv === 'FAVORABLE' || bv === 'LEANING BULLISH') {
      breadthColor  = '#10b981'
      breadthValue  = 'FAVORABLE'
      breadthDetail = `Market breadth favorable — tailwind for ${direction !== 'NO TRADE' ? direction : 'directional'} setups.`
    } else if (bv === 'MIXED') {
      breadthColor  = '#f59e0b'
      breadthValue  = 'MIXED'
      breadthDetail = 'Market could go either way. Directional plays require a stronger individual setup.'
    } else if (bv === 'LEANING BEARISH' || bv === 'HOSTILE') {
      breadthColor  = '#ef4444'
      breadthValue  = bv === 'HOSTILE' ? 'HOSTILE' : 'LEANING BEARISH'
      breadthDetail = 'Bearish market breadth — CALL setups face systemic headwind. Prefer puts or stand aside.'
    }
  }

  // IV Environment
  let ivColor  = '#6b7280'
  let ivValue  = 'IV not loaded'
  let ivDetail = null
  const ivRank = ivData?.ivRank
  if (ivRank != null) {
    if (ivRank < 30) {
      ivColor  = '#10b981'
      ivValue  = `IV Rank ${Math.round(ivRank)}% — cheap premium`
      ivDetail = 'Good time to buy options outright.'
    } else if (ivRank <= 60) {
      ivColor  = '#f59e0b'
      ivValue  = `IV Rank ${Math.round(ivRank)}% — standard conditions`
      ivDetail = 'Standard sizing.'
    } else {
      ivColor  = '#ef4444'
      ivValue  = `IV Rank ${Math.round(ivRank)}% — expensive premium`
      ivDetail = "Use a spread. Buying naked options at this IV rank means you're overpaying."
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div
      className={`vp-root vp-${verdict.toLowerCase()}`}
      style={{ borderColor: vs.border, boxShadow: goGlow }}
    >

      {/* ── Header ── */}
      <div className="vp-header">
        <div className="vp-header-left">
          <span className="vp-verdict" style={{ color: vs.color }}>
            {verdict}
          </span>
          {dirStyle && (
            <span
              className="vp-dir-badge"
              style={{ color: dirStyle.color, background: dirStyle.bg, borderColor: dirStyle.border }}
            >
              {direction}
            </span>
          )}
        </div>
        <div className="vp-header-right">
          {ticker && <span className="vp-ticker">{ticker.toUpperCase()}</span>}
          <span
            className="vp-score-pill"
            style={{ color: scoreColor, borderColor: scoreColor + '55' }}
          >
            {score}/100
          </span>
          {tradeScore?.label && (
            <span className="vp-score-label" style={{ color: scoreColor }}>
              {tradeScore.label}
            </span>
          )}
        </div>
      </div>

      {/* ── Why line ── */}
      {whyText && (
        <div className="vp-why" style={{ borderColor: vs.border + '44' }}>
          {whyText}
        </div>
      )}

      {/* ── Entry plan (GO only) ── */}
      {verdict === 'GO' && currentPrice != null && (
        <>
          <div className="vp-entry-plan">
            <div className="vp-entry-col">
              <div className="vp-entry-label">ENTRY</div>
              <div className="vp-entry-value">${fmt(currentPrice)}</div>
              <div className="vp-entry-note">at market</div>
            </div>
            <div className="vp-entry-col">
              <div className="vp-entry-label">STOP</div>
              <div className="vp-entry-value">${fmt(stopPrice)}</div>
              {stopLabel && <div className="vp-entry-note">{stopLabel}</div>}
            </div>
            {targetPrice != null && (
              <div className="vp-entry-col">
                <div className="vp-entry-label">TARGET</div>
                <div className="vp-entry-value">${fmt(targetPrice)}</div>
                <div className="vp-entry-note">
                  {targetLabel}{targetPct ? ` · +${targetPct}%` : ''}
                </div>
              </div>
            )}
          </div>

          {stopPrice != null && (
            <div className="vp-invalidation">
              Trade is wrong if price closes {isCall ? 'below' : 'above'} ${fmt(stopPrice)} — exit immediately.
            </div>
          )}
        </>
      )}

      {/* ── What needs to change (WAIT only) ── */}
      {verdict === 'WAIT' && blockers.length > 0 && (
        <div className="vp-blockers">
          <div className="vp-blockers-title">WHAT NEEDS TO CHANGE</div>
          {blockers.map((b, i) => (
            <div key={i} className="vp-blocker-item">
              <span className="vp-blocker-icon">→</span>
              <span className="vp-blocker-text">{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Catalyst Alignment (always visible) ── */}
      <div className="vp-catalyst">
        <div className="vp-catalyst-title">CATALYST ALIGNMENT</div>

        <CatalystRow
          color={earningsColor}
          label="EARNINGS"
          value={earningsValue}
          detail={earningsDetail}
        />
        <CatalystRow
          color={breadthColor}
          label="MARKET REGIME"
          value={breadthValue}
          detail={breadthDetail}
        />
        <CatalystRow
          color={ivColor}
          label="IV ENVIRONMENT"
          value={ivValue}
          detail={ivDetail}
        />
      </div>
    </div>
  )
}
