import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { sha256Hex } from "../crypto.ts";
import { GoogleApiError } from "../errors.ts";
import { keyId, mintChannel, stopChannel, verifyChannelId, watchErrorCode, watchFile } from "./channel.ts";

const KEY = "k".repeat(40), OTHER = "z".repeat(40);

Deno.test("channel: minted ids carry a verifiable HMAC tag; tokens are random and only their digest is kept", async () => {
  const a = await mintChannel(KEY), b = await mintChannel(KEY);
  assertEquals(a.channelId.length, 43); // Google: ≤ 64
  assertEquals(a.token.length, 43);     // Google: ≤ 256
  assert(/^gs1[A-Za-z0-9_-]{40}$/.test(a.channelId));
  assert(a.channelId !== b.channelId && a.token !== b.token);
  assertEquals(a.tokenDigest, await sha256Hex(a.token));
  assertEquals(a.keyId, await keyId(KEY));
  assert(/^[0-9a-f]{8}$/.test(a.keyId));
  assert(await verifyChannelId(KEY, a.channelId));
});

Deno.test("channel: forged, re-tagged, other-key and malformed ids are rejected", async () => {
  const a = await mintChannel(KEY);
  const flipped = a.channelId.slice(0, 42) + (a.channelId[42] === "A" ? "B" : "A");
  const swapped = "gs1" + "Q".repeat(24) + a.channelId.slice(27);
  assertEquals(await verifyChannelId(KEY, flipped), false);
  assertEquals(await verifyChannelId(KEY, swapped), false);
  assertEquals(await verifyChannelId(OTHER, a.channelId), false);
  assertEquals(await verifyChannelId(KEY, "gs1" + "A".repeat(40)), false);
  assertEquals(await verifyChannelId(KEY, a.channelId + "x"), false);
  assertEquals(await verifyChannelId("short", a.channelId), false);
  await assertRejects(() => mintChannel("short"));
});

function recorder(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fn };
}

Deno.test("watchFile: posts a web_hook channel to files/{id}/watch and returns Google's resource id and expiration", async () => {
  const exp = Date.now() + 86_000_000;
  const g = recorder(200, { kind: "api#channel", id: "gs1" + "A".repeat(40), resourceId: "RES_1", expiration: String(exp) });
  const out = await watchFile(g.fn, "ya29.x", "SPREADSHEET_1234", { id: "gs1" + "A".repeat(40), token: "t".repeat(43),
    address: "https://p.supabase.co/functions/v1/google-sheets-push", expirationMs: exp });
  assertEquals(out.resourceId, "RES_1");
  assertEquals(out.expiration.getTime(), exp);
  assertEquals(g.calls[0].url, "https://www.googleapis.com/drive/v3/files/SPREADSHEET_1234/watch?supportsAllDrives=true");
  const body = JSON.parse(String(g.calls[0].init.body));
  assertEquals(body, { id: "gs1" + "A".repeat(40), type: "web_hook", address: "https://p.supabase.co/functions/v1/google-sheets-push",
    token: "t".repeat(43), expiration: String(exp) });
  assertEquals((g.calls[0].init.headers as Record<string, string>).Authorization, "Bearer ya29.x");
});

Deno.test("watchFile: an unexpected response or a Google error is never treated as a live channel", async () => {
  const ch = { id: "gs1" + "A".repeat(40), token: "t".repeat(43), address: "https://x", expirationMs: Date.now() + 1000 };
  await assertRejects(() => watchFile(recorder(200, { id: "other", resourceId: "R" }).fn, "t", "SPREADSHEET_1234", ch), GoogleApiError);
  await assertRejects(() => watchFile(recorder(200, { id: ch.id }).fn, "t", "SPREADSHEET_1234", ch), GoogleApiError);
  await assertRejects(() => watchFile(recorder(200, {}).fn, "t", "bad id!", ch), GoogleApiError);
  const e = await assertRejects(() => watchFile(recorder(400, { error: { errors: [{ reason: "push.webhookUrlUnauthorized" }] } }).fn,
    "t", "SPREADSHEET_1234", ch), GoogleApiError);
  assertEquals(watchErrorCode(e), "address_rejected");
  const q = await assertRejects(() => watchFile(recorder(429, {}).fn, "t", "SPREADSHEET_1234", ch), GoogleApiError);
  assertEquals(watchErrorCode(q), "rate_limited");
  const n = await assertRejects(() => watchFile(recorder(404, {}).fn, "t", "SPREADSHEET_1234", ch), GoogleApiError);
  assertEquals(watchErrorCode(n), "access_lost");
  assertEquals(watchErrorCode(new Error("x")), "watch_failed");
});

Deno.test("stopChannel: 204 stopped, 404 already gone, other errors thrown", async () => {
  const ok = recorder(204, null);
  assertEquals(await stopChannel(ok.fn, "t", { id: "gs1x", resourceId: "R" }), "stopped");
  assertEquals(ok.calls[0].url, "https://www.googleapis.com/drive/v3/channels/stop");
  assertEquals(JSON.parse(String(ok.calls[0].init.body)), { id: "gs1x", resourceId: "R" });
  assertEquals(await stopChannel(recorder(404, {}).fn, "t", { id: "a", resourceId: "R" }), "gone");
  await assertRejects(() => stopChannel(recorder(503, {}).fn, "t", { id: "a", resourceId: "R" }), GoogleApiError);
});
