/** Currency exchanges pulled out of a Revolut statement.
 *
 *  These are the moments you actually swapped money between euro and another
 *  currency. They are kept separately from positions so they can be drawn as
 *  markers on the rate chart without affecting portfolio totals.
 */

export type FxTrade = {
  id: string;
  /** ISO date of the exchange */
  date: string;
  /** the non-euro currency, e.g. "USD" */
  currency: string;
  /** amount of `currency` bought (positive) or sold (negative) */
  amount: number;
  /** the euro amount on the other side of the swap (always positive) */
  eurAmount: number;
  /** 1 EUR = rate <currency> for this exchange */
  rate: number;
  description?: string;
};

const KEY = "revolut-portfolio.fxtrades.v1";

export function loadFxTrades(): FxTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FxTrade[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFxTrades(list: FxTrade[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(list));
}

/** Same day + currency + amount = same exchange, however often it is imported. */
export function tradeKey(t: FxTrade) {
  return `${t.date}:${t.currency}:${t.amount.toFixed(2)}`;
}

export function mergeFxTrades(existing: FxTrade[], incoming: FxTrade[]): FxTrade[] {
  const seen = new Set(existing.map(tradeKey));
  const added = incoming.filter((t) => !seen.has(tradeKey(t)));
  return [...existing, ...added].sort((a, b) => a.date.localeCompare(b.date));
}
