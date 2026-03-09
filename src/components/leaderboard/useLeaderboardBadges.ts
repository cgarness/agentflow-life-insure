import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startOfMonth, subDays, format, startOfDay } from "date-fns";

export interface Badge {
  id: string;
  label: string;
  icon: string; // emoji
  color: string; // tailwind bg class
  description: string;
}

export interface AgentFireStatus {
  level: "none" | "onfire" | "blazing";
  todayCalls: number;
  avgCalls: number;
}

const BADGE_DEFS: Omit<Badge, "id">[] = [
  { id: "onfire", label: "On Fire", icon: "🔥", color: "bg-orange-500/10 text-orange-600 border-orange-500/20", description: "Made calls on 5+ consecutive days" } as any,
  { id: "closer", label: "Closer", icon: "⭐", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", description: "Sold 10+ policies this month" } as any,
  { id: "dialer", label: "Dialer", icon: "📞", color: "bg-blue-500/10 text-blue-600 border-blue-500/20", description: "Made 500+ calls this month" } as any,
  { id: "perfect_week", label: "Perfect Week", icon: "✅", color: "bg-green-500/10 text-green-600 border-green-500/20", description: "Hit 100% of all goals this week" } as any,
  { id: "rising_star", label: "Rising Star", icon: "📈", color: "bg-purple-500/10 text-purple-600 border-purple-500/20", description: "Rank improved by 3+ positions" } as any,
  { id: "first_blood", label: "First Blood", icon: "🎯", color: "bg-teal-500/10 text-teal-600 border-teal-500/20", description: "Made their first ever sale" } as any,
  { id: "top_performer", label: "Top Performer", icon: "👑", color: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20", description: "Ranked #1 for 3+ consecutive weeks" } as any,
];

export async function computeBadges(
  agentIds: string[],
  goalsMap: Record<string, number>,
  agentStats: { id: string; callsMade: number; policiesSold: number; appointmentsSet: number; rank: number; prevRank: number | null; goalProgress: number }[]
): Promise<Map<string, Badge[]>> {
  const result = new Map<string, Badge[]>();
  if (agentIds.length === 0) return result;

  const now = new Date();
  const monthStart = startOfMonth(now).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  // Fetch all calls for streak + lifetime sold computation
  const [recentCallsRes, lifetimeCallsRes, scorecardsRes] = await Promise.all([
    supabase.from("calls").select("agent_id, started_at, disposition_name").gte("started_at", thirtyDaysAgo).in("agent_id", agentIds),
    supabase.from("calls").select("agent_id, disposition_name").in("agent_id", agentIds).or("disposition_name.ilike.%sold%,disposition_name.ilike.%policy%"),
    supabase.from("agent_scorecards").select("agent_id, week_start, policies_sold").in("agent_id", agentIds).order("week_start", { ascending: false }).limit(500),
  ]);

  const recentCalls = recentCallsRes.data || [];
  const lifetimeSold = lifetimeCallsRes.data || [];
  const scorecards = scorecardsRes.data || [];

  for (const agentId of agentIds) {
    const badges: Badge[] = [];
    const stats = agentStats.find(a => a.id === agentId);
    if (!stats) { result.set(agentId, badges); continue; }

    const agentCalls = recentCalls.filter(c => c.agent_id === agentId);

    // 1. Streak badge (5+ consecutive days)
    const callDates = new Set(agentCalls.map(c => format(new Date(c.started_at!), "yyyy-MM-dd")));
    let streak = 0;
    for (let i = 0; i < 30; i++) {
      const d = format(subDays(now, i), "yyyy-MM-dd");
      if (callDates.has(d)) { streak++; } else break;
    }
    if (streak >= 5) {
      badges.push({ id: "onfire", label: "On Fire", icon: "🔥", color: "bg-orange-500/10 text-orange-600 border-orange-500/20", description: `${streak}-day call streak` });
    }

    // 2. Closer (10+ policies this month)
    const monthCalls = agentCalls.filter(c => c.started_at && c.started_at >= monthStart);
    const monthSold = monthCalls.filter(c => c.disposition_name && (/sold/i.test(c.disposition_name) || /policy/i.test(c.disposition_name))).length;
    if (monthSold >= 10) {
      badges.push({ id: "closer", label: "Closer", icon: "⭐", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", description: `${monthSold} policies sold this month` });
    }

    // 3. Dialer (500+ calls this month)
    if (monthCalls.length >= 500) {
      badges.push({ id: "dialer", label: "Dialer", icon: "📞", color: "bg-blue-500/10 text-blue-600 border-blue-500/20", description: `${monthCalls.length} calls this month` });
    }

    // 4. Perfect Week
    if (stats.goalProgress >= 100) {
      badges.push({ id: "perfect_week", label: "Perfect Week", icon: "✅", color: "bg-green-500/10 text-green-600 border-green-500/20", description: "All goals met this week" });
    }

    // 5. Rising Star (rank improved by 3+)
    if (stats.prevRank !== null && (stats.prevRank - stats.rank) >= 3) {
      badges.push({ id: "rising_star", label: "Rising Star", icon: "📈", color: "bg-purple-500/10 text-purple-600 border-purple-500/20", description: `Climbed ${stats.prevRank - stats.rank} positions` });
    }

    // 6. First Blood (first ever sale)
    const totalLifetimeSold = lifetimeSold.filter(c => c.agent_id === agentId).length;
    if (totalLifetimeSold === 1) {
      badges.push({ id: "first_blood", label: "First Blood", icon: "🎯", color: "bg-teal-500/10 text-teal-600 border-teal-500/20", description: "First ever policy sold!" });
    }

    // 7. Top Performer (ranked #1 for 3+ consecutive weeks)
    const agentScorecards = scorecards.filter(s => s.agent_id === agentId);
    // Simple check: find if they had the most policies_sold in 3 consecutive weeks
    let consecutiveTop = 0;
    const weekGroups = new Map<string, typeof scorecards>();
    scorecards.forEach(s => {
      const arr = weekGroups.get(s.week_start) || [];
      arr.push(s);
      weekGroups.set(s.week_start, arr);
    });
    const sortedWeeks = [...weekGroups.keys()].sort().reverse();
    for (const wk of sortedWeeks) {
      const wkData = weekGroups.get(wk)!;
      const maxPolicies = Math.max(...wkData.map(s => s.policies_sold || 0));
      const agentWk = wkData.find(s => s.agent_id === agentId);
      if (agentWk && (agentWk.policies_sold || 0) === maxPolicies && maxPolicies > 0) {
        consecutiveTop++;
      } else break;
    }
    if (consecutiveTop >= 3) {
      badges.push({ id: "top_performer", label: "Top Performer", icon: "👑", color: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20", description: `#1 for ${consecutiveTop} consecutive weeks` });
    }

    result.set(agentId, badges);
  }

  return result;
}

export async function computeFireStatus(agentIds: string[]): Promise<Map<string, AgentFireStatus>> {
  const result = new Map<string, AgentFireStatus>();
  if (agentIds.length === 0) return result;

  const now = new Date();
  const todayStart = startOfDay(now).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const [todayRes, monthRes] = await Promise.all([
    supabase.from("calls").select("agent_id").gte("started_at", todayStart).in("agent_id", agentIds),
    supabase.from("calls").select("agent_id").gte("started_at", thirtyDaysAgo).lt("started_at", todayStart).in("agent_id", agentIds),
  ]);

  const todayCalls = todayRes.data || [];
  const pastCalls = monthRes.data || [];

  for (const agentId of agentIds) {
    const todayCount = todayCalls.filter(c => c.agent_id === agentId).length;
    const pastCount = pastCalls.filter(c => c.agent_id === agentId).length;
    const avgCalls = Math.round(pastCount / 30);

    let level: "none" | "onfire" | "blazing" = "none";
    if (avgCalls > 0) {
      if (todayCount >= avgCalls * 2) level = "blazing";
      else if (todayCount >= avgCalls * 1.5) level = "onfire";
    }

    result.set(agentId, { level, todayCalls: todayCount, avgCalls });
  }

  return result;
}
