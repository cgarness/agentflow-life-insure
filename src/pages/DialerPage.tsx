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
import { Lead } from "@/lib/types";
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
  return {
    id: row.id,
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
        if (error) {
          console.error("Error fetching scripts:", error);
        } else {
          setAvailableScripts(data || []);
        }
      });
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
      await saveCall({
        lead_id: currentLead.id,
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

  async function handleSaveAndContinue() {
    if (!selectedDisp || !currentLead || !user) return;
    if (selectedDisp.requireNotes && noteText.trim().length < selectedDisp.minNoteChars) {
      setNoteError(true);
      toast.error(`Please add a note of at least ${selectedDisp.minNoteChars} characters`);
      return;
    }
    setNoteError(false);
    try {
      await saveCall({
        lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        duration_seconds: telnyxCallDuration,
        disposition: selectedDisp.name,
        disposition_color: selectedDisp.color,
        notes: noteText,
        outcome: selectedDisp.name,
      });
      if (noteText.trim().length > 0) {
        await saveNote({
          lead_id: currentLead.id,
          agent_id: user.id,
          content: noteText,
        });
      }
    } catch {
      /* ignore */
    }
    setSessionStats((s) => ({
      ...s,
      calls: s.calls + 1,
      connected: s.connected + 1,
      talkSeconds: s.talkSeconds + telnyxCallDuration,
    }));
    if (selectedDisp.callbackScheduler) {
      setSessionStats((s) => ({ ...s, callbacks: s.callbacks + 1 }));
      setShowCallbackModal(true);
    } else {
      handleAdvance();
    }
  }

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
      await saveAppointment({
        lead_id: currentLead.id,
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
        <div className="w-72 shrink-0 flex flex-col gap-3">
          <div className="bg-card border rounded-xl p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Contact Info</span>
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => setShowFullViewDrawer(true)}
                  className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors border border-primary/20"
                  title="Full View"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => setShowFullViewDrawer(true)} // Currently both open the same "Full View" modal
                  className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors border border-primary/20"
                  title="Edit Contact"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {contactLocalTimeDisplay && (
              <div className="inline-flex items-center bg-green-500/10 text-green-500 rounded-full px-2 py-0.5 text-[10px] font-bold self-start border border-green-500/20">
                <Clock className="w-3 h-3 mr-1" />
                {contactLocalTimeDisplay}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  label: "Name",
                  value: currentLead
                    ? `${currentLead.first_name ?? ""} ${currentLead.last_name ?? ""}`.trim()
                    : null,
                },
                { label: "Phone", value: currentLead?.phone },
                { label: "Email", value: currentLead?.email },
                { label: "State", value: currentLead?.state },
                { label: "Age", value: currentLead?.age },
                { label: "Source", value: currentLead?.source },
              ].map((f) => (
                <div key={f.label} className="min-w-0">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{f.label}</div>
                  <div className="text-sm font-semibold text-foreground mt-0.5 truncate">{f.value || "—"}</div>
                </div>
              ))}
            </div>
            
            <div className="pt-2 border-t mt-1">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Status / Assigned</div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs bg-accent px-2 py-1 rounded-md font-medium">{currentLead?.status || "—"}</span>
                <span className="text-xs text-muted-foreground truncate">{currentLead?.claimed_by || "—"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── CENTER COLUMN (Conversation History) ── */}
        <div className="flex-[1.5] flex flex-col gap-3 overflow-hidden min-h-0">
          <div className="flex flex-col overflow-hidden bg-card border rounded-xl" style={{ flex: 1, minHeight: 0 }}>
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
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3" style={{ minHeight: 0 }}>
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

          {/* SMS composer — shrink-0 */}
          <div className="shrink-0 bg-card border rounded-xl flex flex-col mt-2">
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
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-hidden">
          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            {callState === "active" || callState === "dialing" ? (
              <button
                onClick={handleHangUp}
                className="bg-destructive text-destructive-foreground rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
              >
                <PhoneOff className="w-5 h-5" />
                Hang Up
                <span className="font-mono text-xs">{fmtDuration(telnyxCallDuration)}</span>
              </button>
            ) : (
              <button
                onClick={handleCall}
                className="bg-success text-success-foreground rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
              >
                <Phone className="w-5 h-5" />
                Call
              </button>
            )}
            <button
              onClick={handleSkip}
              className="bg-accent border rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
            >
              <SkipForward className="w-5 h-5" />
              Skip
            </button>
          </div>

          {/* Tab bar */}
          <div className="shrink-0 border rounded-lg overflow-hidden flex">
            {(["dispositions", "queue", "scripts"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                className={`flex-1 py-2 text-sm font-semibold capitalize ${
                  leftTab === tab ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {leftTab === "dispositions" && (
              <div className="flex flex-col gap-4">
                {/* Disposition Select */}
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-bold">
                    Call Result
                  </div>
                  <select
                    value={selectedDisp?.id || ""}
                    onChange={(e) => {
                      const d = dispositions.find(disp => disp.id === e.target.value);
                      if (d) handleSelectDisposition(d);
                    }}
                    className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/50 outline-none h-11"
                  >
                    <option value="" disabled>Select a disposition...</option>
                    {dispositions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Notes and Save Button */}
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 font-bold">
                    Call Notes
                  </div>
                  <textarea
                    value={noteText}
                    onChange={(e) => {
                      setNoteText(e.target.value);
                      setNoteError(false);
                    }}
                    placeholder="Brief summary of the conversation..."
                    className={`bg-accent border rounded-lg p-3 text-sm text-foreground w-full resize-none h-32 focus:ring-2 focus:ring-primary/50 outline-none transition-all ${
                      noteError ? "border-destructive ring-1 ring-destructive" : "border-border"
                    }`}
                  />
                  {selectedDisp?.requireNotes && selectedDisp.minNoteChars > 0 && (
                    <div className="text-[10px] flex justify-between px-1">
                      <span className={noteText.length < selectedDisp.minNoteChars ? "text-destructive font-medium" : "text-success font-medium"}>
                        {noteText.length} / {selectedDisp.minNoteChars} characters min
                      </span>
                      {noteError && <span className="text-destructive font-bold">Required</span>}
                    </div>
                  )}
                  <button
                    onClick={handleSaveAndContinue}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full rounded-xl py-3.5 text-sm font-bold mt-2 shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
                  >
                    Save Disposition & Continue
                  </button>
                </div>
              </div>
            )}

            {leftTab === "queue" && (
              <div className="flex flex-col">
                {leadQueue.map((lead, i) => (
                  <div
                    key={lead.id}
                    className={`bg-card border rounded-lg p-3 mb-2 ${
                      i === currentLeadIndex ? "bg-primary/10 border-primary/30" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-foreground">
                        {lead.first_name} {lead.last_name}
                      </span>
                      {i === currentLeadIndex && (
                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {lead.state && (
                        <span className="bg-accent border rounded px-1.5 py-0.5">{lead.state}</span>
                      )}
                      {lead.age && <span>Age {lead.age}</span>}
                      {lead.source && <span>{lead.source}</span>}
                    </div>
                  </div>
                ))}
                {leadQueue.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-6">No leads in queue</p>
                )}
              </div>
            )}

            {leftTab === "scripts" && (
              <div className="flex flex-col gap-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1 px-1">
                  Active Scripts
                </div>
                {availableScripts.length === 0 ? (
                  <div className="text-center py-8 bg-accent/30 rounded-xl border border-dashed border-border">
                    <FileText className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No active scripts found</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {availableScripts.map((script) => (
                      <button
                        key={script.id}
                        onClick={() => setActiveScriptId(script.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                          activeScriptId === script.id
                            ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20"
                            : "bg-card border-border hover:border-primary/40 hover:bg-accent/50"
                        )}
                      >
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                          activeScriptId === script.id ? "bg-primary/20 text-primary" : "bg-accent text-muted-foreground"
                        )}>
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-foreground truncate">{script.name}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-tight">{script.product_type || "General"}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── CALLBACK MODAL ── */}
      <Dialog
        open={showCallbackModal}
        onOpenChange={(open) => {
          if (!open) setShowCallbackModal(false);
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
        onClose={() => setShowAppointmentModal(false)}
        onSave={(data) => {
          addAppointment(data);
          if (currentLead && user && selectedCampaignId) {
            saveAppointment({
              lead_id: currentLead.id,
              agent_id: user.id,
              campaign_id: selectedCampaignId,
              title: data.title,
              date: format(data.date, "yyyy-MM-dd"),
              time: data.startTime,
              end_time: data.endTime,
              notes: data.notes,
            }).catch(() => {});
          }
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
            // Refresh local queue state
            setLeadQueue(prev => prev.map(l => l.id === id ? { ...l, ...data, 
              // Map back to snake_case for local state consistency if needed
              first_name: data.firstName ?? l.first_name,
              last_name: data.lastName ?? l.last_name,
              phone: data.phone ?? l.phone,
              email: data.email ?? l.email,
              state: data.state ?? l.state,
              status: data.status ?? l.status,
              source: data.leadSource ?? l.source,
              lead_score: data.leadScore ?? l.lead_score,
            } : l));
            toast.success("Contact updated");
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
