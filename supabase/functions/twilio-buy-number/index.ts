import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import { canonicalNumberConfig } from "../_shared/twilioNumberConfig.ts";

const FN = "[twilio-buy-number]";
const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractAreaCode(e164: string): string | null {
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1, 4);
  if (d.length === 10) return d.slice(0, 3);
  return null;
}

type BuyBody = {
  phone_number?: string;
  /** Optional display label (e.g. "Los Angeles, CA"); otherwise Twilio's friendly name / number is used. */
  friendly_name?: string | null;
  locality?: string | null;
  region?: string | null;
};

function telephonyStatusError(
  status: unknown,
  subaccountSid: unknown,
): { status: number; code: string; error: string } | null {
  if (
    status === "active" && typeof subaccountSid === "string" &&
    ACCOUNT_SID_PATTERN.test(subaccountSid.trim())
  ) {
    return null;
  }
  if (status === "pending") {
    return {
      status: 503,
      code: "PROVISIONING_PENDING",
      error: "Telephony is still being provisioned for your organization. Please try again shortly.",
    };
  }
  if (status === "pending_manual") {
    return {
      status: 503,
      code: "PROVISIONING_FAILED",
      error: "Telephony provisioning failed. Contact support to retry.",
    };
  }
  if (status === "suspended" || status === "closed") {
    return {
      status: 403,
      code: "TELEPHONY_SUSPENDED",
      error: "Telephony for this organization is suspended.",
    };
  }
  return {
    status: 500,
    code: "TELEPHONY_MISCONFIGURED",
    error: "Telephony is not configured correctly for this organization.",
  };
}

async function fetchNumberDetails(accountSid: string, authToken: string, phoneNumber: string) {
  const basic = btoa(`${accountSid}:${authToken}`);
  // Look for the number in US/Local inventory to get city/state info
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/AvailablePhoneNumbers/US/Local.json?Contains=${encodeURIComponent(phoneNumber)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
    if (!res.ok) return null;
    const json = await res.json();
    const match = json.available_phone_numbers?.find((n: any) => n.phone_number === phoneNumber);
    if (match) {
      const city = match.locality?.trim();
      const state = match.region?.trim();
      if (city && state) return `${city}, ${state}`;
      if (city) return city;
      if (state) return state;
    }
  } catch (e) {
    console.error(`${FN} Failed to fetch number details:`, e);
  }
  return null;
}

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

    // Voice JWTs and the TwiML App execute on the master account. Any number
    // offered as outbound caller ID must therefore be purchased on master too.
    // The phone_numbers.organization_id column remains the tenant boundary.
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("twilio_subaccount_sid, twilio_subaccount_status")
      .eq("id", orgId)
      .maybeSingle();
    if (organizationError || !organization) {
      console.error(`${FN} Organization lookup failed:`, organizationError?.message);
      return new Response(JSON.stringify({ error: "Organization not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const statusError = telephonyStatusError(
      organization.twilio_subaccount_status,
      organization.twilio_subaccount_sid,
    );
    if (statusError) {
      return new Response(JSON.stringify({ error: statusError.error, code: statusError.code }), {
        status: statusError.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const credsResult = loadOutboundTwilioCreds();
    if (!credsResult.ok) {
      console.error(`${FN} master credentials:`, credsResult.code);
      return new Response(JSON.stringify({ error: credsResult.error, code: credsResult.code }), {
        status: credsResult.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { accountSid, authToken } = credsResult.creds;

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

    let friendlyName = body.friendly_name?.trim();
    if (!friendlyName) {
      const city = body.locality?.trim();
      const state = body.region?.trim();
      if (city && state) {
        friendlyName = `${city}, ${state}`;
      } else if (city) {
        friendlyName = city;
      } else if (state) {
        friendlyName = state;
      } else {
        // Fallback: try to look up the number's locality/region from Twilio
        friendlyName = await fetchNumberDetails(accountSid, authToken, phoneNumber) ?? undefined;
      }
    }

    const numberConfig = canonicalNumberConfig(supabaseUrl);

    const form = new URLSearchParams();
    form.set("PhoneNumber", phoneNumber);
    if (friendlyName) {
      form.set("FriendlyName", friendlyName);
    }
    form.set("VoiceUrl", numberConfig.voiceUrl);
    form.set("VoiceMethod", numberConfig.voiceMethod);
    form.set("SmsUrl", numberConfig.smsUrl);
    form.set("SmsMethod", numberConfig.smsMethod);
    form.set("StatusCallback", numberConfig.statusCallback);
    form.set("StatusCallbackMethod", numberConfig.statusCallbackMethod);

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
    const twilioFriendly = (twJson.friendly_name as string) || (twJson.phone_number as string) || phoneNumber;
    const e164 = (twJson.phone_number as string) || phoneNumber;
    
    // Use the resolved friendly name from our logic, or fallback to Twilio's returned friendly name
    const finalFriendlyName = friendlyName || twilioFriendly;

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
        friendly_name: finalFriendlyName,
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

    // Existing Trust Hub automation is subaccount-scoped. A master-owned
    // number must stay pending until a master-account assignment path exists;
    // claiming approval here would be false and could hide reputation risk.

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
