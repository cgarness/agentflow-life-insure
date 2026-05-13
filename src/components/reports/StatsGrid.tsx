import React from "react";
import StatCard from "./StatCard";
import { ReportCallSummary, ReportDispositionBreakdown } from "@/lib/reports-queries";
import { differenceInDays } from "date-fns";

interface Props {
  summary?: ReportCallSummary;
  compSummary?: ReportCallSummary;
  breakdown?: ReportDispositionBreakdown;
  compBreakdown?: ReportDispositionBreakdown;
  sessions?: any[];
  activeLeadsCount?: number;
  dispositions?: any[];
  dateRange?: { from?: Date; to?: Date };
  comparing: boolean;
  loading: boolean;
}

export function buildStatComponents(props: Props): Record<string, React.ReactNode> {
  const { summary, compSummary, breakdown, compBreakdown, sessions, activeLeadsCount, dispositions, dateRange, comparing, loading } = props;

  // Helpers
  const calcTrend = (current: number, comp: number, isGoodUp: boolean = true) => {
    if (!comparing || !comp) return undefined;
    const diff = current - comp;
    const pct = comp > 0 ? (diff / comp) * 100 : 0;
    return { value: pct, label: "vs prior", isGoodUp };
  };

  const getCount = (sum?: ReportCallSummary) => sum?.total_calls || 0;
  const getContacted = (sum?: ReportCallSummary) => sum?.contacted || 0;
  const getConverted = (sum?: ReportCallSummary) => sum?.converted || 0;
  
  const getAppts = (bd?: ReportDispositionBreakdown) => {
    if (!bd || !dispositions) return 0;
    const apptSet = new Set(dispositions.filter(d => d.appointment_scheduler).map(d => d.name.toLowerCase()));
    return bd.by_disposition.filter(d => apptSet.has(d.disposition_name.toLowerCase())).reduce((acc, curr) => acc + curr.count, 0);
  };
  
  const getDNC = (bd?: ReportDispositionBreakdown) => {
    if (!bd || !dispositions) return 0;
    const dncSet = new Set(dispositions.filter(d => d.auto_add_to_dnc).map(d => d.name.toLowerCase()));
    return bd.by_disposition.filter(d => dncSet.has(d.disposition_name.toLowerCase())).reduce((acc, curr) => acc + curr.count, 0);
  };
  
  const getCallbacks = (bd?: ReportDispositionBreakdown) => {
    if (!bd || !dispositions) return 0;
    const cbSet = new Set(dispositions.filter(d => d.callback_scheduler).map(d => d.name.toLowerCase()));
    return bd.by_disposition.filter(d => cbSet.has(d.disposition_name.toLowerCase())).reduce((acc, curr) => acc + curr.count, 0);
  };

  const formatSecs = (s?: number) => {
    if (!s) return "0s";
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const cTotal = getCount(summary);
  const compTotal = getCount(compSummary);
  
  const cContacted = getContacted(summary);
  const compContacted = getContacted(compSummary);
  
  const cConverted = getConverted(summary);
  const compConverted = getConverted(compSummary);
  
  const cAppts = getAppts(breakdown);
  const compAppts = getAppts(compBreakdown);

  const cDNC = getDNC(breakdown);
  const compDNC = getDNC(compBreakdown);

  const cCallbacks = getCallbacks(breakdown);
  const compCallbacks = getCallbacks(compBreakdown);

  // Stats calculation
  const totalSessionHours = sessions ? sessions.reduce((acc, s) => acc + (s.duration_seconds || 0), 0) / 3600 : 0;
  
  let daysInRange = 1;
  if (dateRange?.from && dateRange?.to) {
    daysInRange = differenceInDays(dateRange.to, dateRange.from) + 1;
  }
  if (daysInRange < 1) daysInRange = 1;

  const topAgent = summary?.calls_by_agent && summary.calls_by_agent.length > 0  
    ? summary.calls_by_agent.reduce((prev, current) => (prev.converted > current.converted) ? prev : current)
    : null;

  const components: Record<string, React.ReactNode> = {
    stat_total_dials: <StatCard label="Total Dials" value={cTotal.toString()} trend={calcTrend(cTotal, compTotal)} />,
    
    stat_contact_rate: <StatCard label="Contact Rate" 
      value={cTotal > 0 ? `${((cContacted / cTotal) * 100).toFixed(1)}%` : "—"} 
      trend={calcTrend(cTotal > 0 ? (cContacted / cTotal) : 0, compTotal > 0 ? (compContacted / compTotal) : 0)} />,
      
    stat_policies_sold: <StatCard label="Policies Sold" value={cConverted.toString()} trend={calcTrend(cConverted, compConverted)} />,
    
    stat_contacted_to_close: <StatCard label="Contacted to Close" 
      value={cContacted > 0 ? `${((cConverted / cContacted) * 100).toFixed(1)}%` : "—"} 
      trend={calcTrend(cContacted > 0 ? (cConverted / cContacted) : 0, compContacted > 0 ? (compConverted / compContacted) : 0)} />,
      
    stat_appointments_set: <StatCard label="Appointments Set" value={cAppts.toString()} trend={calcTrend(cAppts, compAppts)} />,
    
    stat_appt_to_close: <StatCard label="Appt to Close" 
      value={cAppts > 0 ? `${((cConverted / cAppts) * 100).toFixed(1)}%` : "—"} 
      trend={calcTrend(cAppts > 0 ? (cConverted / cAppts) : 0, compAppts > 0 ? (compConverted / compAppts) : 0)} />,
      
    stat_dials_per_sale: <StatCard label="Dials per Sale" 
      value={cConverted > 0 ? Math.round(cTotal / cConverted).toString() : "—"} 
      trend={calcTrend(cConverted > 0 ? (cTotal / cConverted) : 0, compConverted > 0 ? (compTotal / compConverted) : 0, false)} />,
      
    stat_calls_per_hour: <StatCard label="Calls per Hour" 
      value={totalSessionHours > 0 ? Math.round(cTotal / totalSessionHours).toString() : "—"} />,
      
    stat_call_to_close: <StatCard label="Call to Close" 
      value={cTotal > 0 ? `${((cConverted / cTotal) * 100).toFixed(1)}%` : "—"} 
      trend={calcTrend(cTotal > 0 ? (cConverted / cTotal) : 0, compTotal > 0 ? (compConverted / compTotal) : 0)} />,
      
    stat_total_talk_time: <StatCard label="Total Talk Time" value={formatSecs(summary?.total_duration_seconds)} />,
    
    stat_speed_to_contact: <StatCard label="Speed to Contact" value="—" comingSoon subtitle="Coming Soon" />,
    
    stat_contacted_to_appt: <StatCard label="Contacted to Appt" 
      value={cContacted > 0 ? `${((cAppts / cContacted) * 100).toFixed(1)}%` : "—"} 
      trend={calcTrend(cContacted > 0 ? (cAppts / cContacted) : 0, compContacted > 0 ? (compAppts / compContacted) : 0)} />,
      
    stat_avg_talk_time: <StatCard label="Avg Talk Time" value={formatSecs(summary?.avg_duration_seconds)} />,
    
    stat_dnc_rate: <StatCard label="DNC Rate" 
      value={cTotal > 0 ? `${((cDNC / cTotal) * 100).toFixed(1)}%` : "—"} 
      trend={calcTrend(cTotal > 0 ? (cDNC / cTotal) : 0, compTotal > 0 ? (compDNC / compTotal) : 0, false)} />,
      
    stat_unique_leads: <StatCard label="Unique Leads Dialed" value="—" comingSoon subtitle="Coming Soon" />,
    
    stat_callback_rate: <StatCard label="Callback Rate" 
      value={cContacted > 0 ? `${((cCallbacks / cContacted) * 100).toFixed(1)}%` : "—"} 
      trend={calcTrend(cContacted > 0 ? (cCallbacks / cContacted) : 0, compContacted > 0 ? (compCallbacks / compContacted) : 0)} />,
      
    stat_active_leads: <StatCard label="Active Leads Remaining" value={activeLeadsCount !== undefined ? activeLeadsCount.toString() : "—"} />,
    
    stat_first_dial_contact: <StatCard label="First Dial Contact" value="—" comingSoon subtitle="Coming Soon" />,
    
    stat_calls_per_day: <StatCard label="Calls per Day" 
      value={daysInRange > 0 ? Math.round(cTotal / daysInRange).toString() : "—"} />,
    
    stat_top_performer: <StatCard label="Top Performer" 
      value={topAgent ? topAgent.agent_name : "—"} 
      subtitle={topAgent ? `${topAgent.converted} sales` : undefined} />
  };

  return components;
}
