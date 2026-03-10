import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Pause,
  SkipForward, Search, ChevronLeft, Loader2,
  AlertTriangle, Delete, Lock,
  Zap, ExternalLink, FileText,
  CalendarPlus, CheckCircle,
  Pencil, Send, Eye,
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

  /* ── Right panel tab ── */
  const [rightPanelTab, setRightPanelTab] = useState<"activity" | "scripts" | "queue">("activity");

  /* ── Message Composer ── */
  const [messageTab, setMessageTab] = useState<"sms" | "email">("sms");
  const [messageText, setMessageText] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);

  /* ── Telnyx Numbers (from DB) ── */
  const [telnyxNumbers, setTelnyxNumbers] = useState<{ id: string; phone_number: string; label: string | null; is_default: boolean }[]>([]);
  const [telnyxNumbersLoading, setTelnyxNumbersLoading] = useState(true);
  const [selectedFromNumberId, setSelectedFromNumberId] = useState<string | null>(null);

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

  /* ── Fetch telnyx_numbers ── */
  useEffect(() => {
    const fetchTelnyxNumbers = async () => {
      setTelnyxNumbersLoading(true);
      const { data, error } = await supabase
        .from("telnyx_numbers")
        .select("id, phone_number, label, is_default");
      if (data && data.length > 0) {
        setTelnyxNumbers(data);
        const defaultNum = data.find((n: any) => n.is_default);
        setSelectedFromNumberId(defaultNum ? defaultNum.id : data[0].id);
      } else {
        // Fallback
        setTelnyxNumbers([{ id: "fallback", phone_number: "+19097381193", label: "Main Line", is_default: true }]);
        setSelectedFromNumberId("fallback");
      }
      setTelnyxNumbersLoading(false);
    };
    fetchTelnyxNumbers();
  }, []);

  const selectedFromNumber = telnyxNumbers.find((n) => n.id === selectedFromNumberId);

  /* ── Mock conversation data for unified panel ── */
  const mockConversation = useMemo(() => [
    { id: "mock-sms-1", direction: "outbound", channel: "sms", text: `Hi ${currentLead?.first_name || "there"}, this is ${agentName}. I'm reaching out regarding your life insurance inquiry. Do you have a few minutes to chat?`, timestamp: "2026-03-10T09:15:00Z" },
    { id: "mock-sms-2", direction: "outbound", channel: "sms", text: "I have some great options that could fit your budget. Let me know when works best for a quick call!", timestamp: "2026-03-10T09:16:00Z" },
    { id: "mock-sms-3", direction: "inbound", channel: "sms", text: "Hi! Yes I'm interested. Can you call me this afternoon?", timestamp: "2026-03-10T10:30:00Z" },
    { id: "mock-call-1", type: "call", disposition: "Callback Requested", duration: "3:42", timestamp: "2026-03-10T14:00:00Z" },
    { id: "mock-email-1", direction: "outbound", channel: "email", text: `Hi ${currentLead?.first_name || "there"}, following up on our call today. Attached are the policy details we discussed. Please review and let me know if you have questions.`, timestamp: "2026-03-10T14:30:00Z" },
    { id: "mock-note-1", type: "note", text: "Client interested in whole life policy, wants to discuss with spouse first. Follow up Thursday.", timestamp: "2026-03-10T14:35:00Z" },
  ], [currentLead?.first_name, agentName]);

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
      return;
    }
    const lid = currentLead.lead_id;
    setHistoryLoading(true);

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

      const [notesRes, callsRes, activitiesRes, apptRes] = await Promise.all([notesP, callsP, activitiesP, apptP]);
      
      const notes = notesRes.data || [];
      const calls = (callsRes.data as CallRecord[]) || [];
      const acts = (activitiesRes.data as ActivityRecord[]) || [];
      const appts = (apptRes.data as AppointmentRecord[]) || [];

      setContactNotes(notes);
      setCallHistory(calls);
      setActivities(acts);
      setAppointments(appts);

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

    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return items;
  }, [callHistory, contactNotes, appointments, activities]);

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
     ACTIVE SESSION — THREE PANEL LAYOUT
     ════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-height)-2rem)] overflow-hidden">
      {/* ── Session Stats Bar ── */}
      <div className="shrink-0 bg-card border border-border rounded-xl px-4 py-2 mb-3 flex items-center gap-6 overflow-x-auto">
        <button onClick={endSession} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0">
          <ChevronLeft className="w-4 h-4" /> End
        </button>
        <div className="flex items-center gap-6 text-center">
          {[
            { label: "Duration", value: fmtDuration(sessionSeconds) },
            { label: "Calls", value: session?.calls_made ?? 0 },
            { label: "Connected", value: session?.calls_connected ?? 0 },
            { label: "Avg Duration", value: session && session.calls_connected > 0 ? fmtTime(Math.round(session.total_talk_time / session.calls_connected)) : "0:00" },
            { label: "Talk Time", value: fmtDuration(session?.total_talk_time ?? 0) },
          ].map((s) => (
            <div key={s.label} className="shrink-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              <p className="text-sm font-bold font-mono text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
        <div className="ml-auto shrink-0">
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{selectedCampaign?.name}</span>
        </div>
      </div>

      {/* ── Mobile tab switcher ── */}
      <div className="lg:hidden shrink-0 flex bg-accent rounded-lg p-0.5 mb-3">
        {(["center", "right"] as const).map((t) => (
          <button key={t} onClick={() => setMobileTab(t)}
            className={cn("flex-1 py-1.5 text-xs rounded-md text-center transition-colors",
              mobileTab === t ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground")}>
            {t === "center" ? "Call" : "Details"}
          </button>
        ))}
      </div>

      {/* ── Action Bar + Status Row ── */}
      {currentLead && (
        <div className="shrink-0 bg-card border border-border rounded-xl px-4 py-3 mb-3 flex items-center justify-between gap-4">
          {/* LEFT: 2x2 action grid */}
          <div className="grid grid-cols-2 gap-2">
            {/* Call / End Call */}
            {callStatus === "idle" ? (
              <button onClick={() => handleCall()} disabled={dncChecking}
                className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                {dncChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />} Call
              </button>
            ) : callStatus !== "ended" ? (
              <button onClick={handleHangUp}
                className="bg-destructive text-destructive-foreground rounded-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2 hover:bg-destructive/90 transition-colors">
                <PhoneOff className="w-4 h-4" /> End Call
              </button>
            ) : (
              <button disabled className="bg-green-600/50 text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
                <Phone className="w-4 h-4" /> Call
              </button>
            )}
            {/* Skip */}
            <button onClick={handleSkipLead} disabled={callStatus !== "idle"}
              className="bg-muted text-foreground rounded-lg px-4 py-2 text-sm font-bold hover:bg-accent transition-colors flex items-center justify-center gap-2 disabled:opacity-40">
              <SkipForward className="w-4 h-4" /> Skip
            </button>
            {/* Schedule */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="border border-purple-500/50 text-purple-600 rounded-lg px-4 py-2 text-sm font-bold hover:bg-purple-500/10 transition-colors flex items-center justify-center gap-2">
                  <CalendarPlus className="w-4 h-4" /> Schedule
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
            {/* Full View */}
            {currentLead?.lead_id ? (
              <button
                onClick={() => navigate(`/leads/${currentLead.lead_id}`)}
                className="border border-border bg-muted text-foreground rounded-lg px-4 py-2 text-sm font-bold hover:bg-accent transition-colors flex items-center justify-center gap-2"
              >
                <Eye className="w-4 h-4" /> Full View
              </button>
            ) : (
              <button disabled className="border border-border bg-muted text-foreground/50 rounded-lg px-4 py-2 text-sm font-bold flex items-center justify-center gap-2 opacity-40 cursor-not-allowed">
                <Eye className="w-4 h-4" /> Full View
              </button>
            )}
          </div>
          {/* RIGHT: Status pill */}
          <div className={cn("flex items-center gap-2 rounded-full px-3 py-1.5", dialerReady ? "bg-green-500/10" : "bg-yellow-500/10")}>
            <span className={cn("w-2 h-2 rounded-full animate-pulse", dialerReady ? "bg-green-500" : "bg-yellow-500")} />
            <span className={cn("text-xs font-medium whitespace-nowrap", dialerReady ? "text-green-600" : "text-yellow-600")}>
              {dialerReady ? "Dialer Ready" : "Initializing..."}
            </span>
          </div>
        </div>
      )}

      {/* ── Main Workspace ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 min-h-0 overflow-hidden">

        {/* ═══ LEFT PANEL (Activity / Scripts / Queue) ═══ */}
        <div className={cn("lg:col-span-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden",
          mobileTab !== "right" && "hidden lg:flex")}>

          {/* Tab bar */}
          <div className="shrink-0 flex border-b border-border">
            {(["activity", "scripts", "queue"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightPanelTab(tab)}
                className={cn(
                  "flex-1 py-2.5 text-sm font-medium text-center capitalize transition-colors",
                  rightPanelTab === tab
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "activity" ? "Activity" : tab === "scripts" ? "Scripts" : "Queue"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* ── Activity Tab ── */}
            {rightPanelTab === "activity" && (
              <>
                {!currentLead ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Phone className="w-10 h-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">Select a list and start dialing</p>
                  </div>
                ) : (
                  <>
                    {/* Contact Details Card */}
                    <div className="bg-accent/30 rounded-xl p-4 space-y-3">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact Details</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Full Name</p>
                          <p className="font-medium text-foreground">{currentLead.first_name} {currentLead.last_name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Phone</p>
                          <p className="font-mono text-foreground">{isOpenPool && lockCountdown !== null ? "Hidden" : currentLead.phone}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Email</p>
                          <p className="text-foreground break-all">{currentLead.email || "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">State</p>
                          <p className="text-foreground">{currentLead.state}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Age</p>
                          <p className="text-foreground">{currentLead.age ? `${currentLead.age} yrs` : "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Lead Source</p>
                          <p className="text-foreground">{currentLead.source || "Unknown"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Status</p>
                          <p className="text-foreground">{currentLead.status}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Assigned</p>
                          <p className="text-foreground">{agentName}</p>
                        </div>
                      </div>
                    </div>

                    {/* Pinned Notes (moved from Scripts tab) */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Pinned Notes</h4>
                      {contactNotes.length > 0 && (
                        <div className="space-y-1">
                          {contactNotes.filter((n) => n.pinned).map((n) => (
                            <div key={n.id} className="text-[11px] bg-accent/50 rounded-md p-1.5 text-foreground line-clamp-2">
                              <span className="text-primary mr-1">📌</span>{n.content}
                            </div>
                          ))}
                          {contactNotes.filter((n) => !n.pinned).slice(0, 2).map((n) => (
                            <div key={n.id} className="text-[11px] bg-accent/50 rounded-md p-1.5 text-foreground line-clamp-2">
                              {n.content}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Quick note..." className="flex-1 bg-background border border-input rounded-lg p-2 text-xs text-foreground resize-none h-16 focus:outline-none focus:ring-1 focus:ring-ring" />
                        <button onClick={handleSaveNote} disabled={!newNote.trim()} className="self-end bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"><Pencil className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Scripts Tab ── */}
            {rightPanelTab === "scripts" && (
              <>
                {!currentLead ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <FileText className="w-10 h-10 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No lead selected</p>
                  </div>
                ) : (
                  <>
                    {/* Script sections */}
                    <div className="border border-border rounded-xl overflow-hidden shadow-sm">
                      <button onClick={() => setScriptCollapsed(!scriptCollapsed)} className="w-full flex items-center justify-between px-3 py-2 bg-accent/50 hover:bg-accent transition-colors">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Call Script</span>
                        <ChevronLeft className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", scriptCollapsed ? "-rotate-90" : "rotate-90")} />
                      </button>
                      {!scriptCollapsed && (
                        <div className="p-3 max-h-[300px] overflow-y-auto text-xs text-foreground whitespace-pre-wrap bg-card">
                          {scriptContent ? scriptContent.replace(/\{first_name\}/g, currentLead.first_name).replace(/\{last_name\}/g, currentLead.last_name).replace(/\{state\}/g, currentLead.state).replace(/\{agent_name\}/g, agentName) : <p className="text-muted-foreground italic">No script assigned.</p>}
                        </div>
                      )}
                    </div>

                  </>
                )}
              </>
            )}

            {/* ── Queue Tab ── */}
            {rightPanelTab === "queue" && (
              <>
                {/* Campaign info */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Power Dialer</span>
                      <span className="text-xs text-muted-foreground">{leads.length} remaining</span>
                    </div>
                  </div>
                  {isOpenPool && (
                    <div className="flex items-center gap-2 bg-orange-500/10 rounded-lg p-2">
                      <Zap className="w-4 h-4 text-orange-500" />
                      <span className="text-xs font-semibold text-orange-500">SharkTank Mode</span>
                    </div>
                  )}
                </div>

                {/* Next 2 leads */}
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Up Next</h4>
                  {leadsLoading ? (
                    [1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)
                  ) : leads.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No leads in queue</p>
                  ) : (
                    filteredLeads.slice(currentLeadIdx, currentLeadIdx + 2).map((lead, idx) => {
                      const actualIdx = currentLeadIdx + idx;
                      const isCurrent = actualIdx === currentLeadIdx;
                      const localTime = getContactLocalTime(lead.state);
                      return (
                        <button
                          key={lead.id}
                          onClick={() => { if (callStatus === "idle") setCurrentLeadIdx(actualIdx); }}
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
                            <span className="text-[10px] bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{lead.state}</span>
                            {lead.age && <span className="text-[10px] text-muted-foreground">{lead.age} yrs</span>}
                            {lead.source && <span className="text-[10px] text-muted-foreground truncate">{lead.source}</span>}
                            {localTime && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{localTime}</span>}
                          </div>
                          {/* Attempt dots */}
                          {lead.call_attempts > 0 && (
                            <div className="flex items-center gap-0.5 mt-1 ml-4">
                              {Array.from({ length: Math.min(lead.call_attempts, 5) }).map((_, i) => (
                                <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Pause & End Session */}
                <div className="space-y-2 pt-4">
                  <p className="text-[10px] text-muted-foreground">
                    {callableCount} callable · {outsideCount} outside hours · {leads.length} total
                  </p>
                  <button onClick={endSession}
                    className="w-full border border-destructive text-destructive rounded-lg py-2.5 text-sm font-medium hover:bg-destructive/10 transition-colors">
                    End Session
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ═══ CENTER PANEL ═══ */}
        <div className={cn("lg:col-span-3 bg-card border border-border rounded-xl flex flex-col overflow-hidden relative",
          mobileTab !== "center" && "hidden lg:flex")}>

          {/* Error banner */}
          {dialerError && (
            <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2 shrink-0">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-xs text-destructive flex-1">{dialerError}</span>
              <button onClick={() => window.location.reload()} className="text-xs text-destructive underline">Retry</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {!currentLead && !quickDialMode ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Phone className="w-16 h-16 text-muted-foreground mb-4" />
                <p className="text-lg font-medium text-foreground">No leads in queue</p>
                <p className="text-sm text-muted-foreground">All leads have been called or are outside calling hours.</p>
              </div>
            ) : (
              <>
                {/* ── Contact Header ── */}
                {currentLead && (
                  <div className="text-center space-y-3 pb-4 border-b border-border">
                    <h2 className="text-3xl font-bold text-foreground">{currentLead.first_name} {currentLead.last_name}</h2>
                    <p className="font-mono text-lg text-foreground">
                      {isOpenPool && lockCountdown !== null ? (
                        <span className="text-orange-500 inline-flex items-center justify-center gap-1"><Lock className="w-4 h-4" /> Locked</span>
                      ) : currentLead.phone}
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-sm bg-accent px-2 py-0.5 rounded text-accent-foreground font-medium">{currentLead.state}</span>
                      <span className="text-sm bg-accent px-2 py-0.5 rounded text-teal-500 font-medium">{getContactLocalTime(currentLead.state)}</span>
                      {currentLead.age && <span className="text-sm bg-accent px-2 py-0.5 rounded text-accent-foreground font-medium">{currentLead.age} yrs</span>}
                    </div>
                    {/* From number dropdown */}
                    <div className="max-w-xs mx-auto w-full">
                      {telnyxNumbersLoading ? (
                        <div className="bg-accent text-muted-foreground rounded-lg px-4 py-2 text-sm text-center flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading numbers...
                        </div>
                      ) : (
                        <select
                          value={selectedFromNumberId || ""}
                          onChange={(e) => setSelectedFromNumberId(e.target.value)}
                          className="w-full bg-accent text-foreground rounded-lg px-4 py-2 text-sm font-mono font-semibold text-center appearance-none cursor-pointer border border-border focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {telnyxNumbers.map((n) => (
                            <option key={n.id} value={n.id}>
                              From: {formatPhoneDisplay(n.phone_number)}{n.label ? ` — ${n.label}` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Call Status Indicators + Disposition Wrap-up ── */}
                {currentLead && (
                  <div className="space-y-4 max-w-lg mx-auto w-full">
                    {/* DNC Warning */}
                    {dncWarning && callStatus === "idle" && (
                      <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-destructive font-semibold text-xs">
                          <AlertTriangle className="w-4 h-4 shrink-0" /> DNC Warning
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setDncWarning(false); handleSkipLead(); }} className="flex-1 border border-border bg-background text-foreground rounded-md py-1.5 text-xs font-medium hover:bg-accent transition-colors">Cancel</button>
                          <button onClick={() => handleCall(true)} className="flex-1 bg-destructive text-destructive-foreground rounded-md py-1.5 text-xs font-medium hover:bg-destructive/90 transition-colors">Call Anyway</button>
                        </div>
                      </div>
                    )}

                    {/* Connecting indicator */}
                    {callStatus === "connecting" && (
                      <div className="flex items-center justify-center gap-2 text-primary font-medium text-sm bg-primary/10 rounded-lg p-4">
                        <Loader2 className="w-5 h-5 animate-spin" /> Connecting...
                      </div>
                    )}

                    {/* Connected timer + controls */}
                    {callStatus === "connected" && (
                      <div className="text-center space-y-3 py-4">
                        <div className="flex items-center justify-center gap-1.5 text-green-500 text-sm font-medium">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Connected
                        </div>
                        <p className="text-4xl font-mono font-bold text-foreground">{fmtTime(callSeconds)}</p>
                        <div className="flex justify-center gap-3">
                          <button onClick={() => { telnyxToggleMute(); setMuted(!muted); }}
                            className={cn("p-3 rounded-full transition-colors", telnyxIsMuted ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                            {telnyxIsMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                          </button>
                          <button onClick={() => telnyxToggleHold()}
                            className={cn("p-3 rounded-full transition-colors", telnyxIsOnHold ? "bg-yellow-500/20 text-yellow-600" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                            <Pause className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Disposition grid (wrap-up) */}
                    <AnimatePresence>
                      {callStatus === "ended" && (
                        <motion.div
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          className="space-y-4"
                        >
                          <p className="text-sm text-muted-foreground text-center">Call ended · {fmtTime(callSeconds)}</p>
                          <div className="grid grid-cols-3 gap-2">
                            {dispositions.map((d, idx) => (
                              <button
                                key={d.id}
                                onClick={() => { setSelectedDispId(d.id); setDispNotes(""); setCallbackDate(undefined); }}
                                className={cn(
                                  "py-3 px-4 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2",
                                  selectedDispId === d.id
                                    ? "border-ring ring-1 ring-ring/30 shadow-sm"
                                    : "border-border hover:border-ring/50"
                                )}
                              >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{idx + 1}</span>
                                <span className="text-foreground truncate">{d.name}</span>
                              </button>
                            ))}
                          </div>

                          {/* Notes input if required */}
                          {selectedDisp?.require_notes && (
                            <input
                              type="text"
                              value={dispNotes}
                              onChange={(e) => setDispNotes(e.target.value)}
                              placeholder={`Notes required (min ${selectedDisp.min_note_chars} chars)...`}
                              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          )}

                          {/* Callback scheduler */}
                          {selectedDisp?.callback_scheduler && (
                            <div className="flex items-center gap-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="flex items-center gap-1.5 bg-accent text-accent-foreground border border-border px-3 py-2 rounded-lg text-sm hover:bg-accent/80 transition-colors">
                                    <CalendarPlus className="w-4 h-4" />
                                    {callbackDate ? format(callbackDate, "MMM d, yyyy") : "Schedule Callback"}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-3" align="start">
                                  <Calendar mode="single" selected={callbackDate} onSelect={setCallbackDate} initialFocus className="p-0 border-none" />
                                  <div className="flex gap-2 mt-2">
                                    <input type="time" value={callbackTime} onChange={(e) => setCallbackTime(e.target.value)} className="w-full bg-background border border-input rounded-md px-2 py-1 text-sm" />
                                  </div>
                                </PopoverContent>
                              </Popover>
                              {callbackDate && (
                                <span className="text-xs text-muted-foreground">at {callbackTime}</span>
                              )}
                            </div>
                          )}

                          {/* Save / Skip buttons */}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveDisposition()}
                              disabled={!selectedDispId || !notesValid}
                              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors py-3 rounded-lg text-sm font-bold disabled:opacity-50"
                            >
                              Save Disposition
                            </button>
                            <button
                              onClick={() => handleSkipDisposition()}
                              className="border border-border bg-accent/30 text-foreground hover:bg-accent transition-colors py-3 px-6 rounded-lg text-sm font-medium"
                            >
                              Skip
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* ── Contact Details ── */}
                {currentLead && callStatus !== "ended" && (
                  <div className="bg-accent/30 rounded-xl p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact Details</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Full Name</p>
                        <p className="font-medium text-foreground">{currentLead.first_name} {currentLead.last_name}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Phone</p>
                        <p className="font-mono text-foreground">{isOpenPool && lockCountdown !== null ? "Hidden" : currentLead.phone}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Email</p>
                        <p className="text-foreground break-all">{currentLead.email || "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">State</p>
                        <p className="text-foreground">{currentLead.state}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Age</p>
                        <p className="text-foreground">{currentLead.age ? `${currentLead.age} yrs` : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Lead Source</p>
                        <p className="text-foreground">{currentLead.source || "Unknown"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Status</p>
                        <p className="text-foreground">{currentLead.status}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Assigned</p>
                        <p className="text-foreground">{agentName}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Unified Conversation Panel (GHL-style) ── */}
                {currentLead && callStatus !== "ended" && (
                  <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col h-[420px]">
                    {/* Tab bar: SMS / Email */}
                    <div className="shrink-0 flex border-b border-border">
                      {(["sms", "email"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setMessageTab(tab)}
                          className={cn(
                            "flex-1 py-2.5 text-sm font-medium text-center uppercase tracking-wider transition-colors",
                            messageTab === tab
                              ? "border-b-2 border-primary text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {/* Scrollable conversation history feed */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {mockConversation.map((item) => {
                        // Call entry
                        if (item.type === "call") {
                          return (
                            <div key={item.id} className="flex justify-center">
                              <div className="bg-muted text-muted-foreground rounded-full px-3 py-1.5 text-[11px] font-medium flex items-center gap-1.5">
                                <Phone className="w-3 h-3" />
                                Call — {item.disposition} · {item.duration} · {format(new Date(item.timestamp), "h:mm a")}
                              </div>
                            </div>
                          );
                        }
                        // Note entry
                        if (item.type === "note") {
                          return (
                            <div key={item.id} className="flex justify-center">
                              <div className="bg-yellow-500/10 text-yellow-700 rounded-full px-3 py-1.5 text-[11px] font-medium flex items-center gap-1.5 max-w-[80%]">
                                <FileText className="w-3 h-3 shrink-0" />
                                <span className="truncate">Note: {item.text}</span>
                              </div>
                            </div>
                          );
                        }
                        // SMS / Email message bubble
                        const isOutbound = item.direction === "outbound";
                        return (
                          <div key={item.id} className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
                            <div className="max-w-[75%] space-y-0.5">
                              <div className={cn(
                                "px-3 py-2 text-sm",
                                isOutbound
                                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                                  : "bg-accent text-foreground rounded-2xl rounded-bl-sm"
                              )}>
                                {item.text}
                              </div>
                              <p className={cn("text-[10px] text-muted-foreground px-1", isOutbound ? "text-right" : "text-left")}>
                                {(item.channel || "sms").toUpperCase()} · {format(new Date(item.timestamp), "h:mm a")}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={feedEndRef} />
                    </div>

                    {/* Message composer pinned to bottom */}
                    <div className="shrink-0 border-t border-border p-3 space-y-2">
                      {messageTab === "email" && (
                        <input
                          type="text"
                          value={messageSubject}
                          onChange={(e) => setMessageSubject(e.target.value)}
                          placeholder="Subject..."
                          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      )}
                      <textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        rows={3}
                        placeholder="Type a message..."
                        className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="flex items-center gap-2">
                        {/* Templates dropdown */}
                        <div className="relative">
                          <button
                            onClick={() => setTemplateDropdownOpen(!templateDropdownOpen)}
                            className="border border-border bg-background text-foreground rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent transition-colors flex items-center gap-2"
                          >
                            <FileText className="w-4 h-4" /> Templates
                          </button>
                          {templateDropdownOpen && (
                            <div className="absolute bottom-full mb-1 left-0 z-10 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[200px]">
                              {[
                                { label: "Intro Message", text: `Hi ${currentLead.first_name}, this is ${agentName} reaching out about your life insurance inquiry. I'd love to connect and answer any questions you have!` },
                                { label: "Follow Up", text: `Hi ${currentLead.first_name}, just following up on our earlier conversation. Are you still interested in exploring your life insurance options?` },
                                { label: "Appointment Reminder", text: `Hi ${currentLead.first_name}, this is a reminder about your upcoming appointment. Please let me know if you need to reschedule!` },
                              ].map((t) => (
                                <button
                                  key={t.label}
                                  onClick={() => { setMessageText(t.text); setTemplateDropdownOpen(false); }}
                                  className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => { toast.success(`${messageTab === "sms" ? "SMS" : "Email"} sent!`); setMessageText(""); setMessageSubject(""); }}
                          className="ml-auto bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                        >
                          <Send className="w-4 h-4" /> {messageTab === "sms" ? "Send SMS" : "Send Email"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Disposition History ── */}
                {currentLead && callStatus !== "ended" && (
                  <div>
                    <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Disposition History</h4>
                    {callHistory.length === 0 ? (
                      <p className="text-[11px] text-green-500 italic">First attempt — no history</p>
                    ) : (
                      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                        {[...callHistory].map((c, idx) => {
                          const attemptNum = callHistory.length - idx;
                          const dispColor = getDispColor(c.disposition_name);
                          return (
                            <div key={c.id} className="flex items-center gap-2 text-[11px] bg-accent/30 rounded-lg p-1.5">
                              <span className="text-muted-foreground font-mono shrink-0">#{attemptNum}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-foreground">{c.started_at ? timeAgo(c.started_at) : "—"}</p>
                              </div>
                              {c.disposition_name ? (
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-medium" style={{ backgroundColor: dispColor ? `${dispColor}20` : undefined, color: dispColor || undefined }}>{c.disposition_name}</span>
                              ) : (
                                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-muted text-muted-foreground">No Disp</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      
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
