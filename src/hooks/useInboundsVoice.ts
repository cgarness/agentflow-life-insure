import { useCallback, useEffect, useRef, useState } from "react";
import { Call, Device } from "@twilio/voice-sdk";
import { applyRingtoneOutputs } from "@/lib/ringtoneOutputs";
import { roomToken, roomCallState } from "@/lib/inbounds/api";
import { extractAfCallRowId } from "@/lib/inboundCallOwnership";
export type RoomVoiceState = "offline" | "idle" | "incoming" | "active";
/** Receive-only session. Local accept is UI state; ownership comes only from Twilio's signed callback. */
export function useInboundsVoice(
  sessionId: string,
  user: string,
  onReady: (ready: boolean) => void,
  onChange: () => Promise<void>,
) {
  const [state, setState] = useState<RoomVoiceState>("offline"),
    [error, setError] = useState<string | null>(null),
    [caller, setCaller] = useState(""),
    [muted, setMuted] = useState(false),
    [awaiting, setAwaiting] = useState<string | null>(null);
  const device = useRef<Device | null>(null),
    call = useRef<Call | null>(null),
    generation = useRef(0),
    connecting = useRef(false),
    accepted = useRef<string | null>(null);
  const canRing = useRef(false),
    onChangeRef = useRef(onChange),
    onReadyRef = useRef(onReady),
    stateRef = useRef(state),
    ringId = useRef<string | null>(null);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;
  stateRef.current = state;
  const cleanup = useCallback(() => {
    ++generation.current;
    canRing.current = false;
    onReadyRef.current(false);
    device.current?.destroy();
    device.current = null;
    call.current = null;
    setState("offline");
    connecting.current = false;
  }, []);
  const connect = useCallback(async () => {
    if (device.current?.state === Device.State.Registered) return;
    if (connecting.current) return;
    connecting.current = true;
    const gen = ++generation.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      if (gen !== generation.current) return;
      const token = await roomToken(sessionId);
      if (gen !== generation.current) return;
      const d = new Device(token.token, {
        closeProtection: true,
        allowIncomingWhileBusy: false,
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      });
      device.current = d;
      void applyRingtoneOutputs(d);
      d.audio?.on("deviceChange", () => {
        void applyRingtoneOutputs(d);
      });
      d.on("registered", () => {
        if (gen !== generation.current) return;
        onReadyRef.current(true);
        if (!call.current) setState("idle");
        setError(null);
      });
      d.on("unregistered", () => {
        if (gen !== generation.current) return;
        onReadyRef.current(false);
        if (!call.current) setState("offline");
      });
      d.on("error", (e: Error) => {
        if (gen === generation.current) {
          onReadyRef.current(false);
          setError(e.message);
        }
      });
      d.on("tokenWillExpire", () => {
        void roomToken(sessionId)
          .then((t) => {
            if (gen === generation.current) d.updateToken(t.token);
          })
          .catch(() => {
            onReadyRef.current(false);
            setError(
              "Phone connection expired. Rejoin after finishing your call.",
            );
          });
      });
      d.on("incoming", (c: Call) => {
        const id = extractAfCallRowId(c.customParameters);
        if (
          gen !== generation.current ||
          call.current ||
          accepted.current ||
          !canRing.current ||
          !id
        ) {
          c.reject();
          return;
        }
        call.current = c;
        ringId.current = id;
        setCaller(c.parameters.From || "Incoming caller");
        setState("incoming");
        const finish = () => {
          if (gen !== generation.current || call.current !== c) return;
          call.current = null;
          ringId.current = null;
          canRing.current = false;
          setState("idle");
          setMuted(false);
          void onChangeRef.current();
        };
        c.on("cancel", finish);
        c.on("disconnect", finish);
        c.on("reject", finish);
        c.on("error", finish);
        c.on("accept", () => {
          if (gen !== generation.current) return;
          accepted.current = id;
          setAwaiting(id);
          setState("active");
          canRing.current = false;
          void onChangeRef.current();
        });
      });
      await d.register();
      if (gen !== generation.current) d.destroy();
    } catch (e) {
      if (gen === generation.current) {
        cleanup();
        setError(e instanceof Error ? e.message : "Unable to connect phone");
        throw e;
      }
    } finally {
      connecting.current = false;
    }
  }, [sessionId, cleanup]);
  useEffect(() => cleanup, [cleanup]);
  useEffect(() => {
    if (!awaiting) return;
    let alive = true,
      busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const proof = await roomCallState(awaiting);
        if (!alive) return;
        if (proof.agent_id && proof.agent_id !== user) {
          call.current?.disconnect();
          accepted.current = null;
          setAwaiting(null);
        } else if (
          proof.agent_id === user &&
          proof.dispositioned &&
          proof.ended_at
        ) {
          accepted.current = null;
          setAwaiting(null);
        }
        await onChangeRef.current();
      } catch {
        if (alive)
          setError("Waiting for confirmed call status. Receiving is paused.");
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [awaiting, user]);
  const answer = () => {
    if (!canRing.current || stateRef.current !== "incoming" || accepted.current)
      return;
    call.current?.accept();
  };
  const hangup = () => call.current?.disconnect();
  const decline = () => call.current?.reject();
  const toggleMute = () => {
    const next = !muted;
    call.current?.mute(next);
    setMuted(next);
  };
  return {
    state,
    error,
    caller,
    muted,
    awaiting,
    connect,
    cleanup,
    answer,
    hangup,
    decline,
    toggleMute,
    canRing,
  };
}
