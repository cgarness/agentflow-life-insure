/**
 * useCampaignTeamScope — the Team Leader branch of CampaignDetail's Leads role filter
 * (hierarchy stabilization F7).
 *
 * A DISPLAY filter over rows RLS has already returned, NOT an authorization boundary:
 * `campaign_leads_select` gives a Team Leader every campaign lead in the organization, and a
 * determined user still reads all of them over PostgREST. This only decides which of those rows
 * the Leads tab lists for a Team Leader — their own claims, unclaimed rows, and rows claimed by
 * anyone in their downline.
 *
 * The downline is `usersApi.getAgentScopeIds`, the one audited resolver: a BFS over
 * `profiles.upline_id`, organization-constrained on every round, walking through Deleted members
 * without returning them, and rejecting on any error. Query scoping, not authorization —
 * `profiles_select_org` permits same-organization reads. It replaces a check of `upline_id` on a
 * roster that never selected that column, which left every Team Leader with own + unclaimed only.
 *
 * FAILS NARROW: while unresolved, after any error, or without a viewer or organization the team is
 * the viewer alone — own + unclaimed rows, the previous behaviour. It never widens to the
 * organization, and nothing is persisted or shared between viewers.
 */

import { useEffect, useMemo, useState } from "react";
import { usersSupabaseApi } from "@/lib/supabase-users";

export interface CampaignTeamScopeParams {
  viewerId: string | null | undefined;
  organizationId: string | null | undefined;
}

/** The role strings CampaignDetail has always treated as a Team Leader (case-insensitive). */
export function isCampaignTeamLeaderRole(role: string | null | undefined): boolean {
  const r = (role ?? "").toLowerCase();
  return r === "team leader" || r === "team_leader";
}

/**
 * Pure loader: the viewer plus every non-Deleted descendant in `organizationId`. Fails narrow —
 * the viewer alone without an organization or on any traversal error; nothing without a viewer.
 */
export async function loadCampaignTeamScope(params: CampaignTeamScopeParams): Promise<string[]> {
  const viewerId = (params.viewerId ?? "").trim();
  const organizationId = (params.organizationId ?? "").trim();
  if (!viewerId) return [];
  if (!organizationId) return [viewerId];
  try {
    const ids = await usersSupabaseApi.getAgentScopeIds({ viewerId, organizationId });
    return ids.includes(viewerId) ? ids : [viewerId, ...ids];
  } catch (error) {
    console.error("[useCampaignTeamScope] downline scope failed; showing own and unclaimed leads only:", error);
    return [viewerId];
  }
}

/**
 * The Leads tab's role filter (pure). Agent → their own claims; Team Leader → own claims,
 * unclaimed rows and rows claimed by `teamIds`; any other role (Admin) → every row.
 */
export function filterCampaignLeadsForRole<T extends { claimed_by: string | null }>(
  leads: T[],
  params: { role: string | null | undefined; viewerId: string | null | undefined; teamIds: ReadonlySet<string> },
): T[] {
  const viewerId = params.viewerId ?? null;
  if ((params.role ?? "").toLowerCase() === "agent") {
    return leads.filter((l) => viewerId !== null && l.claimed_by === viewerId);
  }
  if (isCampaignTeamLeaderRole(params.role)) {
    return leads.filter(
      (l) => l.claimed_by == null || (viewerId !== null && l.claimed_by === viewerId) || params.teamIds.has(l.claimed_by),
    );
  }
  return leads;
}

/**
 * The viewer's team ids for the Team Leader filter (`enabled` false → no query, empty set). The
 * result is stored WITH the identity it was resolved for and read back only while that identity
 * still matches, so a viewer or organization change drops the previous team on the same render.
 */
export function useCampaignTeamScope(params: CampaignTeamScopeParams & { enabled: boolean }): ReadonlySet<string> {
  const viewerId = (params.viewerId ?? "").trim();
  const organizationId = (params.organizationId ?? "").trim();
  const key = params.enabled && viewerId && organizationId ? `${viewerId}::${organizationId}` : null;
  const [resolved, setResolved] = useState<{ key: string; ids: string[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void loadCampaignTeamScope({ viewerId, organizationId }).then((ids) => {
      if (!cancelled) setResolved({ key, ids });
    });
    return () => {
      cancelled = true;
    };
  }, [key, viewerId, organizationId]);

  const ids = key && resolved?.key === key ? resolved.ids : null;
  return useMemo(() => new Set(ids ?? []), [ids]);
}
