import React, { useState, useEffect } from "react";
import { Target, TrendingUp, PhoneCall, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

interface GoalProgressWidgetProps {
  userId: string;
}

interface GoalData {
  callsToday: number;
  callsTarget: number;
  policiesMonth: number;
  policiesTarget: number;
  talkTimeMinutes: number;
  talkTimeTarget: number;
  hasGoals: boolean;
}

const ProgressBar: React.FC<{
  current: number;
  target: number;
  label: string;
  icon: React.ElementType;
  gradient: string;
}> = ({ current, target, label, icon: Icon, gradient }) => {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  
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
          {current} / {target}
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

const GoalProgressWidget: React.FC<GoalProgressWidgetProps> = ({ userId }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGoals = async () => {
      try {
        const now = new Date();
        const todayStr = now.toISOString().split("T")[0];
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const startOfDay = `${todayStr}T00:00:00`;

        const [goalsResult, callsResult, winsResult, talkTimeResult] = await Promise.all([
          supabase.from("goals").select("*"),
          supabase
            .from("calls")
            .select("id", { count: "exact", head: true })
            .eq("agent_id", userId)
            .gte("created_at", startOfDay),
          supabase
            .from("clients")
            .select("id", { count: "exact", head: true })
            .eq("assigned_agent_id", userId)
            .gte("created_at", startOfMonth),
          supabase
            .from("calls")
            .select("duration")
            .eq("agent_id", userId)
            .gte("created_at", startOfMonth),
        ]);

        const goals = goalsResult.data ?? [];
        if (goals.length === 0) {
          setData({ callsToday: 0, callsTarget: 0, policiesMonth: 0, policiesTarget: 0, talkTimeMinutes: 0, talkTimeTarget: 0, hasGoals: false });
          setLoading(false);
          return;
        }

        const findTarget = (metric: string) => {
          const g = goals.find((goal) => goal.metric === metric);
          return g?.target_value ?? 0;
        };

        const talkTimeMinutes = Math.round(
          (talkTimeResult.data ?? []).reduce(
            (sum, c) => sum + (c.duration ?? 0),
            0
          ) / 60
        );

        setData({
          callsToday: callsResult.count ?? 0,
          callsTarget: findTarget("calls_daily") || findTarget("calls"),
          policiesMonth: winsResult.count ?? 0,
          policiesTarget: findTarget("policies_monthly") || findTarget("policies"),
          talkTimeMinutes,
          talkTimeTarget: findTarget("talk_time_monthly") || findTarget("talk_time"),
          hasGoals: true,
        });
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    };
    fetchGoals();
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
      {data.talkTimeTarget > 0 && (
        <ProgressBar
          current={data.talkTimeMinutes}
          target={data.talkTimeTarget}
          label="Total Talk Time"
          icon={TrendingUp}
          gradient="premium-gradient-violet"
        />
      )}
      
      {data.callsTarget === 0 && data.policiesTarget === 0 && data.talkTimeTarget === 0 && (
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
