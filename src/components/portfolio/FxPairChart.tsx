import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  ColorType,
  LineStyle,
  LineType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  Banknote,
  Bitcoin,
  CandlestickChart,
  Landmark,
  Layers,
  PiggyBank,
  ScrollText,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rate4 } from "@/lib/portfolio";
import type { FxTrade } from "@/lib/fx-trades";
import { getFxHistory } from "@/lib/fx-live.functions";
import { FX_RANGES, type FxRangeKey } from "@/lib/fx-ranges";
import { alignQuoteWithLive, netFxCostBasis } from "@/lib/fx-quote";
import {
  CATEGORY_LABEL,
  currencyFlag,
  currencySymbol,
  inferCategory,
  type AssetCategory,
} from "@/lib/currency-meta";

const CATEGORY_ICON: Record<AssetCategory, typeof Banknote> = {
  cash: Banknote,
  savings: PiggyBank,
  fund: Landmark,
  stock: CandlestickChart,
  etf: Layers,
  bond: ScrollText,
  crypto: Bitcoin,
};


type Props = {
  /** currency to compare against the main currency, e.g. "USD" */
  currency: string;
  /** the currency the user thinks in — everything is quoted against this */
  base?: string;
  /** available currencies to switch between */
  options: string[];
  onCurrencyChange: (c: string) => void;
  /** live rate: 1 <base> = liveRate <currency> */
  liveRate?: number;
  /** the "<base> per 1 <currency>" level where the portfolio breaks even */
  breakEvenEurPer?: number;
  /** your own buys and sells of this currency, drawn as markers */
  trades?: FxTrade[];
};

const RANGE_KEYS = Object.keys(FX_RANGES) as FxRangeKey[];

