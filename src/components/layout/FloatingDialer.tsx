import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone, X, Mic, Pause, Voicemail,
  PhoneOff, Search, Delete, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { useNavigate } from "react-router-dom";
import { triggerWin, isSaleDisposition } from "@/lib/win-trigger";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { createCall, saveCall } from "@/lib/dialer-api";
import { selectCallerID } from "@/lib/caller-id-selector";

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
    status: telnyxStatus,
    callState: telnyxCallState,
    callDuration: telnyxCallDuration,
    isMuted: telnyxIsMuted,
    currentCall: telnyxCurrentCall,
    makeCall: telnyxMakeCall,
    hangUp: telnyxHangUp,
    toggleMute: telnyxToggleMute,
    initializeClient: telnyxInitialize,
    destroyClient: telnyxDestroy,
  } = useTelnyx();

  const [open, setOpen] = useState(false);
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

  // --- Dialer error state ---
  const [dialerError, setDialerError] = useState<string | null>(null);

  // --- Open animation ---
  const [isVisible, setIsVisible] = useState(false);

  // --- Keypad press state ---
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  // --- Owned phone numbers (loaded once on mount) ---
  const ownedNumbers = useRef<any[]>([]);
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
  const [fromNumber, setFromNumber] = useState<string>("");
  const [localPresenceEnabled, setLocalPresenceEnabled] = useState(true);

  // --- Call state ---
  const [onCall, setOnCall] = useState(false);
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
    const handler = () => setOpen((prev) => !prev);
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
          setFromNumber(detail.fromNumber);
        }
        setSearchTerm(detail.name || detail.phone);
        setActiveTab("dial");
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

  // Open animation toggle + eager Telnyx init / teardown
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setIsVisible(true), 0);
      telnyxInitialize();
      return () => clearTimeout(t);
    } else {
      setIsVisible(false);
      telnyxDestroy();
    }
  }, [open, telnyxInitialize, telnyxDestroy]);

  // Load owned phone numbers for this organization
  useEffect(() => {
    if (!organizationId) return;
    supabase
      .from('phone_numbers')
      .select('phone_number, is_default, spam_status, area_code, friendly_name')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .then(({ data }) => {
        if (data) {
          ownedNumbers.current = data;
          const defaultNum = data.find(n => n.is_default)?.phone_number || data[0]?.phone_number || "";
          setFromNumber(defaultNum);
        }
      });
  }, [organizationId]);

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

  // Fetch recent calls when Recent tab is selected
  const fetchRecentCalls = useCallback(async () => {
    if (!user) return;
    setRecentLoading(true);
    setRecentError(false);
    try {
      const { data, error } = await supabase
        .from("calls")
        .select("id, contact_name, contact_phone, disposition_name, started_at, contact_type")
        .eq("agent_id", user.id)
        .order("started_at", { ascending: false })
        .limit(15);

      if (error) throw error;

      const mapped: RecentCall[] = (data || []).map(c => ({
        id: c.id,
        contact_name: c.contact_name,
        phone: c.contact_phone || "",
        disposition_name: c.disposition_name,
        disposition_color: null,
        created_at: c.started_at || new Date().toISOString(),
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
  }, [user]);

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

  const getPreviousCallerId = async (contactId: string): Promise<string | null> => {
    if (!contactId) return null;
    try {
      const { data } = await supabase
        .from('calls')
        .select('caller_id_used')
        .eq('contact_id', contactId)
        .not('caller_id_used', 'is', null)
        .gt('duration', 0)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.caller_id_used || null;
    } catch (err) {
      console.warn('[FloatingDialer] getPreviousCallerId failed', err);
      return null;
    }
  };

  // --- Call logic ---
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const proceedWithCall = (destinationNumber: string, callerNumber: string, callId?: string) => {
    lastUsedCallerId.current = callerNumber;
    setCurrentCallId(callId || null);
    telnyxMakeCall(destinationNumber, callerNumber || undefined, callId);
    setOnCall(true);
    setCallSeconds(0);
  };

  const initiateCall = async (destinationNumber: string, contactId: string | null) => {
    let finalCallerId = fromNumber;

    if (localPresenceEnabled && !fromNumber) {
      const autoSelected = await selectCallerID(
        { phone: destinationNumber } as any,
        user?.id || "",
        ownedNumbers.current,
        true
      );
      if (autoSelected) finalCallerId = autoSelected;
    }

    if (!finalCallerId) {
      finalCallerId = ownedNumbers.current.find(n => n.is_default)?.phone_number || ownedNumbers.current[0]?.phone_number || "";
    }

    // For all calls, create record first if possible
    let callId;
    if (user && contactId) {
      try {
        callId = await createCall({
          contact_id: contactId,
          agent_id: user.id,
          caller_id_used: finalCallerId,
          contact_name: selectedContact ? `${selectedContact.first_name} ${selectedContact.last_name}` : destinationNumber,
          contact_phone: destinationNumber,
          contact_type: selectedContact?.type,
        }, organizationId);
      } catch (err) {
        console.error("Failed to create call record:", err);
      }
    }

    if (!contactId) {
      proceedWithCall(destinationNumber, finalCallerId, callId);
      return;
    }
    const previousNumber = await getPreviousCallerId(contactId);
    if (previousNumber && !fromNumber) {
      const prevRecord = ownedNumbers.current.find(n => n.phone_number === previousNumber);
      const prevIsFlagged = prevRecord?.spam_status === 'Flagged';
      if (!prevIsFlagged) {
        proceedWithCall(destinationNumber, previousNumber, callId);
      } else {
        setPendingCall({ leadPhone: destinationNumber, contactId, proposedNumber: finalCallerId, previousNumber });
        setShowCallerIdWarning(true);
      }
    } else {
      proceedWithCall(destinationNumber, finalCallerId, callId);
    }
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
    telnyxHangUp();
    setOnCall(false);
    setShowDisposition(true);
    setSelectedDispId(null);
  }, [telnyxHangUp]);

  useEffect(() => {
    if (telnyxCallState === "ended" && onCall) {
      handleHangUp();
    }
  }, [telnyxCallState, onCall, handleHangUp]);

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
            duration_seconds: telnyxCallDuration || callSeconds,
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

  const callDisplayName = selectedContact
    ? `${selectedContact.first_name} ${selectedContact.last_name}`
    : dialedNumber;

  const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  const statusDotColor =
    telnyxStatus === 'ready' ? '#22c55e' : 
    telnyxStatus === 'connecting' ? '#eab308' :
    telnyxStatus === 'error' ? '#ef4444' : '#94a3b8';
  const shouldPulse = telnyxStatus === 'ready' || telnyxStatus === 'connecting';

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
                onClick={() => {
                  setShowCallerIdWarning(false);
                  if (pendingCall) proceedWithCall(pendingCall.leadPhone, pendingCall.proposedNumber);
                  setPendingCall(null);
                }}
                className="flex-1 py-2 rounded-lg bg-warning text-warning-foreground text-sm font-medium hover:bg-warning/90"
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
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: isDragging ? 'none' : 'opacity 150ms ease-out, transform 150ms ease-out',
            left: `${position.x}px`,
            top: `${position.y}px`,
            cursor: isDragging ? 'grabbing' : 'default',
            touchAction: 'none',
          }}
          className="fixed w-[340px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] h-auto bg-card border border-border rounded-xl shadow-2xl z-[1000] flex flex-col overflow-hidden"
        >
          <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

          {/* Panel Header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0" style={{ cursor: 'grab' }}>
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
              {telnyxStatus === 'connecting' && <span className="text-[10px] text-muted-foreground">Connecting…</span>}
              {telnyxStatus === 'ready' && <span className="text-[10px] text-muted-foreground">Ready</span>}
              {telnyxStatus === 'error' && (
                <>
                  <span className="text-[10px] text-destructive">Connection failed —</span>
                  <button onClick={() => telnyxInitialize()} className="text-[10px] text-primary underline underline-offset-2">retry</button>
                </>
              )}
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab Bar */}
          <div className="px-4 pt-3 pb-1 shrink-0">
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

          <div className="flex-1 overflow-y-auto min-h-0 bg-background/50">
            {activeTab === "recent" && (
              <div className="p-4 space-y-4">
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
              <div className="p-4 space-y-4">
                {onCall && (
                  <div className="flex flex-col items-center space-y-4">
                    <p className="font-bold text-foreground text-lg text-center">{callDisplayName}</p>
                    {selectedContact && (
                      <button onClick={() => { navigate(`/contacts?contact=${selectedContact.id}`); setOpen(false); }} className="text-sm text-teal-500 hover:text-teal-600 hover:underline">View Full Contact &rarr;</button>
                    )}
                    {lastUsedCallerId.current && <p className="text-xs text-muted-foreground">Calling from: {lastUsedCallerId.current}</p>}
                    <p className="text-3xl font-mono text-foreground">{formatTime(telnyxCallDuration || callSeconds)}</p>
                    <div className="flex items-center gap-6">
                      <div className="flex flex-col items-center gap-1">
                        <button onClick={telnyxToggleMute} className={`w-12 h-12 rounded-full flex items-center justify-center ${telnyxIsMuted ? "bg-destructive/20 text-destructive" : "bg-accent text-foreground"}`}>
                          {telnyxIsMuted ? <X className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                        </button>
                        <span className="text-xs text-muted-foreground">{telnyxIsMuted ? "Unmute" : "Mute"}</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <button className="w-12 h-12 rounded-full bg-accent text-foreground flex items-center justify-center"><Pause className="w-5 h-5" /></button>
                        <span className="text-xs text-muted-foreground">Hold</span>
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
                          <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)} className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm" />
                          <input type="time" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm" />
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

                {!onCall && !showDisposition && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-2 bg-accent/30 rounded-lg border border-border/50">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-70">From Number</span>
                        <select 
                          value={fromNumber}
                          onChange={(e) => setFromNumber(e.target.value)}
                          className="bg-transparent border-none text-xs font-semibold focus:ring-0 p-0 h-auto cursor-pointer"
                        >
                          <option value="">AI Local Presence</option>
                          {ownedNumbers.current.map(n => (
                            <option key={n.phone_number} value={n.phone_number}>{n.friendly_name || n.phone_number}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 pr-1">
                        <button
                          onClick={() => setLocalPresenceEnabled(!localPresenceEnabled)}
                          className={`w-8 h-4 rounded-full transition-colors relative ${localPresenceEnabled ? 'bg-primary' : 'bg-muted'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${localPresenceEnabled ? 'right-0.5' : 'left-0.5'}`} />
                        </button>
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
                                <p className="text-xs text-muted-foreground">{c.phone}</p>
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
                          <p className="text-xs text-muted-foreground">{selectedContact.phone}</p>
                        </div>
                        <button onClick={handleCallFromContact} className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold flex items-center gap-1.5"><Phone className="w-4 h-4" /> Call</button>
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
                      <div className="grid grid-cols-3 gap-2">
                        {keypadKeys.map(key => (
                          <button key={key} onClick={() => handleKeyPress(key)} className="h-12 rounded-lg bg-muted text-lg font-semibold hover:bg-accent">{key}</button>
                        ))}
                      </div>
                      {dialedNumber.length >= 10 && (
                        <button onClick={handleCallFromKeypad} className="w-full py-3 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold flex items-center justify-center gap-2">
                          <Phone className="w-5 h-5" /> Call
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingDialer;
