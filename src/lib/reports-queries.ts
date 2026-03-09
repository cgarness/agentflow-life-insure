import { supabase } from "@/integrations/supabase/client";
import { startOfDay, endOfDay, format, differenceInDays, parseISO } from "date-fns";

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AgentProfile {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
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

export async function fetchProfiles(): Promise<AgentProfile[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, role")
    .order("first_name");
  return (data || []) as AgentProfile[];
}

export async function fetchCallsRaw(range: DateRange, agentId?: string) {
  let q = supabase
    .from("calls")
    .select("id, agent_id, started_at, duration, direction, disposition_name, disposition_id, outcome, contact_name")
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
    .select("id, lead_source, status, last_contacted_at, created_at, assigned_agent_id")
    .gte("created_at", startOfDay(range.start).toISOString())
    .lte("created_at", endOfDay(range.end).toISOString());
  if (agentId) q = q.eq("assigned_agent_id", agentId);
  const { data } = await q;
  return data || [];
}

export async function fetchWins(range: DateRange, agentId?: string) {
  let q = supabase
    .from("wins")
    .select("*")
    .gte("created_at", startOfDay(range.start).toISOString())
    .lte("created_at", endOfDay(range.end).toISOString());
  if (agentId) q = q.eq("agent_id", agentId);
  const { data } = await q;
  return data || [];
}

// Grouping helpers
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
