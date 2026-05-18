import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
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
      temperature: 0.7,
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
    return new Response("Invalid session", { status: 400 });
  }

  const systemPrompt = sessionAgentInstructions(session);
  const history: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  let processing = false;

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    void updateSession(supabase, sessionId, { status: "in-progress" });
    console.log(`${FN} connected session=${sessionId}`);
  };

  socket.onmessage = async (ev) => {
    if (processing) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    const type = String(event.type ?? "");

    if (type === "setup") {
      console.log(`${FN} setup session=${sessionId}`);
      return;
    }

    if (type === "interrupt") {
      console.log(`${FN} interrupt session=${sessionId}`);
      return;
    }

    if (type === "error") {
      console.error(`${FN} relay error:`, event.description);
      return;
    }

    if (type !== "prompt") return;

    const voicePrompt = String(event.voicePrompt ?? "").trim();
    const isLast = event.last !== false;
    if (!voicePrompt || !isLast) return;

    processing = true;
    try {
      await appendTranscript(supabase, sessionId, {
        role: "user",
        text: voicePrompt,
        at: new Date().toISOString(),
      });

      history.push({ role: "user", content: voicePrompt });
      const messages = [...history];

      let fullReply = "";
      for await (const chunk of streamOpenAIText(messages, openaiKey)) {
        fullReply += chunk;
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

      if (fullReply.trim()) {
        history.push({ role: "assistant", content: fullReply.trim() });
        await appendTranscript(supabase, sessionId, {
          role: "assistant",
          text: fullReply.trim(),
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
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

  socket.onerror = (e) => console.error(`${FN} socket error:`, e);
  socket.onclose = () => console.log(`${FN} closed session=${sessionId}`);

  return response;
});
