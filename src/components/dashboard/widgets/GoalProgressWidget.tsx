import React, { useState, useEffect } from "react";
import { Target, TrendingUp, PhoneCall, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { StatData } from "@/hooks/useDashboardStats";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/webrtcInboundCaller";

interface GoalProgressWidgetProps {
  userId: string;
  stats?: StatData | null;
}

interface GoalData {
  callsToday: number;
  callsTarget: number;
  policiesMonth: number;
  policiesTarget: number;
  premiumSold: number;
  premiumTarget: number;
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
          {/* Shimmer effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-full animate-shimmer" style={{ backgroundSize: "200% 100%" }} />
        </motion.div>
      </div>
    </div>
  );
};

const fmtCurrency = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const GoalProgressWidget: React.FC<GoalProgressWidgetProps> = ({ userId, stats }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGoalsAndStats = async () => {
      if (!userId) return;

      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        // Always fetch goals + current-month premium from wins
        const [goalsRes, winsRes] = await Promise.all([
          supabase.from("goals").select("*"),
          supabase
            .from("wins")
            .select("premium_amount")
            .eq("agent_id", userId)
            .gte("created_at", startOfMonth),
        ]);

        if (goalsRes.error) throw goalsRes.error;
        const goals = goalsRes.data ?? [];

        if (goals.length === 0) {
          setData({ callsToday: 0, callsTarget: 0, policiesMonth: 0, policiesTarget: 0, premiumSold: 0, premiumTarget: 0, hasGoals: false });
          setLoading(false);
          return;
        }

        const findTarget = (metric: string) => {
          const g = goals.find((goal) => goal.metric === metric);
          return g?.target_value ?? 0;
        };

        const premiumSold = (winsRes.data ?? []).reduce(
          (sum, w) => sum + (Number(w.premium_amount) || 0),
          0
        );

        // Use stats from parent when available to avoid redundant network calls
        if (stats) {
          setData({
            callsToday: stats.callsToday,
            callsTarget: findTarget("Daily Calls"),
            policiesMonth: stats.policiesThisMonth,
            policiesTarget: findTarget("Monthly Policies"),
            premiumSold,
            premiumTarget: findTarget("Monthly Premium"),
            hasGoals: true,
          });
          setLoading(false);
          return;
        }

        // Fallback for independent use
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

        const [callsResult, winsResult] = await Promise.all([
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
        ]);

        setData({
          callsToday: callsResult.count ?? 0,
          callsTarget: findTarget("Daily Calls"),
          policiesMonth: winsResult.count ?? 0,
          policiesTarget: findTarget("Monthly Policies"),
          premiumSold,
          premiumTarget: findTarget("Monthly Premium"),
          hasGoals: true,
        });
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    };
    fetchGoalsAndStats();
  }, [userId, stats]);

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
          onClick={() => navigate("/settings")}
          className="text-xs font-bold text-primary hover:text-primary/80 uppercase tracking-widest bg-primary/5 px-4 py-2 rounded-xl transition-all"
        >
          Configure Goals
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

      {data.callsTarget === 0 && data.policiesTarget === 0 && data.premiumTarget === 0 && (
        <div className="text-center py-4 bg-muted/20 rounded-xl border border-dashed border-muted-foreground/20">
          <p className="text-xs font-medium text-muted-foreground px-4">Targets are not yet configured for your metrics</p>
          <button
            onClick={() => navigate("/settings")}
            className="text-[10px] font-bold text-primary hover:underline mt-2 uppercase tracking-widest"
          >
            Go to Settings
          </button>
        </div>
      )}
    </div>
  );
};

export default GoalProgressWidget;