/** Resolve a CSS custom property (oklch etc.) to a plain rgb string. */
function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, bl] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${bl})`;
  } catch {
    return fallback;
  }
}

/** rgb(a, b, c) -> rgba(a, b, c, alpha) */
function withAlpha(rgb: string, alpha: number) {
  const m = rgb.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length < 3) return rgb;
  return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
}

export function FxPairChart({
  currency,
  base = "EUR",
  options,
  onCurrencyChange,
  liveRate,
  breakEvenEurPer,
  trades = [],
}: Props) {
  const [range, setRange] = useState<FxRangeKey>("1Y");
  const [flipped, setFlipped] = useState(true); // true => show <base> per 1 CCY (e.g. 0.86)
  const [hover, setHover] = useState<{ value: number; time: number } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pins, setPins] = useState<{ key: string; left: number; top: number }[]>([]);
  const [openPin, setOpenPin] = useState<string | null>(null);


  const applyDates = () => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    const f = from ? Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000) : undefined;
    const t = to ? Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000) : undefined;
    if (!f && !t) return ts.fitContent();
    ts.setVisibleRange({
      from: (f ?? Math.floor(Date.now() / 1000) - 31_536_000) as UTCTimestamp,
      to: (t ?? Math.floor(Date.now() / 1000)) as UTCTimestamp,
    });
  };

  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastSigRef = useRef<string>("");
  const autoZoomedRef = useRef<string | null>(null);

  const q = useQuery({
    queryKey: ["fx-history", currency, range, base],
    queryFn: () => getFxHistory({ data: { currency, range, base } }),
    enabled: currency !== base,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: range === "1D" || range === "1W" ? 15_000 : 5 * 60_000,
  });

  const data = useMemo(() => {
    const pts = q.data?.points ?? [];
    return pts.map((p) => ({
      time: p.time as UTCTimestamp,
      value: flipped ? 1 / p.value : p.value,
    }));
  }, [q.data, flipped]);

  /** every swap of this currency, regardless of the window on screen */
  const myTrades = useMemo(
    () => trades.filter((t) => t.currency === currency),
    [trades, currency],
  );

  /** Your swaps, snapped onto the nearest candle the chart actually has. */
  const markers = useMemo(() => {
    if (data.length === 0) return [];
    const firstT = data[0]!.time as number;
    return myTrades
      .map((t) => {
        const tt = Math.floor(new Date(`${t.date}T12:00:00Z`).getTime() / 1000);
        return { t, tt };
      })
      .filter((x) => x.tt >= firstT)
      .map(({ t, tt }) => {
        let x = data[0]!.time as number;
        for (const p of data) {
          if ((p.time as number) <= tt) x = p.time as number;
          else break;
        }
        return {
          key: t.id,
          x,
          y: flipped ? 1 / t.rate : t.rate,
          buy: t.amount > 0,
          amount: Math.abs(t.amount),
          eurAmount: t.eurAmount,
          date: t.date,
          rate: t.rate,
          ...(t.description ? { description: t.description } : {}),
          category: inferCategory(t.description),
        };

      })
      .sort((a, b) => a.x - b.x);
  }, [myTrades, data, flipped]);

  /** Zoom the time axis onto the days you actually traded, with some padding. */
  const zoomToTrades = () => {
    const ts = chartRef.current?.timeScale();
    if (!ts || myTrades.length === 0 || data.length < 2) return;
    const stamps = myTrades.map((t) => new Date(`${t.date}T12:00:00Z`).getTime() / 1000);
    const pad = 7 * 86_400;
    const firstT = data[0]!.time as number;
    const lastT = data[data.length - 1]!.time as number;
    // stay inside the loaded window — lightweight-charts throws on ranges it has no data for
    const from = Math.max(firstT, Math.min(...stamps) - pad);
    const to = Math.min(lastT, Math.max(Math.max(...stamps), lastT) + pad);
    if (!(to > from)) return;
    setFrom("");
    setTo("");
    try {
      ts.setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
    } catch {
      ts.fitContent();
    }
  };


  const bought = markers.filter((m) => m.buy).reduce((s, m) => s + m.amount, 0);
  const sold = markers.filter((m) => !m.buy).reduce((s, m) => s + m.amount, 0);

  /** weighted average rate you actually paid, in <base> per 1 <currency> */
  const avgEurPer = useMemo(() => {
    const basis = netFxCostBasis(myTrades, currency);
    return basis?.basePerCurrency;
  }, [myTrades, currency]);

  const first = data[0]?.value;
  const last = data[data.length - 1]?.value;
  const change = first && last ? (last - first) / first : 0;

  const live = liveRate ? (flipped ? 1 / liveRate : liveRate) : undefined;
  // Prefer the cost basis of the swaps drawn on this chart — it must agree
  // with the buy/sell list above. Fall back to the portfolio break-even, but
  // never let an inverted quote (1.67 vs live 0.87) through.
  const breakEvenBasePer = useMemo(() => {
    const fromTrades = avgEurPer;
    const fromPortfolio = breakEvenEurPer && breakEvenEurPer > 0 ? breakEvenEurPer : undefined;
    const liveBasePer = liveRate && liveRate > 0 ? 1 / liveRate : undefined;
    let be = fromTrades ?? fromPortfolio;
    if (be && liveBasePer) be = alignQuoteWithLive(be, liveBasePer);
    // If both exist and the portfolio figure is on the wrong side of 1 vs the
    // trades (or wildly further from live), trust the trades.
    if (fromTrades && fromPortfolio && liveBasePer) {
      const tradesFit = Math.abs(Math.log(fromTrades / liveBasePer));
      const portFit = Math.abs(Math.log(alignQuoteWithLive(fromPortfolio, liveBasePer) / liveBasePer));
      if (portFit > tradesFit + Math.log(1.05)) be = fromTrades;
    }
    return be;
  }, [avgEurPer, breakEvenEurPer, liveRate]);
  const target = breakEvenBasePer ? (flipped ? breakEvenBasePer : 1 / breakEvenBasePer) : undefined;
  const avg = avgEurPer ? (flipped ? avgEurPer : 1 / avgEurPer) : undefined;
  const label = flipped ? `${base} per 1 ${currency}` : `${currency} per 1 ${base}`;


  // create chart once
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const primary = cssVar("--color-primary", "#3b82f6");
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--color-muted-foreground", "#8b8b8b"),
        fontFamily: "inherit",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: {
          color: withAlpha(cssVar("--color-border", "#2a2a2a"), 0.45),
          style: LineStyle.Dotted,
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.18, bottom: 0.12 },
      },
      timeScale: { borderVisible: false, timeVisible: true, rightOffset: 6, barSpacing: 8 },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: withAlpha(primary, 0.5),
          width: 1,
          style: LineStyle.Solid,
          labelBackgroundColor: primary,
        },
        horzLine: {
          color: withAlpha(primary, 0.5),
          style: LineStyle.Dotted,
          labelBackgroundColor: primary,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: false },
      },
      localization: { locale: "en-US", priceFormatter: (p: number) => p.toFixed(4) },
      autoSize: true,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: primary,
      lineWidth: 2,
      lineType: LineType.Curved,
      topColor: withAlpha(primary, 0.34),
      bottomColor: withAlpha(primary, 0),
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderColor: cssVar("--color-background", "#0d0d0d"),
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerBackgroundColor: primary,
      priceLineVisible: false,
      lastValueVisible: false,

      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
    });
    markersRef.current = createSeriesMarkers(series, []);
    chartRef.current = chart;
    seriesRef.current = series;

    chart.subscribeCrosshairMove((param) => {
      const v = param.seriesData.get(series) as { value?: number } | undefined;
      if (!param.time || !v?.value) setHover(null);
      else setHover({ value: v.value, time: param.time as number });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // data, revealed with a short left-to-right animation
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    // the chart library needs strictly increasing, unique timestamps
    const clean = [...data]
      .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time as number))
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter((p, i, arr) => i === 0 || (p.time as number) !== (arr[i - 1]!.time as number));

    if (clean.length === 0) {
      s.setData([]);
      return;
    }

    const sig = `${currency}|${range}|${flipped}`;
    const animate = sig !== lastSigRef.current;
    lastSigRef.current = sig;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (
      !animate ||
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      s.setData(clean);
      chartRef.current?.timeScale().fitContent();
      return;
    }

    const start = performance.now();
    const DUR = 550;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DUR);
      const eased = 1 - (1 - t) ** 3;
      const n = Math.max(2, Math.ceil(clean.length * eased));
      s.setData(clean.slice(0, n));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else {
        rafRef.current = null;
        chartRef.current?.timeScale().fitContent();
      }
    };
    chartRef.current?.timeScale().fitContent();
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [data, currency, range, flipped]);

  // a fresh import brings new swaps: allow the auto-zoom to run again
  useEffect(() => {
    autoZoomedRef.current = null;
  }, [myTrades.length]);

  // the first time your swaps land on the chart, zoom onto them so the
  // markers are actually visible instead of squeezed against the edge
  useEffect(() => {
    if (data.length === 0 || markers.length === 0) return;
    if (autoZoomedRef.current === currency) return;
    autoZoomedRef.current = currency;
    const id = window.setTimeout(zoomToTrades, 620);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, data, currency]);


  // custom pins: the built-in arrow markers are switched off and replaced by
  // HTML badges positioned over the canvas
  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    markersRef.current?.setMarkers([]);
    if (!chart || !s) return;
    const compute = () => {
      const ts = chart.timeScale();
      const next: { key: string; left: number; top: number }[] = [];
      for (const m of markers) {
        const x = ts.timeToCoordinate(m.x as UTCTimestamp);
        const y = s.priceToCoordinate(m.y);
        if (x == null || y == null) continue;
        next.push({ key: m.key, left: x as number, top: y as number });
      }
      setPins(next);
    };
    compute();
    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(compute);
    const ro = new ResizeObserver(compute);
    if (boxRef.current) ro.observe(boxRef.current);
    const id = window.setInterval(compute, 400);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(compute);
      ro.disconnect();
      window.clearInterval(id);
    };
  }, [markers]);

  // break-even + average + live price lines
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of linesRef.current) s.removePriceLine(l);
    linesRef.current = [];
    if (target) {
      linesRef.current.push(
        s.createPriceLine({
          price: target,
          color: cssVar("--color-gain", "#16c784"),
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "break even",
        }),
      );
    }
    // Skip a second line when average and break-even are the same number
    // (pure FX cash with no interest) — two labels on one price is noise.
    const avgDistinct =
      avg && (!target || Math.abs(Math.log(avg / target)) > Math.log(1.002));
    if (avgDistinct && avg) {
      linesRef.current.push(
        s.createPriceLine({
          price: avg,
          color: cssVar("--color-muted-foreground", "#8b8b8b"),
          lineStyle: LineStyle.LargeDashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "your average",
        }),
      );
    }
    if (live) {
      linesRef.current.push(
        s.createPriceLine({
          price: live,
          color: cssVar("--color-primary", "#3b82f6"),
          lineStyle: LineStyle.Dotted,
          lineWidth: 1,
          axisLabelVisible: true,
          title: "now",
        }),
      );
    }
  }, [target, live, avg, data]);


  const shown = hover?.value ?? live;

  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">
            How the {currency}/{base} rate moved
          </h3>
          <p className="text-xs text-muted-foreground">
            {label} ·{" "}
            {hover ? (
              <>
                <span className="num font-semibold text-foreground">{rate4(hover.value)}</span> on{" "}
                {new Date(hover.time * 1000).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: range === "1D" || range === "1W" ? "short" : undefined,
                })}
              </>
            ) : (
              <>
                now{" "}
                <span className="num font-semibold text-foreground">
                  {shown ? rate4(shown) : "—"}
                </span>
                {first && last ? (
                  <>
                    {" · "}
                    <span className={change >= 0 ? "text-gain" : "text-loss"}>
                      {change >= 0 ? "+" : ""}
                      {(change * 100).toFixed(2)}% over {range}
                    </span>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 1 && (
            <Tabs value={currency} onValueChange={onCurrencyChange}>
              <TabsList className="rounded-full">
                {options.map((c) => (
                  <TabsTrigger key={c} value={c} className="rounded-full text-xs">
                    {c}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <button
            onClick={() => setFlipped((f) => !f)}
            className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-secondary/70"
          >
            Flip to {flipped ? `${currency} per 1 ${base}` : `${base} per 1 ${currency}`}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Tabs value={range} onValueChange={(v) => setRange(v as FxRangeKey)}>
          <TabsList className="rounded-full">
            {RANGE_KEYS.map((r) => (
              <TabsTrigger key={r} value={r} className="rounded-full text-xs">
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs">
          <span className="pl-1 text-muted-foreground">from</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="num bg-transparent px-1 outline-none"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="num bg-transparent px-1 outline-none"
          />
          <button
            onClick={applyDates}
            className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Apply
          </button>
        </div>
        <button
          onClick={() => {
            setFrom("");
            setTo("");
            chartRef.current?.timeScale().fitContent();
          }}
          className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-secondary/70"
        >
          Reset zoom
        </button>
        {myTrades.length > 0 && (
          <button
            onClick={zoomToTrades}
            className="rounded-full bg-gain/15 px-3 py-1.5 text-xs font-semibold text-gain transition-colors hover:bg-gain/25"
          >
            Zoom to my {currency} buys
          </button>
        )}
      </div>

      {myTrades.length > 0 && markers.length === 0 && data.length > 0 && (
        <p className="mt-2 rounded-xl bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground">
          Your {myTrades.length} {currency} exchange{myTrades.length > 1 ? "s" : ""} happened before
          this time window — pick a longer range (1Y or MAX) to see the markers.
        </p>
      )}


      <div className="relative mt-3">
        <div ref={boxRef} className="h-[340px] w-full max-w-full overflow-hidden touch-pan-y" />
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {pins.map((p) => {
            const m = markers.find((x) => x.key === p.key);
            if (!m) return null;
            const Icon = CATEGORY_ICON[m.category];
            const open = openPin === p.key;
            return (
              <div
                key={p.key}
                className="group pointer-events-auto absolute z-10"
                style={{ left: p.left, top: p.top, transform: "translate(-50%, -50%)" }}
                onMouseEnter={() => setOpenPin(p.key)}
                onMouseLeave={() => setOpenPin((v) => (v === p.key ? null : v))}
                onClick={() => setOpenPin((v) => (v === p.key ? null : p.key))}
              >
                <div
                  className={`relative flex h-7 min-w-7 items-center justify-center rounded-full border-2 bg-background/95 px-1 leading-none shadow-lg backdrop-blur transition-transform duration-150 hover:scale-110 ${
                    m.buy ? "border-gain" : "border-loss"
                  }`}
                  aria-label={`${m.buy ? "bought" : "sold"} ${currency} on ${m.date}`}
                >
                  <span className="text-[11px] font-extrabold">{currencySymbol(currency)}</span>
                  <span
                    className="pointer-events-none absolute -left-1 -top-1 text-[10px] leading-none"
                    aria-hidden
                  >
                    {currencyFlag(currency)}
                  </span>

                  <span
                    className={`absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full text-background ${
                      m.buy ? "bg-gain" : "bg-loss"
                    }`}
                  >
                    <Icon className="size-2.5" strokeWidth={2.6} />
                  </span>
                </div>

                {open && (
                  <div className="absolute top-[calc(100%+10px)] left-1/2 z-20 w-56 -translate-x-1/2 rounded-xl border border-border bg-popover/95 p-2.5 text-left shadow-xl backdrop-blur">
                    <p
                      className={`text-[11px] font-bold ${m.buy ? "text-gain" : "text-loss"}`}
                    >
                      {m.buy ? "Bought" : "Sold"} {currencySymbol(currency)}
                      {m.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
                    </p>
                    <p className="num mt-1 text-[11px] text-muted-foreground">
                      {new Date(`${m.date}T12:00:00Z`).toLocaleString(undefined, {
                        dateStyle: "medium",
                      })}
                    </p>
                    <p className="num text-[11px] text-muted-foreground">
                      1 {currency} = {rate4(flipped ? m.y : 1 / m.y)} {base} ·{" "}
                      {m.eurAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {base}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold">
                      <Icon className="size-3" /> {CATEGORY_LABEL[m.category]}
                    </p>
                    {m.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {m.description}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {q.isFetching && data.length === 0 && (
          <div className="absolute inset-0 animate-pulse rounded-xl bg-gradient-to-b from-primary/10 to-transparent" />
        )}
        {!q.isFetching && data.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-secondary/30 px-6 text-center text-xs text-muted-foreground">
            {q.isError
              ? `Couldn't load the ${currency}/${base} history right now — try the refresh at the top.`
              : `No rate history available for ${currency}.`}
          </div>
        )}
        {q.isFetching && data.length > 0 && (
          <span className="absolute right-2 top-2 size-1.5 animate-pulse rounded-full bg-primary" />
        )}
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">
        Scroll or pinch to zoom, drag to move around, or set exact dates above.{" "}
        {q.isError ? "Live history is temporarily unavailable." : ""}
      </p>

      {markers.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-gain" /> you bought {currency}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-loss" /> you sold {currency}
            </span>
            <span className="num">
              {bought > 0 ? `bought ${Math.round(bought).toLocaleString()} ${currency}` : ""}
              {bought > 0 && sold > 0 ? " · " : ""}
              {sold > 0 ? `sold ${Math.round(sold).toLocaleString()} ${currency}` : ""} in this
              window
            </span>
          </p>
          <ul className="num space-y-0.5 text-[11px] text-muted-foreground">
            {markers
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 4)
              .map((m) => (
                <li key={`row-${m.key}`}>
                  {m.date} · {m.buy ? "bought" : "sold"}{" "}
                  <span className="font-semibold text-foreground">
                    {m.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
                  </span>{" "}
                  for {m.eurAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {base} —
                  1 {currency} = {rate4(flipped ? m.y : 1 / m.y)} {base}
                </li>
              ))}
          </ul>
        </div>
      )}

      {target && live ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {flipped
            ? live >= target
              ? `You're ahead: 1 ${currency} is worth ${rate4(live)} ${base} and you only need ${rate4(target)} to break even.`
              : `Don't convert yet — wait until 1 ${currency} is worth at least ${rate4(target)} ${base} (it's ${rate4(live)} today).`
            : live <= target
              ? `You're ahead: 1 ${base} costs ${rate4(live)} ${currency} and you need ${rate4(target)} or less to break even.`
              : `Don't convert yet — wait until 1 ${base} costs ${rate4(target)} ${currency} or less (it's ${rate4(live)} today).`}
        </p>
      ) : null}
    </div>
  );
}
