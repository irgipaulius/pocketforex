# Pocket Forex

Personal FX portfolio tracker: positions, live cross rates, charts, and Revolut statement import.

**Live:** [https://pocketforex.hyperreader.eu](https://pocketforex.hyperreader.eu)

## Stack

- [TanStack Start](https://tanstack.com/start) (React + SSR + server functions)
- Vite 8
- Tailwind CSS 4
- Cloudflare Workers (Wrangler) — same runtime Cloudflare uses for full-stack Pages apps

## Features

- Track FX positions and P&amp;L in your chosen base currency
- Live quotes (Yahoo / Binance / ECB Frankfurter fallback)
- Historical rate charts across common windows
- Import Revolut FX activity from Excel/CSV exports
- Client-side portfolio state (no account required)

## Develop

Requires Node 22+ (or Bun).

```sh
bun install   # or: npm install
bun run dev   # or: npm run dev
```

App runs at the Vite URL shown in the terminal (usually `http://localhost:5173`).

## Build &amp; deploy (Cloudflare)

```sh
bun run build
bunx wrangler login          # once
bunx wrangler deploy         # or: bun run deploy
```

Wrangler config (`wrangler.jsonc`) deploys the `pocketforex` Worker and attaches the custom domain **pocketforex.hyperreader.eu** (zone must already live on the same Cloudflare account as [hyperreader.eu](https://hyperreader.eu)).

## Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Local Vite + Workers-aware SSR |
| `build` | Production build |
| `preview` | Local preview of the production build |
| `deploy` | Build + `wrangler deploy` |
| `cf-typegen` | Generate Cloudflare binding types |
| `lint` / `format` | ESLint / Prettier |

## License

MIT
