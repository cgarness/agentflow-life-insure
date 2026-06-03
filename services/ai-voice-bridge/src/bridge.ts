import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { sessionBridgeTokenValid } from "./auth.js";
import type { Env } from "./config.js";
import { welcomeGreetingFromLead } from "./prompt.js";
import {
  appendDebugLog,
  appendTranscript,
  loadSession,
  sessionAgentInstructions,
  updateSession,
  type AiTestSessionRow,
  type InterruptionSensitivity,
} from "./session.js";

type UpstreamConfig = {
  voice: string;
  temperature: number;
  interruption: InterruptionSensitivity;
  speed: number;
};

function vadFromInterruption(level: InterruptionSensitivity) {
  const base = {
    type: "server_vad" as const,
    prefix_padding_ms: 300,
    create_response: true,
    interrupt_response: true,
  };
  switch (level) {
    case "low":
      return { ...base, threshold: 0.7, silence_duration_ms: 800 };
    case "high":
      return { ...base, threshold: 0.3, silence_duration_ms: 200 };
    case "medium":
    default:
      return { ...base, threshold: 0.5, silence_duration_ms: 500 };
  }
}

function clampRealtimeTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1.2, Math.max(0.6, value));
}

/** GA telephony audio — matches buildSipAcceptPayload in openaiRealtimeSip.ts (G.711 µ-law 8 kHz). */
function buildRealtimeAudioConfig(voice: string, interruption: InterruptionSensitivity) {
  return {
    input: {
      format: { type: "audio/pcmu" as const },
      turn_detection: vadFromInterruption(interruption),
    },
    output: {
      format: { type: "audio/pcmu" as const },
      voice: voice || "alloy",
    },
  };
}

