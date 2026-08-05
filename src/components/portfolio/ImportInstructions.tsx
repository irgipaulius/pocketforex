import { Check, FileSpreadsheet, Lock, Smartphone } from "lucide-react";

type Step = { title: string; body: string; tip?: string };

const STEPS: Step[] = [
  {
    title: "Open your profile",
    body: "In the Revolut app, tap your initials in the top-left corner of the home screen.",
  },
  {
    title: "Go to Documents & statements",
    body: "Scroll the profile menu and tap “Documents and statements”, then “Statements”.",
  },
  {
    title: "Pick “Personal” → “Account statement”",
    body: "This is the one that lists every single transaction, including the moments you swapped euros for dollars. The “Consolidated statement” only shows balances.",
    tip: "Format: Excel (.xlsx) or CSV. Period: from the day you joined Revolut → today.",
  },
  {
    title: "Tick every currency you hold — EUR and USD, not just one",
    body: "This is the important bit. An exchange has two sides: euros leaving and dollars arriving. If you export only the euro account, the dashboard can't see what rate you got.",
    tip: "Select all currencies in the list. One file with both sides = exact rates for every swap.",
  },
  {
    title: "Add the trading statement if you own stocks or ETFs",
    body: "Stocks, ETFs and recurring buys (Vanguard S&P 500, VUAA and friends) live in a separate export: Invest → the ⋯ menu → Statements → Account statement → Excel, all time.",
    tip: "Upload both files at once below — they get merged automatically, and re-uploading never creates duplicates.",
  },
  {
    title: "Set the period to “All time”, not the last month",
    body: "This is the single most common reason a position is missing. A statement dated e.g. 1 Jul – 4 Aug only contains what you bought in those 35 days; a Vanguard buy from last year simply isn't in the file.",
    tip: "Start date = the day you opened the account (or just pick 2015). End date = today.",
  },
  {
    title: "Have more than one investing product? Export each one",
    body: "Revolut keeps Stocks, Robo-advisor / Managed portfolio and Savings-linked funds as separate accounts, each with its own statement. If a position is missing after an all-time export, it lives in a different product: open that product, ⋯ → Statements, and export it too.",
    tip: "You can drop all the files in here in one go.",
  },
]




export function ImportInstructions() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl bg-secondary/50 p-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Your file is read inside your browser. Nothing is uploaded, there is no account and no server ever sees a
          single number. Clearing your browser data clears the dashboard.
        </p>
      </div>

      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{s.title}</p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">{s.body}</p>
              {s.tip && (
                <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-secondary/60 px-2 py-1 text-[11px] text-muted-foreground">
                  <Check className="mt-0.5 size-3 shrink-0 text-gain" />
                  {s.tip}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1">
          <FileSpreadsheet className="size-3" /> .xlsx or .csv
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1">
          <Smartphone className="size-3" /> Also works from the Revolut web app
        </span>
      </div>
    </div>
  );
}
