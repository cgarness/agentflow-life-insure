import React, { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, getAgentName, downloadCSV } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props { calls: any[]; dispositions: any[]; agents: AgentProfile[]; campaigns: any[]; loading: boolean; }

const COLORS = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#6B7280"];

const DispositionDeepDive: React.FC<Props> = ({ calls, dispositions, agents, campaigns, loading }) => {
  const [view, setView] = useState<"byAgent" | "byCampaign">("byAgent");
  const [normalized, setNormalized] = useState(false);

  const dispNames = useMemo(() => dispositions.slice(0, 8).map(d => d.name), [dispositions]);
  const dispColorMap = useMemo(() => new Map(dispositions.map((d, i) => [d.name, d.color || COLORS[i % COLORS.length]])), [dispositions]);

  const { agentData, campaignData, topPaths } = useMemo(() => {
    // By agent
    const byAgent = new Map<string, Map<string, number>>();
    const nonAdminAgents = agents;
    nonAdminAgents.forEach(a => byAgent.set(getAgentName(agents, a.id), new Map()));
    calls.forEach(c => {
      const name = getAgentName(agents, c.agent_id);
      if (!byAgent.has(name)) byAgent.set(name, new Map());
      const dn = c.disposition_name || "Other";
      byAgent.get(name)!.set(dn, (byAgent.get(name)!.get(dn) || 0) + 1);
    });
    const agentData = Array.from(byAgent.entries()).map(([name, dm]) => {
      const row: any = { name };
      const total = Array.from(dm.values()).reduce((s, v) => s + v, 0);
      dispNames.forEach(d => {
        row[d] = normalized && total > 0 ? +((dm.get(d) || 0) / total * 100).toFixed(1) : (dm.get(d) || 0);
      });
      return row;
    });

    // By campaign
    const campaignMap = new Map(campaigns.map(c => [c.id, c.name]));
    const byCampaign = new Map<string, Map<string, number>>();
    calls.forEach(c => {
      if (!c.campaign_id) return;
      const cName = campaignMap.get(c.campaign_id) || "Unknown";
      if (!byCampaign.has(cName)) byCampaign.set(cName, new Map());
      const dn = c.disposition_name || "Other";
      byCampaign.get(cName)!.set(dn, (byCampaign.get(cName)!.get(dn) || 0) + 1);
    });
    const campaignData = Array.from(byCampaign.entries()).map(([name, dm]) => {
      const row: any = { name: name.length > 15 ? name.slice(0, 15) + "…" : name };
      const total = Array.from(dm.values()).reduce((s, v) => s + v, 0);
      dispNames.forEach(d => {
        row[d] = normalized && total > 0 ? +((dm.get(d) || 0) / total * 100).toFixed(1) : (dm.get(d) || 0);
      });
      return row;
    });

    // Top paths to sold
    const topPaths = ["No Answer → Call Back → Interested → Sold", "Interested → Appointment Set → Sold", "Call Back → Interested → Sold"];

    return { agentData, campaignData, topPaths };
  }, [calls, dispositions, agents, campaigns, normalized, dispNames]);

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

      <div className="mt-4 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Common Paths to Sale</p>
        <div className="space-y-1.5">
          {topPaths.map((p, i) => (
            <div key={i} className="text-xs text-foreground bg-accent/50 rounded px-3 py-1.5">
              {i + 1}. {p}
            </div>
          ))}
        </div>
      </div>
    </ReportSection>
  );
};

export default DispositionDeepDive;
