import { checked } from "../a2p/store.ts";
import { A2pError, type Db } from "../a2p/types.ts";
import { TwilioA2p } from "../a2p/provider.ts";
import { loadOutboundTwilioCreds } from "../twilioOutboundCreds.ts";
import { ACCOUNT_SID, NUMBER_SID } from "./contracts.ts";
import type { SetupJob, SetupOutcome } from "./setupTypes.ts";

type TrustNumber = Pick<SetupJob, "organization_id" | "phone_number_id" | "phone_number" | "phone_sid" | "account_sid">;

const BU = /^BU[0-9a-f]{32}$/i;
const BN = /^BN[0-9a-f]{32}$/i;
const review = (code: string): SetupOutcome => ({ state: "review", code });
const waiting = (code: string): SetupOutcome => ({
  state: "waiting",
  code,
  retrySeconds: 900,
});

async function profileForAgency(db: Db, job: TrustNumber): Promise<string | null> {
  const row = checked(
    await db.from("phone_settings").select("trust_hub_profile_sid")
      .eq("organization_id", job.organization_id).maybeSingle(),
  ) as { trust_hub_profile_sid: string | null } | null;
  return row?.trust_hub_profile_sid ?? null;
}

async function proveProfileBinding(
  db: Db,
  job: TrustNumber,
  profile: string,
  t: TwilioA2p,
): Promise<SetupOutcome | null> {
  const [otherSettings, pin] = await Promise.all([
    db.from("phone_settings").select("id").eq("trust_hub_profile_sid", profile)
      .neq("organization_id", job.organization_id).limit(1).maybeSingle(),
    db.from("phone_number_setup_profiles").select("organization_id,account_sid")
      .eq("profile_sid", profile).maybeSingle(),
  ]);
  if (checked(otherSettings)) return review("TRUST_PROFILE_CONFLICT");
  const proof = checked(pin) as
    | { organization_id: string; account_sid: string }
    | null;
  if (proof) {
    return proof.organization_id === job.organization_id &&
        proof.account_sid === job.account_sid
      ? null
      : review("TRUST_PROFILE_CONFLICT");
  }
  // Existing agencies can prove their saved BU with their server-owned brand.
  // A user-editable settings SID or the shared platform primary profile is insufficient.
  const brandRow = checked(
    await db.from("a2p_registrations").select("account_sid,brand_sid,is_test")
      .eq("organization_id", job.organization_id).maybeSingle(),
  ) as {
    account_sid: string;
    brand_sid: string;
    is_test: boolean;
  } | null;
  if (!brandRow || !BN.test(brandRow.brand_sid) || brandRow.is_test) {
    return waiting("TRUST_PROFILE_UNVERIFIED");
  }
  if (brandRow.account_sid !== job.account_sid) {
    return review("ACCOUNT_MISMATCH");
  }
  const brand = await t.call(
    `https://messaging.twilio.com/v1/a2p/BrandRegistrations/${brandRow.brand_sid}`,
  );
  if (
    brand.account_sid !== job.account_sid || brand.sid !== brandRow.brand_sid ||
    brand.mock !== false ||
    brand.customer_profile_bundle_sid !== profile
  ) return review("TRUST_PROFILE_UNVERIFIED");
  return null;
}

export async function setupTrust(
  db: Db,
  job: SetupJob,
  signal: AbortSignal,
  load = loadOutboundTwilioCreds,
  request: typeof fetch = fetch,
): Promise<SetupOutcome> {
  const master = load();
  if (!master.ok) return { state: "retry", code: "PROVIDER_RETRY" };
  if (
    !ACCOUNT_SID.test(job.account_sid) ||
    master.creds.accountSid !== job.account_sid ||
    !NUMBER_SID.test(job.phone_sid)
  ) {
    return review("ACCOUNT_MISMATCH");
  }
  const profile = await profileForAgency(db, job);
  if (!profile) return waiting("WAITING_TRUST_PROFILE");
  if (!BU.test(profile)) return review("TRUST_PROFILE_UNVERIFIED");
  return await assignVerifiedTrustNumber(db, job, profile, new TwilioA2p(master.creds, request, signal), true);
}

