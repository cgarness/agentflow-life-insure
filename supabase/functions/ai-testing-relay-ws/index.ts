import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appendDebugLog,
  appendTranscript,
  loadSession,
  sessionAgentInstructions,
  updateSession,
} from "../_shared/aiTestingSession.ts";

const FN = "[ai-testing-relay-ws]";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function* streamOpenAIText(
  messages: ChatMessage[],
  apiKey: string,
  temperature: number,
): AsyncGenerator<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      stream: true,
      max_tokens: 400,
      temperature,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // skip malformed SSE chunk
      }
    }
  }
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();

  console.log(
    `${FN} upgrade requested url=${req.url} session=${sessionId} upgrade=${req.headers.get("upgrade")} xfHost=${req.headers.get("x-forwarded-host")} xfProto=${req.headers.get("x-forwarded-proto")}`,
  );

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }
  if (!sessionId) {
    return new Response("sessionId required", { status: 400 });
  }

  const supabase = getSupabase();
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!supabase || !openaiKey) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const session = await loadSession(supabase, sessionId);
  if (!session || session.stack !== "twilio_cr") {
    await appendDebugLog(supabase, sessionId, "error", "relay_ws.session_invalid", {
      found: Boolean(session),
      stack: session?.stack,
    });
    return new Response("Invalid session", { status: 400 });
  }

  await appendDebugLog(supabase, sessionId, "info", "relay_ws.upgrade", {
    xForwardedHost: req.headers.get("x-forwarded-host"),
    xForwardedProto: req.headers.get("x-forwarded-proto"),
    host: req.headers.get("host"),
  });

  const systemPrompt = sessionAgentInstructions(session);
  const history: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  const temperature = typeof session.temperature === "number" ? session.temperature : 0.7;
  let processing = false;
  let promptCount = 0;
  let tokenSendCount = 0;

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    void updateSession(supabase, sessionId, { status: "in-progress" });
    void appendDebugLog(supabase, sessionId, "info", "relay_ws.socket_open");
    console.log(`${FN} connected session=${sessionId}`);
  };

  socket.onmessage = async (ev) => {
    if (processing) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(String(ev.data));
    } catch {
      void appendDebugLog(supabase, sessionId, "warn", "relay_ws.parse_failed", {
        preview: String(ev.data).slice(0, 200),
      });
      return;
    }

    const type = String(event.type ?? "");

    if (type === "setup") {
      void appendDebugLog(supabase, sessionId, "info", "relay_ws.setup", event);
      console.log(`${FN} setup session=${sessionId}`);
      return;
    }

    if (type === "interrupt") {
      void appendDebugLog(supabase, sessionId, "info", "relay_ws.interrupt", event);
      console.log(`${FN} interrupt session=${sessionId}`);
      return;
    }

    if (type === "error") {
      void appendDebugLog(supabase, sessionId, "error", "relay_ws.relay_error", event);
      console.error(`${FN} relay error:`, event.description);
      return;
    }

    if (type !== "prompt") {
      void appendDebugLog(supabase, sessionId, "info", "relay_ws.event_other", { type });
      return;
    }

    const voicePrompt = String(event.voicePrompt ?? "").trim();
    const isLast = event.last !== false;
    if (!voicePrompt || !isLast) return;

    processing = true;
    promptCount += 1;
    const promptIdx = promptCount;
    void appendDebugLog(supabase, sessionId, "info", "relay_ws.prompt_received", {
      promptIdx,
      voicePromptLength: voicePrompt.length,
      voicePromptPreview: voicePrompt.slice(0, 200),
    });
    try {
      await appendTranscript(supabase, sessionId, {
        role: "user",
        text: voicePrompt,
        at: new Date().toISOString(),
      });

      history.push({ role: "user", content: voicePrompt });
      const messages = [...history];

      let fullReply = "";
      let chunkCount = 0;
      for await (const chunk of streamOpenAIText(messages, openaiKey, temperature)) {
        fullReply += chunk;
        chunkCount += 1;
        tokenSendCount += 1;
        socket.send(JSON.stringify({
          type: "text",
          token: chunk,
          last: false,
          interruptible: true,
        }));
      }
      socket.send(JSON.stringify({
        type: "text",
        token: "",
        last: true,
        interruptible: true,
      }));
      void appendDebugLog(supabase, sessionId, "info", "relay_ws.reply_sent", {
        promptIdx,
        chunkCount,
        totalTokensSent: tokenSendCount,
        replyLength: fullReply.length,
        replyPreview: fullReply.slice(0, 200),
      });

      if (fullReply.trim()) {
        history.push({ role: "assistant", content: fullReply.trim() });
        await appendTranscript(supabase, sessionId, {
          role: "assistant",
          text: fullReply.trim(),
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      void appendDebugLog(supabase, sessionId, "error", "relay_ws.llm_error", err);
      console.error(`${FN} LLM error:`, err);
      socket.send(JSON.stringify({
        type: "text",
        token: "Sorry, I missed that. Could you say that again?",
        last: true,
        interruptible: true,
      }));
    } finally {
      processing = false;
    }
  };

  socket.onerror = (e) => {
    void appendDebugLog(supabase, sessionId, "error", "relay_ws.socket_error", {
      message: (e as ErrorEvent)?.message,
    });
    console.error(`${FN} socket error:`, e);
  };
  socket.onclose = (ev) => {
    void appendDebugLog(supabase, sessionId, "info", "relay_ws.socket_close", {
      code: ev.code,
      reason: ev.reason,
      wasClean: ev.wasClean,
      promptCount,
      tokenSendCount,
    });
    console.log(`${FN} closed session=${sessionId} code=${ev.code} reason=${ev.reason}`);
  };

  return response;
});
