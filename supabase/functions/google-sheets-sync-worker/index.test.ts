// Run: deno test --allow-env supabase/functions/google-sheets-sync-worker/index.test.ts
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handle, isAuthorized } from "./index.ts";
import type { SheetsDb } from "../_shared/googleSheets/db.ts";

const TOKEN = "w".repeat(48);
const req = (auth?: string) => new Request("https://x/functions/v1/google-sheets-sync-worker", {
  method: "POST", headers: auth ? { Authorization: auth } : {}, body: "{}" });
const emptyDb = { claim: async () => [] } as unknown as SheetsDb;

Deno.test("worker: constant-time bearer gate; short tokens never authorize", () => {
  assertEquals(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
  assertEquals(isAuthorized(`Bearer ${TOKEN}x`, TOKEN), false);
  assertEquals(isAuthorized("Bearer short", "short"), false);
  assertEquals(isAuthorized(null, TOKEN), false);
});

Deno.test("worker: unauthorized 403; disabled inert; no due sources → ok", async () => {
  Deno.env.set("GOOGLE_SHEETS_WORKER_TOKEN", TOKEN);
  Deno.env.delete("GOOGLE_SHEETS_ENABLED");
  assertEquals((await handle(req("Bearer nope"), emptyDb)).status, 403);
  const off = await handle(req(`Bearer ${TOKEN}`), emptyDb);
  assertEquals((await off.json()).disabled, true);
  Deno.env.set("GOOGLE_SHEETS_ENABLED", "true");
  const on = await handle(req(`Bearer ${TOKEN}`), emptyDb);
  assertEquals((await on.json()).processed, 0);
  assertEquals((await handle(new Request("https://x", { method: "GET" }), emptyDb)).status, 405);
});
