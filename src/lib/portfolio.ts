import type { RateMap, Series } from "./rates";
import { saneCurrencyPerBase } from "./fx-quote";

export type Investment = {
  id: string;
  name: string;
  currency: string;
  /** amount invested, in `currency` */
  amount: number;
  /** current value in `currency` (optional, defaults to amount + interest) */
  currentValue?: number;
  /** ISO date of the investment */
  date: string;
  /** 1 EUR = entryRate <currency> at the time of investing */
  entryRate: number;
  /** where the entry rate came from: the statement, a guess from that day's
   *  official rate, or typed in by you (the exact rate Revolut charged) */
  rateSource?: "statement" | "estimated" | "manual";
  /** yearly interest / expected return as a decimal, e.g. 0.0325 */
  interestRate?: number;
  note?: string;
};

const KEY = "revolut-portfolio.investments.v1";

export function loadInvestments(): Investment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Investment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveInvestments(list: Investment[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(list));
}

/** Same position, however many times it is imported: same name, currency,
 *  date and amount is always the same line in the statement. */
export function investmentKey(i: Investment) {
  return `${i.name.trim().toLowerCase()}|${i.currency}|${i.date}|${i.amount.toFixed(2)}`;
}

/** Adds only what is genuinely new, and refreshes anything already held. */
export function mergeInvestments(existing: Investment[], incoming: Investment[]): Investment[] {
  const next = [...existing];
  const index = new Map(next.map((p, i) => [investmentKey(p), i] as const));
  for (const inv of incoming) {
    const k = investmentKey(inv);
    const at = index.get(k);
    if (at === undefined) {
      index.set(k, next.length);
      next.push(inv);
    } else {
      const prev = next[at]!;
      // A rate you typed in yourself is the real one Revolut charged — never
      // let a re-import overwrite it with an estimate.
      next[at] =
        prev.rateSource === "manual"
          ? { ...inv, id: prev.id, entryRate: prev.entryRate, rateSource: "manual" }
          : { ...inv, id: prev.id };
    }
  }
  return next;
}


export type Metrics = {
  investment: Investment;
  currentValue: number;
  /** EUR value at entry, using the entry rate */
  entryEur: number;
  /** EUR value now, using the live rate */
  nowEur: number;
  /** EUR value now if FX had not moved (entry rate applied to today's value) */
  nowEurAtEntryFx: number;
  /** EUR gain caused purely by FX movement */
  fxPnl: number;
  fxPct: number;
  /** EUR gain caused by the asset itself */
  assetPnl: number;
  totalPnl: number;
  totalPct: number;
  liveRate: number;
  /** entry rate after fixing upside-down / implausible quotes ("1 base = x currency") */
  entryRate: number;
  /** rate source after sanity — implausible statement figures surface as estimated */
  rateSource?: "statement" | "estimated" | "manual";
  holdingDays: number;
  /** annualised volatility of the EUR/CCY pair, decimal */
  fxVol: number;
  /** typical FX swing over the holding period, decimal */
  fxNoise: number;
  /** total return divided by the FX noise band; >1 means it clears FX swings */
  maturity: number;
  /** interest earned so far, in the holding's own currency */
  interestEarned: number;
  /** the "X per 1 EUR" rate you need to break even (lower = better for you) */
  breakEvenPerEur: number;
  /** the "EUR per 1 X" rate you need to break even (higher = better for you) */
  breakEvenEurPer: number;
  /** how far today's rate is from break-even, decimal (positive = already past it) */
  breakEvenGap: number;
  /** days of interest still needed to break even at today's rate, null if not applicable */
  daysToBreakEven: number | null;
};

export function daysBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

