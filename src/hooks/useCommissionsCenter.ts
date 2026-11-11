import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCommissionScope } from "@/components/commissions/commissionScopeContext";
import { commissionCenterKeys, commissionQueryIdentity, previousPageFor, guardedCommissionRead, guardedPersonalCommissionRead, hideDeniedData } from "./commissionCenterQuery";
export { commissionCenterKeys } from "./commissionCenterQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { usePermissions } from "@/hooks/usePermissions";
import { CALCULATOR_PERMISSION } from "@/hooks/useCommissionCalculator";
import { commissionCenterApi } from "@/lib/commission/centerApi";
import {
  effectiveScheduled, periodReady, scheduledReady, type CommissionPeriod, type HistoryFilter, type PoliciesFilter, type ScheduledFilter,
} from "@/lib/commission/centerFilters";

/** Navigation eligibility is Own OR permitted Team Leader/admin access. Every server request remains authoritative. */
export function useCommissionsAccess() {
  const { user, profile, isImpersonating } = useAuth();
  const { viewer } = useEffectiveViewer();
  const { canSeeCommission, isLoading: permissionsLoading } = usePermissions();
  const userId = user?.id ?? null;
  const orgId = viewer?.organizationId ?? null;
  const fullAccess = profile?.is_super_admin === true || profile?.role === "Admin";
  const ownPermitted = (fullAccess || !permissionsLoading) && canSeeCommission(CALCULATOR_PERMISSION);
  const teamPermitted = fullAccess || (!permissionsLoading && profile?.role === "Team Leader" && canSeeCommission("View Others' Commission Percentage"));
  const permitted = ownPermitted || teamPermitted;
  const enabled = permitted && !isImpersonating && !viewer?.isImpersonating && !!userId && !!orgId && viewer?.viewerId === userId;
  const authorityKey = `${profile?.role}:${profile?.is_super_admin}:${ownPermitted}:${teamPermitted}:${profile?.status}`;
  return { userId, orgId, permitted, ownPermitted, teamPermitted, authorityKey, permissionsLoading, isImpersonating: !!isImpersonating || !!viewer?.isImpersonating, enabled };
}

const common = { staleTime: 15_000, retry: false, refetchOnWindowFocus: "always", refetchOnReconnect: "always" } as const;
function useReadContext() {
  const access = useCommissionsAccess();
  const scope = useCommissionScope();
  const identity = commissionQueryIdentity(scope.scope ?? undefined, scope.revision);
  return { access, scope, identity, enabled: access.enabled && scope.ready && (scope.managed || access.ownPermitted),
    selection: scope.managed ? scope.scope ?? undefined : undefined };
}

export function useCommissionOverview(period: CommissionPeriod) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  return hideDeniedData(useQuery({
    queryKey: commissionCenterKeys.overview(a.userId, a.orgId, period, identity),
    queryFn: ({ signal }) => guardedCommissionRead(scope, () => commissionCenterApi.overview(period, signal, selection)),
    enabled: enabled && periodReady(period),
    ...common,
  }));
}

export function useScheduledPayments(filter: ScheduledFilter) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  const effective = effectiveScheduled(filter);
  const queryKey = commissionCenterKeys.scheduled(a.userId, a.orgId, effective, identity);
  return hideDeniedData(useQuery({
    queryKey,
    queryFn: ({ signal }) => guardedCommissionRead(scope, () => commissionCenterApi.scheduled(effective, signal, selection)),
    enabled: enabled && scheduledReady(effective),
    placeholderData: previousPageFor(queryKey),
    ...common,
  }));
}

export function usePaymentHistory(filter: HistoryFilter) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  const queryKey = commissionCenterKeys.history(a.userId, a.orgId, filter, identity);
  return hideDeniedData(useQuery({
    queryKey,
    queryFn: ({ signal }) => guardedCommissionRead(scope, () => commissionCenterApi.history(filter, signal, selection)),
    enabled: enabled && periodReady(filter.period),
    placeholderData: previousPageFor(queryKey),
    ...common,
  }));
}

export function useCommissionPolicies(filter: PoliciesFilter) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  const queryKey = commissionCenterKeys.policies(a.userId, a.orgId, filter, identity);
  return hideDeniedData(useQuery({
    queryKey,
    queryFn: ({ signal }) => guardedCommissionRead(scope, () => commissionCenterApi.policies(filter, signal, selection)),
    enabled: enabled && periodReady(filter.period),
    placeholderData: previousPageFor(queryKey),
    ...common,
  }));
}

/** Carrier and product breakdowns, comparison and Months 10–12 for the Overview's period (one server snapshot). */
export function useCommissionBreakdown(period: CommissionPeriod) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  return hideDeniedData(useQuery({
    queryKey: commissionCenterKeys.breakdown(a.userId, a.orgId, period, identity),
    queryFn: ({ signal }) => guardedCommissionRead(scope, () => commissionCenterApi.breakdown(period, signal, selection)),
    enabled: enabled && periodReady(period),
    ...common,
  }));
}

/** The seller's goal for one calendar month (`null`: the period is not a single whole month, so no goal is shown). */
export function useCommissionGoal(month: string | null) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  return hideDeniedData(useQuery({
    queryKey: commissionCenterKeys.goal(a.userId, a.orgId, month, identity),
    queryFn: ({ signal }) => guardedPersonalCommissionRead(scope, () => commissionCenterApi.goal(month!, signal)),
    enabled: enabled && a.ownPermitted && scope.isMe && !!month,
    ...common,
  }));
}

/**
 * Sets (cents) or clears (null) the signed-in seller's goal for exactly that month. Both are idempotent on the server, so
 * a retry after an unknown outcome is safe; whatever happens, the month's goal is re-read so the screen shows what is
 * saved. Refused outright when commissions are not available (e.g. under "View As").
 */
export function useCommissionGoalMutation(month: string | null) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  const queryClient = useQueryClient();
  const key = commissionCenterKeys.goal(a.userId, a.orgId, month, identity);
  return useMutation({
    mutationFn: async (targetCents: number | null) => {
      if (!enabled || !a.ownPermitted || !scope.isMe || !month) throw new Error("Commissions aren't available.");
      await guardedPersonalCommissionRead(scope, () => targetCents === null
        ? commissionCenterApi.clearGoal(month) : commissionCenterApi.setGoal(month, targetCents));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key, exact: true }),
  });
}

/** The drawer's policy, re-read whenever it opens (tracking writes also refresh it). */
export function useCommissionPolicy(policyId: string | null) {
  const { access: a, scope, identity, enabled, selection } = useReadContext();
  return hideDeniedData(useQuery({
    queryKey: commissionCenterKeys.policy(a.userId, a.orgId, policyId, identity),
    queryFn: ({ signal }) => guardedCommissionRead(scope, () => commissionCenterApi.policy(policyId!, signal, selection)),
    enabled: enabled && !!policyId,
    ...common,
    staleTime: 0,
  }));
}
