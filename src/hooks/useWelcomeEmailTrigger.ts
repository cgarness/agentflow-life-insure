import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Fire-and-forget trigger for the one-time welcome email.
 *
 * Once an authenticated session has a confirmed email, this invokes the
 * send-welcome-email edge function exactly once per tab session (guarded via
 * sessionStorage, set BEFORE invoking so a failure is never retried in the
 * same tab). The edge function is idempotent server-side, so duplicate
 * invocations across tabs are harmless. Completely silent: it never throws,
 * never blocks, and never affects rendering.
 */
export function useWelcomeEmailTrigger(): void {
  const { user } = useAuth();
  const userId = user?.id;
  const emailConfirmed = Boolean(user?.email_confirmed_at);

  useEffect(() => {
    if (!userId || !emailConfirmed) return;

    const key = `af-welcome-requested:${userId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, new Date().toISOString());
    } catch {
      // sessionStorage unavailable — skip rather than risk repeated invokes.
      return;
    }

    supabase.functions.invoke("send-welcome-email", { body: {} }).catch(() => {});
  }, [userId, emailConfirmed]);
}
