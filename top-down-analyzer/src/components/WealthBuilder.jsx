import { useState } from 'react'
import './WealthBuilder.css'

// FV = PV*(1+r)^t + PMT_annual*((1+r)^t - 1)/r
function compound(pv, rate, years, monthlyPmt = 0) {
  if (years <= 0) return pv
  if (rate <= 0)  return pv + monthlyPmt * 12 * years
  const annualPmt = monthlyPmt * 12
  const growth    = Math.pow(1 + rate, years)
  return pv * growth + (annualPmt > 0 ? annualPmt * (growth - 1) / rate : 0)
}

function fmt(n) {
  if (!isFinite(n) || n < 0) return '$0'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${Math.round(n)}`
}

function parseAmt(s) {
  return Math.max(0, parseFloat(String(s).replace(/,/g, '')) || 0)
}

const ITEMS = {
  jewelry: {
    label: 'Jewelry / Watch',
    icon:  '💎',
    note:  'Loses 50–70% immediately, then slowly fades. Even a Rolex has limited resale market.',
    residual: t => t <= 0 ? 1 : Math.max(0.04, 0.35 * Math.pow(0.91, t - 1)),
  },
  car: {
    label: 'Car / Truck',
    icon:  '🚗',
    note:  'New cars lose ~20% driving off the lot, then ~12%/year after.',
    residual: t => t <= 0 ? 1 : 0.80 * Math.pow(0.88, t - 1),
  },
  clothes: {
    label: 'Clothes / Shoes',
    icon:  '👟',
    note:  'Fashion depreciates to near zero almost immediately.',
    residual: t => t <= 0 ? 1 : 0.03,
  },
  cash: {
    label: 'Cash (sitting idle)',
    icon:  '💵',
    note:  'Inflation quietly erodes purchasing power by ~3%/year.',
    residual: t => Math.pow(0.97, t),
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OPPORTUNITY COST
// ─────────────────────────────────────────────────────────────────────────────
function OpportunityCost() {
  const [amount,  setAmount]  = useState('50000')
  const [itemKey, setItemKey] = useState('jewelry')
  const [years,   setYears]   = useState(20)
  const [rate,    setRate]    = useState(12)

  const amt  = parseAmt(amount)
  const r    = rate / 100
  const item = ITEMS[itemKey]
  const milestones = [1, 5, 10, 20, 30].filter(y => y <= years)
  if (!milestones.includes(years)) milestones.push(years)

  const investAt = t => compound(amt, r, t)
  const itemAt   = t => amt * item.residual(t)

  const finalInvested = investAt(years)
  const finalItem     = itemAt(years)
  const realCost      = finalInvested - finalItem

  return (
    <div className="wb-section">
      <div className="wb-section-eyebrow">Opportunity Cost Calculator</div>
      <div className="wb-section-title">What Are You REALLY Paying For That?</div>
      <div className="wb-section-sub">
        Every dollar you spend is a dollar that stops compounding forever. The sticker price is not the real price. The real price is what that money becomes if you invest it instead.
      </div>

      <div className="wb-controls">
        <div className="wb-control">
          <span className="wb-label">Amount</span>
          <div className="wb-input-wrap">
            <span className="wb-sym">$</span>
            <input className="wb-input" type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50000" />
          </div>
        </div>
        <div className="wb-control wb-control-wide">
          <span className="wb-label">Spending on</span>
          <select className="wb-select" value={itemKey} onChange={e => setItemKey(e.target.value)}>
            {Object.entries(ITEMS).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </div>
        <div className="wb-control">
          <span className="wb-label">Time horizon — {years} yrs</span>
          <input type="range" min={5} max={40} step={5} value={years} onChange={e => setYears(+e.target.value)} className="wb-slider" />
        </div>
        <div className="wb-control">
          <span className="wb-label">Return rate — {rate}%/yr</span>
          <input type="range" min={6} max={25} step={1} value={rate} onChange={e => setRate(+e.target.value)} className="wb-slider" />
        </div>
      </div>

      <div className="wb-item-note">{item.icon} {item.note}</div>

      <div className="wb-compare">
        <div className="wb-compare-col wb-compare-spend">
          <div className="wb-compare-hdr">{item.icon} Spent on {item.label}</div>
          {milestones.map(y => (
            <div key={y} className="wb-compare-row">
              <span className="wb-compare-year">Year {y}</span>
              <span className="wb-compare-val wb-val-red">{fmt(itemAt(y))}</span>
            </div>
          ))}
        </div>
        <div className="wb-compare-col wb-compare-invest">
          <div className="wb-compare-hdr">📈 Invested at {rate}%/yr</div>
          {milestones.map(y => (
            <div key={y} className="wb-compare-row">
              <span className="wb-compare-year">Year {y}</span>
              <span className="wb-compare-val wb-val-green">{fmt(investAt(y))}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="wb-punch">
        <div className="wb-punch-eyebrow">The real price of that {item.label.toLowerCase()}</div>
        <div className="wb-punch-number wb-punch-red">{fmt(realCost)}</div>
        <div className="wb-punch-sub">
          The {item.label.toLowerCase()} costs {fmt(amt)} today. But {fmt(amt)} invested at {rate}% for {years} years becomes {fmt(finalInvested)}.
          The item will be worth {fmt(finalItem)} by then. The opportunity you give up is {fmt(realCost)}.
          That is the real price tag — and it never shows up on the receipt.
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMPOUND GROWTH VISUALIZER
// ─────────────────────────────────────────────────────────────────────────────
function CompoundVisualizer() {
  const [startAmt, setStartAmt] = useState('10000')
  const [monthly,  setMonthly]  = useState('500')
  const [rate,     setRate]     = useState(12)

  const pv  = parseAmt(startAmt)
  const pmt = parseAmt(monthly)
  const r   = rate / 100

  const YEARS = [5, 10, 20, 30]

  const withBoth  = YEARS.map(y => compound(pv, r, y, pmt))
  const startOnly = YEARS.map(y => compound(pv, r, y, 0))
  const pmtOnly   = YEARS.map(y => compound(0, r, y, pmt))

  const totalCash = pv + pmt * 12 * 30
  const marketGave = withBoth[3] - totalCash

  return (
    <div className="wb-section">
      <div className="wb-section-eyebrow">Compound Growth Visualizer</div>
      <div className="wb-section-title">Small Amounts. Patient Time. Extraordinary Results.</div>
      <div className="wb-section-sub">
        You don't need to be rich to start building wealth. You need to start. Compound interest doesn't care about your income — it only cares about time.
      </div>

      <div className="wb-controls">
        <div className="wb-control">
          <span className="wb-label">Starting amount</span>
          <div className="wb-input-wrap">
            <span className="wb-sym">$</span>
            <input className="wb-input" type="text" value={startAmt} onChange={e => setStartAmt(e.target.value)} />
          </div>
        </div>
        <div className="wb-control">
          <span className="wb-label">Monthly addition</span>
          <div className="wb-input-wrap">
            <span className="wb-sym">$</span>
            <input className="wb-input" type="text" value={monthly} onChange={e => setMonthly(e.target.value)} />
          </div>
        </div>
        <div className="wb-control">
          <span className="wb-label">Annual return — {rate}%</span>
          <input type="range" min={4} max={25} step={1} value={rate} onChange={e => setRate(+e.target.value)} className="wb-slider" />
        </div>
      </div>

      <div className="wb-growth-table">
        <div className="wb-growth-hdr">
          <span className="wb-growth-scenario">Scenario</span>
          {YEARS.map(y => <span key={y} className="wb-growth-yr">{y} Years</span>)}
        </div>
        {[
          { label: `$${fmt(pv)} start only`,       values: startOnly, dim: true  },
          { label: `$${pmt}/mo only`,               values: pmtOnly,  dim: true  },
          { label: `Both combined`,                 values: withBoth, dim: false },
        ].map(({ label, values, dim }) => (
          <div key={label} className={`wb-growth-row${dim ? ' wb-growth-dim' : ' wb-growth-main'}`}>
            <span className="wb-growth-scenario">{label}</span>
            {values.map((v, i) => (
              <span key={i} className={`wb-growth-yr${dim ? ' wb-val-dim' : ' wb-val-green'}`}>{fmt(v)}</span>
            ))}
          </div>
        ))}
      </div>

      <div className="wb-punch">
        <div className="wb-punch-eyebrow">Combined value in 30 years</div>
        <div className="wb-punch-number wb-punch-green">{fmt(withBoth[3])}</div>
        <div className="wb-punch-sub">
          You put in {fmt(totalCash)} of your own money over 30 years.
          The market contributed {fmt(marketGave)} — {totalCash > 0 ? Math.round(marketGave / totalCash) : 0}x what you put in.
          That extra {fmt(marketGave)} cost you nothing but time and discipline.
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AGE IS EVERYTHING
// ─────────────────────────────────────────────────────────────────────────────
function AgeIsYourAsset() {
  const [amount, setAmount] = useState('10000')
  const [rate,   setRate]   = useState(12)

  const amt    = parseAmt(amount)
  const r      = rate / 100
  const RETIRE = 65
  const AGES   = [16, 21, 25, 30, 35, 40]
  const values = AGES.map(a => compound(amt, r, RETIRE - a))
  const maxVal = Math.max(...values)

  const youngest  = values[0]
  const oldest    = values[values.length - 1]
  const diff      = youngest - oldest
  const yearsCost = diff / (AGES[AGES.length - 1] - AGES[0])

  return (
    <div className="wb-section">
      <div className="wb-section-eyebrow">Time Is the Real Asset</div>
      <div className="wb-section-title">The Earlier You Start, the Less You Actually Need</div>
      <div className="wb-section-sub">
        Same dollar amount. Same return rate. Completely different outcomes — based on one thing only: when you start.
        This is why teaching financial literacy to teenagers matters more than most people realize.
        The knowledge you get at 16 is worth more than a salary increase at 35.
      </div>

      <div className="wb-controls">
        <div className="wb-control">
          <span className="wb-label">One-time investment</span>
          <div className="wb-input-wrap">
            <span className="wb-sym">$</span>
            <input className="wb-input" type="text" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
        </div>
        <div className="wb-control">
          <span className="wb-label">Annual return — {rate}%</span>
          <input type="range" min={6} max={25} step={1} value={rate} onChange={e => setRate(+e.target.value)} className="wb-slider" />
        </div>
      </div>

      <div className="wb-age-note">
        Investing {fmt(amt)} one time, left untouched until age {RETIRE}:
      </div>

      <div className="wb-age-rows">
        {AGES.map((age, i) => {
          const val    = values[i]
          const barPct = maxVal > 0 ? (val / maxVal) * 100 : 0
          const yrs    = RETIRE - age
          const isBest = i === 0
          const isLast = i === AGES.length - 1
          return (
            <div key={age} className={`wb-age-row${isBest ? ' wb-age-best' : isLast ? ' wb-age-worst' : ''}`}>
              <div className="wb-age-meta">
                <span className="wb-age-label">Start at {age}</span>
                <span className="wb-age-sub">{yrs} years to compound</span>
              </div>
              <div className="wb-age-bar-wrap">
                <div
                  className="wb-age-bar"
                  style={{
                    width: `${barPct}%`,
                    background: isBest ? '#10b981' : isLast ? '#ef4444' : '#2a5a7a',
                  }}
                />
              </div>
              <span className={`wb-age-val${isBest ? ' wb-val-green' : isLast ? ' wb-val-red' : ''}`}>
                {fmt(val)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="wb-punch">
        <div className="wb-punch-eyebrow">Starting at 16 vs. starting at 40</div>
        <div className="wb-punch-number wb-punch-green">{fmt(diff)} difference</div>
        <div className="wb-punch-sub">
          From the exact same {fmt(amt)} investment. Every year of delay costs approximately {fmt(yearsCost)} in future wealth.
          A teenager who invests {fmt(amt)} and never adds another dollar will have more at retirement than someone who invests the same amount at 35 and adds {fmt(amt)} every five years.
          Time is the one resource money cannot buy back.
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ATHLETE'S CAREER WINDOW
// ─────────────────────────────────────────────────────────────────────────────
function CareerWindow() {
  const [annualEarn,  setAnnualEarn]  = useState('500000')
  const [careerYrs,   setCareerYrs]   = useState(8)
  const [investPct,   setInvestPct]   = useState(20)
  const [retireAge,   setRetireAge]   = useState(35)
  const [rate,        setRate]        = useState(12)

  const earn        = parseAmt(annualEarn)
  const r           = rate / 100
  const annualInvest = earn * investPct / 100
  const monthlyInvest = annualInvest / 12
  const totalInvested = annualInvest * careerYrs
  const LIFE_AGE    = 75

  // Value compounded during career (monthly contributions over careerYrs)
  const atRetire    = compound(0, r, careerYrs, monthlyInvest)
  // Continue growing after career until LIFE_AGE
  const yearsAfter  = Math.max(0, LIFE_AGE - retireAge)
  const atLife      = atRetire * Math.pow(1 + r, yearsAfter)

  // Spend scenario residual: ~5% left in decade-old luxury assets
  const spendValue  = totalInvested * 0.05

  return (
    <div className="wb-section">
      <div className="wb-section-eyebrow">The Athlete's Career Window</div>
      <div className="wb-section-title">Your Earning Window Is Short. Your Life After It Is Long.</div>
      <div className="wb-section-sub">
        Most professional athletes earn the majority of their lifetime income in under 10 years. The decisions made during that window determine the 40+ years that follow. Jewelry doesn't compound. Cars don't compound. The system in this app does — but only if the money is in it.
      </div>

      <div className="wb-controls">
        <div className="wb-control">
          <span className="wb-label">Annual earnings</span>
          <div className="wb-input-wrap">
            <span className="wb-sym">$</span>
            <input className="wb-input" type="text" value={annualEarn} onChange={e => setAnnualEarn(e.target.value)} />
          </div>
        </div>
        <div className="wb-control">
          <span className="wb-label">Career length — {careerYrs} yrs</span>
          <input type="range" min={1} max={20} step={1} value={careerYrs} onChange={e => setCareerYrs(+e.target.value)} className="wb-slider" />
        </div>
        <div className="wb-control">
          <span className="wb-label">% invested — {investPct}% = {fmt(annualInvest)}/yr</span>
          <input type="range" min={5} max={70} step={5} value={investPct} onChange={e => setInvestPct(+e.target.value)} className="wb-slider" />
        </div>
        <div className="wb-control">
          <span className="wb-label">Retire age — {retireAge}</span>
          <input type="range" min={25} max={55} step={1} value={retireAge} onChange={e => setRetireAge(+e.target.value)} className="wb-slider" />
        </div>
        <div className="wb-control">
          <span className="wb-label">Return rate — {rate}%/yr</span>
          <input type="range" min={6} max={25} step={1} value={rate} onChange={e => setRate(+e.target.value)} className="wb-slider" />
        </div>
      </div>

      <div className="wb-career-grid">
        <div className="wb-career-col wb-career-invest-col">
          <div className="wb-career-col-title">✓ Investing {investPct}% of Earnings</div>
          <div className="wb-career-stat-row">
            <span>Invested per year</span>
            <span className="wb-stat-green">{fmt(annualInvest)}</span>
          </div>
          <div className="wb-career-stat-row">
            <span>Total cash committed over career</span>
            <span className="wb-stat-green">{fmt(totalInvested)}</span>
          </div>
          <div className="wb-career-stat-row">
            <span>Portfolio at retirement (age {retireAge})</span>
            <span className="wb-stat-green wb-stat-lg">{fmt(atRetire)}</span>
          </div>
          <div className="wb-career-stat-row wb-career-final">
            <span>Portfolio at age {LIFE_AGE} (untouched)</span>
            <span className="wb-stat-green wb-stat-xl">{fmt(atLife)}</span>
          </div>
        </div>

        <div className="wb-career-col wb-career-spend-col">
          <div className="wb-career-col-title">✗ Spent on Cars, Jewelry, Lifestyle</div>
          <div className="wb-career-stat-row">
            <span>Spent per year</span>
            <span className="wb-stat-red">{fmt(annualInvest)}</span>
          </div>
          <div className="wb-career-stat-row">
            <span>Total cash spent over career</span>
            <span className="wb-stat-red">{fmt(totalInvested)}</span>
          </div>
          <div className="wb-career-stat-row">
            <span>Residual value at retirement</span>
            <span className="wb-stat-red wb-stat-lg">~{fmt(spendValue)}</span>
          </div>
          <div className="wb-career-stat-row wb-career-final">
            <span>Residual value at age {LIFE_AGE}</span>
            <span className="wb-stat-red wb-stat-xl">~{fmt(spendValue * 0.3)}</span>
          </div>
        </div>
      </div>

      <div className="wb-punch">
        <div className="wb-punch-eyebrow">
          The cost of spending {investPct}% on depreciating assets during your career
        </div>
        <div className="wb-punch-number wb-punch-red">{fmt(atLife - spendValue * 0.3)}</div>
        <div className="wb-punch-sub">
          Investing just {investPct}% of {fmt(earn)}/year for {careerYrs} years — while spending the other {100 - investPct}% however you want —
          produces {fmt(atLife)} by age {LIFE_AGE}. Spending that same {investPct}% on cars, jewelry, and clothes
          leaves approximately {fmt(spendValue * 0.3)} by then. The difference is {fmt(atLife - spendValue * 0.3)}.
          <br /><br />
          That is the price of financial illiteracy. Not the inability to earn — the inability to keep.
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. NIL DEAL SIMULATOR
// ─────────────────────────────────────────────────────────────────────────────
const NIL_SCENARIOS = [
  {
    name: 'Learning Phase',
    desc: '40% win rate · 1% risk/trade · 3 trades/month',
    col: '#06b6d4',
    winRate: 0.40, rr: 2, riskPct: 1, tradesPerMo: 3,
    note: 'Realistic for year 1 as you learn the system. Still cash-flow positive on expected value.',
  },
  {
    name: 'Developing',
    desc: '50% win rate · 1.5% risk/trade · 4 trades/month',
    col: '#10b981',
    winRate: 0.50, rr: 2, riskPct: 1.5, tradesPerMo: 4,
    note: 'Achievable in year 2–3 with consistent discipline, journaling, and full system mastery.',
  },
  {
    name: 'Disciplined',
    desc: '55% win rate · 2% risk/trade · 5 trades/month',
    col: '#f59e0b',
    winRate: 0.55, rr: 2, riskPct: 2, tradesPerMo: 5,
    note: 'Elite-level execution. Requires deep system knowledge and strict emotional discipline.',
  },
]

const NIL_PERIODS = [
  { label: '6 Months',  months:  6, sub: '1 season'              },
  { label: '1 Year',    months: 12, sub: '2 semesters'           },
  { label: '2 Years',   months: 24, sub: 'sophomore → junior'    },
  { label: '4 Years',   months: 48, sub: 'full college career'   },
]

function evGrowth(capital, scenario, months) {
  const { winRate, rr, riskPct, tradesPerMo } = scenario
  const evPerTrade    = riskPct / 100 * (winRate * rr - (1 - winRate))
  const monthlyFactor = 1 + tradesPerMo * evPerTrade
  return capital * Math.pow(monthlyFactor, months)
}

function NilDealSimulator() {
  const [dealSize,   setDealSize]   = useState('100000')
  const [tradingPct, setTradingPct] = useState(10)

  const deal           = parseAmt(dealSize)
  const tradingCapital = deal * tradingPct / 100
  const keptCash       = deal - tradingCapital

  return (
    <div className="wb-section">
      <div className="wb-section-eyebrow">NIL Deal Simulator</div>
      <div className="wb-section-title">What Your NIL Money Can Become</div>
      <div className="wb-section-sub">
        Enter your NIL deal size. Choose how much to ring-fence for the trading system (the rest stays in your account for
        living expenses and index fund investing). See exactly what that trading portion can grow to — at three skill levels —
        over your college career. Numbers are based on expected-value compounding, not luck.
      </div>

      <div className="wb-controls">
        <div className="wb-control">
          <span className="wb-label">NIL Deal Size</span>
          <div className="wb-input-wrap">
            <span className="wb-sym">$</span>
            <input
              className="wb-input"
              type="text"
              value={dealSize}
              onChange={e => setDealSize(e.target.value)}
              placeholder="100000"
            />
          </div>
        </div>
        <div className="wb-control">
          <span className="wb-label">Allocate to trading — {tradingPct}% ({fmt(tradingCapital)})</span>
          <input type="range" min={5} max={30} step={5} value={tradingPct}
            onChange={e => setTradingPct(+e.target.value)} className="wb-slider" />
        </div>
      </div>

      <div className="wb-nil-allocation">
        <div className="wb-nil-alloc-item wb-nil-alloc-trade">
          <div className="wb-nil-alloc-val">{fmt(tradingCapital)}</div>
          <div className="wb-nil-alloc-lbl">Trading Capital ({tradingPct}%)</div>
          <div className="wb-nil-alloc-sub">Active options strategy — this is what the simulator projects below</div>
        </div>
        <div className="wb-nil-alloc-item wb-nil-alloc-keep">
          <div className="wb-nil-alloc-val">{fmt(keptCash)}</div>
          <div className="wb-nil-alloc-lbl">Protected ({100 - tradingPct}%)</div>
          <div className="wb-nil-alloc-sub">Living expenses + index fund investing — never touched by active trades</div>
        </div>
      </div>

      {NIL_SCENARIOS.map(sc => {
        const vals = NIL_PERIODS.map(p => evGrowth(tradingCapital, sc, p.months))
        return (
          <div key={sc.name} className="wb-nil-scenario" style={{ borderColor: sc.col }}>
            <div className="wb-nil-scenario-hdr">
              <div className="wb-nil-scenario-left">
                <div className="wb-nil-scenario-name" style={{ color: sc.col }}>{sc.name}</div>
                <div className="wb-nil-scenario-desc">{sc.desc}</div>
              </div>
              <div className="wb-nil-4yr">
                <div className="wb-nil-4yr-label">4-Year Target</div>
                <div className="wb-nil-4yr-val" style={{ color: sc.col }}>{fmt(vals[3])}</div>
                <div className="wb-nil-4yr-mult">
                  {tradingCapital > 0 ? `${(vals[3] / tradingCapital).toFixed(1)}× starting capital` : ''}
                </div>
              </div>
            </div>
            <div className="wb-nil-period-row">
              {NIL_PERIODS.map((p, i) => (
                <div key={p.label} className="wb-nil-period">
                  <div className="wb-nil-period-val" style={{ color: sc.col }}>{fmt(vals[i])}</div>
                  <div className="wb-nil-period-label">{p.label}</div>
                  <div className="wb-nil-period-sub">{p.sub}</div>
                  <div className="wb-nil-period-gain" style={{ color: vals[i] > tradingCapital ? '#4a8a6a' : '#4a6888' }}>
                    {tradingCapital > 0 ? `+${fmt(vals[i] - tradingCapital)}` : '—'}
                  </div>
                </div>
              ))}
            </div>
            <div className="wb-nil-scenario-note">{sc.note}</div>
          </div>
        )
      })}

      <div className="wb-punch">
        <div className="wb-punch-eyebrow">What if you spent the full {fmt(deal)} on lifestyle instead?</div>
        <div className="wb-punch-number wb-punch-red">~{fmt(deal * 0.03)} left after 4 years</div>
        <div className="wb-punch-sub">
          Cars, jewelry, and designer goods depreciate to near-zero quickly — typically losing 70–97% of value within 4 years.
          Meanwhile, just {fmt(tradingCapital)} ({tradingPct}%) used in the Developing scenario could grow to{' '}
          <strong style={{ color: '#10b981' }}>{fmt(evGrowth(tradingCapital, NIL_SCENARIOS[1], 48))}</strong>.
          The {fmt(keptCash)} you protected? Invest that in index funds averaging 10%/year and
          it becomes <strong style={{ color: '#10b981' }}>{fmt(compound(keptCash, 0.10, 4))}</strong> from that portion alone.
          <br /><br />
          Financial discipline during your NIL years doesn't limit your lifestyle — it funds it for the next 40 years.
          The goal is to make the earning window matter beyond the earning window.
        </div>
      </div>

      <div className="wb-nil-disclaimer">
        Projections use expected-value compounding based on the parameters shown. Actual results vary with skill development,
        market conditions, and trading discipline. These numbers represent theoretical outcomes — not guaranteed returns.
        We strongly recommend completing at least 20 paper trades with positive results before risking real capital.
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'cost',     label: 'Real Price Tag'     },
  { id: 'compound', label: 'Compound Growth'    },
  { id: 'age',      label: 'Age Is Everything'  },
  { id: 'career',   label: "Athlete's Window"   },
  { id: 'nil',      label: 'NIL Simulator'      },
]

export default function WealthBuilder() {
  const [active, setActive] = useState('cost')

  return (
    <div className="wb-root">
      <div className="wb-header">
        <div className="wb-header-title">Wealth Builder</div>
        <div className="wb-header-sub">
          The market can be life-changing. These tools show you exactly how — and what it costs when you don't start.
        </div>
      </div>

      <div className="wb-mission">
        The financial industry charges two and twenty — 2% of your money every year plus 20% of your profits — because most people never learn how money actually works.
        This tab exists to change that. It doesn't matter if you're 16 with $500, or 25 with a professional contract, or 40 who's never thought about this before.
        The math works the same for everyone. The only variable is when you start and how disciplined you are once you do.
        <br /><br />
        Use these calculators. Run the numbers. Then ask yourself what you're going to do differently.
      </div>

      <div className="wb-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`wb-nav-btn${active === t.id ? ' active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'cost'     && <OpportunityCost />}
      {active === 'compound' && <CompoundVisualizer />}
      {active === 'age'      && <AgeIsYourAsset />}
      {active === 'career'   && <CareerWindow />}
      {active === 'nil'      && <NilDealSimulator />}
    </div>
  )
}
