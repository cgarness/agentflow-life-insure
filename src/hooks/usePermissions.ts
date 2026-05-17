/**
 * usePermissions — React Query hook for role-based permission checks.
 *
 * Loads the current user's permissions from the role_permissions table,
 * falls back to defaults from permissionDefaults.ts if no DB row exists
 * or if the JSONB data is malformed.
 *
 * Super Admin and Admin roles bypass all checks (full access).
 * Do NOT consume this hook in components yet — BUILD 3 wires it up.
 */

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  type RolePermissions,
  type RoleKey,
  type DataScope,
  DB_ROLE_TO_KEY,
  DEFAULT_PAGES,
  DEFAULT_FEATURES,
  DEFAULT_DATA_ACCESS,
  DEFAULT_COMMISSION,
  DATA_SCOPE_KEY_MAP,
} from "@/config/permissionDefaults";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full RolePermissions object from defaults for the given role key. */
function buildDefaults(roleKey: RoleKey): RolePermissions {
  return {
    p: DEFAULT_PAGES,
    f: DEFAULT_FEATURES,
    d: DEFAULT_DATA_ACCESS,
    c: DEFAULT_COMMISSION,
  };
}

/**
 * Normalize raw JSONB from the DB into a safe RolePermissions object.
 * Missing or non-array keys fall back to defaults. Never throws.
 */
function normalizePermissions(
  raw: Record<string, unknown>,
  roleKey: RoleKey,
  orgId: string,
  dbRole: string
): RolePermissions {
  const defaults = buildDefaults(roleKey);
  const warn = (key: string) =>
    console.warn(
      `[usePermissions] Malformed permissions.${key} for org=${orgId} role=${dbRole}. Using defaults.`
    );

  const p = Array.isArray(raw.p) ? (raw.p as RolePermissions["p"]) : (warn("p"), defaults.p);
  const f = Array.isArray(raw.f) ? (raw.f as RolePermissions["f"]) : (warn("f"), defaults.f);
  const d = Array.isArray(raw.d) ? (raw.d as RolePermissions["d"]) : (warn("d"), defaults.d);
  const c = Array.isArray(raw.c) ? (raw.c as RolePermissions["c"]) : (warn("c"), defaults.c);

  return { p, f, d, c };
}

// ---------------------------------------------------------------------------
// Query function
// ---------------------------------------------------------------------------

async function fetchRolePermissions(
  organizationId: string,
  dbRole: string,
  roleKey: RoleKey
): Promise<RolePermissions> {
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permissions")
    .eq("organization_id", organizationId)
    .eq("role", dbRole)
    .maybeSingle();

  if (error) throw error;

  if (!data?.permissions) return buildDefaults(roleKey);

  return normalizePermissions(
    data.permissions as Record<string, unknown>,
    roleKey,
    organizationId,
    dbRole
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePermissionsReturn {
  /** Check if the current user's role can see a sidebar page. Matches by page name (e.g. "Dashboard"). */
  hasPageAccess: (pageSlug: string) => boolean;
  /** Check if the current user's role can use a specific feature. Matches by feature name (e.g. "Import Leads"). */
  hasFeatureAccess: (featureKey: string) => boolean;
  /** Get the data visibility scope for a domain area. Keys: "leads", "calls", "campaigns", "reports". */
  getDataScope: (scopeKey: "leads" | "calls" | "campaigns" | "reports") => DataScope;
  /** Check if the current user's role can see a commission metric. Matches by name (e.g. "View Own Commission Percentage"). */
  canSeeCommission: (commissionKey: string) => boolean;
  /** True while the permissions query is loading. */
  isLoading: boolean;
  /** Error from the query, if any. */
  error: Error | null;
  /** Raw permissions object for direct access by consumers. Null until loaded. */
  permissions: RolePermissions | null;
}

export function usePermissions(): UsePermissionsReturn {
  const { user, profile, isBuildingOrganization } = useAuth();

  const organizationId = profile?.organization_id ?? null;
  const dbRole = profile?.role ?? null;
  const roleKey: RoleKey | null = dbRole ? (DB_ROLE_TO_KEY[dbRole] ?? null) : null;
  const isSuperAdmin = profile?.is_super_admin === true;
  const isAdmin = dbRole === "Admin";
  const fullAccess = isSuperAdmin || isAdmin;

  const canFetchPermissions = !!user && !!organizationId && !!dbRole && !!roleKey;

  const { data, isPending, error } = useQuery<RolePermissions, Error>({
    queryKey: ["rolePermissions", organizationId, dbRole],
    queryFn: () => fetchRolePermissions(organizationId!, dbRole!, roleKey!),
    staleTime: 5 * 60 * 1000,
    enabled: canFetchPermissions,
  });

  const permissions = data ?? null;

  // isLoading is false while the query is disabled; isPending stays true until data exists.
  // Also wait for profile org/role and JWT claim stamping before denying access.
  const waitingForProfile = !!user && !canFetchPermissions;
  const isLoading = isBuildingOrganization || waitingForProfile || (canFetchPermissions && isPending);

  /** Check if the current user's role can see a sidebar page. */
  function hasPageAccess(pageSlug: string): boolean {
    if (fullAccess) return true;
    if (!permissions || !roleKey) return false;
    const page = permissions.p.find((pg) => pg.name === pageSlug);
    if (!page) return false;
    return page[roleKey as "agent" | "teamLeader"] ?? false;
  }

  /** Check if the current user's role can use a specific feature. */
  function hasFeatureAccess(featureKey: string): boolean {
    if (fullAccess) return true;
    if (!permissions || !roleKey) return false;
    for (const cat of permissions.f) {
      const feat = cat.features.find((ft) => ft.name === featureKey);
      if (feat) return feat[roleKey as "agent" | "teamLeader"] ?? false;
    }
    return false;
  }

  /** Get the data visibility scope for a domain area. */
  function getDataScope(scopeKey: "leads" | "calls" | "campaigns" | "reports"): DataScope {
    if (fullAccess) return "all";
    if (!permissions || !roleKey) return "own";
    const label = DATA_SCOPE_KEY_MAP[scopeKey];
    if (!label) return "own";
    const item = permissions.d.find((da) => da.label === label);
    if (!item) return "own";
    return item[roleKey as "agent" | "teamLeader"] ?? "own";
  }

  /** Check if the current user's role can see a commission metric. */
  function canSeeCommission(commissionKey: string): boolean {
    if (fullAccess) return true;
    if (!permissions || !roleKey) return false;
    const item = permissions.c.find((cm) => cm.name === commissionKey);
    if (!item) return false;
    return item[roleKey as "agent" | "teamLeader"] ?? false;
  }

  return {
    hasPageAccess,
    hasFeatureAccess,
    getDataScope,
    canSeeCommission,
    isLoading,
    error: error ?? null,
    permissions,
  };
}
