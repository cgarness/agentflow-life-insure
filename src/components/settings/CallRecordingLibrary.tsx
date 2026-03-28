import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DateInput } from "@/components/shared/DateInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayCircle, Download, Flag, X } from "lucide-react";
import { toast } from "sonner";

interface CallRow {
  id: string;
  created_at: string;
  duration: number | null;
  disposition_name: string | null;
  recording_url: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  agent_id: string | null;
  flagged_for_coaching: boolean;
}

interface AgentOption {
  id: string;
  full_name: string;
}

interface DispOption {
  id: string;
  name: string;
  color: string;
}

const PAGE_SIZE = 25;

const formatDuration = (sec: number | null) => {
  if (!sec) return "No answer";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
};

const CallRecordingLibrary: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [dispositions, setDispositions] = useState<DispOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  // Filters
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [dispFilter, setDispFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchOptions = useCallback(async () => {
    const [aRes, dRes] = await Promise.all([
      supabase.from("profiles").select("id, first_name, last_name"),
      supabase.from("dispositions").select("id, name, color").order("sort_order"),
    ]);
    setAgents(
      (aRes.data || []).map((a: any) => ({ id: a.id, full_name: `${a.first_name} ${a.last_name}`.trim() }))
    );
    setDispositions((dRes.data || []) as DispOption[]);
  }, []);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("calls")
      .select("id, created_at, duration, disposition_name, recording_url, contact_name, contact_phone, agent_id, flagged_for_coaching", { count: "exact" })
      .not("recording_url", "is", null)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (search.trim()) {
      query = query.ilike("contact_name", `%${search.trim()}%`);
    }
    if (agentFilter !== "all") {
      query = query.eq("agent_id", agentFilter);
    }
    if (dispFilter !== "all") {
      const d = dispositions.find((x) => x.id === dispFilter);
      if (d) query = query.eq("disposition_name", d.name);
    }
    if (dateFrom) {
      query = query.gte("created_at", new Date(dateFrom).toISOString());
    }
    if (dateTo) {
      query = query.lte("created_at", new Date(dateTo + "T23:59:59").toISOString());
    }

    const { data, count, error } = await query;
    if (error) {
      toast.error("Failed to load data. Please try again.");
      setLoading(false);
      return;
    }
    setCalls((data || []) as any);
    setTotal(count || 0);
    setLoading(false);
  }, [page, search, agentFilter, dispFilter, dateFrom, dateTo, dispositions]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  useEffect(() => {
    if (dispositions.length > 0 || agentFilter === "all") {
      fetchCalls();
    }
  }, [fetchCalls, dispositions]);

  const clearFilters = () => {
    setSearch("");
    setAgentFilter("all");
    setDispFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  const toggleCoaching = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from("calls")
      .update({ flagged_for_coaching: !current } as any)
      .eq("id", id);
    if (error) {
      toast.error("Failed to update flag.");
      return;
    }
    setCalls((prev) => prev.map((c) => (c.id === id ? { ...c, flagged_for_coaching: !current } : c)));
  };

  const getDispColor = (name: string | null) => {
    if (!name) return undefined;
    return dispositions.find((d) => d.name === name)?.color;
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return "—";
    return agents.find((a) => a.id === agentId)?.full_name || "—";
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Recording Library</h3>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <Input
          placeholder="Search by contact name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="w-56"
        />
        <Select value={agentFilter} onValueChange={(v) => { setAgentFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <DateInput value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(0); }} className="w-40" />
          <span className="text-muted-foreground text-sm">to</span>
          <DateInput value={dateTo} onChange={(v) => { setDateTo(v); setPage(0); }} className="w-40" />
        </div>
        <Select value={dispFilter} onValueChange={(v) => { setDispFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Dispositions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Dispositions</SelectItem>
            {dispositions.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="w-4 h-4 mr-1" /> Clear
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="bg-accent/50 rounded-xl p-12 text-center">
          <PlayCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h4 className="font-semibold text-foreground mb-1">No recordings found</h4>
          <p className="text-sm text-muted-foreground">Recordings appear here after calls complete with recording enabled.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agent</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date & Time</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Disposition</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Recording</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const color = getDispColor(c.disposition_name);
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{c.contact_name || "Unknown"}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{c.contact_phone || "—"}</td>
                      <td className="px-4 py-3 text-foreground">{getAgentName(c.agent_id)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(c.created_at).toLocaleDateString()}{" "}
                        {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{formatDuration(c.duration)}</td>
                      <td className="px-4 py-3">
                        {c.disposition_name ? (
                          <Badge
                            variant="secondary"
                            style={color ? { backgroundColor: `${color}20`, color, borderColor: `${color}40` } : undefined}
                          >
                            {c.disposition_name}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-muted-foreground">None</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.recording_url ? (
                          <audio controls className="h-8 w-48">
                            <source src={c.recording_url} type="audio/mpeg" />
                          </audio>
                        ) : (
                          <span className="text-muted-foreground text-xs">No recording</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleCoaching(c.id, c.flagged_for_coaching)}
                            className={`p-1.5 rounded-lg hover:bg-accent ${c.flagged_for_coaching ? "text-warning" : "text-muted-foreground"}`}
                            title={c.flagged_for_coaching ? "Unflag for coaching" : "Flag for coaching"}
                          >
                            <Flag className="w-4 h-4" fill={c.flagged_for_coaching ? "currentColor" : "none"} />
                          </button>
                          {c.recording_url && (
                            <button
                              onClick={() => window.open(c.recording_url!, "_blank")}
                              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{total} recordings total</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="text-sm text-muted-foreground flex items-center px-2">Page {page + 1} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CallRecordingLibrary;
