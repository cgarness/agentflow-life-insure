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
    const { data: settings, error: fetchError } = await supabaseClient
      .from("telnyx_settings")
      .select("api_key")
      .eq("id", TELNYX_SETTINGS_ID)
      .maybeSingle();

    if (fetchError) throw new Error(`DB error: ${fetchError.message}`);
    if (!settings?.api_key) {
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

    const apiKey = settings.api_key;

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

    // 4. Insert missing numbers
    const toInsert = allTelnyxNumbers.filter((n) => !existingSet.has(n));
    let synced = 0;

    if (toInsert.length > 0) {
      const rows = toInsert.map((phone_number) => ({
        phone_number,
        status: "active",
        is_default: false,
        area_code: extractAreaCode(phone_number),
        created_at: new Date().toISOString(),
      }));

      const { error: insertErr } = await supabaseClient
        .from("phone_numbers")
        .insert(rows);

      if (insertErr) throw new Error(`Insert error: ${insertErr.message}`);
      synced = toInsert.length;
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
