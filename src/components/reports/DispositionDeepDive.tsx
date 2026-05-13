import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, getAgentName, downloadCSV, ReportDispositionBreakdown } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props { breakdown?: ReportDispositionBreakdown; dispositions: any[]; agents: AgentProfile[]; loading: boolean; }

const COLORS = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#6B7280"];

const DispositionDeepDive: React.FC<Props> = ({ breakdown, dispositions, agents, loading }) => {
  const [view, setView] = useState<"byAgent" | "byCampaign">("byAgent");
  const [normalized, setNormalized] = useState(false);

  const dispNames = useMemo(() => dispositions.slice(0, 8).map(d => d.name), [dispositions]);
  const dispColorMap = useMemo(() => new Map(dispositions.map((d, i) => [d.name, d.color || COLORS[i % COLORS.length]])), [dispositions]);

  const { agentData, campaignData } = useMemo(() => {
    if (!breakdown) return { agentData: [], campaignData: [] };

    // By agent
    const agentData = (breakdown.by_agent || []).map(a => {
      const row: any = { name: getAgentName(agents, a.agent_id) };
      const total = Object.values(a.dispositions).reduce((sum, val) => sum + val, 0);
      
      dispNames.forEach(d => {
        row[d] = normalized && total > 0 
          ? +(((a.dispositions[d] || 0) / total) * 100).toFixed(1) 
          : (a.dispositions[d] || 0);
      });
      return row;
    });

    // By campaign
    const campaignData = (breakdown.by_campaign || []).map(c => {
      const name = c.campaign_name || "Unknown";
      const row: any = { name: name.length > 15 ? name.slice(0, 15) + "…" : name };
      const total = Object.values(c.dispositions).reduce((sum, val) => sum + val, 0);
      
      dispNames.forEach(d => {
        row[d] = normalized && total > 0 
          ? +(((c.dispositions[d] || 0) / total) * 100).toFixed(1) 
          : (c.dispositions[d] || 0);
      });
      return row;
    });

    return { agentData, campaignData };
  }, [breakdown, dispositions, agents, normalized, dispNames]);

  const handleExport = () => {
    const d = view === "byAgent" ? agentData : campaignData;
    downloadCSV(`disposition-${view}`, ["Name", ...dispNames], d.map(r => [r.name, ...dispNames.map(n => String(r[n] || 0))]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[300px]" /></div>;

  const chartData = view === "byAgent" ? agentData : campaignData;

  return (
    <ReportSection title="Disposition Deep Dive" defaultOpen={false} onExport={handleExport}>
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {[{ k: "byAgent", l: "By Agent" }, { k: "byCampaign", l: "By Campaign" }].map(v => (
          <button key={v.k} onClick={() => setView(v.k as any)}
            className={`px-2.5 py-1 text-xs rounded-md ${v.k === view ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"}`}>
            {v.l}
          </button>
        ))}
        <button onClick={() => setNormalized(n => !n)}
          className={`px-2.5 py-1 text-xs rounded-md ml-2 ${normalized ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"}`}>
          {normalized ? "%" : "#"}
        </button>
      </div>

      {chartData.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No data available</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} unit={normalized ? "%" : ""} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {dispNames.map((d, i) => (
              <Bar key={d} dataKey={d} stackId="a" fill={dispColorMap.get(d) || COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

    </ReportSection>
  );
};

export default DispositionDeepDive;
