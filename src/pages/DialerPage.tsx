import React, { useState, useEffect, useRef } from "react";
import { ContactLocalTime } from "@/components/shared/ContactLocalTime";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play, Voicemail,
  Clock, Pin, Plus, Calendar, Eye,
  FileText, AlertCircle, CheckCircle, SkipForward,
  Search, ChevronLeft, Loader2, PhoneOff as PhoneOffIcon,
  ArrowRight, ArrowRightLeft, CalendarPlus, ExternalLink,
  PauseCircle, AlertTriangle, Pencil, Check, X, ChevronDown,
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
import ContactModal from "@/components/contacts/ContactModal";
import type { Lead } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { TelnyxRTC } from "@telnyx/webrtc";

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
  email: string;
  status: string;
  assignedAgent: string;
  healthStatus: string;
  bestTimeToCall: string;
  dateOfBirth: string;
}

const initialLeadQueue: LeadQueueItem[] = [
  { name: "John D.", fullName: "John Doe Martinez", state: "FL", age: 34, source: "Facebook Ads", attempts: 0, active: true, phone: "(555) 123-4567", email: "john.m@email.com", status: "Interested", assignedAgent: "Chris G.", healthStatus: "Good", bestTimeToCall: "Morning 8am-12pm", dateOfBirth: "1992-03-15" },
  { name: "Sarah W.", fullName: "Sarah Williams", state: "TX", age: 45, source: "Direct Mail", attempts: 1, active: false, phone: "(555) 234-5678", email: "sarah.w@email.com", status: "New", assignedAgent: "Chris G.", healthStatus: "Excellent", bestTimeToCall: "Afternoon 12pm-5pm", dateOfBirth: "1981-07-22" },
  { name: "Mike P.", fullName: "Mike Peterson", state: "CA", age: 52, source: "Google Ads", attempts: 0, active: false, phone: "(555) 345-6789", email: "mike.p@email.com", status: "Contacted", assignedAgent: "Chris G.", healthStatus: "Fair", bestTimeToCall: "Evening 5pm-8pm", dateOfBirth: "1974-11-08" },
  { name: "Lisa K.", fullName: "Lisa Kim", state: "NY", age: 38, source: "Referral", attempts: 2, active: false, phone: "(555) 456-7890", email: "lisa.k@email.com", status: "Follow Up", assignedAgent: "Chris G.", healthStatus: "Good", bestTimeToCall: "Anytime", dateOfBirth: "1988-01-30" },
  { name: "Tom H.", fullName: "Tom Harris", state: "OH", age: 41, source: "Webinar", attempts: 0, active: false, phone: "(555) 567-8901", email: "tom.h@email.com", status: "New", assignedAgent: "Chris G.", healthStatus: "Good", bestTimeToCall: "Morning 8am-12pm", dateOfBirth: "1985-06-12" },
];

const DNC_NUMBERS = ["(555) 567-8901"];

const leadStatuses = ["New", "Contacted", "Interested", "Follow Up", "Hot", "Not Interested", "Closed Won", "Closed Lost"];
const statusColors: Record<string, string> = {
  New: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  Contacted: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Interested: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  "Follow Up": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Hot: "bg-red-500/10 text-red-400 border-red-500/20",
  "Not Interested": "bg-gray-500/10 text-gray-400 border-gray-500/20",
  "Closed Won": "bg-green-500/10 text-green-400 border-green-500/20",
  "Closed Lost": "bg-red-500/10 text-red-400 border-red-500/20",
};

