/**
 * Everything imported from Revolut is stored euro-denominated, because the
 * reference rate feeds are euro-based. The dashboard, however, must work for
 * someone who thinks in CZK, PLN, GBP or anything else.
 *
 * This module is the single translation layer: it takes euro-based rates and
 * euro-based records and re-expresses them in the user's main currency. After
 * that, every downstream calculation is identical to the euro case — "EUR"
 * simply becomes whatever the main currency is.
 */
import type { Investment } from "./portfolio";
import type { FxTrade } from "./fx-trades";
import type { RateMap, Series } from "./rates";

/** Daily "1 EUR = x <base>" history, with nearest-earlier-day lookup. */
export function baseRateLookup(base: string, history: Series, liveRates: RateMap) {
  const liveBase = base === "EUR" ? 1 : (liveRates[base] ?? 0);
  if (base === "EUR") return (_d?: string) => 1;
  const days = Object.keys(history)
    .filter((d) => typeof history[d]?.[base] === "number")
    .sort();
  return (date?: string) => {
    if (!date || days.length === 0) return liveBase || 0;
    let hit: number | null = null;
    for (const d of days) {
      if (d <= date) hit = history[d]![base]!;
      else break;
    }
    // Before the history starts, the earliest known day is the best guess.
    return hit ?? history[days[0]!]![base]! ?? liveBase;
  };
}

/** "1 EUR = x CCY" becomes "1 base = x CCY". */
export function rebaseRates(liveRates: RateMap, base: string): RateMap {
  if (base === "EUR") return { ...liveRates, EUR: 1 };
  const b = liveRates[base];
  if (!b) return { ...liveRates, EUR: 1 };
  const out: RateMap = {};
  for (const [c, v] of Object.entries(liveRates)) out[c] = v / b;
  out["EUR"] = 1 / b;
  out[base] = 1;
  return out;
}

/** Entry rates recorded per euro become entry rates per unit of the main currency. */
export function rebaseInvestments(
  investments: Investment[],
  base: string,
  rateAt: (date?: string) => number,
): Investment[] {
  if (base === "EUR") return investments;
  return investments.map((i) => {
    const f = rateAt(i.date);
    return f > 0 ? { ...i, entryRate: i.entryRate / f } : i;
  });
}

/** The euro leg of each past swap, re-expressed in the main currency. */
export function rebaseTrades(
  trades: FxTrade[],
  base: string,
  rateAt: (date?: string) => number,
): FxTrade[] {
  if (base === "EUR") return trades;
  return trades.map((t) => {
    const f = rateAt(t.date);
    if (!f) return t;
    return { ...t, rate: t.rate / f, eurAmount: t.eurAmount * f };
  });
}
