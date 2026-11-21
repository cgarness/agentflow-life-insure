import { z } from "https://esm.sh/zod@3.25.76";
import { A2pError, type Account, brandReady, canResume, configReady, type Db, type Registration } from "./types.ts";
import { inquirySession, resumedSession, TwilioA2p } from "./provider.ts";
import { checked, history, lockOperation, patchOperation, unlock } from "./store.ts";
const https = z.string().trim().max(2048).refine((s) => s === "" || /^https:\/\/[^\s]+$/.test(s), "Use an HTTPS URL");
export const draftSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  brandType: z.enum(["STANDARD", "SOLE_PROPRIETOR"]),
  website: https.refine((v) => v.length <= 255, "Business website must be 255 characters or fewer"),
  description: z.string().trim().max(4096),
  privacyUrl: https,
  termsUrl: https,
}).strict();
export async function saveDraft(
  db: Db,
  org: string,
  actor: string,
  input: unknown,
  version: number | null,
): Promise<Registration> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw new A2pError("VALIDATION", "Check the business name, registration type and website URLs.");
  if (version === null) {
    const res = await db.from("a2p_registrations").insert({
      organization_id: org,
      created_by: actor,
      draft: parsed.data,
    }).select("*").maybeSingle();
    if (res.error?.code === "23505") {
      throw new A2pError("DRAFT_CHANGED", "Another administrator created this draft. Reload before editing.", 409);
    }
    return checked(res) as Registration;
  }
  const saved = checked(
    await db.from("a2p_registrations").update({
      draft: parsed.data,
      version: version + 1,
      updated_at: new Date().toISOString(),
    }).eq("organization_id", org).eq("version", version).is("operation_id", null).select("*").maybeSingle(),
  );
  if (!saved) {
    throw new A2pError("DRAFT_CHANGED", "This draft changed or an action is in progress. Reload before editing.", 409);
  }
  return saved as Registration;
}
export async function openRegistration(
  db: Db,
  t: TwilioA2p,
  a: Account,
  r: Registration,
  stage: "brand" | "campaign",
  actor: { id: string; email: string },
  feeVersion: string,
) {
  if (!configReady(a) || feeVersion !== a.fee_version) {
    throw new A2pError("SETUP_REQUIRED", "Account setup or the current fee review is incomplete.", 409);
  }
  if (r.account_sid && r.account_sid !== a.account_sid) {
    throw new A2pError("ACCOUNT_CHANGED", "Registration account changed. Contact support.", 409);
  }
  const status = stage === "brand" ? r.brand_status : r.campaign_status;
  if (!canResume(status)) {
    throw new A2pError(
      "REGISTRATION_IN_REVIEW",
      "Refresh status. A registration under review or already approved cannot be resubmitted.",
      409,
    );
  }
  if (stage === "campaign" && !brandReady(r)) {
    throw new A2pError("BRAND_NOT_READY", "Complete brand verification before registering a campaign.", 409);
  }
  const op = await lockOperation(db, r, stage);
  try {
    await history(db, r.organization_id, "fee_authorization", {
      stage,
      fee_version: a.fee_version,
      fees: a.fees,
      draft: r.draft,
    }, actor.id);
    let session;
    if (stage === "brand") {
      if (r.brand_inquiry_id) {
        session = resumedSession(
          await t.call(
            `https://trusthub.twilio.com/v1/A2PBrandRegistrations/${
              encodeURIComponent(r.brand_inquiry_id)
            }/EmbeddedSessions`,
            "POST",
            {},
          ),
        );
      } else {
        const p = inquirySession(
          await t.call("https://trusthub.twilio.com/v1/A2PBrandRegistrations", "POST", {
            brandType: r.draft.brandType,
            friendlyName: `AgentFlow ${r.organization_id}`,
            notificationEmail: actor.email,
            ...(a.theme_id ? { themeSetId: a.theme_id } : {}),
            businessName: r.draft.businessName,
            businessIndustry: "INSURANCE",
            ...(r.draft.website ? { businessWebsite: r.draft.website } : {}),
          }),
          a.account_sid,
        );
        r = await patchOperation(db, r.organization_id, op, {
          account_sid: a.account_sid,
          brand_inquiry_id: p.id,
          brand_bundle_sid: p.bundle,
          brand_status: "draft",
        });
        session = p;
      }
    } else {
      if (!r.messaging_service_sid) {
        const mg = await t.call("https://messaging.twilio.com/v1/Services", "POST", {
          FriendlyName: `AgentFlow A2P ${r.organization_id}`,
          UseInboundWebhookOnNumber: true,
        }, true);
        if (!/^MG[0-9a-fA-F]{32}$/.test(mg.sid ?? "") || mg.account_sid !== a.account_sid) {
          throw new A2pError("SERVICE_UNCONFIRMED", "Messaging Service requires reconciliation.", 502, true);
        }
        r = await patchOperation(db, r.organization_id, op, { messaging_service_sid: mg.sid });
      }
      if (r.campaign_sid || r.campaign_inquiry_id) {
        const id = r.campaign_sid ? r.messaging_service_sid : r.campaign_inquiry_id;
        session = resumedSession(
          await t.call(
            `https://trusthub.twilio.com/v1/A2PCampaignRegistrations/${encodeURIComponent(id!)}/EmbeddedSessions`,
            "POST",
            {},
          ),
        );
      } else {
        // Only documented required fields: prefill support differs by provider entitlement.
        const p = inquirySession(
          await t.call("https://trusthub.twilio.com/v1/A2PCampaignRegistrations", "POST", {
            a2pBrandRegistrationSid: r.brand_sid,
            messagingServiceSid: r.messaging_service_sid,
            ...(a.theme_id ? { themeSetId: a.theme_id } : {}),
          }),
          a.account_sid,
        );
        r = await patchOperation(db, r.organization_id, op, { campaign_inquiry_id: p.id, campaign_status: "draft" });
        session = p;
      }
    }
    await history(db, r.organization_id, "secure_form_opened", { stage }, actor.id);
    await unlock(db, r.organization_id, op);
    return { sessionId: session.sessionId, sessionToken: session.sessionToken, stage };
  } catch (e) {
    if (!(e instanceof A2pError) || e.uncertain || e.code === "DATABASE_ERROR") {
      throw new A2pError(
        "RECONCILIATION_REQUIRED",
        "The action may have reached Twilio. Contact support to reconcile before retrying.",
        503,
        true,
      );
    }
    await unlock(db, r.organization_id, op);
    throw e;
  }
}
export { attachNumber } from "./numberAttachment.ts";
