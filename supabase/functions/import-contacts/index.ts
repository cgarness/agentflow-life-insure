import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DuplicateRule = "phone_only" | "email_only" | "phone_or_email" | "phone_and_email";
type DuplicateScope = "all_agents" | "assigned_only";
type CsvAction = "skip" | "flag" | "import";

// ── Canonical US-state normalizer (Build 2b) ────────────────────────────────
// BYTE-FOR-BYTE mirror of the SQL public.normalize_us_state(text) and the TS
// normalizeUsState() in src/utils/stateUtils.ts. This three-way identity keeps
// Phase 3's licensed-state dialer filter from silently dropping leads. Trim +
// case-insensitive; valid 2-letter → UPPERCASE; full name (50 + DC) → code;
// blanks/unrecognized returned UNCHANGED. (Edge fn duplicates the map because it
// cannot import from src/.)
const US_STATE_NAME_TO_CODE: Record<string, string> = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
  "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
  "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
  "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
  "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
  "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
  "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
  "district of columbia": "DC",
};
const US_STATE_CODES: Set<string> = new Set(Object.values(US_STATE_NAME_TO_CODE));

function normalizeUsState(raw: string | null | undefined): string | null | undefined {
  if (raw === null || raw === undefined) return raw;
  const trimmed = raw.trim();
  if (trimmed === "") return raw; // blank untouched
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper; // valid 2-letter → uppercase
  const fromName = US_STATE_NAME_TO_CODE[trimmed.toLowerCase()];
  if (fromName) return fromName; // full name → code
  return raw; // unrecognized untouched (don't invent)
}

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
    const {
      type,
      contactData,
      assignment,
      duplicateDetectionRule,
      duplicateDetectionScope,
      csvAction: csvActionRaw,
    } = body || {};

    if (!Array.isArray(contactData)) {
      throw new Error("`contactData` must be an array");
    }
    if (contactData.length === 0) {
      throw new Error("`contactData` is empty — no rows to import");
    }
    if (!assignment || typeof assignment !== "object") {
      throw new Error("`assignment` is missing");
    }

    const rule: DuplicateRule = (duplicateDetectionRule as DuplicateRule) || "phone_or_email";
    const scope: DuplicateScope = (duplicateDetectionScope as DuplicateScope) || "all_agents";
    const csvAction: CsvAction = (csvActionRaw as CsvAction) || "flag";

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
    const strategy = assignment.strategy as string | undefined;
    const isUnassignedLeadImport = strategy === "unassigned" && type !== "clients" && type !== "recruits";

    let targetIds: string[] = [];
    let skipAgentValidation = false;

    if (isUnassignedLeadImport) {
      targetIds = [];
      skipAgentValidation = true;
    } else if (strategy === "self") {
      targetIds = [user.id];
    } else if (strategy === "specific_agent" && assignment.targetAgentId) {
      targetIds = [assignment.targetAgentId];
    } else if (strategy === "round_robin" && Array.isArray(assignment.targetAgentIds) && assignment.targetAgentIds.length > 0) {
      targetIds = assignment.targetAgentIds;
    } else {
      targetIds = [user.id];
    }

    stage = "validate_target_agents";
    if (!skipAgentValidation && targetIds.length > 0) {
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
    const rejected: { reason: string; phone: string; first_name: string; last_name: string }[] = [];
    const flaggedRows: any[] = [];
    const cleanRows: any[] = [];
    let skippedDuplicates = 0;
    let roundRobinIndex = 0;

    for (const row of contactData) {
      const impPhone = normalizePhone(row?.phone);
      const impEmail = normalizeEmail(row?.email);
      const firstName = (row?.firstName ?? "").toString().trim();
      const lastName = (row?.lastName ?? "").toString().trim();

      // Server-side minimum required check (core fields only).
      if (!firstName || !lastName || !impPhone) {
        rejected.push({
          reason: "Missing required core field (first name, last name, or phone)",
          phone: row?.phone ?? "",
          first_name: firstName,
          last_name: lastName,
        });
        continue;
      }

      let assigned_agent_id: string | null = null;
      let user_id_for_row: string | null = null;
      if (!isUnassignedLeadImport) {
        assigned_agent_id = targetIds[roundRobinIndex % targetIds.length];
        user_id_for_row = assigned_agent_id;
        roundRobinIndex++;
      }

      // Duplicate detection (scoped per settings).
      let isDuplicate = false;
      let matchedDbRow: any = null;
      for (const ex of existingContacts || []) {
        const exPhone = normalizePhone(ex.phone);
        const exEmail = normalizeEmail(ex.email);

        // Scope filter: assigned_only means only treat existing rows owned by
        // the same agent as the row we're about to assign as duplicates.
        if (scope === "assigned_only" && assigned_agent_id && ex.assigned_agent_id !== assigned_agent_id) {
          continue;
        }

        let match = false;
        if (rule === "phone_only") match = !!impPhone && impPhone === exPhone;
        else if (rule === "email_only") match = !!impEmail && impEmail === exEmail;
        else if (rule === "phone_and_email") match = !!impPhone && !!impEmail && impPhone === exPhone && impEmail === exEmail;
        else match = (!!impPhone && impPhone === exPhone) || (!!impEmail && impEmail === exEmail);

        if (match) {
          isDuplicate = true;
          matchedDbRow = ex;
          break;
        }
      }

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
        first_name: firstName,
        last_name: lastName,
        phone: (row?.phone ?? "").toString(),
        email: (row?.email ?? "").toString(),
        state: normalizeUsState((row?.state ?? "").toString()),
        notes: row?.notes ?? null,
        assigned_agent_id,
        organization_id: orgId,
      };

      // Merge incoming customFields and (if flagging) the duplicate marker.
      // Marker contract: custom_fields.__agentflow.duplicateImport = true and
      // custom_fields.tags includes "Duplicate". Existing values are preserved.
      const incomingCf: Record<string, any> = (row?.customFields && typeof row.customFields === "object")
        ? { ...row.customFields }
        : {};
      const applyDuplicateMarker = (cf: Record<string, any>) => {
        const meta = (cf.__agentflow && typeof cf.__agentflow === "object") ? { ...cf.__agentflow } : {};
        meta.duplicateImport = true;
        cf.__agentflow = meta;
        const existingTags = Array.isArray(cf.tags) ? cf.tags.filter((t: unknown) => typeof t === "string") : [];
        if (!existingTags.includes("Duplicate")) existingTags.push("Duplicate");
        cf.tags = existingTags;
        return cf;
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
          custom_fields: Object.keys(incomingCf).length > 0 ? incomingCf : null,
          user_id: user_id_for_row,
          // Importer provenance — the authenticated user who ran this import.
          // Stamped on EVERY imported lead (incl. unassigned strategy, where
          // user_id/assigned_agent_id are null) so RLS can scope the unassigned
          // pool to "leads this Team Leader personally imported".
          imported_by_user_id: user.id,
        };
      } else if (tableName === "clients") {
        mappedRow = {
          ...baseRow,
          custom_fields: Object.keys(incomingCf).length > 0 ? incomingCf : null,
        };
      } else {
        // recruits — custom_fields column added in Build 5 migration.
        mappedRow = {
          ...baseRow,
          status: row?.status || "New",
          custom_fields: Object.keys(incomingCf).length > 0 ? incomingCf : null,
        };
      }

      if (isDuplicate) {
        conflicts.push({ imported_row: mappedRow, existing_db_row: matchedDbRow });
        if (csvAction === "skip") {
          skippedDuplicates++;
          continue;
        }
        if (csvAction === "flag") {
          const cf = mappedRow.custom_fields && typeof mappedRow.custom_fields === "object"
            ? { ...mappedRow.custom_fields }
            : {};
          mappedRow.custom_fields = applyDuplicateMarker(cf);
          flaggedRows.push(mappedRow);
          continue;
        }
        // csvAction === "import" → fall through to clean insert without marker.
      }
      cleanRows.push(mappedRow);
    }

    stage = "insert";
    let imported = 0;
    let flagged = 0;
    let insertedLeadIds: string[] = [];

    const insertBatch = async (rows: any[]) => {
      if (rows.length === 0) return [] as any[];
      const { data: insertedRows, error: insertError } = await serviceClient
        .from(tableName)
        .insert(rows)
        .select("id");
      if (insertError) throw new Error(`Batch insert failed: ${insertError.message}`);
      return insertedRows ?? [];
    };

    const cleanInserted = await insertBatch(cleanRows);
    const flaggedInserted = await insertBatch(flaggedRows);
    imported = cleanRows.length + flaggedRows.length;
    flagged = flaggedRows.length;

    if (tableName === "leads") {
      insertedLeadIds = [...cleanInserted, ...flaggedInserted]
        .map((r: { id: string }) => r.id)
        .filter(Boolean);
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        conflicts_count: conflicts.length,
        skipped_duplicates: skippedDuplicates,
        flagged_duplicates: flagged,
        rejected_count: rejected.length,
        rejected,
        conflicts,
        inserted_lead_ids: insertedLeadIds,
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
