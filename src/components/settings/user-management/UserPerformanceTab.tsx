import React from "react";
import { Clock, Percent, PhoneCall, ShieldCheck, Target, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { goalColor } from "./userManagementUtils";

interface Props {
  performance: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  perfLoading: boolean;
  form: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const UserPerformanceTab: React.FC<Props> = ({ performance, perfLoading, form }) => {
  if (perfLoading) {
    return (
      <div className="space-y-3 mt-0">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (!performance) {
    return (
      <div className="py-12 text-center border rounded-lg bg-accent/10 mt-0">
        <p className="text-sm text-muted-foreground">Data failed to load. Please try again.</p>
      </div>
    );
  }

  const stats = [
    { label: "Calls Made", value: performance.callsMonthly, icon: PhoneCall, color: "text-blue-500" },
    { label: "Policies Sold", value: performance.policiesMonthly, icon: ShieldCheck, color: "text-emerald-500" },
    { label: "Apps Set", value: performance.appsWeekly, icon: Users, color: "text-amber-500" },
    { label: "Talk Time", value: `${performance.talkTimeMonthlyHours.toFixed(1)}h`, icon: Clock, color: "text-purple-500" },
    { label: "Conv. Rate", value: performance.conversionRate, icon: Percent, color: "text-rose-500" },
  ];

  const goals = [
    { label: "Monthly Calls", actual: performance.callsMonthly, target: form.monthlyCallGoal as number },
    { label: "Monthly Policies", actual: performance.policiesMonthly, target: form.monthlyPoliciesGoal as number },
    { label: "Weekly Appointments", actual: performance.appsWeekly, target: form.weeklyAppointmentGoal as number },
  ];

  return (
    <div className="space-y-6 mt-0">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {stats.map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-accent/40 rounded-xl p-3.5 border border-white/5 shadow-sm group hover:bg-accent/60 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-3.5 h-3.5 ${s.color} opacity-75`} />
                <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">{s.label}</p>
              </div>
              <p className="text-xl font-black text-foreground tabular-nums tracking-tight">{s.value}</p>
            </div>
          );
        })}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-bold text-foreground/80 tracking-tight uppercase">Current Goal Progress</h4>
        </div>
        <div className="space-y-4 bg-accent/20 rounded-2xl p-5 border border-white/5">
          {goals.map(g => {
            const pct = g.target ? Math.min(100, Math.round((g.actual / g.target) * 100)) : 0;
            return (
              <div key={g.label} className="space-y-1.5">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{g.label}</span>
                  <span className="text-[11px] font-black text-foreground tabular-nums">
                    {g.actual} <span className="text-muted-foreground/50 mx-1">/</span> {g.target}
                    <span className={`ml-2 ${pct >= 80 ? "text-emerald-500" : pct >= 50 ? "text-amber-500" : "text-rose-500"}`}>({pct}%)</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden border border-white/5">
                  <div className={`h-full rounded-full transition-all duration-1000 ${goalColor(pct)} shadow-[0_0_8px_rgba(0,0,0,0.1)]`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-foreground mb-4">Recent Calls</h4>
        {!performance.recentCalls || performance.recentCalls.length === 0 ? (
          <div className="py-8 text-center border rounded-lg bg-accent/10">
            <p className="text-sm text-muted-foreground">No recent calls recorded.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {performance.recentCalls.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={c.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-accent/30 border text-sm">
                <span className="text-foreground font-medium">{c.contactName}</span>
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className="text-[10px] uppercase font-bold">{c.disposition || "N/A"}</Badge>
                  <span className="text-muted-foreground font-mono text-xs">{Math.floor(c.duration / 60)}:{String(c.duration % 60).padStart(2, "0")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserPerformanceTab;
