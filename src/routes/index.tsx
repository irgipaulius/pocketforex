import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { InvestmentForm } from "@/components/portfolio/InvestmentForm";
import { ImportDialog } from "@/components/portfolio/ImportDialog";
import { FxPairChart } from "@/components/portfolio/FxPairChart";
import {
  AllocationChart,
  FxImpactChart,
  ValueChart,
  type ValuePoint,
} from "@/components/portfolio/Charts";
import { PositionsTable } from "@/components/portfolio/PositionsTable";

import {
  annualisedVol,
  eur,
  loadInvestments,
  mergeInvestments,
  pct,
  saveInvestments,
  type Investment,
} from "@/lib/portfolio";
import { loadFxTrades, mergeFxTrades, saveFxTrades, type FxTrade } from "@/lib/fx-trades";
import { FxSignal } from "@/components/portfolio/FxSignal";
import { FxCrossRates } from "@/components/portfolio/FxCrossRates";
import {
  inferBaseCurrency,
  loadBaseCurrency,
  money,
  saveBaseCurrency,
} from "@/lib/base-currency";
import { evaluate } from "@/lib/evaluate";
import { baseRateLookup, rebaseInvestments, rebaseRates, rebaseTrades } from "@/lib/rebase";
import { fetchCurrencies, fetchLatestRates, fetchTimeseries } from "@/lib/rates";
import { getFxQuote } from "@/lib/fx-live.functions";
import { SEO_LINKS, SEO_META, SITE_NAME } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [...SEO_META],
    links: [...SEO_LINKS],
  }),
  component: Dashboard,
});

/** Illustrative trades, shown only in the empty state demo chart. */
function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const DEMO_TRADES: FxTrade[] = [
  { id: "d1", date: isoDaysAgo(300), currency: "USD", amount: 4000, rate: 1.0842, eurAmount: 3689 },
  { id: "d2", date: isoDaysAgo(190), currency: "USD", amount: 2500, rate: 1.1305, eurAmount: 2211 },
  { id: "d3", date: isoDaysAgo(95), currency: "USD", amount: -3000, rate: 1.1642, eurAmount: 2577 },
];
/** What is left after those swaps: 1,000 USD from the first buy + 2,500 from
 *  the second. Fed through the very same evaluation engine as real imports, so
 *  the example verdict is worked out from the live rate, not written by hand. */
const DEMO_INVESTMENTS: Investment[] = [
  {
    id: "di1",
    name: "USD cash (example)",
    currency: "USD",
    amount: 1000,
    date: isoDaysAgo(300),
    entryRate: 1.0842,
    rateSource: "statement",
  },
  {
    id: "di2",
    name: "USD savings (example)",
    currency: "USD",
    amount: 2500,
    date: isoDaysAgo(190),
    entryRate: 1.1305,
    rateSource: "statement",
  },
];


const RANGES = { "1M": 30, "6M": 182, "1Y": 365, "3Y": 1095 } as const;
type RangeKey = keyof typeof RANGES;

