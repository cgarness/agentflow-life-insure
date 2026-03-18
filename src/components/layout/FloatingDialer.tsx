import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Phone, X, Mic, Pause, Voicemail,
  PhoneOff, Search, Delete, Loader2, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { loadPhoneNumbers, pickCallerId, formatPhoneDisplay, type PhoneNumberCache, type CallerIdResult } from "@/lib/local-presence";
import { triggerWin, isSaleDisposition } from "@/lib/win-trigger";
import { useAuth } from "@/contexts/AuthContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface ContactResult {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
}

interface DispositionRow {
  id: string;
  name: string;
  color: string;
}

interface RecentCall {
  id: string;
  contact_name: string | null;
  phone: string;
  disposition_name: string | null;
  disposition_color: string | null;
  created_at: string;
}

function timeAgo(dateStr: string): string {
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
    makeCall: telnyxMakeCall,
    hangUp: telnyxHangUp,
    toggleMute: telnyxToggleMute,
    defaultCallerNumber: telnyxDefaultCaller,
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

  // --- Phone number selector ---
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState<string | null>(null);

  // --- Keypad state ---
  const [dialedNumber, setDialedNumber] = useState("");

  // --- Call state ---
  const [onCall, setOnCall] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);

  // --- Post-call disposition state ---
  const [showDisposition, setShowDisposition] = useState(false);
  const [dispositions, setDispositions] = useState<DispositionRow[]>([]);
  const [selectedDispId, setSelectedDispId] = useState<string | null>(null);

  // --- Telnyx (from shared context) ---
  const clientRef = useRef<Record<string, unknown>>(null);
  const callRef = useRef<Record<string, unknown>>(null);
  const dialerReady = telnyxStatus === "ready";

  // --- Local Presence phone cache ---
  const [phoneCache, setPhoneCache] = useState<PhoneNumberCache | null>(null);
  const [activeCallerId, setActiveCallerId] = useState<CallerIdResult | null>(null);

  const refreshPhoneCache = useCallback(async () => {
    const cache = await loadPhoneNumbers();
    setPhoneCache(cache);
  }, []);

  useEffect(() => { refreshPhoneCache(); }, [refreshPhoneCache]);

  // Derive caller ID for current destination
  const currentCallerId = useMemo<CallerIdResult>(() => {
    const phone = selectedContact?.phone || dialedNumber;
    if (!phoneCache || !phone) return { callerNumber: "", matchType: "none", matchedAreaCode: null };
    return pickCallerId(phone, phoneCache);
  }, [selectedContact?.phone, dialedNumber, phoneCache]);

  const callerNumber = selectedPhoneNumber || currentCallerId.callerNumber || "+10000000000";

  // Listen for toggle event from TopBar
  useEffect(() => {
    const handler = () => setOpen((prev) => !prev);
    window.addEventListener("toggle-floating-dialer", handler);
    return () => window.removeEventListener("toggle-floating-dialer", handler);
  }, []);

  // Listen for quick-call event from campaign leads
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
        });
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

  // Open animation toggle
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setIsVisible(true), 0);
      return () => clearTimeout(t);
    } else {
      setIsVisible(false);
    }
  }, [open]);

  // Fetch active phone numbers for selector
  const { data: phoneNumbers = [] } = useQuery({
    queryKey: ['phone-numbers-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('phone_numbers')
        .select('*')
        .eq('status', 'active')
        .order('is_default', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (phoneNumbers.length > 0 && !selectedPhoneNumber) {
      const defaultNumber = phoneNumbers.find((p: any) => p.is_default);
      setSelectedPhoneNumber(defaultNumber?.phone_number || phoneNumbers[0].phone_number);
    }
  }, [phoneNumbers, selectedPhoneNumber]);

  // Telnyx connection managed by shared TelnyxContext

  // Fetch dispositions for post-call
  useEffect(() => {
    supabase
      .from("dispositions")
      .select("id, name, color")
      .order("sort_order")
      .then(({ data }) => {
        if (data) setDispositions(data);
      });
  }, []);

  // Fetch recent calls when Recent tab is selected
  const fetchRecentCalls = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(false);
    try {
      // "calls" table doesn't exist in the schema — use empty array as fallback
      setRecentCalls([]);
      setRecentError(false);
    } catch {
      setRecentError(true);
      setRecentCalls([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

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
        .select("id, first_name, last_name, phone")
        .or(
          `first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%`
        )
        .limit(5);
      setSearchResults(data || []);
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

  // --- Call ---
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const startCall = (destinationNumber: string) => {
    setActiveCallerId(currentCallerId);
    telnyxMakeCall(destinationNumber, callerNumber);
    setOnCall(true);
    setCallSeconds(0);
  };

  const handleCallFromContact = () => {
    if (!selectedContact) return;
    startCall(selectedContact.phone);
  };

  const handleCallFromKeypad = () => {
    if (dialedNumber.length < 10) return;
    startCall(dialedNumber);
  };

  const handleHangUp = useCallback(() => {
    telnyxHangUp();
    setOnCall(false);
    setShowDisposition(true);
    setSelectedDispId(null);
  }, [telnyxHangUp]);

  const resetAll = () => {
    setShowDisposition(false);
    setSelectedDispId(null);
    setSelectedContact(null);
    setSearchTerm("");
    setSearchResults([]);
    setShowDropdown(false);
    setDialedNumber("");
    setCallSeconds(0);
    setOpen(false);
  };

  const handleSaveDisposition = () => {
    const disp = dispositions.find((d) => d.id === selectedDispId);
    if (disp) {
      console.log("Disposition saved:", { id: disp.id, name: disp.name });
      
      // Trigger win celebration if this is a sale disposition
      if (isSaleDisposition(disp.name) && user && profile) {
        const agentName = `${profile.first_name} ${profile.last_name}`;
        const contactName = selectedContact 
          ? `${selectedContact.first_name} ${selectedContact.last_name}` 
          : dialedNumber;
        triggerWin({
          agentId: user.id,
          agentName,
          contactName,
          contactId: selectedContact?.id,
          policyType: disp.name,
        });
      }
    }
    resetAll();
  };

  const handleSkip = () => {
    resetAll();
  };

  // --- Determine display name for active call ---
  const callDisplayName = selectedContact
    ? `${selectedContact.first_name} ${selectedContact.last_name}`
    : dialedNumber;

  const keypadKeys = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    "*", "0", "#",
  ];

  const statusDotColor =
    telnyxStatus === 'ready' ? '#22c55e' : '#94a3b8';
  const shouldPulse =
    telnyxStatus === 'ready' && telnyxCallState !== 'active';

  return (
    <>
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
          className="fixed w-[340px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
        >
          <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

          {/* Panel Header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
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
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Calling From Selector */}
          <div style={{ padding: '4px 12px 8px' }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>Calling from</span>
              <Select
                value={selectedPhoneNumber || ''}
                onValueChange={setSelectedPhoneNumber}
              >
                <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                  <SelectValue placeholder="Select number" />
                </SelectTrigger>
                <SelectContent>
                  {phoneNumbers.map((phone: any) => (
                    <SelectItem key={phone.id} value={phone.phone_number}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{phone.phone_number}</span>
                        {phone.is_default && (
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">Default</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="px-4 pt-3 pb-1 shrink-0">
            <div className="flex bg-accent rounded-lg p-0.5">
              <button
                onClick={() => setActiveTab("dial")}
                className={`flex-1 py-1.5 text-xs rounded-md text-center transition-colors ${activeTab === "dial"
                    ? "bg-background text-foreground shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                Dial
              </button>
              <button
                onClick={() => setActiveTab("recent")}
                className={`flex-1 py-1.5 text-xs rounded-md text-center transition-colors ${activeTab === "recent"
                    ? "bg-background text-foreground shadow-sm font-medium"
                    : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                Recent
              </button>
            </div>
          </div>

          <div className="p-4 space-y-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
            {/* ===== RECENT TAB ===== */}
            {activeTab === "recent" && (
              <div>
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
                          setSelectedContact({
                            id: call.id,
                            first_name: parts[0],
                            last_name: parts.slice(1).join(" "),
                            phone: call.phone,
                          });
                          setSearchTerm(name);
                          setActiveTab("dial");
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-accent text-left"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-foreground truncate">
                            {call.contact_name || call.phone}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {timeAgo(call.created_at)}
                          </p>
                        </div>
                        {call.disposition_name && (
                          <span
                            className="ml-2 shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                            style={{ backgroundColor: call.disposition_color ?? "#6b7280" }}
                          >
                            {call.disposition_name}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ===== DIAL TAB ===== */}
            {activeTab === "dial" && <>
              {/* ===== ACTIVE CALL STATE ===== */}
              {onCall && (
                <div className="flex flex-col items-center space-y-4">
                  <p className="font-bold text-foreground text-lg text-center">
                    {callDisplayName}
                  </p>
                  {selectedContact && (
                    <button
                      onClick={() => {
                        navigate(`/contacts?contact=${selectedContact.id}`);
                        setOpen(false);
                      }}
                      className="text-sm text-teal-500 hover:text-teal-600 hover:underline"
                    >
                      View Full Contact &rarr;
                    </button>
                  )}
                  {activeCallerId && (
                    <p className="text-xs text-muted-foreground">
                      Calling from: {formatPhoneDisplay(activeCallerId.callerNumber)}
                    </p>
                  )}
                  <p className="text-3xl font-mono text-foreground">
                    {formatTime(telnyxCallDuration || callSeconds)}
                  </p>
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={telnyxToggleMute}
                        className={`w-12 h-12 rounded-full flex items-center justify-center ${telnyxIsMuted ? "bg-destructive/20 text-destructive" : "bg-accent text-foreground"}`}
                      >
                        {telnyxIsMuted ? <X className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                      </button>
                      <span className="text-xs text-muted-foreground">{telnyxIsMuted ? "Unmute" : "Mute"}</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <button className="w-12 h-12 rounded-full bg-accent text-foreground flex items-center justify-center">
                        <Pause className="w-5 h-5" />
                      </button>
                      <span className="text-xs text-muted-foreground">Hold</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <button className="w-12 h-12 rounded-full bg-accent text-foreground flex items-center justify-center">
                        <Voicemail className="w-5 h-5" />
                      </button>
                      <span className="text-xs text-muted-foreground">VM Drop</span>
                    </div>
                  </div>
                  <button
                    onClick={handleHangUp}
                    className="w-full py-3 rounded-lg bg-destructive text-destructive-foreground font-semibold flex items-center justify-center gap-2"
                  >
                    <PhoneOff className="w-5 h-5" /> Hang Up
                  </button>
                </div>
              )}

              {/* ===== POST-CALL DISPOSITION ===== */}
              {!onCall && showDisposition && (
                <div className="flex flex-col items-center space-y-3">
                  <p className="font-medium text-foreground text-center">
                    How did it go?
                  </p>
                  <p className="text-sm text-muted-foreground text-center">
                    Select a disposition
                  </p>
                  <div className="grid grid-cols-2 gap-2 w-full">
                    {dispositions.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDispId(d.id)}
                        className={`px-3 py-2 rounded-full text-sm font-bold text-white ${selectedDispId === d.id
                            ? "ring-2 ring-offset-2 ring-foreground"
                            : ""
                          }`}
                        style={{
                          backgroundColor: d.color,
                          boxShadow: selectedDispId === d.id
                            ? `0 0 10px ${d.color}88`
                            : "none",
                        }}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleSaveDisposition}
                    disabled={!selectedDispId}
                    className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50"
                  >
                    Save &amp; Close
                  </button>
                  <button
                    onClick={handleSkip}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Skip
                  </button>
                </div>
              )}

              {/* ===== IDLE STATE: SEARCH + KEYPAD ===== */}
              {!onCall && !showDisposition && (
                <>
                  {/* SECTION 1 — Contact Search */}
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search contacts..."
                        value={searchTerm}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="w-full h-10 pl-9 pr-8 rounded-lg bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                      {searchTerm && (
                        <button
                          onClick={clearSearch}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Search dropdown */}
                    {showDropdown && (
                      <div className="absolute top-full mt-1 w-full bg-card border border-border rounded-lg shadow-lg z-10 py-1 max-h-60 overflow-y-auto">
                        {searchLoading && (
                          <div className="flex items-center justify-center py-3">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {!searchLoading && searchResults.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-3">
                            No contacts found
                          </p>
                        )}
                        {!searchLoading &&
                          searchResults.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => handleSelectContact(c)}
                              className="w-full px-3 py-2 text-left hover:bg-accent"
                            >
                              <p className="font-bold text-sm text-foreground">
                                {c.first_name} {c.last_name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {c.phone}
                              </p>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Selected contact card */}
                  {selectedContact && (
                    <div className="bg-accent/50 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-foreground text-sm">
                          {selectedContact.first_name} {selectedContact.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {selectedContact.phone}
                        </p>
                        {/* Caller ID */}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {currentCallerId.matchType === "local" ? (
                            <>
                              <span className="text-[10px] text-muted-foreground">From: {formatPhoneDisplay(currentCallerId.callerNumber)}</span>
                              <span className="bg-green-500/10 text-green-600 px-1 py-0.5 rounded text-[9px] font-medium">Local ({currentCallerId.matchedAreaCode})</span>
                            </>
                          ) : currentCallerId.matchType === "default" ? (
                            <>
                              <span className="text-[10px] text-muted-foreground">From: {formatPhoneDisplay(currentCallerId.callerNumber)}</span>
                              <span className="bg-muted text-muted-foreground px-1 py-0.5 rounded text-[9px] font-medium">Default</span>
                            </>
                          ) : (
                            <span className="text-[10px] text-destructive">No caller ID</span>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button onClick={refreshPhoneCache} className="text-muted-foreground hover:text-foreground p-0.5">
                                <RefreshCw className="w-2.5 h-2.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Refresh phone numbers</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                      <button
                        onClick={handleCallFromContact}
                        className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-semibold flex items-center gap-1.5"
                      >
                        <Phone className="w-4 h-4" /> Call
                      </button>
                    </div>
                  )}

                  {/* SECTION 2 — Divider */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">
                      or dial manually
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* SECTION 3 — Keypad */}
                  <div className="space-y-3">
                    {/* Number display */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-10 px-3 rounded-lg bg-muted flex items-center">
                        <span className="font-mono text-foreground text-lg text-left truncate">
                          {dialedNumber}
                        </span>
                      </div>
                      <button
                        onClick={handleBackspace}
                        className="w-10 h-10 rounded-lg bg-muted text-foreground flex items-center justify-center hover:bg-accent"
                      >
                        <Delete className="w-5 h-5" />
                      </button>
                    </div>

                    {/* 3x4 Grid */}
                    <div className="grid grid-cols-3 gap-2">
                      {keypadKeys.map((key) => (
                        <button
                          key={key}
                          onClick={() => handleKeyPress(key)}
                          onMouseDown={() => setPressedKey(key)}
                          onMouseUp={() => setPressedKey(null)}
                          onMouseLeave={() => setPressedKey(null)}
                          style={{
                            transition: 'transform 100ms',
                            transform: pressedKey === key ? 'scale(0.95)' : 'scale(1)',
                          }}
                          className="h-12 rounded-lg bg-muted text-foreground text-lg font-semibold hover:bg-accent flex items-center justify-center"
                        >
                          {key}
                        </button>
                      ))}
                    </div>

                    {/* Call button when 10+ digits */}
                    {dialedNumber.length >= 10 && (
                      <button
                        onClick={handleCallFromKeypad}
                        className="w-full py-3 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold flex items-center justify-center gap-2"
                      >
                        <Phone className="w-5 h-5" /> Call
                      </button>
                    )}
                  </div>
                </>
              )}
            </>}
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingDialer;
