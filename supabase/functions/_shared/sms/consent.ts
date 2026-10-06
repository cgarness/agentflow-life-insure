import type { Db } from "../a2p/types.ts";
import { phone, purpose, signedHeaders, SmsError, UUID } from "./wire.ts";
export interface Policy {
  organization_id: string;
  enforced: boolean;
  send_enabled: boolean;
  uv_profile_id: string;
  uv_project: string;
  sender_name: string;
  selected_phone_ids: string[];
  active_from: string | null;
}
// Database boundary is intentionally untyped, matching the existing shared A2P client.
// deno-lint-ignore no-explicit-any
export function checked<T = any>(result: { data: T; error: unknown }): T {
  if (result.error) {
    throw new SmsError(
      "SMS_STATE",
      "Could not verify texting permissions.",
      503,
    );
  }
  return result.data;
}
export async function policy(db: Db, org: string): Promise<Policy | null> {
  return checked(
    await db.from("sms_agency_policies").select("*").eq("organization_id", org)
      .maybeSingle(),
  ) as Policy | null;
}
export async function bridge(
  p: Policy,
  payload: Record<string, unknown>,
  transport = fetch,
) {
  if (p.uv_project !== "jzdzeevjpootbeuniygx" || !UUID.test(p.uv_profile_id)) {
    throw new SmsError(
      "CONSENT_MAPPING",
      "Consent connection needs review.",
      503,
    );
  }
  const url =
    `https://${p.uv_project}.supabase.co/functions/v1/agentflow-consent`;
  const body = JSON.stringify({
    ...payload,
    organization_id: p.organization_id,
    profile_id: p.uv_profile_id,
  });
  try {
    const response = await transport(url, {
      method: "POST",
      body,
      headers: await signedHeaders(
        Deno.env.get("SMS_BRIDGE_SECRET") ?? "",
        new URL(url).pathname,
        body,
      ),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("bridge_failed");
    return await response.json();
  } catch {
    throw new SmsError(
      "CONSENT_UNAVAILABLE",
      "Consent could not be verified. Please try again later.",
      503,
    );
  }
}
export async function eligibility(
  p: Policy,
  recipient: string,
  messagePurpose: unknown,
  transport = fetch,
) {
  const normalized = phone(recipient), category = purpose(messagePurpose);
  const result = await bridge(p, {
    action: "eligibility",
    phone: normalized,
    purpose: category,
  }, transport);
  const age = Date.now() - Date.parse(result.checked_at);
  if (
    result.organization_id !== p.organization_id ||
    result.profile_id !== p.uv_profile_id || result.phone !== normalized ||
    result.purpose !== category || !Number.isFinite(age) || age < -30000 ||
    age > 30000 || typeof result.allowed !== "boolean"
  ) {
    throw new SmsError(
      "CONSENT_RESPONSE",
      "Consent response did not match this message.",
      503,
    );
  }
  if (!result.allowed) {
    throw new SmsError(
      result.reason === "suppressed" ? "SMS_SUPPRESSED" : "NO_CONSENT",
      result.reason === "suppressed"
        ? "This recipient has opted out of agency texts."
        : `This recipient has not granted ${category} SMS permission.`,
    );
  }
  if (
    !Array.isArray(result.evidence) || !result.evidence.length ||
    result.evidence.some((e: { id: string }) => !UUID.test(e.id))
  ) {
    throw new SmsError(
      "CONSENT_EVIDENCE",
      "Consent evidence is unavailable.",
      503,
    );
  }
  return result.evidence.map((e: { id: string }) => e.id) as string[];
}
export async function suppress(
  db: Db,
  org: string,
  recipient: string,
  reason: "stop" | "provider_block",
  sourceId: string,
) {
  checked(
    await db.rpc("sms_record_suppression", {
      p_org: org,
      p_phone: phone(recipient),
      p_reason: reason,
      p_source: sourceId,
    }),
  );
}
