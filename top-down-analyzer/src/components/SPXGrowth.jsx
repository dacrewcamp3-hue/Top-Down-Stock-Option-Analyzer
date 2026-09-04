import { useState, useMemo } from 'react'
import './SPXGrowth.css'

// ── Educational tooltip wrapper ──────────────────────────────────────────────
function Tip({ children, text, wide, up }) {
  return (
    <span className={`spx-tip${wide ? ' spx-tip-wide' : ''}${up ? ' spx-tip-up' : ''}`}>
      {children}
      <span className="spx-tip-box">{text}</span>
    </span>
  )
}

// ── S&P 500 annual total returns (price + dividends reinvested), 1986–2026 ──
const SP500_ANNUAL = [
  { year: 1986, ret: 18.67 },
  { year: 1987, ret:  5.25 },
  { year: 1988, ret: 16.61 },
  { year: 1989, ret: 31.69 },
  { year: 1990, ret: -3.10 },
  { year: 1991, ret: 30.47 },
  { year: 1992, ret:  7.62 },
  { year: 1993, ret: 10.08 },
  { year: 1994, ret:  1.32 },
  { year: 1995, ret: 37.58 },
  { year: 1996, ret: 22.96 },
  { year: 1997, ret: 33.36 },
  { year: 1998, ret: 28.58 },
  { year: 1999, ret: 21.04 },
  { year: 2000, ret: -9.10 },
  { year: 2001, ret:-11.89 },
  { year: 2002, ret:-22.10 },
  { year: 2003, ret: 28.68 },
  { year: 2004, ret: 10.88 },
  { year: 2005, ret:  4.91 },
  { year: 2006, ret: 15.79 },
  { year: 2007, ret:  5.49 },
  { year: 2008, ret:-37.00 },
  { year: 2009, ret: 26.46 },
  { year: 2010, ret: 15.06 },
  { year: 2011, ret:  2.11 },
  { year: 2012, ret: 16.00 },
  { year: 2013, ret: 32.39 },
  { year: 2014, ret: 13.69 },
  { year: 2015, ret:  1.38 },
  { year: 2016, ret: 11.96 },
  { year: 2017, ret: 21.83 },
  { year: 2018, ret: -4.38 },
  { year: 2019, ret: 31.49 },
  { year: 2020, ret: 18.40 },
  { year: 2021, ret: 28.71 },
  { year: 2022, ret:-18.11 },
  { year: 2023, ret: 26.29 },
  { year: 2024, ret: 25.02 },
  { year: 2025, ret: 12.00, est: true },
  { year: 2026, ret:  8.00, est: true },
]

// US CPI annual inflation rates, 1986–2026 (2025–2026 estimated)
const CPI_ANNUAL = [
  { year: 1986, inf: 1.91 },
  { year: 1987, inf: 3.66 },
  { year: 1988, inf: 4.08 },
  { year: 1989, inf: 4.83 },
  { year: 1990, inf: 5.40 },
  { year: 1991, inf: 4.21 },
  { year: 1992, inf: 3.01 },
  { year: 1993, inf: 2.99 },
  { year: 1994, inf: 2.56 },
  { year: 1995, inf: 2.83 },
  { year: 1996, inf: 2.93 },
  { year: 1997, inf: 2.34 },
  { year: 1998, inf: 1.55 },
  { year: 1999, inf: 2.19 },
  { year: 2000, inf: 3.38 },
  { year: 2001, inf: 2.83 },
  { year: 2002, inf: 1.59 },
  { year: 2003, inf: 2.27 },
  { year: 2004, inf: 2.68 },
  { year: 2005, inf: 3.39 },
  { year: 2006, inf: 3.24 },
  { year: 2007, inf: 2.85 },
  { year: 2008, inf: 3.84 },
  { year: 2009, inf: -0.36 },
  { year: 2010, inf: 1.64 },
  { year: 2011, inf: 3.16 },
  { year: 2012, inf: 2.07 },
  { year: 2013, inf: 1.46 },
  { year: 2014, inf: 1.62 },
  { year: 2015, inf: 0.12 },
  { year: 2016, inf: 1.26 },
  { year: 2017, inf: 2.13 },
  { year: 2018, inf: 2.44 },
  { year: 2019, inf: 1.81 },
  { year: 2020, inf: 1.23 },
  { year: 2021, inf: 4.70 },
  { year: 2022, inf: 8.00 },
  { year: 2023, inf: 4.12 },
  { year: 2024, inf: 2.90 },
  { year: 2025, inf: 2.50, est: true },
  { year: 2026, inf: 2.20, est: true },
]

