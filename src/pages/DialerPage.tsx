import React, { useState, useEffect, useRef } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play, Voicemail,
  Clock, ChevronDown, Pin, Plus, Calendar, Eye,
  FileText, AlertCircle, CheckCircle, SkipForward,
  Search, ChevronLeft, Loader2, PhoneOff as PhoneOffIcon,
  ArrowRight, ArrowRightLeft, CalendarPlus, ExternalLink,
  PauseCircle, AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAgentStatus } from "@/contexts/AgentStatusContext";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";

// ── Mock campaign data ──
interface DialerCampaign {
  id: string;
  name: string;
  status: "Active" | "Paused" | "Draft" | "Completed" | "Archived";
  mode: "Power" | "Predictive";
  leadsAvailable: number;
  callsToday: number;
  conversion: number;
  lastSession: string;
}

const mockCampaigns: DialerCampaign[] = [
  { id: "c1", name: "Q1 Facebook Leads", status: "Active", mode: "Power", leadsAvailable: 47, callsToday: 12, conversion: 8, lastSession: "Today" },
  { id: "c2", name: "Google Ads Spring", status: "Active", mode: "Power", leadsAvailable: 23, callsToday: 0, conversion: 12, lastSession: "Yesterday" },
  { id: "c3", name: "Referral Outreach", status: "Active", mode: "Predictive", leadsAvailable: 15, callsToday: 5, conversion: 21, lastSession: "Mar 1" },
  { id: "c4", name: "Direct Mail Q1", status: "Paused", mode: "Power", leadsAvailable: 88, callsToday: 0, conversion: 4, lastSession: "Feb 28" },
];

