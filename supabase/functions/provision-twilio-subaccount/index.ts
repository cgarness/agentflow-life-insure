import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const RETRY_BACKOFF_MS = [2_000, 8_000, 30_000];
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TwilioErrorPayload = {
  code?: number | string;
  message?: string;
  more_info?: string;
  status?: number;
};

type TwilioCreateAccountResponse = {
  sid?: string;
  auth_token?: string;
  friendly_name?: string;
  status?: string;
} & TwilioErrorPayload;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const masterSid = Deno.env.get("TWILIO_MASTER_ACCOUNT_SID");
  const masterToken = Deno.env.get("TWILIO_MASTER_AUTH_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!masterSid || !masterToken) {
    console.error("[provision-twilio-subaccount] Missing TWILIO_MASTER_* env vars");
    return json({ error: "Missing Twilio master credentials" }, 500);
  }
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[provision-twilio-subaccount] Missing Supabase env vars");
    return json({ error: "Missing Supabase configuration" }, 500);
  }

  let body: { organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const organizationId = body.organization_id?.trim();
  if (!organizationId) {
    return json({ error: "organization_id is required" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, twilio_subaccount_sid, twilio_subaccount_status")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) {
    console.error("[provision-twilio-subaccount] org lookup:", orgError.message);
    return json({ error: "Organization lookup failed", detail: orgError.message }, 500);
  }
  if (!org) {
    return json({ error: "Organization not found", organization_id: organizationId }, 404);
  }
  if (org.twilio_subaccount_sid) {
    return json({
      status: "already_provisioned",
      organization_id: organizationId,
      subaccount_sid: org.twilio_subaccount_sid,
    });
  }

  const friendlyName = (org.name && String(org.name).trim().length > 0)
    ? String(org.name).trim().slice(0, 64)
    : `AgentFlow Org ${organizationId}`;

  const basicAuth = "Basic " + btoa(`${masterSid}:${masterToken}`);
  const twilioUrl = "https://api.twilio.com/2010-04-01/Accounts.json";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const formBody = new URLSearchParams({ FriendlyName: friendlyName }).toString();

    let httpStatus = 0;
    let payload: TwilioCreateAccountResponse | null = null;
    let rawText = "";
    let networkError: string | null = null;

    try {
      const resp = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: basicAuth,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formBody,
      });
      httpStatus = resp.status;
      rawText = await resp.text();
      try {
        payload = rawText ? JSON.parse(rawText) as TwilioCreateAccountResponse : null;
      } catch {
        payload = null;
      }
    } catch (err) {
      networkError = err instanceof Error ? err.message : String(err);
    }

    const ok = !networkError && httpStatus >= 200 && httpStatus < 300 && payload?.sid && payload?.auth_token;

    if (ok) {
      const sid = payload!.sid as string;
      const authToken = payload!.auth_token as string;

      const { data: vaultKey, error: vaultError } = await supabase.rpc(
        "set_twilio_subaccount_token",
        { p_org_id: organizationId, p_token: authToken },
      );

      if (vaultError) {
        // Vault write failure: log to provisioning_errors (does not retry — Twilio side already succeeded).
        await supabase.from("provisioning_errors").insert({
          organization_id: organizationId,
          attempt_number: attempt,
          error_code: "vault_write_failed",
          error_message: vaultError.message,
          twilio_response: { sid, friendly_name: payload?.friendly_name ?? friendlyName },
        });
        console.error("[provision-twilio-subaccount] vault RPC:", vaultError.message);
        return json({ error: "Vault write failed", detail: vaultError.message, subaccount_sid: sid }, 500);
      }

      const { error: updateError } = await supabase
        .from("organizations")
        .update({
          twilio_subaccount_sid: sid,
          twilio_subaccount_auth_token_vault_key: vaultKey ?? `twilio_subaccount_token_${organizationId}`,
          twilio_subaccount_status: "active",
          twilio_provisioned_at: new Date().toISOString(),
        })
        .eq("id", organizationId);

      if (updateError) {
        await supabase.from("provisioning_errors").insert({
          organization_id: organizationId,
          attempt_number: attempt,
          error_code: "org_update_failed",
          error_message: updateError.message,
          twilio_response: { sid },
        });
        console.error("[provision-twilio-subaccount] org update:", updateError.message);
        return json({ error: "Organization update failed", detail: updateError.message, subaccount_sid: sid }, 500);
      }

      return json({
        status: "active",
        organization_id: organizationId,
        subaccount_sid: sid,
        attempts: attempt,
      });
    }

    const errorCode = networkError
      ? "network_error"
      : (payload?.code != null ? String(payload.code) : `http_${httpStatus}`);
    const errorMessage = networkError
      ?? payload?.message
      ?? (rawText ? rawText.slice(0, 500) : `Twilio returned HTTP ${httpStatus}`);

    const { error: insertError } = await supabase.from("provisioning_errors").insert({
      organization_id: organizationId,
      attempt_number: attempt,
      error_code: errorCode,
      error_message: errorMessage,
      twilio_response: networkError
        ? { network_error: networkError }
        : { http_status: httpStatus, body: payload ?? rawText.slice(0, 1000) },
    });
    if (insertError) {
      console.error("[provision-twilio-subaccount] error log insert:", insertError.message);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BACKOFF_MS[attempt - 1]);
      continue;
    }

    const { error: pendingError } = await supabase
      .from("organizations")
      .update({ twilio_subaccount_status: "pending_manual" })
      .eq("id", organizationId);
    if (pendingError) {
      console.error("[provision-twilio-subaccount] pending_manual update:", pendingError.message);
    }

    return json({
      status: "pending_manual",
      organization_id: organizationId,
      attempts: attempt,
      last_error: { code: errorCode, message: errorMessage },
    }, 502);
  }

  // Unreachable — loop always returns.
  return json({ error: "Unexpected provisioning state" }, 500);
});
