import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { TelnyxRTC } from "@telnyx/webrtc";
import { supabase } from "@/integrations/supabase/client";

const TELNYX_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

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
  makeCall: (destinationNumber: string, callerNumber?: string, clientState?: string) => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
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

  const clientRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const endResetRef = useRef<NodeJS.Timeout | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

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

  // Fetch default caller number
  useEffect(() => {
    supabase
      .from("phone_numbers")
      .select("phone_number")
      .eq("is_default", true)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.phone_number) setDefaultCallerNumber(data.phone_number);
      });
  }, []);

  const initializeClient = useCallback(async () => {
    // Skip if already connecting or ready
    if (clientRef.current) return;

    setStatus("connecting");
    setErrorMessage(null);

    try {
      // 1. Fetch credentials
      const { data: settings } = await (supabase as any)
        .from("telnyx_settings")
        .select("api_key, connection_id, sip_username, sip_password")
        .eq("id", TELNYX_SETTINGS_ID)
        .maybeSingle();

      const creds = settings as any;
      if (!creds || !creds.api_key) {
        setStatus("idle");
        return;
      }

      // 2. Fetch SIP credentials via edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke("telnyx-token", {
        body: { connection_id: creds.connection_id },
      });

      if (tokenError || !tokenData?.sip_username) {
        setStatus("error");
        setErrorMessage(tokenData?.error || tokenError?.message || "Failed to get SIP credentials");
        return;
      }

      // 3. Pre-acquire microphone so permission is already granted at call time
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // Mic denied — still register; makeCall will handle the prompt
      }

      // 4. Initialize TelnyxRTC with SIP credentials
      const client = new TelnyxRTC({
        login: tokenData.sip_username,
        password: tokenData.sip_password,
      } as any);

      client.on("telnyx.ready", () => {
        setStatus("ready");
        setErrorMessage(null);
        console.log("TelnyxRTC ready (eager init)");
      });

      client.on("telnyx.error", (error: any) => {
        console.error('TelnyxRTC full error:', JSON.stringify(error, null, 2));
        console.error('TelnyxRTC error message:', error?.message);
        console.error('TelnyxRTC error code:', error?.code);
        setStatus('error');
        setErrorMessage(error?.message || error?.code || 'Connection failed - check browser console');
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
            setCallState("idle");
            setCallDuration(0);
            setCurrentCall(null);
            setIsMuted(false);
            setIsOnHold(false);
            callRef.current = null;
          }, 2000);
        } else if (state === "ringing" || state === "trying") {
          setCallState("dialing");
        }
      });

      clientRef.current = client;
      client.connect();
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err?.message || "Could not initialize dialer");
    }
  }, [attachRemoteAudio]);

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
      console.warn("TelnyxRTC not ready, cannot make call. Status:", status);
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
      const call = clientRef.current.newCall({
        destinationNumber,
        callerNumber: callerNumber || defaultCallerNumber || "",
        audio: true,
        clientState: clientState || undefined,
      });
      callRef.current = call;
      setCurrentCall(call);
      setCallState("dialing");
      setIsMuted(false);
      setIsOnHold(false);
      // Attach remote audio immediately so ringback tone is heard
      attachRemoteAudio(call);
    } catch (err) {
      console.error("Failed to start call:", err);
    }
  }, [status, defaultCallerNumber, attachRemoteAudio]);

  const hangUp = useCallback(() => {
    if (callRef.current) {
      try { callRef.current.hangup(); } catch {} // eslint-disable-line no-empty
    }
  }, []);

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