function connectOpenAiUpstream(
  env: Env,
  instructions: string,
  cfg: UpstreamConfig,
): WebSocket {
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(env.OPENAI_REALTIME_MODEL)}`;
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          output_modalities: ["audio"],
          instructions,
          audio: buildRealtimeAudioConfig(cfg.voice, cfg.interruption),
        },
      }),
    );
  });

  return ws;
}

function waitForUpstreamReady(upstream: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Upstream realtime session timed out"));
    }, 12_000);

    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        const type = String(msg.type ?? "");
        if (type === "error") {
          cleanup();
          const errObj = msg.error as Record<string, unknown> | undefined;
          reject(
            new Error(
              String(errObj?.message ?? msg.message ?? "Upstream session.update error"),
            ),
          );
          return;
        }
        if (type === "session.updated") {
          const sessionObj = msg.session as Record<string, unknown> | undefined;
          const audio = sessionObj?.audio as Record<string, unknown> | undefined;
          const outFmt = (audio?.output as Record<string, unknown> | undefined)?.format;
          const inFmt = (audio?.input as Record<string, unknown> | undefined)?.format;
          const turnDetection = (audio?.input as Record<string, unknown> | undefined)
            ?.turn_detection;
          console.log("[ai-voice-bridge] session.updated", { inFmt, outFmt, turnDetection });
          cleanup();
          resolve();
        }
      } catch {
        // ignore
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error("Upstream WebSocket error"));
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Upstream WebSocket closed before ready"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      upstream.off("open", onOpen);
      upstream.off("message", onMessage);
      upstream.off("error", onError);
      upstream.off("close", onClose);
    };

    const onOpen = () => {
      // session.update is sent from connectOpenAiUpstream on open.
    };

    upstream.on("open", onOpen);
    upstream.on("message", onMessage);
    upstream.on("error", onError);
    upstream.on("close", onClose);

    if (upstream.readyState === WebSocket.OPEN) onOpen();
  });
}

/** Base64 µ-law chunk from response.output_audio.delta — passthrough as-is to Twilio. */
function outputAudioPayload(msg: Record<string, unknown>): string {
  if (typeof msg.delta === "string") return msg.delta;
  return "";
}

function isOutputAudioEvent(type: string): boolean {
  // GA telephony: only output_audio.delta (legacy response.audio.delta is PCM 24kHz).
  return type === "response.output_audio.delta";
}

function greetingInstruction(session: AiTestSessionRow): string {
  const greetingLine = welcomeGreetingFromLead(session.lead_context);
  return greetingLine && greetingLine.trim().length > 0
    ? `The call just connected. Open by saying this greeting naturally in English: "${greetingLine}" Then continue following your system instructions.`
    : "The call just connected. Greet the other person briefly in English, then continue following your system instructions.";
}

function paramFromCustom(
  customParameters: Record<string, unknown>,
  key: string,
): string {
  return String(customParameters[key] ?? "").trim();
}

export type TwilioQueryFallback = {
  sessionId?: string;
};

export type BridgeHandle = {
  sessionId: string;
};

/**
 * Port of ai-testing-stream-ws openai mode (live v20) for Render-hosted WebSockets.
 * Session id + secret are resolved from Twilio's start.customParameters (URL query fallback).
 */
export function attachTwilioBridge(
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
  let firstMediaInAt = "";
  let firstMediaOutAt = "";
  let upstreamMsgCount = 0;
  let session: AiTestSessionRow | null = null;
  let closedCleanly = false;
  let pendingFirstMediaInLog: { at: string; payloadLength: number; track: string } | null = null;
  let aiResponseActive = false;

  const isCallerMediaTrack = (track: string): boolean => {
    const t = track.trim().toLowerCase();
    if (!t || t === "inbound" || t === "inbound_track") return true;
    return t !== "outbound" && t !== "outbound_track";
  };

  const logFirstMediaIn = (payloadLength: number, track: string) => {
    if (firstMediaInAt || !payloadLength) return;
    firstMediaInAt = new Date().toISOString();
    const entry = {
      at: firstMediaInAt,
      payloadLength,
      streamSid,
      track,
      upstreamReady,
    };
    if (!sessionId) {
      pendingFirstMediaInLog = { at: firstMediaInAt, payloadLength, track };
      return;
    }
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.first_media_in", entry);
  };

  const flushPendingFirstMediaInLog = () => {
    if (!sessionId || !pendingFirstMediaInLog) return;
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.first_media_in", {
      at: pendingFirstMediaInLog.at,
      payloadLength: pendingFirstMediaInLog.payloadLength,
      streamSid,
      track: pendingFirstMediaInLog.track,
      upstreamReady,
      bufferedBeforeSession: true,
    });
    pendingFirstMediaInLog = null;
  };

  /** Base64 µ-law from Twilio → OpenAI input buffer (no re-encode). Requires upstream_ready. */
  const forwardInboundToOpenAi = (payload: string) => {
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

  const handleTwilioInboundMedia = (payload: string, track: string) => {
    if (!payload) return;
    twilioMediaIn += 1;
    logFirstMediaIn(payload.length, track);
    forwardInboundToOpenAi(payload);
  };

  const forwardAudioToTwilio = (payload: string) => {
    if (!streamSid || !payload || socket.readyState !== WebSocket.OPEN) return;
    // OpenAI base64 µ-law → Twilio media payload unchanged (no decode/re-encode).
    socket.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload },
      }),
    );
    twilioMediaOut += 1;
    if (!firstMediaOutAt) {
      firstMediaOutAt = new Date().toISOString();
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.first_media_out", {
        at: firstMediaOutAt,
        payloadLength: payload.length,
        streamSid,
      });
    }
  };

  const fireInitialGreetingIfReady = () => {
    if (
      greetingFired ||
      !session ||
      !streamSid ||
      !upstream ||
      upstream.readyState !== WebSocket.OPEN
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
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.greeting_fired", { mode: "openai" });
  };

  const tryFireGreeting = () => {
    if (
      greetingFired ||
      !session ||
      !streamSid ||
      !upstreamReady ||
      !upstream ||
      upstream.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    fireInitialGreetingIfReady();
  };

  const onUpstreamReady = () => {
    upstreamReady = true;
    flushInboundPending();
    tryFireGreeting();
    console.log(`[ai-voice-bridge] upstream ready session=${sessionId} inbound_pending=${inboundPending.length}`);
  };

  const finishSession = async (status: "completed" | "failed", errorMessage?: string) => {
    if (!sessionId) return;
    const patch: Record<string, unknown> = { status };
    if (errorMessage) patch.error_message = errorMessage;
    await updateSession(supabase, sessionId, patch);
  };

  const rejectAtStart = (reason: string) => {
    console.warn(`[ai-voice-bridge] ${reason}`);
    try {
      socket.close(1011, reason.slice(0, 120));
    } catch {
      // ignore
    }
  };

  const beginBridge = async () => {
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_socket_open");

    session = await loadSession(supabase, sessionId);
    if (!session || session.stack !== "openai_realtime") {
      await appendDebugLog(supabase, sessionId, "error", "stream_ws.session_invalid", {
        found: Boolean(session),
        stack: session?.stack,
        mode: "openai",
      });
      socket.close(1011, "invalid session");
      return;
    }

    await appendDebugLog(supabase, sessionId, "info", "stream_ws.upgrade", {
      mode: "openai",
      stack: session.stack,
      host: "render",
    });

    const instructions = sessionAgentInstructions(session);
    const upstreamCfg: UpstreamConfig = {
      voice: session.voice_id ?? "",
      temperature: typeof session.temperature === "number" ? session.temperature : 0.8,
      interruption: session.interruption_sensitivity ?? "medium",
      speed:
        typeof session.speaking_rate === "number" && session.speaking_rate > 0
          ? session.speaking_rate
          : 1.0,
    };

    try {
      await updateSession(supabase, sessionId, { status: "in-progress" });
      upstream = connectOpenAiUpstream(env, instructions, upstreamCfg);
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.upstream_connecting", {
        mode: "openai",
        voice: upstreamCfg.voice,
        temperature: upstreamCfg.temperature,
        interruption: upstreamCfg.interruption,
      });
      await waitForUpstreamReady(upstream);
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.upstream_ready", { mode: "openai" });
      onUpstreamReady();

      upstream.on("message", async (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(msg.type ?? "");
        upstreamMsgCount += 1;
        if (upstreamMsgCount <= 12 || type === "error") {
          void appendDebugLog(
            supabase,
            sessionId,
            type === "error" ? "error" : "info",
            "stream_ws.upstream_msg",
            {
              type,
              n: upstreamMsgCount,
              preview: type === "error" ? msg : undefined,
            },
          );
        }

        if (type === "response.created") {
          aiResponseActive = true;
        }
        if (type === "response.done" || type === "response.completed") {
          aiResponseActive = false;
        }

        if (isOutputAudioEvent(type)) {
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

        if (type === "conversation.item.input_audio_transcription.completed") {
          const text = String(msg.transcript ?? "").trim();
          if (text) {
            await appendTranscript(supabase, sessionId, {
              role: "user",
              text,
              at: new Date().toISOString(),
            });
          }
        }

        if (type === "input_audio_buffer.speech_started") {
          void appendDebugLog(supabase, sessionId, "info", "stream_ws.speech_started", {
            aiResponseActive,
          });
          // Barge-in: stop AI playback on the phone only — do NOT clear OpenAI input buffer
          // (clearing input wipes the caller utterance that triggered speech_started).
          if (streamSid && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: "clear", streamSid }));
          }
        }

        if (type === "input_audio_buffer.speech_stopped") {
          void appendDebugLog(supabase, sessionId, "info", "stream_ws.speech_stopped", {});
        }

        if (type === "error") {
          console.error("[ai-voice-bridge] upstream error:", JSON.stringify(msg).slice(0, 400));
        }
      });

      upstream.on("error", (err) => {
        void appendDebugLog(supabase, sessionId, "error", "stream_ws.upstream_error", {
          message: err.message,
        });
      });

      upstream.on("close", (code, reason) => {
        void appendDebugLog(supabase, sessionId, "warn", "stream_ws.upstream_close", {
          code,
          reason: reason.toString(),
          mode: "openai",
          upstreamMsgCount,
        });
        try {
          socket.close(1011, "upstream closed");
        } catch {
          // ignore
        }
      });

      tryFireGreeting();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void appendDebugLog(supabase, sessionId, "error", "stream_ws.bridge_setup_failed", err);
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

    const event = String(msg.event ?? "");
    if (event === "connected") {
      if (sessionId) {
        void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_connected", msg);
      }
      return;
    }

    if (event === "start") {
      const start = msg.start as Record<string, unknown> | undefined;
      const customParameters = (start?.customParameters ?? {}) as Record<string, unknown>;
      const resolvedSessionId =
        paramFromCustom(customParameters, "sessionId") || (queryFallback.sessionId ?? "");
      const bridgeToken = paramFromCustom(customParameters, "bridgeToken");

      if (!resolvedSessionId) {
        rejectAtStart("start rejected: missing sessionId (customParameters and query empty)");
        return;
      }

      void (async () => {
        const valid = await sessionBridgeTokenValid(supabase, resolvedSessionId, bridgeToken);
        if (!valid) {
          rejectAtStart(`start rejected: invalid bridge token session=${resolvedSessionId}`);
          return;
        }

        sessionId = resolvedSessionId;
        streamSid = String(start?.streamSid ?? msg.streamSid ?? "");
        flushPendingFirstMediaInLog();
        void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_start", {
          streamSid,
          mediaFormat: start?.mediaFormat,
          callSid: start?.callSid,
          customParameters: start?.customParameters,
          tracks: start?.tracks,
        });

        if (!bridgeStarted) {
          bridgeStarted = true;
          await beginBridge();
        }
        tryFireGreeting();
      })();
      return;
    }

    if (event === "media") {
      const media = msg.media as Record<string, unknown> | undefined;
      const track = String(media?.track ?? "inbound");
      if (!isCallerMediaTrack(track)) return;
      const payload = String(media?.payload ?? "");
      handleTwilioInboundMedia(payload, track);
      return;
    }

    if (!bridgeStarted) return;

    if (event === "stop") {
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_stop", {
        mediaIn: twilioMediaIn,
        media_in_count: twilioMediaIn,
        mediaOut: twilioMediaOut,
      });
      upstream?.close();
    }
  });

  socket.on("error", (err) => {
    if (!sessionId) return;
    void appendDebugLog(supabase, sessionId, "error", "stream_ws.twilio_socket_error", {
      message: err.message,
    });
  });

  socket.on("close", (code, reason) => {
    if (!sessionId) {
      console.log(`[ai-voice-bridge] twilio closed before start code=${code}`);
      return;
    }
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_socket_close", {
      code,
      reason: reason.toString(),
      mediaIn: twilioMediaIn,
      media_in_count: twilioMediaIn,
      mediaOut: twilioMediaOut,
      firstMediaInAt,
      firstMediaOutAt,
      streamSid,
      upstreamReady,
    });
    upstream?.close();
    closedCleanly = code === 1000 || code === 1005;
    void finishSession(closedCleanly ? "completed" : "failed");
    console.log(`[ai-voice-bridge] twilio closed session=${sessionId} code=${code}`);
  });

  return { sessionId };
}
