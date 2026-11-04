import assert from "node:assert/strict";
import { authorize, type NumberDependencies } from "./auth.ts";
import {
  failure,
  isNumberOfType,
  NumberError,
  parsePurchase,
  parseSearch,
  requestBody,
} from "./contracts.ts";
import { currentPrice, decimal, rentalPrice, samePrice } from "./pricing.ts";

const ACTOR = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const QUOTE = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
const MASTER = `AC${"1".repeat(32)}`;
const SUB = `AC${"2".repeat(32)}`;
const context = { actor_id: ACTOR, organization_id: ORG, view_as: false };
const request = () =>
  new Request("https://example.test", {
    method: "POST",
    headers: { Authorization: "Bearer verified-user" },
  });
const json = (value: unknown) =>
  Promise.resolve(new Response(JSON.stringify(value)));
const rejects = (fn: () => Promise<unknown>, code: string) =>
  assert.rejects(
    fn,
    (error: unknown) => error instanceof NumberError && error.code === code,
  );

Deno.test("purchase contracts preserve local defaults, bound limits and require context for new actions", () => {
  const local = parseSearch({
    area_code: "(415)",
    state: " ca ",
    locality: " San Francisco ",
    limit: 999,
  });
  assert.equal(local.action, "search");
  if (local.action !== "search") throw new Error("Expected search");
  assert.equal(local.number_type, "local");
  assert.equal(local.area_code, "415");
  assert.equal(local.state, "CA");
  assert.equal(local.locality, "San Francisco");
  assert.equal(local.limit, 50);
  assert.throws(
    () => parseSearch({ action: "search", number_type: "toll_free" }),
    /agency context/,
  );
  assert.equal(
    parseSearch({
      ...context,
      action: "search",
      number_type: "toll_free",
      prefix: "888",
    }).number_type,
    "toll_free",
  );
});

Deno.test("unsupported prefixes, mixed filters, prices and ownership fields cannot enter the contract", () => {
  for (
    const patch of [{ prefix: "877" }, { locality: "Boston" }, {
      monthly_price: "0",
    }, { assigned_to: ACTOR }]
  ) {
    assert.throws(() =>
      parseSearch({
        ...context,
        action: "search",
        number_type: "toll_free",
        ...patch,
      })
    );
  }
  for (
    const phone of [
      "+18775550100",
      "+1800555010",
      "18005550100",
      "+448005550100",
    ]
  ) {
    assert.throws(() =>
      parseSearch({
        ...context,
        action: "quote",
        number_type: "toll_free",
        phone_number: phone,
      })
    );
  }
  assert.equal(isNumberOfType("+18005550100", "local"), false);
  assert.equal(isNumberOfType("+18885550100", "toll_free"), true);
  assert.equal(isNumberOfType("+14155550100", "local"), true);
});

Deno.test("buy requires quote/request IDs and explicitly rejects legacy raw-number purchases", () => {
  const input = parsePurchase({
    ...context,
    action: "purchase",
    quote_id: QUOTE,
    request_id: REQUEST,
  });
  assert.equal(input.quote_id, QUOTE);
  assert.equal("phone_number" in input, false);
  for (
    const legacy of [{ phone_number: "+18005550100" }, {
      action: "quote",
      phone_number: "+18005550100",
    }, { action: "purchase" }]
  ) {
    assert.throws(
      () => parsePurchase(legacy),
      (error: unknown) =>
        error instanceof NumberError && error.code === "REVIEW_REQUIRED",
    );
  }
  assert.throws(() =>
    parsePurchase({
      ...context,
      action: "purchase",
      quote_id: QUOTE,
      request_id: REQUEST,
      price: "0",
    })
  );
  assert.throws(() =>
    parsePurchase({
      ...context,
      action: "status",
      quote_id: QUOTE,
      request_id: REQUEST,
      view_as: true,
    })
  );
});

Deno.test("request parsing bounds streamed input and rejects arrays and malformed JSON", async () => {
  for (const body of ["[]", "null", "not json"]) {
    await rejects(
      () =>
        requestBody(
          new Request("https://example.test", { method: "POST", body }),
        ),
      "INVALID_REQUEST",
    );
  }
  await rejects(
    () =>
      requestBody(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ text: "x".repeat(9000) }),
        }),
      ),
    "BODY_TOO_LARGE",
  );
});

