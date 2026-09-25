import React from "react";
import { Target, TrendingUp, PhoneCall, ShieldCheck, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/webrtcInboundCaller";
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
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** A month's goals and actuals; throws on a query error (never "No goals configured"). */
async function loadGoalProgress(userId: string, monthStart: Date, signal: AbortSignal): Promise<GoalData> {
  const startOfMonth = monthStart.toISOString();

  const [
    profileRes,
    callsRes,
    winsRes,
    apptsRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("monthly_call_goal, monthly_policies_goal, monthly_appointment_goal, monthly_premium_goal")
      .eq("id", userId)
      .abortSignal(signal)
      .maybeSingle(),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
      .eq("agent_id", userId)
      .gte("created_at", startOfMonth)
      .abortSignal(signal),
    supabase
      .from("wins")
      .select("premium_amount")
      .eq("agent_id", userId)
      .gte("created_at", startOfMonth)
      .abortSignal(signal),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfMonth)
      .not("status", "in", "(Canceled,Cancelled,Rescheduled,canceled,cancelled,rescheduled)")
      .abortSignal(signal),
  ]);
  const failure = [profileRes, callsRes, winsRes, apptsRes].find((r) => r.error);
  if (failure) throw failure.error;

  const p = profileRes.data;
  const callsTarget = Number(p?.monthly_call_goal) || 0;
  const policiesTarget = Number(p?.monthly_policies_goal) || 0;
  const appointmentsMonthTarget = Number(p?.monthly_appointment_goal) || 0;
  const premiumTarget = Number(p?.monthly_premium_goal) || 0;

  const hasGoals =
    callsTarget > 0 || policiesTarget > 0 || appointmentsMonthTarget > 0 || premiumTarget > 0;

  const premiumSold = (winsRes.data ?? []).reduce(
    (sum, w) => sum + (Number(w.premium_amount) || 0),
    0
  );

  return {
    callsMonth: callsRes.count ?? 0,
    callsTarget,
    policiesMonth: winsRes.data?.length ?? 0,
    policiesTarget,
    premiumSold,
    premiumTarget,
    appointmentsMonth: apptsRes.count ?? 0,
    appointmentsMonthTarget,
    hasGoals,
  };
}

const GoalProgressWidget: React.FC<GoalProgressWidgetProps> = ({ userId, refreshSignal, refreshTracker }) => {
  const navigate = useNavigate();
  // The month is part of the scope: last month's progress is never kept as this month's.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // One load at a time; a failed refresh keeps the progress on screen and says so.
  const section = useDashboardSection<GoalData>({
    section: "goal_progress",
    userId,
    scope: monthStart.toISOString(),
    load: (signal) => loadGoalProgress(userId, monthStart, signal),
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
