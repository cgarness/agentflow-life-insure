import type { SupabaseClient } from "@supabase/supabase-js";

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Validate per-session bridge token from Twilio customParameters (not global bridge secret). */
export async function sessionBridgeTokenValid(
  supabase: SupabaseClient,
  sessionId: string,
  token: string,
): Promise<boolean> {
  if (!sessionId || !token) return false;
  const { data } = await supabase
    .from("ai_test_sessions")
    .select("bridge_token")
    .eq("id", sessionId)
    .maybeSingle();
  const expected = String(data?.bridge_token ?? "").trim();
  if (!expected) return false;
  return timingSafeEqual(token, expected);
}
