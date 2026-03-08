import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Voicemail,
  Clock, SkipForward, Search, ChevronLeft, Loader2,
  ArrowRight, AlertTriangle, X, Hash, Delete,
  Zap, User, Mail, MapPin, ExternalLink, FileText,
  MessageSquare, CalendarPlus, CheckCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentStatus } from "@/contexts/AgentStatusContext";
import { supabase } from "@/integrations/supabase/client";
import { TelnyxRTC } from "@telnyx/webrtc";
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
  started_at: string | null;
  agent_id: string | null;
}

interface ActivityRecord {
  id: string;
  activity_type: string;
  description: string;
  created_at: string;
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

  /* ── Call script ── */
  const [scriptContent, setScriptContent] = useState<string | null>(null);
  const [scriptCollapsed, setScriptCollapsed] = useState(false);

  /* ── Telnyx WebRTC ── */
  const clientRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const [dialerReady, setDialerReady] = useState(false);
  const [dialerError, setDialerError] = useState<string | null>(null);
  const [callerNumber, setCallerNumber] = useState("+10000000000");

  /* ── Open Pool / SharkTank ── */
  const [lockCountdown, setLockCountdown] = useState<number | null>(null);
  const lockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  /* ── Mobile tab ── */
  const [mobileTab, setMobileTab] = useState<"center" | "left" | "right">("center");

  /* ── Session summary modal ── */
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{ calls: number; connected: number; talkTime: number; duration: number } | null>(null);

  /* ── DNC warning ── */
  const [dncWarning, setDncWarning] = useState(false);
  const [dncChecking, setDncChecking] = useState(false);

  /* ── Derived ── */
  const currentLead = leads[currentLeadIdx] ?? null;
  const isOpenPool = selectedCampaign?.type === "Open Pool";

  const filteredLeads = useMemo(() => {
    return leads.map((l) => {
      const hour = getLeadLocalHour(l.state);
      const callable = hour !== null && hour >= callingHoursStart && hour < callingHoursEnd;
      return { ...l, callable };
    });
  }, [leads, callingHoursStart, callingHoursEnd]);

  const callableCount = filteredLeads.filter((l) => l.callable).length;
  const outsideCount = filteredLeads.filter((l) => !l.callable).length;

