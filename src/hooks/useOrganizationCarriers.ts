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
  scope: string;
  attempt: number;
  carriers: string[] | null;
}

/**
 * The signed-in user's agency carriers from Settings → Carriers (`public.carriers`, organization-scoped; RLS applies).
 * Each result is tagged with the user/agency scope and attempt it was requested for: a result for any other scope
 * reads as loading, so a previous user's or agency's list can never display or validate a save, and a late
 * response from a superseded request is discarded.
 */
export function useOrganizationCarriers(enabled: boolean): OrganizationCarriers {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const scope = enabled && user?.id && organizationId ? `${user.id}|${organizationId}` : null;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const request = useRef(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!scope || !organizationId) return;
    const mine = ++request.current;
    setLoaded(null); // every open, retry or scope change reloads; an earlier result never stands in for it
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
      if (request.current === mine) setLoaded({ scope, attempt, carriers });
    })();
    return () => { request.current += 1; };
  }, [scope, organizationId, attempt]);

  if (!scope) return { status: "idle", carriers: null, retry };
  if (!loaded || loaded.scope !== scope || loaded.attempt !== attempt) return { status: "loading", carriers: null, retry };
  return loaded.carriers ? { status: "ready", carriers: loaded.carriers, retry } : { status: "error", carriers: null, retry };
}
