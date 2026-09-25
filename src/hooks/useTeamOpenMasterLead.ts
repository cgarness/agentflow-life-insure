import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useTeamOpenMasterLead — the master `leads` row a Team / Open Pool viewer is ALREADY authorized
 * to read, kept separate from the dialer queue row so the calling path is never touched.
 *
 * Existing authorization only (Option F): no RPC, no widened read. Sources, in order:
 *   1. the loader's RLS-governed `lead:leads(*)` embed (`currentLead.master_lead`) — no extra query;
 *   2. ONE automatic re-read per visit after this agent's hard claim lands, plus explicit Retry;
 *   3. the row returned by a confirmed save (`adopt`).
 *
 * Request safety (rev 5):
 *   - A VISIT is one `TeamOpenContext` object (organization + viewer + campaign lead + lead). A new
 *     object is created on every context change — A → B → A yields three distinct visits — and the
 *     visit is invalidated on disable and unmount.
 *   - A REQUEST GENERATION increments on every read start, `adopt()` and replacement embed.
 *   - Stale STARTS are rejected: `retry` is bound to the visit it was rendered for.
 *   - Stale FINISHES are rejected: a response applies only when its visit AND generation are still
 *     current and the row's `id` / `organization_id` match the visit.
 *   - The previous visit's row is masked in the FIRST render of a new visit (derived in render).
 * "unavailable" (RLS returned no row) and "error" are explicit states, never an empty contact.
 */
export type TeamOpenMasterStatus = "loaded" | "unavailable" | "loading" | "error";

export const TEAM_OPEN_MASTER_COLUMNS =
  "id, organization_id, first_name, last_name, phone, email, state, status, lead_source, lead_score, age, date_of_birth, best_time_to_call, spouse_info, notes, assigned_agent_id, user_id, custom_fields, last_contacted_at, created_at, updated_at";

/** One visit. Compared by object identity; never rebuilt from its fields. */
export interface TeamOpenContext {
  readonly organizationId: string;
  readonly viewerId: string;
  readonly campaignLeadId: string;
  readonly leadId: string;
}

type Row = Record<string, unknown>;
interface State {
  visit: TeamOpenContext | null;
  embed: Row | null | undefined;
  status: TeamOpenMasterStatus;
  master: Row | null;
}

interface Args {
  enabled: boolean;
  organizationId: string | null;
  viewerId: string | null;
  /** `campaign_leads.id` — queue / lock identity. */
  campaignLeadId: string | null;
  /** `leads.id` — master contact identity. */
  leadId: string | null;
  /** The loader's embedded master row; null / undefined when RLS hid it or the read failed. */
  embedded: Row | null | undefined;
  /** True once this agent's hard claim for `leadId` succeeded. */
  claimed: boolean;
}

const rowMatches = (r: Row | null | undefined, ctx: TeamOpenContext) =>
  !!r && typeof r === "object" && r.id === ctx.leadId &&
  (r.organization_id === undefined || r.organization_id === ctx.organizationId);

function fromEmbed(visit: TeamOpenContext | null, embed: Row | null | undefined): State {
  const ok = !!visit && rowMatches(embed, visit);
  return { visit, embed, status: ok ? "loaded" : "unavailable", master: ok ? (embed as Row) : null };
}

export function useTeamOpenMasterLead({ enabled, organizationId, viewerId, campaignLeadId, leadId, embedded, claimed }: Args) {
  const visit = useMemo<TeamOpenContext | null>(
    () =>
      enabled && organizationId && viewerId && campaignLeadId && leadId
        ? { organizationId, viewerId, campaignLeadId, leadId }
        : null,
    [enabled, organizationId, viewerId, campaignLeadId, leadId],
  );
  const [state, setState] = useState<State>(() => fromEmbed(visit, embedded));
  // First-render masking: a state recorded for another visit or another embed is never shown.
  const view = state.visit === visit && state.embed === embedded ? state : fromEmbed(visit, embedded);

  const visitRef = useRef<TeamOpenContext | null>(visit);
  const embeddedRef = useRef(embedded);
  const genRef = useRef(0);
  const claimLatchRef = useRef<TeamOpenContext | null>(null);

  useLayoutEffect(() => {
    visitRef.current = visit;
    embeddedRef.current = embedded;
    if (state.visit !== visit || state.embed !== embedded) {
      genRef.current += 1; // a new visit or a replacement embed supersedes every in-flight read
      setState(fromEmbed(visit, embedded));
    }
  }, [visit, embedded, state.visit, state.embed]);
  useEffect(() => () => { visitRef.current = null; }, []);

  const startRead = useCallback(async (ctx: TeamOpenContext | null) => {
    if (!ctx || visitRef.current !== ctx) return; // stale START
    const gen = ++genRef.current;
    setState((s) => ({ ...(s.visit === ctx ? s : fromEmbed(ctx, embeddedRef.current)), status: "loading" }));
    let next: Pick<State, "status" | "master">;
    try {
      const { data, error } = await supabase
        .from("leads")
        .select(TEAM_OPEN_MASTER_COLUMNS)
        .eq("id", ctx.leadId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      const r = data as Row | null;
      next = error
        ? { status: "error", master: null }
        : !r
          ? { status: "unavailable", master: null }
          : rowMatches(r, ctx) && r.organization_id === ctx.organizationId
            ? { status: "loaded", master: r }
            : { status: "error", master: null }; // wrong row: never shown
    } catch {
      next = { status: "error", master: null };
    }
    if (visitRef.current !== ctx || genRef.current !== gen) return; // stale FINISH
    setState({ visit: ctx, embed: embeddedRef.current, ...next });
  }, []);

  // At most ONE automatic read per visit after the claim; no polling.
  useEffect(() => {
    if (!visit || !claimed || view.status !== "unavailable" || claimLatchRef.current === visit) return;
    claimLatchRef.current = visit;
    void startRead(visit);
  }, [visit, claimed, view.status, startRead]);

  /** Retry bound to the visit it was rendered for — a retained old callback does nothing. */
  const retry = useCallback(() => startRead(visit), [startRead, visit]);

  /** Adopt the row a confirmed save returned — only for the visit it was saved against. */
  const adopt = useCallback((ctx: TeamOpenContext, saved: Row) => {
    if (visitRef.current !== ctx || saved?.id !== ctx.leadId) return;
    genRef.current += 1; // supersede older reads
    setState({ visit: ctx, embed: embeddedRef.current, status: "loaded", master: { ...saved, organization_id: ctx.organizationId } });
  }, []);

  /** True while `ctx` is still the live visit (for async callers such as the save session). */
  const isCurrent = useCallback((ctx: TeamOpenContext | null) => !!ctx && visitRef.current === ctx, []);

  return { context: visit, status: view.status, master: view.master, retry, adopt, isCurrent };
}
