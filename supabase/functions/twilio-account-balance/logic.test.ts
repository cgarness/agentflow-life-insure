import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  createTwilioBalanceHandler,
  normalizeTwilioBalance,
  type TwilioBalanceDeps,
} from "./logic.ts";

const MASTER_SID = "ACmaster123";
const MASTER_TOKEN = "master-secret-token";
const FALLBACK_SID = "ACfallback999";
const FALLBACK_TOKEN = "fallback-secret-token";
const FIXED_NOW = new Date("2026-10-07T16:30:00.000Z");

function jwt(isSuperAdmin: boolean): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "none" })}.${encode({ is_super_admin: isSuperAdmin })}.sig`;
}

type HarnessOptions = {
  user?: { id: string } | null;
  profileSuper?: boolean | null;
  authThrows?: boolean;
  profileThrows?: boolean;
  env?: Record<string, string | undefined>;
  providerStatus?: number;
  providerBody?: unknown;
  providerRaw?: string;
  fetchThrows?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const logs: string[] = [];
  const env = {
    TWILIO_MASTER_ACCOUNT_SID: MASTER_SID,
    TWILIO_MASTER_AUTH_TOKEN: MASTER_TOKEN,
    TWILIO_ACCOUNT_SID: FALLBACK_SID,
    TWILIO_AUTH_TOKEN: FALLBACK_TOKEN,
    ...(options.env ?? {}),
  };

  const deps: TwilioBalanceDeps = {
    getEnv: (name) => env[name],
    validateUser: async () => {
      if (options.authThrows) throw new Error("auth exploded with secret " + MASTER_TOKEN);
      return options.user === undefined ? { id: "super-1" } : options.user;
    },
    getProfileSuper: async () => {
      if (options.profileThrows) throw new Error("profile exploded");
      return options.profileSuper === undefined ? true : options.profileSuper;
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (options.fetchThrows) throw new Error("network exploded " + MASTER_TOKEN);
      const body = options.providerRaw !== undefined
        ? options.providerRaw
        : JSON.stringify(options.providerBody ?? {
          balance: "123.45",
          currency: "USD",
          account_sid: MASTER_SID,
          secret: MASTER_TOKEN,
        });
      return new Response(body, {
        status: options.providerStatus ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    now: () => FIXED_NOW,
    logger: {
      warn: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    },
  };

  return { handler: createTwilioBalanceHandler(deps), calls, logs };
}

function request(token?: string, method = "POST"): Request {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("https://example.supabase.co/functions/v1/twilio-account-balance", {
    method,
    headers,
  });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

Deno.test("balance normalization accepts real zero and rejects malformed values", () => {
  assertEquals(normalizeTwilioBalance({ balance: "0", currency: "USD" }), { balance: "0", currency: "USD" });
  assertEquals(normalizeTwilioBalance({ balance: "0.00", currency: "USD" }), { balance: "0.00", currency: "USD" });
  assertEquals(normalizeTwilioBalance({ balance: 0, currency: "USD" }), { balance: "0", currency: "USD" });
  assertEquals(normalizeTwilioBalance({ balance: "not-money", currency: "USD" }), null);
  assertEquals(normalizeTwilioBalance({ balance: "1.00", currency: "" }), null);
});

Deno.test("missing Authorization returns 401 without calling Twilio", async () => {
  const h = harness();
  const res = await h.handler(request());
  assertEquals(res.status, 401);
  assertEquals(h.calls.length, 0);
});

Deno.test("invalid authenticated user returns 401", async () => {
  const h = harness({ user: null });
  const res = await h.handler(request(jwt(true)));
  assertEquals(res.status, 401);
  assertEquals(h.calls.length, 0);
});

Deno.test("JWT claim and profile flag must BOTH be true", async () => {
  const claimFalse = harness({ profileSuper: true });
  assertEquals((await claimFalse.handler(request(jwt(false)))).status, 403);
  const profileFalse = harness({ profileSuper: false });
  assertEquals((await profileFalse.handler(request(jwt(true)))).status, 403);
  const missingProfile = harness({ profileSuper: null });
  assertEquals((await missingProfile.handler(request(jwt(true)))).status, 403);
});

Deno.test("real Super Admin calls exact master Balance endpoint and strips provider fields", async () => {
  const h = harness();
  const res = await h.handler(request(jwt(true)));
  assertEquals(res.status, 200);
  assertEquals(h.calls.length, 1);
  assertEquals(h.calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${MASTER_SID}/Balance.json`);
  const headers = new Headers(h.calls[0].init?.headers);
  assertEquals(headers.get("Authorization"), `Basic ${btoa(`${MASTER_SID}:${MASTER_TOKEN}`)}`);
  assert(!h.calls[0].url.includes(FALLBACK_SID));
  assertEquals(await body(res), {
    balance: "123.45",
    currency: "USD",
    updated_at: FIXED_NOW.toISOString(),
  });
});

