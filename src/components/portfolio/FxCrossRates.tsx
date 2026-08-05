import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Grid3X3 } from "lucide-react";

import { getFxQuote, getFxHistory } from "@/lib/fx-live.functions";
import { currencyFlag } from "@/lib/currency-meta";

/** Show a rate with a sensible number of decimals whatever its size. */
function fmt(v: number) {
  if (!Number.isFinite(v) || v <= 0) return "–";
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(1);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(5);
}

/**
 * Live grid of every rate between the currencies you actually hold.
 * Built from our own rate feed (same one the charts use) so it updates in
 * place, without the flicker of a third-party iframe reloading itself.
 */
export function FxCrossRates({ currencies }: { currencies: string[] }) {
  const list = useMemo(() => {
    const picked = Array.from(new Set(currencies.map((c) => c.toUpperCase()).filter(Boolean)));
    for (const fallback of ["EUR", "USD", "GBP"]) {
      if (picked.length >= 3) break;
      if (!picked.includes(fallback)) picked.push(fallback);
    }
    return picked.slice(0, 8);
  }, [currencies]);

  const key = list.join(",");

  // "1 EUR = x CCY" for everything on screen, refreshed gently in place.
  const quotes = useQuery({
    queryKey: ["fx-grid-quotes", key],
    queryFn: () => getFxQuote({ data: { currencies: list, base: "EUR" } }),
    refetchInterval: 5_000,
    placeholderData: keepPreviousData,
  });

  // Yesterday's level for each currency, so we can colour today's move.
  const prev = useQuery({
    queryKey: ["fx-grid-prev", key],
    queryFn: async () => {
      const out: Record<string, number> = { EUR: 1 };
      await Promise.all(
        list
          .filter((c) => c !== "EUR")
          .map(async (c) => {
            try {
              const h = await getFxHistory({ data: { currency: c, range: "1W" as const, base: "EUR" } });
              const pts = h.points ?? [];
              const p = pts[pts.length - 2] ?? pts[pts.length - 1];
              if (p) out[c] = p.value;
            } catch {
              /* colour is optional */
            }
          }),
      );
      return out;
    },
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  const now = quotes.data?.rates ?? {};
  const yday = prev.data ?? {};

  const cell = (row: string, col: string) => {
    const a = now[row];
    const b = now[col];
    if (!a || !b) return null;
    const value = b / a;
    const pa = yday[row];
    const pb = yday[col];
    const change = pa && pb ? (value / (pb / pa) - 1) * 100 : null;
    return { value, change };
  };

  const loading = !quotes.data;

  return (
    <section className="surface mt-3 overflow-hidden p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Grid3X3 className="size-4 text-primary" /> Live rate grid
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Read a row as “1 of this currency buys…”. Green means it got stronger since yesterday.
          </p>
        </div>
        <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          {quotes.isFetching && !loading ? "updating…" : "live"}
        </span>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card p-2 text-left text-xs font-semibold text-muted-foreground">
                1 unit of
              </th>
              {list.map((c) => (
                <th key={c} className="p-2 text-right text-xs font-semibold text-muted-foreground">
                  <span className="mr-1">{currencyFlag(c)}</span>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((row) => (
              <tr key={row} className="group">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-card p-2 text-left text-xs font-bold">
                  <span className="mr-1">{currencyFlag(row)}</span>
                  {row}
                </th>
                {list.map((col) => {
                  if (row === col) {
                    return (
                      <td key={col} className="p-2 text-right text-muted-foreground/40">
                        —
                      </td>
                    );
                  }
                  const c = cell(row, col);
                  const tone =
                    c?.change == null
                      ? "text-foreground"
                      : c.change > 0.01
                        ? "text-emerald-400"
                        : c.change < -0.01
                          ? "text-rose-400"
                          : "text-foreground";
                  return (
                    <td
                      key={col}
                      className="border-t border-border/40 p-2 text-right tabular-nums transition-colors"
                    >
                      {c ? (
                        <>
                          <div className={`font-semibold ${tone}`}>{fmt(c.value)}</div>
                          {c.change != null && (
                            <div className={`text-[10px] ${tone} opacity-80`}>
                              {c.change > 0 ? "+" : ""}
                              {c.change.toFixed(2)}%
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="inline-block h-4 w-14 animate-pulse rounded bg-secondary align-middle" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
