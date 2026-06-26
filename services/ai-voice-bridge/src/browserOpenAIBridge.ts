import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { sessionBridgeTokenValid } from "./auth.js";
import {
  clampRealtimeTemperature,
  connectOpenAiUpstream,
  greetingInstruction,
  isOutputAudioEvent,
  outputAudioPayload,
  waitForUpstreamReady,
  type UpstreamConfig,
} from "./bridge.js";
import { requireOpenAiKey, type Env } from "./config.js";
import {
  appendDebugLog,
  appendTranscript,
  loadSession,
  sessionAgentInstructions,
  updateSession,
  type AiTestSessionRow,
} from "./session.js";
import {
  buildTwilioStreamPatch,
  extractOpenAiUsageFromMessage,
  mergeUsageMetrics,
  openAiAudioTokensFromSeconds,
  type UsageMetricsOpenai,
} from "./usageMetrics.js";

function upstreamConfigFromSession(session: AiTestSessionRow): UpstreamConfig {
  return {
    voice: session.voice_id ?? "",
    temperature: typeof session.temperature === "number" ? session.temperature : 0.8,
    interruption: session.interruption_sensitivity ?? "medium",
    speed:
      typeof session.speaking_rate === "number" && session.speaking_rate > 0
        ? session.speaking_rate
        : 1.0,
  };
}

/**
 * Browser mic/speaker ↔ OpenAI Realtime. Same upstream config as the Twilio phone
 * path (audio/pcmu µ-law 8 kHz), but the client wire protocol is simple JSON.
 */
export function attachBrowserOpenAIBridge(
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
  let session: AiTestSessionRow | null = null;
  let streamStartedAtMs: number | null = null;
  let mediaIn = 0;
  let mediaOut = 0;
  let openAiUsage: UsageMetricsOpenai = { model: env.OPENAI_REALTIME_MODEL };
  const inboundPending: string[] = [];

  const sendClient = (payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const persistUsage = () => {
    if (!sessionId) return;
    const endedAt = Date.now();
    const streamPatch = buildTwilioStreamPatch({
      streamStartedAtMs,
      streamEndedAtMs: endedAt,
      mediaIn,
      mediaOut,
    });
    const inbound = streamPatch.twilio?.inbound_audio_sec ?? 0;
    const outbound = streamPatch.twilio?.outbound_audio_sec ?? 0;
    if (!openAiUsage.usage_from_api) {
      const derived = openAiAudioTokensFromSeconds(inbound, outbound);
      openAiUsage = {
        ...openAiUsage,
        inbound_audio_sec: inbound,
        outbound_audio_sec: outbound,
        input_audio_tokens: derived.input_audio_tokens,
        output_audio_tokens: derived.output_audio_tokens,
      };
    } else {
      openAiUsage = {
        ...openAiUsage,
        inbound_audio_sec: inbound,
        outbound_audio_sec: outbound,
      };
    }
    void mergeUsageMetrics(supabase, sessionId, {
      ...streamPatch,
      openai: openAiUsage,
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
    if (
      greetingFired ||
      !session ||
      !upstream ||
      upstream.readyState !== WebSocket.OPEN ||
      !upstreamReady
    ) {
      return;
    }
    greetingFired = true;
    const voice = session.voice_id?.trim() || "alloy";
    const temperature = clampRealtimeTemperature(
      typeof session.temperature === "number" ? session.temperature : 0.8,
    );
    upstream.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: greetingInstruction(session),
          output_modalities: ["audio"],
          temperature,
          audio: {
            output: {
              format: { type: "audio/pcmu" },
              voice,
            },
          },
        },
      }),
    );
    void appendDebugLog(supabase, sessionId, "info", "openai.greeting_sent", { mode: "browser" });
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

  const beginBridge = async () => {
    try {
      requireOpenAiKey(env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendDebugLog(supabase, sessionId, "error", "openai.ws.connect_failed", {
        error_message: message,
      });
      sendClient({ type: "error", message });
      socket.close(1011, message.slice(0, 120));
      return;
    }

    session = await loadSession(supabase, sessionId);
    if (!session || session.stack !== "openai_realtime") {
      await appendDebugLog(supabase, sessionId, "error", "openai.session_invalid", {
        found: Boolean(session),
        stack: session?.stack,
      });
      sendClient({ type: "error", message: "Invalid session" });
      socket.close(1011, "invalid session");
      return;
    }

    const instructions = sessionAgentInstructions(session);
    const cfg = upstreamConfigFromSession(session);
    openAiUsage = { model: env.OPENAI_REALTIME_MODEL };

    try {
      streamStartedAtMs = Date.now();
      await updateSession(supabase, sessionId, { status: "in-progress" });
      upstream = connectOpenAiUpstream(env, instructions, cfg);
      upstream.on("open", () => {
        void appendDebugLog(supabase, sessionId, "info", "openai.ws.connected", {});
      });

      await waitForUpstreamReady(upstream);
      upstreamReady = true;
      void appendDebugLog(supabase, sessionId, "info", "openai.session.ready", { mode: "browser" });
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
          void appendDebugLog(supabase, sessionId, "error", "openai.response.failed", msg);
        }

        if (type === "response.done" || type === "response.completed") {
          const usagePatch = extractOpenAiUsageFromMessage(msg);
          if (usagePatch) {
            openAiUsage = {
              ...openAiUsage,
              model: env.OPENAI_REALTIME_MODEL,
              input_audio_tokens:
                (openAiUsage.input_audio_tokens ?? 0) + (usagePatch.input_audio_tokens ?? 0),
              output_audio_tokens:
                (openAiUsage.output_audio_tokens ?? 0) + (usagePatch.output_audio_tokens ?? 0),
              text_input_tokens:
                (openAiUsage.text_input_tokens ?? 0) + (usagePatch.text_input_tokens ?? 0),
              text_output_tokens:
                (openAiUsage.text_output_tokens ?? 0) + (usagePatch.text_output_tokens ?? 0),
              usage_from_api: true,
            };
          }
        }

        if (isOutputAudioEvent(type)) {
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
        void appendDebugLog(supabase, sessionId, "error", "openai.ws.error", {
          message: err.message,
        });
      });

      upstream.on("close", (code, reason) => {
        void appendDebugLog(supabase, sessionId, "warn", "openai.ws.closed", {
          code,
          reason: reason.toString(),
        });
        try {
          socket.close(1011, "openai closed");
        } catch {
          // ignore
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void appendDebugLog(supabase, sessionId, "error", "openai.session.config_failed", {
        error_message: message,
      });
      sendClient({ type: "error", message });
      await finishSession("failed", message);
      socket.close(1011, "openai bridge setup failed");
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
        void appendDebugLog(supabase, sessionId, "info", "browser.stream.connected", {
          mode: "openai",
        });
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
    void appendDebugLog(supabase, sessionId, "error", "browser.stream.socket_error", {
      message: err.message,
    });
  });

  socket.on("close", (code) => {
    if (!sessionId) return;
    void appendDebugLog(supabase, sessionId, "info", "browser.stream.closed", {
      code,
      media_in_count: mediaIn,
      media_out_count: mediaOut,
      mode: "openai",
    });
    upstream?.close();
    persistUsage();
    const ok = code === 1000 || code === 1005;
    void finishSession(ok ? "completed" : "failed", ok ? undefined : `browser close code ${code}`);
  });

  return { sessionId };
}