export async function assignVerifiedTrustNumber(
  db: Db, job: TrustNumber, profile: string, t: TwilioA2p, sharedAccount: boolean,
): Promise<SetupOutcome> {
  if (!BU.test(profile) || !NUMBER_SID.test(job.phone_sid) || t.creds.accountSid !== job.account_sid) return review("TRUST_PROFILE_CONFLICT");
  const profileUrl =
    `https://trusthub.twilio.com/v1/CustomerProfiles/${profile}`;
  const numberUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${job.account_sid}/IncomingPhoneNumbers/${job.phone_sid}.json`;
  let customer, number;
  try {
    const proofFailure = sharedAccount ? await proveProfileBinding(db, job, profile, t) : null;
    if (proofFailure) return proofFailure;
    [customer, number] = await Promise.all([
      t.call(profileUrl),
      t.call(numberUrl),
    ]);
  } catch (e) {
    if (e instanceof A2pError && e.code === "PROVIDER_404") {
      return review("TRUST_PROFILE_UNVERIFIED");
    }
    throw e;
  }
  if (customer.sid !== profile || customer.account_sid !== job.account_sid) {
    return review("TRUST_PROFILE_CONFLICT");
  }
  if (customer.status === "twilio-rejected") {
    return review("TRUST_PROFILE_REJECTED");
  }
  if (customer.status !== "twilio-approved") {
    return waiting("WAITING_TRUST_PROFILE");
  }
  if (
    number.sid !== job.phone_sid || number.phone_number !== job.phone_number ||
    number.account_sid !== job.account_sid ||
    number.capabilities?.voice !== true
  ) return review("NUMBER_SCOPE_CHANGED");

  const assignments = profileUrl + "/ChannelEndpointAssignments";
  const findAssignment = async () => {
    const rows = await t.list(
      assignments + "?ChannelEndpointSid=" + job.phone_sid,
      "results",
    );
    if (!rows.length) return false;
    if (
      rows.length !== 1 || rows[0].account_sid !== job.account_sid ||
      rows[0].customer_profile_sid !== profile ||
      rows[0].channel_endpoint_sid !== job.phone_sid ||
      rows[0].channel_endpoint_type !== "phone-number" ||
      !/^RA[0-9a-f]{32}$/i.test(rows[0].sid ?? "")
    ) {
      throw new A2pError(
        "TRUST_ASSIGNMENT_CONFLICT",
        "Could not verify the number's exact profile assignment.",
        409,
      );
    }
    return true;
  };
  const complete: SetupOutcome = {
    state: "complete",
    code: "TRUST_LINKED",
    profileSid: profile,
  };
  try {
    if (await findAssignment()) return complete;
    const active = checked(
      await db.from("phone_numbers").select("id").eq("id", job.phone_number_id)
        .eq("organization_id", job.organization_id).eq(
          "twilio_sid",
          job.phone_sid,
        ).eq("phone_number", job.phone_number)
        .in("status", ["active", "Active"]).maybeSingle(),
    );
    if (!active) return review("NUMBER_SCOPE_CHANGED");
    if ((await profileForAgency(db, job)) !== profile) {
      return review("TRUST_PROFILE_CONFLICT");
    }
    try {
      await t.call(assignments, "POST", {
        ChannelEndpointSid: job.phone_sid,
        ChannelEndpointType: "phone-number",
      }, true);
    } catch (e) {
      if (
        e instanceof A2pError &&
        ["PROVIDER_400", "PROVIDER_409"].includes(e.code)
      ) {
        // A duplicate response may name an assignment outside the intended profile.
        return await findAssignment()
          ? complete
          : review("TRUST_ASSIGNMENT_CONFLICT");
      }
      throw e;
    }
    return await findAssignment()
      ? complete
      : { state: "retry", code: "PROVIDER_RETRY" };
  } catch (e) {
    if (e instanceof A2pError && e.code === "TRUST_ASSIGNMENT_CONFLICT") {
      return review(e.code);
    }
    throw e;
  }
}
