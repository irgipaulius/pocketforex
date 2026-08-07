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
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rate4 } from "@/lib/portfolio";
import type { FxTrade } from "@/lib/fx-trades";
import { getFxHistory } from "@/lib/fx-live.functions";
import { FX_RANGES, type FxRangeKey } from "@/lib/fx-ranges";
import { alignQuoteWithLive, netFxCostBasis } from "@/lib/fx-quote";

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

type TradeMark = {
  key: string;
  time: UTCTimestamp;
  price: number;
  buy: boolean;
  amount: number;
  eurAmount: number;
  date: string;
  rate: number;
  description?: string;
};

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

/** Nearest trade mark within ~1.5 chart bars of a crosshair time. */
function nearestMark(marks: TradeMark[], t: number, barSec: number): TradeMark | null {
  if (marks.length === 0) return null;
  const tol = Math.max(barSec * 1.5, 86_400);
  let best: TradeMark | null = null;
  let bestDist = Infinity;
  for (const m of marks) {
    const d = Math.abs((m.time as number) - t);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best && bestDist <= tol ? best : null;
}

/** Compact label for the pin: 1.2k, 850, 12k… */
function pinAmount(n: number) {
  const a = Math.abs(n);
  if (a >= 10_000) return `${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${(a / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (a >= 100) return String(Math.round(a));
  return a.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function moneyAmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * FX P&L of this lot vs today's rate.
 * Buy: what those units are worth now minus what you paid.
 * Sell: what you received minus what those units would be worth now.
 */
function markPnlVsNow(
  m: TradeMark,
  /** 1 base = liveRate currency */
  liveRate: number | undefined,
): { pnl: number; nowWorth: number } | null {
  if (!liveRate || liveRate <= 0 || m.amount <= 0) return null;
  const nowWorth = m.amount / liveRate;
  const pnl = m.buy ? nowWorth - m.eurAmount : m.eurAmount - nowWorth;
  return { pnl, nowWorth };
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
  /** true => show <base> per 1 CCY (e.g. 0.86 EUR per USD) — the sell-USD orientation */
  const [flipped, setFlipped] = useState(true);
  const [hover, setHover] = useState<{ value: number; time: number } | null>(null);
  const [activeMark, setActiveMark] = useState<TradeMark | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastSigRef = useRef<string>("");
  const autoZoomedRef = useRef<string | null>(null);
  const marksRef = useRef<TradeMark[]>([]);
  const barSecRef = useRef(86_400);

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

  const q = useQuery({
    queryKey: ["fx-history", currency, range, base],
    queryFn: () => getFxHistory({ data: { currency, range, base } }),
    enabled: currency !== base,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: range === "1D" || range === "1W" ? 30_000 : 5 * 60_000,
  });

  const data = useMemo(() => {
    const pts = q.data?.points ?? [];
    return pts.map((p) => ({
      time: p.time as UTCTimestamp,
      value: flipped ? 1 / p.value : p.value,
    }));
  }, [q.data, flipped]);

  const myTrades = useMemo(
    () => trades.filter((t) => t.currency === currency),
    [trades, currency],
  );

  /** Buys/sells snapped onto the nearest candle — used for markers + detail panel. */
  const marks = useMemo((): TradeMark[] => {
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
        const mark: TradeMark = {
          key: t.id,
          time: x as UTCTimestamp,
          price: flipped ? 1 / t.rate : t.rate,
          buy: t.amount > 0,
          amount: Math.abs(t.amount),
          eurAmount: t.eurAmount,
          date: t.date,
          rate: t.rate,
        };
        if (t.description) mark.description = t.description;
        return mark;
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [myTrades, data, flipped]);

  marksRef.current = marks;
  barSecRef.current =
    data.length >= 2
      ? Math.max(60, ((data[data.length - 1]!.time as number) - (data[0]!.time as number)) / (data.length - 1))
      : 86_400;

  const zoomToTrades = () => {
    const ts = chartRef.current?.timeScale();
    if (!ts || myTrades.length === 0 || data.length < 2) return;
    const stamps = myTrades.map((t) => new Date(`${t.date}T12:00:00Z`).getTime() / 1000);
    const pad = 7 * 86_400;
    const firstT = data[0]!.time as number;
    const lastT = data[data.length - 1]!.time as number;
    const fromT = Math.max(firstT, Math.min(...stamps) - pad);
    const toT = Math.min(lastT, Math.max(Math.max(...stamps), lastT) + pad);
    if (!(toT > fromT)) return;
    setFrom("");
    setTo("");
    try {
      ts.setVisibleRange({ from: fromT as UTCTimestamp, to: toT as UTCTimestamp });
    } catch {
      ts.fitContent();
    }
  };

  const bought = marks.filter((m) => m.buy).reduce((s, m) => s + m.amount, 0);
  const sold = marks.filter((m) => !m.buy).reduce((s, m) => s + m.amount, 0);

  const avgEurPer = useMemo(() => {
    const basis = netFxCostBasis(myTrades, currency);
    return basis?.basePerCurrency;
  }, [myTrades, currency]);

  const first = data[0]?.value;
  const last = data[data.length - 1]?.value;
  const change = first && last ? (last - first) / first : 0;

  const live = liveRate ? (flipped ? 1 / liveRate : liveRate) : undefined;
  const breakEvenBasePer = useMemo(() => {
    const fromTrades = avgEurPer;
    const fromPortfolio = breakEvenEurPer && breakEvenEurPer > 0 ? breakEvenEurPer : undefined;
    const liveBasePer = liveRate && liveRate > 0 ? 1 / liveRate : undefined;
    let be = fromTrades ?? fromPortfolio;
    if (be && liveBasePer) be = alignQuoteWithLive(be, liveBasePer);
    if (fromTrades && fromPortfolio && liveBasePer) {
      const tradesFit = Math.abs(Math.log(fromTrades / liveBasePer));
      const portFit = Math.abs(Math.log(alignQuoteWithLive(fromPortfolio, liveBasePer) / liveBasePer));
      if (portFit > tradesFit + Math.log(1.05)) be = fromTrades;
    }
    return be;
  }, [avgEurPer, breakEvenEurPer, liveRate]);
  const target = breakEvenBasePer ? (flipped ? breakEvenBasePer : 1 / breakEvenBasePer) : undefined;
  const avg = avgEurPer ? (flipped ? avgEurPer : 1 / avgEurPer) : undefined;
  const label = flipped ? `1 ${currency} = ? ${base}` : `1 ${base} = ? ${currency}`;
  const sellHint = flipped
    ? `Up = ${currency} stronger → better to sell ${currency}`
    : `Down = ${currency} stronger → better to sell ${currency}`;

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
        scaleMargins: { top: 0.12, bottom: 0.1 },
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
    markersRef.current = createSeriesMarkers(series, [], { autoScale: true, zOrder: "top" });
    chartRef.current = chart;
    seriesRef.current = series;

    chart.subscribeCrosshairMove((param) => {
      const v = param.seriesData.get(series) as { value?: number } | undefined;
      if (!param.time || !v?.value) {
        setHover(null);
        setActiveMark(null);
        return;
      }
      const t = param.time as number;
      setHover({ value: v.value, time: t });
      setActiveMark(nearestMark(marksRef.current, t, barSecRef.current));
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

  useEffect(() => {
    autoZoomedRef.current = null;
  }, [myTrades.length]);

  useEffect(() => {
    if (data.length === 0 || marks.length === 0) return;
    if (autoZoomedRef.current === currency) return;
    autoZoomedRef.current = currency;
    const id = window.setTimeout(zoomToTrades, 620);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, data, currency]);

  // Native canvas dots + amount — never steal pointer events from zoom/scrub
  useEffect(() => {
    const plugin = markersRef.current;
    if (!plugin) return;
    const gain = cssVar("--color-gain", "#16c784");
    const loss = cssVar("--color-loss", "#ea3943");
    const seriesMarkers: SeriesMarker<Time>[] = marks.map((m) => ({
      time: m.time,
      // Sit the dot on the rate; label hangs above buys / below sells so they don't collide
      position: m.buy ? "atPriceTop" : "atPriceBottom",
      shape: "circle",
      color: m.buy ? gain : loss,
      size: 1.4,
      price: m.price,
      id: m.key,
      text: pinAmount(m.amount),
    }));
    plugin.setMarkers(seriesMarkers);
  }, [marks]);

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
    const avgDistinct = avg && (!target || Math.abs(Math.log(avg / target)) > Math.log(1.002));
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
  const activePnl = activeMark ? markPnlVsNow(activeMark, liveRate) : null;
  /** 1 currency = ? base at the trade and now */
  const tradeBasePer = activeMark
    ? flipped
      ? activeMark.price
      : 1 / activeMark.price
    : undefined;
  const nowBasePer = liveRate && liveRate > 0 ? 1 / liveRate : undefined;

  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">
            How the {currency}/{base} rate moved
          </h3>
          <p className="text-xs text-muted-foreground">
            {label} · {sellHint}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
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
            Flip to {flipped ? `1 ${base} = ? ${currency}` : `1 ${currency} = ? ${base}`}
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

      {myTrades.length > 0 && marks.length === 0 && data.length > 0 && (
        <p className="mt-2 rounded-xl bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground">
          Your {myTrades.length} {currency} exchange{myTrades.length > 1 ? "s" : ""} happened before
          this time window — pick a longer range (1Y or MAX) to see the markers.
        </p>
      )}

      <div className="relative mt-3">
        <div ref={boxRef} className="h-[360px] w-full max-w-full overflow-hidden touch-pan-y" />
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

      {/* Detail card — scrub near a pin; stays under the chart so zoom never fights a floating tooltip */}
      {activeMark ? (
        <div
          className={`mt-2 rounded-xl border px-3 py-2.5 text-xs ${
            activeMark.buy ? "border-gain/30 bg-gain/10" : "border-loss/30 bg-loss/10"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className={`font-bold ${activeMark.buy ? "text-gain" : "text-loss"}`}>
              {activeMark.buy ? "Bought" : "Sold"} {moneyAmt(activeMark.amount)} {currency}
            </p>
            <p className="num text-muted-foreground">
              {new Date(`${activeMark.date}T12:00:00Z`).toLocaleDateString(undefined, {
                dateStyle: "medium",
              })}
            </p>
          </div>
          <dl className="num mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{currency}</dt>
              <dd className="font-semibold">{moneyAmt(activeMark.amount)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{base}</dt>
              <dd className="font-semibold">{moneyAmt(activeMark.eurAmount)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Rate then</dt>
              <dd className="font-semibold">
                1 {currency} = {tradeBasePer != null ? rate4(tradeBasePer) : "—"} {base}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Rate now</dt>
              <dd className="font-semibold">
                1 {currency} = {nowBasePer != null ? rate4(nowBasePer) : "—"} {base}
              </dd>
            </div>
          </dl>
          {activePnl ? (
            <p
              className={`num mt-2 text-sm font-bold ${activePnl.pnl >= 0 ? "text-gain" : "text-loss"}`}
            >
              {activePnl.pnl >= 0 ? "+" : ""}
              {moneyAmt(activePnl.pnl)} {base}{" "}
              <span className="font-medium text-muted-foreground">
                {activeMark.buy
                  ? `vs what you paid · now worth ${moneyAmt(activePnl.nowWorth)} ${base}`
                  : `vs holding · would be worth ${moneyAmt(activePnl.nowWorth)} ${base}`}
              </span>
            </p>
          ) : null}
          {activeMark.description ? (
            <p className="mt-1 line-clamp-1 text-muted-foreground">{activeMark.description}</p>
          ) : null}
        </div>
      ) : marks.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-gain" /> buy {currency}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-loss" /> sell {currency}
          </span>
          <span className="num">
            {bought > 0 ? `bought ${Math.round(bought).toLocaleString()} ${currency}` : ""}
            {bought > 0 && sold > 0 ? " · " : ""}
            {sold > 0 ? `sold ${Math.round(sold).toLocaleString()} ${currency}` : ""}
          </span>
          <span className="text-muted-foreground/80">Scrub near a pin for P&amp;L</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Scroll or pinch to zoom, drag to pan.
        </p>
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
