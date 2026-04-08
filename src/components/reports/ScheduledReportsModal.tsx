import React, { useState, useEffect } from "react";
import { X, Clock, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchScheduledReports, createScheduledReport, updateScheduledReport, deleteScheduledReport, AgentProfile } from "@/lib/reports-queries";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onClose: () => void;
  agents: AgentProfile[];
  userId: string;
}

const REPORT_SECTIONS = ["Call Volume", "Dispositions", "Policies Sold", "Campaign Performance", "Lead Sources", "Heatmap", "Agent Efficiency"];
const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const ScheduledReportsModal: React.FC<Props> = ({ open, onClose, agents, userId }) => {
  const { organizationId } = useOrganization();
  const [tab, setTab] = useState<"list" | "create">("list");
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [sendTime, setSendTime] = useState("08:00");
  const [sections, setSections] = useState<string[]>(REPORT_SECTIONS.slice(0, 4));
  const [agentFilter, setAgentFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    const data = await fetchScheduledReports();
    setReports(data);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); }, [open]);

  const handleCreate = async () => {
    if (!name.trim()) { toast({ title: "Enter a name", variant: "destructive" }); return; }
    try {
      await createScheduledReport({
        name, frequency,
        day_of_week: frequency === "weekly" ? dayOfWeek : null,
        day_of_month: frequency === "monthly" ? dayOfMonth : null,
        send_time: sendTime,
        report_sections: sections,
        agent_filter: agentFilter === "all" ? null : agentFilter,
        recipients: [],
        created_by: userId,
      }, organizationId);
      toast({ title: "Report schedule created" });
      setName("");
      load();
      setTab("list");
    } catch { toast({ title: "Error creating schedule", variant: "destructive" }); }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateScheduledReport(id, { enabled });
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteScheduledReport(id);
    toast({ title: "Schedule deleted" });
    load();
  };

  const nonAdmin = agents;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="w-4 h-4" /> Scheduled Reports</DialogTitle>
        </DialogHeader>

        <div className="flex border-b mb-3">
          {[{ k: "list", l: "Existing Schedules" }, { k: "create", l: "Create Schedule" }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k as any)}
              className={`flex-1 py-2 text-xs font-medium border-b-2 ${t.k === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
              {t.l}
            </button>
          ))}
        </div>

        {tab === "list" && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : reports.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-2">No scheduled reports yet</p>
                <Button size="sm" variant="outline" onClick={() => setTab("create")}><Plus className="w-3.5 h-3.5 mr-1" /> Create One</Button>
              </div>
            ) : reports.map(r => (
              <div key={r.id} className="bg-accent/50 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{r.frequency} · {r.send_time}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.enabled} onCheckedChange={v => handleToggle(r.id, v)} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "create" && (
          <div className="space-y-3">
            <div><label className="text-xs font-medium mb-1 block">Name</label><Input className="h-8 text-xs" value={name} onChange={e => setName(e.target.value)} placeholder="Weekly Performance Report" /></div>
            <div><label className="text-xs font-medium mb-1 block">Frequency</label>
              <Select value={frequency} onValueChange={setFrequency}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{["daily", "weekly", "monthly"].map(f => <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>)}</SelectContent></Select>
            </div>
            {frequency === "weekly" && (
              <div><label className="text-xs font-medium mb-1 block">Day</label>
                <Select value={String(dayOfWeek)} onValueChange={v => setDayOfWeek(Number(v))}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{DAYS_OF_WEEK.map((d, i) => <SelectItem key={i} value={String(i + 1)}>{d}</SelectItem>)}</SelectContent></Select>
              </div>
            )}
            {frequency === "monthly" && (
              <div><label className="text-xs font-medium mb-1 block">Day of Month</label>
                <Select value={String(dayOfMonth)} onValueChange={v => setDayOfMonth(Number(v))}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 28 }, (_, i) => <SelectItem key={i} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent></Select>
              </div>
            )}
            <div><label className="text-xs font-medium mb-1 block">Time</label><Input type="time" className="h-8 text-xs" value={sendTime} onChange={e => setSendTime(e.target.value)} /></div>
            <div><label className="text-xs font-medium mb-1 block">Agent Filter</label>
              <Select value={agentFilter} onValueChange={setAgentFilter}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All Agents" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All Agents</SelectItem>{nonAdmin.map(a => <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-2 block">Include Sections</label>
              <div className="grid grid-cols-2 gap-1.5">
                {REPORT_SECTIONS.map(s => (
                  <label key={s} className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={sections.includes(s)} onCheckedChange={v => setSections(prev => v ? [...prev, s] : prev.filter(x => x !== s))} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Email delivery will activate when SMTP is configured in Settings. Schedules are saved and ready.</p>
            <Button className="w-full" size="sm" onClick={handleCreate}>Save Schedule</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ScheduledReportsModal;
