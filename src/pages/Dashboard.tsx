import React, { useState, useEffect } from "react";
import {
  Phone, ShieldCheck, Calendar, Megaphone, TrendingUp, TrendingDown,
  Clock, ArrowRight, PhoneCall, Users, Star, Trophy, Loader2,
} from "lucide-react";
import { dashboardApi } from "@/lib/mock-api";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardStats, LeaderboardEntry, WinFeedItem } from "@/lib/types";
import { calcAging } from "@/lib/mock-data";

const neonColors = {
  cyan: { glow: "neon-glow-cyan", text: "neon-text-cyan", border: "hsla(187,94%,43%,0.25)" },
  green: { glow: "neon-glow-green", text: "neon-text-green", border: "hsla(142,71%,45%,0.25)" },
  pink: { glow: "neon-glow-pink", text: "neon-text-pink", border: "hsla(330,81%,60%,0.25)" },
  amber: { glow: "neon-glow-amber", text: "neon-text-amber", border: "hsla(38,92%,50%,0.25)" },
  blue: { glow: "neon-glow-blue", text: "neon-text-cyan", border: "hsla(217,91%,60%,0.25)" },
};

const rankClass = (rank: number) =>
  rank === 1 ? "neon-rank-gold" : rank === 2 ? "neon-rank-silver" : rank === 3 ? "neon-rank-bronze" : "";

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [missedCalls, setMissedCalls] = useState<any[]>([]);
  const [anniversaries, setAnniversaries] = useState<any[]>([]);
  const [wins, setWins] = useState<WinFeedItem[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [lbPeriod, setLbPeriod] = useState("Today");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [s, lb, fu, mc, ann, w, act] = await Promise.all([
        dashboardApi.getStats(),
        dashboardApi.getLeaderboard(lbPeriod),
        dashboardApi.getFollowUps(),
        dashboardApi.getMissedCalls(),
        dashboardApi.getAnniversaries(),
        dashboardApi.getWins(),
        dashboardApi.getRecentActivity(),
      ]);
      setStats(s); setLeaderboard(lb); setFollowUps(fu);
      setMissedCalls(mc); setAnniversaries(ann); setWins(w);
      setActivities(act); setLoading(false);
    };
    load();
  }, [lbPeriod]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const s = await dashboardApi.getStats();
      setStats(s);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.firstName || "Agent";

  if (loading) return (
    <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
  );

  const statCards = [
    { label: "Total Calls Today", value: stats!.totalCallsToday, trend: stats!.callsTrend, icon: Phone, positive: true, color: "blue" as const },
    { label: "Policies Sold This Month", value: stats!.policiesSoldThisMonth, trend: stats!.policiesTrend, icon: ShieldCheck, positive: true, color: "green" as const },
    { label: "Appointments Scheduled", value: stats!.appointmentsThisWeek, trend: stats!.appointmentsTrend, icon: Calendar, positive: null, color: "cyan" as const },
    { label: "Active Campaigns", value: stats!.activeCampaigns, trend: "", icon: Megaphone, positive: null, color: "pink" as const },
  ];

  const appointments = followUps.slice(0, 3).map(f => ({
    time: "Today",
    name: `${f.firstName} ${f.lastName}`,
    type: f.status === "Hot" ? "Sales Call" : "Follow Up",
  }));

  return (
    <div className="dashboard-neon space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold neon-gradient-text">Dashboard</h1>
        <p className="text-muted-foreground">{greeting}, <span className="neon-heading font-semibold">{firstName}</span>! Here's your overview.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => {
          const nc = neonColors[s.color];
          return (
            <div key={s.label} className="neon-card rounded-xl p-5 cursor-pointer" style={{ borderColor: nc.border }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className={`text-3xl font-bold text-foreground mt-1 ${nc.text}`}>{s.value}</p>
                  {s.trend && (
                    <div className="flex items-center gap-1 mt-2">
                      {s.positive === true && <TrendingUp className="w-3.5 h-3.5 text-success" />}
                      {s.positive === false && <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
                      <span className={`text-xs ${s.positive === true ? "text-success" : s.positive === false ? "text-destructive" : "text-muted-foreground"}`}>{s.trend}</span>
                    </div>
                  )}
                </div>
                <div className={`w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary ${nc.glow}`}>
                  <s.icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Daily Briefing */}
          <div className="neon-card rounded-xl p-5">
            <h2 className="font-semibold neon-heading mb-4">📋 Daily Briefing</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{appointments.length} Appointments Today</h3>
                {appointments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-primary font-medium neon-text-cyan">{a.time}</span>
                      <span className="text-sm text-foreground">{a.name}</span>
                    </div>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{a.type}</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{followUps.length} Follow-ups Due</h3>
                {followUps.slice(0, 3).map((f) => (
                  <div key={f.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <span className="text-sm text-foreground">{f.firstName} {f.lastName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${f.aging >= 5 ? "bg-destructive/10 text-destructive" : f.aging >= 3 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{f.aging}d ago</span>
                  </div>
                ))}
              </div>
              {anniversaries.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">{anniversaries.length} Policy Anniversaries</h3>
                  {anniversaries.slice(0, 2).map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                      <span className="text-sm text-foreground">{a.firstName} {a.lastName} — {a.policyType}</span>
                      <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">In {a.daysUntilAnniversary}d</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Win Feed */}
          <div className="neon-card rounded-xl p-5">
            <h2 className="font-semibold neon-heading mb-4">🎉 Win Feed</h2>
            <div className="space-y-3">
              {wins.map((w) => (
                <div key={w.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-success text-xs font-bold neon-glow-green">{w.agentAvatar}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground"><span className="font-medium">{w.agentName}</span> sold <span className="text-primary font-medium neon-text-cyan">{w.policyType}</span> to {w.contactName} ({w.contactState})</p>
                    <p className="text-xs text-muted-foreground">{w.time}</p>
                  </div>
                  <span className="text-lg">🎉</span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Feed */}
          <div className="neon-card rounded-xl p-5">
            <h2 className="font-semibold neon-heading mb-4">Recent Activity</h2>
            <div className="space-y-3">
              {activities.map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    a.type === "call" ? "bg-primary/10 text-primary neon-glow-blue" : a.type === "policy" ? "bg-success/10 text-success neon-glow-green" : a.type === "lead" ? "bg-warning/10 text-warning neon-glow-amber" : "bg-accent text-accent-foreground"
                  }`}>
                    {a.type === "call" ? <Phone className="w-4 h-4" /> : a.type === "policy" ? <ShieldCheck className="w-4 h-4" /> : a.type === "lead" ? <Users className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{a.desc}</p>
                    <p className="text-xs text-muted-foreground">{a.agent} · {a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Follow Up Queue */}
          <div className="neon-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold neon-heading">Follow Up Queue</h2>
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium animate-neon-pulse">{followUps.length}</span>
            </div>
            {followUps.slice(0, 5).map((f) => (
              <div key={f.id} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{f.firstName} {f.lastName}</p>
                  <p className="text-xs text-muted-foreground">{f.leadSource}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${f.aging >= 5 ? "bg-destructive/10 text-destructive" : f.aging >= 3 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{f.aging}d</span>
                  <button className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 sidebar-transition neon-glow-blue">
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Missed Calls */}
          <div className="neon-card rounded-xl p-5">
            <h2 className="font-semibold neon-heading mb-4">📞 Missed Calls</h2>
            {missedCalls.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No missed calls today!</p>
            ) : missedCalls.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                <div>
                  <p className="text-sm text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.time}</p>
                </div>
                <button className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-medium hover:bg-primary/20 sidebar-transition">Call Back</button>
              </div>
            ))}
          </div>

          {/* Anniversaries */}
          <div className="neon-card rounded-xl p-5">
            <h2 className="font-semibold neon-heading mb-4">🎂 Policy Anniversaries</h2>
            {anniversaries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No upcoming anniversaries</p>
            ) : anniversaries.slice(0, 3).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                <div>
                  <p className="text-sm font-medium text-foreground">{a.firstName} {a.lastName}</p>
                  <p className="text-xs text-muted-foreground">{a.policyType} · {a.carrier}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">In {a.daysUntilAnniversary}d</span>
                  <button className="w-7 h-7 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition">
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Team Leaderboard */}
      <div className="neon-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold neon-heading flex items-center gap-2"><Trophy className="w-5 h-5 text-warning animate-trophy-shine" /> Team Leaderboard</h2>
          <div className="flex rounded-lg p-0.5" style={{ background: "hsla(222,47%,11%,0.8)", border: "1px solid hsla(187,94%,43%,0.15)" }}>
            {["Today", "Week", "Month"].map((t) => (
              <button key={t} onClick={() => setLbPeriod(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium sidebar-transition ${lbPeriod === t ? "bg-primary/20 text-foreground neon-toggle-active" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border/30">
                <th className="text-left py-2 font-medium">#</th>
                <th className="text-left py-2 font-medium">Agent</th>
                <th className="text-right py-2 font-medium">Calls</th>
                <th className="text-right py-2 font-medium">Policies</th>
                <th className="text-right py-2 font-medium">Appts</th>
                <th className="text-right py-2 font-medium hidden sm:table-cell">Talk Time</th>
                <th className="text-right py-2 font-medium">Goal</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((a) => (
                <tr key={a.userId} className={`border-b border-border/30 last:border-0 ${a.userId === user?.id ? "bg-primary/5" : ""}`}>
                  <td className={`py-2.5 font-bold ${rankClass(a.rank) || "text-foreground"}`}>{a.rank}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center ${a.rank <= 3 ? neonColors[a.rank === 1 ? "amber" : a.rank === 2 ? "cyan" : "pink"].glow : ""}`}>{a.avatar}</div>
                      <span className="font-medium text-foreground">{a.name}</span>
                      {a.userId === user?.id && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">You</span>}
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-foreground">{a.calls}</td>
                  <td className="py-2.5 text-right text-foreground">{a.policies}</td>
                  <td className="py-2.5 text-right text-foreground">{a.appointments}</td>
                  <td className="py-2.5 text-right text-foreground hidden sm:table-cell">{a.talkTime}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${a.goalProgress >= 80 ? "bg-success" : a.goalProgress >= 60 ? "bg-warning" : "bg-destructive"} ${a.goalProgress >= 80 ? "neon-progress-bar" : a.goalProgress >= 60 ? "neon-progress-bar-warning" : "neon-progress-bar-danger"}`}
                          style={{ width: `${Math.min(a.goalProgress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{a.goalProgress}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
