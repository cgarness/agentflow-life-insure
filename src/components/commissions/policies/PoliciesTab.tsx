import { useSearchParams } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import { useCommissionPolicies } from "@/hooks/useCommissionsCenter";
import { PAGE_SIZE, parsePolicies, periodReady, withParam } from "@/lib/commission/centerFilters";
import type { PolicyListPage } from "@/lib/commission/centerSchemas";
import type { OpenPolicy } from "../CommissionDrawer";
import { InfoTip, Pager } from "../shared/Bits";
import { CenterError } from "../shared/CenterState";
import { PoliciesFilters } from "./PoliciesFilters";
import { PoliciesTable } from "./PoliciesTable";

/** The whole filter's totals with the breakdowns' definitions, so a bar or slice equals the list it opens. */
function Totals({ totals }: { totals: PolicyListPage["totals"] }) {
  const { money } = useAmounts();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-sm">
      <span className="text-muted-foreground">
        {totals.policies} {totals.policies === 1 ? "policy" : "policies"} · {totals.with_estimate_count} with estimate
        {totals.on_hold_count > 0 ? ` · On hold: ${totals.on_hold_count} not included` : ""}
      </span>
      <span className="flex items-center gap-1 tabular-nums">
        Est. commission <span className="font-semibold">{totals.with_estimate_count > 0 ? money(totals.estimate_cents) : "—"}</span>
        <InfoTip label="About Est. commission">Saved first-year estimates on these policies (not on hold). Policies without an estimate are
          not counted as $0. Not carrier-verified.</InfoTip>
      </span>
    </div>
  );
}

/** Policies: every policy credited to the seller, with its estimate, payments and setup state; filterable by sale date. */
export function PoliciesTab({ onOpen }: { onOpen: OpenPolicy }) {
  const [params, setParams] = useSearchParams();
  const filter = parsePolicies(params);
  const query = useCommissionPolicies(filter);
  const data = query.data;
  const pending = query.isPlaceholderData;
  const counts = data?.counts;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PoliciesFilters filter={filter} data={data} />
        {counts && counts.eligible_count > 0 && (
          <div className="w-full max-w-xs space-y-1.5 sm:w-64">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">Estimates set up
                <InfoTip label="About estimates set up">Policies credited to you that have a saved estimate, out of every policy you sold.
                  A policy without one shows no amounts, not $0.</InfoTip>
              </span>
              <span className="tabular-nums text-foreground">{counts.with_estimate_count} of {counts.eligible_count}</span>
            </div>
            <Progress value={Math.round((counts.with_estimate_count / counts.eligible_count) * 100)} aria-label="Estimates set up"
              className="h-1.5 bg-primary/15" />
          </div>
        )}
      </div>
      {!periodReady(filter.period) ? null : !data && query.isError ? <CenterError error={query.error} onRetry={() => void query.refetch()} /> : (
        <>
          {data && query.isError && <CenterError compact error={query.error} onRetry={() => void query.refetch()} />}
          <PoliciesTable rows={data?.rows ?? null} onOpen={onOpen} pending={pending} />
          {data && data.rows.length > 0 && <Totals totals={data.totals} />}
          {data && (
            <Pager label="Policy pages" page={filter.page} pageSize={PAGE_SIZE} total={data.total_count} pending={pending}
              onPage={(page) => setParams(withParam(params, "page", String(page), "1"))} />
          )}
        </>
      )}
    </div>
  );
}
