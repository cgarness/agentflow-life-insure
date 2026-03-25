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

export async function fetchProfiles(): Promise<AgentProfile[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role, email")
    .order("first_name");
  return (data || []) as AgentProfile[];
}

export async function fetchCallsRaw(range: DateRange, agentId?: string) {
  let q = supabase
    .from("calls")
    .select("id, agent_id, started_at, duration, direction, disposition_name, disposition_id, outcome, contact_name, contact_id, contact_phone, campaign_id, campaign_lead_id")
    .gte("started_at", startOfDay(range.start).toISOString())
    .lte("started_at", endOfDay(range.end).toISOString());
  if (agentId) q = q.eq("agent_id", agentId);
  const { data } = await q;
  return data || [];
}

export async function fetchDispositions() {
  const { data } = await supabase.from("dispositions").select("id, name, color");
  return data || [];
}

export async function fetchCampaignsWithStats() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, name, type, status, total_leads, leads_contacted, leads_converted")
    .gt("total_leads", 0)
    .order("leads_converted", { ascending: false });
  return data || [];
}

export async function fetchLeads(range: DateRange, agentId?: string) {
  let q = supabase
    .from("leads")
    .select("id, lead_source, status, last_contacted_at, created_at, assigned_agent_id, phone, state")
    .gte("created_at", startOfDay(range.start).toISOString())
    .lte("created_at", endOfDay(range.end).toISOString());
  if (agentId) q = q.eq("assigned_agent_id", agentId);
  const { data } = await q;
  return data || [];
}

export async function fetchDialerSessions(range: DateRange, agentId?: string) {
  let q = supabase
    .from("dialer_sessions")
    .select("id, agent_id, started_at, ended_at, calls_made, calls_connected, policies_sold, total_talk_time")
    .gte("started_at", startOfDay(range.start).toISOString())
    .lte("started_at", endOfDay(range.end).toISOString());
  if (agentId) q = q.eq("agent_id", agentId);
  const { data } = await q;
  return data || [];
}

export async function fetchGoals() {
  const { data } = await supabase.from("goals").select("*");
  return data || [];
}

export async function fetchCampaignLeads(range: DateRange) {
  const { data } = await supabase
    .from("campaign_leads")
    .select("id, campaign_id, call_attempts, first_name, last_name, status, disposition, created_at, state")
    .gte("created_at", startOfDay(range.start).toISOString())
    .lte("created_at", endOfDay(range.end).toISOString());
  return data || [];
}

export async function fetchLeadSourceCosts() {
  const { data } = await supabase.from("lead_source_costs").select("*");
  return data || [];
}

export async function upsertLeadSourceCost(leadSource: string, cost: number) {
  const { error } = await supabase.from("lead_source_costs").upsert(
    { lead_source: leadSource, cost, updated_at: new Date().toISOString() },
    { onConflict: "lead_source" }
  );
  if (error) throw error;
}

export async function fetchSavedReports() {
  const { data } = await supabase
    .from("saved_reports")
    .select("*")
    .order("created_at", { ascending: false });
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

export async function fetchScheduledReports() {
  const { data } = await supabase
    .from("scheduled_reports")
    .select("*")
    .order("created_at", { ascending: false });
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

export function isSoldDisposition(name: string | null): boolean {
  const dn = (name || "").toLowerCase();
  return dn.includes("sold") || dn.includes("policy");
}
