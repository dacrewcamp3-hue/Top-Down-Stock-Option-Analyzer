import { useState, useCallback, useEffect, useRef } from 'react'
import { TIMEFRAMES } from './data/timeframes'
import { SWING_CATEGORIES } from './data/swingCategories'
import { analyzeEntry } from './utils/analyzeEntry'
import { analyzeSwing } from './utils/analyzeSwing'
import { fetchAllTimeframes, fetchIVData, fetchEarningsDate, fetchPreMarketBars } from './utils/fetchTicker'
import { fetchOptionsChain } from './utils/fetchOptionsChain'
import { fetchInsiderActivity } from './utils/fetchInsider'
import { fetchShortInterest } from './utils/fetchShortInterest'
import { fetchBreadth } from './utils/fetchBreadth'
import { calcHistoricalVol, bsPrice } from './utils/fetchOptions'
import { deriveConfluenceSignals, derive4HSwingSignals, derive4HSwingTrendSignals, deriveMarketAndRisk } from './utils/autoSignals'
import { calcFibonacci, calcSwingRSI, calcADX, calcMAStack, calcVWAP, detectDoublePatterns, calcRelativeStrength, calcVolumeSpike, calcORBreakRetest, calcWeeklyAlignment, detectHAndS, detectContinuationPatterns, calcVolumeProfile } from './utils/indicators'
import TimeframePanel from './components/TimeframePanel'
import EntryRecommendation from './components/EntryRecommendation'
import SwingCategoryPanel from './components/SwingCategoryPanel'
import SwingResult from './components/SwingResult'
import TradeJournal from './components/TradeJournal'
import OptionsChain from './components/OptionsChain'
import Scanner from './components/Scanner'
import Backtest from './components/Backtest'
import MethodGuide from './components/MethodGuide'
import FlowScanner from './components/FlowScanner'
import MarketPulse from './components/MarketPulse'
import FlowTape from './components/FlowTape'
import AlignmentMatrix from './components/AlignmentMatrix'
import InsiderActivity from './components/InsiderActivity'
import RiskGuard from './components/RiskGuard'
import CyclePanel from './components/CyclePanel'
import VolumeProfileCard from './components/VolumeProfileCard'
import PriceChart from './components/PriceChart'
import PriceVolumePanel from './components/PriceVolumePanel'
import SignalScanner from './components/SignalScanner'
import GapScanner from './components/GapScanner'
import SectorRotation from './components/SectorRotation'
import PriceLevelAlerts from './components/PriceLevelAlerts'
import PlaybookPanel from './components/PlaybookPanel'
import EarningsMode from './components/EarningsMode'
import AlertCenter from './components/AlertCenter'
import LastAlertBanner from './components/LastAlertBanner'
import TradeBrief from './components/TradeBrief'
import MarketBreadth from './components/MarketBreadth'
import BestTradeNow from './components/BestTradeNow'
import OnboardingModal from './components/OnboardingModal'
import WatchlistBoard from './components/WatchlistBoard'
import GlobalTooltip from './components/GlobalTooltip'
import LivePriceTicker from './components/LivePriceTicker'
import { SkeletonCard } from './components/LoadingSkeleton'
import { calcTradeScore } from './utils/calcTradeScore'
import { analyzeCycle } from './utils/cycleAnalysis'
import { playTone, isSoundEnabled, setSoundEnabled } from './utils/audioAlerts'
import { fireNotification, requestNotifPermission } from './utils/browserAlerts'
import SignalHistory from './components/SignalHistory'
import WyckoffPanel from './components/WyckoffPanel'
import { detectWyckoff } from './utils/wyckoff'
import SmartAlertToast from './components/SmartAlertToast'
import { pushAlert } from './components/AlertCenter'
import './App.css'

// ── Market session detection ──────────────────────────────────────────────────
function getMarketStatus() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/New_York',
  })
  const parts = fmt.formatToParts(new Date())
  const day = parts.find(p => p.type === 'weekday').value
  const h   = parseInt(parts.find(p => p.type === 'hour').value, 10)
  const m   = parseInt(parts.find(p => p.type === 'minute').value, 10)
  const et  = (h === 24 ? 0 : h) * 60 + m
  if (['Saturday', 'Sunday'].includes(day)) return 'closed'
  if (et >= 570  && et < 960)  return 'open'   // 9:30 AM – 4:00 PM
  if (et >= 240  && et < 570)  return 'pre'    // 4:00 AM – 9:30 AM
  if (et >= 960  && et < 1200) return 'after'  // 4:00 PM – 8:00 PM
  return 'closed'
}

const SMART_INTERVALS = { open: 30, pre: 120, after: 120, closed: 900 }

function buildInitialTfStates() {
  const state = {}
  for (const tf of TIMEFRAMES) {
    state[tf.id] = {}
    for (const field of tf.fields) {
      state[tf.id][field.id] = null
    }
  }
  return state
}

function buildInitialCollapsed() {
  const state = {}
  for (const tf of TIMEFRAMES) state[tf.id] = tf.defaultCollapsed
  return state
}

function buildInitialSwingStates() {
  const state = {}
  for (const cat of SWING_CATEGORIES) {
    state[cat.id] = {}
    for (const field of cat.fields) {
      state[cat.id][field.id] = field.type === 'multi' ? [] : null
    }
  }
  return state
}

function buildInitialSwingCollapsed() {
  const state = {}
  for (const cat of SWING_CATEGORIES) state[cat.id] = cat.defaultCollapsed
  return state
}

