// Weighted 0-100 trade quality score aggregating every analysis layer.
// Returned by value (no side effects) — call after signals are computed.

export function calcTradeScore({
  confluenceResult,
  setupGrade,
  ivData,
  adxSignal,
  sectorRS,
  insiderData,
  rsiSignal,
  weeklyAlign,
  maStack,
  volumeSpike,
  shortInterest,
  wyckoff,
}) {
  const signal = confluenceResult?.signal
  if (!signal || signal === 'NO TRADE') {
    return { score: 0, label: 'No Signal', color: '#6b7280', bg: '#0a0f1a', border: '#111827', direction: null, breakdown: [] }
  }

  const isCall = signal === 'CALL'
  let total = 0
  const breakdown = []

  function add(label, pts, max, note) {
    total += pts
    breakdown.push({ label, score: pts, max, note })
  }

  // 1. Confluence strength 0-25
  const cfVal   = Math.abs(confluenceResult?.confluence ?? 0)
  const gated   = confluenceResult?.gateBlocked ? 0.65 : 1.0
  const cfPts   = Math.min(25, Math.round(cfVal * 25 * gated))
  const cfDesc  = `${confluenceResult?.totalBull ?? 0}B / ${confluenceResult?.totalBear ?? 0}Be${confluenceResult?.gateBlocked ? ' · gated' : ''}`
  add('Confluence', cfPts, 25, cfDesc)

  // 2. Weekly alignment 0-15
  let weekPts = 0, weekNote = 'No weekly data'
  if (weeklyAlign) {
    const wOk = isCall ? weeklyAlign.signal === 'BULLISH' : weeklyAlign.signal === 'BEARISH'
    const stackOk = weeklyAlign.bullStack === isCall
    if (wOk && stackOk)      { weekPts = 15; weekNote = `Weekly ${weeklyAlign.signal} — fully aligned` }
    else if (wOk)            { weekPts = 10; weekNote = `Weekly ${weeklyAlign.signal} — price aligned, EMA stack mixed` }
    else if (weeklyAlign.signal === 'MIXED') { weekPts = 4; weekNote = 'Weekly mixed — proceed with caution' }
    else                      { weekPts = 0;  weekNote = `Weekly ${weeklyAlign.signal} — conflicts with ${signal} direction` }
  }
  add('Weekly Alignment', weekPts, 15, weekNote)

  // 3. RSI signal 0-12
  let rsiPts = 0, rsiNote = 'No RSI data'
  if (rsiSignal) {
    const rsiOk  = isCall ? rsiSignal.signal === 'BULLISH' : rsiSignal.signal === 'BEARISH'
    const gateOk = isCall ? rsiSignal.above44 : rsiSignal.below43
    const emaOk  = isCall ? rsiSignal.aboveEma : !rsiSignal.aboveEma
    const hasCross = isCall ? (rsiSignal.crossAboveEma || rsiSignal.crossAbove44) : (rsiSignal.crossBelowEma || rsiSignal.crossBelow43)
    if (rsiOk && hasCross)   { rsiPts = 12; rsiNote = `RSI ${rsiSignal.rsi} — ${rsiSignal.signal} cross active` }
    else if (rsiOk && gateOk){ rsiPts = 9;  rsiNote = `RSI ${rsiSignal.rsi} — ${rsiSignal.signal}, above/below 44/43` }
    else if (emaOk && gateOk){ rsiPts = 6;  rsiNote = `RSI ${rsiSignal.rsi} — positioned correctly vs EMA and gate` }
    else if (emaOk)          { rsiPts = 3;  rsiNote = `RSI ${rsiSignal.rsi} — above/below EMA signal line` }
    else                      { rsiNote = `RSI ${rsiSignal.rsi} — not aligned with ${signal}` }
  }
  add('RSI Signal', rsiPts, 12, rsiNote)

  // 4. ADX trend strength 0-13
  let adxPts = 0, adxNote = 'No ADX data'
  if (adxSignal) {
    const { adx, adxRising, plusDI, minusDI } = adxSignal
    const diOk = isCall ? plusDI > minusDI : minusDI > plusDI
    if      (adx >= 25 && diOk && adxRising) { adxPts = 13; adxNote = `ADX ${adx.toFixed(0)} rising — strong trend aligned` }
    else if (adx >= 21 && diOk)              { adxPts = 9;  adxNote = `ADX ${adx.toFixed(0)} — trend aligned` }
    else if (adx >= 15 && diOk)              { adxPts = 5;  adxNote = `ADX ${adx.toFixed(0)} — moderate trend` }
    else if (adx >= 10)                      { adxPts = 2;  adxNote = `ADX ${adx.toFixed(0)} — weak trend` }
    else                                      { adxNote = `ADX ${adx?.toFixed(0) ?? '—'} — no trend` }
  }
  add('Trend Strength', adxPts, 13, adxNote)

  // 5. MA Stack 0-10
  let maPts = 0, maNote = 'No MA stack data'
  if (maStack) {
    const maOk = isCall ? maStack.signal === 'BULLISH' : maStack.signal === 'BEARISH'
    const abv30 = isCall ? maStack.above30 === true : maStack.above30 === false
    const aligned = isCall ? (maStack.bullCount ?? 0) : (maStack.bearCount ?? 0)
    if (maOk && aligned >= 4)      { maPts = 10; maNote = `MA stack ${maStack.signal} — ${aligned}/5 EMAs aligned` }
    else if (maOk && abv30)        { maPts = 7;  maNote = `MA stack ${maStack.signal} — above 30 EMA midfield` }
    else if (maOk)                 { maPts = 4;  maNote = `MA stack ${maStack.signal}` }
    else if (abv30)                { maPts = 2;  maNote = 'Price at 30 EMA — mixed stack' }
    else                            { maNote = `MA stack ${maStack.signal ?? 'unknown'} — not aligned` }
  }
  add('MA Stack', maPts, 10, maNote)

  // 6. Setup grade 0-12
  const grade     = setupGrade?.grade
  const gradePts  = { 'A+': 12, 'A': 9, 'B': 6, 'C': 3 }[grade] ?? 0
  add('Setup Grade', gradePts, 12, grade ? `Grade ${grade} (${setupGrade.pct}% checks passing)` : 'No grade yet')

  // 7. IV conditions 0-8 (cheap IV is good for buyers)
  let ivPts = 4, ivNote = 'IV rank unknown — neutral'
  if (ivData?.ivRank != null) {
    const r = ivData.ivRank
    ivPts  = r < 25 ? 8 : r < 40 ? 6 : r < 55 ? 4 : r < 70 ? 2 : 0
    ivNote = `IV rank ${Math.round(r)} — ${r < 40 ? 'cheap/moderate, good to buy' : r < 70 ? 'elevated, size down' : 'expensive, spread preferred'}`
  }
  add('IV Conditions', ivPts, 8, ivNote)

  // 8. Volume spike 0-5
  let volPts = 0, volNote = 'No volume data'
  if (volumeSpike != null) {
    if      (volumeSpike.spike)      { volPts = 5; volNote = `${volumeSpike.ratio}× volume spike — institutional conviction` }
    else if (volumeSpike.ratio >= 1) { volPts = 3; volNote = `${volumeSpike.ratio}× vol — above average` }
    else if (volumeSpike.lowVolume)  { volPts = 0; volNote = `Low volume (${volumeSpike.ratio}×) — weak participation` }
    else                              { volPts = 2; volNote = `Vol ${volumeSpike.ratio}× — normal` }
  }
  add('Volume', volPts, 5, volNote)

  // 9. Sector RS 0-5
  let sectorPts = 0, sectorNote = 'No sector data'
  if (sectorRS) {
    const bull = ['BULL', 'STRONG BULL']
    const bear = ['BEAR', 'STRONG BEAR']
    const stockOk  = isCall ? bull.includes(sectorRS.stockVsSector?.signal) : bear.includes(sectorRS.stockVsSector?.signal)
    const sectorOk = isCall ? bull.includes(sectorRS.sectorVsSpy?.signal)   : bear.includes(sectorRS.sectorVsSpy?.signal)
    sectorPts = stockOk && sectorOk ? 5 : stockOk || sectorOk ? 3 : 0
    sectorNote = `Stock vs sector: ${sectorRS.stockVsSector?.signal ?? '—'} · Sector vs SPY: ${sectorRS.sectorVsSpy?.signal ?? '—'}`
  }
  add('Sector RS', sectorPts, 5, sectorNote)

  // 10. Insider flow 0-5
  let insiderPts = 0, insiderNote = 'No insider data'
  if (insiderData?.total90d > 0) {
    const verdict = insiderData.sentiment?.verdict
    const bullish = verdict === 'BULLISH' || verdict === 'LEAN BULLISH'
    const bearish = verdict === 'BEARISH'
    if      (isCall  && bullish) { insiderPts = 5; insiderNote = `${insiderData.total90d} insider transactions, net buying (90d)` }
    else if (!isCall && bearish) { insiderPts = 5; insiderNote = `Net insider selling (90d)` }
    else                          { insiderPts = 2; insiderNote = `${insiderData.total90d} transactions — ${verdict?.toLowerCase() ?? 'mixed'} flow` }
  }
  add('Insider Flow', insiderPts, 5, insiderNote)

  // 11. Squeeze risk / fuel — can add or subtract points
  // CALL + squeeze: short covering adds rocket fuel (bonus)
  // PUT  + squeeze: forced covering fights the thesis (penalty)
  // PUT  + very high short% but no squeeze yet: mild negative (crowded bear)
  let squeezePts = 0, squeezeNote = 'No short interest data'
  if (shortInterest) {
    const pct     = shortInterest.shortPct ?? 0
    const dtc     = shortInterest.daysToCover ?? 0
    const squeeze = shortInterest.squeeze   // bool: pct>=10% && dtc>=3
    const momRising = (shortInterest.mom ?? 0) > 0.05  // shorts increasing >5% MoM

    if (isCall && squeeze) {
      squeezePts = 8
      squeezeNote = `${(pct*100).toFixed(1)}% short float · ${dtc.toFixed(1)}d to cover — short covering adds upside fuel`
    } else if (isCall && pct >= 0.05) {
      squeezePts = 3
      squeezeNote = `${(pct*100).toFixed(1)}% short float — moderate short interest, some covering possible`
    } else if (isCall) {
      squeezePts = 1
      squeezeNote = `Low short interest — no squeeze fuel, but no short-side headwind either`
    } else if (!isCall && squeeze) {
      // PUT + squeeze = serious risk — forced covering could blow out the trade
      squeezePts = -8
      squeezeNote = `⚠ SQUEEZE RISK: ${(pct*100).toFixed(1)}% float short · ${dtc.toFixed(1)}d to cover — shorts could be forced to cover against your put`
    } else if (!isCall && pct >= 0.20) {
      // Very high short% without imminent squeeze = crowded bear (neutral to slight positive for puts)
      squeezePts = momRising ? 3 : 1
      squeezeNote = `${(pct*100).toFixed(1)}% float short — crowded bear trade${momRising ? ', shorts still adding' : ''}`
    } else if (!isCall && pct >= 0.10) {
      squeezePts = -3
      squeezeNote = `${(pct*100).toFixed(1)}% float short · ${dtc.toFixed(1)}d to cover — elevated short interest, squeeze risk present`
    } else if (!isCall) {
      squeezePts = 0
      squeezeNote = `Low short interest — no squeeze risk, put trade structurally clean`
    }
  }
  // Cap so squeeze bonus can't push past 100, and penalty is floored at what it is
  add('Squeeze Risk', squeezePts, 8, squeezeNote)

  // 12. Wyckoff structural alignment -8 to +10
  let wyckoffPts = 0, wyckoffNote = 'No Wyckoff data'
  if (wyckoff?.signal) {
    const wSig = wyckoff.signal   // 'BULLISH' | 'BEARISH' | 'NEUTRAL'
    const phase = wyckoff.phase   // 'MARKUP' | 'MARKDOWN' | 'ACCUMULATION' | 'DISTRIBUTION' | 'SPRING' | 'UTAD' | 'RANGING'
    const structureAligns   = (isCall && wSig === 'BULLISH') || (!isCall && wSig === 'BEARISH')
    const structureConflicts = (isCall && wSig === 'BEARISH') || (!isCall && wSig === 'BULLISH')

    if (structureAligns) {
      wyckoffPts  = phase === 'MARKUP'      ? 10
                  : phase === 'SPRING'      ? 10
                  : phase === 'ACCUMULATION'? 8
                  : phase === 'DISTRIBUTION'? 8  // distribution PUT aligns
                  : phase === 'MARKDOWN'    ? 10
                  : phase === 'UTAD'        ? 10
                  : 5
      wyckoffNote = `${phase} phase aligns — structural ${wSig.toLowerCase()} confirms ${signal} direction`
    } else if (structureConflicts) {
      wyckoffPts  = phase === 'MARKDOWN' || phase === 'DISTRIBUTION' || phase === 'UTAD' ? -8
                  : phase === 'MARKUP'   || phase === 'SPRING'       || phase === 'ACCUMULATION' ? -8
                  : -4
      wyckoffNote = `⚠ ${phase} vs ${signal} — structural conflict: counter-trend trade, reduce size and require all gates open`
    } else {
      wyckoffPts  = 2
      wyckoffNote = `Wyckoff ${phase} — neutral/ranging structure, no directional confirmation`
    }
  }
  add('Wyckoff Structure', wyckoffPts, 10, wyckoffNote)

  const score = Math.min(100, Math.max(0, total))

  let label, color, bg, border
  if      (score >= 78) { label = 'Strong';     color = '#10b981'; bg = '#001a0d'; border = '#065f46' }
  else if (score >= 60) { label = 'Confirmed';  color = '#34d399'; bg = '#012410'; border = '#047857' }
  else if (score >= 42) { label = 'Developing'; color = '#f59e0b'; bg = '#1a0f00'; border = '#92400e' }
  else if (score >= 20) { label = 'Weak';       color = '#6b7280'; bg = '#0f1623'; border = '#1e2d45' }
  else                  { label = 'No Signal';  color = '#374151'; bg = '#0a0f1a'; border = '#111827' }

  return { score, label, color, bg, border, direction: signal, breakdown }
}
