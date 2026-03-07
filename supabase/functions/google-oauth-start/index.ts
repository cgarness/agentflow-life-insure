import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const googleScopes = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const toBase64Url = (input: string) =>
  btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const buildState = async (userId: string, secret: string) => {
  const payload = JSON.stringify({ u: userId, t: Date.now(), n: crypto.randomUUID() });
  const payloadB64 = toBase64Url(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const sigB64 = toBase64Url(String.fromCharCode(...new Uint8Array(signature)));
  return `${payloadB64}.${sigB64}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
    const oauthStateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET") || Deno.env.get("GOOGLE_CLIENT_SECRET") || "dev-google-state-secret";

    if (!googleClientId || !redirectUri) {
      return json({ error: "Missing GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI in function secrets" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const state = await buildState(user.id, oauthStateSecret);

    // Best-effort state persistence (works when migration exists; not required).
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await adminClient
      .from("calendar_integrations")
      .upsert(
        {
          user_id: user.id,
          provider: "google",
          oauth_state: state,
          oauth_state_expires_at: expiresAt,
        },
        { onConflict: "user_id,provider" },
      );

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: googleScopes.join(" "),
      state,
    });

    return json({ authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
