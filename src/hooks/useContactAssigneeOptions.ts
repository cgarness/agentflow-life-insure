/**
 * FullScreenContactView's "Assigned Agent" data (hierarchy stabilization F10, moved out of the
 * component per F12). For the open contact it reads:
 *  - the organization's Active roster, with an explicit organization filter on top of
 *    `profiles_select_org` (query scoping); no organization, no roster query;
 *  - a Team Leader's scope (self + downline) from `get_contact_scope_agents`. It is withheld under
 *    "View As", where the RPC would answer for the real operator's `auth.uid()`;
 *  - the current assignee's own row when it is not the viewer, so a name outside the Active
 *    roster still displays.
 * A failed read is an empty list (or no assignee row), never a wider one: a Team Leader whose
 * scope read fails is offered only the current assignee.
 *
 * Returns `agents` (the roster with the assignee row prepended, the display-name source),
 * `rosterLoaded` (the reads for THIS contact have finished) and `assigneeOptions`
 * (`resolveAssignableAgents` for the effective viewer).
 *
 * UX narrowing only: RLS and `private.assert_may_assign_to` are the authority. Stale-response
 * safe: a load that finishes after the inputs changed is ignored, and a scope change
 * (organization or effective viewer) drops the previous scope's lists on the same render.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { effectiveViewerKey, isEffectiveSuperAdmin, type EffectiveViewer } from "@/lib/effectiveViewer";
import { resolveAssignableAgents, type AssignableAgent } from "@/lib/contacts/resolveAssignableAgents";

export const CONTACT_ROSTER_COLUMNS = "id, first_name, last_name, status";

export interface ContactAssigneeRoster {
  /** The organization's Active profiles. */
  roster: AssignableAgent[];
  /** A Team Leader's scope from `get_contact_scope_agents` ([] when not read or on error). */
  team: AssignableAgent[];
  /** The looked-up assignee row, or null. */
  assignee: AssignableAgent | null;
}

type NameRow = { id?: string | null; first_name?: string | null; last_name?: string | null };

const toAgent = (row: NameRow): AssignableAgent =>
  ({ id: row.id as string, firstName: row.first_name || "", lastName: row.last_name || "" });
const toAgents = (rows: unknown): AssignableAgent[] =>
  ((rows ?? []) as NameRow[]).filter((row) => !!row?.id).map(toAgent);

const NO_ROWS = { data: null, error: null };
const EMPTY: AssignableAgent[] = [];

/**
 * The picker's reads, in parallel. Never rejects: each failed read is logged and becomes an
 * empty list (roster, team) or no row (assignee), so the options narrow rather than widen.
 */
export async function loadContactAssigneeRoster(params: {
  organizationId: string | null | undefined;
  /** The profile whose name to look up (the current assignee when it is not the viewer). */
  assigneeId: string | null | undefined;
  /** Read `get_contact_scope_agents`: a non-impersonating Team Leader only. */
  withTeam: boolean;
}): Promise<ContactAssigneeRoster> {
  const org = (params.organizationId ?? "").trim();
  const assigneeId = (params.assigneeId ?? "").trim();
  try {
    const [assigneeRes, rosterRes, teamRes] = await Promise.all([
      assigneeId
        ? supabase.from("profiles").select("id, first_name, last_name").eq("id", assigneeId).maybeSingle()
        : NO_ROWS,
      org
        ? supabase.from("profiles").select(CONTACT_ROSTER_COLUMNS).eq("organization_id", org).eq("status", "Active")
        : NO_ROWS,
      params.withTeam ? supabase.rpc("get_contact_scope_agents") : NO_ROWS,
    ]);
    for (const res of [assigneeRes, rosterRes, teamRes]) {
      if (res.error) console.error("[useContactAssigneeOptions] read failed:", res.error);
    }
    const row = assigneeRes.error ? null : (assigneeRes.data as NameRow | null);
    return {
      roster: rosterRes.error ? [] : toAgents(rosterRes.data),
      team: teamRes.error ? [] : toAgents(teamRes.data),
      assignee: row?.id ? toAgent(row) : null,
    };
  } catch (e) {
    console.error("[useContactAssigneeOptions] load failed:", e);
    return { roster: [], team: [], assignee: null };
  }
}

export function useContactAssigneeOptions(params: {
  contactId: string | null | undefined;
  currentAssigneeId: string | null | undefined;
  /** The page's organization (`useOrganization`), the roster's explicit filter. */
  organizationId: string | null | undefined;
  /** The effective viewer (`useEffectiveViewer`); null while unresolved, which offers nobody. */
  viewer: EffectiveViewer | null;
  /** The effective profile's id: the viewer's own name comes from the profile, so no lookup. */
  selfId: string | null | undefined;
}) {
  const { contactId, viewer } = params;
  const org = (params.organizationId ?? "").trim();
  const assigneeId = (params.currentAssigneeId ?? "").trim();
  const selfId = (params.selfId ?? "").trim();
  const lookupId = assigneeId && assigneeId !== selfId ? assigneeId : "";
  const withTeam = viewer?.role === "Team Leader" && !viewer.isImpersonating;
  const scopeKey = JSON.stringify([org, effectiveViewerKey(viewer), selfId]);
  const loadKey = JSON.stringify([scopeKey, contactId ?? null, lookupId]);

  const [loaded, setLoaded] = useState<(ContactAssigneeRoster & { scopeKey: string; loadKey: string }) | null>(null);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    void loadContactAssigneeRoster({ organizationId: org, assigneeId: lookupId, withTeam }).then((result) => {
      if (!cancelled) setLoaded({ ...result, scopeKey, loadKey });
    });
    return () => { cancelled = true; };
  }, [contactId, org, lookupId, withTeam, scopeKey, loadKey]);

  // Another scope's lists are never shown; within a scope the previous contact's lists stay
  // visible while the next contact loads, but `rosterLoaded` is false until its own load lands.
  const current = loaded?.scopeKey === scopeKey ? loaded : null;
  const rosterLoaded = current?.loadKey === loadKey;

  const agents = useMemo(() => {
    if (!current) return EMPTY;
    const { roster, assignee } = current;
    return assignee && !roster.some((a) => a.id === assignee.id) ? [assignee, ...roster] : roster;
  }, [current]);

  const team = current?.team ?? EMPTY;
  const assigneeOptions = useMemo(
    () => resolveAssignableAgents({
      role: viewer?.role, viewerId: viewer?.viewerId, isSuperAdmin: isEffectiveSuperAdmin(viewer),
      orgAgents: agents, teamAgents: team, currentAssigneeId: assigneeId,
    }),
    [viewer, agents, team, assigneeId],
  );

  return { agents, rosterLoaded, assigneeOptions };
}
