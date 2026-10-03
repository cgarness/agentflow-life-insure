import { A2pError, type Db, type Registration, safeErrors } from "./types.ts";
import { TwilioA2p } from "./provider.ts";
import { checked, registration } from "./store.ts";
export async function syncRegistration(db: Db, twilio: TwilioA2p, org: string): Promise<Registration> {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = checked(
    await db.from("a2p_registrations").update({ sync_token: token, sync_started_at: now }).eq("organization_id", org)
      .is("operation_id", null)
      .or(`sync_token.is.null,sync_started_at.lt.${new Date(Date.now() - 120000).toISOString()}`).select("*")
      .maybeSingle(),
  ) as Registration | null;
  if (!row) throw new A2pError("SYNC_BUSY", "Registration status is already being refreshed.", 409);
  try {
    if (row.account_sid && row.account_sid !== twilio.creds.accountSid) {
      throw new A2pError("ACCOUNT_CHANGED", "Registration account needs reconciliation.", 409);
    }
    let brand: Record<string, any> | undefined;
    if (row.brand_sid) {
      brand = await twilio.call(`https://messaging.twilio.com/v1/a2p/BrandRegistrations/${row.brand_sid}`);
    } else if (row.brand_bundle_sid) {
      const b = await twilio.list(
        `https://messaging.twilio.com/v1/a2p/BrandRegistrations?A2PProfileBundleSid=${row.brand_bundle_sid}`,
        "data",
      );
      if (b.length > 1) {
        throw new A2pError("BRAND_AMBIGUOUS", "Multiple brand records need administrator reconciliation.", 409);
      }
      brand = b[0];
    }
    if (
      brand &&
      (brand.account_sid !== twilio.creds.accountSid ||
        (row.brand_bundle_sid && brand.a2p_profile_bundle_sid !== row.brand_bundle_sid))
    ) throw new A2pError("BRAND_SCOPE", "Provider brand ownership does not match.", 409);
    if (
      brand &&
      (!/^BN[0-9a-fA-F]{32}$/.test(brand.sid ?? "") || typeof brand.status !== "string" ||
        typeof brand.mock !== "boolean")
    ) {
      throw new A2pError("INVALID_PROVIDER_RESPONSE", "Brand status could not be verified.", 502);
    }
    let campaign: Record<string, any> | undefined;
    const pool: { phone_number_id: string; pool_member: boolean }[] = [];
    if (row.messaging_service_sid) {
      const cs = await twilio.list(
        `https://messaging.twilio.com/v1/Services/${row.messaging_service_sid}/Compliance/Usa2p`,
        "compliance",
      );
      if (cs.length > 1) {
        throw new A2pError("CAMPAIGN_AMBIGUOUS", "Multiple messaging campaigns need reconciliation.", 409);
      }
      campaign = cs[0];
      if (
        campaign &&
        (campaign.account_sid !== twilio.creds.accountSid ||
          campaign.brand_registration_sid !== (brand?.sid ?? row.brand_sid) ||
          campaign.messaging_service_sid !== row.messaging_service_sid)
      ) throw new A2pError("CAMPAIGN_SCOPE", "Provider campaign ownership does not match.", 409);
      if (
        campaign &&
        (!/^QE[0-9a-fA-F]{32}$/.test(campaign.sid ?? "") || typeof campaign.campaign_status !== "string" ||
          typeof campaign.mock !== "boolean")
      ) {
        throw new A2pError("INVALID_PROVIDER_RESPONSE", "Campaign status could not be verified.", 502);
      }
      const members = await twilio.list(
        `https://messaging.twilio.com/v1/Services/${row.messaging_service_sid}/PhoneNumbers?PageSize=100`,
        "phone_numbers",
      );
      const linked = checked(
        await db.from("a2p_numbers").select("phone_number_id,phone_sid").eq("organization_id", org),
      ) as { phone_number_id: string; phone_sid: string }[];
      for (const n of linked) {
        const member = members.some((m) =>
          m.sid === n.phone_sid && m.account_sid === twilio.creds.accountSid &&
          m.service_sid === row.messaging_service_sid
        );
        pool.push({ phone_number_id: n.phone_number_id, pool_member: member });
      }
    }
    const snap = {
      pool,
      brand_sid: brand?.sid ?? row.brand_sid,
      brand_status: brand?.status ?? (row.brand_inquiry_id ? "draft" : row.brand_status),
      identity_status: brand ? brand.identity_status ?? null : row.identity_status,
      brand_errors: safeErrors(brand?.errors?.length ? brand.errors : brand?.failure_reason),
      campaign_sid: campaign?.sid ?? row.campaign_sid,
      campaign_status: campaign?.campaign_status ??
        (row.campaign_sid ? "not_found" : row.campaign_inquiry_id ? "draft" : row.campaign_status),
      campaign_errors: safeErrors(campaign?.errors?.length ? campaign.errors : campaign?.failure_reason),
      is_test: brand?.mock === true || campaign?.mock === true || row.is_test,
    };
    const committed = checked(await db.rpc("commit_a2p_snapshot", { p_org: org, p_token: token, p_snapshot: snap }));
    if (!committed) throw new A2pError("SYNC_CHANGED", "A newer refresh replaced this one.", 409);
    return (await registration(db, org))!;
  } catch (e) {
    await db.from("a2p_registrations").update({
      sync_token: null,
      sync_started_at: null,
      sync_error: "Status could not be refreshed. Last known status may be out of date.",
    }).eq("organization_id", org).eq("sync_token", token);
    throw e;
  }
}
