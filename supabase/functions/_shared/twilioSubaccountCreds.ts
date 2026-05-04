// Resolves per-org Twilio subaccount credentials for REST API calls.
//
// Reads organizations.twilio_subaccount_sid + status, then loads the auth
// token from Vault via the public.get_twilio_subaccount_token RPC.
// Status-gated identically to the twilio-token Edge Function (Phase 2):
//   pending         → 503 PROVISIONING_PENDING
//   pending_manual  → 503 PROVISIONING_FAILED
//   suspended/closed→ 403 TELEPHONY_SUSPENDED
//   missing sid     → 500 TELEPHONY_MISCONFIGURED
//   missing vault   → 500 TOKEN_MISSING
//
// Used by twilio-buy-number, twilio-search-numbers, twilio-trust-hub.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SubaccountCreds = {
  accountSid: string;
  authToken: string;
};

export type SubaccountCredsResult =
  | { ok: true; creds: SubaccountCreds }
  | { ok: false; status: number; code: string; error: string };

export async function loadSubaccountCreds(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<SubaccountCredsResult> {
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("twilio_subaccount_sid, twilio_subaccount_status")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) {
    return {
      ok: false,
      status: 500,
      code: "ORG_LOOKUP_FAILED",
      error: "Could not load organization for telephony credentials.",
    };
  }
  if (!org) {
    return {
      ok: false,
      status: 404,
      code: "ORG_NOT_FOUND",
      error: "Organization not found.",
    };
  }

  const status = String(org.twilio_subaccount_status ?? "");
  const sid = String(org.twilio_subaccount_sid ?? "").trim();

  if (status === "pending") {
    return {
      ok: false,
      status: 503,
      code: "PROVISIONING_PENDING",
      error: "Telephony is still being provisioned for your organization. Please try again shortly.",
    };
  }
  if (status === "pending_manual") {
    return {
      ok: false,
      status: 503,
      code: "PROVISIONING_FAILED",
      error: "Telephony provisioning failed. Contact support to retry.",
    };
  }
  if (status === "suspended" || status === "closed") {
    return {
      ok: false,
      status: 403,
      code: "TELEPHONY_SUSPENDED",
      error: "Telephony for this organization is suspended.",
    };
  }
  if (status !== "active" || !sid) {
    return {
      ok: false,
      status: 500,
      code: "TELEPHONY_MISCONFIGURED",
      error: "Telephony is not configured correctly for this organization.",
    };
  }

  const { data: token, error: tokenError } = await supabase.rpc(
    "get_twilio_subaccount_token",
    { p_org_id: organizationId },
  );

  if (tokenError) {
    return {
      ok: false,
      status: 500,
      code: "TOKEN_LOOKUP_FAILED",
      error: "Could not retrieve telephony credentials.",
    };
  }
  const authToken = typeof token === "string" ? token.trim() : "";
  if (!authToken) {
    return {
      ok: false,
      status: 500,
      code: "TOKEN_MISSING",
      error: "Telephony credentials are missing for this organization.",
    };
  }

  return { ok: true, creds: { accountSid: sid, authToken } };
}
