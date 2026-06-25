import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { sessionBridgeTokenValid } from "./auth.js";
import { requireInworldKey, type Env } from "./config.js";
import {
  appendDebugLog,
  appendTranscript,
  sessionAgentInstructions,
  updateSession,
} from "./session.js";
import {
  buildInworldAudioConfig,
  connectInworldUpstream,
  INWORLD_GREETING,
  loadInworldSession,
  outputAudioPayload,
  upstreamConfigFromSession,
  waitForInworldReady,
  type InworldSessionRow,
} from "./inworldBridge.js";
import {
  buildTwilioStreamPatch,
  extractInworldUsageFromMessage,
  mergeUsageMetrics,
  type UsageMetricsInworld,
} from "./usageMetrics.js";

/**
 * Browser mic/speaker ↔ Inworld Realtime. Same upstream config as the Twilio
 * path (audio/pcmu µ-law 8 kHz), but the client wire protocol is simple JSON
 * instead of Twilio Media Streams.
 */
export function attachBrowserInworldBridge(
  socket: WebSocket,
  env: Env,
  supabase: SupabaseClient,
  queryFallback: { sessionId?: string },
): { sessionId: string } {
  let sessionId = queryFallback.sessionId ?? "";
  let authed = false;
  let bridgeStarted = false;
  let upstream: WebSocket | null = null;
  let upstreamReady = false;
  let greetingFired = false;
  let session: InworldSessionRow | null = null;
  let streamStartedAtMs: number | null = null;
  let mediaIn = 0;
  let mediaOut = 0;
  let inworldUsage: UsageMetricsInworld = {};
  const inboundPending: string[] = [];

  const sendClient = (payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const persistUsage = () => {
    if (!sessionId) return;
    const endedAt = Date.now();
    const bridgeSec =
      streamStartedAtMs != null ? Math.round(((endedAt - streamStartedAtMs) / 1000) * 1000) / 1000 : undefined;
    void mergeUsageMetrics(supabase, sessionId, {
      ...buildTwilioStreamPatch({ streamStartedAtMs, streamEndedAtMs: endedAt, mediaIn, mediaOut }),
      inworld: { ...inworldUsage, bridge_session_sec: bridgeSec },
    });
  };

  const forwardInbound = (payload: string) => {
    if (!payload) return;
    if (!upstreamReady || !upstream || upstream.readyState !== WebSocket.OPEN) {
      inboundPending.push(payload);
      return;
    }
    upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
  };

  const flushInboundPending = () => {
    if (!upstreamReady || !upstream || upstream.readyState !== WebSocket.OPEN) return;
    for (const payload of inboundPending.splice(0)) {
      upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
    }
  };

  const fireGreeting = () => {
    if (greetingFired || !session || !upstream || upstream.readyState !== WebSocket.OPEN || !upstreamReady) {
      return;
    }
    greetingFired = true;
    const cfg = upstreamConfigFromSession(session, env);
    upstream.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: `The call just connected. Say exactly: "${INWORLD_GREETING}" Then stop and wait for the caller.`,
          output_modalities: ["audio"],
          temperature: cfg.temperature,
          audio: {
            output: buildInworldAudioConfig(cfg.voice, cfg.ttsModel, cfg.interruption, cfg.speed).output,
          },
        },
      }),
    );
    void appendDebugLog(supabase, sessionId, "info", "inworld.greeting_sent", { greeting: INWORLD_GREETING });
  };

  const beginBridge = async () => {
    try {
      requireInworldKey(env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendDebugLog(supabase, sessionId, "error", "inworld.ws.connect_failed", { error_message: message });
      sendClient({ type: "error", message });
      socket.close(1011, message.slice(0, 120));
      return;
    }

    session = await loadInworldSession(supabase, sessionId);
    if (!session || session.stack !== "inworld_realtime_agent") {
      await appendDebugLog(supabase, sessionId, "error", "inworld.session_invalid", {
        found: Boolean(session),
        stack: session?.stack,
      });
      sendClient({ type: "error", message: "Invalid session" });
      socket.close(1011, "invalid session");
      return;
    }

    const instructions = sessionAgentInstructions(session);
    const cfg = upstreamConfigFromSession(session, env);
    inworldUsage = { router_model: cfg.routerModel, tts_model: cfg.ttsModel, voice_id: cfg.voice };

    try {
      streamStartedAtMs = Date.now();
      await updateSession(supabase, sessionId, { status: "in-progress" });
      upstream = connectInworldUpstream(env, sessionId, instructions, cfg);
      upstream.on("open", () => {
        void appendDebugLog(supabase, sessionId, "info", "inworld.ws.connected", {});
      });

      await waitForInworldReady(upstream);
      upstreamReady = true;
      void appendDebugLog(supabase, sessionId, "info", "inworld.session.ready", {});
      sendClient({ type: "ready" });
      flushInboundPending();
      fireGreeting();

      upstream.on("message", async (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(msg.type ?? "");

        if (type === "error") {
          void appendDebugLog(supabase, sessionId, "error", "inworld.response.failed", msg);
        }

        if (type === "response.done" || type === "response.completed") {
          const usagePatch = extractInworldUsageFromMessage(msg);
          if (usagePatch) {
            inworldUsage = {
              ...inworldUsage,
              ...usagePatch,
              stt_audio_sec: (inworldUsage.stt_audio_sec ?? 0) + (usagePatch.stt_audio_sec ?? 0),
              tts_audio_sec: (inworldUsage.tts_audio_sec ?? 0) + (usagePatch.tts_audio_sec ?? 0),
              tts_characters: (inworldUsage.tts_characters ?? 0) + (usagePatch.tts_characters ?? 0),
              input_tokens: (inworldUsage.input_tokens ?? 0) + (usagePatch.input_tokens ?? 0),
              output_tokens: (inworldUsage.output_tokens ?? 0) + (usagePatch.output_tokens ?? 0),
              usage_from_api: true,
            };
          }
        }

        if (type === "response.output_audio.delta") {
          const delta = outputAudioPayload(msg);
          if (delta) {
            sendClient({ type: "audio", payload: delta });
            mediaOut += 1;
          }
        }

        if (
          type === "response.output_audio_transcript.delta" ||
          type === "response.audio_transcript.delta"
        ) {
          const delta = String(msg.delta ?? "");
          if (delta) {
            await appendTranscript(supabase, sessionId, {
              role: "assistant",
              text: delta,
              at: new Date().toISOString(),
            });
            sendClient({ type: "transcript", role: "assistant", text: delta });
          }
        }

        if (type === "conversation.item.input_audio_transcription.completed") {
          const text = String(msg.transcript ?? "").trim();
          if (text) {
            await appendTranscript(supabase, sessionId, {
              role: "user",
              text,
              at: new Date().toISOString(),
            });
            sendClient({ type: "transcript", role: "user", text });
          }
        }

        if (type === "input_audio_buffer.speech_started") {
          sendClient({ type: "clear" });
        }
      });

      upstream.on("error", (err) => {
        void appendDebugLog(supabase, sessionId, "error", "inworld.ws.connect_failed", { message: err.message });
      });

      upstream.on("close", (code, reason) => {
        void appendDebugLog(supabase, sessionId, "warn", "inworld.ws.closed", {
          code,
          reason: reason.toString(),
        });
        try {
          socket.close(1011, "inworld closed");
        } catch {
          // ignore
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void appendDebugLog(supabase, sessionId, "error", "inworld.session.config_failed", {
        error_message: message,
      });
      sendClient({ type: "error", message });
      await updateSession(supabase, sessionId, { status: "failed", error_message: message });
      socket.close(1011, "inworld bridge setup failed");
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
      if (payload) {
        mediaIn += 1;
        forwardInbound(payload);
      }
      return;
    }

    if (type === "stop") {
      persistUsage();
      upstream?.close();
    }
  });

  socket.on("error", (err) => {
    if (!sessionId) return;
    void appendDebugLog(supabase, sessionId, "error", "browser.stream.socket_error", { message: err.message });
  });

  socket.on("close", () => {
    if (!sessionId) return;
    upstream?.close();
    persistUsage();
    void updateSession(supabase, sessionId, { status: "completed" });
    void appendDebugLog(supabase, sessionId, "info", "call.completed", {});
  });

  return { sessionId };
}
