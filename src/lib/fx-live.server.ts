import { FX_RANGES, type FxPoint, type FxRangeKey } from "./fx-ranges";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
  };
};

/** Shared, short-lived cache so many browser polls hit the upstream feed rarely. */
type Entry = { at: number; value: Promise<YahooChart> };
const cache = new Map<string, Entry>();

/** Upstream feeds sometimes hang; never let one stall the whole response. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function yahoo(symbol: string, range: string, interval: string, ttlMs: number): Promise<YahooChart> {
  const key = `${symbol}|${range}|${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const value = (async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://finance.yahoo.com/",
        Origin: "https://finance.yahoo.com",
      },
    });
    if (!res.ok) throw new Error(`Rate feed unavailable (${res.status})`);
    return (await res.json()) as YahooChart;
  })();

  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    // a failed fetch must not be remembered
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

/** Feed symbol for "1 <base> = x <currency>". */
function symbolFor(currency: string, base = "EUR") {
  return `${base.toUpperCase()}${currency.toUpperCase()}=X`;
}

/** Binance's EUR/USDT book is a true tick-by-tick proxy for EUR/USD. */
let usdTick: { at: number; value: Promise<number | null> } | null = null;

function binanceEurUsd(): Promise<number | null> {
  if (usdTick && Date.now() - usdTick.at < 900) return usdTick.value;
  const value = (async () => {
    try {
      const r = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT");
      if (!r.ok) return null;
      const j = (await r.json()) as { price?: string };
      const p = Number(j.price);
      return Number.isFinite(p) && p > 0 ? p : null;
    } catch {
      return null;
    }
  })();
  usdTick = { at: Date.now(), value };
  return value;
}

/** Last known good rates, so a feed outage still returns usable numbers. */
const lastGood: Record<string, number> = {};

/** Daily ECB rates — a calm fallback when the market feeds are unreachable. */
async function frankfurterLatest(currency: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${currency.toUpperCase()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: Record<string, number> };
    const v = json.rates?.[currency.toUpperCase()];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Latest market rates, cached briefly so per-second polling stays polite. */
export async function fetchLiveQuotes(currencies: string[], base = "EUR") {
  const b = base.toUpperCase();
  const wanted = Array.from(
    new Set([...currencies.map((c) => c.toUpperCase()), b].filter((c) => c !== "EUR")),
  );
  const entries = await Promise.all(
    wanted.map(async (c) => {
      try {
        if (c.toUpperCase() === "USD") {
          const live = await binanceEurUsd();
          if (live) return [c, live] as const;
        }
        try {
          const j = await yahoo(symbolFor(c), "1d", "5m", 5000);
          const price = j.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (price) return [c, price] as const;
        } catch {
          // fall through to the daily reference rate
        }
        const daily = await frankfurterLatest(c);
        if (daily) return [c, daily] as const;
        const cached = lastGood[c.toUpperCase()];
        return typeof cached === "number" ? ([c, cached] as const) : null;
      } catch {
        return null;
      }
    }),
  );
  const eurRates: Record<string, number> = { EUR: 1 };
  for (const e of entries) {
    if (!e) continue;
    eurRates[e[0]] = e[1];
    lastGood[e[0].toUpperCase()] = e[1];
  }
  // Re-express "1 EUR = x CCY" as "1 <base> = x CCY" so the whole app can be
  // centred on whatever currency the user thinks in.
  const factor = b === "EUR" ? 1 : eurRates[b];
  if (!factor) return { rates: eurRates, at: Date.now() };
  const rates: Record<string, number> = {};
  for (const [c, v] of Object.entries(eurRates)) rates[c] = v / factor;
  rates[b] = 1;
  return { rates, at: Date.now() };
}

/** Daily ECB history, used when the market feed is busy. */
async function frankfurterHistory(currency: string, days: number, base = "EUR"): Promise<FxPoint[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const res = await fetchWithTimeout(`https://api.frankfurter.dev/v1/${from}..?base=${base.toUpperCase()}&symbols=${currency.toUpperCase()}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { rates?: Record<string, Record<string, number>> };
  const rows = json.rates ?? {};
  return Object.keys(rows)
    .sort()
    .map((day) => {
      const v = rows[day]?.[currency.toUpperCase()];
      return typeof v === "number" ? { time: Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000), value: v } : null;
    })
    .filter((p): p is FxPoint => p !== null);
}

const FALLBACK_DAYS: Record<FxRangeKey, number> = {
  "1D": 7,
  "1W": 14,
  "1M": 31,
  "6M": 183,
  "1Y": 365,
  "3Y": 1095,
  "5Y": 1825,
  MAX: 3650,
};

/** Intraday-to-decade history of "1 EUR = x <currency>". */
export async function fetchFxHistory(
  currency: string,
  range: FxRangeKey,
  base = "EUR",
): Promise<{ points: FxPoint[] }> {
  const cfg = FX_RANGES[range];
  const ttl = range === "1D" || range === "1W" ? 30_000 : 5 * 60_000;
  let j: YahooChart | null = null;
  for (let attempt = 0; attempt < 2 && !j; attempt++) {
    try {
      j = await yahoo(symbolFor(currency, base), cfg.range, cfg.interval, ttl);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const points: FxPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = close[i];
    const t = ts[i];
    if (typeof v === "number" && Number.isFinite(v) && typeof t === "number") {
      points.push({ time: t, value: v });
    }
  }
  if (points.length > 1) return { points };
  try {
    const direct = await frankfurterHistory(currency, FALLBACK_DAYS[range] ?? 365, base);
    if (direct.length > 1) return { points: direct };
  } catch {
    // fall through to the cross-rate route below
  }
  // No direct feed for this pair: build it from the two euro-based series.
  try {
    const days = FALLBACK_DAYS[range] ?? 365;
    const [q, b] = await Promise.all([
      frankfurterHistory(currency, days),
      base.toUpperCase() === "EUR" ? Promise.resolve<FxPoint[]>([]) : frankfurterHistory(base, days),
    ]);
    if (base.toUpperCase() === "EUR") return { points: q };
    const byTime = new Map(b.map((p) => [p.time, p.value]));
    return {
      points: q
        .map((p) => {
          const f = byTime.get(p.time);
          return f && f > 0 ? { time: p.time, value: p.value / f } : null;
        })
        .filter((p): p is FxPoint => p !== null),
    };
  } catch {
    return { points: [] };
  }
}

