// Push-sync hooks for google-sheets-api actions (plan §6.4, §17). Every hook is best-effort: a failure is logged
// and never changes the action's own result — maintenance retries registrations and stops. Scope (mode + pilot
// allowlist), ownership and eligibility are decided in SQL; enabling hooks also need the Edge kill switch on.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SheetsConfig } from "../_shared/googleSheets/config.ts";
import { sheetsDb } from "../_shared/googleSheets/db.ts";
import { sanitizeError } from "../_shared/googleSheets/errors.ts";
import { PUSH, pushReady, readPushConfig, type PushConfig } from "../_shared/googleSheets/push/config.ts";
import { pushDb, type RealtimeStatus } from "../_shared/googleSheets/push/db.ts";
import { processTargets } from "../_shared/googleSheets/push/processor.ts";
import { background as edgeBackground, type Background } from "../_shared/googleSheets/push/runtime.ts";
import { ensureWatch, releaseWatches, type WatchDeps } from "../_shared/googleSheets/push/watches.ts";

export interface HookCtx {
  svc: SupabaseClient; cfg: SheetsConfig; fetchFn: typeof fetch; userId: string; orgId: string;
  /** Test seams; production reads the Edge environment and uses EdgeRuntime.waitUntil. */
  push?: { pcfg?: PushConfig; background?: Background };
}
type ChangeReason = "activate" | "resume" | "save" | "review" | "identity_review";

function deps(c: HookCtx): WatchDeps {
  return { db: sheetsDb(c.svc), push: pushDb(c.svc), cfg: c.cfg, pcfg: c.push?.pcfg ?? readPushConfig(), fetchFn: c.fetchFn };
}

async function ownConnection(c: HookCtx) {
  const { data } = await c.svc.from("google_sheets_connections").select("id, status, auth_generation")
    .eq("user_id", c.userId).eq("organization_id", c.orgId).maybeSingle();
  return data as { id: string; status: string; auth_generation: number } | null;
}

/** The spreadsheet a source belongs to (read before Pause / Remove, so Remove can still release it). */
export async function spreadsheetOf(c: HookCtx, sourceId: string): Promise<string | null> {
  try {
    const { data } = await c.svc.from("google_sheets_sources").select("spreadsheet_id")
      .eq("id", sourceId).eq("user_id", c.userId).eq("organization_id", c.orgId).maybeSingle();
    return (data as { spreadsheet_id: string } | null)?.spreadsheet_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Enable / Resume / mapping save / review applies: make sure the spreadsheet is watched, queue one event-driven
 * catch-up read (unless a fresh registration already queued one) and start processing in the background.
 */
export async function afterSourceChange(c: HookCtx, sourceId: string, reason: ChangeReason): Promise<void> {
  const d = deps(c);
  if (!pushReady(d.pcfg) || !c.cfg.enabled) return;
  try {
    const conn = await ownConnection(c);
    const spreadsheetId = await spreadsheetOf(c, sourceId);
    if (!conn || conn.status !== "connected" || !spreadsheetId) return;
    const watched = await ensureWatch(d, { connectionId: conn.id, generation: Number(conn.auth_generation), spreadsheetId,
      reason: reason === "resume" ? "resume" : reason === "activate" ? "activate" : "recover" });
    const target = watched.kicked ? watched.target_id : await d.push.kick(c.userId, c.orgId, sourceId, reason);
    if (target) {
      (c.push?.background ?? edgeBackground)(
        processTargets(d, { target, worker: "api", budgetMs: PUSH.apiBudgetMs }), "google-sheets-api(push)");
    }
  } catch (e) {
    console.error(`google-sheets-api: push hook (${reason}) failed: ${sanitizeError(e)}`);
  }
}

/** Pause / Remove: stop monitoring a spreadsheet once none of its tabs is enabled. */
export async function afterRelease(c: HookCtx, spreadsheetId: string): Promise<void> {
  const conn = await ownConnection(c).catch(() => null);
  await releaseWatches(deps(c), c.userId, c.orgId, spreadsheetId, false, conn?.status === "connected" ? conn.id : null);
}

/** Disconnect: stop every channel while the refresh token still exists (bounded; never blocks the disconnect). */
export async function beforeDisconnect(c: HookCtx): Promise<void> {
  const conn = await ownConnection(c).catch(() => null);
  const work = releaseWatches(deps(c), c.userId, c.orgId, null, true, conn?.status === "connected" ? conn.id : null);
  let timer: number | undefined;
  await Promise.race([work, new Promise((r) => { timer = setTimeout(r, 5_000); })]);
  clearTimeout(timer);
}

/** Monitoring summary for the status action; null when unavailable (the UI then shows no monitoring line). */
export async function realtimeStatus(c: HookCtx): Promise<RealtimeStatus | null> {
  try {
    return await pushDb(c.svc).status(c.userId, c.orgId);
  } catch {
    return null;
  }
}
