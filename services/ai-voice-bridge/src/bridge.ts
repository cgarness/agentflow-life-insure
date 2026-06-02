import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
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
  switch (level) {
    case "low":
      return { type: "server_vad", threshold: 0.7, silence_duration_ms: 800 };
    case "high":
      return { type: "server_vad", threshold: 0.3, silence_duration_ms: 200 };
    case "medium":
    default:
      return { type: "server_vad" };
  }
}

function clampRealtimeTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1.2, Math.max(0.6, value));
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
          temperature: clampRealtimeTemperature(cfg.temperature),
          audio: {
            input: {
              format: { type: "audio/pcmu" },
              turn_detection: vadFromInterruption(cfg.interruption),
              transcription: { model: "whisper-1" },
            },
            output: {
              format: { type: "audio/pcmu" },
              voice: cfg.voice || "alloy",
              speed: cfg.speed,
            },
          },
        },
      }),
    );
  });

  return ws;
}

function waitForUpstreamReady(upstream: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Upstream realtime session timed out"));
    }, 12_000);

    const onMessage = (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        const type = String(msg.type ?? "");
        if (type === "session.updated" || type === "session.created") {
          cleanup();
          resolve();
        }
        if (type === "error") {
          cleanup();
          reject(new Error(String(msg.error ?? msg.message ?? "Upstream error")));
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

    const onOpen = () => {
      fallbackTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, 1500);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      upstream.off("open", onOpen);
      upstream.off("message", onMessage);
      upstream.off("error", onError);
      upstream.off("close", onClose);
    };

    upstream.on("open", onOpen);
    upstream.on("message", onMessage);
    upstream.on("error", onError);
    upstream.on("close", onClose);

    if (upstream.readyState === WebSocket.OPEN) onOpen();
  });
}

function outputAudioPayload(msg: Record<string, unknown>): string {
  if (typeof msg.delta === "string") return msg.delta;
  const audio = msg.audio as Record<string, unknown> | undefined;
  if (typeof audio?.delta === "string") return audio.delta;
  return "";
}

function isOutputAudioEvent(type: string): boolean {
  return type === "response.output_audio.delta" || type === "response.audio.delta";
}

function greetingInstruction(session: AiTestSessionRow): string {
  const greetingLine = welcomeGreetingFromLead(session.lead_context);
  return greetingLine && greetingLine.trim().length > 0
    ? `The call just connected. Open by saying this greeting naturally in English: "${greetingLine}" Then continue following your system instructions.`
    : "The call just connected. Greet the other person briefly in English, then continue following your system instructions.";
}

export type BridgeHandle = {
  sessionId: string;
};

/**
 * Port of ai-testing-stream-ws openai mode (live v20) for Render-hosted WebSockets.
 */
export function attachTwilioBridge(
  socket: WebSocket,
  env: Env,
  supabase: SupabaseClient,
  sessionId: string,
): BridgeHandle {
  let upstream: WebSocket | null = null;
  let streamSid = "";
  let bridgeReady = false;
  let greetingFired = false;
  const pendingMedia: string[] = [];
  let twilioMediaIn = 0;
  let twilioMediaOut = 0;
  let firstMediaInAt = "";
  let firstMediaOutAt = "";
  let upstreamMsgCount = 0;
  let session: AiTestSessionRow | null = null;
  let closedCleanly = false;

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
    upstream.send(
      JSON.stringify({
        type: "response.create",
        response: { instructions: greetingInstruction(session) },
      }),
    );
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.greeting_fired", { mode: "openai" });
  };

  const markBridgeReady = () => {
    if (bridgeReady || !streamSid || !upstream || upstream.readyState !== WebSocket.OPEN) {
      return;
    }
    bridgeReady = true;
    for (const payload of pendingMedia.splice(0)) {
      upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
    }
    fireInitialGreetingIfReady();
    console.log(`[ai-voice-bridge] bridge ready session=${sessionId}`);
  };

  const appendCallerAudio = (payload: string) => {
    if (!payload) return;
    if (!bridgeReady) {
      pendingMedia.push(payload);
      markBridgeReady();
      return;
    }
    upstream?.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
  };

  const finishSession = async (status: "completed" | "failed", errorMessage?: string) => {
    const patch: Record<string, unknown> = { status };
    if (errorMessage) patch.error_message = errorMessage;
    await updateSession(supabase, sessionId, patch);
  };

  void (async () => {
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
          upstream?.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
          if (streamSid && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ event: "clear", streamSid }));
          }
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

      markBridgeReady();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void appendDebugLog(supabase, sessionId, "error", "stream_ws.bridge_setup_failed", err);
      await finishSession("failed", message);
      socket.close(1011, "bridge setup failed");
    }
  })();

  socket.on("message", (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }

    const event = String(msg.event ?? "");
    if (event === "connected") {
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_connected", msg);
      return;
    }

    if (event === "start") {
      const start = msg.start as Record<string, unknown> | undefined;
      streamSid = String(start?.streamSid ?? msg.streamSid ?? "");
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_start", {
        streamSid,
        mediaFormat: start?.mediaFormat,
        callSid: start?.callSid,
        customParameters: start?.customParameters,
      });
      markBridgeReady();
      return;
    }

    if (event === "media") {
      const media = msg.media as Record<string, unknown> | undefined;
      const payload = String(media?.payload ?? "");
      twilioMediaIn += 1;
      if (!firstMediaInAt && payload) {
        firstMediaInAt = new Date().toISOString();
        void appendDebugLog(supabase, sessionId, "info", "stream_ws.first_media_in", {
          at: firstMediaInAt,
          payloadLength: payload.length,
          streamSid,
          bridgeReady,
        });
      }
      appendCallerAudio(payload);
      return;
    }

    if (event === "stop") {
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_stop", {
        mediaIn: twilioMediaIn,
        mediaOut: twilioMediaOut,
      });
      upstream?.close();
    }
  });

  socket.on("error", (err) => {
    void appendDebugLog(supabase, sessionId, "error", "stream_ws.twilio_socket_error", {
      message: err.message,
    });
  });

  socket.on("close", (code, reason) => {
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_socket_close", {
      code,
      reason: reason.toString(),
      mediaIn: twilioMediaIn,
      mediaOut: twilioMediaOut,
      firstMediaInAt,
      firstMediaOutAt,
      streamSid,
    });
    upstream?.close();
    closedCleanly = code === 1000 || code === 1005;
    void finishSession(closedCleanly ? "completed" : "failed");
    console.log(`[ai-voice-bridge] twilio closed session=${sessionId} code=${code}`);
  });

  return { sessionId };
}
