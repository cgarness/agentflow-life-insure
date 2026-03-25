import { supabase } from "@/integrations/supabase/client";

export interface DialerDailyStats {
  id: string;
  agent_id: string;
  stat_date: string;
  calls_made: number;
  calls_connected: number;
  total_talk_seconds: number;
  policies_sold: number;
  session_started_at: string | null;
  last_updated_at: string;
}

/**
 * Upsert dialer stats for today. Numeric fields are INCREMENTED on conflict,
 * not replaced. session_started_at is only set if not already present.
 */
export async function upsertDialerStats(
  agentId: string,
  updates: {
    calls_made?: number;
    calls_connected?: number;
    total_talk_seconds?: number;
    policies_sold?: number;
    session_started_at?: string | null;
  }
): Promise<void> {
  const { error } = await (supabase as any).rpc("increment_dialer_stats", { // eslint-disable-line @typescript-eslint/no-explicit-any
    p_agent_id: agentId,
    p_calls_made: updates.calls_made ?? 0,
    p_calls_connected: updates.calls_connected ?? 0,
    p_total_talk_seconds: updates.total_talk_seconds ?? 0,
    p_policies_sold: updates.policies_sold ?? 0,
    p_session_started_at: updates.session_started_at ?? null,
  });
  if (error) {
    console.error("[upsertDialerStats] error:", error);
    throw error;
  }
}

/**
 * Fetch today's stats row for the given agent.
 * Returns null if no row exists yet (agent hasn't called today).
 */
export async function getTodayStats(
  agentId: string
): Promise<DialerDailyStats | null> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("dialer_daily_stats")
    .select("*")
    .eq("agent_id", agentId)
    .eq("stat_date", today)
    .maybeSingle();
  if (error) {
    console.error("[getTodayStats] error:", error);
    throw error;
  }
  return (data as DialerDailyStats) ?? null;
}

/**
 * Delete today's stats row for the given agent (used by Reset Stats).
 */
export async function deleteTodayStats(agentId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const { error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("dialer_daily_stats")
    .delete()
    .eq("agent_id", agentId)
    .eq("stat_date", today);
  if (error) {
    console.error("[deleteTodayStats] error:", error);
    throw error;
  }
}
