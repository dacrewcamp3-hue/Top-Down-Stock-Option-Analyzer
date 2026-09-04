// Swing trade signal system — focused on the 4H 5 EMA rule.
// Entry: 2 consecutive 4H bars close ABOVE 5 EMA
// Exit:  2 consecutive 4H bars close BELOW 5 EMA
//
// Options use `direction` (bull/bear/neutral) instead of points.

export const SWING_CATEGORIES = [
  {
    id: 'fourHSignal',
    label: '4H vs 5 EMA',
    shortLabel: '4H',
    defaultCollapsed: false,
    fields: [
      {
        id: 'lastBar',
        label: 'Last Closed 4H Bar',
        type: 'single',
        options: [
          { id: 'above', label: 'Closed Above 5 EMA', direction: 'bull' },
          { id: 'below', label: 'Closed Below 5 EMA', direction: 'bear' },
        ],
      },
      {
        id: 'prevBar',
        label: 'Previous 4H Bar',
        type: 'single',
        options: [
          { id: 'above', label: 'Closed Above 5 EMA', direction: 'bull' },
          { id: 'below', label: 'Closed Below 5 EMA', direction: 'bear' },
        ],
      },
    ],
  },
  {
    id: 'trendFilter',
    label: 'Trend Alignment',
    shortLabel: 'TREND',
    defaultCollapsed: false,
    fields: [
      {
        id: 'dailyTrend',
        label: 'Daily Trend',
        type: 'single',
        options: [
          { id: 'bull', label: 'Bullish', direction: 'bull' },
          { id: 'neutral', label: 'Neutral', direction: 'neutral' },
          { id: 'bear', label: 'Bearish', direction: 'bear' },
        ],
      },
      {
        id: 'weeklyTrend',
        label: 'Weekly Trend',
        type: 'single',
        options: [
          { id: 'bull', label: 'Bullish', direction: 'bull' },
          { id: 'neutral', label: 'Neutral', direction: 'neutral' },
          { id: 'bear', label: 'Bearish', direction: 'bear' },
        ],
      },
    ],
  },
]
