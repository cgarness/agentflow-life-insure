import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Voicemail,
  Clock, SkipForward, Search, ChevronLeft, Loader2,
  ArrowRight, AlertTriangle, X, Hash, Delete, Lock,
  Zap, User, Mail, MapPin, ExternalLink, FileText,
  MessageSquare, CalendarPlus, CheckCircle, Pin,
  PhoneMissed, Pencil, CalendarDays, Activity, ChevronDown,
  MessageCircle, MailIcon, RefreshCw, Filter, Send, Eye,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentStatus } from "@/contexts/AgentStatusContext";
import { supabase } from "@/integrations/supabase/client";
import { loadPhoneNumbers, pickCallerId, formatPhoneDisplay, type PhoneNumberCache, type CallerIdResult } from "@/lib/local-presence";
import { triggerWin, isSaleDisposition } from "@/lib/win-trigger";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { STATE_TIMEZONES, getContactLocalTime } from "@/utils/contactLocalTime";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";

/* ─── Types ─── */
interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  total_leads: number;
  description: string;
  leads_contacted?: number;
  leads_converted?: number;
  cached_states?: string[];
}

interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  state: string;
  age: number | null;
  status: string;
  call_attempts: number;
  last_called_at: string | null;
  disposition: string | null;
  locked_by: string | null;
  locked_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  source: string | null;
  sort_order: number;
}

interface Disposition {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  require_notes: boolean;
  min_note_chars: number;
  callback_scheduler: boolean;
}

interface CallRecord {
  id: string;
  contact_name: string | null;
  duration: number | null;
  disposition_name: string | null;
  disposition_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  agent_id: string | null;
  notes: string | null;
}

interface ActivityRecord {
  id: string;
  activity_type: string;
  description: string;
  created_at: string;
  metadata: any;
}

interface AppointmentRecord {
  id: string;
  title: string;
  type: string;
  status: string;
  start_time: string;
  contact_name: string | null;
  created_by: string | null;
  created_at: string;
}

interface AgentProfile {
  id: string;
  first_name: string;
  last_name: string;
}

/* ── Conversation feed item (unified timeline) ── */
type FeedItemType = "call" | "note" | "appointment" | "activity" | "sms" | "email";
interface FeedItem {
  id: string;
  type: FeedItemType;
  timestamp: string;
  data: any;
}

interface ContactNote {
  id: string;
  content: string;
  pinned: boolean;
  created_at: string;
}

interface DialerSession {
  id: string;
  calls_made: number;
  calls_connected: number;
  total_talk_time: number;
  started_at: string;
}

interface TelnyxNumber {
  id: string;
  phone_number: string;
  label: string | null;
  is_default: boolean;
}

interface MessageRecord {
  id: string;
  contact_id: string;
  agent_id: string | null;
  channel: "sms" | "email";
  direction: "inbound" | "outbound";
  body: string | null;
  subject: string | null;
  status: string;
  created_at: string;
}

/* ─── Helpers ─── */
const fmtTime = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

function getLeadLocalHour(state: string): number | null {
  const tz = STATE_TIMEZONES[state?.toUpperCase()];
  if (!tz) return null;
  return parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()),
    10,
  );
}

