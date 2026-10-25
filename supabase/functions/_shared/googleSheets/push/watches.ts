// Watch lifecycle: register (files.watch), renew (register again; the overlap is expected), stop (channels.stop),
// and the maintenance pass. The database decides WHAT to do (scope, generation, renew window, lock order); this
// module only performs the Google calls and records their results.
import type { SheetsConfig } from "../config.ts";
import type { SheetsDb } from "../db.ts";
import { GoogleApiError, sanitizeError } from "../errors.ts";
import { refreshAccessToken } from "../oauth.ts";
import { keyId, mintChannel, stopChannel, watchErrorCode, watchFile } from "./channel.ts";
import { PUSH, pushReady, type PushConfig } from "./config.ts";
import type { PushDb, StopItem } from "./db.ts";
import { processTargets, type ProcessSummary } from "./processor.ts";

export interface WatchDeps {
  db: SheetsDb; push: PushDb; cfg: SheetsConfig; pcfg: PushConfig; fetchFn: typeof fetch; now?: () => number;
}

class TokenError extends Error { constructor(public code: string) { super(code); } }

/** Access tokens per connection for one pass; a reconnect failure disables only the generation that failed. */
export function tokenCache(d: WatchDeps) {
  const cache = new Map<string, { token: string; generation: number }>();
  return async (connectionId: string, generation?: number): Promise<{ token: string; generation: number }> => {
    const hit = cache.get(connectionId);
    if (hit && (generation === undefined || hit.generation === generation)) return hit;
    const rt = await d.db.refreshToken(connectionId);
    if (!rt) throw new TokenError("not_connected");
    if (generation !== undefined && rt.auth_generation !== generation) throw new TokenError("connection_changed");
    try {
      const r = await refreshAccessToken(d.fetchFn, d.cfg, rt.refresh_token);
      const v = { token: r.access_token, generation: rt.auth_generation };
      cache.set(connectionId, v);
      return v;
    } catch (e) {
      if (e instanceof GoogleApiError && e.failure === "reconnect") {
        await d.db.markReconnect(connectionId, rt.auth_generation, e.reason);
        throw new TokenError("reconnect_required");
      }
      throw new TokenError(e instanceof GoogleApiError && e.failure === "quota" ? "rate_limited" : "google_unavailable");
    }
  };
}
export type Tokens = ReturnType<typeof tokenCache>;

/** Stops channels with Google and records each result (404 = already gone). Never throws. */
export async function stopItems(d: WatchDeps, items: StopItem[], tokens: Tokens, connectionId?: string): Promise<number> {
  let stopped = 0;
  for (const it of items) {
    try {
      if (!it.resource_id) { await d.push.watchResult(it.row, "abandoned", null, null, "no_resource_id"); continue; }
      const { token } = await tokens(it.connection_id ?? connectionId ?? "");
      await stopChannel(d.fetchFn, token, { id: it.channel_id, resourceId: it.resource_id });
      await d.push.watchResult(it.row, "stopped", null, null, null);
      stopped++;
    } catch (e) {
      const code = e instanceof TokenError ? e.code : watchErrorCode(e);
      await d.push.watchResult(it.row, "stop_failed", null, null, code).catch(() => undefined);
    }
  }
  return stopped;
}

export interface EnsureResult { outcome: string; kicked: boolean; target_id: string | null; code?: string }

