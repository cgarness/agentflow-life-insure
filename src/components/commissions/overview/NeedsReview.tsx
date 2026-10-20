import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatCents } from "@/lib/commission/installments";
import { policiesHref, scheduledHref } from "@/lib/commission/centerFilters";
import type { CommissionOverview } from "@/lib/commission/centerSchemas";
import { Progress } from "@/components/ui/progress";
import { InfoTip } from "../shared/Bits";

function Item({ to, label, count, detail }: { to: string; label: string; count: number; detail?: string }) {
  const body = (
    <>
      <span className="text-sm text-foreground">{label}</span>
      <span className="flex items-center gap-2 text-sm tabular-nums">
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
        <span className={count > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}>{count}</span>
        {count > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
      </span>
    </>
  );
  return (
    <li>
      {count > 0 ? (
        <Link to={to} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link>
      ) : <div className="flex items-center justify-between gap-3 px-2 py-2">{body}</div>}
    </li>
  );
}

/** Things to look at, whatever the period: past windows without a full receipt, missing dates, unconfirmed estimates
 * and policies without an estimate. Plus how many of the seller's policies have an estimate. */
export function NeedsReview({ data }: { data: CommissionOverview }) {
  const r = data.review;
  const { eligible_count: eligible, with_estimate_count: withEstimate } = data.setup;
  const pct = eligible > 0 ? Math.round((withEstimate / eligible) * 100) : 0;
  return (
    <div className="space-y-3">
      <ul className="-mx-2">
        <Item to={scheduledHref({ scope: "any", status: "check_payment" })} label="Check payment" count={r.check_payment.count}
          detail={r.check_payment.count > 0 ? formatCents(r.check_payment.remaining_cents) : undefined} />
        <Item to={scheduledHref({ scope: "any", status: "date_needed" })} label="Date needed" count={r.date_needed.count} />
        <Item to={policiesHref("needs_review")} label="Needs review" count={r.needs_review.count} />
        <Item to={policiesHref("missing")} label="Missing commission" count={r.missing_estimate.count} />
      </ul>
      {eligible > 0 && (
        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">Estimates set up
              <InfoTip label="About estimates set up">Policies credited to you that have a saved estimate, out of every policy you sold.
                A policy without one shows no amounts, not $0.</InfoTip>
            </span>
            <span className="tabular-nums text-foreground">{withEstimate} of {eligible}</span>
          </div>
          <Progress value={pct} aria-label="Estimates set up" className="h-1.5 bg-primary/15" />
        </div>
      )}
    </div>
  );
}
