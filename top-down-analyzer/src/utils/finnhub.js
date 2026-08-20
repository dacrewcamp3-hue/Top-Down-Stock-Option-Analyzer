// Finnhub free-tier data client.
// Free plan: 60 API calls/minute · real-time US quotes · 1-min candles back 1 year.
// Sign up free at https://finnhub.io → Dashboard → API Keys → copy your key.
// Paste it in the app's Settings panel (gear icon in the header).
//
// Resolution mapping (Yahoo → Finnhub):
//   1wk → W   1d → D   60m → 60   15m → 15   5m → 5   1m → 1

const BASE = 'https://finnhub.io/api/v1'

// ── Key storage ──────────────────────────────────────────────────────────────
const KEY_LS = 'finnhub_api_key'
let _key = localStorage.getItem(KEY_LS) || ''

export function getFinnhubKey()        { return _key }
export function hasFinnhubKey()        { return !!_key }
export function setFinnhubKey(k)       { _key = k.trim(); localStorage.setItem(KEY_LS, _key) }
export function clearFinnhubKey()      { _key = ''; localStorage.removeItem(KEY_LS) }

function url(path, params = {}) {
  const q = new URLSearchParams({ ...params, token: _key })
  return `${BASE}${path}?${q}`
}

// ── Candle fetch ─────────────────────────────────────────────────────────────
// resolution: '1' '5' '15' '30' '60' 'D' 'W' 'M'
// Returns { t, o, h, l, c, v } arrays (same shape as Yahoo parse output)
export async function finnhubCandles(symbol, resolution, fromUnix, toUnix) {
  if (!_key) return null
  const r = await fetch(url('/stock/candle', { symbol, resolution, from: fromUnix, to: toUnix }))
  if (!r.ok) return null
  const d = await r.json()
  if (d.s !== 'ok' || !d.t?.length) return null
  return { t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v }
}

// ── Real-time quote ──────────────────────────────────────────────────────────
// Returns { c, d, dp, h, l, o, pc, t } (current, change, changePct, high, low, open, prevClose, time)
export async function finnhubQuote(symbol) {
  if (!_key) return null
  const r = await fetch(url('/quote', { symbol }))
  if (!r.ok) return null
  const d = await r.json()
  if (!d.c) return null
  return d
}

// ── Company profile (for earnings date fallback) ─────────────────────────────
export async function finnhubProfile(symbol) {
  if (!_key) return null
  const r = await fetch(url('/stock/profile2', { symbol }))
  if (!r.ok) return null
  return r.json()
}

// ── Earnings calendar ────────────────────────────────────────────────────────
export async function finnhubEarnings(symbol) {
  if (!_key) return null
  const r = await fetch(url('/stock/earnings', { symbol, limit: 4 }))
  if (!r.ok) return null
  return r.json()
}

// ── WebSocket live price stream ──────────────────────────────────────────────
// onQuote(price, change, changePct) is called on each tick.
// Returns a cleanup function.
export function finnhubStream(symbol, onQuote) {
  if (!_key || !symbol) return () => {}

  const ws = new WebSocket(`wss://ws.finnhub.io?token=${_key}`)
  let alive = true

  ws.onopen = () => {
    if (alive) ws.send(JSON.stringify({ type: 'subscribe', symbol }))
  }

  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'trade' && msg.data?.length) {
        const latest = msg.data[msg.data.length - 1]
        onQuote(latest.p, null, null)   // price, change, changePct (change needs prev close)
      }
    } catch {}
  }

  ws.onerror = () => {}
  ws.onclose = () => {}

  return () => {
    alive = false
    try {
      ws.send(JSON.stringify({ type: 'unsubscribe', symbol }))
      ws.close()
    } catch {}
  }
}

// ── Resolution → seconds per bar (for from/to calculation) ──────────────────
const RES_SECS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, 'D': 86400, 'W': 604800 }

// Helper: fetch N bars back from now for a given resolution
export async function finnhubBarsBack(symbol, resolution, bars) {
  const secs = RES_SECS[resolution] ?? 86400
  const to   = Math.floor(Date.now() / 1000)
  // request 2× to account for weekends/holidays
  const from = to - secs * bars * 2.5
  return finnhubCandles(symbol, resolution, Math.floor(from), to)
}
