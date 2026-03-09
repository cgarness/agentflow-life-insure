import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Download, BarChart3, CalendarIcon, FileText, Bookmark, Clock, ToggleLeft, ToggleRight } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay, differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  DateRange, Grouping, autoGrouping,
  fetchProfiles, fetchCallsRaw, fetchDispositions,
  fetchCampaignsWithStats, fetchLeads, fetchDialerSessions, fetchGoals,
  fetchCampaignLeads, fetchLeadSourceCosts, downloadCSV,
  AgentProfile,
} from "@/lib/reports-queries";

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

function comparisonRange(range: DateRange): DateRange {
  const days = differenceInDays(range.end, range.start) + 1;
  return { start: startOfDay(subDays(range.start, days)), end: endOfDay(subDays(range.start, 1)) };
}

const PRESET_LABELS: Record<Preset, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 Days", "30d": "Last 30 Days",
  month: "This Month", lastMonth: "Last Month", custom: "Custom",
};

const Reports: React.FC = () => {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role?.toLowerCase() === "admin" || profile?.role?.toLowerCase() === "team leader";

  // Controls
  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState<DateRange>(presetToRange("30d"));
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [grouping, setGrouping] = useState<Grouping>("daily");
  const [comparing, setComparing] = useState(false);

  // Panels
  const [showMyReports, setShowMyReports] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  // Data
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [compCalls, setCompCalls] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [campaignLeads, setCampaignLeads] = useState<any[]>([]);
  const [leadCosts, setLeadCosts] = useState<any[]>([]);
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const effectiveAgent = useMemo(() => {
    if (!isAdmin && profile?.id) return profile.id;
    return selectedAgent && selectedAgent !== "all" ? selectedAgent : undefined;
  }, [isAdmin, profile, selectedAgent]);

  const nonAdminAgents = useMemo(() => agents.filter(a => a.role?.toLowerCase() !== "admin"), [agents]);
  const compRange = useMemo(() => comparisonRange(range), [range]);

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
    setLoading(true);
    try {
      const [a, c, d, camp, l, sess, g, cl, lc] = await Promise.all([
        fetchProfiles(),
        fetchCallsRaw(range, effectiveAgent),
        fetchDispositions(),
        fetchCampaignsWithStats(),
        fetchLeads(range, effectiveAgent),
        fetchDialerSessions(range, effectiveAgent),
        fetchGoals(),
        fetchCampaignLeads(range),
        fetchLeadSourceCosts(),
      ]);

      // Fetch scorecards
      const { data: sc } = await supabase.from("agent_scorecards").select("*").order("week_start", { ascending: false }).limit(200);

      setAgents(a); setCalls(c); setDispositions(d); setCampaigns(camp);
      setLeads(l); setSessions(sess); setGoals(g); setCampaignLeads(cl);
      setLeadCosts(lc); setScorecards(sc || []);

      // Fetch comparison data if comparing
      if (comparing) {
        const cc = await fetchCallsRaw(compRange, effectiveAgent);
        setCompCalls(cc);
      } else {
        setCompCalls([]);
      }
    } catch (e) {
      console.error("Reports fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [range, effectiveAgent, comparing, compRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExportAll = () => {
    const rows = [
      ["Total Calls", String(calls.length)],
      ["Outbound", String(calls.filter(c => c.direction === "outbound").length)],
      ["Inbound", String(calls.filter(c => c.direction === "inbound").length)],
      ["Total Leads", String(leads.length)],
      ["Period", `${format(range.start, "MMM dd yyyy")} - ${format(range.end, "MMM dd yyyy")}`],
    ];
    downloadCSV("reports-summary", ["Metric", "Value"], rows);
  };

  const hasData = calls.length > 0 || leads.length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date preset pills */}
          <div className="flex items-center gap-0.5 bg-accent rounded-lg p-0.5">
            {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
              <button key={p} onClick={() => setPreset(p)}
                className={cn("px-2 py-1.5 text-[11px] rounded-md transition-colors", p === preset ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Custom date pickers */}
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs h-8">
                    <CalendarIcon className="w-3.5 h-3.5 mr-1" />
                    {customStart ? format(customStart, "MMM dd") : "Start"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customStart} onSelect={setCustomStart} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <span className="text-xs text-muted-foreground">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs h-8">
                    <CalendarIcon className="w-3.5 h-3.5 mr-1" />
                    {customEnd ? format(customEnd, "MMM dd") : "End"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Compare toggle */}
          <Button variant={comparing ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setComparing(c => !c)}>
            {comparing ? <ToggleRight className="w-3.5 h-3.5 mr-1" /> : <ToggleLeft className="w-3.5 h-3.5 mr-1" />}
            Compare
          </Button>

          {/* Agent filter */}
          {isAdmin && (
            <Select value={selectedAgent || "all"} onValueChange={v => setSelectedAgent(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="All Agents" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {nonAdminAgents.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* My Reports */}
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowMyReports(true)}>
            <Bookmark className="w-3.5 h-3.5 mr-1" /> My Reports
          </Button>

          {/* Schedule */}
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowSchedule(true)}>
            <Clock className="w-3.5 h-3.5 mr-1" /> Schedule
          </Button>

          {/* Export */}
          <TooltipProvider>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExportAll}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export All
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>PDF export coming soon</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </div>

      {/* Comparison legend */}
      {comparing && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground bg-accent/50 rounded-lg px-3 py-2">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary" /> {format(range.start, "MMM dd")} – {format(range.end, "MMM dd")}</span>
          <span>vs</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary/30" /> {format(compRange.start, "MMM dd")} – {format(compRange.end, "MMM dd")}</span>
        </div>
      )}

      {!hasData && !loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <BarChart3 className="w-16 h-16 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1">No data available for this period</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">Try selecting a different date range or start making calls to see your analytics</p>
          <Button onClick={() => navigate("/dialer")}>Go to Dialer</Button>
        </div>
      ) : (
        <>
          {/* Agent Performance Cards */}
          {isAdmin && (
            <AgentPerformanceCards calls={calls} agents={agents} goals={goals} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} loading={loading} />
          )}

          {/* Report 1 — Call Volume */}
          <CallVolumeChart calls={calls} compCalls={comparing ? compCalls : undefined} agents={agents} grouping={grouping} onGroupingChange={setGrouping} loading={loading} comparing={comparing} />

          {/* Report 2 + 3 — Dispositions + Policies Sold */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <DispositionsPieChart calls={calls} dispositions={dispositions} grouping={grouping} loading={loading} />
            <PoliciesSoldChart calls={calls} compCalls={comparing ? compCalls : undefined} agents={agents} grouping={grouping} selectedAgent={effectiveAgent} loading={loading} comparing={comparing} />
          </div>

          {/* Report 4 — Campaign Performance */}
          <CampaignPerformance campaigns={campaigns} loading={loading} />

          {/* Report 5 — Lead Source + ROI */}
          <LeadSourceTable leads={leads} costs={leadCosts} loading={loading} isAdmin={isAdmin} onCostsChanged={() => fetchLeadSourceCosts().then(setLeadCosts)} />

          {/* Report 6 + 7 — Communications + Heatmap */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <CommunicationsStats calls={calls} compCalls={comparing ? compCalls : undefined} range={range} loading={loading} comparing={comparing} />
            <CallingHeatmap calls={calls} loading={loading} />
          </div>

          {/* Report 8 — Call Duration Analysis */}
          <CallDurationAnalysis calls={calls} dispositions={dispositions} loading={loading} />

          {/* Report 9 — Agent Efficiency */}
          {isAdmin && (
            <AgentEfficiency calls={calls} sessions={sessions} agents={agents} currentUserId={user?.id} isAdmin={isAdmin} loading={loading} />
          )}

          {/* Report 10 — Call Flow Analysis */}
          <CallFlowAnalysis calls={calls} campaignLeads={campaignLeads} loading={loading} />

          {/* Report 11 — Disposition Deep Dive */}
          <DispositionDeepDive calls={calls} dispositions={dispositions} agents={agents} campaigns={campaigns} loading={loading} />

          {/* Report 12 — Goal Tracking */}
          <GoalTracking scorecards={scorecards} agents={agents} selectedAgent={effectiveAgent} loading={loading} />
        </>
      )}

      {/* Panels & Modals */}
      <CustomReportBuilder open={showMyReports} onClose={() => setShowMyReports(false)} agents={agents} userId={user?.id || ""} onLoadReport={() => {}} />
      <ScheduledReportsModal open={showSchedule} onClose={() => setShowSchedule(false)} agents={agents} userId={user?.id || ""} />
    </div>
  );
};

export default Reports;
