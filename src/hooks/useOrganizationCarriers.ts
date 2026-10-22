import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { normalizeCarrierNames } from "@/lib/carrierSelection";

export type CarrierListStatus = "idle" | "loading" | "ready" | "error";

export interface OrganizationCarriers {
  status: CarrierListStatus;
  /** Configured names, sorted; null unless the list loaded successfully for the CURRENT user and agency. */
  carriers: string[] | null;
  retry: () => void;
}

interface Loaded {
  session: number;
  carriers: string[] | null;
}

/**
 * The signed-in user's agency carriers from Settings → Carriers (`public.carriers`, organization-scoped; RLS applies).
 * Every load is a session: a new session starts whenever the user, agency or retry attempt changes or the hook is
 * disabled (modal closed), and a result counts only for the session that requested it. So a previous open's,
 * user's or agency's list can never display or validate a save, not even for one render, and a late response
 * from a superseded request is discarded.
 */
export function useOrganizationCarriers(enabled: boolean): OrganizationCarriers {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const scope = enabled && user?.id && organizationId ? `${user.id}|${organizationId}` : null;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const request = useRef(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Adjust state while rendering (React's pattern for state derived from changing inputs): a changed key starts the
  // next session in this same render, so even a render React discards for this update never returns an older result.
  const key = scope ? `${scope}|${attempt}` : null;
  const [session, setSession] = useState({ key, id: 0 });
  let current = session;
  if (session.key !== key) {
    current = { key, id: session.id + 1 };
    setSession(current);
  }
  const sessionId = current.id;

  useEffect(() => {
    if (!scope || !organizationId) return;
    const mine = ++request.current;
    (async () => {
      let carriers: string[] | null = null;
      try {
        const { data, error } = await supabase
          .from("carriers")
          .select("name")
          .eq("organization_id", organizationId)
          .order("name", { ascending: true });
        if (error) throw error;
        carriers = normalizeCarrierNames((data ?? []).map((row) => row.name));
      } catch (e) {
        console.error("Error loading carriers:", e instanceof Error ? e.message : e);
      }
      // The request counter keeps a superseded request from overwriting the current session's result.
      if (request.current === mine) setLoaded({ session: sessionId, carriers });
    })();
    return () => { request.current += 1; };
  }, [sessionId, scope, organizationId]);

  if (!scope) return { status: "idle", carriers: null, retry };
  if (!loaded || loaded.session !== sessionId) return { status: "loading", carriers: null, retry };
  return loaded.carriers ? { status: "ready", carriers: loaded.carriers, retry } : { status: "error", carriers: null, retry };
}
