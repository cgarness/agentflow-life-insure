import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone, X, Mic, Pause, Voicemail,
  PhoneOff, Search, Delete, Loader2,
  Minus, ChevronUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTwilio, MakeCallOptions } from "@/contexts/TwilioContext";
import { useNavigate } from "react-router-dom";
import { triggerWin, isSaleDisposition } from "@/lib/win-trigger";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { saveCall } from "@/lib/dialer-api";
import { primeIncomingCallAudio } from "@/lib/incomingCallAlerts";
import { OUTBOUND_CALL_DIRECTIONS } from "@/lib/webrtcInboundCaller";
import { CALLER_ID_STICKY_MIN_DURATION_SEC } from "@/lib/caller-id-selection";
import { DateInput } from "@/components/shared/DateInput";
import { Button } from "@/components/ui/button";
import { InboundCallIdentity } from "@/components/layout/InboundCallIdentity";
import { DialerCallPhaseLabel } from "@/components/layout/DialerCallPhaseLabel";
import {
  useInboundCallerDisplayLines,
  usefulIncomingSdkDisplayName,
} from "@/hooks/useInboundCallerDisplayLines";

interface ContactResult {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  type?: "lead" | "client" | "recruit";
}

interface DispositionRow {
  id: string;
  name: string;
  color: string;
  require_notes: boolean;
  min_note_chars: number;
  callback_scheduler: boolean;
  automation_trigger: boolean;
  automation_id: string | null;
}

interface RecentCall {
  id: string;
  contact_name: string | null;
  phone: string;
  disposition_name: string | null;
  disposition_color: string | null;
  created_at: string;
  contact_type?: "lead" | "client" | "recruit";
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "unknown";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

const FloatingDialer: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();

  // --- Drag state ---
  const [position, setPosition] = useState({ x: window.innerWidth - 340 - 16, y: 64 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, [role="listbox"], [role="option"], [data-radix-popper-content-wrapper]')) return;
    setIsDragging(true);
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const newX = Math.max(0, Math.min(window.innerWidth - 340, e.clientX - dragOffset.current.x));
    const newY = Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.current.y));
    setPosition({ x: newX, y: newY });
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const {
    status: twilioStatus,
    errorMessage: twilioErrorMessage,
    callState: twilioCallState,
    callDuration: twilioCallDuration,
    isMuted: twilioIsMuted,
    isOnHold: twilioIsOnHold,
    incomingCallerNumber,
    incomingCallerName,
    crmContactName,
    identifiedContact,
    lastCallDirection,
    makeCall: twilioMakeCall,
    hangUp: twilioHangUp,
    answerIncomingCall: twilioAnswerIncoming,
    rejectIncomingCall: twilioRejectIncoming,
    toggleMute: twilioToggleMute,
    toggleHold: twilioToggleHold,
    initializeClient: twilioInitialize,
    isReady: twilioIsReady,
    availableNumbers,
    selectedCallerNumber,
    setSelectedCallerNumber,
    getSmartCallerId,
    incomingCallAlerts,
    enableIncomingCallAlerts,
    destroyClient: twilioDestroy,
  } = useTwilio();

  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<"dial" | "recent">("dial");

  // --- Recent calls state ---
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState(false);

  // --- Search state ---
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ContactResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactResult | null>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // --- Open animation ---
  const [isVisible, setIsVisible] = useState(false);

  // --- Keypad press state ---
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  const lastUsedCallerId = useRef<string>("");

  // --- Caller ID warning modal state ---
  const [showCallerIdWarning, setShowCallerIdWarning] = useState(false);
  const [pendingCall, setPendingCall] = useState<{
    leadPhone: string;
    contactId: string | null;
    proposedNumber: string;
    previousNumber: string;
  } | null>(null);

  // --- Keypad state ---
  const [dialedNumber, setDialedNumber] = useState("");

  // --- From Number Selection ---
  const [displayedFromNumber, setDisplayedFromNumber] = useState<string>("");

  // --- Call state ---
  const [onCall, setOnCall] = useState(false);
  const onCallRef = useRef(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);

