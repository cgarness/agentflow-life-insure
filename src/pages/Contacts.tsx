import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import {
  Search, Filter, LayoutGrid, List, Upload, Plus, MoreHorizontal,
  Phone, Eye, Pencil, Trash2, X, ShieldCheck, Calendar as CalendarIcon, Mail, Users,
  Loader2, ChevronDown, ChevronUp, AlertTriangle, Columns3, Lock,
  ArrowUp, ArrowDown, ArrowUpDown, Undo2, Megaphone, Download, UserPlus,
  GraduationCap, CheckCircle2, ArrowRight, Clipboard
} from "lucide-react";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { leadSourcesSupabaseApi, healthStatusesSupabaseApi } from "@/lib/supabase-settings";
import { importLeadsToSupabase } from "@/lib/supabase-leads";
import { supabase } from "@/integrations/supabase/client";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { Lead, Client, Recruit, LeadStatus, ContactNote, ContactActivity, User, UserProfile } from "@/lib/types";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";

type UserWithProfile = User & { profile: UserProfile };
import type { Json } from "@/integrations/supabase/types";
import { calcAging, getAgentName, getAgentInitials } from "@/lib/data-helpers";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import AddLeadModal from "@/components/contacts/AddLeadModal";
import AddClientModal from "@/components/contacts/AddClientModal";
import AddRecruitModal from "@/components/contacts/AddRecruitModal";
import AgentModal from "@/components/contacts/AgentModal";
import ImportLeadsModal, { type ImportHistoryEntry } from "@/components/contacts/ImportLeadsModal";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AddToCampaignModal from "@/components/contacts/AddToCampaignModal";
import { useBranding } from "@/contexts/BrandingContext";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { formatStateToAbbreviation } from "@/utils/stateUtils";
import { isCallableNow, TIMEZONE_GROUPS, STATE_TIMEZONES } from "@/utils/timezoneUtils";
import { StateSelector } from "@/components/shared/StateSelector";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { format as formatBtnDate } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import ContactsFilterModal, { type ContactsFilterValues, type ContactsTab, type DownlineAgent } from "@/components/contacts/ContactsFilterModal";

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
  "Appointment Set": "#9333EA",
  "APPPINTMENT SET": "#9333EA",
};

const normalizeStatusDisplay = (status: string) => {
  if (!status) return "";
  return status.replace(/AP+PINTMENT/i, "Appointment");
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
type ClientColumnKey = "name" | "phone" | "email" | "state" | "policyType" | "carrier" | "premium" | "faceAmount" | "issueDate" | "agent";
interface ClientColDef { key: ClientColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
const CLIENT_COLUMNS: ClientColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "state", label: "State", defaultVisible: true },
  { key: "policyType", label: "Policy Type", defaultVisible: true },
  { key: "carrier", label: "Carrier", defaultVisible: true },
  { key: "premium", label: "Premium", defaultVisible: true },
  { key: "faceAmount", label: "Face Amount", defaultVisible: true },
  { key: "issueDate", label: "Issue Date", defaultVisible: true },
  { key: "agent", label: "Agent", defaultVisible: true },
];
const DEFAULT_CLIENT_VISIBLE = new Set(CLIENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.key));

