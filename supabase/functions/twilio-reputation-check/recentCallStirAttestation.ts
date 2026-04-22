/**
 * Twilio documents attestation A/B/C for outbound on:
 * - Status callback parameter `StirStatus` (ringing / in-progress)
 * - Voice webhook `StirVerstat` (e.g. TN-Validation-Passed-A)
 * - Call resource JSON may include stir_verstat / stir_status when fetched after the call.
 *
 * There is no separate "get attestation for phone number" API; we use recent outbound
 * Call SIDs stored on `calls.twilio_call_sid` and GET …/Calls/{CallSid}.json.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const OUTBOUND_DIRECTIONS = new Set([
  "outbound",
  "outgoing",
  "outgoing_dial",
  "dial_outbound",
]);

function basicAuth(accountSid: string, authToken: string): string {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

/** Map Twilio Call JSON + StirVerstat-style strings to a single letter. */
export function parseStirLevelFromTwilioPayload(
  raw: string | null | undefined,
): "A" | "B" | "C" | "U" | null {
  if (!raw) return null;
  const s = String(raw).toUpperCase().trim();
  if (s === "A" || s === "B" || s === "C" || s === "U") return s;
  const token = s.match(/(?:^|[-_\s])([ABCU])(?:$|[-_\s])/);
  if (token?.[1]) return token[1] as "A" | "B" | "C" | "U";
  const letters = s.replace(/[^ABCU]/g, "");
  if (letters.includes("A")) return "A";
  if (letters.includes("B")) return "B";
  if (letters.includes("C")) return "C";
  if (letters.includes("U")) return "U";
  return null;
}

function parseStirFromCallJson(json: Record<string, unknown>): "A" | "B" | "C" | "U" | null {
  const combined =
    (typeof json.stir_verstat === "string" ? json.stir_verstat : null) ??
    (typeof json.stirVerstat === "string" ? json.stirVerstat : null) ??
    (typeof json.stir_status === "string" ? json.stir_status : null) ??
    (typeof json.stirStatus === "string" ? json.stirStatus : null) ??
    (typeof json.shaken_stir === "string" ? json.shaken_stir : null) ??
    (typeof json.shakenStir === "string" ? json.shakenStir : null);
  return parseStirLevelFromTwilioPayload(combined);
}

async function fetchCallResourceStir(
  accountSid: string,
  authToken: string,
  callSid: string,
): Promise<"A" | "B" | "C" | "U" | null> {
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: basicAuth(accountSid, authToken),
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  return parseStirFromCallJson(json);
}

function isOutboundDirection(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const n = String(raw).toLowerCase().replace(/\s+/g, "_");
  return OUTBOUND_DIRECTIONS.has(n);
}

/**
 * Best attestation from recent outbound calls for this caller ID: prefers `calls.shaken_stir`,
 * then Twilio Call REST for each `twilio_call_sid` until A/B/C/U is found.
 */
export async function fetchRecentOutboundStirAttestation(
  supabase: SupabaseClient,
  organizationId: string,
  callerIdE164: string,
  accountSid: string,
  authToken: string,
): Promise<"A" | "B" | "C" | "U" | null> {
  const { data: rows, error } = await supabase
    .from("calls")
    .select("twilio_call_sid, shaken_stir, direction, created_at")
    .eq("organization_id", organizationId)
    .eq("caller_id_used", callerIdE164)
    .not("twilio_call_sid", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.warn("[recentCallStirAttestation] calls query:", error.message);
    return null;
  }

  const list = (rows ?? []) as Array<{
    twilio_call_sid: string | null;
    shaken_stir: string | null;
    direction: string | null;
  }>;

  const outbound = list.filter((r) => isOutboundDirection(r.direction));
  const maxRestLookups = 8;

  let restAttempts = 0;
  for (const row of outbound) {
    const fromDb = parseStirLevelFromTwilioPayload(row.shaken_stir ?? undefined);
    if (fromDb) return fromDb;

    const sid = String(row.twilio_call_sid ?? "").trim();
    if (!sid.startsWith("CA")) continue;
    if (restAttempts >= maxRestLookups) break;
    restAttempts++;

    const fromApi = await fetchCallResourceStir(accountSid, authToken, sid);
    if (fromApi) return fromApi;
  }

  return null;
}
