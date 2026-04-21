import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
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
import { isVoiceSdkInboundDirection } from "@/lib/voiceSdkNotificationBranch";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { dispositionsSupabaseApi } from "@/lib/supabase-dispositions";
import {
  getCampaignLeads,
  getLeadHistory,
  saveCall,
  saveNote,
  saveAppointment,
  updateLeadStatus,
  getTodayCallCount,
  getContactCallStats,
} from "@/lib/dialer-api";
import { useTwilio, MakeCallOptions } from "@/contexts/TwilioContext";
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
import { checkCallingHours } from "@/utils/dialerUtils";
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
import {
  sortQueue,
  applyDispositionToQueue,
  queueOrderChanged,
  getLeadTier,
  formatTimeUntil,
  type CampaignLead,
} from "@/lib/queue-manager";
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
import LockTimerArc from "@/components/dialer/LockTimerArc";
import { useLeadLock, QueueFilters } from "@/hooks/useLeadLock";
import { useHardClaim } from "@/hooks/useHardClaim";
import { releaseAllAgentLocks, releaseAllAgentLocksBeacon } from "@/lib/dialer-queue";
import { useDialerStateMachine } from "@/hooks/useDialerStateMachine";
import { HistorySkeleton, LeadInfoSkeleton } from "@/components/dialer/DialerSkeletons";
import { DialerHeaderStats } from "@/components/dialer/DialerHeaderStats";
import { ConversationHistory } from "@/components/dialer/ConversationHistory";
import { DialerActions } from "@/components/dialer/DialerActions";

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
  recording_url?: string | null;
  duration?: number | null;
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
    userId: row.user_id || "",
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

const DEFAULT_OUTBOUND_RING_SEC = 25;

