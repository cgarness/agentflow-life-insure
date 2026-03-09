import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { downloadCSV } from "@/lib/reports-queries";
import ReportSection from "./ReportSection";

interface Props {
  campaigns: any[];
  loading: boolean;
}

const CampaignPerformance: React.FC<Props> = ({ campaigns, loading }) => {
  const navigate = useNavigate();
  const data = campaigns.map(c => ({
    name: c.name.length > 18 ? c.name.slice(0, 18) + "…" : c.name,
    fullName: c.name, id: c.id, type: c.type,
    total: c.total_leads || 0, contacted: c.leads_contacted || 0, converted: c.leads_converted || 0,
    contactRate: c.total_leads > 0 ? Math.round((c.leads_contacted || 0) / c.total_leads * 100) : 0,
    conversionRate: c.total_leads > 0 ? Math.round((c.leads_converted || 0) / c.total_leads * 100) : 0,
  }));

  const handleExport = () => {
    downloadCSV("campaign-performance", ["Campaign", "Type", "Total", "Contacted", "Contact%", "Converted", "Conv%"],
      data.map(d => [d.fullName, d.type, String(d.total), String(d.contacted), `${d.contactRate}%`, String(d.converted), `${d.conversionRate}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[300px]" /></div>;

  return (
    <ReportSection title="Campaign Performance" onExport={handleExport}>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No campaigns with leads found</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(200, data.length * 50)}>
            <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
              <Legend />
              <Bar dataKey="total" fill="hsl(var(--muted-foreground))" name="Total Leads" radius={[0, 4, 4, 0]} />
              <Bar dataKey="contacted" fill="hsl(var(--primary))" name="Contacted" radius={[0, 4, 4, 0]} />
              <Bar dataKey="converted" fill="hsl(var(--success))" name="Converted" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead><tr className="border-b">
                {["Campaign", "Type", "Total", "Contacted", "Converted", "Conv. Rate"].map(h => (
                  <th key={h} className={`py-2 px-2 text-muted-foreground font-medium ${h === "Campaign" || h === "Type" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.map(d => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-accent/50 cursor-pointer" onClick={() => navigate(`/campaigns/${d.id}`)}>
                    <td className="py-2 px-2 font-medium text-foreground">{d.fullName}</td>
                    <td className="py-2 px-2"><Badge variant="secondary" className="text-xs">{d.type}</Badge></td>
                    <td className="py-2 px-2 text-right text-foreground">{d.total}</td>
                    <td className="py-2 px-2 text-right text-foreground">{d.contacted} <span className="text-muted-foreground text-xs">({d.contactRate}%)</span></td>
                    <td className="py-2 px-2 text-right text-foreground">{d.converted} <span className="text-muted-foreground text-xs">({d.conversionRate}%)</span></td>
                    <td className="py-2 px-2 text-right font-medium text-foreground">{d.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportSection>
  );
};

export default CampaignPerformance;
