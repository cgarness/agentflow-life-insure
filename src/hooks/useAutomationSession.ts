import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

const sessionSchema = z.object({
  actor_id: z.string(), session_id: z.string(), target_id: z.string().nullable(),
  revision: z.number().int().positive().safe(),
});
type ServerSession = z.infer<typeof sessionSchema>;
const changeKey = "agentflow.automation.session-change";

// The unverified claim is only a cache key. The database authenticates the caller and checks auth.sessions.
function sessionKey(token: string | undefined) {
  if (!token) return undefined;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.session_id === "string" ? payload.session_id : token;
  } catch {
    return token;
  }
}

export function useAutomationSession(actor: string | null, accessToken: string | undefined, watchMode = false) {
  const token = sessionKey(accessToken);
  const [context, setContext] = useState<ServerSession | null>(null);
  const [legacy, setLegacy] = useState(false);
  const legacyToken = useRef<string | undefined>(undefined);
  const installed = useRef(false);
  const latest = useRef<ServerSession | null>(null);
  const generation = useRef(0);
  const identity = useRef(token);
  identity.current = token;

  const accept = useCallback((value: unknown) => {
    const next = sessionSchema.parse(value);
    if (next.actor_id !== actor) throw new Error("The signed-in account changed.");
    if (latest.current?.session_id === next.session_id && latest.current.revision > next.revision) return false;
    installed.current = true;
    legacyToken.current = undefined;
    latest.current = next;
    setContext(next);
    setLegacy(false);
    return true;
  }, [actor]);

  const refresh = useCallback(async () => {
    if (!actor || !token) return;
    const current = ++generation.current;
    try {
      const { data, error } = await supabase.rpc("automation_session_context");
      if (generation.current !== current || identity.current !== token) return;
      if (error) {
        // An application running before the isolated migration retains the original CRM View As.
        if (error.code === "PGRST202" && !installed.current) {
          legacyToken.current = token;
          setLegacy(true);
          latest.current = null;
          setContext(null);
          return;
        }
        throw error;
      }
      accept(data);
    } catch {
      if (generation.current === current && identity.current === token) {
        legacyToken.current = undefined;
        latest.current = null;
        setContext(null);
        setLegacy(false);
      }
    }
  }, [actor, token, accept]);

  useEffect(() => {
    setContext(null);
    setLegacy(false);
    legacyToken.current = undefined;
    latest.current = null;
    void refresh();
    const changed = (event: StorageEvent) => {
      if (event.key === changeKey) void refresh();
    };
    const focused = () => { void refresh(); };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", focused);
    return () => {
      generation.current++;
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", focused);
    };
  }, [refresh]);

  // Direct API mode transitions and another browser sharing a session may produce no storage event.
  useEffect(() => {
    if (!watchMode || !token) return;
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => window.clearInterval(interval);
  }, [watchMode, token, refresh]);

  const transition = useCallback(async (targetId: string | null) => {
    if (!actor || !token || identity.current !== token) return false;
    if (!latest.current && legacyToken.current !== token) await refresh();
    if (identity.current !== token) return false;
    if (legacyToken.current === token) return true;
    const current = latest.current;
    if (!current || current.actor_id !== actor || identity.current !== token) return false;
    try {
      const { data, error } = await supabase.rpc("automation_session_transition", {
        p_expected_revision: current.revision, p_target_id: targetId,
      });
      if (error) throw error;
      try { window.localStorage.setItem(changeKey, crypto.randomUUID()); } catch { /* focus refresh remains available */ }
      if (identity.current !== token) return false;
      return accept(data);
    } catch {
      await refresh();
      return false;
    }
  }, [actor, token, accept, refresh]);

  return { context, legacy, transition };
}
