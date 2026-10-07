import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  handleTwilioAccountBalance,
  normalizeTwilioBalance,
  type BalanceAdminClient,
  type BalanceAuthClient,
} from "./balance.ts";

const MASTER_SID = `AC${"1".repeat(32)}`;
const MASTER_TOKEN = "master-secret-token";

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode(claims)}.signature`;
}

function request(token?: string, method = "GET"): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://example.supabase.co/functions/v1/twilio-account-balance", {
    method,
    headers,
  });
}

function clients(options: {
  user?: { id: string } | null;
  authError?: unknown;
  profile?: { is_super_admin?: unknown } | null;
  profileError?: unknown;
} = {}): {
  authClient: BalanceAuthClient;
  adminClient: BalanceAdminClient;
  profileCalls: Array<Record<string, string>>;
} {
  const profileCalls: Array<Record<string, string>> = [];
  const authClient: BalanceAuthClient = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: options.user === undefined ? { id: "user-1" } : options.user },
          error: options.authError ?? null,
        }),
    },
  };
  const adminClient: BalanceAdminClient = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: string) {
              return {
                maybeSingle() {
                  profileCalls.push({ table, columns, column, value });
                  return Promise.resolve({
                    data: options.profile === undefined
                      ? { is_super_admin: true }
                      : options.profile,
                    error: options.profileError ?? null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  return { authClient, adminClient, profileCalls };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function deps(
  options: Parameters<typeof clients>[0] = {},
  extra: Partial<Parameters<typeof handleTwilioAccountBalance>[1]> = {},
) {
  const c = clients(options);
  return {
    clients: c,
    deps: {
      authClient: c.authClient,
      adminClient: c.adminClient,
      masterAccountSid: MASTER_SID,
      masterAuthToken: MASTER_TOKEN,
      now: () => new Date("2026-10-06T20:00:00.000Z"),
      ...extra,
    },
  };
}

Deno.test("balance endpoint returns 401 without a bearer token", async () => {
  const { deps: d, clients: c } = deps();
  const response = await handleTwilioAccountBalance(request(), d);
  assertEquals(response.status, 401);
  assertEquals(c.profileCalls.length, 0);
});

Deno.test("balance endpoint returns 401 for malformed or invalid authentication", async () => {
  const malformed = new Request("https://example.supabase.co/functions/v1/twilio-account-balance", {
    method: "GET",
    headers: { Authorization: "Token nope" },
  });
  const first = deps();
  assertEquals((await handleTwilioAccountBalance(malformed, first.deps)).status, 401);

  const second = deps({ user: null, authError: { message: "invalid JWT" } });
  const response = await handleTwilioAccountBalance(
    request(jwt({ is_super_admin: true })),
    second.deps,
  );
  assertEquals(response.status, 401);
});

Deno.test("Agent and Admin callers are forbidden", async () => {
  for (const label of ["Agent", "Admin"]) {
    const { deps: d } = deps({ profile: { is_super_admin: false } });
    const response = await handleTwilioAccountBalance(
      request(jwt({ is_super_admin: false, user_role: label })),
      d,
    );
    assertEquals(response.status, 403, label);
  }
});

Deno.test("both the JWT claim and server profile must prove Super Admin", async () => {
  const claimFalse = deps({ profile: { is_super_admin: true } });
  assertEquals(
    (await handleTwilioAccountBalance(
      request(jwt({ is_super_admin: false })),
      claimFalse.deps,
    )).status,
    403,
  );

  const profileFalse = deps({ profile: { is_super_admin: false } });
  assertEquals(
    (await handleTwilioAccountBalance(
      request(jwt({ is_super_admin: true })),
      profileFalse.deps,
    )).status,
    403,
  );
});

Deno.test("Super Admin lookup uses the real authenticated user id with maybeSingle", async () => {
  const { deps: d, clients: c } = deps({ user: { id: "real-super-admin" } }, {
    fetcher: () => Promise.resolve(
      new Response(JSON.stringify({ balance: "12.34", currency: "USD", account_sid: MASTER_SID }), {
        status: 200,
      }),
    ),
  });
  const response = await handleTwilioAccountBalance(
    request(jwt({ is_super_admin: true })),
    d,
  );
  assertEquals(response.status, 200);
  assertEquals(c.profileCalls, [{
    table: "profiles",
    columns: "is_super_admin",
    column: "id",
    value: "real-super-admin",
  }]);
});

Deno.test("Super Admin request targets only the exact master Balance resource and uses Basic Auth server-side", async () => {
  let seenUrl = "";
  let seenAuthorization = "";
  const { deps: d } = deps({}, {
    fetcher: (input, init) => {
      seenUrl = String(input);
      seenAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Promise.resolve(
        new Response(JSON.stringify({
          balance: "123.45",
          currency: "USD",
          account_sid: MASTER_SID,
          extra: "provider-only",
        }), { status: 200 }),
      );
    },
  });

  const response = await handleTwilioAccountBalance(
    request(jwt({ is_super_admin: true })),
    d,
  );
  assertEquals(response.status, 200);
  assertEquals(
    seenUrl,
    `https://api.twilio.com/2010-04-01/Accounts/${MASTER_SID}/Balance.json`,
  );
  assertEquals(
    seenAuthorization,
    `Basic ${btoa(`${MASTER_SID}:${MASTER_TOKEN}`)}`,
  );

  const result = await body(response);
  assertEquals(result, {
    balance: "123.45",
    currency: "USD",
    updated_at: "2026-10-06T20:00:00.000Z",
  });
  assertEquals("account_sid" in result, false);
  assertEquals("extra" in result, false);
});