// ── Combined trade signal: confluence direction × swing timing ─────────────────
function TradeSignalBar({ cf, sw, swConfirmed }) {
  if (!cf || cf === 'NO TRADE') return (
    <div className="tsb tsb-neutral">
      <span className="tsb-icon">—</span>
      <div className="tsb-body">
        <span className="tsb-main">NO TRADE</span>
        <span className="tsb-sub">Confluence unclear · wait for stronger alignment across timeframes</span>
      </div>
    </div>
  )

  // Both agree — clear entry
  if (cf === 'CALL' && sw === 'LONG') return (
    <div className="tsb tsb-bull">
      <span className="tsb-icon">✓</span>
      <div className="tsb-body">
        <span className="tsb-main">ENTER CALLS{!swConfirmed ? ' · WAIT FOR 2ND BAR' : ''}</span>
        <span className="tsb-sub">Confluence bullish + 4H entry signal aligned · {swConfirmed ? 'fully confirmed' : '1 bar confirmed — wait for close'}</span>
      </div>
    </div>
  )

  if (cf === 'PUT' && sw === 'EXIT') return (
    <div className="tsb tsb-bear">
      <span className="tsb-icon">✓</span>
      <div className="tsb-body">
        <span className="tsb-main">ENTER PUTS{!swConfirmed ? ' · WAIT FOR 2ND BAR' : ''}</span>
        <span className="tsb-sub">Confluence bearish + 4H exit signal aligned · {swConfirmed ? 'fully confirmed' : '1 bar confirmed — wait for close'}</span>
      </div>
    </div>
  )

  // Conflict — direction and timing disagree
  if (cf === 'CALL' && sw === 'EXIT') return (
    <div className="tsb tsb-conflict">
      <span className="tsb-icon">!</span>
      <div className="tsb-body">
        <span className="tsb-main">DO NOT ENTER · PULLBACK IN PROGRESS</span>
        <span className="tsb-sub">Overall structure is bullish but 4H momentum broke down · wait for LONG ENTRY signal before buying calls</span>
      </div>
    </div>
  )

  if (cf === 'PUT' && sw === 'LONG') return (
    <div className="tsb tsb-conflict">
      <span className="tsb-icon">!</span>
      <div className="tsb-body">
        <span className="tsb-main">DO NOT ENTER · BOUNCE IN PROGRESS</span>
        <span className="tsb-sub">Overall structure is bearish but 4H is bouncing · wait for EXIT signal before buying puts</span>
      </div>
    </div>
  )

  // Direction confirmed, no timing trigger yet
  const isBull = cf === 'CALL'
  return (
    <div className="tsb tsb-watch">
      <span className="tsb-icon">◷</span>
      <div className="tsb-body">
        <span className="tsb-main">{isBull ? 'BULLISH' : 'BEARISH'} · WAITING FOR ENTRY</span>
        <span className="tsb-sub">{isBull ? 'Confluence says CALL' : 'Confluence says PUT'} · swing has no confirmed signal yet · do not enter early</span>
      </div>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('tdsa-active-tab') ?? 'analyze')
  const [ticker, setTicker] = useState('')

  // Live-data state
  const [isLoading, setIsLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [liveLoaded, setLiveLoaded] = useState(false)

  // Confluence tab state
  const [tfStates, setTfStates] = useState(buildInitialTfStates)
  const [collapsed, setCollapsed] = useState(buildInitialCollapsed)

  // Swing tab state
  const [swingStates, setSwingStates] = useState(buildInitialSwingStates)
  const [swingCollapsed, setSwingCollapsed] = useState(buildInitialSwingCollapsed)
  const [fibLevels, setFibLevels] = useState(null)
  const [rsiSignal, setRsiSignal] = useState(null)
  const [adxSignal, setAdxSignal] = useState(null)
  const [maStack, setMaStack]     = useState(null)
  const [patterns, setPatterns]     = useState(null)
  const [vwapSignal, setVwapSignal] = useState(null)
  const [rsScore, setRsScore]       = useState(null)
  const [volumeSpike, setVolumeSpike] = useState(null)
  const [vixData, setVixData]       = useState(null)
  const [orbRetest, setOrbRetest]   = useState(null)
  const [ivData, setIvData]         = useState(null)
  const [weeklyAlign, setWeeklyAlign]   = useState(null)
  const [hsPatterns, setHsPatterns]     = useState(null)
  const [contPatterns, setContPatterns] = useState(null)
  const [currentPrice, setCurrentPrice] = useState(null)
  const [quoteChangePct, setQuoteChangePct] = useState(null)
  const [sectorRS, setSectorRS]         = useState(null)

  const [historicalVol, setHistoricalVol] = useState(null)

  const [isEnriching, setIsEnriching] = useState(false)

  const [showGuide, setShowGuide] = useState(
    () => !localStorage.getItem('tdsa-guide-dismissed')
  )
  const [showGuideModal,    setShowGuideModal]    = useState(false)
  const [showOnboarding,    setShowOnboarding]    = useState(() => !localStorage.getItem('tda_onboarded'))
  const [analyzeView,    setAnalyzeView]    = useState(() => localStorage.getItem('tdsa-analyze-view') ?? 'brief')
  const [scannerView,    setScannerView]    = useState(() => localStorage.getItem('tdsa-scanner-view') ?? 'market')
  const [showSettings,    setShowSettings]    = useState(false)
  const [earningsDate,   setEarningsDate]   = useState(null)
  const [backtestResult, setBacktestResult] = useState(null)
  const [optionsChain,   setOptionsChain]   = useState(null)
  const [chainFetchDone, setChainFetchDone] = useState(false)
  const [insiderData,    setInsiderData]    = useState(null)
  const [insiderLoading, setInsiderLoading] = useState(false)
  const [shortInterest,  setShortInterest]  = useState(null)
  const [weeklyBars,     setWeeklyBars]     = useState(null)
  const [cycleData,      setCycleData]      = useState(null)
  const [volumeProfile,  setVolumeProfile]  = useState(null)
  const [dailyBars,      setDailyBars]      = useState(null)
  const [fourHBars,      setFourHBars]      = useState(null)
  const [oneHBars,       setOneHBars]       = useState(null)
  const [fifteenMBars,   setFifteenMBars]   = useState(null)
  const [fiveMBars,      setFiveMBars]      = useState(null)
  const [showPreMarket,  setShowPreMarket]  = useState(false)
  const [pmBars,         setPmBars]         = useState(null)
  const [pmLoading,      setPmLoading]      = useState(false)
  const [pmFetchError,   setPmFetchError]   = useState(null)
  const [chartTf,        setChartTf]        = useState(() => localStorage.getItem('tdsa-chart-tf') ?? 'D')
  const [breadthData,    setBreadthData]    = useState(null)
  const [breadthLoading, setBreadthLoading] = useState(false)
  const [wyckoffData,    setWyckoffData]    = useState(null)

  // ── Alerts & watchlist ───────────────────────────────────────────────────
  const [alertsOn, setAlertsOn]   = useState(isSoundEnabled)
  const [notifEnabled, setNotifEnabled] = useState(() => localStorage.getItem('tdsa-notif-enabled') === 'true')
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wl') ?? '[]') } catch { return [] }
  })

  // ── Auto-refresh state ───────────────────────────────────────────────────
  const [autoInterval,  setAutoInterval]  = useState(() => +(localStorage.getItem('tdsa-auto-interval') ?? 60))
  const [smartRefresh,  setSmartRefresh]  = useState(() => localStorage.getItem('tdsa-smart-refresh') === 'true')
  const [countdown,     setCountdown]     = useState(null)
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [dataAge,       setDataAge]       = useState(null)
  const fetchingRef   = useRef(false)
  const tickerInputRef = useRef(null)
  const countdownRef  = useRef(null)
  const prevSigRef    = useRef(null)
  const prevOrbRef    = useRef(null)
  const prevEma8Ref   = useRef(null)
  const showPreMarketRef = useRef(false)

  // Keep ref in sync so handleFetch (stale closure) can always read current value
  useEffect(() => { showPreMarketRef.current = showPreMarket }, [showPreMarket])

  // ── Persist UI preferences to localStorage ────────────────────────────────
  useEffect(() => { try { localStorage.setItem('tdsa-active-tab',    activeTab)    } catch {} }, [activeTab])
  useEffect(() => { try { localStorage.setItem('tdsa-analyze-view',  analyzeView)  } catch {} }, [analyzeView])
  useEffect(() => { try { localStorage.setItem('tdsa-scanner-view',  scannerView)  } catch {} }, [scannerView])
  useEffect(() => { try { localStorage.setItem('tdsa-chart-tf',      chartTf)      } catch {} }, [chartTf])
  useEffect(() => { try { localStorage.setItem('tdsa-auto-interval', String(autoInterval)) } catch {} }, [autoInterval])
  useEffect(() => { try { localStorage.setItem('tdsa-smart-refresh', String(smartRefresh))  } catch {} }, [smartRefresh])
  useEffect(() => { try { localStorage.setItem('tdsa-notif-enabled', String(notifEnabled))  } catch {} }, [notifEnabled])

  // ── Smart auto-refresh: adjust interval based on market session ──────────
  useEffect(() => {
    if (!smartRefresh) return
    const update = () => {
      const target = SMART_INTERVALS[getMarketStatus()]
      setAutoInterval(target)
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [smartRefresh])

  // ── Data freshness counter (live "Xs ago" in header) ─────────────────────
  useEffect(() => {
    if (!lastUpdated) { setDataAge(null); return }
    const tick = () => setDataAge(Math.round((Date.now() - lastUpdated.getTime()) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  // ── Live data fetch — two-phase progressive load ──────────────────────────
  // Phase 1: OHLCV only → signal appears fast (usually < 1s)
  // Phase 2: IV, options chain, earnings → enriches cards while visible
  const handleFetch = useCallback(async (overrideTicker, { silent = false } = {}) => {
    const sym = (overrideTicker ?? ticker).trim().toUpperCase()
    if (!sym || fetchingRef.current) return
    fetchingRef.current = true
    // Silent refresh (auto-interval): skip all loading indicators and don't blank
    // out visible content — data updates in-place without disrupting the UI.
    if (!silent) {
      setIsLoading(true)
      setOptionsChain(null)
      setChainFetchDone(false)
    }
    setFetchError(null)

    try {
      // ── Phase 1: price/OHLCV data ──────────────────────────────────────
      const tfDataMap = await fetchAllTimeframes(sym)

      // Confluence signals
      const newTfStates = deriveConfluenceSignals(tfDataMap, TIMEFRAMES)
      setTfStates(newTfStates)

      const { signal, confluence } = analyzeEntry(newTfStates, TIMEFRAMES)
      setWatchlist(prev => {
        const entry   = { ticker: sym, signal, score: Math.round(50 + confluence * 50) }
        const updated = [...prev.filter(w => w.ticker !== sym), entry].slice(-15)
        try { localStorage.setItem('wl', JSON.stringify(updated)) } catch {}
        return updated
      })

      // Swing signals
      const swingPartial = {
        ...derive4HSwingSignals(tfDataMap['4h']),
        ...derive4HSwingTrendSignals(tfDataMap.daily, tfDataMap.weekly),
        ...deriveMarketAndRisk(tfDataMap.spy, tfDataMap['4h']),
      }
      setSwingStates(prev => {
        const next = { ...prev }
        for (const [catId, fields] of Object.entries(swingPartial)) {
          next[catId] = { ...next[catId], ...fields }
        }
        return next
      })

      // Technical indicators (all synchronous)
      const cp = tfDataMap.daily.closes[tfDataMap.daily.closes.length - 1]
      setCurrentPrice(cp)

      setHistoricalVol(calcHistoricalVol(tfDataMap.daily.closes))
      setFibLevels(calcFibonacci(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes))
      setRsiSignal(calcSwingRSI(tfDataMap.daily.closes))
      setAdxSignal(calcADX(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes))
      setMaStack(calcMAStack(tfDataMap.daily.closes))
      setPatterns(detectDoublePatterns(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes, tfDataMap.daily.timestamps))
      setVwapSignal(calcVWAP(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes, tfDataMap.daily.volumes))
      setRsScore(tfDataMap.spy ? calcRelativeStrength(tfDataMap.daily.closes, tfDataMap.spy.closes) : null)
      setVolumeSpike(calcVolumeSpike(tfDataMap.daily.volumes))
      setVixData(tfDataMap.vix ?? null)
      setOrbRetest(calcORBreakRetest(tfDataMap['5m'], tfDataMap['15m']))
      setWeeklyAlign(calcWeeklyAlignment(tfDataMap.weekly.closes, tfDataMap.weekly.highs, tfDataMap.weekly.lows))
      setWeeklyBars(tfDataMap.weekly)
      setCycleData(analyzeCycle(tfDataMap.weekly))
      setDailyBars(tfDataMap.daily)
      setFourHBars(tfDataMap['4h'] ?? null)
      setOneHBars(tfDataMap['1h'] ?? null)
      setFifteenMBars(tfDataMap['15m'] ?? null)
      setFiveMBars(tfDataMap['5m'] ?? null)
      if (!silent) setPmBars(null)  // reset pre-market cache on ticker change only — silent refreshes keep existing bars
      setHsPatterns(detectHAndS(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes, tfDataMap.daily.timestamps))
      setContPatterns(detectContinuationPatterns(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes, tfDataMap.daily.volumes))
      setVolumeProfile(calcVolumeProfile(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes, tfDataMap.daily.volumes))
      setWyckoffData(detectWyckoff(tfDataMap.daily.highs, tfDataMap.daily.lows, tfDataMap.daily.closes, tfDataMap.daily.volumes))
      if (tfDataMap.sectorETF && tfDataMap.spy) {
        setSectorRS({
          stockVsSector: calcRelativeStrength(tfDataMap.daily.closes, tfDataMap.sectorETF.closes),
          sectorVsSpy:   calcRelativeStrength(tfDataMap.sectorETF.closes, tfDataMap.spy.closes),
          etf:    tfDataMap.sectorETF.etf,
          sector: tfDataMap.sectorETF.sector,
        })
      } else {
        setSectorRS(null)
      }

      // Signal is ready — show the UI immediately
      setLastUpdated(new Date())
      setLiveLoaded(true)
      if (!silent) setIsLoading(false)

      // ── Phase 2: network enrichment (IV, options chain, earnings, insider) ──
      if (!silent) setIsEnriching(true)
      try {
        const [ivResult, earnDate, optChain] = await Promise.all([
          fetchIVData(sym),
          fetchEarningsDate(sym),
          fetchOptionsChain(sym),   // already has auto-retry on 401 via yfFetch
        ])
        setIvData(ivResult)
        setEarningsDate(earnDate)
        setOptionsChain(optChain)
        // Use the live quote price as the authoritative current price (more real-time than
        // the daily chart bar close, and already accounts for same-day splits/events).
        if (optChain?.S != null) setCurrentPrice(optChain.S)
        if (optChain?.quoteChangePct != null) setQuoteChangePct(optChain.quoteChangePct)
        setChainFetchDone(true)
      } catch (enrichErr) {
        // Enrichment failure is non-fatal — signals are already shown
        console.warn('[handleFetch phase 2]', enrichErr.message)
        setChainFetchDone(true)
      } finally {
        if (!silent) setIsEnriching(false)
      }

      // Pre-market bars — re-fetch silently if PRE is active so data stays current
      // Use ref (not closure) because handleFetch is useCallback([ticker]) — showPreMarket would be stale
      if (silent && showPreMarketRef.current) {
        fetchPreMarketBars(sym)
          .then(bars => setPmBars(bars))
          .catch(() => {})
      }

      // Insider + short interest — skip on silent auto-refresh (SEC filings don't change minute-to-minute)
      if (!silent) {
        setInsiderLoading(true)
        setInsiderData(null)
        setShortInterest(null)
        fetchInsiderActivity(sym)
          .then(d => setInsiderData(d))
          .catch(() => setInsiderData(null))
          .finally(() => setInsiderLoading(false))
        fetchShortInterest(sym)
          .then(d => setShortInterest(d))
          .catch(() => setShortInterest(null))
      }

    } catch (err) {
      if (!silent) setFetchError(err.message)
    } finally {
      fetchingRef.current = false
      if (!silent) setIsLoading(false)
      if (!silent) setIsEnriching(false)
    }
  }, [ticker])

  // ── Options chain retry (targeted — does not reload the whole ticker) ───────
  const handleRetryOptionsChain = useCallback(async () => {
    if (!ticker) return
    setOptionsChain(null)
    setChainFetchDone(false)
    setIsEnriching(true)
    try {
      const optChain = await fetchOptionsChain(ticker)
      setOptionsChain(optChain)
    } catch (e) {
      console.warn('[options chain retry]', e.message)
    } finally {
      setIsEnriching(false)
      setChainFetchDone(true)
    }
  }, [ticker])


  // ── Auto-refresh countdown ────────────────────────────────────────────────
  // NOTE: uses a closure variable `remaining` — NEVER call handleFetch inside a
  // React state updater because StrictMode invokes updaters twice, causing double fetches.
  useEffect(() => {
    clearInterval(countdownRef.current)
    if (!liveLoaded || autoInterval === 0) {
      setCountdown(null)
      return
    }
    let remaining = autoInterval
    setCountdown(remaining)
    countdownRef.current = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        handleFetch(undefined, { silent: true })
        remaining = autoInterval
      }
      setCountdown(remaining)
    }, 1000)
    return () => clearInterval(countdownRef.current)
  }, [liveLoaded, autoInterval, handleFetch])

  // ── Market breadth — fetch on mount and expose refresh ───────────────────
  const refreshBreadth = useCallback(async () => {
    setBreadthLoading(true)
    try {
      const data = await fetchBreadth()
      setBreadthData(data)
    } catch (e) {
      console.warn('[breadth]', e.message)
    } finally {
      setBreadthLoading(false)
    }
  }, [])

  useEffect(() => { refreshBreadth() }, [refreshBreadth])

  // Auto-load SPY on every fresh page load so new visitors immediately see the app working.
  // The override param bypasses the stale ticker closure; fetchingRef prevents double-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTicker('SPY'); handleFetch('SPY') }, [])

  // ── Keyboard-first ticker loading ─────────────────────────────────────────
  // Any alphanumeric key typed while no interactive element is focused
  // immediately routes to the ticker input so users never need to click it first.
  useEffect(() => {
    const onGlobalKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const active = document.activeElement
      const inInteractive = active && active !== document.body &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
         active.tagName === 'BUTTON' || active.tagName === 'SELECT' ||
         active.contentEditable === 'true')
      if (inInteractive) return

      if (/^[A-Za-z0-9]$/.test(e.key)) {
        e.preventDefault()
        tickerInputRef.current?.focus()
        setTicker(prev => (prev + e.key).toUpperCase().slice(0, 6))
        setLiveLoaded(false)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        tickerInputRef.current?.focus()
        setTicker(prev => prev.slice(0, -1))
      } else if (e.key === 'Escape') {
        tickerInputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [])

  // ── Scoring ───────────────────────────────────────────────────────────────
  const confluenceResult = analyzeEntry(tfStates, TIMEFRAMES)
  const swingResult      = analyzeSwing(swingStates, SWING_CATEGORIES, vwapSignal)

  // ── Regime filter — blocks CALL signals when VIX > 28 + weekly net bearish ─
  const regimeBlocked = (() => {
    if (!liveLoaded) return false
    const vixLevel  = vixData?.current ?? 0
    const weeklyBD  = confluenceResult.breakdown?.find(b => b.id === 'weekly')
    const weeklyNet = weeklyBD ? weeklyBD.bull - weeklyBD.bear : 0
    return vixLevel > 28 && weeklyNet < 0 && confluenceResult.signal === 'CALL'
  })()

  // ── Signal-change alerts ──────────────────────────────────────────────────
  useEffect(() => {
    const sig  = confluenceResult.signal
    const orb  = orbRetest?.signal    ?? null
    const ema8 = orbRetest?.ema8Signal ?? null
    if (!liveLoaded) {
      prevSigRef.current = sig; prevOrbRef.current = orb; prevEma8Ref.current = ema8
      return
    }
    if (prevSigRef.current !== null && sig !== prevSigRef.current) {
      if (sig === 'CALL' || sig === 'PUT') {
        const score    = Math.round(Math.abs(confluenceResult.confluence ?? 0) * 100)
        const wBD      = confluenceResult.breakdown?.find(b => b.id === 'weekly')
        const dBD      = confluenceResult.breakdown?.find(b => b.id === 'daily')
        const wStr     = wBD ? (wBD.bull > wBD.bear ? 'W ↑' : wBD.bear > wBD.bull ? 'W ↓' : 'W —') : ''
        const dStr     = dBD ? (dBD.bull > dBD.bear ? 'D ↑' : dBD.bear > dBD.bull ? 'D ↓' : 'D —') : ''
        const scoreStr = sig === 'CALL' ? `+${score}%` : `-${score}%`
        const body     = `${prevSigRef.current} → ${sig} · Confluence ${scoreStr} · ${wStr} ${dStr}`
        if (sig === 'CALL') playTone('call'); else playTone('put')
        if (notifEnabled) fireNotification(`${ticker} Signal: ${sig}`, body, 'signal')
        // Rich in-app toast
        pushAlert({
          title:      `${ticker} — ${sig === 'CALL' ? 'BUY CALLS' : 'BUY PUTS'}`,
          body:       `${wStr} ${dStr}`.trim(),
          type:       'signal',
          ticker,
          direction:  sig,
          prevSignal: prevSigRef.current,
          score,
          bull:       confluenceResult.totalBull ?? 0,
          bear:       confluenceResult.totalBear ?? 0,
        })
      }
    }
    if (prevOrbRef.current === 'INSIDE' && orb === 'BREAK') {
      playTone('orb')
      const dir      = orbRetest?.breakDir
      const level    = dir === 'bull' ? orbRetest?.orHigh : orbRetest?.orLow
      const dirLabel = dir === 'bull' ? '↑ above' : dir === 'bear' ? '↓ below' : 'through'
      const lvlStr   = level ? ` $${level.toFixed(2)}` : ''
      const breakBody = `Price broke ${dirLabel}${lvlStr} opening range — watch for retest`
      if (notifEnabled) fireNotification(`${ticker} ORB Break`, breakBody, 'orb')
      pushAlert({
        title:     `${ticker} — ORB BREAK`,
        body:      breakBody,
        type:      'orb',
        ticker,
        direction: dir === 'bull' ? 'CALL' : dir === 'bear' ? 'PUT' : null,
      })
    }
    if (orb === 'INSIDE' && prevEma8Ref.current === 'neutral' && (ema8 === 'bull' || ema8 === 'bear')) {
      playTone('ema8')
      const ema8Body = `EMA 8 crossed ${ema8 === 'bull' ? '↑ above' : '↓ below'} EMA 15/30 inside the opening range — momentum building`
      if (notifEnabled) fireNotification(`${ticker} EMA 8 Cross`, ema8Body, 'ema8')
      pushAlert({
        title:     `${ticker} — EMA 8 CROSS`,
        body:      ema8Body,
        type:      'ema8',
        ticker,
        direction: ema8 === 'bull' ? 'CALL' : 'PUT',
      })
    }
    prevSigRef.current = sig; prevOrbRef.current = orb; prevEma8Ref.current = ema8
  }, [confluenceResult.signal, orbRetest, liveLoaded, notifEnabled, ticker])

  // ── Log Trade → writes a quick-entry note to the journal ─────────────────
  function logTrade(entry) {
    try {
      const existing = JSON.parse(localStorage.getItem('tj_notes_v2') ?? '[]')
      const t = ticker || entry.ticker || '—'
      const text = [
        `${entry.action} · ${entry.pattern ?? 'Setup'} · Grade ${entry.grade}`,
        `Entry: $${entry.entryPrice} · Stop: $${entry.stopPrice} · Target: $${entry.targetPrice}`,
        `R:R ${entry.rrRatio}:1 · Max risk $${entry.maxRisk}`,
      ].join('\n')
      const note = {
        id:     String(entry.id ?? Date.now()),
        date:   new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ticker: t,
        text,
      }
      localStorage.setItem('tj_notes_v2', JSON.stringify([note, ...existing].slice(0, 200)))
    } catch {}
  }

  function handleLoadTicker(sym) {
    setLiveLoaded(false); setLastUpdated(null); setIvData(null)
    setFetchError(null); setRsiSignal(null); setFibLevels(null)
    setAdxSignal(null); setMaStack(null); setPatterns(null)
    setVwapSignal(null); setRsScore(null); setVolumeSpike(null)
    setVixData(null); setOrbRetest(null)
    setWeeklyAlign(null); setHsPatterns(null); setContPatterns(null)
    setCurrentPrice(null); setSectorRS(null); setHistoricalVol(null)
    setOptionsChain(null)
    setTicker(sym)
    handleFetch(sym)
  }

  async function togglePreMarket() {
    const next = !showPreMarket
    setShowPreMarket(next)
    setPmFetchError(null)
    if (next) {
      // Auto-switch to 1H so pre-market bars are actually visible (D/W/4H don't show them)
      if (!['1H', '15M', '5M'].includes(chartTf)) setChartTf('1H')
      if (ticker && !pmBars) {
        setPmLoading(true)
        try {
          const bars = await fetchPreMarketBars(ticker)
          setPmBars(bars)
          const hasAny = bars?.['1h']?.closes?.length || bars?.['15m']?.closes?.length || bars?.['5m']?.closes?.length
          if (!hasAny) setPmFetchError('No pre-market data available for this ticker')
        } catch {
          setPmFetchError('Pre-market data unavailable — try again')
        }
        setPmLoading(false)
      }
    }
  }

  function removeFromWatchlist(t) {
    setWatchlist(prev => {
      const updated = prev.filter(w => w.ticker !== t)
      try { localStorage.setItem('wl', JSON.stringify(updated)) } catch {}
      return updated
    })
  }

  function handleTickerKeyDown(e) {
    if (e.key === 'Enter') handleFetch()
  }

  // ── Manual overrides ─────────────────────────────────────────────────────
  const handleFieldChange = useCallback((tfId, fieldId, value) => {
    setTfStates(prev => ({ ...prev, [tfId]: { ...prev[tfId], [fieldId]: value } }))
  }, [])

  const handleToggleCollapse = useCallback((tfId) => {
    setCollapsed(prev => ({ ...prev, [tfId]: !prev[tfId] }))
  }, [])

  const handleSwingFieldChange = useCallback((catId, fieldId, value) => {
    setSwingStates(prev => ({ ...prev, [catId]: { ...prev[catId], [fieldId]: value } }))
  }, [])

  const handleSwingToggleCollapse = useCallback((catId) => {
    setSwingCollapsed(prev => ({ ...prev, [catId]: !prev[catId] }))
  }, [])

  function handleReset() {
    setTfStates(buildInitialTfStates())
    setSwingStates(buildInitialSwingStates())
    setFibLevels(null); setRsiSignal(null); setAdxSignal(null)
    setMaStack(null); setPatterns(null); setVwapSignal(null)
    setRsScore(null); setVolumeSpike(null); setVixData(null)
    setOrbRetest(null); setIvData(null); setLastUpdated(null)
    setCountdown(null); setTicker(''); setFetchError(null)
    setLiveLoaded(false)
    setWeeklyAlign(null); setHsPatterns(null); setContPatterns(null)
    setCurrentPrice(null); setSectorRS(null); setHistoricalVol(null)
    setEarningsDate(null); setBacktestResult(null)
    setOptionsChain(null); setChainFetchDone(false); setInsiderData(null); setInsiderLoading(false); setShortInterest(null)
    setVolumeProfile(null); setWyckoffData(null)
  }

  // ── Setup Grade ──────────────────────────────────────────────────────────
  const setupGrade = (() => {
    const dir = swingResult?.signal
    if (dir !== 'LONG' && dir !== 'EXIT') return null
    const bull = dir === 'LONG'
    const checks = []
    const add = (name, pass) => checks.push({ name, pass: !!pass })

    add('4H Confirmed', swingResult.confirmed)

    if (rsiSignal) {
      add('RSI Signal',  bull ? rsiSignal.signal === 'BULLISH' : rsiSignal.signal === 'BEARISH')
      add('RSI 44 gate', bull ? rsiSignal.above44 : rsiSignal.below43)
    }
    if (adxSignal) {
      add('ADX 21 Savage', bull ? adxSignal.adx >= 21 && adxSignal.plusDI >= 21 : adxSignal.adx >= 21 && adxSignal.minusDI >= 21)
      add('ADX Rising',    adxSignal.adxRising)
    }
    if (maStack) {
      add('30 EMA Midfield', bull ? maStack.above30 === true : maStack.above30 === false)
      add('MA Stack aligned', bull ? maStack.signal === 'BULLISH' : maStack.signal === 'BEARISH')
    }
    if (vwapSignal) {
      add('VWAP position', bull ? vwapSignal.aboveVwap : !vwapSignal.aboveVwap)
      add('VWAP cross',    bull ? vwapSignal.crossAbove : vwapSignal.crossBelow)
    }
    if (patterns) {
      add('Pattern confirmed', bull ? !!patterns.doubleBottom?.confirmed : !!patterns.doubleTop?.confirmed)
      if (bull && patterns.doubleBottom?.isBigW) {
        add('Big W detected', true)
      }
      if (bull && patterns.doubleBottom?.isAdamAdam) {
        add('Adam & Adam detected', true)
      }
      if (bull && patterns.doubleBottom?.isAdamEve) {
        add('Adam & Eve detected', true)
      }
      if (bull && patterns.doubleBottom?.isEveAdam) {
        add('Eve & Adam detected', true)
      }
      if (bull && patterns.doubleBottom?.isEveEve) {
        add('Eve & Eve detected', true)
      }
      if (!bull && patterns.doubleTop?.isBigM)        add('Big M detected', true)
      if (!bull && patterns.doubleTop?.isAdamEveTop)  add('Adam & Eve Top detected', true)
      if (!bull && patterns.doubleTop?.isEveAdamTop)  add('Eve & Adam Top detected', true)
      if (!bull && patterns.doubleTop?.isAdamAdamTop) add('Adam & Adam Top detected', true)
      if (!bull && patterns.doubleTop?.isEveEveTop)   add('Eve & Eve Top detected', true)
    }
    if (hsPatterns?.headAndShoulders && !bull) add('H&S pattern detected',   true)
    if (hsPatterns?.inverseHAndS     && bull)  add('Inv H&S detected',       true)
    if (contPatterns?.bullFlag       && bull)  add('Bull flag detected',      true)
    if (contPatterns?.bearFlag       && !bull) add('Bear flag detected',      true)
    if (rsScore) {
      add('RS vs SPY',   bull ? ['BULL','STRONG BULL'].includes(rsScore.signal) : ['BEAR','STRONG BEAR'].includes(rsScore.signal))
      add('RS Strong',   bull ? rsScore.signal === 'STRONG BULL' : rsScore.signal === 'STRONG BEAR')
    }
    if (volumeSpike) {
      add('Volume spike', volumeSpike.spike)
    }

    const passing = checks.filter(c => c.pass).length
    const total   = checks.length
    const pct     = total > 0 ? passing / total : 0

    let grade, color, bg, border
    if      (pct >= 0.80) { grade = 'A+'; color = '#10b981'; bg = '#011c10'; border = '#065f46' }
    else if (pct >= 0.65) { grade = 'A';  color = '#34d399'; bg = '#011c10'; border = '#047857' }
    else if (pct >= 0.50) { grade = 'B';  color = '#f59e0b'; bg = '#1a1000'; border = '#4d3000' }
    else                  { grade = 'C';  color = '#6b7280'; bg = '#0f1623'; border = '#1e2d45' }

    return { grade, color, bg, border, passing, total, pct: Math.round(pct * 100), checks }
  })()

  // ── Trade score (0-100) — must be after setupGrade ───────────────────────
  const tradeScore = calcTradeScore({
    confluenceResult, setupGrade, ivData, adxSignal, sectorRS, insiderData,
    rsiSignal, weeklyAlign, maStack, volumeSpike, shortInterest, wyckoff: wyckoffData,
  })

  // Yesterday's close for % calculations.
  // Priority order:
  //   1. Phase 2 live quote: S - regularMarketChange. Split-adjusted, matches all major platforms.
  //   2. Phase 1 chart meta: regularMarketPreviousClose (official but unadjusted for same-day splits).
  //   3. Bar-derived fallback from the daily OHLCV array.
  const prevDayCloseValue = (() => {
    if (!dailyBars?.closes?.length || !dailyBars?.timestamps?.length) return null
    // Phase 2 wins — split-adjusted and authoritative
    if (optionsChain?.quotePrevClose != null) return optionsChain.quotePrevClose
    // Phase 1 chart meta
    if (dailyBars.prevClose != null) return dailyBars.prevClose
    // Bar-derived fallback: during the regular session the last bar is today's in-progress bar,
    // so [length-2] = yesterday's close. Pre-market: no today bar yet, use [length-1].
    const lastDailyTs   = dailyBars.timestamps[dailyBars.timestamps.length - 1]
    const lastDailyDate = new Date(lastDailyTs * 1000).toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    const todayDate     = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })
    return lastDailyDate === todayDate
      ? (dailyBars.closes.length >= 2 ? dailyBars.closes[dailyBars.closes.length - 2] : null)
      : dailyBars.closes[dailyBars.closes.length - 1]
  })()

  return (
    <div className="app">
      <div className="mobile-banner">
        This app is designed for desktop — charts and panels don't fit small screens well.
        For the best experience, open it on a laptop or desktop.
      </div>
      <GlobalTooltip />

      {/* Smart alert toasts — fixed bottom-right, blinking on trigger */}
      <SmartAlertToast
        onLoadTicker={t => { handleLoadTicker(t); setActiveTab('analyze'); setAnalyzeView('brief') }}
      />

      {/* Settings backdrop — closes popover on outside click */}
      {showSettings && (
        <div className="settings-backdrop" onClick={() => setShowSettings(false)} />
      )}

      {/* Onboarding modal — auto-shows on first visit, re-openable */}
      {showOnboarding && (
        <OnboardingModal onClose={() => {
          localStorage.setItem('tda_onboarded', '1')
          setShowOnboarding(false)
        }} />
      )}

      {/* Method Guide modal */}
      {showGuideModal && (
        <div className="guide-modal-overlay" onClick={() => setShowGuideModal(false)}>
          <div className="guide-modal" onClick={e => e.stopPropagation()}>
            <button className="guide-modal-close" onClick={() => setShowGuideModal(false)}>✕</button>
            <MethodGuide />
          </div>
        </div>
      )}

      <header className="app-header">
        <div className="app-header-left">
          <div className="app-title">Top-Down Analyzer</div>
          {ticker && liveLoaded
            ? <div className="app-ticker-display">
                {ticker}
                {tradeScore?.score > 0 && (
                  <span className="app-score-pill"
                    data-tip="Trade Score (0–100): weighted composite of confluence, weekly alignment, RSI, ADX, MA stack, setup grade, IV conditions, volume, sector RS, insider flow, and squeeze risk. ≥78 = Strong · ≥60 = Confirmed · ≥42 = Developing · ≥20 = Weak."
                    style={{ color: tradeScore.color, background: tradeScore.bg, border: `1px solid ${tradeScore.border}` }}>
                    {tradeScore.score}
                  </span>
                )}
                <LivePriceTicker
                  currentPrice={currentPrice}
                  prevDayClose={prevDayCloseValue}
                  changePct={quoteChangePct}
                />
                {dataAge != null && (
                  <span
                    className={`data-age-pill${dataAge > 300 ? ' data-age-stale' : ''}`}
                    title={`Data last updated at ${lastUpdated?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
                  >
                    {dataAge < 60
                      ? `${dataAge}s ago`
                      : dataAge < 3600
                        ? `${Math.round(dataAge / 60)}m ago`
                        : `${Math.round(dataAge / 3600)}h ago`}
                  </span>
                )}
              </div>
            : <div className="app-subtitle">Stock &amp; Options Signal Confluence</div>
          }
        </div>

        <div className="app-header-right">
          <div className="ticker-group">
            <input
              ref={tickerInputRef}
              className="ticker-input"
              type="text"
              placeholder="TICKER"
              maxLength={6}
              value={ticker}
              onChange={e => {
                setTicker(e.target.value.toUpperCase())
                setLiveLoaded(false); setLastUpdated(null); setIvData(null)
                setRsiSignal(null); setFibLevels(null); setAdxSignal(null)
                setMaStack(null); setPatterns(null); setVwapSignal(null)
                setRsScore(null); setVolumeSpike(null); setVixData(null)
                setOrbRetest(null); setWeeklyAlign(null); setHsPatterns(null)
                setContPatterns(null); setCurrentPrice(null); setQuoteChangePct(null); setSectorRS(null)
                setHistoricalVol(null)
              }}
              onKeyDown={handleTickerKeyDown}
              spellCheck={false}
            />
            {liveLoaded && <span className="live-badge">LIVE</span>}
          </div>

          <button
            className={`fetch-btn${isLoading ? ' loading' : ''}`}
            onClick={handleFetch}
            disabled={isLoading || !ticker.trim()}
          >
            {isLoading
              ? <span className="fetch-spinner" />
              : countdown != null
                ? `↻ ${countdown}s`
                : liveLoaded ? '↻ Reload' : 'Load'}
          </button>

          {isEnriching && !isLoading && (
            <span className="enriching-pill" title="Loading options chain & IV data...">
              <span className="fetch-spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
              IV
            </span>
          )}

          <AlertCenter onLoadTicker={handleLoadTicker} />

          <div className="settings-wrap">
            <button
              className={`gear-btn${showSettings ? ' active' : ''}`}
              onClick={() => setShowSettings(v => !v)}
              title="Settings"
            >⚙</button>

            {showSettings && (
              <div className="settings-popover">
                <div className="settings-row">
                  <span className="settings-lbl">AUTO</span>
                  <div className="arf-pills">
                    {[[0,'Off'],[30,'30s'],[60,'1m'],[120,'2m'],[300,'5m']].map(([s, label]) => (
                      <button
                        key={s}
                        className={`arf-pill${!smartRefresh && autoInterval === s ? ' active' : ''}`}
                        onClick={() => { setSmartRefresh(false); setAutoInterval(s) }}
                      >{label}</button>
                    ))}
                    <button
                      className={`arf-pill${smartRefresh ? ' active' : ''}`}
                      onClick={() => setSmartRefresh(v => !v)}
                      title="Smart: 30s during market hours, 2m pre/after, 15m when closed"
                    >Smart</button>
                  </div>
                </div>
                {smartRefresh && (
                  <div className="settings-smart-note">
                    Smart: {getMarketStatus() === 'open' ? '30s (market open)' : getMarketStatus() === 'pre' ? '2m (pre-market)' : getMarketStatus() === 'after' ? '2m (after hours)' : '15m (market closed)'}
                  </div>
                )}
                <div className="settings-row">
                  <span className="settings-lbl">SOUND</span>
                  <button
                    className={`arf-pill${alertsOn ? ' active' : ''}`}
                    onClick={() => setAlertsOn(v => { setSoundEnabled(!v); return !v })}
                    title="Sound alert when CALL/PUT fires, ORB breaks, or 8 EMA cross fires"
                  >{alertsOn ? 'On' : 'Off'}</button>
                </div>
                <div className="settings-row">
                  <span className="settings-lbl">BROWSER</span>
                  <button
                    className={`arf-pill${notifEnabled ? ' active' : ''}`}
                    onClick={async () => {
                      if (!notifEnabled) {
                        const granted = await requestNotifPermission()
                        if (granted) setNotifEnabled(true)
                        else alert('Browser notifications were denied. Enable them in your browser settings and try again.')
                      } else {
                        setNotifEnabled(false)
                      }
                    }}
                    title="Browser push notification when signal flips, ORB breaks, or EMA 8 crosses — works while tab is open"
                  >{notifEnabled ? 'Alerts On' : 'Alerts Off'}</button>
                </div>

                {lastUpdated && (
                  <div className="settings-ts">
                    {getMarketStatus() === 'open' ? '🟢' : getMarketStatus() === 'pre' ? '🟡' : getMarketStatus() === 'after' ? '🟠' : '⚫'}&nbsp;
                    Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    {dataAge != null && dataAge > 300 && (
                      <span style={{ color: '#ef4444', marginLeft: 6 }}>— DATA STALE</span>
                    )}
                  </div>
                )}
                <button
                  className="settings-reset-btn"
                  onClick={() => { handleReset(); setShowSettings(false) }}
                >Reset All</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <MarketPulse breadthData={breadthData} vixData={breadthData?.vix ?? vixData} />

      <div className="watchlist-bar">
        <span className="wl-label">WATCHLIST</span>
        <div className="wl-pills">
          {watchlist.map(w => (
            <div key={w.ticker} className={`wl-pill wl-${w.signal === 'CALL' ? 'call' : w.signal === 'PUT' ? 'put' : 'no-trade'}`}>
              <button className="wl-load" onClick={() => handleLoadTicker(w.ticker)}>
                <span className="wl-ticker">{w.ticker}</span>
                <span className="wl-sig">{w.signal}</span>
              </button>
              <button className="wl-rm" onClick={() => removeFromWatchlist(w.ticker)}>×</button>
            </div>
          ))}
          {liveLoaded && ticker && !watchlist.find(w => w.ticker === ticker) && (
            <button
              className="wl-add-btn"
              onClick={() => setWatchlist(prev => {
                const entry   = { ticker, signal: confluenceResult.signal, score: Math.round(50 + (confluenceResult.confluence ?? 0) * 50) }
                const updated = [...prev, entry].slice(-15)
                try { localStorage.setItem('wl', JSON.stringify(updated)) } catch {}
                return updated
              })}
              title={`Add ${ticker} to watchlist`}
            >+ {ticker}</button>
          )}
          {watchlist.length === 0 && !liveLoaded && (
            <span className="wl-empty-hint">Load a ticker then press + to add it</span>
          )}
        </div>
      </div>

      {fetchError && (
        <div className="fetch-error">
          <span className="fetch-error-icon">⚠</span>
          {fetchError}
        </div>
      )}

      <div className="tab-nav">
        {[
          ['analyze',  'Analyze',  'Load any ticker to get a directional signal, trade score, chart read, and a complete entry and exit plan.'],
          ['options',  'Options',  'Options chain — pick a strike and expiry, see your break-even price, and get a full trade plan with stops.'],
          ['scanner',  'Scanner',  'Find setups across the market, track overall market health, watch where big money is flowing, and run your regime playbook.'],
          ['trades',   'Trades',   'Write your trade thoughts — why you entered, what you saw, why you exited. Your personal record of reasoning.'],
          ['backtest', 'Backtest', 'See how the strategy signals performed historically on the ticker you\'ve loaded — hit rate, average gain, and more.'],
        ].map(([id, label, tip]) => (
          <button
            key={id}
            className={`tab-btn${activeTab === id ? ' active' : ''}`}
            onClick={() => setActiveTab(id)}
            data-tip={tip}
          >
            {label}
          </button>
        ))}
        <button className="guide-btn" onClick={() => setShowGuideModal(true)} title="Method Guide">?</button>
        <button className="guide-btn ob-how-btn" onClick={() => setShowOnboarding(true)} title="How it works — system overview">▶</button>
      </div>

      <LastAlertBanner onLoadTicker={t => { setTicker(t); handleFetch(t); setActiveTab('analyze'); setAnalyzeView('brief') }} />
      <RiskGuard />

      {/* ── Analyze tab: Confluence + Swing Score via sub-toggle ── */}
      {activeTab === 'analyze' && (
        <>
          <div className="sub-toggle">
            {/* ── Primary workflow tabs ── */}
            <button
              className={`sub-btn${analyzeView === 'brief' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('brief')}
              data-tip="Overview — your complete trade summary: signal direction, score, recommended strike, and a ready-to-use entry and exit plan. Start here every time."
            >
              Overview
              {liveLoaded && tradeScore?.score > 0 && (
                <span className="tab-badge" style={{ background: tradeScore.color }}>{tradeScore.score}</span>
              )}
            </button>
            <button
              className={`sub-btn${analyzeView === 'confluence' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('confluence')}
              data-tip="Signals — timeframe breakdown showing what the weekly, daily, 4-hour, 1-hour, and 30-minute charts are each saying, and how many are aligned in the same direction."
            >Signals</button>
            <button
              className={`sub-btn${analyzeView === 'swing' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('swing')}
              data-tip="Timing — confirms whether right now is the right moment to enter, or if you should wait for a stronger signal on the 4-hour chart."
            >Timing</button>
            <button
              className={`sub-btn${analyzeView === 'chart' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('chart')}
              data-tip="Chart — price chart with your EMA family overlays, Fibonacci levels, gap markers, and volume. Switch between weekly, daily, 4H, 1H, 15M, and 5M."
            >Chart</button>
            <button
              className={`sub-btn${analyzeView === 'market' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('market')}
              data-tip="Market — overall market health: VIX fear level, how many stocks are rising vs falling, and which sectors are leading. Check this before every trade."
            >Market</button>

            {/* ── Divider between primary and research tabs ── */}
            <span className="sub-divider" />

            {/* ── Research tabs (less frequently needed) ── */}
            <button
              className={`sub-btn sub-btn-secondary${analyzeView === 'watchlist' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('watchlist')}
              data-tip="Watchlist — all your saved tickers ranked by signal strength. Run this before the market opens each day to find the day's strongest setups."
            >
              Watchlist
              {watchlist.length > 0 && (
                <span className="tab-badge">{watchlist.length}</span>
              )}
            </button>
            <button
              className={`sub-btn sub-btn-secondary${analyzeView === 'earnings' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('earnings')}
              data-tip="Earnings — upcoming earnings date and the expected price move. Helps you decide whether to hold through the report or exit before it."
            >Earnings</button>
            <button
              className={`sub-btn sub-btn-secondary${analyzeView === 'insider' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('insider')}
              data-tip="Insiders — recent buying and selling by company executives and board members. Heavy insider buying is one of the strongest bullish signals available."
            >
              Insiders
              {insiderData?.total90d > 0 && (
                <span className="tab-badge">{insiderData.total90d}</span>
              )}
            </button>
            <button
              className={`sub-btn sub-btn-secondary${analyzeView === 'history' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('history')}
              data-tip="History — EMA 15/30 cross win rate for this ticker: how often past bull and bear signals moved ≥3% in the right direction within 10 trading days."
            >History</button>
            <button
              className={`sub-btn sub-btn-secondary${analyzeView === 'wyckoff' ? ' active' : ''}`}
              onClick={() => setAnalyzeView('wyckoff')}
              data-tip="Wyckoff — identifies whether smart money is accumulating (Spring = buy), distributing (UTAD = sell), or in markup/markdown. The most direct read on institutional intent."
            >Wyckoff</button>
          </div>

          {analyzeView === 'brief' && isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SkeletonCard rows={4} title />
              <SkeletonCard rows={6} title />
              <SkeletonCard rows={3} title />
            </div>
          )}

          {analyzeView === 'brief' && !isLoading && (
            <BestTradeNow
              watchlist={watchlist}
              onLoadTicker={t => { handleLoadTicker(t); setAnalyzeView('brief') }}
              currentTicker={ticker}
            />
          )}

          {analyzeView === 'brief' && !isLoading && (
            <TradeBrief
              ticker={ticker}
              currentPrice={currentPrice}
              tradeScore={tradeScore}
              confluenceResult={confluenceResult}
              swingResult={swingResult}
              setupGrade={setupGrade}
              ivData={ivData}
              historicalVol={historicalVol}
              adxSignal={adxSignal}
              fibLevels={fibLevels}
              orbRetest={orbRetest}
              earningsDate={earningsDate}
              vixData={vixData}
              weeklyAlign={weeklyAlign}
              insiderData={insiderData}
              sectorRS={sectorRS}
              regimeBlocked={regimeBlocked}
              lastUpdated={lastUpdated}
              isEnriching={isEnriching}
              cycleData={cycleData}
              dailyBars={dailyBars}
              shortInterest={shortInterest}
              breadthData={breadthData}
              breadthLoading={breadthLoading}
              vwapSignal={vwapSignal}
              onRefreshBreadth={refreshBreadth}
              onNavigate={v => setAnalyzeView(v)}
              optionsChain={optionsChain}
              volumeSpike={volumeSpike}
              volumeProfile={volumeProfile}
              wyckoff={wyckoffData}
            />
          )}

          {analyzeView === 'confluence' && (
            <>
              <AlignmentMatrix
                tfStates={tfStates}
                timeframes={TIMEFRAMES}
                weeklyGate={confluenceResult.weeklyGate}
                dailyGate={confluenceResult.dailyGate}
              />
              {optionsChain?.ivLean && optionsChain.ivLean.dir !== 'neutral' && (() => {
                const { dir, strength, pcv, skew } = optionsChain.ivLean
                const isBull = dir === 'bull'
                const color  = isBull ? '#10b981' : '#ef4444'
                const bg     = isBull ? '#011c10' : '#1a0000'
                const border = isBull ? '#065f46' : '#7f1d1d'
                return (
                  <div className="iv-lean-bar" style={{ borderColor: border, background: bg }}>
                    <span className="iv-lean-icon" style={{ color }}>{isBull ? '▲' : '▼'}</span>
                    <span className="iv-lean-label" style={{ color }}>
                      {strength === 'strong' ? 'STRONG' : 'MILD'} {isBull ? 'CALL' : 'PUT'} FLOW
                    </span>
                    <span className="iv-lean-detail">
                      {pcv != null && <span>P/C Vol: <b>{pcv.toFixed(2)}</b></span>}
                      {skew != null && <span>IV Skew: <b style={{ color: skew > 0 ? '#10b981' : '#ef4444' }}>{skew > 0 ? '+' : ''}{skew.toFixed(1)}%</b></span>}
                    </span>
                    <span className="iv-lean-note">Options market is pricing in {isBull ? 'upside' : 'downside'} demand</span>
                  </div>
                )
              })()}
              <div className="main-layout">
                <div className="tf-panels">
                  {TIMEFRAMES.map(tf => (
                    <TimeframePanel
                      key={tf.id}
                      tf={tf}
                      values={tfStates[tf.id]}
                      onFieldChange={(fieldId, value) => handleFieldChange(tf.id, fieldId, value)}
                      collapsed={collapsed[tf.id]}
                      onToggleCollapse={() => handleToggleCollapse(tf.id)}
                    />
                  ))}
                </div>
                <aside className="rec-aside">
                  <EntryRecommendation
                    result={confluenceResult}
                    ticker={ticker}
                    orbRetest={orbRetest}
                    ivData={ivData}
                    regimeBlocked={regimeBlocked}
                    swingResult={swingResult}
                    vwapSignal={vwapSignal}
                  />
                </aside>
              </div>
            </>
          )}

          {analyzeView === 'insider' && (
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              <InsiderActivity
                data={insiderData}
                ticker={ticker}
                isLoading={insiderLoading}
                shortInterest={shortInterest}
              />
            </div>
          )}

          {analyzeView === 'watchlist' && (
            <WatchlistBoard watchlist={watchlist} onLoadTicker={handleLoadTicker} />
          )}

          {analyzeView === 'market' && (
            <MarketBreadth
              data={breadthData}
              isLoading={breadthLoading}
              onRefresh={refreshBreadth}
            />
          )}

          {analyzeView === 'history' && (
            <SignalHistory
              closes={dailyBars?.closes}
              highs={dailyBars?.highs}
              lows={dailyBars?.lows}
              volumes={dailyBars?.volumes}
              timestamps={dailyBars?.timestamps}
              ticker={ticker}
            />
          )}

          {analyzeView === 'wyckoff' && (
            <WyckoffPanel wyckoff={wyckoffData} ticker={ticker} />
          )}

          {analyzeView === 'earnings' && (
            <EarningsMode
              ticker={ticker}
              currentPrice={currentPrice}
              ivData={ivData}
              dailyCloses={dailyBars?.closes}
              dailyTimestamps={dailyBars?.timestamps}
            />
          )}

          {analyzeView === 'chart' && (() => {
            const isPmTf = ['1H', '15M', '5M'].includes(chartTf)
            const pmKey  = chartTf === '1H' ? '1h' : chartTf === '15M' ? '15m' : '5m'
            const chartBarsMap = {
              W: weeklyBars, D: dailyBars, '4H': fourHBars,
              '1H':  (showPreMarket && pmBars?.['1h']?.closes?.length)  ? pmBars['1h']  : oneHBars,
              '15M': (showPreMarket && pmBars?.['15m']?.closes?.length) ? pmBars['15m'] : fifteenMBars,
              '5M':  (showPreMarket && pmBars?.['5m']?.closes?.length)  ? pmBars['5m']  : fiveMBars,
            }
            const chartBars = chartBarsMap[chartTf] ?? dailyBars
            return (
              <>
                <div className="chart-tf-row">
                  <span className="chart-tf-group-label">TREND</span>
                  {['W','D'].map(tf => (
                    <button
                      key={tf}
                      className={`chart-tf-btn${chartTf === tf ? ' active' : ''}`}
                      onClick={() => setChartTf(tf)}
                      disabled={!chartBarsMap[tf]}
                    >{tf}</button>
                  ))}
                  <span className="chart-tf-sep" />
                  <span className="chart-tf-group-label">ENTRY</span>
                  {['4H','1H','15M','5M'].map(tf => (
                    <button
                      key={tf}
                      className={`chart-tf-btn${chartTf === tf ? ' active' : ''}`}
                      onClick={() => setChartTf(tf)}
                      disabled={!chartBarsMap[tf]}
                    >{tf}</button>
                  ))}
                  <span className="chart-tf-sep" />
                  <button
                    className={`chart-tf-btn${showPreMarket ? (pmFetchError ? ' pm-error' : ' active') : ''}`}
                    onClick={togglePreMarket}
                    disabled={!ticker || pmLoading}
                    title={pmFetchError || 'Show pre-market session (4:00 AM – 9:30 AM ET) on 1H, 15M, and 5M charts'}
                    style={showPreMarket && !pmFetchError ? { borderColor: '#3b82f6', color: '#60a5fa' } : {}}
                  >
                    {pmLoading ? '…' : 'PRE'}
                  </button>
                </div>
                <PriceChart
                  key={`${ticker}-${chartTf}`}
                  closes={chartBars?.closes}
                  highs={chartBars?.highs}
                  lows={chartBars?.lows}
                  opens={chartBars?.opens}
                  volumes={chartBars?.volumes}
                  timestamps={chartBars?.timestamps}
                  fibLevels={chartTf === 'W' || chartTf === 'D' ? fibLevels : null}
                  orbHigh={orbRetest?.orHigh}
                  orbLow={orbRetest?.orLow}
                  title={ticker}
                  timeframe={chartTf}
                  showPreMarket={showPreMarket && isPmTf}
                  prevDayClose={prevDayCloseValue}
                />
                <PriceVolumePanel
                  closes={chartBars?.closes}
                  volumes={chartBars?.volumes}
                  chartTf={chartTf}
                />
                <CyclePanel cycle={cycleData} ticker={ticker} />
                <VolumeProfileCard volumeProfile={volumeProfile} />
              </>
            )
          })()}

          {analyzeView === 'swing' && (
            <div className="swing-layout">
              <div className="swing-config-col">
                {SWING_CATEGORIES.map(cat => (
                  <SwingCategoryPanel
                    key={cat.id}
                    cat={cat}
                    values={swingStates[cat.id]}
                    onFieldChange={(fieldId, value) => handleSwingFieldChange(cat.id, fieldId, value)}
                    collapsed={swingCollapsed[cat.id]}
                    onToggleCollapse={() => handleSwingToggleCollapse(cat.id)}
                  />
                ))}
              </div>
              <div className="swing-result-col">
                <SwingResult
                  result={swingResult} ticker={ticker} fibLevels={fibLevels}
                  rsiSignal={rsiSignal} adxSignal={adxSignal} maStack={maStack}
                  patterns={patterns} vwapSignal={vwapSignal} rsScore={rsScore}
                  volumeSpike={volumeSpike} vixData={vixData} setupGrade={setupGrade}
                  ivData={ivData} weeklyAlign={weeklyAlign} hsPatterns={hsPatterns}
                  contPatterns={contPatterns} sectorRS={sectorRS}
                  currentPrice={currentPrice} onLogTrade={logTrade}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Options tab ── */}
      {activeTab === 'options' && (
        <OptionsChain
          ticker={ticker}
          currentPrice={currentPrice}
          historicalVol={historicalVol}
          swingResult={swingResult}
          confluenceResult={confluenceResult}
          setupGrade={setupGrade}
          patterns={patterns}
          hsPatterns={hsPatterns}
          ivData={ivData}
          lastUpdated={lastUpdated}
          earningsDate={earningsDate}
          adxSignal={adxSignal}
          optionsChain={optionsChain}
          chainFetchDone={chainFetchDone}
          onRetryChain={handleRetryOptionsChain}
        />
      )}

      {/* ── Scanner tab: Market Scan + Flow via sub-toggle ── */}
      {activeTab === 'scanner' && (
        <>
          <div className="sub-toggle">
            <button
              className={`sub-btn${scannerView === 'market' ? ' active' : ''}`}
              onClick={() => setScannerView('market')}
              data-tip="Market Health — current conditions across SPY, QQQ, VIX, and sector breadth. Check this before any trade to know whether the market is working with you or against you."
            >Market</button>
            <button
              className={`sub-btn${scannerView === 'signal' ? ' active' : ''}`}
              onClick={() => setScannerView('signal')}
              data-tip="Setups — scan your watchlist for tickers showing a bullish or bearish signal right now. Sort by signal strength to find the best opportunities."
            >Setups</button>
            <button
              className={`sub-btn${scannerView === 'gaps' ? ' active' : ''}`}
              onClick={() => setScannerView('gaps')}
              data-tip="Gaps — stocks that opened significantly higher or lower than yesterday's close. Gaps create momentum and are often the fastest-moving trades of the day."
            >Gaps</button>
            <button
              className={`sub-btn${scannerView === 'sectors' ? ' active' : ''}`}
              onClick={() => setScannerView('sectors')}
              data-tip="Sectors — which industry sectors (tech, healthcare, energy, etc.) are outperforming the S&P 500 and which are lagging. Money flows from weak sectors to strong ones."
            >Sectors</button>
            <button
              className={`sub-btn${scannerView === 'alerts' ? ' active' : ''}`}
              onClick={() => setScannerView('alerts')}
              data-tip="Alerts — set a price target on any ticker and get notified the moment it crosses. Works while you're away from the screen."
            >Alerts</button>
            <button
              className={`sub-btn${scannerView === 'flow' ? ' active' : ''}`}
              onClick={() => setScannerView('flow')}
              data-tip="Options Flow — large options bets placed by institutional traders. Unusual call or put activity often reveals where smart money is positioned before a move."
            >Options Flow</button>
            <button
              className={`sub-btn${scannerView === 'tape' ? ' active' : ''}`}
              onClick={() => setScannerView('tape')}
              data-tip="Live Flow — real-time stream of options trades printing right now. See every large position the moment it happens."
            >Live Flow</button>
            <button
              className={`sub-btn${scannerView === 'playbook' ? ' active' : ''}`}
              onClick={() => setScannerView('playbook')}
              data-tip="Playbook — based on today's market regime (bull, bear, or defensive), see which ETFs to play and the exact entry and exit rules for each using your EMA family."
            >Playbook</button>
          </div>
          {scannerView === 'market' && (
            <Scanner
              onLoadTicker={t => {
                setTicker(t); handleFetch(t)
                setActiveTab('analyze'); setAnalyzeView('confluence')
              }}
              onLoadAndBrief={t => {
                setTicker(t); handleFetch(t)
                setActiveTab('analyze'); setAnalyzeView('brief')
              }}
            />
          )}
          {scannerView === 'flow' && (
            <FlowScanner
              onLoadTicker={t => {
                setTicker(t); handleFetch(t)
                setActiveTab('analyze'); setAnalyzeView('confluence')
              }}
            />
          )}
          {scannerView === 'signal' && (
            <SignalScanner
              watchlist={watchlist}
              onLoadTicker={t => {
                setTicker(t); handleFetch(t)
                setActiveTab('analyze'); setAnalyzeView('confluence')
              }}
            />
          )}
          {scannerView === 'gaps' && (
            <GapScanner
              watchlist={watchlist}
              onLoadTicker={t => {
                setTicker(t); handleFetch(t)
                setActiveTab('analyze'); setAnalyzeView('brief')
              }}
            />
          )}
          {scannerView === 'sectors' && (
            <SectorRotation
              sectors={breadthData?.sectors}
              loading={breadthLoading && !breadthData?.sectors}
            />
          )}
          {scannerView === 'alerts' && (
            <PriceLevelAlerts
              currentTicker={ticker}
              fibLevels={fibLevels}
              orbRetest={orbRetest}
            />
          )}
          {scannerView === 'tape' && (
            <FlowTape watchlist={watchlist} />
          )}
          {scannerView === 'playbook' && (
            <PlaybookPanel
              breadthData={breadthData}
              vixData={breadthData?.vix ?? vixData}
              onLoadTicker={t => {
                setTicker(t); handleFetch(t)
                setActiveTab('analyze'); setAnalyzeView('brief')
              }}
            />
          )}
        </>
      )}

      {/* ── Trades tab: Journal ── */}
      {activeTab === 'trades' && (
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 12px' }}>
          <TradeJournal />
        </div>
      )}

      {/* ── Backtest tab ── */}
      {activeTab === 'backtest' && (
        <Backtest ticker={ticker} onResult={r => setBacktestResult(r)} />
      )}

      {/* ── Persistent verdict bar (fixed bottom) ── */}
      {liveLoaded && (
        <div className={`verdict-bar${
          regimeBlocked ? ' verdict-regime'
          : confluenceResult.signal === 'CALL' ? ' verdict-call'
          : confluenceResult.signal === 'PUT'  ? ' verdict-put'
          : ' verdict-neutral'
        }`}>
          <div className="verdict-left">
            <span className="verdict-ticker">{ticker}</span>
            <span className="verdict-signal">
              {regimeBlocked ? 'HIGH RISK' : confluenceResult.signal}
            </span>
            {regimeBlocked && (
              <span className="verdict-gate">VIX TOO HIGH</span>
            )}
            {!regimeBlocked && confluenceResult.gateBlocked && (
              <span className="verdict-gate">WAIT — TIMING</span>
            )}
            {earningsDate && (() => {
              const d = Math.round((earningsDate.getTime() - Date.now()) / 86400000)
              return d > 0 && d <= 21
                ? <span className="verdict-earnings">EARN {d}d</span>
                : null
            })()}
          </div>
          <div className="verdict-detail">
            {regimeBlocked
              ? `VIX ${vixData?.current?.toFixed(0)} — market risk too elevated to enter new positions · wait for VIX to fall below 28`
              : !confluenceResult.gateBlocked
                ? `${confluenceResult.totalBull} bullish · ${confluenceResult.totalBear} bearish · ${Math.round(Math.abs(confluenceResult.confluence) * 100)}% aligned${backtestResult ? ` · Kelly ${backtestResult.kellyOptions}% sizing` : ''}`
                : `Higher timeframe disagrees — wait for alignment before entering`
            }
          </div>
          <div className="verdict-actions">
            <button className="verdict-btn" onClick={() => setActiveTab('options')}>→ Options</button>
            <button className="verdict-btn" onClick={() => setActiveTab('backtest')}>→ Backtest</button>
          </div>
        </div>
      )}
    </div>
  )
}
