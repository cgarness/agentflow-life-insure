import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSubaccountCreds } from "../_shared/twilioSubaccountCreds.ts";

const FN = "[twilio-search-numbers]";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SearchBody = {
  area_code?: string;
  locality?: string;
  state?: string;
  limit?: number;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error(`${FN} Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY`);
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(jwt);

    if (userError || !user) {
      console.error(`${FN} Auth error:`, userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      console.error(`${FN} Profile / organization:`, profileError?.message);
      return new Response(
        JSON.stringify({ error: "Organization not found for user" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const orgId = profile.organization_id as string;

    const credsResult = await loadSubaccountCreds(supabase, orgId);
    if (!credsResult.ok) {
      console.error(`${FN} subaccount creds:`, credsResult.code);
      return new Response(JSON.stringify({ error: credsResult.error, code: credsResult.code }), {
        status: credsResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { accountSid, authToken } = credsResult.creds;

    let body: SearchBody = {};
    try {
      body = (await req.json()) as SearchBody;
    } catch {
      body = {};
    }

    const limitRaw = typeof body.limit === "number" && !Number.isNaN(body.limit) ? body.limit : 20;
    const limit = Math.min(50, Math.max(1, Math.floor(limitRaw)));

    const params = new URLSearchParams();
    params.set("PageSize", String(limit));
    const ac = body.area_code?.replace(/\D/g, "").slice(0, 3);
    if (ac) params.set("AreaCode", ac);
    if (body.locality?.trim()) params.set("InLocality", body.locality.trim());
    const st = body.state?.trim().toUpperCase().slice(0, 2);
    if (st) params.set("InRegion", st);

    const twilioUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/AvailablePhoneNumbers/US/Local.json?${params.toString()}`;

    const basic = btoa(`${accountSid}:${authToken}`);
    const twRes = await fetch(twilioUrl, {
      method: "GET",
      headers: { Authorization: `Basic ${basic}` },
    });

    const twText = await twRes.text();
    let twJson: Record<string, unknown>;
    try {
      twJson = JSON.parse(twText) as Record<string, unknown>;
    } catch {
      console.error(`${FN} Twilio non-JSON response`, twRes.status, twText.slice(0, 200));
      return new Response(JSON.stringify({ error: "Twilio returned an invalid response" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!twRes.ok) {
      const msg =
        (twJson.message as string) ||
        (twJson as { error_message?: string }).error_message ||
        `Twilio error (${twRes.status})`;
      console.error(`${FN} Twilio API error:`, twRes.status, msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawList = (twJson.available_phone_numbers as Record<string, unknown>[]) ?? [];
    const numbers = rawList.map((n) => ({
      phone_number: String(n.phone_number ?? ""),
      friendly_name: (n.friendly_name as string) ?? null,
      locality: (n.locality as string) ?? null,
      region: (n.region as string) ?? null,
      postal_code: (n.postal_code as string) ?? null,
      country: (n.iso_country as string) ?? "US",
    }));

    return new Response(JSON.stringify({ numbers }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(`${FN} Fatal:`, e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
