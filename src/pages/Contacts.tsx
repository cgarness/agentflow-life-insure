import React, { useState, useEffect, useCallback } from "react";
import {
  Search, Filter, LayoutGrid, List, Upload, Plus, MoreHorizontal,
  Phone, Eye, Pencil, Trash2, X, ShieldCheck, Calendar, Mail, Users,
  Loader2, ChevronDown, GripVertical, AlertTriangle,
} from "lucide-react";
import { leadsApi, clientsApi, recruitsApi, notesApi } from "@/lib/mock-api";
import { Lead, Client, Recruit, LeadStatus, ContactNote, ContactActivity } from "@/lib/types";
import { mockUsers, mockProfiles, mockCalls, mockNotes, mockActivities, calcAging, getAgentName, getAgentInitials } from "@/lib/mock-data";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

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

// ---- Contact Detail Modal ----
const ContactDetailModal: React.FC<{
  lead: Lead | null;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Lead>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}> = ({ lead, onClose, onUpdate, onDelete }) => {
  const [activeTab, setActiveTab] = useState<"Overview" | "Activity" | "Calls" | "Notes">("Overview");
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Lead>>({});
  const [newNote, setNewNote] = useState("");
  const [localNotes, setLocalNotes] = useState<ContactNote[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (lead) {
      setEditForm({ ...lead });
      setLocalNotes(mockNotes.filter(n => n.contactId === lead.id).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
      setActiveTab("Overview");
      setEditMode(false);
    }
  }, [lead]);

  if (!lead) return null;

  const aging = calcAging(lead.lastContactedAt);
  const leadCalls = mockCalls.filter(c => c.contactId === lead.id);
  const leadActivities = mockActivities.filter(a => a.contactId === lead.id);

  const handleSave = async () => {
    await onUpdate(lead.id, editForm);
    setEditMode(false);
    toast.success("Contact updated");
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    const note = await notesApi.add(lead.id, "lead", newNote, "u1");
    setLocalNotes(prev => [note, ...prev]);
    setNewNote("");
    toast.success("Note added");
  };

  const handleTogglePin = async (noteId: string) => {
    const updated = await notesApi.togglePin(noteId);
    setLocalNotes(prev => prev.map(n => n.id === noteId ? updated : n).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)));
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
        {/* Hero */}
        <div className="p-6 border-b">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-bold">
                {lead.firstName[0]}{lead.lastName[0]}
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{lead.firstName} {lead.lastName}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[lead.status]}`}>{lead.status}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${lead.leadScore >= 8 ? "bg-success/10 text-success" : lead.leadScore >= 5 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}`}>Score: {lead.leadScore}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${aging >= 5 ? "bg-destructive/10 text-destructive" : aging >= 3 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{aging === 0 ? "Today" : `${aging}d ago`}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setEditMode(!editMode)} className={`px-3 py-1.5 rounded-lg text-xs font-medium sidebar-transition ${editMode ? "bg-warning/10 text-warning" : "bg-muted text-foreground hover:bg-accent"}`}>
                {editMode ? "Cancel Edit" : "Edit"}
              </button>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
          </div>
          <div className="flex gap-2 mt-4 flex-wrap">
            <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Phone className="w-4 h-4" />Call</button>
            <button className="px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium flex items-center gap-2 hover:bg-accent sidebar-transition"><Mail className="w-4 h-4" />Email</button>
            <button className="px-4 py-2 rounded-lg bg-muted text-foreground text-sm font-medium flex items-center gap-2 hover:bg-accent sidebar-transition"><Calendar className="w-4 h-4" />Schedule</button>
            <button className="px-4 py-2 rounded-lg bg-success/10 text-success text-sm font-medium flex items-center gap-2 hover:bg-success/20 sidebar-transition"><ShieldCheck className="w-4 h-4" />Convert to Client</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-6">
          {(["Overview", "Activity", "Calls", "Notes"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${activeTab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "Overview" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ["Phone", lead.phone, "phone"],
                ["Email", lead.email, "email"],
                ["State", lead.state, "state"],
                ["Lead Source", lead.leadSource, "leadSource"],
                ["Age", lead.age?.toString() || "—", "age"],
                ["Assigned Agent", getAgentName(lead.assignedAgentId), ""],
                ["Status", lead.status, "status"],
                ["Score", lead.leadScore.toString(), "leadScore"],
              ].map(([label, value, key]) => (
                <div key={label}>
                  <label className="text-xs font-medium text-muted-foreground">{label}</label>
                  {editMode && key ? (
                    key === "status" ? (
                      <select value={(editForm as any)[key] || value} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value as LeadStatus }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border mt-1 focus:ring-2 focus:ring-primary/50 focus:outline-none">
                        {allStatuses.map(s => <option key={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input value={(editForm as any)[key] || ""} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border mt-1 focus:ring-2 focus:ring-primary/50 focus:outline-none" />
                    )
                  ) : (
                    <p className="text-sm text-foreground mt-0.5">{value}</p>
                  )}
                </div>
              ))}
              {editMode && (
                <div className="col-span-2">
                  <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Save Changes</button>
                </div>
              )}
            </div>
          )}

          {activeTab === "Activity" && (
            <div className="space-y-3">
              {leadActivities.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No activity yet</p>}
              {leadActivities.map(a => (
                <div key={a.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${a.type === "call" ? "bg-primary/10 text-primary" : a.type === "status" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
                    {a.type === "call" ? <Phone className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm text-foreground">{a.description}</p>
                    <p className="text-xs text-muted-foreground">{a.agentName} · {new Date(a.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "Calls" && (
            <div className="space-y-3">
              {leadCalls.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No calls yet</p>}
              {leadCalls.map(c => (
                <div key={c.id} className="bg-muted/50 rounded-lg p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-primary" />
                    <div>
                      <p className="text-sm text-foreground">{c.direction === "outbound" ? "Outbound" : "Inbound"} · {formatDuration(c.duration)}</p>
                      <p className="text-xs text-muted-foreground">{c.agentName} · {new Date(c.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  {c.disposition && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[c.disposition] || "bg-muted text-muted-foreground"}`}>{c.disposition}</span>}
                </div>
              ))}
            </div>
          )}

          {activeTab === "Notes" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddNote()} placeholder="Add a note..." className="flex-1 h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
                <button onClick={handleAddNote} disabled={!newNote.trim()} className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition disabled:opacity-50">Add</button>
              </div>
              {localNotes.map(n => (
                <div key={n.id} className={`rounded-lg border p-3 ${n.pinned ? "border-primary/30 bg-primary/5" : ""}`}>
                  <div className="flex items-start justify-between">
                    <p className="text-sm text-foreground">{n.note}</p>
                    <button onClick={() => handleTogglePin(n.id)} className={`text-xs shrink-0 ml-2 ${n.pinned ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>{n.pinned ? "📌" : "Pin"}</button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{n.agentName} · {new Date(n.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-3 flex items-center justify-between">
          <div className="flex gap-2">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-destructive font-medium">Delete permanently?</span>
                <button onClick={async () => { await onDelete(lead.id); onClose(); }} className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium">Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-medium">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="px-3 py-1.5 rounded-lg text-destructive text-xs font-medium hover:bg-destructive/10 sidebar-transition flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />Delete</button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Created {new Date(lead.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
};

// ---- Delete Confirm ----
const DeleteConfirmModal: React.FC<{ open: boolean; count: number; onConfirm: () => void; onClose: () => void }> = ({ open, count, onConfirm, onClose }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 animate-in fade-in zoom-in-95">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-destructive" /></div>
          <div>
            <h3 className="font-semibold text-foreground">Delete {count} contact{count > 1 ? "s" : ""}?</h3>
            <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent sidebar-transition">Cancel</button>
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
    for (const id of selectedIds) await leadsApi.delete(id);
    toast.success(`${selectedIds.size} lead(s) deleted`);
    setSelectedIds(new Set());
    fetchData();
  };

  const handleBulkStatusChange = async (status: LeadStatus) => {
    for (const id of selectedIds) await leadsApi.update(id, { status });
    toast.success(`${selectedIds.size} lead(s) updated`);
    setSelectedIds(new Set());
    fetchData();
  };

  const toggleSelect = (id: string) => setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => setSelectedIds(prev => prev.size === leads.length ? new Set() : new Set(leads.map(l => l.id)));

  const tabs = ["Leads", "Clients", "Recruits", "Agents"] as const;

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
        {(tab === "Leads" || tab === "Recruits") && (
          <div className="flex bg-muted rounded-lg p-0.5 border border-border">
            <button onClick={() => setView("table")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><List className="w-4 h-4" /></button>
            <button onClick={() => setView("kanban")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><LayoutGrid className="w-4 h-4" /></button>
          </div>
        )}
        <div className="flex-1" />
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <select onChange={e => { if (e.target.value) handleBulkStatusChange(e.target.value as LeadStatus); e.target.value = ""; }} className="h-8 px-2 rounded-lg bg-muted text-sm border border-border text-foreground focus:outline-none">
              <option value="">Change Status</option>
              {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setDeleteConfirmOpen(true)} className="h-8 px-3 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 sidebar-transition">Delete</button>
          </div>
        )}
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
                    <th className="w-10 py-3 px-3"><input type="checkbox" checked={selectedIds.size === leads.length && leads.length > 0} onChange={toggleAll} className="rounded" /></th>
                    <th className="text-left py-3 font-medium">Name</th>
                    <th className="text-left py-3 font-medium">Phone</th>
                    <th className="text-left py-3 font-medium hidden lg:table-cell">Email</th>
                    <th className="text-left py-3 font-medium">State</th>
                    <th className="text-left py-3 font-medium">Status</th>
                    <th className="text-left py-3 font-medium hidden xl:table-cell">Source</th>
                    <th className="text-center py-3 font-medium">Score</th>
                    <th className="text-center py-3 font-medium hidden lg:table-cell">Aging</th>
                    <th className="text-left py-3 font-medium hidden xl:table-cell">Agent</th>
                    <th className="w-10 py-3"></th>
                  </tr></thead>
                  <tbody>
                    {leads.map(l => {
                      const aging = calcAging(l.lastContactedAt);
                      return (
                        <tr key={l.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedIds.has(l.id) ? "bg-primary/5" : ""}`} onClick={() => setSelectedLead(l)}>
                          <td className="py-3 px-3" onClick={e => { e.stopPropagation(); toggleSelect(l.id); }}><input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => {}} className="rounded" /></td>
                          <td className="py-3 font-medium text-foreground">{l.firstName} {l.lastName}</td>
                          <td className="py-3 text-foreground font-mono text-xs">{l.phone}</td>
                          <td className="py-3 text-muted-foreground hidden lg:table-cell">{l.email}</td>
                          <td className="py-3"><span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{l.state}</span></td>
                          <td className="py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[l.status]}`}>{l.status}</span></td>
                          <td className="py-3 text-muted-foreground hidden xl:table-cell">{l.leadSource}</td>
                          <td className="py-3 text-center"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.leadScore >= 8 ? "bg-success/10 text-success" : l.leadScore >= 5 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}`}>{l.leadScore}</span></td>
                          <td className="py-3 text-center hidden lg:table-cell"><span className={`w-2.5 h-2.5 rounded-full inline-block ${aging >= 5 ? "bg-destructive" : aging >= 3 ? "bg-warning" : "bg-success"}`} /></td>
                          <td className="py-3 text-foreground hidden xl:table-cell">{getAgentName(l.assignedAgentId)}</td>
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
      <ContactDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} onUpdate={handleUpdateLead} onDelete={handleDeleteLead} />
      <DeleteConfirmModal open={deleteConfirmOpen} count={selectedIds.size} onConfirm={handleBulkDelete} onClose={() => setDeleteConfirmOpen(false)} />
    </div>
  );
};

export default Contacts;
