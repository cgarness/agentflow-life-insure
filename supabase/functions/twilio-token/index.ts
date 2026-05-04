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

function base64url(data: ArrayBuffer | string): string {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function buildAccessToken(
  apiKeySid: string,
  apiKeySecret: string,
  accountSid: string,
  twimlAppSid: string,
  identity: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = `${apiKeySid}-${now}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const payload = {
    iss: apiKeySid,
    sub: accountSid,
    exp: now + 14400,
    jti,
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: twimlAppSid },
      },
    },
  };

  const headerEncoded = base64url(JSON.stringify(header));
  const payloadEncoded = base64url(JSON.stringify(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiKeySecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64url(signature)}`;
}

function generateIdentity(userId: string): string {
  const prefix = userId.replace(/-/g, "").slice(0, 8);
  const randomBytes = new Uint8Array(2);
  crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `agent_${prefix}_${suffix}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      console.error("[twilio-token] Auth error:", userError?.message);
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("organization_id, twilio_client_identity")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[twilio-token] Profile lookup failed:", profileError.message);
      return json({ error: "Could not resolve user profile" }, 500);
    }
    if (!profile || !profile.organization_id) {
      return json({ error: "No organization on profile", code: "NO_ORGANIZATION" }, 403);
    }

    const orgId: string = profile.organization_id;

    const { data: org, error: orgError } = await supabaseClient
      .from("organizations")
      .select(
        "twilio_subaccount_sid, twilio_subaccount_auth_token_vault_key, twilio_subaccount_status",
      )
      .eq("id", orgId)
      .maybeSingle();

    if (orgError) {
      console.error("[twilio-token] Org lookup failed:", orgError.message);
      return json({ error: "Could not resolve organization" }, 500);
    }
    if (!org) {
      return json({ error: "Organization not found", code: "NO_ORGANIZATION" }, 403);
    }

    const status: string = org.twilio_subaccount_status ?? "pending";
    const sidPartial = org.twilio_subaccount_sid
      ? String(org.twilio_subaccount_sid).slice(0, 8)
      : "(none)";

    if (status === "pending") {
      console.log(`[twilio-token] org=${orgId} sid=${sidPartial} outcome=provisioning_pending`);
      return json(
        {
          error: "Phone system is being set up. Try again in 30 seconds.",
          code: "PROVISIONING_PENDING",
        },
        503,
      );
    }
    if (status === "pending_manual") {
      console.log(`[twilio-token] org=${orgId} sid=${sidPartial} outcome=provisioning_failed`);
      return json(
        {
          error: "Contact support — telephony provisioning needs attention.",
          code: "PROVISIONING_FAILED",
        },
        503,
      );
    }
    if (status === "suspended" || status === "closed") {
      console.log(`[twilio-token] org=${orgId} sid=${sidPartial} outcome=suspended status=${status}`);
      return json({ error: "Telephony suspended", code: "TELEPHONY_SUSPENDED" }, 403);
    }
    if (status !== "active") {
      console.error(`[twilio-token] org=${orgId} unexpected status=${status}`);
      return json({ error: "Telephony unavailable", code: "TELEPHONY_UNAVAILABLE" }, 503);
    }

    if (!org.twilio_subaccount_sid || !org.twilio_subaccount_auth_token_vault_key) {
      console.error(
        `[twilio-token] org=${orgId} status=active but missing sid or vault_key — data integrity error`,
      );
      return json({ error: "Telephony configuration error", code: "TELEPHONY_MISCONFIGURED" }, 500);
    }

    const { data: subaccountToken, error: tokenError } = await supabaseClient.rpc(
      "get_twilio_subaccount_token",
      { p_org_id: orgId },
    );

    if (tokenError) {
      console.error("[twilio-token] Vault RPC failed:", tokenError.message);
      return json({ error: "Could not retrieve telephony credentials", code: "TOKEN_LOOKUP_FAILED" }, 500);
    }
    if (!subaccountToken) {
      console.error(`[twilio-token] org=${orgId} sid=${sidPartial} vault returned null`);
      return json({ error: "Telephony credentials missing", code: "TOKEN_MISSING" }, 500);
    }

    let identity: string = profile.twilio_client_identity ?? "";
    if (!identity) {
      identity = generateIdentity(user.id);
      console.log(`[twilio-token] org=${orgId} generated new identity: ${identity}`);
      const { error: updateError } = await supabaseClient
        .from("profiles")
        .update({ twilio_client_identity: identity, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (updateError) {
        console.error("[twilio-token] Failed to persist identity:", updateError.message);
      }
    }

    const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
    const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
    const twimlAppSid = Deno.env.get("TWILIO_TWIML_APP_SID");

    if (!apiKeySid || !apiKeySecret || !twimlAppSid) {
      console.error("[twilio-token] Missing Twilio API key / TwiML app env vars");
      return json({ error: "Server configuration error" }, 500);
    }

    const subaccountSid = String(org.twilio_subaccount_sid);

    const token = await buildAccessToken(
      apiKeySid,
      apiKeySecret,
      subaccountSid,
      twimlAppSid,
      identity,
    );

    console.log(`[twilio-token] org=${orgId} sid=${sidPartial} outcome=ok`);

    return json({ token, identity, expires_in: 14400 }, 200);
  } catch (error) {
    console.error("[twilio-token] Fatal error:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Internal server error" }, 500);
  }
});
