// Run after appointment-refusal.sql. With "refuse", the agency's sending window has moved later: the worker picks up the
// reminder text, reserves its provider request, and the final authorization refuses it. The reservation is cancelled
// before any handoff and nothing reaches the provider. With "send", the window is open again: the next lease releases
// that cancelled reservation, reserves afresh and sends the text exactly once.
import assert from "node:assert/strict";
import type { AutomationClaim } from "../../../supabase/functions/_shared/automations/runtime.ts";
import { allowConsent, calls, db, id, processClaim } from "./channel-transport.ts";
allowConsent(true);
const phase = Deno.args[0];
assert.ok(phase === "refuse" || phase === "send", "Choose refuse or send.");
const run = id(28);
const { data, error } = await db.rpc("automation_claim_work", { p_limit: 1 });
assert.ifError(error);
const claims = data as AutomationClaim[];
assert.equal(claims.length, 1, "the held reminder is the only work due");
assert.equal(claims[0].run_id, run);
assert.equal(claims[0].node_id, "text");
await processClaim(claims[0]);
const reservation = await db.from("sms_dispatches").select("state,error_code").eq("organization_id", id(1))
  .eq("request_key", `automation:${run}:text`).maybeSingle();
assert.ifError(reservation.error);
if (phase === "refuse") {
  assert.equal(calls.length, 0, "nothing reaches the provider outside sending hours");
  assert.deepEqual(reservation.data, { state: "failed", error_code: "pre_handoff_cancelled" },
    "the request reserved for the refused text was cancelled before any handoff");
  console.log("Verified native refusal: a reminder outside sending hours was refused at its final authorization, its reservation cancelled before any handoff.");
} else {
  assert.equal(calls.length, 1, "the reminder reaches the provider once");
  assert.equal(calls[0].get("To"), "+12025550149");
  assert.equal(reservation.data?.state, "accepted", "the fresh reservation was accepted");
  const history = await db.from("messages").select("id").eq("organization_id", id(1)).eq("contact_id", id(18));
  assert.ifError(history.error);
  assert.equal(history.data?.length, 1, "the reminder was recorded once");
  console.log("Verified native retry: once the sending window opened, the next lease sent the refused reminder exactly once.");
}
