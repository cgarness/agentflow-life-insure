import { createServer, type IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, type WebSocket } from "ws";
import { attachTwilioBridge } from "./bridge.js";
import { loadEnv } from "./config.js";

const FN = "[ai-voice-bridge]";

function parseUrl(req: IncomingMessage): URL | null {
  try {
    const host = req.headers.host ?? "localhost";
    return new URL(req.url ?? "/", `http://${host}`);
  } catch {
    return null;
  }
}

function secretFromRequest(url: URL): string {
  return (url.searchParams.get("secret") ?? "").trim();
}

function sessionIdFromRequest(url: URL): string {
  return (url.searchParams.get("sessionId") ?? "").trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const server = createServer((req, res) => {
  if (req.url?.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "ai-voice-bridge" }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = parseUrl(req);
  if (!url || url.pathname !== "/twilio") {
    socket.destroy();
    return;
  }

  const sessionId = sessionIdFromRequest(url);
  const secret = secretFromRequest(url);

  if (!sessionId) {
    console.warn(`${FN} upgrade rejected: missing sessionId`);
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!secret || !timingSafeEqual(secret, env.AI_VOICE_BRIDGE_SECRET)) {
    console.warn(`${FN} upgrade rejected: invalid secret session=${sessionId}`);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    console.log(`${FN} twilio upgrade session=${sessionId}`);
    attachTwilioBridge(ws, env, supabase, sessionId);
  });
});

server.listen(env.PORT, () => {
  console.log(`${FN} listening on port ${env.PORT} path=/twilio health=/health`);
});
