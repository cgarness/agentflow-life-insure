import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  pipelineSupabaseApi,
  contactManagementSettingsSupabaseApi,
  customFieldsSupabaseApi,
} from "@/lib/supabase-settings";
import {
  findDuplicates,
  describeDuplicate,
  type DuplicateRule,
  type DuplicateScope,
  type ManualAction,
  type DuplicateContactType,
} from "@/lib/contactDuplicateDetection";
import { computeMissingRequired } from "@/lib/contactRequiredFields";
import type { CustomField, ContactManagementSettings } from "@/lib/types";
import {
  Search, Filter, LayoutGrid, List, Upload, Plus, MoreHorizontal,
  Phone, Eye, Pencil, Trash2, X, ShieldCheck, Calendar as CalendarIcon, Mail, Users,
  Loader2, ChevronDown, ChevronUp, AlertTriangle, Columns3, Lock,
  ArrowUp, ArrowDown, ArrowUpDown, Undo2, Megaphone, Download, UserPlus,
  GraduationCap, CheckCircle2, ArrowRight
} from "lucide-react";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { recruitsSupabaseApi } from "@/lib/supabase-recruits";
import { notesSupabaseApi } from "@/lib/supabase-notes";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { leadSourcesSupabaseApi } from "@/lib/supabase-settings";
import { supabase } from "@/integrations/supabase/client";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { Lead, Client, Recruit, LeadStatus, ContactNote, ContactActivity, User, UserProfile, PipelineStage } from "@/lib/types";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import {
  Dialog as ConfirmDialog,
  DialogContent as ConfirmDialogContent,
  DialogHeader as ConfirmDialogHeader,
  DialogTitle as ConfirmDialogTitle,
  DialogDescription as ConfirmDialogDescription,
  DialogFooter as ConfirmDialogFooter,
} from "@/components/ui/dialog";

type UserWithProfile = User & { profile: UserProfile };
import type { Json } from "@/integrations/supabase/types";
import { getAgentName, getAgentInitials } from "@/lib/data-helpers";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import AddLeadModal from "@/components/contacts/AddLeadModal";
import type { AddLeadSaveMeta } from "@/components/contacts/AddLeadModal";
import ConvertLeadModal from "@/components/contacts/ConvertLeadModal";
import { addLeadsToCampaignBatched } from "@/lib/supabase-campaign-leads";
import AddClientModal from "@/components/contacts/AddClientModal";
import AddRecruitModal from "@/components/contacts/AddRecruitModal";
import AgentModal from "@/components/contacts/AgentModal";
import { type ImportHistoryEntry } from "@/components/contacts/ImportLeadsModal";
import {
  previewImportUndo,
  undoContactImport,
  describeImportUndoReason,
  importUndoRowStatus,
  type ImportUndoReasonCode,
} from "@/lib/supabase-import-undo";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AddToCampaignModal from "@/components/contacts/AddToCampaignModal";
import { useBranding } from "@/contexts/BrandingContext";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { formatStateToAbbreviation } from "@/utils/stateUtils";
import { formatDOB } from "@/utils/dobUtils";
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
import { ContactKanbanBoard } from "@/components/contacts/ContactKanbanBoard";
import ContactScopeSelector from "@/components/contacts/ContactScopeSelector";
import { CommissionGate } from "@/components/PermissionGate";
import { usePermissions } from "@/hooks/usePermissions";
import { useContactScope } from "@/hooks/useContactScope";
import {
  buildLeadFilterPayload,
  resolveAgentFilterOptions,
  resolveCallableStates,
  resolveOwnerAgentIds,
  scopeLabel,
  leadSortColumnToCanonical,
  clientSortColumnToCanonical,
  recruitSortColumnToCanonical,
  type LeadFilterPayload,
  type LeadUiFilters,
  type KanbanResult,
} from "@/lib/contactsFilters";
// Contacts Build 6 — pure table config + display helpers extracted from this page.
import {
  fallbackStatusColors,
  fallbackRecruitColors,
  policyTypeColors,
  ALL_COLUMNS,
  CLIENT_COLUMNS,
  RECRUIT_COLUMNS,
  AGENT_COLUMNS,
  DEFAULT_VISIBLE,
  DEFAULT_CLIENT_VISIBLE,
  DEFAULT_RECRUIT_VISIBLE,
  DEFAULT_AGENT_VISIBLE,
  STARTER_LAYOUT,
  type ColumnKey,
  type ClientColumnKey,
  type RecruitColumnKey,
  type AgentColumnKey,
} from "@/components/contacts/contactsTableConfig";
import { normalizeStatusDisplay } from "@/lib/contactsDisplay";
import DeleteConfirmModal from "@/components/contacts/DeleteConfirmModal";

