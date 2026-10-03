import assert from "node:assert/strict";
import { A2pError, type Account, brandReady, campaignReady, configReady, type Registration } from "./types.ts";
import { inquirySession, TwilioA2p } from "./provider.ts";
import { parseEvents, validateEventSignature } from "./events.ts";
import { admin, readBody } from "./auth.ts";
import { attachNumber, openRegistration, saveDraft } from "./registration.ts";
import { registeredSender, registeredWorkflowNumber } from "./sending.ts";
import { deliverEmails } from "./notifications.ts";
import { syncRegistration } from "./sync.ts";
const sid = (prefix: string, n = "1") => prefix + n.repeat(32);
const account: Account = {
  organization_id: "org",
  account_sid: sid("AC"),
  account_scope: "master",
  primary_profile_sid: sid("BU"),
  enabled: true,
  sms_enforced: true,
  enrollment_verified_at: "2026-01-01",
  resources_reconciled_at: "2026-01-01",
  fee_version: "test-v1",
  fees: [{ label: "Test only fee fixture", amount: "Test only" }],
  fees_valid_until: "2099-01-01",
};
const draft = {
  businessName: "Test agency",
  brandType: "STANDARD",
  website: "https://example.test",
  description: "",
  privacyUrl: "",
  termsUrl: "",
};
function reg(p: Partial<Registration> = {}): Registration {
  return {
    organization_id: "org",
    created_by: "admin",
    draft,
    version: 1,
    account_sid: null,
    brand_inquiry_id: null,
    brand_bundle_sid: null,
    brand_sid: null,
    brand_status: "not_started",
    identity_status: null,
    brand_errors: [],
    messaging_service_sid: null,
    campaign_inquiry_id: null,
    campaign_sid: null,
    campaign_status: "not_started",
    campaign_errors: [],
    is_test: false,
    operation_id: null,
    operation_kind: null,
    last_synced_at: null,
    sync_error: null,
    ...p,
  };
}
const approved = () =>
  reg({
    account_sid: account.account_sid,
    brand_status: "APPROVED",
    identity_status: "VERIFIED",
    brand_sid: sid("BN"),
    campaign_status: "VERIFIED",
    messaging_service_sid: sid("MG"),
    last_synced_at: new Date().toISOString(),
  });
// Query-double tests exercise handler boundaries. Real privileges and transactions run in SQL.
function database(seed: Record<string, any[]> = {}) {
  const rows = structuredClone(seed), calls: any[] = [];
  return {
    rows,
    calls,
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "admin" } }, error: null }) },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: true, error: null };
    },
    from(table: string) {
      let action = "select", values: any, filters: ((r: any) => boolean)[] = [], single = false, ignore = false;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        in: (k: string, values: unknown[]) => {
          filters.push((r) => values.includes(r[k]));
          return q;
        },
        is: (k: string, v: unknown) => {
          filters.push((r) => (r[k] ?? null) === v);
          return q;
        },
        or: () => q,
        lt: (k: string, v: number) => {
          filters.push((r) => r[k] < v);
          return q;
        },
        order: () => q,
        limit: () => q,
        update: (v: any) => {
          action = "update";
          values = v;
          return q;
        },
        insert: (v: any) => {
          action = "insert";
          values = v;
          return q;
        },
        upsert: (v: any, o: any) => {
          action = "insert";
          values = v;
          ignore = o.ignoreDuplicates;
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve().then(() => {
            calls.push({ table, action, values });
            const all = rows[table] ?? (rows[table] = []);
            let selected = all.filter((r) => filters.every((f) => f(r)));
            if (action === "insert") {
              if (table === "a2p_registrations" && all.some((r) => r.organization_id === values.organization_id)) {
                return { data: null, error: { code: "23505" } };
              }
              if (!ignore || !all.some((r) => r.phone_number_id === values.phone_number_id)) {
                all.push({ ...values, version: values.version ?? 1 });
              }
              selected = [all.at(-1)];
            }
            if (action === "update") {
              for (const row of selected) Object.assign(row, values);
            }
            return { data: structuredClone(single ? selected[0] ?? null : selected), error: null };
          }).then(resolve, reject),
      };
      return q;
    },
  };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const creds = { accountSid: account.account_sid, authToken: "test-token-only" };
