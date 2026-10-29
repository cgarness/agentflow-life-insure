import { useBranding } from "@/contexts/BrandingContext";
import { useAuth } from "@/contexts/AuthContext";
import { loadPerformanceSummary, summaryScopeKey } from "@/lib/performanceSummary";
import { isPremiumWhollyUnknown } from "@/lib/premiumAvailability";
import React from "react";
import { Target, TrendingUp, PhoneCall, ShieldCheck, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { DASHBOARD_TONES, type DashboardTone } from "@/components/dashboard/ui/dashboardTones";
import { useDashboardSection } from "@/hooks/useDashboardSection";
import type { DashboardRefreshTracker } from "@/lib/dashboardRefresh";
import { DashboardSectionNotice, DashboardSectionUnavailable } from "@/components/dashboard/DashboardSectionNotice";

interface GoalProgressWidgetProps {
  userId: string;
  /** Incremented by the Dashboard's Refresh control. */
  refreshSignal?: number;
  refreshTracker?: DashboardRefreshTracker | null;
}

interface GoalData {
  callsMonth: number;
  callsTarget: number;
  policiesMonth: number;
  policiesTarget: number;
  /** Null when every premium this month is unknown (D14): progress is unavailable, not $0. */
  premiumSold: number | null;
  premiumTarget: number;
  appointmentsMonth: number;
  appointmentsMonthTarget: number;
  hasGoals: boolean;
  unknownPremiums: number;
  timeZone: string;
}

const ProgressBar: React.FC<{
  current: number | null;
  target: number;
  label: string;
  icon: React.ElementType;
  tone: DashboardTone;
  formatValue?: (v: number) => string;
}> = ({ current, target, label, icon: Icon, tone, formatValue }) => {
  const reduceMotion = useReducedMotion();
  const pct = current !== null && target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const fmt = formatValue ?? ((v: number) => String(v));
  const valueText = `${current === null ? "Unavailable" : fmt(current)} / ${fmt(target)}`;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end gap-2 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${DASHBOARD_TONES[tone].soft}`}>
            <Icon className={`h-3.5 w-3.5 ${DASHBOARD_TONES[tone].text}`} aria-hidden="true" />
          </span>
          <span className="break-words text-xs font-bold text-foreground uppercase tracking-wider">{label}</span>
        </div>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums bg-muted/50 px-2 py-0.5 rounded-full">
          {valueText}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={current === null ? undefined : Math.round(pct)}
        aria-valuetext={current === null ? "Unavailable" : `${Math.round(pct)}% (${valueText})`}
        className="relative h-3 bg-muted/40 rounded-full overflow-hidden border border-border/40"
      >
        {current !== null && <motion.div
          initial={{ width: reduceMotion ? `${pct}%` : 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }}
          className={`h-full rounded-full ${DASHBOARD_TONES[tone].chip}`}
        />}
      </div>
    </div>
  );
};

const fmtCurrency = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A month's goals and actuals; throws on a query error (never "No goals configured"). */
async function loadGoalProgress(userId: string, signal: AbortSignal): Promise<GoalData> {
  const [profileRes, summary] = await Promise.all([
    supabase.from("profiles").select("monthly_call_goal, monthly_policies_goal, monthly_appointment_goal, monthly_premium_goal")
      .eq("id", userId).abortSignal(signal).maybeSingle(),
    loadPerformanceSummary("month", "own", userId, signal),
  ]);
  if (profileRes.error) throw profileRes.error;
  const p = profileRes.data;
  const callsTarget = Number(p?.monthly_call_goal) || 0;
  const policiesTarget = Number(p?.monthly_policies_goal) || 0;
  const appointmentsMonthTarget = Number(p?.monthly_appointment_goal) || 0;
  const premiumTarget = Number(p?.monthly_premium_goal) || 0;

  const hasGoals =
    callsTarget > 0 || policiesTarget > 0 || appointmentsMonthTarget > 0 || premiumTarget > 0;


  return {
    callsMonth: summary.current.calls,
    callsTarget,
    policiesMonth: summary.current.policies,
    policiesTarget,
    premiumSold: isPremiumWhollyUnknown(summary.current.policies, summary.current.unknown_premiums) ? null : summary.current.monthly_premium,
    premiumTarget,
    appointmentsMonth: summary.current.bookings,
    appointmentsMonthTarget,
    hasGoals,
    unknownPremiums: summary.current.unknown_premiums, timeZone: summary.time_zone,
  };
}

const GoalProgressWidget: React.FC<GoalProgressWidgetProps> = ({ userId, refreshSignal, refreshTracker }) => {
  const navigate = useNavigate();
  // The month is part of the scope: last month's progress is never kept as this month's.
  const { branding } = useBranding();
  const { profile } = useAuth();
  const periodKey = summaryScopeKey("month", branding.timezone);
  // One load at a time; a failed refresh keeps the progress on screen and says so.
  const section = useDashboardSection<GoalData>({
    section: "goal_progress",
    userId,
    scope: `${profile?.organization_id}|${periodKey}`,
    load: (signal) => loadGoalProgress(userId, signal),
    refreshSignal,
    refreshTracker,
  });
  const data = section.data;
  const notice = <DashboardSectionNotice state={section} label="goal progress" className="mb-3" />;

  if (section.loading) {
    return (
      <div className="space-y-6" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-32 bg-muted rounded animate-pulse motion-reduce:animate-none" />
            <div className="h-3 bg-muted rounded-full animate-pulse motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) return <DashboardSectionUnavailable state={section} label="goal progress" />;

  if (!data.hasGoals) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
        {notice}
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
          <Target className="w-7 h-7 text-emerald-600 dark:text-emerald-400 opacity-70" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground font-medium mb-4">No goals configured</p>
        <button
          type="button"
          onClick={() => navigate("/settings?section=my-profile")}
          className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 uppercase tracking-widest bg-emerald-500/5 px-4 py-2 rounded-xl transition-colors motion-reduce:transition-none"
        >
          Configure goals in My Profile
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notice}
      <p className="text-xs text-muted-foreground">{data.unknownPremiums ? `${data.unknownPremiums} policies have unknown premium; premium progress is incomplete.` : "Month to date"}</p>
      {/* Each bar in its category tone: calls blue, policies green, appointments purple, premium gold. */}
      {([
        { label: "Monthly Calls", current: data.callsMonth, target: data.callsTarget, icon: PhoneCall, tone: "blue" },
        { label: "Monthly Policies", current: data.policiesMonth, target: data.policiesTarget, icon: ShieldCheck, tone: "green" },
        { label: "Monthly Appointments", current: data.appointmentsMonth, target: data.appointmentsMonthTarget, icon: Calendar, tone: "purple" },
        { label: "Monthly Premium", current: data.premiumSold, target: data.premiumTarget, icon: TrendingUp, tone: "gold", formatValue: fmtCurrency },
      ] as const).filter((bar) => bar.target > 0).map((bar) => <ProgressBar key={bar.label} {...bar} />)}
    </div>
  );
};

export default GoalProgressWidget;
