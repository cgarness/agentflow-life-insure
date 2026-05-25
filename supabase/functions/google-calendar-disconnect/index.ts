import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeToken } from "../_shared/google-token.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: integration, error: integrationError } = await authClient
    .from("calendar_integrations")
    .select("id, access_token")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  if (integrationError) return json({ error: integrationError.message }, 500);

  // Calendar Pass 3 (B3): tokens are stored base64-encoded; decode before sending to
  // Google's revoke endpoint so the revoke actually invalidates the grant Google-side.
  // Response is intentionally ignored — disconnect succeeds regardless of revoke outcome.
  const rawAccessToken = decodeToken(integration?.access_token ?? null);
  if (rawAccessToken) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: rawAccessToken }).toString(),
      });
    } catch {
      // ignore — disconnect should not depend on Google availability
    }
  }

  const { error: updateError } = await authClient
    .from("calendar_integrations")
    .update({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      sync_enabled: false,
      calendar_id: "primary",
      oauth_state: null,
      oauth_state_expires_at: null,
    })
    .eq("user_id", user.id)
    .eq("provider", "google");

  if (updateError) return json({ error: updateError.message }, 500);

  return json({ disconnected: true });
});
