import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { attachTwilioBridge } from "./bridge.js";
import { loadEnv } from "./config.js";
import { attachDeepgramBridge } from "./deepgramBridge.js";
import { createBridgeSupabase } from "./supabaseClient.js";

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
const supabase = createBridgeSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function writeJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Liveness — Render healthCheckPath uses /health */
function healthJson(res: import("node:http").ServerResponse) {
  writeJson(res, 200, { ok: true, service: "ai-voice-bridge" });
}

/** Readiness — which upstream credentials are configured (no secret values). */
function readyJson(res: import("node:http").ServerResponse) {
  const deepgram = Boolean(env.DEEPGRAM_API_KEY?.trim());
  const openai = Boolean(env.OPENAI_API_KEY?.trim());
  const supabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  writeJson(res, deepgram && openai && supabase ? 200 : 503, {
    ok: deepgram && openai && supabase,
    service: "ai-voice-bridge",
    paths: ["/twilio", "/twilio/deepgram"],
    configured: { openai, deepgram, supabase },
  });
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/ready")) {
    readyJson(res);
    return;
  }
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
  const deepgram = Boolean(env.DEEPGRAM_API_KEY?.trim());
  console.log(
    `${FN} listening port=${env.PORT} paths=/twilio /twilio/deepgram health=/health /healthz /ready deepgram=${deepgram}`,
  );
});