Deno.test("money comparison is lossless and rejects fallback, numeric, negative or unbounded prices", () => {
  assert.equal(decimal("0.00000001"), "0.00000001");
  assert.equal(decimal("2.15000000"), "2.15");
  assert.equal(decimal("0.0000"), "0");
  for (
    const value of [
      2.15,
      "-1",
      "NaN",
      "Infinity",
      "1e3",
      "",
      "1.123456789",
      "10000000000",
    ]
  ) assert.throws(() => decimal(value));
  assert.equal(
    samePrice({
      monthly_price: "2.1500",
      currency: "USD",
      inbound_per_minute: "0.0220",
    }, { monthly_price: "2.15", currency: "USD", inbound_per_minute: "0.022" }),
    true,
  );
  assert.equal(
    samePrice({
      monthly_price: "2.15",
      currency: "USD",
      inbound_per_minute: "0.022",
    }, {
      monthly_price: "2.15",
      currency: "USD",
      inbound_per_minute: "0.02200001",
    }),
    false,
  );
});

Deno.test("pricing uses current account rental and exact-number inbound prices, never base prices", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Basic ${btoa(`${MASTER}:synthetic-token`)}`,
    );
    return url.includes("PhoneNumbers/Countries")
      ? json({
        iso_country: "US",
        price_unit: "usd",
        phone_number_prices: [{
          number_type: "toll free",
          current_price: "2.1500",
          base_price: "99.00",
        }],
      })
      : json({
        destination_number: "+18005550100",
        iso_country: "US",
        price_unit: "uSd",
        inbound_call_price: {
          number_type: "toll-free",
          current_price: "0.0220",
          base_price: "9.99",
        },
      });
  };
  assert.deepEqual(
    await currentPrice(
      { accountSid: MASTER, authToken: "synthetic-token" },
      "+18005550100",
      "toll_free",
      fetchImpl,
    ),
    { monthly_price: "2.15", currency: "USD", inbound_per_minute: "0.022" },
  );
  assert.equal(
    urls.some((url) => url.endsWith("/v2/Voice/Numbers/%2B18005550100")),
    true,
  );
});

Deno.test("pricing fails closed for missing rental, wrong number, type, currency or inbound rate", async () => {
  const creds = { accountSid: MASTER, authToken: "synthetic-token" };
  await rejects(
    () =>
      rentalPrice(creds, "toll_free", () =>
        json({
          iso_country: "US",
          price_unit: "USD",
          phone_number_prices: [{
            number_type: "toll free",
            base_price: "2.15",
          }],
        })),
    "PRICE_UNAVAILABLE",
  );
  for (
    const patch of [
      { destination_number: "+18885550100" },
      { destination_number: undefined, number: "+18005550100" },
      { destination_number: "+18885550100", number: "+18005550100" },
      { iso_country: "CA" },
      { price_unit: "CAD" },
      { inbound_call_price: { number_type: "local", current_price: "0.022" } },
      { inbound_call_price: { number_type: "toll-free", base_price: "0.022" } },
      // A null v2 rate alone cannot authorize a purchase without verified country pricing.
      {
        inbound_call_price: {
          number_type: null,
          current_price: null,
          base_price: null,
        },
      },
      { inbound_call_price: null },
    ]
  ) {
    const fetchImpl: typeof fetch = (url) =>
      String(url).includes("PhoneNumbers/Countries")
        ? json({
          iso_country: "US",
          price_unit: "USD",
          phone_number_prices: [{
            number_type: "toll free",
            current_price: "2.15",
          }],
        })
        : json({
          destination_number: "+18005550100",
          iso_country: "US",
          price_unit: "USD",
          inbound_call_price: {
            number_type: "toll-free",
            current_price: "0.022",
          },
          ...patch,
        });
    await rejects(
      () => currentPrice(creds, "+18005550100", "toll_free", fetchImpl),
      "PRICE_UNAVAILABLE",
    );
  }
});

function pricingFixture(options: {
  voice?: Record<string, unknown>;
  country?: unknown;
  voiceStatus?: number;
  countryFails?: boolean;
} = {}) {
  const urls: string[] = [];
  // Shape follows https://www.twilio.com/docs/voice/pricing-api/voicenumber-resource.
  const voice = {
    country: "United States",
    destination_number: "+18005550100",
    iso_country: "US",
    origination_number: null,
    inbound_call_price: {
      base_price: null,
      current_price: null,
      number_type: null,
    },
    outbound_call_prices: [],
    price_unit: "usd",
    ...options.voice,
  };
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    urls.push(url);
    assert.equal(init?.method, "GET");
    if (url.endsWith("/v1/PhoneNumbers/Countries/US")) {
      return json({
        iso_country: "US",
        price_unit: "USD",
        phone_number_prices: [
          { number_type: "toll free", current_price: "2.15" },
          { number_type: "local", current_price: "1.15" },
        ],
      });
    }
    if (url.includes("/v2/Voice/Numbers/")) {
      return Promise.resolve(
        new Response(JSON.stringify(voice), {
          status: options.voiceStatus ?? 200,
        }),
      );
    }
    assert.equal(url, "https://pricing.twilio.com/v1/Voice/Countries/US");
    if (options.countryFails) {
      return Promise.reject(new Error("Synthetic pricing connection failure"));
    }
    return json(
      options.country ??
        {
          iso_country: "US",
          price_unit: "USD",
          inbound_call_prices: [
            {
              number_type: "local",
              current_price: "0.0085",
              base_price: "9.99",
            },
            {
              number_type: "toll free",
              current_price: "0.0215",
              base_price: "9.99",
            },
          ],
        },
    );
  };
  return { fetchImpl, urls };
}

Deno.test("documented nullable v2 inbound pricing uses verified US type-specific current price", async () => {
  const creds = { accountSid: MASTER, authToken: "synthetic-token" };
  for (
    const inbound of [null, undefined, {}, {
      base_price: null,
      current_price: null,
      number_type: null,
    }]
  ) {
    const h = pricingFixture({ voice: { inbound_call_price: inbound } });
    const price = await currentPrice(
      creds,
      "+18005550100",
      "toll_free",
      h.fetchImpl,
    );
    assert.deepEqual(price, {
      monthly_price: "2.15",
      currency: "USD",
      inbound_per_minute: "0.0215",
    });
    assert.equal(
      h.urls.filter((url) => url.endsWith("/v1/Voice/Countries/US")).length,
      1,
    );
  }
  const local = pricingFixture({
    voice: { destination_number: "+14155550100" },
  });
  assert.deepEqual(
    await currentPrice(creds, "+14155550100", "local", local.fetchImpl),
    { monthly_price: "1.15", currency: "USD", inbound_per_minute: "0.0085" },
  );
});

Deno.test("only documented inbound type aliases and case-normalized currencies are accepted", async () => {
  for (const number_type of ["toll-free", "toll free"]) {
    const h = pricingFixture({
      voice: {
        inbound_call_price: {
          number_type,
          current_price: "0.022",
          base_price: null,
        },
        price_unit: "uSd",
      },
    });
    const price = await currentPrice(
      { accountSid: MASTER, authToken: "synthetic-token" },
      "+18005550100",
      "toll_free",
      h.fetchImpl,
    );
    assert.equal(price.currency, "USD");
    assert.equal(price.inbound_per_minute, "0.022");
    assert.equal(
      h.urls.some((url) => url.endsWith("/v1/Voice/Countries/US")),
      false,
    );
  }
});

Deno.test("country pricing never masks a v2 read failure, wrong destination, currency or malformed partial rate", async () => {
  for (
    const options of [
      { voiceStatus: 401 },
      { voiceStatus: 500 },
      { voice: { destination_number: undefined, number: "+18005550100" } },
      { voice: { destination_number: "+18885550100" } },
      { voice: { iso_country: "CA" } },
      { voice: { price_unit: "CAD" } },
      {
        voice: {
          inbound_call_price: {
            number_type: "toll-free",
            current_price: null,
            base_price: null,
          },
        },
      },
      {
        voice: {
          inbound_call_price: {
            number_type: null,
            current_price: null,
            base_price: "0.022",
          },
        },
      },
      {
        voice: {
          inbound_call_price: {
            number_type: "toll-free",
            current_price: "bad",
            base_price: "0.022",
          },
        },
      },
      {
        voice: {
          inbound_call_price: {
            number_type: "tollfree",
            current_price: "0.022",
          },
        },
      },
      { voice: { inbound_call_price: "invalid" } },
    ]
  ) {
    const h = pricingFixture(options);
    await rejects(
      () =>
        currentPrice(
          { accountSid: MASTER, authToken: "synthetic-token" },
          "+18005550100",
          "toll_free",
          h.fetchImpl,
        ),
      "PRICE_UNAVAILABLE",
    );
    assert.equal(
      h.urls.some((url) => url.endsWith("/v1/Voice/Countries/US")),
      false,
    );
  }
});

Deno.test("country fallback requires one matching current price and consistent US currency", async () => {
  for (
    const country of [
      {
        iso_country: "CA",
        price_unit: "USD",
        inbound_call_prices: [{
          number_type: "toll free",
          current_price: "0.022",
        }],
      },
      {
        iso_country: "US",
        price_unit: "CAD",
        inbound_call_prices: [{
          number_type: "toll free",
          current_price: "0.022",
        }],
      },
      { iso_country: "US", price_unit: "USD", inbound_call_prices: [] },
      {
        iso_country: "US",
        price_unit: "USD",
        inbound_call_prices: [{ number_type: "local", current_price: "0.022" }],
      },
      {
        iso_country: "US",
        price_unit: "USD",
        inbound_call_prices: [{
          number_type: "toll free",
          base_price: "0.022",
        }],
      },
      {
        iso_country: "US",
        price_unit: "USD",
        inbound_call_prices: [{
          number_type: "toll free",
          current_price: null,
        }],
      },
      {
        iso_country: "US",
        price_unit: "USD",
        inbound_call_prices: [
          { number_type: "toll free", current_price: "0.022" },
          { number_type: "toll-free", current_price: "0.022" },
        ],
      },
    ]
  ) {
    const h = pricingFixture({ country });
    await rejects(
      () =>
        currentPrice(
          { accountSid: MASTER, authToken: "synthetic-token" },
          "+18005550100",
          "toll_free",
          h.fetchImpl,
        ),
      "PRICE_UNAVAILABLE",
    );
  }
  const failed = pricingFixture({ countryFails: true });
  await rejects(
    () =>
      currentPrice(
        { accountSid: MASTER, authToken: "synthetic-token" },
        "+18005550100",
        "toll_free",
        failed.fetchImpl,
      ),
    "PRICE_UNAVAILABLE",
  );
});

function authDeps(
  profilePatch: Record<string, unknown> = {},
  orgPatch: Record<string, unknown> = {},
): NumberDependencies {
  const db = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve({
            error: null,
            data: table === "profiles"
              ? {
                id: ACTOR,
                organization_id: ORG,
                role: "Admin",
                status: "Active",
                ...profilePatch,
              }
              : {
                twilio_subaccount_sid: SUB,
                twilio_subaccount_status: "active",
                ...orgPatch,
              },
          }),
      };
      return query;
    },
  };
  return {
    db: db as unknown as NumberDependencies["db"],
    userForToken: () => Promise.resolve({ id: ACTOR }),
    masterCredentials: () => ({
      accountSid: MASTER,
      authToken: "synthetic-token",
    }),
    localCredentials: () =>
      Promise.resolve({
        accountSid: SUB,
        authToken: "synthetic-sub-token",
      }),
    fetchImpl: () =>
      Promise.reject(new Error("Authorization must not call provider")),
    supabaseUrl: "https://example.supabase.co",
    now: Date.now,
  };
}

Deno.test("authorization uses actual active profile roles and own organization including Super Admin", async () => {
  for (const role of ["Admin", "Super Admin"]) {
    assert.deepEqual(
      await authorize(
        request(),
        context as { view_as: false },
        authDeps({ role }),
      ),
      { id: ACTOR, organizationId: ORG },
    );
  }
  for (
    const profile of [
      { role: "Agent" },
      { role: "Team Leader" },
      { status: "Inactive" },
      { organization_id: null },
      { id: REQUEST },
    ]
  ) {
    await rejects(
      () =>
        authorize(request(), context as { view_as: false }, authDeps(profile)),
      "FORBIDDEN",
    );
  }
  await rejects(
    () =>
      authorize(request(), {
        ...context,
        organization_id: REQUEST,
        view_as: false,
      }, authDeps({ role: "Super Admin" })),
    "SCOPE_CHANGED",
  );
  await rejects(
    () =>
      authorize(
        request(),
        { ...context, actor_id: REQUEST, view_as: false },
        authDeps(),
      ),
    "SCOPE_CHANGED",
  );
});

Deno.test("authorization fails for invalid JWT and suspended or unconfigured telephony", async () => {
  const deps = authDeps();
  deps.userForToken = () => Promise.resolve(null);
  await rejects(() => authorize(request(), {}, deps), "UNAUTHORIZED");
  await rejects(
    () => authorize(new Request("https://example.test"), {}, authDeps()),
    "UNAUTHORIZED",
  );
  for (const status of ["suspended", "closed"]) {
    await rejects(() =>
      authorize(
        request(),
        {},
        authDeps({}, { twilio_subaccount_status: status }),
      ), "TELEPHONY_SUSPENDED");
  }
  await rejects(
    () =>
      authorize(
        request(),
        {},
        authDeps({}, { twilio_subaccount_status: "pending" }),
      ),
    "PROVISIONING_PENDING",
  );
  await rejects(
    () =>
      authorize(
        request(),
        {},
        authDeps({}, { twilio_subaccount_sid: "invalid" }),
      ),
    "TELEPHONY_MISCONFIGURED",
  );
});

Deno.test("public errors include protocol and never expose unexpected provider or database secrets", async () => {
  const response = failure(
    new Error("private database row and synthetic-secret-token"),
  );
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.protocol_version, 1);
  assert.equal(JSON.stringify(body).includes("synthetic-secret-token"), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
