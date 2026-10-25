import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { afterRelease, afterSourceChange, beforeDisconnect, realtimeStatus, type HookCtx } from "./push.ts";

const CFG = { enabled: true, clientId: "cid", clientSecret: "s", redirectUri: "https://x", allowedOrigins: [], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const PCFG = { enabled: true, key: "p".repeat(40), maintenanceToken: "m".repeat(40), address: "https://p.supabase.co/functions/v1/google-sheets-push" };

/** Minimal service client: two table reads and recorded RPCs with canned answers. */
function svc(rpcAnswers: Record<string, unknown> = {}, opts: { rpcError?: boolean } = {}) {
  const rpcs: [string, Record<string, unknown>][] = [];
  const rows: Record<string, unknown> = {
    google_sheets_connections: { id: "c1", status: "connected", auth_generation: 7 },
    google_sheets_sources: { spreadsheet_id: "SPREADSHEET_123" },
  };
  const client = {
    from(table: string) {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push([fn, args]);
      if (opts.rpcError) return { data: null, error: { message: "boom" } };
      return { data: rpcAnswers[fn] ?? null, error: null };
    },
  };
  return { client, rpcs };
}
function google() {
  return ((url: string, init?: RequestInit) => {
    const r = (s: number, b: unknown) => Promise.resolve(new Response(b === null ? null : JSON.stringify(b), { status: s }));
    if (url.includes("oauth2.googleapis.com/token")) return r(200, { access_token: "ya29.t", expires_in: 3600 });
    if (url.includes("/watch")) return r(200, { id: JSON.parse(String(init?.body)).id, resourceId: "RES", expiration: String(Date.now() + 8.6e7) });
    if (url.includes("/channels/stop")) return r(204, null);
    return r(404, {});
  }) as typeof fetch;
}
/** RPCs the hook itself made (the background processing it starts claims on its own). */
const hookCalls = (s: ReturnType<typeof svc>) => s.rpcs.map((r) => r[0]).filter((n) => n !== "google_sheets_push_claim");
const ctx = (s: ReturnType<typeof svc>, pcfg = PCFG, bg: string[] = []): HookCtx => ({
  svc: s.client as never, cfg: CFG, fetchFn: google(), userId: "u1", orgId: "o1",
  push: { pcfg, background: (_p, label) => { bg.push(label); } },
});

Deno.test("afterSourceChange: registers the spreadsheet watch, then processes in the background (no extra kick after a fresh registration)", async () => {
  const s = svc({
    google_sheets_get_refresh_token: [{ refresh_token: "rt", auth_generation: 7 }],
    google_sheets_watch_begin: [{ outcome: "register", channel_row_id: "row1", target_id: "t1" }],
    google_sheets_watch_result: { status: "activated", stop: [], kicked: true, target_id: "t1" },
  });
  const bg: string[] = [];
  await afterSourceChange(ctx(s, PCFG, bg), "s1", "activate");
  assertEquals(hookCalls(s), ["google_sheets_watch_begin", "google_sheets_get_refresh_token", "google_sheets_watch_result"]);
  assertEquals(s.rpcs[0][1].p_reason, "activate");
  assertEquals(bg, ["google-sheets-api(push)"]);
  assertEquals(s.rpcs.find((r) => r[0] === "google_sheets_push_claim")?.[1].p_target, "t1"); // the background run's own target
});

Deno.test("afterSourceChange: an existing watch → one catch-up kick for this source, then background processing", async () => {
  const s = svc({ google_sheets_watch_begin: [{ outcome: "exists", channel_row_id: null, target_id: "t1" }], google_sheets_push_kick: "t1" });
  const bg: string[] = [];
  await afterSourceChange(ctx(s, PCFG, bg), "s1", "save");
  assertEquals(hookCalls(s), ["google_sheets_watch_begin", "google_sheets_push_kick"]);
  assertEquals(s.rpcs[1][1], { p_user: "u1", p_org: "o1", p_source: "s1", p_reason: "save" });
  assertEquals(bg.length, 1);
});

Deno.test("afterSourceChange: kill switch off → no database call, no Google call, no background work", async () => {
  const s = svc();
  const bg: string[] = [];
  await afterSourceChange(ctx(s, { ...PCFG, enabled: false }, bg), "s1", "resume");
  assertEquals(s.rpcs.length, 0);
  assertEquals(bg.length, 0);
});

Deno.test("hooks never throw: database errors are logged and the action result is untouched", async () => {
  const s = svc({}, { rpcError: true });
  await afterSourceChange(ctx(s), "s1", "review");
  await afterRelease(ctx(s), "SPREADSHEET_123");
  await beforeDisconnect(ctx(s));
  assertEquals(await realtimeStatus(ctx(s)), null);
});

Deno.test("afterRelease / beforeDisconnect: release in SQL (force only for Disconnect), then stop with Google", async () => {
  const s = svc({ google_sheets_watch_release: { stop: [{ row: "r1", channel_id: "gs1A", resource_id: "RES" }] },
    google_sheets_get_refresh_token: [{ refresh_token: "rt", auth_generation: 7 }], google_sheets_watch_result: { status: "stopped", stop: [], kicked: false } });
  await afterRelease(ctx(s), "SPREADSHEET_123");
  assertEquals(s.rpcs[0], ["google_sheets_watch_release", { p_user: "u1", p_org: "o1", p_spreadsheet: "SPREADSHEET_123", p_force: false }]);
  assertEquals(s.rpcs.at(-1)?.[1].p_action, "stopped");
  const d = svc({ google_sheets_watch_release: { stop: [] } });
  await beforeDisconnect(ctx(d));
  assertEquals(d.rpcs[0], ["google_sheets_watch_release", { p_user: "u1", p_org: "o1", p_spreadsheet: null, p_force: true }]);
});
