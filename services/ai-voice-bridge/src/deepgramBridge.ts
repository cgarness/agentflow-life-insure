import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { sessionBridgeTokenValid } from "./auth.js";
import type { Env } from "./config.js";
import { requireDeepgramKey } from "./config.js";
import {
  appendDebugLog,
  appendTranscript,
  loadSession,
  sessionAgentInstructions,
  updateSession,
  type AiTestSessionRow,
} from "./session.js";

const DEEPGRAM_AGENT_WS = "wss://agent.deepgram.com/v1/agent/converse";
const DEEPGRAM_GREETING = "Hi, this is Sarah. Can you hear me okay?";
const KEEPALIVE_MS = 5000;

function paramFromCustom(customParameters: Record<string, unknown>, key: string): string {
  return String(customParameters[key] ?? "").trim();
}

function isCallerMediaTrack(track: string): boolean {
  return track === "inbound" || track === "inbound_track";
}

function deepgramSpeakModel(session: AiTestSessionRow): string {
  const voice = session.voice_id?.trim();
  if (voice && voice.startsWith("aura-")) return voice;
  return "aura-2-thalia-en";
}

function buildDeepgramSettings(session: AiTestSessionRow): Record<string, unknown> {
  const temperature =
    typeof session.temperature === "number" && Number.isFinite(session.temperature)
      ? Math.min(1.2, Math.max(0, session.temperature))
      : 0.7;

  return {
    type: "Settings",
    audio: {
      input: { encoding: "mulaw", sample_rate: 8000 },
      output: { encoding: "mulaw", sample_rate: 8000, container: "none" },
    },
    agent: {
      language: "en",
      listen: {
        provider: {
          type: "deepgram",
          model: "flux-general-en",
          version: "v2",
        },
      },
      think: {
        provider: {
          type: "open_ai",
          model: "gpt-4o-mini",
          temperature,
        },
        prompt: sessionAgentInstructions(session),
      },
      speak: {
        provider: {
          type: "deepgram",
          model: deepgramSpeakModel(session),
        },
      },
      greeting: DEEPGRAM_GREETING,
    },
  };
}

export type TwilioQueryFallback = {
  sessionId?: string;
};

