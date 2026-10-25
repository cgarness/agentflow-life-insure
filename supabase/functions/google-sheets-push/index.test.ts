import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { sha256Hex } from "../_shared/googleSheets/crypto.ts";
import { mintChannel } from "../_shared/googleSheets/push/channel.ts";
import type { AcceptOutcome, PushDb } from "../_shared/googleSheets/push/db.ts";
import type { Notice } from "../_shared/googleSheets/push/headers.ts";
import { handle, type ReceiverDeps } from "./index.ts";

const KEY = "p".repeat(40);
const CFG = { enabled: true, clientId: "cid", clientSecret: "s", redirectUri: "https://x", allowedOrigins: [], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const PCFG = { enabled: true, key: KEY, maintenanceToken: "m".repeat(40), address: "https://p.supabase.co/functions/v1/google-sheets-push" };

function receiver(outcome: AcceptOutcome | "throw", process = true, pcfg = PCFG) {
  const accepted: { n: Notice; digest: string }[] = [];
  const background: string[] = [];
  const d: ReceiverDeps = {
    pcfg, cfg: CFG,
    push: { accept: async (n: Notice, digest: string) => {
      accepted.push({ n, digest });
      if (outcome === "throw") throw new Error("connection refused");
      return { outcome, target_id: "t1", process };
    } } as unknown as PushDb,
    process: async (t) => t,
    background: (_p, label) => { background.push(label); },
  };
  return { d, accepted, background };
}
async function notice(over: Record<string, string | null> = {}) {
  const ch = await mintChannel(KEY);
  const h: Record<string, string> = {
    "X-Goog-Channel-ID": ch.channelId, "X-Goog-Channel-Token": ch.token, "X-Goog-Resource-ID": "RES_1",
    "X-Goog-Resource-State": "update", "X-Goog-Message-Number": "12", "X-Goog-Changed": "content",
    "User-Agent": "APIs-Google; (+https://developers.google.com/webmasters/APIs-Google.html)",
  };
  for (const [k, v] of Object.entries(over)) { if (v === null) delete h[k]; else h[k] = v; }
  return { req: new Request("https://p.supabase.co/functions/v1/google-sheets-push", { method: "POST", headers: h }), ch };
}

Deno.test("receiver: a queued notification is acknowledged 200 only after accept, then processed in the background", async () => {
  const r = receiver("queued");
  const { req, ch } = await notice();
  const res = await handle(req, r.d);
  assertEquals(res.status, 200);
  assertEquals(r.accepted.length, 1);
  assertEquals(r.accepted[0].digest, await sha256Hex(ch.token)); // only the digest leaves the function
  assertEquals(r.accepted[0].n.channelId, ch.channelId);
  assertEquals(r.background, ["google-sheets-push"]);
});

Deno.test("receiver: a database failure answers 503 so Google retries; nothing is processed", async () => {
  const r = receiver("throw");
  const res = await handle((await notice()).req, r.d);
  assertEquals(res.status, 503);
  assertEquals(r.background.length, 0);
});

Deno.test("receiver: outcome → status (sync / duplicate / stale are 200 without work; rejects are 4xx)", async () => {
  const cases: [AcceptOutcome, number][] = [["sync", 200], ["duplicate", 200], ["ignored_inactive", 200], ["ignored_stale", 200],
    ["unknown_channel", 404], ["rejected_token", 401], ["rejected_resource", 401], ["invalid", 400]];
  for (const [o, status] of cases) {
    const r = receiver(o);
    assertEquals((await handle((await notice()).req, r.d)).status, status, o);
    assertEquals(r.background.length, 0, o);
  }
});

Deno.test("receiver: forged / random channel ids and malformed headers never reach the database", async () => {
  const forged = receiver("queued");
  assertEquals((await handle((await notice({ "X-Goog-Channel-ID": "gs1" + "A".repeat(40) })).req, forged.d)).status, 404);
  const malformed = receiver("queued");
  assertEquals((await handle((await notice({ "X-Goog-Channel-Token": null })).req, malformed.d)).status, 400);
  assertEquals((await handle((await notice({ "X-Goog-Resource-ID": "bad id" })).req, malformed.d)).status, 400);
  const other = receiver("queued", true, { ...PCFG, key: "q".repeat(40) }); // a channel minted under another key
  assertEquals((await handle((await notice()).req, other.d)).status, 404);
  assertEquals(forged.accepted.length + malformed.accepted.length + other.accepted.length, 0);
  assertEquals((await handle(new Request("https://p/x", { method: "GET" }), receiver("queued").d)).status, 405);
  assertEquals((await handle((await notice()).req, receiver("queued", true, { ...PCFG, key: "short" }).d)).status, 503);
});

Deno.test("receiver: with the kill switch off the notification is still durably accepted, but not processed", async () => {
  const r = receiver("queued", true, { ...PCFG, enabled: false });
  assertEquals((await handle((await notice()).req, r.d)).status, 200);
  assertEquals(r.accepted.length, 1);
  assertEquals(r.background.length, 0);
});

Deno.test("receiver: logs carry outcome codes and ids only — never the token or the resource id", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    const { req, ch } = await notice();
    await handle(req, receiver("queued").d);
    await handle((await notice({ "X-Goog-Channel-ID": "gs1" + "B".repeat(40) })).req, receiver("queued").d);
    const all = lines.join("\n");
    assert(!all.includes(ch.token) && !all.includes("RES_1") && !all.includes(ch.channelId), all);
    assert(all.includes("outcome=queued") && all.includes("outcome=unknown_channel"), all);
  } finally {
    console.log = orig;
  }
});
