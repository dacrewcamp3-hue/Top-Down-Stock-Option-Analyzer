// EMA 15/30 cross signal history with 4 quality filters (all thresholds match the rest of the app):
//   1. Trend alignment  — cross must follow EMA 65 direction (bull above EMA 65, bear below)
//   2. ADX 21 Savage    — ADX ≥ 21 AND +DI ≥ 21 (bull) or −DI ≥ 21 (bear); choppy markets skipped
//   3. Volume ≥ 1.25×  — cross bar must have above-average volume (20-bar SMA × 1.25)
//   4. RSI gate         — bull: RSI > 44 and rising  |  bear: RSI < 43 and falling (intentional 1-pt gap)

function buildEMA(prices, period) {
  const k = 2 / (period + 1)
  const out = new Array(prices.length)
  out[0] = prices[0]
  for (let i = 1; i < prices.length; i++) {
    out[i] = prices[i] * k + out[i - 1] * (1 - k)
  }
  return out
}

function buildRSI(closes, period = 14) {
  const n   = closes.length
  const rsi = new Array(n).fill(50)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period && i < n; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  for (let i = period; i < n; i++) {
    if (i > period) {
      const d = closes[i] - closes[i - 1]
      avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
      avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
    }
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs)
  }
  return rsi
}

// Returns { adx, plusDI, minusDI } arrays — full "21 Savage" data set.
// bull rule: adx >= 21 && plusDI  >= 21
// bear rule: adx >= 21 && minusDI >= 21
function buildADX(highs, lows, closes, period = 14) {
  const n = closes.length
  const zero = () => new Array(n).fill(0)
  if (!highs || !lows || n < period * 2 + 2) return { adx: zero(), plusDI: zero(), minusDI: zero() }

  const tr = [0], pdm = [0], ndm = [0]
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])))
    const up = highs[i] - highs[i-1], dn = lows[i-1] - lows[i]
    pdm.push(up > dn && up > 0 ? up : 0)
    ndm.push(dn > up && dn > 0 ? dn : 0)
  }

  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0)
  let pdi = pdm.slice(1, period + 1).reduce((a, b) => a + b, 0)
  let ndi = ndm.slice(1, period + 1).reduce((a, b) => a + b, 0)

  const adxArr = zero(), plusArr = zero(), minusArr = zero()
  const dx = zero()

  for (let i = period; i < n; i++) {
    if (i > period) {
      atr = atr - atr / period + tr[i]
      pdi = pdi - pdi / period + pdm[i]
      ndi = ndi - ndi / period + ndm[i]
    }
    const pp = atr > 0 ? (pdi / atr) * 100 : 0
    const np = atr > 0 ? (ndi / atr) * 100 : 0
    plusArr[i]  = pp
    minusArr[i] = np
    const s = pp + np
    dx[i] = s > 0 ? (Math.abs(pp - np) / s) * 100 : 0
  }

  let adxVal = dx.slice(period, 2 * period).reduce((a, b) => a + b, 0) / period
  if (2 * period - 1 < n) adxArr[2 * period - 1] = adxVal
  for (let i = 2 * period; i < n; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period
    adxArr[i] = adxVal
  }
  return { adx: adxArr, plusDI: plusArr, minusDI: minusArr }
}

function buildVolSMA(volumes, period = 20) {
  const avg = new Array(volumes.length).fill(0)
  for (let i = period - 1; i < volumes.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += (volumes[j] || 0)
    avg[i] = sum / period
  }
  return avg
}