/** Campaign `ring_timeout_seconds` first, then org `phone_settings.ring_timeout`, then 25s. */
function resolveOutboundRingSeconds(
  campaignRingSeconds: number | null | undefined,
  phoneRingSeconds: number | null | undefined,
): number {
  if (typeof campaignRingSeconds === "number" && !Number.isNaN(campaignRingSeconds) && campaignRingSeconds > 0) {
    return campaignRingSeconds;
  }
  if (typeof phoneRingSeconds === "number" && !Number.isNaN(phoneRingSeconds) && phoneRingSeconds > 0) {
    return phoneRingSeconds;
  }
  return DEFAULT_OUTBOUND_RING_SEC;
}

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
  const [leadCallStats, setLeadCallStats] = useState<Record<string, { calls_today: number; total_calls: number; last_disposition: string | null }>>({});
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const currentLead = leadQueue[currentLeadIndex] ?? null;

  // Fetch precise queue exact stats when the leadQueue changes. Limit to the queue we actually see to optimize.
  useEffect(() => {
    if (leadQueue.length === 0) return;
    const fetchStats = async () => {
      // Just fetch for the first 50 to avoid massive payload if queue is huge, or all if small
      const idsToFetch = leadQueue.slice(0, 75).map(l => String(l.lead_id || l.id)).filter(Boolean);
      const results = await getContactCallStats(idsToFetch);
      setLeadCallStats(results);
    };
    fetchStats();
  }, [leadQueue]);

  // Keep index in range (e.g. after handleAdvance with an empty queue computed index -1).
  useEffect(() => {
    const len = leadQueue.length;
    setCurrentLeadIndex((i) => {
      if (len === 0) return 0;
      if (i < 0 || i >= len) return Math.max(0, Math.min(i, len - 1));
      return i;
    });
  }, [leadQueue]);

  const [isAdvancing, setIsAdvancingState] = useState(false);
  const isAdvancingRef = useRef(false);
  const setIsAdvancing = useCallback((val: boolean) => {
    isAdvancingRef.current = val;
    setIsAdvancingState(val);
  }, []);
  const [loadingLeads, setLoadingLeads] = useState(false);

  const isQueueExhausted = useMemo(() => {
    return !loadingLeads && !currentLead && !!selectedCampaignId;
  }, [loadingLeads, currentLead, selectedCampaignId]);

  const nextAvailableTime = useMemo(() => {
    if (!isQueueExhausted) return null;
    const now = new Date();
    let earliest: Date | null = null;
    leadQueue.forEach((lead) => {
      const ts = lead.retry_eligible_at || lead.callback_due_at;
      if (ts) {
        const d = new Date(ts);
        if (d > now) {
          if (!earliest || d < earliest) earliest = d;
        }
      }
    });
    return earliest;
  }, [isQueueExhausted, leadQueue]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [leadStages, setLeadStages] = useState<PipelineStage[]>([]);
  const [leftTab, setLeftTab] = useState<"dispositions" | "queue" | "scripts">("dispositions");

  // Call status from context
  const {
    status: twilioStatus,
    errorMessage: twilioErrorMessage,
    callState: twilioCallState,
    callDuration: twilioCallDuration,
    currentCall: twilioCurrentCall,
    availableNumbers,
    selectedCallerNumber,
    setSelectedCallerNumber,
    makeCall: twilioMakeCall,
    hangUp: twilioHangUp,
    hangUpOrphan,
    dismissOrphanCall,
    orphanCall,
    initializeClient: twilioInitialize,
    destroyClient: twilioDestroy,
    getSmartCallerId,
    applyDialSessionRingTimeout: twilioApplyDialSessionRingTimeout,
  } = useTwilio();
  const twilioHangUpRef = useRef(twilioHangUp);
  twilioHangUpRef.current = twilioHangUp;
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
  const [historyLeadId, setHistoryLeadId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const leadTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Appointment/Callback state for inline scheduling
  const [aptTitle, setAptTitle] = useState("");
  const [aptType, setAptType] = useState<string>("Sales Call");
  const [aptDate, setAptDate] = useState("");
  const [aptStartTime, setAptStartTime] = useState("10:00 AM");
  const [aptEndTime, setAptEndTime] = useState("10:30 AM");
  const [aptNotes, setAptNotes] = useState("");
  const [dialerStats, setDialerStats] = useState<DialerDailyStats | null>(null);
  const [sessionStats, setSessionStats] = useState({ calls_made: 0, calls_connected: 0, total_talk_seconds: 0, policies_sold: 0 });

  // Keep ?contact= aligned with whichever lead is at currentLeadIndex.
  // Do NOT gate on isAdvancing — advance/skip/queue/arrow handlers bump the index while
  // isAdvancing is true; if we skip URL writes here, the contact→index effect still sees
  // the old ?contact= and snaps the index back (glitchy arrows / save & next).
  const lastSyncedLeadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (loadingLeads || !currentLead) return;

    const leadId = String(currentLead.lead_id || currentLead.id || "");
    const currentParam = searchParams.get("contact");

    // Only conditionally sync if the lead ITSELF changed, to avoid fighting the browser Back button
    if (leadId !== lastSyncedLeadIdRef.current) {
      lastSyncedLeadIdRef.current = leadId;
      if (leadId && leadId !== String(currentParam ?? "")) {
        const newParams = new URLSearchParams(searchParams);
        newParams.set("contact", leadId);
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [currentLead, loadingLeads, searchParams, setSearchParams]);

  const contactParam = searchParams.get("contact");

  // Deep-link / browser back: when ?contact= or queue contents change, jump to that lead.
  // Must NOT depend on currentLeadIndex — otherwise this runs on every arrow click with a
  // stale URL for one frame and overwrites the index before the URL effect above runs.
  useEffect(() => {
    if (loadingLeads) return;
    if (!contactParam || showFullViewDrawer || fetchingFromUrl) return;

    // Ignore URL jumps if we are in the middle of programmatic advancing/skipping.
    // This prevents stale ?contact= URL from overwriting the queue index while transitions happen.
    if (isAdvancingRef.current) return;

    const leadId = String(currentLead?.lead_id || currentLead?.id || "");
    if (contactParam === leadId) return;

    const match = leadQueue.find(
      l => String(l.lead_id ?? "") === contactParam || String(l.id ?? "") === contactParam
    );
    if (!match) return;
    const idx = leadQueue.indexOf(match);
    setCurrentLeadIndex((cur) => (cur === idx ? cur : idx));
  }, [contactParam, leadQueue, showFullViewDrawer, fetchingFromUrl, loadingLeads, currentLead]);
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
  /** In-session cache: instant history when revisiting a lead; invalidated on explicit refresh. */
  const historySessionCacheRef = useRef<Map<string, HistoryItem[]>>(new Map());
  /** For merging late `recording_url` updates without flashing skeleton on other leads. */
  const currentLeadIdForHistoryRef = useRef<string | null>(null);
  const recordingHistoryRetryTimersRef = useRef<number[]>([]);
  /** Campaign row id for the last outbound dial — pairs with `scheduleRecordingHistoryRefresh(masterLeadId)`. */
  const lastDialCampaignLeadIdRef = useRef<string | null>(null);
  const lastScrolledLeadIdRef = useRef<string | null>(null);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasDialedOnce = useRef(false);
  const callWasAnswered = useRef(false);
  /** Mirrors state for ring-timeout callback (avoids stale React closures). */
  const currentCallIdRef = useRef<string | null>(null);
  const twilioCallStateRef = useRef<string>("idle");
  const isAutoDispositioningRef = useRef(false);
  const lastProcessedCallIdRef = useRef<string | null>(null);
  const hasProcessedEndedState = useRef(false);
  /** True while handling an inbound WebRTC session — skips campaign auto-dispose / wrap-up on end. */
  const wasInboundSessionRef = useRef(false);
  /** After applyQueueLifecycle mutates the queue, index is applied in the same paint via useLayoutEffect */
  const pendingLifecycleIndexRef = useRef<number | null>(null);
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();
  useEffect(() => {
    currentLeadIdForHistoryRef.current = currentLead
      ? String(currentLead.lead_id || currentLead.id)
      : null;
  }, [currentLead]);
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
  // ── Auto-Dial settings and telemetry (replaces AutoDialer class) ──
  const [autoDialEnabled, setAutoDialEnabled] = useState(true);
  /** Auto-dial pause after each new lead (ms); synced from `campaigns.dial_delay_seconds`. */
  const [dialDelayMs, setDialDelayMs] = useState(2000);
  const ringTimeoutRef = useRef<number>(DEFAULT_OUTBOUND_RING_SEC); // synced with TwilioContext + campaign / phone_settings
  /** Outbound only: when Twilio entered `dialing` (used to honor full ring timeout on early SDK disconnect). */
  const outboundDialStartedAtRef = useRef<number | null>(null);
  const deferredNoAnswerDisposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  // DNC warning
  const [showDncWarning, setShowDncWarning] = useState(false);
  const [dncLead, setDncLead] = useState<any>(null);
  const [dncReason, setDncReason] = useState("");
  // Session end modal
  const [showSessionEnd, setShowSessionEnd] = useState(false);
  const [autoDialSessionStats, setAutoDialSessionStats] = useState<any>(null);

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
  const [ringTimeoutValue, setRingTimeoutValue] = useState(DEFAULT_OUTBOUND_RING_SEC);

  // ── Queue sort / filter / preview ──
  type QueueSortKey = 'smart' | 'default' | 'age_oldest' | 'attempts_fewest' | 'timezone' | 'score_high' | 'name_az';
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
    return (localStorage.getItem(QUEUE_SORT_KEY) as QueueSortKey) || 'smart';
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
    if (twilioCallState === "dialing" || twilioCallState === "incoming") return "ringing";
    if (twilioCallState === "active" || twilioCallState === "ended" || showWrapUp) return "connected";
    return "idle";
  }, [lockMode, currentLead, twilioCallState, showWrapUp]);

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

  // ── Change 5: Ground calls_made from live calls table on session load ──
  useEffect(() => {
    if (!user?.id || !selectedCampaignId) return;
    let cancelled = false;
    getTodayCallCount(user.id, selectedCampaignId).then((count) => {
      if (!cancelled) {
        setDialerStats(prev => prev ? { ...prev, calls_made: count } : prev);
        setSessionStats(prev => ({ ...prev, calls_made: count }));
      }
    });
    return () => { cancelled = true; };
  }, [user?.id, selectedCampaignId]);

  // ── Session duration ticker (Active time only) ──
  useEffect(() => {
    // Only set initial if we just loaded it
    if (sessionElapsed === 0 && dialerStats?.session_duration_seconds) {
      setSessionElapsed(dialerStats.session_duration_seconds);
    }
  }, [dialerStats?.session_duration_seconds]);

  useEffect(() => {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    if (!selectedCampaignId) return; // Only tick when a campaign is selected

    let lastTick = Date.now();
    let accumulatedDeltaMs = 0;

    const tick = () => {
      const now = Date.now();
      const deltaMs = now - lastTick;
      lastTick = now;
      
      accumulatedDeltaMs += deltaMs;
      
      // Update UI blindly
      setSessionElapsed(prev => prev + 1);

      // Periodically flush accumulated time to DB (every 10s or 60s, will do 30s)
      if (accumulatedDeltaMs >= 30000) {
        const flushSecs = Math.floor(accumulatedDeltaMs / 1000);
        accumulatedDeltaMs -= flushSecs * 1000;
        if (user?.id) {
          upsertDialerStats(user.id, { session_duration_seconds: flushSecs }).catch(() => {});
        }
      }
    };
    
    // initial set
    lastTick = Date.now();
    sessionTimerRef.current = setInterval(tick, 1000);
    
    return () => {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      // Flush anything remaining
      const flushSecs = Math.floor(accumulatedDeltaMs / 1000);
      if (flushSecs > 0 && user?.id) {
        upsertDialerStats(user.id, { session_duration_seconds: flushSecs }).catch(() => {});
      }
      accumulatedDeltaMs = 0;
    };
  }, [selectedCampaignId, user?.id]);

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
      const smartId = await getSmartCallerId(contactPhone, contactId, { localPresenceEnabled });
      setDisplayedFromNumber(smartId);
    };
    resolve();
  }, [currentLead, selectedCallerNumber, getSmartCallerId, localPresenceEnabled]);

  // ── Owned phone numbers (removed local fetching, now using TwilioContext) ──
  const lastUsedCallerId = useRef<string>("");

  /* --- effects for syncing query data to state if needed --- */
  // Note: We prefer using the data from useQuery directly, but some effects or 
  // handlers might expect these states. We'll update them via useEffect for compatibility.
  useEffect(() => {
    const fetchCampaigns = async () => {
      if (!organizationId) return;
      setCampaignsLoading(true);
      // Note: omit `dial_delay_seconds` here so older DBs without that column still load the list;
      // delay is loaded when a campaign is selected (sync effect + optional follow-up query).
      const { data, error } = await supabase
        .from('campaigns')
        .select('id, name, type, status, description, tags, total_leads, leads_contacted, leads_converted, max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled, assigned_agent_ids, created_by')
        .eq('organization_id', organizationId)
        .in('status', ['Active', 'Paused', 'Draft'])
        .order('name', { ascending: true });
      if (error) {
        console.error('[Dialer] campaigns fetch:', error);
        toast.error('Could not load campaigns. Check your connection or ask an admin to verify database migrations.');
        setCampaigns([]);
        setCampaignsLoading(false);
        return;
      }
      if (data) {
        const userId = user?.id;
        const roleLower = (profile?.role || '').toLowerCase().trim();
        const seesAllDialerCampaigns =
          Boolean(profile?.is_super_admin) ||
          roleLower === 'admin' ||
          roleLower === 'manager' ||
          roleLower === 'team leader' ||
          roleLower === 'team lead' ||
          roleLower === 'team_leader';
        // Agents: POOL is open; PERSONAL/TEAM need creator or assignment. Elevated roles: match RLS (all rows returned).
        const visible = seesAllDialerCampaigns
          ? data
          : data.filter((c: any) => {
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
  }, [organizationId, user?.id, profile?.role, profile?.is_super_admin]);

  useEffect(() => {
    setDispositions(dispositionsData);
  }, [dispositionsData]);

  useEffect(() => {
    setAvailableScripts(scriptsData);
  }, [scriptsData]);

  useEffect(() => {
    setLeadStages(leadStagesData);
  }, [leadStagesData]);

  const [hasMoreLeads, setHasMoreLeads] = useState(true);
  const [currentOffset, setCurrentOffset] = useState(0);
  const BATCH_SIZE = 50;

  /**
   * Lock-mode lead loader (Team / Open Pool).
   * Calls getNextLead() to atomically fetch + lock one lead,
   * then fetches its full joined data and sets it as leadQueue[0].
   * Returns true if a lead was loaded, false if queue is empty.
   *
   * Accepts an optional campaignType override so callers don't depend
   * on `selectedCampaign` being available in the closure. When omitted,
   * the type is fetched directly from the campaigns table (self-sufficient).
   */
  const loadLockModeLead = useCallback(async (overrideCampaignType?: string): Promise<boolean> => {
    if (!selectedCampaignId) return false;
    setLoadingLeads(true);
    setIsAdvancing(true);
    try {
      // Resolve campaign type: use override, then closure, then fetch from DB
      let resolvedType = overrideCampaignType || selectedCampaign?.type;
      let campaignData: any = null;
      if (!resolvedType) {
        const { data } = await supabase
          .from("campaigns")
          .select("type, queue_filters, max_attempts")
          .eq("id", selectedCampaignId)
          .maybeSingle() as { data: any };
        campaignData = data;
        resolvedType = data?.type;
      }
      if (!resolvedType) {
        console.error("[loadLockModeLead] Could not resolve campaign type");
        setLoadingLeads(false);
        return false;
      }

      // Fetch manager-set filters from the campaign record
      if (!campaignData) {
        const { data } = await supabase
          .from("campaigns")
          .select("queue_filters, max_attempts")
          .eq("id", selectedCampaignId)
          .maybeSingle();
        campaignData = data;
      }
      const filters: QueueFilters = (campaignData?.queue_filters as QueueFilters) ?? {};

      const lock = await getNextLead(selectedCampaignId, resolvedType, filters);
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
        loadLockModeLead(resolvedType);
      });
      return true;
    } catch (err) {
      console.error("[loadLockModeLead] Error:", err);
      toast.error("Failed to load next lead");
      return false;
    } finally {
      setLoadingLeads(false);
      setTimeout(() => setIsAdvancing(false), 100);
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
    } catch (err: any) {
      console.error("[Dialer] Fetch Error (batch):", err);
      toast.error("Failed to load leads: " + (err.message || "Unknown error"));
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

    // For lock-mode campaigns, we need the campaign type to be resolved.
    // If selectedCampaign isn't available yet (e.g. campaigns haven't loaded),
    // the loadLockModeLead function will self-resolve the type from the DB.
    // However, we also need lockMode to be correctly computed, which depends
    // on selectedCampaign. If campaigns haven't loaded yet and lockMode is
    // incorrectly false, we'd run the wrong path. Guard against this:
    if (lockMode === false && !selectedCampaign) {
      // campaigns not loaded yet — lockMode may be incorrectly false.
      // Wait for campaigns to load before deciding the loading path.
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

        // ── Queue Lifecycle: fetch retry interval + pre-populate retry_eligible_at ──
        let campaignRetryInterval = 24;
        try {
          const { data: campData } = await supabase
            .from('campaigns')
            .select('retry_interval_hours')
            .eq('id', selectedCampaignId)
            .maybeSingle();
          if (campData?.retry_interval_hours != null) {
            campaignRetryInterval = campData.retry_interval_hours as number;
            setRetryIntervalHours(campaignRetryInterval);
          }
        } catch { /* non-critical */ }

        const now = new Date();
        const enriched: CampaignLead[] = (leads as CampaignLead[]).map(lead => {
          // Pre-populate retry_eligible_at for previously-called leads
          // Skip if retryInterval is 0 (immediate retry — no wait period)
          if (lead.status === 'Called' && lead.last_called_at && campaignRetryInterval > 0) {
            const eligibleAt = new Date(
              new Date(lead.last_called_at).getTime() + campaignRetryInterval * 3_600_000
            );
            // Only set if not yet eligible (still in the future)
            if (eligibleAt > now) {
              return { ...lead, retry_eligible_at: eligibleAt.toISOString() };
            }
          }
          // Pre-populate callback_due_at from scheduled_callback_at
          if (lead.scheduled_callback_at) {
            return { ...lead, callback_due_at: lead.scheduled_callback_at };
          }
          return lead;
        });

        const sorted = sortQueue(enriched, now);
        setLeadQueue(sorted);
        setCurrentOffset(BATCH_SIZE);

        // Check for saved queue position (with 60-minute staleness window)
        if (user?.id) {
          try {
            const { data: savedState } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
              .from('dialer_queue_state')
              .select('current_lead_id, queue_index, updated_at')
              .eq('user_id', user.id)
              .eq('campaign_id', selectedCampaignId)
              .maybeSingle();

            if (savedState) {
              // ── Change 4: 60-minute staleness window ──
              const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
              const savedUpdatedAt = savedState.updated_at ? new Date(savedState.updated_at).getTime() : 0;
              const isStale = (Date.now() - savedUpdatedAt) > STALE_THRESHOLD_MS;

              if (isStale) {
                setCurrentLeadIndex(0);
                toast.info("Session expired — starting from the top");
              } else {
                const savedIndex = sorted.findIndex(
                  (l: any) => (l.lead_id || l.id) === savedState.current_lead_id
                );
                if (savedIndex >= 0) {
                  setCurrentLeadIndex(savedIndex);
                  toast.success("Resuming where you left off");
                } else {
                  setCurrentLeadIndex(0);
                }
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
      } catch (err: any) {
        console.error("[Dialer] Fetch Error (resume):", err);
        toast.error("Failed to load leads: " + (err.message || "Unknown error"));
      } finally {
        setLoadingLeads(false);
      }
    };

    if (lockMode) {
      // Team / Open Pool: atomic lock-based single-lead loading
      // Pass the campaign type explicitly to avoid closure staleness
      loadLockModeLead(selectedCampaign?.type);
    } else {
      loadWithResume();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, selectedCampaign, lockMode, user?.id, organizationId]);
  // Reset hasDialedOnce when campaign changes so the first call must always be manual
  useEffect(() => {
    hasDialedOnce.current = false;
    return () => { hasDialedOnce.current = false; };
  }, [selectedCampaignId]);

  // ── Sync auto-dial prefs from campaign list row (refined when syncSettings runs) ──
  useEffect(() => {
    if (!selectedCampaign) return;
    const campaignAutoDialValue = selectedCampaign.auto_dial_enabled;
    // Only sync if the campaign has an explicit setting (not null/undefined)
    if (campaignAutoDialValue != null) {
      setAutoDialEnabled(campaignAutoDialValue);
    }
    const d = (selectedCampaign as { dial_delay_seconds?: number | null }).dial_delay_seconds;
    if (d != null && d !== undefined) {
      const sec = Number(d);
      if (!Number.isNaN(sec) && sec >= 0) {
        setDialDelayMs(Math.min(10_000, Math.max(500, Math.round(sec * 1000))));
      }
    }
  }, [selectedCampaignId, selectedCampaign]);

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

    // ── Campaign max_attempts enforcement: hide leads that exceeded max attempts ──
    const campaignMaxAttempts = selectedCampaign?.max_attempts;
    if (campaignMaxAttempts != null && campaignMaxAttempts > 0) {
      q = q.filter(({ lead }) => (lead.call_attempts || 0) < campaignMaxAttempts);
    }

    // Apply sort
    switch (queueSort) {
      case 'smart': {
        // ── Change 7: 4-tier smart sort ──
        const now = new Date();
        q.sort((a, b) => {
          const tierA = getLeadTier(a.lead as CampaignLead, now);
          const tierB = getLeadTier(b.lead as CampaignLead, now);
          if (tierA !== tierB) return tierA - tierB;
          // Within Tier 4: soonest due timestamp first
          if (tierA === 4) {
            const tsA = a.lead.retry_eligible_at || a.lead.callback_due_at || '';
            const tsB = b.lead.retry_eligible_at || b.lead.callback_due_at || '';
            if (tsA && tsB) return new Date(tsA as string).getTime() - new Date(tsB as string).getTime();
          }
          return a.originalIndex - b.originalIndex;
        });
        break;
      }
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
  }, [leadQueue, queueSort, queueFilter, selectedCampaign?.max_attempts]);

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

  // ── 60-second queue re-sort: promotes leads whose retry/callback time has arrived ──
  useEffect(() => {
    if (!selectedCampaignId || lockMode) return;
    const interval = setInterval(() => {
      const now = new Date();
      setLeadQueue(prev => {
        // Guard 1: Never re-sort while a call is active or dialing — would disrupt the live lead
        if (twilioCallState === 'active' || twilioCallState === 'dialing' || twilioCallState === 'incoming') return prev;
        // Guard 2: Never re-sort while wrap-up modal is open — agent is mid-disposition
        if (showWrapUp) return prev;
        // Guard 3: Only sort leads AFTER the current index — current and prior leads must not move
        const head = prev.slice(0, currentLeadIndex + 1);
        const tail = prev.slice(currentLeadIndex + 1);
        const sortedTail = sortQueue(tail as CampaignLead[], now);
        const updated = [...head, ...sortedTail] as typeof prev;
        if (queueOrderChanged(prev as CampaignLead[], updated)) {
          toast("Queue updated — new leads are now eligible", { duration: 2000 });
          return updated;
        }
        return prev;
      });
    }, 60_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, lockMode, twilioCallState, showWrapUp, currentLeadIndex]);

  const fetchHistory = useCallback(
    async (
      leadId: string,
      opts?: { signal?: AbortSignal; campaignLeadId?: string | null }
    ) => {
    const signal = opts?.signal;
    if (isAdvancingRef.current) return;
    historySessionCacheRef.current.delete(leadId);
    setLoadingHistory(true);
    try {
      const data = await getLeadHistory(leadId, organizationId, {
        signal,
        campaignLeadId: opts?.campaignLeadId,
      });
      if (!signal?.aborted) {
        historySessionCacheRef.current.set(leadId, data);
        setHistory(data);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && err.message !== 'Aborted') {
        console.warn("Failed to load history:", err);
      }
    } finally {
      if (!signal?.aborted) {
        setLoadingHistory(false);
      }
    }
  }, [organizationId]);

  /** Refetch timeline for a lead when the voice pipeline delivers `recording_url` after wrap-up (no isAdvancing guard). */
  const refreshHistoryForLeadQuiet = useCallback(
    async (leadId: string, campaignLeadId?: string | null) => {
      try {
        const data = await getLeadHistory(leadId, organizationId, {
          campaignLeadId,
        });
        historySessionCacheRef.current.set(leadId, data);
        if (currentLeadIdForHistoryRef.current === leadId) {
          setHistory(data);
        }
      } catch (e) {
        console.warn("[DialerPage] Quiet history refresh failed:", e);
      }
    },
    [organizationId]
  );

  const scheduleRecordingHistoryRefresh = useCallback(
    (leadId: string) => {
      const campaignLeadId = lastDialCampaignLeadIdRef.current;
      recordingHistoryRetryTimersRef.current.forEach(clearTimeout);
      recordingHistoryRetryTimersRef.current = [];
      for (const ms of [3000, 12000, 35000, 60000]) {
        const tid = window.setTimeout(() => {
          void refreshHistoryForLeadQuiet(leadId, campaignLeadId);
        }, ms);
        recordingHistoryRetryTimersRef.current.push(tid);
      }
    },
    [refreshHistoryForLeadQuiet]
  );

  useEffect(
    () => () => {
      recordingHistoryRetryTimersRef.current.forEach(clearTimeout);
      recordingHistoryRetryTimersRef.current = [];
    },
    []
  );

  // ── Debounced Lead Transition: orchestrates all lead-dependent fetches ──
  // Prevents ERR_INSUFFICIENT_RESOURCES by debouncing + serializing fetches
  // when currentLeadIndex changes rapidly (e.g. skip-spam).
  useEffect(() => {
    // Clear stale data immediately on lead change
    if (!currentLead) {
      setHistory([]);
      setHistoryLeadId(null);
      setAssignedAgentName(null);
      setIsTransitioning(false);
      return;
    }

    // Show skeleton immediately
    setIsTransitioning(true);

    // Cancel any pending debounce from previous lead change
    if (leadTransitionRef.current) {
      clearTimeout(leadTransitionRef.current);
    }

    const controller = new AbortController();
    const leadId = currentLead.lead_id || currentLead.id;
    const agentId = currentLead.assigned_agent_id;

    const cached = historySessionCacheRef.current.get(leadId);
    if (cached) {
      setHistory(cached);
      setHistoryLeadId(leadId);
      setLoadingHistory(false);
    } else {
      setHistory([]);
      setHistoryLeadId(null);
      setLoadingHistory(true);
    }

    // 0ms — yield one tick so rapid lead switches still batch-cancel via clearTimeout above
    leadTransitionRef.current = setTimeout(async () => {
      const historyPromise = getLeadHistory(leadId, organizationId, {
        signal: controller.signal,
        campaignLeadId: currentLead.id,
      });
      const profilePromise = agentId
        ? supabase
            .from("profiles")
            .select("first_name, last_name")
            .eq("id", agentId)
            .maybeSingle()
        : Promise.resolve({ data: null as { first_name?: string; last_name?: string } | null });

      const [histOutcome, profOutcome] = await Promise.allSettled([historyPromise, profilePromise]);

      if (controller.signal.aborted) return;

      if (histOutcome.status === "fulfilled") {
        const data = histOutcome.value;
        historySessionCacheRef.current.set(leadId, data);
        setHistory(data);
        setHistoryLeadId(leadId);
        setLoadingHistory(false);
      } else {
        const err = histOutcome.reason;
        if (err?.name !== "AbortError" && err?.message !== "Aborted") {
          console.warn("Failed to load history:", err);
          toast.error("Failed to load history");
        }
        setLoadingHistory(false);
        setHistoryLeadId(leadId);
      }

      if (!agentId) {
        setAssignedAgentName(null);
      } else if (profOutcome.status === "fulfilled") {
        const profRes = profOutcome.value as { data: { first_name?: string; last_name?: string } | null };
        if (profRes?.data) {
          const p = profRes.data;
          setAssignedAgentName(`${p.first_name || ""} ${p.last_name || ""}`.trim());
        } else {
          setAssignedAgentName(null);
        }
      } else {
        setAssignedAgentName(null);
      }

      if (!controller.signal.aborted) {
        setIsTransitioning(false);
      }
    }, 0);

    return () => {
      controller.abort();
      if (leadTransitionRef.current) {
        clearTimeout(leadTransitionRef.current);
        leadTransitionRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLead?.id, currentLead?.lead_id, organizationId]);

  // ── Scroll history to bottom on new items or lead change ──
  const prevHistoryLenRef = useRef(0);
  useEffect(() => {
    if (history.length !== prevHistoryLenRef.current || !isTransitioning) {
      prevHistoryLenRef.current = history.length;
      // Small raf delay to let DOM paint the new items
      requestAnimationFrame(() => {
        historyEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      });
    }
  }, [history.length, currentLead?.id, isTransitioning]);

  /* --- queue lifecycle --- */

  /**
   * Applies a disposition's queue behavior (retry / callback / permanent remove),
   * re-sorts the queue, and advances the dialer head to the next dialable lead.
   * Called after every disposition save in both the manual and auto-dispose paths.
   */
  const TERMINAL_STATUSES = ['DNC', 'Completed', 'Removed', 'removed', 'Closed Won'];
  const applyQueueLifecycle = useCallback((
    disposedLead: CampaignLead,
    dispositionName: string,
    callbackDueAt: string | null,
  ) => {
    setIsAdvancing(true);
    const now = new Date();
    // Functional update avoids a stale leadQueue when the call-end effect runs before
    // a queued React render (Personal campaigns could otherwise apply dispositions to []).
    setLeadQueue(prev => {
      const newQueue = applyDispositionToQueue(
        prev as CampaignLead[],
        disposedLead,
        dispositionName,
        retryIntervalHours,
        callbackDueAt,
        now,
      );
      let nextIndex = newQueue.findIndex(
        lead => !TERMINAL_STATUSES.includes((lead as any).status || '')
             && getLeadTier(lead as CampaignLead, now) !== 4
      );
      
      // If no valid leads left, flag by setting nextIndex = -1 but keep UI on current lead
      if (nextIndex === -1) {
        if (autoDialEnabled) setAutoDialEnabled(false);
      }
      
      const safeIndex = nextIndex === -1 ? currentLeadIndex : Math.min(nextIndex, newQueue.length - 1);
      pendingLifecycleIndexRef.current = safeIndex;
      return newQueue;
    });

    setTimeout(() => setIsAdvancing(false), 100);
  }, [retryIntervalHours]);

  useLayoutEffect(() => {
    const p = pendingLifecycleIndexRef.current;
    if (p === null) return;
    pendingLifecycleIndexRef.current = null;
    setCurrentLeadIndex((cur) => (cur === p ? cur : p));
  }, [leadQueue]);

  /* --- call handlers --- */

  const [showCallerIdWarning, setShowCallerIdWarning] = useState(false);
  const [pendingCall, setPendingCall] = useState<{
    leadPhone: string;
    contactId: string;
    proposedNumber: string;
    previousNumber: string;
  } | null>(null);

  const [pendingOverrideIndex, setPendingOverrideIndex] = useState<number | null>(null);

  const _executeLeadSelect = useCallback((idx: number) => {
    const lead = leadQueue[idx];
    const leadId = lead?.lead_id || lead?.id;
    if (leadId) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set("contact", String(leadId));
      setSearchParams(newParams, { replace: true });
    }
    setIsAdvancing(true);
    setCurrentLeadIndex(idx);
    if (twilioCallState === "idle" || twilioCallState === "ended") {
      setShowWrapUp(false);
    }
    setTimeout(() => setIsAdvancing(false), 500);
  }, [leadQueue, searchParams, setSearchParams, twilioCallState]);

  // ── Lead Selection Handler (with isAdvancing guard) ──
  const handleLeadSelect = useCallback((idx: number) => {
    if (isAdvancingRef.current) return;
    if (idx === currentLeadIndex) return;

    const lead = leadQueue[idx];
    if (getLeadTier(lead as CampaignLead, new Date()) === 4) {
      // Show confirmation modal for Tier 4 instead of blocking entirely
      setPendingOverrideIndex(idx);
      if (autoDialEnabled) setAutoDialEnabled(false);
      return;
    }

    _executeLeadSelect(idx);
  }, [currentLeadIndex, leadQueue, autoDialEnabled, _executeLeadSelect]);

  const confirmOverrideSelect = useCallback(() => {
    if (pendingOverrideIndex === null) return;
    _executeLeadSelect(pendingOverrideIndex);
    setPendingOverrideIndex(null);
  }, [pendingOverrideIndex, _executeLeadSelect]);

  const handleAdvance = useCallback(async () => {
    if (isAdvancingRef.current) return;
    setIsAdvancing(true);
    setShowWrapUp(false);
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentCallId(null);
    setClaimRingActive(false);
    cancelClaimTimer();
    setIsEditingContact(false);
    setEditForm({});

    if (lockMode && currentLead?.id) {
      stopHeartbeat();
      // Await the lock release before fetching next lead to prevent
      // the RPC from re-fetching the lead we just released.
      await releaseLock(currentLead.id as string);
      await loadLockModeLead();
      // loadLockModeLead internally handles setIsAdvancing(false) if we integrate it,
      // or we handle it here.
      setIsAdvancing(false);
      return;
    }

    setCurrentLeadIndex((prev) => {
      const len = leadQueue.length;
      if (len <= 0) return 0;
      let nextIdx = Math.min(prev + 1, len - 1);
      
      // Strict Queue: Do not advance into Tier 4 (pending retry) area.
      if (getLeadTier(leadQueue[nextIdx] as CampaignLead, new Date()) === 4) {
        toast.info("No more dialable leads ready right now.");
        if (autoDialEnabled) setAutoDialEnabled(false); // Disable auto dial so it doesn't loop
        return prev; 
      }
      return nextIdx;
    });

    setTimeout(() => setIsAdvancing(false), 50); // Reduced from 300ms for "instant" feel

    if (autoDialEnabled) {
      console.log("[DialerPage] Auto-Dialer will advance reactively via state machine");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDialEnabled, lockMode, currentLead?.id, leadQueue.length, stopHeartbeat, releaseLock, loadLockModeLead, cancelClaimTimer]);

  const handleSkip = useCallback(async () => {
    if (isAdvancingRef.current) return;
    setIsAdvancing(true);
    setIsEditingContact(false);
    setEditForm({});
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentCallId(null);
    setClaimRingActive(false);
    cancelClaimTimer();

    // ── Change 6: Persist skip to campaign_leads with retry_eligible_at ──
    if (currentLead?.id) {
      const skipRetryHours = retryIntervalHours > 0 ? retryIntervalHours : 24;
      const retryAt = new Date(Date.now() + skipRetryHours * 3_600_000).toISOString();
      supabase
        .from('campaign_leads')
        .update({
          retry_eligible_at: retryAt,
          status: 'Called',
        } as any)
        .eq('id', currentLead.id)
        .then(({ error }) => {
          if (error) console.warn('[handleSkip] Failed to persist skip:', error);
        });
    }

    if (lockMode && currentLead?.id) {
      const campaignLeadId = currentLead.id as string;
      stopHeartbeat();
      // Await the lock release before fetching next lead so the RPC
      // doesn't re-serve the same lead we just skipped.
      await releaseLock(campaignLeadId);
      // Load next lead atomically for Team/Open
      await loadLockModeLead();
      setIsAdvancing(false);
      return;
    }

    // Mark skipped locally so it disappears from current session view
    setLeadQueue(prev => prev.map((l, i) => i === currentLeadIndex ? { ...l, _skipped: true } : l));

    setCurrentLeadIndex((prev) => {
      const len = leadQueue.length;
      if (len <= 0) return 0;
      let nextIdx = Math.min(prev + 1, len - 1);
      
      // Strict Queue: Do not advance into Tier 4 (pending retry) area.
      if (getLeadTier(leadQueue[nextIdx] as CampaignLead, new Date()) === 4) {
        toast.info("No more dialable leads ready right now.");
        if (autoDialEnabled) setAutoDialEnabled(false);
        return prev;
      }
      return nextIdx;
    });
    setTimeout(() => setIsAdvancing(false), 50); // Reduced from 300ms for "instant" feel

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockMode, currentLead?.id, leadQueue.length, stopHeartbeat, releaseLock, loadLockModeLead, cancelClaimTimer, retryIntervalHours, currentLeadIndex]);

  const proceedWithCall = useCallback(async (leadPhone: string, callerNumber: string, contactId?: string) => {
    lastDialCampaignLeadIdRef.current = currentLead?.id ?? null;
    lastUsedCallerId.current = callerNumber;
    // Consolidated: MakeCallOptions passes all metadata to TwilioContext.makeCall
    // where the single call record is created.
    const opts: MakeCallOptions = {
      contactId: contactId || null,
      campaignId: selectedCampaignId || null,
      campaignLeadId: currentLead?.id || null,
      contactName: `${currentLead?.first_name || ''} ${currentLead?.last_name || ''}`.trim() || null,
      contactPhone: leadPhone,
    };
    const callId = await twilioMakeCall(leadPhone, callerNumber || undefined, opts);
    setCurrentCallId(callId || null);
  }, [twilioMakeCall, selectedCampaignId, currentLead]);

  const initiateCall = useCallback(async (leadPhone: string, contactId: string) => {
    if (!user) {
      toast.error("Authentication required to make calls. Please log in again.");
      return;
    }
    const smartCallerId = await getSmartCallerId(leadPhone, contactId, { localPresenceEnabled });
    proceedWithCall(leadPhone, smartCallerId, contactId);
  }, [getSmartCallerId, user?.id, proceedWithCall, localPresenceEnabled]);

  const handleCall = useCallback(() => {
    if (!currentLead) {
      toast.error("No lead selected");
      return;
    }
    if (twilioStatus === "error") {
      toast.error(twilioErrorMessage || "Dialer error. Please check your settings.");
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
          amd_skipped: 0,
          session_started_at: now,
          session_duration_seconds: 0,
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
    callWasAnswered.current = false;
    setSessionStats(prev => ({ ...prev, calls_made: prev.calls_made + 1 }));
    const contactId = currentLead.lead_id || currentLead.id || "";
    initiateCall(currentLead.phone, contactId);
  }, [currentLead, twilioStatus, twilioErrorMessage, dialerStats, user?.id, initiateCall]);

  const handleHangUp = useCallback(() => {
    console.log("[Dialer] Hang up — duration:", twilioCallDuration, "counting as connected:", twilioCallDuration >= 7);
    if (twilioCallDuration >= 7) {
      // Optimistic local update
      setDialerStats(prev => prev ? {
        ...prev,
        calls_connected: prev.calls_connected + 1,
        total_talk_seconds: prev.total_talk_seconds + twilioCallDuration,
        last_updated_at: new Date().toISOString(),
      } : prev);
      setSessionStats(prev => ({
        ...prev,
        calls_connected: prev.calls_connected + 1,
        total_talk_seconds: prev.total_talk_seconds + twilioCallDuration,
      }));
      // Persist to Supabase
      if (user?.id) {
        upsertDialerStats(user.id, {
          calls_connected: 1,
          total_talk_seconds: twilioCallDuration,
        }).catch(() => {});
      }
    }
    twilioHangUp();
  }, [twilioCallDuration, twilioHangUp, user?.id]);

  const handleAutoDispose = useCallback(async (disposition: Disposition) => {
    // Use currentCallId (internal UUID) which is more reliable than twilioCurrentCall
    // since twilioHangUp() may have already cleared the twilio call reference
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
    setIsEditingContact(false);
    setEditForm({});
    // ── Queue Lifecycle: remove disposed lead, re-sort, reset to head ──
    if (lockMode) {
      // Lock mode: release lock and fetch next lead — applyQueueLifecycle would
      // keep the same locked lead in the single-lead queue, which is incorrect.
      await handleAdvance();
    } else if (currentLead) {
      applyQueueLifecycle(currentLead as CampaignLead, disposition.name, null);
    }
    // Auto-dial logic handled reactively by useEffect on currentLead?.id change
  }, [currentCallId, currentLead, lockMode, handleAdvance, applyQueueLifecycle]);

  // Keep refs aligned for async timers (strict ring timeout must not use stale state).
  useEffect(() => {
    currentCallIdRef.current = currentCallId;
  }, [currentCallId]);
  useEffect(() => {
    twilioCallStateRef.current = twilioCallState;
  }, [twilioCallState]);

  useEffect(() => {
    if (twilioCallState !== "dialing") return;
    if (deferredNoAnswerDisposeTimerRef.current) {
      clearTimeout(deferredNoAnswerDisposeTimerRef.current);
      deferredNoAnswerDisposeTimerRef.current = null;
    }
    outboundDialStartedAtRef.current = Date.now();
  }, [twilioCallState]);

  useEffect(() => {
    return () => {
      if (deferredNoAnswerDisposeTimerRef.current) {
        clearTimeout(deferredNoAnswerDisposeTimerRef.current);
        deferredNoAnswerDisposeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (twilioCallState === "incoming") wasInboundSessionRef.current = true;
    if (twilioCallState === "active" && isVoiceSdkInboundDirection(twilioCurrentCall?.direction)) {
      wasInboundSessionRef.current = true;
    }
    if (twilioCallState === "idle") wasInboundSessionRef.current = false;
  }, [twilioCallState, twilioCurrentCall?.direction]);

  // Track whether the current call was answered (reached "active" state)
  useEffect(() => {
    if (twilioCallState === "active") {
      callWasAnswered.current = true;
    }
  }, [twilioCallState]);

  // ── Strict Ring Timeout Enforcement ──
  // Interval watchdog depends only on `twilioCallState` so `twilioHangUp` ref changes cannot reset the timer.
  // Skip only when UI is active/answered — not `calls.status` (Twilio in-progress maps to connected too early).
  useEffect(() => {
    if (twilioCallState !== "dialing") return;
    const limitSec = Math.max(1, ringTimeoutRef.current || 25);
    const startedAt = Date.now();
    let fired = false;

    const iv = window.setInterval(() => {
      if (fired) return;
      if (twilioCallStateRef.current !== "dialing") {
        window.clearInterval(iv);
        return;
      }
      if ((Date.now() - startedAt) / 1000 < limitSec) return;
      fired = true;
      window.clearInterval(iv);

      const limitAtFire = limitSec;
      const ringPolicyAtFire = ringTimeoutRef.current;

      void (async () => {
        if (twilioCallStateRef.current !== "dialing") return;
        if (callWasAnswered.current) {
          console.log("[RingTimeout] Strict path — skip hangup; call reached active (answered).", {
            limitSec: limitAtFire,
            ringTimeoutRef: ringPolicyAtFire,
          });
          return;
        }

        console.log(
          `[RingTimeout] Strict enforcement: ${limitAtFire}s reached. Hanging up.`,
          { ringTimeoutRef: ringPolicyAtFire },
        );
        toast.info(`No answer after ${limitAtFire}s — hanging up.`);
        twilioHangUpRef.current();
      })();
    }, 400);

    return () => window.clearInterval(iv);
  }, [twilioCallState]);

  // Reset the ended-state guard only when a new call begins — NOT on every non-ended state.
  // Resetting on "idle" caused a double-fire: ended → idle (200ms reset) → ended (WebRTC destroy notification)
  // would re-process the same call end and advance the lead twice.
  useEffect(() => {
    if (twilioCallState === "dialing" || twilioCallState === "incoming") {
      hasProcessedEndedState.current = false;
      lastProcessedCallIdRef.current = null;
    }
  }, [twilioCallState]);

  // Trigger wrap-up when call ends (covers remote hangup).
  // Ring timeout (call never answered) auto-dispositions as "No Answer" silently.
  // Manual hang-up of an answered call ALWAYS shows the wrap-up panel.
  useEffect(() => {
    if (twilioCallState === "ended") {
      // Process-once guard: prevent re-firing from dependency changes while still "ended"
      if (hasProcessedEndedState.current) return;

      // Re-entrancy guard: prevent infinite loop
      if (isAutoDispositioningRef.current) return;

      if (wasInboundSessionRef.current) {
        hasProcessedEndedState.current = true;
        callWasAnswered.current = false;
        wasInboundSessionRef.current = false;
        return;
      }

      // Strict process-once-per-call-id guard (must run BEFORE flipping hasProcessedEndedState)
      const callIdToProcess = twilioCurrentCall?.id || twilioCurrentCall?.callControlId || currentCallId;
      if (callIdToProcess && lastProcessedCallIdRef.current === callIdToProcess) {
        return;
      }

      hasProcessedEndedState.current = true;

      if (callIdToProcess) {
        lastProcessedCallIdRef.current = callIdToProcess;
      }

      const wasAnswered = callWasAnswered.current;

      // ── Ring timeout / no answer path — auto-disposition silently ──
      // Twilio can emit `disconnect` before the org ring-timeout window elapses; wait the remainder
      // so auto-dial does not advance early while the PSTN leg may still be ringing.
      if (!wasAnswered) {
        const ringSec = ringTimeoutRef.current;
        const startedAt = outboundDialStartedAtRef.current ?? Date.now();
        const elapsed = Date.now() - startedAt;
        const remainingMs = Math.max(0, ringSec * 1000 - elapsed);

        const runNoAnswerDispose = () => {
          deferredNoAnswerDisposeTimerRef.current = null;
          isAutoDispositioningRef.current = true;
          try {
            console.log("[DialerPage] Call ended without being answered — auto-dispositioning as No Answer.");
            const noAnswerDisp =
              dispositions.find((d) => d.name.toLowerCase() === "no answer") ||
              dispositions.find((d) => d.name.toLowerCase().includes("no answer"));

            if (noAnswerDisp) {
              handleAutoDispose(noAnswerDisp);
            } else {
              console.warn('[DialerPage] No "No Answer" disposition found — advancing without disposition.');
              handleAdvance();
            }
          } finally {
            callWasAnswered.current = false;
            isAutoDispositioningRef.current = false;
          }
        };

        if (remainingMs > 0) {
          console.log(
            `[DialerPage] No-answer dispose deferred ${remainingMs}ms to honor ring timeout (${ringSec}s).`,
          );
          deferredNoAnswerDisposeTimerRef.current = setTimeout(runNoAnswerDispose, remainingMs);
        } else {
          runNoAnswerDispose();
        }
        return;
      }

      // ── Answered call path — show wrap-up for manual disposition ──
      setTimeout(() => setShowWrapUp(true), 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twilioCallState, twilioHangUp, twilioCurrentCall, dispositions, handleAutoDispose, handleAdvance, currentCallId]);

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
    if (!showWrapUp || twilioCallState === "active") return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && dispositions[num - 1]) {
      handleSelectDisposition(dispositions[num - 1]);
    }
  }
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showWrapUp, twilioCallState, dispositions]);

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

    const fetchPhone = (supabase
      .from("phone_settings")
      .select("ring_timeout")
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
        if (phoneData?.ring_timeout) setRingTimeoutValue(phoneData.ring_timeout);
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
        amd_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq("organization_id", organizationId);

    setCallingSettingsSaving(false);
    
    if (campaignError || phoneError) {
      toast.error("Failed to save settings — please try again");
      console.error("Save error:", { campaignError, phoneError });
    } else {
      toast.success("Calling settings saved");
      const { data: ringRow } = await supabase
        .from("campaigns")
        .select("ring_timeout_seconds")
        .eq("id", effectiveCampaignId)
        .maybeSingle();
      const cr = (ringRow as { ring_timeout_seconds?: number | null } | null)?.ring_timeout_seconds;
      const mergedAfterSave = resolveOutboundRingSeconds(cr, ringTimeoutValue);
      ringTimeoutRef.current = mergedAfterSave;
      twilioApplyDialSessionRingTimeout(mergedAfterSave);
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

  // ── Sync Telemetry and Settings (replaces AutoDialer.startSession) ──
  useEffect(() => {
    if (!selectedCampaignId || !organizationId) return;

    const syncSettings = async () => {
      // 1. Fetch Campaign Settings (omit dial_delay_seconds so missing column does not null the whole row)
      const { data: campaignData } = await supabase
        .from("campaigns")
        .select("max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled")
        .eq("id", selectedCampaignId)
        .maybeSingle();

      if (campaignData) {
        setCallingHoursStart((campaignData.calling_hours_start as string)?.slice(0, 5) ?? "09:00");
        setCallingHoursEnd((campaignData.calling_hours_end as string)?.slice(0, 5) ?? "21:00");
        setRetryIntervalHours(campaignData.retry_interval_hours ?? 24);
        setAutoDialEnabled(campaignData.auto_dial_enabled ?? true);
        setLocalPresenceEnabled(campaignData.local_presence_enabled ?? true);
      }

      const { data: delayRow, error: delayErr } = await supabase
        .from("campaigns")
        .select("dial_delay_seconds")
        .eq("id", selectedCampaignId)
        .maybeSingle();
      if (!delayErr && delayRow) {
        const raw = (delayRow as { dial_delay_seconds?: number | null }).dial_delay_seconds;
        if (typeof raw === "number" && !Number.isNaN(raw) && raw >= 0) {
          setDialDelayMs(Math.min(10_000, Math.max(500, Math.round(raw * 1000))));
        } else {
          setDialDelayMs(2000);
        }
      } else {
        setDialDelayMs(2000);
      }

      const { data: ringCampaignRow, error: ringCampaignErr } = await supabase
        .from("campaigns")
        .select("ring_timeout_seconds")
        .eq("id", selectedCampaignId)
        .maybeSingle();

      const campaignRing =
        !ringCampaignErr && ringCampaignRow
          ? (ringCampaignRow as { ring_timeout_seconds?: number | null }).ring_timeout_seconds
          : null;

      // 2. Fetch Global Phone Settings
      const { data: phoneData } = await supabase
        .from("phone_settings")
        .select("ring_timeout")
        .eq("organization_id", organizationId)
        .maybeSingle();

      const phoneRing = phoneData?.ring_timeout;
      const effectiveRing = resolveOutboundRingSeconds(campaignRing, phoneRing);
      ringTimeoutRef.current = effectiveRing;
      twilioApplyDialSessionRingTimeout(effectiveRing);
    };

    syncSettings();
    setSessionStats({ calls_made: 0, calls_connected: 0, total_talk_seconds: 0, policies_sold: 0 });
    twilioInitialize();

    return () => {
      // Cleanup
    };
  }, [selectedCampaignId, organizationId, twilioInitialize, twilioApplyDialSessionRingTimeout]);

  useEffect(() => {
    return () => {
      twilioApplyDialSessionRingTimeout(null);
    };
  }, [twilioApplyDialSessionRingTimeout]);

  const memoizedCheckHours = useCallback(
    (state: string) => checkCallingHours(state, callingHoursStart, callingHoursEnd),
    [callingHoursStart, callingHoursEnd]
  );

  // ── Two-Lane State Machine Hook ──
  const { machineState, autoDialCountdownActive, cancelAutoDialCountdown } = useDialerStateMachine({
    isAutoDialEnabled: autoDialEnabled && !isPaused,
    twilioCallState,
    twilioStatus,
    currentLead,
    hasDialedOnce,
    showWrapUp,
    isAdvancing,
    dialDelayMs,
    checkCallingHours: memoizedCheckHours,
    onCall: handleCall,
    onSkip: handleSkip,
  });



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

  // ── Cache access token for synchronous beforeunload usage ──
  const accessTokenRef = useRef<string>("");
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      accessTokenRef.current = data?.session?.access_token || "";
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      accessTokenRef.current = session?.access_token || "";
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── beforeunload: release ALL agent locks + stop heartbeat + cancel claim ──
  useEffect(() => {
    const handleUnload = () => {
      // Bulk-release all locks for this campaign via beacon (survives page unload)
        if (lockMode && selectedCampaignId) {
        const sbUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const token = accessTokenRef.current || (import.meta.env.VITE_SUPABASE_ANON_KEY as string);
        const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        releaseAllAgentLocksBeacon(selectedCampaignId, sbUrl, token, anon);
      }
      stopHeartbeat();
      cancelClaimTimer();
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockMode, selectedCampaignId]);

  // ── Inbound answer → start claim timer (Team/Open only) ──
  useEffect(() => {
    if (!lockMode || !currentLead) return;
    if (twilioCallState === "active") {
      if (isVoiceSdkInboundDirection(twilioCurrentCall?.direction)) {
        setClaimRingActive(false);
        return;
      }
      setClaimRingActive(true);
      startClaimTimer(
        currentLead.id as string,
        (currentLead.lead_id || currentLead.id) as string,
        selectedCampaignId || ""
      );
    } else if (twilioCallState === "idle" || twilioCallState === "ended") {
      setClaimRingActive(false);
      // Cancel timer only on idle (ended keeps the card revealed during wrap-up)
      if (twilioCallState === "idle") cancelClaimTimer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twilioCallState, lockMode, currentLead?.id]);

  /* --- caller ID selection --- */
  // Redundant helper removed, now using getSmartCallerId from TwilioContext

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
      const campaignRowId = currentLead.id;
      await saveCall({
        id: currentCallId || undefined,
        master_lead_id: masterId,
        campaign_lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        duration_seconds: twilioCallDuration,
        disposition: d.name,
        notes: "",
        outcome: d.name,
        caller_id_used: lastUsedCallerId.current || undefined,
      }, organizationId);
      historySessionCacheRef.current.delete(masterId);
      void refreshHistoryForLeadQuiet(masterId, campaignRowId);
    } catch {
      /* ignore */
    }
    // Reset UI state
    setShowWrapUp(false);
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentCallId(null);
    setIsEditingContact(false);
    setEditForm({});

    if (lockMode) {
      // Lock mode: release lock and fetch next lead via handleAdvance
      await handleAdvance();
    } else {
      // Personal: re-sort queue with disposition applied (instead of simple increment)
      // This ensures the disposed lead is moved to the correct tier and currentLeadIndex
      // is reset to the first eligible lead — fixes "stays on same contact" bug.
      const updatedLead: CampaignLead = {
        ...(currentLead as CampaignLead),
        call_attempts: (currentLead.call_attempts || 0) + 1,
        last_called_at: new Date().toISOString(),
        status: d.name,
      };
      applyQueueLifecycle(updatedLead, d.name, null);
    }
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

        // ── Sync scheduled_callback_at to campaign_leads for waterfall queue ──
        try {
          const [h, rest] = callbackTime.split(':');
          const [min, period] = (rest || '').split(' ');
          let hours24 = parseInt(h, 10);
          if (period === 'PM' && hours24 < 12) hours24 += 12;
          if (period === 'AM' && hours24 === 12) hours24 = 0;
          const callbackISO = new Date(
            callbackDate.getFullYear(),
            callbackDate.getMonth(),
            callbackDate.getDate(),
            hours24,
            parseInt(min || '0', 10),
          ).toISOString();
          await supabase
            .from('campaign_leads')
            .update({ scheduled_callback_at: callbackISO } as any)
            .eq('id', currentLead.id);
        } catch (e) {
          console.warn('[DialerPage] Failed to sync scheduled_callback_at', e);
        }
      } else {
        // ── Clear scheduled_callback_at if not a callback disposition ──
        // This prevents stale callbacks from keeping a lead at the front of the queue
        try {
          await supabase
            .from('campaign_leads')
            .update({ scheduled_callback_at: null } as any)
            .eq('id', currentLead.id);
        } catch (e) {
          console.warn('[DialerPage] Failed to clear scheduled_callback_at', e);
        }
      }

      // 3. Save call record
      await saveCall({
        id: currentCallId || undefined,
        master_lead_id: masterId,
        campaign_lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        duration_seconds: twilioCallDuration,
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
          twilioCallDuration
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
            const { error: removeClError } = await supabase
              .from('campaign_leads')
              // Must match TERMINAL_STATUSES in dialer-api `getCampaignLeads` (capital R)
              .update({ status: 'Removed' })
              .eq('campaign_id', selectedCampaignId!)
              .eq('lead_id', currentLead.lead_id || currentLead.id);
            if (removeClError) {
              console.warn("Failed to remove lead from campaign", removeClError.message);
            }
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

      if (twilioCallDuration > 0 && masterId) {
        scheduleRecordingHistoryRefresh(masterId);
      }

      historySessionCacheRef.current.delete(masterId);

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
        fetchHistory(currentLead.lead_id || currentLead.id, {
          campaignLeadId: currentLead.id,
        });
        toast.success("Call saved successfully", { id: toastId });
        if (selectedDisp && selectedDisp.name.toLowerCase().includes("sold")) {
          setDialerStats(prev => prev ? { ...prev, policies_sold: prev.policies_sold + 1, last_updated_at: new Date().toISOString() } : prev);
          setSessionStats(prev => ({ ...prev, policies_sold: prev.policies_sold + 1 }));
          if (user?.id) upsertDialerStats(user.id, { policies_sold: 1 }).catch(() => {});
        }

        // ── Change 8: Update local call_attempts + last_called_at + status after save ──
        setLeadQueue(prev => prev.map((l, i) =>
          i === currentLeadIndex
            ? { ...l, call_attempts: (l.call_attempts || 0) + 1, last_called_at: new Date().toISOString(), status: selectedDisp?.name || l.status }
            : l
        ));
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

        if (lockMode) {
          // Team/Open: same path as skip/advance — get_next_queue_lead + enrich + heartbeat
          setShowWrapUp(false);
          setSelectedDisp(null);
          setNoteText("");
          setNoteError(false);
          setCurrentCallId(null);
          stopHeartbeat();
          if (currentLead?.id) {
            await releaseLock(currentLead.id as string);
          }
          const loaded = await loadLockModeLead(campaignType);
          if (!loaded) {
            toast("Queue empty — no more leads available");
          }
        } else {
          // ── Queue Lifecycle: re-insert disposed lead at correct priority tier ──
          // Resolve callbackDueAt from the inline callback scheduler if active
          let callbackDueAt: string | null = null;
          if (selectedDisp?.callbackScheduler && callbackDate && callbackTime) {
            // Build ISO from the selected date + time (same values used to save the appointment)
            const [h, rest] = callbackTime.split(':');
            const [min, period] = (rest || '').split(' ');
            let hours24 = parseInt(h, 10);
            if (period === 'PM' && hours24 < 12) hours24 += 12;
            if (period === 'AM' && hours24 === 12) hours24 = 0;
            callbackDueAt = new Date(
              callbackDate.getFullYear(),
              callbackDate.getMonth(),
              callbackDate.getDate(),
              hours24,
              parseInt(min || '0', 10),
            ).toISOString();
          }

          // ── Change 8: Update local call_attempts + last_called_at before queue lifecycle ──
          setLeadQueue(prev => prev.map((l, i) =>
            i === currentLeadIndex
              ? { ...l, call_attempts: (l.call_attempts || 0) + 1, last_called_at: new Date().toISOString(), status: selectedDisp?.name || l.status }
              : l
          ));

          if (currentLead) {
            applyQueueLifecycle(
              { ...currentLead, call_attempts: (currentLead.call_attempts || 0) + 1, last_called_at: new Date().toISOString(), status: selectedDisp?.name || currentLead.status } as CampaignLead,
              selectedDisp?.name || '',
              callbackDueAt,
            );
          }

          // UI wrap-up cleanup (replaces handleAdvance — queue reset is the advance)
          setShowWrapUp(false);
          setSelectedDisp(null);
          setNoteText("");
          setNoteError(false);
          setCurrentCallId(null);
          setCallbackDate(undefined);
          setCallbackTime("");
          setClaimRingActive(false);
          cancelClaimTimer();
          
          if (autoDialEnabled) {
            console.log("[DialerPage] Reactive machine will handle the next call after save-and-next");
          }
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
                  if (pendingCall) {
                    proceedWithCall(
                      pendingCall.leadPhone,
                      pendingCall.proposedNumber,
                      pendingCall.contactId
                    );
                  }
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
            // Release all locks for this campaign (bulk cleanup)
            if (lockMode && selectedCampaignId) {
              releaseAllAgentLocks(selectedCampaignId);
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
            twilioDestroy();
            setSelectedCampaignId(null);
            setLeadQueue([]);
            setCurrentLeadIndex(0);
          }}
          className="border border-destructive text-destructive text-xs rounded-lg px-3 py-1 font-semibold shrink-0 hover:bg-destructive hover:text-destructive-foreground transition-colors"
        >
          ← End Session
        </button>

        {/* CENTER: centered inline stats in subtle boxes */}
        <DialerHeaderStats 
          statsLoading={statsLoading}
          sessionStartedAt={dialerStats?.session_started_at}
          sessionElapsed={sessionElapsed}
          sessionStats={sessionStats}
          fmtSessionDuration={fmtSessionDuration}
          fmtDuration={fmtDuration}
        />

        {/* RIGHT */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Auto-Dial toggle */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium">Auto-Dial</label>
            <Switch
              checked={autoDialEnabled}
              onCheckedChange={(checked) => {
                setAutoDialEnabled(checked);
                if (!checked) setIsPaused(false);
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
                setIsPaused(!isPaused);
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
      {isQueueExhausted ? (
        <div className="flex flex-1 items-center justify-center p-8 flex-col text-center bg-card/30 m-3 rounded-xl border border-dashed border-border/50">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <Users className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <h3 className="text-xl font-bold text-foreground mb-2">No Available Contacts In Queue.</h3>
          {nextAvailableTime ? (
            <p className="text-sm font-semibold text-primary max-w-sm text-balance">
              Next Available Contact Is In {formatTimeUntil(nextAvailableTime.toISOString(), new Date())}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground max-w-sm text-balance">
              Your queue is empty or all contacts have been processed. Additional leads will appear here when assigned or eligible for retry.
            </p>
          )}
        </div>
      ) : (
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
                          setIsAdvancing(true);
                          setCurrentLeadIndex(i => i - 1);
                          setShowWrapUp(false);
                          setSelectedDisp(null);
                          setNoteText("");
                          setNoteError(false);
                          setTimeout(() => setIsAdvancing(false), 100);
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
                          setIsAdvancing(true);
                          setCurrentLeadIndex(i => i + 1);
                          setShowWrapUp(false);
                          setSelectedDisp(null);
                          setNoteText("");
                          setNoteError(false);
                          setTimeout(() => setIsAdvancing(false), 100);
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
              isAdvancing={isAdvancing}
            />
          </div>
        </div>

        {/* ── CENTER COLUMN (Conversation History) ── */}
        <ConversationHistory
          history={historyLeadId === (currentLead?.lead_id || currentLead?.id) ? history : []}
          loadingHistory={loadingHistory || historyLeadId !== (currentLead?.lead_id || currentLead?.id)}
          formatDateTime={formatDateTime}
          smsTab={smsTab}
          messageText={messageText}
          subjectText={subjectText}
          selectedCallerNumber={selectedCallerNumber}
          availableNumbers={availableNumbers}
          onSmsTabChange={handleSmsTabChange}
          onOpenTemplates={handleOpenTemplates}
          onSendMessage={handleSendMessage}
          onMessageChange={(text) => setMessageText(text)}
          onSubjectChange={(text) => setSubjectText(text)}
          onCallerNumberChange={setSelectedCallerNumber}
          historyEndRef={historyEndRef}
        />

        {/* ── RIGHT COLUMN (Controls & Outcomes) ── */}
        <DialerActions
          voiceCallState={twilioCallState}
          voiceCallDuration={twilioCallDuration}
          claimRingActive={claimRingActive}
          campaignType={campaignType}
          campaignId={selectedCampaignId || ""}
          organizationId={organizationId}
          userRole={profile?.role || "agent"}
          lockMode={lockMode}
          currentLead={currentLead}
          leftTab={leftTab}
          dispositions={dispositions}
          selectedDisp={selectedDisp}
          fmtDuration={fmtDuration}
          onHangUp={handleHangUp}
          onCall={handleCall}
          onSkip={handleSkip}
          onSelectTab={setLeftTab}
          onSelectDisposition={handleSelectDisposition}
          showWrapUp={showWrapUp}
          noteText={noteText}
          noteError={noteError}
          onNoteChange={setNoteText}
          onSaveAndNext={handleSaveAndNext}
          onSaveOnly={handleSaveOnly}
          callbackDate={callbackDate}
          setCallbackDate={setCallbackDate}
          callbackTime={callbackTime}
          setCallbackTime={setCallbackTime}
          aptTitle={aptTitle}
          setAptTitle={setAptTitle}
          aptDate={aptDate}
          setAptDate={setAptDate}
          aptStartTime={aptStartTime}
          setAptStartTime={setAptStartTime}
          aptEndTime={aptEndTime}
          setAptEndTime={setAptEndTime}
          queuePanelProps={{
            campaignType,
            campaignId: selectedCampaignId!,
            organizationId,
            userRole: (profile as any)?.role || "Agent",
            displayQueue: displayQueue as any,
            leadQueue: leadQueue as any,
            currentLeadIndex,
            onSelectLead: handleLeadSelect,
            queueSort,
            setQueueSort,
            showQueueFilters,
            setShowQueueFilters,
            loadingLeads,
            hasMoreLeads,
            currentOffset,
            fetchLeadsBatch,
            leadCallStats,
            onClearFilters: () => setQueueFilter({ status: '', state: '', leadSource: '', minAttempts: 0, maxAttempts: 99, minScore: 0, maxScore: 10 }),
            filterSummary: (queueSort !== 'smart' || queueFilter.status || queueFilter.state || queueFilter.leadSource || queueFilter.maxAttempts < 99 || queueFilter.minScore > 0 || queueFilter.maxScore < 10)
                ? `Showing ${displayQueue.length} of ${leadQueue.length} leads`
                : "",
          }}
          availableScripts={availableScripts}
          activeScriptId={activeScriptId}
          onOpenScript={setActiveScriptId}
        />
      </div>
      )}

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
          key={currentLead.lead_id || currentLead.id}
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
                handleSkip();
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
                  twilioMakeCall(dncLead.phone);
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
                // Release all locks for this campaign (bulk cleanup)
                if (lockMode && selectedCampaignId) {
                  releaseAllAgentLocks(selectedCampaignId);
                }
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
        loading={callingSettingsLoading}
        saving={callingSettingsSaving}
        onSave={handleSaveCallingSettings}
      />

      {/* ── Early Access / Queue Override Modal ── */}
      <Dialog open={pendingOverrideIndex !== null} onOpenChange={(open) => { if (!open) setPendingOverrideIndex(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="w-5 h-5" />
              Lead Not Ready
            </DialogTitle>
            <DialogDescription className="pt-2">
              This lead is scheduled for a future retry or callback and normally shouldn't be called yet. 
              Are you sure you want to override the schedule and call them now?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingOverrideIndex(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmOverrideSelect}>
              Call Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
}
