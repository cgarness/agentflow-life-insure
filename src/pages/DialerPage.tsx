import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDistanceToNow } from "date-fns";
import {
  Phone,
  PhoneOff,
  Calendar as CalendarIcon,
  Eye,
  Pencil,
  Activity,
  MessageSquare,
  Mail,
  FileText,
  Loader2,
  Send,
  ChevronDown,
  BarChart3,
  TrendingUp,
  Clock,
  ChevronLeft,
  ChevronRight,
  Users,
  ArrowRight,
  Check,
  X,
  Pause,
  Play,
  AlertTriangle,
  SlidersHorizontal,
  ListFilter,
  SortAsc,
} from "lucide-react";
import { cn, getStatusColorStyle } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { dispositionsSupabaseApi } from "@/lib/supabase-dispositions";
import {
  getCampaignLeads,
  getLeadHistory,
  createCall,
  saveCall,
  saveNote,
  saveAppointment,
  updateLeadStatus,
} from "@/lib/dialer-api";
import { useTelnyx } from "@/contexts/TelnyxContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AutoDialer } from "@/lib/auto-dialer";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { useCalendar } from "@/contexts/CalendarContext";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { Lead, PipelineStage, DialerDailyStats } from "@/lib/types";
import { upsertDialerStats, getTodayStats, deleteTodayStats } from "@/lib/supabase-dialer-stats";
import { Skeleton } from "@/components/ui/skeleton";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import { getContactLocalTime, getContactTimezone } from "@/utils/contactLocalTime";

import DraggableScriptPopup from "@/components/dialer/DraggableScriptPopup";
import { normalizeState } from "@/utils/stateUtils";
import { DateInput } from "@/components/shared/DateInput";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence } from "framer-motion";
import { useBranding } from "@/contexts/BrandingContext";
import CampaignSelection from "@/components/dialer/CampaignSelection";
import CampaignSettingsModal from "@/components/dialer/CampaignSettingsModal";
import LeadCard, { CallStatus } from "@/components/dialer/LeadCard";
import QueuePanel from "@/components/dialer/QueuePanel";
import ClaimRing from "@/components/dialer/ClaimRing";
import { useLeadLock, QueueFilters } from "@/hooks/useLeadLock";
import { useHardClaim } from "@/hooks/useHardClaim";

/* ─── Types ─── */

interface Disposition {
  id: string;
  name: string;
  color: string;
  requireNotes: boolean;
  minNoteChars: number;
  callbackScheduler: boolean;
  appointmentScheduler: boolean;
  automationTrigger: boolean;
  automationName?: string;
  campaignAction: 'none' | 'remove_from_queue' | 'remove_from_campaign';
  dncAutoAdd: boolean;
}

interface HistoryItem {
  id: string;
  type: string;
  description: string;
  disposition?: string | null;
  disposition_color?: string | null;
  created_at: string;
}

/* ─── Dialer Session ─── */

