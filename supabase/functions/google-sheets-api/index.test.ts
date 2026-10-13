// google-sheets-api request gating that needs no network: the backend flag is read per request and, while it
// is unset, every action except status/disconnect is refused before authentication or any database call.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handle } from "./index.ts";

const post = (body: unknown) => new Request("https://fn.test/google-sheets-api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

Deno.test("api: flag unset → 503 disabled for import actions, before authentication", async () => {
  Deno.env.delete("GOOGLE_SHEETS_ENABLED");
  for (const action of ["picker_token", "sync_now", "activate", "review_apply", "identity_review_apply", "save", "preview"]) {
    const res = await handle(post({ action }));
    assertEquals(res.status, 503, action);
    assertEquals((await res.json()).error, "disabled");
    assertEquals(res.headers.get("Cache-Control"), "no-store");
  }
});

Deno.test("api: method, preflight and malformed bodies", async () => {
  Deno.env.set("GOOGLE_SHEETS_ENABLED", "true");
  assertEquals((await handle(new Request("https://fn.test/x", { method: "GET" }))).status, 405);
  assertEquals((await handle(new Request("https://fn.test/x", { method: "OPTIONS" }))).status, 204);
  assertEquals((await handle(post("{not json"))).status, 400);
  Deno.env.delete("GOOGLE_SHEETS_ENABLED");
});
