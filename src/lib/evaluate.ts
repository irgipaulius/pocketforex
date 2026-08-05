/**
 * ONE place where every number on the dashboard is worked out.
 *
 * Components must not do their own maths: they receive slices of the
 * `Evaluation` produced here. That way the headline, the currency cards, the
 * chart and the positions table can never disagree with each other.
 *
 * Convention: every "…Eur" figure is in euro. The page converts to the user's
 * main currency at the very end, for display only.
 */
import { computeMetrics, type Investment, type Metrics } from "./portfolio";
import type { RateMap } from "./rates";
import type { FxTrade } from "./fx-trades";
import { alignQuoteWithLive, netFxCostBasis } from "./fx-quote";

export type Verdict = {
  /** what the numbers say to do with this currency right now */
  action: "sell" | "buy" | "watch";
  headline: string;
  detail: string;
  tone: "gain" | "loss" | "muted";
};

export type CurrencyEval = {
  currency: string;
  /** how much of this currency you hold, in that currency */
  holding: number;
  /** what you originally put in, in euro */
  entryEur: number;
  /** what it is worth today, in euro, at the live rate */
  valueEur: number;
  /** cashing out today vs what you put in (interest + currency, in euro) */
  pnlEur: number;
  /** the part of `pnlEur` caused only by the exchange rate moving */
  fxPnlEur: number;
  /** interest / price growth part, in euro */
  assetPnlEur: number;
  /** 1 EUR = this many <currency> is where you break even */
  breakEvenPerEur: number;
  /** 1 <currency> = this many EUR is where you break even */
  breakEvenEurPer: number;
  /** live: 1 EUR = live <currency> */
  live: number;
  /** live: 1 <currency> = liveEurPer EUR */
  liveEurPer: number;
  /** true when cashing out today returns more euro than you put in */
  aboveBreakEven: boolean;
  /** how far today's rate is from break-even, decimal (+ = past it) */
  gap: number;
  verdict: Verdict;
};

export type Totals = {
  investedEur: number;
  valueEur: number;
  pnlEur: number;
  pnlPct: number;
  fxPnlEur: number;
  assetPnlEur: number;
  positions: number;
};

export type Evaluation = {
  positions: Metrics[];
  totals: Totals;
  currencies: CurrencyEval[];
  /** currencies worth offering in pickers (holdings + past swaps) */
  pairOptions: string[];
  allocation: { name: string; value: number }[];
  byCurrency: Map<string, CurrencyEval>;
};

const pctStr = (n: number) => `${(Math.abs(n) * 100).toFixed(2)}%`;

function makeVerdict(
  c: Omit<CurrencyEval, "verdict">,
  money: (baseValue: number) => string,
  base: string,
): Verdict {
  if (!c.live || !c.breakEvenPerEur) {
    return {
      action: "watch",
      headline: `Waiting on a ${c.currency} rate`,
      detail: `After you hold some ${c.currency}, this tells you whether converting back to ${base} today would leave you ahead or behind.`,
      tone: "muted",
    };
  }
  if (c.aboveBreakEven) {
    return {
      action: "sell",
      headline: `Converting ${c.currency} back today locks in a gain`,
      detail:
        `You'd get about ${money(Math.abs(c.pnlEur))} more ${base} than you put in. ` +
        `You only fall into a loss if 1 ${c.currency} drops below ${c.breakEvenEurPer.toFixed(4)} ${base}.`,
      tone: "gain",
    };
  }
  return {
    action: "buy",
    headline: `Don't convert ${c.currency} back yet`,
    detail:
      `Cashing out today would cost you about ${money(Math.abs(c.pnlEur))} versus what you paid. ` +
      `Wait until 1 ${c.currency} is worth at least ${c.breakEvenEurPer.toFixed(4)} ${base} ` +
      `(it's ${c.liveEurPer.toFixed(4)} today). New ${c.currency} buys are ${pctStr(c.gap)} cheaper than your average — fine for topping up, not for exiting.`,
    tone: "loss",
  };
}

