import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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

  const payload = await req.json().catch(() => ({}));
  const calendarId = typeof payload.calendarId === "string" && payload.calendarId ? payload.calendarId : "primary";
  const syncMode = payload.syncMode === "two_way" ? "two_way" : "outbound_only";

  const { error } = await authClient
    .from("calendar_integrations")
    .upsert(
      {
        user_id: user.id,
        provider: "google",
        calendar_id: calendarId,
        sync_mode: syncMode,
      },
      { onConflict: "user_id,provider" },
    );

  if (error) return json({ error: error.message }, 500);

  return json({ saved: true });
});
