// Handler gate tests for platform-admin-notify. Offline: every case returns
// before any Supabase client or Resend call is made.
// Run: deno test --allow-env --allow-read supabase/functions/platform-admin-notify/index.test.ts

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
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
