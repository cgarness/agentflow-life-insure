import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appendDebugLog,
  appendTranscript,
  loadSession,
  sessionAgentInstructions,
  updateSession,
} from "../_shared/aiTestingSession.ts";

const FN = "[ai-testing-stream-ws]";

type StreamMode = "xai" | "openai";

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key);
}

type UpstreamConfig = {
  voice: string;
  temperature: number;
  interruption: "low" | "medium" | "high";
};

function vadFromInterruption(level: UpstreamConfig["interruption"]) {
  switch (level) {
    case "low": return { type: "server_vad", threshold: 0.7, silence_duration_ms: 800 };
    case "high": return { type: "server_vad", threshold: 0.3, silence_duration_ms: 200 };
    case "medium":
    default: return { type: "server_vad" };
  }
}

function connectUpstream(mode: StreamMode, instructions: string, cfg: UpstreamConfig): WebSocket {
  if (mode === "xai") {
    const apiKey = Deno.env.get("XAI_API_KEY") ?? "";
    const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          voice: cfg.voice || "eve",
          instructions,
          temperature: cfg.temperature,
          turn_detection: vadFromInterruption(cfg.interruption),
          audio: {
            input: { format: { type: "audio/pcmu" } },
            output: { format: { type: "audio/pcmu" } },
          },
        },
      }));
    });
    return ws;
  }

  // OpenAI Realtime GA (gpt-realtime-2 era). Beta shapes are gone:
  //  - drop the deprecated "openai-beta.realtime-v1" subprotocol;
  //  - audio config is nested under session.audio.input/output;
  //  - "modalities" -> "output_modalities"; mu-law is { type: "audio/pcmu" }.
  // Deno's WebSocket can't set an Authorization header, so the API key rides
  // the still-supported "openai-insecure-api-key.<key>" subprotocol.
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const model = Deno.env.get("OPENAI_REALTIME_MODEL") ?? "gpt-realtime-2";
  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    ["realtime", `openai-insecure-api-key.${apiKey}`],
  );
  ws.addEventListener("open", () => {
    // GA session.update — keep audio mu-law 8k in BOTH directions (Twilio Media
    // Streams uses g711 mu-law / audio/pcmu). Temperature is intentionally NOT
    // sent: GA gpt-realtime rejects a session-level temperature and that would
    // fail session.update, leaving the call silent. input.transcription enables
    // the conversation.item.input_audio_transcription.completed user-side events.
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            turn_detection: vadFromInterruption(cfg.interruption),
            transcription: { model: "whisper-1" },
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: cfg.voice || "alloy",
          },
        },
      },
    }));
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

    const onMessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
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
      upstream.removeEventListener("open", onOpen);
      upstream.removeEventListener("message", onMessage);
      upstream.removeEventListener("error", onError);
      upstream.removeEventListener("close", onClose);
    };

    upstream.addEventListener("open", onOpen);
    upstream.addEventListener("message", onMessage);
    upstream.addEventListener("error", onError);
    upstream.addEventListener("close", onClose);

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

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
  const modeParam = (url.searchParams.get("mode") ?? "xai").trim();
  const mode: StreamMode = modeParam === "openai" ? "openai" : "xai";

  console.log(
    `${FN} upgrade requested url=${req.url} session=${sessionId} mode=${mode} upgrade=${req.headers.get("upgrade")} xfHost=${req.headers.get("x-forwarded-host")} xfProto=${req.headers.get("x-forwarded-proto")}`,
  );

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }
  if (!sessionId) {
    return new Response("sessionId required", { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const session = await loadSession(supabase, sessionId);
  if (!session || (session.stack !== "xai_s2s" && session.stack !== "openai_realtime")) {
    await appendDebugLog(supabase, sessionId, "error", "stream_ws.session_invalid", {
      found: Boolean(session),
      stack: session?.stack,
      mode,
    });
    return new Response("Invalid session", { status: 400 });
  }

  await appendDebugLog(supabase, sessionId, "info", "stream_ws.upgrade", {
    mode,
    xForwardedHost: req.headers.get("x-forwarded-host"),
    xForwardedProto: req.headers.get("x-forwarded-proto"),
    host: req.headers.get("host"),
  });

  if (mode === "xai" && !Deno.env.get("XAI_API_KEY")) {
    return new Response("XAI_API_KEY missing", { status: 500 });
  }
  if (mode === "openai" && !Deno.env.get("OPENAI_API_KEY")) {
    return new Response("OPENAI_API_KEY missing", { status: 500 });
  }

  const instructions = sessionAgentInstructions(session);
  const upstreamCfg: UpstreamConfig = {
    voice: session.voice_id ?? "",
    temperature: typeof session.temperature === "number" ? session.temperature : 0.7,
    interruption: (session.interruption_sensitivity as UpstreamConfig["interruption"]) ?? "medium",
  };
  const { socket, response } = Deno.upgradeWebSocket(req);

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

  const forwardAudioToTwilio = (payload: string) => {
    if (!streamSid || !payload) return;
    socket.send(JSON.stringify({
      event: "media",
      streamSid,
      media: { payload },
    }));
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
    if (greetingFired || mode !== "openai" || !streamSid || !upstream || upstream.readyState !== WebSocket.OPEN) {
      return;
    }
    greetingFired = true;
    upstream.send(JSON.stringify({
      type: "response.create",
      response: {
        instructions: "You just answered the call. Greet the caller briefly in English using the configured voice.",
      },
    }));
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.greeting_fired", { mode });
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
    console.log(`${FN} bridge ready mode=${mode} session=${sessionId}`);
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

  socket.onopen = async () => {
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_socket_open");
    try {
      await updateSession(supabase, sessionId, { status: "in-progress" });
      upstream = connectUpstream(mode, instructions, upstreamCfg);
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.upstream_connecting", {
        mode, voice: upstreamCfg.voice, temperature: upstreamCfg.temperature,
        interruption: upstreamCfg.interruption,
      });
      await waitForUpstreamReady(upstream);
      void appendDebugLog(supabase, sessionId, "info", "stream_ws.upstream_ready", { mode });

      upstream.onmessage = async (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(msg.type ?? "");
        upstreamMsgCount += 1;
        if (upstreamMsgCount <= 12 || type === "error") {
          void appendDebugLog(supabase, sessionId, type === "error" ? "error" : "info", "stream_ws.upstream_msg", {
            type,
            n: upstreamMsgCount,
            preview: type === "error" ? msg : undefined,
          });
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
          if (streamSid) socket.send(JSON.stringify({ event: "clear", streamSid }));
        }

        if (type === "error") {
          console.error(`${FN} upstream error:`, JSON.stringify(msg).slice(0, 400));
        }
      };

      upstream.onerror = (e) => {
        void appendDebugLog(supabase, sessionId, "error", "stream_ws.upstream_error", {
          message: (e as ErrorEvent)?.message,
        });
        console.error(`${FN} upstream error:`, e);
      };
      upstream.onclose = (ev) => {
        void appendDebugLog(supabase, sessionId, "warn", "stream_ws.upstream_close", {
          code: ev.code,
          reason: ev.reason,
          wasClean: ev.wasClean,
          mode,
          upstreamMsgCount,
        });
        console.log(`${FN} upstream closed code=${ev.code} reason=${ev.reason} session=${sessionId}`);
        try {
          socket.close(1011, "upstream closed");
        } catch {
          // ignore
        }
      };

      // Initial OpenAI greeting is fired inside markBridgeReady() once streamSid
      // is known — sending it earlier dropped audio because outbound media frames
      // require streamSid to be set.
      markBridgeReady();
    } catch (err) {
      void appendDebugLog(supabase, sessionId, "error", "stream_ws.bridge_setup_failed", err);
      console.error(`${FN} bridge setup failed:`, err);
      socket.close(1011, "bridge setup failed");
    }
  };

  socket.onmessage = (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
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
  };

  socket.onerror = (e) => {
    void appendDebugLog(supabase, sessionId, "error", "stream_ws.twilio_socket_error", {
      message: (e as ErrorEvent)?.message,
    });
  };
  socket.onclose = (ev) => {
    void appendDebugLog(supabase, sessionId, "info", "stream_ws.twilio_socket_close", {
      code: ev.code,
      reason: ev.reason,
      wasClean: ev.wasClean,
      mediaIn: twilioMediaIn,
      mediaOut: twilioMediaOut,
      firstMediaInAt,
      firstMediaOutAt,
      streamSid,
    });
    upstream?.close();
    console.log(`${FN} twilio closed session=${sessionId} code=${ev.code} reason=${ev.reason}`);
  };

  return response;
});
