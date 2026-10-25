// =============================================================================
// google-sheets-push — receiver for Google Drive change notifications (files.watch channels).
// verify_jwt=false: Google sends no Supabase JWT. Authentication is independent of the gateway, user agent and IP:
//   1. header shape, then the HMAC tag inside the channel id (forged or random ids never reach the database);
//   2. google_sheets_push_accept, in ONE transaction: the stored channel (by id), a constant-time comparison of the
//      channel-token digest, the stored (or first observed) Google resource id, channel state and expiry, and the
//      connection's CURRENT auth_generation. Organization, user and spreadsheet come only from server rows.
// The acknowledgement (200) is sent only after that transaction commits ('queued' = durably accepted); a database
// failure answers 503 so Google retries with backoff. Processing then runs in the background (EdgeRuntime.waitUntil)
// through the existing import engine; if the isolate stops, the queued job is recovered by maintenance.
// Logs carry an outcome code and internal ids only — never tokens, header values or lead data.
// =============================================================================
import { readConfig, type SheetsConfig } from "../_shared/googleSheets/config.ts";
import { sha256Hex } from "../_shared/googleSheets/crypto.ts";
import { sheetsDb } from "../_shared/googleSheets/db.ts";
import { sanitizeError } from "../_shared/googleSheets/errors.ts";
import { serviceClient } from "../_shared/googleSheets/auth.ts";
import { verifyChannelId } from "../_shared/googleSheets/push/channel.ts";
import { PUSH, pushReady, readPushConfig, type PushConfig } from "../_shared/googleSheets/push/config.ts";
import { pushDb, type AcceptOutcome, type PushDb } from "../_shared/googleSheets/push/db.ts";
import { parseNotice } from "../_shared/googleSheets/push/headers.ts";
import { processTargets } from "../_shared/googleSheets/push/processor.ts";
import { background, type Background } from "../_shared/googleSheets/push/runtime.ts";

export interface ReceiverDeps {
  push: PushDb;
  pcfg: PushConfig;
  cfg: SheetsConfig;
  process: (targetId: string) => Promise<unknown>;
  background: Background;
}

const STATUS: Record<AcceptOutcome, number> = {
  queued: 200, sync: 200, duplicate: 200, ignored_inactive: 200, ignored_stale: 200,
  invalid: 400, unknown_channel: 404, rejected_token: 401, rejected_resource: 401,
};

const reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
const log = (fields: Record<string, string | number>) =>
  console.log(`google-sheets-push: ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ")}`);

function realDeps(): ReceiverDeps {
  const svc = serviceClient();
  const db = sheetsDb(svc), push = pushDb(svc), cfg = readConfig(), pcfg = readPushConfig();
  return {
    push, pcfg, cfg, background,
    process: (target) => processTargets({ db, push, cfg, fetchFn: fetch }, { target, worker: "receiver", budgetMs: PUSH.receiverBudgetMs }),
  };
}

export async function handle(req: Request, deps?: ReceiverDeps): Promise<Response> {
  const received = new Date();
  if (req.method !== "POST") return reply(405);
  const d = deps ?? realDeps();
  if (d.pcfg.key.length < 32) { log({ outcome: "not_configured" }); return reply(503); }

  const parsed = parseNotice(req.headers);
  if (!parsed.ok) { log({ outcome: "malformed", field: parsed.reason }); return reply(400); }
  const n = parsed.notice;
  if (!(await verifyChannelId(d.pcfg.key, n.channelId))) {
    log({ outcome: "unknown_channel", channel: (await sha256Hex(n.channelId)).slice(0, 12) });
    return reply(404);
  }

  let r: Awaited<ReturnType<PushDb["accept"]>>;
  try {
    r = await d.push.accept(n, await sha256Hex(n.token), received);
  } catch (e) {
    console.error(`google-sheets-push: accept failed: ${sanitizeError(e)}`);
    return reply(503);
  }
  const status = STATUS[r.outcome] ?? 400;
  log({ outcome: r.outcome, state: n.state, target: r.target_id ?? "-", ms: Date.now() - received.getTime() });
  if (r.outcome === "queued" && r.process && r.target_id && pushReady(d.pcfg) && d.cfg.enabled) {
    d.background(d.process(r.target_id), "google-sheets-push");
  }
  return reply(status);
}

if (import.meta.main) Deno.serve((req) => handle(req));
