import React, { useMemo, useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentProfile, formatDuration, formatHours, downloadCSV, ReportCallSummary } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props { summary?: ReportCallSummary; sessions: any[]; agents: AgentProfile[]; currentUserId?: string; isAdmin: boolean; loading: boolean; }

type SortKey = "name" | "totalCalls" | "connected" | "answerRate" | "avgDuration" | "convRate" | "talkTime" | "callsPerHour";

const AgentEfficiency: React.FC<Props> = ({ summary, sessions, agents, currentUserId, isAdmin, loading }) => {
  const [sortKey, setSortKey] = useState<SortKey>("convRate");
  const [sortAsc, setSortAsc] = useState(false);

  const data = useMemo(() => {
    if (!summary) return [];
    const nonAdmin = agents;
    return nonAdmin.map(agent => {
      const agentData = summary.calls_by_agent.find(a => a.agent_id === agent.id) || {
        total: 0, contacted: 0, converted: 0, total_duration: 0, avg_duration: 0
      };

      const as_ = sessions.filter(s => s.agent_id === agent.id);
      const totalSessionTime = as_.reduce((s, sess) => {
        if (sess.started_at && sess.ended_at) {
          return s + (new Date(sess.ended_at).getTime() - new Date(sess.started_at).getTime()) / 1000;
        }
        return s;
      }, 0);
      const callsPerHour = totalSessionTime > 0 ? +(agentData.total / (totalSessionTime / 3600)).toFixed(1) : 0;

      return {
        id: agent.id,
        name: `${agent.first_name} ${agent.last_name?.charAt(0) || ""}.`,
        initials: `${agent.first_name?.charAt(0) || ""}${agent.last_name?.charAt(0) || ""}`,
        totalCalls: agentData.total,
        connected: agentData.contacted,
        answerRate: agentData.total > 0 ? Math.round(agentData.contacted / agentData.total * 100) : 0,
        avgDuration: Math.round(agentData.avg_duration),
        convRate: agentData.total > 0 ? +(agentData.converted / agentData.total * 100).toFixed(1) : 0,
        talkTime: agentData.total_duration,
        callsPerHour,
        sold: agentData.converted,
      };
    });
  }, [summary, sessions, agents]);

  const sorted = useMemo(() => {
    const s = [...data];
    s.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });
    return s;
  }, [data, sortKey, sortAsc]);

  const bestValues = useMemo(() => {
    if (data.length === 0) return {} as any;
    return {
      totalCalls: Math.max(...data.map(d => d.totalCalls)),
      connected: Math.max(...data.map(d => d.connected)),
      answerRate: Math.max(...data.map(d => d.answerRate)),
      avgDuration: Math.max(...data.map(d => d.avgDuration)),
      convRate: Math.max(...data.map(d => d.convRate)),
      talkTime: Math.max(...data.map(d => d.talkTime)),
      callsPerHour: Math.max(...data.map(d => d.callsPerHour)),
    };
  }, [data]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const handleExport = () => {
    downloadCSV("agent-efficiency", ["Agent", "Calls", "Connected", "Answer%", "Avg Dur", "Conv%", "Talk Time", "Calls/Hr"],
      sorted.map(d => [d.name, String(d.totalCalls), String(d.connected), `${d.answerRate}%`, formatDuration(d.avgDuration), `${d.convRate}%`, formatHours(d.talkTime), String(d.callsPerHour)]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[350px]" /></div>;

  const SH = ({ l, k }: { l: string; k: SortKey }) => (
    <th className="py-2 px-2 text-right text-muted-foreground font-medium cursor-pointer hover:text-foreground text-xs whitespace-nowrap" onClick={() => toggleSort(k)}>
      {l} {sortKey === k && (sortAsc ? "↑" : "↓")}
    </th>
  );

  const scatterData = data.map(d => ({ x: d.totalCalls, y: d.convRate, z: d.talkTime, name: d.initials, fullName: d.name }));

  return (
    <ReportSection title="Agent Efficiency Report" defaultOpen={false} onExport={handleExport}>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No agent data available</p>
      ) : (
        <>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-xs">
              <thead><tr className="border-b">
                <th className="py-2 px-2 text-left text-muted-foreground font-medium cursor-pointer" onClick={() => toggleSort("name")}>Agent</th>
                <SH l="Calls" k="totalCalls" /><SH l="Connected" k="connected" /><SH l="Answer%" k="answerRate" />
                <SH l="Avg Dur" k="avgDuration" /><SH l="Calls/Hr" k="callsPerHour" />
                <SH l="Conv%" k="convRate" /><SH l="Talk Time" k="talkTime" />
              </tr></thead>
              <tbody>
                {sorted.map(d => (
                  <tr key={d.id} className={`border-b last:border-0 ${d.id === currentUserId ? "bg-primary/5" : ""}`}>
                    <td className="py-2 px-2 font-medium text-foreground">{d.name}</td>
                    {[
                      { v: d.totalCalls, f: String(d.totalCalls), bk: "totalCalls" },
                      { v: d.connected, f: String(d.connected), bk: "connected" },
                      { v: d.answerRate, f: `${d.answerRate}%`, bk: "answerRate" },
                      { v: d.avgDuration, f: formatDuration(d.avgDuration), bk: "avgDuration" },
                      { v: d.callsPerHour, f: String(d.callsPerHour), bk: "callsPerHour" },
                      { v: d.convRate, f: `${d.convRate}%`, bk: "convRate" },
                      { v: d.talkTime, f: formatHours(d.talkTime), bk: "talkTime" },
                    ].map((cell, ci) => (
                      <td key={ci} className={`py-2 px-2 text-right text-foreground ${cell.v === bestValues[cell.bk] && cell.v > 0 ? "font-bold text-warning" : ""}`}>{cell.f}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <>
              <h4 className="text-xs font-semibold text-foreground mb-2">Efficiency Scatter Plot</h4>
              <div className="relative">
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 10, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis type="number" dataKey="x" name="Calls Made" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} label={{ value: "Calls Made", position: "bottom", offset: -5, style: { fill: "hsl(var(--muted-foreground))", fontSize: 10 } }} />
                    <YAxis type="number" dataKey="y" name="Conv Rate" unit="%" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} label={{ value: "Conv%", angle: -90, position: "insideLeft", style: { fill: "hsl(var(--muted-foreground))", fontSize: 10 } }} />
                    <ZAxis type="number" dataKey="z" range={[40, 400]} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }}
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                      formatter={(v: any, name: string) => [name === "Conv Rate" ? `${v}%` : v, name]}
                      labelFormatter={() => ""}
                    />
                    <Scatter data={scatterData} fill="hsl(var(--primary))" />
                  </ScatterChart>
                </ResponsiveContainer>
                {/* Quadrant labels */}
                <div className="absolute top-2 right-4 text-[9px] text-success font-medium">⭐ Stars</div>
                <div className="absolute top-2 left-12 text-[9px] text-primary font-medium">Quality</div>
                <div className="absolute bottom-12 right-4 text-[9px] text-warning font-medium">Needs Coaching</div>
                <div className="absolute bottom-12 left-12 text-[9px] text-destructive font-medium">At Risk</div>
              </div>
            </>
          )}
        </>
      )}
    </ReportSection>
  );
};

export default AgentEfficiency;