const rejectCode = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (e: unknown) => e instanceof A2pError && e.code === code);
Deno.test("approval requires real, verified brand AND verified campaign", () => {
  assert.equal(brandReady(approved()), true);
  assert.equal(campaignReady(approved()), true);
  for (
    const p of [{ is_test: true }, { identity_status: "SELF_DECLARED" }, { identity_status: null }, {
      brand_status: "PENDING",
    }, { brand_status: "FUTURE_STATE" }]
  ) assert.equal(brandReady({ ...approved(), ...p }), false);
  assert.equal(campaignReady({ ...approved(), campaign_status: "IN_PROGRESS" }), false);
});
Deno.test("account preparation, fee integrity and expiry fail closed", () => {
  assert.equal(configReady(account), true);
  for (
    const p of [
      { enabled: false },
      { sms_enforced: false },
      { enrollment_verified_at: null },
      { resources_reconciled_at: null },
      { fees: [] },
      {
        fees: [{ label: "", amount: "" }],
      },
      { fees_valid_until: "2000-01-01" },
    ]
  ) assert.equal(configReady({ ...account, ...p }), false);
});
Deno.test("inquiry IDs must belong to pinned account; malformed create is uncertain", () => {
  const p = {
    id: `tri1.us1.account.${account.account_sid}.registration.${sid("BU")}`,
    sessionId: "inq_test",
    sessionToken: "secret",
  };
  assert.equal(inquirySession(p, account.account_sid).bundle, sid("BU"));
  assert.throws(() => inquirySession(p, sid("AC", "2")), (e: any) => e.uncertain === true);
  assert.throws(() => inquirySession({ ...p, sessionToken: "" }, account.account_sid));
});
Deno.test("provider restricts destinations and preserves uncertain mutations", async () => {
  let requests = 0;
  const t = new TwilioA2p(creds, async () => {
    requests++;
    throw Error("network");
  });
  await rejectCode(t.call("https://evil.test/path"), "INVALID_PROVIDER_URL");
  assert.equal(requests, 0);
  await assert.rejects(
    t.call("https://trusthub.twilio.com/v1/A2PBrandRegistrations", "POST", {}),
    (e: any) => e.uncertain === true,
  );
  await assert.rejects(t.call("https://messaging.twilio.com/v1/Services"), (e: any) => e.uncertain === false);
  const bad = new TwilioA2p(creds, async () => response({ code: 20403, message: "secret provider data" }, 403));
  await assert.rejects(
    bad.call("https://trusthub.twilio.com/v1/A2PBrandRegistrations", "POST", {}),
    (e: any) => !e.uncertain && !e.message.includes("secret provider data"),
  );
});
Deno.test("signed event validates exact body and URL, rejects tampering", async () => {
  const body = "[]",
    hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
    hex = Array.from(hash, (x) => x.toString(16).padStart(2, "0")).join("");
  const url = `https://example.test/a2p?account=${account.account_sid}&bodySHA256=${hex}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(creds.authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = btoa(
    String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(url)))),
  );
  assert.equal(await validateEventSignature(url, body, sig, creds.authToken), true);
  assert.equal(await validateEventSignature(url, "[{}]", sig, creds.authToken), false);
  assert.equal(await validateEventSignature(url + "&different=true", body, sig, creds.authToken), false);
  assert.equal(await validateEventSignature(url, body, null, creds.authToken), false);
});
Deno.test("events use entity timestamp and reject cross-account or future events", () => {
  const e = {
    id: "event",
    type: "com.twilio.messaging.compliance.number-registration.successful",
    time: new Date().toISOString(),
    data: { accountsid: account.account_sid, updateddate: 1700000000000 },
  };
  assert.equal(parseEvents(JSON.stringify([e]), account.account_sid)[0].time, new Date(1700000000000).toISOString());
  assert.throws(() => parseEvents(JSON.stringify([e]), sid("AC", "2")));
  assert.throws(() =>
    parseEvents(JSON.stringify([{ ...e, data: { ...e.data, updateddate: Date.now() + 600000 } }]), account.account_sid)
  );
});
Deno.test("trusted admin authorization rejects role, stale organization and View As", async () => {
  const db = database({
    profiles: [{ id: "admin", organization_id: "org", role: "Admin", status: "Active", email: "admin@example.test" }],
  });
  const req = new Request("https://example.test", { headers: { Authorization: "Bearer token" } });
  const body = { actor_id: "admin", organization_id: "org" };
  assert.equal((await admin(req, body, db)).id, "admin");
  await rejectCode(admin(req, { ...body, organization_id: "other" }, db), "SCOPE_CHANGED");
  await rejectCode(admin(req, { ...body, view_as: true }, db), "SCOPE_CHANGED");
  db.rows.profiles[0].role = "Agent";
  await rejectCode(admin(req, body, db), "FORBIDDEN");
  await rejectCode(admin(new Request("https://example.test"), body, db), "UNAUTHORIZED");
});
Deno.test("draft validation and optimistic concurrency preserve another admin edit", async () => {
  const db = database({ a2p_registrations: [reg()] });
  await rejectCode(saveDraft(db, "org", "admin", { ...draft, website: "http://example.test" }, 1), "VALIDATION");
  await rejectCode(saveDraft(db, "org", "admin", { ...draft, ein: "never-store" }, 1), "VALIDATION");
  await saveDraft(db, "org", "admin", draft, 1);
  await rejectCode(saveDraft(db, "org", "admin", { ...draft, businessName: "stale" }, 1), "DRAFT_CHANGED");
  assert.equal(db.rows.a2p_registrations[0].draft.businessName, "Test agency");
});
Deno.test("create saves inquiry mapping before returning token; token never persisted", async () => {
  const r = reg(), db = database({ a2p_registrations: [r] });
  const t = new TwilioA2p(
    creds,
    async () =>
      response({
        id: `tri1.us1.account.${account.account_sid}.registration.${sid("BU")}`,
        sessionId: "inq_test",
        sessionToken: "do-not-persist",
      }),
  );
  const result = await openRegistration(
    db,
    t,
    account,
    r,
    "brand",
    { id: "admin", email: "admin@example.test" },
    account.fee_version,
  );
  assert.equal(result.sessionToken, "do-not-persist");
  assert.equal(db.rows.a2p_registrations[0].brand_bundle_sid, sid("BU"));
  assert.equal(db.rows.a2p_registrations[0].operation_id, null);
  assert.equal(JSON.stringify(db.rows).includes("do-not-persist"), false);
});
Deno.test("known create rejection unlocks; network uncertainty retains operation", async () => {
  for (const uncertain of [false, true]) {
    const r = reg(), db = database({ a2p_registrations: [r] });
    const t = new TwilioA2p(creds, async () => {
      if (uncertain) throw Error("timeout");
      return response({ code: 20403 }, 403);
    });
    await assert.rejects(
      openRegistration(db, t, account, r, "brand", { id: "admin", email: "admin@example.test" }, account.fee_version),
    );
    assert.equal(!!db.rows.a2p_registrations[0].operation_id, uncertain);
  }
});
Deno.test("concurrent create produces one provider mutation", async () => {
  const r = reg(), db = database({ a2p_registrations: [r] });
  let calls = 0;
  const t = new TwilioA2p(creds, async () => {
    calls++;
    return response({
      id: `tri1.us1.account.${account.account_sid}.registration.${sid("BU")}`,
      sessionId: "inq_test",
      sessionToken: "secret",
    });
  });
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      openRegistration(db, t, account, r, "brand", { id: "admin", email: "admin@example.test" }, account.fee_version)
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
});
Deno.test("rejected submitted campaign resumes by Messaging Service instead of creating", async () => {
  const r = reg({
      ...approved(),
      campaign_sid: sid("QE"),
      campaign_inquiry_id: "obsolete-bundle",
      campaign_status: "FAILED",
    }),
    db = database({ a2p_registrations: [r] });
  const urls: string[] = [];
  const t = new TwilioA2p(creds, async (url) => {
    urls.push(String(url));
    return response({ sessionId: "inq_test", sessionToken: "secret" });
  });
  await openRegistration(
    db,
    t,
    account,
    r,
    "campaign",
    { id: "admin", email: "admin@example.test" },
    account.fee_version,
  );
  assert.deepEqual(urls, [`https://trusthub.twilio.com/v1/A2PCampaignRegistrations/${sid("MG")}/EmbeddedSessions`]);
});
Deno.test("pending registration and stale fee acceptance cannot submit", async () => {
  const r = reg({ brand_status: "PENDING" }), db = database({ a2p_registrations: [r] });
  const t = new TwilioA2p(creds, async () => {
    throw Error("must not call");
  });
  await rejectCode(
    openRegistration(db, t, account, r, "brand", { id: "admin", email: "" }, account.fee_version),
    "REGISTRATION_IN_REVIEW",
  );
  await rejectCode(
    openRegistration(db, t, account, reg(), "brand", { id: "admin", email: "" }, "old"),
    "SETUP_REQUIRED",
  );
});
Deno.test("number attachment rejects non-US, toll-free and mismatched ownership before mutation", async () => {
  for (const scenario of ["Canada", "toll-free", "foreign-account"]) {
    const r = approved(),
      phone = scenario === "toll-free" ? "+18005551234" : "+14155551234",
      db = database({
        a2p_registrations: [r],
        phone_numbers: [{
          id: "phone",
          organization_id: "org",
          twilio_sid: sid("PN"),
          phone_number: phone,
          status: "active",
        }],
      });
    let mutations = 0;
    const t = new TwilioA2p(creds, async (url, init) => {
      if (init?.method !== "GET") mutations++;
      return response(
        String(url).includes("lookups") ? { valid: true, country_code: "CA", phone_number: phone } : {
          account_sid: scenario === "foreign-account" ? sid("AC", "2") : account.account_sid,
          sid: sid("PN"),
          phone_number: phone,
          capabilities: { sms: true },
        },
      );
    });
    await assert.rejects(attachNumber(db, t, account, r, "phone", "admin"));
    assert.equal(mutations, 0);
  }
});
Deno.test("SMS gate preserves staged orgs and blocks unapproved, stale, test, foreign personal and unregistered senders", async () => {
  assert.equal(await registeredSender(database(), "org", "+14155551234"), null);
  for (
    const patch of [{ campaign_status: "IN_PROGRESS" }, { is_test: true }, { last_synced_at: "2000-01-01" }, {
      sync_error: "sync failed",
    }]
  ) {
    await rejectCode(
      registeredSender(
        database({ a2p_accounts: [account], a2p_registrations: [reg({ ...approved(), ...patch })] }),
        "org",
        "+14155551234",
      ),
      "A2P_NOT_READY",
    );
  }
  const seed = {
    a2p_accounts: [account],
    a2p_registrations: [approved()],
    phone_numbers: [{
      id: "phone",
      organization_id: "org",
      phone_number: "+14155551234",
      twilio_sid: sid("PN"),
      status: "active",
      assignment_type: "personal",
      assigned_to: "other",
    }],
  };
  await rejectCode(registeredSender(database(seed), "org", "+14155551234", "admin"), "SENDER_NOT_ALLOWED");
  await rejectCode(registeredSender(database(seed), "org", "+14155551234", "other"), "NUMBER_NOT_REGISTERED");
});
Deno.test("provider refresh rejects a foreign campaign without committing any status", async () => {
  const r = approved(), db = database({ a2p_registrations: [r] });
  const t = new TwilioA2p(
    creds,
    async (url) =>
      response(
        String(url).includes("BrandRegistrations")
          ? {
            sid: sid("BN"),
            account_sid: account.account_sid,
            status: "APPROVED",
            identity_status: "VERIFIED",
            mock: false,
          }
          : {
            compliance: [{
              sid: sid("QE"),
              account_sid: sid("AC", "2"),
              brand_registration_sid: sid("BN"),
              messaging_service_sid: sid("MG"),
              campaign_status: "VERIFIED",
            }],
          },
      ),
  );
  await rejectCode(syncRegistration(db, t, "org"), "CAMPAIGN_SCOPE");
  assert.equal(db.calls.some((c) => c.name === "commit_a2p_snapshot"), false);
});
Deno.test("registered SMS sender checks current provider membership and exact pinned credentials", async () => {
  const names = ["TWILIO_MASTER_ACCOUNT_SID", "TWILIO_MASTER_AUTH_TOKEN"];
  const previous = names.map((n) => Deno.env.get(n)), original = globalThis.fetch;
  try {
    Deno.env.set(names[0], account.account_sid);
    Deno.env.set(names[1], "test-only-token");
    const db = database({
      a2p_accounts: [account],
      a2p_registrations: [approved()],
      phone_numbers: [{
        id: "phone",
        organization_id: "org",
        phone_number: "+14155551234",
        twilio_sid: sid("PN"),
        status: "active",
        assignment_type: "agency",
      }],
      a2p_numbers: [{
        organization_id: "org",
        phone_number_id: "phone",
        phone_sid: sid("PN"),
        messaging_service_sid: sid("MG"),
        status: "registered",
      }],
    });
    let member = true, calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      return String(url).includes("IncomingPhoneNumbers")
        ? response({ account_sid: account.account_sid, sid: sid("PN"), capabilities: { sms: true } })
        : response({
          account_sid: account.account_sid,
          sid: sid("PN"),
          service_sid: member ? sid("MG") : sid("MG", "2"),
        });
    };
    assert.equal((await registeredSender(db, "org", "+14155551234", "admin"))?.messagingServiceSid, sid("MG"));
    assert.equal(calls, 2);
    member = false;
    await rejectCode(registeredSender(db, "org", "+14155551234", "admin"), "SENDER_REMOVED");
    Deno.env.set(names[0], sid("AC", "2"));
    await rejectCode(registeredSender(db, "org", "+14155551234", "admin"), "ACCOUNT_MISMATCH");
  } finally {
    globalThis.fetch = original;
    names.forEach((name, i) => previous[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, previous[i]!));
  }
});
Deno.test("workflow selects only an active registered shared number", async () => {
  const db = database({
    a2p_accounts: [account],
    a2p_registrations: [approved()],
    a2p_numbers: [{
      organization_id: "org",
      phone_number_id: "personal",
      messaging_service_sid: sid("MG"),
      status: "registered",
    }, { organization_id: "org", phone_number_id: "agency", messaging_service_sid: sid("MG"), status: "registered" }],
    phone_numbers: [{
      id: "personal",
      organization_id: "org",
      phone_number: "+14155551000",
      status: "active",
      assignment_type: "personal",
    }, {
      id: "unregistered",
      organization_id: "org",
      phone_number: "+14155551001",
      status: "active",
      assignment_type: "agency",
    }, {
      id: "agency",
      organization_id: "org",
      phone_number: "+14155551002",
      status: "active",
      assignment_type: "agency",
    }],
  });
  assert.equal(await registeredWorkflowNumber(db, "org"), "+14155551002");
  db.rows.phone_numbers[2].status = "inactive";
  await rejectCode(registeredWorkflowNumber(db, "org"), "SENDER_NOT_ALLOWED");
});
Deno.test("callback body limits count UTF-8 bytes and stop oversized input", async () => {
  assert.equal(await readBody(new Request("https://example.test", { method: "POST", body: "é" }), 2), "é");
  await rejectCode(readBody(new Request("https://example.test", { method: "POST", body: "éé" }), 3), "TOO_LARGE");
});
Deno.test("email delivery rechecks recipient eligibility and uses a stable idempotency key", async () => {
  const original = globalThis.fetch, previous = Deno.env.get("RESEND_API_KEY");
  Deno.env.set("RESEND_API_KEY", "test-only");
  const db = database({
    a2p_email_outbox: [{
      id: "mail",
      organization_id: "org",
      user_id: "admin",
      title: "A2P registration needs attention",
      attempts: 0,
      created_at: new Date().toISOString(),
      sent_at: null,
    }],
    profiles: [{
      id: "admin",
      email: "admin@example.test",
      role: "Admin",
      status: "Active",
      organization_id: "org",
      email_notifications_enabled: false,
    }],
  });
  let sent = 0;
  globalThis.fetch = async (_url, init) => {
    sent++;
    assert.equal((init?.headers as Record<string, string>)["Idempotency-Key"], "a2p-mail");
    const body = JSON.parse(init?.body as string);
    assert.deepEqual(body.to, ["admin@example.test"]);
    assert.match(body.text, /settings\?section=a2p-registration/);
    return response({ id: "test-message" });
  };
  try {
    await deliverEmails(db);
    assert.equal(sent, 0);
    db.rows.a2p_email_outbox[0].sent_at = null;
    db.rows.profiles[0].email_notifications_enabled = true;
    await deliverEmails(db);
    await deliverEmails(db);
    assert.equal(sent, 1);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", previous);
  }
});
Deno.test("missing or mock campaign and lost identity cannot retain ready state", async () => {
  for (const mode of ["missing", "mock", "identity"]) {
    const r = approved(), db = database({ a2p_registrations: [r] });
    const t = new TwilioA2p(creds, async (url) => {
      if (String(url).includes("BrandRegistrations")) {
        return response({
          sid: sid("BN"),
          account_sid: account.account_sid,
          status: "APPROVED",
          identity_status: mode === "identity" ? null : "VERIFIED",
          mock: false,
        });
      }
      if (String(url).includes("PhoneNumbers")) return response({ phone_numbers: [] });
      return response({
        compliance: mode === "missing" ? [] : [{
          sid: sid("QE"),
          account_sid: account.account_sid,
          brand_registration_sid: sid("BN"),
          messaging_service_sid: sid("MG"),
          campaign_status: "VERIFIED",
          mock: mode === "mock",
        }],
      });
    });
    if (mode === "missing") db.rows.a2p_registrations[0].campaign_sid = sid("QE");
    await syncRegistration(db, t, "org");
    const snapshot = db.calls.find((c) => c.name === "commit_a2p_snapshot").args.p_snapshot;
    assert.equal(campaignReady({ ...r, ...snapshot }), false);
  }
});
Deno.test("a delayed stale create cannot run after the first operation has unlocked", async () => {
  const stale = reg(), db = database({ a2p_registrations: [stale] });
  let calls = 0;
  const t = new TwilioA2p(creds, async () => {
    calls++;
    return response({
      id: `tri1.us1.account.${account.account_sid}.registration.${sid("BU")}`,
      sessionId: "inq_test",
      sessionToken: "secret",
    });
  });
  await openRegistration(
    db,
    t,
    account,
    stale,
    "brand",
    { id: "admin", email: "admin@example.test" },
    account.fee_version,
  );
  await rejectCode(
    openRegistration(db, t, account, stale, "brand", { id: "admin", email: "admin@example.test" }, account.fee_version),
    "OPERATION_PENDING",
  );
  assert.equal(calls, 1);
});
