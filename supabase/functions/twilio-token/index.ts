import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      console.error("[twilio-token] Auth error:", userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("organization_id, twilio_client_identity")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error("[twilio-token] Profile lookup failed:", profileError?.message);
      return new Response(
        JSON.stringify({ error: "Could not resolve user profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let identity: string = profile.twilio_client_identity ?? "";
    if (!identity) {
      identity = generateIdentity(user.id);
      console.log(`[twilio-token] Generated new identity: ${identity}`);
      const { error: updateError } = await supabaseClient
        .from("profiles")
        .update({ twilio_client_identity: identity, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (updateError) {
        console.error("[twilio-token] Failed to persist identity:", updateError.message);
      }
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
    const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
    const twimlAppSid = Deno.env.get("TWILIO_TWIML_APP_SID");

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      console.error("[twilio-token] Missing Twilio credentials in environment");
      return new Response(
        JSON.stringify({ error: "Server configuration error — missing Twilio credentials" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = await buildAccessToken(apiKeySid, apiKeySecret, accountSid, twimlAppSid, identity);

    return new Response(
      JSON.stringify({ token, identity, expires_in: 14400 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[twilio-token] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
