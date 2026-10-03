import { credentials, database, failure, json } from "../_shared/a2p/auth.ts";
import { account, checked } from "../_shared/a2p/store.ts";
import { A2pError } from "../_shared/a2p/types.ts";
import { TwilioA2p } from "../_shared/a2p/provider.ts";
import { syncRegistration } from "../_shared/a2p/sync.ts";
import { deliverEmails } from "../_shared/a2p/notifications.ts";
Deno.serve(async (req: Request) => {
  try {
    const secret = Deno.env.get("A2P_RECONCILE_SECRET");
    if (req.method !== "POST" || !secret || req.headers.get("Authorization") !== `Bearer ${secret}`) {
      throw new A2pError("FORBIDDEN", "Unauthorized.", 403);
    }
    const db = database();
    let processed = 0, failed = 0;
    const deadline = AbortSignal.timeout(45000), started = Date.now(), synced = new Set<string>();
    async function sync(org: string) {
      if (synced.has(org)) return;
      checked(
        await db.from("a2p_registrations").update({ sync_attempted_at: new Date().toISOString() }).eq(
          "organization_id",
          org,
        ),
      );
      const a = await account(db, org);
      if (!a) throw new A2pError("ACCOUNT_REQUIRED", "Registration account unavailable.");
      await syncRegistration(db, new TwilioA2p(await credentials(db, a), fetch, deadline), org);
      synced.add(org);
    }
    const inbox = checked(
      await db.from("a2p_event_inbox").select("*").is("processed_at", null).lt("attempts", 8).lte(
        "retry_at",
        new Date().toISOString(),
      ).order("received_at").limit(25),
    ) as Record<string, any>[];
    for (const e of inbox) {
      if (Date.now() - started > 35000) break;
      try {
        if (e.event_type.includes(".number-")) {
          checked(await db.rpc("process_a2p_number_event", { p_account: e.account_sid, p_event: e.event_id }));
        } else {
          await sync(e.organization_id);
          checked(
            await db.from("a2p_event_inbox").update({ processed_at: new Date().toISOString() }).eq(
              "account_sid",
              e.account_sid,
            ).eq("event_id", e.event_id),
          );
        }
        processed++;
      } catch {
        failed++;
        // A malformed/missing mapping cannot starve unrelated agencies indefinitely.
        checked(
          await db.from("a2p_event_inbox").update({
            attempts: e.attempts + 1,
            retry_at: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** e.attempts)).toISOString(),
            last_error: "Reconciliation failed; verify account and resource mapping.",
          }).eq("account_sid", e.account_sid).eq("event_id", e.event_id),
        );
      }
    }
    const regs = checked(
      await db.from("a2p_registrations").select("organization_id").not("account_sid", "is", null).order(
        "sync_attempted_at",
        { ascending: true, nullsFirst: true },
      ).limit(2),
    ) as { organization_id: string }[];
    for (const r of regs) {
      if (Date.now() - started > 35000) break;
      try {
        await sync(r.organization_id);
      } catch {
        failed++;
      }
    }
    await deliverEmails(db);
    return json({ processed, failed });
  } catch (e) {
    return failure(e);
  }
});
