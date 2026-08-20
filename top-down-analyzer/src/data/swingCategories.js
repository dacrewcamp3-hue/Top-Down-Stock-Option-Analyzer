// Swing trade signal system — focused on the 4H 8 EMA rule.
// Entry: 2 consecutive 4H bars close ABOVE 8 EMA
// Exit:  2 consecutive 4H bars close BELOW 8 EMA
//
// Options use `direction` (bull/bear/neutral) instead of points.

export const SWING_CATEGORIES = [
  {
    id: 'fourHSignal',
    label: '4H vs 8 EMA',
    shortLabel: '4H',
    defaultCollapsed: false,
    fields: [
      {
        id: 'lastBar',
        label: 'Last Closed 4H Bar',
        type: 'single',
        options: [
          { id: 'above', label: 'Closed Above 8 EMA', direction: 'bull' },
          { id: 'below', label: 'Closed Below 8 EMA', direction: 'bear' },
        ],
      },
      {
        id: 'prevBar',
        label: 'Previous 4H Bar',
        type: 'single',
        options: [
          { id: 'above', label: 'Closed Above 8 EMA', direction: 'bull' },
          { id: 'below', label: 'Closed Below 8 EMA', direction: 'bear' },
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
  {
    id: 'marketConditions',
    label: 'Market Conditions',
    shortLabel: 'MKT',
    defaultCollapsed: true,
    fields: [
      {
        id: 'marketState',
        label: 'Overall Market (SPY / QQQ)',
        type: 'single',
        options: [
          { id: 'bull', label: 'Bullish / Uptrend', direction: 'bull' },
          { id: 'neutral', label: 'Neutral / Sideways', direction: 'neutral' },
          { id: 'bear', label: 'Bearish / Downtrend', direction: 'bear' },
        ],
      },
    ],
  },
  {
    id: 'riskSetup',
    label: 'Risk Setup',
    shortLabel: 'RISK',
    defaultCollapsed: true,
    fields: [
      {
        id: 'stopPlacement',
        label: 'Stop Placement',
        type: 'single',
        options: [
          { id: 'below8ema', label: 'Below 8 EMA (Long)', direction: 'bull' },
          { id: 'above8ema', label: 'Above 8 EMA (Short)', direction: 'bear' },
          { id: 'unclear', label: 'No Clear Level', direction: 'neutral' },
        ],
      },
      {
        id: 'rrRatio',
        label: 'Risk / Reward',
        type: 'single',
        options: [
          { id: '3to1', label: '3:1 or Better', direction: 'bull' },
          { id: '2to1', label: '2:1', direction: 'neutral' },
          { id: 'below2', label: 'Below 2:1', direction: 'bear' },
        ],
      },
    ],
  },
]
