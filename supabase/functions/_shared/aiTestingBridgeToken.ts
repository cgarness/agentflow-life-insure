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