const CPI_MAP = Object.fromEntries(CPI_ANNUAL.map(d => [d.year, d.inf]))

const CRASH_NOTES = {
  1990: 'Gulf War recession — S&P dropped ~20% peak to trough.',
  2000: 'Dot-com bubble peak — internet stocks had been wildly overvalued.',
  2001: 'Dot-com crash continued + September 11 market shock.',
  2002: 'Dot-com crash bottom — 3-year total S&P drop was ~49%.',
  2008: 'The Great Financial Crisis — housing bubble collapse, banks failed. S&P dropped ~57% peak to trough.',
  2018: 'Fed rate hike fears — market dropped ~20% in Q4 then fully recovered by April 2019.',
  2022: 'Post-COVID inflation spike — Fed raised rates aggressively. S&P dropped ~25%.',
}

const YEAR_MIN = 1986
const YEAR_MAX = 2026
const MIN_INVEST = 1000

function fmtDollar(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${Math.round(n).toLocaleString()}`
}
function fmtMultiple(ratio) {
  if (ratio >= 10) return `${ratio.toFixed(0)}×`
  return `${ratio.toFixed(1)}×`
}

const PRESET_YEARS   = [1986, 1990, 1995, 2000, 2005, 2010, 2015, 2020]
const PRESET_AMOUNTS = [1000, 5000, 10000, 25000, 50000]
const CRASH_YEARS    = new Set(Object.keys(CRASH_NOTES).map(Number))
const yearPct        = y => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100

export default function SPXGrowth() {
  const [startYear,  setStartYear]  = useState(1990)
  const [endYear,    setEndYear]    = useState(2026)
  const [investment, setInvestment] = useState(1000)
  const [customAmt,  setCustomAmt]  = useState('1000')
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const [mode,       setMode]       = useState('nominal')

  const changeStart = v => setStartYear(Math.min(+v, endYear - 1))
  const changeEnd   = v => setEndYear(Math.max(+v, startYear + 1))

  const growthRows = useMemo(() => {
    const rows = []
    let balance = investment
    for (const d of SP500_ANNUAL) {
      if (d.year < startYear || d.year > endYear) continue
      const prev      = balance
      const spxRet    = d.ret / 100
      const cpi       = (CPI_MAP[d.year] ?? 2.5) / 100
      const annualRet = mode === 'real'
        ? ((1 + spxRet) / (1 + cpi)) - 1
        : spxRet
      balance = balance * (1 + annualRet)
      rows.push({
        year:    d.year,
        nomRet:  d.ret,
        realRet: +((annualRet * 100).toFixed(2)),
        inf:     CPI_MAP[d.year] ?? 2.5,
        balance: Math.round(balance),
        delta:   Math.round(balance - prev),
        est:     !!d.est,
      })
    }
    return rows
  }, [startYear, endYear, investment, mode])

  const finalBalance = growthRows.at(-1)?.balance ?? investment
  const totalGain    = finalBalance - investment
  const multiple     = finalBalance / investment
  const years        = growthRows.length
  const cagr         = years > 1
    ? ((Math.pow(finalBalance / investment, 1 / years) - 1) * 100).toFixed(1)
    : null

  // SVG chart
  const W = 1000, H = 220
  const PAD = { top: 18, bottom: 30, left: 4, right: 4 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const maxBal   = Math.max(...growthRows.map(r => r.balance), investment * 1.05)
  const minBal   = Math.min(...growthRows.map(r => r.balance), investment * 0.95)
  const balRange = maxBal - minBal || 1

  const toX = i => PAD.left + (i / growthRows.length) * innerW
  const toY = v => PAD.top + (1 - (v - minBal) / balRange) * innerH

  const allPts = [
    { x: PAD.left, y: toY(investment) },
    ...growthRows.map((r, i) => ({ x: toX(i + 1), y: toY(r.balance) })),
  ]
  const lineD = allPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaD = `${lineD} L${PAD.left + innerW},${PAD.top + innerH} L${PAD.left},${PAD.top + innerH} Z`

  const isReal      = mode === 'real'
  const accentColor = isReal ? '#a78bfa' : '#22c55e'
  const hRow        = hoveredIdx !== null ? growthRows[hoveredIdx] : null
  const displayRet  = r => isReal ? r.realRet : r.nomRet

  const handleAmtChange = v => {
    setCustomAmt(v)
    const n = parseInt(v, 10)
    if (!isNaN(n) && n >= MIN_INVEST) setInvestment(n)
  }

  const trackLeft  = yearPct(startYear)
  const trackRight = 100 - yearPct(endYear)

  return (
    <div className="spx-root">

      {/* ── Header + mode toggle ── */}
      <div className="spx-header">
        <div className="spx-header-icon">📈</div>
        <div className="spx-header-text">
          <h2 className="spx-title">S&P 500 Wealth Escalator</h2>
          <p className="spx-subtitle">
            Drag both handles to set your window — any span from <strong>1986 to August 2026</strong>.
            See what a simple S&amp;P 500 index investment would have grown to over that period.
          </p>
        </div>
        <div className="spx-mode-toggle">
          <Tip
            text="Shows raw dollar amounts — what your account statement would literally say. No math adjustments. Just the actual growth."
            wide up
          >
            <button
              className={`spx-mode-btn${!isReal ? ' active' : ''}`}
              onClick={() => setMode('nominal')}
            >Nominal</button>
          </Tip>
          <Tip
            text="Shows real purchasing power. A dollar in 1990 bought way more than a dollar today. This strips inflation out so you can see what your gain actually means in terms of what you can BUY — not just the number on paper."
            wide up
          >
            <button
              className={`spx-mode-btn real${isReal ? ' active' : ''}`}
              onClick={() => setMode('real')}
            >Inflation-Adj.</button>
          </Tip>
        </div>
      </div>

      {isReal && (
        <div className="spx-mode-note">
          <span className="spx-mode-note-icon">ℹ</span>
          <span>
            <strong>Inflation-adjusted (real) returns</strong> — each year's S&amp;P 500 gain is
            reduced by that year's CPI inflation rate. Result is in <strong>{startYear} purchasing-power dollars</strong>.
            Example: market up 10%, inflation 4% → real gain is only ~5.8%.
          </span>
        </div>
      )}

      {/* ── Dual-range year slider ── */}
      <div className="spx-ctrl-block">
        <div className="spx-ctrl-label">
          <Tip
            text="Slide the LEFT dot to pick your start year — when the investment was first made. Slide the RIGHT dot to pick when it ended. Drag them anywhere between 1986 and 2026."
            wide
          >
            Year Range <span className="spx-tip-icon">?</span>
          </Tip>
          &nbsp;
          <span className="spx-ctrl-val">{startYear}</span>
          <span className="spx-range-arrow"> → </span>
          <span className="spx-ctrl-val">{endYear}</span>
          <span className="spx-range-span"> ({years} yr{years !== 1 ? 's' : ''})</span>
        </div>

        <div className="spx-preset-row">
          <span className="spx-preset-label">Start:</span>
          {PRESET_YEARS.map(y => (
            <button
              key={y}
              className={`spx-pill${startYear === y ? ' active' : ''}`}
              onClick={() => changeStart(y)}
            >{y}</button>
          ))}
        </div>

        <div
          className="spx-dual-wrap"
          style={{ '--track-left': `${trackLeft}%`, '--track-right': `${trackRight}%` }}
        >
          <div className="spx-dual-track"><div className="spx-dual-fill" /></div>
          <input type="range" min={YEAR_MIN} max={YEAR_MAX} step={1} value={startYear}
            onChange={e => changeStart(e.target.value)}
            className="spx-dual-input spx-dual-start"
            title={`Start year: ${startYear} — drag right to start later`}
          />
          <input type="range" min={YEAR_MIN} max={YEAR_MAX} step={1} value={endYear}
            onChange={e => changeEnd(e.target.value)}
            className="spx-dual-input spx-dual-end"
            title={`End year: ${endYear} — drag left to see what an early exit looks like`}
          />
        </div>

        <div className="spx-range-labels"><span>{YEAR_MIN}</span><span>{YEAR_MAX}</span></div>
      </div>

      {/* ── Investment amount ── */}
      <div className="spx-ctrl-block">
        <div className="spx-ctrl-label">
          <Tip text="How much you invested at the start. You put it in once and never added to it — pure compound growth. $1,000 is the minimum to show how even small amounts snowball over time.">
            Initial Investment <span className="spx-tip-icon">?</span>
          </Tip>
        </div>
        <div className="spx-preset-row">
          {PRESET_AMOUNTS.map(a => (
            <button key={a}
              className={`spx-pill${investment === a ? ' active' : ''}`}
              onClick={() => { setInvestment(a); setCustomAmt(a.toString()) }}
            >${a.toLocaleString()}</button>
          ))}
        </div>
        <div className="spx-custom-row">
          <span className="spx-dollar-sign">$</span>
          <input type="number" min={MIN_INVEST} value={customAmt}
            onChange={e => handleAmtChange(e.target.value)}
            className="spx-custom-input" placeholder="Custom amount…"
          />
        </div>
      </div>

      {/* ── Result banner ── */}
      <div className={`spx-banner${isReal ? ' spx-banner-real' : ''}`}>
        <div className="spx-banner-main">
          <div className="spx-banner-label">
            <Tip text={`You put in ${fmtDollar(investment)} once and left it alone in an S&P 500 index fund — no adding, no selling, no timing the market. Just patience.`}>
              {fmtDollar(investment)} invested in {startYear}
              <span className="spx-tip-icon">?</span>
            </Tip>
            {' → '}
            {isReal && <span className="spx-banner-badge">real {startYear} $</span>}
          </div>

          <div className="spx-banner-value" style={{ color: accentColor }}>
            <Tip text={`What that one investment is worth in ${endYear}. The market did the work. You just had to not sell.`} wide>
              {fmtDollar(finalBalance)}
              <span className="spx-tip-icon" style={{ fontSize: '0.6em', verticalAlign: 'super' }}>?</span>
            </Tip>
          </div>

          <div className="spx-banner-sub">
            <Tip text={`Total profit above what you put in. ${fmtMultiple(multiple)} means every dollar you invested turned into ${fmtMultiple(multiple)} dollars. This is the power of compound growth — your gains earn gains.`}>
              {totalGain >= 0 ? '+' : ''}{fmtDollar(Math.abs(totalGain))} gain &nbsp;·&nbsp; {fmtMultiple(multiple)} your money
              <span className="spx-tip-icon">?</span>
            </Tip>
            &nbsp;·&nbsp;
            <Tip text={`Compound Annual Growth Rate — the average yearly speed of your investment. A ${cagr}% CAGR means if it grew at exactly this rate every single year, you'd get the same result. It's how you compare investments fairly across time.`}>
              {cagr}% / yr CAGR <span className="spx-tip-icon">?</span>
            </Tip>
            {isReal && <span className="spx-banner-real-note"> after inflation</span>}
          </div>
        </div>
        <div className="spx-banner-years">{years} yr{years !== 1 ? 's' : ''} in market</div>
      </div>

      {/* ── Chart ── */}
      <div className="spx-chart-wrap">
        <div className="spx-chart-legend">
          <span className="spx-chart-legend-item">
            <span style={{ color: accentColor }}>▬</span> Portfolio value
          </span>
          <Tip text="These dashed red lines mark years when the market had a major crash. The key lesson: every single one of them recovered. Investors who stayed in came out ahead." wide>
            <span className="spx-chart-legend-item spx-chart-legend-crash">
              <span style={{ color: '#ef4444' }}>╌</span> Major crash year
              <span className="spx-tip-icon">?</span>
            </span>
          </Tip>
        </div>

        {hRow && (
          <div className="spx-tooltip-box">
            <strong>{hRow.year}{hRow.est ? ' *' : ''}</strong>
            &nbsp;·&nbsp;
            {CRASH_YEARS.has(hRow.year) && (
              <span style={{ color: '#f97316', fontSize: '0.75em' }}>⚠ crash year &nbsp;</span>
            )}
            {isReal && <span style={{ color: '#f59e0b', fontSize: '0.75em' }}>CPI {hRow.inf.toFixed(1)}%&nbsp; </span>}
            <span className={displayRet(hRow) >= 0 ? 'pos' : 'neg'}>
              {isReal ? 'Real' : 'S&P'} {displayRet(hRow) >= 0 ? '+' : ''}{displayRet(hRow).toFixed(2)}%
            </span>
            &nbsp;·&nbsp; Balance: <strong>{fmtDollar(hRow.balance)}</strong>
            &nbsp;·&nbsp;
            <span className={hRow.delta >= 0 ? 'pos' : 'neg'}>
              {hRow.delta >= 0 ? '+' : ''}{fmtDollar(Math.abs(hRow.delta))}
            </span>
            {CRASH_YEARS.has(hRow.year) && (
              <div style={{ fontSize: '0.72em', color: '#94a3b8', marginTop: 3 }}>
                {CRASH_NOTES[hRow.year]}
              </div>
            )}
          </div>
        )}

        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          className="spx-svg" onMouseLeave={() => setHoveredIdx(null)}>
          <defs>
            <linearGradient id="spxFillNom" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#22c55e" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.03" />
            </linearGradient>
            <linearGradient id="spxFillReal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#a78bfa" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          <path d={areaD} fill={isReal ? 'url(#spxFillReal)' : 'url(#spxFillNom)'} />

          {growthRows.map((r, i) =>
            CRASH_YEARS.has(r.year) ? (
              <line key={r.year}
                x1={toX(i + 1)} y1={PAD.top}
                x2={toX(i + 1)} y2={PAD.top + innerH}
                stroke="#ef4444" strokeWidth="1" strokeOpacity="0.28"
                strokeDasharray="4 3" />
            ) : null
          )}

          <path d={lineD} fill="none" stroke={accentColor}
            strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

          {growthRows.map((r, i) => (
            <rect key={r.year}
              x={toX(i)} y={0}
              width={innerW / Math.max(growthRows.length, 1)} height={H}
              fill="transparent" style={{ cursor: 'crosshair' }}
              onMouseEnter={() => setHoveredIdx(i)} />
          ))}

          {hoveredIdx !== null && allPts[hoveredIdx + 1] && (
            <circle cx={allPts[hoveredIdx + 1].x} cy={allPts[hoveredIdx + 1].y}
              r="5" fill={accentColor} stroke="#fff" strokeWidth="2" />
          )}

          {growthRows.map((r, i) =>
            r.year % 5 === 0 ? (
              <text key={r.year} x={toX(i + 1)} y={H - 6}
                textAnchor="middle" fontSize="13" fill="#6b7280">{r.year}</text>
            ) : null
          )}
        </svg>
      </div>

      {/* ── Year-by-year table ── */}
      <div className="spx-table-wrap">
        <table className="spx-table">
          <thead>
            <tr>
              <th>
                <Tip text="Each row is one calendar year. Hover a row to see context about what happened. Red rows = years the market dropped." up>
                  Year <span className="spx-tip-icon">?</span>
                </Tip>
              </th>
              <th>
                <Tip text="The S&P 500's total return that year — stock price movement plus dividends reinvested. Positive = market went up. Negative = it dropped. The long-term average is ~10%/year. Single years can swing wildly." up wide>
                  S&amp;P Return <span className="spx-tip-icon">?</span>
                </Tip>
              </th>
              {isReal && (
                <th>
                  <Tip text="Consumer Price Index — how much everyday prices rose that year. Groceries, rent, gas. When CPI is high (like 2022's 8%), inflation is quietly stealing from your returns." up wide>
                    CPI <span className="spx-tip-icon">?</span>
                  </Tip>
                </th>
              )}
              {isReal && (
                <th>
                  <Tip text="Your real gain after inflation. Formula: (1 + S&P Return) ÷ (1 + CPI) − 1. This is the honest number. If the market returned 10% but prices rose 8%, you only got ~1.85% richer in terms of buying power." up wide>
                    Real Return <span className="spx-tip-icon">?</span>
                  </Tip>
                </th>
              )}
              <th>
                <Tip text="Your total account value at year end. Watch how the jumps get bigger as the balance grows — that's compounding. The same 10% return on $100K earns $10K. On $1M it earns $100K." up wide>
                  Balance <span className="spx-tip-icon">?</span>
                </Tip>
              </th>
              <th>
                <Tip text="How many dollars you gained or lost in that single year. Red years feel terrible in the moment. But look at what came after every single crash in this table — the market recovered every time." up wide>
                  Year Gain / Loss <span className="spx-tip-icon">?</span>
                </Tip>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="spx-start-row">
              <td>{startYear} (start)</td>
              <td>—</td>
              {isReal && <td>—</td>}
              {isReal && <td>—</td>}
              <td><strong>{fmtDollar(investment)}</strong></td>
              <td>—</td>
            </tr>
            {growthRows.map(r => (
              <tr key={r.year}
                className={[
                  displayRet(r) < 0 ? 'spx-neg-row' : '',
                  CRASH_YEARS.has(r.year) ? 'spx-crash-row' : '',
                ].join(' ').trim()}
                title={CRASH_YEARS.has(r.year) ? CRASH_NOTES[r.year] : undefined}
              >
                <td>
                  {r.year}
                  {CRASH_YEARS.has(r.year) && <span className="spx-crash-tag" title={CRASH_NOTES[r.year]}>crash</span>}
                  {r.est && <span className="spx-est-tag">est.</span>}
                </td>
                <td className={r.nomRet >= 0 ? 'pos' : 'neg'}>
                  {r.nomRet >= 0 ? '+' : ''}{r.nomRet.toFixed(2)}%
                </td>
                {isReal && <td className="spx-cpi-col">{r.inf.toFixed(1)}%</td>}
                {isReal && (
                  <td className={r.realRet >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>
                    {r.realRet >= 0 ? '+' : ''}{r.realRet.toFixed(2)}%
                  </td>
                )}
                <td><strong>{fmtDollar(r.balance)}</strong></td>
                <td className={r.delta >= 0 ? 'pos' : 'neg'}>
                  {r.delta >= 0 ? '+' : '−'}{fmtDollar(Math.abs(r.delta))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="spx-table-footer">
          <Tip text="2025 and 2026 returns are our best estimate based on available data — they will change as the year plays out. Everything from 1986–2024 is actual historical data." wide>
            <span className="spx-footnote-inline">* estimated years <span className="spx-tip-icon">?</span></span>
          </Tip>
          <span className="spx-footnote-inline">·</span>
          <Tip text="'Crash' years are major market downturns of 20%+ that made headlines. Every one of them recovered within a few years. This is why time in the market beats timing the market." wide>
            <span className="spx-footnote-inline">crash = major drawdown <span className="spx-tip-icon">?</span></span>
          </Tip>
          <span className="spx-footnote-inline">·</span>
          <span className="spx-footnote-inline">For educational use only.</span>
        </div>
      </div>

    </div>
  )
}
