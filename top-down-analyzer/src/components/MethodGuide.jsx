import { useState } from 'react'
import { useEmaNames, setEmaName, resetEmaNames, EMA_DEFAULTS } from '../utils/emaNames'
import './MethodGuide.css'

const STEPS = [
  {
    num: '01',
    title: 'The Game: Top-Down Analysis',
    short: 'Know what game you\'re playing before you touch an entry',
    body: `This is a game. Not in a reckless way — in the way that every professional system has rules, scoring, and consequences. You are trying to maximize money on the upside when the market wants to go up, and maximize money on the downside when it wants to go down. Both directions are opportunities. Neither direction is your identity.

The way you win this game is not by being right more often than you're wrong. It is by finding high-probability setups, sizing correctly, and letting the math work. One A+ setup with proper execution beats six mediocre entries that break even. This app is built around that principle.

Top-down analysis is the framework: you start at the highest timeframe (weekly), work down to the daily, then to the 4H entry trigger. Every layer is a gate. Every gate has to open before you're allowed to enter. If any gate is locked — the trade doesn't happen.

THE TRADE SCORE (0–100): Every ticker you load gets a unified quality score calculated across 12 dimensions: Confluence (25 pts), Weekly Alignment (15 pts), RSI Signal (12 pts), ADX Trend Strength (13 pts), MA Stack (10 pts), Setup Grade (12 pts), IV Conditions (8 pts), Volume (5 pts), Sector RS (5 pts), Insider Flow (5 pts), Squeeze Risk (±8 pts), and Wyckoff Structural Alignment (±10 pts). The Wyckoff factor is particularly important: a MARKDOWN or DISTRIBUTION phase opposing a CALL signal deducts up to 8 points and triggers a visible warning banner — it flags that you're trading a counter-trend bounce, not a true trend entry. 78+ = Strong. 60–77 = Confirmed. 42–59 = Developing. Below 42 = wait for a better setup.

THE THREE UNLOCK GATES (shown on the Brief tab): These are the three sequential conditions that must be met before a trade is active. Gate 1 is weekly structure. Gate 2 is daily momentum. Gate 3 is the intraday entry trigger. All three must show ✓ green before the banner reads TRADE UNLOCKED. One locked gate = no trade, regardless of how good the others look.

MACRO ECONOMIC CALENDAR (shown at the top of the Brief): Before every trade, the app shows you upcoming FOMC (Fed rate decisions), CPI (inflation), NFP (jobs), GDP, and PPI releases in the next 21 days. This is critical. Options pricing reflects event risk — buying premium into a Fed decision means you're paying for the volatility, and you'll often experience IV crush immediately after even if you're directionally correct. EXTREME RISK events within 5 days = stand aside or reduce size by 50%+. HIGH RISK events within 10 days = plan your expiry date to clear the event. A technically perfect setup in the wrong macro environment is still a bad trade.

HISTORICAL PROBABILITY (shown below the score breakdown): After loading a ticker with a signal, the app runs two years of historical backtest data filtered to your exact conditions — same direction, same setup grade, same ADX level — and shows you the options win rate for that specific combination. This converts the Trade Score from a composite grade into an actual probability: "Under these conditions, options have historically won X% of the time over Y signals." A win rate below 50% under current conditions is a reason to step back, even if the Trade Score looks decent.

THE EXIT PLAN (shown below the recommended option): Every trade needs a stop, a scale-out target, and a full exit target set BEFORE you enter. The app calculates all three automatically using ATR (stop at 1.5×), Fibonacci extensions (Target 1 at 50% scale-out, Target 2 at full exit), and volume profile levels where available. These are the exact levels you put into your broker the moment you decide to trade — not after the trade is open.

THE BRIEF (your default landing view): When you load a ticker, open on the Brief sub-tab. Everything you need is on one screen: Trade Score gauge, the three unlock gates, Macro Calendar, Wyckoff structure check, Signal Intelligence cards, the recommended option, Exit Plan, Historical Probability, and the Stock Entry plan. This view is designed to deliver a full decision in under 30 seconds.

Data loads in two phases. Phase 1 — price data and all signals — appears within one second of loading. Phase 2 — IV rank, options chain, earnings date — enriches the recommendation cards automatically in the background. You'll see "enriching..." while this happens. The direction signal is always in Phase 1. Act on the direction; the enriched cards just sharpen the execution.`,
    rule: 'Read the Trade Score before anything else. Below 42, the setup isn\'t ready. Check the Macro Calendar — if FOMC or CPI is within 5 days, size down or stand aside. Check the Historical Probability — below 50% means the edge isn\'t there. All three gates must be green before entering.',
  },
  {
    num: '02',
    title: 'Gate 1: The Weekly Director',
    short: 'The weekly chart sets the only direction you\'re allowed to trade',
    body: `The weekly chart is Gate 1. It does one thing: tells you the direction. You don't time entries on the weekly. You don't look for patterns or candle formations. You ask a single binary question — is this stock in a weekly uptrend or a weekly downtrend — and the answer determines everything downstream.

A bullish weekly reads: price above the 15 EMA, the 8 EMA above the 15 EMA (EMA stack in order), RSI holding above 44, and ADX above 21 with +DI above −DI. Every one of those conditions matters. An RSI below 44 on the weekly means the buyers don't have momentum yet. An ADX below 21 means there is no real trend — just drift. Neither of those lets you buy calls.

A bearish weekly is the mirror: price below the 15 EMA, EMAs stacked bearishly, RSI below 57, ADX above 21 with −DI leading. This is the only environment where you trade puts.

WEEKLY ALIGNMENT SCORE: The Trade Score gives 15 points to weekly alignment — the largest share after confluence. It evaluates whether the price is on the right side of the weekly 8 and 15 EMAs, whether the EMA stack is ordered correctly (8 above 15 for bulls, 15 above 8 for bears), and whether all three align with the trade direction. A fully aligned weekly scores 15. A mixed weekly scores 4. An opposing weekly scores 0 — and that 15-point deficit will almost certainly pull the total score below the entry threshold.

REGIME BLOCK: If VIX is above 28 AND the weekly structure is net bearish, the app automatically blocks all CALL signals with a REGIME BLOCK banner. You are not allowed to buy calls in a high-volatility, bearish-weekly environment. Options pricing reflects the fear — you are paying maximum premium for a trade going against the macro. Sit out, trade puts, or wait for the regime to clear.

The Alignment Matrix in the Confluence sub-tab shows all timeframes in a grid. Green weekly = Gate 1 open. Red weekly = Gate 1 locked, full stop.`,
    rule: 'No calls without a bullish weekly. No puts without a bearish weekly. A mixed weekly score of 4/15 means wait — do not force direction on a MIXED signal.',
  },
  {
    num: '03',
    title: 'Gate 2: Daily Momentum',
    short: 'The daily confirms the trend is alive and trending now',
    body: `The weekly tells you direction. The daily tells you whether momentum is alive right now. Gate 2 needs both — the daily gate from the confluence analysis, and ADX confirming the trend has real force.

On the daily, you're watching: is the stock in a clear pullback within a trend, or is it topping and rolling over? The Move Classifier (visible on the Brief) measures the depth of the current retracement as a Fibonacci percentage. A tight pullback (23.6%–38.2%) with declining volume and price holding above the 8 or 15 EMA is the cleanest entry zone — the trend is resting, not reversing. A deep pullback (61.8%–78.6%) requires a 15 EMA reclaim before entry. A full reversal (78.6%+) means the trend may be done — wait for a new base to form.

RSI ON THE DAILY (12 pts in Trade Score): RSI(14) with an EMA(20) signal line applied to RSI values — not price. This is your momentum gate inside the daily. Bullish triggers: RSI crosses above EMA(20) or crosses above 44. Bearish triggers: RSI crosses below 43 or crosses below EMA(20). The RSI gauge on the Swing tab shows this in real time — the pip is the RSI value, the vertical line is the EMA signal line. When the pip is above the line and above 44 (for calls) or below the line and below 43 (for puts), momentum is with you.

MA STACK (10 pts in Trade Score): The daily EMA stack (8, 15, 30, 65, 200) tells you how well organized the trend is. A fully bullish stack has all five in descending order with price above all of them. Each misaligned EMA represents a potential overhead resistance. The 30 EMA is the midfield: above it, bulls control the range. Below it, bears do. Gate 2 scores higher when the stack is ordered and price is on the right side of the 30.

ADX FILTER: An ADX reading below 21 means there is no real trend — only noise. The strongest Gate 2 setup has ADX above 25, rising, with DI aligned correctly. That combination scores 13/13 in the Trade Score's trend strength dimension. ADX below 15 scores nothing, regardless of what direction the daily appears to be pointing.`,
    rule: 'No entry if ADX < 21. Check the RSI gauge — RSI must be above the EMA signal line and above 44 for calls, below the line and below 43 for puts.',
  },
  {
    num: '04',
    title: 'Gate 3: The Entry Trigger',
    short: '4H two-bar rule and ORB — these are the only entries',
    body: `Gate 3 is the intraday trigger. Even when the weekly is bullish and the daily is lined up perfectly, you do not enter until Gate 3 fires. Entry without a trigger is guessing — and guessing is not part of this system.

THE 4H TWO-BAR RULE: This is your primary swing entry. The rule is simple: you need two consecutive 4-hour bars closing on the correct side of the 8 EMA. For a bull entry (CALL), two consecutive 4H bars closing above the 8 EMA. For a bear entry (PUT), two consecutive bars closing below it. One bar doesn't count — it filters out false breaks and noise. Two bars means the momentum has shifted and held.

This rule is auto-detected by the app every time you load a ticker. The Swing tab shows the current bar and previous bar status (Above 8 EMA / Below 8 EMA). When both show the same result, Gate 3 is confirmed. The app shows "4H confirmed" in the Brief header. Until both bars confirm, Gate 3 shows "1 BAR" (partial) — which means watch, not enter.

THE ORB (OPENING RANGE BREAKOUT): During market hours, this is your secondary trigger. The first 15-minute candle of the trading day sets the range: ORH (range high) and ORL (range low). A confirmed close above ORH with a retest and bounce = bull entry. Below ORL with a retest = bear entry. The app tracks both live. The ORB signal fires in the verdict bar at the bottom of the screen the moment a break and retest registers. An ORB break automatically opens Gate 3 on the Brief — even without the 4H two-bar rule being met.

THE ENTRY: When Gate 3 opens, you don't delay. You execute the trade plan the app has already built for you — the recommended option (Brief tab) and the Stock Entry plan below it. Both are live and ready the moment you load the ticker.

SETUP GRADE: Gate 3 is when the Setup Grade becomes meaningful. A+ means 80%+ of all swing checks are passing — 4H confirmed, RSI signal, ADX, MA stack, volume, patterns. This grade directly affects DTE recommendations for options and signals that all the executor conditions are stacked in your favor.`,
    rule: 'Two 4H bars on the same side of the 8 EMA = Gate 3 open. One bar = watch, not trade. ORB break + retest also unlocks Gate 3. No entry before Gate 3 fires.',
  },
  {
    num: '05',
    title: 'Stock Trade Entry: Sizing for Maximum Upside',
    short: 'Shares, stops, targets, and exactly how much you make per move',
    body: `This app is not just an options tool. Every signal that fires for a call also fires for a long stock trade. Every put signal also fires for a short. The stock entry plan appears on the Brief tab alongside the options recommendation — both carry equal weight in this system.

WHY STOCK AND OPTIONS TOGETHER: Options provide leverage. A single option contract controls 100 shares for a fraction of the cost. But leverage cuts both ways — time decay, IV crush, and bid/ask spreads all work against you. Stock trades have no time decay. They're cleaner, more forgiving of timing, and easier to scale. The optimal approach is to run both in proportion to the setup quality: high-conviction A+ setups justify options. Solid B setups might be stock-only. The decision depends on IV rank, DTE, and how much time you want to give the trade.

THE STOCK ENTRY CARD: After loading a ticker, the Brief shows a STOCK TRADE card with:
— Entry at market price
— Stop loss at the primary EMA (15 EMA by default, 8 EMA for aggressive, 65 EMA for wide) or 1.5× ATR fallback if no EMA is valid
— Target 1 and Target 2 at Fibonacci extensions
— Position size in shares (calculated from your account size and risk %)
— Dollar amount at each target: exactly what you pocket in dollars if the stock hits T1 or T2

POSITION SIZING: Every calculation uses your account size and risk percentage from the Risk Panel settings. The formula: max dollar risk = account × risk%. Shares = floor(max risk / stop distance). The card shows the exact share count, total position value, and dollar risk — all live, recalculated every time you load a new ticker.

DOLLAR TARGETS: This is the number that matters. Not a percentage, not an R:R ratio — actual dollars. At Target 1 (first Fibonacci extension), the card shows exactly "+$X" in your direction color. At Target 2, "+$Y". The R:R ratio is shown as X:1 next to each target. You always know what winning looks like before you enter.

STOP LOGIC: The preferred stop is the 15 EMA for longs (below price) and 15 EMA for shorts (above price). If price is too close to the 15 EMA to provide meaningful distance, the app falls back to the 8 EMA (tighter, more aggressive) or the 65 EMA (wider, for high-volatility names). If none are valid, 1.5× ATR is the fallback. The stop is always meaningful — not arbitrary.`,
    rule: 'Know your dollar target before entry. If Target 1 is less than 2:1 R:R from your stop, the setup doesn\'t meet the minimum. Stock and options are both valid — the setup quality determines which you use.',
  },
  {
    num: '06',
    title: 'Options Execution: Strike, DTE, Greeks',
    short: 'Picking the right option and understanding what you\'re buying',
    body: `Once the three gates are open, the Brief tab builds your options trade automatically. The recommendation targets delta 0.35–0.65, DTE 21+, and accounts for your IV rank before sizing.

DELTA (Δ): How much the option moves per $1 in stock. A delta of 0.50 means the option gains $50 per contract per $1 move. Target 0.35–0.65. Below 0.35 = lottery ticket (needs a big move). Above 0.65 = mostly stock exposure, not leverage.

THETA (Θ): The daily dollar cost of holding the option from time decay alone. Always working against you. FAST decay (3%+ per day) means you need the move quickly. SLOW (below 1.2%) gives you time. DTE 21+ keeps theta manageable on swing trades. Never buy weekly options for directional swings — theta explodes in the final 7 days and turns your trade into a coin flip.

VEGA (ν): How much the option moves per 1% change in IV. When you buy and IV drops after entry, vega works against you even if the stock goes the right way. High vega + high IV rank = dangerous combination. When IV rank is above 60, the app shows a spread recommendation instead of a naked option.

IV RANK (8 pts in Trade Score): Below 30 = cheap premium, favorable to buy. 30–60 = standard sizing. Above 60 = expensive, the app shows debit or credit spread alternatives automatically. IV rank below 40 is the sweet spot for buying premium outright.

THE 4-STEP EXIT PLAN (every option recommendation card shows this):
Step 1 — STOP at −40%: If the option drops 40% from your entry premium, close all contracts. No exceptions.
Step 2 — BREAKEVEN at +50%: When up 50%, move stop to entry price. You can no longer lose on this trade.
Step 3 — HOUSE MONEY at +100%: When the option doubles, sell enough contracts to recover your full initial cost. The remaining contracts cost you nothing.
Step 4 — TRAIL at 25%: Free contracts trail at 25% below the running high. Let them run until the trail stops you out.

EXPIRATION COMPARISON (Options tab → Expirations): The Expirations sub-view shows the ATM strike across every available expiry side-by-side — premium, delta, daily theta cost, implied volatility, and call breakeven for each. Use this to choose your hold time before you enter. A 7-day expiry costs less but decays faster; a 45-day expiry costs more but gives the trade room to breathe. Every column header and individual cell has a hover tooltip explaining the value. The sweet spot for swing entries is 21–45 DTE — enough time for the setup to develop, not so much that premium becomes excessive.

SCALING IN: Enter 50% at signal. Add 50% only when the stock has moved 1%+ in your direction AND the option has not already run +25%. Never chase.`,
    rule: "Delta 0.35–0.65. DTE 21+. IV rank below 60 for outright. Stop at −40%, breakeven at +50%, house money at +100%, trail at 25%. Use the Expirations view to compare hold-time cost before entry — the theta column shows exactly what each calendar day costs you at each expiry.",
  },
  {
    num: '07',
    title: 'Market Structure: GEX, IV Term Structure & Breadth',
    short: 'What the options market knows that the chart doesn\'t',
    body: `The Scanner tab and the Market Breadth panel on the Brief add two layers the chart can't show: where market makers are positioned (GEX), and whether the broader market is providing tailwind or headwind (breadth).

GAMMA EXPOSURE (GEX): Market makers who sell options hedge their exposure by buying and selling the underlying. The GEX chart in the Options tab shows net gamma at every strike. Green bars = call-dominated strikes (dealers buy dips, creating floors). Red bars = put-dominated strikes (dealers sell rallies, creating ceilings). The gamma flip — the level where dealer behavior reverses — is your most important structural level. Above the flip: markets are stable and mean-reverting. Below it: moves accelerate. Always know whether you're trading above or below the gamma flip.

IV TERM STRUCTURE: Normal (upward sloping) = far-dated options cost more than near-dated, standard condition. Inverted (near-term IV above back-month IV) = market pricing a near-term catalyst. Almost always means earnings or macro event. Do not buy single-leg options through an inverted term structure.

MARKET BREADTH (Brief tab → Market Breadth panel): The NYSE advance-decline line, TRIN, SPY/IWM EMA position, and VIX level combine into a market verdict: FAVORABLE, LEANING BULLISH, MIXED, LEANING BEARISH, or HOSTILE. When the market is HOSTILE, your win rate on individual CALL setups drops — the tide is going out. When it's FAVORABLE, the wind is at your back. This verdict is always visible on the Brief tab without navigating away.

SECTOR ROTATION (5 pts in Trade Score): Your ticker's relative strength versus its sector ETF, and the sector ETF versus SPY. A stock outperforming its sector while the sector outperforms SPY is a double confirmation of relative momentum. The Sectors sub-tab in Scanner shows all 11 SPDR sector ETFs ranked by 20-day performance and EMA position — so you can find the strongest sectors before picking the ticker inside them.

SIGNAL SCANNER (Scanner → Signal Scan): Runs the full confluence analysis on every ticker in your watchlist simultaneously. Results show signal direction, score, and key flags. Load the top-scoring ticker directly from the scanner into the Brief for full analysis. This is the daily hunt — the goal is to find the A+ setup before the move, not after.`,
    rule: 'Enter calls above the gamma flip. Avoid directional options with an inverted term structure. Check market breadth before entering — HOSTILE breadth reduces CALL win rates even on clean individual setups.',
  },
  {
    num: '08',
    title: 'Insider Activity & Smart Money',
    short: 'SEC Form 4 filings tell you what insiders know',
    body: `The Analyze tab → Insider view pulls real SEC Form 4 filings from EDGAR. Form 4 is required within two business days whenever a corporate officer, director, or 10%+ shareholder buys or sells company stock.

WHY THIS MATTERS: Insiders rarely buy their own stock unless they believe it is going higher. Multiple insiders buying simultaneously — especially after a pullback — is one of the most reliable fundamental signals available. It is not about any single purchase. It is about clustering. When your technical CALL signal aligns with CEO and CFO open-market purchases in the last 30 days, conviction rises. This is Smart Money confirming your read.

INSIDER FLOW IN THE TRADE SCORE (5 pts): Net buying in the last 90 days that aligns with your direction scores the full 5 points. Mixed signals (buys and sells) score 2. Net selling against your direction scores 0.

WHAT TO LOOK FOR: Open-market purchases made at market prices carry the most signal. Routine option exercises and pre-scheduled 10b5-1 plan sales carry almost none — they're automated and pre-committed, not discretionary decisions. The app flags transaction types automatically. Focus on rows labeled "Buy" or "Purchase" — not "Option Exercise."

SHORT INTEREST: On the Brief, the Short Interest card shows what percentage of the float is sold short and the days-to-cover ratio. Heavy short interest (20%+) in a stock with a CALL signal raises a specific opportunity: if the stock breaks out, shorts must cover — buying into the rally and amplifying the move. The SQUEEZE POTENTIAL badge fires when both short % and days-to-cover are elevated. This is not a reason to enter alone, but it is a reason to hold longer when the move starts.

FILING LINKS: Each insider filing row has a direct SEC ↗ link to the actual Form 4 on SEC.gov. Click it, verify the transaction type and share count, and draw your own conclusion. Don't rely on aggregated verdicts. The raw filing is always two clicks away.`,
    rule: 'Insider data adds conviction — it does not create a trade. A CALL signal plus net insider buying in the last 90 days = raise size. A CALL signal with heavy insider selling = use minimum size or skip.',
  },
  {
    num: '09',
    title: 'Keeping Score: Journal & Backtest',
    short: 'The feedback loop that makes the system improve over time',
    body: `This is where the game metaphor becomes most literal: you are keeping score. Not just wins and losses — the reasoning behind each decision. The traders who compound don't just track outcomes. They track whether their execution matched the system's edge. Writing it down is the feedback loop.

THE THOUGHT JOURNAL (Trades tab): Every trade deserves a written record of why you took it. Not a P&L tracker — the market handles that. A record of your reasoning. Why did this setup meet the standard? What did the chart tell you? Why did you exit when you did? This record catches the habits that numbers don't show: entering before Gate 3 fires, sizing up out of emotion instead of conviction, exiting winners too early and holding losers too long. Each entry is stored locally with a date and optional ticker tag. Review your last three entries before entering any new trade — the patterns in your writing become the patterns in your execution.

HOW TO USE THE JOURNAL: Open the Trades tab and click "+ New Entry." Tag the ticker. Write one to three sentences on why the setup met the standard, what your thesis is, and what would invalidate it. When you exit, add a second entry on the same ticker: what actually happened, whether your reasoning held, and what you'd do differently. The entry/exit pair is more valuable than any performance stat — it's the only record of whether your judgment is improving.

BACKTEST (Backtest tab): Before you trade any setup live, run the backtest. It replays the exact same weekly + daily confluence signals over two years of historical price data — the same math the live app uses, applied to history. You see the signal win rate, average move per signal, compounded equity curve, max consecutive losses, and how each grade (A+/A/B) performed individually.

DATE-RANGE FILTER: The backtest has a "From / To" date picker. Use this to test the strategy against specific market regimes — a 2022 bear market, a 2023 bull run, a high-volatility period — not just the full two-year window. If the signals work in both bull and bear conditions, the edge is regime-independent. If they only work in one type of market, you know when to reduce size.

OPTIONS P&L SIMULATION: The backtest's Options view simulates actual option trades on every historical signal — Black-Scholes pricing, grade-adaptive exits (A+ exits at +200%, B exits at +100%), IV crush modeled in, fee comparison, Kelly sizer, and scale-out vs. outright comparison. This proves the edge before any real capital is at risk.

THE FEEDBACK LOOP: Signal fires → Trade Journal records the reasoning → Backtest validates the historical edge → Risk Panel sets the size → RiskGuard watches the session. Every layer feeds the next. The journal is the human layer — it catches what algorithms can't: whether your judgment is improving or deteriorating over time.`,
    rule: 'Log every trade in the journal — not to track P&L, but to track your reasoning. Read your last three entries before any new entry. Run the backtest on each new ticker before going live — use the date-range filter to test the edge against the regime you are in right now, not just the default two-year average.',
  },
  {
    num: '10',
    title: 'Behavioral Guardrails: Staying In The Game',
    short: 'The system that stops you before discipline breaks down',
    body: `Everything in this system is designed to give you an edge. This step is designed to make sure you don't throw it away.

Most traders don't lose because their signals are wrong. They lose because they break their own rules — after a loss streak, after a big win, when boredom sets in, or when the market is moving fast and FOMO overrides discipline. RiskGuard is the behavioral layer that watches for those moments and fires a banner before you act.

RISKGUARD BANNERS: RiskGuard reads your current session's open positions and closed trade history in real time. Each banner is a specific trigger with a specific instruction:

— DAILY LOSS LIMIT (red): You've lost 3% or more of your account today. The session is over. No new entries regardless of signal quality. Every trader has days where the market is moving against their setups and adding a third or fourth losing trade compounds a bad day into a week-destroying loss. The 3% daily limit exists precisely for those days.

— MAX POSITIONS (red): You already have 4 open positions. The fifth trade is never allowed. Spreading attention across too many simultaneous positions degrades execution on all of them. Four is the operational limit.

— LOSS STREAK — 3 CONSECUTIVE LOSSES (red): Three losses in a row is not bad luck. It is information. Either your execution degraded, the regime shifted against your bias, or you're forcing setups that aren't there. Mandatory stop. Do not re-enter until you have reviewed the three closed trades and identified exactly what the issue was.

— WIN STREAK — 5 OR MORE WINS (yellow): Counterintuitive but real. After 5+ consecutive wins, overconfidence is the primary risk. Position sizing creeps up, setup quality standards creep down. Yellow banner means size down on the next trade regardless of signal score. Let the system decide the trade. You decide nothing about sizing.

— TIME-OF-DAY WARNING (yellow): The first 30 minutes of the trading day (9:30–10:00 AM ET) and the final 30 minutes (3:30–4:00 PM ET) have the highest noise and the worst fills. Spreads widen, volume spikes, algo activity dominates. These windows are for watching, not entering. The banner fires if you attempt a paper trade during those windows.

HOW TO READ A BANNER: Red means stop, full stop. No exceptions, no override. Yellow means size down and proceed with caution — not proceed at full size. The answer to a red banner is never "this setup is so good I'll ignore it." The system has seen hundreds of your previous decisions. The banner knows something you don't right now.

WHAT RISKGUARD DOESN'T DO: It won't stop you from making a bad trade if all your guardrails are green. It's not a signal filter. It's a session-level behavioral check. The signals, gates, and Trade Score handle setup quality. RiskGuard handles you.`,
    rule: 'Red banner = no trade, no exceptions. Yellow = size down, not skip. Check RiskGuard before every entry — not just when something feels wrong. The guardrails exist for the moments when everything feels right and you\'re about to make your worst decision.',
  },
]

