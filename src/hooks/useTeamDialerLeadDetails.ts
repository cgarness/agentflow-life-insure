import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TeamOpenMasterStatus } from "@/hooks/useTeamOpenMasterLead";

type Row = Record<string, unknown>;
interface Args {
  enabled: boolean;
  organizationId: string | null;
  viewerId: string | null;
  campaignId: string | null;
  campaignLeadId: string | null;
  leadId: string | null;
  /** Current Team membership; changing it invalidates a visit even if IDs remain the same. */
  membershipKey: string;
}
interface Visit {
  organizationId: string;
  viewerId: string;
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  membershipKey: string;
}
interface State {
  visit: Visit | null;
  status: TeamOpenMasterStatus;
  details: Row | null;
}
const empty = (visit: Visit | null): State => ({ visit, status: visit ? "loading" : "unavailable", details: null });

/** A display DTO only. Never adopt it into useTeamOpenMasterLead, an edit draft or Sold/Convert. */
export function useTeamDialerLeadDetails({ enabled, organizationId, viewerId, campaignId, campaignLeadId, leadId, membershipKey }: Args) {
  const visit = useMemo<Visit | null>(() =>
    enabled && organizationId && viewerId && campaignId && campaignLeadId && leadId
      ? { organizationId, viewerId, campaignId, campaignLeadId, leadId, membershipKey } : null,
  [enabled, organizationId, viewerId, campaignId, campaignLeadId, leadId, membershipKey]);
  const active = useRef(visit);
  const generation = useRef(0);
  const [state, setState] = useState<State>(() => empty(visit));
  const view = state.visit === visit ? state : empty(visit); // first-render mask

  useLayoutEffect(() => {
    active.current = visit;
    return () => { active.current = null; generation.current += 1; };
  }, [visit]);

  const read = useCallback(async (ctx: Visit | null) => {
    if (!ctx || active.current !== ctx) return; // stale start
    const request = ++generation.current;
    setState(empty(ctx));
    let next: State;
    try {
      // Narrow cast: new RPC is absent from the existing generated schema types.
      const { data, error } = await (supabase as unknown as {
        rpc(name: "get_team_dialer_lead_details", args: { p_campaign_lead_id: string }):
          PromiseLike<{ data: unknown; error: unknown }>;
      }).rpc("get_team_dialer_lead_details", { p_campaign_lead_id: ctx.campaignLeadId });
      const row = data && typeof data === "object" && !Array.isArray(data) ? data as Row : null;
      const matches = row?.id === ctx.leadId && row?.campaign_lead_id === ctx.campaignLeadId &&
        row?.campaign_id === ctx.campaignId && row?.organization_id === ctx.organizationId;
      next = error ? { visit: ctx, status: "error", details: null }
        : data === null ? { visit: ctx, status: "unavailable", details: null }
          : matches ? { visit: ctx, status: "loaded", details: row }
            : { visit: ctx, status: "error", details: null };
    } catch {
      next = { visit: ctx, status: "error", details: null };
    }
    if (active.current !== ctx || generation.current !== request) return; // stale finish
    setState(next);
  }, []);
  useEffect(() => { void read(visit); }, [visit, read]); // one bounded read per visit; no polling
  const retry = useCallback(() => read(visit), [read, visit]);
  return { status: view.status, details: view.details, retry };
}
