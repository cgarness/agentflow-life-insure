import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { SheetsDb } from "../db.ts";
import type { PushDb, StopItem } from "./db.ts";
import { ensureWatch, releaseWatches, runMaintenance, type WatchDeps } from "./watches.ts";

const CFG = { enabled: true, clientId: "cid", clientSecret: "s", redirectUri: "https://x", allowedOrigins: [], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const PCFG = { enabled: true, key: "p".repeat(40), maintenanceToken: "m".repeat(40), address: "https://p.supabase.co/functions/v1/google-sheets-push" };

function google(watch: [number, unknown] = [200, null], stop: [number, unknown] = [204, null], refresh: [number, unknown] = [200, { access_token: "ya29.t", expires_in: 3600 }]) {
  const calls: { url: string; body: any }[] = [];
  const fn = ((url: string, init?: RequestInit) => {
    let body: any = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = String(init?.body); } // OAuth posts a form
    calls.push({ url, body });
    const r = (s: number, b: unknown) => Promise.resolve(new Response(b === null ? null : JSON.stringify(b), { status: s }));
    if (url.includes("oauth2.googleapis.com/token")) return r(...refresh);
    if (url.includes("/watch")) return watch[1] === null ? r(watch[0], { id: body.id, resourceId: "RES_NEW", expiration: String(Date.now() + 86_000_000) }) : r(...watch);
    if (url.includes("/channels/stop")) return r(...stop);
    return r(404, {});
  }) as typeof fetch;
  return { fn, calls };
}

function fakes(opts: { begin?: string; activated?: { status: string; stop: StopItem[]; kicked: boolean }; release?: StopItem[];
  items?: unknown[]; mode?: string } = {}) {
  const log: string[] = [];
  const results: [string, string, string | null][] = [];
  const reconnect: unknown[] = [];
  const db = {
    refreshToken: async () => ({ refresh_token: "rt", auth_generation: 7 }),
    markReconnect: async (...a: unknown[]) => { reconnect.push(a); return true; },
  } as unknown as SheetsDb;
  const push = {
    watchBegin: async (conn: string, gen: number, sp: string, channelId: string, digest: string, keyId: string, reason: string) => {
      log.push(`begin ${conn} ${gen} ${sp} ${reason} ${channelId.length} ${digest.length} ${keyId.length}`);
      return { outcome: opts.begin ?? "register", channel_row_id: "row1", target_id: "t1" };
    },
    watchResult: async (row: string, action: string, _r: string | null, _e: Date | null, code: string | null) => {
      results.push([row, action, code]);
      return action === "activated" ? (opts.activated ?? { status: "activated", stop: [], kicked: true, target_id: "t1" }) : { status: action, stop: [], kicked: false };
    },
    watchRelease: async () => ({ stop: opts.release ?? [] }),
    maintenanceClaim: async () => ({ mode: opts.mode ?? "pilot", items: opts.items ?? [] }),
    claim: async () => null,
  } as unknown as PushDb;
  return { db, push, log, results, reconnect };
}
const deps = (f: ReturnType<typeof fakes>, fetchFn: typeof fetch, pcfg = PCFG): WatchDeps => ({ db: f.db, push: f.push, cfg: CFG, pcfg, fetchFn });

Deno.test("ensureWatch: begin → files.watch with the minted channel → activated → old channels stopped", async () => {
  const f = fakes({ activated: { status: "activated", kicked: false, stop: [{ row: "old", channel_id: "gs1OLD", resource_id: "RES_OLD" }] } });
  const g = google();
  const r = await ensureWatch(deps(f, g.fn), { connectionId: "c1", generation: 7, spreadsheetId: "SPREADSHEET_123", reason: "renew" });
  assertEquals(r.outcome, "activated");
  assertEquals(f.log[0], "begin c1 7 SPREADSHEET_123 renew 43 64 8");
  const watch = g.calls.find((c) => c.url.includes("/watch"))!;
  assertEquals(watch.body.type, "web_hook");
  assertEquals(watch.body.address, PCFG.address);
  assertEquals(watch.body.token.length, 43);
  assertEquals(g.calls.find((c) => c.url.includes("/channels/stop"))!.body, { id: "gs1OLD", resourceId: "RES_OLD" });
  assertEquals(f.results.map((x) => x[1]), ["activated", "stopped"]);
});