Deno.test("fallback Twilio credentials are never accepted for platform billing", async () => {
  const h = harness({
    env: {
      TWILIO_MASTER_ACCOUNT_SID: "",
      TWILIO_MASTER_AUTH_TOKEN: "",
      TWILIO_ACCOUNT_SID: FALLBACK_SID,
      TWILIO_AUTH_TOKEN: FALLBACK_TOKEN,
    },
  });
  const res = await h.handler(request(jwt(true)));
  assertEquals(res.status, 500);
  assertEquals(await body(res), { error: "Balance unavailable" });
  assertEquals(h.calls.length, 0);
});

Deno.test("missing either exact master credential fails closed", async () => {
  for (const env of [
    { TWILIO_MASTER_ACCOUNT_SID: "" },
    { TWILIO_MASTER_AUTH_TOKEN: "" },
  ]) {
    const h = harness({ env });
    const res = await h.handler(request(jwt(true)));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { error: "Balance unavailable" });
    assertEquals(h.calls.length, 0);
  }
});

Deno.test("Twilio zero balance is success, not unavailable", async () => {
  for (const balance of ["0", "0.00", 0]) {
    const h = harness({ providerBody: { balance, currency: "USD", account_sid: MASTER_SID } });
    const res = await h.handler(request(jwt(true)));
    assertEquals(res.status, 200);
    const result = await body(res);
    assertEquals(Number(result.balance), 0);
  }
});

Deno.test("provider HTTP failures are sanitized and never expose secrets", async () => {
  const h = harness({
    providerStatus: 401,
    providerBody: {
      code: 20003,
      message: `Authentication failed ${MASTER_TOKEN}`,
      account_sid: MASTER_SID,
    },
  });
  const res = await h.handler(request(jwt(true)));
  assertEquals(res.status, 502);
  const responseText = JSON.stringify(await body(res));
  assertEquals(responseText.includes(MASTER_TOKEN), false);
  assertEquals(responseText.includes(MASTER_SID), false);
  assertEquals(h.logs.some((line) => line.includes(MASTER_TOKEN)), false);
  assertEquals(h.logs.some((line) => line.includes(MASTER_SID)), false);
  assert(h.logs.some((line) => line.includes("status=401")));
  assert(h.logs.some((line) => line.includes("code=20003")));
});

Deno.test("malformed JSON, invalid balance, and network errors fail safely", async () => {
  const malformed = harness({ providerRaw: "{not-json" });
  assertEquals((await malformed.handler(request(jwt(true)))).status, 502);

  const invalid = harness({ providerBody: { balance: "NaN", currency: "USD" } });
  assertEquals((await invalid.handler(request(jwt(true)))).status, 502);

  const network = harness({ fetchThrows: true });
  const res = await network.handler(request(jwt(true)));
  assertEquals(res.status, 502);
  assertEquals(JSON.stringify(await body(res)).includes(MASTER_TOKEN), false);
  assertEquals(network.logs.some((line) => line.includes(MASTER_TOKEN)), false);
});

Deno.test("auth/profile infrastructure failures are generic and never call Twilio", async () => {
  const auth = harness({ authThrows: true });
  const authRes = await auth.handler(request(jwt(true)));
  assertEquals(authRes.status, 500);
  assertEquals(auth.calls.length, 0);
  assertEquals(JSON.stringify(await body(authRes)).includes(MASTER_TOKEN), false);

  const profile = harness({ profileThrows: true });
  const profileRes = await profile.handler(request(jwt(true)));
  assertEquals(profileRes.status, 500);
  assertEquals(profile.calls.length, 0);
});

Deno.test("OPTIONS is allowed and other HTTP methods are rejected", async () => {
  const h = harness();
  assertEquals((await h.handler(request(undefined, "OPTIONS"))).status, 200);
  assertEquals((await h.handler(request(jwt(true), "GET"))).status, 405);
  assertEquals(h.calls.length, 0);
});
