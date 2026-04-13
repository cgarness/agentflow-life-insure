import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/telnyxInboundCaller";

export interface StatData {
  callsToday: number;
  callsYesterday: number;
  leadsToday: number;
  leadsYesterday: number;
  policiesThisMonth: number;
  policiesLastMonth: number;
  appointmentsToday: number;
  appointmentsYesterday: number;
  callsThisMonth: number;
  winsThisMonth: number;
  premiumThisMonth: number;
  premiumLastMonth: number;
  talkTimeMinutes: number;
  prevLabel: string;
}

export const useDashboardStats = (
  userId: string | undefined,
  role: string,
  adminToggle: "team" | "my",
  timeRange: "day" | "week" | "month" | "year" = "month"
) => {
  const [data, setData] = useState<StatData | null>(null);
  const [loading, setLoading] = useState(true);

  const isFiltered = (role !== "Admin" && role !== "Team Leader") || adminToggle === "my";

  const fetchStats = useCallback(async () => {
    if (!userId) return;
    
    try {
      const now = new Date();
      let startOfPeriod = new Date();
      let startOfPrevPeriod = new Date();
      let endOfPrevPeriod = new Date();
      let prevLabel = "yesterday";

      if (timeRange === "day") {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startOfPrevPeriod = new Date(startOfPeriod);
        startOfPrevPeriod.setDate(startOfPrevPeriod.getDate() - 1);
        endOfPrevPeriod = new Date(startOfPeriod);
        endOfPrevPeriod.setMilliseconds(-1);
        prevLabel = "yesterday";
      } else if (timeRange === "week") {
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        startOfPeriod = new Date(today.setDate(diff));
        startOfPeriod.setHours(0, 0, 0, 0);
        startOfPrevPeriod = new Date(startOfPeriod);
        startOfPrevPeriod.setDate(startOfPrevPeriod.getDate() - 7);
        endOfPrevPeriod = new Date(startOfPeriod);
        endOfPrevPeriod.setMilliseconds(-1);
        prevLabel = "last week";
      } else if (timeRange === "month") {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfPrevPeriod = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endOfPrevPeriod = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        prevLabel = "last month";
      } else if (timeRange === "year") {
        startOfPeriod = new Date(now.getFullYear(), 0, 1);
        startOfPrevPeriod = new Date(now.getFullYear() - 1, 0, 1);
        endOfPrevPeriod = new Date(now.getFullYear(), 0, 0, 23, 59, 59);
        prevLabel = "last year";
      }

      const startStr = startOfPeriod.toISOString();
      const startPrevStr = startOfPrevPeriod.toISOString();
      const endPrevStr = endOfPrevPeriod.toISOString();

      const buildCallQuery = (start: string, end?: string) => {
        let q = supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
          .gte("created_at", start);
        if (end) q = q.lte("created_at", end);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q;
      };

      const buildSalesQuery = (start: string, end?: string) => {
        let q = supabase
          .from("clients")
          .select("id, premium", { count: "exact" })
          .gte("created_at", start);
        if (end) q = q.lte("created_at", end);
        if (isFiltered) q = q.eq("assigned_agent_id", userId);
        return q;
      };

      const buildApptQuery = (start: string, end?: string) => {
        let q = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("status", "Scheduled")
          .gte("start_time", start);
        if (end) q = q.lte("start_time", end);
        if (isFiltered) q = q.eq("user_id", userId);
        return q as any;
      };

      const buildLeadsQuery = (start: string, end?: string) => {
        let q = supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start);
        if (end) q = q.lte("created_at", end);
        if (isFiltered) q = q.eq("assigned_agent_id", userId);
        return q;
      };

      const buildTalkTimeQuery = (start: string) => {
        let q = supabase
          .from("calls")
          .select("duration")
          .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
          .gte("created_at", start);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q as any;
      };

      const [callsNow, callsPrev, salesNow, salesPrev, apptsNow, apptsPrev, leadsNow, leadsPrev, talkTimeRes] = await Promise.all([
        buildCallQuery(startStr),
        buildCallQuery(startPrevStr, endPrevStr),
        buildSalesQuery(startStr),
        buildSalesQuery(startPrevStr, endPrevStr),
        buildApptQuery(startStr),
        buildApptQuery(startPrevStr, endPrevStr),
        buildLeadsQuery(startStr),
        buildLeadsQuery(startPrevStr, endPrevStr),
        buildTalkTimeQuery(startStr),
      ]);

      const premiumNow = (salesNow.data as any[])?.reduce((sum, s) => sum + (Number(s.premium) || 0), 0) ?? 0;
      const premiumPrev = (salesPrev.data as any[])?.reduce((sum, s) => sum + (Number(s.premium) || 0), 0) ?? 0;
      
      const talkTimeMinutes = Math.round(
        (talkTimeRes.data as any[])?.reduce((sum, c) => sum + (Number(c.duration) || 0), 0) / 60
      ) ?? 0;

      setData({
        callsToday: callsNow.count ?? 0,
        callsYesterday: callsPrev.count ?? 0,
        leadsToday: leadsNow.count ?? 0,
        leadsYesterday: leadsPrev.count ?? 0,
        policiesThisMonth: salesNow.count ?? 0,
        policiesLastMonth: salesPrev.count ?? 0,
        appointmentsToday: apptsNow.count ?? 0,
        appointmentsYesterday: apptsPrev.count ?? 0,
        callsThisMonth: callsNow.count ?? 0,
        winsThisMonth: salesNow.count ?? 0,
        premiumThisMonth: premiumNow * 12,
        premiumLastMonth: premiumPrev * 12,
        talkTimeMinutes,
        prevLabel,
      });
    } catch (err) {
      console.error("Error fetching dashboard stats:", err);
    } finally {
      setLoading(false);
    }
  }, [userId, isFiltered, timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchStats();
    // Auto-refresh every 2 minutes for a balance of freshness vs network load
    const interval = setInterval(fetchStats, 120000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return { data, loading, refresh: fetchStats };
};