function timeAgo(dateStr: string): string {
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

type CallStatus = "idle" | "connecting" | "connected" | "ended";

/* ═══════════════════════════════════════════════════════════
   DIALER PAGE
   ═══════════════════════════════════════════════════════════ */
const DialerPage: React.FC = () => {
  const { user, profile } = useAuth();
  const { setDialerOverride } = useAgentStatus();
  const navigate = useNavigate();
  const {
    status: telnyxStatus,
    callState: telnyxCallState,
    callDuration: telnyxCallDuration,
    isMuted: telnyxIsMuted,
    isOnHold: telnyxIsOnHold,
    makeCall: telnyxMakeCall,
    hangUp: telnyxHangUp,
    toggleMute: telnyxToggleMute,
    toggleHold: telnyxToggleHold,
    defaultCallerNumber: telnyxDefaultCaller,
  } = useTelnyx();
  const agentId = user?.id ?? "";
  const agentName = profile ? `${profile.first_name} ${profile.last_name}` : "Agent";

  /* ── Campaign state ── */
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignSearch, setCampaignSearch] = useState("");

  /* ── Session state ── */
  const [session, setSession] = useState<DialerSession | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  /* ── Leads state ── */
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [currentLeadIdx, setCurrentLeadIdx] = useState(0);

  /* ── Calling hours ── */
  const [callingHoursStart, setCallingHoursStart] = useState(9);
  const [callingHoursEnd, setCallingHoursEnd] = useState(17);

  /* ── Quick Dial mode ── */
  const [quickDialMode, setQuickDialMode] = useState(false);
  const [quickDialNumber, setQuickDialNumber] = useState("");

  /* ── Call state ── */
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callSeconds, setCallSeconds] = useState(0);
  const [callStartedAt, setCallStartedAt] = useState<Date | null>(null);
  const [muted, setMuted] = useState(false);

  /* ── Disposition state ── */
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [selectedDispId, setSelectedDispId] = useState<string | null>(null);
  const [dispNotes, setDispNotes] = useState("");
  const [callbackDate, setCallbackDate] = useState<Date | undefined>();
  const [callbackTime, setCallbackTime] = useState("10:00");

  /* ── Contact notes ── */
  const [contactNotes, setContactNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");

  /* ── Right panel data ── */
  const [callHistory, setCallHistory] = useState<CallRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<Record<string, AgentProfile>>({});

  /* ── Conversation History feed ── */
  const [feedFilter, setFeedFilter] = useState<"all" | "calls" | "notes" | "appointments" | "activity">("all");
  const [expandedFeedItems, setExpandedFeedItems] = useState<Set<string>>(new Set());
  const [historyLoading, setHistoryLoading] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);

  /* ── Call script ── */
  const [scriptContent, setScriptContent] = useState<string | null>(null);
  const [scriptCollapsed, setScriptCollapsed] = useState(false);

  /* ── Telnyx (from shared context) ── */
  const clientRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const dialerReady = telnyxStatus === "ready";
  const dialerError = telnyxStatus === "error" ? "Check Telnyx credentials in Settings" : null;
  const [phoneCache, setPhoneCache] = useState<PhoneNumberCache | null>(null);
  const [activeCallerId, setActiveCallerId] = useState<CallerIdResult | null>(null);

  /* ── Open Pool / SharkTank ── */
  const [lockCountdown, setLockCountdown] = useState<number | null>(null);
  const lockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  /* ── Mobile tab ── */
  const [mobileTab, setMobileTab] = useState<"center" | "right">("center");

  /* ── Left panel tab ── */
  const [activeTab, setActiveTab] = useState<"dispositions" | "queue" | "scripts">("dispositions");

  /* ── Session summary modal ── */
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{ calls: number; connected: number; talkTime: number; duration: number } | null>(null);

  /* ── DNC warning ── */
  const [dncWarning, setDncWarning] = useState(false);
  const [dncChecking, setDncChecking] = useState(false);

  /* ── Lead hover preview cache ── */
  const [leadLastCalls, setLeadLastCalls] = useState<Record<string, { disposition_name: string | null; started_at: string | null }>>({});
  const [hoveredLeadId, setHoveredLeadId] = useState<string | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  /* ── Telnyx Numbers ── */
  const [telnyxNumbers, setTelnyxNumbers] = useState<TelnyxNumber[]>([]);
  const [telnyxNumbersLoading, setTelnyxNumbersLoading] = useState(true);
  const [selectedTelnyxNumberId, setSelectedTelnyxNumberId] = useState<string | null>(null);

  /* ── Conversation Messages ── */
  const [contactMessages, setContactMessages] = useState<MessageRecord[]>([]);
  const [composerChannel, setComposerChannel] = useState<"sms" | "email">("sms");
  const [smsBody, setSmsBody] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);

  /* ── Full View Dialog ── */
  const [showFullView, setShowFullView] = useState(false);

  /* ── Derived ── */
  const currentLead = leads[currentLeadIdx] ?? null;
  const isOpenPool = selectedCampaign?.type === "Open Pool";

  /* ── Local Presence caller ID ── */
  const currentCallerId = useMemo<CallerIdResult>(() => {
    const phone = quickDialMode ? quickDialNumber : currentLead?.phone ?? "";
    if (!phoneCache || !phone) return { callerNumber: "", matchType: "none", matchedAreaCode: null };
    return pickCallerId(phone, phoneCache);
  }, [currentLead?.phone, quickDialNumber, quickDialMode, phoneCache]);

  const callerNumber = currentCallerId.callerNumber || "+10000000000";

  const filteredLeads = useMemo(() => {
    return leads.map((l) => {
      const hour = getLeadLocalHour(l.state);
      const callable = hour !== null && hour >= callingHoursStart && hour < callingHoursEnd;
      return { ...l, callable };
    });
  }, [leads, callingHoursStart, callingHoursEnd]);

  const callableCount = filteredLeads.filter((l) => l.callable).length;
  const outsideCount = filteredLeads.filter((l) => !l.callable).length;

  /* ═══ TELNYX — connection managed by TelnyxContext ═══ */

  /* ── Load phone numbers cache ── */
  const refreshPhoneCache = useCallback(async () => {
    const cache = await loadPhoneNumbers();
    setPhoneCache(cache);
  }, []);

  useEffect(() => { refreshPhoneCache(); }, [refreshPhoneCache]);

  /* ── Fetch telnyx numbers ── */
  useEffect(() => {
    const fetchTelnyxNumbers = async () => {
      setTelnyxNumbersLoading(true);
      const { data, error } = await (supabase as any).from("telnyx_numbers")
        .select("id, phone_number, label, is_default")
        .order("created_at");
      if (data && !error) {
        setTelnyxNumbers(data);
        const defaultNum = data.find((n: TelnyxNumber) => n.is_default);
        if (defaultNum) setSelectedTelnyxNumberId(defaultNum.id);
      }
      setTelnyxNumbersLoading(false);
    };
    fetchTelnyxNumbers();
  }, []);

  /* ── Fetch campaigns ── */
  useEffect(() => {
    const fetch = async () => {
      setCampaignsLoading(true);
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, type, status, total_leads, description, leads_contacted, leads_converted")
        .eq("status", "Active")
        .gt("total_leads", 0)
        .order("name");

      if (data) {
        // Fetch states for each campaign
        const campaignsWithStates = await Promise.all(
          data.map(async (c: any) => {
            const { data: states } = await supabase.rpc("get_campaign_states", { p_campaign_id: c.id });
            return {
              ...c,
              cached_states: states || [],
            };
          })
        );
        setCampaigns(campaignsWithStates);
      } else {
        setCampaigns([]);
      }
      setCampaignsLoading(false);
    };
    fetch();
  }, []);

  /* ── Fetch dispositions ── */
  useEffect(() => {
    supabase.from("dispositions").select("id, name, color, sort_order, require_notes, min_note_chars, callback_scheduler")
      .order("sort_order")
      .then(({ data }) => { if (data) setDispositions(data); });
  }, []);

  /* ── Session timer ── */
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setSessionSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [session]);

  /* ── Call timer ── */
  useEffect(() => {
    if (callStatus !== "connected") return;
    const t = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [callStatus]);

  /* ── Agent status sync ── */
  useEffect(() => {
    if (!session) { setDialerOverride(null); return; }
    setDialerOverride(callStatus === "connected" ? "on-call" : "in-session");
  }, [session, callStatus, setDialerOverride]);

  useEffect(() => () => setDialerOverride(null), [setDialerOverride]);

  /* ── Fetch leads when campaign selected ── */
  const fetchLeads = useCallback(async (campaignId: string) => {
    setLeadsLoading(true);
    const { data } = await supabase
      .from("campaign_leads")
      .select("*")
      .eq("campaign_id", campaignId)
      .in("status", ["Queued", "Skipped"])
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const loadedLeads = (data as CampaignLead[]) || [];
    setLeads(loadedLeads);
    setCurrentLeadIdx(0);
    setLeadsLoading(false);

    // Batch-fetch last call record per lead for hover preview (single query)
    const leadIds = loadedLeads.map((l) => l.lead_id).filter(Boolean) as string[];
    if (leadIds.length > 0) {
      const { data: callData } = await (supabase as any)
        .from("calls")
        .select("contact_id, disposition_name, started_at")
        .in("contact_id", leadIds)
        .order("started_at", { ascending: false });
      if (callData) {
        // Keep only the most recent call per contact_id
        const map: Record<string, { disposition_name: string | null; started_at: string | null }> = {};
        for (const row of callData) {
          if (!map[row.contact_id]) map[row.contact_id] = { disposition_name: row.disposition_name, started_at: row.started_at };
        }
        setLeadLastCalls(map);
      }
    }
  }, []);

  /* ── Load contact data when current lead changes ── */
  useEffect(() => {
    if (!currentLead?.lead_id) {
      setContactNotes([]);
      setCallHistory([]);
      setActivities([]);
      setAppointments([]);
      setContactMessages([]);
      return;
    }
    const lid = currentLead.lead_id;
    setHistoryLoading(true);
    setSmsBody("");
    setEmailBody("");
    setEmailSubject("");

    const fetchAll = async () => {
      // notes (all, not just 3)
      const notesP = supabase.from("contact_notes").select("id, content, pinned, created_at, author_id")
        .eq("contact_id", lid).order("created_at", { ascending: false });
      // call history
      const callsP = supabase.from("calls").select("id, contact_name, duration, disposition_name, disposition_id, started_at, ended_at, agent_id, notes")
        .eq("contact_id", lid).order("started_at", { ascending: false });
      // activities
      const activitiesP = supabase.from("contact_activities").select("id, activity_type, description, created_at, metadata")
        .eq("contact_id", lid).order("created_at", { ascending: false });
      // appointments
      const apptP = supabase.from("appointments").select("id, title, type, status, start_time, contact_name, created_by, created_at")
        .eq("contact_id", lid).order("created_at", { ascending: false });
      // messages
      const msgsP = (supabase as any).from("messages").select("id, contact_id, agent_id, channel, direction, body, subject, status, created_at")
        .eq("contact_id", lid).order("created_at", { ascending: true });

      const [notesRes, callsRes, activitiesRes, apptRes, msgsRes] = await Promise.all([notesP, callsP, activitiesP, apptP, msgsP]);
      
      const notes = notesRes.data || [];
      const calls = (callsRes.data as CallRecord[]) || [];
      const acts = (activitiesRes.data as ActivityRecord[]) || [];
      const appts = (apptRes.data as AppointmentRecord[]) || [];
      const msgs = (msgsRes.data as MessageRecord[]) || [];

      setContactNotes(notes);
      setCallHistory(calls);
      setActivities(acts);
      setAppointments(appts);
      setContactMessages(msgs);

      // Collect unique agent IDs from calls and fetch profiles
      const agentIds = new Set<string>();
      calls.forEach((c) => { if (c.agent_id) agentIds.add(c.agent_id); });
      notes.forEach((n: any) => { if (n.author_id) agentIds.add(n.author_id); });
      appts.forEach((a) => { if (a.created_by) agentIds.add(a.created_by); });
      
      if (agentIds.size > 0) {
        const { data: profiles } = await supabase.from("profiles")
          .select("id, first_name, last_name")
          .in("id", Array.from(agentIds));
        if (profiles) {
          const map: Record<string, AgentProfile> = {};
          profiles.forEach((p: any) => { map[p.id] = p; });
          setAgentProfiles(map);
        }
      }
      setHistoryLoading(false);
    };
    fetchAll();
  }, [currentLead?.lead_id]);

  /* ── Build unified conversation feed ── */
  const conversationFeed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];

    callHistory.forEach((c) => {
      items.push({ id: `call-${c.id}`, type: "call", timestamp: c.started_at || c.ended_at || "", data: c });
    });
    contactNotes.forEach((n) => {
      items.push({ id: `note-${n.id}`, type: "note", timestamp: n.created_at, data: n });
    });
    appointments.forEach((a) => {
      items.push({ id: `appt-${a.id}`, type: "appointment", timestamp: a.created_at, data: a });
    });
    activities.forEach((a) => {
      if (a.activity_type === "sms") {
        items.push({ id: `sms-${a.id}`, type: "sms", timestamp: a.created_at, data: a });
      } else if (a.activity_type === "email") {
        items.push({ id: `email-${a.id}`, type: "email", timestamp: a.created_at, data: a });
      } else {
        items.push({ id: `activity-${a.id}`, type: "activity", timestamp: a.created_at, data: a });
      }
    });
    contactMessages.forEach((m) => {
      items.push({ id: `msg-${m.id}`, type: m.channel === "sms" ? "sms" : "email", timestamp: m.created_at, data: m });
    });

    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return items;
  }, [callHistory, contactNotes, appointments, activities, contactMessages]);

  const filteredFeed = useMemo(() => {
    if (feedFilter === "all") return conversationFeed;
    if (feedFilter === "calls") return conversationFeed.filter((i) => i.type === "call");
    if (feedFilter === "notes") return conversationFeed.filter((i) => i.type === "note");
    if (feedFilter === "appointments") return conversationFeed.filter((i) => i.type === "appointment");
    if (feedFilter === "activity") return conversationFeed.filter((i) => i.type === "activity" || i.type === "sms" || i.type === "email");
    return conversationFeed;
  }, [conversationFeed, feedFilter]);

  /* ── Auto-scroll feed to bottom ── */
  useEffect(() => {
    if (feedEndRef.current) feedEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [filteredFeed.length]);

  /* ── Smart timestamp formatter ── */
  const formatMessageTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return format(d, "h:mm a");
    if (diffDays < 7) return format(d, "EEE h:mm a");
    return format(d, "MMM d h:mm a");
  };

  /* ── Send message handler ── */
  const handleSendMessage = async () => {
    if (!currentLead?.lead_id) return;
    const body = composerChannel === "sms" ? smsBody.trim() : emailBody.trim();
    if (!body) return;
    const subject = composerChannel === "email" ? emailSubject.trim() : null;

    const { data, error } = await (supabase as any).from("messages").insert({
      contact_id: currentLead.lead_id,
      agent_id: agentId,
      channel: composerChannel,
      direction: "outbound",
      body,
      subject,
    }).select().single();

    if (error) {
      toast.error("Failed to send message");
      return;
    }
    if (data) {
      setContactMessages((prev) => [...prev, data as MessageRecord]);
    }
    if (composerChannel === "sms") setSmsBody(""); else { setEmailBody(""); setEmailSubject(""); }
    toast.success(`${composerChannel.toUpperCase()} sent`);
  };

  /* ── Selected telnyx number ── */
  const selectedTelnyxNumber = telnyxNumbers.find((n) => n.id === selectedTelnyxNumberId) ?? telnyxNumbers.find((n) => n.is_default) ?? telnyxNumbers[0];
  const formatTelnyxDisplay = (n: TelnyxNumber) => {
    const display = formatPhoneDisplay(n.phone_number);
    return n.label ? `${display} — ${n.label}` : display;
  };

  const getAgentFirstName = (agentId: string | null) => {
    if (!agentId) return "";
    const p = agentProfiles[agentId];
    return p ? p.first_name : "";
  };

  const toggleFeedExpand = (id: string) => {
    setExpandedFeedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getDispColor = (dispName: string | null) => {
    if (!dispName) return null;
    const d = dispositions.find((d) => d.name === dispName);
    return d?.color ?? null;
  };

  /* ── Open Pool polling ── */
  useEffect(() => {
    if (!selectedCampaign || !isOpenPool) return;
    pollTimerRef.current = setInterval(() => {
      fetchLeads(selectedCampaign.id);
    }, 5000);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [selectedCampaign, isOpenPool, fetchLeads]);

  /* ── SharkTank lock countdown ── */
  useEffect(() => {
    if (!isOpenPool || !currentLead || callStatus !== "idle") {
      setLockCountdown(null);
      if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      return;
    }
    // Try to lock the lead
    const lockLead = async () => {
      const { error } = await supabase
        .from("campaign_leads")
        .update({ status: "Locked", locked_by: agentId, locked_at: new Date().toISOString() })
        .eq("id", currentLead.id)
        .eq("status", "Queued");
      if (error) {
        // Lock failed — skip to next
        advanceToNextLead();
        return;
      }
      setLockCountdown(30);
      lockTimerRef.current = setInterval(() => {
        setLockCountdown((prev) => {
          if (prev === null || prev <= 1) {
            // Auto-release
            supabase.from("campaign_leads")
              .update({ status: "Queued", locked_by: null, locked_at: null })
              .eq("id", currentLead.id);
            advanceToNextLead();
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    };
    lockLead();
    return () => { if (lockTimerRef.current) clearInterval(lockTimerRef.current); };
  }, [currentLead?.id, isOpenPool, callStatus]);

  /* ═══ ACTIONS ═══ */

  const startSession = async (campaign: Campaign) => {
    const { data } = await supabase.from("dialer_sessions").insert({
      agent_id: agentId,
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      mode: "Power",
      started_at: new Date().toISOString(),
      calls_made: 0,
      calls_connected: 0,
      total_talk_time: 0,
    }).select().single();

    if (data) {
      setSession(data as DialerSession);
      setSessionSeconds(0);
      setSelectedCampaign(campaign);
      setQuickDialMode(false);
      fetchLeads(campaign.id);
    }
  };

  const endSession = async () => {
    if (session) {
      await supabase.from("dialer_sessions").update({ ended_at: new Date().toISOString() }).eq("id", session.id);
      setSummaryData({
        calls: session.calls_made,
        connected: session.calls_connected,
        talkTime: session.total_talk_time,
        duration: sessionSeconds,
      });
      setShowSummary(true);
      return; // Don't reset yet — modal will handle it
    }
    resetAfterSession();
  };

  const resetAfterSession = () => {
    setSession(null);
    setSelectedCampaign(null);
    setLeads([]);
    setCurrentLeadIdx(0);
    setCallStatus("idle");
    setCallSeconds(0);
    setQuickDialMode(false);
    setShowSummary(false);
    setSummaryData(null);
  };

  const advanceToNextLead = () => {
    setCurrentLeadIdx((prev) => {
      const next = prev + 1;
      return next < leads.length ? next : prev;
    });
    setCallStatus("idle");
    setCallSeconds(0);
    setSelectedDispId(null);
    setDispNotes("");
    setNewNote("");
    setCallbackDate(undefined);
  };

  const handleCall = async (bypassDnc = false) => {
    const number = quickDialMode ? quickDialNumber : currentLead?.phone;
    if (!number) return;

    // DNC check
    if (!bypassDnc) {
      setDncChecking(true);
      const cleaned = number.replace(/\D/g, "");
      const { data: dncHit } = await supabase
        .from("dnc_list")
        .select("id")
        .or(`phone_number.eq.${cleaned},phone_number.eq.${number}`)
        .limit(1)
        .maybeSingle();
      setDncChecking(false);
      if (dncHit) {
        setDncWarning(true);
        return;
      }
    }
    setDncWarning(false);

    if (!dialerReady) {
      toast.error("Dialer not ready. Please wait and try again.");
      return;
    }

    // For Open Pool, claim the lead
    if (isOpenPool && currentLead) {
      await supabase.from("campaign_leads")
        .update({ status: "Claimed", claimed_by: agentId, claimed_at: new Date().toISOString() })
        .eq("id", currentLead.id);
      if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      setLockCountdown(null);
    }

    setActiveCallerId(currentCallerId);
    setCallStatus("connecting");
    setCallSeconds(0);
    setCallStartedAt(new Date());
    setMuted(false);

    telnyxMakeCall(number.replace(/\D/g, ""), callerNumber);

    // Simulate connection after brief delay if Telnyx doesn't fire
    setTimeout(() => {
      setCallStatus((prev) => (prev === "connecting" ? "connected" : prev));
    }, 3000);
  };

  const handleHangUp = () => {
    telnyxHangUp();
    setCallStatus("ended");
    setMuted(false);
  };

  const handleSkipLead = async () => {
    if (currentLead) {
      await supabase.from("campaign_leads").update({ status: "Skipped" }).eq("id", currentLead.id);
    }
    advanceToNextLead();
  };

  const handleSaveNote = async () => {
    if (!newNote.trim() || !currentLead?.lead_id) return;
    const { data: inserted } = await supabase.from("contact_notes").insert({
      contact_id: currentLead.lead_id,
      contact_type: "lead",
      content: newNote,
      author_id: agentId,
    }).select("id, content, pinned, created_at, author_id").single();
    setNewNote("");
    if (inserted) {
      // Optimistically add to contactNotes (prepend) so feed updates
      setContactNotes((prev) => [inserted as any, ...prev]);
    }
    toast.success("Note saved");
  };

  const handleSaveDisposition = async () => {
    const disp = dispositions.find((d) => d.id === selectedDispId);
    if (!disp) return;

    // Validate notes
    if (disp.require_notes && dispNotes.length < disp.min_note_chars) return;

    const now = new Date();
    const endedAt = now.toISOString();
    const startedAt = callStartedAt?.toISOString() ?? endedAt;
    const duration = callSeconds;
    const contactName = currentLead ? `${currentLead.first_name} ${currentLead.last_name}` : "Manual Dial";
    const contactPhone = quickDialMode ? quickDialNumber : currentLead?.phone ?? "";

    // 1. Insert call record
    const callerIdOutcome = activeCallerId
      ? JSON.stringify({ caller_id: activeCallerId.callerNumber, match_type: activeCallerId.matchType })
      : null;
    await supabase.from("calls").insert({
      contact_id: currentLead?.lead_id ?? null,
      contact_type: "lead",
      contact_name: contactName,
      contact_phone: contactPhone,
      agent_id: agentId,
      campaign_id: selectedCampaign?.id ?? null,
      campaign_lead_id: currentLead?.id ?? null,
      direction: "outbound",
      duration,
      disposition_id: disp.id,
      disposition_name: disp.name,
      notes: dispNotes || null,
      outcome: callerIdOutcome,
      started_at: startedAt,
      ended_at: endedAt,
    });

    // 2. Update campaign_lead
    if (currentLead) {
      const closingDisps = ["Sold", "Not Interested", "Wrong Number"];
      const newStatus = closingDisps.some((d) => disp.name.includes(d)) ? "Completed" : "Called";
      await supabase.from("campaign_leads")
        .update({
          status: newStatus,
          call_attempts: currentLead.call_attempts + 1,
          last_called_at: now.toISOString(),
          disposition: disp.name,
        })
        .eq("id", currentLead.id);
    }

    // 3. Update dialer_session
    if (session) {
      const updates: any = { calls_made: session.calls_made + 1 };
      if (duration > 0) {
        updates.calls_connected = session.calls_connected + 1;
        updates.total_talk_time = session.total_talk_time + duration;
      }
      await supabase.from("dialer_sessions").update(updates).eq("id", session.id);
      setSession((prev) => prev ? { ...prev, ...updates } : prev);
    }

    // 4. Update campaign counts
    if (selectedCampaign) {
      // Direct increment approach
      const { data: cData } = await supabase.from("campaigns").select("leads_contacted, leads_converted").eq("id", selectedCampaign.id).single();
      if (cData) {
        await supabase.from("campaigns").update({
          leads_contacted: (cData.leads_contacted ?? 0) + 1,
          ...(disp.name.includes("Sold") || disp.name.includes("Appointment")
            ? { leads_converted: (cData.leads_converted ?? 0) + 1 } : {}),
        }).eq("id", selectedCampaign.id);
      }
    }

    // 5. Increment disposition usage_count
    const { data: dData } = await supabase.from("dispositions").select("usage_count").eq("id", disp.id).single();
    if (dData) {
      await supabase.from("dispositions").update({ usage_count: (dData.usage_count ?? 0) + 1 }).eq("id", disp.id);
    }

    // 6. Schedule callback if needed
    if (disp.callback_scheduler && callbackDate) {
      const cbStart = new Date(callbackDate);
      const [h, m] = callbackTime.split(":").map(Number);
      cbStart.setHours(h, m, 0, 0);
      await supabase.from("appointments").insert({
        title: `Callback — ${currentLead?.first_name ?? ""} ${currentLead?.last_name ?? ""}`,
        contact_name: contactName,
        contact_id: currentLead?.lead_id ?? null,
        type: "Follow Up",
        status: "Scheduled",
        start_time: cbStart.toISOString(),
        created_by: agentId,
        user_id: agentId,
      });
      // Log activity
      if (currentLead?.lead_id) {
        await supabase.from("contact_activities").insert({
          contact_id: currentLead.lead_id,
          contact_type: "lead",
          activity_type: "callback",
          description: `Callback scheduled for ${format(cbStart, "MMM d, yyyy h:mm a")}`,
          agent_id: agentId,
        });
      }
    }

    // 7. Trigger win celebration if this is a sale disposition
    if (isSaleDisposition(disp.name)) {
      triggerWin({
        agentId,
        agentName,
        contactName,
        contactId: currentLead?.lead_id,
        campaignId: selectedCampaign?.id,
        campaignName: selectedCampaign?.name,
        callId: undefined, // Call ID would be returned from insert if needed
        policyType: disp.name,
      });
    }

    toast.success("Disposition saved");

    // Remove the current lead from local queue and advance
    setLeads((prev) => prev.filter((_, i) => i !== currentLeadIdx));
    setCurrentLeadIdx((prev) => Math.min(prev, leads.length - 2));
    setCallStatus("idle");
    setCallSeconds(0);
    setSelectedDispId(null);
    setDispNotes("");
    setCallbackDate(undefined);
  };

  const handleSkipDisposition = async () => {
    // Log call without disposition
    const now = new Date();
    const contactName = currentLead ? `${currentLead.first_name} ${currentLead.last_name}` : "Manual Dial";
    const skipCallerIdOutcome = activeCallerId
      ? JSON.stringify({ caller_id: activeCallerId.callerNumber, match_type: activeCallerId.matchType })
      : null;
    await supabase.from("calls").insert({
      contact_id: currentLead?.lead_id ?? null,
      contact_type: "lead",
      contact_name: contactName,
      contact_phone: currentLead?.phone ?? quickDialNumber,
      agent_id: agentId,
      campaign_id: selectedCampaign?.id ?? null,
      campaign_lead_id: currentLead?.id ?? null,
      direction: "outbound",
      duration: callSeconds,
      outcome: skipCallerIdOutcome,
      started_at: callStartedAt?.toISOString(),
      ended_at: now.toISOString(),
    });
    if (session) {
      const updates: any = { calls_made: session.calls_made + 1 };
      if (callSeconds > 0) {
        updates.calls_connected = session.calls_connected + 1;
        updates.total_talk_time = session.total_talk_time + callSeconds;
      }
      await supabase.from("dialer_sessions").update(updates).eq("id", session.id);
      setSession((prev) => prev ? { ...prev, ...updates } : prev);
    }
    if (currentLead) {
      await supabase.from("campaign_leads").update({
        call_attempts: currentLead.call_attempts + 1,
        last_called_at: now.toISOString(),
      }).eq("id", currentLead.id);
    }
    setLeads((prev) => prev.filter((_, i) => i !== currentLeadIdx));
    setCurrentLeadIdx((prev) => Math.min(prev, leads.length - 2));
    setCallStatus("idle");
    setCallSeconds(0);
    setSelectedDispId(null);
    setDispNotes("");
    toast.info("Disposition skipped");
  };

  /* ── Quick Dial keypad ── */
  const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  /* ── Selected disposition object ── */
  const selectedDisp = dispositions.find((d) => d.id === selectedDispId);
  const notesValid = !selectedDisp?.require_notes || dispNotes.length >= (selectedDisp?.min_note_chars ?? 0);

  /* ════════════════════════════════════════════════════
     CAMPAIGN SELECTION SCREEN
     ════════════════════════════════════════════════════ */
  if (!selectedCampaign && !quickDialMode) {
    const filtered = campaigns.filter((c) => c.name.toLowerCase().includes(campaignSearch.toLowerCase()));
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-xs text-muted-foreground">AgentFlow / Dialer</p>
          <h1 className="text-3xl font-bold text-foreground mt-1">Start a Session</h1>
          <p className="text-muted-foreground mt-1">Select a list to begin dialing</p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={campaignSearch}
            onChange={(e) => setCampaignSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="w-full bg-background border border-input rounded-lg pl-10 pr-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <button
          onClick={() => setQuickDialMode(true)}
          className="text-sm text-primary hover:underline"
        >
          or Quick Dial →
        </button>

        {campaignsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Phone className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-foreground">No active campaigns found</p>
            <p className="text-sm text-muted-foreground">Create a campaign with leads to start dialing.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((c) => {
              const contacted = c.leads_contacted || 0;
              const converted = c.leads_converted || 0;
              const remaining = Math.max(0, c.total_leads - contacted);
              const progressPct = c.total_leads > 0 ? Math.round((contacted / c.total_leads) * 100) : 0;
              const convertRate = contacted > 0 ? ((converted / contacted) * 100).toFixed(1) : "0.0";

              return (
                <div key={c.id} className="bg-card border border-border rounded-xl flex flex-col hover:border-primary/50 hover:shadow-lg transition-all group overflow-hidden">
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="font-bold text-lg text-foreground leading-tight line-clamp-2">{c.name}</h3>
                      <span className="shrink-0 bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                        {c.type}
                      </span>
                    </div>

                    {c.description && (
                      <p className="text-xs text-muted-foreground mb-4 line-clamp-2">{c.description}</p>
                    )}

                    {/* Progress Bar */}
                    <div className="mt-auto space-y-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{contacted} Contacted</span>
                        <span>{c.total_leads} Total</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-border/50">
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Left</p>
                        <p className="font-mono text-sm font-semibold text-foreground">{remaining}</p>
                      </div>
                      <div className="text-center border-l border-r border-border/50">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Wins</p>
                        <p className="font-mono text-sm font-semibold text-success">{converted}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Close Rate</p>
                        <p className="font-mono text-sm font-semibold text-foreground">{convertRate}%</p>
                      </div>
                    </div>

                    {/* States Badges */}
                    {c.cached_states && c.cached_states.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {c.cached_states.slice(0, 5).map(state => (
                          <span key={state} className="bg-accent/50 text-accent-foreground border border-border/50 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            {state}
                          </span>
                        ))}
                        {c.cached_states.length > 5 && (
                          <span className="bg-muted text-muted-foreground border border-border/50 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-help" title={c.cached_states.slice(5).join(', ')}>
                            +{c.cached_states.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => startSession(c)}
                    className="w-full bg-accent/30 text-accent-foreground py-3.5 text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors outline-none flex items-center justify-center gap-2 border-t border-border group-hover:border-transparent"
                  >
                    <Phone className="w-4 h-4" /> Start Dialing This List
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ════════════════════════════════════════════════════
     QUICK DIAL MODE (no campaign)
     ════════════════════════════════════════════════════ */
  if (quickDialMode && !selectedCampaign) {
    return (
      <div className="max-w-md mx-auto space-y-6 py-8">
        <button onClick={() => setQuickDialMode(false)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" /> Back to Lists
        </button>
        <h2 className="text-2xl font-bold text-foreground text-center">Quick Dial</h2>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="text-center">
            <p className="text-2xl font-mono text-foreground tracking-wider min-h-[2rem]">
              {quickDialNumber || <span className="text-muted-foreground">Enter number</span>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
            {keypadKeys.map((k) => (
              <button key={k} onClick={() => setQuickDialNumber((p) => p + k)}
                className="h-12 rounded-lg bg-accent text-foreground text-lg font-medium hover:bg-accent/80 transition-colors">
                {k}
              </button>
            ))}
          </div>
          <div className="flex gap-2 max-w-[240px] mx-auto">
            <button onClick={() => setQuickDialNumber((p) => p.slice(0, -1))}
              className="flex-1 h-10 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 flex items-center justify-center">
              <Delete className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                if (quickDialNumber.length >= 10) {
                  // Start a quick session
                  setCallStatus("connecting");
                  setCallStartedAt(new Date());
                  setCallSeconds(0);
                  // Start call via Telnyx
                  if (clientRef.current && dialerReady) {
                    try {
                      const call = clientRef.current.newCall({ destinationNumber: quickDialNumber.replace(/\D/g, ""), callerNumber });
                      callRef.current = call;
                    } catch { toast.error("Call failed"); }
                  }
                  setTimeout(() => setCallStatus((p) => p === "connecting" ? "connected" : p), 3000);
                }
              }}
              disabled={quickDialNumber.length < 10}
              className="flex-[2] h-10 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Phone className="w-4 h-4" /> Call
            </button>
          </div>
        </div>

        {/* Active quick call */}
        {callStatus !== "idle" && (
          <div className="bg-card border border-border rounded-xl p-6 text-center space-y-4">
            <p className="text-lg font-mono text-foreground">{quickDialNumber}</p>
            {callStatus === "connecting" && (
              <div className="flex items-center justify-center gap-2 text-primary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Connecting...</span>
              </div>
            )}
            {callStatus === "connected" && (
              <>
                <p className="text-3xl font-mono text-foreground">{fmtTime(callSeconds)}</p>
                <div className="flex items-center justify-center gap-2 text-green-500 text-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Connected
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={() => { telnyxToggleMute(); setMuted(!muted); }}
                    className={cn("p-3 rounded-full transition-colors", telnyxIsMuted ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                    {telnyxIsMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                </div>
              </>
            )}
            {callStatus !== "ended" && (
              <button onClick={handleHangUp} className="w-full bg-destructive text-destructive-foreground rounded-lg py-3 font-medium flex items-center justify-center gap-2">
                <PhoneOff className="w-5 h-5" /> Hang Up
              </button>
            )}
            {callStatus === "ended" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Call ended · {fmtTime(callSeconds)}</p>
                <button onClick={() => { setCallStatus("idle"); setQuickDialNumber(""); setCallSeconds(0); }}
                  className="bg-primary text-primary-foreground rounded-lg px-6 py-2 text-sm font-medium">
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ════════════════════════════════════════════════════
     ACTIVE SESSION — TWO COLUMN LAYOUT
     ════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height)-2rem)] overflow-hidden">

      {/* ── Top Control Bar ── */}
      <div className="shrink-0 flex justify-between items-center border-b border-border px-4 py-2 mb-3">
        <button
          onClick={endSession}
          className="text-sm border border-destructive text-destructive rounded-lg px-3 py-1.5 hover:bg-destructive/10 transition-colors"
        >
          ← End Session
        </button>
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full animate-pulse", dialerReady ? "bg-success" : "bg-yellow-500")} />
          <span className={cn("font-semibold text-sm", dialerReady ? "text-success" : "text-yellow-500")}>
            {dialerReady ? "Dialer Ready" : "Initializing..."}
          </span>
        </div>
        <span className="text-sm text-muted-foreground">{selectedCampaign?.name ?? ""}</span>
      </div>

      {/* ── Error / DNC banners ── */}
      {dialerError && (
        <div className="shrink-0 px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <span className="text-xs text-destructive flex-1">{dialerError}</span>
          <button onClick={() => window.location.reload()} className="text-xs text-destructive underline">Retry</button>
        </div>
      )}
      {dncWarning && callStatus === "idle" && (
        <div className="shrink-0 mx-4 mb-2 bg-destructive/10 border border-destructive/30 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-destructive font-semibold text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" /> DNC Warning
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setDncWarning(false); handleSkipLead(); }} className="flex-1 border border-border bg-background text-foreground rounded-md py-1.5 text-xs font-medium hover:bg-accent transition-colors">Cancel</button>
            <button onClick={() => handleCall(true)} className="flex-1 bg-destructive text-destructive-foreground rounded-md py-1.5 text-xs font-medium hover:bg-destructive/90 transition-colors">Call Anyway</button>
          </div>
        </div>
      )}

      {/* ── Call status indicator ── */}
      {callStatus === "connecting" && (
        <div className="shrink-0 mx-4 mb-2 flex items-center gap-2 text-primary font-medium text-xs bg-primary/10 rounded-lg p-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting...
        </div>
      )}
      {callStatus === "connected" && (
        <div className="shrink-0 mx-4 mb-2 flex items-center justify-between text-xs bg-card border border-border rounded-lg p-2">
          <div className="flex items-center gap-1.5 text-success font-medium">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Connected
          </div>
          <p className="font-mono font-bold text-foreground text-sm">{fmtTime(callSeconds)}</p>
          <div className="flex gap-1">
            <button onClick={() => { telnyxToggleMute(); setMuted(!muted); }} className={cn("p-1.5 rounded transition-colors", telnyxIsMuted ? "bg-destructive/20 text-destructive" : "bg-muted hover:bg-muted/80")}>
              {telnyxIsMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => telnyxToggleHold()} className={cn("p-1.5 rounded transition-colors", telnyxIsOnHold ? "bg-yellow-500/20 text-yellow-600" : "bg-muted hover:bg-muted/80")}>
              <Pause className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Two Column Layout ── */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">

        {/* ═══ LEFT COLUMN ═══ */}
        <div className="w-[320px] shrink-0 flex flex-col gap-3 overflow-hidden">

          {/* SharkTank banner */}
          {isOpenPool && (
            <div className="shrink-0 px-3 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-semibold text-orange-500">SharkTank Mode</span>
            </div>
          )}

          {/* 1. Action Buttons Row */}
          <div className="grid grid-cols-4 gap-2 shrink-0">
            {callStatus === "idle" || callStatus === "ended" ? (
              <button
                onClick={() => handleCall()}
                disabled={dncChecking}
                className="bg-success text-success-foreground rounded-xl py-3 font-semibold text-sm flex flex-col items-center gap-1 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {dncChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                <span>Call</span>
              </button>
            ) : (
              <button
                onClick={handleHangUp}
                className="bg-destructive text-destructive-foreground rounded-xl py-3 font-semibold text-sm flex flex-col items-center gap-1 hover:opacity-90 transition-opacity"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End</span>
              </button>
            )}
            <button
              onClick={handleSkipLead}
              disabled={callStatus !== "idle"}
              className="bg-accent text-foreground border border-border rounded-xl py-3 font-semibold text-sm flex flex-col items-center gap-1 hover:bg-accent/80 transition-colors disabled:opacity-40"
            >
              <SkipForward className="w-4 h-4" />
              <span>Skip</span>
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button className="bg-accent text-foreground border border-border rounded-xl py-3 font-semibold text-sm flex flex-col items-center gap-1 hover:bg-accent/80 transition-colors">
                  <CalendarPlus className="w-4 h-4" />
                  <span>Schedule</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Schedule Appointment</h4>
                  <Calendar mode="single" selected={callbackDate} onSelect={setCallbackDate} initialFocus className="p-0 border-none" />
                  <div className="flex gap-2">
                    <input type="time" value={callbackTime} onChange={(e) => setCallbackTime(e.target.value)} className="w-full bg-background border border-input rounded-md px-2 py-1 text-sm" />
                    <button onClick={() => toast.success("Time selected. Save disposition to finalize.")} className="bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-md font-medium whitespace-nowrap">Set</button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <button
              onClick={() => setShowFullView(true)}
              className="bg-accent text-foreground border border-border rounded-xl py-3 font-semibold text-sm flex flex-col items-center gap-1 hover:bg-accent/80 transition-colors"
            >
              <Eye className="w-4 h-4" />
              <span>Full View</span>
            </button>
          </div>

          {/* 2. Call Stats */}
          <div className="grid grid-cols-3 gap-2 shrink-0">
            {[
              { label: "Calls", value: String(session?.calls_made ?? 0) },
              { label: "Connected", value: String(session?.calls_connected ?? 0) },
              { label: "Avg Duration", value: session && (session.calls_connected ?? 0) > 0 ? fmtTime(Math.round(session.total_talk_time / session.calls_connected)) : "0:00" },
              { label: "Talk Time", value: fmtDuration(session?.total_talk_time ?? 0) },
              { label: "Conv Rate", value: session && (session.calls_made ?? 0) > 0 ? `${Math.round(((session.calls_connected ?? 0) / session.calls_made) * 100)}%` : "0%" },
              { label: "Callbacks", value: "0" },
            ].map((s) => (
              <div key={s.label} className="bg-card border border-border rounded-lg p-2 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
                <p className="text-base font-bold font-mono text-foreground mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>

          {/* 3. Tab Bar + 4. Tab Content */}
          <div className="flex-1 flex flex-col border border-border rounded-lg overflow-hidden min-h-0">
            {/* Tab Bar */}
            <div className="flex shrink-0">
              {(["dispositions", "queue", "scripts"] as const).map((tab, idx) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "flex-1 py-2 text-xs font-semibold transition-colors",
                    idx > 0 && "border-l border-border",
                    activeTab === tab
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab === "dispositions" ? "Dispositions" : tab === "queue" ? "Queue" : "Scripts"}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto min-h-0">

              {/* ── Dispositions Tab ── */}
              {activeTab === "dispositions" && (
                <div className="p-3 space-y-4">
                  {/* Section A: Current contact mini-card */}
                  {currentLead ? (
                    <div className="space-y-2">
                      <div>
                        <p className="font-bold text-foreground text-sm">{currentLead.first_name} {currentLead.last_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{currentLead.phone}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-xs font-medium">{currentLead.state}</span>
                        <span className="text-xs font-bold" style={{ color: "#00ff88" }}>{getContactLocalTime(currentLead.state)}</span>
                        {currentLead.age && <span className="bg-accent text-foreground px-2 py-0.5 rounded text-xs">{currentLead.age} yrs</span>}
                      </div>
                      {telnyxNumbersLoading ? (
                        <Skeleton className="h-8 w-full rounded-lg" />
                      ) : (
                        <select
                          value={selectedTelnyxNumberId ?? ""}
                          onChange={(e) => setSelectedTelnyxNumberId(e.target.value)}
                          className="w-full bg-accent text-foreground rounded-lg text-xs border border-border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {telnyxNumbers.length === 0 ? (
                            <option value="">+19097381193</option>
                          ) : (
                            telnyxNumbers.map((n) => (
                              <option key={n.id} value={n.id}>{formatTelnyxDisplay(n)}</option>
                            ))
                          )}
                        </select>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No lead selected</p>
                  )}

                  {/* Section B: Disposition grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {dispositions.map((d, idx) => (
                      <button
                        key={d.id}
                        onClick={() => { setSelectedDispId(d.id === selectedDispId ? null : d.id); setDispNotes(""); setCallbackDate(undefined); }}
                        className={cn(
                          "flex items-center gap-2 px-2 py-2 rounded-lg text-xs border transition-colors",
                          selectedDispId !== d.id && "bg-accent border-border"
                        )}
                        style={selectedDispId === d.id ? { borderColor: d.color, backgroundColor: `${d.color}22` } : undefined}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="flex-1 font-medium text-foreground text-left leading-tight">{d.name}</span>
                        <span className="text-muted-foreground ml-auto">{idx < 9 ? idx + 1 : ""}</span>
                      </button>
                    ))}
                  </div>

                  {/* Notes field (shown when disposition requires it) */}
                  {selectedDisp?.require_notes && (
                    <input
                      type="text"
                      value={dispNotes}
                      onChange={(e) => setDispNotes(e.target.value)}
                      placeholder={`Notes (${selectedDisp.min_note_chars} chars min)...`}
                      className="w-full bg-background border border-input rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  )}

                  {/* Save Disposition button */}
                  {selectedDispId && (
                    <button
                      onClick={handleSaveDisposition}
                      disabled={!notesValid}
                      className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
                    >
                      Save Disposition
                    </button>
                  )}

                  {/* Section C: Quick Notes */}
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Quick Notes</p>
                    <textarea
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Add a note..."
                      className="w-full bg-accent border border-border rounded-lg p-2 text-sm text-foreground resize-none h-20"
                    />
                    <button
                      onClick={handleSaveNote}
                      disabled={!newNote.trim() || !currentLead?.lead_id}
                      className="w-full bg-primary text-primary-foreground rounded-lg py-2 text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
                    >
                      Save Note
                    </button>
                  </div>
                </div>
              )}

              {/* ── Queue Tab ── */}
              {activeTab === "queue" && (
                <div className="flex flex-col h-full">
                  <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
                    <span className="text-xs text-muted-foreground">{callableCount} callable · {outsideCount} outside hours · {leads.length} total</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-xs flex items-center gap-1.5 border border-border bg-background px-2 py-1.5 rounded-md text-foreground hover:bg-accent transition-colors">
                          <Filter className="w-3 h-3" /> Filter <ChevronDown className="w-3 h-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-3 space-y-3" align="end">
                        <h4 className="font-semibold text-sm">Queue Options</h4>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-foreground">Sort By</label>
                          <select className="w-full bg-background border border-input rounded text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring">
                            <option>Queue Order (Default)</option>
                            <option>Timezone (East to West)</option>
                            <option>Lead Score (High to Low)</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-foreground">Filter States</label>
                          <select className="w-full bg-background border border-input rounded text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring">
                            <option>All States</option>
                            <option>East Coast</option>
                            <option>West Coast</option>
                          </select>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {leadsLoading ? (
                      [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)
                    ) : filteredLeads.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">No leads in queue</div>
                    ) : (
                      filteredLeads.map((lead, idx) => {
                        const isCurrent = idx === currentLeadIdx;
                        const localTime = getContactLocalTime(lead.state);
                        const isHovered = hoveredLeadId === lead.id;
                        const lastCall = lead.lead_id ? leadLastCalls[lead.lead_id] : null;
                        const lastCallDispColor = lastCall?.disposition_name ? getDispColor(lastCall.disposition_name) : null;

                        return (
                          <div
                            key={lead.id}
                            className="relative"
                            onMouseEnter={() => { hoverTimerRef.current = setTimeout(() => setHoveredLeadId(lead.id), 300); }}
                            onMouseLeave={() => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); setHoveredLeadId(null); }}
                          >
                            <button
                              onClick={() => { if (callStatus === "idle") setCurrentLeadIdx(idx); }}
                              className={cn(
                                "w-full text-left rounded-lg p-2.5 transition-all border",
                                isCurrent ? "border-primary bg-primary/5" : "border-transparent hover:bg-accent",
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <span className={cn("w-2 h-2 rounded-full shrink-0", lead.callable ? "bg-green-500" : "bg-yellow-500")} />
                                <span className="font-semibold text-sm text-foreground truncate">{lead.first_name} {lead.last_name}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-1 ml-4">
                                <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">{lead.state}</span>
                                {lead.source && <span className="text-[10px] text-muted-foreground truncate">{lead.source}</span>}
                                {localTime && <span className="text-[10px] ml-auto shrink-0 font-bold" style={{ color: "#00ff88" }}>{localTime}</span>}
                              </div>
                              {isCurrent && lockCountdown !== null && (
                                <div className="mt-1 ml-4 text-[10px] text-orange-500 font-medium">⏱ {lockCountdown}s to call</div>
                              )}
                            </button>

                            {/* Hover Preview Card */}
                            <AnimatePresence>
                              {isHovered && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.95 }}
                                  transition={{ duration: 0.15, ease: "easeOut" }}
                                  className="hidden lg:block absolute left-full top-0 ml-2 z-50 w-[280px] bg-card border border-border rounded-lg shadow-lg p-3 space-y-2"
                                >
                                  <div className="absolute left-0 top-4 -translate-x-full">
                                    <div className="w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[6px] border-r-border" />
                                  </div>
                                  <div className="absolute left-0 top-4 -translate-x-[calc(100%-1px)]">
                                    <div className="w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[6px] border-r-card" />
                                  </div>
                                  <p className="font-bold text-sm text-foreground">{lead.first_name} {lead.last_name}</p>
                                  <p className="font-mono text-xs text-foreground">
                                    {isOpenPool && !isCurrent
                                      ? <span className="flex items-center gap-1 text-muted-foreground"><Lock className="w-3 h-3" /> Hidden</span>
                                      : lead.phone}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{lead.email || "No email"}</p>
                                  <div className="flex items-center gap-2 text-xs">
                                    <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">{lead.state}</span>
                                    {localTime && <span style={{ color: "#00ff88" }}>{localTime}</span>}
                                  </div>
                                  {lead.source && <p className="text-[10px] text-muted-foreground">Source: {lead.source}</p>}
                                  <div className="border-t border-border pt-2 space-y-1.5">
                                    {lastCall?.disposition_name ? (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground">Last:</span>
                                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: lastCallDispColor ? `${lastCallDispColor}20` : undefined, color: lastCallDispColor || undefined }}>{lastCall.disposition_name}</span>
                                      </div>
                                    ) : (
                                      <p className="text-[10px] text-muted-foreground italic">No previous calls</p>
                                    )}
                                    <p className="text-[10px] text-muted-foreground">{lead.call_attempts > 0 ? `${lead.call_attempts} previous attempt${lead.call_attempts !== 1 ? "s" : ""}` : "First attempt"}</p>
                                    <p className="text-[10px] text-muted-foreground">{lead.last_called_at ? `Last contacted ${timeAgo(lead.last_called_at)}` : "Never contacted"}</p>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ── Scripts Tab ── */}
              {activeTab === "scripts" && (
                <div className="p-3 space-y-3">
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="text-primary font-semibold text-sm mb-2">Opening Script</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Hi {currentLead ? currentLead.first_name : "[Name]"}, my name is {profile?.first_name ?? "your agent"} and I'm calling from AgentFlow Life Insurance. I noticed you recently inquired about life insurance coverage — I just have a couple of quick questions. Do you have two minutes?
                    </p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="font-semibold text-sm mb-2" style={{ color: "#8B5CF6" }}>Objection Handling</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      I completely understand. Many of our clients felt the same way at first. What I can do is walk you through a few options that fit your budget — no pressure, no commitment. Would that be okay with you?
                    </p>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ═══ CENTER COLUMN ═══ */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">

          {/* Contact Details Header Card */}
          <div className="bg-card border border-border rounded-xl p-4 shrink-0">
            {currentLead ? (
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: "Full Name", value: `${currentLead.first_name} ${currentLead.last_name}` },
                  { label: "Phone", value: currentLead.phone },
                  { label: "Email", value: currentLead.email || "—" },
                  { label: "State", value: currentLead.state },
                  { label: "Age", value: currentLead.age ? `${currentLead.age} yrs` : "—" },
                  { label: "Lead Source", value: currentLead.source || "Unknown" },
                  { label: "Status", value: currentLead.status },
                  { label: "Assigned", value: agentName },
                ].map((f) => (
                  <div key={f.label}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{f.label}</p>
                    <p className="text-sm font-semibold text-foreground mt-1">{f.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4 text-center">
                <Phone className="w-10 h-10 text-muted-foreground mb-2" />
                <p className="text-sm font-medium text-foreground">No leads in queue</p>
                <p className="text-xs text-muted-foreground">All leads have been called or are outside calling hours.</p>
              </div>
            )}
          </div>

          {/* Conversation History */}
          <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden min-h-0">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border shrink-0">
              <span className="font-semibold text-sm text-foreground">Conversation History</span>
            </div>

            {/* Scrollable feed */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {historyLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : filteredFeed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <MessageSquare className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No conversation history yet</p>
                </div>
              ) : (
                <>
                  {filteredFeed.map((item) => {
                    const expanded = expandedFeedItems.has(item.id);

                    if (item.type === "call") {
                      const c = item.data as CallRecord;
                      const connected = (c.duration ?? 0) > 0;
                      return (
                        <div key={item.id} className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                            <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm text-foreground">Call — {c.disposition_name || (connected ? "Connected" : "No Answer")}{connected ? ` · ${fmtTime(c.duration!)}` : ""}</p>
                            <p className="text-xs text-muted-foreground">{formatMessageTime(item.timestamp)}</p>
                          </div>
                        </div>
                      );
                    }

                    if (item.type === "note") {
                      const n = item.data as ContactNote;
                      return (
                        <div key={item.id} className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm text-foreground cursor-pointer" onClick={() => toggleFeedExpand(item.id)}>{expanded ? n.content : n.content.length > 120 ? n.content.slice(0, 120) + "…" : n.content}</p>
                            <p className="text-xs text-muted-foreground">{formatMessageTime(item.timestamp)}</p>
                          </div>
                        </div>
                      );
                    }

                    if (item.type === "appointment") {
                      const a = item.data as AppointmentRecord;
                      return (
                        <div key={item.id} className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm text-foreground">{a.type} — {a.status}</p>
                            <p className="text-xs text-muted-foreground">{formatMessageTime(item.timestamp)}</p>
                          </div>
                        </div>
                      );
                    }

                    if (item.type === "sms" || item.type === "email") {
                      const isMsg = item.id.startsWith("msg-");
                      const direction = isMsg ? (item.data as MessageRecord).direction : ((item.data as ActivityRecord).metadata?.direction || "outbound");
                      const body = isMsg ? (item.data as MessageRecord).body : (item.data as ActivityRecord).description;
                      const channel = item.type === "sms" ? "SMS" : "Email";
                      const isOutbound = direction === "outbound";

                      return (
                        <div key={item.id} className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
                          <div className="max-w-[70%]">
                            <div className={cn(
                              "px-4 py-2.5 text-sm leading-relaxed",
                              isOutbound
                                ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                                : "bg-accent text-foreground rounded-2xl rounded-bl-sm"
                            )}>
                              {body}
                            </div>
                            <p className={cn("text-xs text-muted-foreground mt-1", isOutbound ? "text-right" : "text-left")}>
                              {channel} · {formatMessageTime(item.timestamp)}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    if (item.type === "activity") {
                      const a = item.data as ActivityRecord;
                      return (
                        <div key={item.id} className="flex items-start gap-3">
                          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm text-foreground">{a.description}</p>
                            <p className="text-xs text-muted-foreground">{formatMessageTime(item.timestamp)}</p>
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}
                  <div ref={feedEndRef} />
                </>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-border px-4 py-3 shrink-0 space-y-2">
              {/* Channel tabs */}
              <div className="flex bg-muted rounded-lg p-0.5 w-fit">
                <button onClick={() => setComposerChannel("sms")} className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors", composerChannel === "sms" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>SMS</button>
                <button onClick={() => setComposerChannel("email")} className={cn("px-3 py-1 rounded-md text-xs font-medium transition-colors", composerChannel === "email" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>Email</button>
              </div>

              {/* Email subject */}
              {composerChannel === "email" && (
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject..."
                  className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}

              {/* Input + Send row */}
              <div className="flex gap-2">
                <input
                  value={composerChannel === "sms" ? smsBody : emailBody}
                  onChange={(e) => composerChannel === "sms" ? setSmsBody(e.target.value) : setEmailBody(e.target.value)}
                  placeholder={composerChannel === "sms" ? "Type a message..." : "Type an email..."}
                  className="flex-1 bg-accent border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                />
                <button
                  onClick={handleSendMessage}
                  className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  Send
                </button>
              </div>

              {/* Templates button */}
              <div className="relative">
                <button
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="bg-accent text-muted-foreground border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent/80 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" /> Templates
                </button>
                {showTemplates && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 bg-card border border-border rounded-xl shadow-xl p-2 space-y-1 z-50">
                    {[
                      { name: "Intro Message", text: `Hi ${currentLead?.first_name ?? ""}, I'm reaching out about your life insurance inquiry. Is now a good time to chat?` },
                      { name: "Follow Up", text: `Hi ${currentLead?.first_name ?? ""}, just following up from our recent conversation. Do you have a few minutes this week?` },
                      { name: "Appointment Reminder", text: `Hi ${currentLead?.first_name ?? ""}, just a reminder about your appointment. Looking forward to speaking with you!` },
                    ].map((t) => (
                      <button
                        key={t.name}
                        onClick={() => { if (composerChannel === "sms") setSmsBody(t.text); else setEmailBody(t.text); setShowTemplates(false); }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-xs transition-colors"
                      >
                        <p className="font-medium text-foreground">{t.name}</p>
                        <p className="text-muted-foreground line-clamp-1 mt-0.5">{t.text}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Full View Dialog ── */}
      <Dialog open={showFullView} onOpenChange={setShowFullView}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{currentLead ? `${currentLead.first_name} ${currentLead.last_name}` : "Contact Details"}</DialogTitle>
            <DialogDescription>Full contact information</DialogDescription>
          </DialogHeader>
          {currentLead && (
            <div className="grid grid-cols-2 gap-4 mt-4">
              {[
                { label: "Full Name", value: `${currentLead.first_name} ${currentLead.last_name}` },
                { label: "Phone", value: currentLead.phone },
                { label: "Email", value: currentLead.email || "—" },
                { label: "State", value: currentLead.state },
                { label: "Age", value: currentLead.age ? `${currentLead.age} yrs` : "—" },
                { label: "Lead Source", value: currentLead.source || "Unknown" },
                { label: "Status", value: currentLead.status },
                { label: "Assigned", value: agentName },
                { label: "Call Attempts", value: `${currentLead.call_attempts}` },
                { label: "Last Disposition", value: currentLead.disposition || "None" },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">{f.label}</p>
                  <p className="text-foreground text-sm font-medium">{f.value}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      
      {/* ── Session Summary Modal ── */}
      <AnimatePresence>
        {showSummary && summaryData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-8 space-y-6"
            >
              <div className="text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Session Complete</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedCampaign?.name} · {fmtDuration(summaryData.duration)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Calls Made", value: summaryData.calls },
                  { label: "Connected", value: summaryData.connected },
                  {
                    label: "Answer Rate",
                    value: summaryData.calls > 0
                      ? `${Math.round((summaryData.connected / summaryData.calls) * 100)}%`
                      : "0%",
                  },
                  { label: "Total Talk Time", value: fmtDuration(summaryData.talkTime) },
                  {
                    label: "Avg Call Duration",
                    value: summaryData.connected > 0
                      ? fmtTime(Math.round(summaryData.talkTime / summaryData.connected))
                      : "0:00",
                  },
                  {
                    label: "Conversion Rate",
                    value: summaryData.calls > 0
                      ? `${Math.round(((summaryData.connected) / summaryData.calls) * 100)}%`
                      : "0%",
                  },
                ].map((s) => (
                  <div key={s.label} className="bg-accent/50 rounded-xl p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                    <p className="text-lg font-bold font-mono text-foreground mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>

              <button
                onClick={resetAfterSession}
                className="w-full bg-primary text-primary-foreground rounded-xl py-3 font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DialerPage;
