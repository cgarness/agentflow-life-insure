import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Download, BarChart3, CalendarIcon, FileText } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  DateRange, Grouping, autoGrouping,
  fetchProfiles, fetchCallsRaw, fetchDispositions,
  fetchCampaignsWithStats, fetchLeads, downloadCSV,
  AgentProfile,
} from "@/lib/reports-queries";

import CallVolumeChart from "@/components/reports/CallVolumeChart";
import DispositionsPieChart from "@/components/reports/DispositionsPieChart";
import PoliciesSoldChart from "@/components/reports/PoliciesSoldChart";
import CampaignPerformance from "@/components/reports/CampaignPerformance";
import LeadSourceTable from "@/components/reports/LeadSourceTable";
import CommunicationsStats from "@/components/reports/CommunicationsStats";
import CallingHeatmap from "@/components/reports/CallingHeatmap";

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
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role?.toLowerCase() === "admin" || profile?.role?.toLowerCase() === "team leader";

  const [preset, setPreset] = useState<Preset>("30d");
  const [range, setRange] = useState<DateRange>(presetToRange("30d"));
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [grouping, setGrouping] = useState<Grouping>("daily");

  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const effectiveAgent = useMemo(() => {
    if (!isAdmin && profile?.id) return profile.id;
    return selectedAgent || undefined;
  }, [isAdmin, profile, selectedAgent]);

  const nonAdminAgents = useMemo(() => agents.filter(a => a.role?.toLowerCase() !== "admin"), [agents]);

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
      const [a, c, d, camp, l] = await Promise.all([
        fetchProfiles(),
        fetchCallsRaw(range, effectiveAgent),
        fetchDispositions(),
        fetchCampaignsWithStats(),
        fetchLeads(range, effectiveAgent),
      ]);
      setAgents(a);
      setCalls(c);
      setDispositions(d);
      setCampaigns(camp);
      setLeads(l);
    } catch (e) {
      console.error("Reports fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [range, effectiveAgent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExportAll = () => {
    // Export summary CSV
    const rows = [
      ["Total Calls", String(calls.length)],
      ["Outbound", String(calls.filter(c => c.direction === "outbound").length)],
      ["Inbound", String(calls.filter(c => c.direction === "inbound").length)],
      ["Policies Sold", String(calls.filter(c => { const dn = (c.disposition_name || "").toLowerCase(); return dn.includes("sold") || dn.includes("policy"); }).length)],
      ["Total Leads", String(leads.length)],
      ["Period", `${format(range.start, "MMM dd yyyy")} - ${format(range.end, "MMM dd yyyy")}`],
    ];
    downloadCSV("reports-summary", ["Metric", "Value"], rows);
  };

  const hasData = calls.length > 0 || leads.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date preset pills */}
          <div className="flex items-center gap-1 bg-accent rounded-lg p-0.5">
            {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
              <button key={p} onClick={() => setPreset(p)}
                className={cn("px-2.5 py-1.5 text-xs rounded-md transition-colors", p === preset ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
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

          {/* Agent filter */}
          {isAdmin && (
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="All Agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {nonAdminAgents.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

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

      {!hasData && !loading ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <BarChart3 className="w-16 h-16 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1">No data available for this period</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">Try selecting a different date range or start making calls to see your analytics</p>
          <Button onClick={() => navigate("/dialer")}>Go to Dialer</Button>
        </div>
      ) : (
        <>
          {/* Report 1 — Call Volume (full width) */}
          <CallVolumeChart calls={calls} agents={agents} grouping={grouping} onGroupingChange={setGrouping} loading={loading} />

          {/* Row: Dispositions + Policies Sold */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DispositionsPieChart calls={calls} dispositions={dispositions} loading={loading} />
            <PoliciesSoldChart calls={calls} agents={agents} grouping={grouping} selectedAgent={effectiveAgent} loading={loading} />
          </div>

          {/* Report 4 — Campaign Performance (full width) */}
          <CampaignPerformance campaigns={campaigns} loading={loading} />

          {/* Report 5 — Lead Source Performance (full width) */}
          <LeadSourceTable leads={leads} loading={loading} />

          {/* Row: Communications + Heatmap */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <CommunicationsStats calls={calls} loading={loading} />
            <CallingHeatmap calls={calls} loading={loading} />
          </div>
        </>
      )}
    </div>
  );
};

export default Reports;
