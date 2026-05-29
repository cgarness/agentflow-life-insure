import { supabase } from "@/integrations/supabase/client";

export interface DialerSessionRecord {
  id: string;
  organization_id: string;
  agent_id: string;
  campaign_id: string | null;
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  status: "active" | "ended" | "abandoned";
}

function parseDialerSessionRow(data: unknown): DialerSessionRecord {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid dialer session response");
  }
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    agent_id: String(row.agent_id),
    campaign_id: row.campaign_id != null ? String(row.campaign_id) : null,
    started_at: String(row.started_at),
    last_heartbeat_at: String(row.last_heartbeat_at),
    ended_at: row.ended_at != null ? String(row.ended_at) : null,
    status: row.status as DialerSessionRecord["status"],
  };
}

export async function startDialerSession(
  campaignId?: string,
): Promise<DialerSessionRecord> {
  const { data, error } = await (supabase as any).rpc("start_dialer_session", { // eslint-disable-line @typescript-eslint/no-explicit-any
    p_campaign_id: campaignId ?? null,
  });
  if (error) {
    console.error("[startDialerSession] error:", error);
    throw error;
  }
  return parseDialerSessionRow(data);
}

export async function heartbeatDialerSession(
  sessionId: string,
): Promise<DialerSessionRecord> {
  const { data, error } = await (supabase as any).rpc("heartbeat_dialer_session", { // eslint-disable-line @typescript-eslint/no-explicit-any
    p_session_id: sessionId,
  });
  if (error) {
    console.warn("[heartbeatDialerSession] error:", error);
    throw error;
  }
  return parseDialerSessionRow(data);
}

export async function endDialerSession(
  sessionId: string,
): Promise<DialerSessionRecord> {
  const { data, error } = await (supabase as any).rpc("end_dialer_session", { // eslint-disable-line @typescript-eslint/no-explicit-any
    p_session_id: sessionId,
  });
  if (error) {
    console.warn("[endDialerSession] error:", error);
    throw error;
  }
  return parseDialerSessionRow(data);
}
