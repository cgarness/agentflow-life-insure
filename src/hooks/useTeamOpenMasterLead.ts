import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useTeamOpenMasterLead — the master `leads` row a Team / Open Pool viewer is ALREADY authorized
 * to read, kept separate from the dialer queue row so the calling path is never touched.
 *
 * Existing authorization only (Option F): no RPC, no widened read. Sources, in order:
 *   1. the loader's RLS-governed `lead:leads(*)` embed (`currentLead.master_lead`) — no extra query;
 *   2. ONE event-driven re-read after this agent's hard claim lands (`claim_lead` sets
 *      `assigned_agent_id`, the sync trigger sets `user_id`, and today's RLS then admits the row);
 *   3. the row returned by a confirmed save (`adopt`).
 *
 * "unavailable" (RLS returned no row) and "error" (the read failed) are explicit states — a failed
 * or empty read is never presented as a contact with empty fields. Every async result is dropped
 * unless the lead identity it was requested for is still the one on screen.
 */
export type TeamOpenMasterStatus = "loaded" | "unavailable" | "loading" | "error";

export const TEAM_OPEN_MASTER_COLUMNS =
  "id, organization_id, first_name, last_name, phone, email, state, status, lead_source, age, date_of_birth, best_time_to_call, spouse_info, notes, assigned_agent_id, user_id, custom_fields, updated_at";

interface Args {
  enabled: boolean;
  /** `campaign_leads.id` — queue / lock identity. */
  campaignLeadId: string | null;
  /** `leads.id` — master contact identity. */
  leadId: string | null;
  organizationId: string | null;
  /** The loader's embedded master row; null / undefined when RLS hid it or the read failed. */
  embedded: Record<string, unknown> | null | undefined;
  /** True once this agent's hard claim for `leadId` succeeded. */
  claimed: boolean;
}

export function useTeamOpenMasterLead({ enabled, campaignLeadId, leadId, organizationId, embedded, claimed }: Args) {
  const key = enabled && campaignLeadId && leadId ? `${campaignLeadId}:${leadId}` : null;
  const [state, setState] = useState<{ key: string | null; status: TeamOpenMasterStatus; master: Record<string, unknown> | null }>(
    { key: null, status: "unavailable", master: null },
  );
  const keyRef = useRef<string | null>(key);
  keyRef.current = key;
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;

  // Identity change: adopt the embed (already authorized) or start as unavailable. Never carry a
  // previous lead's row across.
  useEffect(() => {
    const e = embeddedRef.current;
    const ok = !!e && typeof e === "object" && (e as { id?: unknown }).id === leadId;
    setState({ key, status: key && ok ? "loaded" : "unavailable", master: key && ok ? (e as Record<string, unknown>) : null });
  }, [key, leadId]);

  const fetchMaster = useCallback(async () => {
    const requestedKey = keyRef.current;
    if (!requestedKey || !leadId || !organizationId) return;
    setState((s) => (s.key === requestedKey ? { ...s, status: "loading" } : s));
    try {
      const { data, error } = await supabase
        .from("leads")
        .select(TEAM_OPEN_MASTER_COLUMNS)
        .eq("id", leadId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (keyRef.current !== requestedKey) return; // lead changed while in flight
      if (error) {
        setState({ key: requestedKey, status: "error", master: null });
        return;
      }
      setState({
        key: requestedKey,
        status: data ? "loaded" : "unavailable",
        master: (data as Record<string, unknown> | null) ?? null,
      });
    } catch {
      if (keyRef.current === requestedKey) setState({ key: requestedKey, status: "error", master: null });
    }
  }, [leadId, organizationId]);

  // One re-read when this agent's hard claim lands and the row was not readable before.
  const current = state.key === key ? state : null;
  const needsClaimRead = !!key && claimed && current?.status === "unavailable";
  useEffect(() => {
    if (needsClaimRead) void fetchMaster();
  }, [needsClaimRead, fetchMaster]);

  /** Adopt the row a confirmed save returned — only for the identity it was saved against. */
  const adopt = useCallback((savedKey: string, row: Record<string, unknown>) => {
    if (keyRef.current !== savedKey) return;
    setState({ key: savedKey, status: "loaded", master: row });
  }, []);

  return {
    key,
    status: (current?.status ?? "unavailable") as TeamOpenMasterStatus,
    master: current?.master ?? null,
    retry: fetchMaster,
    adopt,
  };
}
