import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FN = "[twilio-trust-hub]";
const US_A2P_POLICY_SID = "RNdfbf3fae0e1107f8aded0e7cead80bf5";

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

function basicAuthHeader(accountSid: string, authToken: string): string {
  const token = btoa(`${accountSid}:${authToken}`);
  return `Basic ${token}`;
}

type TwilioErr = { code?: number; message?: string; status?: number; more_info?: string };

async function twilioTrustHubJson<T>(
  accountSid: string,
  authToken: string,
  url: string,
  init: RequestInit,
  step: string,
): Promise<{ ok: true; data: T } | { ok: false; err: TwilioErr; status: number }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuthHeader(accountSid, authToken),
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || "Invalid Twilio response" };
  }
  if (!res.ok) {
    console.error(`${FN} ${step} HTTP ${res.status}`, text.slice(0, 2000));
    return { ok: false, err: data as TwilioErr, status: res.status };
  }
  console.log(`${FN} ${step} OK`);
  return { ok: true, data: data as T };
}

type TrustHubDraft = {
  customer_profile_sid?: string;
  end_user_sid?: string;
  supporting_document_sid?: string;
  address_sid?: string;
};

function parseSecretBundle(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getDraft(bundle: Record<string, unknown>): TrustHubDraft {
  const d = bundle["trust_hub_registration_draft"];
  if (d && typeof d === "object" && !Array.isArray(d)) return d as TrustHubDraft;
  return {};
}

function mergeDraft(
  bundle: Record<string, unknown>,
  patch: TrustHubDraft,
): Record<string, unknown> {
  const prev = getDraft(bundle);
  return {
    ...bundle,
    trust_hub_registration_draft: { ...prev, ...patch },
  };
}

function clearDraft(bundle: Record<string, unknown>): Record<string, unknown> {
  const next = { ...bundle };
  delete next["trust_hub_registration_draft"];
  return next;
}

type RegisterBody = {
  action?: string;
  business_name?: string;
  business_type?: string;
  ein?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_email?: string;
  contact_phone?: string;
  website?: string;
};

const BUSINESS_TYPES = new Set(["sole_proprietorship", "partnership", "llc", "corporation"]);

function validateRegister(b: RegisterBody): string | null {
  const req = [
    ["business_name", b.business_name],
    ["business_type", b.business_type],
    ["ein", b.ein],
    ["address_street", b.address_street],
    ["address_city", b.address_city],
    ["address_state", b.address_state],
    ["address_zip", b.address_zip],
    ["contact_first_name", b.contact_first_name],
    ["contact_last_name", b.contact_last_name],
    ["contact_email", b.contact_email],
    ["contact_phone", b.contact_phone],
  ] as const;
  for (const [k, v] of req) {
    if (!String(v ?? "").trim()) return `Missing required field: ${k}`;
  }
  const bt = String(b.business_type).trim();
  if (!BUSINESS_TYPES.has(bt)) {
    return "business_type must be sole_proprietorship, partnership, llc, or corporation";
  }
  const einDigits = String(b.ein).replace(/\D/g, "");
  if (einDigits.length !== 9) {
    return "EIN must be exactly 9 digits (numbers only).";
  }
  const st = String(b.address_state).trim().toUpperCase();
  if (st.length !== 2) return "address_state must be a 2-letter US state code.";
  const phone = String(b.contact_phone).trim();
  if (!phone.startsWith("+")) {
    return "contact_phone must be in E.164 format (e.g. +15551234567).";
  }
  return null;
}

function twilioMessage(e: TwilioErr): string {
  return (e.message || "Twilio request failed").trim();
}

async function postForm(
  accountSid: string,
  authToken: string,
  url: string,
  form: Record<string, string>,
  step: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; err: TwilioErr; status: number }> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    body.set(k, v);
  }
  return twilioTrustHubJson<Record<string, unknown>>(accountSid, authToken, url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, step);
}

