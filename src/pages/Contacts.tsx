import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import {
  Search, Filter, LayoutGrid, List, Upload, Plus, MoreHorizontal,
  Phone, Eye, Pencil, Trash2, X, ShieldCheck, Calendar, Mail, Users,
  Loader2, ChevronDown, ChevronUp, AlertTriangle, Columns3, Lock,
  ArrowUp, ArrowDown, ArrowUpDown, Undo2, Megaphone, Download, UserPlus,
  GraduationCap, CheckCircle2, ArrowRight, Clipboard
} from "lucide-react";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { importLeadsToSupabase } from "@/lib/supabase-leads";
import { supabase } from "@/integrations/supabase/client";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { Lead, Client, Recruit, LeadStatus, ContactNote, ContactActivity, User, UserProfile } from "@/lib/types";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";

type UserWithProfile = User & { profile: UserProfile };
import type { Json } from "@/integrations/supabase/types";
import { calcAging, getAgentName, getAgentInitials } from "@/lib/data-helpers";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import AgentModal from "@/components/contacts/AgentModal";
import ImportLeadsModal, { type ImportHistoryEntry } from "@/components/contacts/ImportLeadsModal";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AddToCampaignModal from "@/components/contacts/AddToCampaignModal";
import { useBranding } from "@/contexts/BrandingContext";

// Fallback status colors (used if pipeline stages haven't loaded)
const fallbackStatusColors: Record<string, string> = {
  "New": "#3B82F6",
  "Contacted": "#A855F7",
  "Interested": "#EAB308",
  "Follow Up": "#14B8A6",
  "Hot": "#F97316",
  "Not Interested": "#EF4444",
  "Closed Won": "#22C55E",
  "Closed Lost": "#EF4444",
};

const fallbackRecruitColors: Record<string, string> = {
  "Prospect": "#6B7280",
  "Contacted": "#A855F7",
  "Interview": "#EAB308",
  "Licensed": "#3B82F6",
  "Active": "#22C55E",
};

