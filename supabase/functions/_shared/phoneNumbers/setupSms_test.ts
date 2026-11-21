import assert from "node:assert/strict";
import { attachNumber } from "../a2p/numberAttachment.ts";
import { TwilioA2p } from "../a2p/provider.ts";
import { database } from "../a2p/registrationTestDb.ts";
import { configReady } from "../a2p/types.ts";
import { setupSms } from "./setupSms.ts";
import type { SetupJob } from "./setupTypes.ts";

const sid = (prefix: string, n = "1") => prefix + n.repeat(32);
const job: SetupJob = {
  kind: "sms",
  purchase_id: "purchase-A",
  lease_token: "lease-A",
  organization_id: "A",
  actor_id: "buyer",
  account_sid: sid("AC"),
  phone_number_id: "number",
  phone_sid: sid("PN"),
  phone_number: "+14155550123",
  number_type: "local",
  attempts: 1,
};

function fixture() {
  const org = job.organization_id, mg = sid("MG"), bn = sid("BN"), qe = sid("QE"), ac = job.account_sid;
  const db = database({
    a2p_accounts: [{
      organization_id: org,
      account_sid: ac,
      enabled: true,
      sms_enforced: true,
      resources_reconciled_at: "2025-01-01",
      enrollment_verified_at: null,
      fees_valid_until: "2020-01-01",
    }],
    a2p_registrations: [{
      organization_id: org,
      account_sid: ac,
      brand_sid: bn,
      brand_status: "APPROVED",
      identity_status: "VERIFIED",
      campaign_sid: qe,
      campaign_status: "VERIFIED",
      messaging_service_sid: mg,
      is_test: false,
      version: 1,
    }],
    phone_numbers: [{
      id: job.phone_number_id,
      organization_id: org,
      twilio_sid: job.phone_sid,
      phone_number: job.phone_number,
      status: "active",
      inbounds_only: false,
    }],
    a2p_numbers: [],
  });
  const brand = {
    sid: bn,
    account_sid: ac,
    status: "APPROVED",
    identity_status: "VERIFIED",
    mock: false,
    brand_type: "STANDARD",
  };
  const campaign = {
    sid: qe,
    account_sid: ac,
    brand_registration_sid: bn,
    messaging_service_sid: mg,
    campaign_status: "VERIFIED",
    mock: false,
  };
  const service = { sid: mg, account_sid: ac, use_inbound_webhook_on_number: true };
  const members: { sid: string; account_sid: string; service_sid: string }[] = [];
  let posts = 0;
  const opts = { lost: false, foreignService: false, throttled: false, hidden: false };
  const requests: string[] = [];
  const provider = new TwilioA2p({ accountSid: ac, authToken: "fixture" }, async (url, init) => {
    const u = new URL(String(url));
    requests.push((init?.method || "GET") + " " + u.pathname);
    const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status });
    if (u.pathname.includes("/BrandRegistrations/")) return json(brand);
    if (u.pathname.endsWith("/Compliance/Usa2p")) return json({ compliance: [campaign] });
    if (u.host === "lookups.twilio.com") {
      return json({ valid: true, country_code: "US", phone_number: job.phone_number });
    }
    if (u.pathname.includes("/IncomingPhoneNumbers/")) {
      return json({ sid: job.phone_sid, account_sid: ac, phone_number: job.phone_number, capabilities: { sms: true } });
    }
    if (u.pathname.endsWith("/PhoneNumbers") && init?.method === "GET") {
      return json({ phone_numbers: opts.hidden ? [] : members });
    }
    if (u.pathname.endsWith("/PhoneNumbers") && init?.method === "POST") {
      assert.equal(new URLSearchParams(String(init.body)).get("PhoneNumberSid"), job.phone_sid);
      assert.equal(db.rows.a2p_numbers[0]?.phone_sid, job.phone_sid, "mapping must precede provider POST");
      posts++;
      if (opts.throttled) {
        opts.throttled = false;
        return json({ code: 20429 }, 429);
      }
      if (opts.foreignService) return json({ code: 21712 }, 400);
      members.push({ sid: job.phone_sid, account_sid: ac, service_sid: mg });
      if (opts.lost) {
        opts.lost = false;
        throw Error("connection lost after acceptance");
      }
      return json(members.at(-1), 201);
    }
    if (u.pathname.endsWith("/" + mg)) return json(service);
    assert.fail("Unexpected Twilio endpoint: " + u.pathname);
  });
  let intent = false;
  // PostgreSQL tests exercise the actual lease, scope and intent transaction; this double models its decisions.
  const client = {
    ...db,
    rpc: async (name: string, args: { p_action: string }) => {
      assert.equal(name, "phone_number_setup_sms_intent");
      const result = (data: string) => ({ data, error: null });
      if (args.p_action === "rejected") {
        intent = false;
        return result("retry");
      }
      if (db.rows.a2p_numbers.some((n) => n.status === "failed")) return result("failed");
      if (!db.rows.a2p_numbers.length) {
        db.rows.a2p_numbers.push({
          organization_id: org,
          phone_number_id: job.phone_number_id,
          phone_sid: job.phone_sid,
          messaging_service_sid: mg,
        });
      }
      if (args.p_action === "member") return result("member");
      if (intent) return result("uncertain");
      intent = true;
      return result("post");
    },
  };
  const run = (j = job) => setupSms(client, j, AbortSignal.timeout(10000), async () => provider);
  return { run, db, provider, brand, campaign, service, members, requests, opts, posts: () => posts };
}

