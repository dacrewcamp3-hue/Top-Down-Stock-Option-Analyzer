// Russian-doll timeframe hierarchy — higher TFs trump lower ones via weight.
// Each field option has a `value` of 'bull', 'bear', or 'neutral'.
// Only 'bull' and 'bear' options contribute to the confluence score.

const TREND_FIELD = {
  id: 'trend',
  label: 'Trend',
  options: [
    { label: 'Bullish', value: 'bull' },
    { label: 'Bearish', value: 'bear' },
    { label: 'Neutral', value: 'neutral' },
  ],
}

const STRUCTURE_FIELD = {
  id: 'structure',
  label: 'Market Structure',
  options: [
    { label: 'HH / HL', value: 'bull' },
    { label: 'LH / LL', value: 'bear' },
    { label: 'Ranging', value: 'neutral' },
  ],
}

const EMA_FIELD = {
  id: 'priceVsEMA',
  label: 'Price vs 30 EMA  (Midfield)',
  options: [
    { label: 'Above 30 EMA ↑', value: 'bull' },
    { label: 'Below 30 EMA ↓', value: 'bear' },
    { label: 'At 30 EMA', value: 'neutral' },
  ],
}

// RSI gate: ≥44 = get in bull side · 30-44 = bear territory · <30 oversold
const RSI_FIELD = {
  id: 'rsi',
  label: 'RSI  (44 = Get In)',
  options: [
    { label: 'Above 44 ↑', value: 'bull' },
    { label: '30–44 Bear Zone', value: 'bear' },
    { label: 'Under 30 (Extreme)', value: 'neutral' },
  ],
}

// MACD vs Gunline (signal line) — MACD above Gunline = money, MACD below = caution
const MACD_FIELD = {
  id: 'macd',
  label: 'MACD · Gunline',
  options: [
    { label: 'MACD above Gunline ↑ (histogram > 0)', value: 'bull' },
    { label: 'MACD below Gunline ↓ (histogram < 0)', value: 'bear' },
    { label: 'At Gunline / Flat', value: 'neutral' },
  ],
}

const KEY_LEVEL_FIELD = {
  id: 'keyLevel',
  label: 'Key Level',
  options: [
    { label: 'Near Support', value: 'bull' },
    { label: 'Near Resistance', value: 'bear' },
    { label: 'In Between', value: 'neutral' },
  ],
}

const VOLUME_FIELD = {
  id: 'volume',
  label: 'Volume',
  options: [
    { label: 'Above Avg', value: 'bull' },
    { label: 'Below Avg', value: 'bear' },
    { label: 'Average', value: 'neutral' },
  ],
}

const ENTRY_TRIGGER_FIELD = {
  id: 'entryTrigger',
  label: 'Entry Trigger',
  options: [
    { label: 'Bullish Signal', value: 'bull' },
    { label: 'Bearish Signal', value: 'bear' },
    { label: 'Indecision', value: 'neutral' },
  ],
}

// 2-bar 8 EMA cross confirmation — the primary entry trigger
const EMA8_CROSS_FIELD = {
  id: 'ema8Cross',
  label: '8 EMA Cross  (2 Bars)',
  options: [
    { label: '2 Bars Above 8 EMA ↑', value: 'bull' },
    { label: '2 Bars Below 8 EMA ↓', value: 'bear' },
    { label: 'Unconfirmed', value: 'neutral' },
  ],
}

const ORB_FIELD = {
  id: 'orbBreak',
  label: 'OR Break  (15M Gate)',
  options: [
    { label: 'Bull · ORH Break ↑', value: 'bull' },
    { label: 'Bear · ORL Break ↓', value: 'bear' },
    { label: 'Inside OR', value: 'neutral' },
  ],
}

const VWAP_FIELD = {
  id: 'priceVsVWAP',
  label: 'Price vs VWAP',
  options: [
    { label: 'Above VWAP ↑', value: 'bull' },
    { label: 'Below VWAP ↓', value: 'bear' },
    { label: 'At VWAP', value: 'neutral' },
  ],
}

// ADX "21 Savage" — 3 signals, 21 is the magic number
const ADX_FIELD = {
  id: 'adx',
  label: 'ADX  (21 Savage)',
  options: [
    { label: 'ADX≥21 & +DI≥21  🔼 Bull', value: 'bull' },
    { label: 'ADX≥21 & −DI≥21  🔽 Bear', value: 'bear' },
    { label: 'ADX < 21 or no DI ≥ 21  (No Clear Trend)', value: 'neutral' },
  ],
}

// weight = how strongly signals from this TF pull the confluence score.
// Russian-doll rule: outer rings (higher TFs) always outweigh inner rings.
export const TIMEFRAMES = [
  {
    id: 'weekly',
    label: '6-Month Weekly',
    shortLabel: 'WK',
    weight: 8,
    defaultCollapsed: false,
    fields: [TREND_FIELD, STRUCTURE_FIELD, EMA_FIELD, RSI_FIELD, ADX_FIELD, EMA8_CROSS_FIELD],
  },
  {
    id: 'daily',
    label: '3-Month Daily',
    shortLabel: 'DY',
    weight: 6,
    defaultCollapsed: false,
    fields: [TREND_FIELD, STRUCTURE_FIELD, EMA_FIELD, RSI_FIELD, MACD_FIELD, KEY_LEVEL_FIELD, ADX_FIELD, EMA8_CROSS_FIELD],
  },
  {
    id: '4h',
    label: '4 Hour',
    shortLabel: '4H',
    weight: 3,
    defaultCollapsed: true,
    fields: [TREND_FIELD, EMA_FIELD, RSI_FIELD, MACD_FIELD, ADX_FIELD, EMA8_CROSS_FIELD],
  },
  {
    id: '1h',
    label: '1 Hour',
    shortLabel: '1H',
    weight: 2,
    defaultCollapsed: true,
    fields: [TREND_FIELD, EMA_FIELD, RSI_FIELD, MACD_FIELD, ADX_FIELD, EMA8_CROSS_FIELD],
  },
  {
    id: '15m',
    label: '15 Min  ·  ORB Gate',
    shortLabel: '15M',
    weight: 1,
    defaultCollapsed: true,
    fields: [RSI_FIELD, ORB_FIELD, VWAP_FIELD, VOLUME_FIELD, EMA8_CROSS_FIELD],
  },
  {
    id: '5m',
    label: '5 Min  ·  Entry',
    shortLabel: '5M',
    weight: 1,
    defaultCollapsed: true,
    fields: [RSI_FIELD, MACD_FIELD, ADX_FIELD, VWAP_FIELD, ENTRY_TRIGGER_FIELD],
  },
]
