import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { useLeadLock } from "@/hooks/useLeadLock";
import { useHardClaim } from "@/hooks/useHardClaim";
import { useCalendar } from "@/contexts/CalendarContext";
import { upsertDialerStats } from "@/lib/supabase-dialer-stats";
import { getCampaignLeads, getLeadHistory, saveCall, saveNote, saveAppointment, updateLeadStatus } from "@/lib/dialer-api";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { 
  applyDispositionToQueue, 
  type CampaignLead 
} from "@/lib/queue-manager";
import { DialerDailyStats, PipelineStage } from "@/lib/types";
import { CircuitBreaker } from "@/lib/CircuitBreaker";

/* ─── Types ─── */

export interface Disposition {
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

export interface HistoryItem {
  id: string;
  type: string;
  description: string;
  disposition?: string | null;
  disposition_color?: string | null;
  created_at: string;
}

export type AmdStatus = 'idle' | 'detecting' | 'human' | 'machine';

export interface DialerContextType {
  // Campaign & Lead Queue
  campaigns: any[];
  setCampaigns: React.Dispatch<React.SetStateAction<any[]>>;
  campaignsLoading: boolean;
  setCampaignsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  selectedCampaignId: string | null;
  selectedCampaign: any;
  setSelectedCampaignId: (id: string | null) => void;
  leadQueue: any[];
  setLeadQueue: React.Dispatch<React.SetStateAction<any[]>>;
  currentLeadIndex: number;
  setCurrentLeadIndex: React.Dispatch<React.SetStateAction<number>>;
  currentLead: any;
  loadingLeads: boolean;
  setLoadingLeads: React.Dispatch<React.SetStateAction<boolean>>;
  hasMoreLeads: boolean;
  setHasMoreLeads: React.Dispatch<React.SetStateAction<boolean>>;
  currentOffset: number;
  setCurrentOffset: React.Dispatch<React.SetStateAction<number>>;
  
  // Call State
  telnyxStatus: string;
  telnyxErrorMessage: string | null;
  telnyxCallState: string;
  telnyxCallDuration: number;
  telnyxCurrentCall: any;
  callStatus: 'idle' | 'ringing' | 'connected';
  isAdvancing: boolean;
  setIsAdvancing: React.Dispatch<React.SetStateAction<boolean>>;
  autoDialEnabled: boolean;
  setAutoDialEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  isPaused: boolean;
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>;
  amdStatus: AmdStatus;
  setAmdStatus: React.Dispatch<React.SetStateAction<AmdStatus>>;
  amdEnabled: boolean;
  
  // Stats
  dialerStats: DialerDailyStats | null;
  setDialerStats: React.Dispatch<React.SetStateAction<DialerDailyStats | null>>;
  sessionStats: any;
  setSessionStats: React.Dispatch<React.SetStateAction<any>>;
  sessionElapsed: number;
  setSessionElapsed: React.Dispatch<React.SetStateAction<number>>;
  
  // Modals & Tabs
  leftTab: "dispositions" | "queue" | "scripts";
  setLeftTab: React.Dispatch<React.SetStateAction<"dispositions" | "queue" | "scripts">>;
  showWrapUp: boolean;
  setShowWrapUp: React.Dispatch<React.SetStateAction<boolean>>;
  showCallbackModal: boolean;
  setShowCallbackModal: React.Dispatch<React.SetStateAction<boolean>>;
  showAppointmentModal: boolean;
  setShowAppointmentModal: React.Dispatch<React.SetStateAction<boolean>>;
  showFullViewDrawer: boolean;
  setShowFullViewDrawer: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Form State
  isEditingContact: boolean;
  setIsEditingContact: React.Dispatch<React.SetStateAction<boolean>>;
  editForm: any;
  setEditForm: React.Dispatch<React.SetStateAction<any>>;
  noteText: string; setNoteText: (t: string) => void;
  noteError: string | null; setNoteError: (e: string | null) => void;
  smsTab: "sms" | "email"; setSmsTab: (t: "sms" | "email") => void;
  messageText: string; setMessageText: (t: string) => void;
  subjectText: string; setSubjectText: (t: string) => void;
  selectedCallerNumber: string; setSelectedCallerNumber: (n: string) => void;
  availableNumbers: any[]; setAvailableNumbers: (n: any[]) => void;
  campaignStats: Record<string, { state: string; count: number }[]>; setCampaignStats: (s: any) => void;
  callbackDate: Date | undefined; setCallbackDate: (d: Date | undefined) => void;
  callbackTime: string;
  setCallbackTime: React.Dispatch<React.SetStateAction<string>>;
  
