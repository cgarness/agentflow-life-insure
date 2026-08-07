import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import {
  canonicalNumberConfig,
  isAuthorizedInternalRequest,
  parseRepairRequest,
  type RepairTargetRow,
  sanitizeTwilioFailure,
  validateRepairTargets,
} from "./ownership.ts";
import {
  repairNumberOwnership,
  type RepairStep,
  RepairStepError,
  type RepairTwilioClient,
  type TwilioResponse,
} from "./repair.ts";

const FN = "[repair-twilio-number-ownership]";
const JSON_HEADERS = { "Content-Type": "application/json" };
const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function twilioRequest(
  authAccountSid: string,
  authToken: string,
  resourceAccountSid: string,
  phoneNumberSid: string,
  form?: URLSearchParams,
): Promise<TwilioResponse> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${
    encodeURIComponent(resourceAccountSid)
  }/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`;
  const response = await fetch(url, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${btoa(`${authAccountSid}:${authToken}`)}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form?.toString(),
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // A bounded, sanitized text response is handled by sanitizeTwilioFailure.
  }
  return { ok: response.ok, status: response.status, payload };
}

function transferForm(masterAccountSid: string): URLSearchParams {
  return new URLSearchParams({ AccountSid: masterAccountSid });
}

function configurationForm(
  config: ReturnType<typeof canonicalNumberConfig>,
): URLSearchParams {
  return new URLSearchParams({
    VoiceUrl: config.voiceUrl,
    VoiceMethod: config.voiceMethod,
    SmsUrl: config.smsUrl,
    SmsMethod: config.smsMethod,
    StatusCallback: config.statusCallback,
    StatusCallbackMethod: config.statusCallbackMethod,
  });
}

function repairErrorMessage(step: RepairStep): string {
  switch (step) {
    case "master_lookup":
      return "Twilio ownership lookup failed";
    case "subaccount_lookup":
      return "Number was not found in the expected Twilio subaccount";
    case "transfer":
      return "Twilio number transfer failed";
    case "configure":
      return "Twilio callback configuration failed";
    case "verify":
      return "Twilio ownership/configuration verification failed";
    case "database_update":
      return "Number repaired in Twilio but database status update failed";
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
    "";
  const workflowSecret = Deno.env.get("WORKFLOW_INTERNAL_SECRET")?.trim() ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(`${FN} Missing server configuration`);
    return json({ error: "Server configuration error" }, 500);
  }
  if (
    !isAuthorizedInternalRequest(
      req.headers.get("Authorization"),
      serviceRoleKey,
      req.headers.get("X-Workflow-Secret"),
      workflowSecret,
    )
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  let repairRequest;
  try {
    repairRequest = parseRepairRequest(await req.json());
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Invalid request",
    }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("twilio_subaccount_sid, twilio_subaccount_status")
    .eq("id", repairRequest.organizationId)
    .maybeSingle();
  if (organizationError || !organization) {
    console.error(`${FN} Organization lookup failed`);
    return json({ error: "Organization not found" }, 404);
  }
  const subaccountSid = String(organization.twilio_subaccount_sid ?? "").trim();
  if (
    organization.twilio_subaccount_status !== "active" ||
    !ACCOUNT_SID_PATTERN.test(subaccountSid)
  ) {
    return json({ error: "Organization telephony is not active" }, 409);
  }

  const { data: rawRows, error: rowsError } = await supabase
    .from("phone_numbers")
    .select("id, organization_id, status, twilio_sid, created_at")
    .in("id", repairRequest.phoneNumberIds);
  if (rowsError) {
    console.error(`${FN} Phone-number lookup failed`);
    return json({ error: "Could not load repair targets" }, 500);
  }

  let targets: RepairTargetRow[];
  try {
    targets = validateRepairTargets(
      repairRequest,
      (rawRows ?? []) as RepairTargetRow[],
    );
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Invalid repair targets",
    }, 409);
  }

  const credentials = loadOutboundTwilioCreds();
  if (!credentials.ok) {
    console.error(`${FN} ${credentials.code}`);
    return json(
      { error: credentials.error, code: credentials.code },
      credentials.status,
    );
  }
  const { accountSid: masterAccountSid, authToken } = credentials.creds;
  if (
    !ACCOUNT_SID_PATTERN.test(masterAccountSid) ||
    masterAccountSid === subaccountSid
  ) {
    console.error(`${FN} Invalid account topology`);
    return json({ error: "Twilio account topology is misconfigured" }, 500);
  }

  const config = canonicalNumberConfig(supabaseUrl);
  const results: Array<Record<string, unknown>> = [];

  const twilioClient: RepairTwilioClient = {
    lookup: (resourceAccountSid, phoneNumberSid) =>
      twilioRequest(
        masterAccountSid,
        authToken,
        resourceAccountSid,
        phoneNumberSid,
      ),
    transfer: (sourceAccountSid, phoneNumberSid, targetAccountSid) =>
      twilioRequest(
        masterAccountSid,
        authToken,
        sourceAccountSid,
        phoneNumberSid,
        transferForm(targetAccountSid),
      ),
    configure: (resourceAccountSid, phoneNumberSid, expectedConfig) =>
      twilioRequest(
        masterAccountSid,
        authToken,
        resourceAccountSid,
        phoneNumberSid,
        configurationForm(expectedConfig),
      ),
  };

  for (const target of targets) {
    let ownershipStatus: "repaired" | "already_repaired";
    try {
      const repaired = await repairNumberOwnership({
        masterAccountSid,
        subaccountSid,
        phoneNumberSid: target.twilio_sid,
        config,
        client: twilioClient,
        markTrustHubPending: async () => {
          const { data: updated, error: updateError } = await supabase
            .from("phone_numbers")
            .update({ trust_hub_status: "pending" })
            .eq("id", target.id)
            .eq("organization_id", repairRequest.organizationId)
            .select("id")
            .maybeSingle();
          if (updateError || !updated) throw new Error("Update failed");
        },
      });
      ownershipStatus = repaired.status;
    } catch (error) {
      if (!(error instanceof RepairStepError)) {
        console.error(`${FN} Unexpected repair failure`);
        return json(
          { error: "Unexpected number repair failure", results },
          500,
        );
      }
      console.error(`${FN} Repair failed`, error.step, error.httpStatus);
      if (error.step === "database_update") {
        return json({ error: repairErrorMessage(error.step), results }, 500);
      }
      const failure = sanitizeTwilioFailure(error.httpStatus, error.payload);
      return json({
        error: repairErrorMessage(error.step),
        failure,
        results,
      }, 502);
    }

    results.push({
      phone_number_id: target.id,
      status: ownershipStatus,
      ownership_verified: true,
      webhooks_verified: true,
      trust_hub_status: "pending",
    });
  }

  return json({ repaired: results.length, results }, 200);
});
