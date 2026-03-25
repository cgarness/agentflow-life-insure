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
import GeographicHeatmap from "@/components/reports/GeographicHeatmap";

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
  const [loading, setLoading] = useState(true);
  const [outcomesData, setOutcomesData] = useState<any[]>([]);
  const [outcomesTotal, setOutcomesTotal] = useState(0);
  const [outcomesLoading, setOutcomesLoading] = useState(true);

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

      const { data: sc } = await supabase.from("agent_scorecards").select("*").order("week_start", { ascending: false }).limit(200);

      setAgents(a); setCalls(c); setDispositions(d); setCampaigns(camp);
      setLeads(l); setSessions(sess); setGoals(g); setCampaignLeads(cl);
      setLeadCosts(lc); setScorecards(sc || []);

      const { data: outcomeRows, error: outcomesError } = await supabase
        .from('calls')
        .select('disposition_name')
        .not('disposition_name', 'is', null);
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
        const cc = await fetchCallsRaw(compRange, effectiveAgent);
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
  }, [range, effectiveAgent, comparing, compRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // State-filtered data: when a state is selected on the map, filter calls and leads
  const filteredCalls = useMemo(() => {
    if (!stateFilter) return calls;
    // Build contact_id → state and campaign_lead_id → state maps
    const contactState = new Map<string, string>();
    for (const l of leads) {
      const st = l.state?.trim().toUpperCase();
      if (st && l.id) contactState.set(l.id, st.length === 2 ? st : "");
    }
    const clState = new Map<string, string>();
    for (const cl of campaignLeads) {
      const st = cl.state?.trim().toUpperCase();
      if (st && cl.id) clState.set(cl.id, st.length === 2 ? st : "");
    }
    return calls.filter(c => {
      const s1 = contactState.get(c.contact_id);
      const s2 = c.campaign_lead_id ? clState.get(c.campaign_lead_id) : undefined;
      return s1 === stateFilter || s2 === stateFilter;
    });
  }, [calls, leads, campaignLeads, stateFilter]);

  const filteredLeads = useMemo(() => {
    if (!stateFilter) return leads;
    return leads.filter(l => {
      const st = l.state?.trim().toUpperCase();
      return st === stateFilter;
    });
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          {stateFilter && (
            <Badge variant="secondary" className="flex items-center gap-1 text-xs">
              Filtering by: {STATE_NAMES[stateFilter] || stateFilter}
              <button onClick={() => setStateFilter(null)} className="ml-0.5 hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
        </div>
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

          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs h-8">
                    <CalendarIcon className="w-3.5 h-3.5 mr-1" />
                    {customStart ? formatDate(customStart) : "Start"}
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
                    {customEnd ? formatDate(customEnd) : "End"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          )}

          <Button variant={comparing ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setComparing(c => !c)}>
            {comparing ? <ToggleRight className="w-3.5 h-3.5 mr-1" /> : <ToggleLeft className="w-3.5 h-3.5 mr-1" />}
            Compare
          </Button>

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

          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowMyReports(true)}>
            <Bookmark className="w-3.5 h-3.5 mr-1" /> My Reports
          </Button>

          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowSchedule(true)}>
            <Clock className="w-3.5 h-3.5 mr-1" /> Schedule
          </Button>

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

      {comparing && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground bg-accent/50 rounded-lg px-3 py-2">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary" /> {formatDate(range.start)} – {formatDate(range.end)}</span>
          <span>vs</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary/30" /> {formatDate(compRange.start)} – {formatDate(compRange.end)}</span>
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
          {isAdmin && (
            <AgentPerformanceCards calls={activeCalls} agents={agents} goals={goals} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} loading={loading} />
          )}

          <CallVolumeChart calls={activeCalls} compCalls={comparing ? compCalls : undefined} agents={agents} grouping={grouping} onGroupingChange={setGrouping} loading={loading} comparing={comparing} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {outcomesLoading ? (
              <div className="bg-card rounded-xl border p-5">
                <div className="h-6 w-48 bg-muted animate-pulse rounded mb-4" />
                <div className="h-[350px] bg-muted animate-pulse rounded" />
              </div>
            ) : outcomesData.length === 0 ? (
              <div className="bg-card rounded-xl border p-5 flex items-center justify-center h-[200px]">
                <p className="text-sm text-muted-foreground text-center">No call data available for this period</p>
              </div>
            ) : (
              <DispositionsPieChart calls={activeCalls} dispositions={dispositions} grouping={grouping} loading={loading} />
            )}
            <PoliciesSoldChart calls={activeCalls} compCalls={comparing ? compCalls : undefined} agents={agents} grouping={grouping} selectedAgent={effectiveAgent} loading={loading} comparing={comparing} />
          </div>

          <CampaignPerformance campaigns={campaigns} loading={loading} />

          <LeadSourceTable leads={activeLeads} costs={leadCosts} loading={loading} isAdmin={isAdmin} onCostsChanged={() => fetchLeadSourceCosts().then(setLeadCosts)} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <CommunicationsStats calls={activeCalls} compCalls={comparing ? compCalls : undefined} range={range} loading={loading} comparing={comparing} />
            <CallingHeatmap calls={activeCalls} loading={loading} />
          </div>

          <CallDurationAnalysis calls={activeCalls} dispositions={dispositions} loading={loading} />

          {isAdmin && (
            <AgentEfficiency calls={activeCalls} sessions={sessions} agents={agents} currentUserId={user?.id} isAdmin={isAdmin} loading={loading} />
          )}

          <CallFlowAnalysis calls={activeCalls} campaignLeads={campaignLeads} loading={loading} />

          <DispositionDeepDive calls={activeCalls} dispositions={dispositions} agents={agents} campaigns={campaigns} loading={loading} />

          <GoalTracking scorecards={scorecards} agents={agents} selectedAgent={effectiveAgent} loading={loading} />

          {/* Report 13 — Geographic Heatmap */}
          <GeographicHeatmap
            calls={calls}
            leads={leads}
            campaignLeads={campaignLeads}
            dispositions={dispositions}
            loading={loading}
            onStateFilter={setStateFilter}
            activeStateFilter={stateFilter}
          />
        </>
      )}

      <CustomReportBuilder open={showMyReports} onClose={() => setShowMyReports(false)} agents={agents} userId={user?.id || ""} onLoadReport={() => {}} />
      <ScheduledReportsModal open={showSchedule} onClose={() => setShowSchedule(false)} agents={agents} userId={user?.id || ""} />
    </div>
  );
};

export default Reports;
