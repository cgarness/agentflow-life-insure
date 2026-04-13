import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TelnyxRTC } from "@telnyx/webrtc";
import { wireTelnyxIncomingNotifications } from "@/lib/telnyx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { resolveTelnyxNotificationBranch, isTelnyxSdkInboundDirection } from "@/lib/telnyxNotificationBranch";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import { buildOrgDidLast10Set, last10Digits, resolveInboundCallerRawNumber } from "@/lib/telnyxInboundCaller";
import {
  loadIncomingCallAlertsPrefs,
  enableIncomingCallAlertsFromUserGesture,
  showIncomingDesktopNotification,
  closeIncomingDesktopNotification,
  startIncomingRingtone,
  stopIncomingRingtone,
  isIncomingAudioPrimed,
  getDesktopNotificationPermission,
} from "@/lib/incomingCallAlerts";

/** Bridged inbound: remote audio may attach after `active` — refresh playback once per `RTCPeerConnection`. */
const inboundPeerTrackRefreshAttached = new WeakSet<RTCPeerConnection>();

/** Mic capture for Telnyx WebRTC: AEC/NS/AGC + 48 kHz mono where the browser supports it. */
const TELNYX_MIC_CAPTURE: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
  },
};

const toE164 = (phone: string): string => {
  if (!phone) return phone;
  // Already E.164
  if (phone.startsWith('+')) return phone.replace(/[^\d+]/g, '');
  // Strip all non-digits
  const digits = phone.replace(/\D/g, '');
  // 11 digits starting with 1 — US number with country code
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // 10 digits — assume US
  if (digits.length === 10) return `+1${digits}`;
  // Anything else — prepend + and hope for the best
  return `+${digits}`;
};

function extractIncomingCallerDisplay(
  call: any,
  rawNotification?: unknown,
  excludeOrgLast10?: Set<string>,
): { number: string; name: string } {
  const opts = call?.options ?? {};
  const resolved = resolveInboundCallerRawNumber(call, rawNotification, excludeOrgLast10);
  const fallbackRaw = opts.remoteCallerNumber ?? call?.remoteCallerNumber ?? "";
  const fallback = typeof fallbackRaw === "string" ? fallbackRaw.trim() : "";
  const isExcluded = (s: string) => {
    const d = s.replace(/\D/g, "");
    const l10 = d.length >= 10 ? d.slice(-10) : "";
    return l10.length === 10 && Boolean(excludeOrgLast10?.has(l10));
  };
  let num = resolved || fallback;
  if (num && isExcluded(num)) num = "";
  const name =
    opts.remoteCallerName ??
    opts.callerName ??
    call?.remoteCallerName ??
    "";
  return { number: String(num || "").trim(), name: String(name || "").trim() };
}

type TelnyxStatus = "idle" | "connecting" | "ready" | "error";
export type CallState = "idle" | "dialing" | "incoming" | "active" | "ended";

/** CRM-backed identity for inbound calls (from `calls` row / webhook + Realtime). */
export type IdentifiedContact = { name: string; number: string; type?: string };

interface OrphanCall {
  id: string;
  telnyx_call_control_id: string | null;
  contact_id: string | null;
  caller_id_used: string | null;
  started_at: string | null;
  status: string;
}

/** Options for makeCall — pass contact/campaign metadata for single-point call record creation. */
export interface MakeCallOptions {
  contactId?: string | null;
  campaignId?: string | null;
  campaignLeadId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactType?: string | null;
}

interface TelnyxContextValue {
  status: TelnyxStatus;
  errorMessage: string | null;
  currentCall: any | null;
  callState: CallState;
  callDuration: number;
  isMuted: boolean;
  isOnHold: boolean;
  defaultCallerNumber: string;
  isReady: boolean;
  ringTimeout: number;
  orphanCall: OrphanCall | null;
  connectionDropped: boolean;
  incomingCallerNumber: string;
  incomingCallerName: string;
  /** CRM match from `leads` by inbound phone (incoming ring only). */
  crmContactName: string;
  /** Lead/client name + number from `calls` row (webhook contact match + Realtime). */
  identifiedContact: IdentifiedContact | null;
  makeCall: (destinationNumber: string, callerNumber?: string, opts?: MakeCallOptions) => Promise<string | undefined>;
  hangUp: () => void;
  answerIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => void;
  hangUpOrphan: () => Promise<void>;
  dismissOrphanCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  availableNumbers: any[];
  selectedCallerNumber: string;
  setSelectedCallerNumber: (number: string) => void;
  getSmartCallerId: (contactPhone: string, contactId?: string | null) => Promise<string>;
  initializeClient: () => Promise<void>;
  destroyClient: () => void;
  /** Inbound: desktop notification + ringtone prefs (requires one-time Enable click). */
  incomingCallAlerts: {
    optIn: boolean;
    audioPrimed: boolean;
    desktopPermission: NotificationPermission | "unsupported";
    ringtoneEnabled: boolean;
    desktopEnabled: boolean;
  };
  enableIncomingCallAlerts: () => Promise<void>;
}

const TelnyxContext = createContext<TelnyxContextValue | null>(null);

export const useTelnyx = (): TelnyxContextValue => {
  const ctx = useContext(TelnyxContext);
  if (!ctx) throw new Error("useTelnyx must be used within TelnyxProvider");
  return ctx;
};

