import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { FX_RANGES, type FxRangeKey } from "./fx-ranges";
import { fetchFxHistory, fetchLiveQuotes } from "./fx-live.server";

/** Live "1 EUR = x <currency>" quotes, refreshed on every call. */
export const getFxQuote = createServerFn({ method: "GET" })
  .validator((d) =>
    z.object({ currencies: z.array(z.string()).max(12), base: z.string().min(3).max(5).optional() }).parse(d),
  )
  .handler(async ({ data }) => fetchLiveQuotes(data.currencies, data.base ?? "EUR"));

/** Rate history for one currency over the requested window. */
export const getFxHistory = createServerFn({ method: "GET" })
  .validator((d) =>
    z
      .object({
        currency: z.string().min(3).max(5),
        range: z.enum(Object.keys(FX_RANGES) as [FxRangeKey, ...FxRangeKey[]]),
        base: z.string().min(3).max(5).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => fetchFxHistory(data.currency, data.range, data.base ?? "EUR"));
