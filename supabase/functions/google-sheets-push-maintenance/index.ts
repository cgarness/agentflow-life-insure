// =============================================================================
// google-sheets-push-maintenance — watch upkeep and recovery for Google Sheets push sync (plan §17, D3).
// Invoked ONLY by pg_cron (google-sheets-push-maintenance-every-minute), which sends a request only while
// private.google_sheets_push_maintenance_due() is true, with `Authorization: Bearer <Vault
// google_sheets_push_maintenance_token>` compared in constant time against GOOGLE_SHEETS_PUSH_MAINTENANCE_TOKEN
// (≥ 32 chars). verify_jwt=false (invariant #2); the body is ignored.
// Work: stop channels, register / renew channels, then jobs that are already queued and due (retries, recovered
// leases, backlog). It never reads a spreadsheet that no notification or owner action queued. With the kill switch
// GOOGLE_SHEETS_PUSH_ENABLED unset only stops run; GOOGLE_SHEETS_ENABLED unset → inert.
// =============================================================================
import { readConfig } from "../_shared/googleSheets/config.ts";
import { timingSafeEqual } from "../_shared/googleSheets/crypto.ts";
import { sheetsDb } from "../_shared/googleSheets/db.ts";
import { sanitizeError } from "../_shared/googleSheets/errors.ts";
import { json } from "../_shared/googleSheets/http.ts";
import { serviceClient } from "../_shared/googleSheets/auth.ts";
import { PUSH, readPushConfig } from "../_shared/googleSheets/push/config.ts";
import { pushDb } from "../_shared/googleSheets/push/db.ts";
import { runMaintenance, type WatchDeps } from "../_shared/googleSheets/push/watches.ts";

export function isAuthorized(authorization: string | null, token: string): boolean {
  if (token.length < 32) return false;
  return timingSafeEqual(authorization ?? "", `Bearer ${token}`);
}

export async function handle(req: Request, depsOverride?: WatchDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const pcfg = depsOverride?.pcfg ?? readPushConfig();
  if (!isAuthorized(req.headers.get("Authorization"), pcfg.maintenanceToken)) return json({ error: "unauthorized" }, 403);
  const cfg = depsOverride?.cfg ?? readConfig();
  if (!cfg.enabled) return json({ ok: true, disabled: true }, 200);
  if (pcfg.key.length < 32) return json({ ok: false, error: "not_configured" }, 503);

  let d = depsOverride;
  if (!d) {
    const svc = serviceClient();
    d = { db: sheetsDb(svc), push: pushDb(svc), cfg, pcfg, fetchFn: fetch };
  }
  try {
    const s = await runMaintenance(d, PUSH.maintenanceBudgetMs);
    const out = { ok: true, mode: s.mode, stopped: s.stopped, registered: s.registered, failed: s.failed,
      targets: s.processed?.targets ?? 0, imported: s.processed?.imported ?? 0 };
    if (out.stopped || out.registered || out.failed || out.targets) console.log(`google-sheets-push-maintenance: ${JSON.stringify(out)}`);
    return json(out, 200);
  } catch (e) {
    console.error(`google-sheets-push-maintenance: ${sanitizeError(e)}`);
    return json({ ok: false }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req));
