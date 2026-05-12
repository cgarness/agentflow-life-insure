import React, { useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV, upsertLeadSourceCost } from "@/lib/reports-queries";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

interface Props {
  leads: any[];
  costs: any[];
  loading: boolean;
  isAdmin: boolean;
  onCostsChanged: () => void;
}

type SortKey = "source" | "total" | "contacted" | "converted" | "rate";

const LeadSourceTable: React.FC<Props> = ({ leads, costs, loading, isAdmin, onCostsChanged }) => {
  const [sortKey, setSortKey] = useState<SortKey>("rate");
  const [sortAsc, setSortAsc] = useState(false);
  const [editingCosts, setEditingCosts] = useState(false);
  const [costInputs, setCostInputs] = useState<Record<string, string>>({});

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    costs.forEach(c => m.set(c.lead_source, c.cost || 0));
    return m;
  }, [costs]);

  const data = useMemo(() => {
    const bySource = new Map<string, { total: number; contacted: number; converted: number }>();
    leads.forEach(l => {
      const src = l.lead_source || "Unknown";
      const cur = bySource.get(src) || { total: 0, contacted: 0, converted: 0 };
      cur.total++;
      if (l.last_contacted_at) cur.contacted++;
      const s = (l.status || "").toLowerCase();
      if (s.includes("won") || s.includes("sold") || s.includes("client")) cur.converted++;
      bySource.set(src, cur);
    });
    return Array.from(bySource.entries()).map(([source, v]) => {
      const cost = costMap.get(source) || 0;
      return {
        source, ...v,
        rate: v.total > 0 ? +(v.converted / v.total * 100).toFixed(1) : 0,
        cost, cpl: v.total > 0 ? +(cost / v.total).toFixed(2) : 0,
        cpc: v.converted > 0 ? +(cost / v.converted).toFixed(2) : 0,
      };
    });
  }, [leads, costMap]);

  const sorted = useMemo(() => {
    const s = [...data];
    s.sort((a, b) => {
      const av = sortKey === "source" ? a.source : a[sortKey];
      const bv = sortKey === "source" ? b.source : b[sortKey];
      return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });
    return s;
  }, [data, sortKey, sortAsc]);

  const topRate = sorted.length > 0 ? Math.max(...sorted.map(d => d.rate)) : 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const handleSaveCosts = async () => {
    try {
      for (const [source, val] of Object.entries(costInputs)) {
        const num = parseFloat(val);
        if (!isNaN(num)) await upsertLeadSourceCost(source, num);
      }
      toast({ title: "Costs saved" });
      setEditingCosts(false);
      onCostsChanged();
    } catch { toast({ title: "Error saving costs", variant: "destructive" }); }
  };

  const handleExport = () => {
    downloadCSV("lead-source-performance", ["Source", "Total", "Contacted", "Converted", "Conv%", "Cost", "CPL", "CPC"],
      sorted.map(d => [d.source, String(d.total), String(d.contacted), String(d.converted), `${d.rate}%`, `$${d.cost}`, `$${d.cpl}`, `$${d.cpc}`]));
  };

  const roiLabel = (cpc: number) => {
    if (cpc === 0) return null;
    if (cpc < 50) return <span className="text-xs px-1.5 py-0.5 rounded bg-success/10 text-success">High ROI</span>;
    if (cpc < 150) return <span className="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning">Medium</span>;
    return <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">Low ROI</span>;
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-[250px]" /></div>;

  return (
    <ReportSection title="Lead Source Performance & ROI" onExport={handleExport}>
      {isAdmin && (
        <div className="flex justify-end mb-2">
          {editingCosts ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditingCosts(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveCosts}>Save Costs</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { setEditingCosts(true); setCostInputs(Object.fromEntries(sorted.map(d => [d.source, String(d.cost)]))); }}>Edit Costs</Button>
          )}
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No lead data for this period</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 dark:bg-white/5">
              <tr className="border-b border-slate-100 dark:border-slate-800">
                {[{ l: "Source", k: "source" as SortKey }, { l: "Total", k: "total" as SortKey }, { l: "Contacted", k: "contacted" as SortKey }, { l: "Converted", k: "converted" as SortKey }, { l: "Conv Rate", k: "rate" as SortKey }].map(h => (
                  <th key={h.l} className={`py-4 px-4 text-slate-500 font-bold uppercase tracking-tighter text-[11px] cursor-pointer hover:text-primary transition-colors ${h.l === "Source" ? "text-left" : "text-right"}`} onClick={() => toggleSort(h.k)}>
                    <div className={cn("flex items-center gap-1", h.l === "Source" ? "justify-start" : "justify-end")}>
                      {h.l} {sortKey === h.k && (sortAsc ? "↑" : "↓")}
                    </div>
                  </th>
                ))}
                <th className="py-4 px-4 text-right text-slate-500 font-bold uppercase tracking-tighter text-[11px]">Cost</th>
                <th className="py-4 px-4 text-right text-slate-500 font-bold uppercase tracking-tighter text-[11px]">CPL</th>
                <th className="py-4 px-4 text-right text-slate-500 font-bold uppercase tracking-tighter text-[11px]">CPC</th>
                <th className="py-4 px-4 text-right text-slate-500 font-bold uppercase tracking-tighter text-[11px]">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-900">
              {sorted.map(d => (
                <tr key={d.source} className={cn("group hover:bg-slate-50/80 dark:hover:bg-white/5 transition-colors", d.rate === topRate && d.rate > 0 ? "bg-amber-50/30 dark:bg-amber-500/5" : "")}>
                  <td className="py-4 px-4 font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    {d.rate === topRate && d.rate > 0 && (
                      <div className="p-1 bg-amber-100 dark:bg-amber-500/20 rounded-lg">
                        <Trophy className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      </div>
                    )}
                    {d.source}
                  </td>
                  <td className="py-4 px-4 text-right text-slate-600 dark:text-slate-400 font-medium">{d.total}</td>
                  <td className="py-4 px-4 text-right text-slate-600 dark:text-slate-400 font-medium">{d.contacted}</td>
                  <td className="py-4 px-4 text-right text-slate-600 dark:text-slate-400 font-medium">{d.converted}</td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden hidden sm:block">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(d.rate, 100)}%` }} />
                      </div>
                      <span className="font-black text-slate-900 dark:text-slate-100 w-10 text-right">{d.rate}%</span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right">
                    {editingCosts ? (
                      <Input className="h-8 w-24 text-xs ml-auto rounded-lg border-slate-200" type="number" value={costInputs[d.source] ?? ""} onChange={e => setCostInputs(p => ({ ...p, [d.source]: e.target.value }))} />
                    ) : (
                      <span className="font-bold text-slate-900 dark:text-slate-100">{d.cost > 0 ? `$${d.cost.toLocaleString()}` : <span className="text-slate-300 dark:text-slate-700 font-medium text-[10px] uppercase tracking-widest">—</span>}</span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-right text-slate-500 dark:text-slate-500 font-medium">{d.cost > 0 ? `$${d.cpl}` : "—"}</td>
                  <td className="py-4 px-4 text-right text-slate-500 dark:text-slate-500 font-medium">{d.cost > 0 ? `$${d.cpc}` : "—"}</td>
                  <td className="py-4 px-4 text-right">{roiLabel(d.cpc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  );
};

export default LeadSourceTable;
