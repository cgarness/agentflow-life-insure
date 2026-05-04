// Super Admin retry tool for Twilio subaccount provisioning.
//
// Accepts { organization_id }, verifies the caller is a Super Admin
// (JWT claim is_super_admin === true AND profiles.is_super_admin = true),
// then re-invokes the provision-twilio-subaccount Edge Function which
// is already idempotent (returns 'already_provisioned' if SID exists).
//
// JWT validated in-code (verify_jwt = false to support ES256 tokens —
// AGENT_RULES.md §Telephony / Security).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FN = "[retry-twilio-provisioning]";

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

function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error(`${FN} Missing Supabase env vars`);
    return json({ error: "Server configuration error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const jwt = authHeader.replace("Bearer ", "");

  const supabaseAuth = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(jwt);
  if (userError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const claims = decodeJwtClaims(jwt);
  const claimSuper = claims?.is_super_admin === true;

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return json({ error: "Profile lookup failed" }, 500);
  }
  const profileSuper = profile.is_super_admin === true;

  if (!claimSuper || !profileSuper) {
    console.warn(`${FN} forbidden — user=${user.id} claim=${claimSuper} profile=${profileSuper}`);
    return json({ error: "Forbidden — Super Admin only" }, 403);
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

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, twilio_subaccount_sid, twilio_subaccount_status")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) {
    return json({ error: "Organization lookup failed" }, 500);
  }
  if (!org) {
    return json({ error: "Organization not found" }, 404);
  }

  // Idempotency: if a SID already exists, never call Twilio again.
  if (org.twilio_subaccount_sid) {
    return json({
      status: "already_provisioned",
      organization_id: organizationId,
      subaccount_sid: org.twilio_subaccount_sid,
    });
  }

  const status = String(org.twilio_subaccount_status ?? "");
  if (status !== "pending_manual" && status !== "pending") {
    return json({
      error: `Cannot retry — status is '${status}'. Only 'pending' and 'pending_manual' orgs can be retried.`,
    }, 400);
  }

  const provisionUrl = `${supabaseUrl}/functions/v1/provision-twilio-subaccount`;
  let provisionResp: Response;
  try {
    provisionResp = await fetch(provisionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organization_id: organizationId }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${FN} provision invoke network error:`, msg);
    return json({ status: "pending_manual", error: msg }, 502);
  }

  const text = await provisionResp.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    payload = { error: "Provision function returned invalid JSON" };
  }

  return new Response(JSON.stringify(payload), {
    status: provisionResp.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
