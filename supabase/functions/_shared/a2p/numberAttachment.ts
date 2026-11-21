import { TwilioA2p } from "./provider.ts";
import { checked, history, lockOperation, unlock } from "./store.ts";
import { A2pError, type Account, campaignReady, type Db, type Registration } from "./types.ts";

export type PurchasedSender = {
  purchase_id: string;
  lease_token: string;
  signal: AbortSignal;
  account_sid: string;
  phone_sid: string;
  phone_number: string;
};
const serviceBase = "https://messaging.twilio.com/v1/Services";
function reject(code: string, message: string): never {
  throw new A2pError(code, message, 409);
}

async function checkTargets(
  t: TwilioA2p,
  a: Account,
  r: Registration,
  n: Record<string, any>,
) {
  const serviceUrl = serviceBase + "/" + r.messaging_service_sid;
  const [brand, campaigns, service, pn] = await Promise.all([
    t.call(
      "https://messaging.twilio.com/v1/a2p/BrandRegistrations/" + r.brand_sid,
    ),
    t.list(serviceUrl + "/Compliance/Usa2p", "compliance"),
    t.call(serviceUrl),
    t.number(n.twilio_sid),
  ]);
  if (campaigns.length !== 1) reject("SERVICE_CONFIGURATION", "This service needs one verified agency campaign.");
  const campaign = campaigns[0];
  if (
    brand.account_sid !== a.account_sid || brand.sid !== r.brand_sid ||
    (r.brand_bundle_sid &&
      brand.a2p_profile_bundle_sid !== r.brand_bundle_sid) ||
    service.account_sid !== a.account_sid ||
    service.sid !== r.messaging_service_sid ||
    campaign.account_sid !== a.account_sid || campaign.sid !== r.campaign_sid ||
    campaign.messaging_service_sid !== r.messaging_service_sid ||
    campaign.brand_registration_sid !== r.brand_sid
  ) {
    reject(
      "ACCOUNT_CHANGED",
      "The live registration does not match this agency’s verified resources.",
    );
  }
  if (
    brand.mock !== false || campaign.mock !== false ||
    !campaignReady({
      ...r,
      brand_status: brand.status,
      identity_status: brand.identity_status,
      campaign_status: campaign.campaign_status,
    })
  ) {
    reject(
      "CAMPAIGN_NOT_READY",
      "The agency’s live messaging campaign is not approved.",
    );
  }
  if (!["STANDARD", "SOLE_PROPRIETOR"].includes(brand.brand_type)) {
    reject(
      "SERVICE_CONFIGURATION",
      "The agency’s registration type needs verification.",
    );
  }
  if (
    pn.phone_number !== n.phone_number || !/^\+1\d{10}$/.test(n.phone_number) ||
    /^\+1(?:800|833|844|855|866|877|888)/.test(n.phone_number)
  ) {
    reject(
      "NUMBER_REGIME",
      "Only US local phone numbers can use this registration.",
    );
  }
  const lookup = await t.call(
    "https://lookups.twilio.com/v2/PhoneNumbers/" +
      encodeURIComponent(n.phone_number),
  );
  if (
    lookup.valid !== true || lookup.country_code !== "US" ||
    lookup.phone_number !== n.phone_number
  ) {
    reject(
      "NUMBER_COUNTRY",
      "Only verified US local numbers can use this registration.",
    );
  }
  // A Messaging Service can override a number’s inbound SMS webhook when it joins the pool.
  if (
    service.use_inbound_webhook_on_number !== true &&
    (!pn.sms_url || service.inbound_request_url !== pn.sms_url ||
      service.inbound_method !== "POST" || pn.sms_method !== "POST")
  ) {
    reject(
      "SERVICE_CONFIGURATION",
      "The Messaging Service must preserve the number’s inbound SMS webhook.",
    );
  }
  return {
    poolUrl: serviceUrl + "/PhoneNumbers",
    sole: brand.brand_type === "SOLE_PROPRIETOR" ||
      campaign.us_app_to_person_usecase === "SOLE_PROPRIETOR",
  };
}

