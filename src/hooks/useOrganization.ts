import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

/**
 * useOrganization hook — reads org_id and role from JWT custom claims.
 * Falls back to profile data if JWT claims are not yet available.
 */
export const useOrganization = () => {
  const { profile, session } = useAuth();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [role, setRole] = useState<string>("Agent");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    let jwtOrgId = null;
    let jwtRole = "Agent";
    let jwtIsSuperAdmin = false;

    if (session?.access_token) {
      try {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]));
        jwtOrgId = payload.org_id;
        jwtRole = payload.user_role || "Agent";
        jwtIsSuperAdmin = payload.is_super_admin === true;
      } catch {
        // JWT decode failed
      }
    }

    // Combine JWT with Profile fallback for immediate reflection of DB changes
    setOrgId(jwtOrgId || (profile as any)?.organization_id || null);
    setRole(jwtRole !== "Agent" ? jwtRole : ((profile as any)?.role || "Agent"));
    setIsSuperAdmin(jwtIsSuperAdmin || (profile as any)?.is_super_admin === true);
  }, [session, profile]);

  return {
    organizationId: orgId,
    teamId: (profile as any)?.team_id as string | null ?? null,
    role,
    isSuperAdmin,
  };
};
