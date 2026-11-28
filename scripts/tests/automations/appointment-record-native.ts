// Run after appointment-record-fixture.sql on the same disposable local AgentFlow database, with Deno network limited
// to loopback. The sign-off demonstrations of the reminder record (a booking's texts are given once per appointment
// time across runs; a text that failed for a temporary reason is retried at most once on a qualifying new run; a stop
// committed before the final handoff wins), through the real worker: every lease goes through runAutomationClaim and
// dispatchChannel, and every provider request is a synthetic Twilio call counted in `calls`. A signed-in Admin of the
// agency books, moves, cancels and reopens appointments, records and corrects outcomes as the CRM does, and stops runs
// as the builder does. Twilio status callbacks are signed and go through the real receipt handler. The appointments
// booked here stand for Friday at 2 PM: a day and half a minute ahead, so the day before really arrives here. Time
// passes further only where a step says so (the fixture's automation_record_fixture_due).
import assert from "node:assert/strict";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { dispatchChannel } from "../../../supabase/functions/_shared/automations/channel.ts";
import { handleReceipt } from "../../../supabase/functions/_shared/automations/receiptHandler.ts";
import { type AutomationClaim, runAutomationClaim } from "../../../supabase/functions/_shared/automations/runtime.ts";
import { allowConsent, calls, db, endpoint, id, interceptOnce, pendingInterceptors, testFetch } from "./channel-transport.ts";