function isAlreadyAssigned(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("already been assigned") || m.includes("already assigned") || m.includes("duplicate");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error(`${FN} Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY`);
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

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

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id, role, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id) {
    console.error(`${FN} Profile read:`, profileError?.message);
    return jsonResponse({ error: "Organization not found for user" }, 400);
  }

  const orgId = profile.organization_id as string;
  const role = String((profile as { role?: string }).role ?? "");
  const isSuper = (profile as { is_super_admin?: boolean }).is_super_admin === true;
  const canManage = isSuper || role === "Admin" || role === "Super Admin";

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action ?? "").trim();

  const { data: settingsRow, error: settingsError } = await supabase
    .from("phone_settings")
    .select("id, account_sid, auth_token, api_secret, trust_hub_profile_sid")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (settingsError) {
    console.error(`${FN} phone_settings:`, settingsError.message);
    return jsonResponse({ error: "Could not load phone settings" }, 500);
  }

  const accountSid = String(settingsRow?.account_sid ?? "").trim();
  const authToken = String(settingsRow?.auth_token ?? "").trim();

  if (action === "check-status") {
    const bundle = parseSecretBundle(settingsRow?.api_secret as string | null | undefined);
    const draft = getDraft(bundle);
    const profileSid = String(settingsRow?.trust_hub_profile_sid ?? draft.customer_profile_sid ?? "").trim();
    if (!profileSid) {
      return jsonResponse({ status: "not-registered" }, 200);
    }
    if (!accountSid || !authToken) {
      return jsonResponse({ error: "Twilio credentials not configured in Phone Settings." }, 400);
    }
    const url = `https://trusthub.twilio.com/v1/CustomerProfiles/${encodeURIComponent(profileSid)}`;
    const r = await twilioTrustHubJson<{ status?: string }>(accountSid, authToken, url, { method: "GET" }, "check-status GET CustomerProfile");
    if (!r.ok) {
      return jsonResponse({ error: twilioMessage(r.err), twilio_code: r.err.code }, r.status >= 400 ? r.status : 502);
    }
    const st = String(r.data.status ?? "unknown");
    return jsonResponse({ status: st, profile_sid: profileSid }, 200);
  }

  if (action === "register" || action === "assign-numbers") {
    if (!canManage) {
      return jsonResponse({
        error: "Only organization Admins (or Super Admins) can register with Trust Hub or assign phone numbers.",
      }, 403);
    }
    if (!accountSid || !authToken) {
      return jsonResponse({ error: "Twilio credentials not configured in Phone Settings." }, 400);
    }
  }

  if (action === "assign-numbers") {
    const profileSid = String(settingsRow?.trust_hub_profile_sid ?? "").trim();
    if (!profileSid) {
      return jsonResponse({ error: "No Trust Hub customer profile on file. Register first." }, 400);
    }
    const profUrl = `https://trusthub.twilio.com/v1/CustomerProfiles/${encodeURIComponent(profileSid)}`;
    const pr = await twilioTrustHubJson<{ status?: string }>(accountSid, authToken, profUrl, { method: "GET" }, "assign-numbers GET CustomerProfile");
    if (!pr.ok) {
      return jsonResponse({ error: twilioMessage(pr.err) }, 502);
    }
    if (String(pr.data.status) !== "twilio-approved") {
      return jsonResponse({
        error: `Trust Hub profile must be twilio-approved before assigning numbers (current: ${pr.data.status}).`,
      }, 400);
    }

    const rawSids = body.twilio_sids;
    const twilioSids = Array.isArray(rawSids)
      ? rawSids.map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (twilioSids.length === 0) {
      return jsonResponse({ error: "twilio_sids must be a non-empty array of Twilio Phone Number SIDs (PN…)." }, 400);
    }

    const results: { twilio_sid: string; ok: boolean; error?: string }[] = [];

    for (const pnSid of twilioSids) {
      const assignUrl =
        `https://trusthub.twilio.com/v1/CustomerProfiles/${encodeURIComponent(profileSid)}/ChannelEndpointAssignments`;
      const ar = await postForm(accountSid, authToken, assignUrl, {
        ChannelEndpointType: "phone-number",
        ChannelEndpointSid: pnSid,
      }, `assign-numbers attach ${pnSid}`);
      if (!ar.ok) {
        const msg = twilioMessage(ar.err);
        if (isAlreadyAssigned(msg)) {
          results.push({ twilio_sid: pnSid, ok: true });
        } else {
          results.push({ twilio_sid: pnSid, ok: false, error: msg });
          continue;
        }
      } else {
        results.push({ twilio_sid: pnSid, ok: true });
      }

      const { error: upErr } = await supabase
        .from("phone_numbers")
        .update({ trust_hub_status: "approved" })
        .eq("organization_id", orgId)
        .eq("twilio_sid", pnSid);
      if (upErr) {
        console.error(`${FN} assign-numbers DB update`, upErr.message);
      }
    }

    return jsonResponse({ results, profile_sid: profileSid }, 200);
  }

  if (action === "register") {
    const b = body as RegisterBody;
    const v = validateRegister(b);
    if (v) return jsonResponse({ error: v }, 400);

    const existingProfileSid = String(settingsRow?.trust_hub_profile_sid ?? "").trim();
    if (existingProfileSid) {
      const exUrl =
        `https://trusthub.twilio.com/v1/CustomerProfiles/${encodeURIComponent(existingProfileSid)}`;
      const ex = await twilioTrustHubJson<{ status?: string }>(
        accountSid,
        authToken,
        exUrl,
        { method: "GET" },
        "register precheck GET CustomerProfile",
      );
      if (ex.ok) {
        const st = String(ex.data.status ?? "");
        if (st && st !== "draft") {
          return jsonResponse({
            error:
              "A Trust Hub customer profile is already linked to this agency. Use Check Status, or contact Twilio support if you need to change it.",
            profile_sid: existingProfileSid,
            status: st,
          }, 400);
        }
      }
    }

    let localBundle = parseSecretBundle(settingsRow?.api_secret as string | null | undefined);
    let draft = getDraft(localBundle);
    const einDigits = String(b.ein).replace(/\D/g, "");
    const state = String(b.address_state).trim().toUpperCase();
    const website = String(b.website ?? "").trim();
    const businessName = String(b.business_name).trim();
    const contactEmail = String(b.contact_email).trim();

    const persistDraft = async (d: TrustHubDraft) => {
      draft = { ...draft, ...d };
      localBundle = mergeDraft(localBundle, draft);
      const nextSecret = JSON.stringify(localBundle);
      const { error } = await supabase
        .from("phone_settings")
        .update({ api_secret: nextSecret, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId);
      if (error) console.error(`${FN} persistDraft`, error.message);
    };

    const persistFinal = async (customerProfileSid: string) => {
      localBundle = clearDraft(localBundle);
      const nextSecret = JSON.stringify(localBundle);
      const { error } = await supabase
        .from("phone_settings")
        .update({
          trust_hub_profile_sid: customerProfileSid,
          api_secret: nextSecret,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId);
      if (error) {
        console.error(`${FN} persistFinal`, error.message);
        throw new Error("Could not save Trust Hub profile to phone_settings.");
      }
    };

    let customerProfileSid = draft.customer_profile_sid ?? "";

    if (!customerProfileSid) {
      const cr = await postForm(accountSid, authToken, "https://trusthub.twilio.com/v1/CustomerProfiles", {
        FriendlyName: businessName,
        Email: contactEmail,
        PolicySid: US_A2P_POLICY_SID,
      }, "register StepA CustomerProfile");
      if (!cr.ok) {
        await persistDraft({});
        return jsonResponse({
          error: `Trust Hub Step A (Customer Profile): ${twilioMessage(cr.err)}`,
          twilio_code: cr.err.code,
        }, 400);
      }
      customerProfileSid = String((cr.data as { sid?: string }).sid ?? "");
      if (!customerProfileSid) {
        return jsonResponse({ error: "Trust Hub Step A: missing profile SID in Twilio response." }, 502);
      }
      await persistDraft({ customer_profile_sid: customerProfileSid });
    }

    let endUserSid = draft.end_user_sid ?? "";
    if (!endUserSid) {
      const endUserAttrs = {
        business_name: businessName,
        business_type: String(b.business_type).trim(),
        ein: einDigits,
        business_industry: "INSURANCE",
        business_registration_number: einDigits,
        business_regions_of_operation: "US",
        website_url: website || undefined,
      };
      const er = await postForm(accountSid, authToken, "https://trusthub.twilio.com/v1/EndUsers", {
        FriendlyName: businessName,
        Type: "customer_profile_business_information",
        Attributes: JSON.stringify(endUserAttrs),
      }, "register StepB EndUser");
      if (!er.ok) {
        await persistDraft({ customer_profile_sid: customerProfileSid });
        return jsonResponse({
          error: `Trust Hub Step B (End User): ${twilioMessage(er.err)}`,
          twilio_code: er.err.code,
          partial: { customer_profile_sid: customerProfileSid },
        }, 400);
      }
      endUserSid = String((er.data as { sid?: string }).sid ?? "");
      if (!endUserSid) {
        return jsonResponse({ error: "Trust Hub Step B: missing end user SID." }, 502);
      }
      await persistDraft({ customer_profile_sid: customerProfileSid, end_user_sid: endUserSid });
    }

    const assignEndUserUrl =
      `https://trusthub.twilio.com/v1/CustomerProfiles/${encodeURIComponent(customerProfileSid)}/ChannelEndpointAssignments`;
    const arEu = await postForm(accountSid, authToken, assignEndUserUrl, {
      ChannelEndpointType: "end-user",
      ChannelEndpointSid: endUserSid,
    }, "register StepC attach EndUser");
    if (!arEu.ok && !isAlreadyAssigned(twilioMessage(arEu.err))) {
      await persistDraft({ customer_profile_sid: customerProfileSid, end_user_sid: endUserSid });
      return jsonResponse({
        error: `Trust Hub Step C (attach End User): ${twilioMessage(arEu.err)}`,
        twilio_code: arEu.err.code,
        partial: { customer_profile_sid: customerProfileSid, end_user_sid: endUserSid },
      }, 400);
    }

    let addressSid = draft.address_sid ?? "";
    if (!addressSid) {
      const addrUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Addresses.json`;
      const adr = await postForm(accountSid, authToken, addrUrl, {
        FriendlyName: businessName,
        Street: String(b.address_street).trim(),
        City: String(b.address_city).trim(),
        Region: state,
        PostalCode: String(b.address_zip).trim(),
        IsoCountry: "US",
        CustomerName: businessName,
      }, "register StepD Address");
      if (!adr.ok) {
        await persistDraft({ customer_profile_sid: customerProfileSid, end_user_sid: endUserSid });
        return jsonResponse({
          error: `Trust Hub Step D (Address): ${twilioMessage(adr.err)}`,
          twilio_code: adr.err.code,
          partial: { customer_profile_sid: customerProfileSid, end_user_sid: endUserSid },
        }, 400);
      }
      addressSid = String((adr.data as { sid?: string }).sid ?? "");
      if (!addressSid) {
        return jsonResponse({ error: "Trust Hub Step D: missing Address SID." }, 502);
      }
      await persistDraft({
        customer_profile_sid: customerProfileSid,
        end_user_sid: endUserSid,
        address_sid: addressSid,
      });
    }

    let supportingDocSid = draft.supporting_document_sid ?? "";
    if (!supportingDocSid) {
      const sdAttrs = { address_sids: [addressSid] };
      const sdr = await postForm(accountSid, authToken, "https://trusthub.twilio.com/v1/SupportingDocuments", {
        FriendlyName: `${businessName} Address`,
        Type: "customer_profile_address",
        Attributes: JSON.stringify(sdAttrs),
      }, "register Step SupportingDocument");
      if (!sdr.ok) {
        await persistDraft({
          customer_profile_sid: customerProfileSid,
          end_user_sid: endUserSid,
          address_sid: addressSid,
        });
        return jsonResponse({
          error: `Trust Hub Step E (Supporting Document): ${twilioMessage(sdr.err)}`,
          twilio_code: sdr.err.code,
          partial: {
            customer_profile_sid: customerProfileSid,
            end_user_sid: endUserSid,
            address_sid: addressSid,
          },
        }, 400);
      }
      supportingDocSid = String((sdr.data as { sid?: string }).sid ?? "");
      if (!supportingDocSid) {
        return jsonResponse({ error: "Trust Hub Step E: missing Supporting Document SID." }, 502);
      }
      await persistDraft({
        customer_profile_sid: customerProfileSid,
        end_user_sid: endUserSid,
        address_sid: addressSid,
        supporting_document_sid: supportingDocSid,
      });
    }

    const arSd = await postForm(accountSid, authToken, assignEndUserUrl, {
      ChannelEndpointType: "supporting-document",
      ChannelEndpointSid: supportingDocSid,
    }, "register Step attach SupportingDocument");
    if (!arSd.ok && !isAlreadyAssigned(twilioMessage(arSd.err))) {
      await persistDraft({
        customer_profile_sid: customerProfileSid,
        end_user_sid: endUserSid,
        address_sid: addressSid,
        supporting_document_sid: supportingDocSid,
      });
      return jsonResponse({
        error: `Trust Hub Step F (attach Supporting Document): ${twilioMessage(arSd.err)}`,
        twilio_code: arSd.err.code,
        partial: {
          customer_profile_sid: customerProfileSid,
          end_user_sid: endUserSid,
          supporting_document_sid: supportingDocSid,
          address_sid: addressSid,
        },
      }, 400);
    }

    const evalUrl =
      `https://trusthub.twilio.com/v1/CustomerProfiles/${encodeURIComponent(customerProfileSid)}/Evaluations`;
    const ev = await postForm(accountSid, authToken, evalUrl, {
      PolicySid: US_A2P_POLICY_SID,
    }, "register StepG SubmitEvaluation");
    if (!ev.ok) {
      await persistDraft({
        customer_profile_sid: customerProfileSid,
        end_user_sid: endUserSid,
        address_sid: addressSid,
        supporting_document_sid: supportingDocSid,
      });
      return jsonResponse({
        error: `Trust Hub Step G (Submit for review): ${twilioMessage(ev.err)}`,
        twilio_code: ev.err.code,
        partial: {
          customer_profile_sid: customerProfileSid,
          end_user_sid: endUserSid,
          supporting_document_sid: supportingDocSid,
          address_sid: addressSid,
        },
      }, 400);
    }

    try {
      await persistFinal(customerProfileSid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      return jsonResponse({ error: msg }, 500);
    }

    return jsonResponse({
      profile_sid: customerProfileSid,
      status: "pending-review",
      evaluation_sid: String((ev.data as { sid?: string }).sid ?? "") || undefined,
    }, 200);
  }

  return jsonResponse({ error: `Unknown action: ${action || "(empty)"}` }, 400);
});
