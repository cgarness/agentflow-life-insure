import { supabase } from "@/integrations/supabase/client";

/**
 * Selection-screen presence — thin wrapper over the read-only aggregate RPC
 * public.get_dialer_campaign_presence(uuid[]) (migration 20260820213208).
 *
 * Contract (see implementation_plan.md, approved 2026-08-20):
 *  - ONE batched call serves the whole selection screen — never one request per row.
 *  - A returned Supabase error is a FAILURE (throws). It must never be coerced into
 *    zeros: the UI renders "—" for unavailable presence, never a fabricated
 *    "No active agents".
 *  - The server returns a row only for campaigns the caller may dial; requested ids
 *    the server omitted stay absent from the map (rendered "—", not zero).
 *  - Agent-role callers receive counts with an empty identity array; leadership
 *    identity entries carry only agent_id / display_name / avatar_url /
 *    last_heartbeat_at.
 *  - Presence is NEVER persisted to localStorage — a stale cached live count lies.
 */

/** React Query key prefix — shared with useCampaignSelectionLive's single refresh owner. */
export const DIALER_CAMPAIGN_PRESENCE_QUERY_KEY = "dialerCampaignPresence";

export interface DialerPresenceAgent {
  agentId: string;
  displayName: string | null;
  avatarUrl: string | null;
  lastHeartbeatAt: string | null;
}

export interface CampaignPresenceEntry {
  activeAgentCount: number;
  activeAgents: DialerPresenceAgent[];
}

export type CampaignPresenceMap = Record<string, CampaignPresenceEntry>;

function parseAgent(raw: unknown): DialerPresenceAgent | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.agent_id == null) return null;
  return {
    agentId: String(a.agent_id),
    displayName: a.display_name != null ? String(a.display_name) : null,
    avatarUrl: a.avatar_url != null ? String(a.avatar_url) : null,
    lastHeartbeatAt: a.last_heartbeat_at != null ? String(a.last_heartbeat_at) : null,
  };
}

export async function getDialerCampaignPresence(
  campaignIds: string[],
): Promise<CampaignPresenceMap> {
  if (campaignIds.length === 0) return {};

  // RPC absent from generated types — narrow cast (house pattern; server enforces auth/scope).
  const { data, error } = await (supabase as any).rpc("get_dialer_campaign_presence", {
    p_campaign_ids: campaignIds,
  });
  if (error) {
    console.error("[dialer-presence] get_dialer_campaign_presence:", error);
    throw error;
  }

  const map: CampaignPresenceMap = {};
  for (const raw of Array.isArray(data) ? data : []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.campaign_id == null) continue;
    const agents = Array.isArray(row.active_agents)
      ? row.active_agents.map(parseAgent).filter((a): a is DialerPresenceAgent => a !== null)
      : [];
    map[String(row.campaign_id)] = {
      activeAgentCount: Number(row.active_agent_count ?? 0),
      activeAgents: agents,
    };
  }
  return map;
}
