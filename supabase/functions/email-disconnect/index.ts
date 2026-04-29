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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const connectionId = String(body?.connection_id || "").trim();
    if (!connectionId) return json({ success: false, error: "connection_id is required" }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await admin
      .from("user_email_connections")
      .update({
        status: "disconnected",
        access_token_encrypted: "",
        refresh_token_encrypted: null,
        access_token_expires_at: null,
        last_error: null,
      })
      .eq("id", connectionId)
      .eq("user_id", user.id);
    if (error) return json({ success: false, error: error.message }, 500);

    return json({ success: true });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

