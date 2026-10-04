import { useBranding } from "@/contexts/BrandingContext";
import { useAuth } from "@/contexts/AuthContext";
import { loadPerformanceSummary, summaryScopeKey } from "@/lib/performanceSummary";
import React from "react";
import { Target, TrendingUp, PhoneCall, ShieldCheck, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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
  premiumSold: number;
  premiumTarget: number;
  appointmentsMonth: number;
  appointmentsMonthTarget: number;
  hasGoals: boolean;
  unknownPremiums: number;
  timeZone: string;
}

const ProgressBar: React.FC<{
  current: number;
  target: number;
  label: string;
  icon: React.ElementType;
  gradient: string;
  formatValue?: (v: number) => string;
}> = ({ current, target, label, icon: Icon, gradient, formatValue }) => {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const fmt = formatValue ?? ((v: number) => String(v));

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end px-1">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg bg-card border border-border shadow-sm`}>
            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">{label}</span>
        </div>
        <span className="text-[10px] font-bold text-muted-foreground tabular-nums bg-muted/50 px-2 py-0.5 rounded-full">
          {fmt(current)} / {fmt(target)}
        </span>
      </div>
      <div className="relative h-3 bg-muted/30 rounded-full overflow-hidden border border-white/5 shadow-inner">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-full rounded-full ${gradient} relative shadow-[0_0_10px_rgba(0,0,0,0.1)]`}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-full animate-shimmer" style={{ backgroundSize: "200% 100%" }} />
        </motion.div>
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
    premiumSold: summary.current.monthly_premium,
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
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-32 bg-muted rounded animate-pulse" />
            <div className="h-3 bg-muted rounded-full animate-pulse" />
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
        <div className="w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <Target className="w-8 h-8 text-muted-foreground opacity-50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium mb-4">No goals configured</p>
        <button
          type="button"
          onClick={() => navigate("/settings?section=my-profile")}
          className="text-xs font-bold text-primary hover:text-primary/80 uppercase tracking-widest bg-primary/5 px-4 py-2 rounded-xl transition-all"
        >
          Configure goals in My Profile
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notice}
      <p className="text-xs text-muted-foreground">{data.timeZone} · {data.unknownPremiums ? `${data.unknownPremiums} policies have unknown premium; premium progress is incomplete.` : "Month to date"}</p>
      {data.callsTarget > 0 && (
        <ProgressBar
          current={data.callsMonth}
          target={data.callsTarget}
          label="Monthly Calls"
          icon={PhoneCall}
          gradient="premium-gradient-blue"
        />
      )}
      {data.policiesTarget > 0 && (
        <ProgressBar
          current={data.policiesMonth}
          target={data.policiesTarget}
          label="Monthly Policies"
          icon={ShieldCheck}
          gradient="premium-gradient-emerald"
        />
      )}
      {data.appointmentsMonthTarget > 0 && (
        <ProgressBar
          current={data.appointmentsMonth}
          target={data.appointmentsMonthTarget}
          label="Monthly Appointments"
          icon={Calendar}
          gradient="premium-gradient-amber"
        />
      )}
      {data.premiumTarget > 0 && (
        <ProgressBar
          current={data.premiumSold}
          target={data.premiumTarget}
          label="Monthly Premium"
          icon={TrendingUp}
          gradient="premium-gradient-violet"
          formatValue={fmtCurrency}
        />
      )}
    </div>
  );
};

export default GoalProgressWidget;
