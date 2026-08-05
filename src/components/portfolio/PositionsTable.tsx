import { useMemo, useState } from "react";
import { ChevronDown, Info, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InvestmentForm } from "@/components/portfolio/InvestmentForm";
import { eur, pct, rate4, type Investment, type Metrics } from "@/lib/portfolio";

type SortKey = "date" | "name" | "value" | "pnl";

type Props = {
  metrics: Metrics[];
  onSave: (inv: Investment) => void;
  onDelete: (id: string) => void;
  base?: string;
  fmt?: (n: number) => string;
};

export function PositionsTable({ metrics, onSave, onDelete, fmt = eur, base = "EUR" }: Props) {
  const [sort, setSort] = useState<SortKey>("value");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    return metrics.slice().sort((a, b) => {
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
  }, [metrics, sort, dir]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const head = (key: SortKey, label: string, className = "") => (
    <button
      type="button"
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
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/60 bg-secondary/40 px-3 py-2">
        <div className="flex items-center gap-3">
          {head("name", "Position")}
          {head("date", "Bought")}
        </div>
        {head("value", "Worth", "justify-end")}
        {head("pnl", "P&L", "justify-end")}
      </div>

      <div className="max-h-[520px] overflow-y-auto">
        {rows.map((m) => {
          const isOpen = open.has(m.investment.id);
          const estimated = (m.rateSource ?? m.investment.rateSource) === "estimated";
          const foreign = m.investment.currency !== base;
          return (
            <div key={m.investment.id} className="border-b border-border/40 last:border-0">
              <button
                type="button"
                onClick={() => toggle(m.investment.id)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <ChevronDown
                      className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                    <span className="truncate text-sm font-semibold">{m.investment.name}</span>
                    <span className="text-[11px] text-muted-foreground">{m.investment.currency}</span>
                    {estimated && foreign && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            className="inline-flex text-muted-foreground hover:text-foreground"
                            aria-label="Rate estimated from that day's market"
                          >
                            <Info className="size-3.5" />
                          </span>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-64 text-xs leading-relaxed"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Exchange rate for {m.investment.date} estimated from the official FX feed
                          for that day. Edit the position and enter what you actually paid for an
                          exact figure.
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <p className="num mt-0.5 pl-6 text-[11px] text-muted-foreground">
                    {m.investment.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                    {m.investment.currency} · {m.investment.date}
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
                <div className="animate-fade-in space-y-3 bg-secondary/25 px-3 pb-4 pt-1">
                  {foreign ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                      <Row
                        label={`1 ${m.investment.currency} in ${base}`}
                        value={`${rate4(1 / m.liveRate)} now · ${rate4(1 / m.entryRate)} bought`}
                      />
                      <Row
                        label="Currency effect"
                        value={`${fmt(m.fxPnl)} (${pct(m.fxPct)})`}
                        tone={m.fxPnl >= 0 ? "gain" : "loss"}
                      />
                      <Row
                        label="Break even"
                        value={`1 ${m.investment.currency} = ${rate4(m.breakEvenEurPer)} ${base}`}
                        tone={m.breakEvenGap >= 0 ? "gain" : "loss"}
                      />
                      {m.investment.interestRate !== undefined && (
                        <Row
                          label="Interest"
                          value={`+${m.interestEarned.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${m.investment.currency}`}
                          tone="gain"
                        />
                      )}
                    </dl>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Already in {base} — exchange rate doesn't move this one.
                    </p>
                  )}

                  {foreign && (
                    <p className="text-[11px] text-muted-foreground">
                      {m.breakEvenGap >= 0
                        ? `Converting back today: about ${fmt(m.totalPnl)} ahead.`
                        : `Wait until 1 ${m.investment.currency} ≥ ${rate4(m.breakEvenEurPer)} ${base} (now ${rate4(1 / m.liveRate)}).`}
                    </p>
                  )}

                  <div className="flex justify-end gap-1">
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
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">No positions yet.</p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`num mt-0.5 font-semibold ${tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
