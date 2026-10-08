import assert from "node:assert/strict";
import {
  type KeywordJob,
  processLifecycle,
  verifiedKeyword,
} from "./lifecycle.ts";
import { recordInboundStop } from "./webhook.ts";
import { purposeStatus } from "./consent.ts";
import { verifyRequest } from "./wire.ts";

const org = "00000000-0000-0000-0000-000000000001";
const sid = (prefix: string) => prefix + "1".repeat(32);
const recipient = "+19095551001", sender = "+19095550100";
const job: KeywordJob = {
  organization_id: org,
  message_sid: sid("SM"),
  phone_e164: recipient,
  keyword: "START",
  attempts: 0,
};
const now = Date.parse("2026-10-08T06:00:00Z");
const valid = {
  sid: sid("SM"),
  account_sid: sid("AC"),
  messaging_service_sid: sid("MG"),
  direction: "inbound",
  status: "received",
  from: recipient,
  to: sender,
  body: " Start ",
  date_sent: "Thu, 08 Oct 2026 05:59:00 +0000",
};
const verify = (message: Record<string, unknown>, j = job) =>
  verifiedKeyword(j, message, sid("AC"), sid("MG"), [sender], now);

Deno.test("START provider proof binds account/service/SID/phones/keyword and event time", () => {
  assert.deepEqual(verify(valid), {
    to: sender,
    at: "2026-10-08T05:59:00.000Z",
  });
  for (
    const patch of [
      { sid: sid("SM").replace(/1$/, "2") },
      { account_sid: sid("AC").replace(/1$/, "2") },
      { messaging_service_sid: sid("MG").replace(/1$/, "2") },
      { direction: "outbound-api" },
      { status: "queued" },
      { from: "+19095551002" },
      { to: "+19095550101" },
      { body: "START please" },
      { body: "UNSTOP" },
      { body: "YES" },
      { body: "STOP" },
      { date_sent: null },
      { date_sent: "not-a-date" },
      { date_sent: "Thu, 08 Oct 2026 06:02:00 +0000" },
    ]
  ) {
    assert.throws(
      () => verify({ ...valid, ...patch }),
      /evidence requires review/,
    );
  }
});

Deno.test("STOP metadata recognizes only provider-confirmed standard keyword bodies", () => {
  const stop = { ...job, keyword: "STOP" as const };
  for (
    const body of [
      "STOP",
      "stopall",
      " UNSUBSCRIBE ",
      "REVOKE",
      "OPTOUT",
      "END",
      "QUIT",
      "CANCEL",
    ]
  ) {
    assert.ok(verify({ ...valid, body }, stop));
  }
  assert.throws(() => verify(valid, stop));
});

function inboundFixture(enabled = true, selected = true) {
  const calls: { name: string; args: unknown }[] = [];
  const db = {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => ({
          data: table === "sms_agency_policies"
            ? {
              enforced: true,
              start_enabled: enabled,
              selected_phone_ids: ["selected"],
            }
            : {
              id: selected ? "selected" : "other",
              assignment_type: "agency",
              status: "active",
            },
          error: null,
        }),
      };
      return q;
    },
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: null, error: null };
    },
  };
  return { db, calls };
}
Deno.test("authenticated exact START queues review, never directly deletes suppression", async () => {
  const f = inboundFixture();
  await recordInboundStop(f.db, org, {
    Body: "sTaRt ",
    From: recipient,
    To: sender,
    MessageSid: sid("SM"),
  });
  assert.deepEqual(f.calls, [{
    name: "sms_receive_start",
    args: { p_org: org, p_phone: recipient, p_sid: sid("SM") },
  }]);
  for (const Body of ["HELP", "INFO", "START please", "UNSTOP", "YES"]) {
    const x = inboundFixture();
    await recordInboundStop(x.db, org, {
      Body,
      From: recipient,
      To: sender,
      MessageSid: sid("SM"),
    });
    assert.equal(x.calls.length, 0);
  }
  const disabled = inboundFixture(false);
  await recordInboundStop(disabled.db, org, {
    Body: "START",
    From: recipient,
    To: sender,
    MessageSid: sid("SM"),
  });
  assert.equal(disabled.calls.length, 0);
  await assert.rejects(
    () =>
      recordInboundStop(inboundFixture(true, false).db, org, {
        Body: "START",
        From: recipient,
        To: sender,
        MessageSid: sid("SM"),
      }),
    /sender/,
  );
});

Deno.test("status permits informational-only re-enrollment without bypassing a local block", () => {
  const info = { allowed: true, reason: "granted" };
  const market = { allowed: false, reason: "suppressed" };
  assert.deepEqual(purposeStatus(false, info, market), {
    suppressed: false,
    informational: true,
    marketing: false,
  });
  assert.equal(purposeStatus(true, info, market).suppressed, true);
  assert.equal(purposeStatus(false, market, market).suppressed, true);
});

