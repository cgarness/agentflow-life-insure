import { useEffect, useLayoutEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { pendingSmsStore } from "@/lib/sms-send/pendingSmsStore";

/**
 * Binds the REAL signed-in identity to the memory-only pending-SMS store, once for the whole app,
 * so sign-out, a user change and View As take effect even when no SMS surface is mounted.
 *
 * The auth subscription runs the store's cleanup synchronously with Supabase's event, before React
 * re-renders; the layout effect then binds the identity AuthContext resolved. Renders nothing.
 */
export function PendingSmsAuthorityBridge() {
  const { user, realProfile, profile, isImpersonating } = useAuth();
  const impersonating = isImpersonating === true;
  const realUserId = user?.id ?? null;
  const real = realProfile ?? (impersonating ? null : profile);
  // A profile that belongs to anyone but the session user grants nothing.
  const organizationId = real && real.id === realUserId ? real.organization_id ?? null : null;

  useLayoutEffect(() => {
    pendingSmsStore.bindAuthority({ realUserId, organizationId, impersonating });
  }, [realUserId, organizationId, impersonating]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      pendingSmsStore.handleAuthEvent(event, session?.user?.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}