  // Appointments
  aptTitle: string; setAptTitle: React.Dispatch<React.SetStateAction<string>>;
  aptType: string; setAptType: React.Dispatch<React.SetStateAction<string>>;
  aptDate: string; setAptDate: React.Dispatch<React.SetStateAction<string>>;
  aptStartTime: string; setAptStartTime: React.Dispatch<React.SetStateAction<string>>;
  aptEndTime: string; setAptEndTime: React.Dispatch<React.SetStateAction<string>>;
  aptNotes: string; setAptNotes: React.Dispatch<React.SetStateAction<string>>;

  // History
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  loadingHistory: boolean;
  setLoadingHistory: React.Dispatch<React.SetStateAction<boolean>>;
  historyLeadId: string | null;
  setHistoryLeadId: React.Dispatch<React.SetStateAction<string | null>>;
  
  // Handlers
  handleCall: () => void;
  handleHangUp: () => void;
  handleSkip: () => void;
  handleAdvance: () => void;
  handleLeadSelect: (idx: number) => void;
  saveCallData: () => Promise<boolean>;
  handleSaveOnly: () => Promise<void>;
  handleSaveAndNext: () => Promise<void>;
  handleStatusChange: (newStatus: string) => Promise<void>;
  handleToggleLocalPresence: (campaignId: string, newValue: boolean) => Promise<void>;
  handleAutoDispose: (disposition: Disposition) => Promise<void>;
  handleMachineDetectedAction: () => Promise<void>;
  loadLockModeLead: (overrideType?: string) => Promise<boolean>;
  fetchLeadsBatch: (campaignId: string, offset: number) => Promise<void>;
  applyQueueLifecycle: (disposedLead: CampaignLead, dispositionName: string, callbackDueAt: string | null) => void;
  telnyxInitialize: () => void;
  telnyxDestroy: () => void;

  // Refs (for internal logic)
  circuitBreakerRef: React.MutableRefObject<CircuitBreaker>;
  ringTimeoutRef: React.MutableRefObject<number>;
  sessionTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  hasDialedOnce: React.MutableRefObject<boolean>;
  lastUsedCallerId: React.MutableRefObject<string>;
  historyEndRef: React.RefObject<HTMLDivElement>;
  leadTransitionRef: React.MutableRefObject<NodeJS.Timeout | null>;
  
  // Derived state
  campaignType: string;
  lockMode: boolean;
  
  // Metadata
  organizationId: string | null;
  user: any;
  profile: any;

