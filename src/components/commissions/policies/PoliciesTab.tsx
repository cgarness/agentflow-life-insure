import { useSearchParams } from "react-router-dom";
import { Progress } from "@/components/ui/progress";
import { useCommissionPolicies } from "@/hooks/useCommissionsCenter";
import { PAGE_SIZE, SETUP_FILTERS, SETUP_LABELS, parsePolicies, withParam } from "@/lib/commission/centerFilters";
import type { OpenPolicy } from "../CommissionDrawer";
import { FilterSelect, InfoTip, Pager } from "../shared/Bits";
import { CenterError } from "../shared/CenterState";
import { useCarrierOptions } from "../shared/useCarrierOptions";
import { PoliciesTable } from "./PoliciesTable";

const ALL = "__all__";

/** Policies: every policy credited to the seller, with its estimate, payments and setup state. */
export function PoliciesTab({ onOpen }: { onOpen: OpenPolicy }) {
  const [params, setParams] = useSearchParams();
  const filter = parsePolicies(params);
  const query = useCommissionPolicies(filter);
  const data = query.data;
  const pending = query.isPlaceholderData;
  const counts = data?.counts;
  const carriers = useCarrierOptions(data?.carriers, filter.carrier);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect label="Show" value={filter.setup} className="w-48" options={SETUP_FILTERS.map((s) => [s, SETUP_LABELS[s]] as const)}
            onChange={(setup) => setParams(withParam(params, "setup", setup, "all"))} />
          <FilterSelect<string> label="Carrier" value={filter.carrier ?? ALL} className="w-44"
            options={[[ALL, "All carriers"], ...carriers.map((c) => [c, c] as const)]}
            onChange={(c) => setParams(withParam(params, "carrier", c === ALL ? null : c))} />
        </div>
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
      {!data && query.isError ? <CenterError error={query.error} onRetry={() => void query.refetch()} /> : (
        <>
          {data && query.isError && <CenterError compact error={query.error} onRetry={() => void query.refetch()} />}
          <PoliciesTable rows={data?.rows ?? null} onOpen={onOpen} pending={pending} />
          {data && (
            <Pager label="Policy pages" page={filter.page} pageSize={PAGE_SIZE} total={data.total_count} pending={pending}
              onPage={(page) => setParams(withParam(params, "page", String(page), "1"))} />
          )}
        </>
      )}
    </div>
  );
}
