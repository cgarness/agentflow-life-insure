import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Filter, LayoutGrid, List, Upload, Plus, MoreHorizontal,
  Phone, Eye, Pencil, Trash2, X, ShieldCheck, Calendar, Mail, Users,
  Loader2, ChevronDown, GripVertical, AlertTriangle, Columns3, Lock,
  ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { leadsApi, clientsApi, recruitsApi, notesApi } from "@/lib/mock-api";
import { Lead, Client, Recruit, LeadStatus, ContactNote, ContactActivity } from "@/lib/types";
import { mockUsers, mockProfiles, mockCalls, mockNotes, mockActivities, calcAging, getAgentName, getAgentInitials } from "@/lib/mock-data";
import ContactModal from "@/components/contacts/ContactModal";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const statusColors: Record<string, string> = {
  "New": "bg-muted text-muted-foreground",
  "Contacted": "bg-primary/10 text-primary",
  "Interested": "bg-warning/10 text-warning",
  "Follow Up": "bg-info/10 text-info",
  "Hot": "bg-warning/20 text-warning",
  "Not Interested": "bg-destructive/10 text-destructive",
  "Closed Won": "bg-success/10 text-success",
  "Closed Lost": "bg-destructive/20 text-destructive",
};

const policyTypeColors: Record<string, string> = {
  "Term": "bg-primary/10 text-primary",
  "Whole Life": "bg-success/10 text-success",
  "IUL": "bg-info/10 text-info",
};

const allStatuses: LeadStatus[] = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];

// Aging pill helper
function agingPill(days: number) {
  if (days >= 15) return { cls: "bg-red-500/10 text-red-500", label: `🔥 ${days}d` };
  if (days >= 8) return { cls: "bg-orange-500/10 text-orange-500", label: `${days}d` };
  if (days >= 4) return { cls: "bg-yellow-500/10 text-yellow-500", label: `${days}d` };
  return { cls: "bg-green-500/10 text-green-500", label: `${days}d` };
}

// Column definitions
type ColumnKey = "name" | "phone" | "email" | "state" | "status" | "source" | "score" | "aging" | "agent" | "dob" | "health" | "bestTime" | "leadSourceAlias" | "createdDate" | "lastContacted";

interface ColDef { key: ColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }

const ALL_COLUMNS: ColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "state", label: "State", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
  { key: "source", label: "Source", defaultVisible: true },
  { key: "score", label: "Score", defaultVisible: true },
  { key: "aging", label: "Aging", defaultVisible: true },
  { key: "agent", label: "Agent", defaultVisible: true },
  { key: "dob", label: "Date of Birth", defaultVisible: false },
  { key: "health", label: "Health Status", defaultVisible: false },
  { key: "bestTime", label: "Best Time to Call", defaultVisible: false },
  { key: "leadSourceAlias", label: "Lead Source", defaultVisible: false },
  { key: "createdDate", label: "Created Date", defaultVisible: false },
  { key: "lastContacted", label: "Last Contacted", defaultVisible: false },
];

const DEFAULT_VISIBLE = new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

const mockAgents = [
  { id: "u1", name: "Chris G." },
  { id: "u2", name: "Sarah J." },
  { id: "u3", name: "Mike T." },
  { id: "u4", name: "Lisa R." },
  { id: "u5", name: "James W." },
];