// Boundary double only. The paired SQL harness tests real transactions and ACLs.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
function workerFixture(withKeyword = false) {
  const profile = "00000000-0000-0000-0000-000000000002";
  const secret = "synthetic-lifecycle-secret-".repeat(3);
  Deno.env.set("SMS_BRIDGE_SECRET", secret);
  Deno.env.set("TWILIO_MASTER_ACCOUNT_SID", sid("AC"));
  Deno.env.set("TWILIO_MASTER_AUTH_TOKEN", "synthetic-token");
  const pending: Row = {
    organization_id: org,
    phone_e164: recipient,
    revision: 7,
    synced_at: null,
    informational_restored: true,
    start_event_id: "00000000-0000-0000-0000-000000000003",
    prior_consent_event: "00000000-0000-0000-0000-000000000004",
    first_stop_at: "2026-10-08T05:58:00Z",
    start_at: valid.date_sent,
    retry_at: "2020-01-01T00:00:00Z",
  };
  const rows: Record<string, Row[]> = {
    sms_agency_policies: [{
      organization_id: org,
      enforced: true,
      start_enabled: true,
      selected_phone_ids: ["selected"],
      uv_profile_id: profile,
      uv_project: "jzdzeevjpootbeuniygx",
    }],
    a2p_accounts: [{
      organization_id: org,
      account_scope: "master",
      account_sid: sid("AC"),
    }],
    a2p_registrations: [{
      organization_id: org,
      account_sid: sid("AC"),
      messaging_service_sid: sid("MG"),
    }],
    phone_numbers: [{
      id: "selected",
      organization_id: org,
      assignment_type: "agency",
      status: "active",
      phone_number: sender,
    }],
    sms_keyword_jobs: withKeyword
      ? [{ ...job, retry_at: "2020-01-01T00:00:00Z", verified_at: null }]
      : [],
    sms_recipient_lifecycle: withKeyword ? [] : [pending],
  };
  const calls: { name: string; args: Row }[] = [];
  let failure = false,
    mismatched = false,
    denied = false,
    stale = false,
    providerFailure = false;
  let providerReads = 0, relayCalls = 0;
  const db = {
    from: (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let single = false, patch: Row | undefined;
      const q = {
        select: () => q,
        limit: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        is: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        in: (k: string, v: unknown[]) => {
          filters.push((r) => v.includes(r[k]));
          return q;
        },
        lt: (k: string, v: number) => {
          filters.push((r) => r[k] < v);
          return q;
        },
        lte: (k: string, v: string) => {
          filters.push((r) => r[k] <= v);
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        update: (v: Row) => {
          patch = v;
          return q;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const found = (rows[table] ?? []).filter((r) =>
            filters.every((f) => f(r))
          );
          if (patch) found.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({
            data: structuredClone(single ? found[0] : found),
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
    rpc: (name: string, args: Row) => {
      calls.push({ name, args });
      if (name === "sms_verify_keyword") {
        rows.sms_keyword_jobs[0].verified_at = new Date().toISOString();
        rows.sms_recipient_lifecycle = [pending];
      } else if (name === "sms_ack_lifecycle") {
        if (pending.revision !== args.p_revision) {
          return { data: false, error: null };
        }
        pending.synced_at = new Date().toISOString();
      } else throw Error(name);
      return { data: true, error: null };
    },
  };
  const transport = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.twilio.com")) {
      providerReads++;
      assert.equal(init?.method, "GET");
      assert.ok(url.endsWith(`/Messages/${job.message_sid}.json`));
      if (providerFailure) throw Error("unavailable");
      return Response.json({
        ...valid,
        date_sent: new Date(Date.now() - 1000).toUTCString(),
      });
    }
    assert.ok(url.endsWith("/functions/v1/agentflow-consent"));
    assert.equal(init?.method, "POST");
    const body = String(init?.body);
    await verifyRequest(
      new Request(url, init),
      body,
      secret,
      new URL(url).pathname,
    );
    assert.equal(JSON.parse(body).action, "lifecycle");
    relayCalls++;
    if (failure) throw Error("unavailable");
    const revision = pending.revision;
    if (stale) pending.revision++;
    return Response.json({
      organization_id: org,
      profile_id: profile,
      phone: recipient,
      revision: mismatched ? revision - 1 : revision,
      restored: true,
      informational_allowed: !denied,
    });
  };
  return {
    db,
    transport,
    rows,
    calls,
    pending,
    mode: (value: string) => {
      failure = value === "outage";
      mismatched = value === "mismatch";
      denied = value === "denied";
      stale = value === "stale";
      providerFailure = value === "provider-outage";
    },
    counts: () => ({ providerReads, relayCalls }),
  };
}

Deno.test("keyword worker independently reads proof, signs relay and acknowledges the same revision; no SMS POST", async () => {
  const f = workerFixture(true);
  await processLifecycle(f.db, f.transport);
  assert.deepEqual(f.calls.map((c) => c.name), [
    "sms_verify_keyword",
    "sms_ack_lifecycle",
  ]);
  assert.ok(f.pending.synced_at);
  assert.deepEqual(f.counts(), { providerReads: 1, relayCalls: 1 });
});

Deno.test("provider outage keeps START unverified and retries without lifting suppression", async () => {
  const f = workerFixture(true);
  f.mode("provider-outage");
  await processLifecycle(f.db, f.transport);
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows.sms_keyword_jobs[0].verified_at, null);
  assert.equal(f.rows.sms_keyword_jobs[0].attempts, 1);
  assert.equal(f.counts().relayCalls, 0);
});

Deno.test("bridge outage recovers durably; duplicate delivery needs the exact current acknowledgment", async () => {
  const f = workerFixture();
  f.mode("outage");
  await processLifecycle(f.db, f.transport);
  assert.equal(f.pending.synced_at, null);
  assert.equal(f.calls.length, 0);
  assert.ok(Date.parse(f.pending.retry_at) > Date.now());
  f.mode("ok");
  f.pending.retry_at = "2020-01-01T00:00:00Z";
  await processLifecycle(f.db, f.transport);
  assert.ok(f.pending.synced_at);
  await processLifecycle(f.db, f.transport);
  assert.equal(f.calls.length, 1);
});

for (const mode of ["mismatch", "denied", "stale"]) {
  Deno.test(`lifecycle ${mode} response cannot open the AF gate`, async () => {
    const f = workerFixture();
    f.mode(mode);
    await processLifecycle(f.db, f.transport);
    assert.equal(f.pending.synced_at, null);
    assert.equal(f.calls.length, mode === "stale" ? 1 : 0);
  });
}
