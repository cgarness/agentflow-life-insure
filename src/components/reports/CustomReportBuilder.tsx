import React, { useState, useEffect } from "react";
import { X, Bookmark, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchSavedReports, createSavedReport, deleteSavedReport, AgentProfile } from "@/lib/reports-queries";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onClose: () => void;
  agents: AgentProfile[];
  userId: string;
  onLoadReport: (config: any) => void;
}

const CustomReportBuilder: React.FC<Props> = ({ open, onClose, agents, userId, onLoadReport }) => {
  const { organizationId } = useOrganization();
  const [tab, setTab] = useState<"saved" | "create">("saved");
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("calls_made");
  const [groupBy, setGroupBy] = useState("agent");
  const [chartType, setChartType] = useState("bar");

  const load = async () => {
    setLoading(true);
    const data = await fetchSavedReports();
    setReports(data);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); }, [open]);

  const handleSave = async () => {
    if (!name.trim()) { toast({ title: "Enter a report name", variant: "destructive" }); return; }
    try {
      await createSavedReport(name, { metric, groupBy, chartType }, userId, organizationId);
      toast({ title: "Report saved" });
      setName("");
      load();
      setTab("saved");
    } catch { toast({ title: "Error saving report", variant: "destructive" }); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSavedReport(id);
      toast({ title: "Report deleted" });
      load();
    } catch { toast({ title: "Error deleting report", variant: "destructive" }); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 max-w-full bg-card border-l shadow-xl z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">My Reports</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="w-4 h-4" /></Button>
      </div>

      <div className="flex border-b">
        {[{ k: "saved", l: "Saved Reports" }, { k: "create", l: "Create New" }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            className={`flex-1 py-2 text-xs font-medium border-b-2 ${t.k === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
            {t.l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "saved" && (
          <div className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : reports.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No saved reports yet. Create one to get started.</p>
            ) : reports.map(r => (
              <div key={r.id} className="bg-accent/50 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(r.created_at), "MMM dd, yyyy")}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { onLoadReport(r.config); onClose(); }}>
                    <Play className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "create" && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Metric</label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["calls_made", "policies_sold", "appointments_set", "talk_time", "conversion_rate", "answer_rate", "avg_duration"].map(m => (
                    <SelectItem key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Group By</label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["agent", "campaign", "lead_source", "day", "week", "month", "hour", "day_of_week", "disposition"].map(g => (
                    <SelectItem key={g} value={g}>{g.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Chart Type</label>
              <Select value={chartType} onValueChange={setChartType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["bar", "line", "pie", "table"].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Report Name</label>
              <Input className="h-8 text-xs" value={name} onChange={e => setName(e.target.value)} placeholder="My custom report" />
            </div>
            <Button className="w-full" size="sm" onClick={handleSave}>Save Report</Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomReportBuilder;
