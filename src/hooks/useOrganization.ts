import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

/**
 * useOrganization hook — reads org_id and role from JWT custom claims.
 * Falls back to profile data if JWT claims are not yet available.
 */
export const useOrganization = () => {
  const { profile, session } = useAuth();

  const { orgId, role, isSuperAdmin } = useMemo(() => {
    let jwtOrgId = null;
    let jwtRole = "Agent";
    let jwtIsSuperAdmin = false;

    if (session?.access_token) {
      try {
        // Use basic base64 decoding for tokens
        const payload = JSON.parse(atob(session.access_token.split('.')[1]));
        jwtOrgId = payload.org_id;
        jwtRole = payload.user_role || "Agent";
        jwtIsSuperAdmin = payload.is_super_admin === true;
      } catch (e) {
        // JWT decode failed or malformed
      }
    }

    // Combine JWT with Profile fallback for immediate reflection of DB changes
    return {
      orgId: jwtOrgId || (profile as any)?.organization_id || null,
      role: jwtRole !== "Agent" ? jwtRole : ((profile as any)?.role || "Agent"),
      isSuperAdmin: jwtIsSuperAdmin || (profile as any)?.is_super_admin === true
    };
  }, [session, profile]);

  return {
    organizationId: orgId,
    teamId: (profile as any)?.team_id as string | null ?? null,
    role,
    isSuperAdmin,
  };
};