export async function attachNumber(
  db: Db,
  t: TwilioA2p,
  a: Account,
  r: Registration,
  id: string,
  actor: string,
  purchase?: PurchasedSender,
) {
  if (
    r.organization_id !== a.organization_id || a.account_sid !== r.account_sid ||
    a.account_sid !== t.creds.accountSid ||
    (purchase && purchase.account_sid !== a.account_sid)
  ) reject("ACCOUNT_CHANGED", "The registration account and the number’s owner must match.");
  if (
    !a.enabled || !a.sms_enforced || !a.resources_reconciled_at || !campaignReady(r) ||
    !/^MG[\da-f]{32}$/i.test(r.messaging_service_sid ?? "") || !/^BN[\da-f]{32}$/i.test(r.brand_sid ?? "") ||
    !/^QE[\da-f]{32}$/i.test(r.campaign_sid ?? "")
  ) reject("CAMPAIGN_NOT_READY", "The agency needs a verified campaign.");
  if (r.operation_id) reject("OPERATION_PENDING", "An administrator’s registration operation must finish first.");

  const n = checked(
    await db.from("phone_numbers").select("id,twilio_sid,phone_number,status,inbounds_only")
      .eq("organization_id", r.organization_id).eq("id", id).maybeSingle(),
  ) as Record<string, any> | null;
  if (!n || !["active", "Active"].includes(n.status)) reject("NUMBER_UNAVAILABLE", "Select an active agency number.");
  if (n.inbounds_only) reject("VOICE_ONLY", "This number is reserved for inbound calls.");
  if (purchase && (purchase.phone_number !== n.phone_number || purchase.phone_sid !== n.twilio_sid)) {
    reject("NUMBER_MAPPING_CHANGED", "The phone number no longer matches its purchase receipt.");
  }
  if (!purchase) {
    const setup = checked(
      await db.rpc("phone_number_setup_managed", { p_org: r.organization_id, p_number: n.phone_number }),
    ) as { managed?: boolean } | null;
    if (typeof setup?.managed !== "boolean") {
      reject("SETUP_UNAVAILABLE", "The sender's setup owner could not be verified.");
    }
    if (setup.managed) {
      reject("AUTOMATIC_NUMBER_SETUP", "This purchase already has automatic setup. Check its status in Phone Numbers.");
    }
  }
  // Automatic work has its own organization-serialized queue lease. The onboarding mutex
  // is consumed by production SMS senders and must never be taken by background attachment.
  const op = purchase ? null : await lockOperation(db, r, "attach_number");
  try {
    const { poolUrl, sole } = await checkTargets(t, a, r, n);
    const members = await t.list(poolUrl + "?PageSize=100", "phone_numbers");
    if (members.some((m) => m.service_sid !== r.messaging_service_sid || m.account_sid !== a.account_sid)) {
      reject("ACCOUNT_CHANGED", "Sender pool ownership could not be verified.");
    }
    const member = members.some((m) => m.sid === n.twilio_sid);
    if (!member && sole && members.length > 0) {
      reject("SENDER_LIMIT", "This campaign already has its permitted sender.");
    }
    const writeIntent = async (action: "member" | "reserve" | "rejected") =>
      checked(
        await db.rpc("phone_number_setup_sms_intent", {
          p_purchase: purchase!.purchase_id,
          p_lease: purchase!.lease_token,
          p_service: r.messaging_service_sid,
          p_brand: r.brand_sid,
          p_campaign: r.campaign_sid,
          p_action: action,
          p_sole: sole,
        }),
      );
    if (purchase) {
      // The final atomic check binds this lease, live agency/number, campaign and signed-event mapping.
      if (purchase.signal.aborted) {
        throw new A2pError("PROVIDER_UNAVAILABLE", "Setup needs another worker attempt.", 503);
      }
      const decision = await writeIntent(member ? "member" : "reserve");
      const errors: Record<string, string> = {
        busy: "OPERATION_PENDING",
        waiting: "CAMPAIGN_NOT_READY",
        capacity: "SENDER_LIMIT",
        conflict: "NUMBER_MAPPING_CHANGED",
        inactive: "NUMBER_UNAVAILABLE",
        failed: "REGISTRATION_FAILED",
        uncertain: "INTENT_UNCONFIRMED",
      };
      if (decision !== (member ? "member" : "post")) {
        reject(
          errors[String(decision)] ?? "INTENT_UNCONFIRMED",
          "Sender setup needs reconciliation before continuing.",
        );
      }
    } else {
      const prior = checked(
        await db.from("a2p_numbers").select("phone_sid,messaging_service_sid")
          .eq("organization_id", r.organization_id).eq("phone_number_id", id).maybeSingle(),
      ) as Record<string, any> | null;
      if (prior && (prior.phone_sid !== n.twilio_sid || prior.messaging_service_sid !== r.messaging_service_sid)) {
        reject("NUMBER_MAPPING_CHANGED", "This number already has a different registration mapping.");
      }
      if (!member && sole) {
        const reservations = checked(
          await db.from("a2p_numbers").select("phone_sid").eq("organization_id", r.organization_id)
            .eq("messaging_service_sid", r.messaging_service_sid).in("status", [
              "pending_registration",
              "registered",
              "pending_deregistration",
            ]),
        ) as { phone_sid: string }[];
        if (reservations.some((m) => m.phone_sid !== n.twilio_sid)) {
          reject("SENDER_LIMIT", "Another sender is reserved for this campaign.");
        }
      }
      if (!prior) {
        checked(
          await db.from("a2p_numbers").insert({
            organization_id: r.organization_id,
            phone_number_id: id,
            phone_sid: n.twilio_sid,
            messaging_service_sid: r.messaging_service_sid,
          }),
        );
      }
    }
    if (!member) {
      try {
        if (purchase?.signal.aborted) {
          await writeIntent("rejected"); // timeout before the external call, known zero provider writes
          throw new A2pError("PROVIDER_UNAVAILABLE", "Setup needs another worker attempt.", 503);
        }
        // Twilio rejects senders assigned elsewhere. Never remove or move a sender.
        const added = await t.call(poolUrl, "POST", { PhoneNumberSid: n.twilio_sid }, true);
        if (
          added.sid !== n.twilio_sid || added.service_sid !== r.messaging_service_sid ||
          added.account_sid !== a.account_sid
        ) {
          throw new A2pError("ATTACH_UNCONFIRMED", "Sender membership needs reconciliation.", 502, true);
        }
      } catch (error) {
        // These responses expressly reject a new assignment. A duplicate (21710), timeout, or
        // malformed response instead keeps the intent for read-only reconciliation.
        if (
          purchase && error instanceof A2pError && !error.uncertain &&
          (["PROVIDER_401", "PROVIDER_403", "PROVIDER_429"].includes(error.code) ||
            [21712, 21714, 21715, 30125].includes(error.providerCode ?? 0))
        ) {
          await writeIntent("rejected");
        }
        throw error;
      }
    }
    await history(db, r.organization_id, "number_link_requested", { phone_sid: n.twilio_sid }, actor);
    if (op) await unlock(db, r.organization_id, op);
  } catch (error) {
    if (op && error instanceof A2pError && !error.uncertain && error.code !== "DATABASE_ERROR") {
      await unlock(db, r.organization_id, op);
    }
    throw error;
  }
}
