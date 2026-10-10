// Run: deno test --allow-read --allow-env supabase/functions/_shared/onboardingEmail/
import assert from "node:assert/strict";
import { createUnsubscribeToken, UNSUBSCRIBE_TOKEN_SHAPE, verifyUnsubscribeToken } from "./unsubscribeToken.ts";

const SECRET = "s".repeat(40);
const OTHER_SECRET = "t".repeat(40);
const USER = "00000000-0000-0000-0000-000000000101";

Deno.test("token: round trip, deterministic, URL-safe, carries no email or name", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  assert.equal(token, await createUnsubscribeToken(SECRET, USER), "deterministic per user");
  assert.match(token, UNSUBSCRIBE_TOKEN_SHAPE);
  assert.equal(encodeURIComponent(token), token);
  assert.ok(!token.includes("@"));
  assert.deepEqual(await verifyUnsubscribeToken(SECRET, token), { ok: true, userId: USER, category: "onboarding" });
});

Deno.test("token: a different user gets a different token", async () => {
  assert.notEqual(await createUnsubscribeToken(SECRET, USER), await createUnsubscribeToken(SECRET, "00000000-0000-0000-0000-000000000102"));
});

Deno.test("token: tampering, a wrong secret and malformed input are refused", async () => {
  const token = await createUnsubscribeToken(SECRET, USER);
  const [v, payload, sig] = token.split(".");
  const forgedPayload = btoa(JSON.stringify({ u: "00000000-0000-0000-0000-000000000999", c: "onboarding" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.deepEqual(await verifyUnsubscribeToken(SECRET, `${v}.${forgedPayload}.${sig}`), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await verifyUnsubscribeToken(SECRET, `${v}.${payload}.${flipped}`), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await verifyUnsubscribeToken(OTHER_SECRET, token), { ok: false, reason: "bad_signature" });
  for (const bad of [undefined, null, 42, "", "v1", "v1..", `v2.${payload}.${sig}`, `${token}.extra`, "v1.a b.c", "x".repeat(600)]) {
    const result = await verifyUnsubscribeToken(SECRET, bad);
    assert.equal(result.ok, false, String(bad));
  }
});

Deno.test("token: a validly signed payload with the wrong category or id is refused", async () => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sign = async (body: unknown) => {
    const p = btoa(JSON.stringify(body)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const s = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1.${p}`)));
    return `v1.${p}.${btoa(String.fromCharCode(...s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  };
  assert.deepEqual(await verifyUnsubscribeToken(SECRET, await sign({ u: USER, c: "security" })), { ok: false, reason: "malformed" });
  assert.deepEqual(await verifyUnsubscribeToken(SECRET, await sign({ u: "not-a-uuid", c: "onboarding" })), { ok: false, reason: "malformed" });
});

Deno.test("token: a short secret or a non-UUID user id is a programming error", async () => {
  await assert.rejects(() => createUnsubscribeToken("short", USER));
  await assert.rejects(() => verifyUnsubscribeToken("short", "v1.a.b"));
  await assert.rejects(() => createUnsubscribeToken(SECRET, "jordan@example.test"));
});