Deno.test("real zero balances remain valid instead of becoming unavailable", async () => {
  for (const value of ["0", "0.00", 0]) {
    const { deps: d } = deps({}, {
      fetcher: () => Promise.resolve(
        new Response(JSON.stringify({ balance: value, currency: "USD" }), { status: 200 }),
      ),
    });
    const response = await handleTwilioAccountBalance(
      request(jwt({ is_super_admin: true })),
      d,
    );
    assertEquals(response.status, 200, String(value));
    const result = await body(response);
    assert(Number(result.balance) === 0);
  }
});

Deno.test("missing exact master credentials fails safely and never calls Twilio", async () => {
  for (const override of [
    { masterAccountSid: "" },
    { masterAuthToken: "" },
  ]) {
    let called = false;
    const { deps: d } = deps({}, {
      ...override,
      fetcher: () => {
        called = true;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });
    const response = await handleTwilioAccountBalance(
      request(jwt({ is_super_admin: true })),
      d,
    );
    assertEquals(response.status, 503);
    assertEquals(called, false);
    assertEquals(await body(response), { error: "Balance unavailable" });
  }
});

Deno.test("provider HTTP failures are sanitized and do not expose provider messages or credentials", async () => {
  const logs: string[] = [];
  const { deps: d } = deps({}, {
    fetcher: () => Promise.resolve(
      new Response(JSON.stringify({
        code: 20003,
        message: `Authenticate failed for ${MASTER_SID} using ${MASTER_TOKEN}`,
        account_sid: MASTER_SID,
      }), { status: 401 }),
    ),
    logger: {
      error: (...args: unknown[]) => logs.push(args.join(" ")),
      warn: (...args: unknown[]) => logs.push(args.join(" ")),
    },
  });

  const response = await handleTwilioAccountBalance(
    request(jwt({ is_super_admin: true })),
    d,
  );
  assertEquals(response.status, 502);
  assertEquals(await body(response), { error: "Balance unavailable" });
  assert(logs.length > 0);
  for (const line of logs) {
    assertEquals(line.includes(MASTER_SID), false);
    assertEquals(line.includes(MASTER_TOKEN), false);
    assertEquals(line.includes("Authenticate failed"), false);
  }
  assertStringIncludes(logs.join("\n"), "status=401");
  assertStringIncludes(logs.join("\n"), "code=20003");
});

Deno.test("malformed JSON, invalid balances, and network errors fail without fabricating zero", async () => {
  const cases: Array<() => Promise<Response>> = [
    () => {
      const { deps: d } = deps({}, {
        fetcher: () => Promise.resolve(new Response("{", { status: 200 })),
      });
      return handleTwilioAccountBalance(request(jwt({ is_super_admin: true })), d);
    },
    () => {
      const { deps: d } = deps({}, {
        fetcher: () => Promise.resolve(
          new Response(JSON.stringify({ balance: "not-a-number", currency: "USD" }), { status: 200 }),
        ),
      });
      return handleTwilioAccountBalance(request(jwt({ is_super_admin: true })), d);
    },
    () => {
      const { deps: d } = deps({}, {
        fetcher: () => Promise.reject(new Error(`network ${MASTER_TOKEN}`)),
      });
      return handleTwilioAccountBalance(request(jwt({ is_super_admin: true })), d);
    },
  ];

  for (const run of cases) {
    const response = await run();
    assertEquals(response.status, 502);
    assertEquals(await body(response), { error: "Balance unavailable" });
  }
});

Deno.test("currency must be a three-letter code and balance must be finite", () => {
  assertEquals(normalizeTwilioBalance({ balance: "1.00", currency: "USD" }), {
    balance: "1.00",
    currency: "USD",
  });
  assertEquals(normalizeTwilioBalance({ balance: "-4.20", currency: "usd" }), {
    balance: "-4.20",
    currency: "USD",
  });
  assertEquals(normalizeTwilioBalance({ balance: "NaN", currency: "USD" }), null);
  assertEquals(normalizeTwilioBalance({ balance: "1.00", currency: "US" }), null);
  assertEquals(normalizeTwilioBalance({ balance: "", currency: "USD" }), null);
});

Deno.test("non-GET methods are refused and OPTIONS stays side-effect free", async () => {
  const { deps: d } = deps();
  assertEquals((await handleTwilioAccountBalance(request(jwt({ is_super_admin: true }), "POST"), d)).status, 405);
  assertEquals((await handleTwilioAccountBalance(request(undefined, "OPTIONS"), d)).status, 200);
});
