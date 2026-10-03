import { admin, credentials, database, failure, json, readBody, verifyPlatformProfile } from "../_shared/a2p/auth.ts";
import { account, checked, registration } from "../_shared/a2p/store.ts";
import { A2pError, configReady } from "../_shared/a2p/types.ts";
import { TwilioA2p } from "../_shared/a2p/provider.ts";
import { attachNumber, openRegistration, saveDraft } from "../_shared/a2p/registration.ts";
import { syncRegistration } from "../_shared/a2p/sync.ts";
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({});
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const raw = await readBody(req, 40000);
    let b: Record<string, any>;
    try {
      b = JSON.parse(raw);
    } catch {
      throw new A2pError("INVALID_JSON", "Invalid request.");
    }
    if (!b || Array.isArray(b)) throw new A2pError("INVALID_REQUEST", "Invalid request.");
    const db = database(), actor = await admin(req, b, db), org = actor.organization_id;
    let r = await registration(db, org);
    const a = await account(db, org);
    if (b.action === "save_draft") {
      if (b.version !== null && (!Number.isInteger(b.version) || b.version < 1)) {
        throw new A2pError("VERSION_REQUIRED", "Reload the draft.");
      }
      r = await saveDraft(db, org, actor.id, b.draft, b.version);
    } else if (["refresh", "open_brand", "open_campaign", "attach_number"].includes(b.action)) {
      if (!a || !r) {
        throw new A2pError(
          "SETUP_REQUIRED",
          "Save your preparation details and ask your administrator to finish account setup.",
          409,
        );
      }
      const t = new TwilioA2p(await credentials(db, a));
      if (b.action === "refresh") r = await syncRegistration(db, t, org);
      else if (b.action === "attach_number") {
        if (typeof b.phone_number_id !== "string" || !/^[-0-9a-f]{36}$/i.test(b.phone_number_id)) {
          throw new A2pError("INVALID_NUMBER", "Select a phone number.");
        }
        r = await syncRegistration(db, t, org);
        await attachNumber(db, t, a, r, b.phone_number_id, actor.id);
        r = await syncRegistration(db, t, org);
      } else {
        if (b.accept_fees !== true || typeof b.fee_version !== "string") {
          throw new A2pError("FEES_REQUIRED", "Review and accept the current registration fees.");
        }
        if (r.account_sid) r = await syncRegistration(db, t, org);
        await verifyPlatformProfile(a);
        return json(
          await openRegistration(db, t, a, r, b.action === "open_brand" ? "brand" : "campaign", actor, b.fee_version),
        );
      }
    } else if (b.action !== "overview") throw new A2pError("INVALID_ACTION", "Unknown action.");
    const phones = checked(
      await db.from("phone_numbers").select("id,phone_number,twilio_sid,status,assignment_type").eq(
        "organization_id",
        org,
      ).in("status", ["active", "Active"]).order("created_at").limit(500),
    );
    const numbers = r
      ? checked(
        await db.from("a2p_numbers").select("phone_number_id,status,pool_member,checked_at,failure_reason,event_at").eq(
          "organization_id",
          org,
        ),
      )
      : [];
    const events = r
      ? checked(
        await db.from("a2p_history").select("id,kind,detail,created_at").eq("organization_id", org).order(
          "created_at",
          { ascending: false },
        ).limit(50),
      )
      : [];
    return json({
      registration: r
        ? {
          draft: r.draft,
          version: r.version,
          brand_status: r.brand_status,
          identity_status: r.identity_status,
          brand_errors: r.brand_errors,
          campaign_status: r.campaign_status,
          campaign_errors: r.campaign_errors,
          is_test: r.is_test,
          last_synced_at: r.last_synced_at,
          sync_error: r.sync_error,
          operation_pending: !!r.operation_id,
        }
        : null,
      phones,
      numbers,
      history: events,
      setup_ready: configReady(a),
      account_enabled: a?.enabled ?? false,
      fees: a?.fees ?? [],
      fee_version: a?.fee_version ?? null,
      fees_valid_until: a?.fees_valid_until ?? null,
      sms_enforced: a?.sms_enforced ?? false,
    });
  } catch (e) {
    return failure(e);
  }
});
