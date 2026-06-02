import WebSocket from "ws";
if (!(globalThis as any).WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

import { createServer, type IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
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

  wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
    console.log(`${FN} twilio websocket upgrade accepted`);
    const queryFallback = {
      sessionId: sessionIdFromRequest(url),
      secret: secretFromRequest(url),
    };
    attachTwilioBridge(ws, env, supabase, queryFallback);
  });
});

server.listen(env.PORT, () => {
  console.log(`${FN} listening on port ${env.PORT} path=/twilio health=/health`);
});
