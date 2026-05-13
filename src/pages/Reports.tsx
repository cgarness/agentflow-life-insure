import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Download, BarChart3, CalendarIcon, Bookmark, Clock, Settings2 } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { supabase } from "@/integrations/supabase/client";
import {
  DateRange, Grouping, autoGrouping,
  fetchProfiles, fetchLeads, fetchDialerSessions, fetchGoals,
  fetchLeadSourceCosts, downloadCSV,
  AgentProfile,
  fetchReportCallSummary, fetchReportCallVolumeTimeseries, fetchReportDispositionBreakdown, fetchReportCampaignPerformance,
  fetchDispositions, fetchActiveLeadsCount,
  ReportCallSummary, ReportCallVolumeTimeseries, ReportDispositionBreakdown, ReportCampaignPerformance
} from "@/lib/reports-queries";

import { buildStatComponents } from "@/components/reports/StatsGrid";
import AgentPerformanceCards from "@/components/reports/AgentPerformanceCards";
import CallVolumeChart from "@/components/reports/CallVolumeChart";
import DispositionsPieChart from "@/components/reports/DispositionsPieChart";
import PoliciesSoldChart from "@/components/reports/PoliciesSoldChart";
import CampaignPerformance from "@/components/reports/CampaignPerformance";
import LeadSourceTable from "@/components/reports/LeadSourceTable";
import CommunicationsStats from "@/components/reports/CommunicationsStats";
import CallingHeatmap from "@/components/reports/CallingHeatmap";
import CallDurationAnalysis from "@/components/reports/CallDurationAnalysis";
import AgentEfficiency from "@/components/reports/AgentEfficiency";
import CallFlowAnalysis from "@/components/reports/CallFlowAnalysis";
import DispositionDeepDive from "@/components/reports/DispositionDeepDive";
import GoalTracking from "@/components/reports/GoalTracking";
import CustomReportBuilder from "@/components/reports/CustomReportBuilder";
import ScheduledReportsModal from "@/components/reports/ScheduledReportsModal";
import ReportCustomizer from "@/components/reports/ReportCustomizer";
import SectionRenderer from "@/components/reports/SectionRenderer";
import { fetchUserLayout, saveUserLayout, saveOrgDefaultLayout, resetUserLayout, getDefaultLayout } from "@/lib/report-layout";
import { ReportLayoutConfig, SectionConfig } from "@/lib/report-layout-constants";


type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";

function presetToRange(preset: Preset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today": return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": return { start: startOfDay(subDays(now, 1)), end: endOfDay(subDays(now, 1)) };
    case "7d": return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
    case "30d": return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
    case "month": return { start: startOfMonth(now), end: endOfDay(now) };
    case "lastMonth": { const lm = subMonths(now, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
    default: return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
  }
}

const PRESET_LABELS: Record<Preset, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 Days", "30d": "Last 30 Days",
  month: "This Month", lastMonth: "Last Month", custom: "Custom",
};

