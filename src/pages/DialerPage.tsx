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
} from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { user } = useAuth();

  const currentLead = leadQueue[currentLeadIndex] ?? null;
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  /* --- data loading --- */

  useEffect(() => {
    getCampaigns()
      .then(setCampaigns)
      .catch(() => toast.error("Failed to load campaigns"));
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

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* ── TOP CONTROL BAR ── */}
      <div className="flex justify-between items-center border-b px-4 py-2">
        <button className="border border-destructive text-destructive text-sm rounded-lg px-3 py-1.5 font-semibold">
          ← End Session
        </button>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success inline-block" />
          <span className="text-success font-semibold text-sm">Dialer Ready</span>
        </div>
        <span className="text-muted-foreground text-sm">{selectedCampaign?.name ?? "No campaign"}</span>
      </div>

      {/* ── COLUMNS ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT COLUMN ── */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-hidden p-3 border-r">
          {/* 1. Campaign selector */}
          {selectedCampaignId === null ? (
            <select
              className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              value=""
              onChange={(e) => setSelectedCampaignId(e.target.value || null)}
            >
              <option value="">Select a campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground truncate">
                {selectedCampaign?.name}
              </span>
              <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5 rounded-full">
                {leadQueue.length}
              </span>
              <span
                className="text-primary cursor-pointer text-xs ml-auto"
                onClick={() => setSelectedCampaignId(null)}
              >
                Change
              </span>
            </div>
          )}

          {/* 2. Action buttons */}
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
            <button
              onClick={() => setShowScheduleModal(true)}
              className="bg-accent border rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
            >
              <CalendarIcon className="w-5 h-5" />
              Schedule
            </button>
            <button
              onClick={() => setShowFullViewDrawer(true)}
              className="bg-accent border rounded-xl py-3 flex flex-col items-center gap-1 text-sm font-semibold"
            >
              <Eye className="w-5 h-5" />
              Full View
            </button>
          </div>

          {/* 3. Session stats */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Calls", value: sessionStats.calls },
              { label: "Connected", value: sessionStats.connected },
              { label: "Avg Duration", value: avgDuration },
              { label: "Talk Time", value: fmtDuration(sessionStats.talkSeconds) },
              { label: "Conv Rate", value: convRate },
              { label: "Callbacks", value: sessionStats.callbacks },
            ].map((s) => (
              <div key={s.label} className="bg-card border rounded-lg p-2 text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</div>
                <div className="text-base font-bold font-mono text-foreground">{s.value}</div>
              </div>
            ))}
          </div>

          {/* 4. Tab bar */}
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

          {/* 5. Tab content */}
          <div className="flex-1 overflow-y-auto">
            {/* ── Dispositions tab ── */}
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
                    <div className="mt-1">
                      <select className="bg-accent border border-border rounded text-xs px-2 py-1 text-foreground">
                        <option>+19097381193</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Wrap-up UI */}
                {showWrapUp && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {dispositions.map((d, i) => {
                        const isSelected = selectedDisp?.id === d.id;
                        return (
                          <button
                            key={d.id}
                            onClick={() => handleSelectDisposition(d)}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left ${
                              isSelected ? "border-2" : "bg-accent border border-border"
                            }`}
                            style={
                              isSelected
                                ? { borderColor: d.color, backgroundColor: `${d.color}21` }
                                : undefined
                            }
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: d.color }}
                            />
                            <span className="flex-1 truncate">{d.name}</span>
                            <span className="text-muted-foreground text-xs">{i + 1}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Notes + save */}
                    <textarea
                      value={noteText}
                      onChange={(e) => {
                        setNoteText(e.target.value);
                        setNoteError(false);
                      }}
                      placeholder="Add notes…"
                      className={`bg-accent border rounded-lg p-2 text-sm resize-none h-20 w-full ${
                        noteError ? "border-destructive" : "border-border"
                      }`}
                    />
                    {selectedDisp && selectedDisp.minNoteChars > 0 && (
                      <div className="text-xs text-muted-foreground text-right -mt-2">
                        {noteText.length}/{selectedDisp.minNoteChars}
                      </div>
                    )}
                    <button
                      onClick={handleSaveAndContinue}
                      className="bg-primary text-primary-foreground w-full rounded-lg py-2 text-sm font-semibold"
                    >
                      Save &amp; Continue
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── Queue tab ── */}
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

            {/* ── Scripts tab ── */}
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
        <div className="flex-1 flex flex-col gap-3 overflow-hidden p-3">
          {/* 1. Contact details header */}
          <div className="bg-card border rounded-xl p-4">
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

          {/* 2. Conversation history */}
          <div className="flex-1 bg-card border rounded-xl flex flex-col overflow-hidden">
            <div className="font-semibold text-sm text-foreground px-4 py-3 border-b">
              Conversation History
            </div>
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

          {/* 3. Message composer */}
          <div className="border-t px-4 py-3">
            <div className="flex gap-2">
              {(["sms", "email"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSmsTab(tab)}
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
            <div className="flex gap-2 mt-2">
              <input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={`Type ${smsTab.toUpperCase()} message…`}
                className="flex-1 bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              />
              <button
                onClick={handleSendMessage}
                className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <button className="bg-accent text-muted-foreground border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 w-fit mt-2">
              <FileText className="w-4 h-4" />
              Templates
            </button>
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

      {/* ── FULL VIEW DRAWER ── */}
      <Sheet open={showFullViewDrawer} onOpenChange={setShowFullViewDrawer}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>
              {currentLead
                ? `${currentLead.first_name ?? ""} ${currentLead.last_name ?? ""}`.trim()
                : "No Lead"}
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 mt-4">
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
              { label: "Assigned Agent ID", value: currentLead?.claimed_by },
              { label: "Notes", value: currentLead?.notes },
            ].map((f) => (
              <div key={f.label}>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{f.label}</div>
                <div className="text-sm text-foreground font-medium mt-0.5">{f.value ?? "—"}</div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
