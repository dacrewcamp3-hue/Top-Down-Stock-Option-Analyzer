import { useState, useMemo } from 'react'

// Historical data — VIX estimates by year and annual return
const HIST = [
  { year: 2000, vix: 23, ret: -9.1,  note: 'Dot-com peak — elevated VIX, distribution' },
  { year: 2001, vix: 26, ret: -11.9, note: 'Post-9/11 uncertainty, elevated fear' },
  { year: 2002, vix: 32, ret: -22.1, note: 'Bear market bottom, panic selling' },
  { year: 2003, vix: 22, ret: 28.7,  note: 'Recovery year — VIX falling from extremes' },
  { year: 2007, vix: 18, ret: 5.5,   note: 'Late bull, complacency before GFC' },
  { year: 2008, vix: 40, ret: -37.0, note: 'GFC crisis — extreme fear regime' },
  { year: 2009, vix: 31, ret: 26.5,  note: 'Recovery from bottom — high VIX declining' },
  { year: 2010, vix: 23, ret: 15.1,  note: 'Post-GFC normalization' },
  { year: 2011, vix: 28, ret: 2.1,   note: 'Debt ceiling crisis — elevated VIX, choppy' },
  { year: 2012, vix: 18, ret: 16.0,  note: 'Recovery — VIX calming, trending up' },
  { year: 2015, vix: 21, ret: 1.4,   note: 'China scare — elevated vol, range bound' },
  { year: 2016, vix: 16, ret: 12.0,  note: 'Election year recovery' },
  { year: 2018, vix: 22, ret: -4.4,  note: 'Rate hike fear — vol spike in Q4' },
  { year: 2019, vix: 15, ret: 31.5,  note: 'Low VIX bull year — optimal conditions' },
  { year: 2020, vix: 35, ret: 18.4,  note: 'COVID crash then recovery — extreme range' },
  { year: 2021, vix: 19, ret: 28.7,  note: 'Stimulus bull — low VIX, strong trend' },
  { year: 2022, vix: 28, ret: -18.1, note: 'Rate hike bear — sustained high VIX' },
  { year: 2023, vix: 17, ret: 26.3,  note: 'VIX collapsed — AI bull market began' },
  { year: 2024, vix: 16, ret: 25.0,  note: 'Continued AI bull, low VIX' },
  { year: 2025, vix: 22, ret: -1.5,  note: 'Tariff shock — Liberation Day -18% drawdown, recovered by summer (partial-year est.)' },
  { year: 2026, vix: 19, ret:  6.0,  note: 'Post-tariff recovery — AI growth resumes, VIX normalizing · ESTIMATED (year in progress)', est: true },
]

// S&P 500 avg monthly return (%) — 30-year historical average through 2026
const MON_AVGS = [-0.1, 1.1, 0.8, 1.5, 0.3, 0.6, 1.4, 0.0, -0.7, 1.0, 1.7, 1.5]

