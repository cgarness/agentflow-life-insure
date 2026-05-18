import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appendTranscript,
  loadSession,
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

Deno.serve((req) => {
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

  const { socket, response } = Deno.upgradeWebSocket(req);
  const supabase = getSupabase();

  let upstream: WebSocket | null = null;
  let streamSid = "";
  let instructions = "You are a helpful assistant on a phone call. Be concise and natural.";
  let upstreamReady = false;

  const forwardAudioToTwilio = (payload: string) => {
    if (!streamSid || !payload) return;
    socket.send(JSON.stringify({
      event: "media",
      streamSid,
      media: { payload },
    }));
  };

  socket.onopen = async () => {
    if (!supabase) {
      socket.close(1011, "Server misconfigured");
      return;
    }
    const session = await loadSession(supabase, sessionId);
    if (!session || (session.stack !== "xai_s2s" && session.stack !== "openai_realtime")) {
      socket.close(1008, "Invalid session");
      return;
    }
    instructions = session.prompt;
    await updateSession(supabase, sessionId, { status: "in-progress" });

    if (mode === "xai" && !Deno.env.get("XAI_API_KEY")) {
      socket.close(1011, "XAI_API_KEY missing");
      return;
    }
    if (mode === "openai" && !Deno.env.get("OPENAI_API_KEY")) {
      socket.close(1011, "OPENAI_API_KEY missing");
      return;
    }

    upstream = connectUpstream(mode, instructions);

    upstream.onmessage = async (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const type = String(msg.type ?? "");

      if (mode === "xai") {
        if (type === "response.output_audio.delta") {
          const delta = String(msg.delta ?? "");
          forwardAudioToTwilio(delta);
        }
        if (type === "response.output_audio_transcript.delta") {
          const delta = String(msg.delta ?? "");
          if (delta && supabase) {
            await appendTranscript(supabase, sessionId, {
              role: "assistant",
              text: delta,
              at: new Date().toISOString(),
            });
          }
        }
        if (type === "conversation.item.input_audio_transcription.completed") {
          const text = String(msg.transcript ?? "").trim();
          if (text && supabase) {
            await appendTranscript(supabase, sessionId, {
              role: "user",
              text,
              at: new Date().toISOString(),
            });
          }
        }
        if (type === "session.updated") upstreamReady = true;
      } else {
        if (type === "response.audio.delta") {
          const delta = String(msg.delta ?? "");
          forwardAudioToTwilio(delta);
        }
        if (type === "response.audio_transcript.delta") {
          const delta = String(msg.delta ?? "");
          if (delta && supabase) {
            await appendTranscript(supabase, sessionId, {
              role: "assistant",
              text: delta,
              at: new Date().toISOString(),
            });
          }
        }
        if (type === "conversation.item.input_audio_transcription.completed") {
          const text = String(
            (msg as Record<string, unknown>).transcript ?? "",
          ).trim();
          if (text && supabase) {
            await appendTranscript(supabase, sessionId, {
              role: "user",
              text,
              at: new Date().toISOString(),
            });
          }
        }
        if (type === "session.updated") upstreamReady = true;
      }
    };

    upstream.onerror = (e) => console.error(`${FN} upstream error:`, e);
    upstream.onclose = () => console.log(`${FN} upstream closed session=${sessionId}`);

    console.log(`${FN} twilio stream connected mode=${mode} session=${sessionId}`);
  };

  socket.onmessage = (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    const event = String(msg.event ?? "");
    if (event === "start") {
      const start = msg.start as Record<string, unknown> | undefined;
      streamSid = String(start?.streamSid ?? msg.streamSid ?? "");
      return;
    }

    if (event === "media" && upstream && upstream.readyState === WebSocket.OPEN) {
      const media = msg.media as Record<string, unknown> | undefined;
      const payload = String(media?.payload ?? "");
      if (!payload) return;

      if (mode === "xai") {
        upstream.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: payload,
        }));
      } else if (upstreamReady) {
        upstream.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: payload,
        }));
      }
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