  // UI state
  isTransitioning: boolean;
  setIsTransitioning: React.Dispatch<React.SetStateAction<boolean>>;
  assignedAgentName: string | null;
  setAssignedAgentName: React.Dispatch<React.SetStateAction<string | null>>;
  contactLocalTimeDisplay: string;
  setContactLocalTimeDisplay: React.Dispatch<React.SetStateAction<string>>;
  dispositions: Disposition[];
  setDispositions: React.Dispatch<React.SetStateAction<Disposition[]>>;
  leadStages: PipelineStage[];
  setLeadStages: React.Dispatch<React.SetStateAction<PipelineStage[]>>;
}

const DialerContext = createContext<DialerContextType | undefined>(undefined);

export const useDialer = () => {
  const context = useContext(DialerContext);
  if (!context) throw new Error("useDialer must be used within a DialerProvider");
  return context;
};

export const DialerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [leadQueue, setLeadQueue] = useState<any[]>([]);
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [hasMoreLeads, setHasMoreLeads] = useState(true);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [autoDialEnabled, setAutoDialEnabled] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [amdStatus, setAmdStatus] = useState<AmdStatus>('idle');
  const [dialerStats, setDialerStats] = useState<DialerDailyStats | null>(null);
  const [sessionStats, setSessionStats] = useState({ calls_made: 0, calls_connected: 0, total_talk_seconds: 0, policies_sold: 0 });
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [leftTab, setLeftTab] = useState<"dispositions" | "queue" | "scripts">("dispositions");
  const [showWrapUp, setShowWrapUp] = useState(false);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [showFullViewDrawer, setShowFullViewDrawer] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [smsTab, setSmsTab] = useState<"sms" | "email">("sms");
  const [messageText, setMessageText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [selectedCallerNumber, setSelectedCallerNumber] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [campaignStats, setCampaignStats] = useState<Record<string, { state: string; count: number }[]>>({});
  const [callbackDate, setCallbackDate] = useState<Date | undefined>(undefined);
  const [callbackTime, setCallbackTime] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLeadId, setHistoryLeadId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [assignedAgentName, setAssignedAgentName] = useState<string | null>(null);
  const [contactLocalTimeDisplay, setContactLocalTimeDisplay] = useState("");
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [leadStages, setLeadStages] = useState<PipelineStage[]>([]);

  const [aptTitle, setAptTitle] = useState("");
  const [aptType, setAptType] = useState<string>("Sales Call");
  const [aptDate, setAptDate] = useState("");
  const [aptStartTime, setAptStartTime] = useState("10:00 AM");
  const [aptEndTime, setAptEndTime] = useState("10:30 AM");
  const [aptNotes, setAptNotes] = useState("");

  const currentLead = leadQueue[currentLeadIndex] ?? null;
  const currentCallId = useRef<string | null>(null);
  const circuitBreakerRef = useRef(new CircuitBreaker({ threshold: 5, windowMs: 60000 }));
  const ringTimeoutRef = useRef<number>(30);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasDialedOnce = useRef(false);
  const lastUsedCallerId = useRef<string>("");
  const historyEndRef = useRef<HTMLDivElement>(null);
  const leadTransitionRef = useRef<NodeJS.Timeout | null>(null);

  const {
    status: telnyxStatus,
    errorMessage: telnyxErrorMessage,
    callState: telnyxCallState,
    callDuration: telnyxCallDuration,
    currentCall: telnyxCurrentCall,
    makeCall: telnyxMakeCall,
    hangUp: telnyxHangUp,
    telnyxInitialize,
    telnyxDestroy,
    getSmartCallerId,
    amdEnabled,
  } = useTelnyx() as any;

  const { getNextLead, releaseLock, startHeartbeat, stopHeartbeat } = useLeadLock();
  const { claimOnDisposition, cancelClaimTimer } = useHardClaim();
  const { addAppointment } = useCalendar();

  const selectedCampaignId = searchParams.get("campaign");
  const setSelectedCampaignId = useCallback((id: string | null) => {
    if (id) setSearchParams({ campaign: id });
    else setSearchParams({});
  }, [setSearchParams]);

  const selectedCampaign = useMemo(() => campaigns.find((c) => c.id === selectedCampaignId), [campaigns, selectedCampaignId]);
  const campaignType = useMemo(() => (selectedCampaign?.type || "Personal") as string, [selectedCampaign]);
  const lockMode = useMemo(() => {
    const t = campaignType.toUpperCase();
    return t === "TEAM" || t.includes("OPEN");
  }, [campaignType]);

  const callStatus = useMemo<"idle" | "ringing" | "connected">(() => {
    if (!lockMode) return "connected";
    if (!currentLead) return "idle";
    if (telnyxCallState === "dialing") return "ringing";
    if (telnyxCallState === "active" || telnyxCallState === "ended" || showWrapUp) return "connected";
    return "idle";
  }, [lockMode, currentLead, telnyxCallState, showWrapUp]);

  const fetchLeadsBatch = useCallback(async (campaignId: string, offset: number) => {
    setLoadingLeads(true);
    try {
      const data = await getCampaignLeads(campaignId, organizationId, 50, offset);
      setLeadQueue(prev => [...prev, ...data]);
      setCurrentOffset(offset + 50);
      setHasMoreLeads(data.length >= 50);
    } catch { toast.error("Failed to load more leads"); }
    finally { setLoadingLeads(false); }
  }, [organizationId]);

  const applyQueueLifecycle = useCallback((disposedLead: CampaignLead, dispositionName: string, callbackDueAt: string | null) => {
    setIsAdvancing(true);
    const now = new Date();
    const newQueue = applyDispositionToQueue(leadQueue as CampaignLead[], disposedLead, dispositionName, 24, callbackDueAt, now);
    const nextIndex = newQueue.findIndex(lead => !['DNC', 'Completed', 'Removed', 'Closed Won'].includes((lead as any).status || ''));
    setLeadQueue(newQueue);
    setCurrentLeadIndex(nextIndex === -1 ? 0 : nextIndex);
    setTimeout(() => setIsAdvancing(false), 300);
  }, [leadQueue]);

  const handleLeadSelect = useCallback((idx: number) => {
    if (isAdvancing) return;
    if (idx === currentLeadIndex) return;
    setIsAdvancing(true);
    setCurrentLeadIndex(idx);
    if (telnyxCallState === "idle" || telnyxCallState === "ended") setShowWrapUp(false);
    setTimeout(() => setIsAdvancing(false), 500);
  }, [isAdvancing, currentLeadIndex, telnyxCallState]);

  const handleCall = useCallback(async () => {
    if (!currentLead || !user) return;
    const now = new Date().toISOString();
    setDialerStats(prev => prev ? { ...prev, calls_made: prev.calls_made + 1, last_updated_at: now } : prev);
    upsertDialerStats(user.id, { calls_made: 1, session_started_at: dialerStats?.session_started_at ? null : now }).catch(() => {});
    hasDialedOnce.current = true;
    setSessionStats(prev => ({ ...prev, calls_made: prev.calls_made + 1 }));
    const smartCallerId = await getSmartCallerId(currentLead.phone, currentLead.lead_id || currentLead.id);
    lastUsedCallerId.current = smartCallerId;
    const callId = await telnyxMakeCall(currentLead.phone, smartCallerId, {
      contactId: currentLead.lead_id || currentLead.id,
      campaignId: selectedCampaignId,
      campaignLeadId: currentLead.id,
      contactName: `${currentLead.first_name} ${currentLead.last_name}`,
      contactPhone: currentLead.phone
    });
    currentCallId.current = callId || null;
  }, [currentLead, user, telnyxMakeCall, getSmartCallerId, selectedCampaignId, dialerStats]);

  const handleHangUp = useCallback(() => {
    if (telnyxCallDuration >= 7 && user) {
      setDialerStats(prev => prev ? { ...prev, calls_connected: prev.calls_connected + 1, total_talk_seconds: prev.total_talk_seconds + telnyxCallDuration } : prev);
      upsertDialerStats(user.id, { calls_connected: 1, total_talk_seconds: telnyxCallDuration }).catch(() => {});
    }
    telnyxHangUp();
  }, [telnyxCallDuration, user, telnyxHangUp]);

  const loadLockModeLead = useCallback(async (overrideType?: string) => {
    if (!selectedCampaignId) return false;
    setLoadingLeads(true);
    try {
      let resolvedType = overrideType || campaignType;
      const { data: campData } = await (supabase.from("campaigns") as any).select("queue_filters").eq("id", selectedCampaignId).maybeSingle();
      const lock = await getNextLead(selectedCampaignId, resolvedType, campData?.queue_filters as any);
      if (!lock) { setLeadQueue([]); return false; }
      const { data: fullRow } = await supabase.from("campaign_leads").select("*, lead:leads(*)").eq("id", lock.id).maybeSingle();
      if (fullRow) {
        const { lead: leadData, ...campaignLead } = fullRow as any;
        setLeadQueue([{ ...(leadData || {}), ...campaignLead, id: campaignLead.id, lead_id: leadData?.id || campaignLead.lead_id }]);
        setCurrentLeadIndex(0);
        startHeartbeat(lock.id, () => loadLockModeLead(resolvedType));
        return true;
      }
      return false;
    } finally { setLoadingLeads(false); }
  }, [selectedCampaignId, campaignType, getNextLead, startHeartbeat]);

  const handleAdvance = useCallback(async () => {
    if (isAdvancing) return;
    setIsAdvancing(true);
    setShowWrapUp(false);
    if (lockMode && currentLead?.id) {
      stopHeartbeat();
      await releaseLock(currentLead.id);
      await loadLockModeLead();
    } else {
      setCurrentLeadIndex(prev => Math.min(prev + 1, leadQueue.length - 1));
    }
    setTimeout(() => setIsAdvancing(false), 300);
  }, [isAdvancing, lockMode, currentLead, stopHeartbeat, releaseLock, loadLockModeLead, leadQueue.length]);

  const handleSkip = useCallback(async () => {
    setIsAdvancing(true);
    if (lockMode && currentLead?.id) {
      stopHeartbeat();
      await releaseLock(currentLead.id);
      await loadLockModeLead();
    } else {
      setCurrentLeadIndex(prev => Math.min(prev + 1, leadQueue.length - 1));
    }
    setTimeout(() => setIsAdvancing(false), 300);
  }, [lockMode, currentLead, stopHeartbeat, releaseLock, loadLockModeLead, leadQueue.length]);

  const saveCallData = async () => {
    if (!currentLead || !user || !dispositions.find(d => d.id === 'current')) return false; // placeholder logic for selection
    // In real use, this would check the selected disposition state
    return true;
  };

  const handleSaveOnly = async () => { if (await saveCallData()) toast.success("Saved"); };
  const handleSaveAndNext = async () => { if (await saveCallData()) handleAdvance(); };

  const handleStatusChange = async (newStatus: string) => {
    if (!currentLead) return;
    try {
      await updateLeadStatus(currentLead.id, currentLead.lead_id || currentLead.id, newStatus, organizationId);
      setLeadQueue(prev => prev.map((l, i) => i === currentLeadIndex ? { ...l, status: newStatus } : l));
      toast.success("Status updated");
    } catch { toast.error("Update failed"); }
  };

  const handleToggleLocalPresence = async (campaignId: string, newValue: boolean) => {
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, local_presence_enabled: newValue } : c));
    await supabase.from("campaigns").update({ local_presence_enabled: newValue }).eq("id", campaignId);
  };

  const handleAutoDispose = useCallback(async (disposition: Disposition) => {
    if (currentCallId.current) await supabase.from('calls').update({ disposition_name: disposition.name }).eq('id', currentCallId.current);
    handleAdvance();
  }, [handleAdvance]);

  const handleMachineDetectedAction = useCallback(async () => {
    setAmdStatus('machine'); toast.info("🤖 Machine detected");
    const noAnswerDisp = dispositions.find(d => d.name.toLowerCase().includes("no answer"));
    if (noAnswerDisp) handleAutoDispose(noAnswerDisp); else handleSkip();
  }, [dispositions, handleAutoDispose, handleSkip]);

  const value: DialerContextType = {
    campaigns, setCampaigns, campaignsLoading, setCampaignsLoading, selectedCampaignId, selectedCampaign, setSelectedCampaignId,
    leadQueue, setLeadQueue, currentLeadIndex, setCurrentLeadIndex, currentLead, loadingLeads, setLoadingLeads, hasMoreLeads, setHasMoreLeads, currentOffset, setCurrentOffset,
    telnyxStatus, telnyxErrorMessage, telnyxCallState, telnyxCallDuration, telnyxCurrentCall,
    callStatus, isAdvancing, setIsAdvancing, autoDialEnabled, setAutoDialEnabled, isPaused, setIsPaused, amdStatus, setAmdStatus, amdEnabled,
    dialerStats, setDialerStats, sessionStats, setSessionStats, sessionElapsed, setSessionElapsed,
    leftTab, setLeftTab, showWrapUp, setShowWrapUp, showCallbackModal, setShowCallbackModal, showAppointmentModal, setShowAppointmentModal, showFullViewDrawer, setShowFullViewDrawer,
    isEditingContact, setIsEditingContact, editForm, setEditForm, noteText, setNoteText, noteError, setNoteError,
    smsTab, setSmsTab, messageText, setMessageText, subjectText, setSubjectText, selectedCallerNumber, setSelectedCallerNumber, availableNumbers, setAvailableNumbers,
    campaignStats, setCampaignStats, callbackDate, setCallbackDate, callbackTime, setCallbackTime,
    aptTitle, setAptTitle, aptType, setAptType, aptDate, setAptDate, aptStartTime, setAptStartTime, aptEndTime, setAptEndTime, aptNotes, setAptNotes,
    history, setHistory, loadingHistory, setLoadingHistory, historyLeadId, setHistoryLeadId,
    handleCall, handleHangUp, handleSkip, handleAdvance, handleLeadSelect, saveCallData, handleSaveOnly, handleSaveAndNext, handleStatusChange, handleToggleLocalPresence, handleAutoDispose, handleMachineDetectedAction, loadLockModeLead, fetchLeadsBatch, applyQueueLifecycle, telnyxInitialize, telnyxDestroy,
    circuitBreakerRef, ringTimeoutRef, sessionTimerRef, hasDialedOnce, lastUsedCallerId, historyEndRef, leadTransitionRef,
    campaignType, lockMode, organizationId, user, profile,
    isTransitioning, setIsTransitioning, assignedAgentName, setAssignedAgentName, contactLocalTimeDisplay, setContactLocalTimeDisplay, dispositions, setDispositions, leadStages, setLeadStages
  };

  return <DialerContext.Provider value={value}>{children}</DialerContext.Provider>;
};