// ── Campaign Selection Screen ──
const CampaignSelection: React.FC<{ onSelect: (c: DialerCampaign) => void }> = ({ onSelect }) => {
  const [search, setSearch] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const activeCampaigns = mockCampaigns.filter(c => c.status === "Active");
  const filtered = activeCampaigns.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  const handleStart = (c: DialerCampaign) => {
    setLoadingId(c.id);
    setTimeout(() => onSelect(c), 800);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">AgentFlow / Dialer</div>
      <h1 className="text-3xl font-bold text-foreground">Start a Session</h1>
      <p className="text-muted-foreground mt-1">Select a campaign to begin dialing</p>

      <div className="mt-8 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="w-full bg-background border border-border rounded-md pl-10 pr-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            {activeCampaigns.length === 0 ? (
              <>
                <PhoneOffIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium">No active campaigns assigned</p>
                <p className="text-muted-foreground text-sm">Contact your admin to get assigned to an active campaign.</p>
              </>
            ) : (
              <>
                <Search className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium">No campaigns match your search</p>
                <p className="text-muted-foreground text-sm">Try a different search term.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(c => {
              const isLoading = loadingId === c.id;
              return (
                <div key={c.id} className="bg-card border border-border rounded-lg p-5 cursor-pointer hover:border-primary hover:shadow-md transition-all duration-150">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground font-semibold text-base truncate">{c.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${c.mode === "Power" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"}`}>
                      {c.mode}
                    </span>
                  </div>
                  <div className="flex items-stretch mt-4">
                    <div className="flex-1 text-center">
                      <p className="text-foreground font-bold text-lg">{c.leadsAvailable}</p>
                      <p className="text-muted-foreground text-xs">leads available</p>
                    </div>
                    <div className="border-r border-border" />
                    <div className="flex-1 text-center">
                      <p className="text-foreground font-bold text-lg">{c.callsToday}</p>
                      <p className="text-muted-foreground text-xs">calls today</p>
                    </div>
                    <div className="border-r border-border" />
                    <div className="flex-1 text-center">
                      <p className="text-foreground font-bold text-lg">{c.conversion}%</p>
                      <p className="text-muted-foreground text-xs">conversion</p>
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs mt-3">Last session: {c.lastSession}</p>
                  <button
                    onClick={() => handleStart(c)}
                    disabled={!!loadingId}
                    className="w-full mt-3 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Loading session...</>
                    ) : (
                      <>Start Dialing <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Mock data ──
const sessionStats = [
  { label: "Session Duration", value: "01:23:45" },
  { label: "Calls Made", value: "12" },
  { label: "Connected", value: "5" },
  { label: "Answer Rate", value: "42%" },
  { label: "Policies Sold", value: "1" },
  { label: "Avg Duration", value: "3:24" },
];

interface LeadQueueItem {
  name: string;
  fullName: string;
  state: string;
  age: number;
  source: string;
  attempts: number;
  active: boolean;
  phone: string;
}

const initialLeadQueue: LeadQueueItem[] = [
  { name: "John D.", fullName: "John Doe Martinez", state: "FL", age: 34, source: "Facebook Ads", attempts: 0, active: true, phone: "(555) 123-4567" },
  { name: "Sarah W.", fullName: "Sarah Williams", state: "TX", age: 45, source: "Direct Mail", attempts: 1, active: false, phone: "(555) 234-5678" },
  { name: "Mike P.", fullName: "Mike Peterson", state: "CA", age: 52, source: "Google Ads", attempts: 0, active: false, phone: "(555) 345-6789" },
  { name: "Lisa K.", fullName: "Lisa Kim", state: "NY", age: 38, source: "Referral", attempts: 2, active: false, phone: "(555) 456-7890" },
  { name: "Tom H.", fullName: "Tom Harris", state: "OH", age: 41, source: "Webinar", attempts: 0, active: false, phone: "(555) 567-8901" },
];

const DNC_NUMBERS = ["(555) 567-8901"];

const scriptSections = ["Introduction", "Needs Analysis", "Presentation", "Close"];

type CallStatus = "ready" | "dialing" | "connected" | "ended";

const hardcodedDispositions = [
  { id: "sold", name: "Sold / Policy Issued", bgClass: "bg-green-500/10", textClass: "text-green-400", borderClass: "border-green-500/20", activeBg: "bg-green-500", requireNotes: false },
  { id: "callback", name: "Call Back / Follow Up", bgClass: "bg-blue-500/10", textClass: "text-blue-400", borderClass: "border-blue-500/20", activeBg: "bg-blue-500", requireNotes: false },
  { id: "not-interested", name: "Not Interested", bgClass: "bg-red-500/10", textClass: "text-red-400", borderClass: "border-red-500/20", activeBg: "bg-red-500", requireNotes: false },
  { id: "no-answer", name: "No Answer / Voicemail", bgClass: "bg-gray-500/10", textClass: "text-gray-400", borderClass: "border-gray-500/20", activeBg: "bg-gray-500", requireNotes: false },
  { id: "wrong-number", name: "Wrong Number / Bad Lead", bgClass: "bg-orange-500/10", textClass: "text-orange-400", borderClass: "border-orange-500/20", activeBg: "bg-orange-500", requireNotes: false },
  { id: "interested", name: "Interested", bgClass: "bg-yellow-500/10", textClass: "text-yellow-400", borderClass: "border-yellow-500/20", activeBg: "bg-yellow-500", requireNotes: true, minNoteChars: 10 },
];

const vmDropOptions = ["Standard VM Drop", "Callback VM Drop"];
const mockAgents = ["Chris G.", "Sarah J.", "Mike T.", "Lisa R.", "James W."];

const DialerPage: React.FC = () => {
  const { setDialerOverride } = useAgentStatus();
  const [selectedCampaign, setSelectedCampaign] = useState<DialerCampaign | null>(null);
  const [confirmChangeCampaign, setConfirmChangeCampaign] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);

  // Call state
  const [callStatus, setCallStatus] = useState<CallStatus>("ready");
  const [callSeconds, setCallSeconds] = useState(0);
  const [totalTalkSeconds, setTotalTalkSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const dialTimerRef = useRef<NodeJS.Timeout | null>(null);

  // DNC
  const [showDncWarning, setShowDncWarning] = useState(false);

  // Disposition
  const [selectedDispId, setSelectedDispId] = useState<string | null>(null);
  const [callNotes, setCallNotes] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("10:00");

  // VM dropdown
  const [vmDropOpen, setVmDropOpen] = useState(false);

  // Lead queue
  const [leadQueue] = useState<LeadQueueItem[]>(initialLeadQueue);
  const activeLeadIdx = leadQueue.findIndex(l => l.active);
  const activeLead = leadQueue[activeLeadIdx];
  const nextLead = activeLeadIdx >= 0 && activeLeadIdx < leadQueue.length - 1 ? leadQueue[activeLeadIdx + 1] : null;

  // Script tab
  const [scriptTab, setScriptTab] = useState(0);

  // Call timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (callStatus === "connected") {
      timer = setInterval(() => setCallSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [callStatus]);

  // Agent status sync
  useEffect(() => {
    if (!selectedCampaign) {
      setDialerOverride(null);
    } else if (callStatus === "connected") {
      setDialerOverride("on-call");
    } else {
      setDialerOverride("in-session");
    }
  }, [selectedCampaign, callStatus, setDialerOverride]);

  // Cleanup on unmount
  useEffect(() => {
    return () => setDialerOverride(null);
  }, [setDialerOverride]);

  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const isSessionActive = callStatus === "connected" || callStatus === "dialing" || callSeconds > 0 || selectedDispId !== null;

  const handleCampaignSelect = (c: DialerCampaign) => {
    setSelectedCampaign(c);
    setDialerOverride("in-session");
  };

  const handleChangeCampaign = () => {
    if (isSessionActive) {
      setConfirmChangeCampaign(true);
    } else {
      resetSession();
      setSelectedCampaign(null);
    }
  };

  const resetSession = () => {
    setCallStatus("ready");
    setCallSeconds(0);
    setMuted(false);
    setHeld(false);
    setSelectedDispId(null);
    setCallNotes("");
    setNoteError(false);
    setShowFollowUp(false);
    setShowDncWarning(false);
    if (dialTimerRef.current) clearTimeout(dialTimerRef.current);
  };

  const confirmAndChangeCampaign = () => {
    resetSession();
    setConfirmChangeCampaign(false);
    setSelectedCampaign(null);
    setDialerOverride(null);
  };

  const handleCall = () => {
    if (!activeLead) return;
    // DNC check
    if (DNC_NUMBERS.includes(activeLead.phone)) {
      setShowDncWarning(true);
      return;
    }
    startDialing();
  };

  const startDialing = () => {
    setShowDncWarning(false);
    setCallStatus("dialing");
    setCallSeconds(0);
    setSelectedDispId(null);
    setCallNotes("");
    setMuted(false);
    setHeld(false);
    dialTimerRef.current = setTimeout(() => {
      setCallStatus("connected");
    }, 2000);
  };

  const handleHangUp = () => {
    if (dialTimerRef.current) clearTimeout(dialTimerRef.current);
    setTotalTalkSeconds(prev => prev + callSeconds);
    setCallStatus("ended");
    setMuted(false);
    setHeld(false);
  };

  const handleCancelDnc = () => {
    setShowDncWarning(false);
    setCallStatus("ready");
  };

  const handleVmDrop = (option: string) => {
    setVmDropOpen(false);
    toast({ title: "Voicemail dropped.", description: option });
  };

  const handleSelectDisposition = (id: string) => {
    setSelectedDispId(id);
    setNoteError(false);
    setCallNotes("");
    setShowFollowUp(false);
  };

  const handleSaveAndNext = () => {
    if (!selectedDispId) return;
    const disp = hardcodedDispositions.find(d => d.id === selectedDispId);
    if (disp?.requireNotes && callNotes.length < (disp.minNoteChars || 0)) {
      setNoteError(true);
      return;
    }
    toast({ title: "Disposition saved. Loading next contact." });
    setSelectedDispId(null);
    setCallNotes("");
    setCallStatus("ready");
    setCallSeconds(0);
    setShowFollowUp(false);
  };

  const handleEndSession = () => {
    setShowEndModal(true);
  };

  const confirmEndSession = () => {
    resetSession();
    setTotalTalkSeconds(0);
    setShowEndModal(false);
    setSelectedCampaign(null);
    setDialerOverride(null);
    toast({ title: "Session ended. Great work!" });
  };

  // Keyboard shortcuts for dispositions
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= hardcodedDispositions.length) {
        e.preventDefault();
        handleSelectDisposition(hardcodedDispositions[num - 1].id);
      }
    };
    if (selectedCampaign) {
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }
  }, [selectedCampaign]);

  // ── Campaign Selection ──
  if (!selectedCampaign) {
    return <CampaignSelection onSelect={handleCampaignSelect} />;
  }

  const selectedDisp = selectedDispId ? hardcodedDispositions.find(d => d.id === selectedDispId) : null;

  // ── Dialer Session View ──
  return (
    <div className="space-y-4">
      {/* Change Campaign link */}
      <button onClick={handleChangeCampaign} className="text-sm text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1 transition-colors">
        <ChevronLeft className="w-4 h-4" /> Change Campaign
      </button>

      <h1 className="text-2xl font-bold text-foreground">Dialer</h1>

      {/* Session Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {sessionStats.map((s) => (
          <div key={s.label} className="bg-card rounded-lg border p-3 text-center">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-lg font-bold font-mono text-foreground mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Three Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ═══ LEFT PANEL — Queue ═══ */}
        <div className="bg-card rounded-xl border p-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Campaign</label>
            <button className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-accent text-sm text-foreground">
              {selectedCampaign.name} <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{selectedCampaign.mode} Dialer</span>
            <span className="text-xs text-muted-foreground">{selectedCampaign.leadsAvailable} remaining</span>
          </div>
          <div className="space-y-2">
            {leadQueue.map((l, i) => (
              <div key={i} className={`rounded-lg p-3 sidebar-transition ${l.active ? "bg-primary/10 border border-primary/30" : "bg-accent/50 hover:bg-accent"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-foreground">{l.name}</span>
                  <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{l.state}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">Age {l.age}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">{l.source}</span>
                </div>
                <div className="flex items-center gap-1 mt-1.5">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className={`w-1.5 h-1.5 rounded-full ${j < l.attempts ? "bg-primary" : "bg-muted"}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Next Up preview */}
          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Next Up</p>
            {nextLead ? (
              <div>
                <p className="text-sm font-medium text-foreground">{nextLead.name}</p>
                <p className="text-xs text-muted-foreground">{nextLead.state} · Age {nextLead.age} · {nextLead.source}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">End of queue</p>
            )}
          </div>

          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-lg bg-warning/10 text-warning text-sm font-medium hover:bg-warning/20 sidebar-transition">Pause</button>
            <button onClick={handleEndSession} className="flex-1 py-2 rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 sidebar-transition">End</button>
          </div>
        </div>

        {/* ═══ CENTER PANEL — Contact Details ═══ */}
        <div className="lg:col-span-2 bg-card rounded-xl border p-6 space-y-6">
          {/* Contact Header */}
          {activeLead && (
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-foreground">{activeLead.fullName}</h2>
              <p className="text-muted-foreground flex items-center justify-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> {activeLead.phone}
              </p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{activeLead.state === "FL" ? "Florida" : activeLead.state === "TX" ? "Texas" : activeLead.state === "CA" ? "California" : activeLead.state === "NY" ? "New York" : activeLead.state}</span>
                <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">Age {activeLead.age}</span>
              </div>
              {/* Connection status */}
              <div className="flex justify-center">
                <span className={cn(
                  "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium",
                  callStatus === "ready" && "bg-success/10 text-success",
                  callStatus === "dialing" && "bg-blue-500/10 text-blue-400",
                  callStatus === "connected" && "bg-success/10 text-success",
                  callStatus === "ended" && "bg-muted text-muted-foreground",
                )}>
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    callStatus === "ready" && "bg-success",
                    callStatus === "dialing" && "bg-blue-400 animate-pulse",
                    callStatus === "connected" && "bg-success",
                    callStatus === "ended" && "bg-muted-foreground",
                  )} />
                  {callStatus === "ready" && "Ready"}
                  {callStatus === "dialing" && "Dialing..."}
                  {callStatus === "connected" && (
                    <>Connected · {formatTime(callSeconds)}</>
                  )}
                  {callStatus === "ended" && "Call Ended"}
                </span>
              </div>
            </div>
          )}

          {/* DNC Warning */}
          <AnimatePresence>
            {showDncWarning && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-red-500/10 border border-red-500/20 rounded-md px-4 py-3 text-red-400 text-sm"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p>This number appears on the DNC list. Proceed with caution.</p>
                    <div className="flex gap-2 mt-2">
                      <button onClick={handleCancelDnc} className="px-3 py-1.5 rounded-md border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/10">Cancel Call</button>
                      <button onClick={startDialing} className="px-3 py-1.5 rounded-md bg-red-500 text-white text-xs font-medium hover:bg-red-600">Proceed Anyway</button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Call Script */}
          <div className="bg-accent/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground text-sm">Call Script</h3>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Term Life</span>
            </div>
            <div className="flex gap-1 border-b pb-2">
              {scriptSections.map((s, i) => (
                <button key={s} onClick={() => setScriptTab(i)} className={`px-3 py-1 rounded-md text-xs font-medium sidebar-transition ${i === scriptTab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{s}</button>
              ))}
            </div>
            <div className="text-sm text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
              {scriptTab === 0 && (
                <>
                  <p>"Hi, this is [Your Name] from AgentFlow Insurance. I'm reaching out because you recently expressed interest in learning more about life insurance options. Is this a good time to chat for a few minutes?"</p>
                  <p className="text-xs text-primary font-medium italic">If yes, continue. If no, schedule callback.</p>
                </>
              )}
              {scriptTab === 1 && (
                <>
                  <p>"Great! To make sure I recommend the right coverage, can I ask a few quick questions? How many dependents do you have? What's your current coverage situation?"</p>
                  <p className="text-xs text-primary font-medium italic">Listen actively. Note key details about family and financial situation.</p>
                </>
              )}
              {scriptTab === 2 && (
                <>
                  <p>"Based on what you've shared, I'd recommend our Term Life plan. It provides [coverage amount] for a monthly premium of [amount]. This would ensure your family is protected if anything were to happen."</p>
                  <p className="text-xs text-primary font-medium italic">Emphasize value and peace of mind. Address objections calmly.</p>
                </>
              )}
              {scriptTab === 3 && (
                <>
                  <p>"Would you like to move forward with this plan today? I can get everything set up right now and you'll have coverage starting immediately."</p>
                  <p className="text-xs text-primary font-medium italic">If hesitant, offer to schedule a follow-up. Never pressure.</p>
                </>
              )}
            </div>
          </div>

          {/* Pinned Notes + Quick Note */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Pin className="w-4 h-4 text-primary" /> Pinned Notes</h3>
            <div className="bg-accent/50 rounded-lg p-3 text-sm text-muted-foreground">Has 2 kids, wife is a teacher. Interested in 20-year term policy.</div>
            <div className="flex gap-2">
              <input type="text" placeholder="Add a quick note..." className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <button className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"><Plus className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANEL — Dispositions ═══ */}
        <div className="space-y-4">
          <div className="bg-card rounded-xl border p-4 space-y-3">
            {/* Call / Hang Up buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleCall}
                disabled={callStatus === "connected" || callStatus === "dialing"}
                className={cn(
                  "flex-1 py-2.5 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors",
                  callStatus === "connected" || callStatus === "dialing"
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                <Phone className="w-4 h-4" /> Call
              </button>
              <button
                onClick={handleHangUp}
                disabled={callStatus !== "connected" && callStatus !== "dialing"}
                className={cn(
                  "flex-1 py-2.5 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors",
                  callStatus !== "connected" && callStatus !== "dialing"
                    ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                    : "bg-red-500 text-white hover:bg-red-600"
                )}
              >
                <PhoneOff className="w-4 h-4" /> Hang Up
              </button>
            </div>

            {/* Live Call Timer */}
            <AnimatePresence>
              {(callStatus === "connected" || callStatus === "dialing") && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center py-2"
                >
                  <p className="text-foreground font-mono text-lg font-semibold">{formatTime(callSeconds)}</p>
                  <p className="text-muted-foreground text-xs">Call Duration</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active Call Action Row */}
            <AnimatePresence>
              {(callStatus === "connected" || callStatus === "dialing") && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex gap-2"
                >
                  {/* Mute */}
                  <button
                    onClick={() => setMuted(!muted)}
                    className={cn(
                      "flex-1 py-1.5 px-3 rounded-md text-sm flex items-center justify-center gap-1.5 transition-colors",
                      muted
                        ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                        : "bg-muted text-foreground hover:bg-accent"
                    )}
                  >
                    {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                  {/* Hold */}
                  <button
                    onClick={() => setHeld(!held)}
                    className={cn(
                      "flex-1 py-1.5 px-3 rounded-md text-sm flex items-center justify-center gap-1.5 transition-colors",
                      held
                        ? "bg-orange-500/10 text-orange-500 border border-orange-500/20"
                        : "bg-muted text-foreground hover:bg-accent"
                    )}
                  >
                    <PauseCircle className="w-4 h-4" />
                  </button>
                  {/* Voicemail */}
                  <div className="relative flex-1">
                    <button
                      onClick={() => setVmDropOpen(!vmDropOpen)}
                      className="w-full py-1.5 px-3 rounded-md text-sm flex items-center justify-center gap-1.5 bg-muted text-foreground hover:bg-accent transition-colors"
                    >
                      <Voicemail className="w-4 h-4" />
                    </button>
                    {vmDropOpen && (
                      <div className="absolute top-full mt-1 right-0 w-44 bg-card border rounded-lg shadow-lg py-1 z-50">
                        {vmDropOptions.map(opt => (
                          <button key={opt} onClick={() => handleVmDrop(opt)} className="w-full px-3 py-2 text-sm text-foreground hover:bg-accent text-left">{opt}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Transfer (disabled) */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="flex-1 py-1.5 px-3 rounded-md text-sm flex items-center justify-center gap-1.5 bg-muted text-muted-foreground cursor-not-allowed opacity-50">
                        <ArrowRightLeft className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Coming soon — available after Twilio setup</TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Disposition Section */}
            <div className="pt-2">
              <p className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">Disposition</p>
              <div className="space-y-1.5">
                {hardcodedDispositions.map((d, idx) => {
                  const isSelected = selectedDispId === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => handleSelectDisposition(d.id)}
                      className={cn(
                        "rounded-md px-4 py-2.5 text-sm font-medium text-left w-full flex items-center justify-between transition-all duration-150 border",
                        isSelected
                          ? `${d.activeBg} text-white border-transparent`
                          : `${d.bgClass} ${d.textClass} ${d.borderClass} hover:brightness-110`
                      )}
                    >
                      <span>{d.name}</span>
                      <span className={cn(
                        "rounded px-1.5 text-xs",
                        isSelected ? "bg-white/20 text-white" : "bg-background/50 text-muted-foreground"
                      )}>{idx + 1}</span>
                    </button>
                  );
                })}
              </div>

              {/* Notes section slides open when disposition selected */}
              <AnimatePresence>
                {selectedDisp && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 mt-3 overflow-hidden"
                  >
                    <label className="text-sm font-medium text-foreground block">Notes</label>
                    <textarea
                      value={callNotes}
                      onChange={e => { setCallNotes(e.target.value); setNoteError(false); }}
                      placeholder="Add call notes..."
                      rows={3}
                      className="w-full bg-background border border-border rounded-md p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    />
                    {selectedDisp.requireNotes && (
                      <p className={cn(
                        "text-xs",
                        callNotes.length >= (selectedDisp.minNoteChars || 0) ? "text-muted-foreground" : noteError ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {callNotes.length} / {selectedDisp.minNoteChars} minimum characters
                      </p>
                    )}

                    {/* Schedule Follow Up toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">Schedule Follow Up</span>
                      <Switch checked={showFollowUp} onCheckedChange={setShowFollowUp} />
                    </div>

                    {showFollowUp && (
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={followUpDate}
                          onChange={e => setFollowUpDate(e.target.value)}
                          className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                        />
                        <input
                          type="time"
                          value={followUpTime}
                          onChange={e => setFollowUpTime(e.target.value)}
                          className="w-28 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
                        />
                      </div>
                    )}

                    <button
                      onClick={handleSaveAndNext}
                      disabled={selectedDisp.requireNotes && callNotes.length < (selectedDisp.minNoteChars || 0)}
                      className="w-full bg-primary text-primary-foreground rounded-md px-6 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 mt-3"
                    >
                      Save & Next
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Contact Quick Links */}
          <div className="flex gap-2">
            <button className="flex-1 py-2 rounded-md border border-border text-sm text-foreground font-medium flex items-center justify-center gap-1.5 hover:bg-accent transition-colors">
              <CalendarPlus className="w-4 h-4" /> Schedule
            </button>
            <button className="flex-1 py-2 rounded-md border border-border text-sm text-foreground font-medium flex items-center justify-center gap-1.5 hover:bg-accent transition-colors">
              <ExternalLink className="w-4 h-4" /> Full View
            </button>
          </div>
        </div>
      </div>

      {/* Change Campaign confirmation */}
      <AlertDialog open={confirmChangeCampaign} onOpenChange={setConfirmChangeCampaign}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End current session and change campaign?</AlertDialogTitle>
            <AlertDialogDescription>Your current dialing session will be ended and you'll return to the campaign selection screen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmAndChangeCampaign}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Session Summary Modal */}
      <AnimatePresence>
        {showEndModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setShowEndModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-lg p-6 max-w-md w-full"
            >
              <h2 className="text-xl font-bold text-foreground">End Session?</h2>
              <p className="text-muted-foreground text-sm mb-4">Here's a summary of your session</p>

              <div className="grid grid-cols-2 gap-4 mb-6">
                {[
                  { label: "Calls Made", value: "12" },
                  { label: "Connected", value: "5" },
                  { label: "Answer Rate", value: "42%" },
                  { label: "Policies Sold", value: "1" },
                  { label: "Total Talk Time", value: `${Math.floor(totalTalkSeconds / 60)}m ${totalTalkSeconds % 60}s` },
                  { label: "Conversion Rate", value: `${Math.round((1 / 12) * 100)}%` },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className="text-2xl font-bold text-foreground">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowEndModal(false)}
                  className="flex-1 border border-border rounded-md px-6 py-2.5 text-foreground hover:bg-muted transition-colors"
                >
                  Keep Dialing
                </button>
                <button
                  onClick={confirmEndSession}
                  className="flex-1 bg-red-500 text-white rounded-md px-6 py-2.5 hover:bg-red-600 transition-colors"
                >
                  End Session
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DialerPage;
