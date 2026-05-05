import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSubaccountCreds } from "../_shared/twilioSubaccountCreds.ts";

const FN = "[update-sms-urls]";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error(`${FN} Missing env vars`);
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    // ── Auth: Super Admin only ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const jwt = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(jwt);

    if (userError || !user) {
      console.error(`${FN} Auth error:`, userError?.message);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Check JWT claim for super_admin
    const isSuperAdminClaim =
      user.app_metadata?.is_super_admin === true ||
      user.user_metadata?.is_super_admin === true;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Defense-in-depth: also check profiles.is_super_admin
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_super_admin, organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error(`${FN} Profile lookup failed:`, profileError?.message);
      return jsonResponse({ error: "Profile not found" }, 400);
    }

    if (!isSuperAdminClaim && !profile.is_super_admin) {
      console.warn(`${FN} Non-super-admin attempt by ${user.id}`);
      return jsonResponse({ error: "Forbidden — Super Admin only" }, 403);
    }

    // ── Resolve the correct SmsUrl ──
    const origin = supabaseUrl.replace(/\/+$/, "");
    const newSmsUrl = `${origin}/functions/v1/twilio-sms-webhook`;

    // ── Load all purchased numbers grouped by org ──
    const { data: numbers, error: numError } = await supabase
      .from("phone_numbers")
      .select("id, phone_number, twilio_sid, organization_id, status")
      .in("status", ["active", "Active"])
      .not("twilio_sid", "is", null);

    if (numError) {
      console.error(`${FN} phone_numbers query:`, numError.message);
      return jsonResponse({ error: "Failed to load phone numbers" }, 500);
    }

    if (!numbers || numbers.length === 0) {
      return jsonResponse({ success: true, updated: 0, message: "No active numbers found" }, 200);
    }

    console.log(`${FN} Found ${numbers.length} active numbers to update`);

    // Group numbers by org for credential resolution
    const byOrg = new Map<string, typeof numbers>();
    for (const n of numbers) {
      if (!n.organization_id || !n.twilio_sid) continue;
      const orgId = n.organization_id as string;
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      byOrg.get(orgId)!.push(n);
    }

    const results: Array<{
      phone: string;
      twilio_sid: string;
      status: "updated" | "skipped" | "error";
      detail?: string;
    }> = [];

    for (const [orgId, orgNumbers] of byOrg) {
      // Try subaccount creds first; fall back to phone_settings if not provisioned
      let accountSid: string | null = null;
      let authToken: string | null = null;

      const credsResult = await loadSubaccountCreds(supabase, orgId);
      if (credsResult.ok) {
        accountSid = credsResult.creds.accountSid;
        authToken = credsResult.creds.authToken;
      } else {
        // Fallback to phone_settings (pre-Phase-3 orgs)
        const { data: ps } = await supabase
          .from("phone_settings")
          .select("account_sid, auth_token")
          .eq("organization_id", orgId)
          .maybeSingle();
        if (ps?.account_sid && ps?.auth_token) {
          accountSid = ps.account_sid.trim();
          authToken = ps.auth_token.trim();
        }
      }

      if (!accountSid || !authToken) {
        for (const n of orgNumbers) {
          results.push({
            phone: n.phone_number,
            twilio_sid: n.twilio_sid,
            status: "skipped",
            detail: `No Twilio credentials for org ${orgId}`,
          });
        }
        continue;
      }

      const basic = btoa(`${accountSid}:${authToken}`);

      for (const n of orgNumbers) {
        try {
          const form = new URLSearchParams();
          form.set("SmsUrl", newSmsUrl);
          form.set("SmsMethod", "POST");

          const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(n.twilio_sid)}.json`;

          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Basic ${basic}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
          });

          if (res.ok) {
            results.push({
              phone: n.phone_number,
              twilio_sid: n.twilio_sid,
              status: "updated",
            });
            console.log(`${FN} Updated SmsUrl for ${n.phone_number} (${n.twilio_sid})`);
          } else {
            const errText = await res.text().catch(() => "");
            results.push({
              phone: n.phone_number,
              twilio_sid: n.twilio_sid,
              status: "error",
              detail: `Twilio ${res.status}: ${errText.slice(0, 200)}`,
            });
            console.error(`${FN} Twilio error for ${n.phone_number}:`, res.status, errText.slice(0, 200));
          }
        } catch (err) {
          results.push({
            phone: n.phone_number,
            twilio_sid: n.twilio_sid,
            status: "error",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const updated = results.filter((r) => r.status === "updated").length;
    const errors = results.filter((r) => r.status === "error").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    console.log(`${FN} Done — updated=${updated} errors=${errors} skipped=${skipped}`);

    return jsonResponse(
      {
        success: true,
        sms_url: newSmsUrl,
        updated,
        errors,
        skipped,
        total: results.length,
        results,
      },
      200,
    );
  } catch (err) {
    console.error(`${FN} Fatal:`, err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
    );
  }
});