/** Annualised volatility of EUR/CCY from a daily series. */
export function annualisedVol(series: Series, ccy: string, base = "EUR"): number {
  if (ccy === base) return 0;
  const values = Object.keys(series)
    .sort()
    .map((d) => {
      const v = series[d]?.[ccy];
      if (typeof v !== "number") return undefined;
      if (base === "EUR") return v;
      const b = series[d]?.[base];
      return typeof b === "number" && b > 0 ? v / b : undefined;
    })
    .filter((v): v is number => typeof v === "number");
  if (values.length < 10) return 0;
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    if (prev > 0) rets.push(Math.log(cur / prev));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function computeMetrics(
  investment: Investment,
  liveRates: RateMap,
  vols: Record<string, number>,
  /** the currency all "Eur"-suffixed figures are denominated in */
  base = "EUR",
  /** official "1 base = x currency" on the purchase date, when known */
  dayRate?: number,
): Metrics {
  const rawLive = investment.currency === base ? 1 : (liveRates[investment.currency] ?? investment.entryRate);
  // Prefer the purchase-day official rate as the compass. Falling back to live
  // makes "now" and "when you bought" identical — only use it when history is
  // missing.
  const reference =
    investment.currency === base
      ? 1
      : dayRate && dayRate > 0
        ? dayRate
        : rawLive > 0
          ? rawLive
          : investment.entryRate;
  const trustFar = investment.rateSource === "manual";
  const { rate: entryRate, usedMarket } =
    investment.currency === base
      ? { rate: 1, usedMarket: false }
      : saneCurrencyPerBase(investment.entryRate, reference, { trustFar });
  const liveRate = rawLive > 0 ? rawLive : entryRate;
  const rateSource =
    investment.currency === base
      ? investment.rateSource
      : usedMarket
        ? ("estimated" as const)
        : investment.rateSource;
  const holdingDays = daysBetween(new Date(investment.date), new Date());
  const rate = investment.interestRate ?? 0;
  // Interest that has built up on this exact position since its own start date.
  const grown = investment.amount * (1 + rate) ** (Math.max(holdingDays, 0) / 365);
  const currentValue = investment.currentValue ?? grown;
  const interestEarned = currentValue - investment.amount;

  const entryEur = investment.amount / entryRate;
  const nowEur = currentValue / liveRate;
  const nowEurAtEntryFx = currentValue / entryRate;
  const fxPnl = nowEur - nowEurAtEntryFx;
  const assetPnl = nowEurAtEntryFx - entryEur;
  const totalPnl = nowEur - entryEur;
  const fxVol = vols[investment.currency] ?? 0;
  const fxNoise = fxVol * Math.sqrt(Math.max(holdingDays, 1) / 365);
  const noiseEur = fxNoise * entryEur;

  // Break-even: currentValue / X = entryEur  ->  X = currentValue * entryRate / amount
  const breakEvenPerEur = investment.amount === 0 ? liveRate : (currentValue * entryRate) / investment.amount;
  const breakEvenEurPer = breakEvenPerEur === 0 ? 0 : 1 / breakEvenPerEur;
  // Positive = today's rate is already better than what you need.
  const breakEvenGap = breakEvenPerEur === 0 ? 0 : (breakEvenPerEur - liveRate) / breakEvenPerEur;

  // If the rate never moves again, how long until interest alone covers the gap?
  let daysToBreakEven: number | null = null;
  if (totalPnl < 0 && rate > 0 && liveRate > 0 && entryRate > 0 && liveRate !== entryRate) {
    const need = Math.log(liveRate / entryRate) / Math.log(1 + rate);
    const days = need * 365 - holdingDays;
    // Cap absurd horizons from near-zero / inverted rates that slipped through.
    if (Number.isFinite(days) && days > 0 && days < 365 * 40) daysToBreakEven = Math.ceil(days);
  }

  // Base-currency holdings have no FX risk — don't show "Too early to convert".
  const maturity =
    investment.currency === base
      ? totalPnl >= 0
        ? 2
        : -1
      : noiseEur === 0
        ? totalPnl > 0
          ? 2
          : 0
        : totalPnl / noiseEur;

  return {
    investment,
    currentValue,
    entryEur,
    nowEur,
    nowEurAtEntryFx,
    fxPnl,
    fxPct: nowEurAtEntryFx === 0 ? 0 : fxPnl / nowEurAtEntryFx,
    assetPnl,
    totalPnl,
    totalPct: entryEur === 0 ? 0 : totalPnl / entryEur,
    liveRate,
    entryRate,
    ...(rateSource ? { rateSource } : {}),
    holdingDays,
    fxVol,
    fxNoise,
    maturity,
    interestEarned,
    breakEvenPerEur,
    breakEvenEurPer,
    breakEvenGap,
    daysToBreakEven,
  };
}

export const eur = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);

export const pct = (n: number) =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;

export function maturityLabel(m: number) {
  if (m >= 1.5) return { label: "OK to convert back", tone: "good" as const };
  if (m >= 0.5) return { label: "Almost there", tone: "warn" as const };
  if (m >= -0.5) return { label: "Too early to convert", tone: "muted" as const };
  return { label: "Underwater for now", tone: "bad" as const };
}

/** e.g. "1.1642" -> "1.1642"; keeps enough digits for FX without noise */
export const rate4 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");