Deno.test("approved campaign automatically accepts a purchased sender without onboarding or resubmission", async () => {
  const f = fixture();
  assert.equal(configReady(f.db.rows.a2p_accounts[0]), false);
  assert.deepEqual(await f.run(), { state: "complete", code: "submitted" });
  assert.equal(f.db.rows.a2p_numbers[0].status, undefined, "no manufactured registration event");
  assert.deepEqual(await f.run({ ...job, attempts: 2 }), { state: "complete", code: "submitted" });
  assert.equal(f.posts(), 1);
});

Deno.test("interrupted provider acknowledgement reconciles the exact sender before retry", async () => {
  const f = fixture();
  f.opts.lost = true;
  assert.deepEqual(await f.run(), { state: "retry", code: "provider_retry" });
  assert.ok(
    !f.db.rows.a2p_registrations[0].operation_id,
    "A lost acknowledgement cannot pause existing agency senders",
  );
  assert.deepEqual(await f.run({ ...job, attempts: 2 }), { state: "complete", code: "submitted" });
  assert.equal(f.posts(), 1);
  assert.ok(!f.db.rows.a2p_registrations[0].operation_id);
});

Deno.test("campaign approval can arrive after purchase and suspended live campaigns wait", async () => {
  const f = fixture(), r = f.db.rows.a2p_registrations[0];
  r.campaign_status = "IN_PROGRESS";
  assert.equal((await f.run()).code, "waiting_agency");
  assert.equal(f.requests.length, 0);
  r.campaign_status = "VERIFIED";
  f.campaign.campaign_status = "SUSPENDED";
  assert.equal((await f.run()).code, "waiting_agency");
  assert.equal(f.posts(), 0);
  f.campaign.campaign_status = "VERIFIED";
  assert.equal((await f.run()).code, "submitted");
});

Deno.test("same master account cannot enroll a number into another agency's campaign or service", async () => {
  const f = fixture();
  f.campaign.brand_registration_sid = sid("BN", "2");
  assert.equal((await f.run()).code, "account_mismatch");
  f.campaign.brand_registration_sid = sid("BN");
  f.campaign.messaging_service_sid = sid("MG", "2");
  assert.equal((await f.run()).code, "account_mismatch");
  assert.equal((await f.run({ ...job, organization_id: "B" })).code, "waiting_agency");
  assert.equal((await f.run({ ...job, account_sid: sid("AC", "2") })).code, "account_mismatch");
  assert.equal((await f.run({ ...job, phone_sid: sid("PN", "2") })).code, "mapping_conflict");
  assert.equal(f.posts(), 0);
});

