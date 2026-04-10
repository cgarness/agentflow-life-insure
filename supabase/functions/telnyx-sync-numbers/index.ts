import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TELNYX_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

/** Same targets as telnyx-buy-number — AgentFlow Call Control + AgentFlow SMS profile */
const AGENTFLOW_CALL_CONTROL_ID = "2911194903079814357";
const AGENTFLOW_MESSAGING_PROFILE_ID = "40019cd5-f007-4511-93c2-216916e1da07";

const extractAreaCode = (num: string) => {
  const cleaned = num.replace(/\D/g, "");
  const digits =
    cleaned.startsWith("1") && cleaned.length === 11
      ? cleaned.slice(1)
      : cleaned;
  return digits.slice(0, 3);
};

type TelnyxPhoneRow = {
  id: string;
  phone_number: string;
  connection_id: unknown;
  messaging_profile_id: unknown;
};

const normRelationId = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "id" in v) {
    const id = (v as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
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
    let routingOnly = false;
    let applyAgentflowRouting = false;
    try {
      const body = await req.json();
      routingOnly = !!body?.routing_only;
      applyAgentflowRouting = !!body?.apply_agentflow_routing || routingOnly;
    } catch {
      // Empty body from older clients
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) throw new Error("Invalid user token");

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      throw new Error("User has no associated organization");
    }

    const organizationId = profile.organization_id;

    const { data: settings, error: fetchError } = await supabaseClient
      .from("telnyx_settings")
      .select("api_key")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (fetchError) throw new Error(`DB error: ${fetchError.message}`);

    let finalSettings = settings;
    if (!finalSettings?.api_key) {
      const { data: globalSettings } = await supabaseClient
        .from("telnyx_settings")
        .select("api_key")
        .eq("id", TELNYX_SETTINGS_ID)
        .maybeSingle();
      finalSettings = globalSettings;
    }

    if (!finalSettings?.api_key) {
      return new Response(
        JSON.stringify({
          error: "No Telnyx API key found. Save it in Settings first.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const apiKey = finalSettings.api_key;

    const telnyxRecords: TelnyxPhoneRow[] = [];
    let currentPage = 1;
    let totalPages = 1;

    while (currentPage <= totalPages) {
      const url = `https://api.telnyx.com/v2/phone_numbers?page[number]=${currentPage}&page[size]=250`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        return new Response(
          JSON.stringify({
            error: `Telnyx API error (${res.status}): ${body}`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const json = await res.json();
      const records = json.data || [];
      for (const record of records) {
        if (record.id && record.phone_number) {
          telnyxRecords.push({
            id: record.id,
            phone_number: record.phone_number,
            connection_id: record.connection_id,
            messaging_profile_id: record.messaging_profile_id,
          });
        }
      }

      totalPages = json.meta?.total_pages ?? 1;
      currentPage++;
    }

    const allTelnyxNumbers = telnyxRecords.map((r) => r.phone_number);

    let routing_updated = 0;
    let routing_skipped = 0;
    let routing_failed = 0;

    if (applyAgentflowRouting && telnyxRecords.length > 0) {
      for (const r of telnyxRecords) {
        const curConn = normRelationId(r.connection_id);
        const curMsg = normRelationId(r.messaging_profile_id);
        const needsPatch =
          curConn !== AGENTFLOW_CALL_CONTROL_ID ||
          curMsg !== AGENTFLOW_MESSAGING_PROFILE_ID;
        if (!needsPatch) {
          routing_skipped++;
          continue;
        }
        const patchRes = await fetch(
          `https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(r.id)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              connection_id: AGENTFLOW_CALL_CONTROL_ID,
              messaging_profile_id: AGENTFLOW_MESSAGING_PROFILE_ID,
            }),
          }
        );
        if (patchRes.ok) {
          routing_updated++;
        } else {
          routing_failed++;
          const errText = await patchRes.text();
          console.error(
            `[telnyx-sync-numbers] PATCH failed for ${r.phone_number}:`,
            errText
          );
        }
      }
    }

    let synced = 0;
    let skipped = 0;

    if (!routingOnly && allTelnyxNumbers.length > 0) {
      const rows = allTelnyxNumbers.map((phone_number) => ({
        phone_number,
        status: "active",
        is_default: false,
        area_code: extractAreaCode(phone_number),
        organization_id: organizationId,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertErr } = await supabaseClient
        .from("phone_numbers")
        .upsert(rows, { onConflict: "phone_number" });

      if (upsertErr) throw new Error(`Sync error: ${upsertErr.message}`);
      synced = allTelnyxNumbers.length;
      skipped = allTelnyxNumbers.length - synced;
    }

    return new Response(
      JSON.stringify({
        synced,
        skipped,
        total: allTelnyxNumbers.length,
        routing_only: routingOnly,
        routing: applyAgentflowRouting
          ? {
              updated: routing_updated,
              skipped: routing_skipped,
              failed: routing_failed,
            }
          : null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
