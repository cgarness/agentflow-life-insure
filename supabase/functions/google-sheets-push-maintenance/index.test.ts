import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { SheetsDb } from "../_shared/googleSheets/db.ts";
import type { PushDb } from "../_shared/googleSheets/push/db.ts";
import type { WatchDeps } from "../_shared/googleSheets/push/watches.ts";
import { handle, isAuthorized } from "./index.ts";

const TOKEN = "m".repeat(40);
const CFG = { enabled: true, clientId: "cid", clientSecret: "s", redirectUri: "https://x", allowedOrigins: [], stateKey: "k".repeat(40), workerToken: "w".repeat(40) };
const deps = (over: Partial<WatchDeps> = {}): WatchDeps => ({
  db: {} as SheetsDb, cfg: CFG, fetchFn: fetch,
  pcfg: { enabled: true, key: "p".repeat(40), maintenanceToken: TOKEN, address: "https://p/functions/v1/google-sheets-push" },
  push: { maintenanceClaim: async () => ({ mode: "pilot", items: [] }), claim: async () => null } as unknown as PushDb,
  ...over,
});
const post = (auth?: string) => new Request("https://p/functions/v1/google-sheets-push-maintenance",
  { method: "POST", headers: auth ? { Authorization: auth } : {} });

Deno.test("maintenance: constant-time bearer check; short or missing tokens never authorize", () => {
  assertEquals(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
  assertEquals(isAuthorized(`Bearer ${TOKEN}x`, TOKEN), false);
  assertEquals(isAuthorized(null, TOKEN), false);
  assertEquals(isAuthorized("Bearer short", "short"), false);
});

Deno.test("maintenance: 403 without the token; 405 for GET; inert while Sheets is disabled; runs a pass otherwise", async () => {
  assertEquals((await handle(post(), deps())).status, 403);
  assertEquals((await handle(post("Bearer wrong"), deps())).status, 403);
  assertEquals((await handle(new Request("https://p/x"), deps())).status, 405);
  const disabled = await handle(post(`Bearer ${TOKEN}`), deps({ cfg: { ...CFG, enabled: false } }));
  assertEquals(await disabled.json(), { ok: true, disabled: true });
  const res = await handle(post(`Bearer ${TOKEN}`), deps());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).mode, "pilot");
});
