import { useState } from 'react'
import { useEmaNames } from '../utils/emaNames'
import './OnboardingModal.css'

// ── Static data ───────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { col: '#60a5fa', label: 'Analyze',  desc: 'Load any ticker for a directional signal, trade score, Macro Economic Calendar, Wyckoff structure conflict check, historical win probability, structured Exit Plan, Fear & Greed meter, and macro regime read. Start every session here — the Brief sub-tab gives you a complete trade decision in under 30 seconds.' },
  { col: '#a78bfa', label: 'Options',  desc: 'Build your options trade — get a complete plan with Greeks, stops, and spread alternatives. The Expirations sub-view shows the ATM strike across all available expiries side-by-side so you can compare premium, theta, and breakeven before choosing your hold time.' },
  { col: '#34d399', label: 'Scanner',  desc: 'Market health, setup finder, gap watch, sector rotation, price level alerts, options flow, live flow, and your regime playbook — all in one place.' },
  { col: '#f59e0b', label: 'Trades',   desc: 'Write your trade thoughts — why you entered, what you saw, why you exited. Your personal record of reasoning that builds pattern recognition over time and catches execution habits the numbers alone never show.' },
  { col: '#4a90c4', label: 'Backtest', desc: 'Replay the strategy signals over historical data — hit rate, equity curve, options P&L simulation, and Kelly sizer. Use the date-range filter to test against the specific regime you are trading in right now.' },
]

const EMA_META = [
  { ema: 8,   role: 'Momentum — first to feel every move',       col: '#06b6d4' },
  { ema: 15,  role: 'Entries & exits — confirms the signal',     col: '#f97316' },
  { ema: 30,  role: 'Direction — the midfield test',             col: '#84cc16' },
  { ema: 65,  role: 'Support & resistance — the major levels',   col: '#a855f7' },
  { ema: 200, role: 'The foundation — above = bull territory',   col: '#eab308' },
]

