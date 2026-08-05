import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Info, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { getFxHistory } from "@/lib/fx-live.functions";
import { rate4 } from "@/lib/portfolio";
import type { Verdict } from "@/lib/evaluate";

type Props = {
  /** the currency you think in */
  base: string;
  /** the currency you swap into, e.g. "USD" */
  quote: string;
  /** switchable quote currencies */
  options: string[];
  onQuoteChange: (c: string) => void;
  /** live: 1 base = rate quote */
  rate: number;
  /** the "quote per 1 base" level your past swaps break even at */
  breakEven?: number;
  /** worked out once, in lib/evaluate — this component never decides anything */
  verdict: Verdict;
};

const EMPTY: { time: number; value: number }[] = [];

/** Turn a series into a smooth-ish SVG path inside a 100x36 viewbox. */
function sparkPath(values: number[]) {
  if (values.length < 2) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 34 - ((v - min) / span) * 30;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return { line, area: `${line} L100,36 L0,36 Z` };
}

function useSeries(currency: string, enabled: boolean, base = "EUR") {
  return useQuery({
    queryKey: ["fx-history", currency, "1M", base],
    queryFn: () => getFxHistory({ data: { currency, range: "1M" as const, base } }),
    enabled: enabled && currency !== base,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Side-by-side mirror of the pair, with a verdict on which way to swap. */
export function FxSignal({ base, quote, options, onQuoteChange, rate, breakEven, verdict }: Props) {
  const qs = useSeries(quote, true, base);

  /** quote per 1 base, over the last month */
  // The feed already returns the pair quoted against the main currency.
  const series = useMemo(() => qs.data?.points ?? EMPTY, [qs.data]);

  const values = series.map((p) => p.value).filter((v) => Number.isFinite(v) && v > 0);
  const live = rate || values[values.length - 1] || 0;
  const first = values[0] ?? live;
  const changePct = first ? (live - first) / first : 0;

  const be = breakEven && breakEven > 0 ? breakEven : undefined;
  // Colours follow the single shared verdict, never a local calculation.
  const sellIsGood = verdict.action === "sell";
  const watching = verdict.action === "watch";

  const spark = sparkPath(values);
  const sparkInv = sparkPath(values.map((v) => 1 / v));

  return (
    <div className="surface relative overflow-hidden p-4">
      <div
        aria-hidden
        className={`pointer-events-none absolute -top-24 right-0 size-64 rounded-full blur-3xl transition-colors duration-700 ${
          watching ? "bg-primary/10" : sellIsGood ? "bg-gain/10" : "bg-loss/10"
        }`}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" /> Buy or sell right now
        </p>
        {options.length > 1 && (
          <select
            value={quote}
            onChange={(e) => onQuoteChange(e.target.value)}
            className="rounded-full bg-secondary/70 px-3 py-1 text-xs font-semibold outline-none"
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {base} / {o}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="relative mt-3 grid gap-3 sm:grid-cols-2">
        <PairCard
          code={base}
          priceLabel={`${rate4(live)} ${quote}`}
          sub={`1 ${base} buys this much ${quote}`}
          changePct={changePct}
          good={!watching && !sellIsGood}
          spark={spark}
          hasBreakEven={be !== undefined}
          breakEvenLabel={be ? `break-even ${rate4(be)}` : ""}
          hint={`How many ${quote} you get for 1 ${base}.\n\nGoing DOWN (red) = ${quote} is getting more expensive → a good moment to SELL your ${quote} back into ${base}.\n\nGoing UP (green) = ${quote} is getting cheaper → a good moment to BUY ${quote}.`}
        />
        <PairCard
          code={quote}
          priceLabel={`${rate4(live ? 1 / live : 0)} ${base}`}
          sub={`1 ${quote} is worth this much ${base}`}
          changePct={-changePct}
          good={sellIsGood}
          spark={sparkInv}
          hasBreakEven={be !== undefined}
          breakEvenLabel={be ? `break-even ${rate4(1 / be)}` : ""}
          hint={`What 1 ${quote} is worth in ${base}. This is the mirror image of the other chart.\n\nGoing DOWN (red) = ${quote} is cheap right now → a good moment to BUY ${quote}.\n\nGoing UP (green) = ${quote} is strong → a good moment to SELL ${quote} back into ${base}.`}
        />
      </div>


      <div
        className={`relative mt-3 rounded-2xl border p-4 transition-colors ${
          watching
            ? "border-border bg-secondary/40"
            : sellIsGood
              ? "border-gain/30 bg-gain/10"
              : "border-loss/30 bg-loss/10"
        }`}
      >
        <p
          className={`text-lg font-extrabold tracking-tight ${
            watching ? "" : sellIsGood ? "text-gain" : "text-loss"
          }`}
        >
          {verdict.headline}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{verdict.detail}</p>
      </div>
    </div>
  );
}

function PairCard({
  code,
  priceLabel,
  sub,
  changePct,
  good,
  spark,
  hasBreakEven,
  breakEvenLabel,
  hint,
}: {
  code: string;
  priceLabel: string;
  sub: string;
  changePct: number;
  good: boolean;
  spark: { line: string; area: string };
  hasBreakEven: boolean;
  breakEvenLabel: string;
  hint: string;
}) {
  const tone = good ? "gain" : "loss";
  const stroke = good ? "var(--color-gain)" : "var(--color-loss)";
  return (
    <div className="relative overflow-hidden rounded-2xl bg-secondary/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{code}</p>
          <p className="num mt-1 text-2xl font-extrabold tracking-tight">{priceLabel}</p>
          <p
            className={`num mt-0.5 flex items-center gap-1 text-xs font-semibold ${
              good ? "text-gain" : "text-loss"
            }`}
          >
            {changePct >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {(changePct * 100).toFixed(2)}% · 30d
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`How to read the ${code} chart`}
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Info className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 whitespace-pre-line text-xs leading-relaxed">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              How to read this
            </p>
            {hint}
          </PopoverContent>
        </Popover>
      </div>

      <div className="mt-3 h-[52px] w-full">
        {spark.line ? (
          <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="h-full w-full">
            <defs>
              <linearGradient id={`fill-${code}-${tone}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={spark.area} fill={`url(#fill-${code}-${tone})`} />
            {hasBreakEven && (
              <line x1="0" y1="18" x2="100" y2="18" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.5" strokeDasharray="2 2" />
            )}
            <path
              d={spark.line}
              fill="none"
              stroke={stroke}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="[stroke-dasharray:400] [stroke-dashoffset:0] motion-safe:animate-[dash_1.1s_ease-out]"
            />
          </svg>
        ) : (
          <div className="h-full w-full animate-pulse rounded-xl bg-muted/30" />
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {sub}
        {breakEvenLabel ? ` · ${breakEvenLabel}` : ""}
      </p>
    </div>
  );
}
