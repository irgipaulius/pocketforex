import type { RateMap } from "@/lib/rates";

type Props = {
  rates: RateMap;
  /** portfolio value in EUR, converted into the paired currency */
  amountEur: number;
  /** currency paired against EUR, defaults to USD */
  quote?: string;
};

const n = (v: number, d = 4) => v.toLocaleString("en-IE", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v: number, ccy: string) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(v);

/** Shows both directions of the EUR pair at once, with the converted amount. */
export function FxTicker({ rates, amountEur, quote = "USD" }: Props) {
  const rate = rates[quote];
  if (!rate) return null;
  const inverse = 1 / rate;

  return (
    <div className="surface grid gap-3 p-4 sm:grid-cols-2">
      <div className="flex items-baseline justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">EUR / {quote}</p>
          <p className="num text-lg font-bold">{n(rate)}</p>
          <p className="text-[11px] text-muted-foreground">1 EUR = {n(rate)} {quote}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Portfolio in {quote}</p>
          <p className="num font-semibold">{money(amountEur * rate, quote)}</p>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{quote} / EUR</p>
          <p className="num text-lg font-bold">{n(inverse)}</p>
          <p className="text-[11px] text-muted-foreground">1 {quote} = {n(inverse)} EUR</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Portfolio in EUR</p>
          <p className="num font-semibold">{money(amountEur, "EUR")}</p>
        </div>
      </div>
    </div>
  );
}
