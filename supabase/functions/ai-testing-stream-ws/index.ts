import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
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

function connectUpstream(mode: StreamMode, instructions: string): WebSocket {
  if (mode === "xai") {
    const apiKey = Deno.env.get("XAI_API_KEY") ?? "";
    const ws = new WebSocket("wss://api.x.ai/v1/realtime?model=grok-voice-latest", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          voice: "eve",
          instructions,
          turn_detection: { type: "server_vad" },
          audio: {
            input: { format: { type: "audio/pcmu" } },
            output: { format: { type: "audio/pcmu" } },
          },
        },
      }));
    });
    return ws;
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const model = Deno.env.get("OPENAI_REALTIME_MODEL") ??
    "gpt-4o-realtime-preview-2024-12-17";
  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    ["realtime", `openai-insecure-api-key.${apiKey}`, "openai-beta.realtime-v1"],
  );
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions,
        voice: "alloy",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: { type: "server_vad" },
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
    return new Response("Invalid session", { status: 400 });
  }

  if (mode === "xai" && !Deno.env.get("XAI_API_KEY")) {
    return new Response("XAI_API_KEY missing", { status: 500 });
  }
  if (mode === "openai" && !Deno.env.get("OPENAI_API_KEY")) {
    return new Response("OPENAI_API_KEY missing", { status: 500 });
  }

  const instructions = sessionAgentInstructions(session);
  const { socket, response } = Deno.upgradeWebSocket(req);

  let upstream: WebSocket | null = null;
  let streamSid = "";
  let bridgeReady = false;
  const pendingMedia: string[] = [];

  const forwardAudioToTwilio = (payload: string) => {
    if (!streamSid || !payload) return;
    socket.send(JSON.stringify({
      event: "media",
      streamSid,
      media: { payload },
    }));
  };

  const markBridgeReady = () => {
    if (bridgeReady || !streamSid || !upstream || upstream.readyState !== WebSocket.OPEN) {
      return;
    }
    bridgeReady = true;
    for (const payload of pendingMedia.splice(0)) {
      upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: payload }));
    }
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
    try {
      await updateSession(supabase, sessionId, { status: "in-progress" });
      upstream = connectUpstream(mode, instructions);
      await waitForUpstreamReady(upstream);

      upstream.onmessage = async (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(msg.type ?? "");

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

      upstream.onerror = (e) => console.error(`${FN} upstream error:`, e);
      upstream.onclose = (ev) => {
        console.log(`${FN} upstream closed code=${ev.code} session=${sessionId}`);
        try {
          socket.close(1011, "upstream closed");
        } catch {
          // ignore
        }
      };

      if (mode === "openai") {
        upstream.send(JSON.stringify({
          type: "response.create",
          response: {
            instructions: "You just answered the call. Greet the caller briefly in English.",
          },
        }));
      }

      markBridgeReady();
    } catch (err) {
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
    if (event === "connected") return;

    if (event === "start") {
      const start = msg.start as Record<string, unknown> | undefined;
      streamSid = String(start?.streamSid ?? msg.streamSid ?? "");
      markBridgeReady();
      return;
    }

    if (event === "media") {
      const media = msg.media as Record<string, unknown> | undefined;
      appendCallerAudio(String(media?.payload ?? ""));
      return;
    }

    if (event === "stop") {
      upstream?.close();
    }
  };

  socket.onclose = () => {
    upstream?.close();
    console.log(`${FN} twilio closed session=${sessionId}`);
  };

  return response;
});