  /* ═══ TELNYX INIT ═══ */
  useEffect(() => {
    let client: any;
    const init = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setDialerError("Microphone access required. Please allow and refresh.");
        return;
      }
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telnyx-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });
        if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
        const { username, password } = await res.json();
        client = new TelnyxRTC({ login: username, password });
        client.on("telnyx.ready", () => { setDialerReady(true); setDialerError(null); });
        client.on("telnyx.error", (e: any) => { setDialerError(`Dialer error: ${e.message}`); setDialerReady(false); });
        client.on("telnyx.notification", (n: any) => {
          if (n.call) {
            callRef.current = n.call;
            const st = n.call.state;
            if (st === "active") setCallStatus("connected");
            if (st === "hangup" || st === "destroy") setCallStatus("ended");
          }
        });
        clientRef.current = client;
        client.connect();
      } catch {
        setDialerError("Could not initialize dialer. Check your Telnyx settings.");
      }
    };
    init();
    return () => { if (client) try { client.disconnect(); } catch {} };
  }, []);

  /* ── Fetch caller number ── */
  useEffect(() => {
    supabase.from("phone_numbers").select("phone_number").eq("status", "active").limit(1).maybeSingle()
      .then(({ data }) => { if (data?.phone_number) setCallerNumber(data.phone_number); });
  }, []);

  /* ── Fetch campaigns ── */
  useEffect(() => {
    const fetch = async () => {
      setCampaignsLoading(true);
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, type, status, total_leads, description")
        .eq("status", "Active")
        .gt("total_leads", 0)
        .order("name");
      setCampaigns(data || []);
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
    setLeads((data as CampaignLead[]) || []);
    setCurrentLeadIdx(0);
    setLeadsLoading(false);
  }, []);

  /* ── Load contact data when current lead changes ── */
  useEffect(() => {
    if (!currentLead?.lead_id) {
      setContactNotes([]);
      setCallHistory([]);
      setActivities([]);
      return;
    }
    const lid = currentLead.lead_id;
    // notes
    supabase.from("contact_notes").select("id, content, pinned, created_at")
      .eq("contact_id", lid).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(3)
      .then(({ data }) => setContactNotes(data || []));
    // call history
    supabase.from("calls").select("id, contact_name, duration, disposition_name, started_at, agent_id")
      .eq("contact_id", lid).order("started_at", { ascending: false }).limit(10)
      .then(({ data }) => setCallHistory((data as CallRecord[]) || []));
    // activities
    supabase.from("contact_activities").select("id, activity_type, description, created_at")
      .eq("contact_id", lid).order("created_at", { ascending: false }).limit(10)
      .then(({ data }) => setActivities((data as ActivityRecord[]) || []));
  }, [currentLead?.lead_id]);

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

    if (!clientRef.current || !dialerReady) {
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

    setCallStatus("connecting");
    setCallSeconds(0);
    setCallStartedAt(new Date());
    setMuted(false);

    try {
      const call = clientRef.current.newCall({
        destinationNumber: number.replace(/\D/g, ""),
        callerNumber,
      });
      callRef.current = call;
    } catch {
      toast.error("Call failed to connect.");
      setCallStatus("idle");
    }

    // Simulate connection after brief delay if Telnyx doesn't fire
    setTimeout(() => {
      setCallStatus((prev) => (prev === "connecting" ? "connected" : prev));
    }, 3000);
  };

  const handleHangUp = () => {
    if (callRef.current) { try { callRef.current.hangup(); } catch {} callRef.current = null; }
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
    await supabase.from("contact_notes").insert({
      contact_id: currentLead.lead_id,
      contact_type: "lead",
      content: newNote,
      author_id: agentId,
    });
    setNewNote("");
    // Refresh notes
    const { data } = await supabase.from("contact_notes").select("id, content, pinned, created_at")
      .eq("contact_id", currentLead.lead_id).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(3);
    setContactNotes(data || []);
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((c) => (
              <div key={c.id} className="bg-card border border-border rounded-xl p-5 hover:border-primary hover:shadow-md transition-all cursor-pointer group">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground truncate">{c.name}</span>
                  <span className="shrink-0 bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-medium">{c.total_leads} leads</span>
                </div>
                {c.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{c.description}</p>}
                <p className="text-xs text-muted-foreground mt-2">Type: {c.type}</p>
                <button
                  onClick={() => startSession(c)}
                  className="w-full mt-4 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                >
                  Start Dialing <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ))}
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
                  <button onClick={() => { setMuted(!muted); if (callRef.current) callRef.current[muted ? "unmuteAudio" : "muteAudio"]?.(); }}
                    className={cn("p-3 rounded-full transition-colors", muted ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                    {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
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
        {(["center", "left", "right"] as const).map((t) => (
          <button key={t} onClick={() => setMobileTab(t)}
            className={cn("flex-1 py-1.5 text-xs rounded-md text-center transition-colors capitalize",
              mobileTab === t ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground")}>
            {t === "center" ? "Call" : t === "left" ? "Queue" : "Details"}
          </button>
        ))}
      </div>

      {/* ── Three Panels ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 min-h-0 overflow-hidden">

        {/* ═══ LEFT PANEL ═══ */}
        <div className={cn("lg:col-span-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden",
          mobileTab !== "left" && "hidden lg:flex")}>
          <div className="p-3 border-b border-border space-y-3 shrink-0">
            {/* Dial mode */}
            <div className="flex items-center gap-2">
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Power</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground cursor-default opacity-50">Predictive</span>
                </TooltipTrigger>
                <TooltipContent>Coming Soon</TooltipContent>
              </Tooltip>
            </div>
            {/* Calling hours */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <input type="number" min={0} max={23} value={callingHoursStart} onChange={(e) => setCallingHoursStart(Number(e.target.value))}
                className="w-10 bg-background border border-input rounded px-1 py-0.5 text-foreground text-center" />
              <span>to</span>
              <input type="number" min={0} max={23} value={callingHoursEnd} onChange={(e) => setCallingHoursEnd(Number(e.target.value))}
                className="w-10 bg-background border border-input rounded px-1 py-0.5 text-foreground text-center" />
              <span className="text-[10px]">(lead's local time)</span>
            </div>
          </div>

          {/* SharkTank banner */}
          {isOpenPool && (
            <div className="px-3 py-2 bg-orange-500/10 border-b border-orange-500/20 flex items-center gap-2 shrink-0">
              <Zap className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-semibold text-orange-500">SharkTank Mode</span>
            </div>
          )}

          {/* Lead queue */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {leadsLoading ? (
              [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)
            ) : filteredLeads.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No leads in queue</div>
            ) : (
              filteredLeads.map((lead, idx) => {
                const isCurrent = idx === currentLeadIdx;
                const localTime = getContactLocalTime(lead.state);
                return (
                  <button
                    key={lead.id}
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
                      <span className="text-[10px] bg-accent text-accent-foreground px-1.5 py-0.5 rounded">{lead.state}</span>
                      {lead.source && <span className="text-[10px] text-muted-foreground truncate">{lead.source}</span>}
                      {localTime && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{localTime}</span>}
                    </div>
                    {isCurrent && lockCountdown !== null && (
                      <div className="mt-1 ml-4 text-[10px] text-orange-500 font-medium">⏱ {lockCountdown}s to call</div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Queue footer */}
          <div className="p-3 border-t border-border space-y-2 shrink-0">
            <p className="text-[10px] text-muted-foreground">
              {callableCount} callable · {outsideCount} outside hours · {leads.length} total
            </p>
            <button onClick={endSession}
              className="w-full border border-destructive text-destructive rounded-lg py-2 text-sm font-medium hover:bg-destructive/10 transition-colors">
              End Session
            </button>
          </div>
        </div>

        {/* ═══ CENTER PANEL ═══ */}
        <div className={cn("lg:col-span-2 bg-card border border-border rounded-xl flex flex-col overflow-hidden",
          mobileTab !== "center" && "hidden lg:flex")}>

          {/* Error banner */}
          {dialerError && (
            <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2 shrink-0">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-xs text-destructive flex-1">{dialerError}</span>
              <button onClick={() => window.location.reload()} className="text-xs text-destructive underline">Retry</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6">
            {!currentLead && !quickDialMode ? (
              /* No lead */
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Phone className="w-16 h-16 text-muted-foreground mb-4" />
                <p className="text-lg font-medium text-foreground">No leads in queue</p>
                <p className="text-sm text-muted-foreground">All leads have been called or are outside calling hours.</p>
              </div>
            ) : callStatus === "ended" ? (
              /* ── POST-CALL DISPOSITION ── */
              <div className="space-y-6 max-w-lg mx-auto">
                <h2 className="text-xl font-bold text-foreground text-center">How did it go?</h2>
                <p className="text-sm text-muted-foreground text-center">Call duration: {fmtTime(callSeconds)}</p>

                {/* Disposition grid */}
                <div className="grid grid-cols-2 gap-2">
                  {dispositions.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => { setSelectedDispId(d.id); setDispNotes(""); setCallbackDate(undefined); }}
                      className={cn(
                        "rounded-lg px-3 py-2.5 text-sm font-medium text-left transition-all border-2",
                        selectedDispId === d.id ? "border-ring ring-2 ring-ring/30" : "border-transparent",
                      )}
                      style={{
                        backgroundColor: `${d.color}20`,
                        color: d.color,
                      }}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>

                {/* Disposition-aware actions */}
                {selectedDisp && (
                  <div className="space-y-4">
                    {selectedDisp.require_notes && (
                      <div>
                        <label className="text-sm font-medium text-foreground">Notes <span className="text-destructive">*</span></label>
                        <textarea
                          value={dispNotes}
                          onChange={(e) => setDispNotes(e.target.value)}
                          placeholder="Required notes..."
                          className="mt-1 w-full bg-background border border-input rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none h-24"
                        />
                        <p className={cn("text-xs mt-1", dispNotes.length >= selectedDisp.min_note_chars ? "text-green-500" : "text-muted-foreground")}>
                          {dispNotes.length} / {selectedDisp.min_note_chars} characters required
                        </p>
                      </div>
                    )}
                    {selectedDisp.callback_scheduler && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Schedule Callback</label>
                        <div className="flex gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className={cn("flex-1 justify-start text-left", !callbackDate && "text-muted-foreground")}>
                                <CalendarPlus className="w-4 h-4 mr-2" />
                                {callbackDate ? format(callbackDate, "MMM d, yyyy") : "Pick date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar mode="single" selected={callbackDate} onSelect={setCallbackDate} initialFocus className="p-3 pointer-events-auto" />
                            </PopoverContent>
                          </Popover>
                          <input
                            type="time"
                            value={callbackTime}
                            onChange={(e) => setCallbackTime(e.target.value)}
                            className="bg-background border border-input rounded-lg px-3 py-1.5 text-sm text-foreground"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Save & Next */}
                <button
                  onClick={handleSaveDisposition}
                  disabled={!selectedDispId || !notesValid}
                  className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium disabled:opacity-40 transition-colors hover:bg-primary/90"
                >
                  Save & Next
                </button>
                <button onClick={handleSkipDisposition} className="w-full text-sm text-muted-foreground hover:text-foreground">
                  Skip Disposition
                </button>
              </div>
            ) : (
              /* ── IDLE / CONNECTING / CONNECTED ── */
              <div className="space-y-6">
                {/* Contact info */}
                {currentLead && (
                  <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-foreground">{currentLead.first_name} {currentLead.last_name}</h2>
                    <p className="text-xl font-mono text-foreground">
                      {isOpenPool && lockCountdown !== null ? "Locked — ready to dial" : currentLead.phone}
                    </p>
                    <div className="flex items-center justify-center gap-3 text-sm">
                      <span className="bg-accent text-accent-foreground px-2 py-0.5 rounded">{currentLead.state}</span>
                      <span className="text-teal-500">{getContactLocalTime(currentLead.state)}</span>
                      {currentLead.source && <span className="text-muted-foreground">{currentLead.source}</span>}
                    </div>
                  </div>
                )}

                {/* Call controls */}
                {callStatus === "idle" && (
                  <div className="space-y-3">
                    <button onClick={handleCall}
                      className="w-full bg-green-600 text-white rounded-xl py-4 text-lg font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-3">
                      <Phone className="w-6 h-6" /> Call
                    </button>
                    <button onClick={handleSkipLead}
                      className="w-full border border-border text-muted-foreground rounded-xl py-2.5 text-sm font-medium hover:bg-accent transition-colors flex items-center justify-center gap-2">
                      <SkipForward className="w-4 h-4" /> Skip
                    </button>
                  </div>
                )}

                {callStatus === "connecting" && (
                  <div className="text-center space-y-4">
                    <div className="w-20 h-20 mx-auto rounded-full border-4 border-primary/30 flex items-center justify-center animate-pulse">
                      <Phone className="w-8 h-8 text-primary" />
                    </div>
                    <p className="text-primary font-medium">Connecting...</p>
                    <button onClick={() => { setCallStatus("idle"); if (callRef.current) try { callRef.current.hangup(); } catch {} }}
                      className="bg-muted text-muted-foreground rounded-lg px-6 py-2 text-sm">Cancel</button>
                  </div>
                )}

                {callStatus === "connected" && (
                  <div className="text-center space-y-4">
                    <p className="text-4xl font-mono font-bold text-foreground">{fmtTime(callSeconds)}</p>
                    <div className="flex items-center justify-center gap-2 text-green-500 text-sm">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Connected
                    </div>
                    <div className="flex justify-center gap-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              setMuted(!muted);
                              if (callRef.current) callRef.current[muted ? "unmuteAudio" : "muteAudio"]?.();
                            }}
                            className={cn("p-3 rounded-full transition-colors", muted ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground hover:bg-muted/80")}
                          >
                            {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{muted ? "Unmute" : "Mute"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={() => toast.info("Hold not available yet")}
                            className="p-3 rounded-full bg-muted text-muted-foreground hover:bg-muted/80">
                            <Pause className="w-5 h-5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Hold</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={() => toast.info("VM Drop coming soon")}
                            className="p-3 rounded-full bg-muted text-muted-foreground hover:bg-muted/80">
                            <Voicemail className="w-5 h-5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Voicemail Drop</TooltipContent>
                      </Tooltip>
                    </div>
                    <button onClick={handleHangUp}
                      className="w-full bg-destructive text-destructive-foreground rounded-xl py-3 font-semibold flex items-center justify-center gap-2">
                      <PhoneOff className="w-5 h-5" /> Hang Up
                    </button>
                  </div>
                )}

                {/* Call Script */}
                {(callStatus === "idle" || callStatus === "connecting" || callStatus === "connected") && (
                  <div className="border border-border rounded-xl overflow-hidden">
                    <button onClick={() => setScriptCollapsed(!scriptCollapsed)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-accent/50 hover:bg-accent transition-colors">
                      <span className="text-sm font-medium text-foreground flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Call Script
                      </span>
                      <ChevronLeft className={cn("w-4 h-4 text-muted-foreground transition-transform", scriptCollapsed ? "-rotate-90" : "rotate-90")} />
                    </button>
                    {!scriptCollapsed && (
                      <div className="p-4 max-h-[300px] overflow-y-auto text-sm text-foreground whitespace-pre-wrap">
                        {scriptContent ? (
                          scriptContent
                            .replace(/\{first_name\}/g, currentLead?.first_name ?? "")
                            .replace(/\{last_name\}/g, currentLead?.last_name ?? "")
                            .replace(/\{state\}/g, currentLead?.state ?? "")
                            .replace(/\{agent_name\}/g, agentName)
                        ) : (
                          <p className="text-muted-foreground italic">No script assigned. You can assign scripts to campaigns in Campaign Settings.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Quick Notes */}
                {(callStatus === "idle" || callStatus === "connecting" || callStatus === "connected") && currentLead && (
                  <div className="space-y-3">
                    {contactNotes.length > 0 && (
                      <div className="space-y-1">
                        {contactNotes.map((n) => (
                          <div key={n.id} className="text-xs bg-accent/50 rounded-lg p-2 text-foreground">
                            {n.pinned && <span className="text-primary mr-1">📌</span>}
                            {n.content}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Add a note..."
                        className="flex-1 bg-background border border-input rounded-lg p-2 text-sm text-foreground placeholder:text-muted-foreground resize-none h-16 focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button onClick={handleSaveNote} disabled={!newNote.trim()}
                        className="self-end bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40">
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══ RIGHT PANEL ═══ */}
        <div className={cn("lg:col-span-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden",
          mobileTab !== "right" && "hidden lg:flex")}>
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {!currentLead ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Phone className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Select a list and start dialing</p>
              </div>
            ) : (
              <>
                {/* Contact Card */}
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold mx-auto">
                    {currentLead.first_name[0]}{currentLead.last_name[0]}
                  </div>
                  <h3 className="font-semibold text-foreground">{currentLead.first_name} {currentLead.last_name}</h3>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center justify-center gap-1"><Phone className="w-3 h-3" /> {currentLead.phone}</p>
                    {currentLead.email && <p className="flex items-center justify-center gap-1"><Mail className="w-3 h-3" /> {currentLead.email}</p>}
                    <p className="flex items-center justify-center gap-1"><MapPin className="w-3 h-3" /> {currentLead.state}</p>
                    {currentLead.source && <p>Source: {currentLead.source}</p>}
                  </div>
                  <button onClick={() => navigate(`/contacts?contact=${currentLead.lead_id}`)}
                    className="text-xs text-primary hover:underline flex items-center justify-center gap-1 mx-auto">
                    <ExternalLink className="w-3 h-3" /> View Full Contact
                  </button>
                </div>

                {/* Disposition History */}
                <div>
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Call History</h4>
                  {callHistory.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No previous calls</p>
                  ) : (
                    <div className="space-y-1.5">
                      {callHistory.map((c) => (
                        <div key={c.id} className="flex items-center justify-between text-xs bg-accent/30 rounded-lg p-2">
                          <div>
                            <p className="text-foreground">{c.started_at ? format(new Date(c.started_at), "MMM d, h:mm a") : "—"}</p>
                            <p className="text-muted-foreground">{c.duration ? fmtTime(c.duration) : "0:00"}</p>
                          </div>
                          {c.disposition_name && (
                            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-medium">
                              {c.disposition_name}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Activity Timeline */}
                <div>
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">Activity</h4>
                  {activities.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No activity yet</p>
                  ) : (
                    <div className="space-y-1.5">
                      {activities.map((a) => (
                        <div key={a.id} className="flex items-start gap-2 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                          <div className="flex-1">
                            <p className="text-foreground">{a.description}</p>
                            <p className="text-muted-foreground">{timeAgo(a.created_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