Deno.test("ensureWatch: an existing live channel → no Google call; kill switch off → nothing at all", async () => {
  const f = fakes({ begin: "exists" });
  const g = google();
  assertEquals((await ensureWatch(deps(f, g.fn), { connectionId: "c1", generation: 7, spreadsheetId: "SPREADSHEET_123", reason: "activate" })).outcome, "exists");
  assertEquals(g.calls.length, 0);
  const off = fakes();
  const r = await ensureWatch(deps(off, g.fn, { ...PCFG, enabled: false }), { connectionId: "c1", generation: 7, spreadsheetId: "SPREADSHEET_123", reason: "activate" });
  assertEquals(r.outcome, "disabled");
  assertEquals(off.log.length, 0);
});

Deno.test("ensureWatch: Google refusal is recorded as failed with a short code; invalid_grant marks reconnect", async () => {
  const f = fakes();
  const r = await ensureWatch(deps(f, google([400, { error: { errors: [{ reason: "push.webhookUrlUnauthorized" }] } }]).fn),
    { connectionId: "c1", generation: 7, spreadsheetId: "SPREADSHEET_123", reason: "activate" });
  assertEquals([r.outcome, r.code], ["failed", "address_rejected"]);
  assertEquals(f.results, [["row1", "failed", "address_rejected"]]);
  const f2 = fakes();
  const r2 = await ensureWatch(deps(f2, google(undefined, undefined, [400, { error: "invalid_grant" }]).fn),
    { connectionId: "c1", generation: 7, spreadsheetId: "SPREADSHEET_123", reason: "activate" });
  assertEquals(r2.code, "reconnect_required");
  assertEquals(f2.reconnect.length, 1);
  assertEquals(f2.results[0][1], "failed");
});

Deno.test("releaseWatches: stops the returned channels; a failed stop is recorded for retry", async () => {
  const f = fakes({ release: [{ row: "r1", channel_id: "gs1A", resource_id: "RES_A" }, { row: "r2", channel_id: "gs1B", resource_id: null }] });
  assertEquals(await releaseWatches(deps(f, google().fn), "u1", "o1", "SPREADSHEET_123", false, "c1"), 1);
  assertEquals(f.results.map((x) => x[1]), ["stopped", "abandoned"]);
  const f2 = fakes({ release: [{ row: "r1", channel_id: "gs1A", resource_id: "RES_A" }] });
  await releaseWatches(deps(f2, google(undefined, [503, {}]).fn), "u1", "o1", null, true, "c1");
  assertEquals(f2.results, [["r1", "stop_failed", "google_unavailable"]]);
});

Deno.test("runMaintenance: stops, registers, then processes; with the kill switch off only stops run", async () => {
  const items = [
    { kind: "stop", row: "s1", channel_id: "gs1S", resource_id: "RES_S", connection_id: "c1" },
    { kind: "register", target_id: "t1", connection_id: "c1", generation: 7, spreadsheet_id: "SPREADSHEET_123", reason: "renew" },
  ];
  const f = fakes({ items });
  const g = google();
  const s = await runMaintenance(deps(f, g.fn), 60_000);
  assertEquals([s.stopped, s.registered], [1, 1]);
  assert(s.processed !== null);
  const off = fakes({ items });
  const g2 = google();
  const s2 = await runMaintenance(deps(off, g2.fn, { ...PCFG, enabled: false }), 60_000);
  assertEquals([s2.stopped, s2.registered, s2.processed], [1, 0, null]);
  assertEquals(g2.calls.some((c) => c.url.includes("/watch")), false);
});
