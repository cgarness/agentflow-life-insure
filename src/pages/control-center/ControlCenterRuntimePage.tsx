import React, { useMemo, useState } from "react";
import { Terminal, Search, Copy, Check, Calendar, Hash, Globe, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import EmptyState from "@/components/control-center/EmptyState";
import StatusBadge from "@/components/control-center/StatusBadge";
import SeverityBadge from "@/components/control-center/SeverityBadge";
import {
  useControlCenterRuntimeEvents,
  useUpdateRuntimeEventStatus,
} from "@/hooks/useControlCenterRuntimeEvents";
import {
  RUNTIME_EVENT_TYPES,
  RUNTIME_EVENT_TYPE_LABELS,
  RUNTIME_EVENT_SOURCES,
  RUNTIME_EVENT_SOURCE_LABELS,
  RUNTIME_EVENT_SEVERITIES,
  RUNTIME_EVENT_SEVERITY_LABELS,
  RUNTIME_EVENT_STATUSES,
  RUNTIME_EVENT_STATUS_LABELS,
  type RuntimeEventStatus,
} from "@/lib/control-center/constants";
import type { ControlCenterRuntimeEvent } from "@/lib/control-center/types";

const ANY = "__any__";

const ControlCenterRuntimePage: React.FC = () => {
  const eventsQ = useControlCenterRuntimeEvents();
  const updateStatusMut = useUpdateRuntimeEventStatus();
  const events = eventsQ.data ?? [];

  const [selectedEvent, setSelectedEvent] = useState<ControlCenterRuntimeEvent | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ANY);
  const [severityFilter, setSeverityFilter] = useState<string>(ANY);
  const [statusFilter, setStatusFilter] = useState<string>(ANY);
  const [sourceFilter, setSourceFilter] = useState<string>(ANY);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (typeFilter !== ANY && e.event_type !== typeFilter) return false;
      if (severityFilter !== ANY && e.severity !== severityFilter) return false;
      if (statusFilter !== ANY && e.status !== statusFilter) return false;
      if (sourceFilter !== ANY && e.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        (e.message?.toLowerCase().includes(q) ?? false) ||
        (e.route?.toLowerCase().includes(q) ?? false) ||
        (e.component_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [events, typeFilter, severityFilter, statusFilter, sourceFilter, search]);

  const handleStatusChange = async (id: string, newStatus: RuntimeEventStatus) => {
    try {
      await updateStatusMut.mutateAsync({ id, status: newStatus });
      toast.success(`Event status updated to ${RUNTIME_EVENT_STATUS_LABELS[newStatus]}`);
      if (selectedEvent && selectedEvent.id === id) {
        setSelectedEvent((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update status";
      toast.error(msg);
    }
  };

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Stack trace copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 flex items-center gap-2">
            <Terminal className="h-6 w-6 text-sky-500" />
            Runtime Logs & Errors
          </h1>
          <p className="text-sm text-slate-400">
            Track frontend crashes, unhandled rejections, and runtime system telemetry.
          </p>
        </div>
      </header>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="pl-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Event Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All types</SelectItem>
            {RUNTIME_EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {RUNTIME_EVENT_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All severities</SelectItem>
            {RUNTIME_EVENT_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {RUNTIME_EVENT_SEVERITY_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {RUNTIME_EVENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {RUNTIME_EVENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All sources</SelectItem>
            {RUNTIME_EVENT_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {RUNTIME_EVENT_SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {eventsQ.isLoading ? (
        <div className="flex items-center justify-center p-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No runtime events found"
          description="Either no errors have occurred yet, or none match the active filters."
          icon={<Terminal className="h-10 w-10 text-slate-600" />}
        />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Event</TableHead>
                <TableHead className="text-slate-400">Type</TableHead>
                <TableHead className="text-slate-400">Source</TableHead>
                <TableHead className="text-slate-400">Severity</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Route</TableHead>
                <TableHead className="text-slate-400 text-center">Count</TableHead>
                <TableHead className="text-slate-400 text-right">Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow
                  key={e.id}
                  className="border-slate-800 hover:bg-slate-900/60 cursor-pointer align-top"
                  onClick={() => setSelectedEvent(e)}
                >
                  <TableCell className="max-w-xs sm:max-w-md">
                    <div className="font-semibold text-slate-100 truncate">{e.title}</div>
                    {e.message && (
                      <div className="text-xs text-slate-500 mt-1 line-clamp-1 truncate font-mono">
                        {e.message}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-300 whitespace-nowrap">
                    {RUNTIME_EVENT_TYPE_LABELS[e.event_type]}
                  </TableCell>
                  <TableCell className="text-slate-300">
                    {RUNTIME_EVENT_SOURCE_LABELS[e.source]}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={e.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
                  </TableCell>
                  <TableCell className="text-slate-400 truncate max-w-[120px] font-mono text-xs">
                    {e.route || "—"}
                  </TableCell>
                  <TableCell className="text-center font-semibold text-slate-300">
                    {e.occurrence_count}
                  </TableCell>
                  <TableCell className="text-right text-slate-400 whitespace-nowrap text-xs">
                    {new Date(e.last_seen_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    {new Date(e.last_seen_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail Drawer */}
      <Sheet open={selectedEvent !== null} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <SheetContent className="sm:max-w-2xl bg-slate-950 border-l border-slate-800 text-slate-100 overflow-y-auto w-[90vw]">
          {selectedEvent && (
            <div className="space-y-6">
              <SheetHeader className="text-left space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs uppercase tracking-widest text-slate-500">
                    {RUNTIME_EVENT_TYPE_LABELS[selectedEvent.event_type]}
                  </span>
                  <span>•</span>
                  <span className="text-xs text-slate-500 font-mono select-all">
                    ID: {selectedEvent.id}
                  </span>
                </div>
                <SheetTitle className="text-xl font-bold leading-tight text-white">
                  {selectedEvent.title}
                </SheetTitle>
                <SheetDescription className="text-slate-400 select-all font-mono text-xs max-h-24 overflow-y-auto mt-2 p-2 bg-slate-900 border border-slate-800/80 rounded-md">
                  {selectedEvent.message || "No message description."}
                </SheetDescription>
              </SheetHeader>

              {/* Status Picker & Quick Info */}
              <div className="grid grid-cols-2 gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-sm">
                <div>
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <Select
                    value={selectedEvent.status}
                    onValueChange={(val) => handleStatusChange(selectedEvent.id, val as RuntimeEventStatus)}
                  >
                    <SelectTrigger className="w-full h-9 bg-slate-950 border-slate-800">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RUNTIME_EVENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {RUNTIME_EVENT_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-1">
                    Severity & Source
                  </label>
                  <div className="flex items-center gap-2 h-9">
                    <SeverityBadge severity={selectedEvent.severity} />
                    <span className="text-slate-500">/</span>
                    <span className="text-slate-300 font-medium text-xs bg-slate-800 px-2.5 py-0.5 rounded-full ring-1 ring-inset ring-slate-700">
                      {RUNTIME_EVENT_SOURCE_LABELS[selectedEvent.source]}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-slate-300 mt-2">
                  <Hash className="h-4 w-4 text-slate-500" />
                  <span>
                    <span className="text-slate-400">Occurrences: </span>
                    <strong className="text-slate-100">{selectedEvent.occurrence_count}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-2 text-slate-300 mt-2">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <span className="text-xs">
                    <span className="text-slate-400">Last Seen: </span>
                    {new Date(selectedEvent.last_seen_at).toLocaleString()}
                  </span>
                </div>

                <div className="col-span-2 flex items-center gap-2 text-slate-300 border-t border-slate-850 pt-2 mt-1">
                  <Globe className="h-4 w-4 text-slate-500" />
                  <span className="truncate font-mono text-xs">
                    <span className="text-slate-400">Route: </span>
                    {selectedEvent.route || "—"}
                  </span>
                </div>
              </div>

              {/* Stack Trace */}
              {selectedEvent.stack && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-300">Stack Trace</h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-slate-400 hover:text-slate-100 h-8 px-2"
                      onClick={() => copyToClipboard(selectedEvent.stack!)}
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-emerald-500 mr-1.5" />
                      ) : (
                        <Copy className="h-4 w-4 mr-1.5" />
                      )}
                      Copy Stack
                    </Button>
                  </div>
                  <pre className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 overflow-x-auto max-h-80 leading-relaxed custom-scrollbar whitespace-pre select-all">
                    {selectedEvent.stack}
                  </pre>
                </div>
              )}

              {/* Metadata */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                    <Info className="h-4 w-4 text-slate-500" />
                    Additional Metadata
                  </h3>
                </div>
                <pre className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-sky-400/90 overflow-x-auto max-h-60 leading-relaxed custom-scrollbar select-all">
                  {JSON.stringify(selectedEvent.metadata, null, 2)}
                </pre>
              </div>

              {/* Quick Action Drawer Footer */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                {selectedEvent.status !== "resolved" && (
                  <Button
                    variant="outline"
                    className="bg-emerald-950/20 hover:bg-emerald-900/30 text-emerald-400 border-emerald-900/40 hover:border-emerald-800/60"
                    onClick={() => handleStatusChange(selectedEvent.id, "resolved")}
                  >
                    Mark Resolved
                  </Button>
                )}
                {selectedEvent.status !== "ignored" && (
                  <Button
                    variant="outline"
                    className="bg-zinc-950/40 hover:bg-zinc-900/50 text-zinc-400 border-zinc-800"
                    onClick={() => handleStatusChange(selectedEvent.id, "ignored")}
                  >
                    Ignore Event
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="bg-slate-900 border-slate-800 hover:bg-slate-800"
                  onClick={() => setSelectedEvent(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ControlCenterRuntimePage;
