import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { sessionBridgeTokenValid } from "./auth.js";
import type { Env } from "./config.js";
import { requireDeepgramKey } from "./config.js";
import { buildDeepgramSettings, deepgramGreeting } from "./deepgramBridge.js";
import {
  appendDebugLog,
  appendTranscript,
  loadSession,
  updateSession,
  type AiTestSessionRow,
} from "./session.js";
import { buildTwilioStreamPatch, mergeUsageMetrics } from "./usageMetrics.js";

const DEEPGRAM_AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse";
const KEEPALIVE_MS = 5000;

/**
 * Browser mic/speaker ↔ Deepgram Voice Agent. Same upstream config as the Twilio
 * path (µ-law 8 kHz), but the client wire protocol is simple JSON instead of
 * Twilio Media Streams:
 *   client → { type: "auth", bridgeToken } then { type: "audio", payload }
 *   server → { type: "ready" } / { type: "audio", payload } / { type: "transcript" } / { type: "clear" }
 */
export function attachBrowserDeepgramBridge(
  socket: WebSocket,
  env: Env,
  supabase: SupabaseClient,
  queryFallback: { sessionId?: string },
): { sessionId: string } {
  let sessionId = queryFallback.sessionId ?? "";
  let session: AiTestSessionRow | null = null;
  let deepgram: WebSocket | null = null;
  let authed = false;
  let bridgeStarted = false;
  let dgSettingsApplied = false;
  let clientReadySent = false;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let greetingLogged = false;
  let mediaIn = 0;
  let mediaOut = 0;
  let streamStartedAtMs: number | null = null;
  let dgWsConnectedAtMs: number | null = null;

  const sendClient = (payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const clearKeepAlive = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  };

  const persistUsage = () => {
    if (!sessionId) return;
    void mergeUsageMetrics(
      supabase,
      sessionId,
      buildTwilioStreamPatch({
        streamStartedAtMs,
        streamEndedAtMs: Date.now(),
        mediaIn,
        mediaOut,
      }),
    );
  };

  const finishSession = async (status: "completed" | "failed", errorMessage?: string) => {
    if (!sessionId) return;
    const patch: Record<string, unknown> = { status };
    if (errorMessage) patch.error_message = errorMessage;
    await updateSession(supabase, sessionId, patch);
    if (status === "completed") {
      void appendDebugLog(supabase, sessionId, "info", "call.completed", {});
    }
  };

  const sendClientReady = () => {
    if (clientReadySent) return;
    clientReadySent = true;
    sendClient({ type: "ready" });
    const now = Date.now();
    void appendDebugLog(supabase, sessionId, "info", "deepgram.browser.ready_sent", {
      ms_since_stream_start: streamStartedAtMs != null ? now - streamStartedAtMs : null,
      ms_since_ws_open: dgWsConnectedAtMs != null ? now - dgWsConnectedAtMs : null,
    });
  };

  const startKeepAlive = () => {
    clearKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (!deepgram || deepgram.readyState !== WebSocket.OPEN || !dgSettingsApplied) return;
      try {
        deepgram.send(JSON.stringify({ type: "KeepAlive" }));
      } catch {
        // ignore
      }
    }, KEEPALIVE_MS);
  };

  const deepgramMessageText = (data: WebSocket.RawData): string | null => {
    if (typeof data === "string") return data;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    return buf.length > 0 && buf[0] === 0x7b ? buf.toString("utf8") : null;
  };

  const deepgramMessageAudio = (data: WebSocket.RawData): Buffer | null => {
    if (typeof data === "string") return null;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
    return buf.length > 0 && buf[0] === 0x7b ? null : buf;
  };

  const connectDeepgram = () => {
    const apiKey = requireDeepgramKey(env);
    void appendDebugLog(supabase, sessionId, "info", "deepgram.ws.connecting", {});
    deepgram = new WebSocket(DEEPGRAM_AGENT_WS, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    deepgram.on("open", () => {
      dgWsConnectedAtMs = Date.now();
      void appendDebugLog(supabase, sessionId, "info", "deepgram.ws.connected", {
        ms_since_stream_start:
          streamStartedAtMs != null ? dgWsConnectedAtMs - streamStartedAtMs : null,
      });
    });

    deepgram.on("message", async (data) => {
      const jsonText = deepgramMessageText(data);
      if (!jsonText) {
        const audio = deepgramMessageAudio(data);
        if (audio?.length) {
          sendClient({ type: "audio", payload: audio.toString("base64") });
          mediaOut += 1;
          if (mediaOut === 1) {
            void appendDebugLog(supabase, sessionId, "info", "deepgram.first_media_out", {
              bytes: audio.length,
            });
          }
        }
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(msg.type ?? "");

      if (type === "Welcome") {
        if (deepgram?.readyState === WebSocket.OPEN && session) {
          const built = buildDeepgramSettings(session);
          deepgram.send(JSON.stringify(built.settings));
          void appendDebugLog(supabase, sessionId, "info", "deepgram.settings.sent", {
            snapshot: built.snapshot,
          });
        }
        return;
      }

      if (type === "SettingsApplied") {
        dgSettingsApplied = true;
        void appendDebugLog(supabase, sessionId, "info", "deepgram.agent.ready", {});
        if (!greetingLogged && session) {
          greetingLogged = true;
          void appendDebugLog(supabase, sessionId, "info", "deepgram.greeting_sent", {
            greeting_length: deepgramGreeting(session).length,
          });
        }
        startKeepAlive();
        sendClientReady();
        return;
      }

      if (type === "ConversationText") {
        const role = String(msg.role ?? "");
        const content = String(msg.content ?? "").trim();
        if (!content) return;
        const transcriptRole = role === "user" ? "user" : "assistant";
        await appendTranscript(supabase, sessionId, {
          role: transcriptRole,
          text: content,
          at: new Date().toISOString(),
        });
        sendClient({ type: "transcript", role: transcriptRole, text: content });
        void appendDebugLog(
          supabase,
          sessionId,
          "info",
          transcriptRole === "user" ? "user.transcript" : "assistant.transcript",
          { text: content.slice(0, 500) },
        );
        return;
      }

      if (type === "UserStartedSpeaking") {
        sendClient({ type: "clear" });
        return;
      }

      if (type === "AgentAudioDone") {
        void appendDebugLog(supabase, sessionId, "info", "deepgram.agent_audio_done", {});
        return;
      }

      if (type === "Error" || type === "Warning") {
        void appendDebugLog(
          supabase,
          sessionId,
          type === "Error" ? "error" : "warn",
          type === "Error" ? "deepgram.error" : "deepgram.warning",
          msg,
        );
      }
    });

    deepgram.on("error", (err) => {
      void appendDebugLog(supabase, sessionId, "error", "deepgram.ws.error", { message: err.message });
    });

    deepgram.on("close", (code, reason) => {
      clearKeepAlive();
      void appendDebugLog(supabase, sessionId, "info", "deepgram.ws.closed", {
        code,
        reason: reason.toString(),
      });
    });
  };

  const beginBridge = async () => {
    session = await loadSession(supabase, sessionId);
    if (!session || session.stack !== "deepgram_voice_agent") {
      await appendDebugLog(supabase, sessionId, "error", "browser.session_invalid", {
        found: Boolean(session),
        stack: session?.stack,
      });
      sendClient({ type: "error", message: "Invalid session" });
      socket.close(1011, "invalid session");
      return;
    }
    try {
      streamStartedAtMs = Date.now();
      await updateSession(supabase, sessionId, { status: "in-progress" });
      connectDeepgram();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendDebugLog(supabase, sessionId, "error", "browser.bridge_setup_failed", { message });
      sendClient({ type: "error", message });
      await finishSession("failed", message);
      socket.close(1011, "bridge setup failed");
    }
  };

  socket.on("message", (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(msg.type ?? "");

    if (type === "auth") {
      const resolvedSessionId = String(msg.sessionId ?? "").trim() || sessionId;
      const token = String(msg.bridgeToken ?? "").trim();
      if (!resolvedSessionId) {
        sendClient({ type: "error", message: "missing sessionId" });
        socket.close(1011, "missing sessionId");
        return;
      }
      void (async () => {
        const valid = await sessionBridgeTokenValid(supabase, resolvedSessionId, token);
        if (!valid) {
          sendClient({ type: "error", message: "invalid bridge token" });
          socket.close(1011, "invalid bridge token");
          return;
        }
        sessionId = resolvedSessionId;
        authed = true;
        void appendDebugLog(supabase, sessionId, "info", "browser.stream.connected", {});
        if (!bridgeStarted) {
          bridgeStarted = true;
          await beginBridge();
        }
      })();
      return;
    }

    if (!authed) return;

    if (type === "audio") {
      const payload = String(msg.payload ?? "");
      if (!payload || !deepgram || deepgram.readyState !== WebSocket.OPEN || !dgSettingsApplied) return;
      try {
        deepgram.send(Buffer.from(payload, "base64"));
        mediaIn += 1;
      } catch {
        // ignore
      }
      return;
    }

    if (type === "stop") {
      persistUsage();
      deepgram?.close();
    }
  });

  socket.on("error", (err) => {
    if (!sessionId) return;
    void appendDebugLog(supabase, sessionId, "error", "browser.stream.socket_error", {
      message: err.message,
    });
  });

  socket.on("close", (code) => {
    clearKeepAlive();
    if (!sessionId) return;
    void appendDebugLog(supabase, sessionId, "info", "browser.stream.closed", {
      code,
      media_in_count: mediaIn,
      media_out_count: mediaOut,
      dgSettingsApplied,
      clientReadySent,
    });
    deepgram?.close();
    persistUsage();
    const ok = code === 1000 || code === 1005;
    void finishSession(ok ? "completed" : "failed", ok ? undefined : `browser close code ${code}`);
  });

  return { sessionId };
}
