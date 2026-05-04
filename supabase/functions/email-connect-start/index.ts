import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "Mail.Read",
  "Mail.Send",
  "User.Read",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Missing Authorization header" }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();
    if (userError || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const body = await req.json();
    const provider = body?.provider === "microsoft" ? "microsoft" : "google";
    const redirectTo = typeof body?.redirect_to === "string" ? body.redirect_to : `${appBaseUrl}/settings?section=email-settings`;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile?.organization_id) {
      return json({ success: false, error: "Organization not found for user" }, 400);
    }

    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: stateError } = await adminClient.from("email_oauth_states").insert({
      user_id: user.id,
      organization_id: profile.organization_id,
      provider,
      state,
      redirect_to: redirectTo,
      expires_at: expiresAt,
    });
    if (stateError) return json({ success: false, error: stateError.message }, 500);

    if (provider === "google") {
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
      const callbackUrl = Deno.env.get("EMAIL_GOOGLE_CALLBACK_URL");
      if (!clientId || !callbackUrl) {
        return json({ success: false, error: "Missing GOOGLE_CLIENT_ID or EMAIL_GOOGLE_CALLBACK_URL" }, 500);
      }
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        scope: GOOGLE_SCOPES.join(" "),
        state,
      });
      return json({ success: true, auth_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
    }

    const msClientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    const msCallbackUrl = Deno.env.get("EMAIL_MICROSOFT_CALLBACK_URL");
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID") || "common";
    if (!msClientId || !msCallbackUrl) {
      return json({ success: false, error: "Missing MICROSOFT_CLIENT_ID or EMAIL_MICROSOFT_CALLBACK_URL" }, 500);
    }
    const msParams = new URLSearchParams({
      client_id: msClientId,
      response_type: "code",
      redirect_uri: msCallbackUrl,
      response_mode: "query",
      scope: MICROSOFT_SCOPES.join(" "),
      state,
      prompt: "select_account",
    });
    return json({
      success: true,
      auth_url: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${msParams.toString()}`,
    });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

