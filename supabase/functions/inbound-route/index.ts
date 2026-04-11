// Inbound routing settings + presence + voicemail-inbox counts for the current user.
// Read-only endpoint powering the InboundCallRouting settings UI and
// Voicemail inbox header. verify_jwt = false; we validate the bearer token
// manually so the handler can surface per-user + per-org metadata.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ONLINE_WINDOW_SECONDS = 300;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. JWT verification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error("[inbound-route] Auth error:", userError);
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    // 2. Look up the caller's profile + organization
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !profile?.organization_id) {
      console.error("[inbound-route] Profile lookup failed:", profileErr);
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    const organizationId = profile.organization_id;

    // 3. Inbound routing settings for the org (row guaranteed by Phase 1 backfill)
    const { data: settings } = await supabase
      .from("inbound_routing_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();

    // 4. Online agent count (presence window = 5 min)
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
    const { count: onlineAgentCount } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("inbound_enabled", true)
      .gt("last_seen_at", cutoff);

    // 5. Unread voicemail count — personal inbox (this user) + org-wide unassigned
    const { count: personalUnread } = await supabase
      .from("voicemails")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("agent_id", user.id)
      .eq("is_read", false);

    const { count: orgUnread } = await supabase
      .from("voicemails")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("agent_id", null)
      .eq("is_read", false);

    return new Response(
      JSON.stringify({
        settings: settings ?? null,
        online_agent_count: onlineAgentCount ?? 0,
        unread_voicemail_count: (personalUnread ?? 0) + (orgUnread ?? 0),
        unread_personal_count: personalUnread ?? 0,
        unread_org_count: orgUnread ?? 0,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    console.error("[inbound-route] Execution error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
