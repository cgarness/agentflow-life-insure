import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { sessionBridgeTokenValid } from "./auth.js";
import { requireInworldKey, type Env } from "./config.js";
import { sessionAgentInstructions } from "./session.js";
import {
  appendDebugLog,
  appendTranscript,
  loadSession,
  updateSession,
  type AiTestSessionRow,
  type InterruptionSensitivity,
} from "./session.js";
import {
  buildTwilioStreamPatch,
  extractInworldUsageFromMessage,
  mergeUsageMetrics,
  type UsageMetricsInworld,
} from "./usageMetrics.js";

export const INWORLD_GREETING = "Hi, this is Sarah. Can you hear me okay?";

export type InworldSessionRow = AiTestSessionRow & {
  tunables?: Record<string, unknown>;
};

export type UpstreamConfig = {
  routerModel: string;
  voice: string;
  ttsModel: string;
  temperature: number;
  interruption: InterruptionSensitivity;
  speed: number;
  maxOutputTokens: number | "inf";
};

function eagernessFromInterruption(level: InterruptionSensitivity): string {
  switch (level) {
    case "low":
      return "low";
    case "high":
      return "high";
    case "medium":
    default:
      return "medium";
  }
}

function turnDetectionFromInterruption(level: InterruptionSensitivity) {
  return {
    type: "semantic_vad" as const,
    eagerness: eagernessFromInterruption(level),
    create_response: true,
    interrupt_response: true,
  };
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(1.2, Math.max(0, value));
}

export function buildInworldAudioConfig(voice: string, ttsModel: string, interruption: InterruptionSensitivity, speed: number) {
  return {
    input: {
      format: { type: "audio/pcmu" as const },
      turn_detection: turnDetectionFromInterruption(interruption),
    },
    output: {
      format: { type: "audio/pcmu" as const },
      voice: voice || "Sarah",
      model: ttsModel || "inworld-tts-2",
      speed: Math.min(1.5, Math.max(0.25, speed || 1)),
    },
  };
}

function inworldRealtimeUrl(env: Env, sessionKey: string): string {
  const base = (env.INWORLD_REALTIME_WS_URL ?? "wss://api.inworld.ai/api/v1/realtime/session").replace(
    /\?.*$/,
    "",
  );
  return `${base}?key=${encodeURIComponent(sessionKey)}&protocol=realtime`;
}

export function connectInworldUpstream(
  env: Env,
  sessionKey: string,
  instructions: string,
  cfg: UpstreamConfig,
): WebSocket {
  const url = inworldRealtimeUrl(env, sessionKey);
  const ws = new WebSocket(url, {
    headers: { Authorization: `Basic ${requireInworldKey(env)}` },
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model: cfg.routerModel,
          instructions,
          temperature: cfg.temperature,
          max_output_tokens: cfg.maxOutputTokens,
          output_modalities: ["audio"],
          audio: buildInworldAudioConfig(cfg.voice, cfg.ttsModel, cfg.interruption, cfg.speed),
        },
      }),
    );
  });

  return ws;
}

export function waitForInworldReady(upstream: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Inworld realtime session timed out"));
    }, 12_000);

    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        const type = String(msg.type ?? "");
        if (type === "error") {
          cleanup();
          const errObj = msg.error as Record<string, unknown> | undefined;
          reject(
            new Error(String(errObj?.message ?? msg.message ?? "Inworld session.update error")),
          );
          return;
        }
        if (type === "session.updated" || type === "session.created") {
          cleanup();
          resolve();
        }
      } catch {
        // ignore
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error("Inworld WebSocket error"));
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Inworld WebSocket closed before ready"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      upstream.off("message", onMessage);
      upstream.off("error", onError);
      upstream.off("close", onClose);
    };

    upstream.on("message", onMessage);
    upstream.on("error", onError);
    upstream.on("close", onClose);
  });
}

export function outputAudioPayload(msg: Record<string, unknown>): string {
  if (typeof msg.delta === "string") return msg.delta;
  return "";
}

function paramFromCustom(customParameters: Record<string, unknown>, key: string): string {
  return String(customParameters[key] ?? "").trim();
}

export type TwilioQueryFallback = { sessionId?: string };

export type BridgeHandle = { sessionId: string };

export async function loadInworldSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<InworldSessionRow | null> {
  const { data, error } = await supabase
    .from("ai_test_sessions")
    .select(
      "id, organization_id, stack, prompt, lead_context, status, transcript, voice_id, model_id, temperature, speaking_rate, interruption_sensitivity, bridge_token, tunables",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...data,
    lead_context: data.lead_context as InworldSessionRow["lead_context"],
    transcript: Array.isArray(data.transcript) ? data.transcript : [],
    tunables:
      data.tunables && typeof data.tunables === "object"
        ? (data.tunables as Record<string, unknown>)
        : {},
  } as InworldSessionRow;
}

