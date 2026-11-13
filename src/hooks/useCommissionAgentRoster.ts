import { useQuery } from "@tanstack/react-query";
import { commissionCenterApi } from "@/lib/commission/centerApi";
import { canonicalScopeKey, type CommissionAgentScope } from "@/lib/commission/centerScope";
import { useCommissionsAccess } from "./useCommissionsCenter";

/** A roster page is discovery only. All/Selected authority is resolved independently by every server read. */
export function useCommissionAgentRoster(scope: CommissionAgentScope | null, options: { enabled?: boolean; search?: string; page?: number; revision?: string } = {}) {
  const access = useCommissionsAccess();
  const search = options.search ?? "";
  const page = options.page ?? 0;
  const queryKey = ["policy-commissions", "center", access.userId, access.orgId, "agent-roster", access.authorityKey,
    scope ? canonicalScopeKey(scope) : "default", search, page, options.revision ?? "admission"];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => commissionCenterApi.agents(scope, search, page, signal),
    enabled: access.enabled && options.enabled !== false,
    staleTime: 0, retry: false, refetchOnWindowFocus: "always", refetchOnReconnect: "always",
  });
  return { ...query, rosterKey: queryKey };
}
