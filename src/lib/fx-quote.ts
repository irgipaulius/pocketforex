/**
 * FX quote orientation helpers.
 *
 * Everywhere else in the app, a rate means: 1 <base> = rate <currency>
 * (euro-based in storage, then rebased to the user's main currency).
 *
 * Revolut files and hand-typed figures sometimes arrive already inverted
 * ("how many euros for 1 dollar"), or with a garbage cost basis (e.g. EUR
 * deposits kept after USD withdrawals). Orient first, then reject anything
 * still impossibly far from the market.
 */
import type { FxTrade } from "./fx-trades";

/** ~60% away from market in log space → treat as corrupted, not exotic.
 *  Wide enough for multi-year EUR/USD swings; tight enough to reject 0.34→2.95 garbage. */
const IMPLAUSIBLE_LOG = Math.log(1.6);

/** Pick `rate` or `1/rate`, whichever is closer to `reference` on a log scale. */
export function orientCurrencyPerBase(rate: number, reference: number): number {
  if (!(rate > 0) || !(reference > 0)) return rate;
  const keep = Math.abs(Math.log(rate / reference));
  const flip = Math.abs(Math.log(1 / rate / reference));
  return keep <= flip ? rate : 1 / rate;
}

/**
 * Orient a "currency per 1 base" quote, then fall back to `market` when the
 * result is still absurdly far from it (classic bad statement cost basis).
 *
 * `trustFar: true` for rates the user typed in by hand — only orient those.
 */
export function saneCurrencyPerBase(
  rate: number,
  market: number,
  opts?: { trustFar?: boolean },
): { rate: number; usedMarket: boolean } {
  if (!(market > 0)) {
    return { rate: rate > 0 ? rate : 0, usedMarket: false };
  }
  if (!(rate > 0)) return { rate: market, usedMarket: true };

  const oriented = orientCurrencyPerBase(rate, market);
  if (opts?.trustFar) return { rate: oriented, usedMarket: false };

  const dist = Math.abs(Math.log(oriented / market));
  if (dist > IMPLAUSIBLE_LOG) return { rate: market, usedMarket: true };
  return { rate: oriented, usedMarket: false };
}

/**
 * Remaining position from a sequence of buys/sells, with cost basis reduced
 * proportionally on each sale (average-cost method).
 *
 * Returns amounts in the trade's native units: `entryBase` is what you still
 * have tied up in the main currency, `basePerCurrency` is the break-even
 * "1 currency = X base" level.
 */
export function netFxCostBasis(
  trades: FxTrade[],
  currency: string,
): { holding: number; entryBase: number; basePerCurrency: number; currencyPerBase: number } | null {
  const mine = trades.filter((t) => t.currency === currency && t.rate > 0 && t.eurAmount > 0);
  if (mine.length === 0) return null;

  let holding = 0;
  let entryBase = 0;
  for (const t of mine) {
    if (t.amount > 0) {
      holding += t.amount;
      entryBase += t.eurAmount;
      continue;
    }
    if (t.amount >= 0 || holding <= 0) continue;
    const sold = Math.min(holding, -t.amount);
    const costPer = entryBase / holding;
    holding -= sold;
    entryBase -= costPer * sold;
  }

  if (!(holding > 0) || !(entryBase > 0)) return null;
  const basePerCurrency = entryBase / holding;
  return {
    holding,
    entryBase,
    basePerCurrency,
    currencyPerBase: 1 / basePerCurrency,
  };
}

/**
 * When a "base per currency" figure and the live "base per currency" rate sit
 * on opposite sides of 1, one of them is almost certainly inverted — flip the
 * candidate toward the live quote.
 */
export function alignQuoteWithLive(candidate: number, liveBasePerCurrency: number): number {
  if (!(candidate > 0) || !(liveBasePerCurrency > 0)) return candidate;
  if (candidate > 1 === liveBasePerCurrency > 1) return candidate;
  return 1 / candidate;
}

/** True when a "currency per base" quote is too far from market to trust. */
export function isImplausibleRate(rate: number, market: number): boolean {
  if (!(rate > 0) || !(market > 0)) return true;
  const oriented = orientCurrencyPerBase(rate, market);
  return Math.abs(Math.log(oriented / market)) > IMPLAUSIBLE_LOG;
}