  // --- Post-call disposition state ---
  const [showDisposition, setShowDisposition] = useState(false);
  const [dispositions, setDispositions] = useState<DispositionRow[]>([]);
  const [selectedDispId, setSelectedDispId] = useState<string | null>(null);
  const [callNotes, setCallNotes] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackTime, setCallbackTime] = useState('');

  // Derived selected disposition object
  const selectedDisp = dispositions.find((d) => d.id === selectedDispId) ?? null;

  // Listen for toggle event from TopBar
  useEffect(() => {
    const handler = () => {
      setOpen((prev) => {
        const next = !prev;
        if (next) void primeIncomingCallAudio();
        return next;
      });
    };
    window.addEventListener("toggle-floating-dialer", handler);
    return () => window.removeEventListener("toggle-floating-dialer", handler);
  }, []);

  // Listen for quick-call event from campaign leads or contact view
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.phone) {
        const nameParts = (detail.name || "").split(" ");
        setSelectedContact({
          id: detail.contactId || "",
          first_name: nameParts[0] || "",
          last_name: nameParts.slice(1).join(" ") || "",
          phone: detail.phone,
          type: detail.type || "lead",
        });
        if (detail.fromNumber) {
          setSelectedCallerNumber(detail.fromNumber);
        }
        setSearchTerm(detail.name || detail.phone);
        setActiveTab("dial");
        void primeIncomingCallAudio();
        setOpen(true);
      }
    };
    window.addEventListener("quick-call", handler);
    return () => window.removeEventListener("quick-call", handler);
  }, []);

  // Call timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (onCall) {
      timer = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [onCall]);

  // Keep onCallRef in sync so the open effect can read the current value without a dependency.
  useEffect(() => { onCallRef.current = onCall; }, [onCall]);

  // Fire call state change event for TopBar live-call indicator
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('dialer-call-state-change', { detail: { onCall } }));
  }, [onCall]);

  // Reset minimized when panel is closed
  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);

  // Open: ensure the voice client is initialized (idempotent — will not disconnect an existing live client).
  // Close: destroy client only when not mid-call to preserve active call state.
  // onCall is intentionally read via ref to avoid re-running init on every call state change.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setIsVisible(true), 0);
      twilioInitialize();
      return () => clearTimeout(t);
    } else {
      setIsVisible(false);
      if (!onCallRef.current) twilioDestroy();
      setMinimized(false);
    }
  }, [open, twilioInitialize, twilioDestroy]);

  // Fetch dispositions for post-call
  useEffect(() => {
    supabase
      .from("dispositions")
      .select("id, name, color, require_notes, min_note_chars, callback_scheduler, automation_trigger, automation_id")
      .order("sort_order")
      .then(({ data }) => {
        if (data) setDispositions(data);
      });
  }, []);

  // Resolve the "best" number to display when contact or override changes
  useEffect(() => {
    const resolve = async () => {
      const smartId = await getSmartCallerId(selectedContact?.phone || searchTerm, selectedContact?.id);
      setDisplayedFromNumber(smartId);
    };
    resolve();
  }, [selectedContact, searchTerm, selectedCallerNumber, getSmartCallerId]);

  // Fetch recent calls when Recent tab is selected
  const fetchRecentCalls = useCallback(async () => {
    if (!user) return;
    setRecentLoading(true);
    setRecentError(false);
    try {
      let q = supabase
        .from("calls")
        .select("id, contact_name, contact_phone, disposition_name, started_at, created_at, contact_type, direction, agent_id")
        .order("created_at", { ascending: false })
        .limit(15);

      // Own outbound/inbound (after claim) + org inbound still ringing / unclaimed (agent_id NULL)
      if (organizationId) {
        q = q.or(
          `agent_id.eq.${user.id},and(direction.eq.inbound,agent_id.is.null,organization_id.eq.${organizationId})`
        );
      } else {
        q = q.eq("agent_id", user.id);
      }

      const { data, error } = await q;

      if (error) throw error;

      const mapped: RecentCall[] = (data || []).map(c => ({
        id: c.id,
        contact_name: c.contact_name,
        phone: c.contact_phone || "",
        disposition_name: c.disposition_name,
        disposition_color: null,
        created_at: c.started_at || c.created_at || new Date().toISOString(),
        contact_type: c.contact_type as any
      }));

      setRecentCalls(mapped);
    } catch (err) {
      console.error("Error fetching recent calls:", err);
      setRecentError(true);
      setRecentCalls([]);
    } finally {
      setRecentLoading(false);
    }
  }, [user, organizationId]);

  useEffect(() => {
    if (activeTab === "recent") {
      fetchRecentCalls();
    }
  }, [activeTab, fetchRecentCalls]);

  // --- Search with debounce ---
  const doSearch = useCallback(async (term: string) => {
    if (term.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setSearchLoading(true);
    try {
      const { data } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, status")
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%`)
        .limit(5);
      
      setSearchResults((data || []).map(l => ({
        ...l,
        type: (l.status === 'Closed Won' ? 'client' : 'lead') as any
      })));
      setShowDropdown(true);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setSelectedContact(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (val.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchTimerRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelectContact = (c: ContactResult) => {
    setSelectedContact(c);
    setShowDropdown(false);
    setSearchTerm(`${c.first_name} ${c.last_name}`);
  };

  const clearSearch = () => {
    setSearchTerm("");
    setSearchResults([]);
    setShowDropdown(false);
    setSelectedContact(null);
  };

  // --- Keypad ---
  const handleKeyPress = (key: string) => {
    setDialedNumber((prev) => prev + key);
  };

  const handleBackspace = () => {
    setDialedNumber((prev) => prev.slice(0, -1));
  };

  // --- Call logic ---
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const proceedWithCall = async (destinationNumber: string, callerNumber: string, contactId?: string | null) => {
    if (!twilioIsReady) return;
    lastUsedCallerId.current = callerNumber;
    const opts: MakeCallOptions = {
      contactId: contactId || selectedContact?.id || null,
      contactName: selectedContact ? `${selectedContact.first_name} ${selectedContact.last_name}` : null,
      contactPhone: destinationNumber,
      contactType: selectedContact?.type || null,
      applyOutboundRingTimeout: false,
    };
    const callId = await twilioMakeCall(destinationNumber, callerNumber || undefined, opts);
    if (!callId) return;
    setCurrentCallId(callId);
    setOnCall(true);
    setCallSeconds(0);
  };

  const initiateCall = async (destinationNumber: string, contactId: string | null) => {
    const leadPhone = dialedNumber.trim() || destinationNumber;
    if (!leadPhone) return;

    let finalCallerId = selectedCallerNumber || "";
    if (!finalCallerId) {
      finalCallerId = await getSmartCallerId(leadPhone, contactId ?? undefined);
    }
    if (!finalCallerId && availableNumbers.length > 0) {
      finalCallerId =
        availableNumbers.find((n) => n.is_default)?.phone_number || availableNumbers[0].phone_number;
    }

    // Consolidated call creation: TwilioContext.makeCall handles call record creation.
    if (!contactId) {
      void proceedWithCall(destinationNumber, finalCallerId);
      return;
    }

    if (!selectedCallerNumber) {
      try {
        const { data } = await supabase
          .from("calls")
          .select("caller_id_used")
          .eq("contact_id", contactId)
          .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
          .gte("duration", CALLER_ID_STICKY_MIN_DURATION_SEC)
          .not("caller_id_used", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const previousNumber = data?.caller_id_used;
        if (previousNumber) {
          const prevRecord = availableNumbers.find((n) => n.phone_number === previousNumber);
          if (prevRecord?.spam_status === "Flagged" && previousNumber !== finalCallerId) {
            setPendingCall({
              leadPhone: destinationNumber,
              contactId,
              proposedNumber: finalCallerId,
              previousNumber,
            });
            setShowCallerIdWarning(true);
            return;
          }
        }
      } catch (err) {
        console.warn("[FloatingDialer] flagged-caller check failed", err);
      }
    }

    void proceedWithCall(destinationNumber, finalCallerId, contactId);
  };

  const handleCallFromContact = () => {
    if (!selectedContact) return;
    initiateCall(selectedContact.phone, selectedContact.id || null);
  };

  const handleCallFromKeypad = () => {
    if (dialedNumber.length < 10) return;
    initiateCall(dialedNumber, null);
  };

  const handleHangUp = useCallback(() => {
    twilioHangUp();
    setOnCall(false);
    setShowDisposition(true);
    setSelectedDispId(null);
  }, [twilioHangUp]);

  useEffect(() => {
    if (twilioCallState === "incoming") {
      // Premature onCall(true) (e.g. SDK "active" edge) hides Answer/Decline — reset for ring UI.
      setOnCall(false);
      setOpen(true);
      setActiveTab("dial");
    }
  }, [twilioCallState]);

  useEffect(() => {
    if (twilioCallState === "active" && !onCall) {
      setOnCall(true);
      setCallSeconds(0);
    }
  }, [twilioCallState, onCall]);

  useEffect(() => {
    if (twilioCallState === "ended" && onCall) {
      handleHangUp();
    }
    if (twilioCallState === "ended" && !onCall) {
      setCallSeconds(0);
      setCurrentCallId(null);
      setShowDisposition(false);
    }
  }, [twilioCallState, onCall, handleHangUp]);

  const resetAll = () => {
    setShowDisposition(false);
    setSelectedDispId(null);
    setCallNotes('');
    setCallbackDate('');
    setCallbackTime('');
    setSelectedContact(null);
    setSearchTerm("");
    setSearchResults([]);
    setShowDropdown(false);
    setDialedNumber("");
    setCallSeconds(0);
    setOpen(false);
  };

  const handleSaveDisposition = async () => {
    const disp = dispositions.find((d) => d.id === selectedDispId);
    if (disp) {
      if (user && selectedContact) {
        try {
          await saveCall({
            id: currentCallId || undefined,
            master_lead_id: selectedContact.id,
            agent_id: user.id,
            duration_seconds: twilioCallDuration || callSeconds,
            disposition: disp.name,
            notes: callNotes.trim(),
            outcome: disp.name,
            caller_id_used: lastUsedCallerId.current || undefined,
            contact_type: selectedContact.type,
          }, organizationId);
        } catch (err) {
          console.error("Failed to save call:", err);
        }
      }

      if (disp.callback_scheduler && callbackDate && callbackTime && selectedContact?.id) {
        try {
          await supabase.from('appointments').insert([{
            title: `Callback: ${selectedContact.first_name} ${selectedContact.last_name}`,
            contact_id: selectedContact.id,
            contact_name: `${selectedContact.first_name} ${selectedContact.last_name}`,
            type: 'Follow Up',
            status: 'Scheduled',
            start_time: new Date(`${callbackDate}T${callbackTime}`).toISOString(),
            notes: `Callback scheduled from dialer. Disposition: ${disp.name}`,
            created_by: user?.id,
            organization_id: organizationId,
          }] as any);
        } catch { /* ignored */ }
      }

      if (isSaleDisposition(disp.name) && user && profile) {
        triggerWin({
          agentId: user.id,
          agentName: `${profile.first_name} ${profile.last_name}`,
          contactName: selectedContact ? `${selectedContact.first_name} ${selectedContact.last_name}` : dialedNumber,
          contactId: selectedContact?.id,
          policyType: disp.name,
          organizationId,
        });
      }
    }
    resetAll();
  };

  const handleSkip = () => {
    resetAll();
  };

  const inboundLines = useInboundCallerDisplayLines({ onCall });

  const callDisplayName =
    selectedContact
      ? `${selectedContact.first_name} ${selectedContact.last_name}`
      : crmContactName ||
        usefulIncomingSdkDisplayName(incomingCallerName, incomingCallerNumber) ||
        incomingCallerNumber ||
        dialedNumber;

  const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  const statusDotColor =
    twilioStatus === 'ready' ? '#22c55e' :
    twilioStatus === 'connecting' ? '#eab308' :
    twilioStatus === 'error' ? '#ef4444' : '#94a3b8';
  const shouldPulse = twilioStatus === 'ready' || twilioStatus === 'connecting';

  /** Outbound calls are blocked until the voice client is registered (matches TwilioContext.makeCall gates). */
  const canPlaceCall = twilioIsReady && twilioStatus !== 'error';

  return (
    <>
      {showCallerIdWarning && pendingCall && (
        <div className="fixed inset-0 bg-black/50 z-[1001] flex items-center justify-center">
          <div className="bg-card border border-warning/50 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-warning text-xl">⚠️</span>
              <div>
                <h3 className="font-semibold text-foreground">Caller ID Changed</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  This contact was previously called from{' '}
                  <span className="font-mono text-foreground">{pendingCall.previousNumber}</span>,
                  but that number is now <span className="text-destructive font-medium">Flagged</span>.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Calling from <span className="font-mono text-foreground">{pendingCall.proposedNumber}</span> instead.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCallerIdWarning(false); setPendingCall(null); }}
                className="flex-1 py-2 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80"
              >
                Cancel
              </button>
              <button
                disabled={!canPlaceCall}
                title={!canPlaceCall ? "Wait until the dialer shows Ready" : undefined}
                onClick={() => {
                  setShowCallerIdWarning(false);
                  if (pendingCall) {
                    void proceedWithCall(
                      pendingCall.leadPhone,
                      pendingCall.proposedNumber,
                      pendingCall.contactId
                    );
                  }
                  setPendingCall(null);
                }}
                className="flex-1 py-2 rounded-lg bg-warning text-warning-foreground text-sm font-medium hover:bg-warning/90 disabled:opacity-50 disabled:pointer-events-none"
              >
                Call Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          ref={panelRef}
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: isDragging ? 'none' : 'opacity 150ms ease-out, transform 150ms ease-out',
            left: `${position.x}px`,
            top: `${position.y}px`,
          }}
          className={minimized
            ? "fixed w-[240px] bg-card border border-border rounded-xl shadow-2xl z-[1000] flex flex-col overflow-hidden"
            : "fixed w-[320px] max-w-[calc(100vw-2rem)] h-[540px] bg-card border border-border rounded-xl shadow-2xl z-[1000] flex flex-col overflow-hidden"
          }
        >
          <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

          {/* Minimized strip — compact bar shown when panel is minimized */}
          {minimized && (
            <div
              className="flex items-center justify-between px-3 py-2 select-none"
              style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <div className="flex items-center gap-2">
                {onCall && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                <span className="text-sm font-semibold text-foreground">
                  {onCall ? (selectedContact ? `${selectedContact.first_name} ${selectedContact.last_name}` : dialedNumber) : 'Dialer'}
                </span>
                {onCall && <span className="text-xs text-muted-foreground font-mono">{formatTime(callSeconds)}</span>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMinimized(false)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Panel Header — drag handle only here so body controls receive clicks reliably */}
          {!minimized && (
            <div
              className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0 select-none"
              style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: statusDotColor,
                    display: 'inline-block',
                    flexShrink: 0,
                    animation: shouldPulse ? 'pulse 2s infinite' : 'none',
                  }}
                />
                <h2 className="font-semibold text-foreground text-sm">Dialer</h2>
                {twilioStatus === 'connecting' && <span className="text-[10px] text-muted-foreground">Connecting…</span>}
                {twilioStatus === 'idle' && open && <span className="text-[10px] text-muted-foreground">Starting phone…</span>}
                {twilioStatus === 'ready' && <span className="text-[10px] text-muted-foreground">Ready</span>}
                {twilioStatus === 'error' && (
                  <div className="flex flex-col">
                    <span className="text-[10px] text-destructive leading-tight">{twilioErrorMessage || "Connection failed"}</span>
                    <button onClick={() => twilioInitialize()} className="text-[10px] text-primary underline underline-offset-2 w-fit">retry</button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMinimized(true)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {!minimized && (<>
          {/* Tab Bar */}
          <div className="px-3 pt-2 pb-1 shrink-0">
            <div className="flex bg-accent rounded-lg p-0.5">
              <button
                onClick={() => setActiveTab("dial")}
                className={`flex-1 py-1.5 text-xs rounded-md text-center transition-colors ${activeTab === "dial" ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >Dial</button>
              <button
                onClick={() => setActiveTab("recent")}
                className={`flex-1 py-1.5 text-xs rounded-md text-center transition-colors ${activeTab === "recent" ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >Recent</button>
            </div>
          </div>

          {twilioIsReady &&
            !incomingCallAlerts.optIn &&
            twilioCallState !== "incoming" && (
            <div className="mx-3 mt-2 shrink-0 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground leading-snug mb-2">
                One tap unlocks optional desktop pop-ups for inbound life-insurance calls (Twilio rings in the browser; your browser may require this for notifications).
              </p>
              <Button
                type="button"
                size="sm"
                className="w-full h-8 text-xs"
                onClick={() => void enableIncomingCallAlerts()}
              >
                Enable desktop alerts
              </Button>
            </div>
          )}

          {twilioIsReady &&
            incomingCallAlerts.optIn &&
            incomingCallAlerts.desktopEnabled &&
            incomingCallAlerts.desktopPermission === "denied" &&
            twilioCallState !== "incoming" && (
              <p className="mx-3 mt-1.5 shrink-0 text-[10px] text-amber-700 dark:text-amber-500/90 leading-snug">
                Browser notifications are off — you’ll still get the in-app incoming screen and Twilio’s ringtone when this tab is open.
              </p>
            )}

          <div className="flex-1 overflow-y-auto min-h-0 bg-background/50">
            {activeTab === "recent" && (
              <div className="p-3 space-y-3">
                {recentLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!recentLoading && (recentError || recentCalls.length === 0) && (
                  <div className="flex flex-col items-center justify-center py-8 space-y-2">
                    <Phone className="w-8 h-8 text-muted-foreground" />
                    <p className="font-medium text-foreground">No recent calls</p>
                    <p className="text-sm text-muted-foreground">Your call history will appear here</p>
                  </div>
                )}
                {!recentLoading && !recentError && recentCalls.length > 0 && (
                  <div className="space-y-1">
                    {recentCalls.map((call) => (
                      <button
                        key={call.id}
                        onClick={() => {
                          const name = call.contact_name || call.phone;
                          const parts = name.includes(" ") ? name.split(" ") : [name, ""];
                          setSelectedContact({ id: call.id, first_name: parts[0], last_name: parts.slice(1).join(" "), phone: call.phone, type: call.contact_type });
                          setSearchTerm(name);
                          setActiveTab("dial");
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-accent text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-foreground truncate">{call.contact_name || call.phone}</p>
                            {call.contact_type && (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                call.contact_type === 'recruit' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' :
                                call.contact_type === 'client' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                                'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                              }`}>{call.contact_type}</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{call.phone} • {timeAgo(call.created_at)}</p>
                        </div>
                        {call.disposition_name && (
                          <span className="ml-2 shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: call.disposition_color ?? "#6b7280" }}>{call.disposition_name}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "dial" && (
              <div className="px-3 py-2 space-y-3">
                {twilioCallState === "dialing" && (
                  <div className="flex flex-col items-center gap-2 py-3 rounded-lg border border-border bg-muted/30">
                    <DialerCallPhaseLabel
                      callState={twilioCallState}
                      lastCallDirection={lastCallDirection}
                      onCall={false}
                    />
                    <p className="text-sm font-semibold text-foreground text-center px-2 truncate max-w-full">
                      {selectedContact
                        ? `${selectedContact.first_name} ${selectedContact.last_name}`.trim()
                        : dialedNumber || "Connecting…"}
                    </p>
                  </div>
                )}
                {twilioCallState === "incoming" && (
                  <div className="flex flex-col items-center space-y-4 py-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Incoming call</p>
                    <InboundCallIdentity
                      identifiedContact={identifiedContact}
                      fallbackName={inboundLines.displayName}
                      fallbackNumber={inboundLines.displayPhone}
                      nameClassName="text-xl"
                    />
                    <div className="flex w-full gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          void twilioAnswerIncoming();
                        }}
                        className="flex-1 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold text-sm"
                      >
                        Answer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          twilioRejectIncoming();
                        }}
                        className="flex-1 py-3 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold text-sm"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {onCall && (
                  <div className="flex flex-col items-center space-y-4">
                    <DialerCallPhaseLabel
                      callState={twilioCallState}
                      lastCallDirection={lastCallDirection}
                      onCall={onCall}
                    />
                    <InboundCallIdentity
                      identifiedContact={identifiedContact}
                      fallbackName={
                        lastCallDirection === "inbound"
                          ? inboundLines.displayName
                          : callDisplayName
                      }
                      fallbackNumber={
                        lastCallDirection === "inbound"
                          ? inboundLines.displayPhone
                          : incomingCallerNumber || dialedNumber
                      }
                      nameClassName="text-lg"
                    />
                    {selectedContact && (
                      <button onClick={() => { navigate(`/contacts?contact=${selectedContact.id}`); setOpen(false); }} className="text-sm text-teal-500 hover:text-teal-600 hover:underline">View Full Contact &rarr;</button>
                    )}
                    {lastUsedCallerId.current && <p className="text-xs text-muted-foreground">Calling from: {lastUsedCallerId.current}</p>}
                    <p className="text-3xl font-mono text-foreground">{formatTime(twilioCallDuration || callSeconds)}</p>
                    <div className="flex items-center gap-6">
                      <div className="flex flex-col items-center gap-1">
                        <button type="button" onClick={twilioToggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center ${twilioIsMuted ? "bg-destructive/20 text-destructive" : "bg-accent text-foreground"}`}>
                          {twilioIsMuted ? <X className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                        </button>
                        <span className="text-xs text-muted-foreground">{twilioIsMuted ? "Unmute" : "Mute"}</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <button
                          type="button"
                          onClick={twilioToggleHold}
                          className={`w-12 h-12 rounded-full flex items-center justify-center ${
                            twilioIsOnHold ? "bg-primary/20 text-primary" : "bg-accent text-foreground"
                          }`}
                        >
                          <Pause className="w-5 h-5" />
                        </button>
                        <span className="text-xs text-muted-foreground">{twilioIsOnHold ? "Resume" : "Hold"}</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <button className="w-12 h-12 rounded-full bg-accent text-foreground flex items-center justify-center"><Voicemail className="w-5 h-5" /></button>
                        <span className="text-xs text-muted-foreground">VM Drop</span>
                      </div>
                    </div>
                    <button onClick={handleHangUp} className="w-full py-3 rounded-lg bg-destructive text-destructive-foreground font-semibold flex items-center justify-center gap-2">
                      <PhoneOff className="w-5 h-5" /> Hang Up
                    </button>
                  </div>
                )}

                {!onCall && showDisposition && (
                  <div className="flex flex-col items-center space-y-3">
                    <p className="font-medium text-foreground text-center">How did it go?</p>
                    <div className="grid grid-cols-2 gap-2 w-full">
                      {dispositions.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setSelectedDispId(d.id)}
                          className={`px-3 py-2 rounded-full text-sm font-bold text-white ${selectedDispId === d.id ? "ring-2 ring-offset-2 ring-foreground" : ""}`}
                          style={{ backgroundColor: d.color, boxShadow: selectedDispId === d.id ? `0 0 10px ${d.color}88` : "none" }}
                        >{d.name}</button>
                      ))}
                    </div>

                    {selectedDisp?.require_notes && (
                      <div className="w-full space-y-1">
                        <label className="text-xs text-muted-foreground">Call Notes</label>
                        <textarea
                          value={callNotes}
                          onChange={e => setCallNotes(e.target.value)}
                          placeholder="Add notes..."
                          className="w-full px-3 py-2 rounded-lg bg-accent text-sm resize-none"
                          rows={3}
                        />
                      </div>
                    )}

                    {selectedDisp?.callback_scheduler && (
                      <div className="w-full space-y-2">
                        <label className="text-xs text-muted-foreground">Schedule Callback</label>
                        <div className="flex gap-2">
                          <DateInput value={callbackDate} onChange={setCallbackDate} className="flex-1" />
                          <input type="time" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} className="flex-1 h-9 px-3 py-2 rounded-lg bg-accent text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none" />
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleSaveDisposition}
                      disabled={!selectedDispId || (selectedDisp?.require_notes && !callNotes.trim())}
                      className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
                    >Save & Close</button>
                    <button onClick={handleSkip} className="text-sm text-muted-foreground hover:text-foreground">Skip</button>
                  </div>
                )}

                {!onCall && !showDisposition && twilioCallState !== "incoming" && (
                  <div className="space-y-4">
                    {!canPlaceCall && twilioStatus !== 'error' && (
                      <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 px-3 py-2">
                        Wait for <span className="font-medium text-foreground">Ready</span> in the header before placing a call.
                      </p>
                    )}
                    <div className="p-3 bg-accent/40 rounded-lg border border-border transition-colors hover:border-primary/50">
                      <div className="flex flex-col flex-1">
                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-tight mb-1">Calling From</span>
                        <select 
                          value={selectedCallerNumber}
                          onChange={(e) => setSelectedCallerNumber(e.target.value)}
                          className="bg-transparent border-none text-sm font-bold focus:ring-0 p-0 h-auto cursor-pointer w-full text-foreground"
                        >
                          <option value="">AI Local Presence</option>
                          {availableNumbers.map(n => (
                            <option key={n.phone_number} value={n.phone_number}>
                              {n.friendly_name ? `${n.friendly_name} - ` : ''}{n.phone_number}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="w-full h-10 pl-9 pr-8 rounded-lg bg-muted text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      {searchTerm && <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5" /></button>}
                      
                      {showDropdown && (
                        <div className="absolute top-full mt-1 w-full bg-card border rounded-lg shadow-lg z-10 py-1 max-h-60 overflow-y-auto">
                          {searchLoading && <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin" /></div>}
                          {!searchLoading && searchResults.length === 0 && <p className="text-sm text-center py-3">No contacts</p>}
                          {!searchLoading && searchResults.map(c => (
                            <button key={c.id} onClick={() => handleSelectContact(c)} className="w-full px-3 py-2 text-left hover:bg-accent flex items-center justify-between">
                              <div className="min-w-0">
                                <p className="font-bold text-sm truncate">{c.first_name} {c.last_name}</p>
                                <p className="text-xs font-medium text-primary">{c.phone}</p>
                              </div>
                              {c.type && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                                  c.type === 'recruit' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' :
                                  c.type === 'client' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                                  'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                                }`}>{c.type}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedContact && (
                      <div className="bg-accent/50 rounded-lg p-3 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{selectedContact.first_name} {selectedContact.last_name}</p>
                          <p className="text-xs font-medium text-primary">{selectedContact.phone}</p>
                        </div>
                        <button
                          type="button"
                          disabled={!canPlaceCall}
                          title={!canPlaceCall ? "Wait until the dialer shows Ready" : undefined}
                          onClick={() => void handleCallFromContact()}
                          className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          <Phone className="w-4 h-4" /> Call
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs text-muted-foreground italic">or dial manually</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-10 px-3 rounded-lg bg-muted flex items-center">
                          <span className="font-mono text-lg truncate">{dialedNumber}</span>
                        </div>
                        <button onClick={handleBackspace} className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center hover:bg-accent"><Delete className="w-5 h-5" /></button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {keypadKeys.map(key => (
                          <button key={key} onClick={() => handleKeyPress(key)} className="h-10 rounded-lg bg-muted text-base font-semibold hover:bg-accent">{key}</button>
                        ))}
                      </div>
                      {dialedNumber.length >= 10 && (
                        <button
                          type="button"
                          disabled={!canPlaceCall}
                          title={!canPlaceCall ? "Wait until the dialer shows Ready" : undefined}
                          onClick={() => void handleCallFromKeypad()}
                          className="w-full py-2.5 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          <Phone className="w-4 h-4" /> Call
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          </>)}
        </div>
      )}
    </>
  );
};

export default FloatingDialer;