// ---- Add/Edit Contact Modal ----
const AddContactModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
  initial?: Lead | null;
  contactType?: string;
}> = ({ open, onClose, onSave, initial, contactType = "Lead" }) => {
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", state: "", leadSource: "Facebook Ads", status: "New" as LeadStatus });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) setForm({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email, state: initial.state, leadSource: initial.leadSource, status: initial.status });
    else setForm({ firstName: "", lastName: "", phone: "", email: "", state: "", leadSource: "Facebook Ads", status: "New" });
  }, [initial, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{initial ? "Edit" : "Add New"} {contactType}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">First Name *</label>
              <input required value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Last Name *</label>
              <input required value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Phone *</label>
            <input required value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="(555) 123-4567" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Email *</label>
            <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">State</label>
              <input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="FL" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Lead Source</label>
              <select value={form.leadSource} onChange={e => setForm(f => ({ ...f, leadSource: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                {["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent sidebar-transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {initial ? "Save Changes" : "Add Contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};



// ---- Delete Confirm ----
const DeleteConfirmModal: React.FC<{ open: boolean; count: number; onConfirm: () => void; onClose: () => void; title?: string }> = ({ open, count, onConfirm, onClose, title }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
          <div>
            <h3 className="font-semibold text-foreground">{title || `Delete ${count} contact${count > 1 ? "s" : ""}?`}</h3>
            <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-accent sidebar-transition">Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 h-9 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 sidebar-transition">Delete</button>
        </div>
      </div>
    </div>
  );
};

// ---- Main Contacts Page ----
const Contacts: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<"Leads" | "Clients" | "Recruits" | "Agents">("Leads");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sourceStats, setSourceStats] = useState<any[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);

  // Column visibility
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(new Set(DEFAULT_VISIBLE));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  // Bulk action dropdowns
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Sorting
  const [sortCol, setSortCol] = useState<ColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: ColumnKey) => {
    if (sortCol === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  };

  const getSortValue = (l: Lead, key: ColumnKey): string | number => {
    switch (key) {
      case "name": return `${l.firstName} ${l.lastName}`.toLowerCase();
      case "phone": return l.phone;
      case "email": return l.email.toLowerCase();
      case "state": return l.state;
      case "status": return allStatuses.indexOf(l.status);
      case "source": case "leadSourceAlias": return l.leadSource.toLowerCase();
      case "score": return l.leadScore;
      case "aging": return calcAging(l.lastContactedAt);
      case "agent": return getAgentName(l.assignedAgentId).toLowerCase();
      case "dob": return l.dateOfBirth || "";
      case "health": return l.healthStatus || "";
      case "bestTime": return l.bestTimeToCall || "";
      case "createdDate": return l.createdAt;
      case "lastContacted": return l.lastContactedAt || "";
      default: return "";
    }
  };

  const sortedLeads = React.useMemo(() => {
    if (!sortCol) return leads;
    return [...leads].sort((a, b) => {
      const va = getSortValue(a, sortCol);
      const vb = getSortValue(b, sortCol);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [leads, sortCol, sortDir]);

  // Close columns dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false);
    };
    if (columnsOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [columnsOpen]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadData, clientData, recruitData, stats] = await Promise.all([
        leadsApi.getAll({ search: searchQuery, status: statusFilter, source: sourceFilter }),
        clientsApi.getAll(searchQuery),
        recruitsApi.getAll(),
        leadsApi.getSourceStats(),
      ]);
      setLeads(leadData);
      setClients(clientData);
      setRecruits(recruitData);
      setSourceStats(stats);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, sourceFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddLead = async (data: any) => {
    await leadsApi.create({ ...data, leadScore: 5, assignedAgentId: user?.id || "u1" });
    toast.success("Lead added successfully");
    fetchData();
  };

  const handleUpdateLead = async (id: string, data: Partial<Lead>) => {
    await leadsApi.update(id, data);
    fetchData();
  };

  const handleDeleteLead = async (id: string) => {
    await leadsApi.delete(id);
    toast.success("Lead deleted");
    setSelectedLead(null);
    fetchData();
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    for (const id of selectedIds) await leadsApi.delete(id);
    toast.error(`Deleted ${count} leads.`, { duration: 3000, position: "bottom-right" });
    setSelectedIds(new Set());
    fetchData();
  };

  const handleBulkStatusChange = async (status: LeadStatus) => {
    const count = selectedIds.size;
    for (const id of selectedIds) await leadsApi.update(id, { status });
    toast.success(`Updated status for ${count} leads.`, { duration: 3000, position: "bottom-right" });
    setSelectedIds(new Set());
    setBulkStatusOpen(false);
    fetchData();
  };

  const handleBulkAssign = async (agentName: string) => {
    const count = selectedIds.size;
    // Mock assign — just show toast
    toast.success(`Assigned ${count} leads to ${agentName}.`, { duration: 3000, position: "bottom-right" });
    setSelectedIds(new Set());
    setBulkAssignOpen(false);
  };

  const toggleSelect = (id: string) => setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => setSelectedIds(prev => prev.size === leads.length ? new Set() : new Set(leads.map(l => l.id)));

  const isAllSelected = selectedIds.size === leads.length && leads.length > 0;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < leads.length;

  const tabs = ["Leads", "Clients", "Recruits", "Agents"] as const;

  const isColVisible = (key: ColumnKey) => visibleCols.has(key);

  // Render cell value for a lead
  const renderCell = (l: Lead, key: ColumnKey, aging: number) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground">{l.firstName} {l.lastName}</span>;
      case "phone": return <span className="text-foreground font-mono text-xs">{l.phone}</span>;
      case "email": return <span className="text-muted-foreground">{l.email}</span>;
      case "state": return <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{l.state}</span>;
      case "status": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[l.status]}`}>{l.status}</span>;
      case "source": return <span className="text-muted-foreground">{l.leadSource}</span>;
      case "score": {
        const sc = l.leadScore;
        return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sc >= 8 ? "bg-success/10 text-success" : sc >= 5 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}`}>{sc}</span>;
      }
      case "aging": {
        const pill = agingPill(aging);
        return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pill.cls}`}>{pill.label}</span>;
      }
      case "agent": return <span className="text-foreground">{getAgentName(l.assignedAgentId)}</span>;
      case "dob": return <span className="text-muted-foreground text-xs">{l.dateOfBirth || "—"}</span>;
      case "health": return <span className="text-muted-foreground text-xs">{l.healthStatus || "—"}</span>;
      case "bestTime": return <span className="text-muted-foreground text-xs">{l.bestTimeToCall || "—"}</span>;
      case "leadSourceAlias": return <span className="text-muted-foreground">{l.leadSource}</span>;
      case "createdDate": return <span className="text-muted-foreground text-xs">{new Date(l.createdAt).toLocaleDateString()}</span>;
      case "lastContacted": return <span className="text-muted-foreground text-xs">{l.lastContactedAt ? new Date(l.lastContactedAt).toLocaleDateString() : "Never"}</span>;
      default: return null;
    }
  };

  const colAlign = (key: ColumnKey) => (key === "score" || key === "aging") ? "text-center" : "text-left";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Contacts</h1>

      {/* Tabs */}
      <div className="flex border-b">
        {tabs.map(t => (
          <button key={t} onClick={() => { setTab(t); setSearchQuery(""); setStatusFilter(""); setSourceFilter(""); setSelectedIds(new Set()); }}
            className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search contacts..." className="w-full h-9 pl-9 pr-4 rounded-lg bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 border border-border" />
        </div>
        {(tab === "Leads" || tab === "Recruits") && (
          <div className="flex bg-muted rounded-lg p-0.5 border border-border">
            <button onClick={() => setView("table")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><List className="w-4 h-4" /></button>
            <button onClick={() => setView("kanban")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><LayoutGrid className="w-4 h-4" /></button>
          </div>
        )}
        {/* Columns button */}
        {tab === "Leads" && view === "table" && (
          <div className="relative" ref={columnsRef}>
            <button onClick={() => setColumnsOpen(!columnsOpen)} className="h-9 px-3 rounded-md bg-background border border-border text-foreground text-sm flex items-center gap-2 hover:bg-muted transition-colors duration-150">
              <Columns3 className="w-4 h-4" />Columns
            </button>
            {columnsOpen && (
              <div className="absolute top-full mt-1 left-0 w-56 bg-card border border-border rounded-lg shadow-lg p-3 z-50">
                <p className="text-sm font-semibold text-foreground mb-2">Toggle Columns</p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {ALL_COLUMNS.map(col => (
                    <label key={col.key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleCols.has(col.key)}
                        disabled={col.locked}
                        onChange={() => {
                          if (col.locked) return;
                          setVisibleCols(prev => {
                            const next = new Set(prev);
                            next.has(col.key) ? next.delete(col.key) : next.add(col.key);
                            return next;
                          });
                        }}
                        className="rounded"
                      />
                      {col.label}
                      {col.locked && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild><Lock className="w-3 h-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Name cannot be hidden</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </label>
                  ))}
                </div>
                <button onClick={() => setVisibleCols(new Set(DEFAULT_VISIBLE))} className="text-xs text-primary hover:underline mt-2">Reset to default</button>
              </div>
            )}
          </div>
        )}
        <div className="relative">
          <button onClick={() => setFilterOpen(!filterOpen)} className="h-9 px-3 rounded-lg bg-muted text-foreground text-sm flex items-center gap-2 hover:bg-accent sidebar-transition border border-border"><Filter className="w-4 h-4" />Filter</button>
          {filterOpen && (
            <div className="absolute top-full mt-1 left-0 w-56 bg-card border rounded-lg shadow-lg p-3 z-50 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full h-8 px-2 rounded-lg bg-muted text-sm border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none text-foreground">
                  <option value="">All</option>
                  {allStatuses.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Source</label>
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="w-full h-8 px-2 rounded-lg bg-muted text-sm border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none text-foreground">
                  <option value="">All</option>
                  {["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <button onClick={() => { setStatusFilter(""); setSourceFilter(""); setFilterOpen(false); }} className="text-xs text-primary hover:underline">Clear Filters</button>
            </div>
          )}
        </div>
        <div className="flex-1" />
        <button className="h-9 px-3 rounded-lg bg-muted text-foreground text-sm flex items-center gap-2 hover:bg-accent sidebar-transition border border-border"><Upload className="w-4 h-4" />Import CSV</button>
        <button onClick={() => setAddModalOpen(true)} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Plus className="w-4 h-4" />Add Contact</button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
      )}

      {/* LEADS TAB - Table View */}
      {!loading && tab === "Leads" && view === "table" && (
        <>
          {/* Source Performance */}
          <div className="bg-card rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Lead Source Performance</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">Source</th>
                  <th className="text-right py-2 font-medium">Leads</th>
                  <th className="text-right py-2 font-medium">Contacted %</th>
                  <th className="text-right py-2 font-medium">Conversion %</th>
                  <th className="text-right py-2 font-medium">Policies Sold</th>
                </tr></thead>
                <tbody>
                  {sourceStats.map(s => (
                    <tr key={s.source} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer" onClick={() => setSourceFilter(s.source)}>
                      <td className="py-2 font-medium text-foreground">{s.source}</td>
                      <td className="py-2 text-right text-foreground">{s.leads}</td>
                      <td className="py-2 text-right text-foreground">{s.contacted}</td>
                      <td className="py-2 text-right text-foreground">{s.conversion}</td>
                      <td className="py-2 text-right text-foreground">{s.sold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bulk Actions Toolbar */}
          {selectedIds.size > 0 && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 flex items-center gap-3 animate-in slide-in-from-top-2 fade-in duration-200">
              <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
              <div className="w-px h-5 bg-primary/20" />
              {/* Assign Agent */}
              <div className="relative">
                <button onClick={() => { setBulkAssignOpen(!bulkAssignOpen); setBulkStatusOpen(false); }} className="text-sm text-foreground hover:text-primary transition-colors">Assign Agent</button>
                {bulkAssignOpen && (
                  <div className="absolute top-full mt-1 left-0 w-40 bg-card border border-border rounded-lg shadow-lg p-1 z-50">
                    {mockAgents.map(a => (
                      <button key={a.id} onClick={() => handleBulkAssign(a.name)} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors">{a.name}</button>
                    ))}
                  </div>
                )}
              </div>
              {/* Change Status */}
              <div className="relative">
                <button onClick={() => { setBulkStatusOpen(!bulkStatusOpen); setBulkAssignOpen(false); }} className="text-sm text-foreground hover:text-primary transition-colors">Change Status</button>
                {bulkStatusOpen && (
                  <div className="absolute top-full mt-1 left-0 w-44 bg-card border border-border rounded-lg shadow-lg p-1 z-50">
                    {allStatuses.map(s => (
                      <button key={s} onClick={() => handleBulkStatusChange(s)} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors">{s}</button>
                    ))}
                  </div>
                )}
              </div>
              {/* Delete */}
              <button onClick={() => setBulkDeleteOpen(true)} className="text-sm text-red-500 hover:text-red-400 transition-colors">Delete</button>
              {/* SMS Blast */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button disabled className="text-sm text-muted-foreground cursor-not-allowed opacity-50">SMS Blast</button>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon — configure SMS in Settings</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {/* Email Blast */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button disabled className="text-sm text-muted-foreground cursor-not-allowed opacity-50">Email Blast</button>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon — configure Email in Settings</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex-1" />
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Deselect All</button>
            </div>
          )}

          {/* Leads Table */}
          <div className="bg-card rounded-xl border overflow-hidden">
            {leads.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold text-foreground mb-1">No leads found</h3>
                <p className="text-sm text-muted-foreground mb-4">Try adjusting your filters or add your first lead.</p>
                <button onClick={() => setAddModalOpen(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Add Lead</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="w-10 py-3 px-3">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                        onChange={toggleAll}
                        className="rounded"
                      />
                    </th>
                    {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => (
                      <th key={col.key} className={`${colAlign(col.key)} py-3 font-medium select-none cursor-pointer hover:text-foreground transition-colors group`} onClick={() => handleSort(col.key)}>
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {sortCol === col.key ? (
                            sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5 text-primary" /> : <ArrowDown className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
                          )}
                        </span>
                      </th>
                    ))}
                    <th className="w-10 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {sortedLeads.map(l => {
                      const aging = calcAging(l.lastContactedAt);
                      return (
                        <tr key={l.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedIds.has(l.id) ? "bg-primary/5" : ""}`} onClick={() => setSelectedLead(l)}>
                          <td className="py-3 px-3" onClick={e => { e.stopPropagation(); toggleSelect(l.id); }}><input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => {}} className="rounded" /></td>
                          {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => (
                            <td key={col.key} className={`py-3 ${colAlign(col.key)}`}>{renderCell(l, col.key, aging)}</td>
                          ))}
                          <td className="py-3" onClick={e => e.stopPropagation()}><button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* LEADS Kanban */}
      {!loading && tab === "Leads" && view === "kanban" && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {allStatuses.map(status => {
            const items = leads.filter(l => l.status === status);
            return (
              <div key={status} className="min-w-[250px] bg-accent/50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status]}`}>{status}</span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                {items.map(l => (
                  <div key={l.id} className="bg-card rounded-lg border p-3 cursor-pointer hover:shadow-md sidebar-transition" onClick={() => setSelectedLead(l)}>
                    <p className="text-sm font-medium text-foreground">{l.firstName} {l.lastName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{l.state}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${l.leadScore >= 8 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{l.leadScore}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-muted-foreground">{l.leadSource}</span>
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{getAgentInitials(l.assignedAgentId)}</div>
                    </div>
                  </div>
                ))}
                <button onClick={() => setAddModalOpen(true)} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent sidebar-transition">+ Add</button>
              </div>
            );
          })}
        </div>
      )}

      {/* CLIENTS TAB */}
      {!loading && tab === "Clients" && (
        <div className="bg-card rounded-xl border overflow-hidden">
          {clients.length === 0 ? (
            <div className="text-center py-12">
              <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">No clients yet</h3>
              <p className="text-sm text-muted-foreground">Convert leads to clients after policy sales.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground border-b bg-accent/50">
                  <th className="text-left py-3 px-4 font-medium">Name</th>
                  <th className="text-left py-3 font-medium">Phone</th>
                  <th className="text-left py-3 font-medium">Policy Type</th>
                  <th className="text-left py-3 font-medium hidden lg:table-cell">Carrier</th>
                  <th className="text-left py-3 font-medium">Premium</th>
                  <th className="text-left py-3 font-medium hidden lg:table-cell">Face Amount</th>
                  <th className="text-left py-3 font-medium hidden xl:table-cell">Issue Date</th>
                  <th className="w-10 py-3"></th>
                </tr></thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition">
                      <td className="py-3 px-4 font-medium text-foreground">{c.firstName} {c.lastName}</td>
                      <td className="py-3 font-mono text-xs text-foreground">{c.phone}</td>
                      <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${policyTypeColors[c.policyType] || "bg-muted text-muted-foreground"}`}>{c.policyType}</span></td>
                      <td className="py-3 text-muted-foreground hidden lg:table-cell">{c.carrier}</td>
                      <td className="py-3 text-foreground">{c.premiumAmount}</td>
                      <td className="py-3 text-foreground hidden lg:table-cell">{c.faceAmount}</td>
                      <td className="py-3 text-muted-foreground hidden xl:table-cell">{c.issueDate}</td>
                      <td className="py-3"><button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* RECRUITS TAB */}
      {!loading && tab === "Recruits" && (
        <div className="bg-card rounded-xl border overflow-hidden">
          {recruits.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">No recruits yet</h3>
              <p className="text-sm text-muted-foreground">Start building your recruit pipeline.</p>
            </div>
          ) : view === "table" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground border-b bg-accent/50">
                  <th className="text-left py-3 px-4 font-medium">Name</th>
                  <th className="text-left py-3 font-medium">Phone</th>
                  <th className="text-left py-3 font-medium">Email</th>
                  <th className="text-left py-3 font-medium">Status</th>
                  <th className="text-left py-3 font-medium">Agent</th>
                  <th className="w-10 py-3"></th>
                </tr></thead>
                <tbody>
                  {recruits.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition">
                      <td className="py-3 px-4 font-medium text-foreground">{r.firstName} {r.lastName}</td>
                      <td className="py-3 font-mono text-xs text-foreground">{r.phone}</td>
                      <td className="py-3 text-muted-foreground">{r.email}</td>
                      <td className="py-3"><span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{r.status}</span></td>
                      <td className="py-3 text-foreground">{getAgentName(r.assignedAgentId)}</td>
                      <td className="py-3"><button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-4 p-3">
              {["Prospect", "Contacted", "Interview", "Licensed", "Active"].map(s => {
                const items = recruits.filter(r => r.status === s);
                return (
                  <div key={s} className="min-w-[220px] bg-accent/50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-foreground">{s}</span>
                      <span className="text-xs text-muted-foreground">{items.length}</span>
                    </div>
                    {items.map(r => (
                      <div key={r.id} className="bg-card rounded-lg border p-3">
                        <p className="text-sm font-medium text-foreground">{r.firstName} {r.lastName}</p>
                        <p className="text-xs text-muted-foreground">{r.email}</p>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* AGENTS TAB */}
      {!loading && tab === "Agents" && (
        <div className="bg-card rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-muted-foreground border-b bg-accent/50">
                <th className="text-left py-3 px-4 font-medium">Agent</th>
                <th className="text-left py-3 font-medium">Email</th>
                <th className="text-left py-3 font-medium hidden lg:table-cell">Licensed States</th>
                <th className="text-left py-3 font-medium">Commission</th>
                <th className="text-left py-3 font-medium">Role</th>
                <th className="text-left py-3 font-medium">Status</th>
                <th className="w-10 py-3"></th>
              </tr></thead>
              <tbody>
                {mockUsers.map(u => {
                  const p = mockProfiles.find(p => p.userId === u.id);
                  const availColors: Record<string, string> = { Available: "bg-success", "On Break": "bg-warning", "Do Not Disturb": "bg-destructive", Offline: "bg-muted-foreground/50" };
                  return (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-accent/30 sidebar-transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{u.firstName[0]}{u.lastName[0]}</div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${availColors[u.availabilityStatus] || "bg-muted-foreground/50"}`} />
                          </div>
                          <span className="font-medium text-foreground">{u.firstName} {u.lastName}</span>
                        </div>
                      </td>
                      <td className="py-3 text-muted-foreground">{u.email}</td>
                      <td className="py-3 text-muted-foreground hidden lg:table-cell">{p?.licensedStates.join(", ")}</td>
                      <td className="py-3 text-foreground">{p?.commissionLevel}</td>
                      <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.role === "Admin" ? "bg-primary/10 text-primary" : u.role === "Team Leader" ? "bg-info/10 text-info" : "bg-success/10 text-success"}`}>{u.role}</span></td>
                      <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.status === "Active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{u.status}</span></td>
                      <td className="py-3"><button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <AddContactModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddLead} />
      <AddContactModal open={!!editLead} onClose={() => setEditLead(null)} onSave={async (d) => { if (editLead) { await handleUpdateLead(editLead.id, d); setEditLead(null); } }} initial={editLead} />
      <ContactModal lead={selectedLead} onClose={() => setSelectedLead(null)} onUpdate={handleUpdateLead} onDelete={handleDeleteLead} />
      <DeleteConfirmModal open={deleteConfirmOpen} count={selectedIds.size} onConfirm={handleBulkDelete} onClose={() => setDeleteConfirmOpen(false)} />
      <DeleteConfirmModal open={bulkDeleteOpen} count={selectedIds.size} title={`Delete ${selectedIds.size} Leads?`} onConfirm={handleBulkDelete} onClose={() => setBulkDeleteOpen(false)} />
    </div>
  );
};

export default Contacts;