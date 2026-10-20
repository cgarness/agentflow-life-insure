import { useQuery, type Query } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { usePermissions } from "@/hooks/usePermissions";
import { CALCULATOR_PERMISSION } from "@/hooks/useCommissionCalculator";
import { commissionCenterApi } from "@/lib/commission/centerApi";
import { periodReady, type CommissionPeriod, type HistoryFilter, type PoliciesFilter, type ScheduledFilter } from "@/lib/commission/centerFilters";

/**
 * Commissions center access and reads. The page, its navigation item and every read require the existing "View Own
 * Commission Percentage" toggle (the same one the server enforces); nothing is requested under "View As" (the server
 * would answer for the real user). Keys sit under the ["policy-commissions"] prefix, so every tracking write
 * (useTrackingMutation → useRefreshPolicyCommissions) refreshes the center, the drawer and the contact view together.
 * They include the signed-in user, organization and every filter, so an earlier identity's or filter's result is never
 * shown for a newer one.
 */
export function useCommissionsAccess() {
  const { user, isImpersonating } = useAuth();
  const { viewer } = useEffectiveViewer();
  const { canSeeCommission, isLoading: permissionsLoading } = usePermissions();
  const userId = user?.id ?? null;
  const orgId = viewer?.organizationId ?? null;
  const permitted = !permissionsLoading && canSeeCommission(CALCULATOR_PERMISSION);
  const enabled = permitted && !isImpersonating && !viewer?.isImpersonating && !!userId && !!orgId && viewer?.viewerId === userId;
  return { userId, orgId, permitted, permissionsLoading, isImpersonating, enabled };
}

export const commissionCenterKeys = {
  all: ["policy-commissions", "center"] as const,
  overview: (u: string | null, o: string | null, p: CommissionPeriod) => ["policy-commissions", "center", u, o, "overview", p] as const,
  scheduled: (u: string | null, o: string | null, f: ScheduledFilter) => ["policy-commissions", "center", u, o, "scheduled", f] as const,
  history: (u: string | null, o: string | null, f: HistoryFilter) => ["policy-commissions", "center", u, o, "history", f] as const,
  policies: (u: string | null, o: string | null, f: PoliciesFilter) => ["policy-commissions", "center", u, o, "policies", f] as const,
  policy: (u: string | null, o: string | null, id: string | null) => ["policy-commissions", "center", u, o, "policy", id] as const,
};

const common = { staleTime: 15_000, retry: false } as const;

/** Keeps the previous page on screen while the next loads, but only for the same signed-in user and organization. */
function previousPageFor<T>(userId: string | null, orgId: string | null) {
  return (previous: T | undefined, query: Query<T, Error, T, readonly unknown[]> | undefined) =>
    query && query.queryKey[2] === userId && query.queryKey[3] === orgId ? previous : undefined;
}

export function useCommissionOverview(period: CommissionPeriod) {
  const a = useCommissionsAccess();
  return useQuery({
    queryKey: commissionCenterKeys.overview(a.userId, a.orgId, period),
    queryFn: ({ signal }) => commissionCenterApi.overview(period, signal),
    enabled: a.enabled && periodReady(period),
    ...common,
  });
}

export function useScheduledPayments(filter: ScheduledFilter) {
  const a = useCommissionsAccess();
  return useQuery({
    queryKey: commissionCenterKeys.scheduled(a.userId, a.orgId, filter),
    queryFn: ({ signal }) => commissionCenterApi.scheduled(filter, signal),
    enabled: a.enabled && periodReady(filter.period),
    placeholderData: previousPageFor(a.userId, a.orgId),
    ...common,
  });
}

export function usePaymentHistory(filter: HistoryFilter) {
  const a = useCommissionsAccess();
  return useQuery({
    queryKey: commissionCenterKeys.history(a.userId, a.orgId, filter),
    queryFn: ({ signal }) => commissionCenterApi.history(filter, signal),
    enabled: a.enabled && periodReady(filter.period),
    placeholderData: previousPageFor(a.userId, a.orgId),
    ...common,
  });
}

export function useCommissionPolicies(filter: PoliciesFilter) {
  const a = useCommissionsAccess();
  return useQuery({
    queryKey: commissionCenterKeys.policies(a.userId, a.orgId, filter),
    queryFn: ({ signal }) => commissionCenterApi.policies(filter, signal),
    enabled: a.enabled,
    placeholderData: previousPageFor(a.userId, a.orgId),
    ...common,
  });
}

/** The drawer's policy, re-read whenever it opens (tracking writes also refresh it). */
export function useCommissionPolicy(policyId: string | null) {
  const a = useCommissionsAccess();
  return useQuery({
    queryKey: commissionCenterKeys.policy(a.userId, a.orgId, policyId),
    queryFn: ({ signal }) => commissionCenterApi.policy(policyId!, signal),
    enabled: a.enabled && !!policyId,
    ...common,
    staleTime: 0,
  });
}