const stateFullNames: Record<string, string> = {
  FL: "Florida", TX: "Texas", CA: "California", NY: "New York", OH: "Ohio",
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CO: "Colorado",
};

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
  const [leadQueue, setLeadQueue] = useState<LeadQueueItem[]>(initialLeadQueue);
  const activeLeadIdx = leadQueue.findIndex(l => l.active);
  const activeLead = leadQueue[activeLeadIdx];
  const nextLead = activeLeadIdx >= 0 && activeLeadIdx < leadQueue.length - 1 ? leadQueue[activeLeadIdx + 1] : null;

  // Contact editing
  const [editingContact, setEditingContact] = useState(false);
  const [editFields, setEditFields] = useState<Partial<LeadQueueItem>>({});
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  // Contact modal (Full View)
  const [showContactModal, setShowContactModal] = useState(false);

  // Script tab
  const [scriptTab, setScriptTab] = useState(0);

  // Telnyx WebRTC
  const clientRef = useRef<any /* eslint-disable-line @typescript-eslint/no-explicit-any */>(null);
  const callRef = useRef<any /* eslint-disable-line @typescript-eslint/no-explicit-any */>(null);
  const [dialerReady, setDialerReady] = useState(false);
  const [dialerError, setDialerError] = useState<string | null>(null);

  // Close status dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false);
      }
    };
    if (statusDropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusDropdownOpen]);

  // Telnyx WebRTC client initialization
  useEffect(() => {
    let client: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    const init = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error("Microphone permission denied:", err);
        setDialerError("Microphone access is required to make calls. Please allow microphone access and refresh the page.");
        return;
      }
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to get credentials: ${response.status}`);
        }

        const { username, password } = await response.json();

        client = new TelnyxRTC({
          login: username,
          password: password,
        });

        client.on("telnyx.ready", () => {
          setDialerReady(true);
          setDialerError(null);
          console.log("Telnyx WebRTC ready");
        });

        client.on("telnyx.error", (error: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          setDialerError(`Dialer error: ${error.message}`);
          setDialerReady(false);
          console.error("Telnyx error:", error);
        });

        client.on("telnyx.notification", (notification: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          if (notification.call) {
            callRef.current = notification.call;
            const state = notification.call.state;
            if (state === "hangup" || state === "destroy") {
              setCallStatus("ended");
              setSelectedDispId(null);
            }
          }
        });

        clientRef.current = client;
        client.connect();
      } catch (err: any) /* eslint-disable-line @typescript-eslint/no-explicit-any */ {
        setDialerError("Could not initialize dialer. Check your connection.");
      }
    };

    init();

    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

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

  const handleCall = async () => {
    if (!activeLead) return;
    // DNC check
    if (DNC_NUMBERS.includes(activeLead.phone)) {
      setShowDncWarning(true);
      return;
    }
    if (!clientRef.current || !dialerReady) {
      toast({ title: "Dialer not ready", description: "Please wait a moment and try again.", variant: "destructive" });
      return;
    }
    try {
      const call = clientRef.current.newCall({
        destinationNumber: "+15551234567", // placeholder — will be replaced with real lead phone number in a future prompt
        callerNumber: "+19097381193",       // placeholder — will be replaced with agent's assigned Telnyx number
      });
      callRef.current = call;
      startDialing();
    } catch (err) {
      toast({ title: "Call failed", description: "Could not connect the call.", variant: "destructive" });
    }
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
    if (callRef.current) {
      callRef.current.hangup();
      callRef.current = null;
    }
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

  const handleSaveAndNext = async () => {
    if (!selectedDispId) return;
    const disp = hardcodedDispositions.find(d => d.id === selectedDispId);
    if (disp?.requireNotes && callNotes.length < (disp.minNoteChars || 0)) {
      setNoteError(true);
      return;
    }

    if (showFollowUp && followUpDate) {
      const startTime = new Date(followUpDate);
      const [hours, minutes] = followUpTime.split(":").map(Number);
      startTime.setHours(hours, minutes, 0, 0);
      await supabase.from('appointments').insert([{
        title: `Callback — ${disp?.name || "Follow Up"}`,
        contact_name: "John D.",
        type: "Sales Call",
        start_time: startTime.toISOString(),
      }]);
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
          {/* Next Up preview at top */}
          <div className="pb-3 border-b border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Next Up</p>
            {nextLead ? (
              <div className="bg-accent/50 rounded-lg p-3">
                <p className="text-sm font-medium text-foreground">{nextLead.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{nextLead.state} · Age {nextLead.age} · {nextLead.source}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">End of queue</p>
            )}
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
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-sm">
                <span>Local time:</span>
                <ContactLocalTime state={activeLead.state} size="md" />
              </div>
              <p className="text-muted-foreground flex items-center justify-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> {activeLead.phone}
              </p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{stateFullNames[activeLead.state] || activeLead.state}</span>
                <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full">Age {activeLead.age}</span>
                {/* Status Badge with Dropdown */}
                <div className="relative" ref={statusRef}>
                  <button
                    onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                    className={cn(
                      "text-xs px-2.5 py-0.5 rounded-full font-medium border inline-flex items-center gap-1 transition-colors",
                      statusColors[activeLead.status] || "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {activeLead.status}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {statusDropdownOpen && (
                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 w-44 bg-card border border-border rounded-lg shadow-lg py-1 z-50">
                      {leadStatuses.map(s => (
                        <button
                          key={s}
                          onClick={() => {
                            setLeadQueue(q => q.map((l, i) => i === activeLeadIdx ? { ...l, status: s } : l));
                            setStatusDropdownOpen(false);
                            toast({ title: `Status updated to ${s}` });
                          }}
                          className={cn(
                            "w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors flex items-center gap-2",
                            s === activeLead.status && "font-medium text-primary"
                          )}
                        >
                          <span className={cn("w-2 h-2 rounded-full", statusColors[s]?.split(" ")[0] || "bg-muted")} />
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

          {/* Contact Details Grid — Editable */}
          {activeLead && (
            <div className="bg-accent/50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground text-sm">Contact Details</h3>
                {editingContact ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        // Save edits back to queue
                        setLeadQueue(q => q.map((l, i) => i === activeLeadIdx ? { ...l, ...editFields } : l));
                        setEditingContact(false);
                        toast({ title: "Contact updated" });
                      }}
                      className="p-1.5 rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { setEditingContact(false); setEditFields({}); }}
                      className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingContact(true); setEditFields({ ...activeLead }); }}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {([
                  { label: "Full Name", key: "fullName", type: "text" },
                  { label: "Phone", key: "phone", type: "text" },
                  { label: "Email", key: "email", type: "text" },
                  { label: "State", key: "state", type: "text" },
                  { label: "Age", key: "age", type: "number" },
                  { label: "Date of Birth", key: "dateOfBirth", type: "date" },
                  { label: "Lead Source", key: "source", type: "text" },
                  { label: "Health Status", key: "healthStatus", type: "text" },
                  { label: "Best Time to Call", key: "bestTimeToCall", type: "text" },
                  { label: "Assigned", key: "assignedAgent", type: "text" },
                ] as const).map(({ label, key, type }) => (
                  <div key={key} className="flex justify-between items-center text-sm py-1">
                    <span className="text-muted-foreground">{label}</span>
                    {editingContact ? (
                      <input
                        type={type}
                        value={(editFields as Record<string, unknown>)[key] as string}
                        onChange={e => setEditFields(f => ({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value }))}
                        className="w-36 px-2 py-1 text-sm text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 text-right"
                      />
                    ) : (
                      <span className="text-foreground font-medium">
                        {key === "state" ? (stateFullNames[activeLead.state] || activeLead.state) : (activeLead as unknown as Record<string, unknown>)[key] as React.ReactNode}
                      </span>
                    )}
                  </div>
                ))}
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

          {/* Conversation History */}
          <div className="bg-accent/50 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Conversation History
            </h3>
            <div className="space-y-3 max-h-52 overflow-y-auto">
              {[
                { type: "call", icon: "📞", text: "Outbound call — 4:12 duration", detail: "Discussed Term Life options. Client interested.", time: "Yesterday", agent: "Chris G.", disposition: "Interested" },
                { type: "call", icon: "📞", text: "Outbound call — 0:32 duration", detail: "Left voicemail, no answer.", time: "3 days ago", agent: "Chris G.", disposition: "No Answer" },
                { type: "email", icon: "📧", text: "Email sent: Term Life Quote", detail: "Sent initial quote for 20-year term policy.", time: "4 days ago", agent: "System" },
                { type: "sms", icon: "💬", text: "SMS sent: Appointment reminder", detail: "Reminded about scheduled callback.", time: "5 days ago", agent: "System" },
                { type: "call", icon: "📞", text: "Inbound call — 1:45 duration", detail: "Client called with questions about premium rates.", time: "1 week ago", agent: "Sarah J.", disposition: "Follow Up" },
                { type: "appointment", icon: "📅", text: "Appointment completed", detail: "Virtual meeting — reviewed coverage needs.", time: "2 weeks ago", agent: "Chris G." },
              ].map((item, i) => (
                <div key={i} className="flex gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                  <span className="text-base mt-0.5">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-foreground font-medium truncate">{item.text}</p>
                      <span className="text-xs text-muted-foreground shrink-0">{item.time}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{item.agent}</span>
                      {item.disposition && (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{item.disposition}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANEL — Dispositions ═══ */}
        <div className="space-y-4">
          <div className="bg-card rounded-xl border p-4 space-y-3">
            {/* Dialer status */}
            {dialerError && (
              <div className="text-xs text-destructive text-center px-2">{dialerError}</div>
            )}
            {!dialerReady && !dialerError && (
              <div className="text-xs text-muted-foreground text-center">Connecting dialer...</div>
            )}
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
                    <TooltipContent>Coming soon — available after Telnyx setup</TooltipContent>
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
            <button
              onClick={() => setShowContactModal(true)}
              className="flex-1 py-2 rounded-md border border-border text-sm text-foreground font-medium flex items-center justify-center gap-1.5 hover:bg-accent transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Full View
            </button>
          </div>

          {/* Disposition History */}
          <div className="bg-card rounded-xl border p-4 space-y-3">
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Disposition History
            </h3>
            <div className="space-y-2">
              {[
                { date: "Yesterday", disposition: "Interested", duration: "4:12", notes: "Wants info on Term Life", color: "bg-yellow-500/10 text-yellow-400" },
                { date: "3 days ago", disposition: "No Answer", duration: "0:32", notes: "Left voicemail", color: "bg-gray-500/10 text-gray-400" },
                { date: "1 week ago", disposition: "Follow Up", duration: "1:45", notes: "Asked about premium rates", color: "bg-blue-500/10 text-blue-400" },
              ].map((c, i) => (
                <div key={i} className="text-sm border-b border-border last:border-0 pb-2 last:pb-0">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground text-xs">{c.date}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.color}`}>{c.disposition}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="text-foreground font-medium">{c.duration}</span> · {c.notes || "No notes"}
                  </p>
                </div>
              ))}
            </div>
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
      {/* Contact Modal (Full View) — does not affect call state */}
      {showContactModal && activeLead && (
        <ContactModal
          lead={{
            id: `dialer-${activeLeadIdx}`,
            firstName: activeLead.fullName.split(" ")[0],
            lastName: activeLead.fullName.split(" ").slice(1).join(" "),
            phone: activeLead.phone,
            email: activeLead.email,
            state: activeLead.state,
            status: activeLead.status as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            leadSource: activeLead.source,
            leadScore: 7,
            age: activeLead.age,
            dateOfBirth: activeLead.dateOfBirth,
            healthStatus: activeLead.healthStatus,
            bestTimeToCall: activeLead.bestTimeToCall,
            assignedAgentId: "u1",
            notes: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }}
          onClose={() => setShowContactModal(false)}
          onUpdate={async (id, data) => {
            // Sync edits back to queue
            setLeadQueue(q => q.map((l, i) => {
              if (i !== activeLeadIdx) return l;
              return {
                ...l,
                fullName: `${data.firstName ?? l.fullName.split(" ")[0]} ${data.lastName ?? l.fullName.split(" ").slice(1).join(" ")}`,
                phone: data.phone ?? l.phone,
                email: data.email ?? l.email,
                state: data.state ?? l.state,
                source: data.leadSource ?? l.source,
                age: data.age ?? l.age,
                status: data.status ?? l.status,
                healthStatus: data.healthStatus ?? l.healthStatus,
                bestTimeToCall: data.bestTimeToCall ?? l.bestTimeToCall,
                dateOfBirth: data.dateOfBirth ?? l.dateOfBirth,
              };
            }));
          }}
          onDelete={async () => { setShowContactModal(false); }}
        />
      )}
    </div>
  );
};

export default DialerPage;
