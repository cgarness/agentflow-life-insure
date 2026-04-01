import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Extract token from query param (GET) or request body (POST)
    let token: string | null = null;
    let action: string | null = null;

    const url = new URL(req.url);
    token = url.searchParams.get("token");

    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (!token && body.token) token = body.token;
        if (body.action) action = body.action;
      } catch {
        // body may be empty for GET-style POST calls
      }
    }

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing token parameter" }),
        { status: 400, headers }
      );
    }

    // Validate the invitation using service role (bypasses RLS)
    const { data: invitation, error: queryError } = await supabaseAdmin
      .from("invitations")
      .select("id, email, role, first_name, last_name, organization_id, status, expires_at")
      .eq("token", token)
      .eq("status", "Pending")
      .gt("expires_at", new Date().toISOString())
      .single();

    if (queryError || !invitation) {
      return new Response(
        JSON.stringify({ success: false, error: "Invitation not found or expired" }),
        { status: 404, headers }
      );
    }

    // If action=accept, mark the invitation as Accepted
    if (action === "accept") {
      const { error: updateError } = await supabaseAdmin
        .from("invitations")
        .update({ status: "Accepted" })
        .eq("id", invitation.id);

      if (updateError) {
        return new Response(
          JSON.stringify({ success: false, error: `Failed to mark invitation accepted: ${updateError.message}` }),
          { status: 500, headers }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers }
      );
    }

    // Default: return invitation data for the accept-invite page to use
    return new Response(
      JSON.stringify({
        success: true,
        email: invitation.email,
        role: invitation.role,
        first_name: invitation.first_name,
        last_name: invitation.last_name,
        organization_id: invitation.organization_id,
        invitation_id: invitation.id,
      }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers }
    );
  }
});
