import { ownedCalendarIntegration } from "../_shared/google-oauth.ts";
import { z } from "https://esm.sh/zod@3.25.76";
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

  const payload = z.object({ calendarId: z.string().min(1).max(1024), syncMode: z.enum(["two_way", "outbound_only"]) }).safeParse(await req.json().catch(() => null));
  if (!payload.success) return json({ error: "Invalid calendar configuration" }, 400);
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let integration;
  try { integration = await ownedCalendarIntegration(admin, user.id); }
  catch { return json({ error: "Unable to load Google Calendar connection" }, 409); }
  if (!integration?.access_token || !integration.sync_enabled) return json({ error: "Connect Google Calendar first" }, 409);
  const { data, error } = await admin.from("calendar_integrations").update({
    calendar_id: payload.data.calendarId, sync_mode: payload.data.syncMode,
    last_sync_token: null, connection_generation: crypto.randomUUID(),
  }).eq("id", integration.id).eq("user_id", user.id).eq("connection_generation", integration.connection_generation).select("id").maybeSingle();
  if (error || !data) return json({ error: "Google Calendar connection changed. Try again." }, 409);
  return json({ saved: true });
});
