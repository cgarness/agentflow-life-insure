import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TELNYX_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

const extractAreaCode = (num: string) => {
  const cleaned = num.replace(/\D/g, "");
  const digits =
    cleaned.startsWith("1") && cleaned.length === 11
      ? cleaned.slice(1)
      : cleaned;
  return digits.slice(0, 3);
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
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Read Telnyx API key from telnyx_settings
    // Get the user from the auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("No authorization header");
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) throw new Error("Invalid user token");

    // Get the user's organization_id from their profile
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      throw new Error("User has no associated organization");
    }

    const organizationId = profile.organization_id;

    // Fetch settings for this organization
    const { data: settings, error: fetchError } = await supabaseClient
      .from("telnyx_settings")
      .select("api_key")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (fetchError) throw new Error(`DB error: ${fetchError.message}`);

    // Fallback to global settings if no organization-specific settings exist
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

    // 2. Fetch all phone numbers from Telnyx with pagination
    const allTelnyxNumbers: string[] = [];
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
        if (record.phone_number) {
          allTelnyxNumbers.push(record.phone_number);
        }
      }

      totalPages = json.meta?.total_pages ?? 1;
      currentPage++;
    }

    // 3. Check existing numbers in Supabase
    const { data: existingRows, error: existErr } = await supabaseClient
      .from("phone_numbers")
      .select("phone_number");

    if (existErr) throw new Error(`DB error: ${existErr.message}`);

    const existingSet = new Set(
      (existingRows || []).map((r: { phone_number: string }) => r.phone_number)
    );

    // 4. Upsert all numbers to ensure organization_id is set
    let synced = 0;
    if (allTelnyxNumbers.length > 0) {
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
    }

    const skipped = allTelnyxNumbers.length - synced;

    return new Response(
      JSON.stringify({
        synced,
        skipped,
        total: allTelnyxNumbers.length,
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
