import React, { useMemo, useState } from "react";
import { Download, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCSV } from "@/lib/reports-queries";

interface Props {
  leads: any[];
  loading: boolean;
}

type SortKey = "source" | "total" | "contacted" | "converted" | "rate";

const LeadSourceTable: React.FC<Props> = ({ leads, loading }) => {
  const [sortKey, setSortKey] = useState<SortKey>("rate");
  const [sortAsc, setSortAsc] = useState(false);

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
    return Array.from(bySource.entries()).map(([source, v]) => ({
      source,
      ...v,
      rate: v.total > 0 ? +(v.converted / v.total * 100).toFixed(1) : 0,
    }));
  }, [leads]);

  const sorted = useMemo(() => {
    const s = [...data];
    s.sort((a, b) => {
      const av = sortKey === "source" ? a.source : a[sortKey];
      const bv = sortKey === "source" ? b.source : b[sortKey];
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    return s;
  }, [data, sortKey, sortAsc]);

  const topRate = sorted.length > 0 ? Math.max(...sorted.map(d => d.rate)) : 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const handleExport = () => {
    downloadCSV("lead-source-performance", ["Source", "Total", "Contacted", "Converted", "Conv Rate"],
      sorted.map(d => [d.source, String(d.total), String(d.contacted), String(d.converted), `${d.rate}%`]));
  };

  if (loading) return <div className="bg-card rounded-xl border p-5"><Skeleton className="h-6 w-48 mb-4" /><Skeleton className="h-[250px]" /></div>;

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="text-right py-2 px-2 text-muted-foreground font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort(k)}>
      {label} {sortKey === k && (sortAsc ? "↑" : "↓")}
    </th>
  );

  return (
    <div className="bg-card rounded-xl border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Lead Source Performance</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}><Download className="w-3.5 h-3.5" /></Button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No lead data for this period</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium cursor-pointer" onClick={() => toggleSort("source")}>Lead Source</th>
                <SortHeader label="Total" k="total" />
                <SortHeader label="Contacted" k="contacted" />
                <SortHeader label="Converted" k="converted" />
                <th className="text-right py-2 px-2 text-muted-foreground font-medium min-w-[140px] cursor-pointer" onClick={() => toggleSort("rate")}>Conv. Rate</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Avg Days</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={d.source} className={`border-b last:border-0 ${d.rate === topRate && d.rate > 0 ? "bg-warning/5" : ""}`}>
                  <td className="py-2 px-2 font-medium text-foreground flex items-center gap-1.5">
                    {d.rate === topRate && d.rate > 0 && <Trophy className="w-3.5 h-3.5 text-warning" />}
                    {d.source}
                  </td>
                  <td className="py-2 px-2 text-right text-foreground">{d.total}</td>
                  <td className="py-2 px-2 text-right text-foreground">{d.contacted}</td>
                  <td className="py-2 px-2 text-right text-foreground">{d.converted}</td>
                  <td className="py-2 px-2 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-20 h-2 rounded-full bg-accent overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(d.rate, 100)}%` }} />
                      </div>
                      <span className="font-medium text-foreground w-10 text-right">{d.rate}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right text-muted-foreground">N/A</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default LeadSourceTable;