/* ─── Helpers ─── */

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtSessionDuration(seconds: number): string {
  if (seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function historyIcon(type: string) {
  switch (type) {
    case "call":
      return <Phone className="w-3.5 h-3.5 text-muted-foreground" />;
    case "note":
      return <Pencil className="w-3.5 h-3.5 text-muted-foreground" />;
    case "status":
      return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
    case "sms":
      return <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />;
    case "email":
      return <Mail className="w-3.5 h-3.5 text-muted-foreground" />;
    default:
      return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

/** 
 * Maps the snake_case lead object from campaign_leads 
 * to the camelCase Lead interface expected by ContactModal 
 */
function mapDialerLeadToContactLead(row: any): Lead {
  if (!row) return {} as Lead;
  // Use lead_id (the reference to the master leads table) as the id 
  // so that ContactModal's onUpdate correctly updates the master record.
  const idValue = row.lead_id || row.id;
  return {
    id: idValue,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    phone: row.phone || "",
    email: row.email || "",
    state: row.state || "",
    status: row.status || "New",
    leadSource: row.source || "",
    leadScore: row.lead_score ?? 5,
    age: row.age ?? undefined,
    dateOfBirth: row.date_of_birth ?? undefined,
    healthStatus: row.health_status ?? undefined,
    bestTimeToCall: row.best_time_to_call ?? undefined,
    spouseInfo: row.spouse_info ?? undefined,
    notes: row.notes ?? undefined,
    assignedAgentId: row.claimed_by || row.assigned_agent_id || "",
    lastContactedAt: row.last_contacted_at ?? undefined,
    customFields: row.custom_fields ?? undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

const normalizeStatusDisplay = (status: string) => {
  if (!status) return "";
  return status.replace(/AP+PINTMENT/i, "Appointment");
};

const fallbackStatusColors: Record<string, string> = {
  "New": "#3B82F6",
  "New Lead": "#3B82F6",
  "Queued": "#6366F1",
  "Contacted": "#A855F7",
  "Interested": "#EAB308",
  "Follow Up": "#14B8A6",
  "Hot": "#F97316",
  "Not Interested": "#EF4444",
  "Closed Won": "#22C55E",
  "Closed Lost": "#EF4444",
  "Prospect": "#6B7280",
  "Interview": "#EAB308",
  "Licensed": "#3B82F6",
  "Active": "#22C55E",
  "Appointment Set": "#9333EA",
  "APPPINTMENT SET": "#9333EA",
};

/* ─── Component ─── */

export default function DialerPage() {
  /* --- state --- */
  const [searchParams, setSearchParams] = useSearchParams();
  const [fetchingFromUrl, setFetchingFromUrl] = useState(false);
  const [campaigns, setCampaigns] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const selectedCampaignId = searchParams.get("campaign");
  const setSelectedCampaignId = (id: string | null) => {
    if (id) setSearchParams({ campaign: id });
    else setSearchParams({});
  };
  const [leadQueue, setLeadQueue] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [leadStages, setLeadStages] = useState<PipelineStage[]>([]);
  const [leftTab, setLeftTab] = useState<"dispositions" | "queue" | "scripts">("dispositions");
  // Call status from context
  const {
    status: telnyxStatus,
    errorMessage: telnyxErrorMessage,
    callState: telnyxCallState,
    callDuration: telnyxCallDuration,
    currentCall: telnyxCurrentCall,
    availableNumbers,
    selectedCallerNumber,
    setSelectedCallerNumber,
    makeCall: telnyxMakeCall,
    hangUp: telnyxHangUp,
    hangUpOrphan,
    dismissOrphanCall,
    orphanCall,
    initializeClient: telnyxInitialize,
    destroyClient: telnyxDestroy,
    getSmartCallerId,
    amdEnabled,
  } = useTelnyx();

  const [displayedFromNumber, setDisplayedFromNumber] = useState<string>("");

  const [selectedDisp, setSelectedDisp] = useState<Disposition | null>(null);
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [showWrapUp, setShowWrapUp] = useState(false);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [showFullViewDrawer, setShowFullViewDrawer] = useState(false);
  const [callbackDate, setCallbackDate] = useState<Date | undefined>(undefined);
  const [callbackTime, setCallbackTime] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Appointment/Callback state for inline scheduling
  const [aptTitle, setAptTitle] = useState("");
  const [aptType, setAptType] = useState<string>("Sales Call");
  const [aptDate, setAptDate] = useState("");
  const [aptStartTime, setAptStartTime] = useState("10:00 AM");
  const [aptEndTime, setAptEndTime] = useState("10:30 AM");
  const [aptNotes, setAptNotes] = useState("");
  const [dialerStats, setDialerStats] = useState<DialerDailyStats | null>(null);
  const [sessionStats, setSessionStats] = useState({ calls_made: 0, calls_connected: 0, total_talk_seconds: 0, policies_sold: 0 });

  useEffect(() => {
    const contactId = searchParams.get("contact");
    if (contactId && !showFullViewDrawer && !fetchingFromUrl) {
      // If already in queue, just switch to it
      const match = leadQueue.find(l => (l.lead_id === contactId || l.id === contactId));
      if (match) {
        setCurrentLeadIndex(leadQueue.indexOf(match));
        setShowFullViewDrawer(true);
      }
    }
  }, [searchParams, leadQueue, showFullViewDrawer, fetchingFromUrl]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [showEndSessionConfirm, setShowEndSessionConfirm] = useState(false);
  const [smsTab, setSmsTab] = useState<"sms" | "email">("sms");
  const [messageText, setMessageText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [assignedAgentName, setAssignedAgentName] = useState<string | null>(null);
  const [contactLocalTimeDisplay, setContactLocalTimeDisplay] = useState<string>("");
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ringTimeoutRef = useRef<number>(20);
  const hasDialedOnce = useRef(false);
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();
  const { formatDate, formatDateTime } = useBranding();
  const { addAppointment } = useCalendar();
  const [availableScripts, setAvailableScripts] = useState<any[]>([]);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [shouldAdvanceAfterModal, setShouldAdvanceAfterModal] = useState(false);

  // ── Campaign-aware dialer hooks ──
  const { getNextLead, releaseLock, startHeartbeat, stopHeartbeat } = useLeadLock();
  const { startClaimTimer, cancelClaimTimer, claimOnDisposition, claimedLeadIds } = useHardClaim();
  const [claimRingActive, setClaimRingActive] = useState(false);

  // ── Auto-Dial state ──
  const [autoDialer, setAutoDialer] = useState<AutoDialer | null>(null);
  const [autoDialEnabled, setAutoDialEnabled] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  // DNC warning
  const [showDncWarning, setShowDncWarning] = useState(false);
  const [dncLead, setDncLead] = useState<any>(null);
  const [dncReason, setDncReason] = useState("");
  // Session end modal
  const [showSessionEnd, setShowSessionEnd] = useState(false);
  const [autoDialSessionStats, setAutoDialSessionStats] = useState<any>(null);

  // ── AMD status ──
  type AmdStatus = 'idle' | 'detecting' | 'human' | 'machine';
  const [amdStatus, setAmdStatus] = useState<AmdStatus>('idle');

  // ── Calling Settings Modal state ──
  const [callingSettingsOpen, setCallingSettingsOpen] = useState(false);
  const [callingSettingsLoading, setCallingSettingsLoading] = useState(false);
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [maxAttemptsValue, setMaxAttemptsValue] = useState(3);
  const [callingHoursStart, setCallingHoursStart] = useState("09:00");
  const [callingHoursEnd, setCallingHoursEnd] = useState("21:00");
  const [retryIntervalHours, setRetryIntervalHours] = useState(24);
  const [settingsAutoDialEnabled, setSettingsAutoDialEnabled] = useState(true);
  const [localPresenceEnabled, setLocalPresenceEnabled] = useState(true);
  const [callingSettingsSaving, setCallingSettingsSaving] = useState(false);
  const [settingsCampaignId, setSettingsCampaignId] = useState<string | null>(null);
  const [ringTimeoutValue, setRingTimeoutValue] = useState(30);
  const [amdEnabledValue, setAmdEnabledValue] = useState(false);


  // ── Queue sort / filter / preview ──
  type QueueSortKey = 'default' | 'age_oldest' | 'attempts_fewest' | 'timezone' | 'score_high' | 'name_az';
  type QueuePreviewField = 'age' | 'state' | 'score' | 'source' | 'attempts' | 'status' | 'best_time' | 'health';
  interface QueueFilterState {
    status: string;
    state: string;
    leadSource: string;
    minAttempts: number;
    maxAttempts: number;
    minScore: number;
    maxScore: number;
  }

  const QUEUE_SORT_KEY = 'agentflow_queue_sort';
  const QUEUE_FILTER_KEY = 'agentflow_queue_filter';
  const QUEUE_PREVIEW_KEY = 'agentflow_queue_preview';

  const [queueSort, setQueueSort] = useState<QueueSortKey>(() => {
    return (localStorage.getItem(QUEUE_SORT_KEY) as QueueSortKey) || 'default';
  });
  const [queueFilter, setQueueFilter] = useState<QueueFilterState>(() => {
    try {
      const saved = localStorage.getItem(QUEUE_FILTER_KEY);
      return saved ? JSON.parse(saved) : { status: '', state: '', leadSource: '', minAttempts: 0, maxAttempts: 99, minScore: 0, maxScore: 10 };
    } catch { return { status: '', state: '', leadSource: '', minAttempts: 0, maxAttempts: 99, minScore: 0, maxScore: 10 }; }
  });
  const [queuePreviewFields, setQueuePreviewFields] = useState<[QueuePreviewField, QueuePreviewField]>(() => {
    try {
      const saved = localStorage.getItem(QUEUE_PREVIEW_KEY);
      return saved ? JSON.parse(saved) : ['state', 'attempts'];
    } catch { return ['state', 'attempts']; }
  });
  const [showQueueFilters, setShowQueueFilters] = useState(false);
  const [showQueueFieldPicker, setShowQueueFieldPicker] = useState(false);

  const currentLead = leadQueue[currentLeadIndex] ?? null;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  // ── Campaign type helpers ──
  const campaignType = (selectedCampaign?.type || "Personal") as string;
  /** True for Team and Open Pool campaigns — uses atomic lock queue. */
  const lockMode = useMemo(() => {
    const t = campaignType.toUpperCase();
    return t === "TEAM" || t.includes("OPEN");
  }, [campaignType]);

  /**
   * callStatus drives staged lead reveal in LeadCard.
   * Personal always shows 'connected'. Team/Open stages through idle→ringing→connected.
   */
  const callStatus = useMemo<CallStatus>(() => {
    if (!lockMode) return "connected"; // Personal: full reveal always
    if (!currentLead) return "idle";
    if (telnyxCallState === "dialing") return "ringing";
    if (telnyxCallState === "active" || telnyxCallState === "ended" || showWrapUp) return "connected";
    return "idle";
  }, [lockMode, currentLead, telnyxCallState, showWrapUp]);

  /* --- data loading --- */

  // ── Fetch today's stats from Supabase on mount ──
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setStatsLoading(true);
    getTodayStats(user.id)
      .then((stats) => {
        if (!cancelled) {
          setDialerStats(stats);
          setStatsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  // ── Session duration ticker (live-ticking from session_started_at) ──
  useEffect(() => {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (!dialerStats?.session_started_at) {
      setSessionElapsed(0);
      return;
    }
    const startTime = new Date(dialerStats.session_started_at).getTime();
    const tick = () => {
      setSessionElapsed(Math.floor((Date.now() - startTime) / 1000));
    };
    tick(); // immediate
    sessionTimerRef.current = setInterval(tick, 1000);
    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
    };
  }, [dialerStats?.session_started_at]);

  // ── Stop session timer when campaign is exited ──
  useEffect(() => {
    if (!selectedCampaignId) {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
      setSessionElapsed(0);
    }
  }, [selectedCampaignId]);

  /* --- queries --- */
  
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  const { data: campaignStateStats = {} } = useQuery({
    queryKey: ["campaignStateStats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_leads')
        .select('campaign_id, state, lead:leads(state)');
      if (error) throw error;
      
      const stats: Record<string, { state: string, count: number }[]> = {};
      data.forEach(row => {
        const rawState = row.state || (row.lead as any)?.state;
        const normalizedState = normalizeState(rawState);
        if (!normalizedState) return;
        
        if (!stats[row.campaign_id]) stats[row.campaign_id] = [];
        let stateEntry = stats[row.campaign_id].find(s => s.state === normalizedState);
        if (!stateEntry) {
          stateEntry = { state: normalizedState, count: 0 };
          stats[row.campaign_id].push(stateEntry);
        }
        stateEntry.count++;
      });
      // Sort states by count descending
      Object.keys(stats).forEach(cid => {
        stats[cid].sort((a, b) => b.count - a.count);
      });
      return stats;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { data: dispositionsData = [] } = useQuery({
    queryKey: ["dispositions"],
    queryFn: async () => {
      const ds = await dispositionsSupabaseApi.getAll();
      return ds.map((d) => ({
        id: d.id,
        name: d.name,
        color: d.color,
        requireNotes: d.requireNotes,
        minNoteChars: d.minNoteChars,
        callbackScheduler: d.callbackScheduler,
        appointmentScheduler: d.appointmentScheduler,
        automationTrigger: d.automationTrigger,
        automationName: d.automationName,
        campaignAction: d.campaignAction || 'none',
        dncAutoAdd: d.dncAutoAdd || false,
      }));
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });

  const { data: scriptsData = [] } = useQuery({
    queryKey: ["scripts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_scripts")
        .select("*")
        .eq("active", true);
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60 * 10,
  });

  const { data: leadStagesData = [] } = useQuery({
    queryKey: ["leadStages"],
    queryFn: pipelineSupabaseApi.getLeadStages,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  // Resolve the "best" number to display when lead or override changes
  useEffect(() => {
    const resolve = async () => {
      const contactPhone = currentLead?.phone || "";
      const contactId = currentLead?.lead_id || currentLead?.id || "";
      const smartId = await getSmartCallerId(contactPhone, contactId);
      setDisplayedFromNumber(smartId);
    };
    resolve();
  }, [currentLead, selectedCallerNumber, getSmartCallerId]);

  // ── Owned phone numbers (removed local fetching, now using TelnyxContext) ──
  const lastUsedCallerId = useRef<string>("");

  /* --- effects for syncing query data to state if needed --- */
  // Note: We prefer using the data from useQuery directly, but some effects or 
  // handlers might expect these states. We'll update them via useEffect for compatibility.
  useEffect(() => {
    const fetchCampaigns = async () => {
      if (!organizationId) return;
      setCampaignsLoading(true);
      const { data, error } = await supabase
        .from('campaigns')
        .select('id, name, type, status, description, tags, total_leads, leads_contacted, leads_converted, max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled, assigned_agent_ids, created_by')
        .eq('organization_id', organizationId)
        .in('status', ['Active', 'Paused', 'Draft'])
        .order('name', { ascending: true });
      if (!error && data) {
        // Enforce persona/hierarchy: POOL campaigns are open to all; PERSONAL and TEAM
        // campaigns are only visible to the agent who created them or who is in assigned_agent_ids.
        const userId = user?.id;
        const visible = data.filter((c: any) => {
          const t = (c.type || '').toUpperCase();
          if (t.includes('POOL')) return true;
          const ids: string[] = Array.isArray(c.assigned_agent_ids) ? c.assigned_agent_ids : [];
          return c.created_by === userId || ids.includes(userId ?? '');
        });
        setCampaigns(visible);
      }
      setCampaignsLoading(false);
    };
    fetchCampaigns();
  }, [organizationId, user?.id]);

  useEffect(() => {
    setDispositions(dispositionsData);
  }, [dispositionsData]);

  useEffect(() => {
    setAvailableScripts(scriptsData);
  }, [scriptsData]);

  useEffect(() => {
    setLeadStages(leadStagesData);
  }, [leadStagesData]);

  const [loadingLeads, setLoadingLeads] = useState(false);
  const [hasMoreLeads, setHasMoreLeads] = useState(true);
  const [currentOffset, setCurrentOffset] = useState(0);
  const BATCH_SIZE = 50;

  /**
   * Lock-mode lead loader (Team / Open Pool).
   * Calls getNextLead() to atomically fetch + lock one lead,
   * then fetches its full joined data and sets it as leadQueue[0].
   * Returns true if a lead was loaded, false if queue is empty.
   */
  const loadLockModeLead = useCallback(async (): Promise<boolean> => {
    if (!selectedCampaignId || !selectedCampaign) return false;
    setLoadingLeads(true);
    try {
      // Fetch manager-set filters from the campaign record
      const { data: campaignData } = await supabase
        .from("campaigns")
        .select("queue_filters, max_attempts")
        .eq("id", selectedCampaignId)
        .maybeSingle();
      const filters: QueueFilters = (campaignData?.queue_filters as QueueFilters) ?? {};

      const lock = await getNextLead(selectedCampaignId, selectedCampaign.type, filters);
      if (!lock) {
        setLeadQueue([]);
        setHasMoreLeads(false);
        return false;
      }

      // Enrich with full leads table data (campaign_leads row from RPC lacks joined fields)
      const { data: fullRow } = await supabase
        .from("campaign_leads")
        .select("*, lead:leads(*)")
        .eq("id", lock.id)
        .maybeSingle();

      let merged: any = lock;
      if (fullRow) {
        const { lead: leadData, ...campaignLead } = fullRow as any;
        merged = {
          ...(leadData || {}),
          ...campaignLead,
          state: campaignLead.state || leadData?.state || "",
          id: campaignLead.id,
          lead_id: leadData?.id || campaignLead.lead_id,
        };
      }

      setLeadQueue([merged]);
      setCurrentLeadIndex(0);
      setHasMoreLeads(false); // lock mode = one lead at a time
      // Start heartbeat using campaign_leads.id (the lock key)
      startHeartbeat(lock.id, () => {
        // Lock lost — silently re-fetch next lead
        loadLockModeLead();
      });
      return true;
    } catch {
      toast.error("Failed to load next lead");
      return false;
    } finally {
      setLoadingLeads(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, selectedCampaign, getNextLead, startHeartbeat]);

  const fetchLeadsBatch = useCallback(async (campaignId: string, offset: number, clear = false) => {
    setLoadingLeads(true);
    try {
      const leads = await getCampaignLeads(campaignId, organizationId, BATCH_SIZE, offset);
      if (leads.length < BATCH_SIZE) {
        setHasMoreLeads(false);
      } else {
        setHasMoreLeads(true);
      }
      
      if (clear) {
        setLeadQueue(leads);
        setCurrentLeadIndex(0);
        setCurrentOffset(BATCH_SIZE);
      } else {
        setLeadQueue(prev => [...prev, ...leads]);
        setCurrentOffset(prev => prev + BATCH_SIZE);
      }
    } catch (err) {
      toast.error("Failed to load leads");
    } finally {
      setLoadingLeads(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!selectedCampaignId) {
      setLeadQueue([]);
      setCurrentLeadIndex(0);
      setCurrentOffset(0);
      setHasMoreLeads(true);
      return;
    }

    // Load leads, then check for saved queue position
    const loadWithResume = async () => {
      setLoadingLeads(true);
      try {
        const leads = await getCampaignLeads(selectedCampaignId, organizationId, BATCH_SIZE, 0);
        if (leads.length < BATCH_SIZE) {
          setHasMoreLeads(false);
        } else {
          setHasMoreLeads(true);
        }
        setLeadQueue(leads);
        setCurrentOffset(BATCH_SIZE);

        // Check for saved queue position
        if (user?.id) {
          try {
            const { data: savedState } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
              .from('dialer_queue_state')
              .select('current_lead_id, queue_index')
              .eq('user_id', user.id)
              .eq('campaign_id', selectedCampaignId)
              .maybeSingle();

            if (savedState) {
              const savedIndex = leads.findIndex(
                (l: any) => (l.lead_id || l.id) === savedState.current_lead_id
              );
              if (savedIndex >= 0) {
                setCurrentLeadIndex(savedIndex);
                toast.success("Resuming where you left off");
              } else {
                setCurrentLeadIndex(0);
              }
            } else {
              setCurrentLeadIndex(0);
            }
          } catch {
            setCurrentLeadIndex(0);
          }
        } else {
          setCurrentLeadIndex(0);
        }
      } catch {
        toast.error("Failed to load leads");
      } finally {
        setLoadingLeads(false);
      }
    };

    if (lockMode) {
      // Team / Open Pool: atomic lock-based single-lead loading
      loadLockModeLead();
    } else {
      loadWithResume();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, lockMode, user?.id, organizationId]);
  // Reset hasDialedOnce when campaign changes so the first call must always be manual
  useEffect(() => {
    hasDialedOnce.current = false;
    return () => { hasDialedOnce.current = false; };
  }, [selectedCampaignId]);

  // Load more leads when we get close to the end of the queue (Personal only)
  useEffect(() => {
    if (!lockMode && selectedCampaignId && hasMoreLeads && !loadingLeads && leadQueue.length > 0) {
      if (currentLeadIndex >= leadQueue.length - 10) {
        fetchLeadsBatch(selectedCampaignId, currentOffset);
      }
    }
  }, [lockMode, currentLeadIndex, leadQueue.length, selectedCampaignId, hasMoreLeads, loadingLeads, currentOffset, fetchLeadsBatch]);

  // Persist queue preferences to localStorage
  useEffect(() => { localStorage.setItem(QUEUE_SORT_KEY, queueSort); }, [queueSort]);
  useEffect(() => { localStorage.setItem(QUEUE_FILTER_KEY, JSON.stringify(queueFilter)); }, [queueFilter]);
  useEffect(() => { localStorage.setItem(QUEUE_PREVIEW_KEY, JSON.stringify(queuePreviewFields)); }, [queuePreviewFields]);

  // Sorted + filtered view of the lead queue (display only — underlying queue order unchanged)
  const displayQueue = useMemo(() => {
    let q = leadQueue.map((lead, originalIndex) => ({ lead, originalIndex }));

    // Apply filters
    if (queueFilter.status) q = q.filter(({ lead }) => lead.status === queueFilter.status);
    if (queueFilter.state) q = q.filter(({ lead }) => normalizeState(lead.state) === queueFilter.state);
    if (queueFilter.leadSource) q = q.filter(({ lead }) => (lead.source || '').toLowerCase() === queueFilter.leadSource.toLowerCase());
    q = q.filter(({ lead }) => {
      const attempts = lead.call_attempts || 0;
      const score = lead.lead_score ?? 5;
      return attempts >= queueFilter.minAttempts && attempts <= queueFilter.maxAttempts
        && score >= queueFilter.minScore && score <= queueFilter.maxScore;
    });

    // Apply sort
    switch (queueSort) {
      case 'age_oldest':
        q.sort((a, b) => new Date(a.lead.created_at || 0).getTime() - new Date(b.lead.created_at || 0).getTime());
        break;
      case 'attempts_fewest':
        q.sort((a, b) => (a.lead.call_attempts || 0) - (b.lead.call_attempts || 0));
        break;
      case 'timezone':
        q.sort((a, b) => (a.lead.state || '').localeCompare(b.lead.state || ''));
        break;
      case 'score_high':
        q.sort((a, b) => (b.lead.lead_score ?? 5) - (a.lead.lead_score ?? 5));
        break;
      case 'name_az':
        q.sort((a, b) => (a.lead.first_name || '').localeCompare(b.lead.first_name || ''));
        break;
    }

    return q;
  }, [leadQueue, queueSort, queueFilter]);

  // Unique values for filter dropdowns (derived from current queue)
  const uniqueStatuses = useMemo(() => [...new Set(leadQueue.map(l => l.status).filter(Boolean))], [leadQueue]);
  const uniqueStates = useMemo(() => {
    const states = leadQueue.map(l => normalizeState(l.state)).filter(Boolean) as string[];
    return [...new Set(states)].sort();
  }, [leadQueue]);
  const uniqueSources = useMemo(() => [...new Set(leadQueue.map(l => l.source).filter(Boolean))].sort(), [leadQueue]);

  // Helper: render a preview field value for a lead card
  function renderQueuePreviewValue(lead: any, field: string): string {
    switch (field) {
      case 'age': {
        if (!lead.created_at) return '—';
        const days = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000);
        return days === 0 ? 'Today' : `${days}d old`;
      }
      case 'state': return normalizeState(lead.state) || '—';
      case 'score': return lead.lead_score != null ? `Score ${lead.lead_score}` : '—';
      case 'source': return lead.source || lead.lead_source || '—';
      case 'attempts': return `${lead.call_attempts || 0} attempt${(lead.call_attempts || 0) !== 1 ? 's' : ''}`;
      case 'status': return lead.status || '—';
      case 'best_time': return lead.best_time_to_call || '—';
      case 'health': return lead.health_status || '—';
      default: return '—';
    }
  }

  const PREVIEW_FIELD_LABELS: Record<string, string> = {
    age: 'Age', state: 'State', score: 'Score', source: 'Source',
    attempts: 'Attempts', status: 'Status', best_time: 'Best Time', health: 'Health',
  };

  const fetchHistory = useCallback(async (leadId: string) => {
    setLoadingHistory(true);
    try {
      const data = await getLeadHistory(leadId);
      setHistory(data);
    } catch (err) {
      toast.error("Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!currentLead) {
      setHistory([]);
      return;
    }
    fetchHistory(currentLead.lead_id || currentLead.id);
  }, [currentLead, fetchHistory]);

  useEffect(() => {
    if (!currentLead?.assigned_agent_id) {
      setAssignedAgentName(null);
      return;
    }
    supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', currentLead.assigned_agent_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAssignedAgentName(`${data.first_name || ''} ${data.last_name || ''}`.trim());
        } else {
          setAssignedAgentName(null);
        }
      });
  }, [currentLead?.assigned_agent_id]);

  useEffect(() => {
    if (historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history]);

  /* --- call handlers --- */

  const [showCallerIdWarning, setShowCallerIdWarning] = useState(false);
  const [pendingCall, setPendingCall] = useState<{
    leadPhone: string;
    contactId: string;
    proposedNumber: string;
    previousNumber: string;
  } | null>(null);

  const handleAdvance = useCallback(() => {
    setShowWrapUp(false);
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentCallId(null);
    setClaimRingActive(false);
    cancelClaimTimer();

    if (lockMode && currentLead?.id) {
      stopHeartbeat();
      releaseLock(currentLead.id as string);
      loadLockModeLead();
      return;
    }

    setCurrentLeadIndex((i) => {
      const next = i + 1;
      autoDialer?.setIndex(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDialer, lockMode, currentLead?.id]);

  const handleSkip = useCallback(() => {
    setIsEditingContact(false);
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentCallId(null);
    setClaimRingActive(false);
    cancelClaimTimer();

    if (lockMode && currentLead?.id) {
      const campaignLeadId = currentLead.id as string;
      stopHeartbeat();
      releaseLock(campaignLeadId);
      // Load next lead atomically for Team/Open
      loadLockModeLead();
      return;
    }

    setCurrentLeadIndex((i) => {
      const next = i + 1;
      autoDialer?.setIndex(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDialer, lockMode, currentLead?.id]);

  const proceedWithCall = useCallback((leadPhone: string, callerNumber: string, callId?: string) => {
    lastUsedCallerId.current = callerNumber;
    setCurrentCallId(callId || null);
    telnyxMakeCall(leadPhone, callerNumber || undefined, callId);
  }, [telnyxMakeCall]);

  const initiateCall = useCallback(async (leadPhone: string, contactId: string) => {
    if (!user) {
      toast.error("Authentication required to make calls. Please log in again.");
      return;
    }
    const smartCallerId = await getSmartCallerId(leadPhone, contactId);
    
    // For manual calls, we create the record first to get a callId
    let callId;
    try {
      callId = await createCall({
        contact_id: contactId,
        agent_id: user?.id || "",
        campaign_id: selectedCampaignId || undefined,
        caller_id_used: smartCallerId,
        contact_name: `${currentLead?.first_name || ''} ${currentLead?.last_name || ''}`.trim(),
        contact_phone: leadPhone,
      }, organizationId);
    } catch (err) {
      console.error("Failed to create call record for manual call:", err);
    }

    proceedWithCall(leadPhone, smartCallerId, callId);
  }, [getSmartCallerId, user?.id, selectedCampaignId, currentLead, organizationId, proceedWithCall]);

  const handleCall = useCallback(() => {
    if (!currentLead) {
      toast.error("No lead selected");
      return;
    }
    if (telnyxStatus === "error") {
      toast.error(telnyxErrorMessage || "Dialer error. Please check your settings.");
      return;
    }
    const now = new Date().toISOString();
    const isFirstCall = !dialerStats?.session_started_at;
    // Optimistic local update
    setDialerStats(prev => {
      if (!prev) {
        return {
          id: "",
          agent_id: user?.id || "",
          stat_date: new Date().toISOString().split("T")[0],
          calls_made: 1,
          calls_connected: 0,
          total_talk_seconds: 0,
          policies_sold: 0,
          session_started_at: now,
          last_updated_at: now,
        };
      }
      return {
        ...prev,
        calls_made: prev.calls_made + 1,
        session_started_at: prev.session_started_at ?? now,
        last_updated_at: now,
      };
    });
    // Persist to Supabase (fire-and-forget)
    if (user?.id) {
      upsertDialerStats(user.id, {
        calls_made: 1,
        session_started_at: isFirstCall ? now : null,
      }).catch(() => {});
    }
    hasDialedOnce.current = true;
    setSessionStats(prev => ({ ...prev, calls_made: prev.calls_made + 1 }));
    const contactId = currentLead.lead_id || currentLead.id || "";
    initiateCall(currentLead.phone, contactId);
  }, [currentLead, telnyxStatus, telnyxErrorMessage, dialerStats, user?.id, initiateCall]);

  const handleHangUp = useCallback(() => {
    console.log("[Dialer] Hang up — duration:", telnyxCallDuration, "counting as connected:", telnyxCallDuration >= 7);
    if (telnyxCallDuration >= 7) {
      // Optimistic local update
      setDialerStats(prev => prev ? {
        ...prev,
        calls_connected: prev.calls_connected + 1,
        total_talk_seconds: prev.total_talk_seconds + telnyxCallDuration,
        last_updated_at: new Date().toISOString(),
      } : prev);
      setSessionStats(prev => ({
        ...prev,
        calls_connected: prev.calls_connected + 1,
        total_talk_seconds: prev.total_talk_seconds + telnyxCallDuration,
      }));
      // Persist to Supabase
      if (user?.id) {
        upsertDialerStats(user.id, {
          calls_connected: 1,
          total_talk_seconds: telnyxCallDuration,
        }).catch(() => {});
      }
    }
    telnyxHangUp();
  }, [telnyxCallDuration, telnyxHangUp, user?.id]);

  // AMD auto-dispose handler
  const handleAutoDispose = useCallback(async (disposition: Disposition) => {
    // Use currentCallId (internal UUID) which is more reliable than telnyxCurrentCall
    // since telnyxHangUp() may have already cleared the telnyx call reference
    if (currentCallId) {
      try {
        await supabase.from('calls')
          .update({ disposition_name: disposition.name })
          .eq('id', currentCallId);
      } catch {
        // non-blocking
      }
    }
    setShowWrapUp(false);
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentCallId(null);
    setCurrentLeadIndex((i) => {
      const next = i + 1;
      autoDialer?.setIndex(next);
      return next;
    });
    // Auto-dial logic handled reactively by useEffect on currentLead?.id change
  }, [currentCallId, autoDialer]);

  const handleMachineDetectedAction = useCallback(async () => {
    // Prevent double-processing
    setAmdStatus(prev => {
      if (prev === 'machine') return prev;
      return 'machine';
    });

    toast.info('🤖 Machine detected — skipping to next lead', {
      duration: 2000,
    });

    // Increment skip stat
    if (user?.id) {
      upsertDialerStats(user.id, { amd_skipped: 1 }).catch(err => {
        console.warn('Failed to increment AMD skip stat:', err);
      });
    }

    // Find the "No Answer" disposition
    const noAnswerDisp = dispositions.find(d =>
      d.name.toLowerCase() === 'no answer'
    ) || dispositions.find(d =>
      d.name.toLowerCase().includes('no answer')
    );

    if (noAnswerDisp) {
      console.log('[AMD] Found "No Answer" disposition, auto-advancing...');
      setSelectedDisp(noAnswerDisp);
      setShowWrapUp(false); // Force close modal if open
      
      if (autoDialer && autoDialer.isEnabled()) {
        await autoDialer.saveDispositionAndNext(noAnswerDisp.id);
      } else {
        handleAutoDispose(noAnswerDisp);
      }
    } else {
      // No matching disposition — still advance
      console.warn('No "No Answer" disposition found, advancing without disposition');
      handleSkip(); // Reuse skip logic to advance lead
    }
    // Reset AMD status after brief display
    setTimeout(() => setAmdStatus('idle'), 2000);
  }, [user?.id, dispositions, autoDialer, handleAutoDispose, handleSkip]);

  // ── Real-time AMD detection ──
  useEffect(() => {
    if (!currentCallId || !amdEnabled) return;

    console.log('[Realtime] Subscribing to AMD updates for call:', currentCallId);
    
    const channel = supabase
      .channel(`call-amd-${currentCallId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${currentCallId}`,
        },
        (payload) => {
          const newAMD = payload.new.amd_result;
          const oldAMD = payload.old?.amd_result;
          const newDisp = payload.new.disposition_name;
          
          // Trigger skip if machine is detected OR if the server auto-disposed as "No Answer"
          if ((newAMD === 'machine' && oldAMD !== 'machine') || (newDisp === 'No Answer')) {
            console.log('[Realtime] Machine/Auto-No-Answer detected via DB update');
            handleMachineDetectedAction();
          } else if (newAMD === 'human' && oldAMD !== 'human') {
            setAmdStatus('human');
            setTimeout(() => setAmdStatus('idle'), 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentCallId, amdEnabled, handleMachineDetectedAction]);

  // Set AMD status to 'detecting' when a call starts and AMD is enabled
  useEffect(() => {
    if (amdEnabled && (telnyxCallState === 'dialing' || telnyxCallState === 'active')) {
      setAmdStatus('detecting');
    } else if (telnyxCallState === 'idle') {
      setAmdStatus('idle');
    }
  }, [telnyxCallState, amdEnabled]);

  // Trigger wrap-up when call ends (covers remote hangup)
  // Also checks for AMD machine detection to auto-dispose
  useEffect(() => {
    if (telnyxCallState === "ended") {
      // Capture state before resets
      const savedCallId = currentCallId;
      const duration = telnyxCallDuration;
      telnyxHangUp();

      // ── Auto-Disposition for Auto-Dialer ──
      // If the call was not "meaningful" (e.g. < 10s talk time), auto-record No Answer
      const isMeaningful = duration >= 10;
      if (autoDialEnabled && autoDialer?.isEnabled() && !isMeaningful && amdStatus !== 'machine') {
        const noAnswerDisp = dispositions.find(d => 
          d.name.toLowerCase() === 'no answer' || d.name.toLowerCase().includes('no answer')
        );
        if (noAnswerDisp) {
          console.log("[AutoDialer] Non-meaningful call (< 10s), auto-disposing as No Answer");
          autoDialer.saveDispositionAndNext(noAnswerDisp.id).catch(err => {
            console.error("[AutoDialer] Auto-disposition failed:", err);
          });
          return; // Skip wrap-up modal and manual disposition
        }
      }

      // Check for AMD machine detection (Fallback if Realtime missed it)
      const checkAmd = async () => {
        if (!amdEnabled) {
          setAmdStatus('idle');
          if (!isMeaningful && autoDialEnabled) return; // Already handled by auto-disposition
          setShowWrapUp(true);
          return;
        }

        const callControlId = telnyxCurrentCall?.id || telnyxCurrentCall?.callControlId;
        if (!callControlId && !savedCallId) {
          setAmdStatus('idle');
          setShowWrapUp(true);
          return;
        }

        try {
          let callRecord = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise(r => setTimeout(r, 1000));
            const { data } = await supabase
              .from('calls')
              .select('amd_result')
              .eq('id', savedCallId || currentCallId)
              .maybeSingle();

            if (data?.amd_result) {
              callRecord = data;
              break;
            }
          }

          if (callRecord?.amd_result === 'machine' && amdStatus !== 'machine') {
            await handleMachineDetectedAction();
            return;
          }

          if (callRecord?.amd_result === 'human') {
            setAmdStatus('human');
            setTimeout(() => setAmdStatus('idle'), 3000);
          } else {
            setAmdStatus('idle');
          }
        } catch (err) {
          console.warn('AMD check fallback threw:', err);
          setAmdStatus('idle');
        }

        // Only show wrap-up if not already advanced by machine detection or auto-disposition
        setShowWrapUp(current => {
          if (amdStatus === 'machine') return false;
          return true;
        });
      };

      setTimeout(checkAmd, 3000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telnyxCallState, telnyxHangUp, telnyxCurrentCall, dispositions, handleAutoDispose, amdEnabled, autoDialer, currentCallId, amdStatus, handleMachineDetectedAction, autoDialEnabled, telnyxCallDuration]);

  // live local time badge — updates every minute when lead state changes
  useEffect(() => {
    const state = currentLead?.state;
    if (!state) {
      setContactLocalTimeDisplay("");
      return;
    }
    const update = () => {
      const t = getContactLocalTime(state);
      const tz = getContactTimezone(state);
      setContactLocalTimeDisplay(t && tz ? `${t} ${tz}` : t);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [currentLead?.state]);

  /* --- keyboard shortcuts --- */

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
    if (!showWrapUp || telnyxCallState === "active") return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && dispositions[num - 1]) {
      handleSelectDisposition(dispositions[num - 1]);
    }
  }
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showWrapUp, telnyxCallState, dispositions]);

  // (Session duration ticker moved to mount effects above)

  // ── Calling Settings: fetch on open ──
  useEffect(() => {
    const effectiveCampaignId = settingsCampaignId ?? selectedCampaignId;
    if (!callingSettingsOpen || !effectiveCampaignId) return;
    setCallingSettingsLoading(true);
    // 1. Fetch Campaign Settings
    const fetchCampaign = (supabase
      .from("campaigns")
      .select("max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled")
      .eq("id", effectiveCampaignId)
      .maybeSingle() as unknown as Promise<any>);

    // 2. Fetch Global Phone Settings (Ring Timeout + AMD)
    const fetchPhone = (supabase
      .from("phone_settings")
      .select("ring_timeout, amd_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle() as unknown as Promise<any>);

    Promise.all([fetchCampaign, fetchPhone])
      .then(([{ data: campaignData }, { data: phoneData }]: any) => {
        if (campaignData) {
          setIsUnlimited(campaignData.max_attempts === null);
          setMaxAttemptsValue(campaignData.max_attempts ?? 3);
          setCallingHoursStart((campaignData.calling_hours_start as string)?.slice(0, 5) ?? "09:00");
          setCallingHoursEnd((campaignData.calling_hours_end as string)?.slice(0, 5) ?? "21:00");
          setRetryIntervalHours(campaignData.retry_interval_hours ?? 24);
          setSettingsAutoDialEnabled(campaignData.auto_dial_enabled ?? true);
          setLocalPresenceEnabled(campaignData.local_presence_enabled ?? true);
        }
        if (phoneData) {
          if (phoneData.ring_timeout) setRingTimeoutValue(phoneData.ring_timeout);
          setAmdEnabledValue(phoneData.amd_enabled ?? false);
        }
        setCallingSettingsLoading(false);
      })
      .catch((err) => {
        console.warn('[DialerPage] Failed to load calling settings', err);
        setCallingSettingsLoading(false);
      });
  }, [callingSettingsOpen, settingsCampaignId, selectedCampaignId]);

  const handleSaveCallingSettings = async () => {
    const effectiveCampaignId = settingsCampaignId ?? selectedCampaignId;
    if (!effectiveCampaignId) return;
    setCallingSettingsSaving(true);
    // 1. Update Campaign Settings
    const { error: campaignError } = await supabase
      .from("campaigns")
      .update({
        max_attempts: isUnlimited ? null : maxAttemptsValue,
        calling_hours_start: callingHoursStart,
        calling_hours_end: callingHoursEnd,
        retry_interval_hours: retryIntervalHours,
        auto_dial_enabled: settingsAutoDialEnabled,
        local_presence_enabled: localPresenceEnabled,
      })
      .eq("id", effectiveCampaignId);

    // 2. Update Global Phone Settings (Ring Timeout)
    const { error: phoneError } = await supabase
      .from("phone_settings")
      .update({
        ring_timeout: ringTimeoutValue,
        amd_enabled: amdEnabledValue,
        updated_at: new Date().toISOString()
      })
      .eq("organization_id", organizationId);

    setCallingSettingsSaving(false);
    
    if (campaignError || phoneError) {
      toast.error("Failed to save settings — please try again");
      console.error("Save error:", { campaignError, phoneError });
    } else {
      toast.success("Calling settings saved");
      setCallingSettingsOpen(false);
      setSettingsCampaignId(null);
    }
  };

  const handleToggleLocalPresence = async (campaignId: string, newValue: boolean) => {
    // Optimistic update
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, local_presence_enabled: newValue } : c));
    const { error } = await supabase.from('campaigns').update({ local_presence_enabled: newValue }).eq('id', campaignId);
    if (error) {
      // Roll back optimistic update on failure
      setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, local_presence_enabled: !newValue } : c));
      toast.error("Failed to update Local Presence — please try again");
    }
  };

  // ── AutoDialer initialization ──
  useEffect(() => {
    const agentId = user?.id;
    if (!selectedCampaignId || !agentId) return;
    const dialer = new AutoDialer(sessionIdRef.current, selectedCampaignId, agentId, organizationId);
    dialer.startSession().then(() => {
      ringTimeoutRef.current = dialer.getRingTimeout();
    });
    setAutoDialer(dialer);
    // Reset session-scoped stats on campaign entry
    setSessionStats({ calls_made: 0, calls_connected: 0, total_talk_seconds: 0, policies_sold: 0 });
    // Eagerly register TelnyxRTC so the client is ready before the first call
    telnyxInitialize();
    return () => {
      dialer.pauseAutoDialer();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, user?.id, telnyxInitialize]);

  // ── Sync Queue and Index ──
  useEffect(() => {
    if (autoDialer) {
      // Sync the live queue from DialerPage into the auto-dialer instance
      autoDialer.setQueue(leadQueue);
      autoDialer.setIndex(currentLeadIndex);
    }
  }, [autoDialer, leadQueue, currentLeadIndex]);

  // ── Auto-Dial Reactive Trigger (Lead Advance) ──
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const triggerAutoCall = async () => {
      // FIX 2: Must press Call at least once before auto-dial fires
      if (!hasDialedOnce.current) return;

      console.log("[AutoDialer] Reactive trigger check:", {
        autoDialEnabled,
        dialerEnabled: autoDialer?.isEnabled(),
        leadId: currentLead?.id,
        callState: telnyxCallState,
        telnyxStatus
      });

      // 1. Guard check: only trigger if auto-dial is enabled, dialer is ready, and we have a lead
      if (!autoDialEnabled || !autoDialer?.isEnabled() || !currentLead || telnyxCallState !== "idle" || telnyxStatus !== "ready") {
        return;
      }

      // 2. Authentication Check: Ensure user has an active Supabase session before dialing
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.warn("[AutoDialer] Reactive trigger blocked: No active auth session.");
        toast.error("Standard Authentication Required. Please log in to make calls.");
        return;
      }

      // FIX 1: Enforce calling hours for the lead's state (auto-dial only)
      const leadState = currentLead.state || '';
      if (!autoDialer.checkCallingHours(leadState)) {
        const displayState = leadState || 'this state';
        toast.warning(`Outside calling hours for ${displayState} — skipping lead`);
        handleSkip();
        return;
      }

      console.log(`[AutoDialer] Reactive trigger: Waiting 2000ms before dialing ${currentLead.first_name}...`);

      timer = setTimeout(async () => {
        // Double-check guards after delay to ensure user didn't pause or start a manual call
        if (!autoDialEnabled || !autoDialer?.isEnabled() || telnyxCallState !== "idle" || telnyxStatus !== "ready") {
          return;
        }

        console.log("[AutoDialer] 2000ms delay complete. Initiating call to:", currentLead.phone);
        handleCall();
      }, 2000);
    };

    triggerAutoCall();

    return () => {
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLead?.id, autoDialEnabled, telnyxStatus, telnyxCallState]);

  // ── Auto-dial next lead event (auto-dial ON) ──
  useEffect(() => {
    const handleNextLead = () => {
      handleAdvance();
    };
    window.addEventListener("auto-dial-next-lead", handleNextLead);
    return () => window.removeEventListener("auto-dial-next-lead", handleNextLead);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-dial lead closed event (auto-dial OFF) ──
  useEffect(() => {
    const handleLeadClosed = () => {
      handleAdvance();
    };
    window.addEventListener("auto-dial-lead-closed", handleLeadClosed);
    return () => window.removeEventListener("auto-dial-lead-closed", handleLeadClosed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── DNC warning event ──
  useEffect(() => {
    const handleDncWarning = (event: Event) => {
      const { lead, reason } = (event as CustomEvent).detail;
      setDncLead(lead);
      setDncReason(reason ?? "");
      setShowDncWarning(true);
    };
    window.addEventListener("dnc-warning", handleDncWarning);
    return () => window.removeEventListener("dnc-warning", handleDncWarning);
  }, []);

  // ── Session end event ──
  useEffect(() => {
    const handleSessionEnd = (event: Event) => {
      const { sessionId, totalLeads, leadsDialed } = (event as CustomEvent).detail;
      setAutoDialSessionStats({ sessionId, totalLeads, leadsDialed });
      setShowSessionEnd(true);
    };
    window.addEventListener("auto-dial-session-end", handleSessionEnd);
    return () => window.removeEventListener("auto-dial-session-end", handleSessionEnd);
  }, []);

  // ── beforeunload: release lock + stop heartbeat + cancel claim ──
  useEffect(() => {
    const handleUnload = () => {
      if (currentLead?.id && lockMode) {
        releaseLock(currentLead.id as string);
      }
      stopHeartbeat();
      cancelClaimTimer();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLead?.id, lockMode]);

  // ── Telnyx answer → start claim timer (Team/Open only) ──
  useEffect(() => {
    if (!lockMode || !currentLead) return;
    if (telnyxCallState === "active") {
      setClaimRingActive(true);
      startClaimTimer(
        currentLead.id as string,
        (currentLead.lead_id || currentLead.id) as string,
        selectedCampaignId || ""
      );
    } else if (telnyxCallState === "idle" || telnyxCallState === "ended") {
      setClaimRingActive(false);
      // Cancel timer only on idle (ended keeps the card revealed during wrap-up)
      if (telnyxCallState === "idle") cancelClaimTimer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telnyxCallState, lockMode, currentLead?.id]);

  /* --- caller ID selection --- */
  // Redundant helper removed, now using getSmartCallerId from TelnyxContext

  /* --- call handlers --- */



  function handleSelectDisposition(d: Disposition) {
    if (selectedDisp?.id === d.id) {
      setSelectedDisp(null);
      setAptTitle("");
      setAptDate("");
      setAptStartTime("");
      setAptEndTime("");
      return;
    }
    setSelectedDisp(d);
    
    // Reset/Initialize requirements
    if (d.requireNotes) {
      // Keep existing noteText if it was typed, but ensure we show notes tab or indicator
    }
    
      
    if (d.appointmentScheduler) {
      const firstName = currentLead?.first_name || "Contact";
      setAptTitle(`Call with ${firstName}`);
      setAptType("Sales Call");
      const today = new Date().toISOString().split('T')[0];
      setAptDate(today);
      setAptStartTime("");
      setAptEndTime("");
    }

    if (d.name.toLowerCase().includes("no answer")) {
      autoSaveNoAnswer(d);
    }
  }

  async function autoSaveNoAnswer(d: Disposition) {
    if (!currentLead || !user) return;
    try {
      const masterId = currentLead.lead_id || currentLead.id;
      await saveCall({
        id: currentCallId || undefined,
        master_lead_id: masterId,
        campaign_lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        duration_seconds: telnyxCallDuration,
        disposition: d.name,
        notes: "",
        outcome: d.name,
        caller_id_used: lastUsedCallerId.current || undefined,
      }, organizationId);
    } catch {
      /* ignore */
    }
    handleAdvance();
  }

  const saveCallData = async () => {
    if (!currentLead || !user) return false;
    
    // Explicit Validation
    if (!selectedDisp) {
      toast.error("Please select a disposition");
      return false;
    }

    if (selectedDisp.requireNotes && noteText.length < (selectedDisp.minNoteChars || 0)) {
      setNoteError(true);
      toast.error(`Notes must be at least ${selectedDisp.minNoteChars} characters`);
      return false;
    }

    if (selectedDisp.callbackScheduler) {
      if (!callbackDate || !callbackTime) {
        toast.error("Please select a callback date and time");
        return false;
      }
    }

    if (selectedDisp.appointmentScheduler) {
      if (!aptTitle || !aptDate || !aptStartTime || !aptEndTime) {
        toast.error("Please fill in all appointment details");
        return false;
      }
    }

    try {
      const masterId = currentLead.lead_id || currentLead.id;
      
      // 1. Save appointment if needed
      if (selectedDisp?.appointmentScheduler) {
        if (!aptTitle || !aptDate || !aptStartTime || !aptEndTime) {
          toast.error("Please fill in all appointment details");
          return false;
        }
        await saveAppointment({
          master_lead_id: masterId,
          campaign_lead_id: currentLead.id,
          agent_id: user.id,
          campaign_id: selectedCampaignId!,
          title: aptTitle,
          date: aptDate,
          time: aptStartTime,
          end_time: aptEndTime,
          notes: aptNotes || noteText,
        }, organizationId);
        
        // Add to local calendar context for immediate UI feedback
        try {
          addAppointment({
            title: aptTitle,
            type: aptType as any,
            status: "Scheduled",
            contactName: `${currentLead.first_name} ${currentLead.last_name}`,
            contactId: masterId,
            date: new Date(aptDate),
            startTime: aptStartTime,
            endTime: aptEndTime,
            agent: user.email || "Me",
            notes: aptNotes || noteText,
          });
        } catch (e) {
          console.warn("Failed to update local calendar state", e);
        }
      }

      // 2. Save callback if needed
      if (selectedDisp?.callbackScheduler) {
        if (!callbackDate || !callbackTime) {
          toast.error("Please select callback date and time");
          return false;
        }
        await saveAppointment({
          master_lead_id: masterId,
          campaign_lead_id: currentLead.id,
          agent_id: user.id,
          campaign_id: selectedCampaignId!,
          title: "Callback",
          date: format(callbackDate, "yyyy-MM-dd"),
          time: callbackTime,
          end_time: "",
          notes: noteText,
        }, organizationId);
      }

      // 3. Save call record
      await saveCall({
        id: currentCallId || undefined,
        master_lead_id: masterId,
        campaign_lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        duration_seconds: telnyxCallDuration,
        disposition: selectedDisp?.name || "No Disposition",
        notes: noteText,
        outcome: selectedDisp?.name || "No Outcome",
        caller_id_used: lastUsedCallerId.current || undefined,
      }, organizationId);

      if (noteText.trim()) {
        await saveNote({
          master_lead_id: masterId,
          agent_id: user.id,
          content: noteText,
        }, organizationId);
      }

      // Also update the lead status in both the campaign and master record
      await updateLeadStatus(currentLead.id, masterId, selectedDisp?.name || "Called", organizationId);
      try {
        await leadsSupabaseApi.update(masterId, { status: (selectedDisp?.name as any) || "Called" });
      } catch (e) {
        console.warn("Master contact record update failed during save", e);
      }

      // ── Hard Claim (Team / Open Pool only) ──
      if (lockMode) {
        await claimOnDisposition(
          currentLead.id as string,
          masterId as string,
          selectedCampaignId!,
          selectedDisp?.name || "",
          telnyxCallDuration
        );
        stopHeartbeat();
        releaseLock(currentLead.id as string);
        setClaimRingActive(false);
      }

      // ── Campaign Action logic ──
      if (selectedDisp) {
        const action = selectedDisp.campaignAction || 'none';

        if (action === 'remove_from_campaign') {
          try {
            await supabase
              .from('campaign_leads')
              .update({ status: 'removed' })
              .eq('campaign_id', selectedCampaignId!)
              .eq('lead_id', currentLead.lead_id || currentLead.id);
          } catch (e) {
            console.warn("Failed to remove lead from campaign", e);
          }
          // Remove from local queue
          setLeadQueue(prev => prev.filter((_, i) => i !== currentLeadIndex));
        } else if (action === 'remove_from_queue') {
          // Mark as skipped in local session only — do NOT touch campaign_leads
          setLeadQueue(prev => prev.map((l, i) => i === currentLeadIndex ? { ...l, _skipped: true } : l));
        }

        // Auto-add to DNC if enabled
        if (selectedDisp.dncAutoAdd && currentLead.phone) {
          try {
            const { data: existing } = await supabase
              .from('dnc_list')
              .select('id')
              .eq('phone_number', currentLead.phone)
              .maybeSingle();
            if (!existing) {
              await supabase.from('dnc_list').insert({
                phone_number: currentLead.phone,
                reason: `Auto-added via disposition: ${selectedDisp.name}`,
                added_by: user.id,
                organization_id: organizationId,
              } as any);
            }
          } catch (e) {
            console.warn("Failed to auto-add to DNC list", e);
          }
        }
      }

      return true;
    } catch (e: any) {
      toast.error("Failed to save: " + e.message);
      return false;
    }
  };

  const handleSaveOnly = async () => {
    const toastId = toast.loading("Saving call data...");
    try {
      const success = await saveCallData();
      if (success) {
        setShouldAdvanceAfterModal(false);
        fetchHistory(currentLead.lead_id || currentLead.id);
        toast.success("Call saved successfully", { id: toastId });
        if (selectedDisp && selectedDisp.name.toLowerCase().includes("sold")) {
          setDialerStats(prev => prev ? { ...prev, policies_sold: prev.policies_sold + 1, last_updated_at: new Date().toISOString() } : prev);
          setSessionStats(prev => ({ ...prev, policies_sold: prev.policies_sold + 1 }));
          if (user?.id) upsertDialerStats(user.id, { policies_sold: 1 }).catch(() => {});
        }

        // Update local status
        if (selectedDisp) {
          setLeadQueue(prev => prev.map((l, i) => i === currentLeadIndex ? { ...l, status: selectedDisp.name } : l));
        }
      } else {
        toast.dismiss(toastId);
      }
    } catch (error: any) {
      toast.error(`Save failed: ${error.message}`, { id: toastId });
    }
  };

  const handleSaveAndNext = async () => {
    const toastId = toast.loading("Saving...");
    try {
      const success = await saveCallData();
      if (success) {
        setShouldAdvanceAfterModal(true);
        toast.success("Saved successfully", { id: toastId });
        if (selectedDisp && selectedDisp.name.toLowerCase().includes("sold")) {
          setDialerStats(prev => prev ? { ...prev, policies_sold: prev.policies_sold + 1, last_updated_at: new Date().toISOString() } : prev);
          setSessionStats(prev => ({ ...prev, policies_sold: prev.policies_sold + 1 }));
          if (user?.id) upsertDialerStats(user.id, { policies_sold: 1 }).catch(() => {});
        }

        // Delegate advance + auto-dial logic
        if (lockMode) {
          // Team/Open: fetch next locked lead atomically
          setShowWrapUp(false);
          setSelectedDisp(null);
          setNoteText("");
          setNoteError(false);
          setCurrentCallId(null);
          await loadLockModeLead();
        } else if (autoDialer && selectedDisp) {
          await autoDialer.saveDispositionAndNext(selectedDisp.id, noteText || undefined);
          // advance happens via auto-dial-next-lead / auto-dial-lead-closed events
        } else {
          handleAdvance();
        }
      } else {
        toast.dismiss(toastId);
      }
    } catch (error: any) {
      toast.error(`Save failed: ${error.message}`, { id: toastId });
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!currentLead) return;
    try {
      const campaignLeadId = currentLead.id; // Primary key in campaign_leads
      const masterLeadId = currentLead.lead_id || currentLead.id; // Primary key in leads

      // 1. Update the campaign lead status and contact activities
      await updateLeadStatus(campaignLeadId, masterLeadId, newStatus, organizationId);
      
      // 2. Also ensure the master lead record itself is updated
      if (masterLeadId) {
        try {
          await leadsSupabaseApi.update(masterLeadId, { status: newStatus as any });
        } catch (e) {
          console.warn("Master contact record update failed", e);
        }
      }

      // Update local queue state
      setLeadQueue(prev => prev.map((l, i) => i === currentLeadIndex ? { ...l, status: newStatus } : l));
      toast.success(`Status updated to ${newStatus}`);
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  };

  const currentStatusColor = useMemo(() => {
    if (!currentLead?.status) return "#6B7280";
    const status = currentLead.status.toLowerCase().trim();
    
    // 1. Try exact match in set stages
    const stage = leadStages.find(s => s.name.toLowerCase().trim() === status);
    if (stage) return stage.color;
    
    // 2. Try partial match in set stages (e.g. "New Lead" matches "New")
    const partialStage = leadStages.find(s => {
      const sName = s.name.toLowerCase().trim();
      return status.includes(sName) || sName.includes(status);
    });
    if (partialStage) return partialStage.color;

    // 3. Try exact match in fallbackStatusColors (case-insensitive)
    const fallbackKey = Object.keys(fallbackStatusColors).find(k => k.toLowerCase().trim() === status);
    if (fallbackKey) return fallbackStatusColors[fallbackKey];

    // 4. Try fuzzy match in fallbackStatusColors
    const fuzzyFallbackKey = Object.keys(fallbackStatusColors).find(k => {
      const kLow = k.toLowerCase().trim();
      return status.includes(kLow) || kLow.includes(status);
    });
    if (fuzzyFallbackKey) return fallbackStatusColors[fuzzyFallbackKey];
    
    // 5. If leadStages is loaded but no match, use the default stage color or first stage color
    if (leadStages.length > 0) {
      const defaultStage = leadStages.find(s => s.isDefault) || leadStages[0];
      return defaultStage.color;
    }
    
    return "#6B7280";
  }, [leadStages, currentLead?.status]);



  // ── Queue Position Persistence: save on every lead advance ──
  useEffect(() => {
    if (!user?.id || !selectedCampaignId || !currentLead) return;
    const leadId = currentLead.lead_id || currentLead.id;
    if (!leadId) return;
    (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .from('dialer_queue_state')
      .upsert({
        user_id: user.id,
        campaign_id: selectedCampaignId,
        current_lead_id: leadId,
        queue_index: currentLeadIndex,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,campaign_id' })
      .then(() => {})
      .catch(() => {});
  }, [currentLeadIndex, currentLead, user?.id, selectedCampaignId]);

  const startEditing = () => {
    if (!currentLead) return;
    setEditForm({
      first_name: currentLead.first_name || "",
      last_name: currentLead.last_name || "",
      phone: currentLead.phone || "",
      email: currentLead.email || "",
      state: currentLead.state || "",
      age: currentLead.age || "",
      date_of_birth: currentLead.date_of_birth || "",
      health_status: currentLead.health_status || "",
      best_time_to_call: currentLead.best_time_to_call || "",
      spouse_info: currentLead.spouse_info || "",
      source: currentLead.source || "",
      ...currentLead.custom_fields
    });
    setIsEditingContact(true);
  };

  const saveInlineEdit = async () => {
    if (!currentLead) return;
    try {
      const masterId = currentLead.lead_id || currentLead.id;
      const { first_name, last_name, phone, email, state, age, date_of_birth, health_status, best_time_to_call, spouse_info, source, ...customFields } = editForm;
      
      const parsedAge = age ? parseInt(String(age)) : undefined;
      const updateData: any = {
        firstName: first_name,
        lastName: last_name,
        phone,
        email,
        state,
        age: isNaN(Number(parsedAge)) ? undefined : Number(parsedAge),
        dateOfBirth: date_of_birth,
        healthStatus: health_status,
        bestTimeToCall: best_time_to_call,
        spouseInfo: spouse_info || "",
        leadSource: source,
        customFields
      };

      await leadsSupabaseApi.update(masterId, updateData);
      
      // Update denormalized fields in campaign_leads if it's a campaign lead
      if (currentLead.id && currentLead.id !== masterId) {
        await supabase
          .from('campaign_leads')
          .update({
            first_name,
            last_name,
            phone,
            email,
            state
          })
          .eq('id', currentLead.id);
      }
      
      // Update local queue
      setLeadQueue(prev => prev.map((l, i) => i === currentLeadIndex ? { 
        ...l, 
        first_name, 
        last_name, 
        phone, 
        email, 
        state, 
        age: isNaN(Number(parsedAge)) ? l.age : Number(parsedAge), 
        date_of_birth, 
        health_status, 
        best_time_to_call, 
        spouse_info, 
        source,
        custom_fields: customFields
      } : l));
      
      setIsEditingContact(false);
      toast.success("Contact updated");
    } catch (err: any) {
      toast.error("Failed to update contact: " + err.message);
    }
  };

  async function handleSaveCallback() {
    if (!currentLead || !user || !callbackDate) return;
    try {
      const masterId = currentLead.lead_id || currentLead.id;
      await saveAppointment({
        master_lead_id: masterId,
        campaign_lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        title: "Callback",
        date: format(callbackDate, "yyyy-MM-dd"),
        time: callbackTime,
        end_time: "",
        notes: "",
      }, organizationId);
    } catch {
      /* ignore */
    }
    setShowCallbackModal(false);
    setCallbackDate(undefined);
    setCallbackTime("");
    if (shouldAdvanceAfterModal) {
      handleAdvance();
    }
  }


  const handleOpenTemplates = async () => {
    setShowTemplatesModal(true);
    setTemplatesLoading(true);
    const { data } = await supabase
      .from('message_templates')
      .select('id, name, type, content')
      .order('name');
    setTemplates(data || []);
    setTemplatesLoading(false);
  };

  function handleSendMessage() {
    toast.info(`${smsTab.toUpperCase()} sending coming soon`);
    setMessageText("");
    setSubjectText("");
  }

  function handleSmsTabChange(tab: "sms" | "email") {
    setSmsTab(tab);
    setMessageText("");
    setSubjectText("");
  }

  /* ─── RENDER ─── */

  // Selection screen
  if (!selectedCampaignId) {
    return (
      <>
        <CampaignSelection
          campaigns={campaigns}
          campaignsLoading={campaignsLoading}
          campaignStateStats={campaignStateStats}
          onSelectCampaign={setSelectedCampaignId}
          onOpenSettings={(id) => {
            setSettingsCampaignId(id);
            setCallingSettingsOpen(true);
          }}
          onToggleLocalPresence={handleToggleLocalPresence}
        />
        <CampaignSettingsModal
          open={callingSettingsOpen}
          onOpenChange={(open) => { setCallingSettingsOpen(open); if (!open) setSettingsCampaignId(null); }}
          campaignName={campaigns.find(c => c.id === settingsCampaignId)?.name || ""}
          isUnlimited={isUnlimited}
          setIsUnlimited={setIsUnlimited}
          maxAttemptsValue={maxAttemptsValue}
          setMaxAttemptsValue={setMaxAttemptsValue}
          callingHoursStart={callingHoursStart}
          setCallingHoursStart={setCallingHoursStart}
          callingHoursEnd={callingHoursEnd}
          setCallingHoursEnd={setCallingHoursEnd}
          retryIntervalHours={retryIntervalHours}
          setRetryIntervalHours={setRetryIntervalHours}
          ringTimeoutValue={ringTimeoutValue}
          setRingTimeoutValue={setRingTimeoutValue}
          settingsAutoDialEnabled={settingsAutoDialEnabled}
          setSettingsAutoDialEnabled={setSettingsAutoDialEnabled}
          localPresenceEnabled={localPresenceEnabled}
          setLocalPresenceEnabled={setLocalPresenceEnabled}
          amdEnabledValue={amdEnabledValue}
          setAmdEnabledValue={setAmdEnabledValue}
          loading={callingSettingsLoading}
          saving={callingSettingsSaving}
          onSave={handleSaveCallingSettings}
        />
      </>
    );
  }

  // Dialer view
  if (loadingLeads && leadQueue.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background text-foreground items-center justify-center p-6">
        <Loader2 className="w-6 h-6 animate-spin text-primary mb-3" />
        <p className="text-sm text-muted-foreground">Loading lead queue…</p>
      </div>
    );
  }

  if (leadQueue.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background text-foreground items-center justify-center p-6 text-center">
        <div className="bg-accent/30 p-8 rounded-full mb-6">
          <Users className="w-12 h-12 text-muted-foreground opacity-40" />
        </div>
        <h2 className="text-xl font-bold mb-2">Campaign Queue Empty</h2>
        <p className="text-sm text-muted-foreground max-w-md mb-8">
          There are no remaining leads to dial in this campaign that haven't already been called or marked as DNC.
        </p>
        <button
          onClick={() => {
            setSelectedCampaignId(null);
            setLeadQueue([]);
          }}
          className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-semibold hover:bg-primary/90 transition-colors"
        >
          Return to Campaigns
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ─── Mid-Call Refresh Recovery Banner ─── */}
      {orphanCall && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-600 text-white px-4 py-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-lg">&#9888;</span>
            <div>
              <p className="font-semibold text-sm">Active call detected after page reload</p>
              <p className="text-xs opacity-90">
                Call {orphanCall.id.slice(0, 8)}... is still {orphanCall.status} on the network.
                Audio cannot be restored — use Hang Up to terminate cleanly.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={hangUpOrphan}
              className="bg-red-700 hover:bg-red-800 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
            >
              Hang Up
            </button>
            <button
              onClick={dismissOrphanCall}
              className="text-white/70 hover:text-white text-sm px-2 py-1.5 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Message Templates</h3>
              <button
                onClick={() => { setShowTemplatesModal(false); setTemplateSearch(''); }}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              placeholder="Search templates..."
              value={templateSearch}
              onChange={e => setTemplateSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {templatesLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="h-12 rounded-lg bg-accent animate-pulse" />
                ))}
              </div>
            ) : templates.filter(t =>
                t.name.toLowerCase().includes(templateSearch.toLowerCase())
              ).length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                {templates.length === 0
                  ? 'No templates found. Add templates in Settings → Email & SMS Templates.'
                  : 'No templates match your search.'}
              </div>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {templates
                  .filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase()))
                  .map(t => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setMessageText(t.content);
                        setShowTemplatesModal(false);
                        setTemplateSearch('');
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-accent sidebar-transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{t.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t.type}</span>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
      {showCallerIdWarning && pendingCall && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-card border border-warning/50 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-warning text-xl">⚠️</span>
              <div>
                <h3 className="font-semibold text-foreground">Caller ID Changed</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  This contact was previously called from{' '}
                  <span className="font-mono text-foreground">{pendingCall.previousNumber}</span>,
                  but that number is now <span className="text-destructive font-medium">Flagged</span>.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Calling from <span className="font-mono text-foreground">{pendingCall.proposedNumber}</span> instead.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCallerIdWarning(false); setPendingCall(null); }}
                className="flex-1 py-2 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowCallerIdWarning(false);
                  if (pendingCall) proceedWithCall(pendingCall.leadPhone, pendingCall.proposedNumber);
                  setPendingCall(null);
                }}
                className="flex-1 py-2 rounded-lg bg-warning text-warning-foreground text-sm font-medium hover:bg-warning/90"
              >
                Call Anyway
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col h-[calc(100vh-80px)] lg:h-[calc(100vh-88px)] -mt-4 lg:-mt-6 -mb-4 lg:-mb-6 overflow-hidden bg-background text-foreground">
        {/* ── CAMPAIGN TYPE STRIPE (3px, full-width) ── */}
        {lockMode && (() => {
          const t = campaignType.toUpperCase();
          const gradient = t === "TEAM"
            ? "linear-gradient(to right, #6366f1, #8b5cf6, #a855f7)"
            : "linear-gradient(to right, #f59e0b, #ef4444, #f59e0b)";
          return (
            <div
              style={{ height: "3px", background: gradient, flexShrink: 0 }}
              aria-hidden="true"
            />
          );
        })()}
      {/* ── TOP CONTROL BAR ── */}
      <div className="flex items-center border-b px-4 py-1 gap-4">
        {/* LEFT */}
        <button
          onClick={() => {
            // Release lock + stop heartbeat + cancel claim on session end
            if (lockMode && currentLead?.id) {
              releaseLock(currentLead.id as string);
            }
            stopHeartbeat();
            cancelClaimTimer();
            setClaimRingActive(false);
            // Stop session timer
            if (sessionTimerRef.current) {
              clearInterval(sessionTimerRef.current);
              sessionTimerRef.current = null;
            }
            setSessionElapsed(0);
            // Clear saved queue position
            if (user?.id && selectedCampaignId) {
              (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                .from('dialer_queue_state')
                .delete()
                .eq('user_id', user.id)
                .eq('campaign_id', selectedCampaignId)
                .then(() => {})
                .catch(() => {});
            }
            telnyxDestroy();
            setSelectedCampaignId(null);
            setLeadQueue([]);
            setCurrentLeadIndex(0);
          }}
          className="border border-destructive text-destructive text-xs rounded-lg px-3 py-1 font-semibold shrink-0 hover:bg-destructive hover:text-destructive-foreground transition-colors"
        >
          ← End Session
        </button>

        {/* CENTER: centered inline stats in subtle boxes */}
        <div className="flex items-center justify-center flex-1 gap-2">
          {statsLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center px-3 py-1 bg-accent/30 border border-border/50 rounded-xl min-w-[70px]">
                <Skeleton className="h-2 w-10 mb-1" />
                <Skeleton className="h-2.5 w-6" />
              </div>
            ))
          ) : (
            [
              { label: "Session Duration", value: dialerStats?.session_started_at ? fmtSessionDuration(sessionElapsed) : "—" },
              { label: "Calls Made", value: sessionStats.calls_made },
              { label: "Connected", value: sessionStats.calls_connected },
              { label: "Answer Rate", value: sessionStats.calls_made > 0 ? `${Math.round(sessionStats.calls_connected / sessionStats.calls_made * 100)}%` : "—" },
              { label: "Policies Sold", value: sessionStats.policies_sold },
              { label: "Avg Talk Time", value: sessionStats.calls_connected > 0 ? fmtDuration(Math.round(sessionStats.total_talk_seconds / sessionStats.calls_connected)) : "—" },
            ].map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center px-3 py-1 bg-accent/30 border border-border/50 rounded-xl min-w-0 h-14 justify-center transition-all hover:bg-accent/50"
              >
                <div className="text-[8px] text-muted-foreground uppercase tracking-wider font-semibold truncate w-full text-center">{s.label}</div>
                <div className="text-xs font-bold font-mono text-foreground">{s.value}</div>
              </div>
            ))
          )}
        </div>

        {/* RIGHT */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Auto-Dial toggle */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium">Auto-Dial</label>
            <Switch
              checked={autoDialEnabled}
              onCheckedChange={(checked) => {
                setAutoDialEnabled(checked);
                if (autoDialer) {
                  if (checked) {
                    autoDialer.resumeAutoDialer();
                    setIsPaused(false);
                  } else {
                    autoDialer.pauseAutoDialer();
                  }
                }
              }}
            />
          </div>

          {/* Pause/Resume button */}
          {autoDialEnabled && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2 gap-1"
              onClick={() => {
                if (isPaused) {
                  autoDialer?.resumeAutoDialer();
                  setIsPaused(false);
                } else {
                  autoDialer?.pauseAutoDialer();
                  setIsPaused(true);
                }
              }}
            >
              {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {isPaused ? "Resume" : "Pause"}
            </Button>
          )}

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success inline-block" />
            <span className="text-success text-xs font-semibold">Dialer Ready</span>
          </div>
          {/* Campaign type badge */}
          {(() => {
            const t = campaignType.toUpperCase();
            const isTeam = t === "TEAM";
            const isOpen = t.includes("OPEN");
            const dotColor = isTeam ? "#8b5cf6" : isOpen ? "#f59e0b" : "#22c55e";
            const typeLabel = isTeam ? "TEAM" : isOpen ? "OPEN" : "PERSONAL";
            return (
              <div className="flex items-center gap-1.5 bg-accent/30 border border-border px-2 py-0.5 rounded-full">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: dotColor }}
                />
                <span className="text-[10px] font-bold font-mono text-foreground uppercase tracking-widest">
                  {typeLabel} · {selectedCampaign?.name ?? "No Campaign"}
                </span>
              </div>
            );
          })()}
        </div>
      </div>


      {/* ── COLUMNS ── */}
      <div className="flex flex-1 overflow-hidden p-3 gap-3">
        {/* ── NEW LEFT COLUMN (Contact Info) ── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden">
          <div className="bg-card border rounded-xl flex flex-col overflow-hidden h-full">
            {/* Header section — shrink-0 */}
            <div className="p-3 border-b flex flex-col gap-2 bg-card shrink-0">
              <div className="flex items-center justify-between gap-2 overflow-hidden">
                {/* Name / Edit Fields */}
                {currentLead && (
                  <div className="flex-1 min-w-0">
                    {isEditingContact ? (
                      <div className="flex gap-1">
                        <input 
                          value={editForm.first_name || ""}
                          onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                          className="bg-accent/50 border border-border rounded px-1.5 py-1 text-xs font-bold w-full focus:ring-1 focus:ring-primary outline-none"
                          placeholder="First"
                        />
                        <input 
                          value={editForm.last_name || ""}
                          onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                          className="bg-accent/50 border border-border rounded px-1.5 py-1 text-xs font-bold w-full focus:ring-1 focus:ring-primary outline-none"
                          placeholder="Last"
                        />
                      </div>
                    ) : (
                      <h2 className="text-sm font-bold text-foreground truncate" title={`${currentLead?.first_name ?? ""} ${currentLead?.last_name ?? ""}`.trim()}>
                        {`${currentLead?.first_name ?? ""} ${currentLead?.last_name ?? ""}`.trim()}
                      </h2>
                    )}
                  </div>
                )}

                {/* Actions Group (Arrows + View/Edit) */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Arrows */}
                  <div className="flex items-center">
                    <button 
                      onClick={() => {
                        if (currentLeadIndex > 0) {
                          setCurrentLeadIndex(i => i - 1);
                          setShowWrapUp(false);
                          setSelectedDisp(null);
                          setNoteText("");
                          setNoteError(false);
                        }
                      }}
                      disabled={currentLeadIndex === 0}
                      className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Previous Lead"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => {
                        if (currentLeadIndex < leadQueue.length - 1) {
                          setCurrentLeadIndex(i => i + 1);
                          setShowWrapUp(false);
                          setSelectedDisp(null);
                          setNoteText("");
                          setNoteError(false);
                        }
                      }}
                      disabled={currentLeadIndex >= leadQueue.length - 1}
                      className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Next Lead"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="w-px h-4 bg-border mx-0.5" />

                  {/* View/Edit */}
                  <button 
                    onClick={() => setShowFullViewDrawer(true)}
                    className="p-1 px-1 text-primary hover:bg-primary/10 rounded transition-colors"
                    title="Full View"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {isEditingContact ? (
                    <div className="flex items-center gap-0.5">
                      <button 
                        onClick={saveInlineEdit}
                        className="p-1 px-1 text-success hover:bg-success/10 rounded transition-colors"
                        title="Save Edits"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setIsEditingContact(false)}
                        className="p-1 px-1 text-destructive hover:bg-destructive/10 rounded transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={startEditing}
                      className="p-1 px-1 text-primary hover:bg-primary/10 rounded transition-colors"
                      title="Edit Contact"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Status and Time */}
              {currentLead && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <select
                      value={currentLead?.status || ""}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      className="w-full text-[10px] text-center uppercase tracking-widest font-bold rounded-md px-6 py-1 border border-transparent appearance-none focus:ring-0 cursor-pointer transition-colors"
                      style={getStatusColorStyle(currentStatusColor)}
                    >
                      {leadStages.map(s => (
                        <option key={s.id} value={s.name} style={{ color: s.color }}>
                          {normalizeStatusDisplay(s.name)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                  </div>
                  
                  {contactLocalTimeDisplay && (
                    <div className="shrink-0 inline-flex items-center justify-center text-green-500 text-[10px] font-bold">
                      <Clock className="w-2.5 h-2.5 mr-1" />
                      {contactLocalTimeDisplay}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Staged lead reveal — handled by LeadCard */}
            <LeadCard
              lead={currentLead}
              callStatus={callStatus}
              callAttempts={currentLead?.call_attempts ?? 0}
              maxAttempts={selectedCampaign?.max_attempts ?? null}
              lastDisposition={history.find(h => h.type === "call")?.disposition ?? null}
              isClaimed={claimedLeadIds.has((currentLead?.lead_id || currentLead?.id) as string)}
              isEditing={isEditingContact}
              editForm={editForm}
              onEditChange={(key, val) => setEditForm((prev: any) => ({ ...prev, [key]: val }))}
            />
          </div>
        </div>

        {/* ── CENTER COLUMN (Conversation History) ── */}
        <div className="flex-[1.5] flex flex-col overflow-hidden min-h-0">
          <div className="flex flex-col flex-1 overflow-hidden bg-card border rounded-xl">
            {/* Header — shrink-0 */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">Conversation History</span>
              </div>
              <div className="flex items-center gap-2 px-2 py-1 bg-accent/30 rounded-lg border border-border">
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">From:</span>
                <select
                  value={selectedCallerNumber}
                  onChange={(e) => setSelectedCallerNumber(e.target.value)}
                  className="bg-transparent border-none text-xs font-semibold text-foreground focus:ring-0 p-0 h-auto cursor-pointer outline-none transition-all"
                >
                  <option value="">AI Local Presence</option>
                  {availableNumbers.map(n => (
                    <option key={n.phone_number} value={n.phone_number}>
                      {n.friendly_name ? `${n.friendly_name} - ` : ''}{n.phone_number}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Scrollable feed — flex-1 overflow-y-auto */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {loadingHistory && (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loadingHistory && history.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-6">No activity yet</p>
              )}
              {!loadingHistory &&
                history.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                      {historyIcon(item.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-foreground">{item.description}</span>
                        {item.type === "call" && item.disposition && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: item.disposition_color
                                ? `${item.disposition_color}33`
                                : undefined,
                              color: item.disposition_color ?? undefined,
                            }}
                          >
                            {item.disposition}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatDateTime(new Date(item.created_at))}
                      </div>
                    </div>
                  </div>
                ))}
              <div ref={historyEndRef} />
            </div>
          </div>

          {/* SMS composer — shrink-0, fixed at bottom */}
          <div className="shrink-0 bg-card border rounded-xl flex flex-col mt-3">
            <div className="px-4 pt-3">
              {/* Tab Fields */}
              {smsTab === "email" ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={subjectText}
                    onChange={(e) => setSubjectText(e.target.value)}
                    placeholder="Subject"
                    className="bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground w-full"
                  />
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type EMAIL message…"
                    className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none h-20"
                  />
                </div>
              ) : (
                <div className="text-foreground">
                  <input
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type SMS message…"
                    className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              )}
            </div>

            {/* Action Buttons Row: Tabs (Left) + Actions (Right) */}
            <div className="flex items-center justify-between px-4 py-3 border-t mt-3">
              {/* LEFT: Tab switcher */}
              <div className="flex gap-1">
                {(["sms", "email"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => handleSmsTabChange(tab)}
                    className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                      smsTab === tab
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* RIGHT: Templates + Send */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOpenTemplates}
                  className="bg-accent text-muted-foreground border border-border rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/80 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Templates
                </button>

                <button
                  onClick={handleSendMessage}
                  className="bg-success text-success-foreground rounded-lg px-4 py-1.5 text-xs font-bold flex items-center gap-2 hover:bg-success/90 transition-all shadow-sm border border-success/20"
                  title={smsTab === "email" ? "Send Email" : "Send SMS"}
                >
                  <span>Send</span>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN (Controls & Outcomes) ── */}
        <div className="w-80 shrink-0 flex flex-col h-full overflow-hidden">
          {/* Top Actions: Hang Up / Skip */}
          <div className="grid grid-cols-2 gap-2 mb-3 shrink-0">
            {telnyxCallState === "active" || telnyxCallState === "dialing" ? (
              <button
                onClick={handleHangUp}
                className="bg-destructive text-destructive-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-destructive/90 shadow-lg shadow-destructive/20"
              >
                <PhoneOff className="w-4 h-4" />
                <span className="leading-none">Hang Up</span>
                <span className="font-mono text-[9px] opacity-80">{fmtDuration(telnyxCallDuration)}</span>
                {amdEnabled && amdStatus !== 'idle' && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    amdStatus === 'detecting' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' :
                    amdStatus === 'human' ? 'bg-emerald-500/20 text-emerald-400' :
                    amdStatus === 'machine' ? 'bg-red-500/20 text-red-400' : ''
                  }`}>
                    {amdStatus === 'detecting' ? '🔍 AMD' :
                     amdStatus === 'human' ? '👤 Human' :
                     amdStatus === 'machine' ? '🤖 Machine' : ''}
                  </span>
                )}
              </button>
            ) : (
              <div className="relative">
                <ClaimRing
                  active={claimRingActive}
                  campaignType={campaignType}
                  onClaim={() => {
                    // ClaimRing fires this at 30s — claim is already handled by useHardClaim timer
                    // This callback is a UI signal only; no DB call here.
                  }}
                />
                <button
                  onClick={handleCall}
                  className="w-full bg-success text-success-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-success/90 shadow-lg shadow-success/20"
                >
                  <Phone className="w-4 h-4" />
                  <span className="leading-none">Call</span>
                </button>
              </div>
            )}
            <button
              onClick={handleSkip}
              className="bg-accent text-accent-foreground border border-border rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-accent/80"
            >
              <ArrowRight className="w-4 h-4" />
              <span className="leading-none">Skip</span>
            </button>
          </div>

          {/* Main Controls Card with truly fixed footer */}
          <div className="bg-card border rounded-xl overflow-hidden flex flex-col flex-1 min-h-0 min-w-0">
              <div className="grid grid-cols-3 border-b shrink-0">
                {(["dispositions", "queue", "scripts"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLeftTab(t)}
                    className={`py-2.5 text-[10px] uppercase tracking-widest font-bold transition-all ${
                      leftTab === t
                        ? "bg-primary/10 text-primary border-b-2 border-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-muted/5">
                {leftTab === "dispositions" && (
                  <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-2 duration-300">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2 block">
                        Select Outcome
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {dispositions.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => handleSelectDisposition(d)}
                            className={cn(
                              "flex flex-col items-center justify-center p-2 rounded-lg border text-[10px] font-bold uppercase tracking-tight text-center transition-all h-16 group relative",
                              selectedDisp?.id === d.id
                                ? "ring-2 ring-primary border-primary bg-primary/10 text-primary"
                                : "border-border bg-card text-muted-foreground hover:bg-accent"
                            )}
                            style={selectedDisp?.id === d.id ? {} : { 
                              backgroundColor: d.color ? `${d.color}15` : undefined,
                              borderColor: d.color ? `${d.color}30` : undefined,
                              color: d.color ?? undefined
                            }}
                          >
                            <span className="line-clamp-2">{d.name}</span>
                            {/* Small indicator dots for requirements */}
                            <div className="absolute top-1 right-1 flex gap-0.5">
                              {d.requireNotes && <div className="w-1 h-1 rounded-full bg-current opacity-60" title="Notes Required" />}
                              {(d.appointmentScheduler || d.callbackScheduler) && <div className="w-1 h-1 rounded-full bg-current opacity-60" title="Scheduling Required" />}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Requirement Sections */}
                    {selectedDisp && (
                      <div className="flex flex-col gap-4 pt-4 border-t">
                        {/* Requirement: Notes */}
                        {selectedDisp.requireNotes && (
                          <div className="space-y-2 animate-in slide-in-from-top-2 duration-300">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5">
                                <FileText className="w-3 h-3" /> Call Notes *
                              </label>
                              <span className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded-full font-bold",
                                noteText.length >= (selectedDisp.minNoteChars || 0)
                                  ? "bg-success/10 text-success"
                                  : "bg-destructive/10 text-destructive"
                              )}>
                                {noteText.length >= (selectedDisp.minNoteChars || 0) ? "Done" : `${selectedDisp.minNoteChars - noteText.length} chars left`}
                              </span>
                            </div>
                            <textarea
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder={`Enter at least ${selectedDisp.minNoteChars} characters...`}
                              className={cn(
                                "w-full bg-card border rounded-lg p-2.5 text-xs placeholder:text-muted-foreground focus:ring-1 focus:ring-primary h-24 resize-none transition-all",
                                noteText.length < (selectedDisp.minNoteChars || 0) ? "border-muted-foreground/30 focus:border-primary" : "border-success/50"
                              )}
                            />
                          </div>
                        )}

                        {/* Requirement: Callback */}
                        {selectedDisp.callbackScheduler && (
                          <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5">
                              <Clock className="w-3 h-3" /> Schedule Callback *
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <span className="text-[9px] text-muted-foreground font-medium">Date</span>
                                <DateInput
                                  value={callbackDate ? callbackDate.toISOString().split('T')[0] : ""}
                                  onChange={(val) => setCallbackDate(val ? new Date(val + "T00:00:00") : undefined)}
                                />
                              </div>
                              <div className="space-y-1">
                                <span className="text-[9px] text-muted-foreground font-medium">Time</span>
                                <select 
                                  value={callbackTime}
                                  onChange={(e) => setCallbackTime(e.target.value)}
                                  className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none h-[30px]"
                                >
                                  <option value="">Select Time</option>
                                  {Array.from({ length: 48 }).map((_, i) => {
                                    const h = Math.floor(i / 2);
                                    const m = (i % 2) * 30;
                                    const period = h < 12 ? "AM" : "PM";
                                    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                                    const time = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
                                    return <option key={time} value={time}>{time}</option>;
                                  })}
                                </select>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Requirement: Appointment */}
                        {selectedDisp.appointmentScheduler && (
                          <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5">
                              <CalendarIcon className="w-3 h-3" /> Schedule Appointment *
                            </label>
                            <div className="space-y-2.5">
                              <div className="space-y-1">
                                <span className="text-[9px] text-muted-foreground font-medium">Title</span>
                                <input
                                  value={aptTitle}
                                  onChange={(e) => setAptTitle(e.target.value)}
                                  className="w-full bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none"
                                  placeholder="Appointment Title"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <span className="text-[9px] text-muted-foreground font-medium">Type</span>
                                  <select
                                    value={aptType}
                                    onChange={(e) => setAptType(e.target.value)}
                                    className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none h-[30px]"
                                  >
                                    <option value="Sales Call">Sales Call</option>
                                    <option value="Follow Up">Follow Up</option>
                                    <option value="Policy Review">Policy Review</option>
                                    <option value="Recruit Interview">Recruit Interview</option>
                                    <option value="Other">Other</option>
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[9px] text-muted-foreground font-medium">Date</span>
                                  <DateInput
                                    value={aptDate}
                                    onChange={setAptDate}
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <span className="text-[9px] text-muted-foreground font-medium">Start Time</span>
                                  <select
                                    value={aptStartTime}
                                    onChange={(e) => setAptStartTime(e.target.value)}
                                    className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none h-[30px]"
                                  >
                                    {Array.from({ length: 48 }).map((_, i) => {
                                      const h = Math.floor(i / 2);
                                      const m = (i % 2) * 30;
                                      const period = h < 12 ? "AM" : "PM";
                                      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                                      const time = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
                                      return <option key={time} value={time}>{time}</option>;
                                    })}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[9px] text-muted-foreground font-medium">End Time</span>
                                  <select
                                    value={aptEndTime}
                                    onChange={(e) => setAptEndTime(e.target.value)}
                                    className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none h-[30px]"
                                  >
                                    {Array.from({ length: 48 }).map((_, i) => {
                                      const h = Math.floor(i / 2);
                                      const m = (i % 2) * 30;
                                      const period = h < 12 ? "AM" : "PM";
                                      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
                                      const time = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
                                      return <option key={time} value={time}>{time}</option>;
                                    })}
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}


                {leftTab === "queue" && (
                  <QueuePanel
                    campaignType={campaignType}
                    campaignId={selectedCampaignId!}
                    organizationId={organizationId}
                    userRole={(profile as any)?.role || "Agent"}
                    displayQueue={displayQueue as any}
                    leadQueue={leadQueue as any}
                    currentLeadIndex={currentLeadIndex}
                    onSelectLead={setCurrentLeadIndex}
                    queueSort={queueSort}
                    setQueueSort={setQueueSort}
                    showQueueFilters={showQueueFilters}
                    setShowQueueFilters={setShowQueueFilters}
                    showQueueFieldPicker={showQueueFieldPicker}
                    setShowQueueFieldPicker={setShowQueueFieldPicker}
                    queuePreviewFields={queuePreviewFields}
                    setQueuePreviewFields={setQueuePreviewFields}
                    loadingLeads={loadingLeads}
                    hasMoreLeads={hasMoreLeads}
                    currentOffset={currentOffset}
                    fetchLeadsBatch={fetchLeadsBatch}
                    renderQueuePreviewValue={renderQueuePreviewValue}
                    PREVIEW_FIELD_LABELS={PREVIEW_FIELD_LABELS}
                    onClearFilters={() => setQueueFilter({ status: '', state: '', leadSource: '', minAttempts: 0, maxAttempts: 99, minScore: 0, maxScore: 10 })}
                    filterSummary={
                      (queueSort !== 'default' || queueFilter.status || queueFilter.state || queueFilter.leadSource || queueFilter.maxAttempts < 99 || queueFilter.minScore > 0 || queueFilter.maxScore < 10)
                        ? `Showing ${displayQueue.length} of ${leadQueue.length} leads`
                        : ""
                    }
                  />
                )}

                {leftTab === "scripts" && (
                  <div className="flex flex-col gap-2">
                    {availableScripts.length === 0 ? (
                      <div className="text-center py-8">
                        <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
                        <p className="text-sm text-muted-foreground">No scripts available</p>
                      </div>
                    ) : (
                      availableScripts.map((script) => (
                        <button
                          key={script.id}
                          onClick={() => setActiveScriptId(script.id)}
                          className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors flex items-center justify-between group"
                        >
                          <span className="text-xs font-bold text-foreground uppercase tracking-tight">
                            {script.name}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {/* Fixed Footer for Right Column Actions */}
              <div className="p-4 border-t bg-card shrink-0">
                {selectedDisp && (
                  <div className="mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {/* Unified Requirement Indicator */}
                    {(selectedDisp.requireNotes && noteText.length < (selectedDisp.minNoteChars || 0)) ||
                     (selectedDisp.callbackScheduler && (!callbackDate || !callbackTime)) ||
                     (selectedDisp.appointmentScheduler && (!aptTitle || !aptDate || !aptStartTime || !aptEndTime)) ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
                          <Activity className="w-3.5 h-3.5 animate-pulse" />
                          <span className="text-[10px] font-bold uppercase tracking-tight">
                            Requirements Missing
                          </span>
                        </div>
                        <div className="flex flex-col gap-1 px-1">
                          {selectedDisp.requireNotes && noteText.length < (selectedDisp.minNoteChars || 0) && (
                            <div className="text-[9px] text-destructive flex items-center gap-1">
                              <X className="w-2.5 h-2.5" /> Notes ({selectedDisp.minNoteChars - noteText.length} more chars)
                            </div>
                          )}
                          {selectedDisp.callbackScheduler && (!callbackDate || !callbackTime) && (
                            <div className="text-[9px] text-destructive flex items-center gap-1">
                              <X className="w-2.5 h-2.5" /> Callback Date & Time
                            </div>
                          )}
                          {selectedDisp.appointmentScheduler && (!aptTitle || !aptDate || !aptStartTime || !aptEndTime) && (
                            <div className="text-[9px] text-destructive flex items-center gap-1">
                              <X className="w-2.5 h-2.5" /> Appointment Details
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-success/10 border border-success/20 rounded-lg text-success">
                          <Check className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold uppercase tracking-tight">Ready to Save</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!selectedDisp && (
                  <div className="mb-3 px-3 py-2 bg-muted/50 border border-border rounded-lg text-muted-foreground flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 opacity-50" />
                    <span className="text-[10px] font-bold uppercase tracking-tight">Select a disposition to save</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleSaveOnly}
                    disabled={!selectedDisp}
                    className="h-11 rounded-xl bg-accent text-accent-foreground font-bold text-xs shadow-sm hover:bg-accent/80 transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                  <button
                    onClick={handleSaveAndNext}
                    disabled={!selectedDisp}
                    className="h-11 rounded-xl bg-primary text-primary-foreground font-bold text-xs shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Save and Next
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {activeScriptId && (
          <DraggableScriptPopup
            name={availableScripts.find((s) => s.id === activeScriptId)?.name || "Script"}
            content={availableScripts.find((s) => s.id === activeScriptId)?.content || ""}
            onClose={() => setActiveScriptId(null)}
            initialX={window.innerWidth - 480}
            initialY={100}
          />
        )}
      </AnimatePresence>

      {/* ── CALLBACK MODAL ── */}
      <Dialog
        open={showCallbackModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowCallbackModal(false);
            if (shouldAdvanceAfterModal) handleAdvance();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Callback</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Calendar mode="single" selected={callbackDate} onSelect={setCallbackDate} />
            <input
              value={callbackTime}
              onChange={(e) => setCallbackTime(e.target.value)}
              placeholder="e.g. 2:30 PM"
              className="bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => {
                setShowCallbackModal(false);
                setCallbackDate(undefined);
                setCallbackTime("");
                if (shouldAdvanceAfterModal) handleAdvance();
              }}
              className="border border-border rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Skip
            </button>
            <button
              onClick={handleSaveCallback}
              disabled={!callbackDate || !callbackTime}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Save Callback
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── APPOINTMENT MODAL ── */}
      <AppointmentModal
        open={showAppointmentModal}
        onClose={() => {
          setShowAppointmentModal(false);
          if (shouldAdvanceAfterModal) {
            handleAdvance();
          }
        }}
        onSave={(data) => {
          addAppointment(data);
          if (currentLead && user && selectedCampaignId) {
            const masterId = currentLead.lead_id || currentLead.id;
            saveAppointment({
              master_lead_id: masterId,
              campaign_lead_id: currentLead.id,
              agent_id: user.id,
              campaign_id: selectedCampaignId,
              title: data.title,
              date: format(data.date, "yyyy-MM-dd"),
              time: data.startTime,
              end_time: data.endTime,
              notes: data.notes,
            }, organizationId).catch(() => {});
          }
          setShowAppointmentModal(false);
          if (shouldAdvanceAfterModal) {
            handleAdvance();
          }
        }}
        prefillContactName={currentLead ? `${currentLead.first_name} ${currentLead.last_name}` : ""}
        prefillContactId={currentLead?.id}
      />


      {showFullViewDrawer && currentLead && (
        <FullScreenContactView
          contact={mapDialerLeadToContactLead(currentLead)}
          type="lead"
          onClose={() => setShowFullViewDrawer(false)}
          onUpdate={async (id, data) => {
            try {
              await leadsSupabaseApi.update(id, data);
              // Refresh local queue state by matching either the lead_id or the internal id
              setLeadQueue(prev => prev.map(l => (l.lead_id === id || l.id === id) ? {
                ...l,
                ...data,
                first_name: data.firstName ?? l.first_name,
                last_name: data.lastName ?? l.last_name,
                email: data.email ?? l.email,
                phone: data.phone ?? l.phone,
                state: data.state ?? l.state,
                status: data.status ?? l.status,
              } : l));
              toast.success("Contact updated successfully");
            } catch (err: any) {
              toast.error("Failed to update contact: " + err.message);
            }
          }}
          onDelete={async (id) => {
            try {
              await leadsSupabaseApi.delete(id);
              setLeadQueue(prev => prev.filter(l => l.id !== id));
              setShowFullViewDrawer(false);
              toast.success("Contact deleted");
            } catch (err: any) {
              toast.error("Failed to delete contact: " + err.message);
            }
          }}
        />
      )}

      {/* ── DNC Warning Modal ── */}
      <Dialog open={showDncWarning} onOpenChange={setShowDncWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Do Not Call Warning
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-slate-300">This number is on the DNC list.</p>
            {dncReason && (
              <div className="bg-slate-800 rounded p-3">
                <p className="text-sm text-slate-400">Reason:</p>
                <p className="text-sm text-slate-200">{dncReason}</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDncWarning(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                (autoDialer as any)?.skipToNext?.();
                setShowDncWarning(false);
              }}
            >
              Skip to Next
            </Button>
            <Button
              variant="default"
              onClick={() => {
                console.log("DNC override:", dncLead);
                if (dncLead?.phone) {
                  telnyxMakeCall(dncLead.phone);
                }
                setShowDncWarning(false);
              }}
            >
              Dial Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── End-of-Session Modal ── */}
      <Dialog open={showSessionEnd} onOpenChange={setShowSessionEnd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-500" />
              Session Complete
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded p-4">
                <p className="text-sm text-slate-400">Total Leads</p>
                <p className="text-2xl font-bold text-slate-200">
                  {autoDialSessionStats?.totalLeads || 0}
                </p>
              </div>
              <div className="bg-slate-800 rounded p-4">
                <p className="text-sm text-slate-400">Leads Dialed</p>
                <p className="text-2xl font-bold text-blue-400">
                  {autoDialSessionStats?.leadsDialed || 0}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-400 text-center">
              Queue is now empty. Great work!
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                // Clear saved queue position
                if (user?.id && selectedCampaignId) {
                  (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
                    .from('dialer_queue_state')
                    .delete()
                    .eq('user_id', user.id)
                    .eq('campaign_id', selectedCampaignId)
                    .then(() => {})
                    .catch(() => {});
                }
                setShowSessionEnd(false);
                window.location.href = "/campaigns";
              }}
            >
              End Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Calling Settings Dialog ── */}
      <CampaignSettingsModal
        open={callingSettingsOpen}
        onOpenChange={(open) => { setCallingSettingsOpen(open); if (!open) setSettingsCampaignId(null); }}
        campaignName={(settingsCampaignId ? campaigns.find(c => c.id === settingsCampaignId) : selectedCampaign)?.name || ""}
        isUnlimited={isUnlimited}
        setIsUnlimited={setIsUnlimited}
        maxAttemptsValue={maxAttemptsValue}
        setMaxAttemptsValue={setMaxAttemptsValue}
        callingHoursStart={callingHoursStart}
        setCallingHoursStart={setCallingHoursStart}
        callingHoursEnd={callingHoursEnd}
        setCallingHoursEnd={setCallingHoursEnd}
        retryIntervalHours={retryIntervalHours}
        setRetryIntervalHours={setRetryIntervalHours}
        ringTimeoutValue={ringTimeoutValue}
        setRingTimeoutValue={setRingTimeoutValue}
        settingsAutoDialEnabled={settingsAutoDialEnabled}
        setSettingsAutoDialEnabled={setSettingsAutoDialEnabled}
        localPresenceEnabled={localPresenceEnabled}
        setLocalPresenceEnabled={setLocalPresenceEnabled}
        amdEnabledValue={amdEnabledValue}
        setAmdEnabledValue={setAmdEnabledValue}
        loading={callingSettingsLoading}
        saving={callingSettingsSaving}
        onSave={handleSaveCallingSettings}
      />
    </>
  );
}