export function attachDeepgramBridge(
  socket: WebSocket,
  env: Env,
  supabase: SupabaseClient,
  queryFallback: TwilioQueryFallback,
): { sessionId: string } {
  let sessionId = "";
  let streamSid = "";
  let session: AiTestSessionRow | null = null;
  let deepgram: WebSocket | null = null;
  let bridgeStarted = false;
  let dgWelcomeReceived = false;
  let dgSettingsApplied = false;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let greetingLogged = false;
  let twilioMediaIn = 0;

  const clearKeepAlive = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
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

  const rejectAtStart = (reason: string) => {
    console.warn(`[ai-voice-bridge/deepgram] ${reason}`);
    try {
      socket.close(1011, reason.slice(0, 120));
    } catch {
      // ignore
    }
  };

  const startKeepAlive = () => {
    clearKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (!deepgram || deepgram.readyState !== WebSocket.OPEN || !dgSettingsApplied) return;
      try {
        deepgram.send(JSON.stringify({ type: "KeepAlive" }));
      } catch (err) {
        void appendDebugLog(supabase, sessionId, "warn", "deepgram.keepalive_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, KEEPALIVE_MS);
  };

  const forwardAudioToTwilio = (rawMulaw: Buffer) => {
    if (!streamSid || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: rawMulaw.toString("base64") },
      }),
    );
  };

  const connectDeepgram = () => {
    const apiKey = requireDeepgramKey(env);
    void appendDebugLog(supabase, sessionId, "info", "deepgram.ws.connecting", {});

    deepgram = new WebSocket(DEEPGRAM_AGENT_WS, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    deepgram.on("open", () => {
      void appendDebugLog(supabase, sessionId, "info", "deepgram.ws.connected", {});
    });

    deepgram.on("message", async (data) => {
      if (Buffer.isBuffer(data)) {
        forwardAudioToTwilio(data);
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type ?? "");

      if (type === "Welcome") {
        dgWelcomeReceived = true;
        void appendDebugLog(supabase, sessionId, "info", "deepgram.welcome_received", {
          request_id: msg.request_id,
        });
        if (deepgram?.readyState === WebSocket.OPEN) {
          deepgram.send(JSON.stringify(buildDeepgramSettings(session!)));
          void appendDebugLog(supabase, sessionId, "info", "deepgram.settings.sent", {});
        }
        return;
      }

      if (type === "SettingsApplied") {
        dgSettingsApplied = true;
        void appendDebugLog(supabase, sessionId, "info", "deepgram.agent.ready", {});
        if (!greetingLogged) {
          greetingLogged = true;
          void appendDebugLog(supabase, sessionId, "info", "deepgram.greeting_sent", {
            greeting: DEEPGRAM_GREETING,
          });
        }
        startKeepAlive();
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
        if (streamSid && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ event: "clear", streamSid }));
        }
        return;
      }

      if (type === "Error") {
        void appendDebugLog(supabase, sessionId, "error", "deepgram.error", msg);
      }
    });

    deepgram.on("error", (err) => {
      void appendDebugLog(supabase, sessionId, "error", "deepgram.ws.error", {
        message: err.message,
      });
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
      await appendDebugLog(supabase, sessionId, "error", "twilio.stream.session_invalid", {
        found: Boolean(session),
        stack: session?.stack,
      });
      socket.close(1011, "invalid session");
      return;
    }

    try {
      await updateSession(supabase, sessionId, { status: "in-progress" });
      connectDeepgram();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendDebugLog(supabase, sessionId, "error", "twilio.stream.bridge_setup_failed", {
        message,
      });
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
        void appendDebugLog(supabase, sessionId, "info", "twilio.stream.connected", {});
      }
      return;
    }

    if (event === "start") {
      const start = msg.start as Record<string, unknown> | undefined;
      const customParameters = (start?.customParameters ?? {}) as Record<string, unknown>;
      const resolvedSessionId =
        paramFromCustom(customParameters, "sessionId") || (queryFallback.sessionId ?? "");
      const token = paramFromCustom(customParameters, "bridgeToken");

      if (!resolvedSessionId) {
        rejectAtStart("start rejected: missing sessionId");
        return;
      }

      void (async () => {
        const valid = await sessionBridgeTokenValid(supabase, resolvedSessionId, token);
        if (!valid) {
          rejectAtStart(`start rejected: invalid bridge token session=${resolvedSessionId}`);
          return;
        }

        sessionId = resolvedSessionId;
        streamSid = String(start?.streamSid ?? msg.streamSid ?? "");
        void appendDebugLog(supabase, sessionId, "info", "twilio.stream.started", {
          streamSid,
          callSid: start?.callSid,
        });

        if (!bridgeStarted) {
          bridgeStarted = true;
          await beginBridge();
        }
      })();
      return;
    }

    if (event === "media") {
      const media = msg.media as Record<string, unknown> | undefined;
      const track = String(media?.track ?? "inbound");
      if (!isCallerMediaTrack(track)) return;
      const payload = String(media?.payload ?? "");
      if (!payload || !deepgram || deepgram.readyState !== WebSocket.OPEN || !dgSettingsApplied) {
        return;
      }
      try {
        const raw = Buffer.from(payload, "base64");
        deepgram.send(raw);
        twilioMediaIn += 1;
      } catch (err) {
        void appendDebugLog(supabase, sessionId, "error", "twilio.stream.media_forward_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (!bridgeStarted) return;

    if (event === "stop") {
      void appendDebugLog(supabase, sessionId, "info", "twilio.stream.stop", {
        media_in_count: twilioMediaIn,
      });
      deepgram?.close();
    }
  });

  socket.on("error", (err) => {
    if (!sessionId) return;
    void appendDebugLog(supabase, sessionId, "error", "twilio.stream.socket_error", {
      message: err.message,
    });
  });

  socket.on("close", (code, reason) => {
    clearKeepAlive();
    if (!sessionId) return;
    void appendDebugLog(supabase, sessionId, "info", "twilio.stream.closed", {
      code,
      reason: reason.toString(),
      media_in_count: twilioMediaIn,
      dgWelcomeReceived,
      dgSettingsApplied,
    });
    deepgram?.close();
    const ok = code === 1000 || code === 1005;
    void finishSession(ok ? "completed" : "failed", ok ? undefined : `twilio close code ${code}`);
  });

  return { sessionId };
}
