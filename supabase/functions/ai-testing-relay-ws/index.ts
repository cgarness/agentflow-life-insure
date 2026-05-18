import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appendTranscript,
  loadSession,
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

Deno.serve((req) => {
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }
  if (!sessionId) {
    return new Response("sessionId required", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const supabase = getSupabase();
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

  let sessionLoaded = false;
  let systemPrompt = "You are a helpful insurance assistant on a phone call. Keep replies concise and conversational.";
  const history: ChatMessage[] = [];
  let processing = false;

  socket.onopen = async () => {
    if (!supabase) {
      socket.close(1011, "Server misconfigured");
      return;
    }
    const session = await loadSession(supabase, sessionId);
    if (!session || session.stack !== "twilio_cr") {
      socket.close(1008, "Invalid session");
      return;
    }
    sessionLoaded = true;
    systemPrompt = session.prompt;
    history.push({ role: "system", content: systemPrompt });
    await updateSession(supabase, sessionId, { status: "in-progress" });
    console.log(`${FN} connected session=${sessionId}`);
  };

  socket.onmessage = async (ev) => {
    if (!sessionLoaded || !supabase || !openaiKey || processing) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    const type = String(event.type ?? "");

    if (type === "prompt") {
      const voicePrompt = String(event.voicePrompt ?? "").trim();
      if (!voicePrompt) return;

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
          socket.send(JSON.stringify({ type: "text", token: chunk, last: false }));
        }
        socket.send(JSON.stringify({ type: "text", token: "", last: true }));

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
        const fallback =
          "I'm sorry, I'm having a little trouble right now. Could you repeat that?";
        socket.send(JSON.stringify({ type: "text", token: fallback, last: true }));
      } finally {
        processing = false;
      }
    }
  };

  socket.onerror = (e) => console.error(`${FN} socket error:`, e);
  socket.onclose = () => console.log(`${FN} closed session=${sessionId}`);

  return response;
});
