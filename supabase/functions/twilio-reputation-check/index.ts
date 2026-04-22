import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { SUPER_ADMIN_EMAIL, MAX_CHECKS_PER_NUMBER_PER_UTC_DAY } from "./constants.ts";
import { digitsOnly } from "./phone.ts";
import { createOutboundReport, pollOutboundReportForHandle } from "./twilioInsights.ts";
import { computeReputation, extractReportMetrics } from "./scoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  phone_number: z.string().min(8, "phone_number required"),
});

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toE164Plus(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const d = digitsOnly(raw);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

type PhoneRow = {
  id: string;
  organization_id: string | null;
  phone_number: string;
  assigned_to: string | null;
  daily_call_count: number | null;
  attestation_level: string | null;
};

function buildCarrierPanel(
  row: Record<string, unknown> | null,
): Array<{ name: string; blocking_rate: number | null; completion_rate?: number | null; spam_label?: string | null }> {
  const big3 = ["AT&T", "Verizon", "T-Mobile"];
  const out: Array<{ name: string; blocking_rate: number | null; completion_rate?: number | null; spam_label?: string | null }> = [];
  const nested = row?.carriers ?? row?.carrier_breakdown ?? row?.carrier_metrics;
  if (Array.isArray(nested)) {
    for (const name of big3) {
      const hit = nested.find((c) => {
        const o = c as Record<string, unknown>;
        const n = String(o.name ?? o.carrier ?? o.network ?? "").toLowerCase();
        return n.includes(name.toLowerCase().replace("&", "")) ||
          (name === "T-Mobile" && (n.includes("tmobile") || n.includes("t mobile")));
      }) as Record<string, unknown> | undefined;
      const br = typeof hit?.blocking_rate === "number"
        ? hit.blocking_rate
        : typeof hit?.blocked_calls_percentage === "number"
        ? hit.blocked_calls_percentage
        : null;
      out.push({
        name,
        blocking_rate: br != null ? Number(br) : null,
        completion_rate: typeof hit?.completion_rate === "number" ? hit.completion_rate : null,
        spam_label: hit?.spam_label != null ? String(hit.spam_label) : null,
      });
    }
    return out;
  }
  for (const name of big3) {
    out.push({
      name,
      blocking_rate: null,
      spam_label: row
        ? "No per-carrier breakdown in this Insights row (aggregate metrics only)."
        : "No Insights row matched this number yet.",
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const jwt = authHeader.replace("Bearer ", "");

  // Validate the caller JWT with the **anon** client. GoTrue `/user` + user JWT
  // is unreliable when the client was created with the service role key only.
  const supabaseAuth = createClient(supabaseUrl, anonKey);
  const { data: authData, error: authErr } = await supabaseAuth.auth.getUser(jwt);
  if (authErr || !authData?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const user = authData.user;
  const email = String(user.email ?? "").toLowerCase();
  const isSuperEmail = email === SUPER_ADMIN_EMAIL.toLowerCase();

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.flatten().fieldErrors }, 400);
  }
  const phoneE164 = toE164Plus(parsed.data.phone_number);
  if (!phoneE164.startsWith("+")) {
    return jsonResponse({ error: "Invalid phone_number" }, 400);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id, role, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[twilio-reputation-check] profile", profileError.message);
    return jsonResponse({ error: "Could not load profile" }, 500);
  }

  const orgId = profile?.organization_id as string | null | undefined;
  if (!isSuperEmail && !orgId) {
    return jsonResponse({ error: "Organization not found for user" }, 400);
  }

  let phoneQuery = supabase
    .from("phone_numbers")
    .select("id, organization_id, phone_number, assigned_to, daily_call_count, attestation_level")
    .eq("phone_number", phoneE164)
    .eq("status", "active");

  if (!isSuperEmail) {
    phoneQuery = phoneQuery.eq("organization_id", orgId!);
  }

  const { data: phoneRow, error: phoneErr } = await phoneQuery.maybeSingle();

  if (phoneErr || !phoneRow?.id || !phoneRow.organization_id) {
    return jsonResponse({ error: "Phone number not found or not active for your organization" }, 404);
  }

  const row = phoneRow as PhoneRow;
  const role = String((profile as { role?: string })?.role ?? "");
  const isSuperProfile = (profile as { is_super_admin?: boolean })?.is_super_admin === true;
  const isAdmin = isSuperEmail || isSuperProfile || role === "Admin" || role === "Super Admin";
  const isTeamLeader = role === "Team Leader" || role === "Team Lead";
  const isAgent = role === "Agent";

  let allowed = false;
  if (isSuperEmail) allowed = true;
  else if (isAdmin || isTeamLeader) allowed = true;
  else if (isAgent && row.assigned_to === user.id) allowed = true;

  if (!allowed) {
    return jsonResponse({
      error: "Only Admin, Team Leader, or the agent assigned to this number may run a reputation check.",
    }, 403);
  }

  if (!isSuperEmail) {
    const startUtc = new Date();
    startUtc.setUTCHours(0, 0, 0, 0);
    const { count, error: cErr } = await supabase
      .from("phone_number_reputation_checks")
      .select("id", { count: "exact", head: true })
      .eq("phone_number_id", row.id)
      .gte("created_at", startUtc.toISOString());
    if (cErr) {
      console.error("[twilio-reputation-check] rate count", cErr.message);
      return jsonResponse({ error: "Rate limit check failed" }, 500);
    }
    if ((count ?? 0) >= MAX_CHECKS_PER_NUMBER_PER_UTC_DAY) {
      return jsonResponse({
        error: `Maximum ${MAX_CHECKS_PER_NUMBER_PER_UTC_DAY} reputation checks per number per UTC day reached.`,
      }, 429);
    }
  }

  const { data: settingsRow, error: settingsError } = await supabase
    .from("phone_settings")
    .select("account_sid, auth_token")
    .eq("organization_id", row.organization_id)
    .maybeSingle();

  if (settingsError || !settingsRow) {
    return jsonResponse({ error: "Could not load phone settings for organization" }, 500);
  }

  const accountSid = String(settingsRow.account_sid ?? "").trim();
  const authToken = String(settingsRow.auth_token ?? "").trim();
  if (!accountSid || !authToken) {
    return jsonResponse({ error: "Twilio credentials not configured in Phone Settings." }, 400);
  }

  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const created = await createOutboundReport(accountSid, authToken, startIso, endIso);
  if (!created.ok) {
    return jsonResponse({
      error: "Twilio Insights report could not be created",
      twilio_status: created.status,
      detail: created.body,
    }, 502);
  }

  let twilioRow: Record<string, unknown> | null = null;
  try {
    const polled = await pollOutboundReportForHandle(
      accountSid,
      authToken,
      created.report_id,
      row.phone_number,
      { maxAttempts: 35, delayMs: 2000 },
    );
    twilioRow = polled.row;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 502);
  }

  const nowIso = new Date().toISOString();
  const carriers = buildCarrierPanel(twilioRow);

  if (!twilioRow) {
    const carrier_reputation_data = {
      schema_version: 2,
      source: "twilio_voice_insights_outbound",
      report_id: created.report_id,
      window: { start: startIso, end: endIso },
      carriers,
      display_health: "Insufficient Data",
      computed: { reason: "no_matching_handle_in_report" },
    };
    const { error: upErr } = await supabase
      .from("phone_numbers")
      .update({
        spam_status: "Insufficient Data",
        spam_score: null,
        spam_checked_at: nowIso,
        carrier_reputation_data,
      })
      .eq("id", row.id)
      .eq("organization_id", row.organization_id);

    if (upErr) return jsonResponse({ error: upErr.message }, 500);

    await supabase.from("phone_number_reputation_checks").insert({
      organization_id: row.organization_id,
      phone_number_id: row.id,
      checked_by: user.id,
    });

    return jsonResponse({
      success: true,
      spam_status: "Insufficient Data",
      spam_score: null,
      message: "Twilio returned no metrics row for this caller ID in the report (volume window or top-N list).",
    }, 200);
  }

  const metrics = extractReportMetrics(twilioRow, row.daily_call_count, row.attestation_level);
  const computed = computeReputation(metrics);

  const carrier_reputation_data = {
    schema_version: 2,
    source: "twilio_voice_insights_outbound",
    report_id: created.report_id,
    window: { start: startIso, end: endIso },
    carriers,
    display_health: computed.display_health,
    computed: {
      spam_score: computed.spam_score,
      spam_status: computed.spam_status,
      penalties: computed.penalties,
      metrics: computed.metrics,
    },
    twilio_row_keys: Object.keys(twilioRow),
  };

  const patch: Record<string, unknown> = {
    spam_status: computed.spam_status,
    spam_score: computed.spam_score,
    spam_checked_at: nowIso,
    carrier_reputation_data,
  };
  if (computed.metrics.attestation_level && computed.metrics.attestation_level !== row.attestation_level) {
    patch.attestation_level = computed.metrics.attestation_level;
  }

  const { error: upErr2 } = await supabase
    .from("phone_numbers")
    .update(patch)
    .eq("id", row.id)
    .eq("organization_id", row.organization_id);

  if (upErr2) return jsonResponse({ error: upErr2.message }, 500);

  await supabase.from("phone_number_reputation_checks").insert({
    organization_id: row.organization_id,
    phone_number_id: row.id,
    checked_by: user.id,
  });

  return jsonResponse({
    success: true,
    spam_status: computed.spam_status,
    spam_score: computed.spam_score,
    display_health: computed.display_health,
  }, 200);
});
