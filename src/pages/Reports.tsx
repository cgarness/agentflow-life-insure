import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Download, BarChart3, CalendarIcon, FileText, Bookmark, Clock, ToggleLeft, ToggleRight, X } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay, differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useBranding } from "@/contexts/BrandingContext";
import { supabase } from "@/integrations/supabase/client";
import {
  DateRange, Grouping, autoGrouping,
  fetchProfiles, fetchCallsRaw, fetchDispositions, fetchPipelineStages,
  fetchCampaignsWithStats, fetchLeads, fetchDialerSessions, fetchGoals,
  fetchCampaignLeads, fetchLeadSourceCosts, downloadCSV,
  AgentProfile,
} from "@/lib/reports-queries";
import { buildConvertedDispositionSet } from "@/lib/report-utils";

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

// State abbreviation to full name for the filter badge
const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
  DC:"District of Columbia",
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
  const [comparing, setComparing] = useState(false);
  const [stateFilter, setStateFilter] = useState<string | null>(null);

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
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [outcomesData, setOutcomesData] = useState<any[]>([]);
  const [outcomesTotal, setOutcomesTotal] = useState(0);
  const [outcomesLoading, setOutcomesLoading] = useState(true);

  const effectiveAgent = useMemo(() => {
    if (!isAdmin && profile?.id) return profile.id;
    return selectedAgent && selectedAgent !== "all" ? selectedAgent : undefined;
  }, [isAdmin, profile, selectedAgent]);

  const nonAdminAgents = useMemo(() => agents, [agents]);
  const compRange = useMemo(() => comparisonRange(range), [range]);

  const convertedSet = useMemo(
    () => buildConvertedDispositionSet(dispositions, pipelineStages),
    [dispositions, pipelineStages],
  );

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
        fetchProfiles(orgId),
        fetchCallsRaw(range, orgId, effectiveAgent),
        fetchDispositions(orgId),
        fetchCampaignsWithStats(orgId),
        fetchLeads(range, orgId, effectiveAgent),
        fetchDialerSessions(range, orgId, effectiveAgent),
        fetchGoals(orgId),
        fetchCampaignLeads(range, orgId),
        fetchLeadSourceCosts(orgId),
      ]);

      // Pipeline stages: isolated try/catch so failure doesn't crash reports
      let ps: any[] = [];
      try { ps = await fetchPipelineStages(orgId); } catch (e) { console.warn("Failed to fetch pipeline stages:", e); }

      let scQuery = supabase.from("agent_scorecards").select("*").order("week_start", { ascending: false }).limit(200);
      if (orgId) scQuery = scQuery.eq("organization_id", orgId);
      const { data: sc } = await scQuery;

      setAgents(a); setCalls(c); setDispositions(d); setCampaigns(camp);
      setLeads(l); setSessions(sess); setGoals(g); setCampaignLeads(cl);
      setLeadCosts(lc); setScorecards(sc || []); setPipelineStages(ps);

      let outcomesQuery = supabase
        .from('calls')
        .select('disposition_name')
        .gte("started_at", startOfDay(range.start).toISOString())
        .lte("started_at", endOfDay(range.end).toISOString())
        .not('disposition_name', 'is', null);
      if (orgId) outcomesQuery = outcomesQuery.eq("organization_id", orgId);
        
      if (effectiveAgent) {
        outcomesQuery = outcomesQuery.eq("agent_id", effectiveAgent);
      }

      const { data: outcomeRows, error: outcomesError } = await outcomesQuery;
      if (!outcomesError && outcomeRows) {
        const counts: Record<string, number> = {};
        outcomeRows.forEach(row => {
          const key = row.disposition_name || 'No Disposition';
          counts[key] = (counts[key] || 0) + 1;
        });
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const formatted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([name, value]) => ({
            name,
            value,
            pct: total > 0 ? `${Math.round((value / total) * 100)}%` : '0%'
          }));
        setOutcomesData(formatted);
        setOutcomesTotal(total);
        setOutcomesLoading(false);
      }

      if (comparing) {
        const cc = await fetchCallsRaw(compRange, orgId, effectiveAgent);
        setCompCalls(cc);
      } else {
        setCompCalls([]);
      }
    } catch (e) {
      console.error("Reports fetch error:", e);
    } finally {
      setLoading(false);
      setOutcomesLoading(false);
    }
  }, [range, orgId, effectiveAgent, comparing, compRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // State-filtered data: when a state is selected on the map, filter calls and leads
  const filteredCalls = useMemo(() => {
    try {
      if (!stateFilter) return calls;
      const contactState = new Map<string, string>();
      for (const l of leads) {
        if (typeof l.state === 'string') {
          const st = l.state.trim().toUpperCase();
          if (st && l.id) contactState.set(l.id, st.length === 2 ? st : "");
        }
      }
      const clState = new Map<string, string>();
      for (const cl of campaignLeads) {
        if (typeof cl.state === 'string') {
          const st = cl.state.trim().toUpperCase();
          if (st && cl.id) clState.set(cl.id, st.length === 2 ? st : "");
        }
      }
      return calls.filter(c => {
        const s1 = c.contact_id ? contactState.get(c.contact_id) : undefined;
        const s2 = c.campaign_lead_id ? clState.get(c.campaign_lead_id) : undefined;
        return s1 === stateFilter || s2 === stateFilter;
      });
    } catch (e) {
      console.error("Error in filteredCalls:", e);
      return calls;
    }
  }, [calls, leads, campaignLeads, stateFilter]);

  const filteredLeads = useMemo(() => {
    try {
      if (!stateFilter) return leads;
      return leads.filter(l => {
        if (typeof l.state !== 'string') return false;
        return l.state.trim().toUpperCase() === stateFilter;
      });
    } catch (e) {
      console.error("Error in filteredLeads:", e);
      return leads;
    }
  }, [leads, stateFilter]);

  const handleExportAll = () => {
    const c = stateFilter ? filteredCalls : calls;
    const l = stateFilter ? filteredLeads : leads;
    const rows = [
      ["Total Calls", String(c.length)],
      ["Outbound", String(c.filter(x => x.direction === "outbound").length)],
      ["Inbound", String(c.filter(x => x.direction === "inbound").length)],
      ["Total Leads", String(l.length)],
      ["Period", `${formatDate(range.start)} - ${formatDate(range.end)}`],
      ...(stateFilter ? [["State Filter", STATE_NAMES[stateFilter] || stateFilter]] : []),
    ];
    downloadCSV("reports-summary", ["Metric", "Value"], rows);
  };

  const activeCalls = stateFilter ? filteredCalls : calls;
  const activeLeads = stateFilter ? filteredLeads : leads;
  const hasData = activeCalls.length > 0 || activeLeads.length > 0;

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-10">
      {/* Premium Header Banner */}
      <div className="relative overflow-hidden bg-slate-900 rounded-[2rem] p-8 md:p-10 shadow-2xl shadow-slate-200 dark:shadow-none border border-slate-800">
        <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-primary/20 to-transparent pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-primary/20 rounded-2xl backdrop-blur-md border border-primary/30">
                <BarChart3 className="w-6 h-6 text-primary-foreground" />
              </div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">Performance Analytics</h1>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-slate-400 font-medium text-lg">Comprehensive intelligence and growth metrics</p>
              {stateFilter && (
                <Badge className="bg-primary/20 text-primary-foreground border-primary/30 px-3 py-1 text-xs uppercase font-bold tracking-wider hover:bg-primary/30 transition-all cursor-default">
                  Region: {STATE_NAMES[stateFilter] || stateFilter}
                  <button onClick={() => setStateFilter(null)} className="ml-2 hover:text-white transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-1 bg-slate-800/50 p-1.5 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
              {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                <button 
                  key={p} 
                  onClick={() => setPreset(p)}
                  className={cn(
                    "px-4 py-2 text-xs font-bold rounded-xl transition-all duration-200 uppercase tracking-tighter",
                    p === preset 
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                      : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                  )}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                className="bg-white/5 border-slate-700 text-slate-200 hover:bg-white/10 hover:text-white rounded-2xl h-12 px-6 font-bold text-sm transition-all border-2 active:scale-95"
                onClick={handleExportAll}
              >
                <Download className="w-4 h-4 mr-2" />
                Export Intelligence
              </Button>
              
              <div className="hidden lg:flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="w-12 h-12 rounded-2xl bg-white/5 border-slate-700 hover:bg-white/10 text-slate-400 border"
                  onClick={() => setShowSchedule(true)}
                >
                  <Clock className="w-5 h-5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="w-12 h-12 rounded-2xl bg-white/5 border-slate-700 hover:bg-white/10 text-slate-400 border"
                  onClick={() => setShowMyReports(true)}
                >
                  <Bookmark className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
        
        {preset === "custom" && (
          <div className="relative z-10 mt-6 flex items-center gap-3 bg-white/5 p-3 rounded-2xl border border-white/10 inline-flex">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="text-white hover:bg-white/10 h-10 px-4 rounded-xl font-bold">
                  <CalendarIcon className="w-4 h-4 mr-2 text-primary" />
                  {customStart ? formatDate(customStart) : "Start Date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customStart} onSelect={setCustomStart} className="p-3" />
              </PopoverContent>
            </Popover>
            <span className="text-slate-500 font-black">/</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="text-white hover:bg-white/10 h-10 px-4 rounded-xl font-bold">
                  <CalendarIcon className="w-4 h-4 mr-2 text-primary" />
                  {customEnd ? formatDate(customEnd) : "End Date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} className="p-3" />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div className="relative z-10 mt-6 flex items-center gap-6 pt-6 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-slate-500 text-xs font-black uppercase tracking-widest">Compare Mode</span>
            <button 
              onClick={() => setComparing(c => !c)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
                comparing ? "bg-primary" : "bg-slate-700"
              )}
            >
              <span className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                comparing ? "translate-x-6" : "translate-x-1"
              )} />
            </button>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-3">
              <span className="text-slate-500 text-xs font-black uppercase tracking-widest">Analysis View</span>
              <Select value={selectedAgent || "all"} onValueChange={v => setSelectedAgent(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[180px] h-9 bg-white/5 border-slate-700 text-white rounded-xl text-xs font-bold ring-offset-slate-900">
                  <SelectValue placeholder="Unified View" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-white">
                  <SelectItem value="all">Unified View (All)</SelectItem>
                  {nonAdminAgents.map(a => (
                    <SelectItem key={a.id} value={a.id} className="focus:bg-primary focus:text-white">{a.first_name} {a.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {comparing && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground bg-accent/50 rounded-lg px-3 py-2">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary" /> {formatDate(range.start)} – {formatDate(range.end)}</span>
          <span>vs</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary/30" /> {formatDate(compRange.start)} – {formatDate(compRange.end)}</span>
        </div>
      )}

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
          {isAdmin && (
            <AgentPerformanceCards calls={activeCalls} agents={agents} goals={goals} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} loading={loading} convertedSet={convertedSet} />
          )}

          <CallVolumeChart calls={activeCalls} compCalls={comparing ? compCalls : undefined} agents={agents} grouping={grouping} onGroupingChange={setGrouping} loading={loading} comparing={comparing} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {outcomesLoading ? (
              <div className="bg-card rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-6 shadow-sm">
                <div className="h-6 w-48 bg-muted animate-pulse rounded mb-4" />
                <div className="h-[350px] bg-muted animate-pulse rounded" />
              </div>
            ) : outcomesData.length === 0 ? (
              <div className="bg-card rounded-2xl border border-slate-200/60 dark:border-slate-800/60 p-6 shadow-sm flex items-center justify-center h-[200px]">
                <p className="text-sm text-muted-foreground text-center">No call data available for this period</p>
              </div>
            ) : (
              <DispositionsPieChart calls={activeCalls} dispositions={dispositions} grouping={grouping} loading={loading} convertedSet={convertedSet} />
            )}
            <PoliciesSoldChart calls={activeCalls} compCalls={comparing ? compCalls : undefined} agents={agents} grouping={grouping} selectedAgent={effectiveAgent} loading={loading} comparing={comparing} convertedSet={convertedSet} />
          </div>

          <div className="space-y-6">
            <CampaignPerformance campaigns={campaigns} loading={loading} />
            <LeadSourceTable leads={activeLeads} costs={leadCosts} loading={loading} isAdmin={isAdmin} onCostsChanged={() => fetchLeadSourceCosts(orgId).then(setLeadCosts)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CommunicationsStats calls={activeCalls} compCalls={comparing ? compCalls : undefined} range={range} loading={loading} comparing={comparing} />
            <CallingHeatmap calls={activeCalls} loading={loading} />
          </div>

          <CallDurationAnalysis calls={activeCalls} dispositions={dispositions} loading={loading} convertedSet={convertedSet} />

          {isAdmin && (
            <AgentEfficiency calls={activeCalls} sessions={sessions} agents={agents} currentUserId={user?.id} isAdmin={isAdmin} loading={loading} convertedSet={convertedSet} />
          )}

          <CallFlowAnalysis calls={activeCalls} campaignLeads={campaignLeads} loading={loading} convertedSet={convertedSet} />

          <DispositionDeepDive calls={activeCalls} dispositions={dispositions} agents={agents} campaigns={campaigns} loading={loading} />

          <GoalTracking scorecards={scorecards} agents={agents} selectedAgent={effectiveAgent} loading={loading} />


        </>
      )}

      <CustomReportBuilder open={showMyReports} onClose={() => setShowMyReports(false)} agents={agents} userId={user?.id || ""} onLoadReport={() => {}} />
      <ScheduledReportsModal open={showSchedule} onClose={() => setShowSchedule(false)} agents={agents} userId={user?.id || ""} />
    </div>
  );
};

export default Reports;
