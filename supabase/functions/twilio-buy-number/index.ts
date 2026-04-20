import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FN = "[twilio-buy-number]";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FUNCTIONS_BASE = "https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1";

function extractAreaCode(e164: string): string | null {
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1, 4);
  if (d.length === 10) return d.slice(0, 3);
  return null;
}

type BuyBody = {
  phone_number?: string;
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
    if (!supabaseUrl || !serviceKey) {
      console.error(`${FN} Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(jwt);

    if (userError || !user) {
      console.error(`${FN} Auth error:`, userError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const { data: settings, error: settingsError } = await supabase
      .from("phone_settings")
      .select("account_sid, auth_token")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (settingsError) {
      console.error(`${FN} phone_settings read:`, settingsError.message);
      return new Response(JSON.stringify({ error: "Could not load phone settings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accountSid = settings?.account_sid?.trim() ?? "";
    const authToken = settings?.auth_token?.trim() ?? "";
    if (!accountSid || !authToken) {
      return new Response(JSON.stringify({ error: "Twilio credentials not configured." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: BuyBody;
    try {
      body = (await req.json()) as BuyBody;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const phoneNumber = body.phone_number?.trim() ?? "";
    if (!phoneNumber || !phoneNumber.startsWith("+")) {
      return new Response(JSON.stringify({ error: "phone_number is required (E.164, e.g. +15551234567)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base = FUNCTIONS_BASE;
    const voiceUrl = `${base}/twilio-voice-inbound`;
    const smsUrl = `${base}/twilio-sms`;
    const statusCallback = `${base}/twilio-voice-status`;

    const form = new URLSearchParams();
    form.set("PhoneNumber", phoneNumber);
    form.set("VoiceUrl", voiceUrl);
    form.set("VoiceMethod", "POST");
    form.set("SmsUrl", smsUrl);
    form.set("SmsMethod", "POST");
    form.set("StatusCallback", statusCallback);
    form.set("StatusCallbackMethod", "POST");

    const twilioPostUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json`;
    const basic = btoa(`${accountSid}:${authToken}`);

    const twRes = await fetch(twilioPostUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const twText = await twRes.text();
    let twJson: Record<string, unknown>;
    try {
      twJson = JSON.parse(twText) as Record<string, unknown>;
    } catch {
      console.error(`${FN} Twilio non-JSON`, twRes.status, twText.slice(0, 200));
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
      console.error(`${FN} Twilio purchase failed:`, twRes.status, msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const twilioSid = String(twJson.sid ?? "");
    const friendlyName = (twJson.friendly_name as string) || (twJson.phone_number as string) || phoneNumber;
    const e164 = (twJson.phone_number as string) || phoneNumber;

    if (!twilioSid.startsWith("PN")) {
      console.error(`${FN} Unexpected Twilio sid:`, twilioSid);
      return new Response(JSON.stringify({ error: "Twilio did not return a phone number SID" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const areaCode = extractAreaCode(e164);
    const { data: inserted, error: insertError } = await supabase
      .from("phone_numbers")
      .insert({
        phone_number: e164,
        twilio_sid: twilioSid,
        friendly_name: friendlyName,
        status: "active",
        organization_id: orgId,
        trust_hub_status: "pending",
        area_code: areaCode,
        spam_status: "Unknown",
        is_default: false,
      } as Record<string, unknown>)
      .select("*")
      .maybeSingle();

    if (insertError) {
      console.error(`${FN} DB insert failed:`, insertError.message);
      return new Response(
        JSON.stringify({
          error: `Number purchased in Twilio (${twilioSid}) but AgentFlow could not save it: ${insertError.message}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ row: inserted }), {
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
