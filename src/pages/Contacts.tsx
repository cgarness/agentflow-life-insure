import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  Search, Filter, LayoutGrid, List, Upload, Plus, MoreHorizontal,
  Phone, Eye, Pencil, Trash2, X, ShieldCheck, Calendar, Mail, Users,
  Loader2, ChevronDown, ChevronUp, AlertTriangle, Columns3, Lock,
  ArrowUp, ArrowDown, ArrowUpDown, Undo2,
} from "lucide-react";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { importLeadsToSupabase } from "@/lib/supabase-leads";
import { Lead, Client, Recruit, LeadStatus, ContactNote, ContactActivity } from "@/lib/types";
import { mockUsers, mockProfiles, mockCalls, mockNotes, mockActivities, mockCampaigns, calcAging, getAgentName, getAgentInitials } from "@/lib/mock-data";
import ContactModal from "@/components/contacts/ContactModal";
import ClientModal from "@/components/contacts/ClientModal";
import RecruitModal from "@/components/contacts/RecruitModal";
import AgentModal from "@/components/contacts/AgentModal";
import ImportLeadsModal, { type ImportHistoryEntry } from "@/components/contacts/ImportLeadsModal";
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

const recruitStatusColors: Record<string, string> = {
  "Prospect": "bg-muted text-muted-foreground",
  "Contacted": "bg-primary/10 text-primary",
  "Interview": "bg-warning/10 text-warning",
  "Licensed": "bg-info/10 text-info",
  "Active": "bg-success/10 text-success",
};

const allStatuses: LeadStatus[] = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];
const recruitStatuses = ["Prospect", "Contacted", "Interview", "Licensed", "Active"];

// Aging pill helper
function agingPill(days: number) {
  if (days >= 15) return { cls: "bg-red-500/10 text-red-500", label: `🔥 ${days}d` };
  if (days >= 8) return { cls: "bg-orange-500/10 text-orange-500", label: `${days}d` };
  if (days >= 4) return { cls: "bg-yellow-500/10 text-yellow-500", label: `${days}d` };
  return { cls: "bg-green-500/10 text-green-500", label: `${days}d` };
}

// ===== LEAD Column definitions =====
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

