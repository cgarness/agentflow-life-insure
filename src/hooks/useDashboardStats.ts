import { supabase } from "@/integrations/supabase/client";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/webrtcInboundCaller";
import { usePermissions } from "@/hooks/usePermissions";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import { type DashboardRefreshTracker, DashboardSectionError } from "@/lib/dashboardRefresh";

/** A displayed value is null when its query failed: shown as "—", never a made-up 0. */
export interface StatData {
  callsToday: number | null;
  callsYesterday: number | null;
  leadsToday: number;
  leadsYesterday: number;
  policiesThisMonth: number | null;
  policiesLastMonth: number | null;
  appointmentsToday: number | null;
  appointmentsYesterday: number | null;
  callsThisMonth: number | null;
  winsThisMonth: number | null;
  premiumThisMonth: number | null;
  premiumLastMonth: number | null;
  talkTimeMinutes: number;
  prevLabel: string;
}

type StatsRange = "day" | "week" | "month" | "year";

/** The selected period and the one before it (browser-local calendar). */
function statsPeriod(timeRange: StatsRange, now: Date) {
  // Half-open [start, end) throughout. `endOfPeriod` is the EXCLUSIVE start of the
  // NEXT period, and the previous period's exclusive end is the current period's
  // start — so a row on a boundary instant is counted in exactly one period. The
  // old code used inclusive `.lte` bounds fudged with `setMilliseconds(-1)` /
  // `23:59:59`, left the CURRENT period with no upper bound at all, and mutated
  // `today` in place via `today.setDate(diff)`.
  //
  // NOTE: boundaries are still derived in the BROWSER's local timezone. Agency-
  // timezone derivation is Build 2 and is NOT claimed here.
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
  return { startOfPeriod, endOfPeriod, startOfPrevPeriod, prevLabel };
}

export interface DashboardRefreshInput {
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
}

export const useDashboardStats = (
  userId: string | undefined,
  role: string,
  adminToggle: "team" | "my",
  timeRange: StatsRange = "month",
  refresh: DashboardRefreshInput = {},
) => {
  const { getDataScope } = usePermissions();
  const reportsScope = getDataScope("reports");
  if (reportsScope === "team") {
    console.warn("[Dashboard] Team scope deferred — falling back to own");
  }
  const isFiltered = reportsScope !== "all" || adminToggle === "my";

  // Computed per render, so a Refresh after midnight (or a week / month / year
  // boundary) is a NEW selection: yesterday's numbers are never kept as "today's".
  const period = statsPeriod(timeRange, new Date());

  const loadStats = async (signal: AbortSignal): Promise<StatData> => {
    try {
      const { startOfPeriod, endOfPeriod, startOfPrevPeriod, prevLabel } = period;
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
        return q.abortSignal(signal);
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
        return q.abortSignal(signal);
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
        return q.abortSignal(signal) as any;
      };

      const buildLeadsQuery = (start: string, end: string) => {
        let q = supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .gte("created_at", start)
          .lt("created_at", end);
        if (isFiltered) q = q.eq("assigned_agent_id", userId);
        return q.abortSignal(signal);
      };

      const buildTalkTimeQuery = (start: string, end: string) => {
        let q = supabase
          .from("calls")
          .select("duration")
          .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
          .gte("created_at", start)
          .lt("created_at", end);
        if (isFiltered) q = q.eq("agent_id", userId);
        return q.abortSignal(signal) as any;
      };

      const results = await Promise.all([
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
      const [callsNow, callsPrev, salesNow, salesPrev, apptsNow, apptsPrev, leadsNow, leadsPrev, talkTimeRes] = results;

      // A displayed value whose query failed is null ("—"), never a made-up 0.
      const countOf = (r: { count?: number | null; error?: unknown }) => (r.error ? null : r.count ?? 0);
      const premiumOf = (r: { data?: unknown; error?: unknown }) =>
        r.error ? null : ((r.data as any[])?.reduce((sum, s) => sum + (Number(s.premium) || 0), 0) ?? 0) * 12;
      
      // `Math.round(undefined / 60)` is NaN, and `NaN ?? 0` is still NaN because `??`
      // only catches null/undefined — so an empty result rendered a literal "NaN".
      const talkTimeSeconds = (talkTimeRes.data as any[] | null)?.reduce(
        (sum, c) => sum + (Number(c.duration) || 0),
        0,
      ) ?? 0;
      const talkTimeMinutes = Math.round(talkTimeSeconds / 60);

      const stats: StatData = {
        callsToday: countOf(callsNow),
        callsYesterday: countOf(callsPrev),
        leadsToday: leadsNow.count ?? 0,
        leadsYesterday: leadsPrev.count ?? 0,
        policiesThisMonth: countOf(salesNow),
        policiesLastMonth: countOf(salesPrev),
        appointmentsToday: countOf(apptsNow),
        appointmentsYesterday: countOf(apptsPrev),
        callsThisMonth: countOf(callsNow),
        winsThisMonth: countOf(salesNow),
        premiumThisMonth: premiumOf(salesNow),
        premiumLastMonth: premiumOf(salesPrev),
        talkTimeMinutes,
        prevLabel,
      };
      // supabase-js resolves (does not throw) on a query error. Only the queries
      // the cards display count (leads / talk time failing is still a success). A
      // failed Refresh of the SAME selection keeps the numbers already on screen
      // and says so; with nothing on screen, the values that did load are shown
      // (failed ones as "—"), flagged as incomplete — and nothing at all when
      // every displayed query failed.
      const displayedFailures = results.slice(0, 6).filter((r: { error?: unknown }) => r.error);
      if (displayedFailures.length > 0) {
        const fallback = displayedFailures.length < 6 ? { data: stats } : undefined;
        throw new DashboardSectionError("Dashboard stats failed", fallback, displayedFailures[0].error);
      }
      return stats;
    } catch (err) {
      console.error("Error fetching dashboard stats:", err);
      throw err;
    }
  };

  // Loads on mount and when the period or perspective changes, and once per
  // Refresh — one load at a time, and never while the tab is hidden or offline.
  // There is no automatic refresh.
  const section = useDashboardSection<StatData>({
    section: "stats",
    userId,
    scope: `${isFiltered}|${timeRange}|${period.startOfPeriod.toISOString()}`,
    load: loadStats,
    refreshSignal: refresh.refreshSignal,
    refreshTracker: refresh.refreshTracker,
  });

  return { data: section.data, loading: section.loading, section };
};
