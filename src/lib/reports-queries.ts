import { supabase } from "@/integrations/supabase/client";
import { startOfDay, endOfDay, format, differenceInDays, parseISO, startOfMonth, subDays } from "date-fns";

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AgentProfile {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  email: string;
}

export type Grouping = "daily" | "weekly" | "monthly";

export function autoGrouping(range: DateRange): Grouping {
  const days = differenceInDays(range.end, range.start);
  if (days < 14) return "daily";
  if (days <= 60) return "weekly";
  return "monthly";
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export async function fetchProfiles(orgId?: string | null): Promise<AgentProfile[]> {
  let q = supabase
    .from("profiles")
    .select("id, first_name, last_name, role, email")
    .eq("status", "Active")
    .order("first_name");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return (data || []) as AgentProfile[];
}

export async function fetchCallsRaw(range: DateRange, orgId?: string | null, agentId?: string) {
  let q = supabase
    .from("calls")
    .select("id, agent_id, started_at, duration, direction, disposition_name, disposition_id, outcome, contact_name, contact_id, contact_phone, campaign_id, campaign_lead_id")
    .gte("started_at", startOfDay(range.start).toISOString())
    .lte("started_at", endOfDay(range.end).toISOString());
  if (orgId) q = q.eq("organization_id", orgId);
  if (agentId) q = q.eq("agent_id", agentId);
  const { data } = await q;
  return data || [];
}

export async function fetchDispositions(orgId?: string | null) {
  let q = supabase.from("dispositions").select("id, name, color, pipeline_stage_id, dnc_auto_add, callback_scheduler, appointment_scheduler");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function fetchActiveLeadsCount(orgId?: string | null): Promise<number> {
  let q = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "('Sold','DNC','Not Interested')");
  if (orgId) q = q.eq("organization_id", orgId);
  const { count, error } = await q;
  if (error) {
    console.error("fetchActiveLeadsCount error:", error);
    return 0;
  }
  return count || 0;
}

export async function fetchPipelineStages(orgId?: string | null) {
  let q = supabase
    .from("pipeline_stages")
    .select("id, convert_to_client")
    .eq("pipeline_type", "lead");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function fetchCampaignsWithStats(orgId?: string | null) {
  let q = supabase
    .from("campaigns")
    .select("id, name, type, status, total_leads, leads_contacted, leads_converted")
    .gt("total_leads", 0)
    .order("leads_converted", { ascending: false });
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function fetchLeads(range: DateRange, orgId?: string | null, agentId?: string) {
  let q = supabase
    .from("leads")
    .select("id, lead_source, status, last_contacted_at, created_at, assigned_agent_id, phone, state")
    .gte("created_at", startOfDay(range.start).toISOString())
    .lte("created_at", endOfDay(range.end).toISOString());
  if (orgId) q = q.eq("organization_id", orgId);
  if (agentId) q = q.eq("assigned_agent_id", agentId);
  const { data } = await q;
  return data || [];
}

export async function fetchDialerSessions(range: DateRange, orgId?: string | null, agentId?: string) {
  let q = supabase
    .from("dialer_sessions")
    .select("id, agent_id, started_at, ended_at, calls_made, calls_connected, policies_sold, total_talk_time")
    .gte("started_at", startOfDay(range.start).toISOString())
    .lte("started_at", endOfDay(range.end).toISOString());
  if (orgId) q = q.eq("organization_id", orgId);
  if (agentId) q = q.eq("agent_id", agentId);
  const { data } = await q;
  return data || [];
}

export async function fetchGoals(orgId?: string | null) {
  let q = supabase.from("goals").select("*");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function fetchCampaignLeads(range: DateRange, orgId?: string | null) {
  let q = supabase
    .from("campaign_leads")
    .select("id, campaign_id, call_attempts, first_name, last_name, status, disposition, created_at, state")
    .gte("created_at", startOfDay(range.start).toISOString())
    .lte("created_at", endOfDay(range.end).toISOString());
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function fetchLeadSourceCosts(orgId?: string | null) {
  let q = supabase.from("lead_source_costs").select("*");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function upsertLeadSourceCost(leadSource: string, cost: number) {
  const { error } = await supabase.from("lead_source_costs").upsert(
    { lead_source: leadSource, cost, updated_at: new Date().toISOString() },
    { onConflict: "lead_source" }
  );
  if (error) throw error;
}

export async function fetchSavedReports(orgId?: string | null) {
  let q = supabase
    .from("saved_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function createSavedReport(name: string, config: any, userId: string, organizationId: string | null = null) {
  const { error } = await supabase.from("saved_reports").insert({ name, config, created_by: userId, organization_id: organizationId } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (error) throw error;
}

export async function deleteSavedReport(id: string) {
  const { error } = await supabase.from("saved_reports").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchScheduledReports(orgId?: string | null) {
  let q = supabase
    .from("scheduled_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return data || [];
}

export async function createScheduledReport(report: any, organizationId: string | null = null) {
  const { error } = await supabase.from("scheduled_reports").insert({ ...report, organization_id: organizationId } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (error) throw error;
}

export async function updateScheduledReport(id: string, updates: any) {
  const { error } = await supabase.from("scheduled_reports").update(updates).eq("id", id);
  if (error) throw error;
}

export async function deleteScheduledReport(id: string) {
  const { error } = await supabase.from("scheduled_reports").delete().eq("id", id);
  if (error) throw error;
}

export function groupByDate(dateStr: string, grouping: Grouping): string {
  const d = parseISO(dateStr);
  if (grouping === "daily") return format(d, "MMM dd");
  if (grouping === "weekly") {
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    return `Week of ${format(weekStart, "MMM dd")}`;
  }
  return format(d, "MMM yyyy");
}

/** Format lead DOB for CSV export (MM/DD/YYYY). Use when building rows that include date_of_birth. */
export { formatDobForCsv } from "@/utils/dobUtils";

export function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${(c ?? "").toString().replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function getAgentName(agents: AgentProfile[], id: string): string {
  const a = agents.find(a => a.id === id);
  return a ? `${a.first_name} ${a.last_name?.charAt(0) || ""}.` : "Unknown";
}

// ─── Phase 3 RPC Data Shapes & Fetchers ─────────────────────────────────────

export interface ReportCallSummary {
  total_calls: number;
  outbound: number;
  inbound: number;
  contacted: number;
  converted: number;
  total_duration_seconds: number;
  avg_duration_seconds: number;
  answer_rate_pct: number;
  conversion_rate_pct: number;
  calls_by_agent: {
    agent_id: string;
    agent_name: string;
    total: number;
    contacted: number;
    converted: number;
    total_duration: number;
    avg_duration: number;
  }[];
  calls_by_direction: { outbound: number; inbound: number };
}

export interface ReportCallVolumeTimeseries {
  by_hour: { hour: number; total: number; contacted: number; converted: number }[];
  by_day_of_week: { dow: number; dow_name: string; total: number; contacted: number; converted: number }[];
  by_date: { date: string; total: number; contacted: number; converted: number }[];
  heatmap: { dow: number; hour: number; total: number; contacted: number }[];
}

export interface ReportDispositionBreakdown {
  by_disposition: { disposition_name: string; color: string; count: number; avg_duration: number; is_converted: boolean }[];
  by_agent: { agent_id: string; dispositions: Record<string, number> }[];
  by_campaign: { campaign_id: string; campaign_name: string; dispositions: Record<string, number> }[];
  duration_histogram: { range: string; count: number }[];
}

export interface ReportCampaignPerformance {
  campaigns: { campaign_id: string; campaign_name: string; campaign_type: string; total_leads: number; contacted: number; converted: number; conversion_rate_pct: number }[];
  by_lead_source: { lead_source: string; total: number; contacted: number; converted: number; conversion_rate_pct: number }[];
}

export async function fetchReportCallSummary(orgId: string, range: DateRange, agentId?: string): Promise<ReportCallSummary> {
  const { data, error } = await supabase.rpc("rpc_report_call_summary", {
    p_org_id: orgId,
    p_start_date: range.start.toISOString(),
    p_end_date: range.end.toISOString(),
    p_agent_id: agentId || null
  });
  if (error || !data) {
    console.error("fetchReportCallSummary error:", error);
    return {
      total_calls: 0, outbound: 0, inbound: 0, contacted: 0, converted: 0,
      total_duration_seconds: 0, avg_duration_seconds: 0, answer_rate_pct: 0, conversion_rate_pct: 0,
      calls_by_agent: [], calls_by_direction: { outbound: 0, inbound: 0 }
    };
  }
  return data as unknown as ReportCallSummary;
}

export async function fetchReportCallVolumeTimeseries(orgId: string, range: DateRange, agentId?: string): Promise<ReportCallVolumeTimeseries> {
  const { data, error } = await supabase.rpc("rpc_report_call_volume_timeseries", {
    p_org_id: orgId,
    p_start_date: range.start.toISOString(),
    p_end_date: range.end.toISOString(),
    p_agent_id: agentId || null
  });
  if (error || !data) {
    console.error("fetchReportCallVolumeTimeseries error:", error);
    return { by_hour: [], by_day_of_week: [], by_date: [], heatmap: [] };
  }
  return data as unknown as ReportCallVolumeTimeseries;
}

export async function fetchReportDispositionBreakdown(orgId: string, range: DateRange, agentId?: string): Promise<ReportDispositionBreakdown> {
  const { data, error } = await supabase.rpc("rpc_report_disposition_breakdown", {
    p_org_id: orgId,
    p_start_date: range.start.toISOString(),
    p_end_date: range.end.toISOString(),
    p_agent_id: agentId || null
  });
  if (error || !data) {
    console.error("fetchReportDispositionBreakdown error:", error);
    return { by_disposition: [], by_agent: [], by_campaign: [], duration_histogram: [] };
  }
  return data as unknown as ReportDispositionBreakdown;
}

export async function fetchReportCampaignPerformance(orgId: string, range: DateRange, agentId?: string): Promise<ReportCampaignPerformance> {
  const { data, error } = await supabase.rpc("rpc_report_campaign_performance", {
    p_org_id: orgId,
    p_start_date: range.start.toISOString(),
    p_end_date: range.end.toISOString(),
    p_agent_id: agentId || null
  });
  if (error || !data) {
    console.error("fetchReportCampaignPerformance error:", error);
    return { campaigns: [], by_lead_source: [] };
  }
  return data as unknown as ReportCampaignPerformance;
}

