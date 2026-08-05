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
