// Handler gate tests for platform-admin-notify. Offline: every case returns
// before any Resend call; no case reaches a real Supabase client (SUPABASE_URL unset).
// Run: deno test --allow-env --allow-read supabase/functions/platform-admin-notify/index.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handle } from "./index.ts";

const TOKEN = "t".repeat(48);

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  });
}

function post(auth?: string, body = "{}"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers.Authorization = auth;
  return new Request("https://example.test/functions/v1/platform-admin-notify", { method: "POST", headers, body });
}

Deno.test("non-POST is rejected", async () => {
  const res = await handle(new Request("https://example.test/", { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("missing, wrong or unconfigured token is 403", async () => {
  await withEnv({ PLATFORM_ADMIN_NOTIFY_TOKEN: TOKEN }, async () => {
    assertEquals((await handle(post())).status, 403);
    assertEquals((await handle(post("Bearer nope"))).status, 403);
    assertEquals((await handle(post(TOKEN))).status, 403);
  });
  await withEnv({ PLATFORM_ADMIN_NOTIFY_TOKEN: undefined }, async () => {
    assertEquals((await handle(post("Bearer "))).status, 403);
    assertEquals((await handle(post("Bearer undefined"))).status, 403);
  });
  await withEnv({ PLATFORM_ADMIN_NOTIFY_TOKEN: "short" }, async () => {
    assertEquals((await handle(post("Bearer short"))).status, 403);
  });
});

Deno.test("an authorized call without RESEND_API_KEY leaves the queue untouched (503)", async () => {
  await withEnv({ PLATFORM_ADMIN_NOTIFY_TOKEN: TOKEN, RESEND_API_KEY: undefined }, async () => {
    const res = await handle(post(`Bearer ${TOKEN}`, '{"to":"attacker@example.test"}'));
    assertEquals(res.status, 503);
    assertEquals((await res.json()).error, "Email provider not configured");
  });
});

Deno.test("an invalid recipient secret fails closed with 503 before any claim, without echoing it", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    for (const value of ["", "   ", "not-an-email", "a@b.com, c@d.com", "secret-ops@example.test;x@y.test"]) {
      errors.length = 0;
      // SUPABASE_URL is unset: reaching the claim would throw and return 500, so a 503 proves the
      // handler stopped before creating a client or claiming any row.
      await withEnv({
        PLATFORM_ADMIN_NOTIFY_TOKEN: TOKEN,
        RESEND_API_KEY: "re_test_key",
        PLATFORM_ADMIN_NOTIFY_RECIPIENT: value,
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      }, async () => {
        const res = await handle(post(`Bearer ${TOKEN}`));
        assertEquals(res.status, 503, JSON.stringify(value));
        assertEquals((await res.json()).error, "Recipient configuration invalid");
      });
      assertEquals(errors.length, 1);
      assert(errors[0].includes("PLATFORM_ADMIN_NOTIFY_RECIPIENT is set but invalid"));
      assert(errors[0].includes("queue left untouched"));
      assert(!errors[0].includes("@"), "no address fragment logged");
      if (value.trim()) assert(!errors[0].includes(value.trim()), "configured value must not be logged");
    }
  } finally {
    console.error = original;
  }
});

Deno.test("an unset recipient secret proceeds past the gate (default recipient)", async () => {
  // With the recipient unset the handler continues to the claim; SUPABASE_URL is unset, so the
  // client cannot be built and the run reports 500 — proving the gate did not stop it.
  const original = console.error;
  console.error = () => {};
  try {
    await withEnv({
      PLATFORM_ADMIN_NOTIFY_TOKEN: TOKEN,
      RESEND_API_KEY: "re_test_key",
      PLATFORM_ADMIN_NOTIFY_RECIPIENT: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    }, async () => {
      const res = await handle(post(`Bearer ${TOKEN}`));
      assertEquals(res.status, 500);
    });
  } finally {
    console.error = original;
  }
});
