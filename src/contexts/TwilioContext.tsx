import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Device } from "@twilio/voice-sdk";
import {
  initTwilioDevice,
  destroyTwilioDevice,
  twilioMakeCall,
  twilioHangUp,
  twilioHangUpAll,
  twilioAnswerCall,
  getTwilioDevice,
  getCallSid,
  getCallDirection,
  getCallStatus,
  clearIncomingCallHandlers,
  subscribeToIncomingCalls,
  type TwilioCall,
} from "@/lib/twilio-voice";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { isVoiceSdkInboundDirection } from "@/lib/voiceSdkNotificationBranch";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import {
  OUTBOUND_CALL_DIRECTIONS,
  buildOrgDidLast10Set,
  isCallsRowInboundDirection,
  isInboundNameSameAsPhoneNumber,
  last10Digits,
  providerCallSidsEqual,
  resolveInboundCallerRawNumber,
  stripIfOrgOwnedPhoneLabel,
} from "@/lib/webrtcInboundCaller";
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
import {
  startRecording as startBrowserCallRecording,
  stopRecording as stopBrowserCallRecording,
  uploadCallRecording,
} from "@/lib/browser-recording";
import { getStateByAreaCode } from "@/lib/caller-id-selection";
import {
  CALLER_ID_STICKY_MIN_DURATION_SEC,
  selectOutboundCallerId,
} from "@/lib/caller-id-selection";

/** Mic capture for WebRTC: AEC/NS/AGC + 48 kHz mono where the browser supports it. */
const VOICE_MIC_CAPTURE: MediaStreamConstraints = {
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
  num = stripIfOrgOwnedPhoneLabel(String(num || "").trim(), excludeOrgLast10);

  const nameCandidates = [opts.remoteCallerName, call?.remoteCallerName, opts.callerName];
  let name = "";
  for (const c of nameCandidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (!t || /^outbound call$/i.test(t)) continue;
    const stripped = stripIfOrgOwnedPhoneLabel(t, excludeOrgLast10);
    if (stripped) {
      name = stripped;
      break;
    }
  }

  return { number: String(num || "").trim(), name: String(name || "").trim() };
}

type VoiceClientStatus = "idle" | "connecting" | "ready" | "error";
export type CallState = "idle" | "dialing" | "incoming" | "active" | "ended";

/** CRM-backed identity for inbound calls (from `calls` row / webhook + Realtime). */
export type IdentifiedContact = { name: string; number: string; type?: string };

interface OrphanCall {
  id: string;
  twilio_call_sid: string | null;
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

/** Optional campaign-level override for `getSmartCallerId` (falls back to org Phone Settings). */
export type SmartCallerIdOptions = {
  localPresenceEnabled?: boolean;
};

export interface TwilioContextValue {
  status: VoiceClientStatus;
  errorMessage: string | null;
  currentCall: any | null;
  callState: CallState;
  callDuration: number;
  isMuted: boolean;
  isOnHold: boolean;
  defaultCallerNumber: string;
  isReady: boolean;
  ringTimeout: number;
  /**
   * DialerPage pushes the merged outbound ring seconds (campaign → phone_settings → default).
   * Pass `null` when leaving the dialer so org `phone_settings` baseline applies elsewhere.
   */
  applyDialSessionRingTimeout: (seconds: number | null) => void;
  orphanCall: OrphanCall | null;
  connectionDropped: boolean;
  incomingCallerNumber: string;
  incomingCallerName: string;
  /** CRM match from `leads` by inbound phone (incoming ring only). */
  crmContactName: string;
  /** Lead/client name + number from `calls` row (webhook contact match + Realtime). */
  identifiedContact: IdentifiedContact | null;
  lastCallDirection: "inbound" | "outbound";
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
  getSmartCallerId: (
    contactPhone: string,
    contactId?: string | null,
    opts?: SmartCallerIdOptions,
  ) => Promise<string>;
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

const TwilioVoiceReactContext = createContext<TwilioContextValue | null>(null);

export const useTwilio = (): TwilioContextValue => {
  const ctx = useContext(TwilioVoiceReactContext);
  if (!ctx) throw new Error("useTwilio must be used within TwilioProvider");
  return ctx;
};

export const TwilioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<VoiceClientStatus>("idle");
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
  const [phoneBaselineRing, setPhoneBaselineRing] = useState(25);
  /** Merged seconds from DialerPage (campaign + org); null = use org baseline only. */
  const [dialSessionRingOverride, setDialSessionRingOverride] = useState<number | null>(null);
  /** True while DialerPage owns merged ring policy (suppress duplicate timeout toast here). */
  const dialerRingSessionActiveRef = useRef(false);
  const latestRingTimeoutRef = useRef(25);
  const ringTimeout = useMemo(() => {
    if (dialSessionRingOverride != null && dialSessionRingOverride > 0) return dialSessionRingOverride;
    if (phoneBaselineRing > 0) return phoneBaselineRing;
    return 25;
  }, [dialSessionRingOverride, phoneBaselineRing]);
  latestRingTimeoutRef.current = ringTimeout;

