import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ImportInstructions } from "@/components/portfolio/ImportInstructions";
import { parseRevolutStatement, parseRevolutFxTrades, type ImportedItem } from "@/lib/revolut-import";
import type { FxTrade } from "@/lib/fx-trades";
import type { Investment } from "@/lib/portfolio";

type Props = {
  onImport: (items: Investment[], trades: FxTrade[]) => void;
  trigger: React.ReactNode;
};

async function historicalRate(date: string, currency: string): Promise<number | null> {
  if (currency === "EUR") return 1;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=EUR&symbols=${currency}`);
    const json = (await res.json()) as { rates?: Record<string, number> };
    return json.rates?.[currency] ?? null;
  } catch {
    return null;
  }
}

/** Turn any Revolut export (csv or xlsx, one or many files) into plain CSV text. */
async function readAsText(file: File): Promise<string> {
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n]!)).join("\n");
  }
  return file.text();
}

export function ImportDialog({ onImport, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ImportedItem[]>([]);
  const [trades, setTrades] = useState<FxTrade[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  async function onFile(files: File[]) {
    setBusy(true);
    const text = (await Promise.all(files.map(readAsText))).join("\n");
    const parsed = parseRevolutStatement(text);
    const raw = parseRevolutFxTrades(text);

    // Swaps where only one side of the exchange was in the file: fill the rate
    // in from the official rate on that day so the swap still shows up.
    const exact = raw.filter((t) => !t.rateUnknown);
    const filled: typeof raw = [];
    for (const t of raw.filter((t) => t.rateUnknown)) {
      // the same swap may already be here in full, from the other account's file
      const dup = exact.some(
        (e) =>
          e.date === t.date &&
          e.currency === t.currency &&
          (t.eurAmount
            ? Math.abs(e.eurAmount - t.eurAmount) < Math.max(0.5, t.eurAmount * 0.02)
            : Math.abs(Math.abs(e.amount) - Math.abs(t.amount)) < 0.5),
      );
      if (dup) continue;
      const rate = await historicalRate(t.date, t.currency);
      if (!rate) continue;
      const amount = t.eurAmount
        ? Math.sign(t.amount) * t.eurAmount * rate
        : t.amount;
      const eurAmount = t.eurAmount || Math.abs(t.amount) / rate;
      filled.push({
        ...t,
        rate,
        amount: Number(amount.toFixed(2)),
        eurAmount: Number(eurAmount.toFixed(2)),
        description: `${t.description} · rate estimated`,
      });
    }

    const fx = [...exact, ...filled].map((t) => ({ id: crypto.randomUUID(), ...t }));
    setBusy(false);
    setTrades(fx);
    if (parsed.length === 0 && fx.length === 0) {
      toast.error("Couldn't find any savings, funds, stock purchases or currency swaps in that file");
      return;
    }
    setItems(parsed);
    setPicked(Object.fromEntries(parsed.map((p) => [p.key, true])));
  }



  async function confirm() {
    const chosen = items.filter((i) => picked[i.key]);
    if (chosen.length === 0 && trades.length === 0) {
      toast.error("Pick at least one position");
      return;
    }
    setBusy(true);
    const out: Investment[] = [];
    for (const it of chosen) {
      const date = it.date ?? new Date().toISOString().slice(0, 10);
      // Rate priority: the exact rate in the file > the rate implied by the
      // statement's own EUR figure > the official rate on that exact day.
      const implied = it.eurValue && it.eurValue > 0 ? it.amount / it.eurValue : null;
      const exact = it.entryRate ?? implied;
      const rate = exact ?? (await historicalRate(date, it.currency)) ?? 1;
      out.push({
        id: crypto.randomUUID(),
        name: it.name,
        currency: it.currency,
        amount: it.amount,
        date,
        entryRate: rate,
        rateSource: exact ? "statement" : it.currency === "EUR" ? "statement" : "estimated",
        ...(it.interestRate !== undefined ? { interestRate: it.interestRate } : {}),
        note: `Imported from Revolut · ${it.bucket}`,
      });
    }
    onImport(out, trades);
    setBusy(false);
    setOpen(false);
    setItems([]);
    setTrades([]);
    const bits = [
      out.length ? `${out.length} position${out.length > 1 ? "s" : ""}` : "",
      trades.length ? `${trades.length} currency swap${trades.length > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    toast.success(`Imported ${bits.join(" and ")}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setItems([]);
          setTrades([]);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from Revolut</DialogTitle>
          <DialogDescription>
            Read on your device only — your statement never leaves this browser.
          </DialogDescription>
        </DialogHeader>

        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          multiple
          onChange={(e) => {
            const f = Array.from(e.target.files ?? []);
            if (f.length) void onFile(f);
          }}
          className="w-full rounded-xl border border-border bg-secondary/50 p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
        />

        {items.length === 0 && trades.length === 0 && <ImportInstructions />}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((it) => (
              <label
                key={it.key}
                className="flex cursor-pointer items-center gap-3 rounded-xl bg-secondary/60 px-3 py-2.5"
              >
                <Checkbox
                  checked={!!picked[it.key]}
                  onCheckedChange={(v) => setPicked((p) => ({ ...p, [it.key]: !!v }))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{it.name}</span>
                  <span className="block text-[11px] text-muted-foreground num">
                    {it.amount.toLocaleString()} {it.currency}
                    {it.date ? ` · since ${it.date}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {trades.length > 0 && (
          <div className="rounded-xl bg-secondary/40 px-3 py-2.5 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {trades.length} currency swap{trades.length > 1 ? "s" : ""} found
            </span>{" "}
            — they'll appear as buy/sell markers on the rate chart.
            <ul className="mt-1 space-y-0.5 num">
              {trades.slice(0, 6).map((t) => (
                <li key={t.id}>
                  {t.date} · {t.amount > 0 ? "bought" : "sold"} {Math.abs(t.amount).toLocaleString()} {t.currency} at{" "}
                  {t.rate.toFixed(4)}
                </li>
              ))}
              {trades.length > 6 && <li>+{trades.length - 6} more</li>}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={confirm}
            disabled={(items.length === 0 && trades.length === 0) || busy}
            className="w-full rounded-xl"
          >
            {busy ? "Reading your file…" : "Import selected"}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
