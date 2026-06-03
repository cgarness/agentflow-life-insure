import WebSocket from "ws";
if (!(globalThis as any).WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

import { createServer, type IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { attachTwilioBridge } from "./bridge.js";
import { loadEnv } from "./config.js";
import { attachDeepgramBridge } from "./deepgramBridge.js";

const FN = "[ai-voice-bridge]";

function parseUrl(req: IncomingMessage): URL | null {
  try {
    const host = req.headers.host ?? "localhost";
    return new URL(req.url ?? "/", `http://${host}`);
  } catch {
    return null;
  }
}

function sessionIdFromRequest(url: URL): string {
  return (url.searchParams.get("sessionId") ?? "").trim();
}

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function healthJson(res: import("node:http").ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "ai-voice-bridge" }));
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/healthz") || req.url?.startsWith("/health")) {
    healthJson(res);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = parseUrl(req);
  if (!url) {
    socket.destroy();
    return;
  }

  const queryFallback = { sessionId: sessionIdFromRequest(url) };

  if (url.pathname === "/twilio") {
    wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
      console.log(`${FN} openai twilio websocket upgrade`);
      attachTwilioBridge(ws, env, supabase, queryFallback);
    });
    return;
  }

  if (url.pathname === "/twilio/deepgram") {
    wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
      console.log(`${FN} deepgram twilio websocket upgrade`);
      attachDeepgramBridge(ws, env, supabase, queryFallback);
    });
    return;
  }

  socket.destroy();
});

server.listen(env.PORT, () => {
  console.log(
    `${FN} listening port=${env.PORT} paths=/twilio /twilio/deepgram health=/health /healthz`,
  );
});
