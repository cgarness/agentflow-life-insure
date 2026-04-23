import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // Note: We use the user's JWT to initialize the client.
    // This physically enforces PostgreSQL RLS on all operations below!
    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json();
    const { type, contactData, assignment, duplicateHandling, duplicateDetectionRule } = body;

    // Get the executing user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");
    
    // Fetch user profile to get org_id
    const { data: profile } = await supabaseClient.from("profiles").select("organization_id, role").eq("id", user.id).single();
    const orgId = profile?.organization_id;
    if (!orgId) throw new Error("User has no organization_id");

    // 1. The Bouncer: Validate Target Agent IDs via RLS
    // A Manager can only see 'profiles' in their downline due to PostgreSQL RLS.
    // So if they request assignment to an ID they can't query, it's a spoof!
    let targetIds: string[] = [];
    if (assignment.strategy === "self") {
      targetIds = [user.id];
    } else if (assignment.strategy === "specific_agent" && assignment.targetAgentId) {
      targetIds = [assignment.targetAgentId];
    } else if (assignment.strategy === "round_robin" && assignment.targetAgentIds?.length > 0) {
      targetIds = assignment.targetAgentIds;
    } else {
      targetIds = [user.id]; // fallback
    }

    // Explicitly query profiles for these IDs
    const { data: allowedProfiles, error: profilesError } = await supabaseClient
      .from("profiles")
      .select("id")
      .in("id", targetIds);

    if (profilesError) throw new Error(`Profiles check failed: ${profilesError.message}`);
    
    if (allowedProfiles.length !== targetIds.length) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden: Attempted to assign leads to an agent outside of your authorized organization/downline." }),
        { status: 403, headers }
      );
    }

    // 2. Setup Loop Arrays
    const conflicts: any[] = [];
    const readyToInsert: any[] = [];
    let roundRobinIndex = 0;
    
    // Get existing contacts from this org to compare
    const tableName = type === "clients" ? "clients" : (type === "recruits" ? "recruits" : "leads");
    const { data: existingContacts, error: ContactsError } = await supabaseClient
      .from(tableName)
      .select("id, phone, email, first_name, last_name, assigned_agent_id")
      .eq("organization_id", orgId);
      
    if (ContactsError) throw new Error(`Failed referencing org contacts: ${ContactsError.message}`);

    // Helpers
    const normalizePhone = (p: string) => (p || "").replace(/\D/g, "");
    const normalizeEmail = (e: string) => (e || "").toLowerCase().trim();

    // 3. Process Rows
    for (const row of contactData) {
      const impPhone = normalizePhone(row.phone);
      const impEmail = normalizeEmail(row.email);

      let isDuplicate = false;
      let matchedDbRow = null;

      // Duplicate Check against RLS-scoped existing Contacts
      for (const ex of existingContacts || []) {
        const exPhone = normalizePhone(ex.phone);
        const exEmail = normalizeEmail(ex.email);
        
        let match = false;
        if (duplicateDetectionRule === "phone_only" && impPhone && impPhone === exPhone) match = true;
        else if (duplicateDetectionRule === "email_only" && impEmail && impEmail === exEmail) match = true;
        else if (duplicateDetectionRule === "phone_and_email" && impPhone === exPhone && impEmail === exEmail && impPhone && impEmail) match = true;
        else if ((duplicateDetectionRule === "phone_or_email" || !duplicateDetectionRule) && ((impPhone && impPhone === exPhone) || (impEmail && impEmail === exEmail))) match = true;

        if (match) {
          isDuplicate = true;
          matchedDbRow = ex;
          break;
        }
      }

      // Assignment Routing
      const assigned_agent_id = targetIds[roundRobinIndex % targetIds.length];
      roundRobinIndex++;

      // Inject strict backend fields mapping
      const mappedRow = {
        first_name: row.firstName || "",
        last_name: row.lastName || "",
        phone: row.phone || "",
        email: row.email || "",
        state: row.state || "",
        status: row.status || "New",
        [tableName === "leads" ? "lead_source" : "source"]: row.leadSource || "CSV Import",
        lead_score: row.leadScore ?? 5,
        assigned_agent_id,
        ...(tableName === "leads" ? { user_id: assigned_agent_id } : {}),
        organization_id: orgId, // Always stamp orgId centrally
        age: row.age || null,
        date_of_birth: row.dateOfBirth || null,
        best_time_to_call: row.bestTimeToCall || null,
        notes: row.notes || null,
        custom_fields: row.customFields || null,
      };

      if (isDuplicate) {
        // Holding Pen
        conflicts.push({
          imported_row: mappedRow,
          existing_db_row: matchedDbRow
        });
      } else {
        readyToInsert.push(mappedRow);
      }
    }

    // 4. Batch Insert Valid Rows
    let imported = 0;
    if (readyToInsert.length > 0) {
      // Because we use the user's JWT, RLS applies. 
      // Admin/Manager policy allows creating for their org.
      const { error: insertError } = await supabaseClient
        .from(tableName)
        .insert(readyToInsert);
        
      if (insertError) throw new Error(`Batch insert failed: ${insertError.message}`);
      imported = readyToInsert.length;
    }

    // 5. Construct The Receipt
    return new Response(
      JSON.stringify({ 
        success: true, 
        imported, 
        conflicts_count: conflicts.length,
        conflicts
      }),
      { status: 200, headers }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 400, headers }
    );
  }
});