  const applyDialSessionRingTimeout = useCallback((seconds: number | null) => {
    if (seconds == null || (typeof seconds === "number" && (Number.isNaN(seconds) || seconds <= 0))) {
      dialerRingSessionActiveRef.current = false;
      setDialSessionRingOverride(null);
      return;
    }
    dialerRingSessionActiveRef.current = true;
    setDialSessionRingOverride(seconds);
  }, []);
  /** Org default from `phone_settings.api_secret` JSON (`local_presence_enabled`). */
  const [orgLocalPresenceEnabled, setOrgLocalPresenceEnabled] = useState(true);
  const [selectedCallerNumber, setSelectedCallerNumber] = useState<string>(() => {
    return typeof window !== "undefined" ? localStorage.getItem("voice_manual_caller_id") || "" : "";
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
  /** Inbound SDK session id — matches `calls.provider_session_id` from webhook. */
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
  /** Drives outbound ring-timeout effect deps once per placed call (avoids resetting timer on dialing→active). */
  const [outboundRingSessionId, setOutboundRingSessionId] = useState<string | null>(null);

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
        localStorage.setItem("voice_manual_caller_id", selectedCallerNumber);
      } else {
        localStorage.removeItem("voice_manual_caller_id");
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

  const deviceRef = useRef<Device | null>(null);
  /** True only after `registered` (Twilio Device) for the current client — avoids placing calls when React status is stale or socket is half-open. */
  const twilioVoiceReadyRef = useRef(false);
  /** Prevents overlapping initializeClient runs (eager app load + floating dialer open). */
  const initializeInFlightRef = useRef(false);
  /** Set on `registered` (Twilio Device) so we can skip redundant inits (e.g. FloatingDialer open while DialerPage already connected). */
  const twilioVoiceOrgIdRef = useRef<string | null>(null);
  const callRef = useRef<any>(null);
  /** Last inbound notification envelope for the current inbound ring — re-run ANI extract when org-DID exclude set loads. */
  const lastInboundNotificationRef = useRef<unknown>(undefined);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  /** Outbound ring-timeout watchdog interval — cleared on timeout, PSTN open, or call end. */
  const outboundRingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Epoch ms for the current outbound ring window (set with `outboundRingSessionId`). */
  const outboundRingStartedAtRef = useRef<number>(0);
  /** Ring watchdog calls this — never put `hangUp` in the watchdog effect deps (would reset the timer). */
  const hangUpRef = useRef<() => void>(() => {});
  const endResetRef = useRef<NodeJS.Timeout | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const activeCallIdRef = useRef<string | null>(null);
  const activeCallControlIdRef = useRef<string | null>(null);
  /** One DB sync of call SIDs per outbound call (webhooks + recording depend on `calls.twilio_call_sid`). */
  const callIdsDbSyncedRef = useRef(false);
  /** Prevents duplicate browser-side recording starts per call. */
  const recordingStartedRef = useRef(false);
  const pendingAbortCallIdRef = useRef<string | null>(null);
  /** Outbound: set only in Voice.js `accept` (remote answered). Never infer from DB/webhook or `call.status()`. */
  const outboundRemoteAnsweredRef = useRef(false);
  const activeLeadIdRef = useRef<string | null>(null);
  /** LRU for outbound DIDs (E.164 → last used epoch ms). */
  const didLastUsedAtRef = useRef<Map<string, number>>(new Map());

  // Prevents double processing of call-end state across hangUp(), Device `error`, and per-call events handlers.
  // Reset at the start of each new call (makeCall); set when the first handler processes the end.
  const endStateProcessedRef = useRef(false);

  // bridgeAutoAnsweredRef removed — one-legged calling has no inbound bridge leg.

  // Ensure a hidden <audio> element exists for remote audio playback
  const getRemoteAudioElement = useCallback(() => {
    if (remoteAudioRef.current) return remoteAudioRef.current;
    let el = document.getElementById("twilio-remote-audio") as HTMLAudioElement | null;
    if (!el) {
      el = document.createElement("audio");
      el.id = "twilio-remote-audio";
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
      const stream =
        (typeof call?.getRemoteStream === "function" ? call.getRemoteStream() : null) ||
        call?.remoteStream ||
        call?.options?.remoteStream;
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
      .select(
        "phone_number, is_default, spam_status, area_code, friendly_name, daily_call_count, daily_call_limit",
      )
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

  // Fetch global phone settings (ring timeout, etc.)
  useEffect(() => {
    if (!organizationId) return;
    supabase
      .from("phone_settings")
      .select("ring_timeout, api_secret")
      .eq("organization_id", organizationId)
      .maybeSingle()
      .then(({ data }) => {
        const rt = data?.ring_timeout;
        setPhoneBaselineRing(typeof rt === "number" && !Number.isNaN(rt) && rt > 0 ? rt : 25);
        try {
          const flags = data?.api_secret ? JSON.parse(String(data.api_secret)) : {};
          setOrgLocalPresenceEnabled(flags.local_presence_enabled !== false);
        } catch {
          setOrgLocalPresenceEnabled(true);
        }
      });
  }, [organizationId, profile?.id]);

  // Resolve inbound caller against CRM (RPC: leads → campaign_leads → clients) while ringing.
  useEffect(() => {
    if (callState !== "incoming") {
      setCrmContactName("");
      return;
    }
    const raw =
      incomingCallerNumber.trim() ||
      (identifiedContact?.number || "").trim();
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
        console.warn("[TwilioContext] resolve_inbound_caller_display_name:", error.message);
        setCrmContactName("");
        return;
      }

      setCrmContactName(typeof displayName === "string" ? displayName.trim() : "");
    })();

    return () => {
      cancelled = true;
    };
  }, [
    callState,
    incomingCallerNumber,
    identifiedContact?.number,
    organizationId,
    inboundClaimedCallRowId,
    inboundCallerExcludeOrg,
  ]);

  /**
   * WebRTC inbound often reports the agency DID as "remote" on the first notifications.
   * When `phone_numbers` / manual caller ID finish loading, the org-DID exclude set fills in —
   * re-run ANI extraction so we clear the DID and let `calls.caller_id_used` + CRM take over.
   */
  useEffect(() => {
    if (callState !== "incoming") return;
    if (inboundCallerExcludeOrg.size === 0) return;
    const raw = incomingCallerNumber.trim();
    if (!raw) return;
    const l10 = last10Digits(raw);
    if (!l10 || !inboundCallerExcludeOrg.has(l10)) return;
    const c = callRef.current;
    if (!c) {
      setIncomingCallerNumber("");
      setIncomingCallerName("");
      return;
    }
    const { number, name } = extractIncomingCallerDisplay(
      c,
      lastInboundNotificationRef.current,
      inboundCallerExcludeOrg,
    );
    setIncomingCallerNumber(number || "");
    setIncomingCallerName(name);
  }, [callState, incomingCallerNumber, inboundCallerExcludeOrg]);

  /**
   * Service-role claim so the agent can see the row under RLS (`calls.agent_id`).
   * Retries for several seconds: `call.initiated` webhook often lands after the first SDK notification.
   */
  const claimInboundCall = useCallback(
    async (controlId: string, providerSessionId?: string | null): Promise<string | null> => {
      const cc = controlId?.trim() ?? "";
      const sid = providerSessionId?.trim() ?? "";
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
            ...(sid ? { provider_session_id: sid } : {}),
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
    lastInboundNotificationRef.current = undefined;
    setLastCallDirection("outbound");
  }, []);

  const reconcileIdentifiedContactFromCallsRow = useCallback(
    async (row: Record<string, unknown> | null | undefined) => {
      if (!row || !organizationId) return;
      if (!isCallsRowInboundDirection(row.direction)) return;
      if (String(row.organization_id ?? "") !== String(organizationId)) return;

      const typeRaw = typeof row.contact_type === "string" ? row.contact_type.trim() : "";
      const typeStr = typeRaw ? typeRaw.toLowerCase() : undefined;

      const nameFromRow = typeof row.contact_name === "string" ? row.contact_name.trim() : "";
      const num =
        String(row.contact_phone || row.caller_id_used || "").trim() ||
        incomingCallerNumberRef.current;

      const pstn = String(row.contact_phone || row.caller_id_used || "").trim();
      const pstnL10 = pstn ? last10Digits(pstn) : null;
      if (pstnL10 && inboundCallerExcludeRef.current.has(pstnL10)) {
        return;
      }

      const cleanName =
        nameFromRow && num && !isInboundNameSameAsPhoneNumber(nameFromRow, num)
          ? nameFromRow
          : "";

      if (cleanName && num) {
        setIdentifiedContact({ name: cleanName, number: num, type: typeStr });
      }

      if (row.contact_id) {
        const cid = String(row.contact_id);
        if (cleanName) return;

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
            console.warn("[TwilioContext] identifiedContact client fetch:", error.message);
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
            console.warn("[TwilioContext] identifiedContact lead fetch:", error.message);
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
        return;
      }

      // No contact_id yet: still expose PSTN from webhook row so UI is not stuck on "Unknown Caller"
      if (pstn) {
        setIdentifiedContact((prev) => {
          if (
            prev?.name &&
            !isInboundNameSameAsPhoneNumber(prev.name, prev.number || pstn)
          ) {
            return prev.number === pstn ? prev : { ...prev, number: pstn };
          }
          if (cleanName) {
            return { name: cleanName, number: pstn, type: typeStr };
          }
          return { name: "", number: pstn, type: typeStr };
        });
      }
    },
    [organizationId],
  );

  /** Prefer PSTN ANI from `calls` (webhook `payload.from`) when the SDK shows your DID as "remote". */
  const applyInboundAniFromCallsRow = useCallback(
    (row: Record<string, unknown> | null | undefined) => {
      if (!row || !organizationId) return;
      if (!isCallsRowInboundDirection(row.direction)) return;
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

  /**
   * Webhook writes `calls.caller_id_used` shortly after ring; client SELECT/Realtime can miss
   * if Voice session / CallSid ids are not aligned yet. Poll SECURITY DEFINER RPC until row appears.
   */
  useEffect(() => {
    if (callState !== "incoming" || !organizationId) return;

    let cancelled = false;
    let ticks = 0;
    /** Count RPC attempts only after SDK exposes session or control id — do not burn budget while refs are empty. */
    const maxTicks = 40;

    const tick = async () => {
      if (cancelled) return;
      const sid = inboundSdkSessionIdRef.current?.trim() || "";
      const cc = activeCallControlIdRef.current?.trim() || "";
      if (!sid && !cc) return;
      if (ticks >= maxTicks) return;
      ticks += 1;

      const { data, error } = await supabase.rpc("peek_inbound_call_identity", {
        p_provider_session_id: sid || null,
        p_twilio_call_sid: cc || null,
      });

      if (cancelled || error) {
        if (error) {
          console.warn("[TwilioContext] peek_inbound_call_identity:", error.message);
        }
        return;
      }
      if (data == null || typeof data !== "object") return;

      const j = data as Record<string, unknown>;
      const synthetic: Record<string, unknown> = {
        direction: "inbound",
        organization_id: organizationId,
        caller_id_used: j.caller_id_used,
        contact_phone: j.contact_phone,
        contact_name: j.contact_name,
        contact_id: j.contact_id,
        contact_type: j.contact_type,
      };

      applyInboundAniFromCallsRow(synthetic);
      void reconcileIdentifiedContactFromCallsRow(synthetic);
    };

    void tick();
    const id =
      typeof window !== "undefined" ? window.setInterval(() => void tick(), 350) : 0;
    return () => {
      cancelled = true;
      if (id) window.clearInterval(id);
    };
  }, [
    callState,
    organizationId,
    applyInboundAniFromCallsRow,
    reconcileIdentifiedContactFromCallsRow,
  ]);

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
      toast.success("Desktop alerts are on for inbound calls. Twilio plays the ringtone in your browser.");
    } else if (notificationPermission === "denied") {
      toast.message(
        "Allow notifications in your browser settings if you want desktop pop-ups. Twilio still rings incoming calls in this tab."
      );
    } else if (!audioPrimed) {
      toast.error("Could not unlock audio for this browser. Try again or check browser permissions.");
    } else {
      toast.success("Inbound alerts enabled.");
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
          if (!isCallsRowInboundDirection(row.direction)) return;

          const rowAgent = row.agent_id as string | null | undefined;
          const sid = String(row.provider_session_id || "");
          const cc = String(row.twilio_call_sid || "");
          const sessionMatch = Boolean(sid && sid === inboundSdkSessionIdRef.current);
          const localCc = activeCallControlIdRef.current?.trim() || "";
          const controlMatch = Boolean(cc && localCc && providerCallSidsEqual(cc, localCc));
          const unassignedRing =
            (rowAgent == null || rowAgent === "") && (sessionMatch || controlMatch);
          const assignedMine = rowAgent === authUserId;
          if (!unassignedRing && !assignedMine) return;

          applyInboundAniFromCallsRow(row);

          const eventType = String((payload as { eventType?: string }).eventType || "");
          const hasCrmMarker =
            Boolean(row.contact_id) ||
            (typeof row.contact_name === "string" && row.contact_name.trim() !== "");
          const hasAni =
            String(row.caller_id_used || row.contact_phone || "").trim() !== "";
          if (
            (eventType === "UPDATE" || eventType === "INSERT") &&
            (hasCrmMarker || hasAni)
          ) {
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
        "contact_id, contact_name, contact_phone, caller_id_used, contact_type, direction, organization_id, agent_id, provider_session_id, twilio_call_sid";

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
            .in("direction", ["inbound", "incoming"])
            .eq("provider_session_id", sid)
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
            .in("direction", ["inbound", "incoming"])
            .eq("twilio_call_sid", cc)
            .maybeSingle();
          row = (data as Record<string, unknown>) ?? null;
        }
      }

      if (!row && (inboundSdkSessionIdRef.current || activeCallControlIdRef.current)) {
        const { data: peek } = await supabase.rpc("peek_inbound_call_identity", {
          p_provider_session_id: inboundSdkSessionIdRef.current?.trim() || null,
          p_twilio_call_sid: activeCallControlIdRef.current?.trim() || null,
        });
        if (peek && typeof peek === "object" && !Array.isArray(peek)) {
          const j = peek as Record<string, unknown>;
          row = {
            direction: "inbound",
            organization_id: organizationId,
            caller_id_used: j.caller_id_used,
            contact_phone: j.contact_phone,
            contact_name: j.contact_name,
            contact_id: j.contact_id,
            contact_type: j.contact_type,
          };
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
          .select('id, twilio_call_sid, contact_id, caller_id_used, started_at, status')
          .eq('agent_id', profile.id)
          .in('status', ['ringing', 'connected'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.warn('[TwilioContext] Orphan call check failed:', error.message);
          return;
        }

        if (!data) return;

        // Stale call guard: if a call has been "ringing" for >5 minutes, auto-mark as failed
        const STALE_RINGING_THRESHOLD_MS = 5 * 60 * 1000;
        if (data.status === 'ringing' && data.started_at) {
          const age = Date.now() - new Date(data.started_at).getTime();
          if (age > STALE_RINGING_THRESHOLD_MS) {
            console.warn(`[TwilioContext] Stale ringing call ${data.id} (${Math.round(age / 1000)}s old). Auto-cleaning to failed.`);
            await supabase
              .from('calls')
              .update({ status: 'failed', updated_at: new Date().toISOString() })
              .eq('id', data.id);
            return;
          }
        }

        // Silent recovery: after refresh, WebRTC cannot restore audio — same as tapping Hang Up.
        // Best-effort SDK teardown + finalize the DB row so ghost "connected" rows do not loop forever.
        try {
          twilioHangUpAll();
        } catch {
          /* no-op */
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
          console.log(`[TwilioContext] Orphan row ${data.id} finalized via client update (silent refresh recovery).`);
          return;
        }

        console.warn(`[TwilioContext] Orphaned active call detected: ${data.id} (status=${data.status}). Surfacing recovery UI.`);
        setOrphanCall(data as OrphanCall);
      } catch (err) {
        console.warn('[TwilioContext] Exception in orphan call check:', err);
      }
    };

    checkOrphanedCalls();
  }, [profile?.id, organizationId]);

  const hangUpOrphan = useCallback(async () => {
    if (!orphanCall) return;

    try {
      try {
        twilioHangUpAll();
      } catch {
        /* no-op */
      }
      const endedAt = new Date().toISOString();
      const startedMs = orphanCall.started_at ? new Date(orphanCall.started_at).getTime() : Date.now();
      const durationSec = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
      const { error } = await supabase
        .from("calls")
        .update({
          status: "completed",
          ended_at: endedAt,
          duration: durationSec,
        })
        .eq("id", orphanCall.id)
        .eq("agent_id", profile.id);

      if (error) {
        console.warn("[TwilioContext] Orphan hangup DB update failed:", error.message);
        toast.warning("Call may have already ended.");
      } else {
        console.log(`[TwilioContext] Orphaned call ${orphanCall.id} terminated successfully.`);
        toast.success("Orphaned call terminated.");
      }
    } catch (err) {
      console.error("[TwilioContext] Error hanging up orphan call:", err);
      toast.error("Failed to terminate orphaned call.");
    } finally {
      setOrphanCall(null);
    }
  }, [orphanCall, profile?.id]);

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

  const finalizeCallRecord = useCallback(async (duration: number) => {
    if (!activeCallIdRef.current) return;

    const callId = activeCallIdRef.current;
    const leadId = activeLeadIdRef.current;
    
    // Clear refs immediately so we don't double-finalize
    activeCallIdRef.current = null;
    activeLeadIdRef.current = null;

    // Background log to the analytical table, non-blocking
    insertCallLog(duration, leadId).catch(console.warn);

    console.log(`[TwilioContext] Finalizing call record ${callId} with duration ${duration}s`);

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
        console.error("[TwilioContext] Error finalizing call record:", error);
      }
    } catch (err) {
      console.error("[TwilioContext] Exception during call finalization:", err);
    }
  }, []);

