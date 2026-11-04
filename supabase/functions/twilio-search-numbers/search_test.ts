import assert from "node:assert/strict";
import { createNumberSearchHandler } from "./index.ts";
import type { NumberDependencies } from "../_shared/phoneNumbers/auth.ts";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const QUOTE = "30000000-0000-4000-8000-000000000001";
const MASTER = `AC${"1".repeat(32)}`;
const SUB = `AC${"2".repeat(32)}`;
const NOW = Date.parse("2026-11-04T00:00:00Z");
const context = { actor_id: ACTOR, organization_id: ORG, view_as: false };
const number = (phone: string, patch: Record<string, unknown> = {}) => ({
  phone_number: phone,
  friendly_name: "Provider number",
  iso_country: "US",
  locality: "San Francisco",
  region: "CA",
  postal_code: "94107",
  capabilities: { voice: true, sms: true },
  ...patch,
});
const json = (value: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(value), { status }));
type Options = {
  profile?: Record<string, unknown> | null;
  org?: Record<string, unknown> | null;
  user?: null;
  inventory?: (url: URL) => Response | Promise<Response>;
  rental?: unknown;
  owned?: boolean;
  rowExists?: boolean;
};
function harness(options: Options = {}) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
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
              data: options.profile === null ? null : {
                id: ACTOR,
                organization_id: ORG,
                role: "Admin",
                status: "Active",
                ...options.profile,
              },
            });
          }
          if (table === "organizations") {
            assert.equal(filters.id, ORG);
            return Promise.resolve({
              error: null,
              data: options.org === null ? null : {
                twilio_subaccount_sid: SUB,
                twilio_subaccount_status: "active",
                ...options.org,
              },
            });
          }
          if (table === "phone_numbers") {
            return Promise.resolve({
              error: null,
              data: options.rowExists ? { id: "opaque-existing-row" } : null,
            });
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "phone_number_purchase_quote");
      rpcs.push({ name, args });
      return Promise.resolve({
        error: null,
        data: {
          id: QUOTE,
          actor_id: args.p_actor,
          organization_id: args.p_org,
          account_sid: args.p_account,
          phone_number: args.p_number,
          number_type: args.p_type,
          friendly_name: args.p_friendly_name,
          quote: args.p_quote,
          expires_at: new Date(NOW + 300_000).toISOString(),
          state: "quoted",
          request_id: null,
          provider_sid: null,
          phone_number_id: null,
        },
      });
    },
  };
  const deps: NumberDependencies = {
    db: db as unknown as NumberDependencies["db"],
    userForToken: () =>
      Promise.resolve(options.user === null ? null : { id: ACTOR }),
    masterCredentials: () => ({
      accountSid: MASTER,
      authToken: "synthetic-master-token",
    }),
    localCredentials: (org) => {
      assert.equal(org, ORG);
      return Promise.resolve({
        accountSid: SUB,
        authToken: "synthetic-sub-token",
      });
    },
    supabaseUrl: "https://example.supabase.co",
    now: () => NOW,
    fetchImpl: (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      assert.equal(
        init?.method,
        "GET",
        "Search/review must never make a provider POST",
      );
      if (url.pathname.includes("AvailablePhoneNumbers")) {
        if (options.inventory) return Promise.resolve(options.inventory(url));
        const exact = url.searchParams.get("Contains");
        const phone = exact ??
          (url.pathname.includes("/Local")
            ? "+14155550100"
            : url.searchParams.get("AreaCode") === "888"
            ? "+18885550100"
            : "+18005550100");
        return json({ available_phone_numbers: [number(phone)] });
      }
      if (url.pathname.endsWith("/PhoneNumbers/Countries/US")) {
        return json(
          options.rental ??
            {
              iso_country: "US",
              price_unit: "USD",
              phone_number_prices: [
                {
                  number_type: "local",
                  base_price: "9.99",
                  current_price: "1.1500",
                },
                {
                  number_type: "toll free",
                  base_price: "9.99",
                  current_price: "2.1500",
                },
              ],
            },
        );
      }
      if (url.pathname.includes("/Voice/Numbers/")) {
        const phone = decodeURIComponent(url.pathname.split("/").at(-1)!);
        return json({
          destination_number: phone,
          iso_country: "US",
          price_unit: "USD",
          inbound_call_price: {
            number_type: phone.startsWith("+1415") ? "local" : "toll-free",
            current_price: "0.0220",
            base_price: "9.99",
          },
        });
      }
      if (url.pathname.endsWith("/IncomingPhoneNumbers.json")) {
        return json({
          incoming_phone_numbers: options.owned
            ? [{ phone_number: url.searchParams.get("PhoneNumber") }]
            : [],
        });
      }
      throw new Error(`Unexpected provider URL ${url}`);
    },
  };
  return { handler: createNumberSearchHandler(deps), calls, rpcs };
}
function request(body: unknown, token = "signed-user"): Request {
  return new Request(
    "https://example.supabase.co/functions/v1/twilio-search-numbers",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}
const search = (patch: Record<string, unknown> = {}) => ({
  ...context,
  action: "search",
  number_type: "toll_free",
  prefix: "prefer_800",
  ...patch,
});
const quote = (phone = "+18005550100", type = "toll_free") => ({
  ...context,
  action: "quote",
  phone_number: phone,
  number_type: type,
});

Deno.test("local handler preserves legacy filters and subaccount inventory with actual master rental", async () => {
  const h = harness();
  const response = await h.handler(
    request({
      area_code: "415",
      state: "ca",
      locality: "San Francisco",
      limit: 5,
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.protocol_version, 1);
  assert.equal(body.numbers[0].phone_number, "+14155550100");
  assert.equal(body.numbers[0].monthly_price, "1.15");
  assert.equal(body.numbers[0].locality, "San Francisco");
  const inventory = h.calls.find((call) =>
    call.url.pathname.includes("AvailablePhoneNumbers")
  )!;
  assert.ok(
    inventory.url.pathname.includes(
      `/Accounts/${SUB}/AvailablePhoneNumbers/US/Local.json`,
    ),
  );
  assert.equal(inventory.url.searchParams.get("AreaCode"), "415");
  assert.equal(inventory.url.searchParams.get("InRegion"), "CA");
  assert.equal(inventory.url.searchParams.get("InLocality"), "San Francisco");
  assert.equal(inventory.url.searchParams.get("PageSize"), "5");
  assert.equal(
    new Headers(inventory.init?.headers).get("Authorization"),
    `Basic ${btoa(`${SUB}:synthetic-sub-token`)}`,
  );
  const price = h.calls.find((call) =>
    call.url.hostname === "pricing.twilio.com"
  )!;
  assert.equal(
    new Headers(price.init?.headers).get("Authorization"),
    `Basic ${btoa(`${MASTER}:synthetic-master-token`)}`,
  );
});

Deno.test("toll-free handler searches master, prioritizes 800, deduplicates and rejects unsuitable inventory", async () => {
  const h = harness({
    inventory: (url) =>
      json({
        available_phone_numbers: url.searchParams.get("AreaCode") === "800"
          ? [
            number("+18005550100"),
            number("+18005550100"),
            number("+18885550999"),
            number("+18775550100"),
            number("+18005550101", { iso_country: "CA" }),
            number("+18005550102", { capabilities: { voice: false } }),
          ]
          : [number("+18885550100")],
      }),
  });
  const response = await h.handler(request(search()));
  const body = await response.json();
  assert.deepEqual(
    body.numbers.map((row: { phone_number: string }) => row.phone_number),
    ["+18005550100", "+18885550100"],
  );
  assert.equal(body.numbers[0].monthly_price, "2.15");
  assert.equal(
    body.numbers.every((row: { locality: unknown; region: unknown }) =>
      row.locality === null && row.region === null
    ),
    true,
  );
  for (
    const call of h.calls.filter((call) =>
      call.url.pathname.includes("AvailablePhoneNumbers")
    )
  ) {
    assert.ok(
      call.url.pathname.includes(
        `/Accounts/${MASTER}/AvailablePhoneNumbers/US/TollFree.json`,
      ),
    );
    assert.equal(call.url.searchParams.get("VoiceEnabled"), "true");
  }
});

Deno.test("888-only search and total limits are respected", async () => {
  const h = harness();
  const response = await h.handler(
    request(search({ prefix: "888", limit: 1 })),
  );
  assert.deepEqual(
    (await response.json()).numbers.map((row: { phone_number: string }) =>
      row.phone_number
    ),
    ["+18885550100"],
  );
  assert.equal(
    h.calls.filter((call) =>
      call.url.pathname.includes("AvailablePhoneNumbers")
    ).length,
    1,
  );
});

Deno.test("empty 800 inventory falls back to 888 but failed 800 lookup does not masquerade as empty", async () => {
  const empty = harness({
    inventory: (url) =>
      json({
        available_phone_numbers: url.searchParams.get("AreaCode") === "800"
          ? []
          : [number("+18885550100")],
      }),
  });
  assert.equal(
    (await (await empty.handler(request(search()))).json()).numbers[0]
      .phone_number,
    "+18885550100",
  );
  const failed = harness({
    inventory: (url) =>
      url.searchParams.get("AreaCode") === "800"
        ? json({ message: "private provider failure" }, 500)
        : json({ available_phone_numbers: [number("+18885550100")] }),
  });
  const response = await failed.handler(request(search()));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "PROVIDER_UNAVAILABLE");
});

Deno.test("handler permission boundaries deny provider access before search or quote", async () => {
  for (
    const options of [
      { user: null },
      { profile: null },
      { profile: { role: "Agent" } },
      { profile: { role: "Team Leader" } },
      { profile: { status: "Inactive" } },
      { profile: { organization_id: null } },
      { org: { twilio_subaccount_status: "suspended" } },
      { org: null },
    ] satisfies Options[]
  ) {
    const h = harness(options);
    const response = await h.handler(request(search()));
    assert.ok([401, 403].includes(response.status));
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcs.length, 0);
  }
  for (
    const patch of [{ actor_id: QUOTE }, { organization_id: QUOTE }, {
      view_as: true,
    }]
  ) {
    const h = harness();
    assert.equal((await h.handler(request(search(patch)))).status, 403);
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("quote action uses exact master inventory and provider prices without any purchase POST", async () => {
  const h = harness();
  const response = await h.handler(request(quote()));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.protocol_version, 1);
  assert.deepEqual(body.quote, {
    id: QUOTE,
    phone_number: "+18005550100",
    number_type: "toll_free",
    friendly_name: "Provider number",
    monthly_price: "2.15",
    currency: "USD",
    inbound_per_minute: "0.022",
    expires_at: new Date(NOW + 300_000).toISOString(),
  });
  assert.equal(h.rpcs[0].args.p_account, MASTER);
  assert.equal(h.rpcs[0].args.p_org, ORG);
  assert.equal(h.rpcs[0].args.p_actor, ACTOR);
  assert.equal(h.calls.every((call) => call.init?.method === "GET"), true);
  assert.equal(JSON.stringify(body).includes("token"), false);
});

Deno.test("local quote rechecks master availability and preserves server-derived city/state naming", async () => {
  const h = harness();
  const response = await h.handler(request(quote("+14155550100", "local")));
  assert.equal(
    (await response.json()).quote.friendly_name,
    "San Francisco, CA",
  );
  const inventory = h.calls.find((call) =>
    call.url.pathname.includes("AvailablePhoneNumbers")
  )!;
  assert.ok(
    inventory.url.pathname.includes(
      `/Accounts/${MASTER}/AvailablePhoneNumbers/US/Local.json`,
    ),
  );
  assert.equal(inventory.url.searchParams.get("Contains"), "+14155550100");
});

Deno.test("unverified prices and already owned numbers cannot produce a quote", async () => {
  const missingPrice = harness({
    rental: { iso_country: "US", price_unit: "USD", phone_number_prices: [] },
  });
  assert.equal((await missingPrice.handler(request(quote()))).status, 503);
  assert.equal(missingPrice.rpcs.length, 0);
  for (const options of [{ owned: true }, { rowExists: true }]) {
    const h = harness(options);
    const response = await h.handler(request(quote()));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "NUMBER_UNAVAILABLE");
    assert.equal(h.rpcs.length, 0);
  }
});

Deno.test("unsupported methods, malformed input and client prices cannot reach provider or ledger", async () => {
  const h = harness();
  assert.equal(
    (await h.handler(
      new Request("https://example.test", { method: "OPTIONS" }),
    )).status,
    200,
  );
  assert.equal(
    (await h.handler(new Request("https://example.test"))).status,
    405,
  );
  assert.equal(
    (await h.handler(request({ ...quote(), monthly_price: "0.01" }))).status,
    400,
  );
  assert.equal(
    (await h.handler(request({ ...quote(), assigned_to: ACTOR }))).status,
    400,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcs.length, 0);
});
