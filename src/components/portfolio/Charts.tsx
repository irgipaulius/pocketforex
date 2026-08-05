import {
  Area,
  AreaChart,
  ComposedChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { eur } from "@/lib/portfolio";

/** Formats an amount already denominated in the user's main currency. */
export type Fmt = (v: number) => string;

const axis = { stroke: "var(--color-muted-foreground)", fontSize: 11 };

/** Short axis labels, e.g. "CZK 150K" — long currency names would be clipped. */
const compact = (ccy: string) => (v: number) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: ccy,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  } catch {
    return String(Math.round(v));
  }
};

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  color: "var(--color-popover-foreground)",
  fontSize: 12,
} as const;

export type ValuePoint = { date: string; live: number; frozen: number; fx: number };

export function ValueChart({
  data,
  fmt = eur,
  currency = "EUR",
}: {
  data: ValuePoint[];
  fmt?: Fmt;
  currency?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="gLive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={compact(currency)} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, n) => [fmt(v), n === "live" ? "Actual (with FX)" : "If FX never moved"]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(v) => (v === "live" ? "Actual (with FX)" : "If FX never moved")}
        />
        <Area
          type="monotone"
          dataKey="live"
          stroke="var(--color-primary)"
          strokeWidth={2.5}
          fill="url(#gLive)"
          activeDot={{ r: 4 }}
        />
        <Line type="monotone" dataKey="frozen" stroke="var(--color-muted-foreground)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function FxImpactChart({
  data,
  fmt = eur,
  currency = "EUR",
}: {
  data: ValuePoint[];
  fmt?: Fmt;
  currency?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="gFx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-gain)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="var(--color-loss)" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={compact(currency)} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmt(v), "FX impact"]} />
        <Area type="monotone" dataKey="fx" stroke="var(--color-primary)" strokeWidth={2} fill="url(#gFx)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

export function AllocationChart({
  data,
  fmt = eur,
}: {
  data: { name: string; value: number }[];
  fmt?: Fmt;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3} stroke="none">
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => [fmt(v), String(n)]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
