import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Lock } from "lucide-react";
import { isPhoneClient, revolutHomeUrl, revolutInvestUrl } from "@/lib/revolut-links";

function RevolutLink({
  getHref,
  children,
}: {
  getHref: () => string;
  children: ReactNode;
}) {
  const [href, setHref] = useState("https://app.revolut.com/");
  useEffect(() => setHref(getHref()), [getHref]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="size-3 opacity-70" aria-hidden />
    </a>
  );
}

/** Three steps max. Links open the Revolut app on phones, web app on desktop. */
export function ImportInstructions() {
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneClient()), []);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl bg-secondary/50 p-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Files stay in your browser. No account, no upload — clearing browser data clears this
          dashboard.
        </p>
      </div>

      <ol className="space-y-4">
        <li className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
            1
          </span>
          <div className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
            <p className="text-sm font-semibold text-foreground">Get your account statement</p>
            <p className="mt-1">
              <RevolutLink getHref={revolutHomeUrl}>
                Open Revolut {phone ? "app" : "web app"}
              </RevolutLink>
              {phone
                ? " → your initials → Documents and statements → Account statement."
                : " → pick an account → Statement (top right)."}
            </p>
            <p className="mt-1">
              Excel or CSV · <span className="font-semibold text-foreground">every currency you hold</span>{" "}
              · <span className="font-semibold text-foreground">all time</span> (not just this month).
            </p>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
            2
          </span>
          <div className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
            <p className="text-sm font-semibold text-foreground">Got stocks or ETFs?</p>
            <p className="mt-1">
              <RevolutLink getHref={revolutInvestUrl}>Open Invest</RevolutLink>
              {" → ⋯ → Documents → Stocks → Account statement · all time. Skip if you only have savings."}
            </p>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
            3
          </span>
          <div className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">
            <p className="text-sm font-semibold text-foreground">Drop the file(s) above</p>
            <p className="mt-1">Several files at once are fine. Re-importing won't create duplicates.</p>
          </div>
        </li>
      </ol>
    </div>
  );
}
