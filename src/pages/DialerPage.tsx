import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
  const [sessionStats, setSessionStats] = useState({
    calls: 0,
    connected: 0,
    talkSeconds: 0,
    callbacks: 0,
  });
  const [smsTab, setSmsTab] = useState<"sms" | "email">("sms");
  const [messageText, setMessageText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [contactLocalTimeDisplay, setContactLocalTimeDisplay] = useState<string>("");
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { user } = useAuth();
  const { addAppointment } = useCalendar();
  const [availableScripts, setAvailableScripts] = useState<any[]>([]);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);

  const currentLead = leadQueue[currentLeadIndex] ?? null;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  /* --- data loading --- */

  useEffect(() => {
    setLoadingCampaigns(true);
    getCampaigns()
      .then(setCampaigns)
      .catch(() => toast.error("Failed to load campaigns"))
      .finally(() => setLoadingCampaigns(false));
    dispositionsSupabaseApi
      .getAll()
      .then((ds) =>
        setDispositions(
          ds.map((d) => ({
            id: d.id,
            name: d.name,
            color: d.color,
            requireNotes: d.requireNotes,
            minNoteChars: d.minNoteChars,
            callbackScheduler: d.callbackScheduler,
            appointmentScheduler: d.appointmentScheduler,
            automationTrigger: d.automationTrigger,
            automationName: d.automationName,
          })),
        ),
      )
      .catch(() => toast.error("Failed to load dispositions"));

    // Fetch active scripts
    supabase
      .from("call_scripts")
      .select("*")
      .eq("active", true)
      .then(({ data, error }) => {
        if (!error && data) setAvailableScripts(data);
      });
    
    // Fetch lead stages
    pipelineApi.getLeadStages()
      .then(setLeadStages)
      .catch((err) => console.error("Error fetching lead stages:", err));
  }, []);

  useEffect(() => {
    if (!selectedCampaignId) return;
    getCampaignLeads(selectedCampaignId)
      .then((leads) => {
        setLeadQueue(leads);
        setCurrentLeadIndex(0);
      })
      .catch(() => toast.error("Failed to load leads"));
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!currentLead) return;
    setLoadingHistory(true);
    getLeadHistory(currentLead.id)
      .then(setHistory)
      .catch(() => toast.error("Failed to load history"))
      .finally(() => setLoadingHistory(false));
  }, [currentLead]);

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

  const handleSaveAndContinue = async () => {
    if (!currentLead || !user) return;
    if (selectedDisp?.requireNotes && noteText.length < selectedDisp.minNoteChars) {
      setNoteError(true);
      return;
    }

    try {
      const masterId = currentLead.lead_id || currentLead.id;
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

      toast.success("Call saved successfully");

      // Handle Automation Trigger
      if (selectedDisp?.automationTrigger && selectedDisp.automationName) {
        toast.info(`Automation Triggered: ${selectedDisp.automationName}`);
      }
    } catch {
      toast.error("Failed to save call");
    }

    setSessionStats((s) => ({
      ...s,
      calls: s.calls + 1,
      connected: s.connected + 1,
      talkSeconds: s.talkSeconds + telnyxCallDuration,
    }));

    // Logic for next step popups
    if (selectedDisp?.appointmentScheduler) {
      setShowAppointmentModal(true);
    } else if (selectedDisp?.callbackScheduler) {
      setSessionStats((s) => ({ ...s, callbacks: s.callbacks + 1 }));
      setShowCallbackModal(true);
    } else {
      handleAdvance();
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
    setCurrentLeadIndex((i) => i + 1);
  }

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
    handleAdvance();
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
    <div className="flex flex-col h-full bg-background text-foreground">
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
                    <button 
                      onClick={() => setShowFullViewDrawer(true)}
                      className="p-1 px-1.5 text-primary hover:bg-primary/10 rounded transition-colors"
                      title="Edit Contact"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {currentLead && (
                <div className="flex flex-col gap-1 mt-2">
                  <h2 className="text-xl font-bold text-foreground tracking-tight text-center">
                    {`${currentLead.first_name ?? ""} ${currentLead.last_name ?? ""}`.trim()}
                  </h2>
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
                  { label: "Phone", value: currentLead?.phone },
                  { label: "Email", value: currentLead?.email },
                  { label: "State", value: currentLead?.state },
                  { label: "Age", value: currentLead?.age },
                  { label: "DOB", value: currentLead?.date_of_birth },
                  { label: "Health", value: currentLead?.health_status },
                  { label: "Best Time", value: currentLead?.best_time_to_call },
                  { label: "Spouse", value: currentLead?.spouse_info },
                  { label: "Score", value: currentLead?.lead_score },
                  { label: "Source", value: currentLead?.source },
                ].map((f) => (
                  <div key={f.label} className="min-w-0">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{f.label}</div>
                    <div className="text-sm font-semibold text-foreground mt-0.5 truncate">{f.value || "—"}</div>
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
                        <div className="text-sm font-semibold text-foreground mt-0.5">{String(cval) || "—"}</div>
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

        {/* ── RIGHT COLUMN (Original Left) ── */}
        <div className="w-80 shrink-0 flex flex-col overflow-hidden">
          <div className="flex flex-col flex-1 overflow-y-auto pr-1 gap-3 custom-scrollbar">
            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2 shrink-0">
              {callState === "active" || callState === "dialing" ? (
                <button
                  onClick={handleHangUp}
                  className="bg-destructive text-destructive-foreground rounded-xl py-2 flex flex-col items-center gap-1 text-sm font-semibold transition-all hover:bg-destructive/90"
                >
                  <PhoneOff className="w-4.5 h-4.5" />
                  Hang Up
                  <span className="font-mono text-[10px]">{fmtDuration(telnyxCallDuration)}</span>
                </button>
              ) : (
                <button
                  onClick={handleCall}
                  className="bg-success text-success-foreground rounded-xl py-2 flex flex-col items-center gap-1 text-sm font-semibold transition-all hover:bg-success/90"
                >
                  <Phone className="w-4.5 h-4.5" />
                  Call
                </button>
              )}
              <button
                onClick={handleSkip}
                className="bg-accent text-muted-foreground border border-border rounded-xl py-2 flex flex-col items-center gap-1 text-sm font-semibold transition-all hover:bg-accent/80"
              >
                <ArrowRight className="w-4.5 h-4.5" />
                Skip
              </button>
            </div>

            {/* Tabs for right sidebar */}
            <div className="bg-card border rounded-xl overflow-hidden flex flex-col flex-1 min-h-0">
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
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1.5 block">
                        Select Disposition
                      </label>
                      <div className="relative">
                        <select
                          value={selectedDisp?.id || ""}
                          onChange={(e) => {
                            const d = dispositions.find((ds) => ds.id === e.target.value);
                            if (d) handleSelectDisposition(d);
                          }}
                          className={`w-full h-10 px-3 rounded-lg bg-card border border-border text-sm appearance-none focus:ring-2 focus:ring-primary/50 cursor-pointer ${
                            !selectedDisp ? "text-muted-foreground" : "text-foreground font-medium"
                          }`}
                        >
                          <option value="">Select an outcome...</option>
                          {dispositions.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                          Call Notes
                        </label>
                        {selectedDisp?.requireNotes && (
                          <span className="text-[9px] text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-full">
                            Required {selectedDisp.minNoteChars > 0 ? `(${selectedDisp.minNoteChars} chars)` : ""}
                          </span>
                        )}
                      </div>
                      <textarea
                        value={noteText}
                        onChange={(e) => {
                          setNoteText(e.target.value);
                          if (noteError && e.target.value.length >= (selectedDisp?.minNoteChars || 0)) {
                            setNoteError(false);
                          }
                        }}
                        placeholder="Type notes about the call..."
                        className={`w-full bg-card border rounded-lg p-3 text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/50 min-h-[140px] resize-none transition-all ${
                          noteError ? "border-destructive ring-1 ring-destructive" : "border-border"
                        }`}
                      />
                    </div>

                    <button
                      onClick={handleSaveAndContinue}
                      className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2 mt-2"
                    >
                      Save & Continue
                      <ArrowRight className="w-4 h-4" />
                    </button>
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
            </div>
          </div>
        </div>
      </div>

      {/* ── CALLBACK MODAL ── */}
      <Dialog
        open={showCallbackModal}
        onOpenChange={(open) => {
          if (!open) handleAdvance();
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
                handleAdvance();
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
        onClose={() => handleAdvance()}
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
          handleAdvance();
        }}
        prefillContactName={currentLead ? `${currentLead.first_name} ${currentLead.last_name}` : ""}
        prefillContactId={currentLead?.id}
      />

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
    </div>
  );
}
