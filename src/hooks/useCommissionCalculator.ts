import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { fetchCalculatorContext, fetchCalculatorStatus } from "@/lib/commission/api";

/** The existing screen-level permission the calculator respects (decision D3). */
export const CALCULATOR_PERMISSION = "View Own Commission Percentage";

/**
 * Query keys are scoped to the REAL session user and organization: both RPCs resolve the caller from the
 * session on the server, so a different user or organization is a different key and an older response
 * can never be shown for a newer identity. Admin changes invalidate the whole prefix.
 */
export const commissionCalculatorKeys = {
  all: ["commission-calculator"] as const,
  status: (userId: string | null, organizationId: string | null) =>
    ["commission-calculator", "status", userId, organizationId] as const,
  context: (userId: string | null, organizationId: string | null) =>
    ["commission-calculator", "context", userId, organizationId] as const,
};

/**
 * Shared gate for the navigation item, the route and the page. Never runs under "View As" (the RPCs
 * answer for the real session user, so they would show the operator's data under the viewed name);
 * `options.enabled` is the caller's own query-level gate (the sidebar passes `!isImpersonating`).
 */
export function useCommissionCalculatorAccess(options?: { enabled?: boolean }) {
  const { user, profile, isImpersonating } = useAuth();
  const { canSeeCommission, isLoading: permissionsLoading } = usePermissions();
  const organizationId = profile?.organization_id ?? null;
  const permitted = !permissionsLoading && canSeeCommission(CALCULATOR_PERMISSION);
  const enabled = options?.enabled !== false && !isImpersonating && !!user && !!organizationId && permitted;

  const status = useQuery({
    queryKey: commissionCalculatorKeys.status(user?.id ?? null, organizationId),
    queryFn: ({ signal }) => fetchCalculatorStatus(signal),
    enabled,
    staleTime: 60_000,
  });

  return {
    permitted,
    permissionsLoading,
    isImpersonating,
    enabled,
    status,
    /** True only for an ACTIVE, eligible, selected grid. */
    visible: enabled && status.data?.status === "ready",
  };
}

/** The one-snapshot calculator read (grid, active products, variants, rates, the caller's own level). */
export function useCommissionCalculatorContext(enabled: boolean) {
  const { user, profile, isImpersonating } = useAuth();
  const organizationId = profile?.organization_id ?? null;
  return useQuery({
    queryKey: commissionCalculatorKeys.context(user?.id ?? null, organizationId),
    queryFn: ({ signal }) => fetchCalculatorContext(signal),
    enabled: enabled && !isImpersonating && !!user && !!organizationId,
    staleTime: 60_000,
  });
}
