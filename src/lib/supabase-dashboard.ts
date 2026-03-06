import { supabase } from "@/integrations/supabase/client";
import { DashboardStats, LeaderboardEntry } from "@/lib/types";

const FOLLOW_UP_STATUSES = ["Follow Up", "Hot", "Interested", "Contacted"];

const daysBetween = (dateString?: string | null) => {
  if (!dateString) return 0;
  const now = new Date();
  const then = new Date(dateString);
  const diff = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(diff / 86400000));
};

const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(now);
  weekStart.setDate(diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

export const dashboardSupabaseApi = {
  async getStats(): Promise<DashboardStats> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekStart = getWeekStart();

    const [{ count: totalCallsToday }, { count: policiesSoldThisMonth }, { count: appointmentsThisWeek }] = await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("last_contacted_at", todayStart.toISOString()),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "Closed Won")
        .gte("updated_at", monthStart.toISOString()),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .gte("start_time", weekStart.toISOString()),
    ]);

    return {
      totalCallsToday: totalCallsToday ?? 0,
      callsTrend: "",
      policiesSoldThisMonth: policiesSoldThisMonth ?? 0,
      policiesTrend: "",
      appointmentsThisWeek: appointmentsThisWeek ?? 0,
      appointmentsTrend: "",
      activeCampaigns: 0,
    };
  },

  async getLeaderboard(_period = "today"): Promise<LeaderboardEntry[]> {
    const [{ data: profiles, error: profilesError }, { data: leads, error: leadsError }, { data: appointments, error: appointmentsError }] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name").eq("status", "Active"),
      supabase.from("leads").select("assigned_agent_id, status"),
      supabase.from("appointments").select("created_by"),
    ]);

    if (profilesError) throw new Error(profilesError.message);
    if (leadsError) throw new Error(leadsError.message);
    if (appointmentsError) throw new Error(appointmentsError.message);

    const callsByAgent = new Map<string, number>();
    const policiesByAgent = new Map<string, number>();
    for (const lead of leads ?? []) {
      if (!lead.assigned_agent_id) continue;
      callsByAgent.set(lead.assigned_agent_id, (callsByAgent.get(lead.assigned_agent_id) ?? 0) + 1);
      if (lead.status === "Closed Won") {
        policiesByAgent.set(lead.assigned_agent_id, (policiesByAgent.get(lead.assigned_agent_id) ?? 0) + 1);
      }
    }

    const appointmentsByAgent = new Map<string, number>();
    for (const appt of appointments ?? []) {
      if (!appt.created_by) continue;
      appointmentsByAgent.set(appt.created_by, (appointmentsByAgent.get(appt.created_by) ?? 0) + 1);
    }

    const rows = (profiles ?? [])
      .map((profile) => {
        const calls = callsByAgent.get(profile.id) ?? 0;
        const policies = policiesByAgent.get(profile.id) ?? 0;
        const appts = appointmentsByAgent.get(profile.id) ?? 0;
        const fullName = `${profile.first_name} ${profile.last_name}`.trim();
        const initials = `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase();
        const goalProgress = Math.min(100, Math.round(((policies * 10) + (appts * 5) + calls) / 2));

        return {
          userId: profile.id,
          name: fullName || "Agent",
          avatar: initials || "AG",
          calls,
          policies,
          appointments: appts,
          talkTime: "-",
          conversionRate: "-",
          goalProgress,
        };
      })
      .sort((a, b) => (b.policies - a.policies) || (b.appointments - a.appointments) || (b.calls - a.calls))
      .slice(0, 5)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return rows;
  },

  async getFollowUps() {
    const { data, error } = await supabase
      .from("leads")
      .select("id, first_name, last_name, lead_source, status, last_contacted_at, created_at")
      .in("status", FOLLOW_UP_STATUSES)
      .order("last_contacted_at", { ascending: true, nullsFirst: true })
      .limit(10);

    if (error) throw new Error(error.message);

    return (data ?? []).map((lead) => ({
      id: lead.id,
      firstName: lead.first_name,
      lastName: lead.last_name,
      leadSource: lead.lead_source,
      status: lead.status,
      aging: daysBetween(lead.last_contacted_at ?? lead.created_at),
    }));
  },

  async getMissedCalls() {
    return [];
  },

  async getAnniversaries() {
    return [];
  },

  async getWins() {
    return [];
  },

  async getRecentActivity() {
    return [];
  },
};
