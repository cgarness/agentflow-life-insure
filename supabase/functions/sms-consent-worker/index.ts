import { database } from "../_shared/a2p/auth.ts";
import { checked, policy } from "../_shared/sms/consent.ts";
import { processLifecycle } from "../_shared/sms/lifecycle.ts";
import { dispatch } from "../_shared/sms/dispatch.ts";
import { selectedSender } from "../_shared/sms/scope.ts";
import { confirmationBody } from "../_shared/sms/confirmations.ts";
import { equal, failure, json, SmsError } from "../_shared/sms/wire.ts";
export async function handle(req: Request) {
  try {
    const token = Deno.env.get("SMS_CONSENT_WORKER_TOKEN") ?? "";
    if (
      req.method !== "POST" || token.length < 32 ||
      !equal(req.headers.get("Authorization") ?? "", `Bearer ${token}`)
    ) throw new SmsError("WORKER_AUTH", "Unauthorized.", 403);
    const db = database();
    checked(
      await db.from("sms_bridge_nonces").delete().lt(
        "created_at",
        new Date(Date.now() - 86400000).toISOString(),
      ),
    );
    const lifecycle = await processLifecycle(db);
    const jobs = checked(await db.rpc("sms_claim_confirmations"));
    for (const j of jobs ?? []) {
      let state = "pending";
      try {
        const p = await policy(db, j.organization_id);
        if (!p?.enforced) {
          throw new SmsError("SMS_PAUSED", "Agency not enrolled.");
        }
        await dispatch(db, {
          org: j.organization_id,
          key: `confirmation:${j.id}`,
          to: j.phone_e164,
          from: await selectedSender(db, p),
          body: confirmationBody(p.sender_name, j.purposes),
          purpose: j.purposes.includes("marketing")
            ? "marketing"
            : "informational",
          confirmation: {
            id: j.id,
            purposes: j.purposes,
            evidence: j.evidence_ids,
          },
        });
        state = "accepted";
      } catch (e) {
        if (
          e instanceof SmsError &&
          ["SMS_SUPPRESSED", "NO_CONSENT"].includes(e.code)
        ) state = "blocked";
        // Once an attempt exists, never blindly send it again; receipts drive reconciliation.
        const r = checked(
          await db.from("sms_dispatches").select("state").eq(
            "organization_id",
            j.organization_id,
          ).eq("request_key", `confirmation:${j.id}`).maybeSingle(),
        );
        if (r && r.state !== "prepared") {
          state = r.state === "attempting" ? "uncertain" : r.state;
        }
      }
      checked(
        await db.from("sms_confirmation_jobs").update({
          state,
          lease_id: null,
          lease_until: null,
          retry_at: new Date(Date.now() + 60000).toISOString(),
        }).eq("id", j.id).eq("lease_id", j.lease_id).eq("state", "pending"),
      );
    }
    return json({
      processed: jobs?.length ?? 0,
      ...lifecycle,
    });
  } catch (e) {
    return failure(e);
  }
}
if (import.meta.main) Deno.serve(handle);