  const hangUp = useCallback(async () => {
    const callId = activeCallIdRef.current;
    const controlId = activeCallControlIdRef.current;

    console.log("[TwilioContext] Initiating hangup.", { callId, controlId });

    endStateProcessedRef.current = true;
    outboundRingStartedAtRef.current = 0;
    setOutboundRingSessionId(null);
    callStateRef.current = "ended";

    setIdentifiedContact(null);

    // 1. Instant UI update — triggers wrap-up phase in DialerPage
    setCallState("ended");
    
    // Check if we are in the middle of a dial initiation (Race Condition handling)
    if (callStateRef.current === "dialing" && !controlId && callId) {
      console.log("[TwilioContext] Hangup requested during dialing; latching pending abort for:", callId);
      pendingAbortCallIdRef.current = callId;
    }

    // Clear audio immediately
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    if (callRef.current) {
      try {
        twilioHangUp(callRef.current as TwilioCall);
      } catch (err) {
        console.warn("[TwilioContext] Local hangup error:", err);
      }
      callRef.current = null;
    }
    try {
      twilioHangUpAll();
    } catch {
      /* no-op */
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
  hangUpRef.current = hangUp;

  const answerIncomingCall = useCallback(async () => {
    if (callStateRef.current !== "incoming") return;
    const call = callRef.current as TwilioCall | null;
    if (!call || !isVoiceSdkInboundDirection(getCallDirection(call))) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(VOICE_MIC_CAPTURE);
    } catch (err) {
      console.error("[TwilioContext] Mic denied for answer:", err);
      toast.error("Microphone access is required to answer.");
      return;
    }

    if (mediaStreamRef.current && mediaStreamRef.current !== stream) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    }
    mediaStreamRef.current = stream;

    const sid = getCallSid(call) ?? "";
    if (sid) {
      void (async () => {
        const rowId = await claimInboundCall("", sid);
        if (rowId) {
          activeCallIdRef.current = rowId;
          callIdsDbSyncedRef.current = true;
          setInboundClaimedCallRowId(rowId);
        }
      })();
    }

    endStateProcessedRef.current = false;
    recordingStartedRef.current = false;
    activeLeadIdRef.current = null;
    isDialingRef.current = true;

    try {
      await twilioAnswerCall(call, { rtcConstraints: VOICE_MIC_CAPTURE });
      try {
        call.mute(false);
      } catch {
        /* ignore */
      }
      attachRemoteAudio(call);
      try {
        remoteAudioRef.current?.play?.().catch(() => {});
      } catch {
        /* ignore */
      }
    } catch (err: unknown) {
      console.error("[TwilioContext] answer() failed:", err);
      toast.error(err instanceof Error ? err.message : "Could not answer the call.");
      isDialingRef.current = false;
    }
  }, [attachRemoteAudio, claimInboundCall]);

  const rejectIncomingCall = useCallback(() => {
    if (callStateRef.current !== "incoming") return;
    hangUp();
  }, [hangUp]);

  // Ring timeout: outbound stays `active` right after Voice.js `accept` while PSTN still rings.
  // Effect deps are `outboundRingSessionId` only so dialing→active does not reset the timer.
  // Skip hangup when `getCallStatus() === "open"` (callee answered) — use TwiML `<Dial answerOnBridge="true">`.
  useEffect(() => {
    if (!outboundRingSessionId) return;

    const rawLimit = latestRingTimeoutRef.current;
    const limitSec = Math.max(1, Math.min(600, Number.isFinite(rawLimit) ? rawLimit : 25));
    const startedAt = outboundRingStartedAtRef.current || Date.now();
    let fired = false;

    console.log(`[RingTimeout] Watchdog started for ${limitSec}s (session ${outboundRingSessionId})`);

    const iv = window.setInterval(() => {
      if (fired) return;

      const twilioCall = callRef.current as TwilioCall | null;
      if (twilioCall && isVoiceSdkInboundDirection(getCallDirection(twilioCall))) {
        return;
      }

      const stillOutboundRingPhase =
        lastCallLogDirectionRef.current === "outbound" &&
        (callStateRef.current === "dialing" || callStateRef.current === "active");
      if (!stillOutboundRingPhase) {
        window.clearInterval(iv);
        if (outboundRingTimerRef.current === iv) outboundRingTimerRef.current = null;
        return;
      }

      if (twilioCall && !isVoiceSdkInboundDirection(getCallDirection(twilioCall))) {
        try {
          if (getCallStatus(twilioCall) === "open") {
            window.clearInterval(iv);
            if (outboundRingTimerRef.current === iv) outboundRingTimerRef.current = null;
            return;
          }
        } catch {
          /* ignore */
        }
      }

      const elapsedSec = (Date.now() - startedAt) / 1000;
      if (elapsedSec < limitSec) return;

      if (fired) return;
      fired = true;
      window.clearInterval(iv);
      if (outboundRingTimerRef.current === iv) outboundRingTimerRef.current = null;

      const limitAtFire = limitSec;
      const ringPolicyAtFire = latestRingTimeoutRef.current;

      void (async () => {
        const snapCall = callRef.current as TwilioCall | null;
        const stillOut =
          lastCallLogDirectionRef.current === "outbound" &&
          (callStateRef.current === "dialing" || callStateRef.current === "active");
        if (!stillOut) return;
        if (
          snapCall &&
          !isVoiceSdkInboundDirection(getCallDirection(snapCall)) &&
          getCallStatus(snapCall) === "open"
        ) {
          console.log("[RingTimeout] Skip hangup — Voice.js call status is open (callee answered).", {
            callId: activeCallIdRef.current,
            limitSec: limitAtFire,
            ringTimeoutRef: ringPolicyAtFire,
          });
          return;
        }

        console.log(`[RingTimeout] ${limitAtFire}s elapsed — forcing teardown.`, {
          callId: activeCallIdRef.current,
          controlId: activeCallControlIdRef.current,
          limitSec: limitAtFire,
          ringTimeoutRef: ringPolicyAtFire,
        });

        try {
          twilioHangUpAll();
        } catch {
          /* ignore */
        }
        const snap = callRef.current as TwilioCall | null;
        if (snap) {
          try {
            snap.disconnect();
          } catch (e) {
            console.warn("[RingTimeout] Call.disconnect() error:", e);
          }
        }

        if (!dialerRingSessionActiveRef.current) {
          toast.info(`Call timed out after ${limitAtFire}s without answer.`);
        }
        hangUpRef.current();
      })();
    }, 400);

    outboundRingTimerRef.current = iv;

    return () => {
      window.clearInterval(iv);
      if (outboundRingTimerRef.current === iv) {
        outboundRingTimerRef.current = null;
      }
    };
  }, [outboundRingSessionId]);

  const toggleMute = useCallback(() => {
    const call = callRef.current as TwilioCall | null;
    if (!call) return;
    try {
      const next = !call.isMuted();
      call.mute(next);
      setIsMuted(next);
    } catch (err) {
      console.warn("[TwilioContext] toggleMute failed:", err);
    }
  }, []);

  const toggleHold = useCallback(() => {
    setIsOnHold((h) => !h);
  }, []);

  const queryStickyOutboundCaller = useCallback(async (cid: string) => {
    try {
      const { data, error } = await supabase
        .from("calls")
        .select("caller_id_used, duration")
        .eq("contact_id", cid)
        .in("direction", [...OUTBOUND_CALL_DIRECTIONS])
        .not("caller_id_used", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data?.caller_id_used) return null;
      return {
        caller_id_used: data.caller_id_used,
        duration_sec: typeof data.duration === "number" ? data.duration : 0,
      };
    } catch (e) {
      console.warn("[TwilioContext] queryStickyOutboundCaller:", e);
      return null;
    }
  }, []);

  const getSmartCallerId = useCallback(
    async (
      contactPhone: string,
      contactId?: string | null,
      opts?: SmartCallerIdOptions,
    ): Promise<string> => {
      const stamp = (e164: string) => {
        if (e164) didLastUsedAtRef.current.set(e164, Date.now());
      };

      if (selectedCallerNumber) {
        stamp(selectedCallerNumber);
        return selectedCallerNumber;
      }

      const localPresenceEnabled =
        opts?.localPresenceEnabled !== undefined
          ? opts.localPresenceEnabled
          : orgLocalPresenceEnabled;

      const chosen = await selectOutboundCallerId(
        {
          destinationPhone: contactPhone,
          contactId: contactId ?? null,
          phones: availableNumbers,
          localPresenceEnabled,
          defaultFallback: defaultCallerNumber,
          didLastUsedAt: didLastUsedAtRef.current,
          now: Date.now(),
          stickyMinDurationSec: CALLER_ID_STICKY_MIN_DURATION_SEC,
        },
        {
          queryStickyCaller: queryStickyOutboundCaller,
          getStateByAreaCode,
        },
      );

      stamp(chosen);
      return chosen;
    },
    [
      selectedCallerNumber,
      availableNumbers,
      defaultCallerNumber,
      orgLocalPresenceEnabled,
      queryStickyOutboundCaller,
    ],
  );

  const wireTwilioCall = useCallback(
    (call: TwilioCall, notification?: unknown) => {
      callRef.current = call;
      setCurrentCall(call);
      try {
        const sid = getCallSid(call) ?? "";
        Object.defineProperty(call, "id", { value: sid, configurable: true, enumerable: false });
        Object.defineProperty(call, "callControlId", { value: sid, configurable: true, enumerable: false });
      } catch {
        /* ignore */
      }

      const syncIdsToRow = () => {
        const rowId = activeCallIdRef.current;
        const sid = getCallSid(call) ?? "";
        if (!rowId || !sid || callIdsDbSyncedRef.current) return;
        callIdsDbSyncedRef.current = true;
        activeCallControlIdRef.current = sid;
        void supabase
          .from("calls")
          .update({
            twilio_call_sid: sid,
            provider_session_id: sid,
            updated_at: new Date().toISOString(),
          } as Record<string, unknown>)
          .eq("id", rowId)
          .then(({ error: syncErr }) => {
            if (syncErr) {
              callIdsDbSyncedRef.current = false;
              console.warn("[TwilioContext] Failed to sync CallSid to calls row:", syncErr.message);
            }
          });
      };

      const finalizeEnded = () => {
        if (endStateProcessedRef.current) return;
        endStateProcessedRef.current = true;
        outboundRingStartedAtRef.current = 0;
        setOutboundRingSessionId(null);
        if (outboundRingTimerRef.current != null) {
          window.clearInterval(outboundRingTimerRef.current);
          outboundRingTimerRef.current = null;
        }
        setCallState("ended");
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const recordingCallId = activeCallIdRef.current;
        const recordingBlob = stopBrowserCallRecording();
        const orgForUpload =
          (profile as { organization_id?: string | null })?.organization_id || organizationId || "unknown";
        if (recordingBlob && recordingCallId) {
          void uploadCallRecording(recordingCallId, orgForUpload, recordingBlob);
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = null;
        }
        void finalizeCallRecord(callDurationRef.current);
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
      };

      call.on("ringing", () => {
        if (!isVoiceSdkInboundDirection(getCallDirection(call))) {
          callStateRef.current = "dialing";
          setCallState("dialing");
        }
      });

      call.on("accept", () => {
        // Do not clear outboundRingTimerRef here — Voice.js "accept" is browser media up, not PSTN answer;
        // the ring watchdog clears itself when getCallStatus() === "open" or on timeout.
        if (!isVoiceSdkInboundDirection(getCallDirection(call))) {
          outboundRemoteAnsweredRef.current = true;
        }
        try {
          call.mute?.(false);
        } catch {
          /* ignore */
        }
        callStateRef.current = "active";
        setCallState("active");
        if (!timerRef.current) {
          timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
        }
        attachRemoteAudio(call);
        syncIdsToRow();
        if (!recordingStartedRef.current) {
          recordingStartedRef.current = true;
          const rowId = activeCallIdRef.current ?? "";
          const orgForRec =
            (profile as { organization_id?: string | null })?.organization_id || organizationId || "";
          const micSnap = mediaStreamRef.current;
          setTimeout(() => {
            void startBrowserCallRecording(rowId, orgForRec, {
              agentMicStream: micSnap,
            });
          }, 1000);
        }
      });

      call.on("disconnect", () => {
        finalizeEnded();
      });

      call.on("cancel", () => {
        finalizeEnded();
      });

      call.on("reject", () => {
        finalizeEnded();
      });

      call.on("error", (err: { message?: string }) => {
        console.warn("[TwilioContext] Call error:", err);
        finalizeEnded();
      });

      if (isVoiceSdkInboundDirection(getCallDirection(call))) {
        setLastCallDirection("inbound");
        const sid = getCallSid(call) ?? "";
        inboundSdkSessionIdRef.current = sid;
        lastInboundNotificationRef.current = notification;
        const fromParam = String(call.parameters?.From ?? "").trim();
        const { number, name } = extractIncomingCallerDisplay(
          { options: { remoteCallerNumber: fromParam }, remoteCallerNumber: fromParam },
          notification,
          inboundCallerExcludeRef.current,
        );
        setIncomingCallerNumber(number || fromParam);
        setIncomingCallerName(name);
        endStateProcessedRef.current = false;
        setCallState("incoming");

        if (sid && !activeCallIdRef.current) {
          const snap = call;
          void (async () => {
            const claimedId = await claimInboundCall("", sid);
            if (!claimedId || callRef.current !== snap) return;
            activeCallIdRef.current = claimedId;
            setInboundClaimedCallRowId(claimedId);
            callIdsDbSyncedRef.current = true;
          })();
        }
      } else {
        outboundRemoteAnsweredRef.current = false;
        callStateRef.current = "dialing";
        setCallState("dialing");
      }
    },
    [
      attachRemoteAudio,
      claimInboundCall,
      clearIncomingDisplay,
      finalizeCallRecord,
      organizationId,
      profile?.organization_id,
    ],
  );

  const initializeClient = useCallback(async () => {
    if (!profile) {
      console.log("[TwilioContext] Waiting for profile...");
      return;
    }

    if (!organizationId) {
      console.warn("[TwilioContext] Cannot initialize: User has no organization_id");
      setStatus("error");
      setErrorMessage("Your account is not associated with an organization. Please contact support.");
      return;
    }

    if (deviceRef.current) {
      const registered = deviceRef.current.state === Device.State.Registered;
      const sameOrg = twilioVoiceOrgIdRef.current === organizationId;
      if (registered && sameOrg && twilioVoiceReadyRef.current) {
        console.log("[TwilioContext] Device already registered; skipping re-initialization.");
        setStatus("ready");
        setErrorMessage(null);
        return;
      }
      console.log("[TwilioContext] Destroying existing Device before re-initialization...");
      twilioVoiceReadyRef.current = false;
      await destroyTwilioDevice();
      deviceRef.current = null;
      twilioVoiceOrgIdRef.current = null;
    }

    if (initializeInFlightRef.current) {
      console.log("[TwilioContext] initializeClient skipped — already in progress.");
      return;
    }
    initializeInFlightRef.current = true;
    setStatus("connecting");
    setErrorMessage(null);

    try {
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia(VOICE_MIC_CAPTURE);
      } catch {
        /* mic optional at registration */
      }

      clearIncomingCallHandlers();
      await initTwilioDevice({
        onRegistered: () => {
          twilioVoiceOrgIdRef.current = organizationId;
          twilioVoiceReadyRef.current = true;
          deviceRef.current = getTwilioDevice();
          setStatus("ready");
          setErrorMessage(null);
          console.log("[TwilioContext] Twilio Device registered");
        },
        onUnregistered: () => {
          twilioVoiceReadyRef.current = false;
        },
        onError: (err) => {
          console.error("[TwilioContext] Device error:", err);
          twilioVoiceReadyRef.current = false;
          setStatus("error");
          setErrorMessage(err.message || "Twilio connection error");
        },
      });

      deviceRef.current = getTwilioDevice();

      subscribeToIncomingCalls((incomingCall) => {
        endStateProcessedRef.current = false;
        recordingStartedRef.current = false;
        wireTwilioCall(incomingCall);
      });
    } catch (err: unknown) {
      twilioVoiceReadyRef.current = false;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Could not initialize dialer");
    } finally {
      initializeInFlightRef.current = false;
    }
  }, [
    claimInboundCall,
    clearIncomingDisplay,
    finalizeCallRecord,
    organizationId,
    profile?.id,
    wireTwilioCall,
  ]);

