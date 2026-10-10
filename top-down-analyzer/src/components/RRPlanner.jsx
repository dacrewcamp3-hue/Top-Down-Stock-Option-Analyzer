import { useState, useMemo, useEffect } from 'react'

export default function RRPlanner({ ticker, currentPrice }) {
  const [entry,   setEntry]   = useState('')
  const [stop,    setStop]    = useState('')
  const [target1, setTarget1] = useState('')
  const [target2, setTarget2] = useState('')
  const [acctSize, setAcctSize] = useState(() => {
    try { return localStorage.getItem('rr-acct-size') ?? '10000' } catch { return '10000' }
  })
  const [riskPct, setRiskPct] = useState('1')

  // Auto-fill entry from currentPrice when it changes and entry is empty
  useEffect(() => {
    if (currentPrice && !entry) setEntry(currentPrice.toFixed(2))
  }, [currentPrice]) // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    const e   = parseFloat(entry)
    const s   = parseFloat(stop)
    const t1  = parseFloat(target1)
    const t2  = parseFloat(target2)
    const acc = parseFloat(acctSize) || 10000
    const rp  = parseFloat(riskPct)  || 1

    if (!e || !s || e === s) return null

    const riskPerShare = Math.abs(e - s)
    const reward1      = t1 ? Math.abs(t1 - e) : null
    const reward2      = t2 ? Math.abs(t2 - e) : null
    const rr1          = reward1 ? reward1 / riskPerShare : null
    const rr2          = reward2 ? reward2 / riskPerShare : null

    const dollarRisk    = acc * (rp / 100)
    const shares        = riskPerShare > 0 ? Math.floor(dollarRisk / riskPerShare) : 0
    const positionValue = shares * e
    const maxLoss       = shares * riskPerShare
    const maxGain1      = reward1 ? shares * reward1 : null

    const isShort   = s > e
    const direction = isShort ? 'SHORT / PUT' : 'LONG / CALL'
    const dirColor  = isShort ? '#ef4444' : '#10b981'

    const quality = !rr1 ? null
      : rr1 >= 3 ? { label: 'EXCELLENT', col: '#10b981' }
      : rr1 >= 2 ? { label: 'GOOD',      col: '#34d399' }
      : rr1 >= 1 ? { label: 'MARGINAL',  col: '#f59e0b' }
      : { label: 'POOR — SKIP',          col: '#ef4444' }

    return { riskPerShare, reward1, reward2, rr1, rr2, shares, positionValue, maxLoss, maxGain1, direction, dirColor, quality, dollarRisk }
  }, [entry, stop, target1, target2, acctSize, riskPct])

  const inputStyle = {
    background: '#060d18', border: '1px solid #0e1e30', borderRadius: 4,
    color: '#e2e8f0', fontSize: 12, padding: '5px 8px', width: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit',
  }
  const labelStyle = { fontSize: 9, color: '#2a4060', fontWeight: 700, marginBottom: 3, display: 'block' }

  return (
    <div style={{
      background: '#030810', borderTop: '1px solid #0a1820',
      padding: '12px 16px',
    }}>
      <div style={{ fontSize: 9, color: '#2a4060', fontWeight: 800, letterSpacing: '0.5px', marginBottom: 10 }}>
        R:R TRADE PLANNER {ticker ? `· ${ticker}` : ''}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) repeat(2, 0.7fr)', gap: 8, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>ENTRY $</label>
          <input type="number" step="0.01" value={entry}
            onChange={e => setEntry(e.target.value)}
            placeholder={currentPrice?.toFixed(2) ?? '0.00'}
            style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>STOP $</label>
          <input type="number" step="0.01" value={stop}
            onChange={e => setStop(e.target.value)}
            placeholder="Required"
            style={{ ...inputStyle, borderColor: stop ? '#0e1e30' : '#3d1a1a' }} />
        </div>
        <div>
          <label style={labelStyle}>TARGET 1 $</label>
          <input type="number" step="0.01" value={target1}
            onChange={e => setTarget1(e.target.value)}
            placeholder="Required"
            style={{ ...inputStyle, borderColor: target1 ? '#0e1e30' : '#3d1a1a' }} />
        </div>
        <div>
          <label style={labelStyle}>TARGET 2 $ <span style={{ color: '#1a3050' }}>(opt)</span></label>
          <input type="number" step="0.01" value={target2}
            onChange={e => setTarget2(e.target.value)}
            placeholder="Optional"
            style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>ACCOUNT $</label>
          <input type="number" value={acctSize}
            onChange={e => {
              setAcctSize(e.target.value)
              try { localStorage.setItem('rr-acct-size', e.target.value) } catch {}
            }}
            style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>RISK %</label>
          <input type="number" step="0.1" min="0.1" max="5" value={riskPct}
            onChange={e => setRiskPct(e.target.value)}
            style={inputStyle} />
        </div>
      </div>

      {calc ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Direction */}
          <div style={{
            padding: '6px 12px', borderRadius: 6,
            background: calc.dirColor === '#10b981' ? '#010e07' : '#0e0101',
            border: `1px solid ${calc.dirColor}44`,
          }}>
            <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>DIRECTION</div>
            <div style={{ fontSize: 13, color: calc.dirColor, fontWeight: 900 }}>{calc.direction}</div>
          </div>

          {/* R:R ratio */}
          {calc.rr1 != null && (
            <div style={{
              padding: '6px 12px', borderRadius: 6,
              background: calc.quality?.col === '#10b981' ? '#010e07'
                        : calc.quality?.col === '#ef4444' ? '#0e0101'
                        : '#080600',
              border: `1px solid ${calc.quality?.col ?? '#0e1820'}44`,
            }}>
              <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>R:R RATIO · T1</div>
              <div style={{ fontSize: 18, color: calc.quality?.col, fontWeight: 900, lineHeight: 1 }}>
                1 : {calc.rr1.toFixed(2)}
              </div>
              <div style={{ fontSize: 9, color: calc.quality?.col, fontWeight: 700, marginTop: 2 }}>
                {calc.quality?.label}
              </div>
            </div>
          )}

          {calc.rr2 != null && (
            <div style={{ padding: '6px 12px', borderRadius: 6, background: '#060d18', border: '1px solid #0e1820' }}>
              <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>R:R · T2</div>
              <div style={{ fontSize: 14, color: '#60a5fa', fontWeight: 800 }}>1 : {calc.rr2.toFixed(2)}</div>
            </div>
          )}

          {/* Position sizing */}
          <div style={{ padding: '6px 12px', borderRadius: 6, background: '#060d18', border: '1px solid #0e1820' }}>
            <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>SHARES / CONTRACTS</div>
            <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 800 }}>{calc.shares.toLocaleString()}</div>
            <div style={{ fontSize: 9, color: '#4a6a8a' }}>
              ${calc.positionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} position
            </div>
          </div>

          {/* Risk/reward amounts */}
          <div style={{ padding: '6px 12px', borderRadius: 6, background: '#060d18', border: '1px solid #0e1820' }}>
            <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>MAX RISK</div>
            <div style={{ fontSize: 14, color: '#ef4444', fontWeight: 800 }}>
              −${calc.maxLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div style={{ fontSize: 9, color: '#4a6a8a' }}>{riskPct}% of account</div>
          </div>

          {calc.maxGain1 != null && (
            <div style={{ padding: '6px 12px', borderRadius: 6, background: '#060d18', border: '1px solid #0e1820' }}>
              <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>MAX GAIN · T1</div>
              <div style={{ fontSize: 14, color: '#10b981', fontWeight: 800 }}>
                +${calc.maxGain1.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          )}

          {/* Risk per share */}
          <div style={{ padding: '6px 12px', borderRadius: 6, background: '#060d18', border: '1px solid #0e1820' }}>
            <div style={{ fontSize: 8, color: '#2a4060', fontWeight: 700 }}>RISK / SHARE</div>
            <div style={{ fontSize: 14, color: '#f59e0b', fontWeight: 800 }}>
              ${calc.riskPerShare.toFixed(2)}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 10, color: '#1a3050', fontStyle: 'italic' }}>
          Enter entry, stop, and target to calculate position size and R:R ratio.
          A minimum 2:1 R:R is required for a quality trade setup.
        </div>
      )}
    </div>
  )
}
