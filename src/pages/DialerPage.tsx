import React, { useState, useEffect, useRef } from "react";
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
import { makeCall, hangUp } from "@/lib/telnyx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";

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

/* ─── Component ─── */

export default function DialerPage() {
  /* --- state --- */
  const [campaigns, setCampaigns] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [leadQueue, setLeadQueue] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [leftTab, setLeftTab] = useState<"dispositions" | "queue" | "scripts">("dispositions");
  const [onCall, setOnCall] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [activeCall, setActiveCall] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [selectedDisp, setSelectedDisp] = useState<Disposition | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [showWrapUp, setShowWrapUp] = useState(false);
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showFullViewDrawer, setShowFullViewDrawer] = useState(false);
  const [callbackDate, setCallbackDate] = useState<Date | undefined>(undefined);
  const [callbackTime, setCallbackTime] = useState("");
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleEndTime, setScheduleEndTime] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
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
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { user } = useAuth();

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

  // cleanup call timer on unmount
  useEffect(() => {
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
    };
  }, []);

  /* --- keyboard shortcuts --- */

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!showWrapUp || onCall) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && dispositions[num - 1]) {
        handleSelectDisposition(dispositions[num - 1]);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWrapUp, onCall, dispositions]);

  /* --- call handlers --- */

  function handleCall() {
    if (!currentLead) {
      toast.error("No lead selected");
      return;
    }
    if (!import.meta.env.VITE_TELNYX_SIP_USERNAME) {
      toast.warning(
        "Telnyx credentials not configured — add VITE_TELNYX_SIP_USERNAME and VITE_TELNYX_SIP_PASSWORD to your .env file",
      );
      return;
    }
    makeCall(currentLead.phone, "+19097381193")
      .then((call) => {
        setActiveCall(call);
        setOnCall(true);
        setCallSeconds(0);
        callTimerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
      })
      .catch((err: Error) => toast.error(err.message));
  }

  function handleHangUp() {
    if (activeCall) hangUp(activeCall);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    setOnCall(false);
    setActiveCall(null);
    setShowWrapUp(true);
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
        duration_seconds: callSeconds,
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
        duration_seconds: callSeconds,
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
      talkSeconds: s.talkSeconds + callSeconds,
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

  async function handleSaveSchedule() {
    if (!currentLead || !user || !scheduleDate) return;
    try {
      await saveAppointment({
        lead_id: currentLead.id,
        agent_id: user.id,
        campaign_id: selectedCampaignId!,
        title: "Appointment",
        date: format(scheduleDate, "yyyy-MM-dd"),
        time: scheduleTime,
        end_time: scheduleEndTime,
        notes: scheduleNotes,
      });
      toast.success("Appointment saved");
    } catch {
      /* ignore */
    }
    setShowScheduleModal(false);
    setScheduleDate(undefined);
    setScheduleTime("");
    setScheduleEndTime("");
    setScheduleNotes("");
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
                    <div className="mb-4">
                      <h3 className="font-bold text-xl text-foreground leading-tight line-clamp-2">
                        {campaign.name}
                      </h3>
                    </div>

                    {/* Meta/Status Row */}
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Health Indicator */}
                        <div className={cn("w-2 h-2 rounded-full shrink-0", isMockActive ? "bg-success animate-pulse" : campaign.status === "Paused" ? "bg-warning" : "bg-muted-foreground")} />
                        
                        {/* Type Badge */}
                        <span className="shrink-0 bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          Power Dialer
                        </span>
                        
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                      
                      {/* Action Icons */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button className="p-1 text-muted-foreground hover:text-foreground transition-colors" onClick={e => e.stopPropagation()}>
                          <BarChart3 className="w-4 h-4" />
                        </button>
                        <button className="p-1 text-muted-foreground hover:text-foreground transition-colors" onClick={e => e.stopPropagation()}>
                          <Settings className="w-4 h-4" />
                        </button>
                      </div>
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
                      <div className="flex flex-wrap gap-1.5">
                        {mockStates.slice(0, 5).map(s => {
                          const outsideHours = s.state === "FL" || s.state === "NY";
                          return (
                            <span 
                              key={s.state} 
                              className={cn(
                                "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-all",
                                outsideHours && "opacity-50 grayscale"
                              )}
                              style={outsideHours ? { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' } : {
                                backgroundColor: s.bg,
                                color: s.color,
                                border: s.border
                              }}
                            >
                              {outsideHours && <Clock className="w-3 h-3" />}
                              {s.state} ({s.count})
                            </span>
                          );
                        })}
                        {mockStates.length > 5 && (
                          <span className="bg-muted text-muted-foreground border border-border/50 px-2 py-0.5 rounded-full text-xs font-medium cursor-help" title={mockStates.slice(5).map(s => s.state).join(', ')}>
                            +{mockStates.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar & Details */}
                    <div className="mt-auto space-y-2">
                      <p className="text-xs text-muted-foreground font-medium">Campaign Progress</p>
                      <p className="text-xs text-foreground mb-1.5 font-medium">
                        {mockCallsMade}/{mockTotalLeads} calls made · {mockConnected} connected ({mockConnectRate})
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
      <div className="flex items-center border-b px-4 py-2 gap-4">
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

        {/* CENTER-LEFT: inline stats */}
        <div className="flex items-center flex-1">
          {[
            { label: "Calls", value: sessionStats.calls },
            { label: "Connected", value: sessionStats.connected },
            { label: "Avg Duration", value: avgDuration },
            { label: "Talk Time", value: fmtDuration(sessionStats.talkSeconds) },
            { label: "Conv Rate", value: convRate },
            { label: "Callbacks", value: sessionStats.callbacks },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center px-3 border-r border-border last:border-0">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
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
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT COLUMN ── */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-hidden p-3 border-r">
          {/* FIX 5: Campaign selector removed — campaign is selected on the selection screen */}

          {/* Action buttons */}
          <div className="grid grid-cols-4 gap-2">
            {onCall ? (
              <button
                onClick={handleHangUp}
                className="bg-destructive text-destructive-foreground rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
              >
                <PhoneOff className="w-5 h-5" />
                Hang Up
                <span className="font-mono text-xs">{fmtDuration(callSeconds)}</span>
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
            {/* FIX 6: Schedule button — light purple */}
            <button
              onClick={() => setShowScheduleModal(true)}
              className="rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
              style={{
                backgroundColor: '#7C3AED1A',
                color: '#7C3AED',
                border: '1px solid #7C3AED40',
              }}
            >
              <CalendarIcon className="w-5 h-5" />
              Schedule
            </button>
            {/* FIX 7: Full View button — blue */}
            <button
              onClick={() => setShowFullViewDrawer(true)}
              className="rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
              style={{
                backgroundColor: '#1D4ED81A',
                color: '#3B82F6',
                border: '1px solid #3B82F640',
              }}
            >
              <Eye className="w-5 h-5" />
              Full View
            </button>
          </div>

          {/* Tab bar */}
          <div className="border rounded-lg overflow-hidden flex">
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
            {/* FIX 4: Dispositions tab — mini-card + disposition grid + Quick Notes */}
            {leftTab === "dispositions" && (
              <div className="flex flex-col gap-3">
                {/* Mini-card */}
                {currentLead && (
                  <div className="bg-card border rounded-lg p-3">
                    <div className="font-bold text-sm text-foreground">
                      {currentLead.first_name} {currentLead.last_name}
                    </div>
                    <div className="font-mono text-muted-foreground text-xs">{currentLead.phone}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {currentLead.state && (
                        <span className="bg-accent border rounded px-1.5 py-0.5">{currentLead.state}</span>
                      )}
                      {currentLead.age && <span>Age {currentLead.age}</span>}
                    </div>
                  </div>
                )}

                {/* Disposition grid — always visible */}
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">
                    Select Disposition
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {dispositions.map((d, i) => {
                      const isSelected = selectedDisp?.id === d.id;
                      return (
                        <button
                          key={d.id}
                          onClick={() => handleSelectDisposition(d)}
                          className={`rounded-lg px-2 py-2 text-left w-full flex items-center gap-2 cursor-pointer ${
                            isSelected ? "" : "bg-accent border border-border"
                          }`}
                          style={
                            isSelected
                              ? {
                                  backgroundColor: d.color + "22",
                                  border: "1.5px solid " + d.color,
                                }
                              : undefined
                          }
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: d.color }}
                          />
                          <span
                            className="text-xs font-semibold"
                            style={{ color: isSelected ? d.color : undefined }}
                          >
                            {d.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{i + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Notes section — only when showWrapUp */}
                {showWrapUp && (
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                      Quick Notes
                    </div>
                    <textarea
                      value={noteText}
                      onChange={(e) => {
                        setNoteText(e.target.value);
                        setNoteError(false);
                      }}
                      placeholder="Add notes…"
                      className={`bg-accent border rounded-lg p-2 text-sm text-foreground w-full resize-none h-20 ${
                        noteError ? "border-destructive" : "border-border"
                      }`}
                    />
                    {selectedDisp?.requireNotes && selectedDisp.minNoteChars > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        {noteText.length} / {selectedDisp.minNoteChars} min
                      </div>
                    )}
                    <button
                      onClick={handleSaveAndContinue}
                      className="bg-primary text-primary-foreground w-full rounded-lg py-2 text-sm font-semibold mt-1"
                    >
                      Save &amp; Continue
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* FIX 4: Queue tab — maps over leadQueue */}
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

            {/* Scripts tab */}
            {leftTab === "scripts" && (
              <div className="flex flex-col gap-3">
                <div className="bg-card border rounded-xl p-4">
                  <div className="text-primary font-semibold text-sm mb-2">Opening Script</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    &ldquo;Hi, this is [Your Name] calling from [Company]. I&apos;m reaching out because
                    you recently inquired about life insurance options. Is now a good time to chat for
                    just a couple of minutes?&rdquo;
                  </p>
                </div>
                <div className="bg-card border rounded-xl p-4">
                  <div className="font-semibold text-sm mb-2" style={{ color: "#8B5CF6" }}>
                    Objection Handling
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    &ldquo;I completely understand your concern. Many of our clients felt the same way
                    initially. What I&apos;ve found is that once they saw how affordable and flexible
                    these plans are, they were glad they took a few minutes to learn more. Can I share a
                    quick overview?&rdquo;
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER COLUMN ── */}
        <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0 p-3">
          {/* 1. Contact details header */}
          <div className="shrink-0 bg-card border rounded-xl p-4">
            <div className="grid grid-cols-4 gap-4">
              {[
                {
                  label: "Full Name",
                  value: currentLead
                    ? `${currentLead.first_name ?? ""} ${currentLead.last_name ?? ""}`.trim()
                    : null,
                },
                { label: "Phone", value: currentLead?.phone },
                { label: "Email", value: currentLead?.email },
                { label: "State", value: currentLead?.state },
              ].map((f) => (
                <div key={f.label}>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">{f.label}</div>
                  <div className="text-sm font-semibold text-foreground mt-1">{f.value || "—"}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-4 mt-3">
              {[
                { label: "Age", value: currentLead?.age },
                { label: "Lead Source", value: currentLead?.source },
                { label: "Status", value: currentLead?.status },
                { label: "Assigned", value: currentLead?.claimed_by },
              ].map((f) => (
                <div key={f.label}>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">{f.label}</div>
                  <div className="text-sm font-semibold text-foreground mt-1">{f.value ?? "—"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* FIX 1: Conversation history card with pinned composer */}
          <div className="flex flex-col overflow-hidden bg-card border rounded-xl" style={{ flex: 1, minHeight: 0 }}>
            {/* Header — shrink-0 */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-semibold text-sm text-foreground">Conversation History</span>
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

            {/* FIX 1 + FIX 2: Composer — shrink-0, pinned to bottom */}
            <div className="shrink-0 border-t border-border px-4 py-3">
              {/* Tab switcher */}
              <div className="flex gap-2">
                {(["sms", "email"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => handleSmsTabChange(tab)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold uppercase ${
                      smsTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "bg-accent text-muted-foreground"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* FIX 2: Email mode — subject + textarea + full-width send button */}
              {smsTab === "email" ? (
                <div className="flex flex-col gap-2 mt-2">
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
                    className="bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground w-full resize-none h-20"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold w-full"
                  >
                    Send
                  </button>
                </div>
              ) : (
                /* SMS mode — single-line input + Send button side by side */
                <div className="flex gap-2 mt-2">
                  <input
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type SMS message…"
                    className="flex-1 bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={handleSendMessage}
                    className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Templates button — below send in both modes */}
              <button className="bg-accent text-muted-foreground border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 w-fit mt-2">
                <FileText className="w-4 h-4" />
                Templates
              </button>
            </div>
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

      {/* ── SCHEDULE MODAL ── */}
      <Dialog
        open={showScheduleModal}
        onOpenChange={(open) => {
          if (!open) setShowScheduleModal(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Appointment</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Calendar mode="single" selected={scheduleDate} onSelect={setScheduleDate} />
            <input
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              placeholder="Start time, e.g. 2:30 PM"
              className="bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <input
              value={scheduleEndTime}
              onChange={(e) => setScheduleEndTime(e.target.value)}
              placeholder="End time, e.g. 3:00 PM"
              className="bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <textarea
              value={scheduleNotes}
              onChange={(e) => setScheduleNotes(e.target.value)}
              placeholder="Notes…"
              className="bg-accent border border-border rounded-lg p-2 text-sm resize-none h-20"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => {
                setShowScheduleModal(false);
                setScheduleDate(undefined);
                setScheduleTime("");
                setScheduleEndTime("");
                setScheduleNotes("");
              }}
              className="border border-border rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSchedule}
              disabled={!scheduleDate || !scheduleTime}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Save Appointment
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FIX 8: Full View — centered Dialog modal (replaced Sheet/drawer) */}
      <Dialog open={showFullViewDrawer} onOpenChange={setShowFullViewDrawer}>
        <DialogContent className="max-w-2xl w-full max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {currentLead
                ? `${currentLead.first_name ?? ""} ${currentLead.last_name ?? ""}`.trim()
                : "No Lead"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 mt-2">
            {[
              {
                label: "Full Name",
                value: currentLead
                  ? `${currentLead.first_name ?? ""} ${currentLead.last_name ?? ""}`.trim()
                  : null,
              },
              { label: "Phone", value: currentLead?.phone },
              { label: "Email", value: currentLead?.email },
              { label: "State", value: currentLead?.state },
              { label: "Age", value: currentLead?.age },
              { label: "Lead Source", value: currentLead?.source },
              { label: "Status", value: currentLead?.status },
              { label: "Assigned Agent", value: currentLead?.claimed_by },
            ].map((f) => (
              <div key={f.label}>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{f.label}</div>
                <div className="text-sm font-semibold text-foreground mt-1">{f.value ?? "—"}</div>
              </div>
            ))}
            {/* Notes — full width */}
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</div>
              <textarea
                readOnly
                value={currentLead?.notes ?? ""}
                className="bg-accent border rounded-lg p-2 text-sm text-foreground w-full resize-none h-24"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setShowFullViewDrawer(false)}
              className="bg-accent text-foreground rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
