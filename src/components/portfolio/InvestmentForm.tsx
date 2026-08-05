import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { Investment } from "@/lib/portfolio";
import { fetchCurrencies } from "@/lib/rates";

type Props = {
  onSave: (inv: Investment) => void;
  initial?: Investment;
  trigger: React.ReactNode;
  /** the currency the user thinks in — rates are entered against this */
  base?: string;
};

const today = () => new Date().toISOString().slice(0, 10);

export function InvestmentForm({ onSave, initial, trigger, base = "EUR" }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? (base === "USD" ? "EUR" : "USD"));
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [currentValue, setCurrentValue] = useState(
    initial?.currentValue !== undefined ? String(initial.currentValue) : "",
  );
  const [date, setDate] = useState(initial?.date ?? today());
  const [entryRate, setEntryRate] = useState(initial ? String(initial.entryRate) : "");
  const [interest, setInterest] = useState(
    initial?.interestRate !== undefined ? String(initial.interestRate * 100) : "",
  );
  const [lookingUp, setLookingUp] = useState(false);
  const [touchedRate, setTouchedRate] = useState(false);
  // "What you actually paid in the main currency" — the rate is derived from it.
  const paidEur = useMemo(() => {
    const a = Number(amount);
    const r = Number(entryRate);
    if (!Number.isFinite(a) || !Number.isFinite(r) || r <= 0 || a <= 0) return "";
    return (a / r).toFixed(2);
  }, [amount, entryRate]);
  const [paidDraft, setPaidDraft] = useState<string | null>(null);

  const { data: currencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: fetchCurrencies,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const options = useMemo(() => {
    const list = Object.keys(currencies ?? {});
    return list.length
      ? Array.from(new Set([base, "EUR", ...list]))
      : Array.from(new Set([base, "EUR", "USD", "GBP", "NOK", "SEK", "CHF"]));
  }, [currencies]);

  // Suggest the historical Revolut/ECB reference rate for the chosen day.
  useEffect(() => {
    if (!open || currency === base || touchedRate) {
      if (currency === base) setEntryRate("1");
      return;
    }
    let cancelled = false;
    setLookingUp(true);
    fetch(`https://api.frankfurter.dev/v1/${date}?base=${base}&symbols=${currency}`)
      .then((r) => r.json())
      .then((json: { rates?: Record<string, number> }) => {
        const rate = json.rates?.[currency];
        if (!cancelled && rate) setEntryRate(String(rate));
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLookingUp(false));
    return () => {
      cancelled = true;
    };
  }, [open, currency, date, touchedRate, base]);

  function submit() {
    const amt = Number(amount);
    const rate = Number(entryRate);
    if (!name.trim()) {
      toast.error("Give the investment a name");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error("Enter a valid exchange rate");
      return;
    }
    const cv = currentValue.trim() === "" ? undefined : Number(currentValue);
    if (cv !== undefined && (!Number.isFinite(cv) || cv < 0)) {
      toast.error("Invalid current value");
      return;
    }


    const ir = interest.trim() === "" ? undefined : Number(interest) / 100;
    if (ir !== undefined && (!Number.isFinite(ir) || ir < 0)) {
      toast.error("Invalid interest rate");
      return;
    }

    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      currency,
      amount: amt,
      ...(cv !== undefined ? { currentValue: cv } : {}),
      ...(ir !== undefined ? { interestRate: ir } : {}),
      date,
      entryRate: rate,
      rateSource: touchedRate ? "manual" : (initial?.rateSource ?? "estimated"),
    });
    setOpen(false);
    toast.success(initial ? "Investment updated" : "Investment added");
    if (!initial) {
      setName("");
      setAmount("");
      setCurrentValue("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit investment" : "New investment"}</DialogTitle>
          <DialogDescription>
            The rate means: 1 {base} buys X {currency}. We fill in the rate for the date you pick — change it to the
            rate Revolut actually gave you, so the numbers stay exact.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="S&P 500 ETF" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="amount">Invested</Label>
              <Input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1000"
              />
            </div>
            <div className="grid gap-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {options.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rate">
                1 {base} = ? {currency}{" "}
                {lookingUp ? <span className="text-muted-foreground">…</span> : null}
              </Label>
              <Input
                id="rate"
                inputMode="decimal"
                value={entryRate}
                onChange={(e) => {
                  setTouchedRate(true);
                  setPaidDraft(null);
                  setEntryRate(e.target.value);
                }}
                placeholder="1.09"
              />
            </div>
          </div>

          {currency !== base && (
            <div className="grid gap-2 rounded-2xl border border-border/60 bg-secondary/30 p-3">
              <Label htmlFor="paid">What you actually paid ({base})</Label>
              <Input
                id="paid"
                inputMode="decimal"
                value={paidDraft ?? paidEur}
                onChange={(e) => {
                  const v = e.target.value;
                  setPaidDraft(v);
                  const paid = Number(v);
                  const a = Number(amount);
                  if (Number.isFinite(paid) && paid > 0 && Number.isFinite(a) && a > 0) {
                    setTouchedRate(true);
                    setEntryRate(String(a / paid));
                  }
                }}
                placeholder="400"
              />
              <p className="text-[11px] text-muted-foreground">
                Bought this with {base}? Type the {base} amount that actually left your account (e.g. 400) and we work
                out the exact rate Revolut gave you — much more accurate than the day's official rate.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="cv">Worth today ({currency})</Label>
              <Input
                id="cv"
                inputMode="decimal"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ir">Interest % per year</Label>
              <Input
                id="ir"
                inputMode="decimal"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
                placeholder="3.25"
              />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">
            Leave "worth today" empty and we'll grow the amount with the interest rate you enter, day by day from
            this position's own start date.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={submit} className="w-full rounded-xl">
            {initial ? "Save changes" : "Add investment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
