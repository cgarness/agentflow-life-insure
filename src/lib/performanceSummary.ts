import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const count = z.number().nonnegative().int().safe();
const amount = z.number().nonnegative().finite();
const totals = z.object({ calls: count, policies: count, bookings: count, annual_premium: amount,
  monthly_premium: amount, unknown_premiums: count, talk_seconds: count, workload: count, leads: count, estimated_duration_calls: count, unknown_duration_calls: count, conflicting_duration_calls: count });
const iso = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Sales count by agency Sold Date. A payload without this basis (an older backend) fails closed.
const soldDateBasis = { policy_date_basis: z.literal("sold_date"), sold_date_from: isoDate, sold_date_through: isoDate };
const summary = z.object({ organization_id: z.string().uuid(), agent_ids: z.array(z.string().uuid()).nullable(),
  scope: z.string(), period: z.enum(["day", "week", "month", "year"]), time_zone: z.string(),
  start_at: iso, end_at: iso, previous_start: iso, previous_end: iso, workload_end: iso,
  ...soldDateBasis, previous_sold_date_from: isoDate, previous_sold_date_through: isoDate, undated_policies: count,
  current: totals, previous: totals });
export type PerformanceSummary = z.infer<typeof summary>;
export type PerformancePeriod = "day" | "week" | "month" | "year";

export function summaryScopeKey(period: PerformancePeriod, zone?: string | null, now = new Date()): string {
  if (!zone) return `${period}|unresolved`;
  const day = new Date(`${formatInTimeZone(now, zone, "yyyy-MM-dd")}T12:00:00Z`);
  if (period === "week") day.setUTCDate(day.getUTCDate() - (day.getUTCDay()+6)%7);
  if (period === "month" || period === "year") day.setUTCDate(1);
  if (period === "year") day.setUTCMonth(0);
  return `${period}|${zone}|${fromZonedTime(`${day.toISOString().slice(0,10)}T00:00:00`, zone).toISOString()}`;
}

export async function loadPerformanceSummary(period: PerformancePeriod, mode: "own" | "team", agentId: string | null, signal?: AbortSignal): Promise<PerformanceSummary> {
  if (agentId && !z.string().uuid().safeParse(agentId).success) throw new Error("Invalid agent identity");
  let request = (supabase as any).rpc("get_performance_summary", { p_period: period, p_mode: mode, p_agent_id: agentId });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const parsed = summary.parse(data);
  if (parsed.period !== period || (agentId && (parsed.agent_ids?.length !== 1 || parsed.agent_ids[0] !== agentId))) throw new Error("Performance scope changed. Retry.");
  if (summaryScopeKey(period, parsed.time_zone) !== summaryScopeKey(period, parsed.time_zone, new Date(parsed.start_at))) throw new Error("Performance period changed. Retry.");
  const day = (at: string) => formatInTimeZone(at, parsed.time_zone, "yyyy-MM-dd");
  // The previous window ends the calendar day before the current one starts. Pure date arithmetic, so a local
  // midnight that occurs twice (America/Havana on its fall-back day) cannot shift it.
  const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (parsed.sold_date_from !== day(parsed.start_at) || parsed.sold_date_through !== day(parsed.end_at)
    || parsed.previous_sold_date_from !== day(parsed.previous_start) || parsed.previous_sold_date_through !== dayBefore(parsed.sold_date_from)) {
    throw new Error("Performance Sold Date window changed. Retry.");
  }
  return parsed;
}

export async function loadPerformanceDetails(kind: string, period: PerformancePeriod, mode: "own" | "team", agentId: string | null, asOf: string, offset: number) {
  const { data, error } = await (supabase as any).rpc("get_performance_details", {
    p_kind: kind, p_period: period, p_mode: mode, p_agent_id: agentId, p_asof: asOf, p_offset: offset,
  });
  if (error) throw error;
  return z.object({ rows: z.array(z.object({ id: z.string().uuid() }).passthrough()).max(20),
    start_at: iso, end_at: iso, workload_end: iso, time_zone: z.string(), scope: z.string(), organization_id: z.string().uuid(),
    ...soldDateBasis }).parse(data);
}
