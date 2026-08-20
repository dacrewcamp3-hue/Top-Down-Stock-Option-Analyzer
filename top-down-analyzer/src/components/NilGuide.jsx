import { useState } from 'react'
import { useEmaNames, setEmaName, resetEmaNames, EMA_DEFAULTS } from '../utils/emaNames'
import './NilGuide.css'

// ── Market regime engine ──────────────────────────────────────────────────────
function detectRegime(vixData, breadthData) {
  const vix     = vixData?.current ?? null
  const verdict = breadthData?.verdict ?? 'UNKNOWN'
  const spy     = breadthData?.spy

  if (!vix && verdict === 'UNKNOWN') return 'UNKNOWN'
  if (vix > 30 || verdict === 'HOSTILE') return 'BEAR'
  if (vix > 22 || verdict === 'LEANING BEARISH') return 'DEFENSIVE'
  if (spy?.above200 === false && spy?.above65 === false) return 'DEFENSIVE'
  if (vix != null && vix < 18 && (verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH')) return 'BULL'
  return 'NEUTRAL'
}

const REGIME = {
  BULL: {
    label: 'BULL RUN', color: '#10b981', bg: '#021a0d', border: '#10b981',
    tagline: 'Markets are healthy. Best time to add to your ETF positions.',
    body: 'In a bull market your foundation ETFs rise, dividends keep compounding, and your income layer builds faster. Stay invested, add monthly, and let compound growth do the heavy lifting. This is the environment where patient investors build serious wealth.',
    playbook: ['Add to VTI/VOO/QQQ on a fixed monthly schedule', 'Reinvest all dividends automatically (DRIP on)', 'Add to SCHD for growing income', 'Keep 3–6 months of expenses in cash before investing more'],
    leading: ['Technology (XLK)', 'Consumer Discretionary (XLY)', 'Industrials (XLI)'],
    avoid: ['Utilities', 'Bonds'],
  },
  NEUTRAL: {
    label: 'MIXED MARKET', color: '#f59e0b', bg: '#1a1000', border: '#d97706',
    tagline: 'Mixed signals — your ETFs and dividends hold steady. Keep your schedule.',
    body: 'The market is in a decision phase. Your ETF and dividend positions are designed for this — they don\'t need you to do anything. Keep your monthly contributions running on schedule. This is exactly why you build the foundation first: it runs on autopilot while the market figures itself out.',
    playbook: ['Continue monthly ETF contributions on schedule', 'Let dividends reinvest automatically', 'Do not make emotional decisions about your positions', 'Review your holdings and make sure DRIP is active on every position'],
    leading: ['Healthcare (XLV)', 'Consumer Staples (XLP)', 'Utilities (XLU)'],
    avoid: ['High-beta tech', 'Small caps'],
  },
  DEFENSIVE: {
    label: 'DEFENSIVE MODE', color: '#f97316', bg: '#1a0800', border: '#ea580c',
    tagline: 'Elevated risk. Your ETFs are weathering it — do not sell.',
    body: 'Volatility is rising. The most important thing right now: do not sell your ETF positions. That would lock in losses and guarantee you miss the recovery. Your dividend payments continue regardless. This is the moment the foundation earns its keep — it was built to survive exactly this.',
    playbook: ['Do NOT sell your core ETF positions under any circumstances', 'Dividends keep depositing — reinvest every one of them', 'If you have new cash, this is actually a good time to buy more', 'Rotate any new money toward defensive ETFs: XLV, XLU, XLP'],
    leading: ['Healthcare (XLV)', 'Utilities (XLU)', 'Consumer Staples (XLP)'],
    avoid: ['Growth tech', 'Consumer Discretionary'],
  },
  BEAR: {
    label: 'BEAR MARKET', color: '#ef4444', bg: '#1a0505', border: '#b91c1c',
    tagline: 'Market declining. Holders who stay invested win. This is a buying opportunity.',
    body: 'Bear markets feel terrible. They are also temporary and they are when the most wealth gets transferred from people who panic-sell to people who stay invested. If you keep buying your ETFs monthly during a bear market you acquire more shares at lower prices — which means the recovery is dramatically more powerful for you.',
    playbook: ['Hold all index ETF positions — do not sell into fear', 'Keep buying monthly — you\'re getting shares at a discount', 'Every dividend reinvested buys more shares than it did before the decline', 'This is exactly why long-term investing beats short-term thinking'],
    leading: ['Healthcare (XLV)', 'Energy (XLE)', 'Gold ETFs (GLD)'],
    avoid: ['Technology', 'Consumer Discretionary'],
  },
  UNKNOWN: {
    label: 'DATA LOADING', color: '#4a6888', bg: '#0a1020', border: '#1e3456',
    tagline: 'Fetch breadth data to see the current market regime.',
    body: 'Click the Refresh Breadth button in the Scanner tab. Once loaded, this panel shows exactly what the market is doing and adjusts your guidance for ETF buying, dividend investing, and positioning.',
    playbook: ['Go to Scanner tab → click Refresh Breadth', 'Review the Foundation pyramid below while you wait', 'Start building your ETF watchlist: VTI, VOO, SCHD, QQQ'],
    leading: [], avoid: [],
  },
}

// ── Wealth Pyramid ────────────────────────────────────────────────────────────
const PYRAMID = [
  {
    layer: '01', col: '#10b981', bg: '#021a0d', border: '#065f46',
    title: 'Foundation — Index ETFs',
    sub: 'VTI · VOO · QQQ · The first money you invest goes here. No exceptions.',
    pct: '60–70% of your portfolio',
    desc: 'Index ETFs automatically own a piece of hundreds or thousands of companies at once. One share of VTI gives you ownership in 3,500+ US companies simultaneously. They cost almost nothing to hold (0.03%/year), require zero stock-picking skill, and have returned 8–12% annually over long periods. Warren Buffett has publicly stated he recommends a low-cost S&P 500 index fund for most people — and he would know. This layer does not require you to understand individual companies, follow earnings reports, or make any decisions once it\'s set up.',
    rule: 'Set up automatic monthly contributions. Add on every dip. Never sell because of fear. The machine runs itself.',
  },
  {
    layer: '02', col: '#06b6d4', bg: '#011520', border: '#0e4060',
    title: 'Income Layer — Dividend ETFs & Dividend Stocks',
    sub: 'SCHD · VIG · KO · JNJ · PG · O · Your money pays you every quarter.',
    pct: '20–30% of your portfolio',
    desc: 'Dividend ETFs like SCHD hold 100 quality companies that pay you cash every quarter just for being a shareholder. Reinvesting those dividends — DRIP — means every payment automatically buys more shares, which pay more dividends, which buy more shares. This compounding of income is where ordinary investors build extraordinary wealth over time. Individual dividend stocks (KO, JNJ, PG) are the graduate level of this layer — companies so financially durable they\'ve raised their dividend every year for 25–68 consecutive years through every recession, crash, and crisis.',
    rule: 'Turn DRIP on for every dividend position. Never manually collect dividends. The machine feeds itself.',
  },
  {
    layer: '03', col: '#a855f7', bg: '#110820', border: '#5b21b6',
    title: 'Individual Stocks — Quality Names You Understand',
    sub: 'AAPL · MSFT · NVDA · AMZN · Only after layers 01 and 02 are working.',
    pct: 'Max 5% per stock · Total < 20%',
    desc: 'Once your ETF and dividend foundation is established and running on autopilot, individual growth stocks can accelerate your returns. The rules are strict: only buy businesses you can explain in one sentence, only invest in companies you\'d hold for 10 years, and never put more than 5% of your total portfolio in a single company no matter how confident you feel. The reason ETFs come first is that most professional fund managers underperform simple index funds over 10-year periods. Individual stock-picking is genuinely hard — the foundation is your safety net.',
    rule: 'Maximum 5% per position. If you can\'t explain the business in one sentence, don\'t buy it. The foundation carries the weight — individual stocks accelerate it.',
  },
]

// ── Foundation ETFs ───────────────────────────────────────────────────────────
const ETFS = [
  {
    ticker: 'VTI', name: 'Vanguard Total Market ETF', col: '#06b6d4',
    layer: 'Foundation', fee: '0.03%/yr', yield: '~1.5%',
    why: 'Owns a piece of every publicly traded US company — over 3,500 stocks in one share. The most diversified single investment available to anyone. One company going bankrupt costs you less than 0.03% of your position because there are 3,499 others covering for it.',
    best: 'The first ETF most people should buy. Set up automatic monthly contributions and add consistently regardless of what the market is doing.',
    nums: { '5yr': '$36,740', '10yr': '$91,470', '20yr': '$294,510', '30yr': '$745,175', note: 'At $500/month, 8% avg return' },
  },
  {
    ticker: 'VOO', name: 'Vanguard S&P 500 ETF', col: '#10b981',
    layer: 'Foundation', fee: '0.03%/yr', yield: '~1.4%',
    why: 'Tracks the 500 largest US companies. Warren Buffett recommends this fund for most people and has arranged for 90% of his estate to go into it after he dies. Has returned approximately 10% annually over decades. What you own: Apple, Microsoft, Amazon, Nvidia, Google, and 495 others.',
    best: 'Core foundation, interchangeable with VTI. If your brokerage offers fractional shares of VOO, this is the simplest starting point.',
    nums: { '5yr': '$36,740', '10yr': '$91,470', '20yr': '$294,510', '30yr': '$745,175', note: 'At $500/month, 8% avg return' },
  },
  {
    ticker: 'QQQ', name: 'Invesco Nasdaq 100 ETF', col: '#a855f7',
    layer: 'Growth Add-on', fee: '0.20%/yr', yield: '~0.6%',
    why: 'Top 100 largest non-financial Nasdaq companies — heavily weighted toward technology: Apple, Microsoft, Nvidia, Amazon, Meta. Higher growth potential than VOO but also more volatile. When you own QQQ, you own the most innovative companies in the world through a single share.',
    best: 'Growth layer on top of VTI/VOO. Add after your core foundation is established. QQQ gives you concentrated tech exposure without having to pick individual winners.',
    nums: { '5yr': '$36,740', '10yr': '$91,470', '20yr': '$294,510', '30yr': '$745,175', note: 'At $500/month — historically QQQ returned closer to 12-14%' },
  },
  {
    ticker: 'SCHD', name: 'Schwab US Dividend ETF', col: '#f59e0b',
    layer: 'Income Layer', fee: '0.06%/yr', yield: '~3.5%',
    why: 'Holds 100 high-quality dividend-paying US companies screened for financial strength, consistent dividends, and earnings growth. Pays quarterly dividends AND has grown its payout every year since inception. The best single fund for building a growing income stream without picking individual stocks.',
    best: 'Your primary income ETF. Pair with VTI/VOO as your dividend-generating layer. Every quarter you receive cash — reinvest it automatically via DRIP to buy more shares.',
    nums: { '5yr': '$36,740', '10yr': '$91,470', '20yr': '$294,510', '30yr': '$745,175', note: 'At $500/month, ~10% avg total return' },
  },
  {
    ticker: 'VIG', name: 'Vanguard Dividend Growth ETF', col: '#f97316',
    layer: 'Income Layer', fee: '0.06%/yr', yield: '~1.8%',
    why: 'Holds companies with a track record of GROWING their dividend every year — not just paying it. Lower current yield than SCHD but the dividend grows faster. Companies like Apple, Microsoft, JPMorgan Chase, and Visa. A growing dividend is the hallmark of a financially healthy business.',
    best: 'Complements SCHD in your income layer. SCHD gives you higher current income; VIG gives you faster-growing income. Together they provide stable dividends that grow over time.',
    nums: { '5yr': '$36,740', '10yr': '$91,470', '20yr': '$294,510', '30yr': '$745,175', note: 'At $500/month, ~9-10% avg total return' },
  },
  {
    ticker: 'XLV', name: 'Health Care Select SPDR ETF', col: '#ec4899',
    layer: 'Defensive Hedge', fee: '0.09%/yr', yield: '~1.6%',
    why: 'Holds top healthcare companies: UnitedHealth, Johnson & Johnson, Eli Lilly, AbbVie, Pfizer. Healthcare is one of the most recession-resistant sectors — people need medicine and medical care in every economic environment, regardless of what the stock market is doing.',
    best: 'Defensive layer. Useful in DEFENSIVE or BEAR market regimes. Provides stability when growth sectors sell off. A 10–15% allocation here smooths out your overall portfolio during market downturns.',
    nums: null,
  },
]

// ── Dividend Stocks (for Income layer detail) ─────────────────────────────────
const DIVIDEND_STOCKS = [
  {
    ticker: 'SCHD', name: 'Schwab US Dividend ETF', yield: '~3.5%', streak: '10+ yrs', col: '#f59e0b', isEtf: true,
    what: 'This is the ETF version of dividend investing — 100 quality dividend-paying companies in one fund. You get diversification AND income. Has grown its quarterly payout every year since it launched. The simplest, safest way to start building a dividend income stream.',
    lesson: 'Start here. SCHD is what most people should hold before considering individual dividend stocks. One fund, 100 companies, growing income.',
  },
  {
    ticker: 'KO', name: 'Coca-Cola', yield: '~3.1%', streak: '62 years', col: '#ef4444', isEtf: false,
    what: 'People buy Coke in every country, in every recession, in every bear market. Warren Buffett has owned it since 1988. Sells over 2 billion servings of its products every single day. The brand alone is worth more than most companies\' entire operations.',
    lesson: 'Brands people use daily generate cash in every economic environment — that cash funds a growing dividend for 62 consecutive years and counting.',
  },
  {
    ticker: 'JNJ', name: 'Johnson & Johnson', yield: '~3.2%', streak: '62 years', col: '#06b6d4', isEtf: false,
    what: 'Medical devices, pharmaceuticals, and consumer health products sold globally. Has raised its dividend every single year for over 62 consecutive years — through every recession, financial crisis, and pandemic in that time.',
    lesson: 'Healthcare demand is non-cyclical. People need medicine regardless of what the stock market does. That reliability funds 62 years of consecutive dividend growth.',
  },
  {
    ticker: 'PG', name: 'Procter & Gamble', yield: '~2.5%', streak: '68 years', col: '#10b981', isEtf: false,
    what: 'Makes Tide, Pampers, Gillette, Oral-B, and 65 other household brands. Longest active dividend growth streak of any major company. Through the 2008 financial crisis, the dot-com crash, 9/11, COVID-19 — the dividend went up every single year.',
    lesson: 'People buy soap, shampoo, and diapers every week regardless of the economy. That predictability is the foundation of 68 years of rising dividends.',
  },
  {
    ticker: 'O', name: 'Realty Income Corp.', yield: '~5.5%', streak: '30 years', col: '#a855f7', isEtf: false,
    what: 'A Real Estate Investment Trust (REIT) owning 15,000+ commercial properties (Walgreens, 7-Eleven, Dollar General) and paying dividends MONTHLY. Legally required to distribute 90% of taxable income. When you own Realty Income, you\'re a landlord collecting rent — 12 times a year.',
    lesson: 'Monthly dividends make compounding visible. You see your money working every single month. REITs are built to pay income.',
  },
]

// ── Compound Growth Table Data ────────────────────────────────────────────────
// Pre-computed at 8% annual return (monthly compounding)
// FV = PMT × [(1+r)^n − 1] / r  where r = 0.08/12
const GROWTH_TABLE = [
  { monthly: 100,  invested5: 6000,   invested10: 12000,  invested20: 24000,  invested30: 36000,
    value5: 7348,  value10: 18294,    value20: 58902,     value30: 149035,    divIncome30: 373  },
  { monthly: 250,  invested5: 15000,  invested10: 30000,  invested20: 60000,  invested30: 90000,
    value5: 18370, value10: 45735,    value20: 147255,    value30: 372588,    divIncome30: 932  },
  { monthly: 500,  invested5: 30000,  invested10: 60000,  invested20: 120000, invested30: 180000,
    value5: 36740, value10: 91470,    value20: 294510,    value30: 745175,    divIncome30: 1863 },
  { monthly: 1000, invested5: 60000,  invested10: 120000, invested20: 240000, invested30: 360000,
    value5: 73480, value10: 182940,   value20: 589020,    value30: 1490350,   divIncome30: 3726 },
]

// ── Spend vs Invest Data ──────────────────────────────────────────────────────
const SPEND_VS_INVEST = [
  { spend: '$1,000 on sneakers', spendFuture: '~$0 in 10 years', investFuture: '$2,159 in 10 years', investFuture30: '$10,063 in 30 years' },
  { spend: '$1,000 on jewelry', spendFuture: '~$200 in 10 years', investFuture: '$2,159 in 10 years', investFuture30: '$10,063 in 30 years' },
  { spend: '$5,000 on a car upgrade', spendFuture: '~$1,500 in 10 years', investFuture: '$10,795 in 10 years', investFuture30: '$50,313 in 30 years' },
  { spend: '$10,000 lifestyle spend', spendFuture: '~$0–$2,000 in 10 years', investFuture: '$21,590 in 10 years', investFuture30: '$100,627 in 30 years' },
]

// ── Glossary ──────────────────────────────────────────────────────────────────
const CONCEPTS = [
  { term: 'Index ETF', def: 'A fund that holds a basket of stocks matching a market index. One share of VTI gives you ownership in 3,500+ companies. Automatically diversified, professionally managed, and available to anyone with a brokerage account. The single most accessible wealth-building tool for a first-time investor.' },
  { term: 'Expense Ratio', def: 'The annual fee an ETF charges, expressed as a percentage. VTI charges 0.03% — that\'s $0.30 per year on every $1,000 invested. Fees compound negatively over time, so even a 1% annual difference costs you tens of thousands of dollars over a 30-year horizon. Always choose the lowest fee fund.' },
  { term: 'Dividend', def: 'A cash payment a company makes to shareholders, usually quarterly. If you own 100 shares of Coca-Cola and it pays a $0.46/share quarterly dividend, you receive $46 that quarter — simply for owning the shares. The payment comes from the company\'s profits.' },
  { term: 'DRIP — Dividend Reinvestment Plan', def: 'Instead of receiving dividends as cash, you automatically buy more shares with every payment. Dividends buy shares → those shares pay more dividends → which buy more shares. Turn DRIP on for every position and never turn it off. This is where compounding acceleration comes from.' },
  { term: 'Dollar-Cost Averaging (DCA)', def: 'Investing a fixed amount on a fixed schedule regardless of price. $500/month into VTI means you automatically buy more shares when prices are low and fewer when they\'re high. This removes emotion from investing and is the correct long-term approach — especially for a young investor who has 30+ years of growth ahead.' },
  { term: 'Dividend Yield', def: 'Annual dividends paid divided by the stock price. A $100 stock paying $3/year has a 3% yield. Note: a higher yield is not always better. Some companies pay unsustainable dividends funded by debt. Focus on companies and ETFs with growing dividends backed by growing earnings.' },
  { term: 'Dividend Aristocrat', def: 'A company that has raised its dividend every single year for at least 25 consecutive years. Procter & Gamble has raised its dividend for 68 consecutive years — through the 2008 financial crisis, dot-com crash, 9/11, and COVID-19. This consistency is only possible with an extremely durable business model.' },
  { term: 'REIT (Real Estate Investment Trust)', def: 'A company that owns income-producing real estate and is legally required to distribute at least 90% of its taxable income as dividends. REITs let you collect rent income from commercial properties without buying property. Realty Income (O) pays dividends monthly — 12 times a year.' },
  { term: 'Compound Growth', def: 'Earning returns on your previous returns. $10,000 at 10%/year: after year 1 you have $11,000. Year 2 earns 10% on $11,000 = $12,100. The growth accelerates every year without you doing anything. After 30 years: $174,000 from the original $10,000 — without adding a single dollar more.' },
  { term: 'NIL — Name, Image, Likeness', def: 'The legal right for college athletes to earn money from their personal brand, sponsorships, endorsements, social media, and appearances. NIL income is taxable as ordinary income — set aside 25–30% for taxes immediately. Investing the rest is how NIL money creates generational wealth instead of a one-time event.' },
  { term: 'Brokerage Account', def: 'An account that lets you buy and sell stocks, ETFs, and other investments. Fidelity, Schwab, and Vanguard are the most recommended for long-term investors. Free to open, no minimum deposit at most platforms. For young investors, also consider opening a Roth IRA — your gains grow tax-free forever.' },
  { term: 'Roth IRA', def: 'A retirement account where you invest after-tax money and your gains grow COMPLETELY TAX-FREE. You can contribute up to $7,000/year (as of 2024). Every dollar of dividend and growth inside a Roth IRA is never taxed — for the rest of your life. Opening a Roth IRA as a young athlete is one of the highest-impact financial decisions you can make.' },
]

// ── EMA Family Framework ──────────────────────────────────────────────────────
const EMA_FAMILY = [
  {
    ema: 8, name: 'Sister', role: 'Momentum', col: '#06b6d4',
    desc: 'Sister (EMA 8) is the most reactive — she feels every move first. She shows pure short-term momentum. When price is above Sister and she\'s rising, momentum is strong. She\'s the first to warn you something is changing. If Sister is flattening while price pushes higher, that\'s a sign of exhaustion.',
    signal: 'Price accelerating away from EMA 8 = possible exhaustion, be cautious. Price bouncing off EMA 8 while trending = momentum still strong, stay in.',
  },
  {
    ema: 15, name: 'Dad', role: 'Entries & Exits', col: '#f97316',
    desc: 'Dad (EMA 15) confirms what Sister felt. He doesn\'t react to noise — he validates the move. When price and Sister are both above Dad and all three are rising, that\'s your entry signal. When they cross below Dad, that\'s the exit. Dad is the difference between a real signal and a fake-out.',
    signal: 'EMA 8 crossing above EMA 15 with price = entry signal. EMA 8 crossing below EMA 15 = exit. Dad confirms what Sister first detected.',
  },
  {
    ema: 30, name: 'Brothers', role: 'Direction', col: '#84cc16',
    desc: 'The Brothers (EMA 30) are the middle ground. Crossing them either up or down reveals the direction of the larger move. Above the Brothers = bullish bias. Below them = bearish bias. When price crosses the middle, it tells you where momentum is pointing — this is your directional filter.',
    signal: 'Price crossing above EMA 30 = bullish direction confirmed. Price crossing below EMA 30 = bearish direction. The Brothers reveal the trend bias.',
  },
  {
    ema: 65, name: 'Mom', role: 'Support & Resistance', col: '#a855f7',
    desc: 'Mom (EMA 65) is dependable and grounded — she doesn\'t move around much. She acts as major support in an uptrend and major resistance in a downtrend. A pullback to Mom and a bounce is a high-conviction entry signal — the trend is intact. If price breaks through Mom and can\'t reclaim her, the trend may be over.',
    signal: 'Pullback to EMA 65 and bounce = strong entry signal in the trend direction. Breaking below EMA 65 and staying there = significant warning the trend is changing.',
  },
  {
    ema: 200, name: 'Grandma', role: 'The Foundation', col: '#eab308',
    desc: 'Without Grandma, there would be no Mom. EMA 200 is the bedrock of everything. Above Grandma = bull market territory — be aggressive, stay invested, add to positions. Below Grandma = bear market territory — reduce exposure, protect capital, be patient. The largest institutions in the world watch the 200 EMA. It\'s the single most important moving average on any chart.',
    signal: 'Above EMA 200 = long-term bull market, invest confidently and stay invested. Below EMA 200 = long-term bear market, protect capital and be selective.',
  },
]

function fmt(n) {
  return '$' + n.toLocaleString()
}

export default function NilGuide({ vixData, breadthData }) {
  const [openConcept,  setOpenConcept]  = useState(null)
  const [openEtf,      setOpenEtf]      = useState(null)
  const [openDiv,      setOpenDiv]      = useState(null)
  const [activeLayer,  setActiveLayer]  = useState(null)
  const [growthRow,    setGrowthRow]    = useState(2)  // default to $500/month row
  const [openEma,      setOpenEma]      = useState(null)
  const [editingNames, setEditingNames] = useState(false)
  const emaNames = useEmaNames()

  const regime  = detectRegime(vixData, breadthData)
  const rc      = REGIME[regime]
  const vix     = vixData?.current
  const verdict = breadthData?.verdict
  const spyChg  = breadthData?.spy?.chg20
  const gr      = GROWTH_TABLE[growthRow]

  return (
    <div className="ng-root">

      {/* ── 1. Market Regime Banner ── */}
      <div className="ng-regime" style={{ background: rc.bg, borderColor: rc.border }}>
        <div className="ng-regime-top">
          <div className="ng-regime-left">
            <div className="ng-regime-eyebrow">Current Market Regime</div>
            <div className="ng-regime-label" style={{ color: rc.color }}>{rc.label}</div>
            <div className="ng-regime-tagline">{rc.tagline}</div>
          </div>
          <div className="ng-regime-indicators">
            {vix != null && (
              <div className="ng-ind">
                <span className="ng-ind-label">VIX</span>
                <span className="ng-ind-val" style={{ color: vix < 18 ? '#10b981' : vix < 25 ? '#f59e0b' : '#ef4444' }}>
                  {vix.toFixed(1)}
                </span>
                <span className="ng-ind-sub">{vixData.level}</span>
              </div>
            )}
            {verdict && verdict !== 'UNKNOWN' && (
              <div className="ng-ind">
                <span className="ng-ind-label">Breadth</span>
                <span className="ng-ind-val" style={{ color: verdict === 'FAVORABLE' || verdict === 'LEANING BULLISH' ? '#10b981' : verdict === 'HOSTILE' || verdict === 'LEANING BEARISH' ? '#ef4444' : '#f59e0b', fontSize: '11px' }}>
                  {verdict}
                </span>
              </div>
            )}
            {spyChg != null && (
              <div className="ng-ind">
                <span className="ng-ind-label">SPY 20-Day</span>
                <span className="ng-ind-val" style={{ color: spyChg >= 0 ? '#10b981' : '#ef4444' }}>
                  {spyChg >= 0 ? '+' : ''}{spyChg}%
                </span>
              </div>
            )}
          </div>
        </div>
        <p className="ng-regime-body">{rc.body}</p>
        <div className="ng-regime-cols">
          <div className="ng-regime-col">
            <div className="ng-col-hdr">Playbook for This Regime</div>
            {rc.playbook.map((p, i) => (
              <div key={i} className="ng-playbook-item">
                <span className="ng-pb-dot" style={{ background: rc.color }} />
                <span>{p}</span>
              </div>
            ))}
          </div>
          {rc.leading.length > 0 && (
            <div className="ng-regime-col">
              <div className="ng-col-hdr">Leading Sectors Now</div>
              {rc.leading.map((s, i) => (
                <div key={i} className="ng-sector-tag" style={{ borderColor: rc.color, color: rc.color }}>{s}</div>
              ))}
              {rc.avoid.length > 0 && (
                <>
                  <div className="ng-col-hdr ng-col-hdr-avoid">Reduce Exposure</div>
                  {rc.avoid.map((s, i) => (
                    <div key={i} className="ng-sector-tag ng-sector-avoid">{s}</div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Opening Hook ── */}
      <div className="ng-hook-card">
        <div className="ng-hook-eyebrow">For First-Generation Wealth Builders</div>
        <div className="ng-hook-title">This Check Could Still Be Paying You in 40 Years</div>
        <p className="ng-hook-body">
          Most people who receive a large amount of money young spend it on what feels good right now —
          and then it's gone. The athletes who change their family's financial situation for generations
          are the ones who ask one question first: <strong style={{ color: '#10b981' }}>what happens if I invest this instead?</strong>
        </p>
        <p className="ng-hook-body">
          This guide is built around one truth: you don't need to pick stocks, time the market, or become a
          financial expert. You need to start investing in index ETFs consistently, reinvest your dividends automatically,
          and let compound growth do the work for 20–30 years. The math is almost unfair to anyone who starts at 18.
        </p>
        <div className="ng-hook-stats">
          <div className="ng-hook-stat">
            <div className="ng-hook-stat-num" style={{ color: '#10b981' }}>$745K</div>
            <div className="ng-hook-stat-lbl">Investing $500/month from age 18 → age 48</div>
          </div>
          <div className="ng-hook-stat">
            <div className="ng-hook-stat-num" style={{ color: '#06b6d4' }}>$1,863</div>
            <div className="ng-hook-stat-lbl">Monthly passive dividend income from that portfolio</div>
          </div>
          <div className="ng-hook-stat">
            <div className="ng-hook-stat-num" style={{ color: '#a855f7' }}>$180K</div>
            <div className="ng-hook-stat-lbl">Total amount you actually invested to get there</div>
          </div>
        </div>
      </div>

      {/* ── 3. Spend vs Invest ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">The Decision Nobody Tells You About</div>
        <div className="ng-section-title">Every Dollar You Spend Is a Dollar That Stops Working for You</div>
        <p className="ng-section-intro">
          Spending isn't wrong — enjoying your money matters. But most young athletes don't see the real cost of spending.
          When you buy something that depreciates, you don't just lose the money you spent — you lose everything
          that money would have become. Here's what the same money looks like in two different futures.
        </p>
        <div className="ng-svi-grid">
          {SPEND_VS_INVEST.map((s, i) => (
            <div key={i} className="ng-svi-row">
              <div className="ng-svi-spend">
                <div className="ng-svi-label">SPEND</div>
                <div className="ng-svi-item">{s.spend}</div>
                <div className="ng-svi-future" style={{ color: '#ef4444' }}>{s.spendFuture}</div>
              </div>
              <div className="ng-svi-vs">vs</div>
              <div className="ng-svi-invest">
                <div className="ng-svi-label" style={{ color: '#10b981' }}>INVEST IN VTI</div>
                <div className="ng-svi-item">{s.spend}</div>
                <div className="ng-svi-future" style={{ color: '#10b981' }}>{s.investFuture}</div>
                <div className="ng-svi-future30">{s.investFuture30}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="ng-svi-note">
          Assumes 8% average annual return (close to the historical S&P 500 average). Spending is not wrong —
          but knowing this math before you decide changes the quality of your choices.
        </div>
      </div>

      {/* ── 4. Investment Pyramid ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">Build in Order — Don't Skip Layers</div>
        <div className="ng-section-title">The Wealth Pyramid — Foundation First, Always</div>
        <p className="ng-section-intro">
          Your money goes into these three layers in order. Layer 1 is not optional. Layer 2 starts as soon as
          Layer 1 is running. Individual stocks come only after the foundation is established and generating income.
          Tap each layer to learn exactly what belongs there and why.
        </p>
        <div className="ng-pyramid">
          {PYRAMID.map(layer => {
            const isOpen = activeLayer === layer.layer
            return (
              <div
                key={layer.layer}
                className={`ng-pyramid-layer${isOpen ? ' ng-pyramid-open' : ''}`}
                style={{ borderColor: layer.border, background: isOpen ? layer.bg : undefined }}
                onClick={() => setActiveLayer(isOpen ? null : layer.layer)}
              >
                <div className="ng-pyramid-hdr">
                  <div className="ng-pyramid-num" style={{ color: layer.col }}>{layer.layer}</div>
                  <div className="ng-pyramid-meta">
                    <div className="ng-pyramid-title" style={{ color: layer.col }}>{layer.title}</div>
                    <div className="ng-pyramid-sub">{layer.sub}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                    <div className="ng-pyr-pct" style={{ color: layer.col }}>{layer.pct}</div>
                    <div className="ng-pyramid-arrow" style={{ color: layer.col }}>{isOpen ? '▲' : '▼'}</div>
                  </div>
                </div>
                {isOpen && (
                  <div className="ng-pyramid-body">
                    <p className="ng-pyramid-desc">{layer.desc}</p>
                    <div className="ng-pyramid-rule">
                      <span className="ng-rule-icon">Rule:</span> {layer.rule}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 5. Foundation ETFs ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">Layer 01 — Foundation</div>
        <div className="ng-section-title">The ETFs That Build Your Foundation</div>
        <p className="ng-section-intro">
          These six funds cover the entire wealth-building stack: total market core, growth layer,
          dividend income layer, and defensive hedge. You don't need all six at once —
          start with VTI or VOO, add SCHD for income, then QQQ for growth. Tap any to learn what it is and when to use it.
        </p>
        <div className="ng-etf-grid">
          {ETFS.map(etf => {
            const isOpen = openEtf === etf.ticker
            return (
              <div
                key={etf.ticker}
                className={`ng-etf-card${isOpen ? ' ng-etf-open' : ''}`}
                style={{ borderColor: isOpen ? etf.col : undefined }}
                onClick={() => setOpenEtf(isOpen ? null : etf.ticker)}
              >
                <div className="ng-etf-top">
                  <div>
                    <div className="ng-etf-ticker" style={{ color: etf.col }}>{etf.ticker}</div>
                    <div className="ng-etf-name">{etf.name}</div>
                  </div>
                  <div className="ng-etf-right">
                    <div className="ng-etf-type" style={{ color: etf.col }}>{etf.layer}</div>
                    <div className="ng-etf-fee">{etf.fee} · {etf.yield} yield</div>
                  </div>
                </div>
                {isOpen && (
                  <div className="ng-etf-detail">
                    <p className="ng-etf-why">{etf.why}</p>
                    <div className="ng-etf-best">
                      <span className="ng-etf-best-icon">When to use:</span> {etf.best}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="ng-etf-tip">
          <strong>The simple starting portfolio for a NIL athlete:</strong> Start with VTI or VOO as your core (set up a monthly auto-invest).
          Add SCHD to start building dividend income. Add QQQ after those two are running.
          Together these three give you the entire US market, a steady dividend stream, and a technology tilt — all for under 0.10%/year in fees.
        </div>
      </div>

      {/* ── 6. Compound Growth Table ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">Layer 01–02 — The Math That Changes Everything</div>
        <div className="ng-section-title">What Monthly ETF Investing Actually Builds Over Time</div>
        <p className="ng-section-intro">
          This is not speculation — this is the math of compound interest applied to consistent monthly investing.
          Select a monthly amount below and see what your portfolio grows to, how much you actually invested,
          and how much monthly dividend income that portfolio generates at a 3% yield.
          Assumes 8% average annual return (close to the historical S&P 500 average).
        </p>

        {/* Monthly amount selector */}
        <div className="ng-growth-selector">
          <div className="ng-growth-sel-label">Monthly Investment Amount</div>
          <div className="ng-growth-pills">
            {GROWTH_TABLE.map((row, i) => (
              <button
                key={row.monthly}
                className={`ng-growth-pill${growthRow === i ? ' ng-growth-pill-active' : ''}`}
                onClick={() => setGrowthRow(i)}
              >
                {fmt(row.monthly)}/mo
              </button>
            ))}
          </div>
        </div>

        {/* Growth timeline */}
        <div className="ng-growth-timeline">
          {[
            { label: '5 Years', age: 'Age 23', invested: gr.invested5, value: gr.value5 },
            { label: '10 Years', age: 'Age 28', invested: gr.invested10, value: gr.value10 },
            { label: '20 Years', age: 'Age 38', invested: gr.invested20, value: gr.value20 },
            { label: '30 Years', age: 'Age 48', invested: gr.invested30, value: gr.value30 },
          ].map((col, i) => {
            const gain = col.value - col.invested
            const mult = (col.value / col.invested).toFixed(1)
            return (
              <div key={i} className="ng-growth-col">
                <div className="ng-growth-col-hdr">
                  <div className="ng-growth-years">{col.label}</div>
                  <div className="ng-growth-age">(starting at 18 → {col.age})</div>
                </div>
                <div className="ng-growth-value">{fmt(col.value)}</div>
                <div className="ng-growth-invested">You invested: {fmt(col.invested)}</div>
                <div className="ng-growth-gain" style={{ color: '#10b981' }}>
                  Market earned: +{fmt(gain)}
                </div>
                <div className="ng-growth-mult" style={{ color: '#f59e0b' }}>
                  {mult}× your money
                </div>
              </div>
            )
          })}
        </div>

        {/* Dividend income projection */}
        <div className="ng-div-income-card">
          <div className="ng-dic-hdr">
            <span className="ng-dic-icon">💰</span>
            <div>
              <div className="ng-dic-title">After 30 years at {fmt(gr.monthly)}/month</div>
              <div className="ng-dic-sub">Your portfolio generates this in passive dividend income every month (at 3% yield):</div>
            </div>
          </div>
          <div className="ng-dic-amount">
            <span className="ng-dic-num">{fmt(gr.divIncome30)}</span>
            <span className="ng-dic-per">/ month</span>
          </div>
          <div className="ng-dic-body">
            That's {fmt(gr.divIncome30 * 12)}/year — without selling a single share and without doing any work.
            You built this by investing {fmt(gr.monthly)}/month consistently while your dividends reinvested automatically.
            At age 48, this income continues growing and paying you for the rest of your life.
          </div>
        </div>
      </div>

      {/* ── 7. Income Layer — Dividends ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">Layer 02 — Income Layer</div>
        <div className="ng-section-title">Dividend ETFs and Dividend Stocks — Your Money Pays You</div>
        <p className="ng-section-intro">
          Start with SCHD — the dividend ETF that does the hard work for you. Once that's running,
          individual dividend stocks (Coca-Cola, Johnson & Johnson, Procter & Gamble, Realty Income) are
          the next level. Every one of these has raised its dividend payment for 10–68 consecutive years.
          Reinvesting every dividend automatically is the single most important habit in this entire guide.
          Tap any to learn why it belongs in your income layer.
        </p>

        <div className="ng-div-grid">
          {DIVIDEND_STOCKS.map(d => {
            const isOpen = openDiv === d.ticker
            return (
              <div
                key={d.ticker}
                className={`ng-div-card${isOpen ? ' ng-div-open' : ''}`}
                style={{ borderColor: isOpen ? d.col : undefined }}
                onClick={() => setOpenDiv(isOpen ? null : d.ticker)}
              >
                <div className="ng-div-top">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="ng-div-ticker" style={{ color: d.col }}>{d.ticker}</div>
                      {d.isEtf && <span className="ng-div-etf-badge">ETF — Start Here</span>}
                    </div>
                    <div className="ng-div-name">{d.name}</div>
                  </div>
                  <div className="ng-div-right">
                    <div className="ng-div-yield" style={{ color: d.col }}>{d.yield}</div>
                    <div className="ng-div-streak">{d.streak} of growth</div>
                  </div>
                </div>
                {isOpen && (
                  <div className="ng-div-detail">
                    <p className="ng-div-what">{d.what}</p>
                    <div className="ng-div-lesson">
                      <span className="ng-lesson-icon">Key lesson:</span> {d.lesson}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* DRIP Explainer */}
        <div className="ng-drip-card">
          <div className="ng-drip-hdr">Why DRIP (Dividend Reinvestment) Changes Everything</div>
          <div className="ng-drip-cols">
            <div className="ng-drip-col">
              <div className="ng-drip-col-hdr" style={{ color: '#10b981' }}>WITH DRIP ON</div>
              <div className="ng-drip-scenario">
                $10,000 in SCHD at 3.5% yield · 8% total return · 20 years
              </div>
              <div className="ng-drip-result" style={{ color: '#10b981' }}>$46,610</div>
              <div className="ng-drip-detail">Dividends reinvested every quarter into more shares, which pay more dividends</div>
            </div>
            <div className="ng-drip-col">
              <div className="ng-drip-col-hdr" style={{ color: '#ef4444' }}>WITH DRIP OFF</div>
              <div className="ng-drip-scenario">
                $10,000 in SCHD at 3.5% yield · collected as cash · 20 years
              </div>
              <div className="ng-drip-result" style={{ color: '#ef4444' }}>$26,530</div>
              <div className="ng-drip-detail">Portfolio grew at capital appreciation only. Dividends spent or sitting in cash.</div>
            </div>
          </div>
          <div className="ng-drip-delta">
            DRIP produces <strong style={{ color: '#10b981' }}>$20,080 more</strong> over 20 years from the same $10,000 starting position —
            that's 75% more wealth from one setting you turn on and never touch again.
          </div>
        </div>
      </div>

      {/* ── 8. Individual Stocks ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">Layer 03 — Individual Stocks</div>
        <div className="ng-section-title">Individual Stocks: The Third Layer, Built on a Solid Foundation</div>
        <p className="ng-section-intro">
          Once your ETF foundation and dividend income layer are running, individual stocks can accelerate
          your returns. But there are rules — and they exist because most professional fund managers
          underperform simple index ETFs over 10+ years. Individual stock picking is harder than it looks.
        </p>
        <div className="ng-rules-grid">
          {[
            { icon: '5%', rule: 'Maximum 5% of your total portfolio in any single company — no exceptions, no matter how confident you feel.' },
            { icon: '10yr', rule: 'Only buy companies you would hold for 10 years. If you can\'t imagine owning it for a decade, don\'t buy it for a quarter.' },
            { icon: '1 line', rule: 'You must be able to explain the business model in one sentence. If you can\'t explain how they make money, you don\'t understand the investment.' },
            { icon: '< 20%', rule: 'Total individual stocks across your entire portfolio should stay under 20%. The foundation carries the weight — individual stocks accelerate it.' },
          ].map((r, i) => (
            <div key={i} className="ng-rule-card">
              <div className="ng-rule-icon-big">{r.icon}</div>
              <div className="ng-rule-text">{r.rule}</div>
            </div>
          ))}
        </div>
        <div className="ng-etf-tip" style={{ borderLeftColor: '#a855f7' }}>
          <strong>The shortcut for Layer 3:</strong> If you want exposure to quality growth stocks without the research burden,
          QQQ gives you Apple, Microsoft, Nvidia, Amazon, and Meta in one ETF share at 0.20%/year.
          Most people build more wealth through QQQ than by trying to pick those same stocks individually —
          with none of the company-specific risk.
        </div>
      </div>

      {/* ── 8.5. EMA Family ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">Reading the Chart — The EMA Framework</div>
        <div className="ng-section-title">Moving Averages Decoded — Your Market Family</div>
        <p className="ng-section-intro">
          Most people learn moving averages as numbers on a chart. The clearest way to make them permanent
          in your memory is to connect each one to someone with a real job and real weight in your life.
          Every EMA has a personality. Learn the family, and you'll never need to look up what an EMA means again.
        </p>
        <div className="ng-ema-fam-quote">
          "Without Grandma (200), there would be no Mom (65). The whole family is connected." EMA 200 defines
          the regime. EMA 65 builds on it for major support and resistance. EMA 30 reveals direction.
          EMA 15 confirms entries and exits. EMA 8 feels every move first.
        </div>
        {/* ── Personalize names ── */}
        <div className="ng-ema-edit-wrap">
          <button
            className={`ng-ema-edit-toggle${editingNames ? ' active' : ''}`}
            onClick={() => setEditingNames(v => !v)}
          >
            {editingNames ? '▲ Done' : '✎ Personalize your EMA names'}
          </button>
          {editingNames && (
            <div className="ng-ema-edit-panel">
              <div className="ng-ema-edit-hint">
                Give each EMA a name that sticks for <em>you</em> — a person, a concept, anything memorable.
                Changes take effect everywhere in the app instantly.
              </div>
              <div className="ng-ema-edit-grid">
                {EMA_FAMILY.map(em => (
                  <div key={em.ema} className="ng-ema-edit-row">
                    <div className="ng-ema-edit-badge" style={{ color: em.col, borderColor: em.col }}>
                      EMA {em.ema}
                    </div>
                    <div className="ng-ema-edit-role">{em.role}</div>
                    <input
                      className="ng-ema-edit-input"
                      value={emaNames[em.ema]}
                      placeholder={EMA_DEFAULTS[em.ema]}
                      maxLength={20}
                      spellCheck={false}
                      onChange={e => setEmaName(em.ema, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <button className="ng-ema-edit-reset" onClick={resetEmaNames}>
                Reset to defaults
              </button>
            </div>
          )}
        </div>

        <div className="ng-ema-fam-grid">
          {EMA_FAMILY.map(em => {
            const isOpen = openEma === em.ema
            const displayName = emaNames[em.ema]
            return (
              <div
                key={em.ema}
                className={`ng-ema-card${isOpen ? ' ng-ema-open' : ''}`}
                style={{ borderLeftColor: em.col }}
                onClick={() => setOpenEma(isOpen ? null : em.ema)}
              >
                <div className="ng-ema-top">
                  <div className="ng-ema-badge" style={{ color: em.col, borderColor: em.col }}>EMA {em.ema}</div>
                  <div className="ng-ema-names">
                    <div className="ng-ema-name" style={{ color: em.col }}>{displayName}</div>
                    <div className="ng-ema-role">{em.role}</div>
                  </div>
                  <div className="ng-ema-arrow" style={{ color: em.col }}>{isOpen ? '▲' : '▼'}</div>
                </div>
                {isOpen && (
                  <div className="ng-ema-detail">
                    <p className="ng-ema-desc">{em.desc}</p>
                    <div className="ng-ema-signal" style={{ borderLeftColor: em.col }}>
                      <span className="ng-ema-sig-lbl">Signal:</span> {em.signal}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="ng-ema-hierarchy">
          <div className="ng-ema-hier-label">Foundation → Fastest</div>
          <div className="ng-ema-hier-row">
            {[...EMA_FAMILY].reverse().map((em, i, arr) => (
              <span key={em.ema}>
                <span style={{ color: em.col, fontWeight: 800 }}>{emaNames[em.ema]} ({em.ema})</span>
                {i < arr.length - 1 && <span className="ng-ema-hier-sep"> → </span>}
              </span>
            ))}
          </div>
          <div className="ng-ema-hier-note">
            {emaNames[200]} (200) sets the regime — above is bull territory, below is bear.
            {' '}{emaNames[65]} (65) marks the major levels of support and resistance.
            {' '}{emaNames[30]} (30) reveals the directional bias.
            {' '}{emaNames[15]} (15) confirms your entry and exit.
            {' '}{emaNames[8]} (8) is first to feel every move — your momentum gauge.
          </div>
        </div>
      </div>

      {/* ── 9. Glossary ── */}
      <div className="ng-section">
        <div className="ng-section-eyebrow">Financial Literacy</div>
        <div className="ng-section-title">Key Terms — Plain English, No Jargon</div>
        <div className="ng-glossary">
          {CONCEPTS.map(c => (
            <div key={c.term} className="ng-gloss-item" onClick={() => setOpenConcept(openConcept === c.term ? null : c.term)}>
              <div className="ng-gloss-top">
                <span className="ng-gloss-term">{c.term}</span>
                <span className="ng-gloss-arrow">{openConcept === c.term ? '▲' : '▼'}</span>
              </div>
              {openConcept === c.term && <div className="ng-gloss-def">{c.def}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── 11. Family Note ── */}
      <div className="ng-family-card">
        <div className="ng-family-eyebrow">For Parents, Guardians, and Family Members</div>
        <div className="ng-family-title">The Order Matters More Than the Amount</div>
        <p className="ng-family-body">
          NIL money is genuinely life-changing — but only when managed in the right sequence.
          The most dangerous thing a young athlete can do with a large check is skip straight to exciting
          investments, luxury spending, or giving generously to family before the foundation is built.
          The wealth pyramid on this page exists to prevent exactly that.
        </p>
        <p className="ng-family-body">
          The first move with any NIL income: set aside 25–30% for taxes immediately (NIL income is taxable as ordinary income).
          Then establish a core index ETF position — VTI or VOO — with automatic monthly contributions.
          This single action, started early and maintained consistently, builds substantial wealth without requiring
          expertise, active management, or any decisions beyond "keep contributing."
        </p>
        <p className="ng-family-body">
          Add SCHD next to create a growing dividend income stream. Turn DRIP on for every position and never turn it off.
          The compound growth table above shows exactly where consistent monthly investing leads.
          A student-athlete investing just $250/month of their NIL earnings from age 18 has
          <strong style={{ color: '#10b981' }}> $372,000 and $932/month in passive dividend income by age 48</strong> —
          from a foundation that cost $90,000 in total contributions.
        </p>
        <p className="ng-family-body">
          Individual stocks become appropriate in Layer 3 — only after the ETF foundation and dividend income layer are
          established and running automatically. The three-layer pyramid is the entire strategy. It is not optional,
          and it is not something to revisit later. It is the first thing, done right, immediately.
        </p>
      </div>

    </div>
  )
}
