const BASE = "https://api.frankfurter.dev/v1";

export type RateMap = Record<string, number>;

/** Rates are expressed as: 1 EUR = rate <CCY> */
export async function fetchLatestRates(): Promise<{ date: string; rates: RateMap }> {
  const res = await fetch(`${BASE}/latest?base=EUR`);
  if (!res.ok) throw new Error("Could not load live exchange rates");
  const json = (await res.json()) as { date: string; rates: RateMap };
  return { date: json.date, rates: { ...json.rates, EUR: 1 } };
}

export async function fetchCurrencies(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/currencies`);
  if (!res.ok) throw new Error("Could not load currency list");
  return (await res.json()) as Record<string, string>;
}

export type Series = Record<string, RateMap>;

export async function fetchTimeseries(from: string, symbols: string[]): Promise<Series> {
  const wanted = symbols.filter((s) => s !== "EUR");
  if (wanted.length === 0) return {};
  const res = await fetch(`${BASE}/${from}..?base=EUR&symbols=${wanted.join(",")}`);
  if (!res.ok) throw new Error("Could not load historical exchange rates");
  const json = (await res.json()) as { rates: Series };
  return json.rates;
}

/** Nearest "1 EUR = x CCY" on or before `date`. */
export function rateOnDate(series: Series, date: string, currency: string): number | undefined {
  if (currency === "EUR") return 1;
  const days = Object.keys(series).sort();
  let hit: number | undefined;
  for (const d of days) {
    const v = series[d]?.[currency];
    if (typeof v === "number" && v > 0) {
      if (d <= date) hit = v;
      else break;
    }
  }
  if (hit !== undefined) return hit;
  // Before the series starts — earliest known day is the best guess.
  for (const d of days) {
    const v = series[d]?.[currency];
    if (typeof v === "number" && v > 0) return v;
  }
  return undefined;
}
