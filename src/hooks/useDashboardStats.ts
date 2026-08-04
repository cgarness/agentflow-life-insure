import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/webrtcInboundCaller";
import { usePermissions } from "@/hooks/usePermissions";

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
  const { getDataScope } = usePermissions();
  const reportsScope = getDataScope("reports");
  if (reportsScope === "team") {
    console.warn("[Dashboard] Team scope deferred — falling back to own");
  }
  const isFiltered = reportsScope !== "all" || adminToggle === "my";

  const fetchStats = useCallback(async () => {
    if (!userId) return;
    
    try {
      // Half-open [start, end) throughout. `endOfPeriod` is the EXCLUSIVE start of the
      // NEXT period, and the previous period's exclusive end is the current period's
      // start — so a row on a boundary instant is counted in exactly one period. The
      // old code used inclusive `.lte` bounds fudged with `setMilliseconds(-1)` /
      // `23:59:59`, left the CURRENT period with no upper bound at all, and mutated
      // `today` in place via `today.setDate(diff)`.
      //
      // NOTE: boundaries are still derived in the BROWSER's local timezone. Agency-
      // timezone derivation is Build 2 and is NOT claimed here.
      const now = new Date();
      let startOfPeriod: Date;
      let endOfPeriod: Date;
      let startOfPrevPeriod: Date;
      let prevLabel = "yesterday";

      if (timeRange === "day") {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        startOfPrevPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        prevLabel = "yesterday";
      } else if (timeRange === "week") {
        const day = now.getDay();
        const mondayOffset = now.getDate() - day + (day === 0 ? -6 : 1);
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), mondayOffset);
        endOfPeriod = new Date(now.getFullYear(), now.getMonth(), mondayOffset + 7);
        startOfPrevPeriod = new Date(now.getFullYear(), now.getMonth(), mondayOffset - 7);
        prevLabel = "last week";
      } else if (timeRange === "year") {
        startOfPeriod = new Date(now.getFullYear(), 0, 1);
        endOfPeriod = new Date(now.getFullYear() + 1, 0, 1);
        startOfPrevPeriod = new Date(now.getFullYear() - 1, 0, 1);
        prevLabel = "last year";
      } else {
        startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
        endOfPeriod = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        startOfPrevPeriod = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevLabel = "last month";
      }

      const startStr = startOfPeriod.toISOString();
      const endStr = endOfPeriod.toISOString();
      const startPrevStr = startOfPrevPeriod.toISOString();
      // The previous period ends exactly where the current one begins.
      const endPrevStr = startStr;

      const buildCallQuery = (start: string, end: string) => {
        let q = supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
          .gte("created_at", start)
          .lt("created_at", end);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q;
      };

      // KNOWN INCORRECT SOURCE — reads `clients`, not `wins`. Left as-is on purpose:
      // Policies Sold / Annualized Premium correctness is decision D1 / Build 2 and is
      // NOT claimed by Build 1. Only the date bounds are corrected here.
      const buildSalesQuery = (start: string, end: string) => {
        let q = supabase
          .from("clients")
          .select("id, premium", { count: "exact" })
          .gte("created_at", start)
          .lt("created_at", end);
        if (isFiltered) q = q.eq("assigned_agent_id", userId);
        return q;
      };

      // Still filters `status = 'Scheduled'` and still uses `start_time` (occurrence)
      // rather than `created_at` (booking). The Appointments Set definition is Build 2;
      // Build 1 only adds the missing upper bound.
      const buildApptQuery = (start: string, end: string) => {
        let q = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("status", "Scheduled")
          .gte("start_time", start)
          .lt("start_time", end);
        if (isFiltered) q = q.eq("user_id", userId);
        return q as any;
      };

      const buildLeadsQuery = (start: string, end: string) => {
        let q = supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start)
          .lt("created_at", end);
        if (isFiltered) q = q.eq("assigned_agent_id", userId);
        return q;
      };

      const buildTalkTimeQuery = (start: string, end: string) => {
        let q = supabase
          .from("calls")
          .select("duration")
          .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
          .gte("created_at", start)
          .lt("created_at", end);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q as any;
      };

      const [callsNow, callsPrev, salesNow, salesPrev, apptsNow, apptsPrev, leadsNow, leadsPrev, talkTimeRes] = await Promise.all([
        buildCallQuery(startStr, endStr),
        buildCallQuery(startPrevStr, endPrevStr),
        buildSalesQuery(startStr, endStr),
        buildSalesQuery(startPrevStr, endPrevStr),
        buildApptQuery(startStr, endStr),
        buildApptQuery(startPrevStr, endPrevStr),
        buildLeadsQuery(startStr, endStr),
        buildLeadsQuery(startPrevStr, endPrevStr),
        buildTalkTimeQuery(startStr, endStr),
      ]);

      const premiumNow = (salesNow.data as any[])?.reduce((sum, s) => sum + (Number(s.premium) || 0), 0) ?? 0;
      const premiumPrev = (salesPrev.data as any[])?.reduce((sum, s) => sum + (Number(s.premium) || 0), 0) ?? 0;
      
      // `Math.round(undefined / 60)` is NaN, and `NaN ?? 0` is still NaN because `??`
      // only catches null/undefined — so an empty result rendered a literal "NaN".
      const talkTimeSeconds = (talkTimeRes.data as any[] | null)?.reduce(
        (sum, c) => sum + (Number(c.duration) || 0),
        0,
      ) ?? 0;
      const talkTimeMinutes = Math.round(talkTimeSeconds / 60);

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
