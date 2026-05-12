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
          <ResponsiveContainer width="100%" height={Math.max(250, data.length * 60)}>
            <BarChart data={data} layout="vertical" margin={{ left: 20, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-slate-200 dark:stroke-slate-800" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={140} tick={{ fill: "hsl(var(--slate-500))", fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <Tooltip 
                cursor={{ fill: 'hsl(var(--primary)/0.05)' }}
                contentStyle={{ backgroundColor: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} 
              />
              <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: 20 }} />
              <Bar dataKey="total" fill="hsl(var(--slate-200))" name="Total Leads" radius={[0, 6, 6, 0]} barSize={12} />
              <Bar dataKey="contacted" fill="hsl(var(--primary))" name="Contacted" radius={[0, 6, 6, 0]} barSize={12} />
              <Bar dataKey="converted" fill="#10b981" name="Converted" radius={[0, 6, 6, 0]} barSize={12} />
            </BarChart>
          </ResponsiveContainer>
          <div className="overflow-x-auto mt-6 rounded-2xl border border-slate-100 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 dark:bg-white/5">
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  {["Campaign", "Type", "Total", "Contacted", "Converted", "Conv. Rate"].map(h => (
                    <th key={h} className={`py-4 px-4 text-slate-500 font-bold uppercase tracking-tighter text-[11px] ${h === "Campaign" || h === "Type" ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-900">
                {data.map(d => (
                  <tr key={d.id} className="group hover:bg-slate-50/80 dark:hover:bg-white/5 cursor-pointer transition-colors" onClick={() => navigate(`/campaigns/${d.id}`)}>
                    <td className="py-4 px-4 font-bold text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors">{d.fullName}</td>
                    <td className="py-4 px-4"><Badge variant="secondary" className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold text-[10px] px-2 py-0.5 rounded-md border-none">{d.type}</Badge></td>
                    <td className="py-4 px-4 text-right font-medium text-slate-600 dark:text-slate-400">{d.total}</td>
                    <td className="py-4 px-4 text-right text-slate-600 dark:text-slate-400 font-medium">{d.contacted} <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded ml-1">{d.contactRate}%</span></td>
                    <td className="py-4 px-4 text-right text-slate-600 dark:text-slate-400 font-medium">{d.converted} <span className="text-[10px] bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded ml-1">{d.conversionRate}%</span></td>
                    <td className="py-4 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-12 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden hidden sm:block">
                          <div className="h-full bg-emerald-500" style={{ width: `${d.conversionRate}%` }} />
                        </div>
                        <span className="font-black text-slate-900 dark:text-slate-100">{d.conversionRate}%</span>
                      </div>
                    </td>
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
