import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Phone, ShieldCheck, Calendar, Megaphone, TrendingUp, TrendingDown,
  Clock, ArrowRight, Trophy, Users, Target, CheckCircle2, Minus,
  ExternalLink, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  dashboardSupabaseApi,
  ExtendedDashboardStats,
  FollowUpItem,
  TodayAppointment,
  RecentCall,
  CampaignPerformance,
  GoalProgress,
  OnboardingStatus,
} from "@/lib/supabase-dashboard";
import { LeaderboardEntry } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  
  // Data states
  const [stats, setStats] = useState<ExtendedDashboardStats | null>(null);
  const [followUps, setFollowUps] = useState<{
    callbacksToday: FollowUpItem[];
    staleLeads: number;
    hotLeadsStale: number;
  } | null>(null);
  const [todayAppointments, setTodayAppointments] = useState<TodayAppointment[]>([]);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);

  const isAdmin = profile?.role === "admin" || profile?.role === "Admin" || profile?.role === "Team Leader";
  const userId = user?.id || "";

  const loadData = useCallback(async () => {
    if (!userId) return;
    
    try {
      const [
        statsData,
        followUpsData,
        appointmentsData,
        callsData,
        campaignsData,
        goalsData,
        leaderboardData,
        onboardingData,
      ] = await Promise.all([
        dashboardSupabaseApi.getStats(userId, isAdmin),
        dashboardSupabaseApi.getFollowUps(userId, isAdmin),
        dashboardSupabaseApi.getTodayAppointments(userId, isAdmin),
        dashboardSupabaseApi.getRecentCalls(userId, isAdmin),
        dashboardSupabaseApi.getCampaignPerformance(),
        dashboardSupabaseApi.getGoalProgress(userId),
        dashboardSupabaseApi.getLeaderboard(),
        dashboardSupabaseApi.getOnboardingStatus(userId),
      ]);
      
      setStats(statsData);
      setFollowUps(followUpsData);
      setTodayAppointments(appointmentsData);
      setRecentCalls(callsData);
      setCampaigns(campaignsData);
      setGoals(goalsData);
      setLeaderboard(leaderboardData);
      setOnboarding(onboardingData);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Dashboard load error:", error);
    } finally {
      setLoading(false);
    }
  }, [userId, isAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadData();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Greeting based on time
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = profile?.first_name || "Agent";
  const todayFormatted = format(new Date(), "EEEE, MMMM d, yyyy");

  // Format phone number
  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits[0] === "1") {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return phone;
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    if (seconds === 0) return "No Answer";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Trigger FloatingDialer call
  const triggerQuickCall = (contactName: string, phone: string, contactId?: string) => {
    window.dispatchEvent(new CustomEvent("quick-call", {
      detail: { contactName, phone, contactId },
    }));
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-5 w-64" />
          </div>
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // Check if new user - show onboarding
  const showOnboarding = onboarding?.isNewUser;
  const onboardingComplete = onboarding && onboarding.hasLeads && onboarding.hasCalls && onboarding.hasCampaigns && onboarding.hasAppointments;

  // Stat cards configuration
  const statCards = [
    {
      label: "Calls Today",
      value: stats?.totalCallsToday ?? 0,
      trend: stats?.callsTrend || "",
      trendPositive: stats?.callsTrendPositive,
      icon: Phone,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Policies Sold This Month",
      value: stats?.policiesSoldThisMonth ?? 0,
      trend: stats?.policiesTrend || "",
      trendPositive: stats?.policiesTrendPositive,
      icon: ShieldCheck,
      color: "text-success",
      bg: "bg-success/10",
    },
    {
      label: "Appointments Scheduled",
      value: stats?.appointmentsThisWeek ?? 0,
      trend: stats?.appointmentsTrend || "",
      trendPositive: stats?.appointmentsTrendPositive,
      icon: Calendar,
      color: "text-warning",
      bg: "bg-warning/10",
    },
    {
      label: "Active Campaigns",
      value: stats?.activeCampaigns ?? 0,
      trend: "",
      trendPositive: null,
      icon: Megaphone,
      color: "text-accent-foreground",
      bg: "bg-accent",
    },
  ];

  // Follow up count
  const followUpCount = (followUps?.callbacksToday.length ?? 0) + (followUps?.staleLeads ?? 0) + (followUps?.hotLeadsStale ?? 0);
  const allCaughtUp = followUpCount === 0;

  // Appointment type colors
  const getTypeColor = (type: string) => {
    switch (type) {
      case "Sales Call": return "bg-primary/10 text-primary";
      case "Follow Up": return "bg-warning/10 text-warning";
      case "Policy Review": return "bg-success/10 text-success";
      default: return "bg-muted text-muted-foreground";
    }
  };

  // Status badge colors
  const getStatusColor = (status: string) => {
    switch (status) {
      case "Scheduled": return "bg-primary/10 text-primary";
      case "Completed": return "bg-success/10 text-success";
      case "Cancelled": return "bg-destructive/10 text-destructive";
      case "No Show": return "bg-warning/10 text-warning";
      default: return "bg-muted text-muted-foreground";
    }
  };

  // Goal progress color
  const getGoalColor = (current: number, target: number) => {
    const pct = (current / target) * 100;
    if (pct >= 80) return "bg-success";
    if (pct >= 50) return "bg-warning";
    return "bg-destructive";
  };

  // Rank styling
  const getRankStyle = (rank: number) => {
    switch (rank) {
      case 1: return "text-yellow-500";
      case 2: return "text-gray-400";
      case 3: return "text-amber-600";
      default: return "text-muted-foreground";
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">
              {greeting}, {firstName}!
            </p>
            <p className="text-sm text-muted-foreground">{todayFormatted}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3 h-3" />
            Last updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
          </div>
        </div>

        {/* New User Onboarding */}
        {showOnboarding && !onboardingComplete && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                Welcome to AgentFlow, {firstName}!
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Complete these steps to get started:
              </p>
              <div className="space-y-3">
                <div
                  className="flex items-center gap-3 p-3 rounded-lg bg-card border cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate("/contacts")}
                >
                  {onboarding?.hasLeads ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-muted-foreground" />
                  )}
                  <span className={onboarding?.hasLeads ? "line-through text-muted-foreground" : ""}>
                    Import your first leads
                  </span>
                  <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
                </div>
                <div
                  className="flex items-center gap-3 p-3 rounded-lg bg-card border cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate("/dialer")}
                >
                  {onboarding?.hasCalls ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-muted-foreground" />
                  )}
                  <span className={onboarding?.hasCalls ? "line-through text-muted-foreground" : ""}>
                    Set up your dialer
                  </span>
                  <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
                </div>
                <div
                  className="flex items-center gap-3 p-3 rounded-lg bg-card border cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate("/campaigns")}
                >
                  {onboarding?.hasCampaigns ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-muted-foreground" />
                  )}
                  <span className={onboarding?.hasCampaigns ? "line-through text-muted-foreground" : ""}>
                    Create a campaign
                  </span>
                  <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
                </div>
                <div
                  className="flex items-center gap-3 p-3 rounded-lg bg-card border cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate("/calendar")}
                >
                  {onboarding?.hasAppointments ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-muted-foreground" />
                  )}
                  <span className={onboarding?.hasAppointments ? "line-through text-muted-foreground" : ""}>
                    Schedule an appointment
                  </span>
                  <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat) => (
            <Card key={stat.label} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                    {stat.trend ? (
                      <div className="flex items-center gap-1 mt-1">
                        {stat.trendPositive === true && <TrendingUp className="w-3 h-3 text-success" />}
                        {stat.trendPositive === false && <TrendingDown className="w-3 h-3 text-destructive" />}
                        <span className={`text-xs ${
                          stat.trendPositive === true ? "text-success" :
                          stat.trendPositive === false ? "text-destructive" :
                          "text-muted-foreground"
                        }`}>
                          {stat.trend}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 mt-1">
                        <Minus className="w-3 h-3 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center ${stat.color}`}>
                    <stat.icon className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Widgets Grid */}
        {!showOnboarding && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Widget 1: Follow Up Queue */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    Follow Ups Due
                  </CardTitle>
                  <Badge variant="secondary">{followUpCount}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {allCaughtUp ? (
                  <div className="text-center py-6">
                    <CheckCircle2 className="w-10 h-10 text-success mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">You're all caught up! No follow ups due.</p>
                  </div>
                ) : (
                  <>
                    {/* Callbacks Today */}
                    {followUps && followUps.callbacksToday.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
                          Callbacks Today ({followUps.callbacksToday.length})
                        </h4>
                        <div className="space-y-2">
                          {followUps.callbacksToday.map((cb) => (
                            <div key={cb.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-mono text-primary">{cb.time}</span>
                                <span className="text-sm text-foreground">
                                  {cb.firstName} {cb.lastName}
                                </span>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={() => triggerQuickCall(`${cb.firstName} ${cb.lastName}`, cb.phone, cb.id)}
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Stale Leads */}
                    {followUps && followUps.staleLeads > 0 && (
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm text-foreground">Leads Not Contacted 7+ Days</p>
                          <p className="text-xs text-muted-foreground">{followUps.staleLeads} leads need attention</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => navigate("/contacts")}>
                          View All
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </Button>
                      </div>
                    )}

                    {/* Hot Leads Stale */}
                    {followUps && followUps.hotLeadsStale > 0 && (
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm text-foreground">Hot Leads Not Called 3+ Days</p>
                          <p className="text-xs text-destructive">{followUps.hotLeadsStale} high-priority leads</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => navigate("/contacts")}>
                          View All
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Widget 2: Today's Appointments */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-warning" />
                    Today's Schedule
                  </CardTitle>
                  <Badge variant="secondary">{todayAppointments.length}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {todayAppointments.length === 0 ? (
                  <div className="text-center py-6">
                    <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">
                      No appointments today. Schedule one from the Calendar.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => navigate("/calendar")}>
                      View Calendar
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todayAppointments.map((appt) => (
                      <div
                        key={appt.id}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                        onClick={() => navigate("/calendar")}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-mono text-primary w-16">{appt.time}</span>
                          <span className="text-sm text-foreground">{appt.contactName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeColor(appt.type)}`}>
                            {appt.type}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(appt.status)}`}>
                            {appt.status}
                          </span>
                        </div>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => navigate("/calendar")}
                    >
                      View Calendar
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Widget 3: Recent Calls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  Recent Calls
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recentCalls.length === 0 ? (
                  <div className="text-center py-6">
                    <Phone className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">
                      No calls yet. Head to the Dialer to get started.
                    </p>
                    <Button size="sm" onClick={() => navigate("/dialer")}>
                      Go to Dialer
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentCalls.slice(0, 5).map((call) => (
                      <div
                        key={call.id}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                        onClick={() => call.contactId && navigate(`/contacts?contact=${call.contactId}`)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{call.contactName}</p>
                          <p className="text-xs text-muted-foreground">{formatPhone(call.contactPhone)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(call.duration)}
                          </span>
                          {call.dispositionName && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: `${call.dispositionColor}20`,
                                color: call.dispositionColor,
                              }}
                            >
                              {call.dispositionName}
                            </span>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-muted-foreground">
                                {call.startedAt && formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {call.startedAt && format(new Date(call.startedAt), "PPp")}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Widget 4: Campaign Performance */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-accent-foreground" />
                  Active Campaigns
                </CardTitle>
              </CardHeader>
              <CardContent>
                {campaigns.length === 0 ? (
                  <div className="text-center py-6">
                    <Megaphone className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">
                      No active campaigns. Create one to start reaching leads.
                    </p>
                    <Button size="sm" onClick={() => navigate("/campaigns")}>
                      Go to Campaigns
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {campaigns.map((campaign) => {
                      const progress = campaign.totalLeads > 0
                        ? Math.round((campaign.leadsContacted / campaign.totalLeads) * 100)
                        : 0;
                      return (
                        <div
                          key={campaign.id}
                          className="p-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                          onClick={() => navigate(`/campaigns/${campaign.id}`)}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-foreground">{campaign.name}</span>
                            <Badge variant="outline" className="text-xs">{campaign.type}</Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <Progress value={progress} className="h-2" />
                            </div>
                            <span className="text-xs text-muted-foreground w-12 text-right">{progress}%</span>
                          </div>
                          <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                            <span>{campaign.leadsContacted}/{campaign.totalLeads} contacted</span>
                            <span className="text-success">{campaign.leadsConverted} converted</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Widget 5: Goal Progress */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  My Goals
                </CardTitle>
              </CardHeader>
              <CardContent>
                {goals.length === 0 ? (
                  <div className="text-center py-6">
                    <Target className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No goals configured yet. Ask your admin to set goals in Settings → Goal Setting.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {goals.map((goal) => {
                      const pct = goal.target > 0 ? Math.round((goal.current / goal.target) * 100) : 0;
                      return (
                        <div key={goal.metric}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-foreground">{goal.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {goal.current}/{goal.target}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${getGoalColor(goal.current, goal.target)}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-medium w-10 text-right ${
                              pct >= 80 ? "text-success" : pct >= 50 ? "text-warning" : "text-destructive"
                            }`}>
                              {pct}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Widget 6: Leaderboard */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-warning" />
                  Top Performers This Month
                </CardTitle>
              </CardHeader>
              <CardContent>
                {leaderboard.length === 0 ? (
                  <div className="text-center py-6">
                    <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No sales this month yet. Get dialing!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((entry) => {
                      const isCurrentUser = entry.userId === userId;
                      return (
                        <div
                          key={entry.userId}
                          className={`flex items-center gap-3 py-2 px-3 rounded-lg ${
                            isCurrentUser ? "bg-primary/10 border border-primary/20" : "bg-muted/50"
                          }`}
                        >
                          <span className={`text-lg font-bold w-6 ${getRankStyle(entry.rank)}`}>
                            {entry.rank}
                          </span>
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                            {entry.avatar}
                          </div>
                          <div className="flex-1">
                            <span className="text-sm font-medium text-foreground">{entry.name}</span>
                            {isCurrentUser && (
                              <Badge variant="secondary" className="ml-2 text-xs">You</Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-semibold text-foreground">{entry.policies}</span>
                            <span className="text-xs text-muted-foreground ml-1">sold</span>
                          </div>
                        </div>
                      );
                    })}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => navigate("/leaderboard")}
                    >
                      View Full Leaderboard
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

export default Dashboard;
