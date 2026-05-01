import React, { useState, useEffect } from "react";
import { Target, TrendingUp, PhoneCall, ShieldCheck, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/webrtcInboundCaller";

interface GoalProgressWidgetProps {
  userId: string;
}

interface GoalData {
  callsToday: number;
  callsTarget: number;
  policiesMonth: number;
  policiesTarget: number;
  premiumSold: number;
  premiumTarget: number;
  appointmentsWeek: number;
  appointmentsWeekTarget: number;
  hasGoals: boolean;
}

function startOfIsoWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
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

const GoalProgressWidget: React.FC<GoalProgressWidgetProps> = ({ userId }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGoalsAndActuals = async () => {
      if (!userId) return;

      try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const weekStart = startOfIsoWeek(now).toISOString();

        const [
          profileRes,
          callsRes,
          policiesRes,
          winsRes,
          apptsRes,
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("monthly_call_goal, monthly_policies_goal, weekly_appointment_goal, monthly_premium_goal")
            .eq("id", userId)
            .maybeSingle(),
          supabase
            .from("calls")
            .select("id", { count: "exact", head: true })
            .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
            .eq("agent_id", userId)
            .gte("created_at", startOfDay),
          supabase
            .from("clients")
            .select("id", { count: "exact", head: true })
            .eq("assigned_agent_id", userId)
            .gte("created_at", startOfMonth),
          supabase
            .from("wins")
            .select("premium_amount")
            .eq("agent_id", userId)
            .gte("created_at", startOfMonth),
          supabase
            .from("appointments")
            .select("id", { count: "exact", head: true })
            .eq("status", "Scheduled")
            .eq("user_id", userId)
            .gte("start_time", weekStart),
        ]);

        const p = profileRes.data;
        const callsTarget = Number(p?.monthly_call_goal) || 0;
        const policiesTarget = Number(p?.monthly_policies_goal) || 0;
        const appointmentsWeekTarget = Number(p?.weekly_appointment_goal) || 0;
        const premiumTarget = Number(p?.monthly_premium_goal) || 0;

        const hasGoals =
          callsTarget > 0 || policiesTarget > 0 || appointmentsWeekTarget > 0 || premiumTarget > 0;

        const premiumSold = (winsRes.data ?? []).reduce(
          (sum, w) => sum + (Number(w.premium_amount) || 0),
          0
        );

        setData({
          callsToday: callsRes.count ?? 0,
          callsTarget,
          policiesMonth: policiesRes.count ?? 0,
          policiesTarget,
          premiumSold,
          premiumTarget,
          appointmentsWeek: apptsRes.count ?? 0,
          appointmentsWeekTarget,
          hasGoals,
        });
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    };
    fetchGoalsAndActuals();
  }, [userId]);

  if (loading) {
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

  if (!data || !data.hasGoals) {
    return (
      <div className="text-center py-10 flex flex-col items-center">
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
      {data.callsTarget > 0 && (
        <ProgressBar
          current={data.callsToday}
          target={data.callsTarget}
          label="Daily Calls"
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
      {data.appointmentsWeekTarget > 0 && (
        <ProgressBar
          current={data.appointmentsWeek}
          target={data.appointmentsWeekTarget}
          label="Weekly Appointments"
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