  // Start WebRTC registration in the background as soon as we have org context (floating dialer no longer pays full cold-start cost).
  useEffect(() => {
    if (!profile || !organizationId) return;
    void initializeClient();
  }, [profile?.id, organizationId, initializeClient]);

  const destroyClient = useCallback(() => {
    stopIncomingRingtone();
    closeIncomingDesktopNotification();
    twilioVoiceOrgIdRef.current = null;
    twilioVoiceReadyRef.current = false;
    twilioHangUpAll();
    void destroyTwilioDevice();
    deviceRef.current = null;
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

  useEffect(() => {
    const onLeave = () => {
      twilioHangUpAll();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", onLeave);
      return () => window.removeEventListener("beforeunload", onLeave);
    }
  }, []);

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
      console.warn("[TwilioContext] makeCall blocked — already dialing (execution lock).");
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
    if (!twilioVoiceReadyRef.current) {
      const msg =
        status === "connecting"
          ? "Phone is still connecting. Wait until the dialer shows Ready."
          : "Phone is not connected yet. Wait a few seconds or tap retry in the dialer header.";
      console.warn("[TwilioContext] makeCall blocked — SIP not registered. Status:", status);
      toast.error(msg);
      return undefined;
    }

    if (!getTwilioDevice()) {
      console.warn("[TwilioContext] makeCall blocked — no Twilio Device instance.");
      toast.error("Phone connection is not available. Open the dialer to reconnect.");
      return undefined;
    }

    if (status !== "ready") {
      const msg =
        status === "connecting"
          ? "Phone is still connecting, please wait."
          : "Dialer is not connected. Check your credentials in Settings.";
      console.warn("Voice client not ready, cannot make call. Status:", status);
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
        console.warn("[TwilioContext] Call blocked: No active auth session.", refreshErr || getErr);
        toast.error("Authentication error: Session invalid or expired. Please log in to make calls.");
        return undefined;
      }
      session = refreshed;
    }

    if (!session?.access_token) {
      console.warn("[TwilioContext] Call blocked: No active session after refresh check.");
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
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia(VOICE_MIC_CAPTURE);
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
      outboundRemoteAnsweredRef.current = false;
      callStateRef.current = "dialing";
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
      callIdsDbSyncedRef.current = false;
      recordingStartedRef.current = false;
      outboundRingStartedAtRef.current = Date.now();
      setOutboundRingSessionId(callRecord.id);

      if (!getTwilioDevice()) {
        throw new Error("Twilio Device is not ready. Wait for Ready status and try again.");
      }

      console.log("[TwilioContext] Initiating outbound Twilio Voice call:", {
        to: toE164(destinationNumber),
        from: toE164(callerIdUsed),
        callId: callRecord.id,
      });

      const call = await twilioMakeCall({
        to: toE164(destinationNumber),
        callerId: toE164(callerIdUsed),
        callRowId: callRecord.id,
        orgId: organizationId as string,
      });

      wireTwilioCall(call);

      void supabase
        .rpc("increment_phone_number_daily_usage", { p_phone_e164: callerIdUsed })
        .then(({ error: incErr }) => {
          if (incErr) {
            console.warn("[TwilioContext] increment_phone_number_daily_usage:", incErr.message);
          }
        });

      setAvailableNumbers((prev) =>
        prev.map((n) =>
          n.phone_number === callerIdUsed
            ? { ...n, daily_call_count: (n.daily_call_count ?? 0) + 1 }
            : n,
        ),
      );

      return callRecord.id;
    } catch (err: any) {
      console.error("Failed to start call:", err);
      toast.error(err.message || "Failed to start call");
      outboundRemoteAnsweredRef.current = false;
      outboundRingStartedAtRef.current = 0;
      setOutboundRingSessionId(null);
      callStateRef.current = "idle";
      setCallState("idle");
      isDialingRef.current = false;
      return undefined;
    }
    // isDialingRef stays true until the call ends (released in useEffect on idle/ended).
  }, [status, defaultCallerNumber, attachRemoteAudio, organizationId, profile?.id, wireTwilioCall]);


  // Network resilience: Auto-reconnect if internet blips
  useEffect(() => {
    const handleOnline = () => {
      console.log("[TwilioContext] Network restored. Re-initializing client...");
      setConnectionDropped(false);
      if (status === "error" || !deviceRef.current) {
         // Add a tiny delay to ensure socket is actually ready
         setTimeout(() => initializeClient(), 1000);
      }
    };
    
    const handleOffline = () => {
       console.warn("[TwilioContext] Network connectivity lost.");
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
           try {
             twilioHangUp(callRef.current as TwilioCall);
           } catch {
             /* connection already lost */
           }
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
    <TwilioVoiceReactContext.Provider
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
        applyDialSessionRingTimeout,
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
    </TwilioVoiceReactContext.Provider>
  );
};