export function upstreamConfigFromSession(session: InworldSessionRow, env: Env): UpstreamConfig {
  const tunables = session.tunables ?? {};
  const maxRaw = tunables.max_response_tokens ?? 512;
  const maxOutputTokens =
    maxRaw === "inf" || maxRaw === Infinity ? "inf" : Math.min(4096, Math.max(1, Number(maxRaw) || 512));

  return {
    routerModel:
      session.model_id?.trim() ||
      env.INWORLD_ROUTER_MODEL?.trim() ||
      "inworld/latency-optimizer-ab-test",
    voice: session.voice_id?.trim() || env.INWORLD_VOICE_ID?.trim() || "Sarah",
    ttsModel:
      String(tunables.tts_model ?? env.INWORLD_TTS_MODEL ?? "inworld-tts-2").trim() || "inworld-tts-2",
    temperature: clampTemperature(
      typeof session.temperature === "number" ? session.temperature : 0.7,
    ),
    interruption: session.interruption_sensitivity ?? "medium",
    speed:
      typeof session.speaking_rate === "number" && session.speaking_rate > 0
        ? session.speaking_rate
        : 1,
    maxOutputTokens,
  };
}

/**
 * Twilio Media Streams ↔ Inworld Realtime API (OpenAI-compatible protocol, µ-law 8 kHz).
 */
