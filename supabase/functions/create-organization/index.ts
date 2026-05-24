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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { name, slug } = await req.json();

    if (!name || !slug) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: name, slug" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Securely create organization via service role
    const { data: org, error: orgError } = await adminClient
      .from("organizations")
      .insert({ name, slug })
      .select("id")
      .single();

    if (orgError) {
      return new Response(
        JSON.stringify({ error: `Organization creation failed: ${orgError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Seed default data (Dispositions + Pipeline Stages) - Non-fatal
    await seedOrganizationData(adminClient, org.id);

    return new Response(
      JSON.stringify({ success: true, organization_id: org.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Seeds default configuration data for a new organization.
 * Failures are logged but handled non-fatally to ensure org creation completes.
 */
async function seedOrganizationData(supabase: any, organizationId: string) {
  try {
    console.log(`[SEED] Starting default configuration for org: ${organizationId}`);

    // 1. Seed Dispositions — canonical fields only (campaign_action, dnc_auto_add).
    //    Legacy columns remove_from_queue / auto_add_to_dnc are deprecated; do not write.
    const dispositions = [
      { name: "No Answer",       color: "#3B82F6", is_locked: true,  campaign_action: "none",                dnc_auto_add: false, organization_id: organizationId, sort_order: 0 },
      { name: "Appointment Set", color: "#10B981", is_locked: true,  campaign_action: "remove_from_queue",   dnc_auto_add: false, appointment_scheduler: true, organization_id: organizationId, sort_order: 1 },
      { name: "Call Back",       color: "#F59E0B", is_locked: false, campaign_action: "none",                dnc_auto_add: false, callback_scheduler: true,    organization_id: organizationId, sort_order: 2 },
      { name: "Not Interested",  color: "#EF4444", is_locked: false, campaign_action: "remove_from_campaign", dnc_auto_add: false, organization_id: organizationId, sort_order: 3 },
      { name: "DNC",             color: "#000000", is_locked: true,  campaign_action: "remove_from_campaign", dnc_auto_add: true,  organization_id: organizationId, sort_order: 4 },
      { name: "Sold",            color: "#059669", is_locked: false, campaign_action: "remove_from_queue",   dnc_auto_add: false, organization_id: organizationId, sort_order: 5 },
    ];

    const { error: dispError } = await supabase.from("dispositions").insert(dispositions);
    if (dispError) console.error(`[SEED] Error inserting dispositions:`, dispError);

    // 2. Seed Lead Pipeline Stages
    const leadStages = [
      { name: "New", color: "#3B82F6", pipeline_type: "lead", is_default: true, sort_order: 0, organization_id: organizationId },
      { name: "Attempting Contact", color: "#6366F1", pipeline_type: "lead", sort_order: 1, organization_id: organizationId },
      { name: "Appointment Set", color: "#10B981", pipeline_type: "lead", sort_order: 2, organization_id: organizationId },
      { name: "Quoted", color: "#F59E0B", pipeline_type: "lead", sort_order: 3, organization_id: organizationId },
      { name: "Sold", color: "#059669", pipeline_type: "lead", is_positive: true, convert_to_client: true, sort_order: 4, organization_id: organizationId },
      { name: "Dead", color: "#EF4444", pipeline_type: "lead", sort_order: 5, organization_id: organizationId },
    ];

    const { error: leadError } = await supabase.from("pipeline_stages").insert(leadStages);
    if (leadError) console.error(`[SEED] Error inserting lead pipeline stages:`, leadError);

    // 3. Seed Recruit Pipeline Stages
    const recruitStages = [
      { name: "New", color: "#3B82F6", pipeline_type: "recruit", is_default: true, sort_order: 0, organization_id: organizationId },
      { name: "Interview Scheduled", color: "#6366F1", pipeline_type: "recruit", sort_order: 1, organization_id: organizationId },
      { name: "Offer Made", color: "#F59E0B", pipeline_type: "recruit", sort_order: 2, organization_id: organizationId },
      { name: "Hired", color: "#10B981", pipeline_type: "recruit", is_positive: true, sort_order: 3, organization_id: organizationId },
      { name: "Not a Fit", color: "#EF4444", pipeline_type: "recruit", sort_order: 4, organization_id: organizationId },
    ];

    const { error: recruitError } = await supabase.from("pipeline_stages").insert(recruitStages);
    if (recruitError) console.error(`[SEED] Error inserting recruit pipeline stages:`, recruitError);

    console.log(`[SEED] Completed default configuration for org: ${organizationId}`);
  } catch (err) {
    console.error(`[SEED] Critical failure in seedOrganizationData:`, err);
  }
}
