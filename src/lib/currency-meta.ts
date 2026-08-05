/** Pretty, human-friendly labels for any currency code that shows up in a
 *  statement — not just the usual EUR/USD suspects.
 */

const SPECIAL_FLAG: Record<string, string> = {
  EUR: "🇪🇺",
  XAF: "🌍",
  XOF: "🌍",
  XPF: "🌊",
  XCD: "🏝️",
  ANG: "🏝️",
  XAU: "🥇",
  XAG: "🥈",
  BTC: "🟠",
  ETH: "🔷",
  USDT: "🟢",
  USDC: "🔵",
  SOL: "🟣",
  XRP: "⚫",
  ADA: "🔹",
  DOGE: "🐕",
};

/** ISO 4217 codes start with the ISO 3166 country code, so the flag falls out. */
export function currencyFlag(code: string): string {
  const c = code.toUpperCase();
  if (SPECIAL_FLAG[c]) return SPECIAL_FLAG[c]!;
  if (!/^[A-Z]{3,}$/.test(c)) return "🏳️";
  const cc = c.slice(0, 2);
  const flag = String.fromCodePoint(
    ...[...cc].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65)),
  );
  return flag;
}

/** "$", "£", "kr" … falling back to the code itself for crypto and oddities. */
export function currencySymbol(code: string): string {
  const c = code.toUpperCase();
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    const sym = parts.find((p) => p.type === "currency")?.value;
    if (sym && sym !== c) return sym;
  } catch {
    /* not a real ISO currency (crypto, etc.) */
  }
  return c;
}

export type AssetCategory = "cash" | "savings" | "fund" | "stock" | "etf" | "bond" | "crypto";

/** Guess what the money was actually moved into, from the statement wording. */
export function inferCategory(text?: string): AssetCategory {
  const t = (text ?? "").toLowerCase();
  if (/(crypto|bitcoin|btc|ethereum|eth|solana|token|coin)/.test(t)) return "crypto";
  if (/(etf|vuaa|vusa|ucits|index|s&p|tracker)/.test(t)) return "etf";
  if (/(bond|gilt|treasury|t-bill)/.test(t)) return "bond";
  if (/(fund|vanguard|robo|portfolio|money market|mmf)/.test(t)) return "fund";
  if (/(stock|share|equity|buy [a-z]{1,5}\b|trade)/.test(t)) return "stock";
  if (/(savings|flexible|interest|deposit|vault)/.test(t)) return "savings";
  return "cash";
}

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  cash: "Cash exchange",
  savings: "Savings",
  fund: "Fund",
  stock: "Stock",
  etf: "ETF",
  bond: "Bond",
  crypto: "Crypto",
};
