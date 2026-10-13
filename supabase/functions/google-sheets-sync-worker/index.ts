// =============================================================================
// google-sheets-sync-worker — scheduled Google Sheets ingestion.
// Invoked ONLY by pg_cron (google-sheets-sync-every-minute) with `Authorization: Bearer <Vault
// google_sheets_worker_token>`, compared in constant time against GOOGLE_SHEETS_WORKER_TOKEN (≥ 32 chars).
// verify_jwt=false (invariant #2); the body is ignored. Claims at most 10 sources per invocation, one at a
// time (SKIP LOCKED leases), within a 45 s budget; each source processes at most 500 new rows per run.
// GOOGLE_SHEETS_ENABLED unset → inert (200, no work). Works with no browser and no stored user session.
// =============================================================================
import { LIMITS, readConfig } from "../_shared/googleSheets/config.ts";
import { timingSafeEqual } from "../_shared/googleSheets/crypto.ts";
import { sheetsDb, type SheetsDb } from "../_shared/googleSheets/db.ts";
import { runSource, type RunOutcome } from "../_shared/googleSheets/engine.ts";
import { sanitizeError } from "../_shared/googleSheets/errors.ts";
import { json } from "../_shared/googleSheets/http.ts";
import { serviceClient } from "../_shared/googleSheets/auth.ts";

export function isAuthorized(authorization: string | null, token: string): boolean {
  if (token.length < 32) return false;
  return timingSafeEqual(authorization ?? "", `Bearer ${token}`);
}

export async function handle(req: Request, dbOverride?: SheetsDb, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const cfg = readConfig();
  if (!isAuthorized(req.headers.get("Authorization"), cfg.workerToken)) return json({ error: "unauthorized" }, 403);
  if (!cfg.enabled) return json({ ok: true, disabled: true, processed: 0 }, 200);

  const started = Date.now();
  let db = dbOverride;
  if (!db) {
    db = sheetsDb(serviceClient());
  }
  const results: RunOutcome[] = [];
  try {
    for (let i = 0; i < LIMITS.sourcesPerTick; i++) {
      const remaining = LIMITS.workerBudgetMs - (Date.now() - started);
      if (remaining < 8_000) break;
      const lease = crypto.randomUUID();
      const claimed = await db.claim(lease, 1);
      if (!claimed.length) break;
      results.push(await runSource({ db, cfg, fetchFn }, claimed[0], lease, "schedule", remaining - 3_000));
    }
  } catch (e) {
    console.error(`google-sheets-sync-worker: ${sanitizeError(e)}`);
    return json({ ok: false, processed: results.length }, 500);
  }
  const summary = results.reduce((s, r) => ({
    processed: s.processed + 1, imported: s.imported + r.imported, skipped: s.skipped + r.skipped, errors: s.errors + r.errors,
  }), { processed: 0, imported: 0, skipped: 0, errors: 0 });
  if (summary.processed > 0) console.log(`google-sheets-sync-worker: ${JSON.stringify(summary)}`);
  return json({ ok: true, ...summary }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req));
