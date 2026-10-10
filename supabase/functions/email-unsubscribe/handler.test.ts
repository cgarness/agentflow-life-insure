// Run: deno test --allow-read --allow-env supabase/functions/email-unsubscribe/
import assert from "node:assert/strict";
import { createUnsubscribeHandler } from "./handler.ts";
import { createUnsubscribeToken } from "../_shared/onboardingEmail/unsubscribeToken.ts";

const SECRET = "e".repeat(40);
const USER = "00000000-0000-0000-0000-000000000101";
const BASE = "https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/email-unsubscribe";

function setup(env: Record<string, string | undefined> = { EMAIL_UNSUBSCRIBE_SECRET: SECRET }, exists = true) {
  const recorded: string[] = [];
  const logs: string[] = [];
  const handler = createUnsubscribeHandler({
    getEnv: (name) => env[name],
    recordOptOut: (userId) => {
      recorded.push(userId);
      return Promise.resolve(exists);
    },
    logger: { log: (l) => logs.push(l), error: (l) => logs.push(l) },
  });
  return { handler, recorded, logs };
}

Deno.test("unsubscribe: CORS preflight", async () => {
  const { handler } = setup();
  const res = await handler(new Request(BASE, { method: "OPTIONS" }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});

Deno.test("unsubscribe: GET never changes state; it redirects to the confirm page", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  const { handler, recorded } = setup();
  const res = await handler(new Request(`${BASE}?token=${encodeURIComponent(token)}`));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), `https://www.fflagent.com/email/unsubscribe?token=${encodeURIComponent(token)}`);
  const junk = await handler(new Request(`${BASE}?token=${encodeURIComponent("javascript:alert(1)")}`));
  assert.equal(junk.headers.get("Location"), "https://www.fflagent.com/email/unsubscribe", "an odd token is not reflected");
  assert.equal(recorded.length, 0, "no opt-out from a GET");
});

Deno.test("unsubscribe: RFC 8058 one-click POST (token in the query) records the opt-out once", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  const { handler, recorded } = setup();
  const res = await handler(new Request(`${BASE}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(recorded, [USER]);
});

Deno.test("unsubscribe: confirm-page POST with a JSON token", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  const { handler, recorded } = setup();
  const res = await handler(new Request(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }));
  assert.equal(res.status, 200);
  assert.deepEqual(recorded, [USER]);
});

Deno.test("unsubscribe: the answer is identical whether or not the account exists", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  const a = await setup(undefined, true).handler(new Request(`${BASE}?token=${token}`, { method: "POST" }));
  const b = await setup(undefined, false).handler(new Request(`${BASE}?token=${token}`, { method: "POST" }));
  assert.equal(a.status, b.status);
  assert.equal(await a.text(), await b.text());
});

Deno.test("unsubscribe: tampered, missing and oversized tokens are 400 and record nothing", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  const otherSecretToken = await createUnsubscribeToken("o".repeat(40), USER);
  const { handler, recorded } = setup();
  for (const req of [
    new Request(`${BASE}?token=${token.slice(0, -2)}xx`, { method: "POST" }),
    new Request(`${BASE}?token=${otherSecretToken}`, { method: "POST" }),
    new Request(BASE, { method: "POST" }),
    new Request(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" }),
    new Request(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "x".repeat(5000) }) }),
  ]) {
    const res = await handler(req);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: "invalid_link" });
  }
  assert.equal(recorded.length, 0);
});

Deno.test("unsubscribe: missing secret is 503; a store failure is 500; neither echoes identity", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  assert.equal((await setup({}).handler(new Request(`${BASE}?token=${token}`, { method: "POST" }))).status, 503);
  const failing = createUnsubscribeHandler({
    getEnv: () => SECRET,
    recordOptOut: () => Promise.reject(new Error(`rpc failed for ${USER}`)),
    logger: { log: () => {}, error: () => {} },
  });
  const res = await failing(new Request(`${BASE}?token=${token}`, { method: "POST" }));
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.ok(!body.includes(USER) && !body.includes("rpc failed"));
});

Deno.test("unsubscribe: other methods are refused", async () => {
  const { handler } = setup();
  assert.equal((await handler(new Request(BASE, { method: "DELETE" }))).status, 405);
});
