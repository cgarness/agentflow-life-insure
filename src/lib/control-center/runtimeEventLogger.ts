import { supabase } from "@/integrations/supabase/client";
import type {
  RuntimeEventType,
  RuntimeEventSource,
  RuntimeEventSeverity,
} from "./constants";

// 5-second window to prevent duplicate event flood
const THROTTLE_WINDOW_MS = 5000;
const throttleCache = new Map<string, number>();

/**
 * Fast, non-cryptographic hash function to generate stable keys.
 */
export function cyb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Normalizes input text (replaces UUIDs, line/column markers, digits, and whitespace)
 * to generate a stable, reproducible signature key.
 */
export function generateEventKeySignature(
  title: string,
  message: string | null,
  stack: string | null
): string {
  let baseStr = `${title || ""}:${message || ""}:${stack || ""}`;

  // 1. Remove UUIDs
  baseStr = baseStr.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "");

  // 2. Remove line and column numbers (e.g. :12:34 or :1234)
  baseStr = baseStr.replace(/:\d+:\d+/g, "");
  baseStr = baseStr.replace(/:\d+/g, "");

  // 3. Remove all other digits (to ignore IDs, timestamps, etc.)
  baseStr = baseStr.replace(/\d+/g, "");

  // 4. Remove all whitespace
  baseStr = baseStr.replace(/\s+/g, "");

  return cyb53(baseStr);
}

/**
 * Sanitizes input text, redacting credentials, tokens, JWTs, headers, cookies, keys.
 */
export function sanitizeText(text: string): string {
  if (!text) return text;
  let sanitized = text;

  // 1. Redact JWTs (eyJ...)
  sanitized = sanitized.replace(/eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/g, "[REDACTED_JWT]");

  // 2. Redact Twilio Account SIDs and API Key SIDs (AC/SK + 32 chars)
  sanitized = sanitized.replace(/\b(AC|SK)[a-fA-F0-9]{32}\b/g, "[REDACTED_TWILIO_SID]");

  // 3. Find and clean URLs first so we don't destroy query parameter formats with general key-value matches!
  sanitized = sanitized.replace(/(https?:\/\/[^\s"'()]+)/g, (urlMatch) => {
    // Separate trailing line/column markers like :25:32 or :25
    const trailingMatch = urlMatch.match(/(:\d+:\d+|:\d+)?$/);
    const suffix = trailingMatch ? trailingMatch[0] : "";
    const cleanUrlPart = urlMatch.substring(0, urlMatch.length - suffix.length);

    try {
      const url = new URL(cleanUrlPart);
      if (url.search) {
        const params = new URLSearchParams(url.search);
        for (const key of params.keys()) {
          params.set(key, "[REDACTED]");
        }
        url.search = params.toString();
      }
      if (url.password) url.password = "[REDACTED]";
      if (url.username) url.username = "[REDACTED]";
      return url.toString() + suffix;
    } catch {
      // Fallback: regex redact query parameter values inside the URL match
      return cleanUrlPart.replace(/([\?&][^=]+)=([^&\s]+)/g, "$1=[REDACTED]") + suffix;
    }
  });

  // 4. Redact Bearer headers (Bearer eyJ... or Bearer token...)
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/ig, "Bearer [REDACTED]");

  // 5. Redact key=value or key:value format for credentials (e.g. password=abc or password: abc)
  // Negative lookahead prevents matching values that are already redacted (starts with [REDACTED or %5BREDACTED)
  sanitized = sanitized.replace(/(cookie|authorization|auth|password|passwd|secret|token|key|jwt)\s*[:=]\s*(?!Bearer\s+\[REDACTED|\[REDACTED|%5BREDACTED)(Bearer\s+[^\s,;]+|[^\s,;]+)/ig, "$1: [REDACTED]");

  // 6. Redact Twilio/Supabase/other long alphanumeric tokens/keys (32+ chars)
  sanitized = sanitized.replace(/\b[a-fA-F0-9]{32,}\b/g, "[REDACTED_KEY]");

  return sanitized;
}

/**
 * Recursively sanitizes objects and their fields to redact credentials.
 */
export function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return sanitizeText(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (typeof obj === "object") {
    const cleaned: Record<string, any> = {};
    const sensitiveKeys = [
      "token",
      "jwt",
      "secret",
      "password",
      "passwd",
      "cookie",
      "credential",
      "private",
      "apikey",
      "api_key",
      "auth",
      "session",
    ];

    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      const isExcluded = ["event_key", "check_key", "feature_key"].includes(lowerKey);
      const isSensitive =
        sensitiveKeys.some((s) => lowerKey.includes(s)) ||
        lowerKey.endsWith("key") ||
        lowerKey.endsWith("sid") ||
        lowerKey === "authorization";

      if (isSensitive && !isExcluded) {
        cleaned[key] = "[REDACTED]";
      } else {
        cleaned[key] = sanitizeObject(obj[key]);
      }
    }
    return cleaned;
  }
  return obj;
}

interface LogRuntimeEventParams {
  event_type: RuntimeEventType;
  severity: RuntimeEventSeverity;
  source: RuntimeEventSource;
  title: string;
  message?: string | null;
  stack?: string | null;
  route?: string | null;
  component_name?: string | null;
  metadata?: Record<string, any> | null;
}

/**
 * Sanitizes and logs runtime events to Supabase control_center_runtime_events.
 * Implements throttling to limit duplicate logs within 5 seconds.
 */
export async function logRuntimeEvent(params: LogRuntimeEventParams): Promise<string | null> {
  try {
    // 1. Sanitize text and metadata
    const cleanTitle = sanitizeText(params.title);
    const cleanMessage = params.message ? sanitizeText(params.message) : null;
    const cleanStack = params.stack ? sanitizeText(params.stack) : null;
    const cleanMetadata = params.metadata ? sanitizeObject(params.metadata) : {};

    // 2. Generate Event Key Signature
    const eventKey = generateEventKeySignature(cleanTitle, cleanMessage, cleanStack);

    // 3. Throttling Check
    const now = Date.now();
    const lastSeen = throttleCache.get(eventKey);
    if (lastSeen && now - lastSeen < THROTTLE_WINDOW_MS) {
      console.warn(`[logRuntimeEvent] Ignored (throttled): ${cleanTitle}`);
      return null;
    }
    throttleCache.set(eventKey, now);

    // 4. Check Authentication to prevent unauthenticated database exceptions
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      console.warn(`[logRuntimeEvent] Not authenticated. Console log only:`, {
        eventKey,
        ...params,
        title: cleanTitle,
        message: cleanMessage,
        stack: cleanStack,
        metadata: cleanMetadata,
      });
      return null;
    }

    // 5. Invoke RPC
    const { data, error } = await supabase.rpc("log_control_center_runtime_event", {
      p_event_type: params.event_type,
      p_severity: params.severity,
      p_source: params.source,
      p_title: cleanTitle,
      p_message: cleanMessage,
      p_stack: cleanStack,
      p_route: params.route || null,
      p_component_name: params.component_name || null,
      p_metadata: cleanMetadata,
      p_event_key: eventKey,
    });

    if (error) {
      console.error("[logRuntimeEvent] Database RPC failure:", error);
      return null;
    }

    return data as string;
  } catch (err) {
    console.error("[logRuntimeEvent] Exception during logging:", err);
    return null;
  }
}