/** Registers a channel for (connection, spreadsheet) unless a live one exists. Never throws. */
export async function ensureWatch(d: WatchDeps, t: { connectionId: string; generation: number; spreadsheetId: string; reason: string },
  tokens: Tokens = tokenCache(d)): Promise<EnsureResult> {
  const now = d.now ?? Date.now;
  if (!pushReady(d.pcfg)) return { outcome: "disabled", kicked: false, target_id: null };
  let row: string | null = null;
  try {
    const minted = await mintChannel(d.pcfg.key);
    const begin = await d.push.watchBegin(t.connectionId, t.generation, t.spreadsheetId, minted.channelId, minted.tokenDigest,
      minted.keyId, t.reason);
    if (begin.outcome !== "register" || !begin.channel_row_id) return { outcome: begin.outcome, kicked: false, target_id: begin.target_id };
    row = begin.channel_row_id;
    const { token } = await tokens(t.connectionId, t.generation);
    const w = await watchFile(d.fetchFn, token, t.spreadsheetId,
      { id: minted.channelId, token: minted.token, address: d.pcfg.address, expirationMs: now() + PUSH.channelTtlMs });
    const r = await d.push.watchResult(row, "activated", w.resourceId, w.expiration, null);
    if (r.stop.length) await stopItems(d, r.stop, tokens, t.connectionId);
    return { outcome: r.status, kicked: r.kicked, target_id: r.target_id ?? begin.target_id };
  } catch (e) {
    const code = e instanceof TokenError ? e.code : watchErrorCode(e);
    if (e instanceof GoogleApiError && e.failure === "reconnect") {
      await d.db.markReconnect(t.connectionId, t.generation, e.reason).catch(() => false);
    }
    if (row) await d.push.watchResult(row, "failed", null, null, code).catch(() => undefined);
    console.error(`google-sheets-push: watch ${row ? "registration" : "setup"} failed (${code}): ${sanitizeError(e)}`);
    return { outcome: "failed", kicked: false, target_id: null, code };
  }
}

/** Pause / Remove / Disconnect: release in SQL, then stop the returned channels with Google. Never throws. */
export async function releaseWatches(d: WatchDeps, user: string, org: string, spreadsheetId: string | null, force: boolean,
  connectionId: string | null): Promise<number> {
  try {
    const r = await d.push.watchRelease(user, org, spreadsheetId, force);
    if (!r.stop.length || !connectionId) return 0;
    return await stopItems(d, r.stop, tokenCache(d), connectionId);
  } catch (e) {
    console.error(`google-sheets-push: release failed: ${sanitizeError(e)}`);
    return 0;
  }
}

export interface MaintenanceSummary { mode: string; stopped: number; registered: number; failed: number; processed: ProcessSummary | null }

/**
 * One maintenance pass: SQL hygiene + work list, Google stops, registrations/renewals, then due jobs (retries,
 * recovered leases, backlog). With the kill switch off only stops run.
 */
export async function runMaintenance(d: WatchDeps, budgetMs: number): Promise<MaintenanceSummary> {
  const now = d.now ?? Date.now;
  const started = now();
  const ready = pushReady(d.pcfg);
  const list = await d.push.maintenanceClaim(crypto.randomUUID(), PUSH.maintenanceItems, await keyId(d.pcfg.key));
  const tokens = tokenCache(d);
  const summary: MaintenanceSummary = { mode: list.mode, stopped: 0, registered: 0, failed: 0, processed: null };
  const stops = list.items.filter((i) => i.kind === "stop" && i.row && i.channel_id)
    .map((i) => ({ row: i.row!, channel_id: i.channel_id!, resource_id: i.resource_id ?? null, connection_id: i.connection_id }));
  summary.stopped = await stopItems(d, stops, tokens);
  if (ready) {
    for (const it of list.items.filter((i) => i.kind === "register")) {
      if (now() - started > budgetMs / 2) break;
      const r = await ensureWatch(d, { connectionId: it.connection_id, generation: Number(it.generation),
        spreadsheetId: String(it.spreadsheet_id), reason: String(it.reason) }, tokens);
      if (r.outcome === "activated") summary.registered++; else if (r.outcome === "failed") summary.failed++;
    }
    const left = budgetMs - (now() - started);
    if (left > PUSH.minSourceBudgetMs + 2_000) {
      summary.processed = await processTargets(d, { target: null, worker: "maintenance", budgetMs: left });
    }
  }
  return summary;
}
