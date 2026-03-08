import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Phone, ShieldCheck, Calendar, Megaphone, TrendingUp, TrendingDown,
  Clock, ArrowRight, PhoneCall, Users, Star, Trophy, Loader2, Settings2,
  GripHorizontal, Target, DollarSign, BarChart3, Timer,
} from "lucide-react";
import { Responsive, WidthProvider, Layout, Layouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { dashboardSupabaseApi } from "@/lib/supabase-dashboard";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardStats, LeaderboardEntry, WinFeedItem } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import CustomizeDrawer, { WidgetConfig } from "@/components/dashboard/CustomizeDrawer";
import DailyBriefingModal from "@/components/dashboard/DailyBriefingModal";

const ResponsiveGridLayout = WidthProvider(Responsive);

export interface WidgetLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "stat-cards", label: "KPI Stat Cards", visible: true },
  { id: "daily-briefing", label: "Daily Briefing", visible: true },
  { id: "activity-chart", label: "Win Feed", visible: true },
  { id: "recent-activity", label: "Recent Activity", visible: true },
  { id: "quick-actions", label: "Follow Up Queue", visible: true },
  { id: "missed-calls", label: "Missed Calls", visible: true },
  { id: "anniversaries", label: "Policy Anniversaries", visible: true },
  { id: "leaderboard", label: "Team Leaderboard", visible: true },
  { id: "conversion-rate", label: "Conversion Rate", visible: false },
  { id: "avg-talk-time", label: "Avg Talk Time", visible: false },
  { id: "pipeline-value", label: "Pipeline Value", visible: false },
  { id: "goals-progress", label: "Goals Progress", visible: false },
];

const DEFAULT_LAYOUT: WidgetLayoutItem[] = [
  { i: "stat-cards", x: 0, y: 0, w: 12, h: 3, minW: 6, minH: 3 },
  { i: "daily-briefing", x: 0, y: 3, w: 7, h: 6, minW: 4, minH: 4 },
  { i: "quick-actions", x: 7, y: 3, w: 5, h: 6, minW: 3, minH: 4 },
  { i: "activity-chart", x: 0, y: 9, w: 7, h: 5, minW: 4, minH: 3 },
  { i: "missed-calls", x: 7, y: 9, w: 5, h: 5, minW: 3, minH: 3 },
  { i: "recent-activity", x: 0, y: 14, w: 7, h: 5, minW: 4, minH: 3 },
  { i: "anniversaries", x: 7, y: 14, w: 5, h: 5, minW: 3, minH: 3 },
  { i: "leaderboard", x: 0, y: 19, w: 12, h: 6, minW: 6, minH: 4 },
  { i: "conversion-rate", x: 0, y: 25, w: 3, h: 3, minW: 2, minH: 3 },
  { i: "avg-talk-time", x: 3, y: 25, w: 3, h: 3, minW: 2, minH: 3 },
  { i: "pipeline-value", x: 6, y: 25, w: 3, h: 3, minW: 2, minH: 3 },
  { i: "goals-progress", x: 9, y: 25, w: 3, h: 5, minW: 3, minH: 4 },
];

const STORAGE_KEY_PREFIX = "agentflow-dashboard-v2-";

const ROW_HEIGHT = 40;

const Dashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [missedCalls, setMissedCalls] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [anniversaries, setAnniversaries] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [wins, setWins] = useState<WinFeedItem[]>([]);
  const [activities, setActivities] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [lbPeriod, setLbPeriod] = useState("Today");
  const [loading, setLoading] = useState(true);

  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [gridLayouts, setGridLayouts] = useState<Layouts>({ lg: DEFAULT_LAYOUT });
  const [layoutReady, setLayoutReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const briefingCheckedRef = useRef(false);
  const widgetsOnOpenRef = useRef<string>("");

  // Load from localStorage
  useEffect(() => {
    const userId = user?.id || "default";
    const key = STORAGE_KEY_PREFIX + userId;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.widgets) {
          const ids = new Set(parsed.widgets.map((w: WidgetConfig) => w.id));
          const merged = [
            ...parsed.widgets,
            ...DEFAULT_WIDGETS.filter((d) => !ids.has(d.id)),
          ];
          setWidgets(merged);
        }
        if (parsed.layouts) {
          setGridLayouts(parsed.layouts);
        }
      }
    } catch {} // eslint-disable-line no-empty
    setLayoutReady(true);
  }, [user?.id]);

  // Save to localStorage
  useEffect(() => {
    if (!layoutReady) return;
    const userId = user?.id || "default";
    const key = STORAGE_KEY_PREFIX + userId;
    localStorage.setItem(key, JSON.stringify({ widgets, layouts: gridLayouts }));
  }, [widgets, gridLayouts, layoutReady, user?.id]);

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

      // First-login-of-day briefing check
      if (!briefingCheckedRef.current && user?.id) {
        briefingCheckedRef.current = true;
        const today = new Date().toISOString().split("T")[0];
        const key = `briefing-last-shown-${user.id}`;
        if (localStorage.getItem(key) !== today) {
          setBriefingOpen(true);
          localStorage.setItem(key, today);
        }
      }
    };
    load();
  }, [lbPeriod, user?.id]);

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
    setGridLayouts({ lg: DEFAULT_LAYOUT });
  };

  const handleLayoutChange = (_layout: Layout[], allLayouts: Layouts) => {
    setGridLayouts(allLayouts);
  };

  const visibleWidgetIds = useMemo(
    () => new Set(widgets.filter((w) => w.visible).map((w) => w.id)),
    [widgets]
  );

  // Build layout for visible widgets only, ensuring items that don't have a saved position get defaults
  const currentLayout = useMemo(() => {
    const savedLg = (gridLayouts.lg || []) as WidgetLayoutItem[];
    const savedMap = new Map(savedLg.map((l) => [l.i, l]));
    const defaultMap = new Map(DEFAULT_LAYOUT.map((l) => [l.i, l]));

    return Array.from(visibleWidgetIds).map((id) => {
      const saved = savedMap.get(id);
      const def = defaultMap.get(id);
      return saved || def || { i: id, x: 0, y: 100, w: 4, h: 4, minW: 2, minH: 3 };
    });
  }, [visibleWidgetIds, gridLayouts]);

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

  // Mock data for new stat widgets
  const conversionRate = stats ? Math.round((stats.policiesSoldThisMonth / Math.max(stats.totalCallsToday * 30, 1)) * 100) : 12;
  const avgTalkTime = "4m 32s";
  const pipelineValue = "$127,450";
  const goals = { calls: 68, sales: 45, appointments: 72 };

  const DragHandle = () => (
    <div className="dashboard-drag-handle flex items-center justify-center py-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors">
      <GripHorizontal className="w-4 h-4" />
    </div>
  );

  const renderWidget = (id: string) => {
    switch (id) {
      case "stat-cards":
        return (
          <div className="h-full flex flex-col">
            <DragHandle />
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 overflow-auto">
              {statCards.map((s) => (
                <div key={s.label} className="bg-card rounded-xl border p-4 hover:shadow-md sidebar-transition cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-2xl font-bold text-foreground mt-1">{s.value}</p>
                      {s.trend && (
                        <div className="flex items-center gap-1 mt-1">
                          {s.positive === true && <TrendingUp className="w-3 h-3 text-success" />}
                          {s.positive === false && <TrendingDown className="w-3 h-3 text-destructive" />}
                          <span className={`text-xs ${s.positive === true ? "text-success" : s.positive === false ? "text-destructive" : "text-muted-foreground"}`}>{s.trend}</span>
                        </div>
                      )}
                    </div>
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <s.icon className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case "daily-briefing":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 overflow-auto px-5 pb-4">
              <h2 className="font-semibold text-foreground mb-3">📋 Daily Briefing</h2>
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
          </div>
        );

      case "activity-chart":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 overflow-auto px-5 pb-4">
              <h2 className="font-semibold text-foreground mb-3">🎉 Win Feed</h2>
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
          </div>
        );

      case "recent-activity":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 overflow-auto px-5 pb-4">
              <h2 className="font-semibold text-foreground mb-3">Recent Activity</h2>
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
          </div>
        );

      case "quick-actions":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 overflow-auto px-5 pb-4">
              <div className="flex items-center justify-between mb-3">
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
          </div>
        );

      case "missed-calls":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 overflow-auto px-5 pb-4">
              <h2 className="font-semibold text-foreground mb-3">📞 Missed Calls</h2>
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
          </div>
        );

      case "anniversaries":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 overflow-auto px-5 pb-4">
              <h2 className="font-semibold text-foreground mb-3">🎂 Policy Anniversaries</h2>
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
          </div>
        );

      case "leaderboard":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 overflow-auto px-5 pb-4">
              <div className="flex items-center justify-between mb-3">
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
          </div>
        );

      case "conversion-rate":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 px-5 pb-4 flex flex-col justify-center">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Conversion Rate</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{conversionRate}%</p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3 h-3 text-success" />
                    <span className="text-xs text-success">+2.3% vs last month</span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center text-success">
                  <Target className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>
        );

      case "avg-talk-time":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 px-5 pb-4 flex flex-col justify-center">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Avg Talk Time</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{avgTalkTime}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3 h-3 text-success" />
                    <span className="text-xs text-success">+18s vs yesterday</span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Timer className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>
        );

      case "pipeline-value":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 px-5 pb-4 flex flex-col justify-center">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Pipeline Value</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{pipelineValue}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3 h-3 text-success" />
                    <span className="text-xs text-success">+$12,300 this week</span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center text-warning">
                  <DollarSign className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>
        );

      case "goals-progress":
        return (
          <div className="h-full flex flex-col bg-card rounded-xl border">
            <DragHandle />
            <div className="flex-1 px-5 pb-4 overflow-auto">
              <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" /> Goals Progress
              </h2>
              <div className="space-y-4">
                {[
                  { label: "Monthly Calls", value: goals.calls, target: 500, color: "bg-primary" },
                  { label: "Policies Sold", value: goals.sales, target: 20, color: "bg-success" },
                  { label: "Appointments", value: goals.appointments, target: 40, color: "bg-warning" },
                ].map((g) => {
                  const pct = Math.round((g.value / g.target) * 100);
                  return (
                    <div key={g.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-foreground">{g.label}</span>
                        <span className="text-xs text-muted-foreground">{g.value}/{g.target} ({pct}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${g.color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
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

      {/* Grid Layout */}
      <ResponsiveGridLayout
        className="layout"
        layouts={{ lg: currentLayout }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4 }}
        rowHeight={ROW_HEIGHT}
        draggableHandle=".dashboard-drag-handle"
        onLayoutChange={handleLayoutChange}
        compactType="vertical"
        margin={[16, 16]}
        isResizable
        isDraggable
      >
        {Array.from(visibleWidgetIds).map((id) => (
          <div key={id} className="dashboard-grid-item">
            {renderWidget(id)}
          </div>
        ))}
      </ResponsiveGridLayout>

      <CustomizeDrawer
        open={drawerOpen}
        onClose={handleCloseDrawer}
        widgets={widgets}
        onWidgetsChange={setWidgets}
        onReset={handleReset}
      />
      <DailyBriefingModal
        open={briefingOpen}
        onClose={() => setBriefingOpen(false)}
        firstName={firstName}
        appointments={appointments}
        followUps={followUps}
        anniversaries={anniversaries}
        stats={stats}
      />
    </div>
  );
};

export default Dashboard;