export const TelnyxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<TelnyxStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callDuration, setCallDuration] = useState(0);
  const callStateRef = useRef<CallState>(callState);
  const callDurationRef = useRef(0);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);
  useEffect(() => {
    callDurationRef.current = callDuration;
  }, [callDuration]);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [defaultCallerNumber, setDefaultCallerNumber] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [ringTimeout, setRingTimeout] = useState(30);
  const [selectedCallerNumber, setSelectedCallerNumber] = useState<string>(() => {
    return typeof window !== "undefined" ? localStorage.getItem("telnyx_manual_caller_id") || "" : "";
  });

  const [orphanCall, setOrphanCall] = useState<OrphanCall | null>(null);
  const [connectionDropped, setConnectionDropped] = useState(false);
  const [incomingCallerNumber, setIncomingCallerNumber] = useState("");
  const [incomingCallerName, setIncomingCallerName] = useState("");
  const [crmContactName, setCrmContactName] = useState("");
  const [identifiedContact, setIdentifiedContact] = useState<IdentifiedContact | null>(null);
  /** Set when `inbound-call-claim` succeeds — used to read webhook `caller_id_used` for CRM match. */
  const [inboundClaimedCallRowId, setInboundClaimedCallRowId] = useState<string | null>(null);
  const incomingCallerNumberRef = useRef("");
  const incomingCallerNameRef = useRef("");
  /** Telnyx session id for the current inbound SDK call — matches `calls.telnyx_call_id` from webhook. */
  const inboundSdkSessionIdRef = useRef("");
  useEffect(() => {
    incomingCallerNumberRef.current = incomingCallerNumber;
  }, [incomingCallerNumber]);
  useEffect(() => {
    incomingCallerNameRef.current = incomingCallerName;
  }, [incomingCallerName]);

  /** `call_logs.direction` and finalize context for inbound vs outbound. */
  const lastCallLogDirectionRef = useRef<"inbound" | "outbound">("outbound");
  const [lastCallDirection, setLastCallDirection] = useState<"inbound" | "outbound">("outbound");

  // Execution lock: prevents concurrent makeCall invocations (rapid-fire loop fix)
  const isDialingRef = useRef(false);

  // Synchronize lock with callState to ensure it is released when a call ends or is idle.
  useEffect(() => {
    if (callState === "idle" || callState === "ended") {
      isDialingRef.current = false;
    }
  }, [callState]);

  // Persist manual override to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (selectedCallerNumber) {
        localStorage.setItem("telnyx_manual_caller_id", selectedCallerNumber);
      } else {
        localStorage.removeItem("telnyx_manual_caller_id");
      }
    }
  }, [selectedCallerNumber]);

  /** Inbound ring: never show org-owned DIDs as the “customer” caller ID. */
  const inboundCallerExcludeRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    inboundCallerExcludeRef.current = buildOrgDidLast10Set(
      availableNumbers,
      defaultCallerNumber,
      selectedCallerNumber,
    );
  }, [availableNumbers, defaultCallerNumber, selectedCallerNumber]);

  const inboundCallerExcludeOrg = useMemo(
    () => buildOrgDidLast10Set(availableNumbers, defaultCallerNumber, selectedCallerNumber),
    [availableNumbers, defaultCallerNumber, selectedCallerNumber],
  );

  const clientRef = useRef<any>(null);
  /** True only after `telnyx.ready` for the current client — avoids placing calls when React status is stale or socket is half-open. */
  const telnyxSipReadyRef = useRef(false);
  /** Prevents overlapping initializeClient runs (eager app load + floating dialer open). */
  const initializeInFlightRef = useRef(false);
  /** Set on `telnyx.ready` so we can skip redundant inits (e.g. FloatingDialer open while DialerPage already connected). */
  const telnyxConnectedOrgIdRef = useRef<string | null>(null);
  const callRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const endResetRef = useRef<NodeJS.Timeout | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const activeCallIdRef = useRef<string | null>(null);
  const activeCallControlIdRef = useRef<string | null>(null);
  /** One DB sync of Telnyx IDs per outbound call (webhooks + recording depend on `calls.telnyx_call_control_id`). */
  const telnyxIdsDbSyncedRef = useRef(false);
  /** Prevents duplicate start-call-recording invocations per call. */
  const recordingStartedRef = useRef(false);
  const pendingAbortCallIdRef = useRef<string | null>(null);
  const activeLeadIdRef = useRef<string | null>(null);
  /** Skip repeat `calls` lookups for the same contact during auto-dial (invalidated when numbers change). */
  const callerIdByContactRef = useRef<Map<string, string>>(new Map());

  // Browser-side call recording (MediaRecorder)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingAudioCtxRef = useRef<AudioContext | null>(null);

  // Prevents double processing of call-end state across hangUp(), telnyx.error, and telnyx.notification handlers.
  // Reset at the start of each new call (makeCall); set when the first handler processes the end.
  const endStateProcessedRef = useRef(false);

  // bridgeAutoAnsweredRef removed — one-legged calling has no inbound bridge leg.

  // Ensure a hidden <audio> element exists for remote audio playback
  const getRemoteAudioElement = useCallback(() => {
    if (remoteAudioRef.current) return remoteAudioRef.current;
    let el = document.getElementById("telnyx-remote-audio") as HTMLAudioElement | null;
    if (!el) {
      el = document.createElement("audio");
      el.id = "telnyx-remote-audio";
      el.autoplay = true;
      el.setAttribute("playsinline", "true");
      document.body.appendChild(el);
    }
    remoteAudioRef.current = el;
    return el;
  }, []);

  // Attach remote media stream from a call object to the hidden audio element
  const attachRemoteAudio = useCallback((call: any) => {
    try {
      const stream = call?.remoteStream || call?.options?.remoteStream;
      if (stream) {
        const audioEl = getRemoteAudioElement();
        audioEl.srcObject = stream;
        audioEl.play().catch(() => { /* autoplay may be blocked */ });
      }
    } catch (err) {
      console.warn("Failed to attach remote audio:", err);
    }
  }, [getRemoteAudioElement]);

  const { profile, user } = useAuth();
  const organizationId = (profile as { organization_id?: string | null })?.organization_id;
  const authUserId = user?.id ?? profile?.id ?? null;

  // Fetch available numbers for the organization
  useEffect(() => {
    if (!profile || !organizationId) return;
    
    supabase
      .from("phone_numbers")
      .select("phone_number, is_default, spam_status, area_code, friendly_name")
      .eq("organization_id", organizationId)
      .in("status", ["active", "Active"])
      .then(({ data }) => {
        if (data) {
          setAvailableNumbers(data);
          // If no manual override is set, we still want to know the default
          const defaultNum = data.find(n => n.is_default)?.phone_number || data[0]?.phone_number || "";
          setDefaultCallerNumber(defaultNum);
        }
      });
  }, [organizationId, profile?.id]);

  useEffect(() => {
    callerIdByContactRef.current.clear();
  }, [availableNumbers, selectedCallerNumber]);

  // Fetch global phone settings (ring timeout, etc.)
  useEffect(() => {
    if (!organizationId) return;
    supabase
      .from("phone_settings")
      .select("ring_timeout")
      .eq("organization_id", organizationId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.ring_timeout) {
          setRingTimeout(data.ring_timeout);
        }
      });
  }, [organizationId, profile?.id]);

  // Resolve inbound caller against CRM (RPC: leads → campaign_leads → clients) while ringing.
  useEffect(() => {
    if (callState !== "incoming") {
      setCrmContactName("");
      return;
    }
    const raw = incomingCallerNumber.trim();
    if (!raw || raw === "Unknown caller" || !organizationId) {
      setCrmContactName("");
      return;
    }
    const digits = raw.replace(/\D/g, "");
    const last10 = digits.length >= 10 ? digits.slice(-10) : "";
    if (!last10) {
      setCrmContactName("");
      return;
    }

    let cancelled = false;

    void (async () => {
      let phoneForLookup = raw;

      if (inboundClaimedCallRowId) {
        const { data: row, error: rowErr } = await supabase
          .from("calls")
          .select("caller_id_used, contact_phone")
          .eq("id", inboundClaimedCallRowId)
          .maybeSingle();

        if (!cancelled && !rowErr && row) {
          const fromRow = String(row.caller_id_used || row.contact_phone || "").trim();
          const rowDigits = fromRow.replace(/\D/g, "");
          const rowLast10 = rowDigits.length >= 10 ? rowDigits.slice(-10) : "";
          const rowLooksLikeCustomer =
            rowDigits.length >= 10 && !inboundCallerExcludeOrg.has(rowLast10);
          if (rowLooksLikeCustomer) {
            phoneForLookup = fromRow;
            if (!cancelled && rowDigits !== digits) {
              setIncomingCallerNumber(fromRow);
            }
          }
        }
      }

      const normalized = normalizePhoneNumber(phoneForLookup);
      const normDigits = normalized.replace(/\D/g, "");
      if (normDigits.length < 10) {
        if (!cancelled) setCrmContactName("");
        return;
      }

      const { data: displayName, error } = await supabase.rpc("resolve_inbound_caller_display_name", {
        p_caller_phone: normalized || phoneForLookup,
      });

      if (cancelled) return;

      if (error) {
        console.warn("[TelnyxContext] resolve_inbound_caller_display_name:", error.message);
        setCrmContactName("");
        return;
      }

      setCrmContactName(typeof displayName === "string" ? displayName.trim() : "");
    })();

    return () => {
      cancelled = true;
    };
  }, [callState, incomingCallerNumber, organizationId, inboundClaimedCallRowId, inboundCallerExcludeOrg]);

  /** POST dialer-hangup Edge Function; used by orphan banner and silent refresh recovery. */
  const requestDialerHangup = useCallback(async (callId: string, callControlId: string | null): Promise<boolean> => {
    try {
      const { data: { session } } = await supabase.auth.refreshSession();
      if (!session?.access_token) return false;

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
      const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/dialer-hangup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          call_id: callId,
          call_control_id: callControlId,
        }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }, []);

  /**
   * Service-role claim so the agent can see the row under RLS (`calls.agent_id`).
   * Retries for several seconds: `call.initiated` webhook often lands after the first SDK notification.
   */
  const claimInboundCall = useCallback(
    async (controlId: string, telnyxCallSessionId?: string | null): Promise<string | null> => {
      const cc = controlId?.trim() ?? "";
      const sid = telnyxCallSessionId?.trim() ?? "";
      if (!cc && !sid) return null;

      const maxAttempts = 18;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return null;

        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/inbound-call-claim`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            ...(cc ? { call_control_id: cc } : {}),
            ...(sid ? { telnyx_call_id: sid } : {}),
          }),
        });

        const json = (await resp.json().catch(() => ({}))) as { id?: string; error?: string };

        if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
          console.warn("[inbound-call-claim] stopped:", resp.status, json?.error);
          return null;
        }

        if (resp.ok && json.id) {
          lastCallLogDirectionRef.current = "inbound";
          setLastCallDirection("inbound");
          return json.id;
        }

        const delay = Math.min(1200, 200 + attempt * 100);
        await new Promise((r) => setTimeout(r, delay));
      }
      return null;
    },
    []
  );

  const clearIncomingDisplay = useCallback(() => {
    setIncomingCallerNumber("");
    setIncomingCallerName("");
    setCrmContactName("");
    setIdentifiedContact(null);
    setInboundClaimedCallRowId(null);
    inboundSdkSessionIdRef.current = "";
    setLastCallDirection("outbound");
  }, []);

  const reconcileIdentifiedContactFromCallsRow = useCallback(
    async (row: Record<string, unknown> | null | undefined) => {
      if (!row || !organizationId) return;
      if (row.direction !== "inbound") return;
      if (String(row.organization_id ?? "") !== String(organizationId)) return;

      const typeRaw = typeof row.contact_type === "string" ? row.contact_type.trim() : "";
      const typeStr = typeRaw ? typeRaw.toLowerCase() : undefined;

      const nameFromRow = typeof row.contact_name === "string" ? row.contact_name.trim() : "";
      const num =
        String(row.contact_phone || row.caller_id_used || "").trim() ||
        incomingCallerNumberRef.current;

      if (nameFromRow && num) {
        setIdentifiedContact({ name: nameFromRow, number: num, type: typeStr });
      }

      if (!row.contact_id) return;

      const cid = String(row.contact_id);
      if (nameFromRow) return;

      const ct = String(row.contact_type || "lead").toLowerCase();
      const resolvedType = ct === "client" ? "client" : "lead";
      if (ct === "client") {
        const { data, error } = await supabase
          .from("clients")
          .select("first_name, last_name, phone")
          .eq("id", cid)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (error) {
          console.warn("[TelnyxContext] identifiedContact client fetch:", error.message);
          return;
        }
        if (data) {
          const n = `${data.first_name || ""} ${data.last_name || ""}`.trim() || "Client";
          setIdentifiedContact({
            name: n,
            number: String(data.phone || num || "").trim(),
            type: resolvedType,
          });
        }
      } else {
        const { data, error } = await supabase
          .from("leads")
          .select("first_name, last_name, phone")
          .eq("id", cid)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (error) {
          console.warn("[TelnyxContext] identifiedContact lead fetch:", error.message);
          return;
        }
        if (data) {
          const n = `${data.first_name || ""} ${data.last_name || ""}`.trim() || "Lead";
          setIdentifiedContact({
            name: n,
            number: String(data.phone || num || "").trim(),
            type: resolvedType,
          });
        }
      }
    },
    [organizationId],
  );

  /** Prefer PSTN ANI from `calls` (webhook `payload.from`) when the SDK shows your DID as "remote". */
  const applyInboundAniFromCallsRow = useCallback(
    (row: Record<string, unknown> | null | undefined) => {
      if (!row || !organizationId) return;
      if (row.direction !== "inbound") return;
      if (String(row.organization_id ?? "") !== String(organizationId)) return;

      const fromRow = String(row.caller_id_used || row.contact_phone || "").trim();
      if (!fromRow) return;

      const l10 = last10Digits(fromRow);
      if (!l10) return;

      const exclude = inboundCallerExcludeRef.current;
      if (exclude.has(l10)) return;

      const cur = incomingCallerNumberRef.current.trim();
      const curDigits = cur.replace(/\D/g, "");
      const curL10 = curDigits.length >= 10 ? curDigits.slice(-10) : "";
      const curIsAgency = curL10.length === 10 && exclude.has(curL10);

      if (curIsAgency || !cur || curL10 !== l10) {
        setIncomingCallerNumber(normalizePhoneNumber(fromRow) || fromRow);
      }
    },
    [organizationId],
  );

  const [incomingAlertsTick, setIncomingAlertsTick] = useState(0);
  const prevCallStateForAlertsRef = useRef<CallState>("idle");

  const incomingCallAlerts = useMemo(() => {
    void incomingAlertsTick;
    const prefs = loadIncomingCallAlertsPrefs();
    return {
      optIn: prefs.optIn,
      audioPrimed: isIncomingAudioPrimed(),
      desktopPermission: getDesktopNotificationPermission(),
      ringtoneEnabled: prefs.ringtone,
      desktopEnabled: prefs.desktop,
    };
  }, [incomingAlertsTick]);

  const enableIncomingCallAlerts = useCallback(async () => {
    const { audioPrimed, notificationPermission } = await enableIncomingCallAlertsFromUserGesture();
    setIncomingAlertsTick((t) => t + 1);
    if (callStateRef.current === "incoming") {
      const body = incomingCallerNameRef.current
        ? `${incomingCallerNameRef.current}${
            incomingCallerNumberRef.current ? ` · ${incomingCallerNumberRef.current}` : ""
          }`
        : incomingCallerNumberRef.current || "Open AgentFlow to answer";
      if (typeof document !== "undefined" && document.hidden) {
        showIncomingDesktopNotification("Incoming call — AgentFlow", body);
      }
      startIncomingRingtone();
    }
    if (notificationPermission === "granted") {
      toast.success("Desktop alerts and ringtone are on for inbound calls.");
    } else if (notificationPermission === "denied") {
      toast.message(
        "Ringtone is on for this browser. Allow notifications in your browser settings if you also want pop-up alerts."
      );
    } else if (!audioPrimed) {
      toast.error("Could not unlock call sounds. Try again or check browser audio permissions.");
    } else {
      toast.success("Inbound ringtone enabled.");
    }
  }, []);

  useEffect(() => {
    if (!organizationId || !authUserId) return;

    const channel = supabase
      .channel(`calls-identified-${authUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calls",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          if (row.direction !== "inbound") return;

          const rowAgent = row.agent_id as string | null | undefined;
          const sid = String(row.telnyx_call_id || "");
          const cc = String(row.telnyx_call_control_id || "");
          const sessionMatch = Boolean(sid && sid === inboundSdkSessionIdRef.current);
          const controlMatch = Boolean(cc && cc === activeCallControlIdRef.current);
          const unassignedRing =
            (rowAgent == null || rowAgent === "") && (sessionMatch || controlMatch);
          const assignedMine = rowAgent === authUserId;
          if (!unassignedRing && !assignedMine) return;

          applyInboundAniFromCallsRow(row);

          const eventType = String((payload as { eventType?: string }).eventType || "");
          const hasCrmMarker =
            Boolean(row.contact_id) ||
            (typeof row.contact_name === "string" && row.contact_name.trim() !== "");
          if ((eventType === "UPDATE" || eventType === "INSERT") && hasCrmMarker) {
            void reconcileIdentifiedContactFromCallsRow(row);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, authUserId, reconcileIdentifiedContactFromCallsRow, applyInboundAniFromCallsRow]);

  useEffect(() => {
    const inboundUi =
      callState === "incoming" ||
      (callState === "active" && lastCallLogDirectionRef.current === "inbound");
    if (!inboundUi || !organizationId) return;

    let cancelled = false;

    const run = async () => {
      const selectCols =
        "contact_id, contact_name, contact_phone, caller_id_used, contact_type, direction, organization_id, agent_id, telnyx_call_id, telnyx_call_control_id";

      let row: Record<string, unknown> | null = null;

      if (inboundClaimedCallRowId) {
        const { data } = await supabase
          .from("calls")
          .select(selectCols)
          .eq("id", inboundClaimedCallRowId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        row = (data as Record<string, unknown>) ?? null;
      }

      if (!row) {
        const sid = inboundSdkSessionIdRef.current;
        if (sid) {
          const { data } = await supabase
            .from("calls")
            .select(selectCols)
            .eq("organization_id", organizationId)
            .eq("direction", "inbound")
            .eq("telnyx_call_id", sid)
            .maybeSingle();
          row = (data as Record<string, unknown>) ?? null;
        }
      }

      if (!row) {
        const cc = activeCallControlIdRef.current;
        if (cc) {
          const { data } = await supabase
            .from("calls")
            .select(selectCols)
            .eq("organization_id", organizationId)
            .eq("direction", "inbound")
            .eq("telnyx_call_control_id", cc)
            .maybeSingle();
          row = (data as Record<string, unknown>) ?? null;
        }
      }

      if (cancelled || !row) return;
      applyInboundAniFromCallsRow(row);
      await reconcileIdentifiedContactFromCallsRow(row);
    };

    void run();

    const interval =
      typeof window !== "undefined" ? window.setInterval(() => void run(), 500) : 0;
    const stop =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            if (interval) window.clearInterval(interval);
          }, 4500)
        : 0;

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      if (stop) window.clearTimeout(stop);
    };
  }, [
    callState,
    organizationId,
    inboundClaimedCallRowId,
    reconcileIdentifiedContactFromCallsRow,
    applyInboundAniFromCallsRow,
  ]);

  useEffect(() => {
    const prev = prevCallStateForAlertsRef.current;
    prevCallStateForAlertsRef.current = callState;

    if (callState !== "incoming") {
      if (prev === "incoming") {
        stopIncomingRingtone();
        closeIncomingDesktopNotification();
      }
      return;
    }

    if (prev !== "incoming") {
      const body = incomingCallerName
        ? `${incomingCallerName}${incomingCallerNumber ? ` · ${incomingCallerNumber}` : ""}`
        : incomingCallerNumber || "Open AgentFlow to answer";
      if (typeof document !== "undefined" && document.hidden) {
        showIncomingDesktopNotification("Incoming call — AgentFlow", body);
      }
      startIncomingRingtone();
    }
  }, [callState, incomingCallerNumber, incomingCallerName]);

  // ─── Mid-Call Refresh Recovery ───
  // If the agent reloads mid-call, check for orphaned active calls and surface a hang-up UI
  useEffect(() => {
    if (!profile?.id || !organizationId) return;

    const checkOrphanedCalls = async () => {
      try {
        const { data, error } = await supabase
          .from('calls')
          .select('id, telnyx_call_control_id, contact_id, caller_id_used, started_at, status')
          .eq('agent_id', profile.id)
          .in('status', ['ringing', 'connected'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.warn('[TelnyxContext] Orphan call check failed:', error.message);
          return;
        }

        if (!data) return;

        // Stale call guard: if a call has been "ringing" for >5 minutes, auto-mark as failed
        const STALE_RINGING_THRESHOLD_MS = 5 * 60 * 1000;
        if (data.status === 'ringing' && data.started_at) {
          const age = Date.now() - new Date(data.started_at).getTime();
          if (age > STALE_RINGING_THRESHOLD_MS) {
            console.warn(`[TelnyxContext] Stale ringing call ${data.id} (${Math.round(age / 1000)}s old). Auto-cleaning to failed.`);
            await supabase
              .from('calls')
              .update({ status: 'failed', updated_at: new Date().toISOString() })
              .eq('id', data.id);
            return;
          }
        }

        // Silent recovery: after refresh, WebRTC cannot restore audio — same as tapping Hang Up.
        // Finalizes the DB row (and best-effort Telnyx) so ghost "connected" rows do not loop forever.
        const edgeOk = await requestDialerHangup(data.id, data.telnyx_call_control_id);
        if (edgeOk) {
          console.log(`[TelnyxContext] Orphan row ${data.id} finalized via dialer-hangup (silent refresh recovery).`);
          return;
        }

        const endedAt = new Date().toISOString();
        const startedMs = data.started_at ? new Date(data.started_at).getTime() : Date.now();
        const durationSec = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
        const { error: clientErr } = await supabase
          .from('calls')
          .update({
            status: 'completed',
            ended_at: endedAt,
            duration: durationSec,
          })
          .eq('id', data.id)
          .eq('agent_id', profile.id);

        if (!clientErr) {
          console.log(`[TelnyxContext] Orphan row ${data.id} finalized via client update (Edge fallback).`);
          return;
        }

        console.warn(`[TelnyxContext] Orphaned active call detected: ${data.id} (status=${data.status}). Surfacing recovery UI.`);
        setOrphanCall(data as OrphanCall);
      } catch (err) {
        console.warn('[TelnyxContext] Exception in orphan call check:', err);
      }
    };

    checkOrphanedCalls();
  }, [profile?.id, organizationId, requestDialerHangup]);

  const hangUpOrphan = useCallback(async () => {
    if (!orphanCall) return;

    try {
      const ok = await requestDialerHangup(orphanCall.id, orphanCall.telnyx_call_control_id);
      if (ok) {
        console.log(`[TelnyxContext] Orphaned call ${orphanCall.id} terminated successfully.`);
        toast.success('Orphaned call terminated.');
      } else {
        const { data: { session } } = await supabase.auth.refreshSession();
        if (!session?.access_token) {
          toast.error('Session expired. Please log in again.');
        } else {
          console.warn(`[TelnyxContext] Orphan hangup request failed`);
          toast.warning('Call may have already ended.');
        }
      }
    } catch (err) {
      console.error('[TelnyxContext] Error hanging up orphan call:', err);
      toast.error('Failed to terminate orphaned call.');
    } finally {
      setOrphanCall(null);
    }
  }, [orphanCall, requestDialerHangup]);

  const dismissOrphanCall = useCallback(() => {
    setOrphanCall(null);
  }, []);

  const insertCallLog = useCallback(async (duration: number, leadId: string | null) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const direction = lastCallLogDirectionRef.current;
      const { error } = await (supabase as any).from('call_logs').insert({
        user_id: session.user.id,
        lead_id: leadId,
        duration: duration,
        status: duration > 0 ? 'completed' : 'no-answer',
        direction,
      });
      
      if (error) {
        console.warn("[Automated Log] Failed to save call log:", error.message);
      }
    } catch (err) {
      console.warn("[Automated Log] Exception saving call log:", err);
    }
  }, []);

  const startBrowserRecording = useCallback((call: any) => {
    try {
      const remoteStream: MediaStream | undefined = call?.remoteStream;
      const localStream: MediaStream | undefined = call?.localStream ?? mediaStreamRef.current ?? undefined;
      if (!remoteStream) {
        console.warn("[Recording] No remote stream available — skipping browser recording");
        return;
      }

      const ctx = new AudioContext();
      recordingAudioCtxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();

      const remoteSrc = ctx.createMediaStreamSource(remoteStream);
      remoteSrc.connect(dest);

      if (localStream && localStream.getAudioTracks().length > 0) {
        const localSrc = ctx.createMediaStreamSource(localStream);
        localSrc.connect(dest);
      }

      recordingChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(dest.stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data);
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      console.log("[Recording] Browser recording started:", mimeType);
    } catch (err) {
      console.warn("[Recording] Failed to start browser recording:", err);
    }
  }, []);

  const stopBrowserRecording = useCallback((): Blob | null => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* may already be stopped */ }
    }
    mediaRecorderRef.current = null;

    if (recordingAudioCtxRef.current) {
      try { recordingAudioCtxRef.current.close(); } catch { /* ignore */ }
      recordingAudioCtxRef.current = null;
    }

    const chunks = recordingChunksRef.current;
    recordingChunksRef.current = [];
    if (chunks.length === 0) return null;

    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    console.log("[Recording] Browser recording stopped. Size:", (blob.size / 1024).toFixed(1), "KB");
    return blob;
  }, []);

  const uploadRecording = useCallback(async (callId: string, blob: Blob) => {
    try {
      const orgId = profile?.organization_id || "unknown";
      const ext = blob.type.includes("webm") ? "webm" : "ogg";
      const path = `${orgId}/${callId}.${ext}`;

      console.log("[Recording] Uploading to storage:", path);
      const { error: uploadErr } = await supabase.storage
        .from("call-recordings")
        .upload(path, blob, { contentType: blob.type, upsert: true });

      if (uploadErr) {
        console.error("[Recording] Upload failed:", uploadErr);
        return;
      }

      await supabase
        .from("calls")
        .update({ recording_url: `storage:call-recordings/${path}` } as any)
        .eq("id", callId);

      console.log("[Recording] Uploaded and saved:", path);
    } catch (err) {
      console.error("[Recording] Upload exception:", err);
    }
  }, [profile?.organization_id]);

  const finalizeCallRecord = useCallback(async (duration: number) => {
    if (!activeCallIdRef.current) return;

    const callId = activeCallIdRef.current;
    const leadId = activeLeadIdRef.current;
    
    // Clear refs immediately so we don't double-finalize
    activeCallIdRef.current = null;
    activeLeadIdRef.current = null;

    // Background log to the analytical table, non-blocking
    insertCallLog(duration, leadId).catch(console.warn);

    console.log(`[TelnyxContext] Finalizing call record ${callId} with duration ${duration}s`);

    try {
      const { error } = await supabase
        .from('calls')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          duration: duration
        })
        .eq('id', callId);

      if (error) {
        console.error("[TelnyxContext] Error finalizing call record:", error);
      }
    } catch (err) {
      console.error("[TelnyxContext] Exception during call finalization:", err);
    }
  }, []);

  const hangUp = useCallback(async () => {
    const callId = activeCallIdRef.current;
    const controlId = activeCallControlIdRef.current;

    console.log("[TelnyxContext] Initiating dual-layer hangup.", { callId, controlId });

    endStateProcessedRef.current = true;

    setIdentifiedContact(null);

    // 1. Instant UI update — triggers wrap-up phase in DialerPage
    setCallState("ended");
    
    // Check if we are in the middle of a dial initiation (Race Condition handling)
    if (callStateRef.current === "dialing" && !controlId && callId) {
      console.log("[TelnyxContext] Hangup requested during dialing; latching pending abort for:", callId);
      pendingAbortCallIdRef.current = callId;
    }

    // Clear audio immediately
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    // Layer 1: Local WebRTC Hangup leg
    if (callRef.current) {
      try { 
        callRef.current.hangup(); 
      } catch (err) {
        console.warn("[TelnyxContext] Local hangup error:", err);
      }
      callRef.current = null;
    }

    // Layer 2: Secure Server-Side Hangup via Edge Function (awaited — ensures PSTN leg is terminated)
    if (callId) {
      try {
        const { data: { session } } = await supabase.auth.refreshSession();
        if (session?.access_token) {
          const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
          const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

          const resp = await fetch(`${SUPABASE_URL}/functions/v1/dialer-hangup`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
              "apikey": SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              call_id: callId,
              call_control_id: controlId
            }),
          });
          if (!resp.ok) {
            console.error(`[TelnyxContext] Edge hangup returned HTTP ${resp.status} for call ${callId}. PSTN leg may still be alive.`);
          }
        }
      } catch (err) {
        console.error("[TelnyxContext] Edge hangup fetch failed — PSTN leg may still be alive:", err);
      }
    }

    // Immediate cleanup of local states — no delay so wrap-up UI can take over
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Reset call-specific refs synchronously (callState stays "ended" for wrap-up)
    activeCallIdRef.current = null;
    activeCallControlIdRef.current = null;
    isDialingRef.current = false;

    // Deferred cosmetic reset — gives the "ended" state time to trigger wrap-up effects
    if (endResetRef.current) { clearTimeout(endResetRef.current); endResetRef.current = null; }
    endResetRef.current = setTimeout(() => {
      endResetRef.current = null;
      setCurrentCall(null);
      setCallState("idle");
      setIsMuted(false);
      setIsOnHold(false);
      clearIncomingDisplay();
    }, 200);
  }, [clearIncomingDisplay]);

  const answerIncomingCall = useCallback(async () => {
    if (callStateRef.current !== "incoming") return;
    const call = callRef.current;
    if (!call || !isTelnyxSdkInboundDirection(call.direction)) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(TELNYX_MIC_CAPTURE);
    } catch (err) {
      console.error("[TelnyxContext] Mic denied for answer:", err);
      toast.error("Microphone access is required to answer.");
      return;
    }

    // Only one mic capture: release eager warm-up stream from initializeClient / prior calls.
    if (mediaStreamRef.current && mediaStreamRef.current !== stream) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    }
    mediaStreamRef.current = stream;

    // Telnyx `Call.answer()` instantiates the Peer with `this.options`; without `localStream`
    // the SDK may complete signaling with no microphone attached → silent / one-way audio.
    try {
      const opts = call.options as { localStream?: MediaStream } | undefined;
      if (opts && typeof opts === "object") {
        opts.localStream = stream;
      }
    } catch {
      /* ignore */
    }

    let controlId = activeCallControlIdRef.current;
    try {
      const ids = call?.telnyxIDs as { telnyxCallControlId?: string } | undefined;
      if (ids?.telnyxCallControlId) controlId = ids.telnyxCallControlId;
    } catch {
      /* ignore */
    }
    if (!controlId) {
      controlId =
        call?.telnyxCallControlId ||
        call?.options?.telnyxCallControlId ||
        null;
    }

    let sessionId: string | null = null;
    try {
      const ids = call?.telnyxIDs as { telnyxSessionId?: string } | undefined;
      if (ids?.telnyxSessionId) sessionId = ids.telnyxSessionId;
    } catch {
      /* ignore */
    }

    if (controlId || sessionId) {
      void (async () => {
        const rowId = await claimInboundCall(controlId || "", sessionId);
        if (rowId) {
          activeCallIdRef.current = rowId;
          telnyxIdsDbSyncedRef.current = true;
        }
      })();
    }

    endStateProcessedRef.current = false;
    recordingStartedRef.current = false;
    activeLeadIdRef.current = null;
    isDialingRef.current = true;

    try {
      try {
        (clientRef.current as { enableMicrophone?: () => void } | null)?.enableMicrophone?.();
      } catch {
        /* ignore */
      }
      await call.answer();
      try {
        call.unmuteAudio?.();
      } catch {
        /* SDK may not expose */
      }
      attachRemoteAudio(call);
      try {
        remoteAudioRef.current?.play?.().catch(() => {});
      } catch {
        /* ignore */
      }
      // Peer is created inside `answer()`; late remote tracks need a refresh hook.
      try {
        const pc = call.peer?.instance as RTCPeerConnection | undefined;
        if (pc && !inboundPeerTrackRefreshAttached.has(pc)) {
          inboundPeerTrackRefreshAttached.add(pc);
          const onTrack = () => {
            attachRemoteAudio(call);
            try {
              remoteAudioRef.current?.play?.().catch(() => {});
            } catch {
              /* ignore */
            }
          };
          pc.addEventListener("track", onTrack);
          window.setTimeout(() => pc.removeEventListener("track", onTrack), 30000);
        }
      } catch {
        /* ignore */
      }
    } catch (err: unknown) {
      console.error("[TelnyxContext] answer() failed:", err);
      toast.error(err instanceof Error ? err.message : "Could not answer the call.");
      isDialingRef.current = false;
    }
  }, [attachRemoteAudio, claimInboundCall]);

  const rejectIncomingCall = useCallback(() => {
    if (callStateRef.current !== "incoming") return;
    hangUp();
  }, [hangUp]);

  // Ring Timeout Logic: Auto-hangup if call stays "dialing" for too long
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (callState === "dialing" && ringTimeout > 0) {
      console.log(`[RingTimeout] Setting timer for ${ringTimeout}s`);
      timeoutId = setTimeout(async () => {
        if (isTelnyxSdkInboundDirection(callRef.current?.direction)) {
          return;
        }
        if (
          callRef.current &&
          (callRef.current.state === "ringing" ||
            callRef.current.state === "trying" ||
            callRef.current.state === "early")
        ) {
          console.log(
            `[RingTimeout] ${ringTimeout}s reached without agent leg active.`,
            { callId: activeCallIdRef.current, controlId: activeCallControlIdRef.current }
          );

          // PSTN leg can already be "connected" in Supabase (webhook) while WebRTC is still
          // ringing — do not tear down a live customer call.
          const rowId = activeCallIdRef.current;
          if (rowId) {
            const { data: row } = await supabase
              .from("calls")
              .select("status")
              .eq("id", rowId)
              .maybeSingle();
            if (row?.status === "connected") {
              console.log(
                "[RingTimeout] Skipping hangup — call row is connected (customer answered; agent audio still connecting)."
              );
              return;
            }
          }

          // Poll up to 3s (6 × 500ms) for the call_control_id to arrive via telnyx.notification.
          // The ID comes asynchronously and may not be present at exact timeout time.
          if (!activeCallControlIdRef.current) {
            console.warn("[RingTimeout] call_control_id not yet available — polling up to 3s before hanging up...");
            let waited = 0;
            while (!activeCallControlIdRef.current && waited < 3000) {
              await new Promise<void>(resolve => setTimeout(resolve, 500));
              waited += 500;
            }
            console.log(
              `[RingTimeout] Poll complete (${waited}ms). controlId=${activeCallControlIdRef.current ?? "still null"}`
            );
          }

          toast.info(`Call timed out after ${ringTimeout}s without answer.`);
          hangUp();
        }
      }, ringTimeout * 1000);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [callState, ringTimeout, hangUp]);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    try {
      if (typeof call.toggleAudioMute === "function") {
        call.toggleAudioMute();
        setIsMuted(Boolean(call.isAudioMuted));
        return;
      }
    } catch {
      /* fall through */
    }
    setIsMuted((prevMuted) => {
      const nextMuted = !prevMuted;
      try {
        if (prevMuted) call.unmuteAudio?.();
        else call.muteAudio?.();
      } catch {
        const stream: MediaStream | undefined = call.localStream ?? mediaStreamRef.current ?? undefined;
        stream?.getAudioTracks().forEach((t) => {
          t.enabled = !nextMuted;
        });
      }
      return nextMuted;
    });
  }, []);

  const toggleHold = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const targetHold = !isOnHold;
    void (async () => {
      try {
        if (targetHold) await call.hold();
        else await call.unhold();
        setIsOnHold(targetHold);
      } catch (err) {
        console.warn("[TelnyxContext] Hold/unhold failed:", err);
      }
    })();
  }, [isOnHold]);

  const getSmartCallerId = useCallback(async (contactPhone: string, contactId?: string | null): Promise<string> => {
    // 1. Manual Override always wins
    if (selectedCallerNumber) return selectedCallerNumber;

    // 2. Check Contact History (session cache avoids a DB round trip per auto-dial on the same contact)
    if (contactId) {
      const cached = callerIdByContactRef.current.get(contactId);
      if (cached) {
        const ownedCached = availableNumbers.find(
          (n) => n.phone_number === cached && n.spam_status !== "Flagged",
        );
        if (ownedCached) return cached;
        callerIdByContactRef.current.delete(contactId);
      }
      try {
        const { data } = await supabase
          .from('calls')
          .select('caller_id_used')
          .eq('contact_id', contactId)
          .not('caller_id_used', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (data?.caller_id_used) {
          // Verify we still own this number and it's not flagged
          const owned = availableNumbers.find(n => n.phone_number === data.caller_id_used);
          if (owned && owned.spam_status !== 'Flagged') {
            callerIdByContactRef.current.set(contactId, data.caller_id_used);
            return data.caller_id_used;
          }
        }
      } catch (err) {
        console.warn("Error fetching contact call history:", err);
      }
    }

    // 3. Local Presence or Area Code Match
    if (contactPhone && availableNumbers.length > 0) {
      const digits = contactPhone.replace(/\D/g, '');
      const areaCode = digits.length >= 10 ? digits.substring(digits.length - 10, digits.length - 7) : null;
      if (areaCode) {
        const match = availableNumbers.find(n => n.area_code === areaCode && n.spam_status !== 'Flagged');
        if (match) return match.phone_number;
      }
    }

    // 4. Default to Org Default (unless it's flagged)
    const def = availableNumbers.find(n => n.is_default && n.spam_status !== 'Flagged');
    if (def) return def.phone_number;

    // 5. Absolute fallback
    return availableNumbers[0]?.phone_number || defaultCallerNumber || "";
  }, [selectedCallerNumber, availableNumbers, defaultCallerNumber]);

  const initializeClient = useCallback(async () => {
    // 0. Wait for profile to load
    if (!profile) {
      console.log("TelnyxRTC waiting for profile...");
      return;
    }

    if (!organizationId) {
      console.warn("TelnyxRTC cannot initialize: User has no organization_id");
      setStatus("error");
      setErrorMessage("Your account is not associated with an organization. Please contact support.");
      return;
    }

    // 1. Re-use live client when already registered for this org (avoids dropping an active call when a second surface calls init).
    if (clientRef.current) {
      const socketUp = (clientRef.current as { connected?: boolean }).connected === true;
      const sameOrg = telnyxConnectedOrgIdRef.current === organizationId;
      if (socketUp && sameOrg && telnyxSipReadyRef.current) {
        console.log("[TelnyxContext] Telnyx already connected for this organization; skipping re-initialization.");
        setStatus("ready");
        setErrorMessage(null);
        return;
      }
      console.log("TelnyxRTC destroying existing client before re-initialization...");
      telnyxSipReadyRef.current = false;
      try {
        clientRef.current.disconnect();
      } catch (e) {
        console.warn("Error during disconnect:", e);
      }
      clientRef.current = null;
      telnyxConnectedOrgIdRef.current = null;
    }

    if (initializeInFlightRef.current) {
      console.log("[TelnyxContext] initializeClient skipped — connection setup already in progress.");
      return;
    }
    initializeInFlightRef.current = true;
    setStatus("connecting");
    setErrorMessage(null);

    try {
      // 1. Fetch credentials
      let { data: settings, error: settingsError } = await (supabase as any)
        .from("telnyx_settings")
        .select("api_key, connection_id, sip_username, sip_password")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (settingsError) throw new Error(`DB fetch error: ${settingsError.message}`);

      const creds = settings as any;
      if (!creds || !creds.api_key) {
        console.warn("No Telnyx credentials found for organization:", organizationId);
        setStatus("idle");
        setErrorMessage("No phone settings found. Please configure your Telnyx credentials in the Settings page.");
        return;
      }

      // Add robust debug logging (masked password)
      console.log("[TelnyxContext] Using credentials:", {
        sip_username: creds.sip_username,
        sip_password: creds.sip_password ? `${creds.sip_password.slice(0, 3)}***` : "missing",
        connection_id: creds.connection_id,
        api_key_present: !!creds.api_key
      });

      // 2. Fetch SIP credentials via edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke("telnyx-token", {
        body: { connection_id: creds.connection_id },
      });

      // Both token and credential auth are valid for WebRTC audio calls.
      if (tokenError || (!tokenData?.token && !tokenData?.sip_username)) {
        const msg = tokenData?.error || tokenError?.message || "Failed to provision WebRTC credentials";
        console.error("[TelnyxContext] telnyx-token error:", msg, { tokenData, tokenError });
        setStatus("error");
        setErrorMessage(msg);
        toast.error(msg);
        return;
      }

      console.log(`[TelnyxContext] Auth method: ${tokenData.auth_method}, agent: ${tokenData.sip_username}`);

      // 3. Pre-acquire microphone so permission is already granted at call time
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia(TELNYX_MIC_CAPTURE);
      } catch {
        // Mic denied — still register; makeCall will handle the prompt
      }

      // 4. Initialize TelnyxRTC — both token and credential auth support WebRTC audio.
      let client: TelnyxRTC;
      if (tokenData.auth_method === "token" && tokenData.token) {
        client = new TelnyxRTC({ login_token: tokenData.token });
      } else {
        console.log("[TelnyxContext] Using SIP credential auth.");
        client = new TelnyxRTC({ login: tokenData.sip_username, password: tokenData.sip_password });
      }

      // Required by @telnyx/webrtc: SDK wires remote RTP to this element. Manual srcObject
      // attachment alone is not reliable for bidirectional audio on bridged calls.
      client.remoteElement = getRemoteAudioElement();
      wireTelnyxIncomingNotifications(client);

      client.on("telnyx.ready", () => {
        telnyxConnectedOrgIdRef.current = organizationId;
        telnyxSipReadyRef.current = true;
        setStatus("ready");
        setErrorMessage(null);
        console.log("TelnyxRTC ready (eager init)");
        // Telnyx docs: enable mic constraints on the client before answering inbound.
        try {
          (client as { enableMicrophone?: () => void }).enableMicrophone?.();
        } catch {
          /* ignore */
        }
      });

      client.on("telnyx.error", (error: any) => {
        const errorCode = error?.code || error?.error?.code;
        const errorMsg = error?.message || error?.error?.message || '';
        const isRemoteHangup =
          errorCode === -32002 ||
          (typeof errorMsg === "string" && errorMsg.includes("CALL DOES NOT EXIST"));

        if (isRemoteHangup) {
          if (endStateProcessedRef.current) {
            console.log("[TelnyxContext] telnyx.error -32002 skipped (end state already processed).");
            callRef.current = null;
            return;
          }
          endStateProcessedRef.current = true;
          console.log("Remote party ended call — normal cleanup (code -32002)");
          setCallState("ended");
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
          }
          callRef.current = null;
          
          // Immediately finalize database record
          finalizeCallRecord(callDurationRef.current);

          // Deferred cosmetic reset — wrap-up phase (DialerPage) controls lead advancement
          if (endResetRef.current) { clearTimeout(endResetRef.current); endResetRef.current = null; }
          endResetRef.current = setTimeout(() => {
            endResetRef.current = null;
            setCurrentCall(null);
            setCallState("idle");
            setIsMuted(false);
            setIsOnHold(false);
            clearIncomingDisplay();
          }, 200);
          return;
        }

        console.error('TelnyxRTC full error:', JSON.stringify(error, null, 2));
        telnyxSipReadyRef.current = false;
        setStatus('error');

        // Login Incorrect: credentials are invalid or expired
        if (errorCode === -32001 || (typeof errorMsg === "string" && errorMsg.includes("Login Incorrect"))) {
          setErrorMessage("Login failed: Your Telnyx SIP credentials are invalid or expired. Please check your API Key, Connection ID, and SIP credentials in Phone Settings.");
          return;
        }

        const msg = errorMsg || String(errorCode) || 'Connection failed';
        setErrorMessage(msg);
      });

      const wirePeerRemoteHangup = (call: any) => {
        const pc = call?.peer?.instance as RTCPeerConnection | undefined;
        if (!pc || call._agentflowPeerHangupWired) return;
        call._agentflowPeerHangupWired = true;
        pc.addEventListener("connectionstatechange", () => {
          const s = pc.connectionState;
          if (s !== "failed" && s !== "closed") return;
          if (callRef.current !== call || endStateProcessedRef.current) return;
          endStateProcessedRef.current = true;
          setCallState("ended");
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
          }
          finalizeCallRecord(callDurationRef.current);
          if (endResetRef.current) {
            clearTimeout(endResetRef.current);
            endResetRef.current = null;
          }
          endResetRef.current = setTimeout(() => {
            endResetRef.current = null;
            setCurrentCall(null);
            setCallState("idle");
            setIsMuted(false);
            setIsOnHold(false);
            callRef.current = null;
            clearIncomingDisplay();
          }, 200);
        });
      };

      client.on("telnyx.notification", (notification: any) => {
        if (!notification.call) return;
        const call = notification.call;
        const state = call.state;
        const branch = resolveTelnyxNotificationBranch({ direction: call.direction, state });

        // For end states already processed by hangUp() or telnyx.error, skip re-triggering
        if ((state === "destroy" || state === "hangup") && endStateProcessedRef.current) {
          console.log("[TelnyxContext] Notification", state, "skipped (end state already processed).");
          callRef.current = null;
          return;
        }

        callRef.current = call;
        setCurrentCall(call);

        // Attach remote audio for ringback / early media / active (inbound ring may have no stream yet).
        if (
          state === "active" ||
          state === "ringing" ||
          state === "early" ||
          state === "trying"
        ) {
          attachRemoteAudio(call);
        }

        // Extract Telnyx IDs from the SDK (webhooks may lag; recording + hangup need DB linkage).
        let sdkControlId: string | null =
          call?.telnyxCallControlId || call?.options?.telnyxCallControlId || null;
        let sdkSessionId: string | null = null;
        try {
          const ids = call?.telnyxIDs as { telnyxCallControlId?: string; telnyxSessionId?: string } | undefined;
          if (ids?.telnyxCallControlId) sdkControlId = ids.telnyxCallControlId;
          if (ids?.telnyxSessionId) sdkSessionId = ids.telnyxSessionId;
        } catch {
          /* telnyxIDs getter — ignore */
        }
        if (sdkControlId && !activeCallControlIdRef.current) {
          activeCallControlIdRef.current = sdkControlId;
          console.log("[TelnyxContext] Captured call_control_id from SDK:", sdkControlId);
        }

        const rowId = activeCallIdRef.current;
        if (
          rowId &&
          call.direction === "outbound" &&
          sdkControlId &&
          !telnyxIdsDbSyncedRef.current
        ) {
          telnyxIdsDbSyncedRef.current = true;
          const patch: Record<string, string> = {
            telnyx_call_control_id: sdkControlId,
            updated_at: new Date().toISOString(),
          };
          if (sdkSessionId) patch.telnyx_call_id = sdkSessionId;
          void supabase
            .from("calls")
            .update(patch as any)
            .eq("id", rowId)
            .then(({ error: syncErr }) => {
              if (syncErr) {
                telnyxIdsDbSyncedRef.current = false;
                console.warn("[TelnyxContext] Failed to sync Telnyx IDs to calls row:", syncErr.message);
              } else {
                console.log("[TelnyxContext] Synced Telnyx call IDs to DB for row", rowId);
              }
            });
        }

        // Inbound: claim webhook-created row (RLS requires agent_id) — retries inside claimInboundCall.
        if (isTelnyxSdkInboundDirection(call.direction) && branch === "incoming" && !activeCallIdRef.current) {
          const cc = sdkControlId || "";
          const sid = sdkSessionId || "";
          if (cc || sid) {
            const snap = call;
            void (async () => {
              const claimedId = await claimInboundCall(cc, sid);
              if (!claimedId || callRef.current !== snap) return;
              activeCallIdRef.current = claimedId;
              setInboundClaimedCallRowId(claimedId);
              telnyxIdsDbSyncedRef.current = true;
              if (sdkSessionId) {
                void supabase
                  .from("calls")
                  .update({ telnyx_call_id: sdkSessionId, updated_at: new Date().toISOString() } as any)
                  .eq("id", claimedId);
              }
            })();
          }
        }

        // Inbound ring states before "active" — must run before active block so UI shows Answer.
        if (branch === "incoming") {
          setLastCallDirection("inbound");
          inboundSdkSessionIdRef.current = sdkSessionId || "";
          const { number, name } = extractIncomingCallerDisplay(
            call,
            notification,
            inboundCallerExcludeRef.current,
          );
          setIncomingCallerNumber(number || "Unknown caller");
          setIncomingCallerName(name);
          endStateProcessedRef.current = false;
          setCallState("incoming");
        } else if (state === "active") {
          try {
            call.stopRingback?.();
            call.stopRingtone?.();
          } catch {
            /* SDK may not expose ring helpers on all builds */
          }
          attachRemoteAudio(call);

          if (callStateRef.current === "incoming") {
            setCallDuration(0);
            if (!timerRef.current) {
              timerRef.current = setInterval(() => {
                setCallDuration((d) => d + 1);
              }, 1000);
            }
          }

          const rs = call?.remoteStream;
          const remoteTracks = rs?.getAudioTracks() ?? [];
          const ls = call?.localStream ?? mediaStreamRef.current;
          const localTracks = ls?.getAudioTracks() ?? [];

          console.log("[TelnyxContext] Call active — audio diagnostics:", {
            remoteStream: !!rs,
            remoteTracks: remoteTracks.length,
            remoteTrackStates: remoteTracks.map((t: MediaStreamTrack) => `${t.label}:${t.readyState}:enabled=${t.enabled}`),
            localStream: !!ls,
            localTracks: localTracks.length,
            localTrackStates: localTracks.map((t: MediaStreamTrack) => `${t.label}:${t.readyState}:enabled=${t.enabled}`),
            remoteElementSrc: !!remoteAudioRef.current?.srcObject,
          });

          if (remoteTracks.length === 0) {
            console.warn(
              "[TelnyxContext] Active call but no remote audio tracks — check Connection config / firewall / SRTP."
            );
          }

          if (remoteAudioRef.current?.srcObject && remoteAudioRef.current.paused) {
            remoteAudioRef.current.play().catch(() => {});
          }

          wirePeerRemoteHangup(call);
          setCallState("active");

          // Browser-side recording — captures both local + remote audio via MediaRecorder.
          // This works regardless of Telnyx Connection type (Credential or Call Control).
          if (!recordingStartedRef.current) {
            recordingStartedRef.current = true;
            startBrowserRecording(call);
          }
        } else if (branch === "dialing") {
          setCallState("dialing");
        } else if (branch === "ended") {
          endStateProcessedRef.current = true;
          setCallState("ended");
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          // Stop browser recording BEFORE releasing streams
          const recordingCallId = activeCallIdRef.current;
          const recordingBlob = stopBrowserRecording();
          if (recordingBlob && recordingCallId) {
            void uploadRecording(recordingCallId, recordingBlob);
          }

          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
          }

          // Immediately finalize database record
          finalizeCallRecord(callDurationRef.current);

          // Deferred cosmetic reset — wrap-up phase (DialerPage) controls lead advancement
          if (endResetRef.current) { clearTimeout(endResetRef.current); endResetRef.current = null; }
          endResetRef.current = setTimeout(() => {
            endResetRef.current = null;
            setCurrentCall(null);
            setCallState("idle");
            setIsMuted(false);
            setIsOnHold(false);
            callRef.current = null;
            clearIncomingDisplay();
          }, 200);
        }
      });

      clientRef.current = client;
      client.connect();
    } catch (err: any) {
      telnyxSipReadyRef.current = false;
      setStatus("error");
      setErrorMessage(err?.message || "Could not initialize dialer");
    } finally {
      initializeInFlightRef.current = false;
    }
  }, [
    attachRemoteAudio,
    getRemoteAudioElement,
    organizationId,
    profile?.id,
    finalizeCallRecord,
    claimInboundCall,
    clearIncomingDisplay,
    startBrowserRecording,
    uploadRecording,
    stopBrowserRecording,
  ]);

  // Start WebRTC registration in the background as soon as we have org context (floating dialer no longer pays full cold-start cost).
  useEffect(() => {
    if (!profile || !organizationId) return;
    void initializeClient();
  }, [profile?.id, organizationId, initializeClient]);

  const destroyClient = useCallback(() => {
    stopIncomingRingtone();
    closeIncomingDesktopNotification();
    telnyxConnectedOrgIdRef.current = null;
    telnyxSipReadyRef.current = false;
    if (clientRef.current) {
      try { (clientRef.current as any).disconnect(); } catch {} // eslint-disable-line no-empty
      clientRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (endResetRef.current) {
      clearTimeout(endResetRef.current);
      endResetRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    callRef.current = null;
    endStateProcessedRef.current = false;
    setStatus("idle");
    setErrorMessage(null);
    setCurrentCall(null);
    setCallState("idle");
    setCallDuration(0);
    setIsMuted(false);
    setIsOnHold(false);
    clearIncomingDisplay();
  }, [clearIncomingDisplay]);

  // Call duration timer — start when active, stop otherwise
  useEffect(() => {
    if (callState === "dialing") {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } else if (callState === "ended" && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [callState]);

  // Standard UUID string shape (any version) — Postgres accepts v1–v5; a v4-only
  // regex was dropping valid lead IDs so `contact_id` stayed null and history/recordings never linked.
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValidUUID = (val?: string | null): val is string => !!val && UUID_REGEX.test(val);

  const makeCall = useCallback(async (destinationNumber: string, callerNumber?: string, opts?: MakeCallOptions): Promise<string | undefined> => {
    if (isDialingRef.current) {
      console.warn("[TelnyxContext] makeCall blocked — already dialing (execution lock).");
      toast.error("A call is already starting. Please wait.");
      return undefined;
    }

    if (
      callStateRef.current === "incoming" ||
      callStateRef.current === "active" ||
      callStateRef.current === "dialing"
    ) {
      toast.error("Finish or decline the current call before placing another.");
      return undefined;
    }

    // Authoritative gate: SIP registration complete (avoids races where UI shows Ready too early).
    if (!telnyxSipReadyRef.current) {
      const msg =
        status === "connecting"
          ? "Phone is still connecting. Wait until the dialer shows Ready."
          : "Phone is not connected yet. Wait a few seconds or tap retry in the dialer header.";
      console.warn("[TelnyxContext] makeCall blocked — SIP not registered. Status:", status);
      toast.error(msg);
      return undefined;
    }

    if (!clientRef.current) {
      console.warn("[TelnyxContext] makeCall blocked — no client instance.");
      toast.error("Phone connection is not available. Open the dialer to reconnect.");
      return undefined;
    }

    if (status !== "ready") {
      const msg =
        status === "connecting"
          ? "Phone is still connecting, please wait."
          : "Dialer is not connected. Check your credentials in Settings.";
      console.warn("TelnyxRTC not ready, cannot make call. Status:", status);
      toast.error(msg);
      return undefined;
    }

    endStateProcessedRef.current = false;

    const { data: { session: existing }, error: getErr } = await supabase.auth.getSession();
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = existing?.expires_at;
    const stale =
      getErr ||
      !existing?.access_token ||
      (typeof exp === "number" && exp - nowSec < 120);

    let session = existing;
    if (stale) {
      const { data: { session: refreshed }, error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshed?.access_token || refreshErr) {
        console.warn("[TelnyxContext] Call blocked: No active auth session.", refreshErr || getErr);
        toast.error("Authentication error: Session invalid or expired. Please log in to make calls.");
        return undefined;
      }
      session = refreshed;
    }

    if (!session?.access_token) {
      console.warn("[TelnyxContext] Call blocked: No active session after refresh check.");
      toast.error("Authentication error: Session invalid or expired. Please log in to make calls.");
      return undefined;
    }

    const orgIdClaim = session.user.app_metadata?.organization_id;
    if (!orgIdClaim) {
      toast.error("Security Block: No Valid Organization Token.");
      return undefined;
    }

    if (!profile?.id) {
      toast.error("Your profile is still loading. Try again in a moment.");
      return undefined;
    }

    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia(TELNYX_MIC_CAPTURE);
    } catch (err) {
      console.error("Microphone permission denied:", err);
      setStatus("error");
      setErrorMessage("Microphone access is required to make calls. Please allow microphone access in your browser and try again.");
      toast.error("Microphone access is required to place calls.");
      return undefined;
    }

    isDialingRef.current = true;
    lastCallLogDirectionRef.current = "outbound";
    setLastCallDirection("outbound");

    try {
      setInboundClaimedCallRowId(null);
      activeLeadIdRef.current = isValidUUID(opts?.contactId) ? opts!.contactId! : null;
      setCallState("dialing");
      setIsMuted(false);
      setIsOnHold(false);
      setConnectionDropped(false);

      const callerIdUsed = callerNumber || defaultCallerNumber;
      if (!callerIdUsed) {
        throw new Error("No caller ID selected. Please select a phone number to dial from in the Dialer settings.");
      }

      // ── SINGLE CALL RECORD CREATION ──
      const { data: callRecord, error: callError } = await (supabase as any)
        .from('calls')
        .insert({
          contact_id: isValidUUID(opts?.contactId) ? opts!.contactId : null,
          organization_id: organizationId,
          agent_id: profile.id,
          campaign_id: opts?.campaignId || null,
          campaign_lead_id: opts?.campaignLeadId || null,
          contact_name: opts?.contactName || null,
          contact_phone: opts?.contactPhone || destinationNumber,
          contact_type: opts?.contactType || null,
          status: 'ringing',
          direction: 'outbound',
          caller_id_used: callerIdUsed,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .maybeSingle();

      if (callError) throw new Error(`Failed to create call record: ${callError.message}`);
      if (!callRecord) throw new Error("Failed to create call record: no data returned");

      activeCallIdRef.current = callRecord.id;
      activeCallControlIdRef.current = null;
      telnyxIdsDbSyncedRef.current = false;
      recordingStartedRef.current = false;

      // ── ONE-LEGGED CALL: WebRTC SDK dials the customer directly ──
      // Audio flows natively through the WebRTC channel — no SIP transfer or bridge needed.
      // The SDK sends a SIP INVITE through the registered Connection; Telnyx routes to PSTN.
      // Webhooks (call.initiated, call.answered, call.hangup) fire on the Connection's
      // Call Control Application and link back to our DB record via client_state.
      console.log("[TelnyxContext] Initiating one-legged WebRTC call:", {
        to: toE164(destinationNumber),
        from: toE164(callerIdUsed),
        callId: callRecord.id,
      });

      const call = (clientRef.current as any).newCall({
        destinationNumber: toE164(destinationNumber),
        callerNumber: toE164(callerIdUsed),
        callerName: opts?.contactName || "",
        clientState: btoa(callRecord.id),
        audio: true,
        localStream: mediaStreamRef.current,
      });

      callRef.current = call;
      setCurrentCall(call);

      return callRecord.id;
    } catch (err: any) {
      console.error("Failed to start call:", err);
      toast.error(err.message || "Failed to start call");
      setCallState("idle");
      isDialingRef.current = false;
      return undefined;
    }
    // isDialingRef stays true until the call ends (released in useEffect on idle/ended).
  }, [status, defaultCallerNumber, attachRemoteAudio, organizationId, profile?.id]);


  // Network resilience: Auto-reconnect if internet blips
  useEffect(() => {
    const handleOnline = () => {
      console.log("[TelnyxContext] Network restored. Re-initializing client...");
      setConnectionDropped(false);
      if (status === "error" || !clientRef.current) {
         // Add a tiny delay to ensure socket is actually ready
         setTimeout(() => initializeClient(), 1000);
      }
    };
    
    const handleOffline = () => {
       console.warn("[TelnyxContext] Network connectivity lost.");
       setStatus("error");
       setErrorMessage("Internet connection lost. Call may have dropped. Waiting to reconnect...");
       // Instead of calling hangUp() which bypasses wrap-up, transition to "ended" state.
       // This forces the DialerPage wrap-up phase so the agent can log the drop.
       if (callState === "active" || callState === "dialing" || callState === "incoming") {
         setConnectionDropped(true);
         setCallState("ended");
         setIdentifiedContact(null);
         inboundSdkSessionIdRef.current = "";
         // Clean up local WebRTC state without triggering full hangUp flow
         if (callRef.current) {
           try { callRef.current.hangup(); } catch { /* connection already lost */ }
           callRef.current = null;
         }
         if (timerRef.current) {
           clearInterval(timerRef.current);
           timerRef.current = null;
         }
       }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, [status, callState, initializeClient]);

  const isReady = status === "ready";

  return (
    <TelnyxContext.Provider
      value={{
        status,
        errorMessage,
        currentCall,
        callState,
        callDuration,
        isMuted,
        isOnHold,
        defaultCallerNumber,
        isReady,
        ringTimeout,
        orphanCall,
        connectionDropped,
        incomingCallerNumber,
        incomingCallerName,
        crmContactName,
        identifiedContact,
        lastCallDirection,
        availableNumbers,
        selectedCallerNumber,
        setSelectedCallerNumber,
        getSmartCallerId,
        makeCall,
        hangUp,
        answerIncomingCall,
        rejectIncomingCall,
        hangUpOrphan,
        dismissOrphanCall,
        toggleMute,
        toggleHold,
        initializeClient,
        destroyClient,
        incomingCallAlerts,
        enableIncomingCallAlerts,
      }}
    >
      {children}
    </TelnyxContext.Provider>
  );
};