export function calcSignalHistory(
  closes, timestamps,
  { highs, lows, volumes, lookForward = 10, winThresholdPct = 3 } = {}
) {
  if (!closes || closes.length < 65) return null

  const e15              = buildEMA(closes, 15)
  const e30              = buildEMA(closes, 30)
  const e65              = buildEMA(closes, 65)
  const rsi              = buildRSI(closes)
  const { adx, plusDI, minusDI } = buildADX(highs, lows, closes, 14)
  const volAvg           = volumes ? buildVolSMA(volumes, 20) : null

  // Warmup: need EMA 65 and ADX (28 bars) to be meaningful
  const warmup = Math.max(65, 28)

  const signals = []
  let trendBlocked = 0, adxBlocked = 0, volBlocked = 0, rsiBlocked = 0

  for (let i = warmup; i < closes.length; i++) {
    const bullCross = e15[i] > e30[i] && e15[i - 1] <= e30[i - 1]
    const bearCross = e15[i] < e30[i] && e15[i - 1] >= e30[i - 1]
    if (!bullCross && !bearCross) continue

    const isBull = bullCross

    // ── Filter 1: Trend alignment (EMA 65 direction) ─────────────────────
    const trendOk = isBull ? closes[i] > e65[i] : closes[i] < e65[i]

    // ── Filter 2: Full "21 Savage" rule — ADX ≥ 21 AND directional DI ≥ 21 ─
    // Matches autoSignals.js, runBacktest.js, App.jsx (all use ADX + DI dual check)
    const adxOk = isBull
      ? adx[i] >= 21 && plusDI[i]  >= 21
      : adx[i] >= 21 && minusDI[i] >= 21

    // ── Filter 3: Volume ≥ 1.25× 20-bar average ──────────────────────────
    const volOk = !volAvg || volAvg[i] === 0
      || (volumes[i] || 0) >= volAvg[i] * 1.25

    // ── Filter 4: RSI position + direction ───────────────────────────────
    // Matches indicators.js: above44 = RSI > 44 (bull), below43 = RSI < 43 (bear)
    // The 1-point 43/44 gap is intentional — no man's land at the boundary.
    const rsiVal  = rsi[i]
    const rsiUp   = rsi[i] > rsi[i - 1]
    const rsiOk   = isBull ? (rsiVal > 44 && rsiUp) : (rsiVal < 43 && !rsiUp)

    if (!trendOk) trendBlocked++
    if (!adxOk)   adxBlocked++
    if (!volOk)   volBlocked++
    if (!rsiOk)   rsiBlocked++

    const passes = trendOk && adxOk && volOk && rsiOk

    const entry   = closes[i]
    const fwdEnd  = Math.min(i + lookForward, closes.length - 1)
    const fwd     = closes.slice(i + 1, fwdEnd + 1)
    const pending = fwd.length < lookForward

    let bestPct = 0, win = false
    if (fwd.length > 0) {
      const extreme = isBull ? Math.max(...fwd) : Math.min(...fwd)
      bestPct = +((extreme - entry) / entry * 100).toFixed(1)
      win = isBull ? bestPct >= winThresholdPct : bestPct <= -winThresholdPct
    }

    signals.push({
      kind: isBull ? 'bull' : 'bear',
      date: timestamps ? new Date(timestamps[i] * 1000) : null,
      entry, bestPct, win, pending, passes,
      filters: { trend: trendOk, adx: adxOk, volume: volOk, rsi: rsiOk },
    })
  }

  if (signals.length === 0) return null

  // Raw stats (all signals, no filter)
  const rawBulls = signals.filter(s => s.kind === 'bull' && !s.pending)
  const rawBears = signals.filter(s => s.kind === 'bear' && !s.pending)

  // Filtered stats (only signals that pass all 4 gates)
  const filtBulls = signals.filter(s => s.kind === 'bull' && !s.pending && s.passes)
  const filtBears = signals.filter(s => s.kind === 'bear' && !s.pending && s.passes)

  const totalRaw = rawBulls.length + rawBears.length

  return {
    all:             signals,
    recent:          signals.slice(-10),
    // Unfiltered baseline
    bullWinRate:     rawBulls.length > 0 ? Math.round(rawBulls.filter(s => s.win).length / rawBulls.length * 100) : null,
    bearWinRate:     rawBears.length > 0 ? Math.round(rawBears.filter(s => s.win).length / rawBears.length * 100) : null,
    bullCount:       rawBulls.length,
    bearCount:       rawBears.length,
    // Filtered (quality-gated)
    filtBullWinRate: filtBulls.length > 0 ? Math.round(filtBulls.filter(s => s.win).length / filtBulls.length * 100) : null,
    filtBearWinRate: filtBears.length > 0 ? Math.round(filtBears.filter(s => s.win).length / filtBears.length * 100) : null,
    filtBullCount:   filtBulls.length,
    filtBearCount:   filtBears.length,
    // Filter rejection breakdown
    filterStats: {
      total:   totalRaw,
      passed:  filtBulls.length + filtBears.length,
      trend:   trendBlocked,
      adx:     adxBlocked,
      volume:  volBlocked,
      rsi:     rsiBlocked,
    },
    winThreshold: winThresholdPct,
    lookForward,
  }
}
