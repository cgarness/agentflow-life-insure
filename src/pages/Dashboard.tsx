import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Phone, ShieldCheck, Calendar, Megaphone, TrendingUp, TrendingDown,
  Clock, ArrowRight, PhoneCall, Users, Star, Trophy, Loader2, Settings2,
} from "lucide-react";
import { dashboardSupabaseApi } from "@/lib/supabase-dashboard";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardStats, LeaderboardEntry, WinFeedItem } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import CustomizeDrawer, { WidgetConfig } from "@/components/dashboard/CustomizeDrawer";

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "stat-cards", label: "KPI Stat Cards", visible: true },
  { id: "daily-briefing", label: "Daily Briefing", visible: true },
  { id: "activity-chart", label: "Win Feed", visible: true },
  { id: "recent-activity", label: "Recent Activity", visible: true },
  { id: "quick-actions", label: "Follow Up Queue", visible: true },
  { id: "leaderboard", label: "Team Leaderboard", visible: true },
];

const STORAGE_KEY_PREFIX = "agentflow-dashboard-layout-";

const Dashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [missedCalls, setMissedCalls] = useState<any[]>([]);
  const [anniversaries, setAnniversaries] = useState<any[]>([]);
  const [wins, setWins] = useState<WinFeedItem[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [lbPeriod, setLbPeriod] = useState("Today");
  const [loading, setLoading] = useState(true);

  // Widget layout state
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [layoutReady, setLayoutReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const widgetsOnOpenRef = useRef<string>("");

  // Load layout from localStorage
  useEffect(() => {
    const userId = user?.id || "default";
    const key = STORAGE_KEY_PREFIX + userId;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed: WidgetConfig[] = JSON.parse(saved);
        // Merge with defaults in case new widgets were added
        const ids = new Set(parsed.map((w) => w.id));
        const merged = [
          ...parsed,
          ...DEFAULT_WIDGETS.filter((d) => !ids.has(d.id)),
        ];
        setWidgets(merged);
      }
    } catch {}
    setLayoutReady(true);
  }, [user?.id]);

  // Save layout to localStorage whenever widgets change (after initial load)
  useEffect(() => {
    if (!layoutReady) return;
    const userId = user?.id || "default";
    const key = STORAGE_KEY_PREFIX + userId;
    localStorage.setItem(key, JSON.stringify(widgets));
  }, [widgets, layoutReady, user?.id]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [s, lb, fu, mc, ann, w, act] = await Promise.all([
        dashboardSupabaseApi.getStats(),
        dashboardSupabaseApi.getLeaderboard(lbPeriod),
        dashboardSupabaseApi.getFollowUps(),
        dashboardSupabaseApi.getMissedCalls(),
        dashboardSupabaseApi.getAnniversaries(),
        dashboardSupabaseApi.getWins(),
        dashboardSupabaseApi.getRecentActivity(),
      ]);
      setStats(s);
      setLeaderboard(lb);
      setFollowUps(fu);
      setMissedCalls(mc);
      setAnniversaries(ann);
      setWins(w);
      setActivities(act);
      setLoading(false);
    };
    load();
  }, [lbPeriod]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const s = await dashboardSupabaseApi.getStats();
      setStats(s);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = profile?.first_name || "Agent";

  const handleOpenDrawer = () => {
    widgetsOnOpenRef.current = JSON.stringify(widgets);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    if (JSON.stringify(widgets) !== widgetsOnOpenRef.current) {
      toast({ title: "Dashboard layout saved", duration: 3000 });
    }
  };

  const handleReset = () => {
    setWidgets(DEFAULT_WIDGETS);
  };

  const isVisible = useCallback(
    (id: string) => widgets.find((w) => w.id === id)?.visible ?? true,
    [widgets]
  );

  if (loading || !layoutReady) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );

  const statCards = [
    { label: "Total Calls Today", value: stats!.totalCallsToday, trend: stats!.callsTrend, icon: Phone, positive: true },
    { label: "Policies Sold This Month", value: stats!.policiesSoldThisMonth, trend: stats!.policiesTrend, icon: ShieldCheck, positive: true },
    { label: "Appointments Scheduled", value: stats!.appointmentsThisWeek, trend: stats!.appointmentsTrend, icon: Calendar, positive: null },
    { label: "Active Campaigns", value: stats!.activeCampaigns, trend: "", icon: Megaphone, positive: null },
  ];

  const appointments = followUps.slice(0, 3).map(f => ({
    time: "Today",
    name: `${f.firstName} ${f.lastName}`,
    type: f.status === "Hot" ? "Sales Call" : "Follow Up",
  }));

  // Build ordered visible widget list
  // Left column widgets: daily-briefing, activity-chart (win feed), recent-activity
  // Right column widgets: quick-actions (follow up queue), missed-calls, anniversaries
  // Full-width: stat-cards (top), leaderboard (bottom)

  const leftIds = new Set(["daily-briefing", "activity-chart", "recent-activity"]);
  const rightIds = new Set(["quick-actions"]);
  const fullWidthTop = "stat-cards";
  const fullWidthBottom = "leaderboard";

  const orderedVisible = widgets.filter((w) => w.visible);
  const leftWidgets = orderedVisible.filter((w) => leftIds.has(w.id));
  const rightWidgets = orderedVisible.filter((w) => rightIds.has(w.id));
  const hasMiddleSection = leftWidgets.length > 0 || rightWidgets.length > 0;

  const renderWidget = (id: string) => {
    switch (id) {
      case "stat-cards":
        return (
          <div key={id} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((s) => (
              <div key={s.label} className="bg-card rounded-xl border p-5 hover:shadow-md sidebar-transition cursor-pointer">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className="text-3xl font-bold text-foreground mt-1">{s.value}</p>
                    {s.trend && (
                      <div className="flex items-center gap-1 mt-2">
                        {s.positive === true && <TrendingUp className="w-3.5 h-3.5 text-success" />}
                        {s.positive === false && <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
                        <span className={`text-xs ${s.positive === true ? "text-success" : s.positive === false ? "text-destructive" : "text-muted-foreground"}`}>{s.trend}</span>
                      </div>
                    )}
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <s.icon className="w-5 h-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        );

      case "daily-briefing":
        return (
          <div key={id} className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">📋 Daily Briefing</h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{appointments.length} Appointments Today</h3>
                {appointments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-primary font-medium">{a.time}</span>
                      <span className="text-sm text-foreground">{a.name}</span>
                    </div>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{a.type}</span>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{followUps.length} Follow-ups Due</h3>
                {followUps.slice(0, 3).map((f) => (
                  <div key={f.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className="text-sm text-foreground">{f.firstName} {f.lastName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${f.aging >= 5 ? "bg-destructive/10 text-destructive" : f.aging >= 3 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{f.aging}d ago</span>
                  </div>
                ))}
              </div>
              {anniversaries.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">{anniversaries.length} Policy Anniversaries</h3>
                  {anniversaries.slice(0, 2).map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <span className="text-sm text-foreground">{a.firstName} {a.lastName} — {a.policyType}</span>
                      <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">In {a.daysUntilAnniversary}d</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case "activity-chart":
        return (
          <div key={id} className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">🎉 Win Feed</h2>
            <div className="space-y-3">
              {wins.map((w) => (
                <div key={w.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-success text-xs font-bold">{w.agentAvatar}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground"><span className="font-medium">{w.agentName}</span> sold <span className="text-primary font-medium">{w.policyType}</span> to {w.contactName} ({w.contactState})</p>
                    <p className="text-xs text-muted-foreground">{w.time}</p>
                  </div>
                  <span className="text-lg">🎉</span>
                </div>
              ))}
            </div>
          </div>
        );

      case "recent-activity":
        return (
          <div key={id} className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold text-foreground mb-4">Recent Activity</h2>
            <div className="space-y-3">
              {activities.map((a) => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    a.type === "call" ? "bg-primary/10 text-primary" : a.type === "policy" ? "bg-success/10 text-success" : a.type === "lead" ? "bg-warning/10 text-warning" : "bg-accent text-accent-foreground"
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
        );

      case "quick-actions":
        return (
          <React.Fragment key={id}>
            {/* Follow Up Queue */}
            <div className="bg-card rounded-xl border p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-foreground">Follow Up Queue</h2>
                <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">{followUps.length}</span>
              </div>
              {followUps.slice(0, 5).map((f) => (
                <div key={f.id} className="flex items-center justify-between py-2.5 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.firstName} {f.lastName}</p>
                    <p className="text-xs text-muted-foreground">{f.leadSource}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${f.aging >= 5 ? "bg-destructive/10 text-destructive" : f.aging >= 3 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{f.aging}d</span>
                    <button className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 sidebar-transition">
                      <Phone className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Missed Calls */}
            <div className="bg-card rounded-xl border p-5">
              <h2 className="font-semibold text-foreground mb-4">📞 Missed Calls</h2>
              {missedCalls.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No missed calls today!</p>
              ) : missedCalls.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2.5 border-b last:border-0">
                  <div>
                    <p className="text-sm text-foreground">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.time}</p>
                  </div>
                  <button className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-medium hover:bg-primary/20 sidebar-transition">Call Back</button>
                </div>
              ))}
            </div>
            {/* Anniversaries */}
            <div className="bg-card rounded-xl border p-5">
              <h2 className="font-semibold text-foreground mb-4">🎂 Policy Anniversaries</h2>
              {anniversaries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No upcoming anniversaries</p>
              ) : anniversaries.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 border-b last:border-0">
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
          </React.Fragment>
        );

      case "leaderboard":
        return (
          <div key={id} className="bg-card rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-foreground flex items-center gap-2"><Trophy className="w-5 h-5 text-warning" /> Team Leaderboard</h2>
              <div className="flex bg-muted rounded-lg p-0.5 border border-border">
                {["Today", "Week", "Month"].map((t) => (
                  <button key={t} onClick={() => setLbPeriod(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium sidebar-transition ${lbPeriod === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
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
                    <tr key={a.userId} className={`border-b last:border-0 ${a.userId === user?.id ? "bg-primary/5" : ""}`}>
                      <td className="py-2.5 font-bold text-foreground">{a.rank}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{a.avatar}</div>
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
                            <div className={`h-full rounded-full ${a.goalProgress >= 80 ? "bg-success" : a.goalProgress >= 60 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${Math.min(a.goalProgress, 100)}%` }} />
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
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">{greeting}, {firstName}! Here's your overview.</p>
        </div>
        <button
          onClick={handleOpenDrawer}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-sm"
        >
          <Settings2 className="w-4 h-4" />
          Customize
        </button>
      </div>

      {/* Render widgets in user order, preserving layout structure */}
      {(() => {
        const sections: React.ReactNode[] = [];
        let i = 0;
        while (i < orderedVisible.length) {
          const w = orderedVisible[i];
          if (w.id === "stat-cards" || w.id === "leaderboard") {
            sections.push(renderWidget(w.id));
            i++;
          } else {
            // Collect consecutive left/right column widgets
            const leftBatch: WidgetConfig[] = [];
            const rightBatch: WidgetConfig[] = [];
            while (i < orderedVisible.length && orderedVisible[i].id !== "stat-cards" && orderedVisible[i].id !== "leaderboard") {
              const cur = orderedVisible[i];
              if (leftIds.has(cur.id)) leftBatch.push(cur);
              else if (rightIds.has(cur.id)) rightBatch.push(cur);
              i++;
            }
            if (leftBatch.length > 0 || rightBatch.length > 0) {
              sections.push(
                <div key={`grid-${leftBatch[0]?.id || rightBatch[0]?.id}`} className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {leftBatch.length > 0 && (
                    <div className="lg:col-span-3 space-y-6">
                      {leftBatch.map((w) => renderWidget(w.id))}
                    </div>
                  )}
                  {rightBatch.length > 0 && (
                    <div className={leftBatch.length > 0 ? "lg:col-span-2 space-y-6" : "lg:col-span-5 space-y-6"}>
                      {rightBatch.map((w) => renderWidget(w.id))}
                    </div>
                  )}
                </div>
              );
            }
          }
        }
        return sections;
      })()}

      <CustomizeDrawer
        open={drawerOpen}
        onClose={handleCloseDrawer}
        widgets={widgets}
        onWidgetsChange={setWidgets}
        onReset={handleReset}
      />
    </div>
  );
};

export default Dashboard;
