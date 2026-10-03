import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Draft, Overview, Session } from "./types";
export function useA2pRegistration(actor: string, org: string) {
  const [data, setData] = useState<Overview | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const generation = useRef(0), inFlight = useRef(false);
  const invoke = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (inFlight.current) return null;
    const current = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data: result, error: callError } = await supabase.functions.invoke("a2p-registration", {
        body: { action, actor_id: actor, organization_id: org, ...extra },
      });
      if (current !== generation.current) return null;
      if (callError) {
        let message = "A2P Registration could not be reached. Retry or ask your administrator to finish setup.";
        try {
          const body = await callError.context?.json();
          if (typeof body?.error === "string") message = body.error;
        } catch { /* retain safe message */ }
        throw new Error(message);
      }
      if (result?.error) throw new Error(result.error);
      if (!result || typeof result !== "object") throw new Error("Registration response was incomplete.");
      if (action.startsWith("open_")) setSession(result as Session);
      else setData(result as Overview);
      return result;
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "Could not complete this action.");
      return null;
    } finally {
      if (current === generation.current) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }, [actor, org]);
  useEffect(() => {
    const mountedGeneration = generation.current;
    void invoke("overview");
    return () => {
      generation.current = mountedGeneration + 1;
      inFlight.current = false;
    };
  }, [invoke]);
  useEffect(() => {
    if (session) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void invoke("overview");
    }, 60000);
    return () => window.clearInterval(timer);
  }, [invoke, session]);
  const refresh = useCallback(() => invoke("refresh"), [invoke]);
  const save = useCallback((draft: Draft, version: number | null) => invoke("save_draft", { draft, version }), [
    invoke,
  ]);
  const close = useCallback(() => {
    setSession(null);
    void invoke("refresh");
  }, [invoke]);
  return {
    data,
    session,
    busy,
    error,
    refresh,
    save,
    close,
    retry: () => invoke("overview"),
    open: (stage: "brand" | "campaign") =>
      invoke(`open_${stage}`, { accept_fees: true, fee_version: data?.fee_version }),
    attach: (phone_number_id: string) => invoke("attach_number", { phone_number_id }),
  };
}