const EMA_META = [
  { ema: 8,   role: 'Momentum — first to feel every move',     col: '#06b6d4' },
  { ema: 15,  role: 'Entries & exits — confirms the signal',   col: '#f97316' },
  { ema: 30,  role: 'Direction — the midfield test',           col: '#84cc16' },
  { ema: 65,  role: 'Support & resistance — the major levels', col: '#a855f7' },
  { ema: 200, role: 'The foundation — above = bull territory', col: '#eab308' },
]

function EmaPersonalizer() {
  const [open, setOpen] = useState(false)
  const emaNames = useEmaNames()

  return (
    <div className="mg-ema-personalizer">
      <button
        className={`mg-ema-toggle${open ? ' mg-ema-toggle-open' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <span className="mg-ema-toggle-icon">✎</span>
        Personalize your EMA names
        <span className="mg-ema-toggle-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mg-ema-panel">
          <div className="mg-ema-hint">
            Give each EMA a name that sticks for you — a family member, a concept, anything memorable.
            Changes apply everywhere in the app instantly.
          </div>
          <div className="mg-ema-grid">
            {EMA_META.map(em => (
              <div key={em.ema} className="mg-ema-row">
                <div className="mg-ema-badge" style={{ color: em.col, borderColor: em.col }}>
                  EMA {em.ema}
                </div>
                <div className="mg-ema-role">{em.role}</div>
                <input
                  className="mg-ema-input"
                  value={emaNames[em.ema]}
                  placeholder={EMA_DEFAULTS[em.ema]}
                  maxLength={20}
                  spellCheck={false}
                  onChange={e => setEmaName(em.ema, e.target.value)}
                />
              </div>
            ))}
          </div>
          <button className="mg-ema-reset" onClick={resetEmaNames}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  )
}

function PhilosophyBlock() {
  return (
    <div className="mg-philosophy">
      <div className="mg-phil-eyebrow">Why This App Exists</div>
      <div className="mg-phil-body">
        <p>
          The standard deal offered by Wall Street is called "two and twenty" — 2% of your money every year in management fees, plus 20% of every dollar you make in profit. On a $50,000 account that returns 20% in a year, the manager collects $1,000 before the market opens, then takes another $2,000 from your winnings. You net $7,000. They collect $3,000. For your own money, in an account you fund, carrying risk you absorb.
        </p>
        <p>
          That arrangement made sense decades ago when retail investors had no access to real-time data, no options flow, no sector analysis, no way to backtest a signal. That world no longer exists. The same market data the professionals use is available to anyone. The same options chains, the same SEC filings, the same historical price data — all of it. This app is built on that access.
        </p>
        <p>
          But this is more than just access to data. This is a game — and like every game worth playing, it rewards systems over impulse, consistency over brilliance, and discipline over emotion. The goal is not to be right more than you're wrong. The goal is to maximize money on the upside when conditions are right, maximize money on the downside when conditions are right, and sit completely out when they aren't. Both directions are opportunities. The market doesn't care which way it moves — you profit from both.
        </p>
        <div className="mg-phil-anchor">
          Making money is not magic. It is a system, applied with discipline, compounded over time.
        </div>
        <p>
          Every feature in this app exists to help you keep score in that game: the Trade Score tells you the strength of each setup before you enter. The three unlock gates tell you whether all conditions are met. The stock entry card tells you exactly what you make at each target in dollars. The performance dashboard tracks your wins, losses, streaks, and whether your grade discipline is translating into better outcomes. The backtest proves the edge before you risk real capital.
        </p>
        <p>
          The signals don't make you money. The rules do. The signals tell you when the rules align. Your job is to execute — every time, without exception, without emotion. If Gate 1 is locked, you sit out. If the Trade Score is below 42, you wait. If the stop hits −40%, you close. These are not suggestions. They are the rules of the game. The traders who pay two and twenty for the rest of their lives are not less intelligent — they just never built the discipline to run their own system.
        </p>
        <p>
          You built it. Now compound it.
        </p>
      </div>
      <div className="mg-phil-footer">
        This app is proof that you don't need to pay anyone two and twenty to access the market.
        You need to understand what you're looking at — and the discipline to act on it consistently.
      </div>
    </div>
  )
}

function Step({ step, open, onToggle }) {
  return (
    <div className={`mg-step${open ? ' mg-step-open' : ''}`}>
      <button className="mg-step-header" onClick={onToggle}>
        <span className="mg-step-num">{step.num}</span>
        <div className="mg-step-titles">
          <span className="mg-step-title">{step.title}</span>
          <span className="mg-step-short">{step.short}</span>
        </div>
        <span className="mg-step-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mg-step-body">
          <div className="mg-step-text">
            {step.body.split('\n\n').map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="mg-step-rule">
            <span className="mg-rule-icon">⚡</span>
            <span className="mg-rule-text">{step.rule}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MethodGuide() {
  const [open, setOpen] = useState(0)

  return (
    <div className="mg-root">
      <div className="mg-header">
        <div className="mg-header-left">
          <span className="mg-header-title">The Playbook</span>
          <span className="mg-header-sub">
            The complete top-down methodology — stocks, options, both directions, built into every feature of this app
          </span>
        </div>
      </div>

      <div className="mg-intro">
        Ten steps. Every tab maps to one. The system works on both the long and short side — calls and puts, stocks and options. Read this once, understand why each gate exists, and every number the app surfaces will make immediate sense.
      </div>

      <PhilosophyBlock />

      <div className="mg-steps">
        {STEPS.map((step, i) => (
          <Step
            key={step.num}
            step={step}
            open={open === i}
            onToggle={() => setOpen(open === i ? -1 : i)}
          />
        ))}
      </div>

      <EmaPersonalizer />

      <div className="mg-footer">
        <div className="mg-footer-title">The Complete Entry Checklist</div>
        <div className="mg-footer-body">
CHECK MACRO CALENDAR FIRST — if FOMC or CPI is within 5 days, reduce position size by 50%+ or stand aside entirely. Never buy options into a Fed decision without accounting for IV crush risk → run the backtest on any new ticker before entering — use the date-range filter to test against the current regime, not just the 2-year average → check the Historical Probability panel on the Brief — if options win rate under current conditions (direction + grade + ADX) is below 50%, look for a better setup → Check RiskGuard — no red banners, no daily loss limit hit, under 4 open positions → Trade Score ≥ 42 on the Brief → check the Wyckoff Structure banner — if it shows a conflict (MARKDOWN vs CALL or ACCUMULATION vs PUT), cut size 30–50% and require all 3 gates fully open → all three gates open (weekly aligned + daily confirmed + entry trigger fired) → no regime block (VIX &lt; 28 or weekly not bearish) → above gamma flip, IV term structure not inverted → no earnings within 14 days → RSI above EMA signal line and above 44 for calls / below 43 for puts → ADX ≥ 21 with DI aligned → MA stack on the correct side of the 30 EMA → 4H two-bar rule confirmed OR ORB break + retest → check the Expirations view to compare premium and theta cost across all available expiries → SET YOUR EXIT PLAN BEFORE ENTERING — read the Exit Plan card on the Brief: note your Stop Loss price (1.5× ATR), Target 1 (50% scale-out, Fib 1.0 ext), and Target 2 (full exit, Fib 1.618 ext), then enter these levels into your broker before clicking buy → execute: stock entry at market with stop at 15 EMA, option at delta 0.35–0.65 with DTE 21+ → set option stop at −40% from premium entry → when T1 hits, sell 50% and move stop to breakeven (house money from here) → when T2 hits, close the rest → log the trade in the Journal: why you entered, what the macro calendar said, your thesis, and what would invalidate it → if streak is 3 losses, stop for the session and read your last three journal entries before re-engaging.
        </div>
      </div>

      <div className="mg-mission-footer">
        <div className="mg-mission-line">
          Every rule in this system exists for one reason: to keep your edge intact long enough for it to compound. The market rewards two kinds of traders — the ones who are right early, and the ones who are still playing after the ones who got lucky have blown up. Be the second kind. The gates exist so you stay in the game. The score exists so you know when the game is worth playing. The journal exists so you keep getting better at it.
        </div>
        <div className="mg-mission-sig">Built by a trader, for traders who want to keep what they earn — and stay disciplined long enough for the edge to compound.</div>
      </div>
    </div>
  )
}
