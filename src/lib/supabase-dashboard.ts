import { supabase } from "@/integrations/supabase/client";
import { DashboardStats, LeaderboardEntry, WinFeedItem } from "@/lib/types";

const daysBetween = (dateString?: string | null) => {
  if (!dateString) return Infinity;
  const now = new Date();
  const then = new Date(dateString);
  const diff = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(diff / 86400000));
};

const getDateRanges = () => {
  const now = new Date();
  
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthSameDay = new Date(lastMonthStart);
  lastMonthSameDay.setDate(Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
  
  const weekFromNow = new Date(now);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  
  const lastWeekStart = new Date(now);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  return {
    now,
    todayStart,
    yesterdayStart,
    monthStart,
    lastMonthStart,
    lastMonthSameDay,
    weekFromNow,
    lastWeekStart,
    twoWeeksAgo,
    sevenDaysAgo,
    threeDaysAgo,
  };
};

const calculateTrend = (current: number, previous: number): { value: string; positive: boolean | null } => {
  if (previous === 0 && current === 0) return { value: "", positive: null };
  if (previous === 0) return { value: "+100%", positive: true };
  const change = ((current - previous) / previous) * 100;
  if (change === 0) return { value: "", positive: null };
  return {
    value: `${change > 0 ? "+" : ""}${Math.round(change)}%`,
    positive: change > 0,
  };
};

export interface ExtendedDashboardStats extends DashboardStats {
  callsTrendPositive: boolean | null;
  policiesTrendPositive: boolean | null;
  appointmentsTrendPositive: boolean | null;
}

export interface FollowUpItem {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  time?: string;
  type: "callback" | "stale_lead" | "hot_lead";
  aging: number;
  leadSource: string;
  leadScore: number;
}

export interface TodayAppointment {
  id: string;
  contactName: string;
  time: string;
  type: string;
  status: string;
}

export interface RecentCall {
  id: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  duration: number;
  dispositionName: string | null;
  dispositionColor: string;
  startedAt: string;
}

export interface CampaignPerformance {
  id: string;
  name: string;
  type: string;
  totalLeads: number;
  leadsContacted: number;
  leadsConverted: number;
}

export interface GoalProgress {
  metric: string;
  label: string;
  current: number;
  target: number;
  period: string;
}

export interface OnboardingStatus {
  hasLeads: boolean;
  hasCalls: boolean;
  hasCampaigns: boolean;
  hasAppointments: boolean;
  isNewUser: boolean;
}

export interface WinFeedEntry {
  id: string;
  agentName: string;
  contactName: string;
  campaignName: string | null;
  createdAt: string;
}

export interface MissedCall {
  id: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  startedAt: string;
}

export const dashboardSupabaseApi = {
  async getStats(userId: string, isAdmin: boolean): Promise<ExtendedDashboardStats> {
    const ranges = getDateRanges();
    
    // Build base query filters
    const agentFilter = isAdmin ? {} : { agent_id: userId };
    const createdByFilter = isAdmin ? {} : { created_by: userId };
    
    // Calls Today vs Yesterday
    let callsTodayQuery = supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("started_at", ranges.todayStart.toISOString());
    
    let callsYesterdayQuery = supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("started_at", ranges.yesterdayStart.toISOString())
      .lt("started_at", ranges.todayStart.toISOString());
    
    if (!isAdmin) {
      callsTodayQuery = callsTodayQuery.eq("agent_id", userId);
      callsYesterdayQuery = callsYesterdayQuery.eq("agent_id", userId);
    }
    
    // Policies Sold This Month (from wins table)
    let policiesThisMonthQuery = supabase
      .from("wins")
      .select("id", { count: "exact", head: true })
      .gte("created_at", ranges.monthStart.toISOString());
    
    let policiesLastMonthQuery = supabase
      .from("wins")
      .select("id", { count: "exact", head: true })
      .gte("created_at", ranges.lastMonthStart.toISOString())
      .lt("created_at", ranges.monthStart.toISOString());
    
    if (!isAdmin) {
      policiesThisMonthQuery = policiesThisMonthQuery.eq("agent_id", userId);
      policiesLastMonthQuery = policiesLastMonthQuery.eq("agent_id", userId);
    }
    
    // Appointments next 7 days vs previous 7 days
    let appointmentsNextWeekQuery = supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("start_time", ranges.now.toISOString())
      .lt("start_time", ranges.weekFromNow.toISOString());
    
    let appointmentsPrevWeekQuery = supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("start_time", ranges.twoWeeksAgo.toISOString())
      .lt("start_time", ranges.lastWeekStart.toISOString());
    
    if (!isAdmin) {
      appointmentsNextWeekQuery = appointmentsNextWeekQuery.eq("created_by", userId);
      appointmentsPrevWeekQuery = appointmentsPrevWeekQuery.eq("created_by", userId);
    }
    
    // Active Campaigns
    const activeCampaignsQuery = supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("status", "Active");
    
    const [
      { count: callsToday },
      { count: callsYesterday },
      { count: policiesThisMonth },
      { count: policiesLastMonth },
      { count: appointmentsNext },
      { count: appointmentsPrev },
      { count: activeCampaigns },
    ] = await Promise.all([
      callsTodayQuery,
      callsYesterdayQuery,
      policiesThisMonthQuery,
      policiesLastMonthQuery,
      appointmentsNextWeekQuery,
      appointmentsPrevWeekQuery,
      activeCampaignsQuery,
    ]);
    
    const callsTrend = calculateTrend(callsToday ?? 0, callsYesterday ?? 0);
    const policiesTrend = calculateTrend(policiesThisMonth ?? 0, policiesLastMonth ?? 0);
    const appointmentsTrend = calculateTrend(appointmentsNext ?? 0, appointmentsPrev ?? 0);
    
    return {
      totalCallsToday: callsToday ?? 0,
      callsTrend: callsTrend.value,
      callsTrendPositive: callsTrend.positive,
      policiesSoldThisMonth: policiesThisMonth ?? 0,
      policiesTrend: policiesTrend.value,
      policiesTrendPositive: policiesTrend.positive,
      appointmentsThisWeek: appointmentsNext ?? 0,
      appointmentsTrend: appointmentsTrend.value,
      appointmentsTrendPositive: appointmentsTrend.positive,
      activeCampaigns: activeCampaigns ?? 0,
    };
  },

  async getFollowUps(userId: string, isAdmin: boolean): Promise<{
    callbacksToday: FollowUpItem[];
    staleLeads: number;
    hotLeadsStale: number;
  }> {
    const ranges = getDateRanges();
    
    // Callbacks today: appointments with type = 'Follow Up' and start_time is today
    let callbacksQuery = supabase
      .from("appointments")
      .select("id, contact_id, contact_name, start_time, type, status")
      .eq("type", "Follow Up")
      .eq("status", "Scheduled")
      .gte("start_time", ranges.todayStart.toISOString())
      .lt("start_time", new Date(ranges.todayStart.getTime() + 86400000).toISOString())
      .order("start_time", { ascending: true })
      .limit(5);
    
    if (!isAdmin) {
      callbacksQuery = callbacksQuery.eq("created_by", userId);
    }
    
    // Stale leads: not contacted in 7+ days
    const staleLeadsQuery = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .or(`last_contacted_at.lt.${ranges.sevenDaysAgo.toISOString()},last_contacted_at.is.null`);
    
    // Hot leads not called in 3+ days
    const hotLeadsQuery = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("lead_score", 7)
      .or(`last_contacted_at.lt.${ranges.threeDaysAgo.toISOString()},last_contacted_at.is.null`);
    
    const [
      { data: callbacks },
      { count: staleLeads },
      { count: hotLeadsStale },
    ] = await Promise.all([
      callbacksQuery,
      staleLeadsQuery,
      hotLeadsQuery,
    ]);
    
    const callbacksToday: FollowUpItem[] = (callbacks ?? []).map((cb) => ({
      id: cb.id,
      firstName: cb.contact_name?.split(" ")[0] || "",
      lastName: cb.contact_name?.split(" ").slice(1).join(" ") || "",
      phone: "",
      time: new Date(cb.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      type: "callback" as const,
      aging: 0,
      leadSource: "",
      leadScore: 0,
    }));
    
    return {
      callbacksToday,
      staleLeads: staleLeads ?? 0,
      hotLeadsStale: hotLeadsStale ?? 0,
    };
  },

  async getTodayAppointments(userId: string, isAdmin: boolean): Promise<TodayAppointment[]> {
    const ranges = getDateRanges();
    const tomorrowStart = new Date(ranges.todayStart.getTime() + 86400000);
    
    let query = supabase
      .from("appointments")
      .select("id, contact_name, start_time, type, status")
      .gte("start_time", ranges.todayStart.toISOString())
      .lt("start_time", tomorrowStart.toISOString())
      .order("start_time", { ascending: true });
    
    if (!isAdmin) {
      query = query.eq("created_by", userId);
    }
    
    const { data } = await query;
    
    return (data ?? []).map((appt) => ({
      id: appt.id,
      contactName: appt.contact_name || "Unknown",
      time: new Date(appt.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      type: appt.type,
      status: appt.status,
    }));
  },

  async getRecentCalls(userId: string, isAdmin: boolean): Promise<RecentCall[]> {
    let query = supabase
      .from("calls")
      .select("id, contact_id, contact_name, contact_phone, duration, disposition_name, started_at")
      .order("started_at", { ascending: false })
      .limit(10);
    
    if (!isAdmin) {
      query = query.eq("agent_id", userId);
    }
    
    const { data } = await query;
    
    // Get disposition colors
    const dispositionNames = [...new Set((data ?? []).map(c => c.disposition_name).filter(Boolean))];
    const { data: dispositions } = await supabase
      .from("dispositions")
      .select("name, color")
      .in("name", dispositionNames.length > 0 ? dispositionNames : ["__none__"]);
    
    const colorMap = new Map((dispositions ?? []).map(d => [d.name, d.color]));
    
    return (data ?? []).map((call) => ({
      id: call.id,
      contactId: call.contact_id,
      contactName: call.contact_name || "Unknown",
      contactPhone: call.contact_phone || "",
      duration: call.duration ?? 0,
      dispositionName: call.disposition_name,
      dispositionColor: colorMap.get(call.disposition_name || "") || "#6B7280",
      startedAt: call.started_at || "",
    }));
  },

  async getCampaignPerformance(): Promise<CampaignPerformance[]> {
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, type, total_leads, leads_contacted, leads_converted")
      .eq("status", "Active")
      .order("created_at", { ascending: false })
      .limit(5);
    
    return (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      totalLeads: c.total_leads ?? 0,
      leadsContacted: c.leads_contacted ?? 0,
      leadsConverted: c.leads_converted ?? 0,
    }));
  },

  async getGoalProgress(userId: string): Promise<GoalProgress[]> {
    const ranges = getDateRanges();
    
    // Get goals from goals table
    const { data: goals } = await supabase
      .from("goals")
      .select("metric, target_value, period");
    
    // Get current values
    const [
      { count: dailyCalls },
      { count: monthlyPolicies },
    ] = await Promise.all([
      supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", userId)
        .gte("started_at", ranges.todayStart.toISOString()),
      supabase
        .from("wins")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", userId)
        .gte("created_at", ranges.monthStart.toISOString()),
    ]);
    
    const goalMap = new Map((goals ?? []).map(g => [g.metric, g]));
    const result: GoalProgress[] = [];
    
    // Map goals to progress
    const metricsConfig: { metric: string; label: string; currentValue: number }[] = [
      { metric: "daily_calls", label: "Daily Calls", currentValue: dailyCalls ?? 0 },
      { metric: "monthly_policies", label: "Monthly Policies", currentValue: monthlyPolicies ?? 0 },
    ];
    
    for (const config of metricsConfig) {
      const goal = goalMap.get(config.metric);
      if (goal) {
        result.push({
          metric: config.metric,
          label: config.label,
          current: config.currentValue,
          target: goal.target_value,
          period: goal.period,
        });
      }
    }
    
    // Add any other goals with 0 progress
    for (const goal of goals ?? []) {
      if (!metricsConfig.find(m => m.metric === goal.metric)) {
        result.push({
          metric: goal.metric,
          label: goal.metric.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
          current: 0,
          target: goal.target_value,
          period: goal.period,
        });
      }
    }
    
    return result;
  },

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const ranges = getDateRanges();
    
    // Get all profiles
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("status", "Active");
    
    // Get wins this month grouped by agent
    const { data: wins } = await supabase
      .from("wins")
      .select("agent_id")
      .gte("created_at", ranges.monthStart.toISOString());
    
    // Count policies per agent
    const policiesByAgent = new Map<string, number>();
    for (const win of wins ?? []) {
      if (!win.agent_id) continue;
      policiesByAgent.set(win.agent_id, (policiesByAgent.get(win.agent_id) ?? 0) + 1);
    }
    
    // Build leaderboard
    const rows = (profiles ?? [])
      .map((profile) => {
        const policies = policiesByAgent.get(profile.id) ?? 0;
        const fullName = `${profile.first_name} ${profile.last_name}`.trim();
        const initials = `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase();
        
        return {
          userId: profile.id,
          name: fullName || "Agent",
          avatar: initials || "AG",
          policies,
        };
      })
      .filter(a => a.policies > 0)
      .sort((a, b) => b.policies - a.policies)
      .slice(0, 5)
      .map((entry, index) => ({
        rank: index + 1,
        userId: entry.userId,
        name: entry.name,
        avatar: entry.avatar,
        calls: 0,
        policies: entry.policies,
        appointments: 0,
        talkTime: "",
        conversionRate: "",
        goalProgress: 0,
      }));
    
    return rows;
  },

  async getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
    const [
      { count: leadsCount },
      { count: callsCount },
      { count: campaignsCount },
      { count: appointmentsCount },
    ] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }),
      supabase.from("calls").select("id", { count: "exact", head: true }).eq("agent_id", userId),
      supabase.from("campaigns").select("id", { count: "exact", head: true }),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("created_by", userId),
    ]);
    
    const hasLeads = (leadsCount ?? 0) > 0;
    const hasCalls = (callsCount ?? 0) > 0;
    const hasCampaigns = (campaignsCount ?? 0) > 0;
    const hasAppointments = (appointmentsCount ?? 0) > 0;
    
    return {
      hasLeads,
      hasCalls,
      hasCampaigns,
      hasAppointments,
      isNewUser: !hasLeads && !hasCalls && !hasCampaigns && !hasAppointments,
    };
  },

  // Keep legacy methods for backwards compat
  async getStats_legacy(): Promise<DashboardStats> {
    return {
      totalCallsToday: 0,
      callsTrend: "",
      policiesSoldThisMonth: 0,
      policiesTrend: "",
      appointmentsThisWeek: 0,
      appointmentsTrend: "",
      activeCampaigns: 0,
    };
  },

  async getFollowUps_legacy() {
    return [];
  },

  async getMissedCalls(userId: string, isAdmin: boolean): Promise<MissedCall[]> {
    const ranges = getDateRanges();
    const tomorrowStart = new Date(ranges.todayStart.getTime() + 86400000);

    let query = supabase
      .from("calls")
      .select("id, contact_id, contact_name, contact_phone, started_at")
      .eq("duration", 0)
      .eq("direction", "inbound")
      .gte("started_at", ranges.todayStart.toISOString())
      .lt("started_at", tomorrowStart.toISOString())
      .order("started_at", { ascending: false })
      .limit(10);

    if (!isAdmin) {
      query = query.eq("agent_id", userId);
    }

    const { data } = await query;

    return (data ?? []).map((call) => ({
      id: call.id,
      contactId: call.contact_id,
      contactName: call.contact_name || "Unknown",
      contactPhone: call.contact_phone || "",
      startedAt: call.started_at || "",
    }));
  },

  async getAnniversaries() {
    return [];
  },

  async getWinFeed(): Promise<WinFeedEntry[]> {
    const { data } = await supabase
      .from("wins")
      .select("id, agent_name, contact_name, campaign_name, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    return (data ?? []).map((win) => ({
      id: win.id,
      agentName: win.agent_name || "Agent",
      contactName: win.contact_name || "Contact",
      campaignName: win.campaign_name,
      createdAt: win.created_at,
    }));
  },

  async getRecentActivity() {
    return [];
  },
};
