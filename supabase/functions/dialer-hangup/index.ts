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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. JWT Verification
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No authorization header");
    
    // Validate token and get user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error("[dialer-hangup] Auth error:", userError);
      throw new Error("Invalid or expired user session. Please log in again.");
    }

    const body = await req.json();
    const { call_id, call_control_id } = body;

    console.log(`[dialer-hangup] Received hangup request for Call ID: ${call_id}`, { call_control_id });

    if (!call_id) throw new Error("Missing call_id parameter");

    // 2. Fetch call record to verify ownership and get details
    // We fetch with service role but verify agent_id matching the authenticated user
    const { data: call, error: fetchError } = await supabaseClient
      .from("calls")
      .select("id, telnyx_call_control_id, organization_id, agent_id, started_at, status")
      .eq("id", call_id)
      .maybeSingle();

    if (fetchError) throw new Error(`Database fetch error: ${fetchError.message}`);
    if (!call) throw new Error("Call record not found");
    
    // Security: Only allow the agent who owns the call or someone in the same organization
    // for this implementation, we strictly check agent_id for individual calls.
    if (call.agent_id !== user.id) {
       console.error(`[dialer-hangup] Security violation: User ${user.id} attempted to hang up call owned by ${call.agent_id}`);
       throw new Error("Security check failed: You do not have permission to terminate this call.");
    }

    const controlId = call_control_id || call.telnyx_call_control_id;
    const endedAt = new Date().toISOString();
    
    // 3. Mark the call as completed in the database first (Optimistic DB update)
    // This captures the intent to end even if the Telnyx API call fails or the leg is already dead.
    const startedAt = call.started_at ? new Date(call.started_at) : null;
    const duration = startedAt ? Math.round((new Date(endedAt).getTime() - startedAt.getTime()) / 1000) : 0;

    const { error: updateError } = await supabaseClient
      .from("calls")
      .update({
        status: "completed",
        ended_at: endedAt,
        duration: duration,
      })
      .eq("id", call_id)
      .eq("organization_id", call.organization_id); // Strict RLS scoping

    if (updateError) {
      console.error(`[dialer-hangup] Database update error for call ${call_id}:`, updateError);
      throw new Error(`Failed to update call record: ${updateError.message}`);
    }

    if (!controlId) {
       console.log(`[dialer-hangup] No Telnyx control ID found for ${call_id}. Marking call as ended in DB and returning.`);
       return new Response(JSON.stringify({ success: true, message: "Call record finalized in database (no active Telnyx leg found)", duration }), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
         status: 200,
       });
    }

    // 4. Fetch Telnyx API Key for the organization
    const { data: settings } = await supabaseClient
      .from("telnyx_settings")
      .select("api_key")
      .eq("organization_id", call.organization_id)
      .maybeSingle();

    let apiKey = settings?.api_key;
    if (!apiKey) {
      const { data: globalSettings } = await supabaseClient
        .from("telnyx_settings")
        .select("api_key")
        .eq("id", "00000000-0000-0000-0000-000000000001")
        .maybeSingle();
      apiKey = globalSettings?.api_key;
    }

    if (!apiKey) {
      console.warn(`[dialer-hangup] No Telnyx API key found for organization: ${call.organization_id}`);
      throw new Error("Cannot terminate call: No Telnyx API key configured for your organization.");
    }

    // 5. Force Hangup via Telnyx REST API (Terminates the PSTN leg)
    console.log(`[dialer-hangup] Sending hangup action to Telnyx for Control ID: ${controlId}`);
    const telnyxResponse = await fetch(`https://api.telnyx.com/v2/calls/${controlId}/actions/hangup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!telnyxResponse.ok) {
      const errorData = await telnyxResponse.json().catch(() => ({}));
      // 404 is acceptable — it means the call is already ended on Telnyx's side.
      if (telnyxResponse.status === 404) {
        console.log(`[dialer-hangup] Telnyx call already ended (404 Not Found) for ${controlId}`);
      } else {
        console.warn(`[dialer-hangup] Telnyx hangup API returned error [${telnyxResponse.status}]:`, JSON.stringify(errorData, null, 2));
      }
    } else {
      console.log(`[dialer-hangup] Telnyx hangup command accepted for control_id: ${controlId}`);
    }

    return new Response(JSON.stringify({ success: true, duration }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    console.error("[dialer-hangup] Execution error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
