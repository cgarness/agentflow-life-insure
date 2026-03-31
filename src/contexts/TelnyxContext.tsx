import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { TelnyxRTC } from "@telnyx/webrtc";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";



type TelnyxStatus = "idle" | "connecting" | "ready" | "error";
type CallState = "idle" | "dialing" | "active" | "ended";

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
  amdEnabled: boolean;
  ringTimeout: number;
  makeCall: (destinationNumber: string, callerNumber?: string, clientState?: string) => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  availableNumbers: any[];
  selectedCallerNumber: string;
  setSelectedCallerNumber: (number: string) => void;
  getSmartCallerId: (contactPhone: string, contactId?: string | null) => Promise<string>;
  initializeClient: () => Promise<void>;
  destroyClient: () => void;
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
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [defaultCallerNumber, setDefaultCallerNumber] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [amdEnabled, setAmdEnabled] = useState(false);
  const [ringTimeout, setRingTimeout] = useState(30);
  const [selectedCallerNumber, setSelectedCallerNumber] = useState<string>(() => {
    return typeof window !== "undefined" ? localStorage.getItem("telnyx_manual_caller_id") || "" : "";
  });

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

  const clientRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const endResetRef = useRef<NodeJS.Timeout | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const isAutoDialingRef = useRef(false);

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

  const { profile } = useAuth();
  const organizationId = (profile as any)?.organization_id;

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

  // Fetch global phone settings (AMD, Ring Timeout, etc.)
  useEffect(() => {
    if (!organizationId) return;
    supabase
      .from("phone_settings")
      .select("amd_enabled, ring_timeout")
      .eq("organization_id", organizationId)
      .maybeSingle()
      .then(({ data }) => {
        setAmdEnabled(data?.amd_enabled === true);
        if (data?.ring_timeout) {
          setRingTimeout(data.ring_timeout);
        }
      });
  }, [organizationId, profile?.id]);

  const hangUp = useCallback(() => {
    if (callRef.current) {
      try { callRef.current.hangup(); } catch {} // eslint-disable-line no-empty
    }
  }, []);

  // Ring Timeout Logic: Auto-hangup if call stays "dialing" for too long
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    if (callState === "dialing" && ringTimeout > 0) {
      console.log(`[RingTimeout] Setting timer for ${ringTimeout}s`);
      timeoutId = setTimeout(() => {
        if (callRef.current && (callRef.current.state === "ringing" || callRef.current.state === "trying" || callRef.current.state === "early")) {
          console.log(`[RingTimeout] ${ringTimeout}s reached without answer. Hanging up.`);
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
    if (!callRef.current) return;
    try {
      if (isMuted) {
        callRef.current.unmuteAudio();
      } else {
        callRef.current.muteAudio();
      }
      setIsMuted(!isMuted);
    } catch {} // eslint-disable-line no-empty
  }, [isMuted]);

  const toggleHold = useCallback(() => {
    if (!callRef.current) return;
    try {
      if (isOnHold) {
        callRef.current.unhold();
      } else {
        callRef.current.hold();
      }
      setIsOnHold(!isOnHold);
    } catch {} // eslint-disable-line no-empty
  }, [isOnHold]);

  const getSmartCallerId = useCallback(async (contactPhone: string, contactId?: string | null): Promise<string> => {
    // 1. Manual Override always wins
    if (selectedCallerNumber) return selectedCallerNumber;

    // 2. Check Contact History
    if (contactId) {
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

    // 1. Destroy existing client if already set (handles "retry" button)
    if (clientRef.current) {
      console.log("TelnyxRTC destroying existing client before re-initialization...");
      try {
        clientRef.current.disconnect();
      } catch (e) {
        console.warn("Error during disconnect:", e);
      }
      clientRef.current = null;
    }

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

      if (tokenError || (!tokenData?.token && !tokenData?.sip_username)) {
        const msg = tokenData?.error || tokenError?.message || "Failed to provision secure WebRTC token";
        console.error("telnyx-token error:", msg);
        setStatus("error");
        setErrorMessage(msg);
        toast.error(msg);
        return;
      }

      console.log(`[TelnyxContext] Auth method: ${tokenData.auth_method}, agent: ${tokenData.sip_username}`);

      // 3. Pre-acquire microphone so permission is already granted at call time
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Mic denied — still register; makeCall will handle the prompt
      }

      // 4. Initialize TelnyxRTC — token-based or credential-based depending on edge function response
      let client: TelnyxRTC;
      if (tokenData.auth_method === "token" && tokenData.token) {
        client = new TelnyxRTC({
          login_token: tokenData.token,
        });
      } else {
        console.log("[TelnyxContext] Using SIP credential auth fallback");
        client = new TelnyxRTC({
          login: tokenData.sip_username,
          password: tokenData.sip_password,
        });
      }

      client.on("telnyx.ready", () => {
        setStatus("ready");
        setErrorMessage(null);
        console.log("TelnyxRTC ready (eager init)");
      });

      client.on("telnyx.error", (error: any) => {
        const errorCode = error?.code || error?.error?.code;
        const errorMsg = error?.message || error?.error?.message || '';
        const isRemoteHangup =
          errorCode === -32002 ||
          (typeof errorMsg === "string" && errorMsg.includes("CALL DOES NOT EXIST"));

        if (isRemoteHangup) {
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
          endResetRef.current = setTimeout(() => {
            const wasAutoDialing = isAutoDialingRef.current;
            isAutoDialingRef.current = false;
            
            setCallState("idle");
            setCallDuration(0);
            setCurrentCall(null);
            setIsMuted(false);
            setIsOnHold(false);

            if (wasAutoDialing) {
              console.log("[AutoDialer] Call ended, triggering next lead...");
              window.dispatchEvent(new CustomEvent("auto-dial-next-lead"));
            }
          }, 2000);
          return;
        }

        console.error('TelnyxRTC full error:', JSON.stringify(error, null, 2));
        setStatus('error');

        // Login Incorrect: credentials are invalid or expired
        if (errorCode === -32001 || (typeof errorMsg === "string" && errorMsg.includes("Login Incorrect"))) {
          setErrorMessage("Login failed: Your Telnyx SIP credentials are invalid or expired. Please check your API Key, Connection ID, and SIP credentials in Phone Settings.");
          return;
        }

        const msg = errorMsg || String(errorCode) || 'Connection failed';
        setErrorMessage(msg);
      });

      client.on("telnyx.notification", (notification: any) => {
        if (!notification.call) return;
        const call = notification.call;
        callRef.current = call;
        setCurrentCall(call);

        const state = call.state;

        // Attach remote audio for ringback tone and active call audio
        if (state === "active" || state === "ringing" || state === "early" || state === "trying") {
          attachRemoteAudio(call);
        }

        if (state === "active") {
          setCallState("active");
        } else if (state === "ringing" || state === "trying") {
          // AUTO-ANSWER SAFETY: Only auto-answer if we are expecting a call (dialing state)
          if (callState === "dialing") {
            console.log("[TelnyxContext] Auto-answering inbound bridge call.");
            call.answer();
          }
          setCallState("dialing");
        } else if (state === "destroy" || state === "hangup") {
          setCallState("ended");
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
          }
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = null;
          }
          endResetRef.current = setTimeout(() => {
            const wasAutoDialing = isAutoDialingRef.current;
            isAutoDialingRef.current = false;

            setCallState("idle");
            setCallDuration(0);
            setCurrentCall(null);
            setIsMuted(false);
            setIsOnHold(false);
            callRef.current = null;

            if (wasAutoDialing) {
              console.log("[AutoDialer] Call ended, triggering next lead...");
              window.dispatchEvent(new CustomEvent("auto-dial-next-lead"));
            }
          }, 2000);
        }
      });

      clientRef.current = client;
      client.connect();
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err?.message || "Could not initialize dialer");
    }
  }, [attachRemoteAudio, organizationId, profile?.id]);

  const destroyClient = useCallback(() => {
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
    setStatus("idle");
    setErrorMessage(null);
    setCurrentCall(null);
    setCallState("idle");
    setCallDuration(0);
    setIsMuted(false);
    setIsOnHold(false);
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

  const makeCall = useCallback(async (destinationNumber: string, callerNumber?: string, clientState?: string) => {
    if (status !== "ready") {
      const msg = status === "connecting" ? "Dialer is still connecting, please wait." : "Dialer is not connected. Check your credentials in Settings.";
      console.warn("TelnyxRTC not ready, cannot make call. Status:", status);
      toast.error(msg);
      return;
    }

    // 1. Authentication Check: Ensure user has an active Supabase session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn("[TelnyxContext] Call blocked: No active auth session.");
      toast.error("Standard Authentication Required. Please log in to make calls.");
      return;
    }

    if (!clientRef.current) return;

    // Request microphone permission before placing the call
    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("Microphone permission denied:", err);
      setStatus("error");
      setErrorMessage("Microphone access is required to make calls. Please allow microphone access in your browser and try again.");
      return;
    }

    try {
      isAutoDialingRef.current = !!clientState;
      setCallState("dialing");
      setIsMuted(false);
      setIsOnHold(false);

      const callerIdUsed = callerNumber || defaultCallerNumber;
      if (!callerIdUsed) {
        throw new Error("No caller ID selected. Please select a phone number to dial from in the Dialer settings.");
      }

      // 1. Create the Call Record first to get a UUID (call_id)
      // This ID is used as client_state to link all Telnyx events back to this record.
      const { data: callRecord, error: callError } = await (supabase as any)
        .from('calls')
        .insert({
          contact_id: clientState || null, // Assuming clientState passed is the contact ID
          organization_id: organizationId,
          agent_id: profile.id,
          status: 'ringing',
          direction: 'outbound',
          caller_id_used: callerIdUsed,
        })
        .select('id')
        .single();

      if (callError) throw new Error(`Failed to create call record: ${callError.message}`);

      // 2. Invoke the Edge Function to start the Two-Legged Call
      const { data: dialData, error: dialError } = await supabase.functions.invoke("dialer-start-call", {
        body: {
          destination_number: destinationNumber,
          caller_id: callerNumber || defaultCallerNumber || "",
          agent_id: profile.id,
          call_id: callRecord.id,
          organization_id: organizationId
        },
      });

      if (dialError || dialData?.error) {
        const errorMsg = dialData?.error || dialError?.message || "Failed to initiate server-side call";
        console.error("[TelnyxContext] Dialer function error:", errorMsg);
        throw new Error(errorMsg);
      }

      console.log("[TelnyxContext] Server-side call initiated successfully:", dialData.call_control_id);
      
      // Note: We don't have a 'call' object yet. We will receive it via 'telnyx.notification' 
      // when the server bridges the call back to us (the agent).
    } catch (err: any) {
      console.error("Failed to start call:", err);
      toast.error(err.message || "Failed to start call");
      setCallState("idle");
    }
  }, [status, defaultCallerNumber, attachRemoteAudio]);


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
        amdEnabled,
        ringTimeout,
        availableNumbers,
        selectedCallerNumber,
        setSelectedCallerNumber,
        getSmartCallerId,
        makeCall,
        hangUp,
        toggleMute,
        toggleHold,
        initializeClient,
        destroyClient,
      }}
    >
      {children}
    </TelnyxContext.Provider>
  );
};
