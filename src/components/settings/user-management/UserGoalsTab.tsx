import React from "react";
import { PhoneCall, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { goalColor } from "./userManagementUtils";

interface GoalActuals {
  callsMonth: number;
  policiesMonth: number;
  appointmentsMonth: number;
  premiumMonth: number;
}

interface Props {
  form: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  setForm: (updater: (p: any) => any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  goalActuals: GoalActuals;
  perfLoading: boolean;
  saving: boolean;
  onSave: () => void;
}

const UserGoalsTab: React.FC<Props> = ({ form, setForm, goalActuals, perfLoading, saving, onSave }) => {
  if (perfLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 mt-0">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  const goals = [
    { label: "Monthly Calls Goal", key: "monthlyCallGoal", actual: goalActuals.callsMonth, icon: PhoneCall, color: "text-blue-500", bg: "bg-blue-500/10", fmt: (v: number) => String(v) },
    { label: "Monthly Policies Goal", key: "monthlyPoliciesGoal", actual: goalActuals.policiesMonth, icon: ShieldCheck, color: "text-emerald-500", bg: "bg-emerald-500/10", fmt: (v: number) => String(v) },
    { label: "Monthly Appointments Goal", key: "monthlyAppointmentGoal", actual: goalActuals.appointmentsMonth, icon: Users, color: "text-amber-500", bg: "bg-amber-500/10", fmt: (v: number) => String(v) },
    { label: "Monthly Premium Goal ($)", key: "monthlyPremiumGoal", actual: goalActuals.premiumMonth, icon: TrendingUp, color: "text-purple-500", bg: "bg-purple-500/10", fmt: (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) },
  ];

  return (
    <div className="space-y-4 mt-0">
      <div className="grid grid-cols-2 gap-4">
        {goals.map(g => {
          const Icon = g.icon;
          const target = (form[g.key] as number) || 1;
          const pct = Math.min(100, Math.round((g.actual / target) * 100));
          return (
            <div key={g.key} className="bg-card/50 border rounded-xl p-3.5 space-y-3 shadow-sm hover:border-primary/30 transition-colors relative overflow-hidden group">
              <div className={`absolute -right-4 -top-4 w-16 h-16 rounded-full ${g.bg} opacity-20 blur-2xl group-hover:opacity-40 transition-opacity`} />
              <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg ${g.bg} border border-white/10 shadow-sm`}>
                    <Icon className={`w-3.5 h-3.5 ${g.color}`} />
                  </div>
                  <Label className="text-[10px] font-bold text-foreground/70 uppercase tracking-widest">{g.label}</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-muted-foreground font-black uppercase tracking-tighter opacity-70">Target</span>
                  <Input
                    type="number"
                    className="w-14 h-7 text-[11px] font-black bg-muted/30 border-none shadow-inner text-center p-0 focus-visible:ring-1 focus-visible:ring-primary/30"
                    value={form[g.key] || 0}
                    onChange={e => setForm(p => ({ ...p, [g.key]: parseInt(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="space-y-2 relative z-10">
                <div className="flex items-end justify-between px-0.5">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase leading-none mb-1">Status</span>
                    <span className={`text-sm font-black tabular-nums tracking-tight ${pct >= 80 ? "text-emerald-500" : pct >= 50 ? "text-amber-500" : "text-rose-500"}`}>
                      {g.fmt(g.actual)} / {g.fmt(target)}
                    </span>
                  </div>
                  <span className="text-[10px] font-black tabular-nums bg-accent/80 px-2 py-0.5 rounded-full border border-white/5">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden border border-white/5 shadow-inner">
                  <div className={`h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(0,0,0,0.2)] ${goalColor(pct)}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end pt-4 border-t mt-4">
        <Button onClick={onSave} disabled={saving} className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 px-8 h-9 font-bold uppercase tracking-widest text-[10px] group">
          {saving ? "Saving..." : (
            <>
              Save Performance Goals
              <TrendingUp className="w-3.5 h-3.5 ml-2 group-hover:translate-y-[-1px] transition-transform" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default UserGoalsTab;