// ===== CLIENT Column definitions =====
type ClientColumnKey = "name" | "phone" | "policyType" | "carrier" | "premium" | "faceAmount" | "issueDate" | "agent";
interface ClientColDef { key: ClientColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
const CLIENT_COLUMNS: ClientColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "policyType", label: "Policy Type", defaultVisible: true },
  { key: "carrier", label: "Carrier", defaultVisible: true },
  { key: "premium", label: "Premium", defaultVisible: true },
  { key: "faceAmount", label: "Face Amount", defaultVisible: true },
  { key: "issueDate", label: "Issue Date", defaultVisible: true },
  { key: "agent", label: "Agent", defaultVisible: true },
];
const DEFAULT_CLIENT_VISIBLE = new Set(CLIENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// ===== RECRUIT Column definitions =====
type RecruitColumnKey = "name" | "phone" | "email" | "status" | "agent";
interface RecruitColDef { key: RecruitColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
const RECRUIT_COLUMNS: RecruitColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
  { key: "agent", label: "Agent", defaultVisible: true },
];
const DEFAULT_RECRUIT_VISIBLE = new Set(RECRUIT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// ===== AGENT Column definitions =====
type AgentColumnKey = "name" | "email" | "licensedStates" | "commission" | "role" | "status";
interface AgentColDef { key: AgentColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
const AGENT_COLUMNS: AgentColDef[] = [
  { key: "name", label: "Agent", defaultVisible: true, locked: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "licensedStates", label: "Licensed States", defaultVisible: true },
  { key: "commission", label: "Commission", defaultVisible: true },
  { key: "role", label: "Role", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
];
const DEFAULT_AGENT_VISIBLE = new Set(AGENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

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
  initial?: any | null;
  contactType?: string;
}> = ({ open, onClose, onSave, initial, contactType = "Lead" }) => {
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (contactType === "Client") {
      if (initial) setForm({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email, policyType: initial.policyType || "Term", carrier: initial.carrier || "", premiumAmount: initial.premiumAmount || "", faceAmount: initial.faceAmount || "", issueDate: initial.issueDate || "" });
      else setForm({ firstName: "", lastName: "", phone: "", email: "", policyType: "Term", carrier: "", premiumAmount: "", faceAmount: "", issueDate: "" });
    } else if (contactType === "Recruit") {
      if (initial) setForm({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email, status: initial.status || "Prospect" });
      else setForm({ firstName: "", lastName: "", phone: "", email: "", status: "Prospect" });
    } else {
      if (initial) setForm({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email, state: initial.state, leadSource: initial.leadSource, status: initial.status || "New" });
      else setForm({ firstName: "", lastName: "", phone: "", email: "", state: "", leadSource: "Facebook Ads", status: "New" });
    }
  }, [initial, open, contactType]);

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
              <input required value={form.firstName || ""} onChange={e => setForm((f: any) => ({ ...f, firstName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Last Name *</label>
              <input required value={form.lastName || ""} onChange={e => setForm((f: any) => ({ ...f, lastName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Phone *</label>
            <input required value={form.phone || ""} onChange={e => setForm((f: any) => ({ ...f, phone: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="(555) 123-4567" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Email *</label>
            <input required type="email" value={form.email || ""} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>

          {/* Lead-specific fields */}
          {contactType === "Lead" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">State</label>
                <input value={form.state || ""} onChange={e => setForm((f: any) => ({ ...f, state: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="FL" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Lead Source</label>
                <select value={form.leadSource || "Facebook Ads"} onChange={e => setForm((f: any) => ({ ...f, leadSource: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                  {["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Client-specific fields */}
          {contactType === "Client" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Policy Type *</label>
                  <select required value={form.policyType || "Term"} onChange={e => setForm((f: any) => ({ ...f, policyType: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                    {["Term", "Whole Life", "IUL", "Final Expense"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Carrier *</label>
                  <input required value={form.carrier || ""} onChange={e => setForm((f: any) => ({ ...f, carrier: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Premium</label>
                  <input value={form.premiumAmount || ""} onChange={e => setForm((f: any) => ({ ...f, premiumAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$150/mo" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Face Amount</label>
                  <input value={form.faceAmount || ""} onChange={e => setForm((f: any) => ({ ...f, faceAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$500,000" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Issue Date</label>
                <input type="date" value={form.issueDate || ""} onChange={e => setForm((f: any) => ({ ...f, issueDate: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
              </div>
            </>
          )}

          {/* Recruit-specific fields */}
          {contactType === "Recruit" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select value={form.status || "Prospect"} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                {recruitStatuses.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg bg-muted text-foreground text-sm font-medium hover:bg-accent sidebar-transition">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {initial ? "Save Changes" : `Add ${contactType}`}
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
  const location = useLocation();
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
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [selectedRecruitIds, setSelectedRecruitIds] = useState<Set<string>>(new Set());
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedRecruit, setSelectedRecruit] = useState<Recruit | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<typeof mockUsers[0] | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editRecruit, setEditRecruit] = useState<Recruit | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sourceStats, setSourceStats] = useState<any[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>([]);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState<ImportHistoryEntry | null>(null);
  const [sourcePerfOpen, setSourcePerfOpen] = useState(false);

  // Column visibility per tab
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(new Set(DEFAULT_VISIBLE));
  const [visibleClientCols, setVisibleClientCols] = useState<Set<ClientColumnKey>>(new Set(DEFAULT_CLIENT_VISIBLE));
  const [visibleRecruitCols, setVisibleRecruitCols] = useState<Set<RecruitColumnKey>>(new Set(DEFAULT_RECRUIT_VISIBLE));
  const [visibleAgentCols, setVisibleAgentCols] = useState<Set<AgentColumnKey>>(new Set(DEFAULT_AGENT_VISIBLE));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  // Column Resizing State
  const [columnWidths, setColumnWidths] = useState<Record<string, Record<string, number>>>(() => {
    try {
      const saved = localStorage.getItem("contactColumnWidths");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizingColRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // Save to localStorage when widths change
  useEffect(() => {
    localStorage.setItem("contactColumnWidths", JSON.stringify(columnWidths));
  }, [columnWidths]);

  // Handle global mouse events for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingColRef.current) return;
      const diffX = e.clientX - startXRef.current;
      const newWidth = Math.max(60, startWidthRef.current + diffX);

      setColumnWidths(prev => ({
        ...prev,
        [tab]: {
          ...(prev[tab] || {}),
          [resizingColRef.current!]: newWidth
        }
      }));
    };

    const handleMouseUp = () => {
      if (resizingColRef.current) {
        resizingColRef.current = null;
        setResizingCol(null);
        document.body.style.cursor = 'default';
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [tab]);

  const handleResizeStart = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    e.preventDefault();
    resizingColRef.current = key;
    setResizingCol(key);
    startXRef.current = e.clientX;
    const existingWidth = columnWidths[tab]?.[key];
    // Default width if not set (150px is a reasonable guess for a column)
    startWidthRef.current = existingWidth || 150;
    document.body.style.cursor = 'col-resize';
  };

  // Bulk action dropdowns
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Sorting — shared across tabs, reset on tab change
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Action menus
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  const handleSort = (key: string) => {
    if (sortCol === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  };

  // ===== Lead sort =====
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
      const va = getSortValue(a, sortCol as ColumnKey);
      const vb = getSortValue(b, sortCol as ColumnKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [leads, sortCol, sortDir]);

  // ===== Client sort =====
  const getClientSortValue = (c: Client, key: ClientColumnKey): string | number => {
    switch (key) {
      case "name": return `${c.firstName} ${c.lastName}`.toLowerCase();
      case "phone": return c.phone;
      case "policyType": return c.policyType;
      case "carrier": return c.carrier.toLowerCase();
      case "premium": return c.premiumAmount;
      case "faceAmount": return c.faceAmount;
      case "issueDate": return c.issueDate;
      case "agent": return getAgentName(c.assignedAgentId).toLowerCase();
      default: return "";
    }
  };

  const sortedClients = React.useMemo(() => {
    if (!sortCol) return clients;
    return [...clients].sort((a, b) => {
      const va = getClientSortValue(a, sortCol as ClientColumnKey);
      const vb = getClientSortValue(b, sortCol as ClientColumnKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [clients, sortCol, sortDir]);

  // ===== Recruit sort =====
  const getRecruitSortValue = (r: Recruit, key: RecruitColumnKey): string | number => {
    switch (key) {
      case "name": return `${r.firstName} ${r.lastName}`.toLowerCase();
      case "phone": return r.phone;
      case "email": return r.email.toLowerCase();
      case "status": return recruitStatuses.indexOf(r.status);
      case "agent": return getAgentName(r.assignedAgentId).toLowerCase();
      default: return "";
    }
  };

  const sortedRecruits = React.useMemo(() => {
    if (!sortCol) return recruits;
    return [...recruits].sort((a, b) => {
      const va = getRecruitSortValue(a, sortCol as RecruitColumnKey);
      const vb = getRecruitSortValue(b, sortCol as RecruitColumnKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [recruits, sortCol, sortDir]);

  // ===== Agent sort =====
  const getAgentSortValue = (u: typeof mockUsers[0], key: AgentColumnKey): string | number => {
    const p = mockProfiles.find(p => p.userId === u.id);
    switch (key) {
      case "name": return `${u.firstName} ${u.lastName}`.toLowerCase();
      case "email": return u.email.toLowerCase();
      case "licensedStates": return p?.licensedStates.join(", ") || "";
      case "commission": return p?.commissionLevel || "";
      case "role": return u.role;
      case "status": return u.status;
      default: return "";
    }
  };

  const sortedAgents = React.useMemo(() => {
    if (!sortCol) return mockUsers;
    return [...mockUsers].sort((a, b) => {
      const va = getAgentSortValue(a, sortCol as AgentColumnKey);
      const vb = getAgentSortValue(b, sortCol as AgentColumnKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [sortCol, sortDir]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false);
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) setActionMenuId(null);
    };
    if (columnsOpen || actionMenuId) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [columnsOpen, actionMenuId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadData, clientData, recruitData, stats] = await Promise.all([
        leadsSupabaseApi.getAll({ search: searchQuery, status: statusFilter, source: sourceFilter }),
        clientsSupabaseApi.getAll(searchQuery),
        recruitsSupabaseApi.getAll(searchQuery),
        leadsSupabaseApi.getSourceStats(),
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

  // Reset selection and sort on tab change
  useEffect(() => {
    setSortCol(null);
    setSortDir("asc");
    setColumnsOpen(false);
    setActionMenuId(null);
    setBulkAssignOpen(false);
    setBulkStatusOpen(false);
  }, [tab]);

  // Auto-open a contact modal when navigated with openContactId state
  useEffect(() => {
    const openContactId = (location.state as any)?.openContactId;
    if (openContactId && leads.length > 0) {
      const match = leads.find(l => l.id === openContactId);
      if (match) {
        setSelectedLead(match);
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, leads]);

  useEffect(() => {
    const contactId = new URLSearchParams(location.search).get("contact");
    if (contactId && leads.length > 0) {
      const match = leads.find(l => l.id === contactId);
      if (match) {
        setSelectedLead(match);
        window.history.replaceState({}, "", "/contacts");
      }
    }
  }, [location.search, leads]);

  // ===== Lead CRUD =====
  const handleAddLead = async (data: any) => {
    await leadsSupabaseApi.create({ ...data, leadScore: 5, assignedAgentId: user?.id || "u1" });
    toast.success("Lead added successfully");
    fetchData();
  };

  const handleUpdateLead = async (id: string, data: Partial<Lead>) => {
    await leadsSupabaseApi.update(id, data);
    fetchData();
  };

  const handleDeleteLead = async (id: string) => {
    await leadsSupabaseApi.delete(id);
    toast.success("Lead deleted");
    setSelectedLead(null);
    fetchData();
  };

  const handleBulkDeleteLeads = async () => {
    const count = selectedIds.size;
    for (const id of selectedIds) await leadsSupabaseApi.delete(id);
    toast.error(`Deleted ${count} leads.`, { duration: 3000, position: "bottom-right" });
    setSelectedIds(new Set());
    fetchData();
  };

  const handleBulkStatusChange = async (status: LeadStatus) => {
    const count = selectedIds.size;
    for (const id of selectedIds) await leadsSupabaseApi.update(id, { status });
    toast.success(`Updated status for ${count} leads.`, { duration: 3000, position: "bottom-right" });
    setSelectedIds(new Set());
    setBulkStatusOpen(false);
    fetchData();
  };

  const handleBulkAssign = async (agentName: string) => {
    const currentSelection = tab === "Leads" ? selectedIds : tab === "Clients" ? selectedClientIds : selectedRecruitIds;
    const count = currentSelection.size;
    toast.success(`Assigned ${count} ${tab.toLowerCase()} to ${agentName}.`, { duration: 3000, position: "bottom-right" });
    if (tab === "Leads") setSelectedIds(new Set());
    else if (tab === "Clients") setSelectedClientIds(new Set());
    else if (tab === "Recruits") setSelectedRecruitIds(new Set());
    setBulkAssignOpen(false);
  };

  // ===== Client CRUD =====
  const handleAddClient = async (data: any) => {
    await clientsSupabaseApi.create({ ...data, assignedAgentId: user?.id || "u1" });
    toast.success("Client added successfully");
    fetchData();
  };

  const handleDeleteClient = async (id: string) => {
    await clientsSupabaseApi.delete(id);
    toast.success("Client deleted");
    fetchData();
  };

  const handleBulkDeleteClients = async () => {
    const count = selectedClientIds.size;
    for (const id of selectedClientIds) await clientsSupabaseApi.delete(id);
    toast.error(`Deleted ${count} clients.`, { duration: 3000, position: "bottom-right" });
    setSelectedClientIds(new Set());
    fetchData();
  };

  // ===== Recruit CRUD =====
  const handleAddRecruit = async (data: any) => {
    await recruitsSupabaseApi.create({ ...data, assignedAgentId: user?.id || "u1" });
    toast.success("Recruit added successfully");
    fetchData();
  };

  const handleDeleteRecruit = async (id: string) => {
    await recruitsSupabaseApi.delete(id);
    toast.success("Recruit deleted");
    fetchData();
  };

  const handleBulkDeleteRecruits = async () => {
    const count = selectedRecruitIds.size;
    for (const id of selectedRecruitIds) await recruitsSupabaseApi.delete(id);
    toast.error(`Deleted ${count} recruits.`, { duration: 3000, position: "bottom-right" });
    setSelectedRecruitIds(new Set());
    fetchData();
  };

  const handleBulkRecruitStatusChange = async (status: string) => {
    const count = selectedRecruitIds.size;
    for (const id of selectedRecruitIds) await recruitsSupabaseApi.update(id, { status });
    toast.success(`Updated status for ${count} recruits.`, { duration: 3000, position: "bottom-right" });
    setSelectedRecruitIds(new Set());
    setBulkStatusOpen(false);
    fetchData();
  };

  const handleBulkAgentStatusChange = async (status: string) => {
    toast.success(`Updated ${selectedAgentIds.size} agents to ${status}.`, { duration: 3000, position: "bottom-right" });
    setSelectedAgentIds(new Set());
    setBulkStatusOpen(false);
  };

  // ===== Selection helpers =====
  const toggleSelect = (id: string) => setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => setSelectedIds(prev => prev.size === leads.length ? new Set() : new Set(leads.map(l => l.id)));
  const toggleClientSelect = (id: string) => setSelectedClientIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllClients = () => setSelectedClientIds(prev => prev.size === clients.length ? new Set() : new Set(clients.map(c => c.id)));
  const toggleRecruitSelect = (id: string) => setSelectedRecruitIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllRecruits = () => setSelectedRecruitIds(prev => prev.size === recruits.length ? new Set() : new Set(recruits.map(r => r.id)));
  const toggleAgentSelect = (id: string) => setSelectedAgentIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAllAgents = () => setSelectedAgentIds(prev => prev.size === mockUsers.length ? new Set() : new Set(mockUsers.map(u => u.id)));

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

  const renderClientCell = (c: Client, key: ClientColumnKey) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground">{c.firstName} {c.lastName}</span>;
      case "phone": return <span className="text-foreground font-mono text-xs">{c.phone}</span>;
      case "policyType": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${policyTypeColors[c.policyType] || "bg-muted text-muted-foreground"}`}>{c.policyType}</span>;
      case "carrier": return <span className="text-muted-foreground">{c.carrier}</span>;
      case "premium": return <span className="text-foreground">{c.premiumAmount}</span>;
      case "faceAmount": return <span className="text-foreground">{c.faceAmount}</span>;
      case "issueDate": return <span className="text-muted-foreground">{c.issueDate}</span>;
      case "agent": return <span className="text-foreground">{getAgentName(c.assignedAgentId)}</span>;
      default: return null;
    }
  };

  const renderRecruitCell = (r: Recruit, key: RecruitColumnKey) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground">{r.firstName} {r.lastName}</span>;
      case "phone": return <span className="text-foreground font-mono text-xs">{r.phone}</span>;
      case "email": return <span className="text-muted-foreground">{r.email}</span>;
      case "status": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${recruitStatusColors[r.status] || "bg-muted text-muted-foreground"}`}>{r.status}</span>;
      case "agent": return <span className="text-foreground">{getAgentName(r.assignedAgentId)}</span>;
      default: return null;
    }
  };

  const renderAgentCell = (u: typeof mockUsers[0], key: AgentColumnKey) => {
    const p = mockProfiles.find(p => p.userId === u.id);
    const availColors: Record<string, string> = { Available: "bg-success", "On Break": "bg-warning", "Do Not Disturb": "bg-destructive", Offline: "bg-muted-foreground/50" };
    switch (key) {
      case "name": return (
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{u.firstName[0]}{u.lastName[0]}</div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${availColors[u.availabilityStatus] || "bg-muted-foreground/50"}`} />
          </div>
          <span className="font-medium text-foreground truncate">{u.firstName} {u.lastName}</span>
        </div>
      );
      case "email": return <span className="text-muted-foreground">{u.email}</span>;
      case "licensedStates": return <span className="text-muted-foreground">{p?.licensedStates.join(", ")}</span>;
      case "commission": return <span className="text-foreground">{p?.commissionLevel}</span>;
      case "role": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.role === "Admin" ? "bg-primary/10 text-primary" : u.role === "Team Leader" ? "bg-info/10 text-info" : "bg-success/10 text-success"}`}>{u.role}</span>;
      case "status": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.status === "Active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{u.status}</span>;
      default: return null;
    }
  };

  const colAlign = (key: string) => (key === "score" || key === "aging") ? "text-center" : "text-left";

  // Current tab's active selection count
  const activeSelectionCount = tab === "Leads" ? selectedIds.size : tab === "Clients" ? selectedClientIds.size : tab === "Recruits" ? selectedRecruitIds.size : selectedAgentIds.size;

  // Helper to render sortable header
  const renderSortHeader = (key: string, label: string) => {
    const width = columnWidths[tab]?.[key];
    const isResizing = resizingCol === key;

    return (
      <th
        key={key}
        style={{ width: width ? `${width}px` : 'auto', minWidth: width ? `${width}px` : 'auto' }}
        className={`${colAlign(key)} py-3 font-medium select-none cursor-pointer hover:text-foreground transition-colors group relative bg-transparent`}
        onClick={() => !resizingCol && handleSort(key)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortCol === key ? (
            sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5 text-primary" /> : <ArrowDown className="w-3.5 h-3.5 text-primary" />
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />
          )}
        </span>
        <div
          className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 ${isResizing ? "bg-primary" : "bg-transparent"} transition-colors`}
          onMouseDown={(e) => handleResizeStart(e, key)}
          onClick={(e) => e.stopPropagation()}
        />
      </th>
    );
  };

  // Generic columns toggle dropdown
  const renderColumnsDropdown = (columns: { key: string; label: string; locked?: boolean; defaultVisible: boolean }[], visible: Set<string>, setVisible: (s: Set<any>) => void, defaults: Set<string>) => (
    <div className="relative" ref={columnsRef}>
      <button onClick={() => setColumnsOpen(!columnsOpen)} className="h-9 px-3 rounded-md bg-background border border-border text-foreground text-sm flex items-center gap-2 hover:bg-muted transition-colors duration-150">
        <Columns3 className="w-4 h-4" />Columns
      </button>
      {columnsOpen && (
        <div className="absolute top-full mt-1 left-0 w-56 bg-card border border-border rounded-lg shadow-lg p-3 z-50">
          <p className="text-sm font-semibold text-foreground mb-2">Toggle Columns</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {columns.map(col => (
              <label key={col.key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={visible.has(col.key)}
                  disabled={col.locked}
                  onChange={() => {
                    if (col.locked) return;
                    const next = new Set(visible);
                    next.has(col.key) ? next.delete(col.key) : next.add(col.key);
                    setVisible(next);
                  }}
                  className="rounded"
                />
                {col.label}
                {col.locked && (
                  <TooltipProvider><Tooltip><TooltipTrigger asChild><Lock className="w-3 h-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Cannot be hidden</TooltipContent></Tooltip></TooltipProvider>
                )}
              </label>
            ))}
          </div>
          <button onClick={() => setVisible(new Set(defaults))} className="text-xs text-primary hover:underline mt-2">Reset to default</button>
        </div>
      )}
    </div>
  );

  // Generic bulk actions toolbar
  const renderBulkActions = (count: number, onDeselect: () => void, options: { showAssign?: boolean; showStatus?: boolean; statusList?: string[]; onStatusChange?: (s: string) => void; onDelete: () => void }) => (
    <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 flex items-center gap-3 animate-in slide-in-from-top-2 fade-in duration-200">
      <span className="text-sm font-medium text-primary">{count} selected</span>
      <div className="w-px h-5 bg-primary/20" />
      {options.showAssign && (
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
      )}
      {options.showStatus && options.statusList && options.onStatusChange && (
        <div className="relative">
          <button onClick={() => { setBulkStatusOpen(!bulkStatusOpen); setBulkAssignOpen(false); }} className="text-sm text-foreground hover:text-primary transition-colors">Change Status</button>
          {bulkStatusOpen && (
            <div className="absolute top-full mt-1 left-0 w-44 bg-card border border-border rounded-lg shadow-lg p-1 z-50">
              {options.statusList.map(s => (
                <button key={s} onClick={() => options.onStatusChange!(s)} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors">{s}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <button onClick={() => setBulkDeleteOpen(true)} className="text-sm text-red-500 hover:text-red-400 transition-colors">Delete</button>
      {tab === "Leads" && (
        <>
          <TooltipProvider><Tooltip><TooltipTrigger asChild><button disabled className="text-sm text-muted-foreground cursor-not-allowed opacity-50">SMS Blast</button></TooltipTrigger><TooltipContent>Coming soon — configure SMS in Settings</TooltipContent></Tooltip></TooltipProvider>
          <TooltipProvider><Tooltip><TooltipTrigger asChild><button disabled className="text-sm text-muted-foreground cursor-not-allowed opacity-50">Email Blast</button></TooltipTrigger><TooltipContent>Coming soon — configure Email in Settings</TooltipContent></Tooltip></TooltipProvider>
        </>
      )}
      <div className="flex-1" />
      <button onClick={onDeselect} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Deselect All</button>
    </div>
  );

  // Action menu for rows
  const renderActionMenu = (id: string, onEdit: () => void, onDelete: () => void) => (
    <div className="relative" ref={actionMenuId === id ? actionMenuRef : undefined}>
      <button onClick={(e) => { e.stopPropagation(); setActionMenuId(actionMenuId === id ? null : id); }} className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button>
      {actionMenuId === id && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-card border border-border rounded-lg shadow-lg p-1 z-50">
          <button onClick={(e) => { e.stopPropagation(); setActionMenuId(null); onEdit(); }} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md flex items-center gap-2"><Pencil className="w-3.5 h-3.5" />Edit</button>
          <button onClick={(e) => { e.stopPropagation(); setActionMenuId(null); onDelete(); }} className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-accent rounded-md flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" />Delete</button>
        </div>
      )}
    </div>
  );

  // Determine filter options per tab
  const filterStatuses = tab === "Leads" ? allStatuses : tab === "Recruits" ? recruitStatuses : [];

  // Which add modal contact type
  const addContactType = tab === "Clients" ? "Client" : tab === "Recruits" ? "Recruit" : "Lead";
  const handleAddContact = tab === "Clients" ? handleAddClient : tab === "Recruits" ? handleAddRecruit : handleAddLead;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Contacts</h1>

      {/* Tabs */}
      <div className="flex border-b">
        {tabs.map(t => (
          <button key={t} onClick={() => { setTab(t); setSearchQuery(""); setStatusFilter(""); setSourceFilter(""); setSelectedIds(new Set()); setSelectedClientIds(new Set()); setSelectedRecruitIds(new Set()); setSelectedAgentIds(new Set()); }}
            className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"} `}>{t}</button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={`Search ${tab.toLowerCase()}...`} className="w-full h-9 pl-9 pr-4 rounded-lg bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 border border-border" />
        </div>
        {(tab === "Leads" || tab === "Recruits") && (
          <div className="flex bg-muted rounded-lg p-0.5 border border-border">
            <button onClick={() => setView("table")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"} `}><List className="w-4 h-4" /></button>
            <button onClick={() => setView("kanban")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"} `}><LayoutGrid className="w-4 h-4" /></button>
          </div>
        )}
        {/* Columns toggle — shown for all tabs in table view */}
        {view === "table" && (
          tab === "Leads" ? renderColumnsDropdown(ALL_COLUMNS, visibleCols as Set<string>, (s) => setVisibleCols(s as Set<ColumnKey>), DEFAULT_VISIBLE as Set<string>) :
            tab === "Clients" ? renderColumnsDropdown(CLIENT_COLUMNS, visibleClientCols as Set<string>, (s) => setVisibleClientCols(s as Set<ClientColumnKey>), DEFAULT_CLIENT_VISIBLE as Set<string>) :
              tab === "Recruits" ? renderColumnsDropdown(RECRUIT_COLUMNS, visibleRecruitCols as Set<string>, (s) => setVisibleRecruitCols(s as Set<RecruitColumnKey>), DEFAULT_RECRUIT_VISIBLE as Set<string>) :
                renderColumnsDropdown(AGENT_COLUMNS, visibleAgentCols as Set<string>, (s) => setVisibleAgentCols(s as Set<AgentColumnKey>), DEFAULT_AGENT_VISIBLE as Set<string>)
        )}
        {/* Filter */}
        {(tab === "Leads" || tab === "Recruits") && (
          <div className="relative">
            <button onClick={() => setFilterOpen(!filterOpen)} className="h-9 px-3 rounded-lg bg-muted text-foreground text-sm flex items-center gap-2 hover:bg-accent sidebar-transition border border-border"><Filter className="w-4 h-4" />Filter</button>
            {filterOpen && (
              <div className="absolute top-full mt-1 left-0 w-56 bg-card border rounded-lg shadow-lg p-3 z-50 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full h-8 px-2 rounded-lg bg-muted text-sm border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none text-foreground">
                    <option value="">All</option>
                    {filterStatuses.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                {tab === "Leads" && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Source</label>
                    <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="w-full h-8 px-2 rounded-lg bg-muted text-sm border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none text-foreground">
                      <option value="">All</option>
                      {["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                <button onClick={() => { setStatusFilter(""); setSourceFilter(""); setFilterOpen(false); }} className="text-xs text-primary hover:underline">Clear Filters</button>
              </div>
            )}
          </div>
        )}
        <div className="flex-1" />
        {tab === "Leads" && <button onClick={() => setImportModalOpen(true)} className="h-9 px-3 rounded-lg bg-muted text-foreground text-sm flex items-center gap-2 hover:bg-accent sidebar-transition border border-border"><Upload className="w-4 h-4" />Import CSV</button>}
        {tab !== "Agents" && <button onClick={() => setAddModalOpen(true)} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Plus className="w-4 h-4" />Add {addContactType}</button>}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
      )}

      {/* ===== LEADS TAB - Table View ===== */}
      {!loading && tab === "Leads" && view === "table" && (
        <>
          {/* Source Performance */}
          <div className="bg-card rounded-xl border border-border">
            <button onClick={() => setSourcePerfOpen(prev => !prev)} className="w-full flex items-center justify-between px-4 py-3 text-left">
              <h3 className="text-sm font-semibold text-foreground">Lead Source Performance</h3>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${sourcePerfOpen ? "rotate-180" : ""} `} />
            </button>
            <div className="overflow-hidden transition-all duration-200 ease-in-out" style={{ maxHeight: sourcePerfOpen ? "500px" : "0px", opacity: sourcePerfOpen ? 1 : 0 }}>
              <div className="px-4 pb-4">
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
            </div>
          </div>

          {/* Bulk Actions */}
          {selectedIds.size > 0 && renderBulkActions(
            selectedIds.size,
            () => setSelectedIds(new Set()),
            { showAssign: true, showStatus: true, statusList: allStatuses, onStatusChange: (s) => handleBulkStatusChange(s as LeadStatus), onDelete: handleBulkDeleteLeads }
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
                <table className="min-w-full text-sm table-fixed">
                  <thead><tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="py-3 px-3" style={{ width: 40, minWidth: 40 }}>
                      <input type="checkbox" checked={isAllSelected} ref={el => { if (el) el.indeterminate = isIndeterminate; }} onChange={toggleAll} className="rounded" />
                    </th>
                    {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => renderSortHeader(col.key, col.label))}
                    <th className="py-3" style={{ width: 40, minWidth: 40 }}></th>
                  </tr></thead>
                  <tbody>
                    {sortedLeads.map(l => {
                      const aging = calcAging(l.lastContactedAt);
                      return (
                        <tr key={l.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedIds.has(l.id) ? "bg-primary/5" : ""} `} onClick={() => setSelectedLead(l)}>
                          <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleSelect(l.id); }}><input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => { }} className="rounded" /></td>
                          {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => (
                            <td key={col.key} className={`py-3 ${colAlign(col.key)} `}>{renderCell(l, col.key, aging)}</td>
                          ))}
                          <td className="py-3" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                            {renderActionMenu(l.id, () => setEditLead(l), () => handleDeleteLead(l.id))}
                          </td>
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
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status]} `}>{status}</span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                {items.map(l => (
                  <div key={l.id} className="bg-card rounded-lg border p-3 cursor-pointer hover:shadow-md sidebar-transition" onClick={() => setSelectedLead(l)}>
                    <p className="text-sm font-medium text-foreground">{l.firstName} {l.lastName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{l.state}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${l.leadScore >= 8 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"} `}>{l.leadScore}</span>
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

      {/* ===== CLIENTS TAB ===== */}
      {!loading && tab === "Clients" && (
        <>
          {selectedClientIds.size > 0 && renderBulkActions(
            selectedClientIds.size,
            () => setSelectedClientIds(new Set()),
            { showAssign: true, onDelete: handleBulkDeleteClients }
          )}
          <div className="bg-card rounded-xl border overflow-hidden">
            {clients.length === 0 ? (
              <div className="text-center py-12">
                <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold text-foreground mb-1">No clients yet</h3>
                <p className="text-sm text-muted-foreground mb-4">Convert leads to clients after policy sales, or add one manually.</p>
                <button onClick={() => setAddModalOpen(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Add Client</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm table-fixed">
                  <thead><tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="py-3 px-3" style={{ width: 40, minWidth: 40 }}>
                      <input type="checkbox" checked={selectedClientIds.size === clients.length && clients.length > 0} ref={el => { if (el) el.indeterminate = selectedClientIds.size > 0 && selectedClientIds.size < clients.length; }} onChange={toggleAllClients} className="rounded" />
                    </th>
                    {CLIENT_COLUMNS.filter(c => visibleClientCols.has(c.key)).map(col => renderSortHeader(col.key, col.label))}
                    <th className="py-3" style={{ width: 40, minWidth: 40 }}></th>
                  </tr></thead>
                  <tbody>
                    {sortedClients.map(c => (
                      <tr key={c.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedClientIds.has(c.id) ? "bg-primary/5" : ""} `} onClick={() => setSelectedClient(c)}>
                        <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleClientSelect(c.id); }}><input type="checkbox" checked={selectedClientIds.has(c.id)} onChange={() => { }} className="rounded" /></td>
                        {CLIENT_COLUMNS.filter(col => visibleClientCols.has(col.key)).map(col => (
                          <td key={col.key} className={`py-3 ${colAlign(col.key)} `}>{renderClientCell(c, col.key)}</td>
                        ))}
                        <td className="py-3" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                          {renderActionMenu(c.id, () => setEditClient(c), () => handleDeleteClient(c.id))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== RECRUITS TAB ===== */}
      {!loading && tab === "Recruits" && (
        <>
          {selectedRecruitIds.size > 0 && view === "table" && renderBulkActions(
            selectedRecruitIds.size,
            () => setSelectedRecruitIds(new Set()),
            { showAssign: true, showStatus: true, statusList: recruitStatuses, onStatusChange: handleBulkRecruitStatusChange, onDelete: handleBulkDeleteRecruits }
          )}
          <div className="bg-card rounded-xl border overflow-hidden">
            {recruits.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold text-foreground mb-1">No recruits yet</h3>
                <p className="text-sm text-muted-foreground mb-4">Start building your recruit pipeline.</p>
                <button onClick={() => setAddModalOpen(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Add Recruit</button>
              </div>
            ) : view === "table" ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm table-fixed">
                  <thead><tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="py-3 px-3" style={{ width: 40, minWidth: 40 }}>
                      <input type="checkbox" checked={selectedRecruitIds.size === recruits.length && recruits.length > 0} ref={el => { if (el) el.indeterminate = selectedRecruitIds.size > 0 && selectedRecruitIds.size < recruits.length; }} onChange={toggleAllRecruits} className="rounded" />
                    </th>
                    {RECRUIT_COLUMNS.filter(c => visibleRecruitCols.has(c.key)).map(col => renderSortHeader(col.key, col.label))}
                    <th className="py-3" style={{ width: 40, minWidth: 40 }}></th>
                  </tr></thead>
                  <tbody>
                    {sortedRecruits.map(r => (
                      <tr key={r.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedRecruitIds.has(r.id) ? "bg-primary/5" : ""} `} onClick={() => setSelectedRecruit(r)}>
                        <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleRecruitSelect(r.id); }}><input type="checkbox" checked={selectedRecruitIds.has(r.id)} onChange={() => { }} className="rounded" /></td>
                        {RECRUIT_COLUMNS.filter(col => visibleRecruitCols.has(col.key)).map(col => (
                          <td key={col.key} className={`py-3 ${colAlign(col.key)}`} style={{ width: columnWidths[tab]?.[col.key], minWidth: columnWidths[tab]?.[col.key] }}>{renderRecruitCell(r, col.key)}</td>
                        ))}
                        <td className="py-3" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                          {renderActionMenu(r.id, () => setEditRecruit(r), () => handleDeleteRecruit(r.id))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-4 p-3">
                {recruitStatuses.map(s => {
                  const items = recruits.filter(r => r.status === s);
                  return (
                    <div key={s} className="min-w-[220px] bg-accent/50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${recruitStatusColors[s] || "bg-muted text-muted-foreground"} `}>{s}</span>
                        <span className="text-xs text-muted-foreground">{items.length}</span>
                      </div>
                      {items.map(r => (
                        <div key={r.id} className="bg-card rounded-lg border p-3 cursor-pointer hover:shadow-md sidebar-transition" onClick={() => setSelectedRecruit(r)}>
                          <p className="text-sm font-medium text-foreground">{r.firstName} {r.lastName}</p>
                          <p className="text-xs text-muted-foreground">{r.email}</p>
                          <p className="text-xs text-muted-foreground mt-1">{getAgentName(r.assignedAgentId)}</p>
                        </div>
                      ))}
                      <button onClick={() => setAddModalOpen(true)} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent sidebar-transition">+ Add</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== AGENTS TAB ===== */}
      {!loading && tab === "Agents" && (
        <>
          {selectedAgentIds.size > 0 && renderBulkActions(
            selectedAgentIds.size,
            () => setSelectedAgentIds(new Set()),
            { showStatus: true, statusList: ["Active", "Inactive"], onStatusChange: handleBulkAgentStatusChange, onDelete: () => toast.error("Cannot delete agents from this view") }
          )}
          <div className="bg-card rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <thead><tr className="text-muted-foreground border-b bg-accent/50">
                  <th className="py-3 px-3" style={{ width: 40, minWidth: 40 }}>
                    <input type="checkbox" checked={selectedAgentIds.size === mockUsers.length && mockUsers.length > 0} ref={el => { if (el) el.indeterminate = selectedAgentIds.size > 0 && selectedAgentIds.size < mockUsers.length; }} onChange={toggleAllAgents} className="rounded" />
                  </th>
                  {AGENT_COLUMNS.filter(c => visibleAgentCols.has(c.key)).map(col => renderSortHeader(col.key, col.label))}
                  <th className="py-3" style={{ width: 40, minWidth: 40 }}></th>
                </tr></thead>
                <tbody>
                  {sortedAgents.map(u => (
                    <tr key={u.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedAgentIds.has(u.id) ? "bg-primary/5" : ""} `} onClick={() => setSelectedAgent(u)}>
                      <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleAgentSelect(u.id); }}><input type="checkbox" checked={selectedAgentIds.has(u.id)} onChange={() => { }} className="rounded" /></td>
                      {AGENT_COLUMNS.filter(col => visibleAgentCols.has(col.key)).map(col => (
                        <td key={col.key} className={`py-3 ${col.key === "name" ? "px-4" : ""} ${colAlign(col.key)} `}>{renderAgentCell(u, col.key)}</td>
                      ))}
                      <td className="py-3" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                        <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Import History (below leads table) */}
      {tab === "Leads" && (
        <div className="bg-card rounded-xl border">
          <button
            onClick={() => setImportHistoryOpen(!importHistoryOpen)}
            className="w-full flex items-center justify-between p-4 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors duration-150 rounded-xl"
          >
            <div className="flex items-center gap-2">
              Import History
              {importHistory.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded-full">{importHistory.length}</span>
              )}
            </div>
            {importHistoryOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {importHistoryOpen && (
            <div className="px-4 pb-4">
              {importHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No imports yet. Upload your first CSV to get started.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 font-medium">Date</th>
                        <th className="text-left py-2 font-medium">File Name</th>
                        <th className="text-right py-2 font-medium">Total</th>
                        <th className="text-right py-2 font-medium">Imported</th>
                        <th className="text-right py-2 font-medium">Duplicates</th>
                        <th className="text-right py-2 font-medium">Errors</th>
                        <th className="text-right py-2 font-medium">Undo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importHistory.map(h => {
                        const hoursSince = (Date.now() - new Date(h.date).getTime()) / (1000 * 60 * 60);
                        const canUndo = hoursSince < 24;
                        return (
                          <tr key={h.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors duration-150">
                            <td className="py-2 text-foreground">{new Date(h.date).toLocaleDateString()} {new Date(h.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                            <td className="py-2 text-foreground">{h.fileName}</td>
                            <td className="py-2 text-right text-foreground">{h.totalRecords}</td>
                            <td className="py-2 text-right text-green-500">{h.imported}</td>
                            <td className="py-2 text-right text-yellow-500">{h.duplicates}</td>
                            <td className="py-2 text-right text-destructive">{h.errors}</td>
                            <td className="py-2 text-right">
                              <button
                                disabled={!canUndo}
                                onClick={() => setUndoConfirm(h)}
                                className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
                                title={canUndo ? "Undo this import" : "Can only undo within 24 hours"}
                              >
                                <Undo2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <AddContactModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddContact} contactType={addContactType} />
      <AddContactModal open={!!editLead} onClose={() => setEditLead(null)} onSave={async (d) => { if (editLead) { await handleUpdateLead(editLead.id, d); setEditLead(null); } }} initial={editLead} contactType="Lead" />
      <AddContactModal open={!!editClient} onClose={() => setEditClient(null)} onSave={async (d) => { if (editClient) { await clientsSupabaseApi.update(editClient.id, d); setEditClient(null); toast.success("Client updated"); fetchData(); } }} initial={editClient} contactType="Client" />
      <AddContactModal open={!!editRecruit} onClose={() => setEditRecruit(null)} onSave={async (d) => { if (editRecruit) { await recruitsSupabaseApi.update(editRecruit.id, d); setEditRecruit(null); toast.success("Recruit updated"); fetchData(); } }} initial={editRecruit} contactType="Recruit" />
      <ContactModal lead={selectedLead} onClose={() => setSelectedLead(null)} onUpdate={handleUpdateLead} onDelete={handleDeleteLead} />
      <ClientModal client={selectedClient} onClose={() => setSelectedClient(null)} onUpdate={async (id, data) => { await clientsSupabaseApi.update(id, data); toast.success("Client updated"); fetchData(); }} onDelete={handleDeleteClient} />
      <RecruitModal recruit={selectedRecruit} onClose={() => setSelectedRecruit(null)} onUpdate={async (id, data) => { await recruitsSupabaseApi.update(id, data); toast.success("Recruit updated"); fetchData(); }} onDelete={handleDeleteRecruit} />
      <AgentModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      <DeleteConfirmModal open={deleteConfirmOpen} count={selectedIds.size} onConfirm={handleBulkDeleteLeads} onClose={() => setDeleteConfirmOpen(false)} />
      <DeleteConfirmModal
        open={bulkDeleteOpen}
        count={tab === "Leads" ? selectedIds.size : tab === "Clients" ? selectedClientIds.size : selectedRecruitIds.size}
        title={`Delete ${tab === "Leads" ? selectedIds.size : tab === "Clients" ? selectedClientIds.size : selectedRecruitIds.size} ${tab}?`}
        onConfirm={tab === "Leads" ? handleBulkDeleteLeads : tab === "Clients" ? handleBulkDeleteClients : handleBulkDeleteRecruits}
        onClose={() => setBulkDeleteOpen(false)}
      />

      {/* Import Modal */}
      <ImportLeadsModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        existingLeads={leads}
        campaigns={mockCampaigns.map(c => ({ id: c.id, name: c.name, type: c.type, status: c.status }))}
        onImportComplete={async (newLeads, historyEntry) => {
          await importLeadsToSupabase(newLeads);
          setImportHistory(prev => [historyEntry, ...prev]);
          fetchData();
        }}
      />

      {/* Undo Confirmation */}
      {undoConfirm && (
        <DeleteConfirmModal
          open={true}
          count={undoConfirm.imported}
          title={`Remove ${undoConfirm.imported} leads imported from ${undoConfirm.fileName}?`}
          onConfirm={async () => {
            for (const id of undoConfirm.importedLeadIds) {
              await leadsSupabaseApi.delete(id);
            }
            setImportHistory(prev => prev.filter(h => h.id !== undoConfirm.id));
            toast.success(`${undoConfirm.imported} leads removed`, { duration: 3000, position: "bottom-right" });
            setUndoConfirm(null);
            fetchData();
          }}
          onClose={() => setUndoConfirm(null)}
        />
      )}
    </div>
  );
};

export default Contacts;
