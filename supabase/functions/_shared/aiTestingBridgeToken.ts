/** Per-session token for Render Media Stream bridges (never the global bridge secret). */

export function generateBridgeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** WSS base for AI Testing Render bridge (host only or path ending in /twilio). */
export function aiVoiceMonitorWssBase(): string {
  const raw = (
    Deno.env.get("AI_VOICE_MONITOR_URL") ??
    Deno.env.get("AI_VOICE_BRIDGE_WSS_URL") ??
    ""
  ).trim();
  if (!raw) return "";
  return raw.replace(/\/twilio\/?$/i, "").replace(/\/$/, "");
}

/** Inworld Realtime — same Node bridge host as Deepgram, path `/twilio/inworld`. */
export function inworldBridgeWssBase(): string {
  const raw = (
    Deno.env.get("INWORLD_VOICE_BRIDGE_WSS_URL") ??
    Deno.env.get("AI_VOICE_MONITOR_URL") ??
    Deno.env.get("AI_VOICE_BRIDGE_WSS_URL") ??
    ""
  ).trim();
  if (!raw) return "";
  return raw.replace(/\/twilio(\/(deepgram|inworld))?\/?$/i, "").replace(/\/$/, "");
}

export function buildInworldStreamUrl(sessionId: string): string {
  const base = inworldBridgeWssBase();
  if (!base) return "";
  const normalized = base.startsWith("wss://") || base.startsWith("ws://")
    ? base
    : `wss://${base}`;
  return `${normalized}/twilio/inworld?sessionId=${encodeURIComponent(sessionId)}`;
}

export function buildMonitorStreamUrl(
  path: "/twilio" | "/twilio/deepgram",
  sessionId: string,
): string {
  const base = aiVoiceMonitorWssBase();
  if (!base) return "";
  const normalized = base.startsWith("wss://") || base.startsWith("ws://")
    ? base
    : `wss://${base}`;
  return `${normalized}${path}?sessionId=${encodeURIComponent(sessionId)}`;
}

/** Browser transport — same Node bridge host as Deepgram, path `/browser/deepgram`. */
export function buildBrowserDeepgramStreamUrl(sessionId: string): string {
  const base = aiVoiceMonitorWssBase();
  if (!base) return "";
  const normalized = base.startsWith("wss://") || base.startsWith("ws://")
    ? base
    : `wss://${base}`;
  return `${normalized}/browser/deepgram?sessionId=${encodeURIComponent(sessionId)}`;
}

/** Browser transport for Inworld — same host resolution as the Inworld phone path. */
export function buildBrowserInworldStreamUrl(sessionId: string): string {
  const base = inworldBridgeWssBase();
  if (!base) return "";
  const normalized = base.startsWith("wss://") || base.startsWith("ws://")
    ? base
    : `wss://${base}`;
  return `${normalized}/browser/inworld?sessionId=${encodeURIComponent(sessionId)}`;
}

/**
 * WSS host for the Hypercheap Voice Agent Render bridge (separate Python service).
 * Read only HYPERCHEAP_VOICE_BRIDGE_WSS_URL — never reuse the OpenAI/Deepgram
 * monitor URL, since that points at the Node `ai-voice-bridge` service.
 */
export function hypercheapBridgeWssBase(): string {
  const raw = (Deno.env.get("HYPERCHEAP_VOICE_BRIDGE_WSS_URL") ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\/twilio(\/(hypercheap|pipeline))?\/?$/i, "").replace(/\/$/, "");
}

export function buildHypercheapStreamUrl(sessionId: string): string {
  const base = hypercheapBridgeWssBase();
  if (!base) return "";
  const normalized = base.startsWith("wss://") || base.startsWith("ws://")
    ? base
    : `wss://${base}`;
  return `${normalized}/twilio/hypercheap?sessionId=${encodeURIComponent(sessionId)}`;
}

/** Pipeline stack — same Render Python service as Hypercheap, different WS path. */
export function buildPipelineStreamUrl(sessionId: string): string {
  const base = hypercheapBridgeWssBase();
  if (!base) return "";
  const normalized = base.startsWith("wss://") || base.startsWith("ws://")
    ? base
    : `wss://${base}`;
  return `${normalized}/twilio/pipeline?sessionId=${encodeURIComponent(sessionId)}`;
}