export function attachInworldBridge(
  socket: WebSocket,
  env: Env,
  supabase: SupabaseClient,
  queryFallback: TwilioQueryFallback,
): BridgeHandle {
  let sessionId = "";
  let bridgeStarted = false;
  let upstream: WebSocket | null = null;
  let streamSid = "";
  let upstreamReady = false;
  let greetingFired = false;
  const inboundPending: string[] = [];
  let twilioMediaIn = 0;
  let twilioMediaOut = 0;
  let upstreamMsgCount = 0;
  let session: InworldSessionRow | null = null;
  let streamStartedAtMs: number | null = null;
  let inworldUsage: UsageMetricsInworld = {};
  let lastAudioOutLogAt = 0;
  let noTranscriptTimer: ReturnType<typeof setTimeout> | null = null;

  const persistStreamUsage = () => {
    if (!sessionId) return;
    const endedAt = Date.now();
    const streamPatch = buildTwilioStreamPatch({
      streamStartedAtMs,
      streamEndedAtMs: endedAt,
      mediaIn: twilioMediaIn,
      mediaOut: twilioMediaOut,
    });
    const bridgeSec =
      streamStartedAtMs != null
        ? Math.round(((endedAt - streamStartedAtMs) / 1000) * 1000) / 1000
        : undefined;
    void mergeUsageMetrics(supabase, sessionId, {
      ...streamPatch,
      inworld: {
        ...inworldUsage,
        bridge_session_sec: bridgeSec,
      },
    });
  };

  const isCallerMediaTrack = (track: string): boolean => {
    const t = track.trim().toLowerCase();
    if (!t || t === "inbound" || t === "inbound_track") return true;
    return t !== "outbound" && t !== "outbound_track";
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

  const forwardAudioToTwilio = (payload: string) => {
    if (!streamSid || !payload || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload },
      }),
    );
    twilioMediaOut += 1;
    const now = Date.now();
    if (now - lastAudioOutLogAt > 5000) {
      lastAudioOutLogAt = now;
      void appendDebugLog(supabase, sessionId, "info", "inworld.audio.sent", {
        mediaOut: twilioMediaOut,
      });
    }
  };

  const fireGreeting = () => {
    if (
      greetingFired ||
      !session ||
      !streamSid ||
      !upstream ||
      upstream.readyState !== WebSocket.OPEN ||
      !upstreamReady
    ) {
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
    void appendDebugLog(supabase, sessionId, "info", "inworld.greeting_sent", {
      greeting: INWORLD_GREETING,
    });
  };

  const scheduleNoTranscriptTimeout = () => {
    if (noTranscriptTimer) clearTimeout(noTranscriptTimer);
    noTranscriptTimer = setTimeout(() => {
      void appendDebugLog(supabase, sessionId, "warn", "inworld.no_transcript_timeout", {
        mediaIn: twilioMediaIn,
        upstreamMsgCount,
      });
    }, 12_000);
  };

  const beginBridge = async () => {
    try {
      requireInworldKey(env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendDebugLog(supabase, sessionId, "error", "inworld.ws.connect_failed", {
        error_message: message,
      });
      socket.close(1011, message.slice(0, 120));
      return;
    }

    session = await loadInworldSession(supabase, sessionId);
    if (!session || session.stack !== "inworld_realtime_agent") {
      await appendDebugLog(supabase, sessionId, "error", "inworld.session_invalid", {
        found: Boolean(session),
        stack: session?.stack,
      });
      socket.close(1011, "invalid session");
      return;
    }

    const instructions = sessionAgentInstructions(session);
    const cfg = upstreamConfigFromSession(session, env);
    inworldUsage = {
      router_model: cfg.routerModel,
      tts_model: cfg.ttsModel,
      voice_id: cfg.voice,
    };

    try {
      await updateSession(supabase, sessionId, { status: "in-progress" });
      void appendDebugLog(supabase, sessionId, "info", "inworld.ws.connecting", {
        routerModel: cfg.routerModel,
        ttsModel: cfg.ttsModel,
        voice: cfg.voice,
      });

      upstream = connectInworldUpstream(env, sessionId, instructions, cfg);
      upstream.on("open", () => {
        void appendDebugLog(supabase, sessionId, "info", "inworld.ws.connected", {});
        void appendDebugLog(supabase, sessionId, "info", "inworld.session.config_sent", {
          routerModel: cfg.routerModel,
          ttsModel: cfg.ttsModel,
        });
      });

      await waitForInworldReady(upstream);
      upstreamReady = true;
      void appendDebugLog(supabase, sessionId, "info", "inworld.session.ready", {});
      flushInboundPending();
      fireGreeting();
      scheduleNoTranscriptTimeout();

      upstream.on("message", async (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(msg.type ?? "");
        upstreamMsgCount += 1;

        if (type === "error") {
          void appendDebugLog(supabase, sessionId, "error", "inworld.response.failed", msg);
        }

        if (type === "response.created") {
          void appendDebugLog(supabase, sessionId, "info", "inworld.response.started", {});
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
          if (delta) forwardAudioToTwilio(delta);
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
          }
        }

        if (
          type === "response.output_audio_transcript.done" ||
          type === "response.audio_transcript.done"
        ) {
          const text = String(msg.transcript ?? "").trim();
          if (text) {
            void appendDebugLog(supabase, sessionId, "info", "assistant.transcript", {
              text: text.slice(0, 200),
            });
          }
        }

        if (type === "conversation.item.input_audio_transcription.completed") {
          if (noTranscriptTimer) {
            clearTimeout(noTranscriptTimer);
            noTranscriptTimer = null;
          }
          const text = String(msg.transcript ?? "").trim();
          if (text) {
            await appendTranscript(supabase, sessionId, {
              role: "user",
              text,
              at: new Date().toISOString(),
            });
            void appendDebugLog(supabase, sessionId, "info", "user.transcript", { text: text.slice(0, 200) });
          }
        }

        if (type === "input_audio_buffer.speech_started") {
          void appendDebugLog(supabase, sessionId, "info", "inworld.user_speech_started", {});
          if (streamSid && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: "clear", streamSid }));
          }
        }
      });

      upstream.on("error", (err) => {
        void appendDebugLog(supabase, sessionId, "error", "inworld.ws.connect_failed", {
          message: err.message,
        });
      });

      upstream.on("close", (code, reason) => {
        void appendDebugLog(supabase, sessionId, "warn", "inworld.ws.closed", {
          code,
          reason: reason.toString(),
          upstreamMsgCount,
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

    const event = String(msg.event ?? "");
    if (event === "connected") return;

    if (event === "start") {
      const start = msg.start as Record<string, unknown> | undefined;
      const customParameters = (start?.customParameters ?? {}) as Record<string, unknown>;
      const resolvedSessionId =
        paramFromCustom(customParameters, "sessionId") || (queryFallback.sessionId ?? "");
      const bridgeToken = paramFromCustom(customParameters, "bridgeToken");

      if (!resolvedSessionId) {
        try {
          socket.close(1011, "missing sessionId");
        } catch {
          // ignore
        }
        return;
      }

      void (async () => {
        const valid = await sessionBridgeTokenValid(supabase, resolvedSessionId, bridgeToken);
        if (!valid) {
          try {
            socket.close(1011, "invalid bridge token");
          } catch {
            // ignore
          }
          return;
        }

        sessionId = resolvedSessionId;
        streamSid = String(start?.streamSid ?? msg.streamSid ?? "");
        streamStartedAtMs = Date.now();
        void appendDebugLog(supabase, sessionId, "info", "twilio.stream.connected", {
          streamSid,
          callSid: start?.callSid,
        });

        if (!bridgeStarted) {
          bridgeStarted = true;
          await beginBridge();
        }
        fireGreeting();
      })();
      return;
    }

    if (event === "media") {
      const media = msg.media as Record<string, unknown> | undefined;
      const track = String(media?.track ?? "inbound");
      if (!isCallerMediaTrack(track)) return;
      const payload = String(media?.payload ?? "");
      if (payload) {
        twilioMediaIn += 1;
        forwardInbound(payload);
      }
      return;
    }

    if (event === "stop") {
      void appendDebugLog(supabase, sessionId, "info", "twilio.stream.closed", {
        media_in_count: twilioMediaIn,
        media_out_count: twilioMediaOut,
      });
      persistStreamUsage();
      upstream?.close();
    }
  });

  socket.on("close", () => {
    if (!sessionId) return;
    if (noTranscriptTimer) clearTimeout(noTranscriptTimer);
    upstream?.close();
    persistStreamUsage();
    void updateSession(supabase, sessionId, { status: "completed" });
    void appendDebugLog(supabase, sessionId, "info", "call.completed", {});
  });

  return { sessionId };
}