function Dashboard() {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [fxTrades, setFxTrades] = useState<FxTrade[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [range, setRange] = useState<RangeKey>("1Y");
  const [pairCcy, setPairCcy] = useState<string | null>(null);
  const [base, setBase] = useState("EUR");
  const [fxOnly, setFxOnly] = useState(false);


  useEffect(() => {
    const inv = loadInvestments();
    const tr = loadFxTrades();
    setInvestments(inv);
    setFxTrades(tr);
    setBase(loadBaseCurrency() ?? inferBaseCurrency(inv, tr));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveBaseCurrency(base);
  }, [base, hydrated]);

  useEffect(() => {
    if (hydrated) saveInvestments(investments);
  }, [investments, hydrated]);

  useEffect(() => {
    if (hydrated) saveFxTrades(fxTrades);
  }, [fxTrades, hydrated]);

  const currencies = useMemo(
    () => Array.from(new Set(investments.map((i) => i.currency))),
    [investments],
  );

  const rates = useQuery({
    queryKey: ["rates"],
    queryFn: fetchLatestRates,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  /** Second-by-second market rates, layered on top of the daily reference rates. */
  const quoteCcys = useMemo(
    () => (currencies.some((c) => c !== "EUR") ? currencies : ["USD"]),
    [currencies],
  );

  const tick = useQuery({
    queryKey: ["fx-tick", quoteCcys.join(","), base],
    queryFn: () => getFxQuote({ data: { currencies: [...quoteCcys, base], base: "EUR" } }),
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const liveRates = useMemo(
    () => ({ ...(rates.data?.rates ?? {}), ...(tick.data?.rates ?? {}) }),
    [rates.data, tick.data],
  );

  /** Every figure below is already denominated in the main currency. */
  const fmt = useMemo(() => (v: number) => money(v, base), [base]);

  const historyFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - RANGES[range]);
    return d.toISOString().slice(0, 10);
  }, [range]);

  const history = useQuery({
    queryKey: ["history", historyFrom, currencies.join(","), base],
    queryFn: () => fetchTimeseries(historyFrom, [...currencies, base]),
    enabled: currencies.length > 0,
    refetchInterval: 5 * 60_000,
  });

  /** Oldest thing on record — how far back we need EUR→main-currency rates. */
  const earliest = useMemo(() => {
    const days = [...investments.map((i) => i.date), ...fxTrades.map((t) => t.date)].sort();
    return days[0] ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  }, [investments, fxTrades]);

  /** Daily EUR→main-currency rates, used to re-price every past transaction. */
  const baseHistory = useQuery({
    queryKey: ["base-history", earliest, base],
    queryFn: () => fetchTimeseries(earliest, [base]),
    enabled: base !== "EUR",
    staleTime: 60 * 60_000,
  });

  const rateAt = useMemo(
    () => baseRateLookup(base, { ...(history.data ?? {}), ...(baseHistory.data ?? {}) }, liveRates),
    [base, history.data, baseHistory.data, liveRates],
  );

  /** Everything is stored euro-based; from here on it is main-currency based. */
  const baseRates = useMemo(() => rebaseRates(liveRates, base), [liveRates, base]);
  const basedInvestments = useMemo(
    () => rebaseInvestments(investments, base, rateAt),
    [investments, base, rateAt],
  );
  const basedTrades = useMemo(() => rebaseTrades(fxTrades, base, rateAt), [fxTrades, base, rateAt]);

  const vols = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of currencies) out[c] = annualisedVol(history.data ?? {}, c, base);
    return out;
  }, [history.data, currencies, base]);

  /** Optionally look only at money held in a currency other than the main one. */
  const shown = useMemo(
    () => (fxOnly ? basedInvestments.filter((i) => i.currency !== base) : basedInvestments),
    [basedInvestments, fxOnly, base],
  );

  /** ONE evaluation for the whole page — every widget below reads from it. */
  const evaluation = useMemo(
    () =>
      evaluate({ investments: shown, fxTrades: basedTrades, liveRates: baseRates, vols, money: fmt, base }),
    [shown, basedTrades, baseRates, vols, fmt, base],
  );
  const { positions: metrics, totals, allocation, pairOptions } = evaluation;

  /** The empty-state example: same engine, same live rate, sample trades. */
  const demoUsd = useMemo(
    () =>
      evaluate({
        investments: DEMO_INVESTMENTS,
        fxTrades: DEMO_TRADES,
        liveRates,
        vols: { USD: vols["USD"] ?? 0 },
        money: eur,
        base: "EUR",
      }).byCurrency.get("USD") ?? null,
    [liveRates, vols],
  );




  const series: ValuePoint[] = useMemo(() => {
    const data = history.data;
    if (!data || shown.length === 0) return [];
    return Object.keys(data)
      .sort()
      .map((day) => {
        let live = 0;
        let frozen = 0;
        for (const inv of shown) {
          if (inv.date > day) continue;
          const value = inv.currentValue ?? inv.amount;
          const dayBase = base === "EUR" ? 1 : data[day]?.[base];
          const eurRate = inv.currency === "EUR" ? 1 : data[day]?.[inv.currency];
          if (!eurRate || !dayBase) continue;
          // "1 EUR = x CCY" becomes "1 <base> = x CCY" for that very day.
          const rate = eurRate / dayBase;
          live += value / rate;
          frozen += value / inv.entryRate;
        }
        return { date: day.slice(5), live, frozen, fx: live - frozen };
      })
      .filter((p) => p.live > 0);
  }, [history.data, shown, base]);

  /** Any currency can be the main one — yours are listed first. */
  const allCurrencies = useQuery({
    queryKey: ["currencies"],
    queryFn: fetchCurrencies,
    staleTime: 24 * 60 * 60_000,
  });

  const baseOptions = useMemo(() => {
    const mine = Array.from(
      new Set([
        base,
        ...investments.map((i) => i.currency),
        ...fxTrades.map((t) => t.currency),
        ...pairOptions,
        "EUR",
      ]),
    );
    const rest = Object.keys(allCurrencies.data ?? {})
      .filter((c) => !mine.includes(c))
      .sort();
    return [...mine, ...rest];
  }, [base, investments, fxTrades, pairOptions, allCurrencies.data]);
  /** the chart always plots a foreign currency against the main currency */
  const chartOptions = useMemo(
    () => pairOptions.filter((c) => c !== "EUR" && c !== base),
    [pairOptions, base],
  );
  const activePair = pairCcy && chartOptions.includes(pairCcy) ? pairCcy : (chartOptions[0] ?? null);
  const activeInfo = activePair ? (evaluation.byCurrency.get(activePair) ?? null) : null;


  /** Forms and tables work in the main currency; storage stays euro-based. */
  const toStored = (inv: Investment): Investment => {
    if (base === "EUR") return inv;
    const f = rateAt(inv.date);
    return f > 0 ? { ...inv, entryRate: inv.entryRate * f } : inv;
  };

  const upsert = (raw: Investment) =>
    setInvestments((prev) => {
      const inv = toStored(raw);
      const i = prev.findIndex((p) => p.id === inv.id);
      if (i === -1) return [...prev, inv];
      const next = [...prev];
      next[i] = inv;
      return next;
    });

  const importMany = (list: Investment[], trades: FxTrade[] = []) => {
    setInvestments((prev) => mergeInvestments(prev, list));
    if (trades.length) setFxTrades((prev) => mergeFxTrades(prev, trades));
  };

  const wipe = () => {
    if (
      !window.confirm("Delete everything stored on this device? Your Revolut files are untouched.")
    )
      return;
    setInvestments([]);
    setFxTrades([]);
    saveInvestments([]);
    saveFxTrades([]);
  };

  const tone = totals.pnlEur >= 0 ? "text-gain" : "text-loss";

  if (hydrated && investments.length === 0 && fxTrades.length === 0) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-10 sm:px-6">
        <Toaster position="top-center" />
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{SITE_NAME}</h1>
          <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-secondary/70 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            <ShieldCheck className="size-3.5 text-gain" /> Private · no login · nothing leaves your
            device
          </span>
          <p className="mx-auto mt-4 max-w-xl text-balance text-xl font-semibold leading-snug tracking-tight text-foreground/90 sm:text-2xl">
            Your dollars went up in the app. But in euros — are you actually ahead?
          </p>
          <p className="mx-auto mt-3 max-w-md text-pretty text-sm text-muted-foreground">
            Built for Revolut savings, cash funds and stocks held in another currency. Import a
            statement and get three plain answers:
          </p>

          <ul className="mx-auto mt-5 max-w-md space-y-3 text-left text-sm">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                1
              </span>
              <span>
                <span className="font-semibold text-foreground">What it's worth at home</span>
                <span className="text-muted-foreground">
                  {" "}
                  — your USD/GBP balance converted to the currency you actually spend.
                </span>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                2
              </span>
              <span>
                <span className="font-semibold text-foreground">The break-even rate</span>
                <span className="text-muted-foreground">
                  {" "}
                  — how strong the foreign currency must be before converting back makes sense.
                </span>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                3
              </span>
              <span>
                <span className="font-semibold text-foreground">What moved the needle</span>
                <span className="text-muted-foreground">
                  {" "}
                  — how much came from interest or stock growth vs the exchange rate helping or
                  hurting.
                </span>
              </span>
            </li>
          </ul>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <ImportDialog
              onImport={importMany}
              trigger={
                <Button size="lg" className="rounded-2xl px-6 font-bold">
                  <Upload className="size-4" /> Import from Revolut
                </Button>
              }
            />
            <InvestmentForm
              base={base}
              onSave={upsert}
              trigger={
                <Button size="lg" variant="secondary" className="rounded-2xl px-6 font-semibold">
                  <Plus className="size-4" /> Add manually
                </Button>
              }
            />
          </div>
        </div>

        <div className="mt-10">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <LineChart className="size-3.5 text-primary" /> Live example — real rate, sample trades
          </p>
          {demoUsd && (
            <>
              <FxSignal
                base="EUR"
                quote="USD"
                options={["USD"]}
                onQuoteChange={() => {}}
                rate={demoUsd.live}
                {...(demoUsd.breakEvenPerEur ? { breakEven: demoUsd.breakEvenPerEur } : {})}
                verdict={demoUsd.verdict}
              />
              <div className="h-3" />
              <FxPairChart
                currency="USD"
                options={["USD"]}
                onCurrencyChange={() => {}}
                {...(demoUsd.live ? { liveRate: demoUsd.live } : {})}
                {...(demoUsd.breakEvenEurPer ? { breakEvenEurPer: demoUsd.breakEvenEurPer } : {})}
                trades={DEMO_TRADES}
              />
            </>
          )}
          <FxCrossRates currencies={["EUR", "USD", "GBP", "CHF", "JPY"]} />
          <p className="mt-3 text-center text-[12px] text-muted-foreground">
            Same live rate and maths your import will use — sample buys and sells only.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6">
      <Toaster position="top-center" />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {SITE_NAME}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl num">{fmt(totals.valueEur)}</h1>
          <p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${tone} num`}>
            {totals.pnlEur >= 0 ? (
              <TrendingUp className="size-4" />
            ) : (
              <TrendingDown className="size-4" />
            )}
            {fmt(totals.pnlEur)} ({pct(totals.pnlPct)})
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <select
              value={base}
              onChange={(e) => setBase(e.target.value)}
              aria-label="Main currency"
              className="rounded-full bg-secondary/70 px-3 py-2 text-xs font-semibold outline-none"
            >
              {baseOptions.map((c) => (
                <option key={c} value={c}>
                  Main: {c}
                </option>
              ))}
            </select>
            <ImportDialog
              onImport={importMany}
              trigger={
                <Button variant="secondary" className="rounded-full font-semibold">
                  <Upload className="size-4" /> Import
                </Button>
              }
            />
            <InvestmentForm
              base={base}
              onSave={upsert}
              trigger={
                <Button className="rounded-full font-semibold">
                  <Plus className="size-4" /> Add
                </Button>
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
            <button
              onClick={() => {
                void rates.refetch();
                void tick.refetch();
                void history.refetch();
              }}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RefreshCw
                className={`size-3 ${rates.isFetching || tick.isFetching ? "animate-spin" : ""}`}
              />
              {rates.data
                ? `Live · ${new Date(tick.data?.at ?? Date.now()).toLocaleTimeString()}`
                : "Loading rates…"}
            </button>
            <button
              onClick={wipe}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-loss"
            >
              <Trash2 className="size-3" /> Delete my data
            </button>
          </div>
        </div>
      </header>


      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-secondary/50 px-4 py-2.5">
        <div>
          <p className="text-xs font-semibold">Only show foreign currency</p>
          <p className="text-[11px] text-muted-foreground">
            Hide money already in {base}. What's left is what the exchange rate can still move.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={fxOnly}
          aria-label="Show foreign currency holdings only"
          onClick={() => setFxOnly((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${fxOnly ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-background transition-all ${fxOnly ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </div>



      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="What you paid" value={fmt(totals.investedEur)} />
        <Stat
          label="Exchange rate effect"
          value={fmt(totals.fxPnlEur)}
          tone={totals.fxPnlEur >= 0 ? "gain" : "loss"}
        />
        <Stat
          label="Investment growth"
          value={fmt(totals.assetPnlEur)}
          tone={totals.assetPnlEur >= 0 ? "gain" : "loss"}
        />
        <Stat label="Holdings" value={String(totals.positions)} />
      </section>

      {activePair && activePair !== base && activeInfo && (
        <div className="mt-3">
          <FxSignal
            base={base}
            quote={activePair}
            options={chartOptions}
            onQuoteChange={setPairCcy}
            rate={activeInfo.live}
            {...(activeInfo.breakEvenPerEur ? { breakEven: activeInfo.breakEvenPerEur } : {})}
            verdict={activeInfo.verdict}
          />
        </div>
      )}

      {activePair && (
        <div className="mt-3">
          <FxPairChart
            currency={activePair}
            base={base}
            options={chartOptions}

            onCurrencyChange={setPairCcy}
            {...(activeInfo?.live ? { liveRate: activeInfo.live } : {})}
            {...(activeInfo?.breakEvenEurPer
              ? { breakEvenEurPer: activeInfo.breakEvenEurPer }
              : {})}
            trades={basedTrades}
          />
        </div>
      )}

      <FxCrossRates currencies={[base, ...pairOptions]} />

      {shown.length === 0 ? (
        <div className="surface mt-6 p-10 text-center">
          <h2 className="text-lg font-bold">Nothing here yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Add a USD savings pot or a stock you bought in another currency — or import a Revolut
            statement. Everything stays on this device between visits.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <InvestmentForm
              base={base}
              onSave={upsert}
              trigger={
                <Button className="rounded-full font-semibold">
                  <Plus className="size-4" /> Add investment
                </Button>
              }
            />
            <ImportDialog
              onImport={importMany}
              trigger={
                <Button variant="secondary" className="rounded-full font-semibold">
                  <Upload className="size-4" /> Import statement
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-base font-bold">Value over time</h2>
            <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <TabsList className="rounded-full">
                {Object.keys(RANGES).map((r) => (
                  <TabsTrigger key={r} value={r} className="rounded-full text-xs">
                    {r}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="surface mt-3 p-3 pt-5">
            <ValueChart data={series} fmt={fmt} currency={base} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <div className="surface p-4 lg:col-span-3">
              <h3 className="text-sm font-bold">How much the exchange rate moved you</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Ignoring interest and stock prices — only the currency.
              </p>
              <FxImpactChart data={series} fmt={fmt} currency={base} />
            </div>
            <div className="surface p-4 lg:col-span-2">
              <h3 className="text-sm font-bold">Split by currency</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                What your money is worth in {base}, per currency.
              </p>
              <AllocationChart data={allocation} fmt={fmt} />
            </div>
          </div>

          <h2 className="mt-8 text-base font-bold">Your positions</h2>
          <p className="text-xs text-muted-foreground">
            Each holding keeps its own purchase date and exchange rate — so a USD savings pot and a
            stock buy aren't mashed into one average.
          </p>
          <PositionsTable
            fmt={fmt}
            base={base}
            metrics={metrics}
            onSave={upsert}
            onDelete={(id) => setInvestments((p) => p.filter((x) => x.id !== id))}
          />
        </>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="surface p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-bold num ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
