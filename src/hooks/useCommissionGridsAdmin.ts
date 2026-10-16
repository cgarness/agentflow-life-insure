import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { commissionCalculatorKeys } from "@/hooks/useCommissionCalculator";
import {
  createPrivateGrid,
  deletePrivateGrid,
  disableSharedGrid,
  enableSharedGrid,
  fetchAdminOverview,
  fetchGridSnapshot,
  fetchSharedGridCatalog,
  saveGridChanges,
  selectCalculatorGrid,
} from "@/lib/commission/adminApi";
import type { CreateGridMode, GridChangeSet } from "@/lib/commission/adminTypes";

export const COMMISSION_GRIDS_SECTION = "commission-grids";

/**
 * Agency-admin gate for Settings › Commission Grids. Not a "View As" surface (no query under it). The
 * server re-checks agency-admin authority and the caller's own organization on every read and write.
 */
export function useCommissionGridsAdminAccess() {
  const { user, profile, isImpersonating } = useAuth();
  const { hasSettingsSectionAccess, isLoading } = usePermissions();
  const organizationId = profile?.organization_id ?? null;
  const isAdmin = !isLoading && hasSettingsSectionAccess(COMMISSION_GRIDS_SECTION);
  return {
    loading: isLoading,
    isAdmin,
    enabled: isAdmin && !isImpersonating && !!user && !!organizationId,
    userId: user?.id ?? null,
    organizationId,
  };
}

export const commissionGridsAdminKeys = {
  all: (userId: string | null, organizationId: string | null) => ["commission-grids-admin", userId, organizationId] as const,
  overview: (userId: string | null, organizationId: string | null) =>
    ["commission-grids-admin", userId, organizationId, "overview"] as const,
  catalog: (userId: string | null, organizationId: string | null) =>
    ["commission-grids-admin", userId, organizationId, "catalog"] as const,
  snapshot: (userId: string | null, organizationId: string | null, gridId: string | null) =>
    ["commission-grids-admin", userId, organizationId, "snapshot", gridId] as const,
};

export function useCommissionGridsData() {
  const access = useCommissionGridsAdminAccess();
  const overview = useQuery({
    queryKey: commissionGridsAdminKeys.overview(access.userId, access.organizationId),
    queryFn: fetchAdminOverview,
    enabled: access.enabled,
  });
  const catalog = useQuery({
    queryKey: commissionGridsAdminKeys.catalog(access.userId, access.organizationId),
    queryFn: fetchSharedGridCatalog,
    enabled: access.enabled,
  });
  return { access, overview, catalog };
}

export function useGridSnapshot(gridId: string | null) {
  const access = useCommissionGridsAdminAccess();
  return useQuery({
    queryKey: commissionGridsAdminKeys.snapshot(access.userId, access.organizationId, gridId),
    queryFn: () => fetchGridSnapshot(gridId as string),
    enabled: access.enabled && !!gridId,
  });
}

/** Every write invalidates the admin views and the calculator (its grid or selection may have changed). */
export function useCommissionGridMutations() {
  const queryClient = useQueryClient();
  const { userId, organizationId } = useCommissionGridsAdminAccess();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: commissionGridsAdminKeys.all(userId, organizationId) }),
      queryClient.invalidateQueries({ queryKey: commissionCalculatorKeys.all }),
    ]);
  const options = { onSettled: refresh };
  return {
    enable: useMutation({ mutationFn: (gridId: string) => enableSharedGrid(gridId), ...options }),
    disable: useMutation({ mutationFn: (gridId: string) => disableSharedGrid(gridId), ...options }),
    select: useMutation({
      mutationFn: (args: { gridId: string | null; expectedCurrent: string | null }) =>
        selectCalculatorGrid(args.gridId, args.expectedCurrent),
      ...options,
    }),
    create: useMutation({
      mutationFn: (args: { mode: CreateGridMode; name: string; effectiveDate: string; sourceGridId?: string }) =>
        createPrivateGrid(args.mode, args.name, args.effectiveDate, args.sourceGridId),
      ...options,
    }),
    remove: useMutation({
      mutationFn: (args: { gridId: string; revision: number }) => deletePrivateGrid(args.gridId, args.revision),
      ...options,
    }),
    save: useMutation({
      mutationFn: (args: { gridId: string; revision: number; changes: GridChangeSet }) =>
        saveGridChanges(args.gridId, args.revision, args.changes),
      ...options,
    }),
  };
}
