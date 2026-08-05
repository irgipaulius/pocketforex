import type { Investment } from "./portfolio";
import type { FxTrade } from "./fx-trades";

const KEY = "revolut-portfolio.base-currency.v1";

/** The currency the user thinks in. Inferred from the statements, overridable. */
export function inferBaseCurrency(investments: Investment[], trades: FxTrade[]): string {
  const weight = new Map<string, number>();
  const add = (c: string, w: number) => weight.set(c, (weight.get(c) ?? 0) + w);
  // Every swap has a euro leg, so the euro side counts too.
  for (const t of trades) {
    add("EUR", t.eurAmount);
    add(t.currency, t.eurAmount);
  }
  for (const i of investments) add(i.currency, i.entryRate ? i.amount / i.entryRate : i.amount);
  let best = "EUR";
  let top = -1;
  for (const [c, w] of weight)
    if (w > top) {
      top = w;
      best = c;
    }
  return best;
}

export function loadBaseCurrency(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function saveBaseCurrency(c: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, c);
}

export const money = (v: number, ccy: string) => {
  try {
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v.toFixed(2)} ${ccy}`;
  }
};
