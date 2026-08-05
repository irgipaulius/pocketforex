/** Ranges the FX chart can show, mapped to the data feed's range + candle size. */
export const FX_RANGES = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1h" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "3Y": { range: "5y", interval: "1wk" },
  "5Y": { range: "10y", interval: "1wk" },
  MAX: { range: "max", interval: "1mo" },
} as const;

export type FxRangeKey = keyof typeof FX_RANGES;

export type FxPoint = { time: number; value: number };
