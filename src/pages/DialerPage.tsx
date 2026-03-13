import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDistanceToNow } from "date-fns";
import {
  Phone,
  PhoneOff,
  SkipForward,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { dispositionsSupabaseApi } from "@/lib/supabase-dispositions";
import {
  getCampaigns,
  getCampaignLeads,
  getLeadHistory,
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import ContactModal from "@/components/contacts/ContactModal";
import { useCalendar } from "@/contexts/CalendarContext";
import { leadsSupabaseApi } from "@/lib/supabase-contacts";
import { Lead, PipelineStage } from "@/lib/types";
import { pipelineApi } from "@/lib/mock-api";
import { getContactLocalTime, getContactTimezone } from "@/utils/contactLocalTime";

import DraggableScriptPopup from "@/components/dialer/DraggableScriptPopup";
import { supabase } from "@/integrations/supabase/client";
import { AnimatePresence } from "framer-motion";

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
}

interface HistoryItem {
  id: string;
  type: string;
  description: string;
  disposition?: string | null;
  disposition_color?: string | null;
  created_at: string;
}

/* ─── Helpers ─── */

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
    makeCall: telnyxMakeCall, 
    hangUp: telnyxHangUp 
  } = useTelnyx();

  const [selectedDisp, setSelectedDisp] = useState<Disposition | null>(null);
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
  const [sessionStats, setSessionStats] = useState({
    calls: 0,
    connected: 0,
    talkSeconds: 0,
    callbacks: 0,
  });
  const [smsTab, setSmsTab] = useState<"sms" | "email">("sms");
  const [messageText, setMessageText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  // loadingCampaigns is provided by useQuery below
  const [contactLocalTimeDisplay, setContactLocalTimeDisplay] = useState<string>("");
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const { addAppointment } = useCalendar();
  const [availableScripts, setAvailableScripts] = useState<any[]>([]);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [shouldAdvanceAfterModal, setShouldAdvanceAfterModal] = useState(false);

  const currentLead = leadQueue[currentLeadIndex] ?? null;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  /* --- data loading --- */

  /* --- queries --- */
  
  const { data: campaignsData = [], isLoading: loadingCampaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: getCampaigns,
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
    queryFn: pipelineApi.getLeadStages,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  /* --- effects for syncing query data to state if needed --- */
  // Note: We prefer using the data from useQuery directly, but some effects or 
  // handlers might expect these states. We'll update them via useEffect for compatibility.
  useEffect(() => {
    if (campaignsData.length > 0) setCampaigns(campaignsData);
  }, [campaignsData]);

  useEffect(() => {
    if (dispositionsData.length > 0) setDispositions(dispositionsData);
  }, [dispositionsData]);

  useEffect(() => {
    if (scriptsData.length > 0) setAvailableScripts(scriptsData);
  }, [scriptsData]);

  useEffect(() => {
    if (leadStagesData.length > 0) setLeadStages(leadStagesData);
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
    fetchLeadsBatch(selectedCampaignId, 0, true);
  }, [selectedCampaignId, fetchLeadsBatch]);

  // Load more leads when we get close to the end of the queue
  useEffect(() => {
    if (selectedCampaignId && hasMoreLeads && !loadingLeads && leadQueue.length > 0) {
      if (currentLeadIndex >= leadQueue.length - 10) {
        fetchLeadsBatch(selectedCampaignId, currentOffset);
      }
    }
  }, [currentLeadIndex, leadQueue.length, selectedCampaignId, hasMoreLeads, loadingLeads, currentOffset, fetchLeadsBatch]);

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
    if (historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history]);

  // Trigger wrap-up when call ends
  useEffect(() => {
    if (callState === "ended") {
      setShowWrapUp(true);
    }
  }, [callState]);

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

  /* --- call handlers --- */

  function handleCall() {
    if (!currentLead) {
      toast.error("No lead selected");
      return;
    }
    if (telnyxStatus === "error") {
      toast.error("Dialer error. Please check your settings.");
      return;
    }
    telnyxMakeCall(currentLead.phone);
  }

  function handleHangUp() {
    telnyxHangUp();
  }

  function handleSelectDisposition(d: Disposition) {
    setSelectedDisp(d);
    
    // Reset/Initialize requirements
    if (d.requireNotes) {
      // Keep existing noteText if it was typed, but ensure we show notes tab or indicator
    }
    
    if (d.callbackScheduler) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setCallbackDate(tomorrow);
      setCallbackTime("10:00 AM");
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
        master_lead_id: masterId,
        campaign_lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        duration_seconds: telnyxCallDuration,
        disposition: d.name,
        disposition_color: d.color,
        notes: "",
        outcome: d.name,
      });
    } catch {
      /* ignore */
    }
    setSessionStats((s) => ({ ...s, calls: s.calls + 1 }));
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
        });
        
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
        });
      }

      // 3. Save call record
      await saveCall({
        master_lead_id: masterId,
        campaign_lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        duration_seconds: telnyxCallDuration,
        disposition: selectedDisp?.name || "No Disposition",
        disposition_color: selectedDisp?.color || "#6B7280",
        notes: noteText,
        outcome: selectedDisp?.name || "No Outcome",
      });

      if (noteText.trim()) {
        await saveNote({
          master_lead_id: masterId,
          agent_id: user.id,
          content: noteText,
        });
      }

      // Also update the lead status in both the campaign and master record
      await updateLeadStatus(currentLead.id, masterId, selectedDisp?.name || "Called");
      try {
        await leadsSupabaseApi.update(masterId, { status: (selectedDisp?.name as any) || "Called" });
      } catch (e) {
        console.warn("Master contact record update failed during save", e);
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
        setSessionStats((s) => ({
          ...s,
          calls: s.calls + 1,
          connected: s.connected + 1,
          talkSeconds: s.talkSeconds + telnyxCallDuration,
        }));
        
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
    const toastId = toast.loading("Saving and moving next...");
    try {
      const success = await saveCallData();
      if (success) {
        setShouldAdvanceAfterModal(true);
        toast.success("Call saved, moving to next contact", { id: toastId });
        setSessionStats((s) => ({
          ...s,
          calls: s.calls + 1,
          connected: s.connected + 1,
          talkSeconds: s.talkSeconds + telnyxCallDuration,
          callbacks: selectedDisp?.callbackScheduler ? s.callbacks + 1 : s.callbacks,
        }));
        
        handleAdvance();
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
      await updateLeadStatus(campaignLeadId, masterLeadId, newStatus);
      
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
      });
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

  /* --- computed --- */
  const avgDuration =
    sessionStats.connected > 0
      ? fmtDuration(Math.round(sessionStats.talkSeconds / sessionStats.connected))
      : "0:00";
  const convRate =
    sessionStats.calls > 0
      ? `${Math.round((sessionStats.connected / sessionStats.calls) * 100)}%`
      : "0%";

  /* ─── RENDER ─── */

  // FIX 3: Show campaign selection screen when no campaign selected
  if (selectedCampaignId === null) {
    // Extract unique states from all campaign lead data for badges
    const getStateColors = (state: string): string => {
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
          {loadingCampaigns && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">Loading campaigns…</p>
            </div>
          )}
          {!loadingCampaigns && campaigns.length === 0 && (
            <div className="text-center py-12 bg-card border border-dashed rounded-xl">
              <p className="text-muted-foreground text-sm">No active campaigns found.</p>
              <p className="text-muted-foreground text-xs mt-1">Create a campaign to get started.</p>
            </div>
          )}
          {!loadingCampaigns &&
            campaigns.map((campaign) => {
              const total = campaign.total_leads ?? 0;
              const contacted = campaign.leads_contacted ?? 0;
              const converted = campaign.leads_converted ?? 0;
              const remaining = Math.max(0, total - contacted);
              const contactedPct = total > 0 ? Math.round((contacted / total) * 100) : 0;
              const convertedPct = total > 0 ? Math.round((converted / total) * 100) : 0;

              // Parse tags as states if they look like state abbreviations
              const tags: string[] = Array.isArray(campaign.tags)
                ? campaign.tags
                : typeof campaign.tags === "string"
                  ? JSON.parse(campaign.tags || "[]")
                  : [];
              const states = tags.filter((t: string) => /^[A-Z]{2}$/.test(t));

              // Mock data overrides for demonstration as requested
              const isMockActive = true;
              const mockAvgCall = "3:24";
              const mockStates = [
                { state: "FL", count: 34, color: "#2563eb", bg: "rgba(59, 130, 246, 0.1)", border: "rgba(59, 130, 246, 0.3)" },
                { state: "TX", count: 28, color: "#dc2626", bg: "rgba(239, 68, 68, 0.1)", border: "rgba(239, 68, 68, 0.3)" },
                { state: "CA", count: 23, color: "#d97706", bg: "rgba(245, 158, 11, 0.1)", border: "rgba(245, 158, 11, 0.3)" },
                { state: "NY", count: 18, color: "#9333ea", bg: "rgba(168, 85, 247, 0.1)", border: "rgba(168, 85, 247, 0.3)" },
                { state: "OH", count: 12, color: "#16a34a", bg: "rgba(34, 197, 94, 0.1)", border: "rgba(34, 197, 94, 0.3)" },
                { state: "WA", count: 8, color: "", bg: "", border: "" },
                { state: "AZ", count: 6, color: "", bg: "", border: "" }
              ];
              const mockCallsMade = 89;
              const mockConnected = 37;
              const mockTotalLeads = 200;
              const mockConnectRate = "42%";

              return (
                <div
                  key={campaign.id}
                  className="bg-card border border-border rounded-xl flex flex-col hover:border-primary/50 hover:shadow-lg transition-all group overflow-hidden"
                >
                  <div className="p-5 flex-1 flex flex-col" onClick={() => setSelectedCampaignId(campaign.id)}>
                    
                    {/* Campaign Name Row */}
                    <div className="mb-4 flex items-start justify-between gap-2">
                      <h3 className="font-bold text-xl text-foreground leading-tight line-clamp-2">
                        {campaign.name}
                      </h3>
                      <button className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0" onClick={e => e.stopPropagation()}>
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Mini Stats Row */}
                    <div className="flex items-center gap-2 mb-4">
                      <div className="flex items-center gap-1.5 bg-accent/50 rounded px-2 py-1">
                        <TrendingUp className="w-3 h-3 text-success" />
                        <span className="text-xs font-medium text-foreground">Connect Rate: {mockConnectRate}</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-accent/50 rounded px-2 py-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-medium text-foreground">Avg Call: {mockAvgCall}</span>
                      </div>
                    </div>

                    {/* States Badges */}
                    <div className="mb-5">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">States</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {mockStates.map(s => {
                          return (
                            <span 
                              key={s.state} 
                              className="flex items-center justify-center text-[10px] px-1 py-0.5 rounded-md font-medium transition-all bg-blue-500/10 text-blue-500 border border-blue-500/20"
                            >
                              {s.state} ({s.count})
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Progress Bar & Details */}
                    <div className="mt-auto space-y-2">
                      <p className="text-xs text-muted-foreground font-medium">Campaign Progress</p>
                      <p className="text-xs text-foreground mb-1.5 font-medium">
                        {mockCallsMade}/{mockTotalLeads} calls made
                      </p>
                      
                      {/* Dual Layer Progress Bar Container */}
                      <div className="relative w-full h-3 bg-accent rounded-full isolate">
                        {/* Bottom Layer (Total Calls) */}
                        <div 
                          className="absolute top-0 left-0 h-full bg-primary/30 rounded-full transition-all duration-500"
                          style={{ width: `44%` }}
                        />
                        {/* Top Layer (Connections) */}
                        <div 
                          className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all duration-500 z-0"
                          style={{ width: `18.5%` }}
                        />
                        {/* Milestone Tick Marks placed over everything */}
                        <div className="absolute top-1/2 left-[25%] -translate-y-1/2 w-px h-4 bg-border z-10" />
                        <div className="absolute top-1/2 left-[50%] -translate-y-1/2 w-px h-4 bg-border z-10" />
                        <div className="absolute top-1/2 left-[75%] -translate-y-1/2 w-px h-4 bg-border z-10" />
                      </div>
                      
                      <div className="pt-2 flex">
                        <p className="font-mono text-sm font-semibold text-foreground">
                          {campaign.total_leads ? Math.max(0, campaign.total_leads - mockCallsMade) : remaining} remaining
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCampaignId(campaign.id);
                    }}
                    className="w-full bg-accent/30 text-accent-foreground py-3.5 text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors outline-none flex items-center justify-center gap-2 border-t border-border group-hover:border-transparent cursor-pointer"
                  >
                    <Phone className="w-4 h-4" /> Start Dialing This List
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  // Only render dialer UI when campaign is selected and leads exist
  if (leadQueue.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background text-foreground items-center justify-center p-6">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Loading lead queue…</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-80px)] lg:h-[calc(100vh-88px)] -mb-4 lg:-mb-6 overflow-hidden bg-background text-foreground">
      {/* ── TOP CONTROL BAR ── */}
      <div className="flex items-center border-b px-4 pt-1 pb-2 gap-4">
        {/* LEFT */}
        <button 
          onClick={() => {
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
          {[
            { label: "Calls", value: sessionStats.calls },
            { label: "Connected", value: sessionStats.connected },
            { label: "Avg Duration", value: avgDuration },
            { label: "Talk Time", value: fmtDuration(sessionStats.talkSeconds) },
            { label: "Conv Rate", value: convRate },
            { label: "Callbacks", value: sessionStats.callbacks },
          ].map((s) => (
            <div 
              key={s.label} 
              className="flex flex-col items-center px-4 py-1.5 bg-accent/30 border border-border/50 rounded-xl min-w-[80px] transition-all hover:bg-accent/50"
            >
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">{s.label}</div>
              <div className="text-xs font-bold font-mono text-foreground">{s.value}</div>
            </div>
          ))}
        </div>

        {/* RIGHT */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success inline-block" />
            <span className="text-success text-xs font-semibold">Dialer Ready</span>
          </div>
          <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded-full">
            {selectedCampaign?.name ?? "No Campaign"}
          </span>
        </div>
      </div>

      {/* ── COLUMNS ── */}
      <div className="flex flex-1 overflow-hidden p-3 gap-3">
        {/* ── NEW LEFT COLUMN (Contact Info) ── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden">
          <div className="bg-card border rounded-xl flex flex-col overflow-hidden h-full">
            {/* Header section — shrink-0 */}
            <div className="p-4 border-b flex flex-col gap-4 bg-card shrink-0">
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
                  <div className="flex flex-col gap-2">
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
                    'custom_fields', 'lead'
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
              <select className="bg-accent border border-border text-xs text-foreground rounded-lg px-2 py-1 h-7">
                <option>+19097381193</option>
              </select>
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
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
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
                <button className="bg-accent text-muted-foreground border border-border rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/80 transition-colors">
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
                    {leadQueue.length === 0 ? (
                      <div className="text-center py-8">
                        <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
                        <p className="text-sm text-muted-foreground">Queue is empty</p>
                      </div>
                    ) : (
                      leadQueue.map((lead, idx) => (
                        <div
                          key={lead.id}
                          onClick={() => setCurrentLeadIndex(idx)}
                          className={`p-3 rounded-lg border flex items-center gap-3 cursor-pointer transition-all ${
                            idx === currentLeadIndex
                              ? "bg-primary/10 border-primary ring-1 ring-primary/20"
                              : idx < currentLeadIndex
                              ? "opacity-50 grayscale bg-muted/30 border-transparent"
                              : "bg-card hover:bg-accent/50 border-border"
                          }`}
                        >
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              idx === currentLeadIndex
                                ? "bg-primary animate-pulse"
                                : idx < currentLeadIndex
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
                          </div>
                          {idx === currentLeadIndex && (
                            <div className="text-[9px] font-black uppercase text-primary tracking-widest">
                              Now
                            </div>
                          )}
                        </div>
                      ))
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
                    Save & Next
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
            }).catch(() => {});
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
    </>
  );
}
