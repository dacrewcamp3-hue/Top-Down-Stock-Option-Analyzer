// Plain-English definitions for every field shown in the timeframe panels.
// Keyed by field.id from timeframes.js.
export const GLOSSARY = {
  trend:
    'The overall direction price has been moving. Bullish = making higher highs. Bearish = making lower lows.',

  structure:
    'HH/HL = Higher Highs & Higher Lows (uptrend confirmed). LH/LL = Lower Highs & Lower Lows (downtrend confirmed). Ranging = price bouncing sideways with no clear direction.',

  priceVsEMA:
    'The 30 EMA (Exponential Moving Average) acts as the midfield line. Price above it = bulls in control. Price below it = bears in control.',

  rsi:
    'RSI (Relative Strength Index) measures buying and selling pressure on a scale of 0–100. Above 44 = bulls have the edge. 30–44 = bearish zone. Below 30 = extremely oversold — could bounce.',

  macd:
    'MACD vs the signal line (Gunline). When MACD crosses above the Gunline, momentum is turning bullish. Crossing below = turning bearish.',

  keyLevel:
    'A price zone where buyers or sellers have historically stepped in. Near support = bounce zone. Near resistance = rejection zone.',

  volume:
    'How many shares are trading. High volume confirms a move is real. Low volume on a breakout = potential fake-out.',

  entryTrigger:
    'The final confirmation to pull the trigger — a bullish or bearish candle pattern, breakout, or momentum confirmation.',

  ema8Cross:
    '2-bar 8 EMA rule: two consecutive bars closing above the 8 EMA confirms bull momentum. Two bars below confirms bear momentum. One bar isn\'t enough.',

  orbBreak:
    'Opening Range Breakout — the first 15-minute candle sets the ORH (high) and ORL (low). A close above ORH = bullish breakout. A close below ORL = bearish breakdown.',

  priceVsVWAP:
    'VWAP (Volume Weighted Average Price) is the fair price of the day used by institutions. Price above VWAP = bulls in control. Below = bears in control.',

  adx:
    'ADX "21 Savage" measures trend strength. ADX above 21 = a real trend is in place (not just chop). +DI above 21 = bulls are stronger. −DI above 21 = bears are stronger.',
}