// ---- Main Contacts Page ----
const Contacts: React.FC = () => {
  const { user, profile, isBuildingOrganization } = useAuth();
  const { organizationId, role, isSuperAdmin } = useOrganization();
  // Contacts Build 5 — Contacts module permission reader (stable-key catalog).
  // Conversion is intentionally NOT gated by this; it stays universally available.
  const { hasContactsPermission } = usePermissions();
  const { formatDate, formatDateTime } = useBranding();
  // Contacts Build 2 — one permission-aware scope across Leads/Clients/Recruits.
  const {
    scope,
    setScope,
    availableScopes,
    teamAgents,
    teamAgentIds,
    prefError: scopePrefError,
  } = useContactScope();
  const navigate = useNavigate();
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

  // Contacts Build 5: "unassigned" is a Leads-only org-pool scope — never carry it onto
  // the Clients/Recruits tabs (keeps their data + count labels correct).
  useEffect(() => {
    if (tab !== "Leads" && scope === "unassigned") setScope("mine");
  }, [tab, scope, setScope]);

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
  // Per-tab sort (Build 2): authoritative server-side sort, persisted per tab in
  // user_preferences.settings.contactsSort. `sortCol`/`sortDir` are the ACTIVE tab's
  // values. Declared HERE (before fetchData) because fetchData's deps reference them —
  // a later declaration produced a production-only TDZ ("Cannot access 'sortCol'…").
  const [sortByTab, setSortByTab] = useState<Record<string, { col: string | null; dir: "asc" | "desc" }>>({
    Leads: { col: null, dir: "asc" },
    Clients: { col: null, dir: "asc" },
    Recruits: { col: null, dir: "asc" },
    Agents: { col: null, dir: "asc" },
  });
  const activeSort = sortByTab[tab] ?? { col: null, dir: "asc" };
  const sortCol = activeSort.col;
  const sortDir = activeSort.dir;

  const PAGE_SIZE = 50;

  const [leadsPage, setLeadsPage] = useState(0);
  const [clientsPage, setClientsPage] = useState(0);
  const [recruitsPage, setRecruitsPage] = useState(0);
  const [leadsTotalCount, setLeadsTotalCount] = useState(0);
  const [clientsTotalCount, setClientsTotalCount] = useState(0);
  const [recruitsTotalCount, setRecruitsTotalCount] = useState(0);

  const [view, setView] = useState<"table" | "kanban">("table");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [recruits, setRecruits] = useState<Recruit[]>([]);
  // Kanban-specific full-pipeline data (exact per-status counts + bounded slices; Build 4).
  // Declared before fetchData/fetchKanban so the callbacks reference live setters.
  const [leadKanban, setLeadKanban] = useState<KanbanResult<Lead> | null>(null);
  const [recruitKanban, setRecruitKanban] = useState<KanbanResult<Recruit> | null>(null);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [kanbanError, setKanbanError] = useState<string | null>(null);
  const [agents, setAgents] = useState<UserWithProfile[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [realCampaigns, setRealCampaigns] = useState<
    {
      id: string;
      name: string;
      type: string;
      status: string;
      user_id?: string | null;
      assigned_agent_ids?: unknown;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  // Contacts Build 6 — table fetch error surface (kept distinct from the empty state).
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!user?.id || isBuildingOrganization) {
      console.warn(`fetchData: ${!user?.id ? "No user" : "Building organization"}, skipping fetch.`);
      if (!silent) setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setLoadError(null);
    // Secure diagnostic logging (no PII)
    console.info(`[Diagnostic] Session Ready. User: ${user.id.slice(0, 8)}... | Role: ${role} | Org: ${organizationId?.slice(0, 8)}...`);
    try {
      // Import History has no grid data — avoid loading every contact list.
      if (tab === "Import History") {
        const pendingOnly = pendingContactId.current;
        if (pendingOnly) {
          leadsSupabaseApi.getById(pendingOnly).then(res => {
            setSelectedLead(res.lead);
            pendingContactId.current = null;
          }).catch(() => {
            clientsSupabaseApi.getById(pendingOnly).then(client => {
              setSelectedClient(client);
              pendingContactId.current = null;
            }).catch(() => {
              recruitsSupabaseApi.getById(pendingOnly).then(recruit => {
                setSelectedRecruit(recruit);
                pendingContactId.current = null;
              }).catch(() => { /* contact not found */ });
            });
          });
        }
        return;
      }

      // ONE canonical scope-aware filter contract. Leads filter server-side via the
      // RPC (scope resolved in SQL); Clients/Recruits resolve scope to owner ids.
      const explicitAgentIds = downlineAgentIds.length > 0 ? downlineAgentIds : undefined;

      const leadFilters = buildLeadFilterPayload({
        scope,
        agentIds: explicitAgentIds,
        search: searchQuery,
        status: statusFilter,
        source: sourceFilter,
        state: stateFilter,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        timezoneGroups: timezoneFilters,
        callableNow: callableNowFilter,
        attemptBuckets: attemptCountFilters,
        lastDisposition: lastDispositionFilter,
        sortColumn: leadSortColumnToCanonical(sortCol),
        sortDirection: sortDir,
        page: leadsPage,
        pageSize: PAGE_SIZE,
      });

      const ownerAgentIds = resolveOwnerAgentIds({
        scope,
        userId: user?.id,
        teamAgentIds,
        explicitAgentIds,
      });

      const clientFilters = {
        search: searchQuery,
        state: stateFilter,
        policyType: policyTypeFilter,
        assignedAgentIds: ownerAgentIds,
        sortColumn: clientSortColumnToCanonical(sortCol),
        sortDirection: sortDir,
        page: clientsPage,
        pageSize: PAGE_SIZE,
      };

      const recruitFilters = {
        search: searchQuery,
        state: stateFilter,
        assignedAgentIds: ownerAgentIds,
        sortColumn: recruitSortColumnToCanonical(sortCol),
        sortDirection: sortDir,
        page: recruitsPage,
        pageSize: PAGE_SIZE,
      };

      let leadSnapshot: Lead[] | null = null;
      let clientSnapshot: Client[] | null = null;
      let recruitSnapshot: Recruit[] | null = null;
      let leadTotal = 0;
      let clientTotal = 0;
      let recruitTotal = 0;

      if (tab === "Leads") {
        const leadResult = await leadsSupabaseApi.getAll(leadFilters).catch(e => {
          console.error("Error fetching leads:", e);
          toast.error(`Failed to load leads: ${e.message}`);
          setLoadError(e instanceof Error ? e.message : "Failed to load leads.");
          return { data: [] as Lead[], totalCount: 0 };
        });
        leadSnapshot = leadResult.data;
        leadTotal = leadResult.totalCount;
        setLeads(leadResult.data);
        setLeadsTotalCount(leadResult.totalCount);
        setSelectedLead((prev) => {
          if (!prev) return null;
          const next = leadResult.data.find((l) => l.id === prev.id);
          return next ?? prev;
        });
      } else if (tab === "Clients") {
        const clientResult = await clientsSupabaseApi.getAll(clientFilters).catch(e => {
          console.error("Error fetching clients:", e);
          toast.error(`Failed to load clients: ${e.message}`);
          setLoadError(e instanceof Error ? e.message : "Failed to load clients.");
          return { data: [] as Client[], totalCount: 0 };
        });
        clientSnapshot = clientResult.data;
        clientTotal = clientResult.totalCount;
        setClients(clientResult.data);
        setClientsTotalCount(clientResult.totalCount);
        setSelectedClient((prev) => {
          if (!prev) return null;
          const next = clientResult.data.find((c) => c.id === prev.id);
          return next ?? prev;
        });
      } else if (tab === "Recruits") {
        const recruitResult = await recruitsSupabaseApi.getAll(recruitFilters).catch(e => {
          console.error("Error fetching recruits:", e);
          toast.error(`Failed to load recruits: ${e.message}`);
          setLoadError(e instanceof Error ? e.message : "Failed to load recruits.");
          return { data: [] as Recruit[], totalCount: 0 };
        });
        recruitSnapshot = recruitResult.data;
        recruitTotal = recruitResult.totalCount;
        setRecruits(recruitResult.data);
        setRecruitsTotalCount(recruitResult.totalCount);
        setSelectedRecruit((prev) => {
          if (!prev) return null;
          const next = recruitResult.data.find((r) => r.id === prev.id);
          return next ?? prev;
        });
      } else if (tab === "Agents") {
        if (!organizationId) {
          setAgents([]);
          setSelectedAgent(null);
        } else {
          const agentData = await usersApi.getAll({ search: searchQuery, organizationId }).catch(e => {
            console.error("Error fetching agents:", e);
            setLoadError(e instanceof Error ? e.message : "Failed to load agents.");
            return [] as UserWithProfile[];
          });
          setAgents(agentData);
          setSelectedAgent((prev) => {
            if (!prev) return null;
            const next = agentData.find((u) => u.id === prev.id);
            return next ?? prev;
          });
        }
      }

      // Deep-link fallback: if pendingContactId is not in the loaded tab slice, fetch by ID
      const pendingId = pendingContactId.current;
      if (pendingId) {
        const inLeads = leadSnapshot?.some(l => l.id === pendingId);
        const inClients = clientSnapshot?.some(c => c.id === pendingId);
        const inRecruits = recruitSnapshot?.some(r => r.id === pendingId);
        if (!inLeads && !inClients && !inRecruits) {
          leadsSupabaseApi.getById(pendingId).then(res => {
            setSelectedLead(res.lead);
            pendingContactId.current = null;
          }).catch(() => {
            clientsSupabaseApi.getById(pendingId).then(client => {
              setSelectedClient(client);
              pendingContactId.current = null;
            }).catch(() => {
              recruitsSupabaseApi.getById(pendingId).then(recruit => {
                setSelectedRecruit(recruit);
                pendingContactId.current = null;
              }).catch(() => { /* contact not found */ });
            });
          });
        }
      }

      const logLeads = leadSnapshot?.length ?? 0;
      const logClients = clientSnapshot?.length ?? 0;
      const logRecruits = recruitSnapshot?.length ?? 0;
      console.log(`fetchData: Load complete (${tab}). Leads: ${logLeads}/${leadTotal || "—"}, Clients: ${logClients}/${clientTotal || "—"}, Recruits: ${logRecruits}/${recruitTotal || "—"}`);
    } catch (err: any) {
      console.error("fetchData: Failed to load contacts data:", err);
      toast.error(`Critical Error: ${err.message || "Failed to fetch contacts"}`);
      setLoadError(err?.message || "Failed to fetch contacts.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user?.id, isBuildingOrganization, organizationId, tab, searchQuery, statusFilter, sourceFilter, stateFilter, startDate, endDate, timezoneFilters, callableNowFilter, attemptCountFilters, lastDispositionFilter, policyTypeFilter, downlineAgentIds, leadsPage, clientsPage, recruitsPage, scope, teamAgentIds, sortCol, sortDir]);

  /**
   * Kanban read path (Build 4) — SEPARATE from the table fetch. Shows FULL
   * filtered per-stage counts (not the page slice) using the SAME canonical
   * filters/scope. The single-status filter is ignored (D1, dropped in
   * toLeadKanbanPayload); pagination is irrelevant. No-op unless in Kanban view.
   */
  const fetchKanban = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.id || isBuildingOrganization) return;
    if (view !== "kanban" || (tab !== "Leads" && tab !== "Recruits")) return;
    const silent = Boolean(opts?.silent);
    if (!silent) { setKanbanLoading(true); setKanbanError(null); }
    try {
      const explicitAgentIds = downlineAgentIds.length > 0 ? downlineAgentIds : undefined;
      if (tab === "Leads") {
        const payload = buildLeadFilterPayload({
          scope,
          agentIds: explicitAgentIds,
          search: searchQuery,
          status: statusFilter, // dropped for Kanban inside toLeadKanbanPayload (D1)
          source: sourceFilter,
          state: stateFilter,
          startDate: startDate?.toISOString(),
          endDate: endDate?.toISOString(),
          timezoneGroups: timezoneFilters,
          callableNow: callableNowFilter,
          attemptBuckets: attemptCountFilters,
          lastDisposition: lastDispositionFilter,
          sortColumn: leadSortColumnToCanonical(sortCol),
          sortDirection: sortDir,
        });
        setLeadKanban(await leadsSupabaseApi.getKanban(payload));
      } else {
        const ownerAgentIds = resolveOwnerAgentIds({ scope, userId: user?.id, teamAgentIds, explicitAgentIds });
        setRecruitKanban(await recruitsSupabaseApi.getKanban({
          search: searchQuery,
          state: stateFilter,
          assignedAgentIds: ownerAgentIds,
          sortColumn: recruitSortColumnToCanonical(sortCol),
          sortDirection: sortDir,
        }));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load board";
      setKanbanError(msg);
      if (!silent) toast.error(`Failed to load board: ${msg}`);
    } finally {
      if (!silent) setKanbanLoading(false);
    }
  }, [user?.id, isBuildingOrganization, view, tab, scope, downlineAgentIds, searchQuery, statusFilter, sourceFilter, stateFilter, startDate, endDate, timezoneFilters, callableNowFilter, attemptCountFilters, lastDispositionFilter, sortCol, sortDir, teamAgentIds]);

  const [leadStageColors, setLeadStageColors] = useState<Record<string, string>>({});
  const [recruitStageColors, setRecruitStageColors] = useState<Record<string, string>>({});
  // Full configured stages (drive Kanban column order + colors; Build 4).
  const [leadStages, setLeadStages] = useState<PipelineStage[]>([]);
  const [recruitStages, setRecruitStages] = useState<PipelineStage[]>([]);



  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllLeadsMode, setSelectAllLeadsMode] = useState(false);
  // Frozen canonical filter snapshot captured when select-all is entered, so a later
  // bulk action always targets the exact displayed population (callable-now frozen too).
  const [selectAllSnapshot, setSelectAllSnapshot] = useState<LeadFilterPayload | null>(null);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [selectAllClientsMode, setSelectAllClientsMode] = useState(false);
  const [selectedRecruitIds, setSelectedRecruitIds] = useState<Set<string>>(new Set());
  const [selectAllRecruitsMode, setSelectAllRecruitsMode] = useState(false);
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
      p.delete("id"); // Ensure legacy id param is also cleared
      return p;
    });
  }, [setSearchParams]);

  // After a conversion, open the returned Client (fetch by id) on the Clients tab. Deep-link safe.
  const openClientById = useCallback(async (clientId: string) => {
    try {
      const client = await clientsSupabaseApi.getById(clientId);
      if (client) { setTab("Clients"); openContact("client", client); }
    } catch (e) {
      console.error("Could not open converted client:", e);
    }
  }, [openContact]);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [editRecruit, setEditRecruit] = useState<Recruit | null>(null);
  const [rowDeletePending, setRowDeletePending] = useState<
    | { kind: "lead"; id: string; label: string }
    | { kind: "client"; id: string; label: string }
    | { kind: "recruit"; id: string; label: string }
    | null
  >(null);
  const [allLeadSources, setAllLeadSources] = useState<string[]>([]);
  /** Lead source name → hex from Settings → Lead Sources */
  const [leadSourceColorMap, setLeadSourceColorMap] = useState<Record<string, string>>({});
  const [cmsSettings, setCmsSettings] = useState<ContactManagementSettings | null>(null);
  const [activeCustomFields, setActiveCustomFields] = useState<CustomField[]>([]);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    label: string;
    description: string;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>([]);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState<ImportHistoryEntry | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  /** Lead pending conversion via the row-level Convert action (launches the real ConvertLeadModal). */
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [addToCampaignOpen, setAddToCampaignOpen] = useState(false);
  /** Full lead ID list for Add to Campaign (cross-page + select-all-leads); only used when tab is Leads. */
  const [campaignLeadIds, setCampaignLeadIds] = useState<string[] | null>(null);
  const [campaignIdsLoading, setCampaignIdsLoading] = useState(false);

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
        // Per-tab sort restore (validate each saved column against that tab's allowlist).
        if (s.contactsSort && typeof s.contactsSort === "object") {
          setSortByTab((prev) => {
            const next = { ...prev };
            for (const t of ["Leads", "Clients", "Recruits", "Agents"]) {
              const saved = s.contactsSort[t];
              if (saved && (saved.dir === "asc" || saved.dir === "desc")) {
                next[t] = { col: validateSavedSortCol(t, saved.col ?? null), dir: saved.dir };
              }
            }
            return next;
          });
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
    contactsSort: Record<string, { col: string | null; dir: "asc" | "desc" }>;
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

  // Validate a saved sort column against the tab's allowlist (Agents sort is client-side).
  const validateSavedSortCol = (t: string, col: string | null): string | null => {
    if (!col) return null;
    if (t === "Leads") return leadSortColumnToCanonical(col) ? col : null;
    if (t === "Clients") return clientSortColumnToCanonical(col) ? col : null;
    if (t === "Recruits") return recruitSortColumnToCanonical(col) ? col : null;
    return col;
  };

  // Persist per-tab sort (one authoritative source: user_preferences.settings.contactsSort).
  useEffect(() => {
    if (!sortPrefsLoaded.current) return;
    persistSettings({ contactsSort: sortByTab });
  }, [sortByTab, persistSettings]);

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

  // Full-dataset sorting is SERVER-SIDE for Leads/Clients/Recruits (no page-local re-sort).
  // A sort change resets pagination + clears selection and the frozen select-all snapshot,
  // then triggers a refetch (sortByTab is in fetchData's deps). Third click clears → default.
  const applySortChange = (col: string | null, dir: "asc" | "desc") => {
    setSortByTab((prev) => ({ ...prev, [tab]: { col, dir } }));
    setLeadsPage(0);
    setClientsPage(0);
    setRecruitsPage(0);
    setSelectedIds(new Set());
    setSelectAllLeadsMode(false);
    setSelectAllSnapshot(null);
    setSelectedClientIds(new Set());
    setSelectAllClientsMode(false);
    setSelectedRecruitIds(new Set());
    setSelectAllRecruitsMode(false);
  };

  const handleSort = (key: string) => {
    if (sortCol === key) {
      if (sortDir === "asc") applySortChange(key, "desc");
      else applySortChange(null, "asc"); // third click → default (created_at desc)
    } else {
      applySortChange(key, "asc");
    }
  };

  // ===== Agent sort (client-side: Agents tab is a single unpaginated fetch) =====
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

  // Load Kanban data whenever we are (or land) in Kanban view; no-op otherwise.
  useEffect(() => { fetchKanban(); }, [fetchKanban]);

  // Reset pages and select-all mode whenever any filter changes (not when page itself changes)
  useEffect(() => {
    setLeadsPage(0);
    setClientsPage(0);
    setRecruitsPage(0);
    setSelectAllLeadsMode(false);
    setSelectedIds(new Set());
  }, [searchQuery, statusFilter, sourceFilter, stateFilter, startDate, endDate, timezoneFilters, callableNowFilter, attemptCountFilters, lastDispositionFilter, policyTypeFilter, downlineAgentIds]);

  // Fetch pipeline stage colors and names from settings
  useEffect(() => {
    if (!organizationId) return;
    pipelineSupabaseApi.getLeadStages(organizationId).then(stages => {
      setLeadStages(stages);
      if (stages.length > 0) {
        const map: Record<string, string> = {};
        stages.forEach(s => { map[s.name] = s.color; });
        setLeadStageColors(map);
      }
    });
    pipelineSupabaseApi.getRecruitStages(organizationId).then(stages => {
      setRecruitStages(stages);
      if (stages.length > 0) {
        const map: Record<string, string> = {};
        stages.forEach(s => { map[s.name] = s.color; });
        setRecruitStageColors(map);
      }
    });

    // Fetch contact management settings + active custom fields for required/duplicate enforcement.
    contactManagementSettingsSupabaseApi.getSettings(organizationId)
      .then((s) => setCmsSettings(s ?? null))
      .catch((e) => { console.error("Failed to load contact management settings:", e); });
    customFieldsSupabaseApi.getAll(organizationId)
      .then((fields) => setActiveCustomFields(fields.filter((f) => f.active)))
      .catch((e) => { console.error("Failed to load custom fields:", e); });

    // Fetch dynamic settings for filters
    leadSourcesSupabaseApi.getAll(organizationId).then(sources => {
      if (sources.length > 0) {
        setAllLeadSources(sources.map(s => s.name));
        const colors: Record<string, string> = {};
        sources.forEach(s => {
          colors[s.name] = s.color || "#3B82F6";
        });
        setLeadSourceColorMap(colors);
      }
    });

    // Fetch agent profiles for display
    supabase.from("profiles").select("id, first_name, last_name, status").eq("status", "Active").then(({ data }) => {
      if (data) setAgentProfiles(data.map((p: any) => ({ id: p.id, firstName: p.first_name || "", lastName: p.last_name || "" }))); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    // Fetch campaigns for import modal
    supabase
      .from("campaigns")
      .select("id, name, type, status, user_id, assigned_agent_ids")
      .then(({ data }) => {
        if (data) {
          setRealCampaigns(
            data as {
              id: string;
              name: string;
              type: string;
              status: string;
              user_id?: string | null;
              assigned_agent_ids?: unknown;
            }[],
          );
        }
      });
  }, [organizationId]);

  const assignableAgentsForAddLead = React.useMemo(() => {
    if (!user?.id) return [] as { id: string; firstName: string; lastName: string }[];
    // Team Leader → self + recursive downline (canonical hierarchy); Admin/Super → org.
    if (role === "Team Leader") return teamAgents;
    if (role === "Admin" || isSuperAdmin) return agentProfiles;
    return [] as { id: string; firstName: string; lastName: string }[];
  }, [user?.id, role, isSuperAdmin, teamAgents, agentProfiles]);

  const assignableAgentIdsForImport = React.useMemo(() => {
    if (!user?.id) return [] as string[];
    if (role === "Agent" && !isSuperAdmin) return [user.id];
    if (role === "Team Leader") return teamAgentIds;
    return agentProfiles.map((a) => a.id);
  }, [user?.id, role, isSuperAdmin, teamAgentIds, agentProfiles]);

  // Scope-aware specific-agent options for the Filter modal (tested in contactsFilters):
  // Agency → all RLS-authorized org agents; Team → self + recursive downline; Mine → none.
  const agentFilterOptions = React.useMemo<DownlineAgent[]>(
    () => resolveAgentFilterOptions({ scope, orgAgents: agentProfiles, teamAgents }),
    [scope, agentProfiles, teamAgents],
  );

  const getLeadStatusColor = (status: string) => leadStageColors[status] || fallbackStatusColors[status] || "#6B7280";
  const getRecruitStatusColor = (status: string) => recruitStageColors[status] || fallbackRecruitColors[status] || "#6B7280";
  const getLeadSourceHex = (name: string) => {
    const key = name.trim();
    if (!key) return "#6B7280";
    return leadSourceColorMap[key] ?? "#6B7280";
  };

  const renderLeadSourceBadge = (raw: string) => {
    const text = String(raw ?? "").trim();
    if (!text) return <span className="text-muted-foreground">—</span>;
    const hex = getLeadSourceHex(text);
    return (
      <span
        className="inline-flex max-w-full items-center px-2 py-0.5 rounded-full text-xs font-medium border truncate align-middle"
        style={getStatusColorStyle(hex)}
        title={text}
      >
        {text}
      </span>
    );
  };

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
        importCompletionStatus: row.import_completion_status ?? null,
        undoStatus: row.undo_status ?? null,
        campaignId: row.campaign_id ?? null,
      })));
    }
  }, []);

  useEffect(() => { fetchImportHistory(); }, [fetchImportHistory]);

  // ---- Import Undo (Contacts Build 3) ----
  // Advisory server preview before opening the confirm dialog; the execute RPC re-validates regardless.
  const handleOpenUndoImport = useCallback(async (h: ImportHistoryEntry) => {
    try {
      const preview = await previewImportUndo(h.id);
      if (!preview.eligible) {
        const code = preview.blocked_reason_codes?.[0];
        toast.error(code ? describeImportUndoReason(code) : "This import can no longer be undone.", { duration: 4500, position: "bottom-right" });
        await fetchImportHistory();
        return;
      }
      setUndoConfirm(h);
    } catch (e: any) {
      toast.error(`Could not check undo eligibility: ${e?.message ?? "unknown error"}`, { duration: 4000, position: "bottom-right" });
    }
  }, [fetchImportHistory]);

  const handleConfirmUndoImport = useCallback(async (h: ImportHistoryEntry) => {
    setUndoBusy(true);
    try {
      const result = await undoContactImport(h.id);
      if (!result.success) {
        const code = (result.blocked_reason_codes?.[0] ?? result.reason) as ImportUndoReasonCode | undefined;
        toast.error(code ? describeImportUndoReason(code) : "Undo failed.", { duration: 4500, position: "bottom-right" });
        await fetchImportHistory();
        return;
      }
      const n = result.deleted_leads ?? 0;
      toast.success(`Import undone — ${n} lead${n === 1 ? "" : "s"} removed`, { duration: 3000, position: "bottom-right" });
      setUndoConfirm(null);
      await fetchImportHistory();
      fetchData();
    } catch (e: any) {
      toast.error(`Undo failed: ${e?.message ?? "unknown error"}`, { duration: 4000, position: "bottom-right" });
    } finally {
      setUndoBusy(false);
    }
  }, [fetchImportHistory, fetchData]);

  // Reset transient UI on tab change. Sort is per-tab (sortByTab) and intentionally
  // preserved across tabs (the active tab shows its own saved sort).
  useEffect(() => {
    setColumnsOpen(false);
    setActionMenuId(null);
    setBulkAssignOpen(false);
    setBulkStatusOpen(false);
  }, [tab]);

  // Scope change: reset pagination + selection + select-all snapshot, close bulk
  // menus, and drop any specific-agent selections invalid under the new scope.
  useEffect(() => {
    setLeadsPage(0);
    setClientsPage(0);
    setRecruitsPage(0);
    setSelectedIds(new Set());
    setSelectAllLeadsMode(false);
    setSelectAllSnapshot(null);
    setSelectedClientIds(new Set());
    setSelectAllClientsMode(false);
    setSelectedRecruitIds(new Set());
    setSelectAllRecruitsMode(false);
    setBulkAssignOpen(false);
    setBulkStatusOpen(false);
    setDownlineAgentIds((prev) => {
      if (prev.length === 0) return prev;
      const allowed = new Set(agentFilterOptions.map((a) => a.id));
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Non-destructive notice if the saved scope preference couldn't load (Contacts stays on My Contacts).
  useEffect(() => {
    if (scopePrefError) {
      toast.error("Couldn't load your saved Contacts view; showing My Contacts.", { duration: 4000 });
    }
  }, [scopePrefError]);

  // Refresh leads + import history when returning from the /contacts/import page
  useEffect(() => {
    const state = location.state as Record<string, unknown> | null;
    if (state?.importCompleted) {
      fetchData({ silent: true });
      fetchImportHistory();
    }
  }, [location.state]);

  // Auto-open a contact modal when navigated with openContactId state
  useEffect(() => {
    const state = location.state as Record<string, unknown> | null;
    const openContactId = state?.openContactId;
    if (openContactId && typeof openContactId === "string" && leads.length > 0) {
      const match = leads.find(l => l.id === openContactId);
      if (match) openContact("lead", match);
    }
  }, [location.state, leads]);

  // Sync contact view state with URL parameters (handles initial load, browser back button, and dynamic deep links)
  useEffect(() => {
    // Support legacy '?id=' format from older notifications alongside the standard '?contact='
    const contactId = searchParams.get("contact") || searchParams.get("id");
    
    // Always keep pendingContactId in sync for `fetchData` to use as a fallback during pagination/filters
    pendingContactId.current = contactId;

    if (!contactId) {
      // If contact param is missing, clear all selected contact states to unmount the detail view
      setSelectedLead(null);
      setSelectedClient(null);
      setSelectedRecruit(null);
      setSelectedAgent(null);
      return;
    }

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

    if (loading) return;

    let isCancelled = false;
    leadsSupabaseApi.getById(contactId).then(res => {
      if (isCancelled) return;
      setSelectedLead(res.lead);
      pendingContactId.current = null;
    }).catch(() => {
      if (isCancelled) return;
      clientsSupabaseApi.getById(contactId).then(client => {
        if (isCancelled) return;
        setSelectedClient(client);
        pendingContactId.current = null;
      }).catch(() => {
        if (isCancelled) return;
        recruitsSupabaseApi.getById(contactId).then(recruit => {
          if (isCancelled) return;
          setSelectedRecruit(recruit);
          pendingContactId.current = null;
        }).catch(() => {
          if (!isCancelled) {
            console.warn("Deep-link contact not found:", contactId);
            pendingContactId.current = null;
          }
        });
      });
    });

    return () => { isCancelled = true; };
  }, [searchParams, leads, clients, recruits, agents, loading]);

  // ===== Lead CRUD =====
  /**
   * Enforces Required Fields + Duplicate Detection settings for manual contact saves.
   * Returns true if the save may proceed (locked, optional, and warn+confirmed); false otherwise.
   * Resolves only after the user has answered any "warn" prompt.
   */
  const enforceContactPreSave = useCallback(
    async (params: {
      contactType: "lead" | "client" | "recruit";
      entity: Record<string, unknown>;
      excludeId?: string | null;
      assignedAgentId?: string | null;
    }): Promise<boolean> => {
      if (!organizationId) {
        toast.error("Could not determine organization.");
        return false;
      }

      const requiredFieldsSetting =
        params.contactType === "lead"
          ? cmsSettings?.requiredFieldsLead
          : params.contactType === "client"
            ? cmsSettings?.requiredFieldsClient
            : cmsSettings?.requiredFieldsRecruit;

      const missing = computeMissingRequired({
        contactType: params.contactType,
        entity: params.entity,
        requiredFieldsSetting,
        activeCustomFields,
        enforceCustomFields: false,
      });
      if (missing.length > 0) {
        toast.error(`Missing required fields: ${missing.join(", ")}`);
        return false;
      }

      const rule: DuplicateRule = (cmsSettings?.duplicateDetectionRule ?? "phone_or_email") as DuplicateRule;
      const scope: DuplicateScope = (cmsSettings?.duplicateDetectionScope ?? "all_agents") as DuplicateScope;
      const manualAction: ManualAction = (cmsSettings?.manualAction ?? "warn") as ManualAction;
      const table: DuplicateContactType =
        params.contactType === "lead" ? "leads" : params.contactType === "client" ? "clients" : "recruits";

      let matches: Awaited<ReturnType<typeof findDuplicates>> = [];
      try {
        matches = await findDuplicates({
          table,
          organizationId,
          rule,
          scope,
          phone: (params.entity.phone as string) ?? null,
          email: (params.entity.email as string) ?? null,
          assignedAgentId: params.assignedAgentId ?? (params.entity.assignedAgentId as string) ?? null,
          excludeId: params.excludeId ?? null,
        });
      } catch (e) {
        console.error("Duplicate detection failed:", e);
        // Don't block save on a detection lookup failure.
        return true;
      }

      if (matches.length === 0 || manualAction === "allow") return true;

      if (manualAction === "block") {
        toast.error(`Duplicate contact found: ${describeDuplicate(matches[0])}. Save blocked by agency settings.`);
        return false;
      }

      return await new Promise<boolean>((resolve) => {
        setDuplicatePrompt({
          label: `${matches.length} possible duplicate${matches.length === 1 ? "" : "s"} found`,
          description: matches.slice(0, 5).map(describeDuplicate).join("\n"),
          onConfirm: () => {
            setDuplicatePrompt(null);
            resolve(true);
          },
          onCancel: () => {
            setDuplicatePrompt(null);
            resolve(false);
          },
        });
      });
    },
    [organizationId, cmsSettings, activeCustomFields],
  );

  const handleAddLead = async (data: Partial<Lead>, meta?: AddLeadSaveMeta) => {
    const leadSource =
      String(data.leadSource ?? "").trim() ||
      allLeadSources[0] ||
      "Other";
    const ownerId = meta?.assignToAgentId ?? user?.id ?? "";
    if (!ownerId) {
      toast.error("Could not determine assignee.");
      return;
    }

    const okToSave = await enforceContactPreSave({
      contactType: "lead",
      entity: { ...data, leadSource, assignedAgentId: ownerId },
      assignedAgentId: ownerId,
    });
    if (!okToSave) return;

    const row = await leadsSupabaseApi.create(
      {
        ...data,
        leadScore: data.leadScore ?? 5,
        assignedAgentId: ownerId,
        userId: ownerId,
        leadSource,
        status: (data.status as LeadStatus) || "New",
      } as unknown as Omit<Lead, "id" | "createdAt" | "updatedAt">,
      organizationId
    );

    if (meta?.campaignId?.trim()) {
      try {
        const { skipped } = await addLeadsToCampaignBatched(meta.campaignId.trim(), [row.id]);
        if (skipped > 0) {
          toast.message("Lead saved, but campaign rules skipped adding it to that queue.", { duration: 5000 });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        toast.error(`Lead saved, but campaign attach failed: ${msg}`);
      }
    }

    toast.success("Lead added successfully");
    fetchData();
  };

  const handleUpdateLead = async (id: string, data: Partial<Lead>) => {
    try {
      // Only run required/duplicate checks when phone or email is changing.
      const changesPhoneOrEmail = data.phone !== undefined || data.email !== undefined;
      if (changesPhoneOrEmail) {
        const current = leads.find((l) => l.id === id);
        const okToSave = await enforceContactPreSave({
          contactType: "lead",
          entity: { ...(current ?? {}), ...data },
          excludeId: id,
          assignedAgentId: data.assignedAgentId ?? current?.assignedAgentId ?? null,
        });
        if (!okToSave) return;
      }
      const updated = await leadsSupabaseApi.update(id, data);
      const leavesFilteredView =
        Boolean(statusFilter) && data.status !== undefined && updated.status !== statusFilter;
      setLeads(prev => {
        const mapped = prev.map(l => (l.id === id ? updated : l));
        if (leavesFilteredView) return mapped.filter(l => l.id !== id);
        return mapped;
      });
      if (leavesFilteredView) setLeadsTotalCount(c => Math.max(0, c - 1));
      setSelectedLead(prev => (prev?.id === id ? updated : prev));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Update failed";
      toast.error(msg);
    }
  };

  const handleKanbanStatusChange = async (id: string, newStatus: string) => {
    // Status-only move (no duplicate-detection path). We do NOT optimistically
    // move the card in Kanban state — the board is refetched so counts/columns
    // reflect server truth, and on failure the card snaps back to its real
    // column (no stale local illusion). The table page array + selected detail
    // are kept in sync for when the user switches back to the list.
    try {
      if (tab === "Leads") {
        const updated = await leadsSupabaseApi.update(id, { status: newStatus as LeadStatus });
        setLeads(prev => prev.map(l => (l.id === id ? updated : l)));
        setSelectedLead(prev => (prev?.id === id ? updated : prev));
        toast.success(`Moved to ${newStatus}`);
      } else if (tab === "Recruits") {
        const updated = await recruitsSupabaseApi.update(id, { status: newStatus });
        setRecruits(prev => prev.map(r => (r.id === id ? updated : r)));
        setSelectedRecruit(prev => (prev?.id === id ? updated : prev));
        toast.success(`Moved to ${newStatus}`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      void fetchKanban({ silent: true });
    }
  };

  const handleDeleteLead = async (id: string) => {
    try {
      await leadsSupabaseApi.delete(id);
      setLeads(prev => prev.filter(l => l.id !== id));
      setLeadsTotalCount(c => Math.max(0, c - 1));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      const openId = searchParams.get("contact");
      if (openId === id || selectedLead?.id === id) closeContact();
      toast.success("Lead deleted");
      void fetchData({ silent: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
      void fetchData({ silent: true });
    }
  };

  // ----- Canonical select-all payloads (Contacts Build 2) -----
  const currentLeadUiFilters = (): LeadUiFilters => ({
    scope,
    agentIds: downlineAgentIds.length > 0 ? downlineAgentIds : undefined,
    search: searchQuery,
    status: statusFilter,
    source: sourceFilter,
    state: stateFilter,
    startDate: startDate?.toISOString(),
    endDate: endDate?.toISOString(),
    timezoneGroups: timezoneFilters,
    callableNow: callableNowFilter,
    attemptBuckets: attemptCountFilters,
    lastDisposition: lastDispositionFilter,
    sortColumn: leadSortColumnToCanonical(sortCol),
    sortDirection: sortDir,
  });

  // Enter select-all-across-pages for Leads, freezing the exact filter payload
  // (incl. callable-now states) so a later bulk action cannot drift if the clock
  // crosses a calling-window boundary.
  const enterSelectAllLeads = () => {
    const frozenCallableStates = callableNowFilter ? resolveCallableStates() : null;
    setSelectAllSnapshot(buildLeadFilterPayload({ ...currentLeadUiFilters(), frozenCallableStates }));
    setSelectAllLeadsMode(true);
  };
  const exitSelectAllLeads = () => {
    setSelectAllLeadsMode(false);
    setSelectAllSnapshot(null);
    setSelectedIds(new Set());
  };
  const activeLeadSelectAllPayload = (): LeadFilterPayload =>
    selectAllSnapshot ?? buildLeadFilterPayload(currentLeadUiFilters());

  const ownerAgentIdsForBulk = () =>
    resolveOwnerAgentIds({
      scope,
      userId: user?.id,
      teamAgentIds,
      explicitAgentIds: downlineAgentIds.length > 0 ? downlineAgentIds : undefined,
    });
  const clientSelectAllFilters = () => ({
    search: searchQuery || undefined,
    state: stateFilter || undefined,
    policyType: policyTypeFilter || undefined,
    assignedAgentIds: ownerAgentIdsForBulk(),
    sortColumn: clientSortColumnToCanonical(sortCol),
    sortDirection: sortDir,
  });
  const recruitSelectAllFilters = () => ({
    search: searchQuery || undefined,
    state: stateFilter || undefined,
    assignedAgentIds: ownerAgentIdsForBulk(),
    sortColumn: recruitSortColumnToCanonical(sortCol),
    sortDirection: sortDir,
  });

  const handleOpenAddToCampaign = async () => {
    if (tab === "Leads") {
      setCampaignIdsLoading(true);
      try {
        if (selectAllLeadsMode) {
          // Exactly the filtered Lead set — same canonical payload as the table/count.
          const ids = await leadsSupabaseApi.getAllLeadIdsMatching(activeLeadSelectAllPayload());
          setCampaignLeadIds(ids);
        } else {
          setCampaignLeadIds([...selectedIds]);
        }
        setAddToCampaignOpen(true);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Could not load selected leads");
      } finally {
        setCampaignIdsLoading(false);
      }
    } else {
      setCampaignLeadIds(null);
      setAddToCampaignOpen(true);
    }
  };

  const handleBulkDeleteLeads = async () => {
    if (selectAllLeadsMode) {
      try {
        const deleted = await leadsSupabaseApi.deleteAllMatching(activeLeadSelectAllPayload());
        exitSelectAllLeads();
        toast.success(`Deleted ${deleted} lead${deleted === 1 ? "" : "s"}.`, { duration: 3000, position: "bottom-right" });
        void fetchData({ silent: true });
      } catch (e: unknown) {
        // Keep selection; surface failure (some chunks may have committed — refetch shows truth).
        toast.error(e instanceof Error ? e.message : "Bulk delete failed");
        void fetchData({ silent: true });
      }
      return;
    }
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      for (const id of ids) {
        await leadsSupabaseApi.delete(id);
      }
      setLeads(prev => prev.filter(l => !ids.includes(l.id)));
      setLeadsTotalCount(c => Math.max(0, c - ids.length));
      setSelectedIds(new Set());
      const openId = searchParams.get("contact");
      if ((openId && ids.includes(openId)) || (selectedLead && ids.includes(selectedLead.id))) closeContact();
      toast.success(`Deleted ${ids.length} lead${ids.length === 1 ? "" : "s"}.`, { duration: 3000, position: "bottom-right" });
      void fetchData({ silent: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Bulk delete failed";
      toast.error(msg);
      void fetchData({ silent: true });
    }
  };

  const handleBulkStatusChange = async (status: LeadStatus) => {
    if (selectAllLeadsMode) {
      try {
        const updated = await leadsSupabaseApi.updateStatusAllMatching(status, activeLeadSelectAllPayload());
        toast.success(`Updated status for ${updated} lead${updated === 1 ? "" : "s"}.`, { duration: 3000, position: "bottom-right" });
        exitSelectAllLeads();
        setBulkStatusOpen(false);
        void fetchData({ silent: true });
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Bulk update failed");
      }
      return;
    }
    const ids = [...selectedIds];
    const count = ids.length;
    try {
      for (const id of ids) {
        await leadsSupabaseApi.update(id, { status });
      }
      const leavesFilteredView = Boolean(statusFilter) && status !== statusFilter;
      setLeads(prev => {
        let next = prev.map(l => (ids.includes(l.id) ? { ...l, status } : l));
        if (leavesFilteredView) next = next.filter(l => !ids.includes(l.id));
        return next;
      });
      if (leavesFilteredView) setLeadsTotalCount(c => Math.max(0, c - count));
      setSelectedLead(prev => (prev && ids.includes(prev.id) ? { ...prev, status } : prev));
      toast.success(`Updated status for ${count} leads.`, { duration: 3000, position: "bottom-right" });
      setSelectedIds(new Set());
      setBulkStatusOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Bulk update failed";
      toast.error(msg);
    }
  };

  const handleBulkAssign = async (agentId: string, agentName: string) => {
    if (!agentId) {
      toast.error("Could not determine the selected agent.");
      return;
    }
    const finish = (n: number) => {
      setBulkAssignOpen(false);
      toast.success(`Assigned ${n} ${tab.toLowerCase()} to ${agentName}.`, { duration: 3000, position: "bottom-right" });
      void fetchData({ silent: true });
    };
    try {
      if (tab === "Leads") {
        const ids = selectAllLeadsMode
          ? await leadsSupabaseApi.getAllLeadIdsMatching(activeLeadSelectAllPayload())
          : [...selectedIds];
        if (ids.length === 0) return;
        const n = await leadsSupabaseApi.bulkAssign(ids, agentId);
        const idSet = new Set(ids);
        setLeads(prev => prev.map(l => (idSet.has(l.id) ? { ...l, assignedAgentId: agentId, userId: agentId } : l)));
        setSelectedLead(prev => (prev && idSet.has(prev.id) ? { ...prev, assignedAgentId: agentId, userId: agentId } : prev));
        exitSelectAllLeads();
        finish(n);
      } else if (tab === "Clients") {
        const ids = selectAllClientsMode
          ? await clientsSupabaseApi.getAllIdsMatching(clientSelectAllFilters())
          : [...selectedClientIds];
        if (ids.length === 0) return;
        const n = await clientsSupabaseApi.bulkAssign(ids, agentId);
        const idSet = new Set(ids);
        setClients(prev => prev.map(c => (idSet.has(c.id) ? { ...c, assignedAgentId: agentId } : c)));
        setSelectedClient(prev => (prev && idSet.has(prev.id) ? { ...prev, assignedAgentId: agentId } : prev));
        setSelectedClientIds(new Set());
        setSelectAllClientsMode(false);
        finish(n);
      } else if (tab === "Recruits") {
        const ids = selectAllRecruitsMode
          ? await recruitsSupabaseApi.getAllIdsMatching(recruitSelectAllFilters())
          : [...selectedRecruitIds];
        if (ids.length === 0) return;
        const n = await recruitsSupabaseApi.bulkAssign(ids, agentId);
        const idSet = new Set(ids);
        setRecruits(prev => prev.map(r => (idSet.has(r.id) ? { ...r, assignedAgentId: agentId } : r)));
        setSelectedRecruit(prev => (prev && idSet.has(prev.id) ? { ...prev, assignedAgentId: agentId } : prev));
        setSelectedRecruitIds(new Set());
        setSelectAllRecruitsMode(false);
        finish(n);
      }
    } catch (e: unknown) {
      // Failure: keep the selection + select-all mode and previous ownership; never show success.
      toast.error(e instanceof Error ? e.message : "Assignment failed");
    }
  };

  // ===== Client CRUD =====
  const handleAddClient = async (data: Partial<Client>) => {
    if (!user?.id || !organizationId) {
      toast.error("Could not determine your user or organization. Please sign in again.");
      return;
    }
    const ownerId = user.id;
    const okToSave = await enforceContactPreSave({
      contactType: "client",
      entity: { ...data, assignedAgentId: ownerId },
      assignedAgentId: ownerId,
    });
    if (!okToSave) return;
    const saved = await clientsSupabaseApi.create(
      { ...data, assignedAgentId: ownerId } as unknown as Omit<Client, "id" | "createdAt" | "updatedAt">,
      organizationId,
    );
    setClients(prev => [saved, ...prev]);
    setClientsTotalCount(c => c + 1);
    toast.success("Client added successfully");
    void fetchData({ silent: true });
  };

  const handleDeleteClient = async (id: string) => {
    try {
      await clientsSupabaseApi.delete(id);
      setClients(prev => prev.filter(c => c.id !== id));
      setClientsTotalCount(c => Math.max(0, c - 1));
      setSelectedClientIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      const openId = searchParams.get("contact");
      if (openId === id || selectedClient?.id === id) closeContact();
      toast.success("Client deleted");
      void fetchData({ silent: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
      void fetchData({ silent: true });
    }
  };

  const handleBulkDeleteClients = async () => {
    if (selectAllClientsMode) {
      try {
        const deleted = await clientsSupabaseApi.deleteAllMatching(clientSelectAllFilters());
        setSelectedClientIds(new Set());
        setSelectAllClientsMode(false);
        toast.success(`Deleted ${deleted} client${deleted === 1 ? "" : "s"}.`, { duration: 3000, position: "bottom-right" });
        void fetchData({ silent: true });
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Bulk delete failed");
        void fetchData({ silent: true });
      }
      return;
    }
    const ids = [...selectedClientIds];
    if (ids.length === 0) return;
    try {
      for (const id of ids) {
        await clientsSupabaseApi.delete(id);
      }
      setClients(prev => prev.filter(c => !ids.includes(c.id)));
      setClientsTotalCount(c => Math.max(0, c - ids.length));
      setSelectedClientIds(new Set());
      const openId = searchParams.get("contact");
      if ((openId && ids.includes(openId)) || (selectedClient && ids.includes(selectedClient.id))) closeContact();
      toast.success(`Deleted ${ids.length} client${ids.length === 1 ? "" : "s"}.`, { duration: 3000, position: "bottom-right" });
      void fetchData({ silent: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Bulk delete failed";
      toast.error(msg);
      void fetchData({ silent: true });
    }
  };

  // ===== Recruit CRUD =====
  const handleAddRecruit = async (data: Partial<Recruit>) => {
    if (!user?.id || !organizationId) {
      toast.error("Could not determine your user or organization. Please sign in again.");
      return;
    }
    const ownerId = user.id;
    const okToSave = await enforceContactPreSave({
      contactType: "recruit",
      entity: { ...data, assignedAgentId: ownerId },
      assignedAgentId: ownerId,
    });
    if (!okToSave) return;
    await recruitsSupabaseApi.create({ ...data, assignedAgentId: ownerId } as unknown as Omit<Recruit, "id" | "createdAt" | "updatedAt">, organizationId);
    toast.success("Recruit added successfully");
    fetchData();
  };

  const handleDeleteRecruit = async (id: string) => {
    try {
      await recruitsSupabaseApi.delete(id);
      setRecruits(prev => prev.filter(r => r.id !== id));
      setRecruitsTotalCount(c => Math.max(0, c - 1));
      setSelectedRecruitIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      const openId = searchParams.get("contact");
      if (openId === id || selectedRecruit?.id === id) closeContact();
      toast.success("Recruit deleted");
      void fetchData({ silent: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
      void fetchData({ silent: true });
    }
  };

  const handleBulkDeleteRecruits = async () => {
    if (selectAllRecruitsMode) {
      try {
        const deleted = await recruitsSupabaseApi.deleteAllMatching(recruitSelectAllFilters());
        setSelectedRecruitIds(new Set());
        setSelectAllRecruitsMode(false);
        toast.success(`Deleted ${deleted} recruit${deleted === 1 ? "" : "s"}.`, { duration: 3000, position: "bottom-right" });
        void fetchData({ silent: true });
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Bulk delete failed");
        void fetchData({ silent: true });
      }
      return;
    }
    const ids = [...selectedRecruitIds];
    if (ids.length === 0) return;
    try {
      for (const id of ids) {
        await recruitsSupabaseApi.delete(id);
      }
      setRecruits(prev => prev.filter(r => !ids.includes(r.id)));
      setRecruitsTotalCount(c => Math.max(0, c - ids.length));
      setSelectedRecruitIds(new Set());
      const openId = searchParams.get("contact");
      if ((openId && ids.includes(openId)) || (selectedRecruit && ids.includes(selectedRecruit.id))) closeContact();
      toast.success(`Deleted ${ids.length} recruit${ids.length === 1 ? "" : "s"}.`, { duration: 3000, position: "bottom-right" });
      void fetchData({ silent: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Bulk delete failed";
      toast.error(msg);
      void fetchData({ silent: true });
    }
  };

  const handleBulkRecruitStatusChange = async (status: string) => {
    const ids = [...selectedRecruitIds];
    const count = ids.length;
    try {
      for (const id of ids) {
        await recruitsSupabaseApi.update(id, { status });
      }
      setRecruits(prev => prev.map(r => (ids.includes(r.id) ? { ...r, status } : r)));
      setSelectedRecruit(prev => (prev && ids.includes(prev.id) ? { ...prev, status } : prev));
      toast.success(`Updated status for ${count} recruits.`, { duration: 3000, position: "bottom-right" });
      setSelectedRecruitIds(new Set());
      setBulkStatusOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Bulk update failed";
      toast.error(msg);
    }
  };

  // NOTE: A former `handleBulkAgentStatusChange` was removed in Contacts Build 1 — it displayed a
  // success toast with no persistence (no safe Agents-status write exists in this build's API/permission
  // model) and was never wired into any control. Agents administration is out of scope here.

  // ===== Selection helpers =====
  const toggleSelect = (id: string) => { setSelectAllLeadsMode(false); setSelectAllSnapshot(null); setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const toggleAll = () => { setSelectAllLeadsMode(false); setSelectAllSnapshot(null); setSelectedIds(prev => prev.size === leads.length ? new Set() : new Set(leads.map(l => l.id))); };
  const toggleClientSelect = (id: string) => { setSelectAllClientsMode(false); setSelectedClientIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const toggleAllClients = () => { setSelectAllClientsMode(false); setSelectedClientIds(prev => prev.size === clients.length ? new Set() : new Set(clients.map(c => c.id))); };
  const toggleRecruitSelect = (id: string) => { setSelectAllRecruitsMode(false); setSelectedRecruitIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const toggleAllRecruits = () => { setSelectAllRecruitsMode(false); setSelectedRecruitIds(prev => prev.size === recruits.length ? new Set() : new Set(recruits.map(r => r.id))); };
  const toggleAgentSelect = (id: string) => setSelectedAgentIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAllAgents = () => setSelectedAgentIds(prev => prev.size === agents.length ? new Set() : new Set(agents.map(u => u.id)));

  const isAllSelected = selectedIds.size === leads.length && leads.length > 0;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < leads.length;

  const tabs = ["Leads", "Clients", "Recruits", "Agents"] as const;

  const isColVisible = (key: ColumnKey) => visibleCols.has(key);

  // Render cell value for a lead
  const renderCell = (l: Lead, key: ColumnKey) => {
    switch (key) {
      case "name": return <span className="font-medium text-foreground truncate block">{l.firstName} {l.lastName}</span>;
      case "phone": return <span className="text-foreground font-mono text-sm truncate block">{formatPhoneNumber(l.phone)}</span>;
      case "email": return <span className="text-muted-foreground truncate block">{l.email}</span>;
      case "state": return <span className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded-full font-semibold border border-blue-500/20 uppercase tracking-tighter shrink-0">{formatStateToAbbreviation(l.state)}</span>;
      case "status": return (
        <div className="relative group/status inline-block">
          <select
            value={l.status}
            disabled={!hasContactsPermission("contacts.leads.update_status")}
            onChange={(e) => {
              e.stopPropagation();
              handleUpdateLead(l.id, { status: e.target.value as LeadStatus });
              toast.success(`Status changed to ${e.target.value}`);
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2 py-0.5 rounded-full font-medium appearance-none cursor-pointer disabled:cursor-default border-none outline-none pr-5"
            style={getStatusColorStyle(getLeadStatusColor(l.status))}
          >
            {Object.keys(leadStageColors).map(s => <option key={s} value={s} style={{ color: 'inherit', backgroundColor: 'var(--background)' }}>{normalizeStatusDisplay(s)}</option>)}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover/status:opacity-60 transition-opacity" />
        </div>
      );
      case "source": return renderLeadSourceBadge(l.leadSource);
      case "agent": {
        const name = getAgentName(l.assignedAgentId, agentProfiles);
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">{name}</span>;
      }
      case "dob": return <span className="text-muted-foreground text-xs">{formatDOB(l.dateOfBirth) || "—"}</span>;
      case "bestTime": return <span className="text-muted-foreground text-xs">{l.bestTimeToCall || "—"}</span>;
      case "leadSourceAlias": return renderLeadSourceBadge(l.leadSource);
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
      case "premium": return <span className="text-foreground">{c.premiumAmount || "—"}</span>;
      case "faceAmount": return <span className="text-foreground">{c.faceAmount || "—"}</span>;
      case "issueDate": return <span className="text-muted-foreground">{c.issueDate ? formatDate(c.issueDate) : "—"}</span>;
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
            disabled={!hasContactsPermission("contacts.leads.update_status")}
            onChange={(e) => {
              e.stopPropagation();
              const nextStatus = e.target.value;
              recruitsSupabaseApi.update(r.id, { status: nextStatus }).then((updated) => {
                setRecruits(prev => prev.map(x => (x.id === updated.id ? updated : x)));
                setSelectedRecruit(prev => (prev?.id === r.id ? updated : prev));
                toast.success(`Status changed to ${nextStatus}`);
              }).catch((err: unknown) => {
                toast.error(err instanceof Error ? err.message : "Update failed");
              });
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2 py-0.5 rounded-full font-medium appearance-none cursor-pointer disabled:cursor-default border-none outline-none pr-5"
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
      case "commission": return <CommissionGate metric="View Others' Commission Percentage"><span className="text-foreground truncate block">{p?.commissionLevel}</span></CommissionGate>;
      case "role": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${u.role === "Admin" ? "bg-primary/10 text-primary" : u.role === "Team Leader" ? "bg-info/10 text-info" : "bg-success/10 text-success"}`}>{u.role}</span>;
      case "status": return <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${u.status === "Active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{u.status}</span>;
      default: return null;
    }
  };

  const colAlign = (_key: string) => "text-left";

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

  const renderActiveFilters = () => {
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
      const pool = [...agentFilterOptions, ...agentProfiles, ...teamAgents];
      const names = downlineAgentIds.map(id => {
        const a = pool.find(ag => ag.id === id);
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
    return (
    <div className="relative" ref={columnsRef}>
      <button onClick={() => setColumnsOpen(!columnsOpen)} className="h-10 px-4 rounded-xl bg-card border border-border text-foreground text-sm flex items-center gap-2 hover:bg-muted transition-colors duration-150 shadow-sm">
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
  const renderBulkActions = (count: number, onDeselect: () => void, options: { showAssign?: boolean; showStatus?: boolean; statusList?: string[]; onStatusChange?: (s: string) => void }) => (
    <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 flex items-center gap-3 animate-in slide-in-from-top-2 fade-in duration-200">
      <span className="text-sm font-medium text-primary">{count} selected</span>
      <div className="w-px h-5 bg-primary/20" />
      {options.showAssign && hasContactsPermission("contacts.leads.bulk_assign") && (
        <div className="relative">
          <button onClick={() => { setBulkAssignOpen(!bulkAssignOpen); setBulkStatusOpen(false); }} className="text-sm text-foreground hover:text-primary transition-colors">Assign Agent</button>
          {bulkAssignOpen && (
            <div className="absolute top-full mt-1 left-0 w-48 bg-card border border-border rounded-lg shadow-lg p-1 z-[120] max-h-64 overflow-y-auto">
              {assignableAgentsForAddLead.length === 0 ? (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">No agents available to assign</div>
              ) : assignableAgentsForAddLead.map(a => (
                <button key={a.id} onClick={() => handleBulkAssign(a.id, `${a.firstName} ${a.lastName}`)} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors">{a.firstName} {a.lastName}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {options.showStatus && options.statusList && options.onStatusChange && hasContactsPermission("contacts.leads.bulk_status") && (
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
      {hasContactsPermission(`contacts.${tab === "Clients" ? "clients" : tab === "Recruits" ? "recruits" : "leads"}.delete`) && (
        <button onClick={() => setBulkDeleteOpen(true)} className="text-sm text-red-500 hover:text-red-400 transition-colors">Delete</button>
      )}
      {tab === "Leads" && hasContactsPermission("contacts.leads.add_to_campaign") && (
        <button
          type="button"
          disabled={campaignIdsLoading}
          onClick={() => void handleOpenAddToCampaign()}
          className="text-sm text-foreground hover:text-primary flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          {campaignIdsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Megaphone className="w-3.5 h-3.5" />}
          Add to Campaign
        </button>
      )}
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
  const renderActionMenu = (id: string, onEdit: () => void, onDelete: () => void) => {
    const permBase = tab === "Clients" ? "clients" : tab === "Recruits" ? "recruits" : "leads";
    const canEditRow = hasContactsPermission(`contacts.${permBase}.edit`);
    const canDeleteRow = hasContactsPermission(`contacts.${permBase}.delete`);
    // Leads always expose Convert (hardcoded universal action), so the menu is never empty there.
    const hasAnyAction = canEditRow || canDeleteRow || tab === "Leads";
    return (
    <div className="relative" ref={actionMenuId === id ? actionMenuRef : undefined}>
      <button onClick={(e) => { e.stopPropagation(); setActionMenuId(actionMenuId === id ? null : id); }} className="text-muted-foreground hover:text-foreground"><MoreHorizontal className="w-4 h-4" /></button>
      {actionMenuId === id && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-card border border-border rounded-lg shadow-lg p-1 z-[120]">
          {canEditRow && (
            <button onClick={(e) => { e.stopPropagation(); setActionMenuId(null); onEdit(); }} className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md flex items-center gap-2 transition-colors"><Pencil className="w-3.5 h-3.5" />Edit</button>
          )}
          {/* Conversion is intentionally NOT permission-gated (hardcoded universal action). */}
          {tab === "Leads" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActionMenuId(null);
                const lead = leads.find(l => l.id === id);
                // Launch the real conversion flow (not just open the contact).
                if (lead) setConvertLead(lead);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 dark:hover:bg-green-900/10 rounded-md flex items-center gap-2 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />Convert
            </button>
          )}
          {canDeleteRow && <button onClick={(e) => { e.stopPropagation(); setActionMenuId(null); onDelete(); }} className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-accent rounded-md flex items-center gap-2 transition-colors"><Trash2 className="w-3.5 h-3.5" />Delete</button>}
          {!hasAnyAction && (
            <div className="px-3 py-1.5 text-sm text-muted-foreground">No actions available</div>
          )}
        </div>
      )}
    </div>
    );
  };

  // Determine filter options per tab
  const filterStatuses = tab === "Leads" 
    ? Object.keys(leadStageColors)
    : tab === "Recruits" 
      ? Object.keys(recruitStageColors)
      : [];

  // Which add modal contact type
  const addContactType = tab === "Clients" ? "Client" : tab === "Recruits" ? "Recruit" : "Lead";
  const handleAddContact = tab === "Clients" ? handleAddClient : tab === "Recruits" ? handleAddRecruit : handleAddLead;
  // Contacts Build 5: create gating. Leads/Recruits have create keys; Clients have
  // no create key (manual client create stays available — not agency-configurable).
  const canAddCurrentContact =
    tab === "Clients"
      ? true
      : tab === "Recruits"
        ? hasContactsPermission("contacts.recruits.create")
        : hasContactsPermission("contacts.leads.create");

  // Contacts Build 6 — empty/error-state helpers. Distinguish "filtered to zero"
  // (offer Clear filters) from "no records yet" (offer the add action), and surface
  // a recoverable load error instead of a blank list that reads like "no data".
  const hasActiveContactFilters = Boolean(
    searchQuery || statusFilter || sourceFilter || stateFilter || startDate || endDate ||
    timezoneFilters.length || callableNowFilter || attemptCountFilters.length ||
    lastDispositionFilter || policyTypeFilter || downlineAgentIds.length,
  );
  const clearAllFilters = () => {
    setSearchQuery(""); setStatusFilter(""); setSourceFilter(""); setStateFilter("");
    setStartDate(undefined); setEndDate(undefined); setTimezoneFilters([]);
    setCallableNowFilter(false); setAttemptCountFilters([]); setLastDispositionFilter("");
    setPolicyTypeFilter(""); setDownlineAgentIds([]);
  };
  const renderEmptyState = (config: {
    Icon: React.ComponentType<{ className?: string }>;
    noun: string;
    noDataTitle: string;
    noDataBody: string;
    addLabel?: string;
    canAdd?: boolean;
  }) => {
    const { Icon, noun, noDataTitle, noDataBody, addLabel, canAdd } = config;
    if (hasActiveContactFilters) {
      return (
        <div className="text-center py-12">
          <Icon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">No {noun}s match your filters</h3>
          <p className="text-sm text-muted-foreground mb-4">Try adjusting or clearing your filters to see more.</p>
          <button onClick={clearAllFilters} className="px-4 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-accent sidebar-transition">Clear filters</button>
        </div>
      );
    }
    return (
      <div className="text-center py-12">
        <Icon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold text-foreground mb-1">{noDataTitle}</h3>
        <p className="text-sm text-muted-foreground mb-4">{noDataBody}</p>
        {canAdd && addLabel && <button onClick={() => setAddModalOpen(true)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">{addLabel}</button>}
      </div>
    );
  };
  const renderLoadErrorCard = () => (
    <div className="text-center py-12">
      <AlertTriangle className="w-12 h-12 text-destructive/80 mx-auto mb-3" />
      <h3 className="font-semibold text-foreground mb-1">Couldn't load {tab.toLowerCase()}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">{loadError}</p>
      <button onClick={() => fetchData()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Retry</button>
    </div>
  );

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
        {(tab === "Leads" || tab === "Clients" || tab === "Recruits") && (
          <ContactScopeSelector
            scope={scope}
            // "unassigned" is a Leads-only org-pool scope; hide it on Clients/Recruits.
            availableScopes={tab === "Leads" ? availableScopes : availableScopes.filter((s) => s !== "unassigned")}
            onScopeChange={setScope}
          />
        )}
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
          downlineAgents={agentFilterOptions}
          filterStatuses={filterStatuses}
          leadSources={allLeadSources}
          scope={scope}
          disableStatus={view === "kanban"}
        />
        <div className="flex-1" />
        {tab === "Leads" && hasContactsPermission("contacts.leads.import") && <button onClick={() => navigate('/contacts/import')} className="h-10 px-4 rounded-xl bg-card text-foreground text-sm flex items-center gap-2 hover:bg-muted sidebar-transition border border-border shadow-sm"><Upload className="w-4 h-4" />Import CSV</button>}
        {tab !== "Agents" && tab !== "Import History" && canAddCurrentContact && <button onClick={() => setAddModalOpen(true)} className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition shadow-lg shadow-primary/20"><Plus className="w-4 h-4" />Add {addContactType}</button>}
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
          {/* Bulk Actions — select-all assign is restored (Build 2): the snapshot guarantees parity.
              Build 5: outer feature gate removed; each control is individually gated by the Contacts catalog. */}
          {(selectedIds.size > 0 || selectAllLeadsMode) && renderBulkActions(
            selectAllLeadsMode ? leadsTotalCount : selectedIds.size,
            exitSelectAllLeads,
            { showAssign: true, showStatus: true, statusList: filterStatuses, onStatusChange: (s) => handleBulkStatusChange(s as LeadStatus) }
          )}

          {/* Select-all-across-pages banner — true filtered total with scope wording. */}
          {isAllSelected && !selectAllLeadsMode && leadsTotalCount > PAGE_SIZE && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 text-center text-sm text-foreground">
              All {leads.length} leads on this page are selected.{" "}
              <button
                onClick={enterSelectAllLeads}
                className="text-primary font-medium hover:underline"
              >
                Select all {leadsTotalCount} {scopeLabel(scope)}
              </button>
            </div>
          )}
          {selectAllLeadsMode && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 text-center text-sm text-foreground">
              All {leadsTotalCount} {scopeLabel(scope)} are selected.{" "}
              <button
                onClick={exitSelectAllLeads}
                className="text-primary font-medium hover:underline"
              >
                Clear selection
              </button>
            </div>
          )}

          {/* Leads Table */}
          <div className="bg-card rounded-xl border">
            {loadError ? renderLoadErrorCard() : leads.length === 0 ? (
              renderEmptyState({
                Icon: Users,
                noun: "lead",
                noDataTitle: "No leads yet",
                noDataBody: "Add your first lead to start building your pipeline.",
                addLabel: "Add Lead",
                canAdd: canAddCurrentContact,
              })
            ) : (
              <>
              <div className="overflow-x-auto scrollbar-x-hover">
                <table className="min-w-full text-sm table-fixed">
                  <thead><tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="py-3 px-3" style={{ width: 40, minWidth: 40 }}>
                      <input type="checkbox" checked={isAllSelected} ref={el => { if (el) el.indeterminate = isIndeterminate; }} onChange={toggleAll} className="rounded" />
                    </th>
                    {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => renderSortHeader(col.key, col.label))}
                    <th className="py-3" style={{ width: 40, minWidth: 40 }}></th>
                  </tr></thead>
                  <tbody>
                    {leads.map(l => {
                      return (
                        <tr key={l.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedIds.has(l.id) ? "bg-primary/5" : ""} `} onClick={() => openContact("lead", l)}>
                          <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleSelect(l.id); }}><input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => { }} className="rounded" /></td>
                          {ALL_COLUMNS.filter(c => visibleCols.has(c.key)).map(col => (
                            <td key={col.key} className={`py-3 px-3 overflow-hidden ${colAlign(col.key)} `}>{renderCell(l, col.key)}</td>
                          ))}
                          <td className="py-3" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                            {renderActionMenu(l.id, () => setEditLead(l), () => setRowDeletePending({ kind: "lead", id: l.id, label: `${l.firstName} ${l.lastName}`.trim() || "this lead" }))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  {`${leadsTotalCount} ${scopeLabel(scope)} \u00B7 Page ${leadsPage + 1} of ${Math.ceil(leadsTotalCount / PAGE_SIZE) || 1}`}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={leadsPage === 0} onClick={() => { setLeadsPage(p => p - 1); exitSelectAllLeads(); }}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={leadsPage >= Math.ceil(leadsTotalCount / PAGE_SIZE) - 1} onClick={() => { setLeadsPage(p => p + 1); exitSelectAllLeads(); }}>Next</Button>
                </div>
              </div>
              </>
            )}
          </div>
        </>
      )}

      {/* LEADS Kanban */}
      {!loading && tab === "Leads" && view === "kanban" && (
        <ContactKanbanBoard
          tab="Leads"
          stages={leadKanban?.stages ?? []}
          pipelineStages={leadStages}
          perColumnLimit={leadKanban?.perColumnLimit ?? 50}
          agentProfiles={agentProfiles}
          loading={kanbanLoading}
          error={kanbanError}
          canDrag={hasContactsPermission("contacts.leads.update_status")}
          onStatusChange={handleKanbanStatusChange}
          onEdit={(c) => setEditLead(c as Lead)}
          onClick={(c) => openContact("lead", c as Lead)}
          onCall={(c) => {
            window.dispatchEvent(new CustomEvent("quick-call", {
              detail: { name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, contactId: c.id }
            }));
          }}
          onAddContact={() => setAddModalOpen(true)}
          renderLeadSourceBadge={renderLeadSourceBadge}
        />
      )}

      {/* ===== CLIENTS TAB ===== */}
      {!loading && tab === "Clients" && (
        <>
          {/* Build 5: outer feature gate removed; controls gated individually by the Contacts catalog. */}
          {(selectedClientIds.size > 0 || selectAllClientsMode) && renderBulkActions(
            selectAllClientsMode ? clientsTotalCount : selectedClientIds.size,
            () => { setSelectedClientIds(new Set()); setSelectAllClientsMode(false); },
            { showAssign: true }
          )}
          {selectedClientIds.size === clients.length && clients.length > 0 && !selectAllClientsMode && clientsTotalCount > PAGE_SIZE && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 text-center text-sm text-foreground">
              All {clients.length} clients on this page are selected.{" "}
              <button onClick={() => setSelectAllClientsMode(true)} className="text-primary font-medium hover:underline">
                Select all {clientsTotalCount} {scopeLabel(scope)}
              </button>
            </div>
          )}
          {selectAllClientsMode && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 text-center text-sm text-foreground">
              All {clientsTotalCount} {scopeLabel(scope)} are selected.{" "}
              <button onClick={() => { setSelectAllClientsMode(false); setSelectedClientIds(new Set()); }} className="text-primary font-medium hover:underline">
                Clear selection
              </button>
            </div>
          )}
          <div className="bg-card rounded-xl border">
            {loadError ? renderLoadErrorCard() : clients.length === 0 ? (
              renderEmptyState({
                Icon: ShieldCheck,
                noun: "client",
                noDataTitle: "No clients yet",
                noDataBody: "Convert leads to clients after policy sales, or add one manually.",
                addLabel: "Add Client",
                canAdd: true,
              })
            ) : (
              <>
              <div className="overflow-x-auto scrollbar-x-hover">
                <table className="min-w-full text-sm table-fixed">
                  <thead><tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="py-3 px-3" style={{ width: 40, minWidth: 40 }}>
                      <input type="checkbox" checked={selectedClientIds.size === clients.length && clients.length > 0} ref={el => { if (el) el.indeterminate = selectedClientIds.size > 0 && selectedClientIds.size < clients.length; }} onChange={toggleAllClients} className="rounded" />
                    </th>
                    {CLIENT_COLUMNS.filter(c => visibleClientCols.has(c.key)).map(col => renderSortHeader(col.key, col.label))}
                    <th className="py-3" style={{ width: 40, minWidth: 40 }}></th>
                  </tr></thead>
                  <tbody>
                    {clients.map(c => (
                      <tr key={c.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedClientIds.has(c.id) ? "bg-primary/5" : ""} `} onClick={() => openContact("client", c)}>
                        <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleClientSelect(c.id); }}><input type="checkbox" checked={selectedClientIds.has(c.id)} onChange={() => { }} className="rounded" /></td>
                        {CLIENT_COLUMNS.filter(col => visibleClientCols.has(col.key)).map(col => (
                          <td key={col.key} className={`py-3 px-3 overflow-hidden ${colAlign(col.key)} `}>{renderClientCell(c, col.key)}</td>
                        ))}
                        <td className="py-3" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                          {renderActionMenu(c.id, () => setEditClient(c), () => setRowDeletePending({ kind: "client", id: c.id, label: `${c.firstName} ${c.lastName}`.trim() || "this client" }))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  {`${clientsTotalCount} ${scopeLabel(scope)} \u00B7 Page ${clientsPage + 1} of ${Math.ceil(clientsTotalCount / PAGE_SIZE) || 1}`}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={clientsPage === 0} onClick={() => { setClientsPage(p => p - 1); setSelectedClientIds(new Set()); setSelectAllClientsMode(false); }}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={clientsPage >= Math.ceil(clientsTotalCount / PAGE_SIZE) - 1} onClick={() => { setClientsPage(p => p + 1); setSelectedClientIds(new Set()); setSelectAllClientsMode(false); }}>Next</Button>
                </div>
              </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ===== RECRUITS TAB ===== */}
      {!loading && tab === "Recruits" && (
        <>
          {/* Build 5: outer feature gate removed; controls gated individually by the Contacts catalog. */}
          {(selectedRecruitIds.size > 0 || selectAllRecruitsMode) && view === "table" && renderBulkActions(
            selectAllRecruitsMode ? recruitsTotalCount : selectedRecruitIds.size,
            () => { setSelectedRecruitIds(new Set()); setSelectAllRecruitsMode(false); },
            { showAssign: true, showStatus: true, statusList: filterStatuses, onStatusChange: handleBulkRecruitStatusChange }
          )}
          {view === "table" && selectedRecruitIds.size === recruits.length && recruits.length > 0 && !selectAllRecruitsMode && recruitsTotalCount > PAGE_SIZE && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 text-center text-sm text-foreground">
              All {recruits.length} recruits on this page are selected.{" "}
              <button onClick={() => setSelectAllRecruitsMode(true)} className="text-primary font-medium hover:underline">
                Select all {recruitsTotalCount} {scopeLabel(scope)}
              </button>
            </div>
          )}
          {view === "table" && selectAllRecruitsMode && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 text-center text-sm text-foreground">
              All {recruitsTotalCount} {scopeLabel(scope)} are selected.{" "}
              <button onClick={() => { setSelectAllRecruitsMode(false); setSelectedRecruitIds(new Set()); }} className="text-primary font-medium hover:underline">
                Clear selection
              </button>
            </div>
          )}
          {view === "kanban" ? (
            <ContactKanbanBoard
              tab="Recruits"
              stages={recruitKanban?.stages ?? []}
              pipelineStages={recruitStages}
              perColumnLimit={recruitKanban?.perColumnLimit ?? 50}
              agentProfiles={agentProfiles}
              loading={kanbanLoading}
              error={kanbanError}
              canDrag={hasContactsPermission("contacts.leads.update_status")}
              onStatusChange={handleKanbanStatusChange}
              onEdit={(c) => setEditRecruit(c as Recruit)}
              onClick={(c) => openContact("recruit", c as Recruit)}
              onCall={(c) => {
                window.dispatchEvent(new CustomEvent("quick-call", {
                  detail: { name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phone, contactId: c.id }
                }));
              }}
              onAddContact={() => setAddModalOpen(true)}
            />
          ) : (
          <div className="bg-card rounded-xl border">
            {loadError ? renderLoadErrorCard() : recruits.length === 0 ? (
              renderEmptyState({
                Icon: Users,
                noun: "recruit",
                noDataTitle: "No recruits yet",
                noDataBody: "Start building your recruit pipeline.",
                addLabel: "Add Recruit",
                canAdd: canAddCurrentContact,
              })
            ) : (
              <>
              <div className="overflow-x-auto scrollbar-x-hover">
                <table className="min-w-full text-sm table-fixed">
                  <thead><tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="py-3 px-3" style={{ width: 40, minWidth: 40 }}>
                      <input type="checkbox" checked={selectedRecruitIds.size === recruits.length && recruits.length > 0} ref={el => { if (el) el.indeterminate = selectedRecruitIds.size > 0 && selectedRecruitIds.size < recruits.length; }} onChange={toggleAllRecruits} className="rounded" />
                    </th>
                    {RECRUIT_COLUMNS.filter(c => visibleRecruitCols.has(c.key)).map(col => renderSortHeader(col.key, col.label))}
                    <th className="py-3" style={{ width: 40, minWidth: 40 }}></th>
                  </tr></thead>
                  <tbody>
                    {recruits.map(r => (
                      <tr key={r.id} className={`border-b last:border-0 hover:bg-accent/30 sidebar-transition cursor-pointer ${selectedRecruitIds.has(r.id) ? "bg-primary/5" : ""} `} onClick={() => openContact("recruit", r)}>
                        <td className="py-3 px-3" style={{ width: 40 }} onClick={e => { e.stopPropagation(); toggleRecruitSelect(r.id); }}><input type="checkbox" checked={selectedRecruitIds.has(r.id)} onChange={() => { }} className="rounded" /></td>
                        {RECRUIT_COLUMNS.filter(col => visibleRecruitCols.has(col.key)).map(col => (
                          <td key={col.key} className={`py-3 px-3 overflow-hidden ${colAlign(col.key)}`} style={{ width: columnWidths[tab]?.[col.key], minWidth: columnWidths[tab]?.[col.key] }}>{renderRecruitCell(r, col.key)}</td>
                        ))}
                        <td className="py-3" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                          {renderActionMenu(r.id, () => setEditRecruit(r), () => setRowDeletePending({ kind: "recruit", id: r.id, label: `${r.firstName} ${r.lastName}`.trim() || "this recruit" }))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  {`${recruitsTotalCount} ${scopeLabel(scope)} \u00B7 Page ${recruitsPage + 1} of ${Math.ceil(recruitsTotalCount / PAGE_SIZE) || 1}`}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={recruitsPage === 0} onClick={() => { setRecruitsPage(p => p - 1); setSelectedRecruitIds(new Set()); setSelectAllRecruitsMode(false); }}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={recruitsPage >= Math.ceil(recruitsTotalCount / PAGE_SIZE) - 1} onClick={() => { setRecruitsPage(p => p + 1); setSelectedRecruitIds(new Set()); setSelectAllRecruitsMode(false); }}>Next</Button>
                </div>
              </div>
              </>
            )}
          </div>
          )}
        </>
      )}

      {/* ===== AGENTS TAB ===== */}
      {!loading && tab === "Agents" && (
        <div className="bg-card rounded-xl border">
          {loadError ? renderLoadErrorCard() : sortedAgents.length === 0 ? (
            renderEmptyState({
              Icon: Users,
              noun: "agent",
              noDataTitle: "No agents yet",
              noDataBody: "Agents in your organization will appear here.",
            })
          ) : (
          <div className="overflow-x-auto scrollbar-x-hover">
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
                    <td className="py-3" style={{ width: 40 }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
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
                {hasContactsPermission("contacts.leads.import") && <button onClick={() => navigate('/contacts/import')} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition">Import CSV</button>}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {importHistory
                  .filter(h => h.fileName.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(h => {
                  const dateObj = new Date(h.date);
                  const formattedTime = formatDateTime(dateObj);
                  const rowStatus = importUndoRowStatus(h);
                  const canUndo = rowStatus.undoable;
                  const undoTip = canUndo
                    ? "Undo this import"
                    : rowStatus.reason
                      ? describeImportUndoReason(rowStatus.reason)
                      : rowStatus.label === "Undone"
                        ? "This import has already been undone."
                        : "Undo unavailable.";
                  const statusTone =
                    rowStatus.label === "Active" ? "bg-success/10 text-success"
                    : rowStatus.label === "Undone" ? "bg-muted text-muted-foreground"
                    : "bg-warning/10 text-warning";
                  return (
                    <div key={h.id} className="px-6 py-4 hover:bg-accent/30 sidebar-transition">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground truncate">{h.fileName}</span>
                            <span className="text-xs text-muted-foreground">• {formattedTime}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${statusTone}`}>{rowStatus.label}</span>
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
                                onClick={() => void handleOpenUndoImport(h)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 shrink-0"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                Undo Import
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{undoTip}</TooltipContent>
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
      {tab === "Leads" && (
        <AddLeadModal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          onSave={handleAddLead}
          currentUserId={user?.id}
          organizationId={organizationId}
          viewerRole={role}
          viewerIsSuperAdmin={isSuperAdmin}
          assignableAgents={assignableAgentsForAddLead}
        />
      )}
      {tab === "Clients" && <AddClientModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddClient} />}
      {tab === "Recruits" && <AddRecruitModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onSave={handleAddRecruit} />}
      
      <AddLeadModal
        open={!!editLead}
        onClose={() => setEditLead(null)}
        onSave={async (d) => {
          if (editLead) {
            await handleUpdateLead(editLead.id, d);
            setEditLead(null);
          }
        }}
        initial={editLead}
        currentUserId={user?.id}
        organizationId={organizationId}
        viewerRole={role}
        viewerIsSuperAdmin={isSuperAdmin}
        assignableAgents={assignableAgentsForAddLead}
      />
      <AddClientModal open={!!editClient} onClose={() => setEditClient(null)} onSave={async (d) => {
        if (!editClient) return;
        const ok = await enforceContactPreSave({
          contactType: "client",
          entity: { ...editClient, ...d },
          excludeId: editClient.id,
          assignedAgentId: d.assignedAgentId ?? editClient.assignedAgentId,
        });
        if (!ok) return;
        await clientsSupabaseApi.update(editClient.id, d);
        setEditClient(null);
        toast.success("Client updated");
        fetchData();
      }} initial={editClient} />
      <AddRecruitModal open={!!editRecruit} onClose={() => setEditRecruit(null)} onSave={async (d) => {
        if (!editRecruit) return;
        const ok = await enforceContactPreSave({
          contactType: "recruit",
          entity: { ...editRecruit, ...d },
          excludeId: editRecruit.id,
          assignedAgentId: d.assignedAgentId ?? editRecruit.assignedAgentId,
        });
        if (!ok) return;
        await recruitsSupabaseApi.update(editRecruit.id, d);
        setEditRecruit(null);
        toast.success("Recruit updated");
        fetchData();
      }} initial={editRecruit as any} />
      {selectedLead && (
        <FullScreenContactView 
          key={selectedLead.id}
          contact={selectedLead} 
          type="lead" 
          onClose={closeContact} 
          onUpdate={handleUpdateLead} 
          onDelete={handleDeleteLead} 
          onConvert={(clientId) => { closeContact(); fetchData(); void openClientById(clientId); }}
        />
      )}
      {selectedClient && (
        <FullScreenContactView 
          key={selectedClient.id}
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
          key={selectedRecruit.id}
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
      <DeleteConfirmModal
        open={bulkDeleteOpen}
        count={tab === "Leads" ? (selectAllLeadsMode ? leadsTotalCount : selectedIds.size) : tab === "Clients" ? (selectAllClientsMode ? clientsTotalCount : selectedClientIds.size) : (selectAllRecruitsMode ? recruitsTotalCount : selectedRecruitIds.size)}
        title={(() => {
          const n = tab === "Leads" ? (selectAllLeadsMode ? leadsTotalCount : selectedIds.size) : tab === "Clients" ? (selectAllClientsMode ? clientsTotalCount : selectedClientIds.size) : (selectAllRecruitsMode ? recruitsTotalCount : selectedRecruitIds.size);
          const label = tab === "Leads" ? "lead" : tab === "Clients" ? "client" : "recruit";
          return `Delete ${n} ${label}${n !== 1 ? "s" : ""}?`;
        })()}
        onConfirm={tab === "Leads" ? handleBulkDeleteLeads : tab === "Clients" ? handleBulkDeleteClients : handleBulkDeleteRecruits}
        onClose={() => setBulkDeleteOpen(false)}
      />
      <DeleteConfirmModal
        open={rowDeletePending !== null}
        count={1}
        title={rowDeletePending ? `Delete ${rowDeletePending.label}?` : "Delete contact?"}
        onConfirm={async () => {
          if (!rowDeletePending) return;
          const { kind, id } = rowDeletePending;
          if (kind === "lead") await handleDeleteLead(id);
          else if (kind === "client") await handleDeleteClient(id);
          else await handleDeleteRecruit(id);
        }}
        onClose={() => setRowDeletePending(null)}
      />


      {/* Undo Confirmation — atomic, server-enforced (no browser delete loop). Audit row is kept and marked Undone. */}
      {undoConfirm && (
        <DeleteConfirmModal
          open={true}
          count={undoConfirm.importedLeadIds.length}
          title={`Undo this import? ${undoConfirm.importedLeadIds.length} lead${undoConfirm.importedLeadIds.length === 1 ? "" : "s"} will be removed.`}
          description="Removes the leads created by this import (and their campaign queue rows) in one transaction. It only proceeds if none have calls, messages, appointments, tasks, conversions, or other history. The import record is kept and marked Undone."
          confirmLabel={undoBusy ? "Undoing…" : "Undo Import"}
          onConfirm={() => { void handleConfirmUndoImport(undoConfirm); }}
          onClose={() => { if (!undoBusy) setUndoConfirm(null); }}
        />
      )}

      {/* Row-level Convert → real conversion flow; opens the returned Client on success. */}
      {convertLead && (
        <ConvertLeadModal
          open={true}
          onClose={() => setConvertLead(null)}
          lead={convertLead}
          onSuccess={(clientId) => { setConvertLead(null); fetchData(); void openClientById(clientId); }}
        />
      )}

      {/* Add to Campaign Modal */}
      <AddToCampaignModal
        open={addToCampaignOpen}
        onClose={() => {
          setAddToCampaignOpen(false);
          setCampaignLeadIds(null);
        }}
        leadIds={tab === "Leads" ? campaignLeadIds : null}
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
          setSelectAllLeadsMode(false);
          setCampaignLeadIds(null);
          setSelectedClientIds(new Set());
          setSelectedRecruitIds(new Set());
        }}
      />
      <ConfirmDialog
        open={!!duplicatePrompt}
        onOpenChange={(o) => { if (!o && duplicatePrompt) duplicatePrompt.onCancel(); }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{duplicatePrompt?.label ?? "Possible duplicate"}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              Existing contacts that match the configured duplicate rule:
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <pre className="text-xs whitespace-pre-wrap bg-muted/40 border border-border rounded-lg p-3 max-h-48 overflow-auto">
            {duplicatePrompt?.description ?? ""}
          </pre>
          <ConfirmDialogFooter>
            <Button variant="ghost" onClick={() => duplicatePrompt?.onCancel()}>Cancel</Button>
            <Button onClick={() => duplicatePrompt?.onConfirm()}>Save Anyway</Button>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  );
};

export default Contacts;