export default function InsightCenter({
  ticker, breadthData, vixData, tfAlignment, flowSentiment,
  optionsChain, dailyBars, spyDailyBars, confluenceResult,
  earningsDate, masterSignal,
}) {
  const [activeSection, setActiveSection] = useState('evidence')
  // 'evidence' | 'brief' | 'memory' | 'distribution' | 'audit'

  const [brief,       setBrief]       = useState(null)   // { text, loading, error }
  const [devil,       setDevil]       = useState(null)   // { text, loading, error }
  const [auditLog,    setAuditLog]    = useState(() => {
    try { return JSON.parse(localStorage.getItem('insight-audit') ?? '[]') } catch { return [] }
  })
  const [auditNote,   setAuditNote]   = useState('')
  const [auditDirection, setAuditDirection] = useState('BULLISH')

  // ── A. Weight of Evidence (10 independent signals) ──────────────────────────
  const evidence = useMemo(() => {
    const signals = []

    // 1. Market Regime
    const v = breadthData?.verdict
    signals.push({
      name: 'Market Regime',
      vote: v === 'FAVORABLE' || v === 'LEANING BULLISH' ? 'bull'
          : v === 'HOSTILE'   || v === 'LEANING BEARISH' ? 'bear' : 'neutral',
      detail: v ?? 'No data',
      weight: 2,
    })

    // 2. VIX / Fear
    const vix = vixData?.current ?? breadthData?.vix?.current ?? 0
    signals.push({
      name: 'VIX / Fear',
      vote: vix < 18 ? 'bull' : vix > 26 ? 'bear' : 'neutral',
      detail: vix ? `${vix.toFixed(1)}` : 'No data',
      weight: 1,
    })

    // 3. TRIN (Arms Index)
    const trin = breadthData?.trin?.value ?? null
    signals.push({
      name: 'TRIN',
      vote: trin != null ? (trin < 0.85 ? 'bull' : trin > 1.5 ? 'bear' : 'neutral') : 'neutral',
      detail: trin != null ? trin.toFixed(2) : 'No data',
      weight: 1,
    })

    // 4. NYSE Advance-Decline
    const nyadTrend = breadthData?.nyad?.trend
    signals.push({
      name: 'NYSE A/D',
      vote: nyadTrend === 'rising' ? 'bull' : nyadTrend === 'falling' ? 'bear' : 'neutral',
      detail: nyadTrend ?? 'No data',
      weight: 1,
    })

    // 5. New Highs vs Lows
    const highs = breadthData?.hl?.highs ?? 0, lows = breadthData?.hl?.lows ?? 0
    signals.push({
      name: 'Highs / Lows',
      vote: highs > lows * 1.5 ? 'bull' : lows > highs * 1.5 ? 'bear' : 'neutral',
      detail: highs || lows ? `${highs}H / ${lows}L` : 'No data',
      weight: 1,
    })

    // 6. MTF EMA Alignment
    const tfVals = ['W','D','4H','1H','15M'].map(k => tfAlignment?.[k]).filter(Boolean)
    const bullTFs = tfVals.filter(t => t.label === 'BULL').length
    const bearTFs = tfVals.filter(t => t.label === 'BEAR').length
    signals.push({
      name: 'MTF Alignment',
      vote: bullTFs >= 4 ? 'bull' : bearTFs >= 4 ? 'bear' : bullTFs > bearTFs ? 'bull' : bearTFs > bullTFs ? 'bear' : 'neutral',
      detail: tfVals.length ? `${bullTFs}↑ ${bearTFs}↓ ${tfVals.length - bullTFs - bearTFs}—` : 'No data',
      weight: 1,
    })

    // 7. Options Flow Sentiment
    const flow = flowSentiment
    const flowVote = (() => {
      if (!flow) return 'neutral'
      const total = (flow.callPrem ?? 0) + (flow.putPrem ?? 0)
      if (total < 10000) return 'neutral'
      const r = (flow.callPrem ?? 0) / total
      return r > 0.58 ? 'bull' : r < 0.42 ? 'bear' : 'neutral'
    })()
    const callR = flow ? ((flow.callPrem ?? 0) / Math.max(1, (flow.callPrem ?? 0) + (flow.putPrem ?? 0)) * 100).toFixed(0) : null
    signals.push({
      name: 'Options Flow',
      vote: flowVote,
      detail: callR ? `CALL ${callR}%` : 'No data',
      weight: 1,
    })

    // 8. Gamma Positioning
    const gf = optionsChain?.gammaFlip
    const cp = dailyBars?.closes?.filter(v => v != null).at(-1)
    signals.push({
      name: 'Gamma Regime',
      vote: gf && cp ? (cp > gf ? 'bull' : 'bear') : 'neutral',
      detail: gf && cp ? (cp > gf ? `Above γFlip $${gf}` : `Below γFlip $${gf}`) : 'No data',
      weight: 1,
    })

    // 9. Seasonality
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const curMon = new Date().getMonth()
    const monAvg = MON_AVGS[curMon]
    signals.push({
      name: 'Seasonality',
      vote: monAvg > 0.8 ? 'bull' : monAvg < -0.2 ? 'bear' : 'neutral',
      detail: `${monthNames[curMon]}: avg ${monAvg >= 0 ? '+' : ''}${monAvg}%`,
      weight: 1,
    })

    // 10. Confluence Signal Score
    const sig = confluenceResult?.signal
    signals.push({
      name: 'Setup Score',
      vote: sig === 'CALL' ? 'bull' : sig === 'PUT' ? 'bear' : 'neutral',
      detail: sig ?? 'No data',
      weight: 1,
    })

    // Tally weighted votes
    let bullW = 0, bearW = 0, neutW = 0, totalW = 0
    for (const s of signals) {
      totalW += s.weight
      if (s.vote === 'bull')    bullW += s.weight
      else if (s.vote === 'bear') bearW += s.weight
      else                        neutW += s.weight
    }

    const dominant = bullW > bearW ? 'BULLISH' : bearW > bullW ? 'BEARISH' : 'MIXED'
    const dominantCol = dominant === 'BULLISH' ? '#10b981' : dominant === 'BEARISH' ? '#ef4444' : '#f59e0b'
    const strength = Math.round(Math.max(bullW, bearW) / totalW * 100)

    return { signals, bullW, bearW, neutW, totalW, dominant, dominantCol, strength }
  }, [breadthData, vixData, tfAlignment, flowSentiment, optionsChain, dailyBars, confluenceResult])

  // ── B. Regime Memory ──────────────────────────────────────────────────────────
  const regimeMemory = useMemo(() => {
    const curVix  = vixData?.current ?? breadthData?.vix?.current ?? 20
    const isBull  = evidence.dominant === 'BULLISH'
    const isBear  = evidence.dominant === 'BEARISH'

    const analogs = HIST.filter(h => {
      const vixSim = Math.abs(h.vix - curVix) < 8
      const dirSim = isBull ? h.ret > 5 : isBear ? h.ret < -3 : true
      return vixSim && dirSim
    }).sort((a, b) => Math.abs(a.vix - curVix) - Math.abs(b.vix - curVix)).slice(0, 4)

    const avgReturn = analogs.length
      ? (analogs.reduce((s, a) => s + a.ret, 0) / analogs.length).toFixed(1)
      : null
    const posYears  = analogs.filter(a => a.ret > 0).length
    const negYears  = analogs.filter(a => a.ret < 0).length

    return { analogs, avgReturn, posYears, negYears, curVix }
  }, [vixData, breadthData, evidence.dominant])

  // ── C. Outcome Distribution ───────────────────────────────────────────────────
  const outcomeDist = useMemo(() => {
    const curMon = new Date().getMonth() + 1
    const isQ4   = curMon >= 10
    const isQ1   = curMon <= 3
    const isSep  = curMon === 9

    const curVix = vixData?.current ?? breadthData?.vix?.current ?? 20
    const regime = curVix > 28 ? 'high_vix' : curVix > 20 ? 'mid_vix' : 'low_vix'

    const DIST = {
      low_vix:  { down10: 3,  down5: 8,  flat: 22, up5: 42, up10: 25, medianRet: 1.8 },
      mid_vix:  { down10: 8,  down5: 18, flat: 25, up5: 30, up10: 19, medianRet: 0.6 },
      high_vix: { down10: 18, down5: 22, flat: 20, up5: 25, up10: 15, medianRet: -0.4 },
    }

    const dist = DIST[regime]
    const buckets = [
      { label: '< −10%',       pct: dist.down10, col: '#7f1d1d' },
      { label: '−5 to −10%',   pct: dist.down5,  col: '#ef4444' },
      { label: '−5 to +5%',    pct: dist.flat,   col: '#f59e0b' },
      { label: '+5 to +10%',   pct: dist.up5,    col: '#10b981' },
      { label: '> +10%',       pct: dist.up10,   col: '#065f46' },
    ]

    return { regime, buckets, medianRet: dist.medianRet, curVix, isSep, isQ4, isQ1 }
  }, [vixData, breadthData])

  // ── Context builder for AI API calls ─────────────────────────────────────────
  const buildContext = () => {
    const vix = vixData?.current ?? breadthData?.vix?.current
    const trin = breadthData?.trin?.value
    const cp = dailyBars?.closes?.filter(v => v != null).at(-1)
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const curMon = new Date().getMonth()

    const total = (flowSentiment?.callPrem ?? 0) + (flowSentiment?.putPrem ?? 0)
    const callRatio = total > 0 ? (flowSentiment?.callPrem ?? 0) / total : null
    const flowBias  = callRatio != null
      ? callRatio > 0.58 ? `CALL-heavy (${Math.round(callRatio*100)}% calls)`
      : callRatio < 0.42 ? `PUT-heavy (${Math.round((1-callRatio)*100)}% puts)` : 'Neutral'
      : 'No data'

    const gf  = optionsChain?.gammaFlip
    const gammaRegime = gf && cp ? (cp > gf ? 'Positive (price above gamma flip)' : 'Negative (price below gamma flip)') : 'Unknown'

    const earningsIn = earningsDate
      ? `${Math.round((earningsDate - Date.now()) / 86400000)} days`
      : 'Unknown'

    return {
      ticker: ticker ?? 'N/A',
      verdict: breadthData?.verdict ?? 'UNKNOWN',
      vix: vix?.toFixed(1) ?? 'N/A',
      trin: trin?.toFixed(2) ?? 'N/A',
      nyadTrend: breadthData?.nyad?.trend ?? 'unknown',
      highs: breadthData?.hl?.highs ?? 0,
      lows:  breadthData?.hl?.lows  ?? 0,
      tfW:   tfAlignment?.W?.label  ?? '?',
      tfD:   tfAlignment?.D?.label  ?? '?',
      tf4H:  tfAlignment?.['4H']?.label ?? '?',
      tf1H:  tfAlignment?.['1H']?.label ?? '?',
      tf15M: tfAlignment?.['15M']?.label ?? '?',
      chartTrend: confluenceResult?.signal ?? 'N/A',
      flowBias,
      gammaRegime,
      gammaFlip: gf ?? 'N/A',
      currentPrice: cp?.toFixed(2) ?? 'N/A',
      callWall: optionsChain?.callWall ?? 'N/A',
      putWall:  optionsChain?.putWall  ?? 'N/A',
      maxPain:  optionsChain?.maxPain  ?? 'N/A',
      rsiDiv:   'Check RSI panel',
      monthAvg: `${MON_AVGS[curMon] >= 0 ? '+' : ''}${MON_AVGS[curMon]}%`,
      monthName: monthNames[curMon],
      earningsIn,
      evidenceScore: `${evidence.bullW}B / ${evidence.bearW}Br / ${evidence.neutW}N (${evidence.dominant})`,
      dominantThesis: evidence.dominant.toLowerCase(),
    }
  }

  // ── API call functions ────────────────────────────────────────────────────────
  const generateBrief = async () => {
    setBrief({ loading: true, text: null, error: null })
    try {
      const r = await fetch('/ai-api?mode=brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildContext()),
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setBrief({ loading: false, text: j.text, error: null })
    } catch (e) {
      setBrief({ loading: false, text: null, error: e.message })
    }
  }

  const generateDevil = async () => {
    setDevil({ loading: true, text: null, error: null })
    try {
      const r = await fetch('/ai-api?mode=devil', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildContext()),
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setDevil({ loading: false, text: j.text, error: null })
    } catch (e) {
      setDevil({ loading: false, text: null, error: e.message })
    }
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────
  const saveAuditEntry = () => {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      ticker: ticker ?? 'N/A',
      direction: auditDirection,
      regime: breadthData?.verdict ?? 'UNKNOWN',
      vix: (vixData?.current ?? breadthData?.vix?.current ?? 0).toFixed(1),
      evidenceScore: `${evidence.bullW}/${evidence.totalW}`,
      dominant: evidence.dominant,
      strength: evidence.strength,
      note: auditNote,
      brief: brief?.text ?? null,
    }
    const updated = [entry, ...auditLog].slice(0, 50)
    setAuditLog(updated)
    setAuditNote('')
    try { localStorage.setItem('insight-audit', JSON.stringify(updated)) } catch {}
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#020609', color: '#e2e8f0' }}>
      {/* Section nav */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #0a1820',
        background: '#020609', overflowX: 'auto',
      }}>
        {[
          { id: 'evidence',     label: 'Weight of Evidence' },
          { id: 'brief',        label: 'AI Analysis'        },
          { id: 'memory',       label: 'Regime Memory'      },
          { id: 'distribution', label: 'Outcome Range'      },
          { id: 'audit',        label: 'Decision Log'       },
        ].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            style={{
              padding: '10px 18px', fontSize: 11, fontWeight: 700,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: activeSection === s.id ? '#e2e8f0' : '#2a4060',
              borderBottom: activeSection === s.id ? '2px solid #60a5fa' : '2px solid transparent',
              letterSpacing: '0.3px', whiteSpace: 'nowrap',
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── SECTION 1: Weight of Evidence ── */}
      {activeSection === 'evidence' && (
        <div>
              {/* ── Master Signal resolver summary ── */}
              {masterSignal && (
                <div style={{
                  background: masterSignal.blocked ? '#0e0101'
                    : masterSignal.direction === 'CALL' ? '#010e07'
                    : masterSignal.direction === 'PUT'  ? '#0e0101'
                    : '#060d18',
                  border: `1px solid ${
                    masterSignal.blocked ? '#7f1d1d'
                    : masterSignal.direction === 'CALL' ? '#065f46'
                    : masterSignal.direction === 'PUT'  ? '#7f1d1d'
                    : '#0e1e30'
                  }`,
                  borderRadius: 10, padding: '12px 16px', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: '#2a4060', marginBottom: 8, textTransform: 'uppercase' }}>
                    Signal Resolver — Authoritative Direction
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div style={{ fontSize: 20, fontWeight: 900,
                      color: masterSignal.blocked ? '#ef4444'
                        : masterSignal.direction === 'CALL' ? '#10b981'
                        : masterSignal.direction === 'PUT'  ? '#ef4444'
                        : '#4a6a8a'
                    }}>
                      {masterSignal.blocked ? 'BLOCKED' : masterSignal.direction ?? 'NO TRADE'}
                    </div>
                    {!masterSignal.blocked && masterSignal.direction && (
                      <div style={{
                        fontSize: 11, fontWeight: 800,
                        color: masterSignal.confidence >= 70 ? '#10b981'
                             : masterSignal.confidence >= 45 ? '#f59e0b' : '#ef4444',
                        background: masterSignal.confidence >= 70 ? '#010e07'
                             : masterSignal.confidence >= 45 ? '#080600' : '#0e0101',
                        border: `1px solid ${masterSignal.confidence >= 70 ? '#065f46'
                             : masterSignal.confidence >= 45 ? '#4d3000' : '#7f1d1d'}`,
                        borderRadius: 5, padding: '3px 9px',
                      }}>
                        {masterSignal.confidence}/100 confidence
                      </div>
                    )}
                    {masterSignal.tfScore != null && masterSignal.direction && (
                      <div style={{ fontSize: 10, color: '#4a6a8a' }}>
                        {masterSignal.tfScore}/4 TFs aligned
                      </div>
                    )}
                  </div>
                  {masterSignal.blockReason && (
                    <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 6 }}>
                      {masterSignal.blockReason}
                    </div>
                  )}
                  {masterSignal.conflicts?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {masterSignal.conflicts.map((c, i) => (
                        <div key={i} style={{ fontSize: 10, color: '#b0a070' }}>· {c}</div>
                      ))}
                    </div>
                  )}
                  {!masterSignal.blocked && !masterSignal.conflicts?.length && masterSignal.direction && (
                    <div style={{ fontSize: 10, color: '#10b981' }}>
                      ✓ No conflicts detected — all systems aligned
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: '#1a3050', marginTop: 8 }}>
                    Sigma: {masterSignal.sigmaLabel}
                    {masterSignal.sigmaSource === 'estimated' && (
                      <span style={{ color: '#f59e0b', marginLeft: 6 }}>⚠ estimated — live IV unavailable</span>
                    )}
                  </div>
                </div>
              )}
          {/* Dominant verdict banner */}
          <div style={{ padding: '16px', background: '#020609', borderBottom: '1px solid #0a1820' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>WEIGHT OF EVIDENCE</div>
                <div style={{ fontSize: 22, color: evidence.dominantCol, fontWeight: 900 }}>
                  {evidence.dominant}
                </div>
                <div style={{ fontSize: 10, color: '#4a6a8a' }}>
                  {evidence.bullW} bull · {evidence.bearW} bear · {evidence.neutW} neutral
                  {' '}({evidence.strength}% weight aligned)
                </div>
              </div>
              {/* Strength bar */}
              <div style={{ flex: 1, minWidth: 200, maxWidth: 400 }}>
                <div style={{ height: 8, background: '#0a1820', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${evidence.bullW / evidence.totalW * 100}%`, background: '#10b981', transition: 'width 0.4s' }} />
                  <div style={{ width: `${evidence.neutW / evidence.totalW * 100}%`, background: '#1e3456' }} />
                  <div style={{ width: `${evidence.bearW / evidence.totalW * 100}%`, background: '#ef4444' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 8, color: '#10b981' }}>BULL {Math.round(evidence.bullW/evidence.totalW*100)}%</span>
                  <span style={{ fontSize: 8, color: '#ef4444' }}>BEAR {Math.round(evidence.bearW/evidence.totalW*100)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Signal grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 8, padding: 16,
          }}>
            {evidence.signals.map((sig, i) => {
              const col = sig.vote === 'bull' ? '#10b981' : sig.vote === 'bear' ? '#ef4444' : '#f59e0b'
              const bg  = sig.vote === 'bull' ? '#010e07' : sig.vote === 'bear' ? '#0e0101' : '#080600'
              const icon = sig.vote === 'bull' ? '▲' : sig.vote === 'bear' ? '▼' : '◐'
              return (
                <div key={i} style={{
                  background: bg, border: `1px solid ${col}22`,
                  borderRadius: 8, padding: '10px 12px',
                  borderLeft: `3px solid ${col}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 9, color: '#4a6a8a', fontWeight: 700 }}>{sig.name}</span>
                    <span style={{ fontSize: 11, color: col, fontWeight: 900 }}>{icon}</span>
                  </div>
                  <div style={{ fontSize: 12, color: col, fontWeight: 800 }}>{sig.detail}</div>
                  {sig.weight > 1 && (
                    <div style={{ fontSize: 8, color: '#2a4060', marginTop: 3 }}>2x weight</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── SECTION 2: AI Analysis ── */}
      {activeSection === 'brief' && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* API key notice */}
          <div style={{
            padding: '8px 12px', background: '#060d18',
            border: '1px solid #0e1e30', borderRadius: 6,
            fontSize: 10, color: '#2a4060',
          }}>
            Requires <code style={{ color: '#60a5fa' }}>ANTHROPIC_API_KEY</code> in your environment.
            Add it to <code>.env.local</code> for local dev or in your Vercel project settings for production.
          </div>

          {/* Two-column: Brief + Devil */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* AI Brief */}
            <div style={{ background: '#030f09', border: '1px solid #065f46', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>AI PRE-DECISION BRIEF</div>
                  <div style={{ fontSize: 11, color: '#4a6a8a', marginTop: 2 }}>
                    Synthesizes all signals into a plain-English narrative
                  </div>
                </div>
                <button
                  onClick={generateBrief}
                  disabled={brief?.loading}
                  style={{
                    background: brief?.loading ? '#0a1820' : '#065f46',
                    border: 'none', borderRadius: 6, padding: '6px 14px',
                    color: brief?.loading ? '#2a4060' : '#10b981',
                    fontSize: 11, fontWeight: 800, cursor: brief?.loading ? 'wait' : 'pointer',
                  }}>
                  {brief?.loading ? 'Analyzing...' : brief?.text ? 'Refresh' : 'Generate Brief'}
                </button>
              </div>
              {brief?.error ? (
                <div style={{ fontSize: 11, color: '#ef4444', fontStyle: 'italic' }}>
                  {brief.error.includes('not configured')
                    ? 'Add ANTHROPIC_API_KEY to enable this feature.'
                    : `Error: ${brief.error}`}
                </div>
              ) : brief?.text ? (
                <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.75 }}>
                  {brief.text}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: '#1a3050', fontStyle: 'italic' }}>
                  Click Generate Brief to get a plain-English synthesis of all current signals.
                </div>
              )}
            </div>

            {/* Devil's Advocate */}
            <div style={{ background: '#0f0101', border: '1px solid #7f1d1d', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700 }}>DEVIL'S ADVOCATE</div>
                  <div style={{ fontSize: 11, color: '#4a6a8a', marginTop: 2 }}>
                    Strongest counter-argument to the dominant thesis
                  </div>
                </div>
                <button
                  onClick={generateDevil}
                  disabled={devil?.loading}
                  style={{
                    background: devil?.loading ? '#0a1820' : '#7f1d1d',
                    border: 'none', borderRadius: 6, padding: '6px 14px',
                    color: devil?.loading ? '#2a4060' : '#ef4444',
                    fontSize: 11, fontWeight: 800, cursor: devil?.loading ? 'wait' : 'pointer',
                  }}>
                  {devil?.loading ? 'Thinking...' : devil?.text ? 'Refresh' : 'Challenge Thesis'}
                </button>
              </div>
              {devil?.error ? (
                <div style={{ fontSize: 11, color: '#ef4444', fontStyle: 'italic' }}>
                  {devil.error.includes('not configured')
                    ? 'Add ANTHROPIC_API_KEY to enable this feature.'
                    : `Error: ${devil.error}`}
                </div>
              ) : devil?.text ? (
                <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.75 }}>
                  {devil.text}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: '#1a3050', fontStyle: 'italic' }}>
                  Click Challenge Thesis to stress-test the current bullish or bearish case.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 3: Regime Memory ── */}
      {activeSection === 'memory' && (
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>HISTORICAL ANALOGS</div>
            <div style={{ fontSize: 11, color: '#4a6a8a' }}>
              Years where VIX was within 8 points of current {regimeMemory.curVix.toFixed(1)} and market direction was similar.
            </div>
          </div>

          {regimeMemory.analogs.length === 0 ? (
            <div style={{ fontSize: 11, color: '#1a3050' }}>No close analogs found in historical data.</div>
          ) : (
            <>
              {/* Summary */}
              <div style={{
                display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap',
                padding: '10px 14px', background: '#060d18', borderRadius: 8,
                border: '1px solid #0e1e30',
              }}>
                <div>
                  <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>AVG ANNUAL RETURN</div>
                  <div style={{
                    fontSize: 18, fontWeight: 900,
                    color: parseFloat(regimeMemory.avgReturn) >= 0 ? '#10b981' : '#ef4444'
                  }}>
                    {parseFloat(regimeMemory.avgReturn) >= 0 ? '+' : ''}{regimeMemory.avgReturn}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>OUTCOME SPLIT</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>
                    <span style={{ color: '#10b981' }}>{regimeMemory.posYears} up</span>
                    {' / '}
                    <span style={{ color: '#ef4444' }}>{regimeMemory.negYears} down</span>
                  </div>
                </div>
                <div style={{ maxWidth: 400 }}>
                  <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>PATTERN</div>
                  <div style={{ fontSize: 10, color: '#4a6a8a', lineHeight: 1.5 }}>
                    {regimeMemory.posYears > regimeMemory.negYears
                      ? 'Similar conditions have historically resolved bullishly more often than not.'
                      : regimeMemory.negYears > regimeMemory.posYears
                      ? 'Similar conditions have historically resolved bearishly more often than not.'
                      : 'Mixed historical outcomes — no strong directional bias from analogs.'}
                  </div>
                </div>
              </div>

              {/* Analog rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {regimeMemory.analogs.map(a => (
                  <div key={a.year} style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '10px 14px', borderRadius: 8,
                    background: a.ret >= 0 ? '#010e07' : '#0e0101',
                    border: `1px solid ${a.ret >= 0 ? '#065f46' : '#7f1d1d'}`,
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#e2e8f0', width: 44 }}>
                      {a.year}
                      {a.est && <span style={{ fontSize: 8, fontWeight: 700, color: '#f59e0b', display: 'block', marginTop: 1 }}>EST</span>}
                    </div>
                    <div style={{ width: 70 }}>
                      <div style={{ fontSize: 8, color: '#2a4060' }}>VIX</div>
                      <div style={{ fontSize: 13, color: '#60a5fa', fontWeight: 800 }}>{a.vix}</div>
                    </div>
                    <div style={{ width: 80 }}>
                      <div style={{ fontSize: 8, color: '#2a4060' }}>{a.est ? 'YTD RET EST' : 'ANNUAL RET'}</div>
                      <div style={{
                        fontSize: 14, fontWeight: 900,
                        color: a.ret >= 0 ? '#10b981' : '#ef4444'
                      }}>
                        {a.ret >= 0 ? '+' : ''}{a.ret}%
                      </div>
                    </div>
                    <div style={{ flex: 1, fontSize: 11, color: '#4a6a8a' }}>{a.note}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SECTION 4: Outcome Distribution ── */}
      {activeSection === 'distribution' && (
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 4 }}>
              PROBABILITY-WEIGHTED OUTCOME RANGE · NEXT 20 TRADING DAYS · SPX BASE RATES ONLY
            </div>
            <div style={{ fontSize: 11, color: '#4a6a8a' }}>
              Based on historical <strong style={{ color: '#60a5fa' }}>S&P 500</strong> returns when VIX was in the {
                outcomeDist.regime === 'high_vix' ? 'elevated (>28)' :
                outcomeDist.regime === 'mid_vix'  ? 'moderate (20-28)' : 'low (<20)'
              } range. These are market-wide statistics — not specific to {ticker || 'this ticker'}.
              {outcomeDist.isSep && ' September historically weakest month — distribution skewed bearish.'}
              {outcomeDist.isQ4 && ' Q4 historically strongest quarter — distribution skewed bullish.'}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 600 }}>
            {outcomeDist.buckets.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 110, fontSize: 11, color: '#4a6a8a', textAlign: 'right' }}>{b.label}</div>
                <div style={{
                  height: 22, borderRadius: 3,
                  width: `${b.pct * 4}px`,
                  background: b.col,
                  minWidth: 4,
                  transition: 'width 0.4s',
                }} />
                <div style={{ fontSize: 12, color: b.col, fontWeight: 800, width: 36 }}>{b.pct}%</div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 16, padding: '10px 14px',
            background: '#060d18', border: '1px solid #0e1e30', borderRadius: 8,
            display: 'flex', gap: 24,
          }}>
            <div>
              <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>MEDIAN EXPECTED RETURN</div>
              <div style={{
                fontSize: 18, fontWeight: 900,
                color: outcomeDist.medianRet >= 0 ? '#10b981' : '#ef4444'
              }}>
                {outcomeDist.medianRet >= 0 ? '+' : ''}{outcomeDist.medianRet}%
              </div>
              <div style={{ fontSize: 9, color: '#2a4060' }}>over 20 trading days</div>
            </div>
            <div style={{ fontSize: 10, color: '#4a6a8a', lineHeight: 1.6, maxWidth: 400 }}>
              This is not a price target — it is a probability distribution based on historical outcomes in similar VIX regimes.
              A wide distribution means high uncertainty. A narrow distribution with directional skew means a clearer edge.
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 5: Decision Audit Trail ── */}
      {activeSection === 'audit' && (
        <div style={{ padding: 16 }}>
          {/* Log a decision */}
          <div style={{
            padding: 14, background: '#060d18', border: '1px solid #0e1e30',
            borderRadius: 10, marginBottom: 16,
          }}>
            <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 10 }}>LOG THIS DECISION</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {['BULLISH','BEARISH','NEUTRAL','WATCHING'].map(d => (
                  <button key={d} onClick={() => setAuditDirection(d)}
                    style={{
                      padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      cursor: 'pointer', border: 'none',
                      background: auditDirection === d
                        ? d === 'BULLISH' ? '#065f46' : d === 'BEARISH' ? '#7f1d1d' : '#1e3456'
                        : '#0a1820',
                      color: auditDirection === d
                        ? d === 'BULLISH' ? '#10b981' : d === 'BEARISH' ? '#ef4444' : '#60a5fa'
                        : '#2a4060',
                    }}>{d}</button>
                ))}
              </div>
              <span style={{ fontSize: 10, color: '#2a4060' }}>
                {ticker ?? 'No ticker'} · {breadthData?.verdict ?? 'No regime'} · VIX {(vixData?.current ?? breadthData?.vix?.current ?? 0).toFixed(1)}
              </span>
            </div>
            <textarea
              value={auditNote}
              onChange={e => setAuditNote(e.target.value)}
              placeholder="Why are you making this decision? What is your thesis? What would prove you wrong?"
              style={{
                width: '100%', minHeight: 70, padding: '8px 10px',
                background: '#030810', border: '1px solid #0e1e30', borderRadius: 6,
                color: '#cbd5e1', fontSize: 11, fontFamily: 'inherit',
                lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <button
              onClick={saveAuditEntry}
              style={{
                marginTop: 8, padding: '6px 16px', background: '#0e1e30',
                border: '1px solid #1e3456', borderRadius: 6, color: '#60a5fa',
                fontSize: 11, fontWeight: 800, cursor: 'pointer',
              }}>
              Save to Log
            </button>
          </div>

          {/* Audit log entries */}
          {auditLog.length === 0 ? (
            <div style={{ fontSize: 11, color: '#1a3050', fontStyle: 'italic' }}>
              No decisions logged yet. Save a decision above to start your audit trail.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {auditLog.map(e => {
                const dirCol = e.direction === 'BULLISH' ? '#10b981' : e.direction === 'BEARISH' ? '#ef4444' : '#60a5fa'
                return (
                  <div key={e.id} style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: '#060d18', border: '1px solid #0e1e30',
                    borderLeft: `3px solid ${dirCol}`,
                  }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: dirCol, fontWeight: 900 }}>{e.direction}</span>
                      <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 700 }}>{e.ticker}</span>
                      <span style={{ fontSize: 10, color: '#4a6a8a' }}>{e.regime} · VIX {e.vix}</span>
                      <span style={{ fontSize: 10, color: '#2a4060' }}>{e.evidenceScore}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: '#1a3050' }}>{e.timestamp}</span>
                    </div>
                    {e.note && (
                      <div style={{ fontSize: 11, color: '#4a6a8a', lineHeight: 1.5 }}>{e.note}</div>
                    )}
                    {e.brief && (
                      <div style={{
                        marginTop: 6, padding: '6px 10px',
                        background: '#030810', borderRadius: 4,
                        fontSize: 10, color: '#2a4060', fontStyle: 'italic', lineHeight: 1.5,
                      }}>
                        "{e.brief.slice(0, 180)}{e.brief.length > 180 ? '...' : ''}"
                      </div>
                    )}
                  </div>
                )
              })}
              <button
                onClick={() => { setAuditLog([]); localStorage.removeItem('insight-audit') }}
                style={{
                  alignSelf: 'flex-end', padding: '4px 12px',
                  background: 'transparent', border: '1px solid #1a2e45',
                  borderRadius: 4, color: '#1a3050', fontSize: 10, cursor: 'pointer',
                }}>
                Clear log
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
