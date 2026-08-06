/** Parsers for Revolut CSV exports.
 *
 *  Two shapes are supported:
 *  1. The "consolidated statement" export — savings, cash funds, investment
 *     services and crypto balances (current accounts are skipped).
 *  2. The Stocks / Trading account export — one row per buy or sell, each with
 *     its own price and FX rate. Every trade is imported separately so nothing
 *     is averaged away.
 */

export type ImportedItem = {
  key: string;
  /** e.g. "Savings (USD)" or "VUAA · bought 12 Mar 2026" */
  name: string;
  bucket: string;
  currency: string;
  /** amount in `currency` */
  amount: number;
  /** value in EUR, when the statement provides it */
  eurValue?: number;
  /** ISO date of the buy / account opening, when available */
  date?: string;
  /** yearly interest rate as a decimal (0.0325 = 3.25% a year), when stated */
  interestRate?: number;
  /** 1 EUR = entryRate <currency>, when the file states the exact FX rate used */
  entryRate?: number;
};

function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const SYMBOL_CCY: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY" };

/** "$3,876.14" | "€0.00" | "55.80 CZK" -> { amount, currency } */
export function parseMoney(raw: string): { amount: number; currency: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(-?)\s*([€$£¥])\s*([\d.,]+)$/);
  if (m) {
    const n = Number(m[3]!.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    return { amount: m[1] === "-" ? -n : n, currency: SYMBOL_CCY[m[2]!] ?? "EUR" };
  }
  const m2 = s.match(/^(-?)\s*([\d.,]+)\s*([A-Z]{3})$/);
  if (m2) {
    const n = Number(m2[2]!.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    return { amount: m2[1] === "-" ? -n : n, currency: m2[3]! };
  }
  // "USD 1000" / "USD -1000" (trading export puts the code first)
  const m3 = s.match(/^([A-Z]{3})\s*(-?)\s*([\d.,]+)$/);
  if (m3) {
    const n = Number(m3[3]!.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    return { amount: m3[2] === "-" ? -n : n, currency: m3[1]! };
  }
  return null;
}


function parseNumber(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const dots = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (dots) return `20${dots[3]}-${dots[2]}-${dots[1]}`;
  return undefined;
}

const BUCKETS: { match: RegExp; label: string }[] = [
  { match: /^Savings Accounts Summaries$/i, label: "Savings" },
  { match: /^Flexible Cash Funds Summaries$/i, label: "Flexible Cash Funds" },
  { match: /^Investment Services Summaries$/i, label: "Stocks & funds" },
  { match: /^Crypto Summaries$/i, label: "Crypto" },
];

const STOP = /^Current Accounts Summaries$/i;

/* ------------------------------------------------------------------ */
/* 1. Consolidated statement                                           */
/* ------------------------------------------------------------------ */

function parseSummaries(rows: string[][]): ImportedItem[] {
  const items: ImportedItem[] = [];
  let bucket: string | null = null;
  let current: ImportedItem | null = null;

  const flush = () => {
    // Kept even with a zero balance: newer statements omit "Closing balance"
    // entirely, and this row still carries the interest rate / opening date
    // that the transfer-derived position below wants.
    if (current) items.push(current);
    current = null;
  };


  for (const row of rows) {
    const a = row[0] ?? "";

    if (a && (STOP.test(a) || /Transaction Statements?$/i.test(a))) {
      flush();
      bucket = null;
      continue;
    }
    const found = BUCKETS.find((b) => b.match.test(a));
    if (found) {
      flush();
      bucket = found.label;
      continue;
    }
    if (!bucket) continue;

    // Account header, e.g. `Savings  (USD)` / `Trading  (USD)`
    const header = a.match(/^(.+?)\s*\(([A-Z]{3})\)$/);
    if (header && !/details|information|summary/i.test(header[1]!)) {
      flush();
      current = {
        key: `${bucket}:${header[2]}`,
        name: `${header[1]!.replace(/\s+/g, " ").trim()} (${header[2]})`,
        bucket,
        currency: header[2]!,
        amount: 0,
      };
      continue;
    }
    if (bucket === "Crypto" && /^Crypto account details$/i.test(a) && !current) {
      current = { key: "Crypto:EUR", name: "Crypto (EUR)", bucket, currency: "EUR", amount: 0 };
      continue;
    }
    if (!current) continue;

    for (let i = 0; i < row.length; i++) {
      const label = row[i] ?? "";
      if (/^Closing balance$/i.test(label)) {
        const first = parseMoney(row[i + 1] ?? "");
        const second = parseMoney(row[i + 2] ?? "");
        if (first) {
          current.amount = first.amount;
          if (first.currency !== "EUR" || current.currency === "EUR") current.currency = first.currency;
          if (second && second.currency === "EUR") current.eurValue = second.amount;
          else if (first.currency === "EUR") current.eurValue = first.amount;
        }
      }
      if (/^Opening date$/i.test(label)) {
        const d = parseDate(row[i + 1] ?? "");
        if (d) current.date = d;
      }
      // "Gross rate","3.25% p.a." or "Interest rate (net of Lithuanian tax)","3.25%"
      if (/^Gross rate$/i.test(label) || /^Interest rate/i.test(label)) {
        const p = (row[i + 1] ?? "").match(/([\d.]+)\s*%/);
        if (p) current.interestRate = Number(p[1]) / 100;
      }
    }
  }
  flush();
  return items;
}

/* ------------------------------------------------------------------ */
/* 1b. Standalone Savings statement                                   */
/* ------------------------------------------------------------------ */

/** Revolut's Savings product has its own export with columns such as
 *  Date, Description, Gross interest rate earned, Money in/out, Balance.
 *  Import each deposit as its own dated lot so its historical FX rate is
 *  looked up separately. Daily interest rows are deliberately not positions. */
export function parseSavingsRows(rows: string[][]): ImportedItem[] {
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map((cell) => cell.trim().toLowerCase());
    return cells.includes("date") && cells.includes("description") && cells.includes("money in") && cells.includes("balance");
  });
  if (headerIndex < 0) return [];

  const header = rows[headerIndex]!.map((cell) => cell.trim().toLowerCase());
  const dateCol = header.indexOf("date");
  const descriptionCol = header.indexOf("description");
  const moneyInCol = header.indexOf("money in");
  const rateCol = header.findIndex((cell) => /interest rate/.test(cell));

  let interestRate: number | undefined;
  if (rateCol >= 0) {
    for (const row of rows.slice(headerIndex + 1)) {
      const match = (row[rateCol] ?? "").match(/([\d.]+)\s*%/);
      if (match) interestRate = Number(match[1]) / 100;
    }
  }

  const occurrences = new Map<string, number>();
  const out: ImportedItem[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseDate(row[dateCol] ?? "");
    const description = row[descriptionCol] ?? "";
    const deposit = description.match(/^deposit to\s+["“”]?(.+?)["“”]?$/i);
    const money = parseMoney(row[moneyInCol] ?? "");
    if (!date || !deposit || !money || money.amount <= 0) continue;

    const label = deposit[1]!.replace(/["“”]+$/g, "").trim() || "Savings";
    const baseKey = `${date}:${money.currency}:${money.amount.toFixed(2)}`;
    const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
    occurrences.set(baseKey, occurrence);
    out.push({
      key: `savings-deposit:${baseKey}:${occurrence}`,
      name: `${label} · deposit ${date}${occurrence > 1 ? ` #${occurrence}` : ""}`,
      bucket: "Savings",
      currency: money.currency,
      amount: Number(money.amount.toFixed(2)),
      date,
      ...(interestRate !== undefined ? { interestRate } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Stocks / trading export (one row per trade)                      */
/* ------------------------------------------------------------------ */

const HEAD = {
  date: /^(date|completed date|trade date|settled date|date acquired)$/i,
  ticker: /^(ticker|symbol|instrument|name|security)$/i,
  type: /^(type|activity type|transaction type|side)$/i,
  qty: /^(quantity|shares|no\. of shares|units)$/i,
  price: /^(price per share|price|unit price)$/i,
  amount: /^(total amount|amount|value|total|consideration|net amount)$/i,
  ccy: /^(currency|ccy)$/i,
  fx: /^(fx rate|exchange rate|fx rate to eur|rate)$/i,
};

function findHeader(rows: string[][]): { index: number; cols: Record<string, number> } | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const cols: Record<string, number> = {};
    row.forEach((cell, i) => {
      for (const [key, re] of Object.entries(HEAD)) {
        if (cols[key] === undefined && re.test(cell)) cols[key] = i;
      }
    });
    const hasCore = cols["date"] !== undefined && cols["ticker"] !== undefined;
    const hasMoney = cols["amount"] !== undefined || cols["qty"] !== undefined;
    if (hasCore && hasMoney) return { index: r, cols };
  }
  return null;
}

const BUY = /buy|purchase|acquire|market buy|limit buy|dividend reinvest/i;
const SELL = /sell|sale|disposal/i;

/** Parses a Revolut Stocks/Trading export: one investment per buy row. */
export function parseTradeRows(rows: string[][]): ImportedItem[] {
  const found = findHeader(rows);
  if (!found) return [];
  const { index, cols } = found;
  const out: ImportedItem[] = [];

  for (let r = index + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const cell = (k: keyof typeof HEAD) => (cols[k] === undefined ? "" : (row[cols[k]!] ?? ""));

    const ticker = cell("ticker");
    if (!ticker || /^total$/i.test(ticker)) continue;
    const date = parseDate(cell("date"));
    if (!date) continue;

    const type = cell("type");
    if (type && SELL.test(type) && !BUY.test(type)) continue;
    if (type && !BUY.test(type) && !/^$/.test(type) && !/cash top-?up|deposit/i.test(type)) {
      // keep only buy-like rows when a type column exists
      if (!/buy/i.test(type)) continue;
    }

    const money = parseMoney(cell("amount"));
    const qty = parseNumber(cell("qty"));
    const price = parseMoney(cell("price"));
    const currency = (cell("ccy").match(/[A-Z]{3}/)?.[0] ?? money?.currency ?? price?.currency ?? "EUR") as string;

    let amount = money ? Math.abs(money.amount) : null;
    if (amount === null && qty !== null && price) amount = Math.abs(qty * price.amount);
    if (amount === null || amount <= 0) continue;

    const fx = parseNumber(cell("fx"));
    // Keep the raw figure — ImportDialog orients it against that day's market
    // rate so "0.87 EUR per USD" and "1.15 USD per EUR" both land correctly.
    const entryRate = fx && fx > 0 && currency !== "EUR" ? fx : null;

    out.push({
      // content-based, so re-uploading the same statement never doubles a buy
      key: `trade:${ticker}:${date}:${amount.toFixed(2)}:${currency}`,
      name: `${ticker} · bought ${date}`,

      bucket: "Stocks & funds",
      currency,
      amount,
      date,
      ...(entryRate ? { entryRate } : {}),
    });
  }
  return out;
}

/** Non-EUR cash moves in the trading export: a USD top-up means euros were
 *  converted into dollars at that row's FX rate; a USD withdrawal is the
 *  reverse. These are the currency buys/sells shown on the rate chart. */
function parseTradeCashRows(rows: string[][]): ParsedFxTrade[] {
  const found = findHeader(rows);
  if (!found) return [];
  const { index, cols } = found;
  const out: ParsedFxTrade[] = [];

  for (let r = index + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const cell = (k: keyof typeof HEAD) => (cols[k] === undefined ? "" : (row[cols[k]!] ?? ""));

    if (cell("ticker")) continue;
    const type = cell("type");
    if (!/top-?up|withdraw|deposit|transfer|exchange|convert/i.test(type)) continue;

    const date = parseDate(cell("date"));
    if (!date) continue;

    const money = parseMoney(cell("amount"));
    const currency = (cell("ccy").match(/[A-Z]{3}/)?.[0] ?? money?.currency ?? "EUR") as string;
    if (!money || currency === "EUR" || money.amount === 0) continue;

    const fx = parseNumber(cell("fx"));
    if (!fx || fx <= 0) continue;
    // Prefer the orientation where 1 EUR buys more than 1 unit of a weaker
    // currency (USD, GBP, …). JPY-style quotes stay >1 either way; the
    // ImportDialog re-orients against the official rate when filling gaps.
    const rate = fx < 1 && fx > 0 ? 1 / fx : fx;

    const signed = /withdraw/i.test(type) ? -Math.abs(money.amount) : money.amount;
    out.push({
      date,
      currency,
      amount: signed,
      eurAmount: Math.abs(signed) / rate,
      rate,
      description: signed > 0 ? `Bought ${currency}` : `Sold ${currency}`,
    });
  }
  return out;
}



/* ------------------------------------------------------------------ */
/* 3. Currency exchanges inside the transaction statements             */
/* ------------------------------------------------------------------ */

export type ParsedFxTrade = {
  date: string;
  currency: string;
  /** positive = bought that currency, negative = sold it */
  amount: number;
  /** the euro amount on the other side (always positive) */
  eurAmount: number;
  /** 1 EUR = rate <currency> */
  rate: number;
  description: string;
  /** true when only one side of the swap was in the file, so the rate (and the
   *  foreign amount) still has to be filled in from that day's official rate */
  rateUnknown?: boolean;
};


/** Rows like: "Jul 24, 2026","Exchanged to USD",Exchange,"$622.95",€547.55,… */
export function parseExchangeRows(rows: string[][]): ParsedFxTrade[] {
  const out: ParsedFxTrade[] = [];

  for (const row of rows) {
    const date = parseDate(row[0] ?? "");
    if (!date) continue;
    const description = row[1] ?? "";
    const category = row[2] ?? "";
    if (!/exchange|convert/i.test(`${category} ${description}`)) continue;

    // The two "Money in/out" columns: the account currency, then its EUR value.
    const money = parseMoney(row[3] ?? "");
    const eurCell = parseMoney(row[4] ?? "");
    if (!money || money.currency === "EUR" || money.amount === 0) continue;
    if (!eurCell || eurCell.currency !== "EUR" || eurCell.amount === 0) continue;

    const rate = Math.abs(money.amount) / Math.abs(eurCell.amount);
    if (!Number.isFinite(rate) || rate <= 0) continue;

    out.push({
      date,
      currency: money.currency,
      amount: money.amount,
      eurAmount: Math.abs(eurCell.amount),
      rate,
      description: description || (money.amount > 0 ? `Bought ${money.currency}` : `Sold ${money.currency}`),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3b. "Account statement" export (per-currency personal accounts)      */
/*     Type,Product,Started Date,Completed Date,Description,Amount,     */
/*     Fee,Currency,State,Balance                                       */
/* ------------------------------------------------------------------ */

type AccountRow = {
  type: string;
  product: string;
  date: string;
  stamp: string;
  description: string;
  amount: number;
  currency: string;
  state: string;
};

/** Pulls every row of every "account statement" block found in the text.
 *  Several files can be concatenated, so headers are re-detected as we go. */
function readAccountRows(rows: string[][]): AccountRow[] {
  const out: AccountRow[] = [];
  let cols: Record<string, number> | null = null;

  for (const row of rows) {
    const lower = row.map((c) => c.trim().toLowerCase());
    if (lower.includes("type") && lower.includes("description") && lower.includes("amount") && lower.includes("currency")) {
      cols = {
        type: lower.indexOf("type"),
        product: lower.indexOf("product"),
        completed: lower.indexOf("completed date"),
        started: lower.indexOf("started date"),
        description: lower.indexOf("description"),
        amount: lower.indexOf("amount"),
        currency: lower.indexOf("currency"),
        state: lower.indexOf("state"),
      };
      continue;
    }
    if (!cols) continue;
    const at = (k: string) => (cols![k]! >= 0 ? (row[cols![k]!] ?? "") : "");
    const stampRaw = at("completed") || at("started");
    const date = parseDate(stampRaw);
    const amount = parseNumber(at("amount"));
    const currency = at("currency").match(/[A-Z]{3}/)?.[0];
    if (!date || amount === null || !currency) continue;
    const state = at("state");
    if (state && !/completed/i.test(state)) continue;
    out.push({
      type: at("type"),
      product: at("product"),
      date,
      stamp: stampRaw.trim(),
      description: at("description"),
      amount,
      currency,
      state,
    });
  }
  return out;
}

/** Exchange rows come in pairs sharing one timestamp: one side leaves an
 *  account (negative), the other lands in a different currency (positive).
 *  The rate is simply one side divided by the other. */
export function parseAccountExchanges(rows: string[][]): ParsedFxTrade[] {
  const all = readAccountRows(rows).filter((r) => /exchange|convert/i.test(r.type));
  const groups = new Map<string, AccountRow[]>();
  for (const r of all) {
    const list = groups.get(r.stamp) ?? [];
    // Same timestamp + product + currency + amount = the same leg listed twice.
    if (list.some((x) => x.currency === r.currency && Math.abs(x.amount - r.amount) < 0.005)) continue;
    list.push(r);
    groups.set(r.stamp, list);
  }

  const out: ParsedFxTrade[] = [];
  for (const legs of groups.values()) {
    const totals = new Map<string, number>();
    for (const leg of legs) totals.set(leg.currency, (totals.get(leg.currency) ?? 0) + leg.amount);
    const entries = [...totals.entries()].filter(([, v]) => Math.abs(v) > 0.004);

    const eur = entries.find(([c]) => c === "EUR");
    const other = entries.find(([c]) => c !== "EUR");
    const date = legs[0]!.date;

    if (entries.length === 2 && eur && other) {
      const rate = Math.abs(other[1]) / Math.abs(eur[1]);
      if (Number.isFinite(rate) && rate > 0) {
        out.push({
          date,
          currency: other[0],
          amount: other[1], // positive = bought that currency, negative = sold it
          eurAmount: Math.abs(eur[1]),
          rate,
          description: other[1] > 0 ? `Bought ${other[0]}` : `Sold ${other[0]}`,
        });
        continue;
      }
    }

    // Only one side of the swap is in this export — very common, because the
    // EUR account and the USD account are downloaded as separate statements.
    // Keep the exchange anyway and fill the rate in from that day's official
    // rate later, so no swap ever silently disappears.
    for (const leg of legs) {
      if (Math.abs(leg.amount) < 0.004) continue;
      if (leg.currency !== "EUR") {
        out.push({
          date,
          currency: leg.currency,
          amount: leg.amount,
          eurAmount: 0,
          rate: 0,
          rateUnknown: true,
          description: leg.amount > 0 ? `Bought ${leg.currency}` : `Sold ${leg.currency}`,
        });
        continue;
      }
      const ccy = leg.description.match(/\b(?:to|from|into)\s+([A-Z]{3})\b/)?.[1];
      if (!ccy || ccy === "EUR") continue;
      out.push({
        date,
        currency: ccy,
        // euro leaving the account means that currency was bought
        amount: leg.amount < 0 ? 1 : -1,
        eurAmount: Math.abs(leg.amount),
        rate: 0,
        rateUnknown: true,
        description: leg.amount < 0 ? `Bought ${ccy}` : `Sold ${ccy}`,
      });
    }
  }
  return out;
}


/** Transfers out of a spending account into savings / funds / investing.
 *  Only the "Current" side is counted — Revolut lists the receiving account
 *  as a second, mirrored row. */
export function parseAccountTransfers(rows: string[][]): ImportedItem[] {
  type Acc = { bucket: string; label: string; currency: string; amount: number; date?: string };
  const acc = new Map<string, Acc>();

  const add = (bucket: string, label: string, currency: string, into: number, date: string) => {
    if (!into) return;
    const key = `${bucket}:${currency}`;
    const prev = acc.get(key) ?? { bucket, label, currency, amount: 0 };
    prev.amount += into;
    if (into > 0 && (!prev.date || date < prev.date)) prev.date = date;
    acc.set(key, prev);
  };

  for (const r of readAccountRows(rows)) {
    // Money swapped straight inside a savings account never appears as a
    // transfer — the exchange row itself lands in the savings balance.
    if (/exchange|convert/i.test(r.type) && r.product && /deposit|saving/i.test(r.product)) {
      add("Savings", "Savings", r.currency, r.amount, r.date);
      continue;
    }
    if (!/transfer/i.test(r.type)) continue;
    if (r.product && !/current/i.test(r.product)) continue;
    const m = r.description.match(/^(to|from)\s+(.+)$/i);
    if (!m) continue;

    const dest = DESTINATIONS.find((d) => d.match.test(m[2]!));
    if (!dest) continue;

    add(dest.bucket, dest.label, r.currency, -r.amount, r.date);

  }

  const out: ImportedItem[] = [];
  for (const [key, a] of acc) {
    if (a.amount <= 0.004) continue;
    out.push({
      key,
      name: `${a.label} (${a.currency})`,
      bucket: a.bucket,
      currency: a.currency,
      amount: Number(a.amount.toFixed(2)),
      ...(a.date ? { date: a.date } : {}),
    });
  }
  return out;
}

/** Same day + currency + nearly-equal amount = one swap, even across parsers/files. */
export function dedupeFxTrades(trades: ParsedFxTrade[]): ParsedFxTrade[] {
  const out: ParsedFxTrade[] = [];
  for (const t of trades) {
    const i = out.findIndex(
      (e) =>
        e.date === t.date &&
        e.currency === t.currency &&
        Math.sign(e.amount) === Math.sign(t.amount) &&
        Math.abs(Math.abs(e.amount) - Math.abs(t.amount)) < 0.51,
    );
    if (i < 0) {
      out.push(t);
      continue;
    }
    const prev = out[i]!;
    // Prefer the leg that already has a real rate + EUR figure.
    const score = (x: ParsedFxTrade) =>
      (x.rateUnknown ? 0 : 2) + (x.eurAmount > 0 ? 1 : 0) + (x.rate > 0 ? 1 : 0);
    if (score(t) > score(prev)) out[i] = t;
  }
  return out;
}

export function parseRevolutFxTrades(csv: string): ParsedFxTrade[] {
  const rows = csv.split(/\r?\n/).map(parseRow);
  return dedupeFxTrades([
    ...parseExchangeRows(rows),
    ...parseTradeCashRows(rows),
    ...parseAccountExchanges(rows),
  ]);
}

/**
 * Account statement: Exchange +1000 USD then "To Instant Access Savings" −1000 USD
 * is one conversion + a move — not two purchases. Savings/funds statements then
 * list the same deposit again as a dated lot.
 *
 * Prefer lot-level savings deposits over aggregated `Savings:CCY` buckets from
 * transfers/summaries so importing both files doesn't double the holding.
 */
export function dedupeImportedItems(items: ImportedItem[]): ImportedItem[] {
  const savingsLotCcys = new Set<string>();
  for (const it of items) {
    if (it.key.startsWith("savings-deposit:")) savingsLotCcys.add(it.currency);
  }
  if (savingsLotCcys.size === 0) return items;

  return items.filter((it) => {
    if (it.key.startsWith("savings-deposit:") || it.key.startsWith("trade:")) return true;
    // Aggregated savings/transfer buckets share keys like "Savings:USD"
    if (it.bucket === "Savings" && savingsLotCcys.has(it.currency)) return false;
    return true;
  });
}



/* ------------------------------------------------------------------ */
/* 4. Money moved out of the current accounts into savings / funds     */
/*    (the only place newer statements record these holdings)          */
/* ------------------------------------------------------------------ */

const DESTINATIONS: { match: RegExp; bucket: string; label: string }[] = [
  { match: /flexible cash fund/i, bucket: "Flexible Cash Funds", label: "Flexible Cash Funds" },
  { match: /instant access savings|savings account|savings/i, bucket: "Savings", label: "Savings" },
  { match: /robo|managed portfolio|wealth portfolio/i, bucket: "Robo portfolio", label: "Robo portfolio" },
  { match: /commodit|gold|silver/i, bucket: "Commodities", label: "Commodities" },
  { match: /crypto/i, bucket: "Crypto", label: "Crypto" },
  { match: /vault|pocket|savings goal/i, bucket: "Vaults", label: "Vault" },
  { match: /investment account|trading account|brokerage|stocks/i, bucket: "Stocks & funds", label: "Trading cash" },
];

/** Rows like: "Jul 24, 2026","To EUR Flexible Cash Funds",Others,"-€3,500.00" */
export function parseTransfers(rows: string[][], skipTrading = false): ImportedItem[] {
  type Acc = { bucket: string; label: string; currency: string; amount: number; eur: number; date?: string };
  const acc = new Map<string, Acc>();

  for (const row of rows) {
    const date = parseDate(row[0] ?? "");
    if (!date) continue;
    const desc = row[1] ?? "";
    const m = desc.match(/^(to|from)\s+(.+)$/i);
    if (!m) continue;
    const dest = DESTINATIONS.find((d) => d.match.test(m[2]!));
    if (!dest) continue;
    if (skipTrading && dest.bucket === "Stocks & funds") continue;

    const money = parseMoney(row[3] ?? "");
    if (!money || money.amount === 0) continue;
    // Money leaving the current account (negative) is money put into the product.
    const into = -money.amount;

    const eurCell = parseMoney(row[4] ?? "");
    const eurInto =
      money.currency !== "EUR" && eurCell && eurCell.currency === "EUR" ? -eurCell.amount : 0;

    const key = `${dest.bucket}:${money.currency}`;
    const prev = acc.get(key) ?? {
      bucket: dest.bucket,
      label: dest.label,
      currency: money.currency,
      amount: 0,
      eur: 0,
    };
    // Withdrawal without an EUR leg: shrink the euro cost in proportion to the
    // units leaving. Otherwise leftover EUR + smaller USD ⇒ rates like 0.34.
    if (into < 0 && eurInto === 0 && prev.amount > 0 && prev.eur > 0) {
      const leave = Math.min(-into, prev.amount);
      prev.eur *= (prev.amount - leave) / prev.amount;
    }
    prev.amount += into;
    prev.eur += eurInto;
    if (prev.amount < 0) {
      prev.amount = 0;
      prev.eur = 0;
    } else if (prev.eur < 0) {
      prev.eur = 0;
    }
    if (into > 0 && (!prev.date || date < prev.date)) prev.date = date;
    acc.set(key, prev);
  }

  const out: ImportedItem[] = [];
  for (const [key, a] of acc) {
    if (a.amount <= 0) continue;
    out.push({
      key,
      name: `${a.label} (${a.currency})`,
      bucket: a.bucket,
      currency: a.currency,
      amount: Number(a.amount.toFixed(2)),
      ...(a.eur > 0 ? { eurValue: Number(a.eur.toFixed(2)) } : {}),
      ...(a.date ? { date: a.date } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */

export function parseRevolutStatement(csv: string): ImportedItem[] {
  const rows = csv.split(/\r?\n/).map(parseRow);
  const trades = parseTradeRows(rows);
  const accountTransfers = parseAccountTransfers(rows);
  const swaps = parseRevolutFxTrades(csv);
  const items = [
    ...parseSummaries(rows),
    ...parseSavingsRows(rows),
    ...trades,
    ...parseTransfers(rows, trades.length > 0),
    ...accountTransfers,
  ];

  // A foreign-currency holding was paid for with euros that were swapped
  // first. Use the rate of those swaps, weighted by size, instead of the
  // official rate of the day.
  const buySwaps = swaps.filter((t) => t.amount > 0 && t.eurAmount > 0 && t.rate > 0);
  for (const it of items) {
    if (it.currency === "EUR" || it.entryRate) continue;
    const mine = buySwaps.filter((s) => s.currency === it.currency);
    if (mine.length === 0) continue;
    const bought = mine.reduce((sum, s) => sum + s.amount, 0);
    const spent = mine.reduce((sum, s) => sum + s.eurAmount, 0);
    if (bought > 0 && spent > 0) it.entryRate = bought / spent;
  }

  // Merge by key: the biggest balance wins, but details (interest rate,
  // opening date, EUR value) are kept from whichever row happens to have them.
  const map = new Map<string, ImportedItem>();
  for (const it of items) {
    const prev = map.get(it.key);
    if (!prev) {
      map.set(it.key, { ...it });
      continue;
    }
    const bigger = it.amount > prev.amount ? it : prev;
    const merged: ImportedItem = {
      ...prev,
      ...it,
      amount: Math.max(prev.amount, it.amount),
      name: bigger.name,
    };
    const eurValue = bigger.eurValue ?? prev.eurValue ?? it.eurValue;
    const date = prev.date ?? it.date;
    const interestRate = prev.interestRate ?? it.interestRate;
    const entryRate = prev.entryRate ?? it.entryRate;
    if (eurValue !== undefined) merged.eurValue = eurValue;
    else delete merged.eurValue;
    if (date !== undefined) merged.date = date;
    else delete merged.date;
    if (interestRate !== undefined) merged.interestRate = interestRate;
    else delete merged.interestRate;
    if (entryRate !== undefined) merged.entryRate = entryRate;
    else delete merged.entryRate;
    map.set(it.key, merged);
  }

  return dedupeImportedItems(Array.from(map.values()).filter((i) => i.amount > 0));
}


