import { dispatch } from "../_shared/sms/dispatch.ts";
import { policy } from "../_shared/sms/consent.ts";
import { contactScope } from "../_shared/sms/scope.ts";
import { manualSender } from "../_shared/sms/manual.ts";
import { SmsError, UUID } from "../_shared/sms/wire.ts";
import { registeredSender } from "../_shared/a2p/sending.ts";
import { A2pError } from "../_shared/a2p/types.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FN = "[twilio-sms]";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TWILIO_SMS_FRIENDLY: Record<number, string> = {
  21211: "The recipient phone number is invalid or not SMS-capable.",
  21606: "The From number is not owned by your Twilio account.",
  21610: "This recipient has unsubscribed from your messages (STOP).",
};

function digitsCore(input: string): string {
  return input.replace(/\D/g, "");
}

/** Normalize to +E.164 for Twilio (US NANP default). */
function toE164Plus(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const d = digitsCore(raw);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}

function samePhone(a: string, b: string): boolean {
  const da = digitsCore(a);
  const db = digitsCore(b);
  if (!da || !db) return false;
  const na = da.length === 10 ? `1${da}` : da;
  const nb = db.length === 10 ? `1${db}` : db;
  return na === nb;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type TwilioErrorBody = { code?: number; message?: string; more_info?: string };

function formatTwilioFailure(data: TwilioErrorBody): string {
  const code = typeof data.code === "number" ? data.code : undefined;
  const base = (data.message || "Twilio rejected the message.").trim();
  if (code !== undefined && TWILIO_SMS_FRIENDLY[code]) {
    return `${TWILIO_SMS_FRIENDLY[code]} (${base})`;
  }
  return base;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error(`${FN} Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY`);
      return jsonResponse({ success: false, error: "Server configuration error" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const jwt = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(jwt);

    if (userError || !user) {
      console.error(`${FN} Auth error:`, userError?.message);
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.organization_id) {
      console.error(`${FN} Profile / organization:`, profileError?.message);
      return jsonResponse({ success: false, error: "Organization not found for user" }, 400);
    }

    const organizationId = profile.organization_id as string;

    let bodyJson: Record<string, unknown>;
    try {
      bodyJson = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
    }

    const toRaw = typeof bodyJson.to === "string" ? bodyJson.to.trim() : "";
    const fromRaw = typeof bodyJson.from === "string" ? bodyJson.from.trim() : "";
    const bodyText = typeof bodyJson.body === "string" ? bodyJson.body : "";
    const contactId =
      typeof bodyJson.contact_id === "string" && bodyJson.contact_id.trim()
        ? bodyJson.contact_id.trim()
        : typeof bodyJson.lead_id === "string" && bodyJson.lead_id.trim()
          ? bodyJson.lead_id.trim()
          : undefined;
    const contactTypeRaw =
      typeof bodyJson.contact_type === "string" ? bodyJson.contact_type.trim().toLowerCase() : "";
    const contactType =
      contactTypeRaw === "lead" || contactTypeRaw === "client" || contactTypeRaw === "recruit"
        ? contactTypeRaw
        : undefined;

    if (!toRaw || !bodyText.trim()) {
      return jsonResponse(
        { success: false, error: "Missing required fields: to, body" },
        400,
      );
    }

    const to = toE164Plus(toRaw);
    const textingPolicy = await policy(supabase, organizationId);
    if (textingPolicy?.enforced) {
      if (bodyJson.view_as === true || bodyJson.actor_id !== user.id || bodyJson.organization_id !== organizationId || typeof bodyJson.request_id !== "string" || !UUID.test(bodyJson.request_id)) throw new SmsError("SEND_SCOPE", "Reload your own account before sending.", 403);
      const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      await contactScope(caller, organizationId, contactId, contactType, to);
      const from = await manualSender(supabase, textingPolicy, fromRaw);
      // This authenticated endpoint sends human-composed messages. Browser purpose
      // flags cannot grant consent or select an automated/confirmation send path.
      const result = await dispatch(supabase, { org: organizationId, key: `manual:${user.id}:${bodyJson.request_id}`, to, from, body: bodyText, verifyRecipient: async () => { await contactScope(caller, organizationId, contactId, contactType, to); }, manual: true, purpose: "manual", actor: user.id, contactId, contactType });
      if (!result) throw new SmsError("SMS_POLICY", "Texting settings changed. Please retry.", 503);
      return jsonResponse({ ...result }, 200);
    }
    if (!fromRaw) {
      return jsonResponse({ success: false, error: "A sender number is required." }, 400);
    }
    const from = toE164Plus(fromRaw);
    if (!to.startsWith("+") || !from.startsWith("+")) {
      return jsonResponse({ success: false, error: "Invalid phone number format (E.164 required)." }, 400);
    }

    const { data: orgNumbers, error: phonesError } = await supabase
      .from("phone_numbers")
      .select("phone_number, status")
      .eq("organization_id", organizationId)
      .in("status", ["active", "Active"]);

    if (phonesError) {
      console.error(`${FN} phone_numbers lookup:`, phonesError.message);
      return jsonResponse({ success: false, error: "Could not verify sender number." }, 500);
    }

    const fromAllowed = (orgNumbers || []).some(
      (row) => row.phone_number && samePhone(row.phone_number, from),
    );

    if (!fromAllowed) {
      return jsonResponse(
        { success: false, error: "Sender number not registered to your organization." },
        400,
      );
    }

    const registered = await registeredSender(supabase, organizationId, from, user.id);
    let accountSid = registered?.accountSid ?? "";
    let authToken = registered?.authToken ?? "";
    if (!registered) {
      const { data: phoneSettings, error: settingsError } = await supabase
        .from("phone_settings")
        .select("account_sid, auth_token")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (settingsError) {
        console.error(`${FN} phone_settings lookup:`, settingsError.message);
        return jsonResponse({ success: false, error: "Could not load Twilio settings." }, 500);
      }
      accountSid = phoneSettings?.account_sid?.trim() ?? "";
      authToken = phoneSettings?.auth_token?.trim() ?? "";
    }
    if (!accountSid || !authToken) {
      return jsonResponse({ success: false, error: "Twilio credentials not configured." }, 400);
    }

    const params = new URLSearchParams();
    params.set("To", to);
    params.set("From", from);
    params.set("Body", bodyText);
    if (registered) params.set("MessagingServiceSid", registered.messagingServiceSid);

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: params.toString(),
    });

    const twilioPayload: TwilioErrorBody & { sid?: string; status?: string; date_created?: string } = await twilioRes
      .json()
      .catch(() => ({}));

    if (!twilioRes.ok) {
      const msg = formatTwilioFailure(twilioPayload);
      console.error(`${FN} Twilio error ${twilioRes.status}:`, JSON.stringify(twilioPayload));
      return jsonResponse({ success: false, error: msg }, 400);
    }

    const providerMessageId = typeof twilioPayload.sid === "string" ? twilioPayload.sid : "";
    const twilioStatus = typeof twilioPayload.status === "string" ? twilioPayload.status : "queued";
    const sentAt = new Date().toISOString();

    const messageRow: Record<string, unknown> = {
      direction: "outbound",
      body: bodyText,
      from_number: from,
      to_number: to,
      status: twilioStatus,
      provider_message_id: providerMessageId || null,
      organization_id: organizationId,
      created_by: user.id,
      sent_at: sentAt,
    };
    if (contactId) {
      messageRow.lead_id = contactId;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("messages")
      .insert(messageRow)
      .select("id")
      .maybeSingle();

    if (insertError || !inserted?.id) {
      console.error(`${FN} messages insert:`, insertError?.message);
      return jsonResponse(
        {
          success: false,
          error: insertError?.message || "Failed to save message record.",
        },
        500,
      );
    }

    if (contactId && contactType) {
      const truncated = bodyText.length > 50 ? `${bodyText.slice(0, 50)}…` : bodyText;
      const { error: actError } = await supabase.from("contact_activities").insert({
        activity_type: "sms",
        description: `Sent SMS: ${truncated}`,
        contact_id: contactId,
        contact_type: contactType,
        organization_id: organizationId,
        agent_id: user.id,
      });
      if (actError) {
        console.error(`${FN} contact_activities insert:`, actError.message);
      }
    }

    return jsonResponse(
      {
        success: true,
        message_id: inserted.id,
        provider_message_id: providerMessageId,
        status: twilioStatus,
      },
      200,
    );
  } catch (err) {
    if (err instanceof SmsError || err instanceof A2pError) return jsonResponse({ success: false, code: err.code, error: err.message }, err.status);
    console.error(`${FN} Unhandled:`, err);
    return jsonResponse(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      500,
    );
  }
});