Deno.test("review exceptions keep other senders and inbound routing intact", async () => {
  const f = fixture();
  f.brand.brand_type = "SOLE_PROPRIETOR";
  f.members.push({ sid: sid("PN", "8"), account_sid: job.account_sid, service_sid: sid("MG") });
  assert.equal((await f.run()).code, "sender_limit");
  f.members.length = 0;
  f.service.use_inbound_webhook_on_number = false;
  assert.equal((await f.run()).code, "service_configuration");
  f.service.use_inbound_webhook_on_number = true;
  f.db.rows.phone_numbers[0].inbounds_only = true;
  assert.equal((await f.run()).code, "voice_only");
  assert.equal((await f.run({ ...job, number_type: "toll_free" })).code, "toll_free");
  assert.equal(f.posts(), 0);
  f.db.rows.phone_numbers[0].inbounds_only = false;
  f.opts.foreignService = true;
  assert.equal((await f.run()).code, "mapping_conflict");
  assert.ok(!f.requests.some((url) => url.startsWith("DELETE")));
  f.opts.foreignService = false;
  assert.equal((await f.run()).code, "submitted", "confirmed conflict can retry after operator correction");
});

Deno.test("a signed failed or deregistered sender is never silently re-added", async () => {
  const f = fixture();
  f.db.rows.a2p_numbers.push({
    organization_id: "A",
    phone_number_id: "number",
    phone_sid: job.phone_sid,
    messaging_service_sid: sid("MG"),
    status: "failed",
    event_at: "2025-10-05",
  });
  assert.equal((await f.run()).code, "registration_failed");
  assert.equal(f.posts(), 0);
});

Deno.test("a definite Twilio rate-limit rejection can retry and a lost receipt cannot post twice", async () => {
  const f = fixture();
  f.opts.throttled = true;
  assert.equal((await f.run()).state, "retry");
  f.opts.lost = true;
  assert.equal((await f.run()).state, "retry"); // accepted, response lost
  f.opts.hidden = true;
  assert.equal((await f.run({ ...job, attempts: 2 })).state, "retry"); // stale provider read
  assert.equal((await f.run({ ...job, attempts: 4 })).state, "review");
  assert.equal(f.posts(), 2); // one definite rejection, one accepted request
  f.opts.hidden = false;
  assert.equal((await f.run({ ...job, attempts: 5 })).code, "submitted");
  assert.equal(f.posts(), 2);
});
Deno.test("new sender setup never takes or clears the agency onboarding mutex", async () => {
  const f = fixture();
  f.db.rows.a2p_registrations[0].operation_id = "uncertain-manual-action";
  f.db.rows.a2p_registrations[0].operation_kind = "brand";
  assert.equal((await f.run()).code, "provider_retry");
  assert.equal(f.db.rows.a2p_registrations[0].operation_id, "uncertain-manual-action");
  f.db.rows.a2p_registrations[0].operation_id = null;
  f.opts.lost = true;
  await f.run();
  assert.ok(!f.db.calls.some((c) => c.table === "a2p_registrations" && c.action === "update"));
});

Deno.test("manual attachment cannot bypass an automatic purchase's unresolved write", async () => {
  const f = fixture(), managed = database(f.db.rows, { managed: true, owned: true });
  await assert.rejects(
    attachNumber(
      managed,
      f.provider,
      managed.rows.a2p_accounts[0],
      managed.rows.a2p_registrations[0],
      job.phone_number_id,
      job.actor_id,
    ),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "AUTOMATIC_NUMBER_SETUP",
  );
  assert.equal(f.requests.length, 0);
  assert.ok(!managed.rows.a2p_registrations[0].operation_id);
});
