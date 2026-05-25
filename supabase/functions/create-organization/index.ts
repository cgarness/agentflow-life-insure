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

    // Securely create organization via service role.
    // AFTER INSERT trigger on public.organizations seeds:
    //   - default appointment_types (handle_new_organization_seed_appointment_types)
    //   - default pipeline_stages (handle_new_organization_seed_pipeline_stages)
    // Pipeline stages MUST NOT be seeded here — DB trigger is canonical.
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

    // Seed Dispositions only — pipeline stages handled by DB trigger.
    await seedOrganizationDispositions(adminClient, org.id);

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
 * Seeds default Dispositions for a new organization.
 * Failures are logged but handled non-fatally to ensure org creation completes.
 *
 * Pipeline stages are seeded by the DB trigger
 * on_organization_created_seed_pipeline_stages — do NOT add pipeline-stage
 * inserts here. Appointment types are seeded by their own DB trigger.
 */
async function seedOrganizationDispositions(supabase: any, organizationId: string) {
  try {
    console.log(`[SEED] Starting disposition seed for org: ${organizationId}`);

    // Canonical fields only (campaign_action, dnc_auto_add). Legacy columns
    // remove_from_queue / auto_add_to_dnc are deprecated; do not write.
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

    console.log(`[SEED] Completed disposition seed for org: ${organizationId}`);
  } catch (err) {
    console.error(`[SEED] Critical failure in seedOrganizationDispositions:`, err);
  }
}