const STEPS = [
  {
    tag: 'WELCOME',
    title: 'Your Trading Decision System',
    accent: '#4a90c4',
    body: `This is a complete trading system — not a stock picker. Every signal, score, and gate exists to answer one question: does this setup meet the standard to risk real money right now?

The system runs top-down. The weekly chart sets the direction. The daily confirms momentum is alive. The timing check finds the exact moment to enter. All three have to agree before you size in.

Your job isn't to predict where markets go. It's to execute the system when conditions align — and sit on your hands when they don't. Behavioral guardrails watch your session in real time and stop you before discipline breaks down. This app makes the entire process clear enough to share with anyone.`,
  },

  {
    tag: 'THE APP',
    title: 'Five Sections, One Flow',
    accent: '#60a5fa',
    navItems: true,
  },

  {
    tag: 'THE METHOD',
    title: 'The 3 Gates',
    accent: '#10b981',
    gates: [
      {
        num: '1', color: '#10b981',
        name: 'WEEKLY DIRECTION',
        desc: "The big picture. The weekly chart must be trending your direction — price above key moving averages, momentum above the 44 level. If the weekly is against you, don't trade it. You're fighting institutional money.",
      },
      {
        num: '2', color: '#f59e0b',
        name: 'DAILY MOMENTUM',
        desc: 'Confirms the weekly direction is alive right now — not just sitting there. MACD aligned, EMA stack ordered, ADX trend strength ≥ 21. The trend has to be actively moving before you enter.',
      },
      {
        num: '3', color: '#a78bfa',
        name: 'ENTRY TIMING',
        desc: 'The go signal. Two 4-hour bars close on your side of EMA 8, OR an opening range breakout confirms, OR a VWAP 2-bar cross fires. Check the Timing view in Analyze. All 3 gates green = TRADE UNLOCKED.',
      },
    ],
  },

  {
    tag: 'YOUR EMA FAMILY',
    title: 'Five Lines. One Framework.',
    accent: '#a855f7',
    emaStep: true,
    footer: 'Names are yours to set. Open Guide → "Personalize your EMA names" and give each line a name that sticks for you.',
  },

  {
    tag: 'SCORE · ALERTS · PLAYBOOK',
    title: 'The Engine Behind Every Decision',
    accent: '#f59e0b',
    body: 'Every setup is scored 0–100 across twelve factors: confluence alignment, weekly direction, RSI signal, ADX trend strength, EMA stack, setup grade, IV conditions, volume, sector leadership, insider activity, squeeze risk, and Wyckoff structural alignment. The Wyckoff factor is the most structural — if the stock is in a MARKDOWN or DISTRIBUTION phase and the signal says CALL, you\'ll see an orange conflict banner and the score reflects a structural headwind. The Historical Probability panel shows you the options win rate for your exact setup conditions over two years of data.',
    grades: [
      { grade: 'A+', range: '80–100', size: 'Full size — highest conviction setup',  color: '#10b981' },
      { grade: 'A',  range: '65–79',  size: 'Half size — solid conditions',           color: '#34d399' },
      { grade: 'B',  range: '50–64',  size: 'Quarter size or skip entirely',          color: '#f59e0b' },
      { grade: 'C',  range: '< 50',   size: 'Skip — conditions are not right yet',   color: '#6b7280' },
    ],
    footer: 'Alerts: the bell icon at the top of the screen (AlertCenter) stores every notification that has fired — price level triggers, watchlist signal upgrades, and system alerts. Set price level alerts in Scanner → Alerts with Fib and ORB quick-add chips. Watchlist: Analyze → Watchlist runs a full confluence scan on every ticker you follow, auto-refreshes every 5 minutes, and sorts by signal score. Playbook: Scanner → Playbook reads the current market regime (Bull / Bear / Defensive) and shows exactly which ETFs to play, with EMA-family entry and exit rules for each.',
  },

  {
    tag: 'CHECKLIST',
    title: 'Before Your First Trade',
    accent: '#a78bfa',
    checklist: [
      'Macro Calendar (top of Brief): check it before loading any ticker — if FOMC or CPI is within 5 days, reduce size 50%+ or stand aside. Never enter options trades into a Fed decision without planning for IV crush',
      'Analyze → Brief: load a ticker and read the Trade Score, three gates, Wyckoff structure banner, and macro regime — all in the first 10 seconds. If the Wyckoff banner shows a conflict, cut size and require all gates green',
      'Historical Probability panel (Brief): after the score breakdown loads, check the options win rate under your exact conditions — direction + grade + ADX. Below 50% means the edge isn\'t there; find a better setup',
      'Exit Plan (Brief, below the recommended option): read your Stop Loss level, Target 1 (50% scale-out), and Target 2 (full exit) — then enter those prices into your broker BEFORE you click buy',
      'Scanner → Market: confirm the overall market supports your direction before entering anything',
      'Scanner → Playbook: check the current regime — Bull, Bear, or Defensive — before sizing any ETF',
      'Scanner → Alerts: set a price level so the app notifies you when key levels are hit — alerts appear in the bell icon at the top',
      'Backtest: run the backtest on any ticker before trading it live — use the date-range filter to test the signals against today\'s regime, not just the 2-year average',
      'Options → Expirations: compare ATM premium, theta, and breakeven across all available expiries before choosing your hold time',
      'Risk Panel: set your account size and risk % before any position is calculated',
      'RiskGuard banners: when a red banner fires — daily loss limit, 3 consecutive losses, max positions — the answer is no. Yellow means size down. Never dismiss and proceed',
      'Trades → Journal: write why you entered, what the macro calendar said, and why you exited. Add a voice note using the mic button if typing feels slow',
      'Never exceed your grade\'s position size — A+ gets full size, C gets nothing, discipline is the edge',
    ],
    footer: "The goal isn't to win every trade. It's to stay in the game long enough for the edge to compound.",
  },
]

