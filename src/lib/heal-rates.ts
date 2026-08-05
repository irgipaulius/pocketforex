/**
 * Repair stored entry rates using the official FX rate on each position's
 * purchase date. Garbage statement cost bases and earlier "heal with live"
 * mistakes both get replaced and persisted.
 */
import type { Investment } from "./portfolio";
import { rateOnDate, type Series } from "./rates";
import { saneCurrencyPerBase } from "./fx-quote";

const REL_EPS = 0.002; // ~0.2% — ignore tiny float noise

function meaningfullyDifferent(a: number, b: number) {
  if (!(a > 0) || !(b > 0)) return a !== b;
  return Math.abs(Math.log(a / b)) > REL_EPS;
}

/**
 * Returns a new list when something changed, otherwise the same array
 * reference so React effects can bail out.
 */
export function healEntryRates(investments: Investment[], series: Series): Investment[] {
  if (!series || Object.keys(series).length === 0) return investments;

  let changed = false;
  const next = investments.map((inv) => {
    if (inv.currency === "EUR" || inv.rateSource === "manual") return inv;

    const day = rateOnDate(series, inv.date, inv.currency);
    if (!day || !(day > 0)) return inv;

    // Estimated rates must be the official rate for that day — never "today".
    if (inv.rateSource === "estimated") {
      if (!meaningfullyDifferent(inv.entryRate, day)) return inv;
      changed = true;
      return { ...inv, entryRate: day, rateSource: "estimated" as const };
    }

    const { rate, usedMarket } = saneCurrencyPerBase(inv.entryRate, day);
    if (!meaningfullyDifferent(inv.entryRate, rate)) return inv;
    changed = true;
    const rateSource: Investment["rateSource"] = usedMarket
      ? "estimated"
      : (inv.rateSource ?? "statement");
    return { ...inv, entryRate: rate, rateSource };
  });

  return changed ? next : investments;
}
