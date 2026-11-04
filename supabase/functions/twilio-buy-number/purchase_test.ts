import assert from "node:assert/strict";
import { createNumberPurchaseHandler } from "./index.ts";
import type { NumberDependencies } from "../_shared/phoneNumbers/auth.ts";
import type { Operation } from "../_shared/phoneNumbers/contracts.ts";
import { canonicalNumberConfig } from "../_shared/twilioNumberConfig.ts";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const QUOTE = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
const OTHER = "50000000-0000-4000-8000-000000000001";
const PHONE_ID = "60000000-0000-4000-8000-000000000001";
const MASTER = `AC${"1".repeat(32)}`;
const SUB = `AC${"2".repeat(32)}`;
const PN = `PN${"3".repeat(32)}`;
const NOW = Date.parse("2026-11-04T00:00:00Z");
const URL_BASE = "https://example.supabase.co";
const context = { actor_id: ACTOR, organization_id: ORG, view_as: false };
const body = (patch: Record<string, unknown> = {}) => ({
  ...context,
  action: "purchase",
  quote_id: QUOTE,
  request_id: REQUEST,
  ...patch,
});
const request = (value: unknown = body()) =>
  new Request(`${URL_BASE}/functions/v1/twilio-buy-number`, {
    method: "POST",
    headers: {
      Authorization: "Bearer signed-user",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function quoted(patch: Partial<Operation> = {}): Operation {
  return {
    id: QUOTE,
    actor_id: ACTOR,
    organization_id: ORG,
    account_sid: MASTER,
    phone_number: "+18005550100",
    number_type: "toll_free",
    friendly_name: "Selected toll-free number",
    quote: {
      monthly_price: "2.15",
      currency: "USD",
      inbound_per_minute: "0.022",
    },
    expires_at: new Date(NOW + 300_000).toISOString(),
    state: "quoted",
    request_id: null,
    provider_sid: null,
    phone_number_id: null,
    ...patch,
  };
}
type Options = {
  op?: Partial<Operation>;
  profile?: Record<string, unknown>;
  denyLate?: boolean;
  invalidUser?: boolean;
  providerOwned?: boolean;
  existingRow?: boolean;
  unavailable?: boolean;
  price?: string;
  usage?: string;
  master?: string;
  postStatus?: number;
  postRaw?: string;
  receipt?: Record<string, unknown>;
  receiptLookup?: Record<string, unknown>;
  postThrows?: boolean;
  recordFails?: boolean;
  recordResponseLost?: boolean;
  completeFailures?: number;
  claimBlocked?: boolean;
  claimExpires?: boolean;
  beforePostResponse?: () => Promise<void>;
  ledgerGetError?: boolean;
};
function harness(options: Options = {}) {
  let op = quoted(options.op), providerPurchased = false, authCalls = 0;
  let completeFailures = options.completeFailures ?? 0;
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const saved: Record<string, unknown>[] = [];
  const receipt = () => ({
    sid: PN,
    account_sid: MASTER,
    phone_number: op.phone_number,
    capabilities: { voice: true, sms: true },
    ...options.receipt,
  });
  const err = (message: string, code = "PT409") => ({
    data: null,
    error: { message, code },
  });
  const snapshot = (extra: Record<string, unknown> = {}) => ({
    data: structuredClone({ ...op, ...extra }),
    error: null,
  });
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        maybeSingle: () => {
          if (table === "profiles") {
            assert.equal(filters.id, ACTOR);
            return Promise.resolve({
              error: null,
              data: {
                id: ACTOR,
                organization_id: ORG,
                role: options.denyLate && authCalls > 1 ? "Agent" : "Admin",
                status: "Active",
                ...options.profile,
              },
            });
          }
          if (table === "organizations") {
            return Promise.resolve({
              error: null,
              data: {
                twilio_subaccount_sid: SUB,
                twilio_subaccount_status: "active",
              },
            });
          }
          if (table === "phone_numbers") {
            return Promise.resolve({
              error: null,
              data: options.existingRow ? { id: OTHER } : null,
            });
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (
        args.p_actor !== op.actor_id || args.p_org !== op.organization_id ||
        args.p_quote !== op.id
      ) return Promise.resolve(err("operation_not_found", "PT404"));
      if (op.request_id && args.p_request !== op.request_id) {
        return Promise.resolve(err("request_conflict"));
      }
      if (name.endsWith("_get")) {
        return Promise.resolve(
          options.ledgerGetError
            ? err("private internal database failure", "XX000")
            : snapshot(),
        );
      }
      if (name.endsWith("_claim")) {
        if (options.claimBlocked) {
          return Promise.resolve(err("number_unavailable"));
        }
        if (options.claimExpires) {
          op.expires_at = new Date(NOW - 1).toISOString();
          return Promise.resolve(err("quote_expired"));
        }
        if (op.state !== "quoted") {
          return Promise.resolve(snapshot({ claimed: false }));
        }
        if (Date.parse(op.expires_at) <= NOW) {
          return Promise.resolve(err("quote_expired"));
        }
        op = {
          ...op,
          request_id: args.p_request as string,
          state: "purchasing",
        };
        return Promise.resolve(snapshot({ claimed: true }));
      }
      if (name.endsWith("_review")) {
        if (op.state === "quoted") {
          op = {
            ...op,
            request_id: args.p_request as string,
            state: "failed_before_purchase",
          };
        } else if (op.state === "purchasing") {
          op = { ...op, state: "needs_review" };
        }
        op.error_code = args.p_code as string;
        return Promise.resolve(snapshot());
      }
      if (name.endsWith("_record")) {
        if (options.recordFails) {
          return Promise.resolve(
            err("Synthetic receipt save failure", "XX000"),
          );
        }
        op = {
          ...op,
          provider_sid: args.p_sid as string,
          state: "purchased_pending_save",
        };
        return Promise.resolve(
          options.recordResponseLost
            ? err("Synthetic lost database response", "XX000")
            : snapshot(),
        );
      }
      if (name.endsWith("_complete")) {
        if (completeFailures-- > 0) {
          return Promise.resolve(err("Synthetic insert failure", "XX000"));
        }
        if (op.state === "completed") return Promise.resolve(snapshot());
        assert.equal(op.state, "purchased_pending_save");
        assert.equal(op.provider_sid, PN);
        const row = {
          id: PHONE_ID,
          phone_number: op.phone_number,
          twilio_sid: op.provider_sid,
          organization_id: op.organization_id,
          friendly_name: op.friendly_name,
          status: "active",
          assignment_type: "agency",
          assigned_to: null,
          is_default: false,
          is_direct_line: false,
          inbounds_only: false,
          trust_hub_status: "pending",
        };
        saved.push(row);
        op = {
          ...op,
          state: "completed",
          phone_number_id: PHONE_ID,
          row,
          error_code: null,
        };
        return Promise.resolve(snapshot());
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const deps: NumberDependencies = {
    db: db as unknown as NumberDependencies["db"],
    userForToken: () => {
      authCalls++;
      return Promise.resolve(options.invalidUser ? null : { id: ACTOR });
    },
    masterCredentials: () => ({
      accountSid: options.master ?? MASTER,
      authToken: "synthetic-master-token",
    }),
    localCredentials: () =>
      Promise.reject(new Error("Purchases never use subaccount credentials")),
    supabaseUrl: URL_BASE,
    now: () => NOW,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (init?.method === "POST") {
        assert.equal(
          op.state,
          "purchasing",
          "The atomic attempted barrier must precede the provider POST",
        );
        assert.equal(op.request_id, REQUEST);
        assert.equal(
          url.pathname,
          `/2010-04-01/Accounts/${MASTER}/IncomingPhoneNumbers.json`,
        );
        providerPurchased = true;
        if (options.beforePostResponse) await options.beforePostResponse();
        if (options.postThrows) {
          throw new Error(
            "Synthetic network timeout after provider may have charged",
          );
        }
        if (options.postRaw !== undefined) {
          return new Response(options.postRaw, {
            status: options.postStatus ?? 200,
          });
        }
        return json(receipt(), options.postStatus ?? 201);
      }
      assert.equal(init?.method, "GET");
      if (url.pathname.includes("AvailablePhoneNumbers")) {
        return json({
          available_phone_numbers: options.unavailable || providerPurchased
            ? []
            : [{
              phone_number: op.phone_number,
              friendly_name: "Provider label",
              iso_country: "US",
              capabilities: { voice: true, sms: true },
            }],
        });
      }
      if (url.pathname.endsWith("/PhoneNumbers/Countries/US")) {
        return json({
          iso_country: "US",
          price_unit: "USD",
          phone_number_prices: [{
            number_type: op.number_type === "local" ? "local" : "toll free",
            current_price: options.price ?? op.quote.monthly_price,
          }],
        });
      }
      if (url.pathname.includes("/Voice/Numbers/")) {
        return json({
          destination_number: op.phone_number,
          iso_country: "US",
          price_unit: "USD",
          inbound_call_price: {
            number_type: op.number_type === "local" ? "local" : "toll-free",
            current_price: options.usage ?? op.quote.inbound_per_minute,
          },
        });
      }
      if (url.pathname.endsWith("/IncomingPhoneNumbers.json")) {
        return json({
          incoming_phone_numbers: options.providerOwned || providerPurchased
            ? [{ phone_number: op.phone_number }]
            : [],
        });
      }
      if (url.pathname.endsWith(`/IncomingPhoneNumbers/${PN}.json`)) {
        return json({ ...receipt(), ...options.receiptLookup });
      }
      throw new Error(`Unexpected provider URL ${url}`);
    },
  };
  return {
    handler: createNumberPurchaseHandler(deps),
    calls,
    rpcs,
    saved,
    op: () => op,
    posts: () => calls.filter((call) => call.init?.method === "POST"),
  };
}

Deno.test("purchase provisions exactly the reviewed number on master with unchanged callback fields", async () => {
  const h = harness();
  const response = await h.handler(request());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.protocol_version, 1);
  assert.equal(result.operation.state, "completed");
  assert.equal(result.operation.id, QUOTE);
  assert.equal(result.operation.phone_number_id, PHONE_ID);
  assert.equal(h.posts().length, 1);
  const payload = new URLSearchParams(String(h.posts()[0].init?.body));
  const config = canonicalNumberConfig(URL_BASE);
  assert.deepEqual(Object.fromEntries(payload), {
    PhoneNumber: "+18005550100",
    FriendlyName: "Selected toll-free number",
    VoiceUrl: config.voiceUrl,
    VoiceMethod: "POST",
    SmsUrl: config.smsUrl,
    SmsMethod: "POST",
    StatusCallback: config.statusCallback,
    StatusCallbackMethod: "POST",
  });
  assert.equal(
    new Headers(h.posts()[0].init?.headers).get("Authorization"),
    `Basic ${btoa(`${MASTER}:synthetic-master-token`)}`,
  );
  const recorded = h.rpcs.find((call) => call.name.endsWith("_record"))!;
  assert.equal(recorded.args.p_provider_number, "+18005550100");
  assert.equal(recorded.args.p_provider_account, MASTER);
  assert.equal(recorded.args.p_sid, PN);
  assert.equal(result.row.organization_id, ORG);
  assert.equal(result.row.assignment_type, "agency");
  assert.equal(result.row.assigned_to, null);
  assert.equal(result.row.trust_hub_status, "pending");
  assert.equal(result.row.inbounds_only, false);
});

Deno.test("local exact-number purchase retains master ownership and reviewed naming", async () => {
  const h = harness({
    op: {
      phone_number: "+14155550100",
      number_type: "local",
      friendly_name: "San Francisco, CA",
    },
  });
  assert.equal(
    (await (await h.handler(request())).json()).operation.state,
    "completed",
  );
  const payload = new URLSearchParams(String(h.posts()[0].init?.body));
  assert.equal(payload.get("PhoneNumber"), "+14155550100");
  assert.equal(payload.get("FriendlyName"), "San Francisco, CA");
});

Deno.test("completed replay reads ledger first and performs no inventory check or second POST", async () => {
  const h = harness();
  await h.handler(request());
  const before = h.calls.length;
  const result = await (await h.handler(request())).json();
  assert.equal(result.operation.state, "completed");
  assert.equal(result.replayed, true);
  assert.equal(h.calls.length, before);
  assert.equal(h.posts().length, 1);
  assert.equal(h.saved.length, 1);
});

Deno.test("concurrent duplicate requests share one durable claim and one provider POST", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = harness({
    beforePostResponse: () => {
      entered();
      return blocked;
    },
  });
  const first = h.handler(request());
  await started;
  const second = await h.handler(request());
  assert.equal((await second.json()).operation.state, "purchasing");
  assert.equal(h.posts().length, 1);
  release();
  assert.equal((await (await first).json()).operation.state, "completed");
  assert.equal(h.posts().length, 1);
});

Deno.test("different request key cannot repurchase a claimed number", async () => {
  const h = harness({ postThrows: true });
  await h.handler(request());
  const response = await h.handler(request(body({ request_id: OTHER })));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "REQUEST_CONFLICT");
  assert.equal(h.posts().length, 1);
});

Deno.test("global competing-number claim refuses provisioning without revealing the other organization", async () => {
  const h = harness({ claimBlocked: true });
  const response = await h.handler(request());
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.code, "NUMBER_UNAVAILABLE");
  assert.equal(h.posts().length, 0);
  assert.equal(JSON.stringify(result).includes(OTHER), false);
});

Deno.test("rent or usage price changes require another review and never purchase", async () => {
  for (const options of [{ price: "2.16" }, { usage: "0.02200001" }]) {
    const h = harness(options);
    const result = await (await h.handler(request())).json();
    assert.equal(result.operation.state, "failed_before_purchase");
    assert.equal(result.operation.error_code, "PRICE_CHANGED");
    assert.equal(h.posts().length, 0);
    assert.equal(h.rpcs.some((call) => call.name.endsWith("_claim")), false);
  }
});

Deno.test("expired quotes and changed purchasing account fail before provider access", async () => {
  for (
    const [options, expected] of [[{
      op: { expires_at: new Date(NOW - 1).toISOString() },
    }, "QUOTE_EXPIRED"], [{ master: SUB }, "ACCOUNT_CHANGED"]] as const
  ) {
    const h = harness(options);
    const result = await (await h.handler(request())).json();
    assert.equal(result.operation.state, "failed_before_purchase");
    assert.equal(result.operation.error_code, expected);
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("unavailable or previously owned number is never substituted or adopted", async () => {
  for (
    const options of [{ unavailable: true }, { providerOwned: true }, {
      existingRow: true,
    }]
  ) {
    const h = harness(options);
    const result = await (await h.handler(request())).json();
    assert.equal(result.operation.state, "failed_before_purchase");
    assert.equal(result.operation.error_code, "NUMBER_UNAVAILABLE");
    assert.equal(h.posts().length, 0);
    assert.equal(h.saved.length, 0);
  }
});

Deno.test("late role revocation is checked after provider reads and before the paid claim", async () => {
  const h = harness({ denyLate: true });
  const response = await h.handler(request());
  assert.equal(response.status, 403);
  assert.ok(h.calls.length > 0);
  assert.equal(h.posts().length, 0);
  assert.equal(h.rpcs.some((call) => call.name.endsWith("_claim")), false);
});

Deno.test("known provider receipt survives save failure and status finalizes only its exact PN SID", async () => {
  const h = harness({ completeFailures: 1 });
  const first = await (await h.handler(request())).json();
  assert.equal(first.operation.state, "purchased_pending_save");
  assert.equal(first.operation.error_code, "SAVE_PENDING");
  const before = h.calls.length;
  const next = await (await h.handler(request(body({ action: "status" }))))
    .json();
  assert.equal(next.operation.state, "completed");
  assert.equal(next.replayed, true);
  assert.equal(h.posts().length, 1);
  assert.deepEqual(h.calls.slice(before).map((call) => call.url.pathname), [
    `/2010-04-01/Accounts/${MASTER}/IncomingPhoneNumbers/${PN}.json`,
  ]);
});

Deno.test("lost receipt write response is resolved through durable receipt, never through another purchase", async () => {
  const h = harness({ recordResponseLost: true });
  const first = await (await h.handler(request())).json();
  assert.equal(first.operation.state, "purchased_pending_save");
  const second = await (await h.handler(request(body({ action: "status" }))))
    .json();
  assert.equal(second.operation.state, "completed");
  assert.equal(h.posts().length, 1);
});

Deno.test("missing durable receipt stays in review even when master now owns the number", async () => {
  const h = harness({ recordFails: true });
  const first = await (await h.handler(request())).json();
  assert.equal(first.operation.state, "needs_review");
  assert.equal(h.op().provider_sid, null);
  const before = h.calls.length;
  const next = await (await h.handler(request(body({ action: "status" }))))
    .json();
  assert.equal(next.operation.state, "needs_review");
  assert.equal(h.calls.length, before);
  assert.equal(h.posts().length, 1);
  assert.equal(h.saved.length, 0);
});

Deno.test("timeouts, provider errors and malformed successful responses create a permanent attempted barrier", async () => {
  for (
    const options of [
      { postThrows: true },
      { postStatus: 500 },
      { postStatus: 400 },
      { postRaw: "not-json" },
      { postRaw: "null" },
    ]
  ) {
    const h = harness(options);
    const first = await (await h.handler(request())).json();
    assert.equal(first.operation.state, "needs_review");
    assert.equal(first.operation.error_code, "PURCHASE_OUTCOME_UNKNOWN");
    await h.handler(request());
    await h.handler(request(body({ action: "status" })));
    assert.equal(h.posts().length, 1);
    assert.equal(h.saved.length, 0);
  }
});

Deno.test("wrong provider account, number, SID or voice capability never creates a phone row", async () => {
  for (
    const receipt of [{ account_sid: SUB }, { phone_number: "+18885550100" }, {
      sid: "PNbad",
    }, { capabilities: { voice: false, sms: true } }]
  ) {
    const h = harness({ receipt });
    const result = await (await h.handler(request())).json();
    assert.equal(result.operation.state, "needs_review");
    assert.equal(result.operation.error_code, "PROVIDER_RECEIPT_MISMATCH");
    assert.equal(h.saved.length, 0);
    assert.equal(h.rpcs.some((call) => call.name.endsWith("_record")), false);
  }
});

Deno.test("known-SID reconciliation does not finalize a mismatched receipt", async () => {
  const h = harness({
    op: {
      state: "purchased_pending_save",
      provider_sid: PN,
      request_id: REQUEST,
    },
    receiptLookup: { phone_number: "+18885550100" },
  });
  const result = await (await h.handler(request(body({ action: "status" }))))
    .json();
  assert.equal(result.operation.state, "purchased_pending_save");
  assert.equal(result.operation.error_code, "RECEIPT_VERIFICATION_FAILED");
  assert.equal(h.posts().length, 0);
  assert.equal(h.saved.length, 0);
});

Deno.test("status and a crashed purchasing operation cannot become new provider attempts", async () => {
  const unattempted = harness();
  const status =
    await (await unattempted.handler(request(body({ action: "status" }))))
      .json();
  assert.equal(status.operation.state, "quoted");
  assert.equal(unattempted.calls.length, 0);
  const crashed = harness({
    op: {
      state: "purchasing",
      request_id: REQUEST,
      expires_at: new Date(NOW - 86_400_000).toISOString(),
    },
  });
  assert.equal(
    (await (await crashed.handler(request())).json()).operation.state,
    "purchasing",
  );
  assert.equal(crashed.calls.length, 0);
});

Deno.test("status closes an expired unattempted quote and safely recovers expiry while waiting for claim", async () => {
  const expired = harness({
    op: { expires_at: new Date(NOW - 1).toISOString() },
  });
  const status =
    await (await expired.handler(request(body({ action: "status" })))).json();
  assert.equal(status.operation.state, "failed_before_purchase");
  assert.equal(status.operation.error_code, "QUOTE_EXPIRED");
  assert.equal(expired.calls.length, 0);
  assert.equal(
    expired.rpcs.some((call) => call.name.endsWith("_claim")),
    false,
  );

  const waiting = harness({ claimExpires: true });
  const first = await waiting.handler(request());
  assert.equal(first.status, 409);
  assert.equal((await first.json()).code, "QUOTE_EXPIRED");
  const providerReads = waiting.calls.length;
  const recovered =
    await (await waiting.handler(request(body({ action: "status" })))).json();
  assert.equal(recovered.operation.state, "failed_before_purchase");
  assert.equal(waiting.posts().length, 0);
  assert.equal(waiting.calls.length, providerReads);
});

Deno.test("old UI against new buy fails closed, and new request lacks the old handler's purchasing trigger", async () => {
  const h = harness();
  for (
    const old of [{ phone_number: "+18005550100" }, {
      action: "quote",
      phone_number: "+18005550100",
    }, { ...body(), phone_number: "+18005550100" }]
  ) {
    const response = await h.handler(request(old));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "REVIEW_REQUIRED");
  }
  // The deployed old handler requires phone_number before it can call IncomingPhoneNumbers POST.
  assert.equal("phone_number" in body(), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcs.length, 0);
});

Deno.test("purchase authorization and client-owned fields are refused before ledger or provider access", async () => {
  for (
    const options of [{ invalidUser: true }, { profile: { role: "Agent" } }, {
      profile: { status: "Inactive" },
    }]
  ) {
    const h = harness(options);
    assert.ok([401, 403].includes((await h.handler(request())).status));
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcs.length, 0);
  }
  for (
    const patch of [
      { organization_id: OTHER },
      { actor_id: OTHER },
      { view_as: true },
      { assigned_to: ACTOR },
      { monthly_price: "0.01" },
    ]
  ) {
    const h = harness();
    assert.ok(
      [400, 403].includes((await h.handler(request(body(patch)))).status),
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcs.length, 0);
  }
});

Deno.test("foreign or tampered ledger binding never discloses ownership or initiates provider work", async () => {
  const foreign = harness({ op: { actor_id: OTHER, organization_id: OTHER } });
  const response = await foreign.handler(request());
  const result = await response.json();
  assert.equal(response.status, 404);
  assert.equal(result.code, "OPERATION_NOT_FOUND");
  assert.equal(foreign.calls.length, 0);
  assert.equal(JSON.stringify(result).includes(OTHER), false);
  const unavailable = harness({ ledgerGetError: true });
  const error = await unavailable.handler(request());
  assert.equal(error.status, 503);
  assert.equal((await error.text()).includes("private internal"), false);
  assert.equal(unavailable.calls.length, 0);
});
