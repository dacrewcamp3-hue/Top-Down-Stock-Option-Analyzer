# Top-Down Option Analyzer

A React app for top-down multi-timeframe confluence analysis to generate CALL / PUT / NO TRADE recommendations for stock options.

## Setup

```bash
cd top-down-analyzer
npm install
npm run dev
```

Open http://localhost:5173

## How it works

1. Enter a ticker symbol (optional — for reference only)
2. Work top-down: fill in signals for each timeframe (Weekly → Daily → 4H → 1H → 15M)
3. Click any signal button to select it — click again to deselect
4. The recommendation updates live based on weighted confluence

**Scoring rules:**
- `bull` / `bear` signals contribute to the score; `neutral` is ignored
- Higher timeframes carry more weight (Weekly = 5, Daily = 4, 4H = 3, 1H = 2, 15M = 1)
- CALL fires when ≥ 60% of weighted directional signals are bullish
- PUT fires when ≥ 60% of weighted directional signals are bearish
- Minimum 3 directional signals required before any recommendation fires
- Everything between ±60% = NO TRADE

## Customizing

### Add / remove fields

Edit `src/data/timeframes.js`. Each field object looks like:

```js
{
  id: 'myField',
  label: 'My Indicator',
  options: [
    { label: 'Bullish label', value: 'bull' },
    { label: 'Bearish label', value: 'bear' },
    { label: 'Neutral label', value: 'neutral' },
  ],
}
```

### Change thresholds

Edit `src/utils/analyzeEntry.js`:

```js
export const CALL_THRESHOLD = 0.60  // raise for stricter CALL
export const PUT_THRESHOLD  = -0.60 // lower for stricter PUT
export const MIN_SIGNALS    = 3     // minimum directional signals required
```

### Change timeframe weights

In `src/data/timeframes.js`, adjust the `weight` property on each timeframe object.

## File structure

```
src/
├── App.jsx                     main layout + state
├── components/
│   ├── TimeframePanel.jsx      collapsible per-TF input panel
│   ├── TimeframePanel.css
│   ├── EntryRecommendation.jsx CALL/PUT/NO TRADE output card
│   └── EntryRecommendation.css
├── data/
│   └── timeframes.js           all TF configs + field definitions
└── utils/
    └── analyzeEntry.js         signal scoring logic
```