allowConsent(true);
Deno.env.set("SUPABASE_URL", endpoint);
const settings = JSON.parse(
  await Deno.readTextFile((Deno.env.get("AUTOMATION_TEST_SETTINGS") ?? Deno.env.get("AUTOMATIONS_LOCAL_SETTINGS"))!),
);
const org = id(1);
const flow = id(60);
const agencyNumber = "+12025550141";
const phoneOf = (n: number) => "+1202555" + String(n).padStart(4, "0");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Strict equality that shows what was found, so a failed demonstration reads without a rerun. */
function expect(actual: unknown, expected: unknown, label = "") {
  assert.deepStrictEqual(actual, expected,
    `${label}\n  found:    ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
}
expect(calls.length, 0, "no provider request before the demonstrations");

// ---- What the fixture lets this script read and do ----
interface Run {
  id: string;
  status: string;
  reason: string | null;
  node: string;
  due_at: string;
  slot_start: string | null;
  steps: Record<string, string>;
  intents: Record<string, string>;
  messages: Record<string, string>;
  record: { node: string; starts_at: string; attempt: number; kind: string; failure_status: string | null; failure_code: string | null }[];
}
async function runsOf(n: number): Promise<Run[]> {
  for (let attempt = 0;; attempt++) {
    const { data, error } = await db.rpc("automation_record_fixture_runs", { p_contact: id(n) });
    if (!error) return data as Run[];
    // PostgREST finds the fixture's functions once its schema cache has reloaded.
    if (attempt < 60 && (error.code === "PGRST202" || /schema cache/i.test(error.message))) {
      await sleep(250);
      continue;
    }
    throw new Error("The fixture's runs could not be read: " + error.message);
  }
}
/** Time passes for these runs: each next step is due now (see automation_record_fixture_due). */
async function due(runs: string[]) {
  const { data, error } = await db.rpc("automation_record_fixture_due", { p_runs: runs });
  assert.ifError(error);
  expect([...(data as string[])].sort(), [...runs].sort(), "time passes for exactly these runs");
}
const order = ["w24", "t24", "w1", "t1"];
/** A run as the suites show one: how it ended, and its steps in graph order with their reasons. */
const show = (r: Run) =>
  `${r.status}:${r.reason ?? "-"} [${order.filter((k) => k in r.steps).map((k) => `${k}=${r.steps[k]}`).join(", ")}]`;
const shown = async (n: number) => (await runsOf(n)).map(show).join(" | ");
/** The record's rows for the lead's appointment, by the run that wrote them (r1 is the lead's first run), each run's in
 * the order given. */
async function record(n: number) {
  const runs = await runsOf(n);
  return runs.flatMap((r, i) => r.record.map((g) => ({ ...g, run: i + 1, starts: new Date(g.starts_at).getTime() })));
}

// ---- The worker ----
const outcomes: { run: string; node: string; status: string; reason?: string }[] = [];
const channelDependencies = {
  fetch: testFetch,
  env: (name: string) => name === "SUPABASE_URL" ? endpoint : "synthetic-fixture-only",
};
/** One lease, as the worker runs it: the real runtime and channel code, with the outcome noted for the checks. */
async function work(claim: AutomationClaim) {
  await runAutomationClaim(db, claim, async (db, claim, node, contact) => {
    const outcome = await dispatchChannel(db, claim, node, contact, channelDependencies);
    outcomes.push({ run: claim.run_id, node: claim.node_id, ...outcome });
    return outcome;
  });
}
const outcomeOf = (run: string, node: string) => outcomes.filter((o) => o.run === run && o.node === node);
async function claimWork(limit: number): Promise<AutomationClaim[]> {
  const { data, error } = await db.rpc("automation_claim_work", { p_limit: limit });
  assert.ifError(error);
  return data as AutomationClaim[];
}
async function events() {
  for (let pass = 0; pass < 3; pass++) {
    const { error } = await db.rpc("automation_process_events", { p_limit: 25 });
    assert.ifError(error);
  }
}
async function repair() {
  const { error } = await db.rpc("automation_repair_messages", { p_limit: 25 });
  assert.ifError(error);
}
/** The worker's pass: events, then every lease of this automation that is due, one at a time, then events again.
 * Work of any other automation is left alone (its lease lapses as after a crash); the fixture paused the earlier ones. */
async function drain() {
  await events();
  for (let page = 0; page < 50; page++) {
    const claims = await claimWork(10);
    if (claims.length === 0) break;
    for (const claim of claims) if (claim.workflow_id === flow) await work(claim);
  }
  await events();
  await repair();
}
/** Holds each named worker just before its final authorization until all of them have reached it. */
function barrier(count: number) {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => open = resolve);
  const timer = setTimeout(open, 20_000);
  return {
    arrive: async () => {
      if (++arrived === count) {
        clearTimeout(timer);
        open();
      }
      await opened;
    },
    arrived: () => arrived,
  };
}
const atHandoff = (run: string) => (url: URL, body: string) =>
  url.pathname === "/rest/v1/rpc/automation_begin_message" && JSON.parse(body).p_run === run;

// ---- The provider ----
const dateOf = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
const timeOf = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: "UTC" }).format(d);
const dayBefore = (d: Date) => `Day before: see you ${dateOf(d)} at ${timeOf(d)}`;
const hourBefore = (d: Date) => `Hour before: see you ${dateOf(d)} at ${timeOf(d)}`;
/** The texts the synthetic provider was asked to send to a lead, in order. */
const sent = (n: number) => calls.filter((c) => c.get("To") === phoneOf(n)).map((c) => c.get("Body"));
const count = (n: number, body: string) => sent(n).filter((b) => b === body).length;
async function dispatchOf(run: string, node: string) {
  const row = await db.from("sms_dispatches").select("state,error_code,provider_sid,message_id,phone_e164,from_number")
    .eq("organization_id", org).eq("request_key", `automation:${run}:${node}`).maybeSingle();
  assert.ifError(row.error);
  return row.data;
}
/** A signed Twilio status callback for the text a run handed off at a step, through the real receipt handler. */
async function callback(run: string, node: string, status: string, code?: string) {
  const dispatched = await dispatchOf(run, node);
  assert.ok(dispatched?.message_id && dispatched.provider_sid, "the text was handed off and accepted");
  const history = await db.from("messages").select("automation_message_id").eq("organization_id", org)
    .eq("id", dispatched.message_id).single();
  assert.ifError(history.error);
  const url = endpoint + "/functions/v1/automation-provider-receipt?sms=" + history.data!.automation_message_id;
  const params: Record<string, string> = {
    AccountSid: "AC000000000000000000000000000000a1",
    MessagingServiceSid: "MG000000000000000000000000000000a1",
    MessageSid: dispatched.provider_sid,
    MessageStatus: status,
    From: dispatched.from_number,
    To: dispatched.phone_e164,
    ...(code ? { ErrorCode: code } : {}),
  };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("synthetic-only"), { name: "HMAC", hash: "SHA-1" },
    false, ["sign"]);
  const signed = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const signature = btoa(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)),
  )));
  const response = await handleReceipt(
    new Request(url, { method: "POST", body: new URLSearchParams(params), headers: { "x-twilio-signature": signature } }),
    db,
    undefined,
  );
  expect(response.status, 204, `the signed ${status} callback was accepted`);
}
async function history(n: number) {
  const rows = await db.from("messages").select("body,status,automation_message_id").eq("organization_id", org)
    .eq("contact_id", id(n)).order("created_at");
  assert.ifError(rows.error);
  return rows.data!;
}

// ---- A signed-in Admin of the agency, as the CRM and the builder act for a person ----
const email = "af-record-admin@example.invalid";
const password = crypto.randomUUID() + "-Aa1";
const made = await fetch(endpoint + "/auth/v1/admin/users", {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: settings.SERVICE_ROLE_KEY, Authorization: "Bearer " + settings.SERVICE_ROLE_KEY },
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "Record", last_name: "Admin", organization_id: org, role: "Admin" },
  }),
});
assert.ok(made.ok, "the Admin's account was created: " + made.status + " " + (await made.clone().text()).slice(0, 200));
const adminId = (await made.json()).id as string;
const onboarded = await db.from("profiles").update({ onboarding_complete: true }).eq("id", adminId).eq("organization_id", org)
  .select("id,role");
assert.ifError(onboarded.error);
expect(onboarded.data, [{ id: adminId, role: "Admin" }], "the Admin belongs to the agency");
const login = await fetch(endpoint + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: settings.ANON_KEY },
  body: JSON.stringify({ email, password }),
});
assert.ok(login.ok, "the Admin signed in: " + login.status);
const person = createClient(endpoint, settings.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: "Bearer " + (await login.json()).access_token } },
});
const context = await person.rpc("automation_session_context");
assert.ifError(context.error);
const revision = (context.data as { revision: number }).revision;
/** The calendar's booking service, as the CRM books. */
async function book(n: number, start: Date) {
  const { data, error } = await person.rpc("create_appointment_once", {
    p_request_id: crypto.randomUUID(),
    p_appointment: {
      title: "Reminder record " + n,
      contact_id: id(n),
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 30 * 60_000).toISOString(),
      status: "Scheduled",
    },
  });
  assert.ifError(error);
  return (data as { id: string }).id;
}
/** A calendar save, as the CRM's updateAppointment makes it. */
async function save(appointment: string, changes: Record<string, unknown>) {
  const { data, error } = await person.from("appointments").update(changes).eq("id", appointment).eq("organization_id", org)
    .select("id, contact_id");
  assert.ifError(error);
  expect(data?.length, 1, "the save was applied");
}
const move = (appointment: string, start: Date) =>
  save(appointment, { start_time: start.toISOString(), end_time: new Date(start.getTime() + 30 * 60_000).toISOString() });
/** The builder's Stop on a running automation. */
async function stop(run: string) {
  const { error } = await person.rpc("automation_stop_run", { p_run: run, p_session_revision: revision });
  assert.ifError(error);
}
/** A verified inbound reply from the lead, as the signed SMS webhook records it. */
async function reply(n: number) {
  const { error } = await db.rpc("automation_observe_sms_reply", {
    p_org: org,
    p_sid: "SM" + crypto.randomUUID().replaceAll("-", ""),
    p_from: phoneOf(n),
    p_to: agencyNumber,
    p_at: new Date().toISOString(),
  });
  assert.ifError(error);
}

// ---- The day before Friday at 2 PM (T) ----
// Leads 101 to 108 book T through the calendar. T2 is three days later: its day-before reminder is not due yet.
const T = new Date(Math.ceil((Date.now() + 24 * 3600_000 + 30_000) / 1000) * 1000);
const T2 = new Date(T.getTime() + 3 * 24 * 3600_000);
const natural = [101, 102, 103, 104, 105, 106, 107, 108];
const appointment: Record<number, string> = {};
for (const n of natural) appointment[n] = await book(n, T);
await drain();
for (const n of natural) {
  const runs = await runsOf(n);
  expect(runs.length, 1, `lead ${n}'s booking started one run: ${await shown(n)}`);
  assert.ok(runs[0].status === "waiting" && runs[0].node === "w24" &&
    new Date(runs[0].due_at).getTime() === T.getTime() - 24 * 3600_000,
    `lead ${n}'s run waits until a day before T: ${show(runs[0])} due ${runs[0].due_at}`);
}
const first = (n: number) => runsOf(n).then((runs) => runs[0].id);
const [stopped4a, replied4b] = [await first(105), await first(106)];
// 4 (a) and (b): at the last moment, just before the final authorization of the day-before text, a person stops the
// run itself (lead 105), or a verified reply from the lead ends it (lead 106).
interceptOnce(atHandoff(stopped4a), () => stop(stopped4a));
interceptOnce(atHandoff(replied4b), () => reply(106));
await sleep(Math.max(0, T.getTime() - 24 * 3600_000 - Date.now()) + 1500);
await due(await Promise.all(natural.map(first)));
await drain();
expect(pendingInterceptors(), 0, "both texts reached their final authorization");
for (const n of [101, 102, 103, 104, 107, 108]) {
  expect(sent(n), [dayBefore(T)], `lead ${n} got its day-before text for T: ${JSON.stringify(sent(n))}`);
  expect(await shown(n), "waiting:- [w24=elapsed, t24=accepted:Verified provider receipt, w1=wait]",
    `lead ${n}'s run waits for the hour before`);
}

// ---- 4. A stop committed before the final handoff wins ----
for (const [n, run, reason] of [[105, stopped4a, "Stopped by user"], [106, replied4b, "Verified reply received"]] as const) {
  expect(sent(n), [], `lead ${n}: no provider call`);
  expect(await shown(n), `stopped:${reason} [w24=elapsed]`, `lead ${n}'s run ended with the stop`);
  expect(outcomeOf(run, "t24"), [{ run, node: "t24", status: "held", reason: "Run no longer permits a provider handoff." }],
    `lead ${n}'s text was refused at its final authorization`);
  expect(await dispatchOf(run, "t24").then((d) => d && { state: d.state, error_code: d.error_code }),
    { state: "failed", error_code: "pre_handoff_cancelled" }, `lead ${n}'s reserved request was cancelled before any handoff`);
  const [r] = await runsOf(n);
  assert.ok(r.intents.t24 === "prepared" && !("t24" in r.messages) && r.record.length === 0,
    `lead ${n}: nothing was handed to a provider or recorded as given`);
  expect((await history(n)).length, 0, `lead ${n}: no message in the contact's history`);
}
// (c) Lead 112: two booking runs of the automation for the appointment at its time. P's text has been leased; a person
// stops the other run, Q, just before P's final authorization.
const [P, Q] = [311, 312].map(id);
await due([P]);
const [leaseP] = await claimWork(1);
expect(leaseP?.run_id, P, "P's day-before text is leased");
interceptOnce(atHandoff(P), () => stop(Q));
await work(leaseP);
expect(pendingInterceptors(), 0, "P's text reached its final authorization");
expect(sent(112), [], "lead 112: no provider call at the final authorization");
const [firstP, stoppedQ] = await runsOf(112);
expect(show(stoppedQ), "stopped:Stopped by user [w24=elapsed]", "Q was stopped by the person");
expect(show(firstP), "held:Run no longer permits a provider handoff. [w24=elapsed, t24=held:Run no longer permits a provider handoff.]",
  "P's text is held: the stop came first");
expect(await dispatchOf(P, "t24").then((d) => d && { state: d.state, error_code: d.error_code }),
  { state: "failed", error_code: "pre_handoff_cancelled" }, "P's reserved request was cancelled before any handoff");
// The next lease's full check finds the person's stop for this appointment time.
await due([P]);
const [againP] = await claimWork(1);
expect(againP?.run_id, P, "P's text is leased again");
await work(againP);
await drain();
expect(sent(112), [], "lead 112: still no provider call");
expect((await runsOf(112)).map(show)[0],
  "waiting:- [w24=elapsed, t24=skipped:Stopped by a person for this appointment time, w1=wait]",
  "P goes on past its text, which the stop of Q holds");
expect((await record(112)).length, 0, "nothing was recorded as given for lead 112");
console.log(
  `PASS 4 A stop committed before the final handoff wins: no provider call for (a) a person's stop of the run (lead 105, ` +
    `"Stopped by user"), (b) a verified reply that ended it (lead 106, "Verified reply received"), each refused at the ` +
    `final authorization with its reserved request cancelled, and (c) a person's stop of another booking run of the ` +
    `automation for the same appointment and time (lead 112, fixture runs P and Q): P held at the final authorization, ` +
    `then skipped on its next lease as "Stopped by a person for this appointment time".`,
);

// ---- 3. Two workers ----
// Lead 111: runs A and B of the automation for the same appointment and time reach the day-before text together. Each
// worker passes the first check and reserves its request; both then ask for the final authorization at once.
const [A, B, C, D, E] = [301, 302, 303, 304, 305].map(id);
const slot111 = (await runsOf(111))[0].slot_start!;
const T111 = new Date(slot111);
async function race(runs: string[]) {
  await due(runs);
  const pair = await claimWork(2);
  expect(pair.map((c) => c.run_id).sort(), [...runs].sort(), "both runs are leased together");
  const gate = barrier(2);
  for (const lease of pair) interceptOnce(atHandoff(lease.run_id), () => gate.arrive());
  const before = calls.length;
  await Promise.all(pair.map(work));
  expect(gate.arrived(), 2, "both workers reached the final authorization");
  expect(pendingInterceptors(), 0);
  const made = calls.length - before;
  await drain();
  const byId = new Map((await runsOf(111)).map((r) => [r.id, r]));
  const [winner, loser] = byId.get(runs[0])!.record.length ? runs : [runs[1], runs[0]];
  return { made, winner, loser, byId };
}
const first3 = await race([A, B]);
expect(first3.made, 1, "exactly one provider call for the two workers");
expect(sent(111), [dayBefore(T111)]);
expect(show(first3.byId.get(first3.winner)!), "waiting:- [w24=elapsed, t24=accepted:Verified provider receipt, w1=wait]");
expect(show(first3.byId.get(first3.loser)!), "waiting:- [w24=elapsed, t24=skipped:Already sent for this appointment time, w1=wait]",
  "the worker that lost the race advanced past the step");
expect(outcomeOf(first3.loser, "t24"),
  [{ run: first3.loser, node: "t24", status: "skipped", reason: "Already sent for this appointment time" }]);
expect(first3.byId.get(first3.loser)!.record.length, 0, "the loser has no row in the record");
expect(await dispatchOf(first3.loser, "t24").then((d) => d && { state: d.state, error_code: d.error_code }),
  { state: "failed", error_code: "pre_handoff_cancelled" }, "the loser's reserved request was never handed off");
// The retry: attempt 1 is reported undelivered (30003, the handset unreachable) by a signed callback, and runs C and D
// reach the text together. Exactly one sends attempt 2.
await callback(first3.winner, "t24", "undelivered", "30003");
const retry3 = await race([C, D]);
expect(retry3.made, 1, "exactly one more provider call: attempt 2");
expect(sent(111), [dayBefore(T111), dayBefore(T111)]);
expect(show(retry3.byId.get(retry3.winner)!), "waiting:- [w24=elapsed, t24=accepted:Verified provider receipt, w1=wait]");
expect(show(retry3.byId.get(retry3.loser)!),
  "waiting:- [w24=elapsed, t24=skipped:Not sent again: already retried once for this appointment time, w1=wait]",
  "the worker that lost the retry advanced past the step");
expect(outcomeOf(retry3.loser, "t24"),
  [{ run: retry3.loser, node: "t24", status: "skipped", reason: "Not sent again: already retried once for this appointment time" }]);
expect(retry3.byId.get(retry3.loser)!.record.length, 0, "the loser did not consume the retry");
const record111 = (await runsOf(111)).flatMap((r) => r.record.map((g) => ({ run: r.id, ...g })))
  .sort((a, b) => a.attempt - b.attempt);
expect(record111.map((g) => [g.run, g.node, g.attempt, g.kind, g.failure_status, g.failure_code]), [
  [first3.winner, "t24", 1, "sms", "undelivered", "30003"],
  [retry3.winner, "t24", 2, "sms", null, null],
], "the record: the first attempt with the provider's result, and the one retry");
console.log(
  `PASS 3 Two workers: runs A and B (fixture booking runs for one appointment and time, which admission never starts ` +
    `together) reached lead 111's day-before text at once, and both passed the first check and reserved a request; ` +
    `${first3.made} provider call, and the loser was skipped ("Already sent for this appointment time") with no record ` +
    `row and its request never handed off. After a signed undelivered callback (30003), runs C and D reached the retry ` +
    `at once: ${retry3.made} more provider call (attempt 2); the loser was skipped ("Not sent again: already retried once ` +
    `for this appointment time") and did not consume the retry.`,
);

// ---- 5. Receipts cannot authorize a third attempt ----
await callback(first3.winner, "t24", "undelivered", "30003");
await callback(first3.winner, "t24", "failed", "30001");
await callback(retry3.winner, "t24", "undelivered", "30003");
await callback(retry3.winner, "t24", "undelivered", "30003");
await callback(retry3.winner, "t24", "failed", "30001");
await repair();
const before5 = calls.length;
await due([E]);
const [leaseE] = await claimWork(1);
expect(leaseE?.run_id, E, "a further run at the same time reaches the text");
await work(leaseE);
await drain();
expect(calls.length, before5, "no third provider call");
expect(show((await runsOf(111)).find((r) => r.id === E)!),
  "waiting:- [w24=elapsed, t24=skipped:Not sent again: already retried once for this appointment time, w1=wait]");
expect(await dispatchOf(E, "t24"), null, "the further run reserved no request");
const record5 = (await runsOf(111)).flatMap((r) => r.record.map((g) => ({ run: r.id, ...g })))
  .sort((a, b) => a.attempt - b.attempt);
expect(record5.map((g) => [g.run, g.attempt, g.failure_status, g.failure_code]), [
  [first3.winner, 1, "undelivered", "30003"],
  [retry3.winner, 2, "undelivered", "30003"],
], "two attempts only; each keeps the provider's first failure");
expect((await history(111)).map((m) => m.status), ["failed", "failed"],
  "the contact's history keeps both texts with the provider's result");
console.log(
  `PASS 5 Receipts cannot authorize a third attempt: late and duplicate signed callbacks for attempts 1 and 2 ` +
    `(attempt 1: undelivered 30003 again, then failed 30001; attempt 2: undelivered 30003 twice, then failed 30001) left ` +
    `each attempt's first failure in the record; a further run at that time (fixture run E) was skipped ("Not sent ` +
    `again: already retried once for this appointment time"), with no third provider call, no attempt 3 and no request ` +
    `reserved. Both attempts stay in the contact's history as failed.`,
);

// ---- The CRM's changes after the day-before texts ----
// 1 (a) Lead 101: moved to T2, whose day-before reminder is not due yet, and straight back.
await move(appointment[101], T2);
await drain();
await move(appointment[101], T);
await drain();
// 1 (b) Lead 102: moved to T2, a genuinely new time, where the automation starts over; time passes there until T2's
// run has given T2's day-before and hour-before texts and finished. Moved back to T, a new run starts at T.
/** The lead is moved to T2: one run follows T2 and, as time passes there, gives both of T2's reminders and finishes. */
async function awayToT2(n: number) {
  await move(appointment[n], T2);
  await drain();
  for (let turn = 0; turn < 6; turn++) {
    const atT2 = (await runsOf(n)).filter((r) =>
      r.status === "waiting" && r.slot_start && new Date(r.slot_start).getTime() === T2.getTime()
    );
    if (!atT2.length) break;
    await due(atT2.map((r) => r.id));
    await drain();
  }
  const runs = await runsOf(n);
  expect(runs.length, 2, `lead ${n}: the move to T2 started one run there: ${runs.map(show).join(" | ")}`);
  expect(show(runs[1]), "completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, " +
    "w1=elapsed, t1=accepted:Verified provider receipt]", `lead ${n}: T2's run gave T2's reminders and finished`);
  expect(sent(n).slice(-2), [dayBefore(T2), hourBefore(T2)], `lead ${n}: T2's texts: ${JSON.stringify(sent(n))}`);
}
await awayToT2(102);
await move(appointment[102], T);
await drain();
// 2. Leads 103 and 104: marked No Show and Completed by mistake.
await save(appointment[103], { status: "No Show" });
await save(appointment[104], { status: "Completed" });
await drain();
// 6. Lead 107: its day-before text is reported undelivered (30003); the appointment is cancelled and opened again at
// the same time, and its run is carried on.
const run107 = await first(107);
await callback(run107, "t24", "undelivered", "30003");
await save(appointment[107], { status: "Cancelled" });
await drain();
expect(await shown(107), "stopped:Appointment was cancelled [w24=elapsed, t24=accepted:Verified provider receipt, w1=wait]",
  "lead 107's run stopped with the cancellation");
await save(appointment[107], { status: "Scheduled" });
await drain();
// 6 (contrast) Lead 108: its day-before text is reported undelivered (30003); moved to T2, where the automation starts
// over and gives T2's reminders, and back to T: a qualifying new run at T sends that text once more.
const run108 = await first(108);
await callback(run108, "t24", "undelivered", "30003");
await awayToT2(108);
await move(appointment[108], T);
await drain();
expect(sent(108), [dayBefore(T), dayBefore(T2), hourBefore(T2), dayBefore(T)],
  `lead 108: the retry went out on the new run: ${JSON.stringify(sent(108))} / ${await shown(108)}`);

// ---- The hour before T ----
async function hourBeforeT(leads: number[]) {
  for (let turn = 0; turn < 4; turn++) {
    const waiting = (await Promise.all(leads.map(runsOf))).flat().filter((r) => r.status === "waiting" && r.node === "w1");
    if (!waiting.length) return;
    await due(waiting.map((r) => r.id));
    await drain();
  }
}
await hourBeforeT([101, 102, 103, 104, 107, 108]);
for (const n of [103, 104]) {
  expect(await shown(n), "held:The appointment has an outcome recorded [w24=elapsed, t24=accepted:Verified provider receipt, " +
    "w1=elapsed, t1=held:The appointment has an outcome recorded]", `lead ${n}'s hour-before text waits while the outcome stands`);
  expect(sent(n), [dayBefore(T)]);
}
// The person corrects each outcome: the appointment is Scheduled again, before T.
for (const n of [103, 104]) await save(appointment[n], { status: "Scheduled" });
await drain();
for (let turn = 0; turn < 3; turn++) {
  const held = (await Promise.all([103, 104].map(runsOf))).flat().filter((r) => r.status === "held");
  if (!held.length) break;
  await due(held.map((r) => r.id));
  await drain();
}

// ---- 1. Friday at 2 PM, moved away and back ----
expect(sent(101), [dayBefore(T), hourBefore(T)], "lead 101: one day-before text in all and the hour-before text once");
expect(await shown(101), "completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, " +
  "w1=elapsed, t1=accepted:Verified provider receipt] | stopped:Appointment was moved back [w24=wait]",
  "lead 101: the first run carries on, and T2's run, which gave nothing, ended");
expect((await record(101)).map((g) => [g.node, g.starts, g.attempt, g.run]),
  [["t24", T.getTime(), 1, 1], ["t1", T.getTime(), 1, 1]], "lead 101's record: each step once for T");
expect(sent(102), [dayBefore(T), dayBefore(T2), hourBefore(T2), hourBefore(T)],
  `lead 102: one day-before text for T, T2's own two, and the hour-before text for T once: ${JSON.stringify(sent(102))}`);
const runs102 = await runsOf(102);
expect(runs102.length, 3, "lead 102: the first run, T2's and the new run at T: " + runs102.map(show).join(" | "));
expect(show(runs102[0]), "stopped:Appointment was rescheduled [w24=elapsed, t24=accepted:Verified provider receipt, w1=wait]",
  "lead 102: the first run: " + show(runs102[0]));
expect(show(runs102[2]), "completed:Verified provider receipt [w24=elapsed:Already reached for this appointment time, " +
  "t24=skipped:Already sent for this appointment time, w1=elapsed, t1=accepted:Verified provider receipt]",
  "lead 102: the new run at T passes the day-before wait as reached, skips its text and sends the hour-before text: " +
    show(runs102[2]));
expect((await record(102)).map((g) => [g.node, g.starts, g.attempt, g.run]),
  [["t24", T.getTime(), 1, 1], ["t24", T2.getTime(), 1, 2], ["t1", T2.getTime(), 1, 2], ["t1", T.getTime(), 1, 3]],
  "lead 102's record: " + JSON.stringify(await record(102)));
console.log(
  `PASS 1 Friday at 2 PM, moved away and back: lead 101 (moved to T2, whose day-before reminder was not due, and straight ` +
    `back) got ${count(101, dayBefore(T))} day-before text for T in all and ${count(101, hourBefore(T))} still-due ` +
    `hour-before text, its first run carried on; lead 102 (moved to T2, where a new run gave T2's own reminders, then ` +
    `back) got ${count(102, dayBefore(T))} day-before text for T in all and ${count(102, hourBefore(T))} hour-before ` +
    `text (besides T2's own ${count(102, dayBefore(T2))} and ${count(102, hourBefore(T2))}), the new run at T skipping ` +
    `the day-before text as "Already sent for this appointment time". Counted from the synthetic provider calls.`,
);

// ---- 2. Friday at 2 PM, a corrected No Show and a corrected Completed ----
for (const n of [103, 104]) {
  expect(sent(n), [dayBefore(T), hourBefore(T)], `lead ${n}: one day-before text and one hour-before text`);
  expect(await shown(n), "completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, " +
    "w1=elapsed, t1=accepted:Verified provider receipt]", `lead ${n}: one run throughout`);
  expect((await record(n)).map((g) => [g.node, g.starts, g.attempt]), [["t24", T.getTime(), 1], ["t1", T.getTime(), 1]]);
}
console.log(
  `PASS 2 Friday at 2 PM, corrected outcomes: No Show (lead 103) and Completed (lead 104), recorded by a person after the ` +
    `day-before text and corrected to Scheduled before T. Lead 103 got ${count(103, dayBefore(T))} day-before and ` +
    `${count(103, hourBefore(T))} hour-before text, lead 104 ${count(104, dayBefore(T))} and ${count(104, hourBefore(T))}; ` +
    `the hour-before text was held while the outcome stood and went out once corrected, on the same run. Counted from ` +
    `the synthetic provider calls.`,
);

// ---- 6. A carried-on run (and, for contrast, a qualifying new run) ----
expect(sent(107), [dayBefore(T), hourBefore(T)], "lead 107: the day-before text is not sent again; the hour-before text once");
expect(await shown(107), "completed:Verified provider receipt [w24=elapsed, t24=accepted:Verified provider receipt, " +
  "w1=elapsed, t1=accepted:Verified provider receipt]", "lead 107: the run was carried on and never went back");
expect(outcomeOf(run107, "t24").length, 1, "lead 107: the carried-on run never asked to send its day-before text again");
expect((await record(107)).map((g) => [g.node, g.attempt, g.failure_status, g.failure_code]),
  [["t24", 1, "undelivered", "30003"], ["t1", 1, null, null]], "lead 107's record: no attempt 2");
expect(sent(108), [dayBefore(T), dayBefore(T2), hourBefore(T2), dayBefore(T), hourBefore(T)],
  `lead 108: on the qualifying new run at T the day-before text was retried once, then the hour-before text: ` +
    JSON.stringify(sent(108)));
const runs108 = await runsOf(108);
expect(show(runs108[2]), "completed:Verified provider receipt [w24=elapsed:Already reached for this appointment time, " +
  "t24=accepted:Verified provider receipt, w1=elapsed, t1=accepted:Verified provider receipt]",
  "lead 108: the new run at T: " + show(runs108[2]));
expect((await record(108)).map((g) => [g.node, g.starts, g.attempt, g.run, g.failure_code]), [
  ["t24", T.getTime(), 1, 1, "30003"], ["t24", T2.getTime(), 1, 2, null], ["t1", T2.getTime(), 1, 2, null],
  ["t24", T.getTime(), 2, 3, null], ["t1", T.getTime(), 1, 3, null],
], "lead 108's record: attempt 1 with its failure, T2's texts, attempt 2 and the hour-before text: " +
  JSON.stringify(await record(108)));
console.log(
  `PASS 6 A carried-on run: lead 107's day-before text was undelivered (30003); cancelled and reopened at the same time, ` +
    `its run carried on and did not resend it (${count(107, dayBefore(T))} day-before text), and sent the still-due ` +
    `hour-before text once (${count(107, hourBefore(T))}). For contrast, lead 108's undelivered text was retried at most ` +
    `once on a qualifying new run at T (${count(108, dayBefore(T))} day-before texts for T: the first and its one retry).`,
);
expect(pendingInterceptors(), 0);
console.log("Verified the six sign-off demonstrations of the reminder record with the real worker.");
