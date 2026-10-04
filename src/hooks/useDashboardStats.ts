import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { loadPerformanceSummary, summaryScopeKey, type PerformanceSummary } from "@/lib/performanceSummary";
import { usePermissions } from "@/hooks/usePermissions";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import { type DashboardRefreshTracker } from "@/lib/dashboardRefresh";

/** A displayed value is null when its query failed: shown as "—", never a made-up 0. */
export interface StatData {
  performance?: PerformanceSummary;
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
  const { profile } = useAuth();
  const { branding } = useBranding();
  const isFiltered = getDataScope("reports") === "own" || adminToggle === "my";
  const periodKey = summaryScopeKey(timeRange, branding.timezone);
  const loadStats = async (signal: AbortSignal): Promise<StatData> => {
    const result = await loadPerformanceSummary(timeRange, isFiltered ? "own" : "team", isFiltered ? userId! : null, signal);
    if (profile?.organization_id && result.organization_id !== profile.organization_id) throw new Error("Organization changed. Retry.");
    const c = result.current, p = result.previous;
    return { callsToday: c.calls, callsYesterday: p.calls, callsThisMonth: c.calls,
      leadsToday: c.leads, leadsYesterday: p.leads, policiesThisMonth: c.policies, policiesLastMonth: p.policies,
      winsThisMonth: c.policies, appointmentsToday: c.workload, appointmentsYesterday: p.workload,
      premiumThisMonth: c.annual_premium, premiumLastMonth: p.annual_premium, talkTimeMinutes: c.talk_seconds / 60,
      prevLabel: `previous full ${timeRange}`, performance: result };
  };

  // Loads on mount and when the period or perspective changes, and once per
  // Refresh — one load at a time, and never while the tab is hidden or offline.
  // There is no automatic refresh.
  const section = useDashboardSection<StatData>({
    section: "stats",
    userId,
    scope: `${profile?.organization_id}|${isFiltered}|${periodKey}`,
    load: loadStats,
    refreshSignal: refresh.refreshSignal,
    refreshTracker: refresh.refreshTracker,
  });

  return { data: section.data, loading: section.loading, section };
};
