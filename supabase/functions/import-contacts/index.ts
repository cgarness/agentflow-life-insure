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

  // Stage is echoed back in the error payload so the client can pinpoint
  // where the failure happened without us having to tail production logs.
  let stage = "init";

  try {
    stage = "parse_auth_header";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) throw new Error("Authorization header is empty");

    stage = "read_env";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured on the function");
    if (!supabaseAnonKey) throw new Error("SUPABASE_ANON_KEY is not configured on the function");
    if (!supabaseServiceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the function");

    // Anon client used only for validating the user's JWT.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    // Service client used for all DB reads/writes — the function enforces
    // authorization in-code (org membership + target-agent validation) before
    // any insert, so RLS bypass is safe and keeps the flow predictable.
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    stage = "parse_body";
    let body: any;
    try {
      body = await req.json();
    } catch {
      throw new Error("Request body is not valid JSON");
    }
    const { type, contactData, assignment, duplicateDetectionRule } = body || {};

    if (!Array.isArray(contactData)) {
      throw new Error("`contactData` must be an array");
    }
    if (contactData.length === 0) {
      throw new Error("`contactData` is empty — no rows to import");
    }
    if (!assignment || typeof assignment !== "object") {
      throw new Error("`assignment` is missing");
    }

    stage = "validate_jwt";
    // IMPORTANT: pass the JWT explicitly. `getUser()` with no args depends on
    // session storage which does not exist in the Deno edge runtime, so it
    // returns AuthSessionMissingError and the function would falsely 401.
    const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError) throw new Error(`Unauthorized: ${authError.message}`);
    if (!user) throw new Error("Unauthorized: no user in token");

    stage = "load_profile";
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("organization_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw new Error(`Profile lookup failed: ${profileError.message}`);
    if (!profile) throw new Error("User profile not found");
    const orgId = profile.organization_id;
    if (!orgId) throw new Error("User has no organization_id — set organization on the profile");

    stage = "resolve_target_agents";
    let targetIds: string[] = [];
    if (assignment.strategy === "self") {
      targetIds = [user.id];
    } else if (assignment.strategy === "specific_agent" && assignment.targetAgentId) {
      targetIds = [assignment.targetAgentId];
    } else if (assignment.strategy === "round_robin" && Array.isArray(assignment.targetAgentIds) && assignment.targetAgentIds.length > 0) {
      targetIds = assignment.targetAgentIds;
    } else {
      // Fall back to self rather than 400 — the modal always sends a valid
      // strategy, but an empty specific/round-robin selection shouldn't break
      // the whole import.
      targetIds = [user.id];
    }

    stage = "validate_target_agents";
    const { data: allowedProfiles, error: profilesError } = await serviceClient
      .from("profiles")
      .select("id")
      .in("id", targetIds)
      .eq("organization_id", orgId);

    if (profilesError) throw new Error(`Profiles check failed: ${profilesError.message}`);
    if (!allowedProfiles || allowedProfiles.length !== targetIds.length) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Forbidden: one or more target agents are outside your organization.",
          stage,
        }),
        { status: 403, headers }
      );
    }

    stage = "fetch_existing";
    const tableName = type === "clients" ? "clients" : (type === "recruits" ? "recruits" : "leads");

    const { data: existingContacts, error: contactsError } = await serviceClient
      .from(tableName)
      .select("id, phone, email, first_name, last_name, assigned_agent_id")
      .eq("organization_id", orgId);

    if (contactsError) throw new Error(`Failed fetching existing contacts: ${contactsError.message}`);

    const normalizePhone = (p: unknown) => (typeof p === "string" ? p : "").replace(/\D/g, "");
    const normalizeEmail = (e: unknown) => (typeof e === "string" ? e : "").toLowerCase().trim();

    stage = "build_rows";
    const conflicts: any[] = [];
    const readyToInsert: any[] = [];
    let roundRobinIndex = 0;

    for (const row of contactData) {
      const impPhone = normalizePhone(row?.phone);
      const impEmail = normalizeEmail(row?.email);

      let isDuplicate = false;
      let matchedDbRow: any = null;

      for (const ex of existingContacts || []) {
        const exPhone = normalizePhone(ex.phone);
        const exEmail = normalizeEmail(ex.email);

        let match = false;
        if (duplicateDetectionRule === "phone_only" && impPhone && impPhone === exPhone) match = true;
        else if (duplicateDetectionRule === "email_only" && impEmail && impEmail === exEmail) match = true;
        else if (duplicateDetectionRule === "phone_and_email" && impPhone && impEmail && impPhone === exPhone && impEmail === exEmail) match = true;
        else if ((duplicateDetectionRule === "phone_or_email" || !duplicateDetectionRule) && ((impPhone && impPhone === exPhone) || (impEmail && impEmail === exEmail))) match = true;

        if (match) {
          isDuplicate = true;
          matchedDbRow = ex;
          break;
        }
      }

      const assigned_agent_id = targetIds[roundRobinIndex % targetIds.length];
      roundRobinIndex++;

      // Coerce age to a valid integer or null — the leads table stores it as
      // integer and any non-numeric string would cause the entire batch insert
      // to fail with "invalid input syntax for type integer".
      let ageVal: number | null = null;
      if (row?.age !== undefined && row?.age !== null && row?.age !== "") {
        const parsed = typeof row.age === "number" ? row.age : parseInt(String(row.age), 10);
        if (Number.isFinite(parsed)) ageVal = parsed;
      }

      // Shared columns that exist on every contact table.
      const baseRow: Record<string, any> = {
        first_name: (row?.firstName ?? "").toString(),
        last_name: (row?.lastName ?? "").toString(),
        phone: (row?.phone ?? "").toString(),
        email: (row?.email ?? "").toString(),
        state: (row?.state ?? "").toString(),
        notes: row?.notes ?? null,
        assigned_agent_id,
        organization_id: orgId,
      };

      let mappedRow: Record<string, any>;
      if (tableName === "leads") {
        mappedRow = {
          ...baseRow,
          status: row?.status || "New",
          lead_source: row?.leadSource || "CSV Import",
          lead_score: Number.isFinite(row?.leadScore) ? row.leadScore : 5,
          age: ageVal,
          date_of_birth: row?.dateOfBirth || null,
          best_time_to_call: row?.bestTimeToCall || null,
          custom_fields: row?.customFields || null,
          user_id: assigned_agent_id,
        };
      } else if (tableName === "clients") {
        mappedRow = {
          ...baseRow,
          custom_fields: row?.customFields || null,
        };
      } else {
        // recruits
        mappedRow = {
          ...baseRow,
          status: row?.status || "New",
        };
      }

      if (isDuplicate) {
        conflicts.push({ imported_row: mappedRow, existing_db_row: matchedDbRow });
      } else {
        readyToInsert.push(mappedRow);
      }
    }

    stage = "insert";
    let imported = 0;
    if (readyToInsert.length > 0) {
      const { error: insertError } = await serviceClient
        .from(tableName)
        .insert(readyToInsert);

      if (insertError) {
        throw new Error(`Batch insert failed: ${insertError.message}`);
      }
      imported = readyToInsert.length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        conflicts_count: conflicts.length,
        conflicts,
      }),
      { status: 200, headers }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    console.error(`[import-contacts] stage=${stage} error=${message}`);
    return new Response(
      JSON.stringify({ success: false, error: message, stage }),
      { status: 400, headers }
    );
  }
});
