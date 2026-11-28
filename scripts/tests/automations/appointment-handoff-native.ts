// Run after channel-fixture.sql, channel-native.ts and appointment-handoff-fixture.sql on the same disposable local
// AgentFlow database, with Deno network limited to loopback. The worker picks up five reminder texts. Two
// appointments change before the worker starts on their texts, and two more change at the last moment, just before
// the final authorization. Only the reminder whose appointment never changed reaches the synthetic provider.
import assert from "node:assert/strict";
import type { AutomationClaim } from "../../../supabase/functions/_shared/automations/runtime.ts";
import { allowConsent, calls, db, id, interceptOnce, pendingInterceptors, processClaim } from "./channel-transport.ts";
allowConsent(true);
const run = (n: number) => id(20 + n);
const { data, error } = await db.rpc("automation_claim_work", { p_limit: 5 });
assert.ifError(error);
const claims = data as AutomationClaim[];
assert.deepEqual(claims.map((claim) => claim.run_id).sort(), [3, 4, 5, 6, 7].map(run).sort(),
  "the worker picks up exactly the five reminders");
const claim = (n: number) => claims.find((item) => item.run_id === run(n))!;
const start = async (n: number) => {
  const row = await db.from("appointments").select("start_time").eq("id", id(40 + n)).single();
  assert.ifError(row.error);
  return new Date(row.data!.start_time);
};
for (const n of [3, 4, 5, 6, 7]) {
  assert.equal(claim(n).node_id, "text");
  assert.equal(new Date(claim(n).context?.appointment_start ?? "").getTime(), (await start(n)).getTime(),
    "each lease carries its appointment's time");
}
const move = async (n: number) => {
  const later = new Date((await start(n)).getTime() + 24 * 3600_000);
  const moved = await db.from("appointments").update({
    start_time: later.toISOString(),
    end_time: new Date(later.getTime() + 30 * 60_000).toISOString(),
  }).eq("id", id(40 + n)).select("id");
  assert.ifError(moved.error);
  assert.equal(moved.data?.length, 1);
};
const cancel = async (n: number) => {
  const cancelled = await db.from("appointments").update({ status: "Cancelled" }).eq("id", id(40 + n)).select("id");
  assert.ifError(cancelled.error);
  assert.equal(cancelled.data?.length, 1);
};
const dispatchRow = async (n: number) => {
  const row = await db.from("sms_dispatches").select("state,error_code").eq("organization_id", id(1))
    .eq("request_key", `automation:${run(n)}:text`).maybeSingle();
  assert.ifError(row.error);
  return row.data;
};
const before = calls.length;
// After the pickup, before the worker starts: one appointment moves a day later and another is cancelled.
await move(3);
await cancel(4);
for (const n of [3, 4]) await processClaim(claim(n));
for (const n of [3, 4]) assert.equal(await dispatchRow(n), null, "no provider request was reserved for a change made first");
// Unchanged.
await processClaim(claim(5));
// At the last moment: the change commits just before the final authorization is asked for.
const atAuthorization = (n: number) => (url: URL, body: string) =>
  url.pathname === "/rest/v1/rpc/automation_begin_message" && JSON.parse(body).p_run === run(n);
interceptOnce(atAuthorization(6), () => move(6));
interceptOnce(atAuthorization(7), () => cancel(7));
for (const n of [6, 7]) await processClaim(claim(n));
assert.equal(pendingInterceptors(), 0, "both texts reached the final authorization");
for (const n of [6, 7]) {
  assert.deepEqual(await dispatchRow(n), { state: "failed", error_code: "pre_handoff_cancelled" },
    "the request reserved for a refused text was cancelled before any handoff");
}
assert.equal(calls.length, before + 1, "only the reminder whose appointment never changed reaches the provider");
const sent = calls[calls.length - 1];
assert.equal(sent.get("To"), "+12025550146");
const time = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
  timeZone: "UTC",
}).format(await start(5));
assert.equal(sent.get("Body"), "Reminder: " + time);
for (const n of [3, 4, 6, 7]) {
  const history = await db.from("messages").select("id").eq("organization_id", id(1)).eq("contact_id", id(10 + n));
  assert.ifError(history.error);
  assert.equal(history.data?.length, 0, "no message was recorded for a refused reminder");
}
console.log(
  "Verified native appointment reminders: moves and cancellations after pickup, whether made before the worker started or just before final authorization, reached no provider; the unchanged reminder was sent once.",
);
