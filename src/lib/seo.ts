/** Shared SEO copy for Pocket Forex — keep root + index heads in sync. */
export const SITE_URL = "https://pocketforex.hyperreader.eu";
export const SITE_NAME = "Pocket Forex";

export const SEO_TITLE =
  "Pocket Forex — FX Portfolio Tracker, Break-Even Rates & Currency P&L";

export const SEO_DESCRIPTION =
  "Private FX portfolio tracker for multi-currency savings and investments. See live EUR/USD rates, mark your buys and sells, find your break-even exchange rate, and separate real gains from FX moves. Import Revolut statements — no login, data stays on your device.";

export const SEO_KEYWORDS = [
  "FX portfolio tracker",
  "foreign exchange P&L",
  "currency break-even calculator",
  "EUR USD exchange rate",
  "multi-currency portfolio",
  "FX gain vs asset gain",
  "Revolut statement import",
  "cash out currency calculator",
  "exchange rate impact on investments",
  "private forex tracker",
  "browser FX dashboard",
  "USD savings EUR base",
].join(", ");

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: SEO_DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript",
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  featureList: [
    "FX portfolio tracking",
    "Live exchange rates",
    "Break-even rate calculator",
    "Currency P&L vs asset P&L",
    "Revolut statement import",
    "Private browser-only storage",
  ],
};

/** Meta tags for TanStack Router `head()`. Includes JSON-LD via the runtime `script:ld+json` key. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SEO_META: any[] = [
  { title: SEO_TITLE },
  { name: "description", content: SEO_DESCRIPTION },
  { name: "keywords", content: SEO_KEYWORDS },
  { name: "author", content: SITE_NAME },
  { name: "application-name", content: SITE_NAME },
  { name: "robots", content: "index, follow, max-image-preview:large" },
  { name: "theme-color", content: "#0f172a" },
  { property: "og:site_name", content: SITE_NAME },
  { property: "og:title", content: SEO_TITLE },
  { property: "og:description", content: SEO_DESCRIPTION },
  { property: "og:type", content: "website" },
  { property: "og:url", content: SITE_URL },
  { property: "og:locale", content: "en_US" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:title", content: SEO_TITLE },
  { name: "twitter:description", content: SEO_DESCRIPTION },
  // TanStack Router accepts this at runtime; DOM MetaHTMLAttributes typings do not.
  { "script:ld+json": JSON_LD },
];

export const SEO_LINKS = [{ rel: "canonical", href: SITE_URL }];
