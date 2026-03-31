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
    if (session?.access_token) {
      try {
        // Decode the JWT payload (the middle segment)
        const payload = JSON.parse(atob(session.access_token.split('.')[1]));
        if (payload.org_id) {
          setOrgId(payload.org_id);
          setRole(payload.user_role || "Agent");
          setIsSuperAdmin(payload.is_super_admin === true);
          return;
        }
      } catch {
        // JWT decode failed — fall through to profile-based lookup
      }
    }

    // Fallback: read from profile (pre-migration compatibility)
    if (profile) {
      setOrgId((profile as any)?.organization_id ?? null);
      setRole((profile as any)?.role ?? "Agent");
      setIsSuperAdmin((profile as any)?.is_super_admin === true);
    }
  }, [session, profile]);

  return {
    organizationId: orgId,
    teamId: (profile as any)?.team_id as string | null ?? null,
    role,
    isSuperAdmin,
  };
};