const Reports: React.FC = () => {
  const { profile, user } = useAuth();
  const { formatDate } = useBranding();
  const navigate = useNavigate();
  const isAdmin = profile?.role?.toLowerCase() === "admin" || profile?.role?.toLowerCase() === "team leader";
  const orgId = profile?.organization_id ?? null;

  // Controls
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState<DateRange>(presetToRange("30d"));
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [grouping, setGrouping] = useState<Grouping>("daily");

  // Tabs
  const [layout, setLayout] = useState<ReportLayoutConfig>(getDefaultLayout());
  const [editMode, setEditMode] = useState(false);

  // Panels
  const [showMyReports, setShowMyReports] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  // RPC Data
  const [summary, setSummary] = useState<ReportCallSummary>();
  const [volume, setVolume] = useState<ReportCallVolumeTimeseries>();
  const [breakdown, setBreakdown] = useState<ReportDispositionBreakdown>();
  const [performance, setPerformance] = useState<ReportCampaignPerformance>();

  // Aux Data
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [activeLeadsCount, setActiveLeadsCount] = useState<number>(0);
  const [goals, setGoals] = useState<any[]>([]);
  const [leadCosts, setLeadCosts] = useState<any[]>([]);
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const effectiveAgent = useMemo(() => {
    if (!isAdmin && profile?.id) return profile.id;
    return selectedAgent && selectedAgent !== "all" ? selectedAgent : undefined;
  }, [isAdmin, profile, selectedAgent]);

  const nonAdminAgents = useMemo(() => agents, [agents]);

  useEffect(() => {
    if (orgId) {
      fetchUserLayout(orgId).then(setLayout);
    }
  }, [orgId]);

  useEffect(() => {
    if (preset !== "custom") {
      const r = presetToRange(preset);
      setRange(r);
      setGrouping(autoGrouping(r));
    }
  }, [preset]);

  useEffect(() => {
    if (preset === "custom" && customStart && customEnd) {
      const r = { start: startOfDay(customStart), end: endOfDay(customEnd) };
      setRange(r);
      setGrouping(autoGrouping(r));
    }
  }, [preset, customStart, customEnd]);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [a, l, sess, g, lc, sumData, volData, brkData, perfData, dispData, leadsCount] = await Promise.all([
        fetchProfiles(orgId),
        fetchLeads(range, orgId, effectiveAgent),
        fetchDialerSessions(range, orgId, effectiveAgent),
        fetchGoals(orgId),
        fetchLeadSourceCosts(orgId),
        fetchReportCallSummary(orgId, range, effectiveAgent),
        fetchReportCallVolumeTimeseries(orgId, range, effectiveAgent),
        fetchReportDispositionBreakdown(orgId, range, effectiveAgent),
        fetchReportCampaignPerformance(orgId, range, effectiveAgent),
        fetchDispositions(orgId),
        fetchActiveLeadsCount(orgId)
      ]);

      let scQuery = supabase.from("agent_scorecards").select("*").order("week_start", { ascending: false }).limit(200);
      if (orgId) scQuery = scQuery.eq("organization_id", orgId);
      const { data: sc } = await scQuery;

      setAgents(a); setLeads(l); setSessions(sess); setGoals(g);
      setLeadCosts(lc); setScorecards(sc || []);
      setDispositions(dispData); setActiveLeadsCount(leadsCount);

      setSummary(sumData);
      setVolume(volData);
      setBreakdown(brkData);
      setPerformance(perfData);
    } catch (e) {
      console.error("Reports fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [range, orgId, effectiveAgent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSectionsChange = (newSections: SectionConfig[]) => {
    setLayout(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: newSections
      };
    });
  };

  const handleSaveLayout = async () => {
    if (!orgId || !layout) return;
    await saveUserLayout(orgId, layout);
    setEditMode(false);
  };

  const handleResetLayout = async () => {
    if (!orgId) return;
    await resetUserLayout(orgId);
    const newLayout = await fetchUserLayout(orgId);
    setLayout(newLayout);
    setEditMode(false);
  };

  const handleSaveAsDefault = async () => {
    if (!orgId || !layout) return;
    await saveOrgDefaultLayout(orgId, layout);
    setEditMode(false);
  };

  const handleExportAll = () => {
    const rows = [
      ["Total Calls", String(summary?.total_calls || 0)],
      ["Outbound", String(summary?.outbound || 0)],
      ["Inbound", String(summary?.inbound || 0)],
      ["Total Leads", String(leads.length)],
      ["Period", `${formatDate(range.start)} - ${formatDate(range.end)}`],
    ];
    downloadCSV("reports-summary", ["Metric", "Value"], rows);
  };

  const hasData = (summary?.total_calls || 0) > 0 || leads.length > 0;

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-10">
      {/* Slim & Premium Header */}
      <div className="relative overflow-hidden bg-card/60 backdrop-blur-xl border border-primary/10 rounded-[2.5rem] p-6 shadow-xl shadow-primary/5">
        {/* Subtle decorative background elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -ml-32 -mb-32 pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20 border border-white/10">
              <BarChart3 className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground leading-none mb-1.5">Performance Analytics</h1>
              <p className="text-sm text-muted-foreground font-semibold tracking-wide uppercase text-[10px]">Comprehensive intelligence and growth metrics</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border/50">
              {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                <button 
                  key={p} 
                  onClick={() => setPreset(p)}
                  className={cn(
                    "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200",
                    p === preset 
                      ? "bg-background text-foreground shadow-sm border border-border/50" 
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  )}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                className="rounded-xl h-10 px-4 font-semibold active:scale-95 border-border/50"
                onClick={handleExportAll}
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={cn("w-10 h-10 rounded-xl border border-border/50 hover:bg-accent transition-colors", editMode ? "text-primary border-primary bg-primary/5" : "text-muted-foreground")}
                  onClick={() => setEditMode(!editMode)}
                  title="Customize Layout"
                >
                  <Settings2 className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="w-10 h-10 rounded-xl border border-border/50 hover:bg-accent text-muted-foreground"
                  onClick={() => setShowSchedule(true)}
                >
                  <Clock className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="w-10 h-10 rounded-xl border border-border/50 hover:bg-accent text-muted-foreground"
                  onClick={() => setShowMyReports(true)}
                >
                  <Bookmark className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
        
        {preset === "custom" && (
          <div className="mt-4 flex items-center gap-2 bg-muted/30 p-2 rounded-xl border border-border/50 w-fit">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="hover:bg-background/50 h-8 px-3 rounded-lg font-semibold text-xs">
                  <CalendarIcon className="w-3.5 h-3.5 mr-2 text-primary" />
                  {customStart ? formatDate(customStart) : "Start Date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customStart} onSelect={setCustomStart} className="p-3" />
              </PopoverContent>
            </Popover>
            <span className="text-muted-foreground/30 font-medium">/</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="hover:bg-background/50 h-8 px-3 rounded-lg font-semibold text-xs">
                  <CalendarIcon className="w-3.5 h-3.5 mr-2 text-primary" />
                  {customEnd ? formatDate(customEnd) : "End Date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} className="p-3" />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-6 pt-5 border-t border-border/50">
          {isAdmin && (
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Analysis View</span>
              <Select value={selectedAgent || "all"} onValueChange={v => setSelectedAgent(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[160px] h-8 bg-muted/30 border-border/50 text-foreground rounded-lg text-xs font-semibold ring-offset-background">
                  <SelectValue placeholder="Unified View" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Unified View (All)</SelectItem>
                  {nonAdminAgents.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {!hasData && !loading ? (
        <div className="flex flex-col items-center justify-center py-32 text-center bg-white dark:bg-slate-900/50 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-800 shadow-inner">
          <div className="p-6 bg-slate-100 dark:bg-slate-800 rounded-full mb-6">
            <BarChart3 className="w-12 h-12 text-slate-300 dark:text-slate-600" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-2 tracking-tight">Intelligence Stream Empty</h2>
          <p className="text-slate-500 max-w-sm mb-8 font-medium">We couldn't find any performance data for the selected parameters. Start your outreach to populate this dashboard.</p>
          <Button 
            onClick={() => navigate("/dialer")}
            className="h-12 px-8 rounded-2xl font-bold text-sm shadow-xl shadow-primary/20 transition-all hover:scale-105 active:scale-95"
          >
            Launch Dialer Engine
          </Button>
        </div>
      ) : (
        <>
          <ReportCustomizer
            editMode={editMode}
            isAdmin={isAdmin}
            onSave={handleSaveLayout}
            onReset={handleResetLayout}
            onSaveAsDefault={handleSaveAsDefault}
          />

          {layout && layout.sections && (
            <SectionRenderer
              sections={layout.sections}
              editMode={editMode}
              isAdmin={isAdmin}
              onSectionsChange={handleSectionsChange}
              components={{
                ...buildStatComponents({
                  summary, breakdown, volume, sessions, agents, activeLeadsCount, dispositions,
                  dateRange: { from: range.start, to: range.end },
                  loading,
                }),
                call_volume: <CallVolumeChart volume={volume} grouping={grouping} onGroupingChange={setGrouping} loading={loading} />,
                conversion_funnel: <DispositionsPieChart breakdown={breakdown} summary={summary} loading={loading} />,
                communications_stats: <CommunicationsStats summary={summary} range={range} loading={loading} />,
                calling_heatmap: <CallingHeatmap volume={volume} loading={loading} />,
                call_flow_analysis: <CallFlowAnalysis volume={volume} loading={loading} />,
                call_duration_analysis: <CallDurationAnalysis breakdown={breakdown} loading={loading} />,
                disposition_deep_dive: <DispositionDeepDive breakdown={breakdown} dispositions={[]} agents={agents} loading={loading} />,
                policies_sold: <PoliciesSoldChart summary={summary} volume={volume} agents={agents} grouping={grouping} selectedAgent={effectiveAgent} loading={loading} />,
                campaign_performance: <CampaignPerformance performance={performance} loading={loading} />,
                lead_source_roi: <LeadSourceTable performance={performance} costs={leadCosts} loading={loading} isAdmin={isAdmin} onCostsChanged={() => orgId && fetchLeadSourceCosts(orgId).then(setLeadCosts)} />,
                agent_performance_cards: <AgentPerformanceCards summary={summary} agents={agents} goals={goals} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} loading={loading} />,
                agent_efficiency: <AgentEfficiency summary={summary} sessions={sessions} agents={agents} currentUserId={user?.id} isAdmin={isAdmin} loading={loading} />,
                goal_tracking: <GoalTracking scorecards={scorecards} agents={agents} selectedAgent={effectiveAgent} loading={loading} />
              }}
            />
          )}
        </>
      )}

      <CustomReportBuilder open={showMyReports} onClose={() => setShowMyReports(false)} agents={agents} userId={user?.id || ""} onLoadReport={() => {}} />
      <ScheduledReportsModal open={showSchedule} onClose={() => setShowSchedule(false)} agents={agents} userId={user?.id || ""} />
    </div>
  );
};

export default Reports;
