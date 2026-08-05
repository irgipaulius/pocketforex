import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InvestmentForm } from "@/components/portfolio/InvestmentForm";
import { eur, maturityLabel, pct, rate4, type Investment, type Metrics } from "@/lib/portfolio";

type SortKey = "date" | "name" | "value" | "pnl";

type Props = {
  metrics: Metrics[];
  onSave: (inv: Investment) => void;
  onDelete: (id: string) => void;
  /** the currency every converted figure is shown in */
  base?: string;
  /** formats an amount already in the main currency */
  fmt?: (n: number) => string;
};

export function PositionsTable({ metrics, onSave, onDelete, fmt = eur, base = "EUR" }: Props) {
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = metrics.filter(
      (m) =>
        !needle ||
        m.investment.name.toLowerCase().includes(needle) ||
        m.investment.currency.toLowerCase().includes(needle),
    );
    return list.sort((a, b) => {
      const v =
        sort === "date"
          ? a.investment.date.localeCompare(b.investment.date)
          : sort === "name"
            ? a.investment.name.localeCompare(b.investment.name)
            : sort === "value"
              ? a.nowEur - b.nowEur
              : a.totalPnl - b.totalPnl;
      return v * dir;
    });
  }, [metrics, sort, dir, q]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const head = (key: SortKey, label: string, className = "") => (
    <button
      onClick={() => {
        if (sort === key) setDir((d) => (d === 1 ? -1 : 1));
        else {
          setSort(key);
          setDir(key === "name" ? 1 : -1);
        }
      }}
      className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors hover:text-foreground ${
        sort === key ? "text-foreground" : "text-muted-foreground"
      } ${className}`}
    >
      {label}
      <ChevronDown
        className={`size-3 transition-transform ${sort === key && dir === 1 ? "rotate-180" : ""}`}
      />
    </button>
  );

  return (
    <div className="surface mt-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          <span className="num font-semibold text-foreground">{rows.length}</span> position
          {rows.length === 1 ? "" : "s"} · tap a row for the details
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or currency"
            className="h-8 w-52 rounded-full pl-8 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/60 bg-secondary/40 px-3 py-2">
        <div className="flex items-center gap-3">
          {head("name", "Position")}
          {head("date", "Bought")}
        </div>
        {head("value", "Worth now", "justify-end")}
        {head("pnl", "Profit", "justify-end")}
      </div>

      <div className="max-h-[520px] overflow-y-auto">
        {rows.map((m) => {
          const mat = maturityLabel(m.maturity);
          const isOpen = open.has(m.investment.id);
          return (
            <div key={m.investment.id} className="border-b border-border/40 last:border-0">
              <button
                onClick={() => toggle(m.investment.id)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ChevronDown
                      className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                    <span className="truncate text-sm font-semibold">{m.investment.name}</span>
                    <Badge variant="secondary" className="rounded-full text-[10px]">
                      {m.investment.currency}
                    </Badge>
                    {m.investment.currency !== base && (m.rateSource ?? m.investment.rateSource) === "estimated" && (
                      <span
                        title="We couldn't trust the rate in the statement, so we used that day's official rate. Edit the position to enter what you really paid."
                        className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"
                      >
                        rate guessed
                      </span>
                    )}
                    <span
                      className={`hidden rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline ${
                        mat.tone === "good"
                          ? "bg-gain/15 text-gain"
                          : mat.tone === "warn"
                            ? "bg-primary/15 text-primary"
                            : mat.tone === "bad"
                              ? "bg-loss/15 text-loss"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {mat.label}
                    </span>
                  </div>
                  <p className="num mt-0.5 pl-6 text-[11px] text-muted-foreground">
                    {m.investment.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                    {m.investment.currency} · {m.investment.date} · {m.holdingDays}d
                  </p>
                </div>
                <p className="num text-right text-sm font-semibold">{fmt(m.nowEur)}</p>
                <p
                  className={`num w-24 text-right text-xs font-semibold ${
                    m.totalPnl >= 0 ? "text-gain" : "text-loss"
                  }`}
                >
                  {fmt(m.totalPnl)}
                  <span className="block text-[10px] opacity-80">{pct(m.totalPct)}</span>
                </p>
              </button>

              {isOpen && (
                <div className="animate-fade-in bg-secondary/25 px-3 pb-4 pt-1">
                  <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {m.investment.currency !== base && (
                      <>
                        <Cell
                          label={`1 ${base} buys (${m.investment.currency})`}
                          value={`${rate4(m.liveRate)} now · ${rate4(m.entryRate)} when you bought`}
                        />
                        <Cell
                          label={`1 ${m.investment.currency} buys (${base})`}
                          value={`${rate4(1 / m.liveRate)} now · ${rate4(1 / m.entryRate)} when you bought`}
                        />
                      </>
                    )}
                    <Cell
                      label="Worth today"
                      value={`${m.currentValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${
                        m.investment.currency
                      } = ${fmt(m.nowEur)}`}
                    />
                    <Cell
                      label="Currency effect"
                      value={`${fmt(m.fxPnl)} (${pct(m.fxPct)})`}
                      tone={m.fxPnl >= 0 ? "gain" : "loss"}
                    />
                    {m.investment.interestRate !== undefined && (
                      <Cell
                        label={`Interest ${(m.investment.interestRate * 100).toFixed(2)}%/yr`}
                        value={`+${m.interestEarned.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${
                          m.investment.currency
                        }`}
                        tone="gain"
                      />
                    )}
                    {m.investment.currency !== base && (
                      <Cell
                        label="Break even at"
                        value={`1 ${m.investment.currency} = ${rate4(m.breakEvenEurPer)} ${base}`}
                        tone={m.breakEvenGap >= 0 ? "gain" : "loss"}
                      />
                    )}
                    <Cell
                      label="Usual currency wobble"
                      value={`±${(m.fxNoise * 100).toFixed(1)}%`}
                    />
                  </dl>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        m.maturity >= 0 ? "bg-gain" : "bg-loss"
                      }`}
                      style={{ width: `${Math.min(100, Math.abs(m.maturity) * 50)}%` }}
                    />
                  </div>

                  {m.investment.currency !== base && (m.rateSource ?? m.investment.rateSource) === "estimated" && (
                    <p className="mt-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-[11px] text-foreground/90">
                      We don't have a reliable exchange rate for when this {m.investment.currency} was
                      bought, so the figures use the official rate around {m.investment.date}. If you
                      remember what you paid in {base}, hit <strong>Edit</strong> and type that amount
                      into "What you actually paid" — every number here becomes exact.
                    </p>
                  )}

                  <p className="mt-2 flex items-start gap-1 text-[11px] text-muted-foreground">
                    <ArrowUpRight className="mt-0.5 size-3 shrink-0" />
                    <span>
                      {m.investment.currency === base
                        ? `This one is already in ${base}, so the exchange rate can't change it.`
                        : m.breakEvenGap >= 0
                          ? `Converting back today would leave you ${fmt(m.totalPnl)} ahead of what you paid. ` +
                            `You only lose if 1 ${m.investment.currency} falls below ${rate4(
                              m.breakEvenEurPer,
                            )} ${base}.`
                          : `Don't convert yet — wait until 1 ${m.investment.currency} is worth ${rate4(m.breakEvenEurPer)} ${base} ` +
                            `(it's ${rate4(1 / m.liveRate)} today).` +
                            (m.daysToBreakEven !== null
                              ? ` Even if the rate never moves, interest alone covers the gap in about ${m.daysToBreakEven} days.`
                              : "")}
                    </span>
                  </p>

                  <div className="mt-3 flex justify-end gap-2">
                    <InvestmentForm
                      base={base}
                      initial={m.investment}
                      onSave={onSave}
                      trigger={
                        <Button variant="ghost" size="sm" className="rounded-full text-xs">
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-xs text-loss hover:text-loss"
                      onClick={() => onDelete(m.investment.id)}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            Nothing matches “{q}”.
          </p>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-xl bg-background/60 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`num font-semibold ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
