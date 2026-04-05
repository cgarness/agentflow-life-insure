import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

/**
 * useOrganization hook — reads org_id and role from JWT custom claims.
 * Falls back to profile data if JWT claims are not yet available.
 */
export const useOrganization = () => {
  const { profile, session, isImpersonating } = useAuth();

  const { orgId, role, isSuperAdmin } = useMemo(() => {
    let jwtOrgId = null;
    let jwtRole = "Agent";
    let jwtIsSuperAdmin = false;

    if (session?.access_token) {
      try {
        // Use basic base64 decoding for tokens
        const payload = JSON.parse(atob(session.access_token.split('.')[1]));
        jwtOrgId = payload.organization_id;
        jwtRole = payload.role || "Agent";
        jwtIsSuperAdmin = payload.is_super_admin === true;
      } catch (e) {
        // JWT decode failed or malformed
      }
    }

    // If impersonating, prioritize profile data (which contains the impersonated user's data)
    // Otherwise combine JWT with Profile fallback
    if (isImpersonating && profile) {
      return {
        orgId: profile.organization_id,
        role: profile.role,
        isSuperAdmin: profile.is_super_admin === true
      };
    }

    return {
      orgId: jwtOrgId || (profile as any)?.organization_id || null,
      role: jwtRole !== "Agent" ? jwtRole : ((profile as any)?.role || "Agent"),
      isSuperAdmin: jwtIsSuperAdmin || (profile as any)?.is_super_admin === true
    };
  }, [session, profile, isImpersonating]);

  return {
    organizationId: orgId,
    teamId: (profile as any)?.team_id as string | null ?? null,
    role,
    isSuperAdmin: isSuperAdmin || isImpersonating, // Always treat as super admin if they are (to see everything), but role is swapped
  };
};
