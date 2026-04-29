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
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json().catch(() => ({}));
    const userId = typeof body?.user_id === "string" ? body.user_id : null;
    const orgId = typeof body?.organization_id === "string" ? body.organization_id : null;

    let q = admin
      .from("user_email_connections")
      .select("id, user_id, organization_id, provider, provider_account_email, access_token_expires_at, status")
      .eq("status", "connected");
    if (userId) q = q.eq("user_id", userId);
    if (orgId) q = q.eq("organization_id", orgId);

    const { data: connections, error } = await q.limit(100);
    if (error) return json({ success: false, error: error.message }, 500);

    // Placeholder pass: mark scan timestamps so status UI is accurate.
    // Provider API pull + contact matching/inserts are next step.
    const ids = (connections ?? []).map((c) => c.id);
    if (ids.length > 0) {
      await admin
        .from("user_email_connections")
        .update({ last_sync_at: new Date().toISOString(), last_error: null })
        .in("id", ids);
    }

    return json({
      success: true,
      scanned: ids.length,
      inserted: 0,
      failed: 0,
      note: "Sync worker foundation in place. Provider pull/mapping is next implementation step.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});

