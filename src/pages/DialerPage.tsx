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
  Settings,
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
import { cn } from "@/lib/utils";
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
import ContactModal from "@/components/contacts/ContactModal";
import { useCalendar } from "@/contexts/CalendarContext";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { Lead, PipelineStage, DialerDailyStats } from "@/lib/types";
import { upsertDialerStats, getTodayStats, deleteTodayStats } from "@/lib/supabase-dialer-stats";
import { Skeleton } from "@/components/ui/skeleton";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import { getContactLocalTime, getContactTimezone } from "@/utils/contactLocalTime";

import DraggableScriptPopup from "@/components/dialer/DraggableScriptPopup";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence } from "framer-motion";
import { useBranding } from "@/contexts/BrandingContext";

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

const getCampaignTypeColor = (type: string) => {
  const t = (type || "").toUpperCase();
  if (t === "TEAM") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (t === "PERSONAL") return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  if (t.includes("POOL")) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return "bg-muted text-muted-foreground border-border";
};

/* ─── Component ─── */

export default function DialerPage() {
  /* --- state --- */
  const [searchParams, setSearchParams] = useSearchParams();
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
    callState,
    callDuration: telnyxCallDuration,
    currentCall: telnyxCurrentCall,
    makeCall: telnyxMakeCall,
    hangUp: telnyxHangUp,
    initializeClient: telnyxInitialize,
    destroyClient: telnyxDestroy,
  } = useTelnyx();

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
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const { formatDate, formatDateTime } = useBranding();
  const { addAppointment } = useCalendar();
  const [availableScripts, setAvailableScripts] = useState<any[]>([]);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [shouldAdvanceAfterModal, setShouldAdvanceAfterModal] = useState(false);

  // ── Auto-Dial state ──
  const [autoDialer, setAutoDialer] = useState<AutoDialer | null>(null);
  const [manualCallerId, setManualCallerId] = useState<string | null>(null);
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
    if (!dialerStats?.session_started_at) {
      setSessionElapsed(0);
      return;
    }
    const startTime = new Date(dialerStats.session_started_at).getTime();
    const tick = () => {
      setSessionElapsed(Math.floor((Date.now() - startTime) / 1000));
    };
    tick(); // immediate
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [dialerStats?.session_started_at]);

  /* --- queries --- */
  
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  const { data: campaignStateStats = {} } = useQuery({
    queryKey: ["campaignStateStats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_leads')
        .select('campaign_id, state');
      if (error) throw error;
      
      const stats: Record<string, { state: string, count: number }[]> = {};
      data.forEach(row => {
        if (!row.state) return;
        if (!stats[row.campaign_id]) stats[row.campaign_id] = [];
        let stateEntry = stats[row.campaign_id].find(s => s.state === row.state);
        if (!stateEntry) {
          stateEntry = { state: row.state, count: 0 };
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

  // ── Owned phone numbers (loaded once on mount) ──
  const ownedNumbers = useRef<any[]>([]);
  const lastUsedCallerId = useRef<string>("");

  useEffect(() => {
    supabase
      .from('phone_numbers')
      .select('phone_number, is_default, spam_status, area_code, friendly_name')
      .then(({ data }) => {
        if (data) ownedNumbers.current = data;
      });
  }, []);

  /* --- effects for syncing query data to state if needed --- */
  // Note: We prefer using the data from useQuery directly, but some effects or 
  // handlers might expect these states. We'll update them via useEffect for compatibility.
  useEffect(() => {
    const fetchCampaigns = async () => {
      setCampaignsLoading(true);
      const { data, error } = await supabase
        .from('campaigns')
        .select('id, name, type, status, description, tags, total_leads, leads_contacted, leads_converted, max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled')
        .in('status', ['Active', 'Paused'])
        .order('name', { ascending: true });
      if (!error && data) setCampaigns(data);
      setCampaignsLoading(false);
    };
    fetchCampaigns();
  }, []);

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

  const fetchLeadsBatch = useCallback(async (campaignId: string, offset: number, clear = false) => {
    setLoadingLeads(true);
    try {
      const leads = await getCampaignLeads(campaignId, BATCH_SIZE, offset);
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
  }, []);

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
        const leads = await getCampaignLeads(selectedCampaignId, BATCH_SIZE, 0);
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

    loadWithResume();
  }, [selectedCampaignId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load more leads when we get close to the end of the queue
  useEffect(() => {
    if (selectedCampaignId && hasMoreLeads && !loadingLeads && leadQueue.length > 0) {
      if (currentLeadIndex >= leadQueue.length - 10) {
        fetchLeadsBatch(selectedCampaignId, currentOffset);
      }
    }
  }, [currentLeadIndex, leadQueue.length, selectedCampaignId, hasMoreLeads, loadingLeads, currentOffset, fetchLeadsBatch]);

  // Persist queue preferences to localStorage
  useEffect(() => { localStorage.setItem(QUEUE_SORT_KEY, queueSort); }, [queueSort]);
  useEffect(() => { localStorage.setItem(QUEUE_FILTER_KEY, JSON.stringify(queueFilter)); }, [queueFilter]);
  useEffect(() => { localStorage.setItem(QUEUE_PREVIEW_KEY, JSON.stringify(queuePreviewFields)); }, [queuePreviewFields]);

  // Sorted + filtered view of the lead queue (display only — underlying queue order unchanged)
  const displayQueue = useMemo(() => {
    let q = leadQueue.map((lead, originalIndex) => ({ lead, originalIndex }));

    // Apply filters
    if (queueFilter.status) q = q.filter(({ lead }) => lead.status === queueFilter.status);
    if (queueFilter.state) q = q.filter(({ lead }) => (lead.state || '').toLowerCase() === queueFilter.state.toLowerCase());
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
  const uniqueStates = useMemo(() => [...new Set(leadQueue.map(l => l.state).filter(Boolean))].sort(), [leadQueue]);
  const uniqueSources = useMemo(() => [...new Set(leadQueue.map(l => l.source).filter(Boolean))].sort(), [leadQueue]);

  // Helper: render a preview field value for a lead card
  function renderQueuePreviewValue(lead: any, field: string): string {
    switch (field) {
      case 'age': {
        if (!lead.created_at) return '—';
        const days = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000);
        return days === 0 ? 'Today' : `${days}d old`;
      }
      case 'state': return lead.state || '—';
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
    if (!currentLead) return;
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

  // AMD auto-dispose handler
  const handleAutoDispose = useCallback(async (disposition: Disposition) => {
    const callControlId = telnyxCurrentCall?.id || telnyxCurrentCall?.callControlId;
    if (callControlId) {
      try {
        await supabase.from('calls')
          .update({ disposition_name: disposition.name })
          .eq('telnyx_call_id', callControlId);
      } catch {
        // non-blocking
      }
    }
    setShowWrapUp(false);
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentLeadIndex((i) => i + 1);
  }, [telnyxCurrentCall]);

  // Trigger wrap-up when call ends (covers remote hangup)
  // Also checks for AMD machine detection to auto-dispose
  useEffect(() => {
    if (callState === "ended") {
      telnyxHangUp();
      setShowWrapUp(true);

      // Check for AMD machine detection
      const checkAmd = async () => {
        const callControlId = telnyxCurrentCall?.id || telnyxCurrentCall?.callControlId;
        if (!callControlId) return;

        try {
          const { data: callRecord, error: amdError } = await supabase
            .from('calls')
            .select('amd_result')
            .eq('telnyx_call_id', callControlId)
            .maybeSingle();

          if (amdError) {
            console.warn('AMD check failed, continuing with normal wrap-up:', amdError.message);
            return;
          }

          if (callRecord?.amd_result === 'machine') {
            const vmDisposition = dispositions.find(d =>
              d.name.toLowerCase().includes('voicemail') ||
              d.name.toLowerCase().includes('no answer')
            );
            if (vmDisposition) {
              setSelectedDisp(vmDisposition);
              handleAutoDispose(vmDisposition);
            }
          }
        } catch (err) {
          console.warn('AMD check threw, continuing with normal wrap-up:', err);
        }
      };

      checkAmd();
    }
  }, [callState, telnyxHangUp, telnyxCurrentCall, dispositions, handleAutoDispose]);

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
    if (!showWrapUp || callState === "active") return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9 && dispositions[num - 1]) {
      handleSelectDisposition(dispositions[num - 1]);
    }
  }
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showWrapUp, callState, dispositions]);

  // (Session duration ticker moved to mount effects above)

  // ── Calling Settings: fetch on open ──
  useEffect(() => {
    const effectiveCampaignId = settingsCampaignId ?? selectedCampaignId;
    if (!callingSettingsOpen || !effectiveCampaignId) return;
    setCallingSettingsLoading(true);
    supabase
      .from("campaigns")
      .select("max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled")
      .eq("id", effectiveCampaignId)
      .maybeSingle() as Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
      .then(({ data }) => {
        if (data) {
          setIsUnlimited(data.max_attempts === null);
          setMaxAttemptsValue(data.max_attempts ?? 3);
          setCallingHoursStart((data.calling_hours_start as string)?.slice(0, 5) ?? "09:00");
          setCallingHoursEnd((data.calling_hours_end as string)?.slice(0, 5) ?? "21:00");
          setRetryIntervalHours(data.retry_interval_hours ?? 24);
          setSettingsAutoDialEnabled(data.auto_dial_enabled ?? true);
          setLocalPresenceEnabled(data.local_presence_enabled ?? true);
        } else {
          console.warn(`[DialerPage] campaigns row not found for id=${effectiveCampaignId}, using defaults`);
        }
        setCallingSettingsLoading(false);
      })
      .catch((err) => {
        console.warn('[DialerPage] Failed to load campaign calling settings', err);
        setCallingSettingsLoading(false);
      });
  }, [callingSettingsOpen, settingsCampaignId, selectedCampaignId]);

  const handleSaveCallingSettings = async () => {
    const effectiveCampaignId = settingsCampaignId ?? selectedCampaignId;
    if (!effectiveCampaignId) return;
    setCallingSettingsSaving(true);
    const { error } = await supabase
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
    setCallingSettingsSaving(false);
    if (error) {
      toast.error("Failed to save settings — please try again");
    } else {
      toast.success("Calling settings saved");
      setCallingSettingsOpen(false);
      setSettingsCampaignId(null);
    }
  };

  // ── AutoDialer initialization ──
  useEffect(() => {
    const agentId = user?.id;
    if (!selectedCampaignId || !agentId) return;
    const dialer = new AutoDialer(sessionIdRef.current, selectedCampaignId, agentId);
    dialer.startSession();
    setAutoDialer(dialer);
    // Eagerly register TelnyxRTC so the client is ready before the first call
    telnyxInitialize();
    return () => {
      dialer.pauseAutoDialer();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, user?.id]);

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

  // ── Auto-dial call event → trigger TelnyxRTC ──
  useEffect(() => {
    const handleAutoDialCall = (event: Event) => {
      const { lead, callId } = (event as CustomEvent).detail;
      if (lead?.phone) {
        const callerNum = selectCallerId(lead.phone);
        proceedWithCall(lead.phone, callerNum, callId);
      }
    };
    window.addEventListener("auto-dial-call", handleAutoDialCall);
    return () => window.removeEventListener("auto-dial-call", handleAutoDialCall);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telnyxMakeCall]);

  /* --- caller ID selection --- */

  const selectCallerId = (leadPhone: string): string => {
    if (manualCallerId) return manualCallerId;
    if (!ownedNumbers.current || ownedNumbers.current.length === 0) return '';
    const digits = leadPhone.replace(/\D/g, '');
    const leadAreaCode = digits.startsWith('1') ? digits.substring(1, 4) : digits.substring(0, 3);
    const statusRank = (status: string) => {
      if (status === 'Clean') return 0;
      if (status === 'At Risk') return 1;
      if (status === 'Insufficient Data') return 2;
      return 3;
    };
    const usable = ownedNumbers.current.filter(n => n.spam_status !== 'Flagged');
    if (usable.length === 0) {
      return ownedNumbers.current.find(n => n.is_default)?.phone_number || '';
    }
    const campaignLocalPresence = selectedCampaign?.local_presence_enabled !== false;
    if (campaignLocalPresence) {
      const exactMatch = [...usable]
        .filter(n => n.area_code === leadAreaCode)
        .sort((a, b) => statusRank(a.spam_status) - statusRank(b.spam_status))[0];
      if (exactMatch) return exactMatch.phone_number;
    }
    const cleanest = [...usable]
      .sort((a, b) => statusRank(a.spam_status) - statusRank(b.spam_status))[0];
    if (cleanest) return cleanest.phone_number;
    return ownedNumbers.current.find(n => n.is_default)?.phone_number || '';
  };

  const getPreviousCallerId = async (contactId: string): Promise<string | null> => {
    if (!contactId) return null;
    try {
      const { data } = await supabase
        .from('calls')
        .select('caller_id_used')
        .eq('contact_id', contactId)
        .not('caller_id_used', 'is', null)
        .gt('duration', 0)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.caller_id_used || null;
    } catch (err) {
      console.warn('[DialerPage] getPreviousCallerId failed, defaulting to null', err);
      return null;
    }
  };

  /* --- call handlers --- */

  const [showCallerIdWarning, setShowCallerIdWarning] = useState(false);
  const [pendingCall, setPendingCall] = useState<{
    leadPhone: string;
    contactId: string;
    proposedNumber: string;
    previousNumber: string;
  } | null>(null);

  const proceedWithCall = (leadPhone: string, callerNumber: string, callId?: string) => {
    lastUsedCallerId.current = callerNumber;
    setCurrentCallId(callId || null);
    telnyxMakeCall(leadPhone, callerNumber || undefined, callId);
  };

  const initiateCall = async (leadPhone: string, contactId: string) => {
    const previousNumber = await getPreviousCallerId(contactId);
    const autoSelectedNumber = selectCallerId(leadPhone);
    
    // For manual calls, we create the record first to get a callId
    let callId;
    try {
      callId = await createCall({
        contact_id: contactId,
        agent_id: user?.id || "",
        campaign_id: selectedCampaignId || undefined,
        caller_id_used: previousNumber || autoSelectedNumber,
        contact_name: `${currentLead?.first_name || ''} ${currentLead?.last_name || ''}`.trim(),
        contact_phone: leadPhone,
      }, organizationId);
    } catch (err) {
      console.error("Failed to create call record for manual call:", err);
    }

    if (previousNumber) {
      const prevRecord = ownedNumbers.current.find(n => n.phone_number === previousNumber);
      const prevIsFlagged = prevRecord?.spam_status === 'Flagged';
      if (!prevIsFlagged) {
        proceedWithCall(leadPhone, previousNumber, callId);
      } else {
        setPendingCall({ leadPhone, contactId, proposedNumber: autoSelectedNumber, previousNumber });
        setShowCallerIdWarning(true);
        // We'll need to pass the callId to proceedWithCall when the user confirms the warning
        // but for now let's store it in the pending state if needed
      }
    } else {
      proceedWithCall(leadPhone, autoSelectedNumber, callId);
    }
  };

  function handleCall() {
    if (!currentLead) {
      toast.error("No lead selected");
      return;
    }
    if (telnyxStatus === "error") {
      toast.error("Dialer error. Please check your settings.");
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
    const contactId = currentLead.lead_id || currentLead.id || "";
    initiateCall(currentLead.phone, contactId);
  }

  function handleHangUp() {
    console.log("[Dialer] Hang up — duration:", telnyxCallDuration, "counting as connected:", telnyxCallDuration >= 7);
    if (telnyxCallDuration >= 7) {
      // Optimistic local update
      setDialerStats(prev => prev ? {
        ...prev,
        calls_connected: prev.calls_connected + 1,
        total_talk_seconds: prev.total_talk_seconds + telnyxCallDuration,
        last_updated_at: new Date().toISOString(),
      } : prev);
      // Persist to Supabase
      if (user?.id) {
        upsertDialerStats(user.id, {
          calls_connected: 1,
          total_talk_seconds: telnyxCallDuration,
        }).catch(() => {});
      }
    }
    telnyxHangUp();
  }

  function handleSelectDisposition(d: Disposition) {
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
      setAptStartTime("10:00 AM");
      setAptEndTime("10:30 AM");
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
          if (user?.id) upsertDialerStats(user.id, { policies_sold: 1 }).catch(() => {});
        }

        // Delegate advance + auto-dial logic to autoDialer
        if (autoDialer && selectedDisp) {
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

  const currentStatusColor = leadStages.find(s => s.name === currentLead?.status)?.color || "#6B7280";

  function handleAdvance() {
    setShowWrapUp(false);
    setSelectedDisp(null);
    setNoteText("");
    setNoteError(false);
    setCurrentLeadIndex((i) => i + 1);
  }

  function handleSkip() {
    setIsEditingContact(false);
    setCurrentLeadIndex((i) => i + 1);
  }

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
      
      const updateData: any = {
        firstName: first_name,
        lastName: last_name,
        phone,
        email,
        state,
        age: age ? parseInt(String(age)) : undefined,
        dateOfBirth: date_of_birth,
        healthStatus: health_status,
        bestTimeToCall: best_time_to_call,
        spouseInfo: spouse_info,
        leadSource: source,
        customFields
      };

      await leadsSupabaseApi.update(masterId, updateData);
      
      // Update local queue
      setLeadQueue(prev => prev.map((l, i) => i === currentLeadIndex ? { 
        ...l, 
        first_name, 
        last_name, 
        phone, 
        email, 
        state, 
        age: age ? parseInt(String(age)) : l.age, 
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
    // Extract unique states from all campaign lead data for badges
    const getStateColors = (state: string): string => {
// ... (rest of the helper)
      const colors: Record<string, string> = {
        CA: "bg-blue-500/20 text-blue-400 border-blue-500/30",
        TX: "bg-orange-500/20 text-orange-400 border-orange-500/30",
        FL: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        NY: "bg-purple-500/20 text-purple-400 border-purple-500/30",
        IL: "bg-pink-500/20 text-pink-400 border-pink-500/30",
        PA: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
        OH: "bg-amber-500/20 text-amber-400 border-amber-500/30",
        GA: "bg-rose-500/20 text-rose-400 border-rose-500/30",
        NC: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
        MI: "bg-teal-500/20 text-teal-400 border-teal-500/30",
        AZ: "bg-red-500/20 text-red-400 border-red-500/30",
        NV: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      };
      return colors[state] || "bg-muted text-muted-foreground border-border";
    };

    return (
      <>
      <div className="flex flex-col h-full bg-background text-foreground items-center justify-center p-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full mb-4">
            <Phone className="w-3.5 h-3.5" />
            DIALER
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">Select a Campaign</h1>
          <p className="text-sm text-muted-foreground">
            Choose an active campaign to start dialing
          </p>
        </div>

        <div className="w-full max-w-7xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {campaignsLoading && (
            <div className="flex flex-col gap-4 col-span-full">
              <div className="h-20 w-full bg-muted animate-pulse rounded-xl" />
              <div className="h-20 w-full bg-muted animate-pulse rounded-xl" />
              <div className="h-20 w-full bg-muted animate-pulse rounded-xl" />
            </div>
          )}
          {!campaignsLoading && campaigns.length === 0 && (
            <div className="flex items-center justify-center py-12 col-span-full">
              <p className="text-muted-foreground text-sm">No active campaigns</p>
            </div>
          )}
          {!campaignsLoading &&
            campaigns.map((campaign: any) => {
              const states = campaignStateStats[campaign.id] || [];

              return (
                <div
                  key={campaign.id}
                  className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3"
                >
                  {/* Campaign Name & Type - Centered */}
                  <div className="flex flex-col items-center gap-1.5 py-2">
                    <h3 className="font-bold text-lg text-foreground text-center line-clamp-1">{campaign.name}</h3>
                    <span className={cn(
                      "text-[10px] uppercase tracking-widest font-black px-2.5 py-0.5 rounded-full border",
                      getCampaignTypeColor(campaign.type)
                    )}>
                      {campaign.type}
                    </span>
                  </div>

                  {/* States - Only those in the campaign */}
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] uppercase tracking-widest font-black text-muted-foreground text-center">States</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {states.slice(0, 8).map(s => (
                        <span
                          key={s.state}
                          className="flex items-center justify-center text-[10px] px-1 py-1 rounded-md font-bold transition-all bg-primary/10 text-primary border border-primary/20"
                        >
                          {s.state} ({s.count})
                        </span>
                      ))}
                      {states.length === 0 && (
                        <div className="col-span-full py-2 text-center text-[10px] text-muted-foreground italic">
                          No leads assigned
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Local Presence toggle */}
                  <div className="mt-auto flex items-center justify-between px-1 pt-3 border-t border-border/50">
                    <span className="text-[10px] uppercase tracking-widest font-black text-muted-foreground">Local Presence</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={campaign.local_presence_enabled !== false}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const newVal = !(campaign.local_presence_enabled !== false);
                        await supabase.from('campaigns').update({ local_presence_enabled: newVal }).eq('id', campaign.id);
                        setCampaigns(prev => prev.map(c => c.id === campaign.id ? { ...c, local_presence_enabled: newVal } : c));
                      }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        campaign.local_presence_enabled !== false ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        campaign.local_presence_enabled !== false ? "translate-x-4" : "translate-x-1"
                      }`} />
                    </button>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedCampaignId(campaign.id)}
                      className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-all shadow-sm"
                    >
                      Start Dialing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsCampaignId(campaign.id)
                        setCallingSettingsOpen(true)
                      }}
                      className="px-4 py-2 rounded-lg bg-accent text-foreground text-xs font-bold uppercase tracking-widest hover:bg-accent/80 flex items-center gap-1.5 transition-all"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Settings
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* ── Calling Settings Dialog ── */}
      <Dialog open={callingSettingsOpen} onOpenChange={(open) => { setCallingSettingsOpen(open); if (!open) setSettingsCampaignId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Calling Settings</DialogTitle>
            <DialogDescription>
              Configure call attempt limits and scheduling for{" "}
              <span className="font-semibold">{campaigns.find(c => c.id === settingsCampaignId)?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          {callingSettingsLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-5 py-2">
              {/* Max Attempts */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Max Call Attempts</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={isUnlimited ? "" : maxAttemptsValue}
                    disabled={isUnlimited}
                    onChange={(e) => setMaxAttemptsValue(Number(e.target.value))}
                    className="w-20 rounded border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-40"
                    placeholder="3"
                  />
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isUnlimited}
                      onChange={(e) => setIsUnlimited(e.target.checked)}
                      className="accent-primary"
                    />
                    Unlimited
                  </label>
                </div>
              </div>

              {/* Calling Hours */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Calling Hours (local lead time)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={callingHoursStart}
                    onChange={(e) => setCallingHoursStart(e.target.value)}
                    className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <input
                    type="time"
                    value={callingHoursEnd}
                    onChange={(e) => setCallingHoursEnd(e.target.value)}
                    className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </div>
              </div>

              {/* Retry Interval */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Retry Interval (hours)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={retryIntervalHours}
                  onChange={(e) => setRetryIntervalHours(Number(e.target.value))}
                  className="w-24 rounded border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Toggles */}
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer select-none">
                  <span className="text-sm font-medium">Auto-Dial</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settingsAutoDialEnabled}
                    onClick={() => setSettingsAutoDialEnabled((v) => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      settingsAutoDialEnabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        settingsAutoDialEnabled ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>
                <label className="flex items-center justify-between cursor-pointer select-none">
                  <span className="text-sm font-medium">Local Presence</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={localPresenceEnabled}
                    onClick={() => setLocalPresenceEnabled((v) => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      localPresenceEnabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        localPresenceEnabled ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCallingSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCallingSettings} disabled={callingSettingsSaving || callingSettingsLoading}>
              {callingSettingsSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      <div className="flex flex-col h-[calc(100vh-80px)] lg:h-[calc(100vh-88px)] -mb-4 lg:-mb-6 overflow-hidden bg-background text-foreground">
      {/* ── TOP CONTROL BAR ── */}
      <div className="flex items-center border-b px-4 pt-1 pb-2 gap-4">
        {/* LEFT */}
        <button
          onClick={() => {
            // Clear saved queue position
            if (user?.id && selectedCampaignId) {
              supabase
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
              <div key={i} className="flex flex-col items-center px-4 py-1.5 bg-accent/30 border border-border/50 rounded-xl min-w-[80px]">
                <Skeleton className="h-2 w-12 mb-1" />
                <Skeleton className="h-3 w-8" />
              </div>
            ))
          ) : (
            [
              { label: "Session Duration", value: dialerStats?.session_started_at ? fmtSessionDuration(sessionElapsed) : "—" },
              { label: "Calls Made", value: dialerStats?.calls_made ?? 0 },
              { label: "Connected", value: dialerStats?.calls_connected ?? 0 },
              { label: "Answer Rate", value: (dialerStats?.calls_made ?? 0) > 0 ? `${(((dialerStats?.calls_connected ?? 0) / (dialerStats?.calls_made ?? 1)) * 100).toFixed(0)}%` : "—" },
              { label: "Policies Sold", value: dialerStats?.policies_sold ?? 0 },
              { label: "Avg Talk Time", value: (dialerStats?.calls_connected ?? 0) > 0 ? fmtDuration(Math.round((dialerStats?.total_talk_seconds ?? 0) / (dialerStats?.calls_connected ?? 1))) : "—" },
            ].map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center px-4 py-1.5 bg-accent/30 border border-border/50 rounded-xl min-w-0 h-20 justify-center transition-all hover:bg-accent/50"
              >
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold truncate w-full text-center">{s.label}</div>
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
          <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded-full">
            {selectedCampaign?.name ?? "No Campaign"}
          </span>
          <button
            onClick={() => setShowEndSessionConfirm(true)}
            className="border border-destructive text-destructive text-xs px-3 py-1 rounded-lg hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            Reset Stats
          </button>
        </div>
      </div>

      {/* Reset Stats confirmation */}
      {showEndSessionConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-xl p-6 w-80 flex flex-col gap-4 shadow-xl">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">Reset today's stats?</p>
              <p className="text-xs text-muted-foreground">This cannot be undone.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowEndSessionConfirm(false)}
                className="flex-1 py-2 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setDialerStats(null);
                  setSessionElapsed(0);
                  setShowEndSessionConfirm(false);
                  if (user?.id) deleteTodayStats(user.id).catch(() => {});
                }}
                className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90"
              >
                Reset Stats
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── COLUMNS ── */}
      <div className="flex flex-1 overflow-hidden p-3 gap-3">
        {/* ── NEW LEFT COLUMN (Contact Info) ── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden">
          <div className="bg-card border rounded-xl flex flex-col overflow-hidden h-full">
            {/* Header section — shrink-0 */}
            <div className="p-4 border-b flex flex-col gap-2 bg-card shrink-0">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-1">
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
                      <ChevronLeft className="w-5 h-5" />
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
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setShowFullViewDrawer(true)}
                      className="p-1 px-1.5 text-primary hover:bg-primary/10 rounded transition-colors"
                      title="Full View"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {isEditingContact ? (
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={saveInlineEdit}
                          className="p-1 px-1.5 bg-success/10 text-success hover:bg-success/20 rounded transition-colors"
                          title="Save Edits"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setIsEditingContact(false)}
                          className="p-1 px-1.5 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded transition-colors"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={startEditing}
                        className="p-1 px-1.5 text-primary hover:bg-primary/10 rounded transition-colors"
                        title="Edit Contact"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {currentLead && (
                <div className="flex flex-col gap-1 mt-2">
                  {isEditingContact ? (
                    <div className="flex gap-2 justify-center px-4">
                      <input 
                        value={editForm.first_name || ""}
                        onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                        className="bg-accent/50 border border-border rounded-lg px-2 py-1.5 text-sm font-bold text-center flex-1 focus:ring-1 focus:ring-primary outline-none"
                        placeholder="First Name"
                      />
                      <input 
                        value={editForm.last_name || ""}
                        onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                        className="bg-accent/50 border border-border rounded-lg px-2 py-1.5 text-sm font-bold text-center flex-1 focus:ring-1 focus:ring-primary outline-none"
                        placeholder="Last Name"
                      />
                    </div>
                  ) : (
                    <h2 className="text-xl font-bold text-foreground tracking-tight text-center">
                      {`${currentLead?.first_name ?? ""} ${currentLead?.last_name ?? ""}`.trim()}
                    </h2>
                  )}
                  <div className="flex flex-col gap-2 items-center">
                    <div className="relative w-full">
                      <select
                        value={currentLead?.status || ""}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        className="w-full text-[10px] text-center uppercase tracking-widest font-bold rounded-md px-6 py-1 border border-transparent appearance-none focus:ring-0 cursor-pointer transition-colors"
                        style={{ 
                          backgroundColor: currentStatusColor + '15',
                          color: currentStatusColor,
                          borderColor: currentStatusColor + '30'
                        }}
                      >
                        {leadStages.map(s => (
                          <option key={s.id} value={s.name} style={{ color: s.color }}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                    </div>
                    
                    {contactLocalTimeDisplay && (
                      <div className="inline-flex items-center justify-center text-green-500 text-[10px] font-bold">
                        <Clock className="w-2.5 h-2.5 mr-1" />
                        {contactLocalTimeDisplay}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable details — flex-1 overflow-y-auto */}
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "First Name", value: currentLead?.first_name, key: "first_name" },
                  { label: "Last Name", value: currentLead?.last_name, key: "last_name" },
                  { label: "Phone", value: currentLead?.phone, key: "phone" },
                  { label: "Email", value: currentLead?.email, key: "email" },
                  { label: "State", value: currentLead?.state, key: "state" },
                  { label: "Age", value: currentLead?.age, key: "age" },
                  { label: "DOB", value: currentLead?.date_of_birth, key: "date_of_birth" },
                  { label: "Health", value: currentLead?.health_status, key: "health_status" },
                  { label: "Best Time", value: currentLead?.best_time_to_call, key: "best_time_to_call" },
                  { label: "Spouse", value: currentLead?.spouse_info, key: "spouse_info" },
                  { label: "Source", value: currentLead?.source, key: "source" },
                ].map((f) => (
                  <div key={f.label} className="min-w-0">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{f.label}</div>
                    {isEditingContact ? (
                      <input 
                        type="text"
                        value={editForm[f.key] || ""}
                        onChange={(e) => setEditForm({ ...editForm, [f.key]: e.target.value })}
                        className="w-full bg-accent/50 border border-border rounded px-1.5 py-0.5 text-xs text-foreground mt-0.5 focus:ring-1 focus:ring-primary outline-none"
                      />
                    ) : (
                      <div className="text-sm font-semibold text-foreground mt-0.5 truncate">{f.value || "—"}</div>
                    )}
                  </div>
                ))}

                {/* Assigned Agent */}
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">Assigned Agent</div>
                  <div className={cn("text-sm font-semibold mt-0.5 truncate", currentLead?.assigned_agent_id ? "text-foreground" : "text-muted-foreground")}>
                    {assignedAgentName || (currentLead?.assigned_agent_id ? 'Unknown Agent' : 'Unassigned')}
                  </div>
                </div>

                {/* Dynamically render ALL other fields found in currentLead */}
                {currentLead && Object.entries(currentLead).map(([key, value]) => {
                  // Skip system/internal fields already handled or not meant for display
                  const skippedKeys = [
                    'id', 'lead_id', 'campaign_id', 'first_name', 'last_name', 
                    'phone', 'email', 'state', 'age', 'date_of_birth', 
                    'health_status', 'best_time_to_call', 'spouse_info', 
                    'lead_score', 'source', 'status', 'created_at', 'updated_at',
                    'claimed_by', 'claimed_at', 'locked_by', 'locked_at',
                    'call_attempts', 'last_called_at', 'disposition', 'sort_order',
                    'custom_fields', 'lead', 'assigned_agent_id'
                  ];
                  
                  if (skippedKeys.includes(key) || value === null || value === undefined) return null;
                  
                  // Handle custom_fields object specifically if it exists
                  if (key === 'custom_fields' && typeof value === 'object') {
                    return Object.entries(value as object).map(([ckey, cval]) => (
                      <div key={ckey} className="min-w-0 border-t pt-2 col-span-2">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{ckey.replace(/_/g, ' ')}</div>
                        {isEditingContact ? (
                          <input 
                            type="text"
                            value={String(editForm[ckey] ?? cval)}
                            onChange={(e) => setEditForm({ ...editForm, [ckey]: e.target.value })}
                            className="w-full bg-accent/50 border border-border rounded px-1.5 py-0.5 text-xs text-foreground mt-0.5 focus:ring-1 focus:ring-primary outline-none"
                          />
                        ) : (
                          <div className="text-sm font-semibold text-foreground mt-0.5">{String(cval) || "—"}</div>
                        )}
                      </div>
                    ));
                  }

                  // Handle normal fields
                  return (
                    <div key={key} className="min-w-0">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{key.replace(/_/g, ' ')}</div>
                      <div className="text-sm font-semibold text-foreground mt-0.5 truncate">{String(value) || "—"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
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
              
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">From:</span>
                <select
                  value={manualCallerId || ""}
                  onChange={(e) => setManualCallerId(e.target.value || null)}
                  className="bg-accent/50 border border-border rounded px-2 py-1 text-[10px] font-bold text-foreground focus:ring-1 focus:ring-primary outline-none cursor-pointer hover:bg-accent/80 transition-all"
                >
                  <option value="">Auto-Select</option>
                  {(ownedNumbers.current || []).map(n => (
                    <option key={n.phone_number} value={n.phone_number}>
                      {n.friendly_name ? `${n.friendly_name} - ` : ''}{n.phone_number} {n.is_default ? '(Default)' : ''}
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
            {callState === "active" || callState === "dialing" ? (
              <button
                onClick={handleHangUp}
                className="bg-destructive text-destructive-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-destructive/90 shadow-lg shadow-destructive/20"
              >
                <PhoneOff className="w-4 h-4" />
                <span className="leading-none">Hang Up</span>
                <span className="font-mono text-[9px] opacity-80">{fmtDuration(telnyxCallDuration)}</span>
              </button>
            ) : (
              <button
                onClick={handleCall}
                className="bg-success text-success-foreground rounded-xl py-2 flex flex-col items-center justify-center gap-1 text-sm font-semibold transition-all hover:bg-success/90 shadow-lg shadow-success/20"
              >
                <Phone className="w-4 h-4" />
                <span className="leading-none">Call</span>
              </button>
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
                                <input
                                  type="date"
                                  value={callbackDate ? callbackDate.toISOString().split('T')[0] : ""}
                                  onChange={(e) => setCallbackDate(e.target.value ? new Date(e.target.value) : undefined)}
                                  className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none"
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
                                  <input
                                    type="date"
                                    value={aptDate}
                                    onChange={(e) => setAptDate(e.target.value)}
                                    className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none"
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
                  <div className="flex flex-col gap-2">
                    {/* Queue toolbar: sort, filter, field picker */}
                    {leadQueue.length > 0 && (
                      <div className="flex items-center gap-1 mb-1">
                        {/* Sort dropdown */}
                        <div className="relative flex-1">
                          <SortAsc className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                          <select
                            value={queueSort}
                            onChange={(e) => setQueueSort(e.target.value as typeof queueSort)}
                            className="w-full pl-6 pr-2 py-1 text-[10px] font-bold uppercase tracking-wide bg-muted/30 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                          >
                            <option value="default">Default</option>
                            <option value="age_oldest">Oldest First</option>
                            <option value="attempts_fewest">Fewest Attempts</option>
                            <option value="timezone">State / Timezone</option>
                            <option value="score_high">Score High→Low</option>
                            <option value="name_az">Name A→Z</option>
                          </select>
                        </div>
                        {/* Filter toggle */}
                        <button
                          onClick={() => { setShowQueueFilters(v => !v); setShowQueueFieldPicker(false); }}
                          className={cn(
                            "p-1.5 rounded-lg border transition-colors",
                            showQueueFilters
                              ? "bg-primary/10 border-primary text-primary"
                              : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"
                          )}
                          title="Filter queue"
                        >
                          <ListFilter className="w-3.5 h-3.5" />
                        </button>
                        {/* Field picker toggle */}
                        <button
                          onClick={() => { setShowQueueFieldPicker(v => !v); setShowQueueFilters(false); }}
                          className={cn(
                            "p-1.5 rounded-lg border transition-colors",
                            showQueueFieldPicker
                              ? "bg-primary/10 border-primary text-primary"
                              : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"
                          )}
                          title="Customize card fields"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Filter panel */}
                    {showQueueFilters && (
                      <div className="bg-muted/20 border border-border rounded-lg p-3 flex flex-col gap-2 mb-1">
                        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Filters</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold">Status</label>
                            <select
                              value={queueFilter.status}
                              onChange={(e) => setQueueFilter(f => ({ ...f, status: e.target.value }))}
                              className="w-full mt-0.5 px-2 py-1 text-[10px] bg-card border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="">All</option>
                              {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold">State</label>
                            <select
                              value={queueFilter.state}
                              onChange={(e) => setQueueFilter(f => ({ ...f, state: e.target.value }))}
                              className="w-full mt-0.5 px-2 py-1 text-[10px] bg-card border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="">All</option>
                              {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold">Lead Source</label>
                            <select
                              value={queueFilter.leadSource}
                              onChange={(e) => setQueueFilter(f => ({ ...f, leadSource: e.target.value }))}
                              className="w-full mt-0.5 px-2 py-1 text-[10px] bg-card border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="">All</option>
                              {uniqueSources.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold">Max Attempts</label>
                            <select
                              value={queueFilter.maxAttempts}
                              onChange={(e) => setQueueFilter(f => ({ ...f, maxAttempts: Number(e.target.value) }))}
                              className="w-full mt-0.5 px-2 py-1 text-[10px] bg-card border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value={99}>Any</option>
                              <option value={0}>0 (Never Called)</option>
                              <option value={1}>≤ 1</option>
                              <option value={2}>≤ 2</option>
                              <option value={3}>≤ 3</option>
                              <option value={5}>≤ 5</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold">Min Score</label>
                            <select
                              value={queueFilter.minScore}
                              onChange={(e) => setQueueFilter(f => ({ ...f, minScore: Number(e.target.value) }))}
                              className="w-full mt-0.5 px-2 py-1 text-[10px] bg-card border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              {[0,1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n}+</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-bold">Max Score</label>
                            <select
                              value={queueFilter.maxScore}
                              onChange={(e) => setQueueFilter(f => ({ ...f, maxScore: Number(e.target.value) }))}
                              className="w-full mt-0.5 px-2 py-1 text-[10px] bg-card border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>≤{n}</option>)}
                            </select>
                          </div>
                        </div>
                        <button
                          onClick={() => setQueueFilter({ status: '', state: '', leadSource: '', minAttempts: 0, maxAttempts: 99, minScore: 0, maxScore: 10 })}
                          className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground hover:text-destructive mt-1 text-left"
                        >
                          Clear Filters
                        </button>
                      </div>
                    )}

                    {/* Field picker panel */}
                    {showQueueFieldPicker && (
                      <div className="bg-muted/20 border border-border rounded-lg p-3 mb-1">
                        <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-2">Card Preview Fields (pick 2)</div>
                        <div className="grid grid-cols-2 gap-1">
                          {(Object.keys(PREVIEW_FIELD_LABELS) as QueuePreviewField[]).map((field) => {
                            const isSelected = queuePreviewFields.includes(field);
                            const slotIndex = queuePreviewFields.indexOf(field);
                            return (
                              <button
                                key={field}
                                onClick={() => {
                                  setQueuePreviewFields(prev => {
                                    if (isSelected) {
                                      // Remove it, fill the other slot stays
                                      const other = prev.find(f => f !== field) || 'state';
                                      return [other, other] as [QueuePreviewField, QueuePreviewField];
                                    }
                                    // Replace the least-recently selected slot (slot 1 first)
                                    return [prev[0], field] as [QueuePreviewField, QueuePreviewField];
                                  });
                                }}
                                className={cn(
                                  "flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-tight transition-all",
                                  isSelected
                                    ? "bg-primary/10 border-primary text-primary"
                                    : "bg-card border-border text-muted-foreground hover:bg-accent"
                                )}
                              >
                                {isSelected && (
                                  <span className="w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[8px] flex items-center justify-center font-black shrink-0">
                                    {slotIndex + 1}
                                  </span>
                                )}
                                {PREVIEW_FIELD_LABELS[field]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Queue count / filter notice */}
                    {(queueSort !== 'default' || queueFilter.status || queueFilter.state || queueFilter.leadSource || queueFilter.maxAttempts < 99 || queueFilter.minScore > 0 || queueFilter.maxScore < 10) && (
                      <div className="text-[9px] text-muted-foreground font-medium px-1">
                        Showing {displayQueue.length} of {leadQueue.length} leads
                      </div>
                    )}

                    {leadQueue.length === 0 ? (
                      <div className="text-center py-8">
                        <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
                        <p className="text-sm text-muted-foreground">Queue is empty</p>
                      </div>
                    ) : displayQueue.length === 0 ? (
                      <div className="text-center py-6">
                        <ListFilter className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-20" />
                        <p className="text-xs text-muted-foreground">No leads match filters</p>
                      </div>
                    ) : (
                      displayQueue.map(({ lead, originalIndex }) => {
                        const isCurrent = originalIndex === currentLeadIndex;
                        const isPast = originalIndex < currentLeadIndex;
                        return (
                          <div
                            key={lead.id}
                            onClick={() => setCurrentLeadIndex(originalIndex)}
                            className={`p-3 rounded-lg border flex items-center gap-3 cursor-pointer transition-all ${
                              isCurrent
                                ? "bg-primary/10 border-primary ring-1 ring-primary/20"
                                : isPast
                                ? "opacity-50 grayscale bg-muted/30 border-transparent"
                                : "bg-card hover:bg-accent/50 border-border"
                            }`}
                          >
                            <div
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isCurrent
                                  ? "bg-primary animate-pulse"
                                  : isPast
                                  ? "bg-muted"
                                  : "bg-muted-foreground/30"
                              }`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-foreground truncate uppercase tracking-tight">
                                {lead.first_name} {lead.last_name}
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate font-medium">
                                {lead.phone}
                              </div>
                              {/* Preview fields */}
                              <div className="flex items-center gap-2 mt-0.5">
                                {queuePreviewFields.map((field, fi) => {
                                  const val = renderQueuePreviewValue(lead, field);
                                  return val !== '—' ? (
                                    <span key={fi} className="text-[9px] text-muted-foreground/70 truncate">
                                      {val}
                                    </span>
                                  ) : null;
                                })}
                              </div>
                            </div>
                            {isCurrent && (
                              <div className="text-[9px] font-black uppercase text-primary tracking-widest shrink-0">
                                Now
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}

                    {loadingLeads && (
                      <div className="flex items-center justify-center p-4">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      </div>
                    )}

                    {hasMoreLeads && !loadingLeads && leadQueue.length > 0 && (
                      <button
                        onClick={() => fetchLeadsBatch(selectedCampaignId!, currentOffset)}
                        className="text-[10px] text-muted-foreground hover:text-primary py-2 uppercase tracking-widest font-bold"
                      >
                        Load More
                      </button>
                    )}
                  </div>
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


      <ContactModal
        lead={showFullViewDrawer && currentLead ? mapDialerLeadToContactLead(currentLead) : null}
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
                  supabase
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
      <Dialog open={callingSettingsOpen} onOpenChange={(open) => { setCallingSettingsOpen(open); if (!open) setSettingsCampaignId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Calling Settings</DialogTitle>
            <DialogDescription>
              Configure call attempt limits and scheduling for{" "}
              <span className="font-semibold">{(settingsCampaignId ? campaigns.find(c => c.id === settingsCampaignId) : selectedCampaign)?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          {callingSettingsLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-5 py-2">
              {/* Max Attempts */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Max Call Attempts</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={isUnlimited ? "" : maxAttemptsValue}
                    disabled={isUnlimited}
                    onChange={(e) => setMaxAttemptsValue(Number(e.target.value))}
                    className="w-20 rounded border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-40"
                    placeholder="3"
                  />
                  <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isUnlimited}
                      onChange={(e) => setIsUnlimited(e.target.checked)}
                      className="accent-primary"
                    />
                    Unlimited
                  </label>
                </div>
              </div>

              {/* Calling Hours */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Calling Hours (local lead time)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={callingHoursStart}
                    onChange={(e) => setCallingHoursStart(e.target.value)}
                    className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <input
                    type="time"
                    value={callingHoursEnd}
                    onChange={(e) => setCallingHoursEnd(e.target.value)}
                    className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </div>
              </div>

              {/* Retry Interval */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Retry Interval (hours)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={retryIntervalHours}
                  onChange={(e) => setRetryIntervalHours(Number(e.target.value))}
                  className="w-24 rounded border border-input bg-background px-2 py-1.5 text-sm"
                />
              </div>

              {/* Toggles */}
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer select-none">
                  <span className="text-sm font-medium">Auto-Dial</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settingsAutoDialEnabled}
                    onClick={() => setSettingsAutoDialEnabled((v) => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      settingsAutoDialEnabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        settingsAutoDialEnabled ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>
                <label className="flex items-center justify-between cursor-pointer select-none">
                  <span className="text-sm font-medium">Local Presence</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={localPresenceEnabled}
                    onClick={() => setLocalPresenceEnabled((v) => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      localPresenceEnabled ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                        localPresenceEnabled ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCallingSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCallingSettings} disabled={callingSettingsSaving || callingSettingsLoading}>
              {callingSettingsSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
