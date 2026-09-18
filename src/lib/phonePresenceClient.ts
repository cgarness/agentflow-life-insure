/**
 * Browser wiring for PhonePresence (implementation_plan.md rev 3 §6.2): the authenticated RPC for
 * normal writes and a `fetch(..., { keepalive: true })` transport for pagehide/beforeunload/logout.
 * The keepalive request needs the CURRENT access token; it is cached on every RPC write so the
 * teardown path never has to await the auth client.
 */
import { supabase } from "@/integrations/supabase/client";
import { PhonePresence, type HeartbeatArgs, type HeartbeatResult } from "./phonePresence";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

let cachedAccessToken: string | null = null;
let singleton: PhonePresence | null = null;

async function refreshAccessToken(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    cachedAccessToken = data.session?.access_token ?? null;
  } catch {
    /* keep the last known token */
  }
}

async function rpcHeartbeat(args: HeartbeatArgs): Promise<HeartbeatResult> {
  void refreshAccessToken();
  const { data, error } = await supabase.rpc("heartbeat_phone_registration", args);
  if (error) throw new Error(error.message);
  const d = (data && typeof data === "object" ? data : {}) as { applied?: boolean; reason?: string };
  return { applied: d.applied === true, reason: String(d.reason ?? "") };
}

function keepaliveHeartbeat(args: HeartbeatArgs): void {
  if (typeof fetch !== "function" || !SUPABASE_URL || !cachedAccessToken) return;
  try {
    void fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/heartbeat_phone_registration`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cachedAccessToken}`,
      },
      body: JSON.stringify(args),
    }).catch(() => { /* best effort at teardown */ });
  } catch {
    /* best effort at teardown */
  }
}

export function getPhonePresence(): PhonePresence {
  if (!singleton) {
    singleton = new PhonePresence({
      rpc: rpcHeartbeat,
      keepalive: keepaliveHeartbeat,
      log: (message, meta) => console.warn(`[phonePresence] ${message}`, meta ?? {}),
    });
  }
  return singleton;
}

/** AuthContext.logout(): close the current registration BEFORE signOut revokes the token. */
export function flushPhonePresenceOnLogout(): void {
  singleton?.flushUnregisterKeepalive("logout");
}

/** Installed once by TwilioProvider: pagehide/beforeunload close the generation; visible/online refresh it. */
export function installPhonePresenceWindowHooks(presence: PhonePresence): () => void {
  if (typeof window === "undefined") return () => {};
  const onPageHide = () => { presence.flushUnregisterKeepalive("pagehide"); };
  const onBeforeUnload = () => { presence.flushUnregisterKeepalive("beforeunload"); };
  const onVisible = () => { if (document.visibilityState === "visible") void presence.heartbeat("visible"); };
  const onOnline = () => { void presence.heartbeat("online"); };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onBeforeUnload);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  return () => {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onBeforeUnload);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
  };
}
