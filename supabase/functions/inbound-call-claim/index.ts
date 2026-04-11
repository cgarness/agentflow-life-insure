import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      console.error("[inbound-call-claim] Auth error:", userError);
      throw new Error("Invalid or expired user session.");
    }

    const body = await req.json();
    const call_control_id = typeof body?.call_control_id === "string" ? body.call_control_id.trim() : "";
    const telnyx_call_id = typeof body?.telnyx_call_id === "string" ? body.telnyx_call_id.trim() : "";

    if (!call_control_id && !telnyx_call_id) {
      throw new Error("Missing call_control_id and telnyx_call_id");
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      throw new Error("User has no organization");
    }

    const organizationId = profile.organization_id as string;

    let existing: { id: string; agent_id: string | null } | null = null;

    if (call_control_id) {
      const { data, error: fetchError } = await supabaseClient
        .from("calls")
        .select("id, agent_id")
        .eq("telnyx_call_control_id", call_control_id)
        .in("direction", ["inbound", "incoming"])
        .maybeSingle();

      if (fetchError) {
        console.error("[inbound-call-claim] Fetch by control_id error:", fetchError);
        throw new Error(fetchError.message);
      }
      existing = data;
    }

    if (!existing && telnyx_call_id) {
      const { data, error: fetchSessionErr } = await supabaseClient
        .from("calls")
        .select("id, agent_id")
        .eq("telnyx_call_id", telnyx_call_id)
        .in("direction", ["inbound", "incoming"])
        .maybeSingle();

      if (fetchSessionErr) {
        console.error("[inbound-call-claim] Fetch by telnyx_call_id error:", fetchSessionErr);
        throw new Error(fetchSessionErr.message);
      }
      existing = data;

      // Align control id when webhook row had session first or IDs diverged slightly.
      if (existing && call_control_id) {
        await supabaseClient
          .from("calls")
          .update({ telnyx_call_control_id: call_control_id, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      }
    }

    if (!existing) {
      return new Response(JSON.stringify({ id: null, claimed: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existing.agent_id != null && existing.agent_id !== user.id) {
      return new Response(JSON.stringify({ id: null, claimed: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: updated, error: updateError } = await supabaseClient
      .from("calls")
      .update({
        agent_id: user.id,
        organization_id: organizationId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("[inbound-call-claim] Update error:", updateError);
      throw new Error(updateError.message);
    }

    if (!updated?.id) {
      return new Response(JSON.stringify({ id: null, claimed: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[inbound-call-claim] User ${user.id} claimed inbound call row ${updated.id}`);

    return new Response(JSON.stringify({ id: updated.id, claimed: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[inbound-call-claim]", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
