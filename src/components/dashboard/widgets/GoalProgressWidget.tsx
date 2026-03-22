import React, { useState, useEffect } from "react";
import { Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

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
}> = ({ current, target, label }) => {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const barColor = pct >= 100 ? "#22C55E" : pct >= 60 ? "#EAB308" : "#EF4444";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {current} / {target} ({Math.round(pct)}%)
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
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
            .from("wins")
            .select("id", { count: "exact", head: true })
            .eq("agent_id", userId)
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
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-1">
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
            <div className="h-2 bg-muted rounded-full animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (!data || !data.hasGoals) {
    return (
      <div className="text-center py-6">
        <Target className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground mb-2">No goals set yet</p>
        <button
          onClick={() => navigate("/settings")}
          className="text-sm text-primary hover:underline"
        >
          Set Goals →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.callsTarget > 0 && (
        <ProgressBar
          current={data.callsToday}
          target={data.callsTarget}
          label="Calls Today"
        />
      )}
      {data.policiesTarget > 0 && (
        <ProgressBar
          current={data.policiesMonth}
          target={data.policiesTarget}
          label="Policies This Month"
        />
      )}
      {data.talkTimeTarget > 0 && (
        <ProgressBar
          current={data.talkTimeMinutes}
          target={data.talkTimeTarget}
          label="Talk Time (min)"
        />
      )}
      {data.callsTarget === 0 && data.policiesTarget === 0 && data.talkTimeTarget === 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">Goals exist but no targets configured yet</p>
          <button
            onClick={() => navigate("/settings")}
            className="text-sm text-primary hover:underline mt-1"
          >
            Configure Goals →
          </button>
        </div>
      )}
    </div>
  );
};

export default GoalProgressWidget;