// ===== RECRUIT Column definitions =====
type RecruitColumnKey = "name" | "phone" | "email" | "state" | "status" | "agent";
interface RecruitColDef { key: RecruitColumnKey; label: string; defaultVisible: boolean; locked?: boolean; }
const RECRUIT_COLUMNS: RecruitColDef[] = [
  { key: "name", label: "Name", defaultVisible: true, locked: true },
  { key: "phone", label: "Phone", defaultVisible: true },
  { key: "email", label: "Email", defaultVisible: true },
  { key: "state", label: "State", defaultVisible: true },
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

// Starter layout for new users (Rank 4 QA Requirement)
const STARTER_LAYOUT: Record<string, Record<string, number>> = {
  Leads: { name: 200, phone: 150, email: 200, status: 120, state: 80, source: 150, score: 80, aging: 80, agent: 150 },
  Clients: { name: 200, phone: 150, email: 200, state: 80, policyType: 120, carrier: 150, premium: 100, faceAmount: 120, issueDate: 120, agent: 150 },
  Recruits: { name: 200, phone: 150, email: 200, state: 80, status: 120, agent: 150 },
  Agents: { name: 200, email: 220, licensedStates: 180, commission: 120, role: 120, status: 100 },
};



// ---- CopyField ----
const CopyField: React.FC<{ value?: string | number | null }> = ({ value }) => {
  if (!value && value !== 0) return <span className="text-muted-foreground">—</span>;
  const display = String(value);
  return (
    <div className="flex items-center justify-between group w-full overflow-hidden">
      <span className="text-foreground font-medium truncate flex-1">{display}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(display); toast.success("Copied to clipboard"); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
      >
        <Clipboard className="w-3.5 h-3.5" />
      </button>
    </div>
  );;
};

// ---- Delete Confirm ----
const DeleteConfirmModal: React.FC<{ open: boolean; count: number; onConfirm: () => void; onClose: () => void; title?: string }> = ({ open, count, onConfirm, onClose, title }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
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
  const tab = (searchParams.get("tab") as "Leads" | "Clients" | "Recruits" | "Agents" | "Import History") || "Leads";
  const setTab = (newTab: "Leads" | "Clients" | "Recruits" | "Agents" | "Import History") => {
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set("tab", newTab); p.delete("contact"); p.delete("contactType"); return p; });
    // Explicitly reset contact view state when switching tabs
    setSelectedLead(null);
    setSelectedClient(null);
    setSelectedRecruit(null);
    setSelectedAgent(null);
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [timezoneFilters, setTimezoneFilters] = useState<string[]>([]);
  const [callableNowFilter, setCallableNowFilter] = useState(false);
  const [attemptCountFilters, setAttemptCountFilters] = useState<string[]>([]);
  const [lastDispositionFilter, setLastDispositionFilter] = useState<string>("");
  const [policyTypeFilter, setPolicyTypeFilter] = useState<string>("");
  const [downlineAgentIds, setDownlineAgentIds] = useState<string[]>([]);
  const [downlineAgents, setDownlineAgents] = useState<DownlineAgent[]>([]);

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
      // Only pass assignedAgentIds when the user has explicitly selected specific
      // downline agents. When the array is empty, omit the filter entirely so that
      // RLS hierarchical policies (Team Leader, Admin) return ALL accessible records.
      // FORCE filter for current user if they are an Agent to comply with visibility fix.
      let agentIdFilter = downlineAgentIds.length > 0 ? downlineAgentIds : undefined;
      
      if (!agentIdFilter && user?.role === "Agent" && user?.id) {
        agentIdFilter = [user.id];
      }

      const leadFilters = {
        search: searchQuery,
        status: statusFilter,
        source: sourceFilter,
        state: stateFilter,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        timezones: timezoneFilters,
        callableNow: callableNowFilter,
        attemptCounts: attemptCountFilters,
        lastDisposition: lastDispositionFilter,
        assignedAgentIds: agentIdFilter,
      };

      const clientFilters = {
        search: searchQuery,
        state: stateFilter,
        policyType: policyTypeFilter,
        assignedAgentIds: agentIdFilter,
      };

      const recruitFilters = {
        search: searchQuery,
        state: stateFilter,
        assignedAgentIds: agentIdFilter,
      };

      const [leadData, clientData, recruitData, agentData, stats] = await Promise.all([
        leadsSupabaseApi.getAll(leadFilters).catch(e => { console.error("Error fetching leads:", e); return []; }),
        clientsSupabaseApi.getAll(clientFilters).catch(e => { console.error("Error fetching clients:", e); return []; }),
        recruitsSupabaseApi.getAll(recruitFilters).catch(e => { console.error("Error fetching recruits:", e); return []; }),
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
  }, [searchQuery, statusFilter, sourceFilter, stateFilter, startDate, endDate, timezoneFilters, callableNowFilter, attemptCountFilters, lastDispositionFilter, policyTypeFilter, downlineAgentIds]);

  const [leadStageColors, setLeadStageColors] = useState<Record<string, string>>({});
  const [recruitStageColors, setRecruitStageColors] = useState<Record<string, string>>({});

  // Fetch downline agents for the current user
  useEffect(() => {
    if (!user?.id) return;
    usersApi.getDownlineAgents(user.id).then(setDownlineAgents).catch(console.error);
  }, [user?.id]);


  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [selectedRecruitIds, setSelectedRecruitIds] = useState<Set<string>>(new Set());
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedRecruit, setSelectedRecruit] = useState<Recruit | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<UserWithProfile | null>(null);
  // Track a pending contactId from the URL that hasn't been resolved yet (data still loading)
  const pendingContactId = useRef<string | null>(null);

  // Helper: open a contact and persist its ID in the URL
  const openContact = useCallback((type: "lead" | "client" | "recruit" | "agent", entity: Lead | Client | Recruit | UserWithProfile) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set("contact", entity.id);
      p.set("contactType", type);
      // Also set the tab so refresh lands on the right tab
      if (type === "lead") p.set("tab", "Leads");
      else if (type === "client") p.set("tab", "Clients");
      else if (type === "recruit") p.set("tab", "Recruits");
      else if (type === "agent") p.set("tab", "Agents");
      return p;
    });
    if (type === "lead") setSelectedLead(entity as Lead);
    else if (type === "client") setSelectedClient(entity as Client);
    else if (type === "recruit") setSelectedRecruit(entity as Recruit);
    else if (type === "agent") setSelectedAgent(entity as UserWithProfile);
  }, [setSearchParams]);

  // Helper: close a contact and remove the contact params from the URL
  const closeContact = useCallback(() => {
    setSelectedLead(null);
    setSelectedClient(null);
    setSelectedRecruit(null);
    setSelectedAgent(null);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.delete("contact");
      p.delete("contactType");
      return p;
    });
  }, [setSearchParams]);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editRecruit, setEditRecruit] = useState<Recruit | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sourceStats, setSourceStats] = useState<{ source: string; leads: number; contacted: string; conversion: string; sold: number }[]>([]);
  const [allLeadSources, setAllLeadSources] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>([]);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState<ImportHistoryEntry | null>(null);
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);

  // Column visibility per tab with localStorage persistence (Power Dialer Requirement)
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(() => {
    const saved = localStorage.getItem("contacts_visible_cols_leads");
    return saved ? new Set(JSON.parse(saved)) : new Set(DEFAULT_VISIBLE);
  });
  const [visibleClientCols, setVisibleClientCols] = useState<Set<ClientColumnKey>>(() => {
    const saved = localStorage.getItem("contacts_visible_cols_clients");
    return saved ? new Set(JSON.parse(saved)) : new Set(DEFAULT_CLIENT_VISIBLE);
  });
  const [visibleRecruitCols, setVisibleRecruitCols] = useState<Set<RecruitColumnKey>>(() => {
    const saved = localStorage.getItem("contacts_visible_cols_recruits");
    return saved ? new Set(JSON.parse(saved)) : new Set(DEFAULT_RECRUIT_VISIBLE);
  });
  const [visibleAgentCols, setVisibleAgentCols] = useState<Set<AgentColumnKey>>(() => {
    const saved = localStorage.getItem("contacts_visible_cols_agents");
    return saved ? new Set(JSON.parse(saved)) : new Set(DEFAULT_AGENT_VISIBLE);
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  // Unified Preference Persistence (Rank 4 QA - Persisted Layout)
  const [columnWidths, setColumnWidths] = useState<Record<string, Record<string, number>>>(STARTER_LAYOUT);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const sortPrefsLoaded = useRef(false);
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizingColRef = useRef<string | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load ALL user settings from the new hardened table
  useEffect(() => {
    if (!user?.id) return;
    
    const loadSettings = async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("settings")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to load user preferences:", error);
        return;
      }

      if ((data as any)?.settings) {
        const s = (data as any).settings as any;
        if (s.columnWidths) setColumnWidths(s.columnWidths);
        if (s.visibleCols) {
          if (s.visibleCols.leads) setVisibleCols(new Set(s.visibleCols.leads));
          if (s.visibleCols.clients) setVisibleClientCols(new Set(s.visibleCols.clients));
          if (s.visibleCols.recruits) setVisibleRecruitCols(new Set(s.visibleCols.recruits));
          if (s.visibleCols.agents) setVisibleAgentCols(new Set(s.visibleCols.agents));
        }
        if (s.sortPrefs) {
          if (s.sortPrefs.sortCol) setSortCol(s.sortPrefs.sortCol);
          if (s.sortPrefs.sortDir) setSortDir(s.sortPrefs.sortDir);
        }
        sortPrefsLoaded.current = true;
      }
    };

    loadSettings();
  }, [user?.id]);

  // Unified Save Mechanism with 2-second Debounce
  const persistSettings = useCallback((updates: Partial<{
    columnWidths: Record<string, Record<string, number>>;
    visibleCols: any;
    sortPrefs: { sortCol: string | null; sortDir: "asc" | "desc" };
  }>) => {
    if (!user?.id) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    
    saveTimerRef.current = setTimeout(async () => {
      // Fetch current to merge
      const { data } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      const currentSettings = (data as any)?.settings || {};
      const newSettings = {
        ...currentSettings,
        ...updates
      };

      await supabase.from("user_preferences").upsert({
        user_id: user.id,
        settings: newSettings as any,
      } as any, { onConflict: "user_id" });
      
      console.log("Settings persisted successfully.");
    }, 2000); // 2000ms as requested
  }, [user?.id]);

  // Wrappers for state updates that trigger persistence
  const updateColumnWidths = (widths: Record<string, Record<string, number>>) => {
    setColumnWidths(widths);
    persistSettings({ columnWidths: widths });
  };

  const updateVisibleCols = (leads: Set<ColumnKey>, clients: Set<ClientColumnKey>, recruits: Set<RecruitColumnKey>, agents: Set<AgentColumnKey>) => {
    const visible = {
      leads: Array.from(leads),
      clients: Array.from(clients),
      recruits: Array.from(recruits),
      agents: Array.from(agents)
    };
    persistSettings({ visibleCols: visible });
  };

  const updateSortPrefs = (col: string | null, dir: "asc" | "desc") => {
    persistSettings({ sortPrefs: { sortCol: col, sortDir: dir } });
  };

  // Sync sort changes
  useEffect(() => {
    if (!sortPrefsLoaded.current) return;
    updateSortPrefs(sortCol, sortDir);
  }, [sortCol, sortDir]);

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
        // Persist to Supabase
        setColumnWidths(prev => { persistSettings({ columnWidths: prev }); return prev; });
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
      case "email": return c.email;
      case "state": return c.state;
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
      case "state": return r.state || "";
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
    let filtered = agents;
    // Apply state filter for Agents tab (filters on licensed_states or resident_state)
    if (stateFilter) {
      filtered = filtered.filter(a => {
        const licensed = a.profile?.licensedStates;
        const resident = a.profile?.residentState;
        if (Array.isArray(licensed) && licensed.some((ls: any) => (typeof ls === "string" ? ls : ls?.state) === stateFilter)) return true;
        if (resident === stateFilter) return true;
        return false;
      });
    }
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const va = getAgentSortValue(a, sortCol as AgentColumnKey);
      const vb = getAgentSortValue(b, sortCol as AgentColumnKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [agents, sortCol, sortDir, stateFilter]);

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

    // Fetch dynamic settings for filters
    leadSourcesSupabaseApi.getAll().then(sources => {
      if (sources.length > 0) setAllLeadSources(sources.map(s => s.name));
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
      if (match) openContact("lead", match);
    }
  }, [location.state, leads]);

  // Sync contact view state with URL parameters (handles initial load and browser back button)
  useEffect(() => {
    const contactId = searchParams.get("contact");
    if (!contactId) {
      // If contact param is missing, clear all selected contact states to unmount the detail view
      setSelectedLead(null);
      setSelectedClient(null);
      setSelectedRecruit(null);
      setSelectedAgent(null);
      pendingContactId.current = null;
      return;
    }
    pendingContactId.current = contactId;
  }, [searchParams]);

  useEffect(() => {
    const contactId = pendingContactId.current;
    if (!contactId) return;

    // Check leads
    if (leads.length > 0) {
      const match = leads.find(l => l.id === contactId);
      if (match) { setSelectedLead(match); pendingContactId.current = null; return; }
    }

    // Check clients
    if (clients.length > 0) {
      const match = clients.find(c => c.id === contactId);
      if (match) { setSelectedClient(match); pendingContactId.current = null; return; }
    }

    // Check recruits
    if (recruits.length > 0) {
      const match = recruits.find(r => r.id === contactId);
      if (match) { setSelectedRecruit(match); pendingContactId.current = null; return; }
    }

    // Check agents/users
    if (agents.length > 0) {
      const match = agents.find(u => u.id === contactId);
      if (match) { setSelectedAgent(match); pendingContactId.current = null; return; }
    }
  }, [leads, clients, recruits, agents]);

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
    closeContact();
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
      case "name": return <span className="font-medium text-foreground truncate block">{l.firstName} {l.lastName}</span>;
      case "phone": return <span className="text-foreground font-mono text-sm truncate block">{formatPhoneNumber(l.phone)}</span>;
      case "email": return <span className="text-muted-foreground truncate block">{l.email}</span>;
      case "state": return <span className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full font-semibold border border-blue-500/20 uppercase tracking-tighter shrink-0">{formatStateToAbbreviation(l.state)}</span>;
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
            {Object.keys(leadStageColors).map(s => <option key={s} value={s} style={{ color: 'inherit', backgroundColor: 'var(--background)' }}>{normalizeStatusDisplay(s)}</option>)}
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
      case "agent": {
        const name = getAgentName(l.assignedAgentId, agentProfiles);
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">{name}</span>;
      }
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
      case "name": return <span className="font-medium text-foreground truncate block">{c.firstName} {c.lastName}</span>;
      case "phone": return <span className="text-foreground font-mono text-sm truncate block">{formatPhoneNumber(c.phone)}</span>;
      case "email": return <span className="text-muted-foreground truncate block">{c.email}</span>;
      case "state": return <span className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full font-semibold border border-blue-500/20 uppercase tracking-tighter shrink-0">{formatStateToAbbreviation(c.state)}</span>;
      case "policyType": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${policyTypeColors[c.policyType] || "bg-muted text-muted-foreground"}`}>{c.policyType}</span>;
      case "carrier": return <span className="text-muted-foreground truncate block">{c.carrier}</span>;
      case "premium": return <span className="text-foreground">{c.premiumAmount}</span>;
      case "faceAmount": return <span className="text-foreground">{c.faceAmount}</span>;
      case "issueDate": return <span className="text-muted-foreground">{formatDate(c.issueDate)}</span>;
      case "agent": {
        const name = getAgentName(c.assignedAgentId, agentProfiles);
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">{name}</span>;
      }
      default: return null;
    }
  };

  const renderRecruitCell = (r: Recruit, key: RecruitColumnKey) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground truncate block">{r.firstName} {r.lastName}</span>;
      case "phone": return <span className="text-foreground font-mono text-sm truncate block">{formatPhoneNumber(r.phone)}</span>;
      case "email": return <span className="text-muted-foreground truncate block">{r.email}</span>;
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
            {Object.keys(recruitStageColors).map(s => <option key={s} value={s} style={{ color: 'inherit', backgroundColor: 'var(--background)' }}>{normalizeStatusDisplay(s)}</option>)}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover/status:opacity-60 transition-opacity" />
        </div>
      );
      case "agent": {
        const name = getAgentName(r.assignedAgentId, agentProfiles);
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">{name}</span>;
      }
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
      case "email": return <span className="text-muted-foreground truncate block">{u.email}</span>;
      case "licensedStates": {
        const states = p?.licensedStates?.map((s: any) => typeof s === 'string' ? s : s.state) || [];
        return (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {states.map((s: string) => (
              <span key={s} className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold border border-blue-500/20 uppercase tracking-tighter shrink-0">{s}</span>
            ))}
            {states.length === 0 && <span className="text-muted-foreground">—</span>}
          </div>
        );
      }
      case "commission": return <span className="text-foreground truncate block">{p?.commissionLevel}</span>;
      case "role": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${u.role === "Admin" ? "bg-primary/10 text-primary" : u.role === "Team Leader" ? "bg-info/10 text-info" : "bg-success/10 text-success"}`}>{u.role}</span>;
      case "status": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${u.status === "Active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{u.status}</span>;
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
        className={`${colAlign(key)} py-3 px-3 font-medium select-none cursor-pointer hover:text-foreground transition-colors group relative bg-transparent`}
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
          className={`absolute right-[-5px] top-0 bottom-0 w-[10px] cursor-col-resize hover:bg-primary/30 z-[10] ${isResizing ? "bg-primary w-[2px] right-0" : "bg-transparent"} transition-all`}
          onMouseDown={(e) => handleResizeStart(e, key)}
          onClick={(e) => e.stopPropagation()}
        />
      </th>
    );
  };

  // Pending column visibility state for the dropdown (so changes only apply on Save)
  const [pendingVisible, setPendingVisible] = useState<Set<string> | null>(null);  const renderActiveFilters = () => {
    const active: { label: string; onClear: () => void }[] = [];
    if (statusFilter) active.push({ label: `Status: ${statusFilter}`, onClear: () => setStatusFilter("") });
    if (sourceFilter) active.push({ label: `Source: ${sourceFilter}`, onClear: () => setSourceFilter("") });
    if (stateFilter) active.push({ label: `State: ${stateFilter}`, onClear: () => setStateFilter("") });
    if (startDate) active.push({ label: `From: ${formatBtnDate(startDate, "MM/dd/yy")}`, onClear: () => setStartDate(undefined) });
    if (endDate) active.push({ label: `To: ${formatBtnDate(endDate, "MM/dd/yy")}`, onClear: () => setEndDate(undefined) });
    if (timezoneFilters.length > 0) active.push({ label: `Timezones: ${timezoneFilters.join(", ")}`, onClear: () => setTimezoneFilters([]) });
    if (callableNowFilter) active.push({ label: `Callable Now`, onClear: () => setCallableNowFilter(false) });
    if (attemptCountFilters.length > 0) active.push({ label: `Attempts: ${attemptCountFilters.join(", ")}`, onClear: () => setAttemptCountFilters([]) });
    if (lastDispositionFilter) active.push({ label: `Disposition: ${lastDispositionFilter}`, onClear: () => setLastDispositionFilter("") });
    if (policyTypeFilter) active.push({ label: `Policy: ${policyTypeFilter}`, onClear: () => setPolicyTypeFilter("") });
    if (downlineAgentIds.length > 0) {
      const names = downlineAgentIds.map(id => {
        const a = downlineAgents.find(ag => ag.id === id);
        return a ? `${a.firstName} ${a.lastName}` : id;
      });
      active.push({ label: `Agents: ${names.join(", ")}`, onClear: () => setDownlineAgentIds([]) });
    }

    if (active.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-2 mb-4">
        {active.map((filter, i) => (
          <Badge key={i} variant="secondary" className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary border-primary/20">
            {filter.label}
            <X className="w-3 h-3 cursor-pointer hover:text-destructive" onClick={(e) => { e.stopPropagation(); filter.onClear(); }} />
          </Badge>
        ))}
        <button onClick={() => {
          setStatusFilter(""); setSourceFilter(""); setStateFilter("");
          setStartDate(undefined); setEndDate(undefined); setTimezoneFilters([]);
          setCallableNowFilter(false); setAttemptCountFilters([]); setLastDispositionFilter("");
          setPolicyTypeFilter(""); setDownlineAgentIds([]);
        }} className="text-xs text-muted-foreground hover:text-primary underline">Clear All</button>
      </div>
    );
  };

  // Generic columns toggle dropdown
  const renderColumnsDropdown = (columns: { key: string; label: string; locked?: boolean; defaultVisible: boolean }[], visible: Set<string>, setVisible: (s: Set<string>) => void, defaults: Set<string>) => {
    const displaySet = pendingVisible ?? visible;
    return (
    <div className="relative" ref={columnsRef}>
      <button onClick={() => { setColumnsOpen(!columnsOpen); setPendingVisible(columnsOpen ? null : new Set(visible)); }} className="h-10 px-4 rounded-xl bg-card border border-border text-foreground text-sm flex items-center gap-2 hover:bg-muted transition-colors duration-150 shadow-sm">
        <Columns3 className="w-4 h-4" />Columns
      </button>
      {columnsOpen && (
        <div className="absolute top-full mt-1 left-0 w-56 bg-card border border-border rounded-lg shadow-lg p-3 z-[120]">
          <p className="text-sm font-semibold text-foreground mb-2">Toggle Columns</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {columns.map(col => (
              <label key={col.key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Checkbox
                  checked={visible.has(col.key)}
                  disabled={col.locked}
                  onCheckedChange={() => {
                    if (col.locked) return;
                    const next = new Set(visible);
                    if (next.has(col.key)) next.delete(col.key); else next.add(col.key as any);
                    setVisible(next);
                    // Persist immediately (Power Dialer Requirement)
                    const tabKey = tab === "Leads" ? "leads" : tab === "Clients" ? "clients" : tab === "Recruits" ? "recruits" : "agents";
                    localStorage.setItem(`contacts_visible_cols_${tabKey}`, JSON.stringify(Array.from(next)));
                  }}
                />
                <span className="text-sm font-medium">{col.label}</span>
                {col.locked && (
                  <TooltipProvider><Tooltip><TooltipTrigger asChild><Lock className="w-3 h-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Cannot be hidden</TooltipContent></Tooltip></TooltipProvider>
                )}
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t">
            <button onClick={() => {
              const resetSet = new Set(defaults);
              setVisible(resetSet);
              setColumnsOpen(false);
              const tabKey = tab === "Leads" ? "leads" : tab === "Clients" ? "clients" : tab === "Recruits" ? "recruits" : "agents";
              localStorage.setItem(`contacts_visible_cols_${tabKey}`, JSON.stringify(Array.from(resetSet)));
            }} className="text-[10px] text-primary hover:underline">Reset to default</button>
            <button onClick={() => setColumnsOpen(false)} className="px-3 py-1 bg-primary text-primary-foreground rounded-lg text-[10px] font-medium hover:bg-primary/90 sidebar-transition">Close</button>
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
            <div className="absolute top-full mt-1 left-0 w-40 bg-card border border-border rounded-lg shadow-lg p-1 z-[120]">
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
            <div className="absolute top-full mt-1 left-0 w-44 bg-card border border-border rounded-lg shadow-lg p-1 z-[120]">
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
        <div className="absolute right-0 top-full mt-1 w-36 bg-card border border-border rounded-lg shadow-lg p-1 z-[120]">
          <button onClick={(e) => { e.stopPropagation(); setActionMenuId(null); onEdit(); }} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md flex items-center gap-2 transition-colors"><Pencil className="w-3.5 h-3.5" />Edit</button>
          {tab === "Leads" && (
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                setActionMenuId(null); 
                const lead = leads.find(l => l.id === id);
                if (lead) openContact("lead", lead);
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
  const filterStatuses = tab === "Leads" 
    ? Object.keys(leadStageColors)
    : tab === "Recruits" 
      ? Object.keys(recruitStageColors)
      : [];

  // Which add modal contact type
  const addContactType = tab === "Clients" ? "Client" : tab === "Recruits" ? "Recruit" : "Lead";
  const handleAddContact = tab === "Clients" ? handleAddClient : tab === "Recruits" ? handleAddRecruit : handleAddLead;

  return (
    <div className="flex flex-col w-full">
      <h1 className="text-2xl font-bold text-foreground">Contacts</h1>

      {/* Tabs */}
      <div className="flex items-center border-b">
        {tabs.map(t => (
          <button key={t} onClick={() => { setTab(t); setSearchQuery(""); setStatusFilter(""); setSourceFilter(""); setStateFilter(""); setPolicyTypeFilter(""); setDownlineAgentIds([]); setStartDate(undefined); setEndDate(undefined); setTimezoneFilters([]); setCallableNowFilter(false); setAttemptCountFilters([]); setLastDispositionFilter(""); setSelectedIds(new Set()); setSelectedClientIds(new Set()); setSelectedRecruitIds(new Set()); setSelectedAgentIds(new Set()); }}
            className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"} `}>{t}</button>
        ))}
        <div className="w-px h-5 bg-border mx-2 self-center" />
        <button 
          onClick={() => { setTab("Import History"); setSearchQuery(""); setStatusFilter(""); setSourceFilter(""); setSelectedIds(new Set()); setSelectedClientIds(new Set()); setSelectedRecruitIds(new Set()); setSelectedAgentIds(new Set()); }}
          className={`px-4 py-2.5 text-sm font-medium sidebar-transition ${tab === "Import History" ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"} `}
        >
          Import History
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mt-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={tab === "Import History" ? "Search history..." : `Search ${tab.toLowerCase()}...`} className="w-full h-10 pl-9 pr-4 rounded-xl bg-muted/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 border border-border shadow-sm" />
        </div>
        {(tab === "Leads" || tab === "Recruits") && (
          <div className="flex bg-muted rounded-xl p-0.5 border border-border h-10 shadow-sm">
            <button onClick={() => setView("table")} className={`px-3 py-1 rounded-lg sidebar-transition ${view === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"} `}><List className="w-4 h-4" /></button>
            <button onClick={() => setView("kanban")} className={`px-3 py-1 rounded-lg sidebar-transition ${view === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"} `}><LayoutGrid className="w-4 h-4" /></button>
          </div>
        )}
        {/* Columns toggle — shown for all tabs in table view except Import History */}
        {view === "table" && tab !== "Import History" && (
          tab === "Leads" ? renderColumnsDropdown(ALL_COLUMNS, visibleCols as Set<string>, (s) => setVisibleCols(s as Set<ColumnKey>), DEFAULT_VISIBLE as Set<string>) :
            tab === "Clients" ? renderColumnsDropdown(CLIENT_COLUMNS, visibleClientCols as Set<string>, (s) => setVisibleClientCols(s as Set<ClientColumnKey>), DEFAULT_CLIENT_VISIBLE as Set<string>) :
              tab === "Recruits" ? renderColumnsDropdown(RECRUIT_COLUMNS, visibleRecruitCols as Set<string>, (s) => setVisibleRecruitCols(s as Set<RecruitColumnKey>), DEFAULT_RECRUIT_VISIBLE as Set<string>) :
                renderColumnsDropdown(AGENT_COLUMNS, visibleAgentCols as Set<string>, (s) => setVisibleAgentCols(s as Set<AgentColumnKey>), DEFAULT_AGENT_VISIBLE as Set<string>)
        )}
        {/* Filter */}
        {tab !== "Import History" && (
          <button onClick={() => setFilterOpen(true)} className="h-10 px-4 rounded-xl bg-card text-foreground text-sm flex items-center gap-2 hover:bg-muted sidebar-transition border border-border shadow-sm"><Filter className="w-4 h-4" />Filter</button>
        )}
        <ContactsFilterModal
          open={filterOpen}
          onOpenChange={setFilterOpen}
          activeTab={tab as ContactsTab}
          filters={{
            stateFilter,
            downlineAgentIds,
            statusFilter,
            sourceFilter,
            startDate,
            endDate,
            timezoneFilters,
            callableNowFilter,
            attemptCountFilters,
            lastDispositionFilter,
            policyTypeFilter,
          }}
          onFiltersChange={(f: ContactsFilterValues) => {
            setStateFilter(f.stateFilter);
            setDownlineAgentIds(f.downlineAgentIds);
            setStatusFilter(f.statusFilter);
            setSourceFilter(f.sourceFilter);
            setStartDate(f.startDate);
            setEndDate(f.endDate);
            setTimezoneFilters(f.timezoneFilters);
            setCallableNowFilter(f.callableNowFilter);
            setAttemptCountFilters(f.attemptCountFilters);
            setLastDispositionFilter(f.lastDispositionFilter);
            setPolicyTypeFilter(f.policyTypeFilter);
          }}
          downlineAgents={downlineAgents}
          filterStatuses={filterStatuses}
        />
        <div className="flex-1" />
        {tab === "Leads" && <button onClick={() => setImportModalOpen(true)} className="h-10 px-4 rounded-xl bg-card text-foreground text-sm flex items-center gap-2 hover:bg-muted sidebar-transition border border-border shadow-sm"><Upload className="w-4 h-4" />Import CSV</button>}
        {tab !== "Agents" && tab !== "Import History" && <button onClick={() => setAddModalOpen(true)} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition shadow-lg shadow-primary/20"><Plus className="w-4 h-4" />Add {addContactType}</button>}
      </div>

      {/* Active Filters (Power Dialer Feature) */}
      {tab !== "Import History" && renderActiveFilters()}

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
            { showAssign: true, showStatus: true, statusList: filterStatuses, onStatusChange: (s) => handleBulkStatusChange(s as LeadStatus), onDelete: handleBulkDeleteLeads }
          )}

          {/* Leads Table */}
          <div className="bg-card rounded-xl border">
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
                        <tr key={l.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedIds.has(l.id) ? "bg-primary/5" : ""} `} onClick={() => openContact("lead", l)}>
                          <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleSelect(l.id); }}><input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => { }} className="rounded" /></td>
                          {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => (
                            <td key={col.key} className={`py-3 px-3 overflow-hidden ${colAlign(col.key)} `}>{renderCell(l, col.key, aging)}</td>
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
          {Object.keys(leadStageColors).map(status => {
            const items = leads.filter(l => l.status === status);
            return (
              <div key={status} className="min-w-[250px] bg-accent/50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={getStatusColorStyle(getLeadStatusColor(status))}>{status}</span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                {items.map(l => (
                  <div key={l.id} className="bg-card rounded-lg border p-3 cursor-pointer hover:shadow-md sidebar-transition" onClick={() => openContact("lead", l)}>
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
          <div className="bg-card rounded-xl border">
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
                      <tr key={c.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedClientIds.has(c.id) ? "bg-primary/5" : ""} `} onClick={() => openContact("client", c)}>
                        <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleClientSelect(c.id); }}><input type="checkbox" checked={selectedClientIds.has(c.id)} onChange={() => { }} className="rounded" /></td>
                        {CLIENT_COLUMNS.filter(col => visibleClientCols.has(col.key)).map(col => (
                          <td key={col.key} className={`py-3 px-3 overflow-hidden ${colAlign(col.key)} `}>{renderClientCell(c, col.key)}</td>
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
            { showAssign: true, showStatus: true, statusList: filterStatuses, onStatusChange: handleBulkRecruitStatusChange, onDelete: handleBulkDeleteRecruits }
          )}
          <div className="bg-card rounded-xl border">
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
                      <tr key={r.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedRecruitIds.has(r.id) ? "bg-primary/5" : ""} `} onClick={() => openContact("recruit", r)}>
                        <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleRecruitSelect(r.id); }}><input type="checkbox" checked={selectedRecruitIds.has(r.id)} onChange={() => { }} className="rounded" /></td>
                        {RECRUIT_COLUMNS.filter(col => visibleRecruitCols.has(col.key)).map(col => (
                          <td key={col.key} className={`py-3 px-3 overflow-hidden ${colAlign(col.key)}`} style={{ width: columnWidths[tab]?.[col.key], minWidth: columnWidths[tab]?.[col.key] }}>{renderRecruitCell(r, col.key)}</td>
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
                {Object.keys(recruitStageColors).map(s => {
                  const items = recruits.filter(r => r.status === s);
                  return (
                    <div key={s} className="min-w-[220px] bg-accent/50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={getStatusColorStyle(getRecruitStatusColor(s))}>{s}</span>
                        <span className="text-xs text-muted-foreground">{items.length}</span>
                      </div>
                      {items.map(r => (
                        <div key={r.id} className="bg-card rounded-lg border p-3 cursor-pointer hover:shadow-md sidebar-transition" onClick={() => openContact("recruit", r)}>
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
        <div className="bg-card rounded-xl border">
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
                  <tr key={u.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedAgentIds.has(u.id) ? "bg-primary/5" : ""} `} onClick={() => openContact("agent", u)}>
                    <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleAgentSelect(u.id); }}><input type="checkbox" checked={selectedAgentIds.has(u.id)} onChange={() => { }} className="rounded" /></td>
                    {AGENT_COLUMNS.filter(col => visibleAgentCols.has(col.key)).map(col => (
                      <td key={col.key} className={`py-3 px-3 overflow-hidden ${col.key === "name" ? "px-4" : ""} ${colAlign(col.key)} `}>{renderAgentCell(u, col.key)}</td>
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
      )}

      {/* ===== IMPORT HISTORY TAB ===== */}
      {!loading && tab === "Import History" && (
        <div className="bg-card rounded-xl border border-border flex flex-col max-w-4xl">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Upload className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Import History</h3>
          </div>
          <div className="overflow-y-auto">
            {importHistory.length === 0 ? (
              <div className="text-center py-12">
                <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold text-foreground mb-1">No imports yet</h3>
                <p className="text-sm text-muted-foreground mb-4">When you import leads via CSV, your history will appear here.</p>
                <button onClick={() => setImportModalOpen(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Import CSV</button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {importHistory
                  .filter(h => h.fileName.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(h => {
                  const dateObj = new Date(h.date);
                  const msSince = Date.now() - dateObj.getTime();
                  const hoursSince = msSince / (1000 * 60 * 60);
                  const canUndo = hoursSince < 24;
                  const formattedTime = formatDateTime(dateObj);
                  return (
                    <div key={h.id} className="px-6 py-4 hover:bg-accent/30 sidebar-transition">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground truncate">{h.fileName}</span>
                            <span className="text-xs text-muted-foreground">• {formattedTime}</span>
                          </div>
                          <div className="flex flex-wrap gap-4 mt-2 text-xs">
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">Total Records</span>
                              <span className="text-foreground font-medium">{h.totalRecords}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-muted-foreground text-success">Imported</span>
                              <span className="text-foreground font-medium">{h.imported}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-muted-foreground text-warning">Duplicates</span>
                              <span className="text-foreground font-medium">{h.duplicates}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-muted-foreground text-destructive">Errors</span>
                              <span className="text-foreground font-medium">{h.errors}</span>
                            </div>
                          </div>
                        </div>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                disabled={!canUndo}
                                onClick={() => setUndoConfirm(h)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 shrink-0"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                Undo Import
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{canUndo ? "Undo this import" : "Undo is only available within 24 hours of import"}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {tab === "Leads" && <AddLeadModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddLead} />}
      {tab === "Clients" && <AddClientModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddClient} />}
      {tab === "Recruits" && <AddRecruitModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddRecruit} />}
      
      <AddLeadModal open={!!editLead} onClose={() => setEditLead(null)} onSave={async (d) => { if (editLead) { await handleUpdateLead(editLead.id, d); setEditLead(null); } }} initial={editLead} />
      <AddClientModal open={!!editClient} onClose={() => setEditClient(null)} onSave={async (d) => { if (editClient) { await clientsSupabaseApi.update(editClient.id, d); setEditClient(null); toast.success("Client updated"); fetchData(); } }} initial={editClient} />
      <AddRecruitModal open={!!editRecruit} onClose={() => setEditRecruit(null)} onSave={async (d) => { if (editRecruit) { await recruitsSupabaseApi.update(editRecruit.id, d); setEditRecruit(null); toast.success("Recruit updated"); fetchData(); } }} initial={editRecruit as any} />
      {selectedLead && (
        <FullScreenContactView 
          contact={selectedLead} 
          type="lead" 
          onClose={closeContact} 
          onUpdate={handleUpdateLead} 
          onDelete={handleDeleteLead} 
          onConvert={() => { fetchData(); closeContact(); setTab("Clients"); }} 
        />
      )}
      {selectedClient && (
        <FullScreenContactView 
          contact={selectedClient} 
          type="client" 
          onClose={closeContact} 
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
          onClose={closeContact} 
          onUpdate={async (id, data) => { 
            await recruitsSupabaseApi.update(id, data); 
            fetchData(); 
          }} 
          onDelete={handleDeleteRecruit} 
        />
      )}
      <AgentModal agent={selectedAgent} onClose={closeContact} />
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