export function evaluate({
  investments,
  fxTrades,
  liveRates,
  vols,
  money,
  base = "EUR",
}: {
  investments: Investment[];
  fxTrades: FxTrade[];
  liveRates: RateMap;
  vols: Record<string, number>;
  /** formats a euro amount for display, in whatever main currency is picked */
  money: (baseValue: number) => string;
  /** the currency every "…Eur" figure below is actually denominated in */
  base?: string;
}): Evaluation {
  const positions = investments.map((i) => computeMetrics(i, liveRates, vols, base));

  const totals: Totals = {
    investedEur: positions.reduce((s, m) => s + m.entryEur, 0),
    valueEur: positions.reduce((s, m) => s + m.nowEur, 0),
    pnlEur: positions.reduce((s, m) => s + m.totalPnl, 0),
    pnlPct: 0,
    fxPnlEur: positions.reduce((s, m) => s + m.fxPnl, 0),
    assetPnlEur: positions.reduce((s, m) => s + m.assetPnl, 0),
    positions: positions.length,
  };
  totals.pnlPct = totals.investedEur ? totals.pnlEur / totals.investedEur : 0;

  type Acc = { holding: number; entryEur: number; valueEur: number; fx: number; asset: number; pnl: number };
  const acc = new Map<string, Acc>();
  for (const m of positions) {
    const c = m.investment.currency;
    if (c === base) continue;
    const prev = acc.get(c) ?? { holding: 0, entryEur: 0, valueEur: 0, fx: 0, asset: 0, pnl: 0 };
    acc.set(c, {
      holding: prev.holding + m.currentValue,
      entryEur: prev.entryEur + m.entryEur,
      valueEur: prev.valueEur + m.nowEur,
      fx: prev.fx + m.fxPnl,
      asset: prev.asset + m.assetPnl,
      pnl: prev.pnl + m.totalPnl,
    });
  }

  const currencies: CurrencyEval[] = Array.from(acc, ([currency, v]) => {
    const live = liveRates[currency] ?? 0;
    const liveEurPer = live ? 1 / live : 0;

    // Positions are the source of truth when you hold the asset. Past swaps on
    // the rate chart are a second opinion: if they imply a very different
    // "base per currency" cost (classic sign of an inverted entry rate on an
    // imported lot), prefer the swap-derived basis for this currency's quote.
    let breakEvenEurPer = v.entryEur > 0 && v.holding > 0 ? v.entryEur / v.holding : 0;
    const fromSwaps = netFxCostBasis(fxTrades, currency);
    if (fromSwaps && liveEurPer > 0) {
      const swapBe = fromSwaps.basePerCurrency;
      const posBe = breakEvenEurPer;
      const swapCloser =
        !posBe ||
        Math.abs(Math.log(swapBe / liveEurPer)) < Math.abs(Math.log(posBe / liveEurPer));
      // Also catch the "1.67 EUR per USD vs 0.87 live" inversion: opposite
      // sides of 1 while the swaps sit next to live.
      const posInverted = posBe > 0 && posBe > 1 !== liveEurPer > 1;
      if (posInverted || (swapCloser && Math.abs(Math.log(swapBe / (posBe || swapBe))) > Math.log(1.15))) {
        breakEvenEurPer = swapBe;
      }
    }
    if (breakEvenEurPer > 0 && liveEurPer > 0) {
      breakEvenEurPer = alignQuoteWithLive(breakEvenEurPer, liveEurPer);
    }
    const breakEvenPerEur = breakEvenEurPer > 0 ? 1 / breakEvenEurPer : 0;

    const core = {
      currency,
      holding: v.holding,
      entryEur: v.entryEur,
      valueEur: v.valueEur,
      pnlEur: v.pnl,
      fxPnlEur: v.fx,
      assetPnlEur: v.asset,
      breakEvenPerEur,
      breakEvenEurPer,
      live,
      liveEurPer,
      // fewer units per euro than break-even = the currency is strong enough
      // that cashing out returns more euro than you put in.
      aboveBreakEven: live > 0 && breakEvenPerEur > 0 && live <= breakEvenPerEur,
      gap: breakEvenPerEur ? (live - breakEvenPerEur) / breakEvenPerEur : 0,
    };
    return { ...core, verdict: makeVerdict(core, money, base) };
  }).sort((a, b) => b.valueEur - a.valueEur);

  const pairOptions = currencies.map((c) => c.currency);
  for (const t of fxTrades)
    if (t.currency !== base && !pairOptions.includes(t.currency)) pairOptions.push(t.currency);

  const allocMap = new Map<string, number>();
  for (const m of positions)
    allocMap.set(m.investment.currency, (allocMap.get(m.investment.currency) ?? 0) + m.nowEur);
  const allocation = Array.from(allocMap, ([name, value]) => ({ name, value })).sort(
    (a, b) => b.value - a.value,
  );

  return {
    positions,
    totals,
    currencies,
    pairOptions,
    allocation,
    byCurrency: new Map(currencies.map((c) => [c.currency, c])),
  };
}
