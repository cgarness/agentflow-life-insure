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
  makeCall: (destinationNumber: string, callerNumber?: string) => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
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

  // Initialize TelnyxRTC
  useEffect(() => {
    let client: any;
    let mounted = true;

    const init = async () => {
      // 1. Fetch credentials
      const { data: settings } = await supabase
        .from("telnyx_settings")
        .select("api_key, connection_id, sip_username, sip_password")
        .eq("id", TELNYX_SETTINGS_ID)
        .maybeSingle();

      if (!mounted) return;

      const creds = settings as any;
      if (!creds || !creds.api_key) {
        // No credentials configured — stay idle silently
        setStatus("idle");
        return;
      }

      setStatus("connecting");

      // 2. Fetch SIP credentials
      try {
        const { data: tokenData, error: tokenError } = await supabase.functions.invoke("telnyx-token", {
          body: { connection_id: creds.connection_id },
        });

        if (!mounted) return;

        if (tokenError || !tokenData?.sip_username) {
          setStatus("error");
          setErrorMessage(tokenData?.error || tokenError?.message || "Failed to get SIP credentials");
          return;
        }

        // 4. Initialize TelnyxRTC with SIP credentials
        client = new TelnyxRTC({
          login: tokenData.sip_username,
          password: tokenData.sip_password,
          host: 'rtc.telnyx.com',
        });

        client.on("telnyx.ready", () => {
          if (mounted) {
            setStatus("ready");
            setErrorMessage(null);
            console.log("TelnyxRTC ready (shared context)");
          }
        });

        client.on("telnyx.error", (error: any) => {
          if (mounted) {
            console.error('TelnyxRTC full error:', JSON.stringify(error, null, 2));
            console.error('TelnyxRTC error message:', error?.message);
            console.error('TelnyxRTC error code:', error?.code);
            setStatus('error');
            setErrorMessage(error?.message || error?.code || 'Connection failed - check browser console');
          }
        });

        client.on("telnyx.notification", (notification: any) => {
          if (!mounted || !notification.call) return;
          const call = notification.call;
          callRef.current = call;
          setCurrentCall(call);

          const state = call.state;
          if (state === "active") {
            setCallState("active");
          } else if (state === "destroy" || state === "hangup") {
            setCallState("ended");
            // Stop timer
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            // Stop microphone stream so red recording dot goes away
            if (mediaStreamRef.current) {
              mediaStreamRef.current.getTracks().forEach(track => track.stop());
              mediaStreamRef.current = null;
            }
            // Reset after 2 seconds
            endResetRef.current = setTimeout(() => {
              if (mounted) {
                setCallState("idle");
                setCallDuration(0);
                setCurrentCall(null);
                setIsMuted(false);
                setIsOnHold(false);
                callRef.current = null;
              }
            }, 2000);
          } else if (state === "ringing" || state === "trying") {
            setCallState("dialing");
          }
        });

        clientRef.current = client;
        client.connect();
      } catch (err: any) {
        if (mounted) {
          setStatus("error");
          setErrorMessage(err?.message || "Could not initialize dialer");
        }
      }
    };

    init();

    return () => {
      mounted = false;
      if (client) {
        try { client.disconnect(); } catch {} // eslint-disable-line no-empty
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (endResetRef.current) clearTimeout(endResetRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  // Call duration timer — start when active, stop otherwise
  useEffect(() => {
    if (callState === "active") {
      setCallDuration(0);
      timerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } else if (callState !== "active" && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [callState]);

  const makeCall = useCallback(async (destinationNumber: string, callerNumber?: string) => {
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
      });
      callRef.current = call;
      setCurrentCall(call);
      setCallState("dialing");
      setIsMuted(false);
      setIsOnHold(false);
    } catch (err) {
      console.error("Failed to start call:", err);
    }
  }, [status, defaultCallerNumber]);

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
        makeCall,
        hangUp,
        toggleMute,
        toggleHold,
      }}
    >
      {children}
    </TelnyxContext.Provider>
  );
};
