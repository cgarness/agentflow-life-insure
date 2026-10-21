import { hashKey, useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { usePermissions } from "@/hooks/usePermissions";
import { CALCULATOR_PERMISSION } from "@/hooks/useCommissionCalculator";
import { commissionCenterApi } from "@/lib/commission/centerApi";
import {
  effectiveScheduled, periodReady, scheduledReady, type CommissionPeriod, type HistoryFilter, type PoliciesFilter, type ScheduledFilter,
} from "@/lib/commission/centerFilters";

/**
 * Commissions center access and reads. The page, its navigation item and every read require the existing "View Own
 * Commission Percentage" toggle (the same one the server enforces); nothing is requested under "View As" (the server
 * would answer for the real user). Keys sit under the ["policy-commissions"] prefix, so every tracking write
 * (useTrackingMutation → useRefreshPolicyCommissions) refreshes the center, the drawer and the contact view together.
 * They include the signed-in user, organization and every effective filter, so an earlier identity's or filter's result
 * is never shown for a newer one.
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
  breakdown: (u: string | null, o: string | null, p: CommissionPeriod) => ["policy-commissions", "center", u, o, "breakdown", p] as const,
  goal: (u: string | null, o: string | null, month: string | null) => ["policy-commissions", "center", u, o, "goal", month] as const,
};

const common = { staleTime: 15_000, retry: false } as const;

/** Everything that identifies a list's result except its page. */
const listIdentity = (key: readonly unknown[]) => hashKey([key[2], key[3], key[4], { ...(key[5] as object), page: 0 }]);

/**
 * Keeps the shown page on screen (as placeholder data, marked by `isPlaceholderData`) only while ANOTHER PAGE of the same
 * effective filter loads for the same user and organization. A changed filter or identity gets no placeholder: the list
 * shows its loading state until its own rows arrive, and a failed request shows the error.
 */
function previousPageFor<T>(key: readonly unknown[]) {
  const identity = listIdentity(key);
  return (previous: T | undefined, query: Query<T, Error, T, readonly unknown[]> | undefined) =>
    query && listIdentity(query.queryKey) === identity ? previous : undefined;
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
  const effective = effectiveScheduled(filter);
  const queryKey = commissionCenterKeys.scheduled(a.userId, a.orgId, effective);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => commissionCenterApi.scheduled(effective, signal),
    enabled: a.enabled && scheduledReady(effective),
    placeholderData: previousPageFor(queryKey),
    ...common,
  });
}

export function usePaymentHistory(filter: HistoryFilter) {
  const a = useCommissionsAccess();
  const queryKey = commissionCenterKeys.history(a.userId, a.orgId, filter);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => commissionCenterApi.history(filter, signal),
    enabled: a.enabled && periodReady(filter.period),
    placeholderData: previousPageFor(queryKey),
    ...common,
  });
}

export function useCommissionPolicies(filter: PoliciesFilter) {
  const a = useCommissionsAccess();
  const queryKey = commissionCenterKeys.policies(a.userId, a.orgId, filter);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => commissionCenterApi.policies(filter, signal),
    enabled: a.enabled && periodReady(filter.period),
    placeholderData: previousPageFor(queryKey),
    ...common,
  });
}

/** Carrier and product breakdowns, comparison and Months 10–12 for the Overview's period (one server snapshot). */
export function useCommissionBreakdown(period: CommissionPeriod) {
  const a = useCommissionsAccess();
  return useQuery({
    queryKey: commissionCenterKeys.breakdown(a.userId, a.orgId, period),
    queryFn: ({ signal }) => commissionCenterApi.breakdown(period, signal),
    enabled: a.enabled && periodReady(period),
    ...common,
  });
}

/** The seller's goal for one calendar month (`null`: the period is not a single whole month, so no goal is shown). */
export function useCommissionGoal(month: string | null) {
  const a = useCommissionsAccess();
  return useQuery({
    queryKey: commissionCenterKeys.goal(a.userId, a.orgId, month),
    queryFn: ({ signal }) => commissionCenterApi.goal(month!, signal),
    enabled: a.enabled && !!month,
    ...common,
  });
}

/**
 * Sets (cents) or clears (null) the signed-in seller's goal for exactly that month. Both are idempotent on the server, so
 * a retry after an unknown outcome is safe; whatever happens, the month's goal is re-read so the screen shows what is
 * saved. Refused outright when commissions are not available (e.g. under "View As").
 */
export function useCommissionGoalMutation(month: string | null) {
  const a = useCommissionsAccess();
  const queryClient = useQueryClient();
  const key = commissionCenterKeys.goal(a.userId, a.orgId, month);
  return useMutation({
    mutationFn: async (targetCents: number | null) => {
      if (!a.enabled || !month) throw new Error("Commissions aren't available.");
      if (targetCents === null) await commissionCenterApi.clearGoal(month);
      else await commissionCenterApi.setGoal(month, targetCents);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key, exact: true }),
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