// ── Component ─────────────────────────────────────────────────────────────────
export default function OnboardingModal({ onClose }) {
  const [step, setStep] = useState(0)
  const emaNames = useEmaNames()

  const cur    = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="ob-overlay" onClick={onClose}>
      <div className="ob-modal" onClick={e => e.stopPropagation()}>

        <button className="ob-close" onClick={onClose}>✕</button>

        {/* Progress dots */}
        <div className="ob-dots">
          {STEPS.map((s, i) => (
            <button
              key={i}
              className={`ob-dot${i === step ? ' ob-dot-active' : i < step ? ' ob-dot-done' : ''}`}
              style={i === step ? { background: cur.accent } : {}}
              onClick={() => setStep(i)}
            />
          ))}
        </div>

        <div className="ob-tag" style={{ color: cur.accent }}>{cur.tag}</div>
        <div className="ob-title">{cur.title}</div>

        {/* Free text body */}
        {cur.body && <div className="ob-body">{cur.body}</div>}

        {/* App navigation tour */}
        {cur.navItems && (
          <div className="ob-nav-items">
            {NAV_ITEMS.map(item => (
              <div key={item.label} className="ob-nav-item">
                <div className="ob-nav-label" style={{ color: item.col }}>{item.label}</div>
                <div className="ob-nav-desc">{item.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* 3 Gates */}
        {cur.gates && (
          <div className="ob-gates">
            {cur.gates.map(g => (
              <div key={g.num} className="ob-gate" style={{ borderColor: `${g.color}40`, background: `${g.color}08` }}>
                <div className="ob-gate-num" style={{ color: g.color }}>GATE {g.num}</div>
                <div className="ob-gate-name" style={{ color: g.color }}>{g.name}</div>
                <div className="ob-gate-desc">{g.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* EMA family — uses live customized names */}
        {cur.emaStep && (
          <div className="ob-ema-section">
            <div className="ob-ema-grid">
              {EMA_META.map(em => (
                <div key={em.ema} className="ob-ema-row" style={{ borderLeftColor: em.col }}>
                  <div className="ob-ema-badge" style={{ color: em.col, borderColor: em.col }}>E{em.ema}</div>
                  <div className="ob-ema-name" style={{ color: em.col }}>{emaNames[em.ema]}</div>
                  <div className="ob-ema-role">{em.role}</div>
                </div>
              ))}
            </div>
            {cur.footer && <div className="ob-ema-footer">{cur.footer}</div>}
          </div>
        )}

        {/* Trade score table */}
        {cur.grades && (
          <>
            <div className="ob-grades">
              {cur.grades.map(g => (
                <div key={g.grade} className="ob-grade-row">
                  <span className="ob-grade-badge" style={{ color: g.color, borderColor: g.color }}>{g.grade}</span>
                  <span className="ob-grade-range" style={{ color: g.color }}>{g.range}</span>
                  <span className="ob-grade-size">{g.size}</span>
                </div>
              ))}
            </div>
            {cur.footer && <div className="ob-footer-note">{cur.footer}</div>}
          </>
        )}

        {/* Pre-trade checklist */}
        {cur.checklist && (
          <>
            <div className="ob-checklist">
              {cur.checklist.map((item, i) => (
                <div key={i} className="ob-check-row">
                  <span className="ob-check-icon" style={{ color: cur.accent }}>◯</span>
                  <span className="ob-check-text">{item}</span>
                </div>
              ))}
            </div>
            {cur.footer && <div className="ob-footer-note">{cur.footer}</div>}
          </>
        )}

        <div className="ob-nav">
          {step > 0
            ? <button className="ob-btn ob-btn-back" onClick={() => setStep(s => s - 1)}>← Back</button>
            : <div />
          }
          {!isLast
            ? <button className="ob-btn ob-btn-next" style={{ background: cur.accent }} onClick={() => setStep(s => s + 1)}>Next →</button>
            : <button className="ob-btn ob-btn-start" style={{ background: cur.accent }} onClick={onClose}>Let's Go →</button>
          }
        </div>

      </div>
    </div>
  )
}
