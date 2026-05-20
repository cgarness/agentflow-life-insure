import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

/**
 * useOrganization — org and agency role from JWT custom claims, with profile fallback.
 *
 * Claim sources (in priority order):
 * - Auth hook: org_id, user_role, is_super_admin (top-level JWT)
 * - Profile trigger: app_metadata.organization_id, app_metadata.role
 * - profiles row when claims are missing or stale
 *
 * Top-level JWT `role` is Supabase's auth role ("authenticated") — never use it as agency role.
 */

const SUPABASE_AUTH_ROLES = new Set(["authenticated", "anon"]);

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(accessToken.split(".")[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function appMetadata(payload: Record<string, unknown> | null): Record<string, unknown> | undefined {
  const meta = payload?.app_metadata;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : undefined;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const raw of values) {
    if (raw == null || raw === "") continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return null;
}

function resolveAgencyRole(payload: Record<string, unknown> | null, profileRole: string | undefined): string {
  const meta = appMetadata(payload);
  const candidates = [payload?.user_role, meta?.role, profileRole];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const r = raw.trim();
    if (!r || SUPABASE_AUTH_ROLES.has(r.toLowerCase())) continue;
    return r;
  }
  return "Agent";
}

function resolveOrgId(
  payload: Record<string, unknown> | null,
  profileOrgId: string | null | undefined,
): string | null {
  const meta = appMetadata(payload);
  return firstNonEmptyString(payload?.org_id, meta?.organization_id, payload?.organization_id, profileOrgId);
}

function resolveSuperAdmin(payload: Record<string, unknown> | null, profileFlag: boolean | undefined): boolean {
  if (profileFlag === true) return true;
  if (payload?.is_super_admin === true) return true;
  return appMetadata(payload)?.is_super_admin === true;
}

export const useOrganization = () => {
  const { profile, session, isImpersonating } = useAuth();

  const { orgId, role, isSuperAdmin } = useMemo(() => {
    if (isImpersonating && profile) {
      return {
        orgId: profile.organization_id,
        role: profile.role,
        isSuperAdmin: profile.is_super_admin === true,
      };
    }

    const payload = session?.access_token ? decodeJwtPayload(session.access_token) : null;
    const profileOrgId = profile?.organization_id ?? null;
    const profileRole = profile?.role;

    return {
      orgId: resolveOrgId(payload, profileOrgId),
      role: resolveAgencyRole(payload, profileRole),
      isSuperAdmin: resolveSuperAdmin(payload, profile?.is_super_admin),
    };
  }, [session, profile, isImpersonating]);

  return {
    organizationId: orgId,
    teamId: profile?.team_id ?? null,
    role,
    isSuperAdmin: isSuperAdmin || isImpersonating,
  };
};