const policyTypeColors: Record<string, string> = {
  "Term": "bg-primary/10 text-primary",
  "Whole Life": "bg-success/10 text-success",
  "IUL": "bg-info/10 text-info",
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



// ---- CopyField ----
const CopyField: React.FC<{ value?: string | number | null }> = ({ value }) => {
  if (!value && value !== 0) return <span className="text-muted-foreground">—</span>;
  const display = String(value);
  return (
    <div className="flex items-center justify-between group w-full">
      <span className="text-foreground font-medium">{display}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(display); toast.success("Copied to clipboard"); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
      >
        <Clipboard className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ---- Add/Edit Contact Modal ----
const AddContactModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<Lead & Client & Recruit>) => Promise<void>;
  initial?: Partial<Lead & Client & Recruit> | null;
  contactType?: string;
}> = ({ open, onClose, onSave, initial, contactType = "Lead" }) => {
  const [form, setForm] = useState<Partial<Lead & Client & Recruit>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (contactType === "Client") {
      if (initial) setForm({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email, policyType: initial.policyType || "Term", carrier: initial.carrier || "", premiumAmount: initial.premiumAmount || "", faceAmount: initial.faceAmount || "", issueDate: initial.issueDate || "" });
      else setForm({ firstName: "", lastName: "", phone: "", email: "", policyType: "Term", carrier: "", premiumAmount: "", faceAmount: "", issueDate: "" });
    } else if (contactType === "Recruit") {
      if (initial) setForm({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email, status: initial.status as unknown as "New" | "Contacted" | "Interested" | "Follow Up" | "Hot" | "Not Interested" | "Closed Won" | "Closed Lost" });
      else setForm({ firstName: "", lastName: "", phone: "", email: "", status: "Prospect" as unknown as "New" | "Contacted" | "Interested" | "Follow Up" | "Hot" | "Not Interested" | "Closed Won" | "Closed Lost" });
    } else {
      if (initial) setForm({ firstName: initial.firstName, lastName: initial.lastName, phone: initial.phone, email: initial.email, state: initial.state, leadSource: initial.leadSource, status: initial.status || "New", age: initial.age as any || "", dateOfBirth: initial.dateOfBirth || "", healthStatus: initial.healthStatus || "", bestTimeToCall: initial.bestTimeToCall || "", notes: initial.notes || "" });
      else setForm({ firstName: "", lastName: "", phone: "", email: "", state: "", leadSource: "Facebook Ads", status: "New", age: "" as any, dateOfBirth: "", healthStatus: "", bestTimeToCall: "", notes: "" });
    }
  }, [initial, open, contactType]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        <style dangerouslySetInnerHTML={{ __html: `::-webkit-scrollbar { display: none; }` }} />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{initial ? "Edit" : "Add New"} {contactType}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">First Name *</label>
              <input required value={form.firstName || ""} onChange={e => setForm((f) => ({ ...f, firstName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Last Name *</label>
              <input required value={form.lastName || ""} onChange={e => setForm((f) => ({ ...f, lastName: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Phone *</label>
            <input required value={form.phone || ""} onChange={e => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="(555) 123-4567" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Email *</label>
            <input required type="email" value={form.email || ""} onChange={e => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>

          {/* Lead-specific fields */}
          {contactType === "Lead" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">State</label>
                  <input value={form.state || ""} onChange={e => setForm((f) => ({ ...f, state: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="FL" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Lead Source</label>
                  <select value={form.leadSource || "Facebook Ads"} onChange={e => setForm((f) => ({ ...f, leadSource: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                    {["Facebook Ads", "Google Ads", "Direct Mail", "Referral", "Webinar"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Additional Lead Info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Date of Birth</label>
                  <input type="date" value={form.dateOfBirth || ""} onChange={e => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Age</label>
                  <input type="number" value={form.age || ""} onChange={e => setForm((f) => ({ ...f, age: e.target.value ? parseInt(e.target.value) : undefined }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="e.g. 45" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Health Status</label>
                  <select value={form.healthStatus || ""} onChange={e => setForm((f) => ({ ...f, healthStatus: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                    <option value="">Select...</option>
                    {["Excellent", "Good", "Fair", "Poor"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Best Time to Call</label>
                  <select value={form.bestTimeToCall || ""} onChange={e => setForm((f) => ({ ...f, bestTimeToCall: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                    <option value="">Select...</option>
                    {["Morning", "Afternoon", "Evening", "Anytime"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Initial Notes</label>
                <textarea value={form.notes || ""} onChange={e => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full h-20 px-3 py-2 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none" placeholder="Add any background context..." />
              </div>
            </>
          )}

          {/* Client-specific fields */}
          {contactType === "Client" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Policy Type *</label>
                  <select required value={form.policyType || "Term"} onChange={e => setForm((f) => ({ ...f, policyType: e.target.value as "Term" | "Whole Life" | "IUL" | "Final Expense" }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
                    {["Term", "Whole Life", "IUL", "Final Expense"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Carrier *</label>
                  <input required value={form.carrier || ""} onChange={e => setForm((f) => ({ ...f, carrier: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Premium</label>
                  <input value={form.premiumAmount || ""} onChange={e => setForm((f) => ({ ...f, premiumAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$150/mo" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Face Amount</label>
                  <input value={form.faceAmount || ""} onChange={e => setForm((f) => ({ ...f, faceAmount: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" placeholder="$500,000" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Issue Date</label>
                <input type="date" value={form.issueDate || ""} onChange={e => setForm((f) => ({ ...f, issueDate: e.target.value }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none" />
              </div>
            </>
          )}

          {/* Recruit-specific fields */}
          {contactType === "Recruit" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <select value={form.status || "Prospect"} onChange={e => setForm((f) => ({ ...f, status: e.target.value as unknown as "New" | "Contacted" | "Interested" | "Follow Up" | "Hot" | "Not Interested" | "Closed Won" | "Closed Lost" }))} className="w-full h-9 px-3 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none">
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
  const { organizationId } = useOrganization();
  const { formatDate, formatDateTime } = useBranding();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as "Leads" | "Clients" | "Recruits" | "Agents") || "Leads";
  const setTab = (newTab: "Leads" | "Clients" | "Recruits" | "Agents") => {
    setSearchParams({ tab: newTab });
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");

  const [view, setView] = useState<"table" | "kanban">("table");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [agents, setAgents] = useState<UserWithProfile[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [realCampaigns, setRealCampaigns] = useState<{ id: string; name: string; type: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [leadData, clientData, recruitData, agentData, stats] = await Promise.all([
        leadsSupabaseApi.getAll({ search: searchQuery, status: statusFilter, source: sourceFilter }).catch(e => { console.error("Error fetching leads:", e); return []; }),
        clientsSupabaseApi.getAll(searchQuery).catch(e => { console.error("Error fetching clients:", e); return []; }),
        recruitsSupabaseApi.getAll(searchQuery).catch(e => { console.error("Error fetching recruits:", e); return []; }),
        usersApi.getAll({ search: searchQuery }).catch(e => { console.error("Error fetching agents:", e); return []; }),
        leadsSupabaseApi.getSourceStats().catch(e => { console.error("Error fetching lead stats:", e); return []; }),
      ]);
      setLeads(leadData);
      setClients(clientData);
      setRecruits(recruitData);
      setAgents(agentData);
      setSourceStats(stats);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, sourceFilter, user?.id]);

  const [leadStageColors, setLeadStageColors] = useState<Record<string, string>>({});
  const [recruitStageColors, setRecruitStageColors] = useState<Record<string, string>>({});


  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [selectedRecruitIds, setSelectedRecruitIds] = useState<Set<string>>(new Set());
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedRecruit, setSelectedRecruit] = useState<Recruit | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<UserWithProfile | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editRecruit, setEditRecruit] = useState<Recruit | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sourceStats, setSourceStats] = useState<{ source: string; leads: number; contacted: string; conversion: string; sold: number }[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>([]);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState<ImportHistoryEntry | null>(null);
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);

  // Column visibility per tab
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(new Set(DEFAULT_VISIBLE));
  const [visibleClientCols, setVisibleClientCols] = useState<Set<ClientColumnKey>>(new Set(DEFAULT_CLIENT_VISIBLE));
  const [visibleRecruitCols, setVisibleRecruitCols] = useState<Set<RecruitColumnKey>>(new Set(DEFAULT_RECRUIT_VISIBLE));
  const [visibleAgentCols, setVisibleAgentCols] = useState<Set<AgentColumnKey>>(new Set(DEFAULT_AGENT_VISIBLE));
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  // Column Resizing State — persisted to Supabase user_preferences
  const [columnWidths, setColumnWidths] = useState<Record<string, Record<string, number>>>({});
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizingColRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load column widths from Supabase
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("user_preferences")
      .select("preference_value")
      .eq("user_id", user.id)
      .eq("preference_key", "contactColumnWidths")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.preference_value && typeof data.preference_value === "object") {
          setColumnWidths(data.preference_value as Record<string, Record<string, number>>);
        }
      });
  }, [user?.id]);

  // Save column widths to Supabase (debounced)
  const saveColumnWidths = useCallback((w: Record<string, Record<string, number>>) => {
    if (!user?.id) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      supabase.from("user_preferences").upsert({
        user_id: user.id,
        preference_key: "contactColumnWidths",
        preference_value: w as unknown as Json,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,preference_key" });
    }, 500);
  }, [user?.id]);

  // Load visible columns from Supabase
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("user_preferences")
      .select("preference_value")
      .eq("user_id", user.id)
      .eq("preference_key", "contactVisibleCols")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.preference_value && typeof data.preference_value === "object") {
          const v = data.preference_value as Record<string, string[]>;
          if (v.leads) setVisibleCols(new Set(v.leads as ColumnKey[]));
          if (v.clients) setVisibleClientCols(new Set(v.clients as ClientColumnKey[]));
          if (v.recruits) setVisibleRecruitCols(new Set(v.recruits as RecruitColumnKey[]));
          if (v.agents) setVisibleAgentCols(new Set(v.agents as AgentColumnKey[]));
        }
      });
  }, [user?.id]);

  // Save visible columns to Supabase
  const saveVisibleCols = useCallback(async (leadsCols: Set<ColumnKey>, clientsCols: Set<ClientColumnKey>, recruitsCols: Set<RecruitColumnKey>, agentsCols: Set<AgentColumnKey>) => {
    if (!user?.id) return;
    const payload = {
      user_id: user.id,
      preference_key: "contactVisibleCols",
      preference_value: {
        leads: Array.from(leadsCols),
        clients: Array.from(clientsCols),
        recruits: Array.from(recruitsCols),
        agents: Array.from(agentsCols),
      } as unknown as Json,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("user_preferences").upsert(payload, { onConflict: "user_id,preference_key" });
    if (error) {
      console.error("Failed to save column preferences:", error);
    } else {
      console.log("Column preferences saved successfully");
    }
  }, [user?.id]);

  // Sorting — shared across tabs, reset on tab change
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const sortPrefsLoaded = useRef(false);

  // Load sort preferences from Supabase on mount
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("user_preferences")
      .select("preference_value")
      .eq("user_id", user.id)
      .eq("preference_key", "contactSortPrefs")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.preference_value && typeof data.preference_value === "object") {
          const v = data.preference_value as { sortCol?: string | null; sortDir?: "asc" | "desc" };
          if (v.sortCol !== undefined) setSortCol(v.sortCol);
          if (v.sortDir !== undefined) setSortDir(v.sortDir);
        }
        sortPrefsLoaded.current = true;
      });
  }, [user?.id]);

  // Save sort preferences to Supabase whenever they change (skip initial render)
  useEffect(() => {
    if (!sortPrefsLoaded.current) return;
    if (!user?.id) return;
    supabase.from("user_preferences").upsert({
      user_id: user.id,
      preference_key: "contactSortPrefs",
      preference_value: { sortCol, sortDir } as unknown as Json,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,preference_key" });
  }, [sortCol, sortDir, user?.id]);

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
        // Persist to Supabase
        setColumnWidths(prev => { saveColumnWidths(prev); return prev; });
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
      case "agent": return getAgentName(l.assignedAgentId, agentProfiles).toLowerCase();
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
      case "agent": return getAgentName(c.assignedAgentId, agentProfiles).toLowerCase();
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
      case "agent": return getAgentName(r.assignedAgentId, agentProfiles).toLowerCase();
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
  const getAgentSortValue = (u: UserWithProfile, key: AgentColumnKey): string | number => {
    const p = u.profile;
    switch (key) {
      case "name": return `${u.firstName} ${u.lastName}`.toLowerCase();
      case "email": return u.email.toLowerCase();
      case "licensedStates": return p?.licensedStates?.map((s: any) => typeof s === "string" ? s : s.state).join(", ") || "";
      case "commission": return p?.commissionLevel || "";
      case "role": return u.role;
      case "status": return u.status;
      default: return "";
    }
  };

  const sortedAgents = React.useMemo(() => {
    if (!sortCol) return agents;
    return [...agents].sort((a, b) => {
      const va = getAgentSortValue(a, sortCol as AgentColumnKey);
      const vb = getAgentSortValue(b, sortCol as AgentColumnKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [agents, sortCol, sortDir]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false);
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) setActionMenuId(null);
    };
    if (columnsOpen || actionMenuId) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [columnsOpen, actionMenuId]);




  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch pipeline stage colors and names from settings
  useEffect(() => {
    pipelineSupabaseApi.getLeadStages().then(stages => {
      if (stages.length > 0) {
        const map: Record<string, string> = {};
        stages.forEach(s => { map[s.name] = s.color; });
        setLeadStageColors(map);
      }
    });
    pipelineSupabaseApi.getRecruitStages().then(stages => {
      if (stages.length > 0) {
        const map: Record<string, string> = {};
        stages.forEach(s => { map[s.name] = s.color; });
        setRecruitStageColors(map);
      }
    });
    // Fetch agent profiles for display
    supabase.from("profiles").select("id, first_name, last_name, status").eq("status", "Active").then(({ data }) => {
      if (data) setAgentProfiles(data.map((p: any) => ({ id: p.id, firstName: p.first_name || "", lastName: p.last_name || "" }))); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    // Fetch campaigns for import modal
    supabase.from("campaigns").select("id, name, type, status").then(({ data }) => {
      if (data) setRealCampaigns(data);
    });
  }, []);

  const getLeadStatusColor = (status: string) => leadStageColors[status] || fallbackStatusColors[status] || "#6B7280";
  const getRecruitStatusColor = (status: string) => recruitStageColors[status] || fallbackRecruitColors[status] || "#6B7280";

  const fetchImportHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from("import_history")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setImportHistory(data.map((row: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: row.id,
        fileName: row.file_name,
        date: row.created_at,
        totalRecords: row.total_records,
        imported: row.imported,
        duplicates: row.duplicates,
        errors: row.errors,
        importedLeadIds: (row.imported_lead_ids as string[]) || [],
      })));
    }
  }, []);

  useEffect(() => { fetchImportHistory(); }, [fetchImportHistory]);

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
    const state = location.state as Record<string, unknown> | null;
    const openContactId = state?.openContactId;
    if (openContactId && typeof openContactId === "string" && leads.length > 0) {
      const match = leads.find(l => l.id === openContactId);
      if (match) {
        setSelectedLead(match);
      }
    }
  }, [location.state, leads]);

  useEffect(() => {
    const contactId = new URLSearchParams(location.search).get("contact");
    if (!contactId) return;

    // Check leads
    if (leads.length > 0) {
      const match = leads.find(l => l.id === contactId);
      if (match) {
        setSelectedLead(match);
        return;
      }
    }

    // Check clients
    if (clients.length > 0) {
      const match = clients.find(c => c.id === contactId);
      if (match) {
        setSelectedClient(match);
        return;
      }
    }

    // Check recruits
    if (recruits.length > 0) {
      const match = recruits.find(r => r.id === contactId);
      if (match) {
        setSelectedRecruit(match);
        return;
      }
    }

    // Check agents/users
    if (agents.length > 0) {
      const match = agents.find(u => u.id === contactId);
      if (match) {
        setSelectedAgent(match);
        return;
      }
    }
  }, [location.search, leads, clients, recruits, agents]);

  // ===== Lead CRUD =====
  const handleAddLead = async (data: Partial<Lead>) => {
    await leadsSupabaseApi.create({ ...data, leadScore: 5, assignedAgentId: user?.id || "u1" } as unknown as Omit<Lead, "id" | "createdAt" | "updatedAt">, organizationId);
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
  const handleAddClient = async (data: Partial<Client>) => {
    await clientsSupabaseApi.create({ ...data, assignedAgentId: user?.id || "u1" } as unknown as Omit<Client, "id" | "createdAt" | "updatedAt">);
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
  const handleAddRecruit = async (data: Partial<Recruit>) => {
    await recruitsSupabaseApi.create({ ...data, assignedAgentId: user?.id || "u1" } as unknown as Omit<Recruit, "id" | "createdAt" | "updatedAt">);
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
  const toggleSelect = (id: string) => setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelectedIds(prev => prev.size === leads.length ? new Set() : new Set(leads.map(l => l.id)));
  const toggleClientSelect = (id: string) => setSelectedClientIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAllClients = () => setSelectedClientIds(prev => prev.size === clients.length ? new Set() : new Set(clients.map(c => c.id)));
  const toggleRecruitSelect = (id: string) => setSelectedRecruitIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAllRecruits = () => setSelectedRecruitIds(prev => prev.size === recruits.length ? new Set() : new Set(recruits.map(r => r.id)));
  const toggleAgentSelect = (id: string) => setSelectedAgentIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAllAgents = () => setSelectedAgentIds(prev => prev.size === agents.length ? new Set() : new Set(agents.map(u => u.id)));

  const isAllSelected = selectedIds.size === leads.length && leads.length > 0;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < leads.length;

  const tabs = ["Leads", "Clients", "Recruits", "Agents"] as const;

  const isColVisible = (key: ColumnKey) => visibleCols.has(key);

  // Render cell value for a lead
  const renderCell = (l: Lead, key: ColumnKey, aging: number) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground">{l.firstName} {l.lastName}</span>;
      case "phone": return <span className="text-primary font-bold text-sm tracking-tight">{l.phone}</span>;
      case "email": return <span className="text-muted-foreground">{l.email}</span>;
      case "state": return <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{l.state}</span>;
      case "status": return (
        <div className="relative group/status inline-block">
          <select
            value={l.status}
            onChange={(e) => {
              e.stopPropagation();
              handleUpdateLead(l.id, { status: e.target.value as LeadStatus });
              toast.success(`Status changed to ${e.target.value}`);
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2 py-0.5 rounded-full font-medium appearance-none cursor-pointer border-none outline-none pr-5"
            style={getStatusColorStyle(getLeadStatusColor(l.status))}
          >
            {(Object.keys(leadStageColors).length > 0 ? Object.keys(leadStageColors) : allStatuses).map(s => <option key={s} value={s} style={{ color: 'inherit', backgroundColor: 'var(--background)' }}>{s}</option>)}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover/status:opacity-60 transition-opacity" />
        </div>
      );
      case "source": return <span className="text-muted-foreground">{l.leadSource}</span>;
      case "score": {
        const sc = l.leadScore;
        return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sc >= 8 ? "bg-success/10 text-success" : sc >= 5 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}`}>{sc}</span>;
      }
      case "aging": {
        const pill = agingPill(aging);
        return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pill.cls}`}>{pill.label}</span>;
      }
      case "agent": return <span className="text-foreground">{getAgentName(l.assignedAgentId, agentProfiles)}</span>;
      case "dob": return <span className="text-muted-foreground text-xs">{l.dateOfBirth || "—"}</span>;
      case "health": return <span className="text-muted-foreground text-xs">{l.healthStatus || "—"}</span>;
      case "bestTime": return <span className="text-muted-foreground text-xs">{l.bestTimeToCall || "—"}</span>;
      case "leadSourceAlias": return <span className="text-muted-foreground">{l.leadSource}</span>;
      case "createdDate": return <span className="text-muted-foreground text-xs">{formatDate(l.createdAt)}</span>;
      case "lastContacted": return <span className="text-muted-foreground text-xs">{l.lastContactedAt ? formatDate(l.lastContactedAt) : "Never"}</span>;
      default: return null;
    }
  };

  const renderClientCell = (c: Client, key: ClientColumnKey) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground">{c.firstName} {c.lastName}</span>;
      case "phone": return <span className="text-primary font-bold text-sm tracking-tight">{c.phone}</span>;
      case "policyType": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${policyTypeColors[c.policyType] || "bg-muted text-muted-foreground"}`}>{c.policyType}</span>;
      case "carrier": return <span className="text-muted-foreground">{c.carrier}</span>;
      case "premium": return <span className="text-foreground">{c.premiumAmount}</span>;
      case "faceAmount": return <span className="text-foreground">{c.faceAmount}</span>;
      case "issueDate": return <span className="text-muted-foreground">{formatDate(c.issueDate)}</span>;
      case "agent": return <span className="text-foreground">{getAgentName(c.assignedAgentId, agentProfiles)}</span>;
      default: return null;
    }
  };

  const renderRecruitCell = (r: Recruit, key: RecruitColumnKey) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground">{r.firstName} {r.lastName}</span>;
      case "phone": return <span className="text-primary font-bold text-sm tracking-tight">{r.phone}</span>;
      case "email": return <span className="text-muted-foreground">{r.email}</span>;
      case "status": return (
        <div className="relative group/status inline-block">
          <select
            value={r.status}
            onChange={(e) => {
              e.stopPropagation();
              recruitsSupabaseApi.update(r.id, { status: e.target.value }).then(() => {
                toast.success(`Status changed to ${e.target.value}`);
                fetchData();
              });
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2 py-0.5 rounded-full font-medium appearance-none cursor-pointer border-none outline-none pr-5"
            style={getStatusColorStyle(getRecruitStatusColor(r.status))}
          >
            {(Object.keys(recruitStageColors).length > 0 ? Object.keys(recruitStageColors) : recruitStatuses).map(s => <option key={s} value={s} style={{ color: 'inherit', backgroundColor: 'var(--background)' }}>{s}</option>)}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover/status:opacity-60 transition-opacity" />
        </div>
      );
      case "agent": return <span className="text-foreground">{getAgentName(r.assignedAgentId, agentProfiles)}</span>;
      default: return null;
    }
  };

  const renderAgentCell = (u: UserWithProfile, key: AgentColumnKey) => {
    const p = u.profile;
    const availColors: Record<string, string> = { Available: "bg-success", "On Break": "bg-warning", "Do Not Disturb": "bg-destructive", Offline: "bg-muted-foreground/50" };
    switch (key) {
      case "name": return (
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{u.firstName[0]}{u.lastName[0]}</div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${availColors[u.availabilityStatus || "Offline"]}`} />
          </div>
          <span className="font-medium text-foreground truncate">{u.firstName} {u.lastName}</span>
        </div>
      );
      case "email": return <span className="text-muted-foreground">{u.email}</span>;
      case "licensedStates": return <span className="text-muted-foreground">{p?.licensedStates?.map((s: any) => typeof s === 'string' ? s : s.state).join(", ")}</span>;
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

  // Pending column visibility state for the dropdown (so changes only apply on Save)
  const [pendingVisible, setPendingVisible] = useState<Set<string> | null>(null);

  // Generic columns toggle dropdown
  const renderColumnsDropdown = (columns: { key: string; label: string; locked?: boolean; defaultVisible: boolean }[], visible: Set<string>, setVisible: (s: Set<string>) => void, defaults: Set<string>) => {
    const displaySet = pendingVisible ?? visible;
    return (
    <div className="relative" ref={columnsRef}>
      <button onClick={() => { setColumnsOpen(!columnsOpen); setPendingVisible(columnsOpen ? null : new Set(visible)); }} className="h-9 px-3 rounded-md bg-background border border-border text-foreground text-sm flex items-center gap-2 hover:bg-muted transition-colors duration-150">
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
                  checked={displaySet.has(col.key)}
                  disabled={col.locked}
                  onChange={() => {
                    if (col.locked) return;
                    const next = new Set(displaySet);
                    if (next.has(col.key)) next.delete(col.key); else next.add(col.key);
                    setPendingVisible(next);
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
          <div className="flex items-center justify-between mt-3">
            <button onClick={() => {
              setVisible(new Set(defaults));
              setPendingVisible(null);
              setColumnsOpen(false);
              saveVisibleCols(
                tab === "Leads" ? defaults as unknown as Set<ColumnKey> : visibleCols,
                tab === "Clients" ? defaults as unknown as Set<ClientColumnKey> : visibleClientCols,
                tab === "Recruits" ? defaults as unknown as Set<RecruitColumnKey> : visibleRecruitCols,
                tab === "Agents" ? defaults as unknown as Set<AgentColumnKey> : visibleAgentCols,
              );
            }} className="text-xs text-primary hover:underline">Reset to default</button>
            <button onClick={() => {
              if (pendingVisible) {
                setVisible(pendingVisible);
                // Build the save payload using the pending value for the current tab
                const newLeads = tab === "Leads" ? pendingVisible as unknown as Set<ColumnKey> : visibleCols;
                const newClients = tab === "Clients" ? pendingVisible as unknown as Set<ClientColumnKey> : visibleClientCols;
                const newRecruits = tab === "Recruits" ? pendingVisible as unknown as Set<RecruitColumnKey> : visibleRecruitCols;
                const newAgents = tab === "Agents" ? pendingVisible as unknown as Set<AgentColumnKey> : visibleAgentCols;
                saveVisibleCols(newLeads, newClients, newRecruits, newAgents);
              }
              setPendingVisible(null);
              setColumnsOpen(false);
            }} className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">Save</button>
          </div>
        </div>
      )}
    </div>
    );
  };

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
              {agentProfiles.map(a => (
                <button key={a.id} onClick={() => handleBulkAssign(`${a.firstName} ${a.lastName}`)} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors">{a.firstName} {a.lastName}</button>
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
      <button onClick={() => setAddToCampaignOpen(true)} className="text-sm text-foreground hover:text-primary flex items-center gap-1.5 transition-colors">
        <Megaphone className="w-3.5 h-3.5" />
        Add to Campaign
      </button>
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
          <button onClick={(e) => { e.stopPropagation(); setActionMenuId(null); onEdit(); }} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md flex items-center gap-2 transition-colors"><Pencil className="w-3.5 h-3.5" />Edit</button>
          {tab === "Leads" && (
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                setActionMenuId(null); 
                const lead = leads.find(l => l.id === id);
                if (lead) setSelectedLead(lead);
                // The actual conversion flow is triggered via the Convert button in ContactModal
              }} 
              className="w-full text-left px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/10 rounded-md flex items-center gap-2 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />Convert
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); setActionMenuId(null); onDelete(); }} className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-accent rounded-md flex items-center gap-2 transition-colors"><Trash2 className="w-3.5 h-3.5" />Delete</button>
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
    <div className="flex flex-col h-full w-full overflow-hidden">
      <h1 className="text-2xl font-bold text-foreground">Contacts</h1>

      {/* Tabs */}
      <div className="flex items-center border-b">
        {tabs.map(t => (
          <button key={t} onClick={() => { setTab(t); setSearchQuery(""); setStatusFilter(""); setSourceFilter(""); setSelectedIds(new Set()); setSelectedClientIds(new Set()); setSelectedRecruitIds(new Set()); setSelectedAgentIds(new Set()); }}
            className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"} `}>{t}</button>
        ))}
        <div className="w-px h-5 bg-border mx-1 self-center" />
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
          {(Object.keys(leadStageColors).length > 0 ? Object.keys(leadStageColors) : allStatuses).map(status => {
            const items = leads.filter(l => l.status === status);
            return (
              <div key={status} className="min-w-[250px] bg-accent/50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={getStatusColorStyle(getLeadStatusColor(status))}>{status}</span>
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
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{getAgentInitials(l.assignedAgentId, agentProfiles)}</div>
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
                {(Object.keys(recruitStageColors).length > 0 ? Object.keys(recruitStageColors) : recruitStatuses).map(s => {
                  const items = recruits.filter(r => r.status === s);
                  return (
                    <div key={s} className="min-w-[220px] bg-accent/50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={getStatusColorStyle(getRecruitStatusColor(s))}>{s}</span>
                        <span className="text-xs text-muted-foreground">{items.length}</span>
                      </div>
                      {items.map(r => (
                        <div key={r.id} className="bg-card rounded-lg border p-3 cursor-pointer hover:shadow-md sidebar-transition" onClick={() => setSelectedRecruit(r)}>
                          <p className="text-sm font-medium text-foreground">{r.firstName} {r.lastName}</p>
                          <p className="text-xs text-muted-foreground">{r.email}</p>
                          <p className="text-xs text-muted-foreground mt-1">{getAgentName(r.assignedAgentId, agentProfiles)}</p>
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
        <div className="flex gap-4 items-start">
          <div className="flex-1 flex flex-col gap-4 min-w-0">
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
                      <input type="checkbox" checked={selectedAgentIds.size === agents.length && agents.length > 0} ref={el => { if (el) el.indeterminate = selectedAgentIds.size > 0 && selectedAgentIds.size < agents.length; }} onChange={toggleAllAgents} className="rounded" />
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
          </div>

          {/* Import History panel */}
          <div className="w-80 shrink-0 bg-card rounded-xl border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Upload className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Import History</h3>
            </div>
            <div className="overflow-y-auto max-h-96">
              {importHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No imports yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {importHistory.map(h => {
                    const dateObj = new Date(h.date);
                    const msSince = Date.now() - dateObj.getTime();
                    const hoursSince = msSince / (1000 * 60 * 60);
                    const canUndo = hoursSince < 24;
                    const formattedTime = formatDateTime(dateObj);
                    return (
                      <div key={h.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{h.fileName}</span>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  disabled={!canUndo}
                                  onClick={() => setUndoConfirm(h)}
                                  className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 shrink-0"
                                >
                                  <Undo2 className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{canUndo ? "Undo this import" : "Undo is only available within 24 hours of import"}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{formattedTime}</p>
                        <div className="flex flex-wrap gap-2 mt-1 text-xs">
                          <span className="text-foreground">{h.totalRecords} total</span>
                          <span className="text-success">{h.imported} imported</span>
                          <span className="text-warning">{h.duplicates} dupes</span>
                          <span className="text-destructive">{h.errors} errors</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <AddContactModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddContact} contactType={addContactType} />
      <AddContactModal open={!!editLead} onClose={() => setEditLead(null)} onSave={async (d) => { if (editLead) { await handleUpdateLead(editLead.id, d); setEditLead(null); } }} initial={editLead} contactType="Lead" />
      <AddContactModal open={!!editClient} onClose={() => setEditClient(null)} onSave={async (d) => { if (editClient) { await clientsSupabaseApi.update(editClient.id, d); setEditClient(null); toast.success("Client updated"); fetchData(); } }} initial={editClient} contactType="Client" />
      <AddContactModal open={!!editRecruit} onClose={() => setEditRecruit(null)} onSave={async (d) => { if (editRecruit) { await recruitsSupabaseApi.update(editRecruit.id, d); setEditRecruit(null); toast.success("Recruit updated"); fetchData(); } }} initial={editRecruit as any} contactType="Recruit" />
      {selectedLead && (
        <FullScreenContactView 
          contact={selectedLead} 
          type="lead" 
          onClose={() => setSelectedLead(null)} 
          onUpdate={handleUpdateLead} 
          onDelete={handleDeleteLead} 
          onConvert={() => { fetchData(); setSelectedLead(null); }} 
        />
      )}
      {selectedClient && (
        <FullScreenContactView 
          contact={selectedClient} 
          type="client" 
          onClose={() => setSelectedClient(null)} 
          onUpdate={async (id, data) => { 
            await clientsSupabaseApi.update(id, data); 
            fetchData(); 
          }} 
          onDelete={handleDeleteClient} 
        />
      )}
      {selectedRecruit && (
        <FullScreenContactView 
          contact={selectedRecruit} 
          type="recruit" 
          onClose={() => setSelectedRecruit(null)} 
          onUpdate={async (id, data) => { 
            await recruitsSupabaseApi.update(id, data); 
            fetchData(); 
          }} 
          onDelete={handleDeleteRecruit} 
        />
      )}
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
        campaigns={realCampaigns}
        currentUserId={user?.id}
        agentProfiles={agentProfiles}
        onCampaignCreated={async (campaign) => {
          const { error } = await supabase.from("campaigns").insert({
            id: campaign.id,
            name: campaign.name,
            type: campaign.type,
            description: campaign.description,
            status: "Active",
            organization_id: organizationId,
            created_by: user?.id,
          });
          if (error) {
            toast.error("Failed to create campaign during import");
          } else {
            // Refresh campaigns list
            const { data } = await supabase.from("campaigns").select("id, name, type, status");
            if (data) setRealCampaigns(data);
          }
        }}
        onImportComplete={async (newLeads, historyEntry, strategy) => {
          const result = await importLeadsToSupabase(newLeads, organizationId, strategy as any);
          // Insert import history row into Supabase
          await supabase.from("import_history").insert({
            file_name: historyEntry.fileName,
            total_records: historyEntry.totalRecords,
            imported: result.imported,
            duplicates: historyEntry.duplicates + result.duplicates,
            errors: historyEntry.errors + result.errors,
            agent_id: user?.id || null,
            imported_lead_ids: result.importedLeadIds,
            organization_id: organizationId,
          } as any);
          await fetchImportHistory();
          fetchData();
        }}
      />

      {/* Undo Confirmation */}
      {undoConfirm && (
        <DeleteConfirmModal
          open={true}
          count={undoConfirm.imported}
          title={`This will delete all ${undoConfirm.imported} leads that were imported from this file. This cannot be undone.`}
          onConfirm={async () => {
            // Delete leads whose IDs are in importedLeadIds
            if (undoConfirm.importedLeadIds.length > 0) {
              const { error: leadsError } = await supabase
                .from("leads")
                .delete()
                .in("id", undoConfirm.importedLeadIds);
              if (leadsError) {
                console.error("Error deleting imported leads:", leadsError);
                toast.error("Failed to undo import", { duration: 3000, position: "bottom-right" });
                setUndoConfirm(null);
                return;
              }
            }
            // Delete the import_history row
            await supabase.from("import_history").delete().eq("id", undoConfirm.id);
            toast.success(`Import undone — ${undoConfirm.imported} leads removed`, { duration: 3000, position: "bottom-right" });
            setUndoConfirm(null);
            await fetchImportHistory();
            fetchData();
          }}
          onClose={() => setUndoConfirm(null)}
        />
      )}

      {/* Add to Campaign Modal */}
      <AddToCampaignModal
        open={addToCampaignOpen}
        onClose={() => setAddToCampaignOpen(false)}
        selectedContacts={(() => {
          if (tab === "Leads") {
            return leads.filter(l => selectedIds.has(l.id)).map(l => ({
              id: l.id,
              firstName: l.firstName,
              lastName: l.lastName,
              phone: l.phone,
              email: l.email,
              state: l.state,
              age: l.age
            }));
          } else if (tab === "Clients") {
            return clients.filter(c => selectedClientIds.has(c.id)).map(c => ({
              id: c.id,
              firstName: c.firstName,
              lastName: c.lastName,
              phone: c.phone,
              email: c.email,
              state: "", // Clients might not have state in the interface, default to empty
              age: undefined
            }));
          } else if (tab === "Recruits") {
            return recruits.filter(r => selectedRecruitIds.has(r.id)).map(r => ({
              id: r.id,
              firstName: r.firstName,
              lastName: r.lastName,
              phone: r.phone,
              email: r.email,
              state: "",
              age: undefined
            }));
          }
          return [];
        })()}
        onSuccess={() => {
          setSelectedIds(new Set());
          setSelectedClientIds(new Set());
          setSelectedRecruitIds(new Set());
        }}
      />
    </div>
  );
};

export default Contacts;
