import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";
import { BrowserAudioSession, type BrowserAudioStartConfig } from "@/lib/aiTestingBrowserAudio";
import type { TestSession } from "@/hooks/useAITestingSession";

export type BrowserSessionState =
  | "idle"
  | "connecting"
  | "active"
  | "stopping"
  | "error";

const SESSION_SELECT =
  "id, stack, status, transcript, error_message, twilio_call_sid, debug_log, created_at, updated_at, usage_metrics, model_id, prompt";

export function useAITestingBrowserSession() {
  const [state, setState] = useState<BrowserSessionState>("idle");
  const [session, setSession] = useState<TestSession | null>(null);
  const [micActive, setMicActive] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<BrowserAudioSession | null>(null);

  const poll = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("ai_test_sessions")
      .select(SESSION_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (!data) return;
    setSession({
      id: data.id,
      stack: data.stack as TestSession["stack"],
      status: data.status,
      transcript: Array.isArray(data.transcript) ? (data.transcript as TestSession["transcript"]) : [],
      error_message: data.error_message,
      twilio_call_sid: data.twilio_call_sid,
      debug_log: Array.isArray(data.debug_log) ? (data.debug_log as TestSession["debug_log"]) : [],
      created_at: data.created_at,
      updated_at: data.updated_at,
      usage_metrics: data.usage_metrics ?? {},
      model_id: data.model_id,
      prompt: data.prompt ?? "",
    });
  }, []);

  useEffect(() => {
    if (state !== "active") return;
    const id = sessionIdRef.current;
    if (!id) return;
    void poll(id);
    const interval = setInterval(() => void poll(id), 2000);
    return () => clearInterval(interval);
  }, [state, poll]);

  const teardown = useCallback(() => {
    audioRef.current?.stop();
    audioRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
        ws.close(1000, "client stop");
      } catch {
        // ignore
      }
    }
    setMicActive(false);
  }, []);

  const stopBrowserTest = useCallback(async () => {
    const id = sessionIdRef.current;
    setState("stopping");
    teardown();
    if (id) {
      try {
        await supabase.functions.invoke("ai-testing-end-call", { body: { sessionId: id } });
        await poll(id);
      } catch {
        // best-effort — the bridge also marks the session complete on socket close
      }
    }
    setState("idle");
  }, [teardown, poll]);

  const startBrowserTest = useCallback(
    async (body: Record<string, unknown>, audioConfig?: Omit<BrowserAudioStartConfig, "onChunk" | "onError">) => {
      if (state === "connecting" || state === "active") return;
      setState("connecting");
      setSession(null);
      sessionIdRef.current = null;

      let audio: BrowserAudioSession | null = null;
      try {
        const { data, error } = await supabase.functions.invoke("ai-testing-start-browser-session", {
          body,
        });
        if (error) throw error;
        if (!data?.success) throw new Error((data?.error as string) ?? "Could not start session");

        const sessionId = data.sessionId as string;
        const bridgeToken = data.bridgeToken as string;
        const wsUrl = data.wsUrl as string;
        sessionIdRef.current = sessionId;

        audio = new BrowserAudioSession();
        await audio.start({
          ...audioConfig,
          onChunk: (payload) => {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio", payload }));
          },
          onError: (message) => console.error("[ai-testing-browser-audio]", message),
        });
        audioRef.current = audio;
        setMicActive(true);

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "auth", bridgeToken, sessionId }));
        };

        ws.onmessage = (event) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          } catch {
            return;
          }
          const type = String(msg.type ?? "");
          if (type === "ready") {
            setState("active");
            void poll(sessionId);
          } else if (type === "audio") {
            audioRef.current?.play(String(msg.payload ?? ""));
          } else if (type === "clear") {
            audioRef.current?.clearPlayback();
          } else if (type === "error") {
            toast.error(String(msg.message ?? "Bridge error"));
            setState("error");
            teardown();
          }
        };

        ws.onerror = () => {
          toast.error("Voice bridge connection failed");
          setState("error");
          teardown();
        };

        ws.onclose = () => {
          if (sessionIdRef.current) void poll(sessionIdRef.current);
          setMicActive(false);
          setState((prev) => (prev === "active" || prev === "connecting" ? "idle" : prev));
        };

        toast.success("Browser test connecting — start talking once it says Ready");
      } catch (err) {
        audio?.stop();
        audioRef.current = null;
        setMicActive(false);
        setState("error");
        toast.error(await edgeFunctionErrorMessage(err, "Failed to start browser test"));
      }
    },
    [state, poll, teardown],
  );

  useEffect(() => {
    return () => teardown();
  }, [teardown]);

  return {
    state,
    session,
    micActive,
    isRunning: state === "connecting" || state === "active",
    startBrowserTest,
    stopBrowserTest,
  };
}
