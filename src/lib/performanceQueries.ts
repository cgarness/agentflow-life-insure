import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { AgentStats, Period, Win } from "@/components/leaderboard/leaderboardTypes";
import { mapPeriodToRpcParam } from "@/components/leaderboard/leaderboardTypes";
import type { LeaderboardLoadResult } from "@/lib/leaderboardRequestGate";

const count = z.number().int().nonnegative().safe();
const amount = z.number().finite().nonnegative();
const rowSchema = z.object({
  agent_id: z.string().uuid(), first_name: z.string().nullable(), last_name: z.string().nullable(),
  organization_id: z.string().uuid(), organization_name: z.string(), agent_status: z.literal("Active"),
  calls_made: count, appointments_set: count, policies_sold: count, annualized_premium: amount,
  unknown_premiums: count, talk_time_seconds: count, recent_wins_7d: count,
  estimated_duration_calls: count, unknown_duration_calls: count, conflicting_duration_calls: count,
});
const snapshotSchema = z.object({
  period: z.enum(["today", "week", "month"]), time_zone: z.string().min(1),
  start_at: z.string().datetime({ offset: true }), end_at: z.string().datetime({ offset: true }),
  organization_id: z.string().uuid(), group_id: z.string().uuid().nullable(), roster: z.literal("active"),
  rows: z.array(rowSchema), excluded: z.object({ calls_made: count, appointments_set: count, policies_sold: count }),
});
export type PerformanceSnapshot = Omit<z.infer<typeof snapshotSchema>, "rows"> & { rows: AgentStats[] };

export async function loadPerformanceSnapshot(period: Period, groupId: string | null, orgId: string, signal: AbortSignal): Promise<LeaderboardLoadResult<PerformanceSnapshot>> {
  const { data, error } = await (supabase as any).rpc("get_leaderboard_snapshot", {
    p_period: mapPeriodToRpcParam(period), p_group_id: groupId,
  }).abortSignal(signal);
  if (error) return { data: null, error };
  const parsed = snapshotSchema.safeParse(data);
  if (!parsed.success || parsed.data.period !== mapPeriodToRpcParam(period) || parsed.data.group_id !== groupId || parsed.data.organization_id !== orgId) {
    return { data: null, error: new Error("Standings returned an invalid or different scope. Retry.") };
  }
  const snapshot = parsed.data;
  if ((!groupId && snapshot.rows.some(r => r.organization_id !== orgId)) ||
      new Set(snapshot.rows.map(r => r.agent_id)).size !== snapshot.rows.length ||
      snapshot.rows.some(r => r.unknown_premiums > r.policies_sold || r.conflicting_duration_calls > r.calls_made || r.estimated_duration_calls + r.unknown_duration_calls > r.calls_made)) {
    return { data: null, error: new Error("Standings returned inconsistent metric data. Retry.") };
  }
  try { new Intl.DateTimeFormat("en", { timeZone: snapshot.time_zone }).format(); }
  catch { return { data: null, error: new Error("Agency timezone is invalid.") }; }
  if (Date.parse(snapshot.end_at) < Date.parse(snapshot.start_at) || Date.parse(snapshot.end_at) - Date.parse(snapshot.start_at) > 35 * 86400000) {
    return { data: null, error: new Error("Standings returned invalid date bounds.") };
  }
  return { data: { ...snapshot, rows: snapshot.rows.map(r => ({
    id: r.agent_id, first_name: r.first_name ?? "", last_name: r.last_name ?? "", rank: 0,
    callsMade: r.calls_made, policiesSold: r.policies_sold, appointmentsSet: r.appointments_set,
    estimatedDurationCalls: r.estimated_duration_calls, unknownDurationCalls: r.unknown_duration_calls, conflictingDurationCalls: r.conflicting_duration_calls,
    talkTime: r.talk_time_seconds, premiumSold: r.annualized_premium, unknownPremiums: r.unknown_premiums,
    conversionRate: r.calls_made > 0 ? r.policies_sold / r.calls_made * 100 : null,
    recentWins7d: r.recent_wins_7d, organizationId: r.organization_id, organizationName: r.organization_name,
  })) }, error: null };
}

const winSchema = z.object({
  id: z.string().uuid(), agent_id: z.string().uuid().nullable(), agent_name: z.string().nullable(),
  contact_id: z.string().uuid().nullable(), contact_name: z.string().nullable(), campaign_name: z.string().nullable(),
  policy_type: z.string().nullable(), premium_amount: z.number().nullable(), premium_snapshot: z.boolean(),
  created_at: z.string().datetime({ offset: true }), celebrated: z.boolean().nullable(),
  premiumSold: amount.nullable(), premium_known: z.boolean(),
});
export async function loadPerformanceWins(groupId: string | null, signal: AbortSignal): Promise<LeaderboardLoadResult<Win[]>> {
  const { data, error } = await (supabase as any).rpc("get_leaderboard_recent_wins", { p_group_id: groupId }).abortSignal(signal);
  if (error) return { data: null, error };
  const parsed = z.array(winSchema).max(20).safeParse(data);
  if (!parsed.success) return { data: null, error: new Error("Recent Wins returned invalid data. Retry.") };
  return { data: parsed.data.map(w => ({ ...w, id: w.id!, created_at: w.created_at!, agent_name: w.agent_name ?? "", contact_name: w.contact_name ?? "",
    campaign_name: w.campaign_name ?? "", policy_type: w.policy_type ?? "" })), error: null };
}
