import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleRedirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");

    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: "SUPABASE_URL or SUPABASE_ANON_KEY is not configured" }, 500);
    }

    if (!googleClientId || !googleRedirectUri) {
      return json({ error: "GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI is not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Unable to verify authenticated user" }, 401);
    }

    const statePayload = {
      provider: "google",
      userId: userData.user.id,
      accessToken: authorization.replace(/^Bearer\s+/i, ""),
      nonce: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    const encodedState = btoa(JSON.stringify(statePayload));

    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", googleClientId);
    googleAuthUrl.searchParams.set("redirect_uri", googleRedirectUri);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("include_granted_scopes", "true");
    googleAuthUrl.searchParams.set("prompt", "consent");
    googleAuthUrl.searchParams.set("scope", "openid email profile https://www.googleapis.com/auth/calendar");
    googleAuthUrl.searchParams.set("state", encodedState);

    return json({
      provider: "google",
      authorization_url: googleAuthUrl.toString(),
      redirect_uri: googleRedirectUri,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
