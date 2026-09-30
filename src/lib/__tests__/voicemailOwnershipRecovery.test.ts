// Corrective pass (2026-09-16) — DURABLE OWNERSHIP RECOVERY in twilio-recording-status.
//
// This suite executes the REAL callback handler — including its signature validation — against a
// database double that models the production RPC contracts and the PostgREST write boundary, and
// then hands the SAME modelled table to the REAL purge worker. It deliberately does not re-implement
// the resolver: the previous "what the callback persists" tests mirrored the decision and therefore
// could not see that nothing was ever written.
//
// The reproduced sequence:
//   1. a stored (or purged) voicemail holds provider_account_sid = NULL
//   2. a valid signed callback supplies account B
//   3. the resolver establishes B and the cleanup-retry branch DELETEs against B
//   4. the DELETE returns 503
//   5. the callback records the cleanup failure and answers 503 — but never persists B
//   6. the next scheduled purge run sees NULL, issues no request, and reports unresolved_ownership
import { createHmac, webcrypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runVoicemailSourceCleanup,
  type VoicemailDeps,
} from "../../../supabase/functions/recording-retention-purge/voicemail";

const REPO = path.resolve(__dirname, "../../..");
const FN_DIR = "supabase/functions/twilio-recording-status";
const SUPABASE_URL = "https://example.supabase.co";
const AUTH_TOKEN = "twilio-auth-token";
const PLATFORM = "AC" + "a".repeat(32); // the platform credential's own account
const ACCOUNT_B = "AC" + "b".repeat(32); // the subaccount that actually owns the recording
const ACCOUNT_C = "AC" + "c".repeat(32); // a third, conflicting account
const REC = "RE" + "d".repeat(32);
const CALL_ROW = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const CALL_SID = "CA" + "e".repeat(32);

type Handler = (req: Request) => Promise<Response>;

interface VmRow {
  id: string;
  recording_sid: string;
  call_id: string;
  organization_id: string;
  provider_account_sid: string | null;
  status: "pending" | "stored" | "failed" | "purged";
  storage_path: string | null;
  source_cleanup_state: "pending" | "failed" | "deleted";
  source_cleanup_attempts: number;
  source_cleanup_next_at: number | null;
  listened_at: string | null;
  notified_at: string | null;
  notify_attempts: number;
}

function storedRow(over: Partial<VmRow> = {}): VmRow {
  return {
    id: "vm-1",
    recording_sid: REC,
    call_id: CALL_ROW,
    organization_id: ORG,
    provider_account_sid: null,
    status: "stored",
    storage_path: `${ORG}/20260916/${CALL_SID}-${REC}.mp3`,
    source_cleanup_state: "failed",
    source_cleanup_attempts: 2,
    source_cleanup_next_at: null,
    listened_at: "2026-09-15T10:00:00.000Z",
    notified_at: "2026-09-15T10:00:05.000Z",
    notify_attempts: 1,
    ...over,
  };
}

interface Model {
  rows: VmRow[];
  fetches: Array<{ url: string; method?: string }>;
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  uploads: string[];
  downloads: string[];
  /** Force the guarded ownership write to fail. */
  ownerWrite?: "error" | "throw";
  /** Runs just before the guarded write lands, to simulate a concurrent writer. */
  beforeOwnerWrite?: () => void;
  /** Status the provider returns for a DELETE. */
  deleteStatus: number;
  /** Every download, upload, DELETE and RPC in the order the handler performed them. */
  events: string[];
  /** Every table the handler opened through `from()`. */
  tables: string[];
  /**
   * Mirrors `coalesce(v.provider_account_sid, EXCLUDED.provider_account_sid)` when a concurrent
   * insert already established a different owner: the upsert returns THAT owner, not ours.
   */
  upsertOwnerWins?: string;
}

let bundlePath: string;
let baselineBundlePath: string | null = null;
const nodeRequire = createRequire(__filename);

function bundle(indexSrc: string, idempotencySrc: string, tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `trs-${tag}-`));
  const stubName = "supabase-stub.mjs";
  writeFileSync(
    path.join(dir, stubName),
    "export const createClient = (...a) => globalThis.__TEST_CREATE_CLIENT__(...a);\nexport default { createClient };\n",
  );
  writeFileSync(path.join(dir, "idempotency.ts"), idempotencySrc);
  const patched = indexSrc.replace(
    /from "https:\/\/esm\.sh\/@supabase\/supabase-js@2";/,
    `from "./${stubName}";`,
  );
  writeFileSync(path.join(dir, "index.ts"), patched);
  const out = path.join(dir, "handler.cjs");
  execFileSync(
    path.join(REPO, "node_modules/.bin/esbuild"),
    [path.join(dir, "index.ts"), "--bundle", "--format=cjs", "--platform=node", `--outfile=${out}`],
    { stdio: "pipe" },
  );
  return out;
}

beforeAll(() => {
  const idx = readFileSync(path.join(REPO, FN_DIR, "index.ts"), "utf8");
  const idem = readFileSync(path.join(REPO, FN_DIR, "idempotency.ts"), "utf8");
  // the ONLY edit is the remote import specifier
  expect(idx.split("\n").filter((l, i) => l !== idx.replace(/from "https:\/\/esm\.sh\/@supabase\/supabase-js@2";/, 'from "./x.mjs";').split("\n")[i])).toHaveLength(1);
  bundlePath = bundle(idx, idem, "head");

  try {
    baselineBundlePath = bundle(
      execFileSync("git", ["show", `42b48df:${FN_DIR}/index.ts`], { cwd: REPO, encoding: "utf8" }),
      execFileSync("git", ["show", `42b48df:${FN_DIR}/idempotency.ts`], { cwd: REPO, encoding: "utf8" }),
      "42b48df",
    );
  } catch {
    baselineBundlePath = null; // shallow clone: the baseline probe is skipped
  }
}, 120_000);

/** Chainable PostgREST double over a single modelled table. */
function makeClient(model: Model) {
  const matches = (r: VmRow, filters: Array<[string, string, unknown]>) =>
    filters.every(([op, col, val]) =>
      op === "is" ? (r as unknown as Record<string, unknown>)[col] === val
                  : (r as unknown as Record<string, unknown>)[col] === val);

  function builder(table: string) {
    const filters: Array<[string, string, unknown]> = [];
    let mode: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};

    const apply = () => {
      if (table !== "voicemails") return [] as VmRow[];
      const hit = model.rows.filter((r) => matches(r, filters));
      if (mode === "update") {
        model.beforeOwnerWrite?.();
        const reHit = model.rows.filter((r) => matches(r, filters)); // re-evaluate after the concurrent writer
        for (const r of reHit) Object.assign(r, patch);
        return reHit;
      }
      return hit;
    };

    const api: Record<string, unknown> = {
      select: () => api,
      update: (p: Record<string, unknown>) => { mode = "update"; patch = p; return api; },
      eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push(["is", c, v]); return api; },
      maybeSingle: async () => {
        const rows = apply();
        return { data: rows.length ? { ...rows[0] } : null, error: null };
      },
      // awaiting the builder resolves the query (update ... select)
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        if (mode === "update" && model.ownerWrite === "throw") { reject(new Error("connection reset")); return; }
        if (mode === "update" && model.ownerWrite === "error") {
          resolve({ data: null, error: { message: "could not serialize access", code: "40001" } });
          return;
        }
        resolve({ data: apply().map((r) => ({ ...r })), error: null });
      },
    };
    return api;
  }

  return {
    from: (t: string) => { model.tables.push(t); return builder(t); },
    storage: {
      from: () => ({
        upload: async (p: string) => { model.uploads.push(p); model.events.push("upload"); return { data: { path: p }, error: null }; },
        remove: async () => ({ data: [], error: null }),
      }),
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      model.rpcs.push({ fn, args });
      model.events.push(`rpc:${fn}`);
      const sid = String(args.p_recording_sid ?? "");
      const row = model.rows.find((r) => r.recording_sid === sid);
      if (fn === "mark_voicemail_source_deleted") {
        if (row && row.source_cleanup_state !== "deleted") { row.source_cleanup_state = "deleted"; return { data: { updated: true }, error: null }; }
        return { data: { updated: false }, error: null };
      }
      if (fn === "record_voicemail_cleanup_failure") {
        if (row && row.source_cleanup_state !== "deleted") {
          row.source_cleanup_state = "failed";
          row.source_cleanup_attempts += 1;
          row.source_cleanup_next_at = 0; // due again immediately, for the worker step
          return { data: { updated: true }, error: null };
        }
        return { data: { updated: false }, error: null };
      }
      if (fn === "converge_inbound_notifications") return { data: { voicemails_owed: 0, voicemails_notified: 0 }, error: null };
      if (fn === "upsert_voicemail_from_recording") {
        // faithful to M7: existing owner wins, 'stored' is sticky, otherwise EXCLUDED wins
        const existing = model.rows.find((r) => r.recording_sid === sid);
        if (existing) {
          existing.provider_account_sid = existing.provider_account_sid ?? (args.p_account_sid as string | null);
          existing.storage_path = existing.storage_path ?? (args.p_storage_path as string | null);
          existing.status = existing.status === "stored" ? "stored" : (args.p_status as VmRow["status"]);
          return { data: { ...existing }, error: null };
        }
        const created = storedRow({
          provider_account_sid: model.upsertOwnerWins ?? ((args.p_account_sid as string | null) ?? null),
          status: args.p_status as VmRow["status"],
          storage_path: (args.p_storage_path as string | null) ?? null,
          source_cleanup_state: "pending",
          source_cleanup_attempts: 0,
          listened_at: null,
          notified_at: null,
          notify_attempts: 0,
        });
        model.rows.push(created);
        return { data: { ...created }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

function signedRequest(params: Record<string, string>, search = ""): Request {
  const url = `${SUPABASE_URL}/functions/v1/twilio-recording-status${search}`;
  let signing = url;
  for (const k of Object.keys(params).sort()) signing += k + params[k];
  const signature = createHmac("sha1", AUTH_TOKEN).update(signing, "utf8").digest("base64");
  return new Request(url, {
    method: "POST",
    headers: { "x-twilio-signature": signature, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

async function loadCallback(model: Model, baseline = false): Promise<Handler> {
  (globalThis as Record<string, unknown>).__TEST_CREATE_CLIENT__ = () => makeClient(model);
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    model.fetches.push({ url: u, method: init?.method });
    if (init?.method === "DELETE") { model.events.push("DELETE"); return new Response(null, { status: model.deleteStatus }); }
    model.downloads.push(u);
    model.events.push("download");
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof globalThis.fetch;

  let captured: Handler | undefined;
  const env: Record<string, string> = {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    TWILIO_ACCOUNT_SID: PLATFORM,
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  };
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: Handler) => { captured = h; },
  };
  const target = baseline ? (baselineBundlePath as string) : bundlePath;
  delete nodeRequire.cache[nodeRequire.resolve(target)];
  nodeRequire(target);
  if (!captured) throw new Error("handler never registered");
  return captured;
}

/** The REAL purge worker, backed by the same modelled table. */
async function runWorker(model: Model) {
  const clock = { t: 1_000_000 };
  const deps: VoicemailDeps = {
    nowMs: () => clock.t,
    invocationStartMs: clock.t,
    retentionAnchorMs: clock.t,
    listRoutingSettings: async () => ({ data: [], error: null }),
    expiredBatch: async () => ({ data: [], error: null }),
    removeObjects: async () => ({ data: [], error: null }),
    markPurged: async () => ({ data: 0, error: null }),
    credentials: () => ({ accountSid: PLATFORM, authToken: AUTH_TOKEN }),
    // M8: the actionable selection also requires an ESTABLISHED owner. That is exactly what makes the
    // recovery below observable — the row is invisible to the worker until the callback persists B.
    cleanupActionableBatch: async (limit) => ({
      data: model.rows
        .filter((r) => ["stored", "purged"].includes(r.status) && r.source_cleanup_state !== "deleted" && r.source_cleanup_attempts < 50)
        .filter((r) => /^AC[0-9a-fA-F]{32}$/.test((r.provider_account_sid ?? "").trim()))
        .slice(0, limit)
        .map((r) => ({
          id: r.id, recording_sid: r.recording_sid,
          provider_account_sid: r.provider_account_sid, source_cleanup_attempts: r.source_cleanup_attempts,
        })),
      error: null,
    }),
    // Back-compat for the BASELINE bundles below, which are older worker builds that call
    // `cleanupBatch`. It keeps the PRE-M8 semantics (no owner filter) so those reproductions stay
    // faithful to the code they are pinning. The current worker never calls this.
    cleanupBatch: async (limit: number) => ({
      data: model.rows
        .filter((r) => ["stored", "purged"].includes(r.status) && r.source_cleanup_state !== "deleted" && r.source_cleanup_attempts < 50)
        .slice(0, limit)
        .map((r) => ({
          id: r.id, recording_sid: r.recording_sid,
          provider_account_sid: r.provider_account_sid, source_cleanup_attempts: r.source_cleanup_attempts,
        })),
      error: null,
    }),
    cleanupBlockedSummary: async () => {
      const blocked = model.rows.filter(
        (r) => ["stored", "purged"].includes(r.status) && r.source_cleanup_state !== "deleted" &&
               r.source_cleanup_attempts < 50 &&
               !/^AC[0-9a-fA-F]{32}$/.test((r.provider_account_sid ?? "").trim()),
      );
      return {
        data: [{
          blocked_due: blocked.length, blocked_total: blocked.length,
          blocked_orgs: blocked.length ? 1 : 0,
          oldest_blocked_at: blocked.length ? new Date(clock.t).toISOString() : null,
          scan_capped: false,
        }],
        error: null,
      };
    },
    deleteProviderRecording: async ({ ownerAccountSid, recordingSid }) => {
      model.fetches.push({ url: `worker:/Accounts/${ownerAccountSid}/Recordings/${recordingSid}`, method: "DELETE" });
      // the recording only exists under ACCOUNT_B; anywhere else answers 404
      return { kind: "status", status: ownerAccountSid === ACCOUNT_B ? 204 : 404 };
    },
    markSourceDeleted: async (s) => {
      const r = model.rows.find((x) => x.recording_sid === s);
      if (r && r.source_cleanup_state !== "deleted") { r.source_cleanup_state = "deleted"; return { data: { updated: true }, error: null }; }
      return { data: { updated: false }, error: null };
    },
    recordCleanupFailure: async (s) => {
      const r = model.rows.find((x) => x.recording_sid === s);
      if (r && r.source_cleanup_state !== "deleted") { r.source_cleanup_attempts += 1; return { data: { updated: true }, error: null }; }
      return { data: { updated: false }, error: null };
    },
    readCleanupState: async (s) => {
      const r = model.rows.find((x) => x.recording_sid === s);
      return { data: r ? { source_cleanup_state: r.source_cleanup_state } : null, error: null };
    },
    log: () => {},
  };
  return runVoicemailSourceCleanup(deps);
}

function model(over: Partial<Model> & { rows: VmRow[] }): Model {
  return { fetches: [], rpcs: [], uploads: [], downloads: [], deleteStatus: 503, events: [], tables: [], ...over };
}

const CALLBACK_PARAMS = {
  RecordingSid: REC,
  RecordingUrl: "https://api.twilio.com/recordings/RE",
  RecordingStatus: "completed",
  RecordingDuration: "7",
  CallSid: CALL_SID,
  AccountSid: ACCOUNT_B, // the signed callback establishes B
};
const SEARCH = `?source=voicemail&mailbox=group&call_row_id=${CALL_ROW}&org_id=${ORG}`;

beforeAll(() => {
  // The handler signs with crypto.subtle. jsdom exposes `crypto` as a getter-only property, so it is
  // redefined rather than assigned; Node's WebCrypto is the faithful implementation here.
  if (!(globalThis.crypto as Crypto | undefined)?.subtle) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
  }
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).Deno;
  delete (globalThis as Record<string, unknown>).__TEST_CREATE_CLIENT__;
});

describe("signature validation is genuinely exercised", () => {
  it("an unsigned callback is rejected and writes nothing", async () => {
    const m = model({ rows: [storedRow()] });
    const handler = await loadCallback(m);
    const res = await handler(
      new Request(`${SUPABASE_URL}/functions/v1/twilio-recording-status${SEARCH}`, {
        method: "POST",
        body: new URLSearchParams(CALLBACK_PARAMS).toString(),
      }),
    );
    expect(res.status).toBe(403);
    expect(m.rows[0].provider_account_sid).toBeNull();
    expect(m.fetches).toHaveLength(0);
  });
});

describe.each([
  ["stored", "stored" as const],
  ["purged", "purged" as const],
])("callback-to-worker ownership recovery (%s row)", (_label, status) => {
  it("persists and verifies B before deleting, leaves cleanup owed, and the worker then completes", async () => {
    const m = model({ rows: [storedRow({ status })], deleteStatus: 503 });
    const handler = await loadCallback(m);

    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));

    // the provider failed, so the callback stays recoverable
    expect(res.status).toBe(503);
    // ...but ownership is now DURABLE
    expect(m.rows[0].provider_account_sid).toBe(ACCOUNT_B);
    // the DELETE went to B, and the write happened BEFORE it
    const del = m.fetches.find((f) => f.method === "DELETE");
    expect(del?.url).toContain(`/Accounts/${ACCOUNT_B}/Recordings/${REC}`);
    // cleanup is still owed
    expect(m.rows[0].source_cleanup_state).toBe("failed");
    expect(m.rows[0].source_cleanup_attempts).toBeGreaterThan(2);
    // everything else is preserved
    expect(m.rows[0].status).toBe(status);
    expect(m.rows[0].storage_path).toBe(storedRow().storage_path);
    expect(m.rows[0].listened_at).toBe(storedRow().listened_at);
    expect(m.rows[0].notified_at).toBe(storedRow().notified_at);
    expect(m.rows[0].notify_attempts).toBe(1);
    // a purged row must not be re-downloaded or re-uploaded
    expect(m.uploads).toHaveLength(0);
    expect(m.downloads).toHaveLength(0);

    // ── the next scheduled run, using the REAL worker over the same table ──
    const out = await runWorker(m);
    expect(out.unresolved_ownership).toBe(0);
    expect(out.provider_deletions).toBe(1);
    expect(out.reconciled).toBe(1);
    expect(m.rows[0].source_cleanup_state).toBe("deleted");
    expect(m.rows[0].status).toBe(status); // still purged if it was purged
  });

  it("BASELINE 42b48df: the same sequence never persists B, and the worker is stuck", async () => {
    if (!baselineBundlePath) return;
    const m = model({ rows: [storedRow({ status })], deleteStatus: 503 });
    const handler = await loadCallback(m, true);

    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));
    expect(res.status).toBe(503);
    expect(m.fetches.find((f) => f.method === "DELETE")?.url).toContain(`/Accounts/${ACCOUNT_B}/`);
    // the defect: B was established in memory and used, but never written
    expect(m.rows[0].provider_account_sid).toBeNull();

    // The worker is still stuck on this row, and under M8 it says so through the BLOCKED backlog rather
    // than through an in-pass ownership outcome: the row is excluded from the actionable selection up
    // front, so it is never attempted — which is the point, because it can no longer hide actionable
    // work behind it. Either way the obligation stands and nothing was deleted or fabricated.
    const attemptsBeforeWorker = m.rows[0].source_cleanup_attempts;
    const out = await runWorker(m);
    expect(out.blocked_ownership_total).toBe(1);
    expect(out.blocked_ownership_due).toBe(1);
    expect(out.unresolved_ownership).toBe(0);          // not selected, so not attempted in-pass
    expect(out.rows_attempted).toBe(0);
    expect(out.provider_deletions).toBe(0);
    expect(out.queue_empty).toBe(false);               // blocked work is never reported as an empty queue
    expect(out.status).toBe("partial");
    expect(out.reason).toBe("blocked_unresolved_ownership");
    expect(m.rows[0].source_cleanup_state).not.toBe("deleted");
    // and the worker fabricated no attempt of its own: whatever the callback recorded is what remains,
    // so the 50-attempt ceiling can never quietly retire a row the worker never even asked about
    expect(m.rows[0].source_cleanup_attempts).toBe(attemptsBeforeWorker);
  });
});

describe("ownership write outcomes", () => {
  it("a returned write error issues NO DELETE and stays recoverable", async () => {
    const m = model({ rows: [storedRow()], ownerWrite: "error" });
    const handler = await loadCallback(m);
    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));
    expect(res.status).toBe(503);
    expect(m.fetches.filter((f) => f.method === "DELETE")).toHaveLength(0);
    expect(m.rows[0].provider_account_sid).toBeNull();
    expect(m.rows[0].source_cleanup_state).toBe("failed"); // untouched
  });

  it("a THROWN write failure issues NO DELETE and stays recoverable", async () => {
    const m = model({ rows: [storedRow()], ownerWrite: "throw" });
    const handler = await loadCallback(m);
    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));
    expect(res.status).toBe(503);
    expect(m.fetches.filter((f) => f.method === "DELETE")).toHaveLength(0);
  });

  it("a concurrent writer that stored the SAME owner is acceptable and the DELETE proceeds", async () => {
    const m = model({ rows: [storedRow()], deleteStatus: 204 });
    m.beforeOwnerWrite = () => { m.rows[0].provider_account_sid = ACCOUNT_B; }; // guard now matches nothing
    const handler = await loadCallback(m);
    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));
    expect(res.status).toBe(200);
    expect(m.rows[0].provider_account_sid).toBe(ACCOUNT_B);
    expect(m.fetches.find((f) => f.method === "DELETE")?.url).toContain(`/Accounts/${ACCOUNT_B}/`);
  });

  it("a concurrent writer that stored a DIFFERENT owner is a conflict: no DELETE, stored owner kept", async () => {
    const m = model({ rows: [storedRow()] });
    m.beforeOwnerWrite = () => { m.rows[0].provider_account_sid = ACCOUNT_C; };
    const handler = await loadCallback(m);
    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));
    expect(res.status).toBe(503);
    expect(m.fetches.filter((f) => f.method === "DELETE")).toHaveLength(0);
    expect(m.rows[0].provider_account_sid).toBe(ACCOUNT_C); // never overwritten
  });

  it("CONTROL: an already-known matching owner needs no write and deletes straight away", async () => {
    const m = model({ rows: [storedRow({ provider_account_sid: ACCOUNT_B })], deleteStatus: 204 });
    const handler = await loadCallback(m);
    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));
    expect(res.status).toBe(200);
    expect(m.rows[0].source_cleanup_state).toBe("deleted");
  });

  it("CONTROL: an unresolved owner issues no DELETE and persists nothing", async () => {
    const m = model({ rows: [storedRow()] });
    const handler = await loadCallback(m);
    const { AccountSid: _drop, ...noAccount } = CALLBACK_PARAMS;
    const res = await handler(signedRequest(noAccount, SEARCH));
    expect(res.status).toBe(503);
    expect(m.fetches.filter((f) => f.method === "DELETE")).toHaveLength(0);
    expect(m.rows[0].provider_account_sid).toBeNull();
  });

  it("a stored owner that disagrees with the callback is rejected before any write", async () => {
    const m = model({ rows: [storedRow({ provider_account_sid: ACCOUNT_C })] });
    const handler = await loadCallback(m);
    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));
    expect(res.status).toBe(503);
    expect(m.fetches.filter((f) => f.method === "DELETE")).toHaveLength(0);
    expect(m.rows[0].provider_account_sid).toBe(ACCOUNT_C);
  });
});

describe("the initial upsert's authoritative owner decides", () => {
  it("when a concurrent insert's owner wins the coalesce, no DELETE is attempted against ours", async () => {
    // No row exists at lookup time, so the branch goes through the store pipeline and the upsert is
    // what establishes ownership — and M7 resolves it as coalesce(existing, incoming).
    const m = model({ rows: [], deleteStatus: 204, upsertOwnerWins: ACCOUNT_C });
    const handler = await loadCallback(m);

    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));

    // the media was stored, but the authoritative owner is C, so B is never deleted against
    expect(m.uploads).toHaveLength(1);
    expect(m.rows[0].provider_account_sid).toBe(ACCOUNT_C);
    expect(m.fetches.filter((f) => f.method === "DELETE")).toHaveLength(0);
    expect(res.status).toBe(503); // recoverable: the source is preserved and cleanup stays owed
  });

  it("CONTROL: when our owner does win, the DELETE proceeds against it", async () => {
    const m = model({ rows: [], deleteStatus: 204 });
    const handler = await loadCallback(m);

    const res = await handler(signedRequest(CALLBACK_PARAMS, SEARCH));

    expect(m.rows[0].provider_account_sid).toBe(ACCOUNT_B);
    expect(m.fetches.find((f) => f.method === "DELETE")?.url).toContain(`/Accounts/${ACCOUNT_B}/`);
    expect(res.status).toBe(200);
  });
});

// ── Agent-voicemail callback repair (2026-09-30), executed through the REAL handler ─────────────────────
// New agent callbacks carry `mailbox=agent&mailbox_agent_id=<uuid>` (only [A-Za-z0-9._-]); the legacy signed
// forms stay accepted. Signature validation is unchanged: it runs first, over the exact received URL.
describe("agent-voicemail callback repair — executed", () => {
  const AGENT = "33333333-3333-4333-8333-333333333333";
  const AGENT2 = "55555555-5555-4555-8555-555555555555";
  const ATTEMPT = "44444444-4444-4444-8444-444444444444";
  const ids = `call_row_id=${CALL_ROW}&org_id=${ORG}&attempt_id=${ATTEMPT}`;
  const NEW_AGENT = `?source=voicemail&mailbox=agent&mailbox_agent_id=${AGENT}&${ids}`;
  const LEGACY_AGENT = `?source=voicemail&mailbox=agent%3A${AGENT}&${ids}`;
  const GROUP = `?source=voicemail&mailbox=group&${ids}`;
  const FN_URL = `${SUPABASE_URL}/functions/v1/twilio-recording-status`;

  /** Signed over one URL, delivered on another (identical when `sentSearch` is omitted). */
  function signedOver(signedSearch: string, sentSearch = signedSearch, opts: { token?: string; sentParams?: Record<string, string>; noSignature?: boolean } = {}): Request {
    let signing = `${FN_URL}${signedSearch}`;
    for (const k of Object.keys(CALLBACK_PARAMS).sort()) signing += k + (CALLBACK_PARAMS as Record<string, string>)[k];
    const signature = createHmac("sha1", opts.token ?? AUTH_TOKEN).update(signing, "utf8").digest("base64");
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (!opts.noSignature) headers["x-twilio-signature"] = signature;
    return new Request(`${FN_URL}${sentSearch}`, { method: "POST", headers, body: new URLSearchParams(opts.sentParams ?? CALLBACK_PARAMS).toString() });
  }
  const fresh = () => model({ rows: [], deleteStatus: 204 });
  const upsertArgs = (m: Model) => m.rpcs.filter((r) => r.fn === "upsert_voicemail_from_recording").map((r) => r.args);
  const consoleText = () => JSON.stringify([
    ...vi.mocked(console.log).mock.calls, ...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls,
  ]);
  const expectNothingTouched = (m: Model) => {
    expect(m.rpcs).toEqual([]);
    expect(m.uploads).toEqual([]);
    expect(m.fetches).toEqual([]);
    expect(m.tables).toEqual([]);
  };

  it("NEW form: a signed agent voicemail is stored for that agent; order upload → persist → delete → notify is unchanged", async () => {
    const m = fresh();
    const handler = await loadCallback(m);
    const res = await handler(signedOver(NEW_AGENT));
    expect(res.status).toBe(200);
    expect(upsertArgs(m)).toEqual([expect.objectContaining({
      p_recording_sid: REC, p_call_row_id: CALL_ROW, p_org_id: ORG, p_attempt_id: ATTEMPT,
      p_mailbox: `agent:${AGENT}`, p_status: "stored", p_account_sid: ACCOUNT_B,
    })]);
    expect(m.uploads).toHaveLength(1);
    expect(m.fetches.find((f) => f.method === "DELETE")?.url).toContain(`/Accounts/${ACCOUNT_B}/Recordings/${REC}`);
    expect(m.rows[0].source_cleanup_state).toBe("deleted");
    const at = (e: string) => m.events.indexOf(e);
    expect(at("download")).toBeGreaterThanOrEqual(0);
    expect(at("download")).toBeLessThan(at("upload"));
    expect(at("upload")).toBeLessThan(at("rpc:upsert_voicemail_from_recording"));
    expect(at("rpc:upsert_voicemail_from_recording")).toBeLessThan(at("DELETE"));
    expect(at("DELETE")).toBeLessThan(at("rpc:mark_voicemail_source_deleted"));
    expect(at("rpc:mark_voicemail_source_deleted")).toBeLessThan(at("rpc:converge_inbound_notifications"));
  });

  it("NEW form: a duplicate delivery is idempotent — no second download, upload or DELETE", async () => {
    const m = fresh();
    const handler = await loadCallback(m);
    expect((await handler(signedOver(NEW_AGENT))).status).toBe(200);
    const again = await handler(signedOver(NEW_AGENT));
    expect(again.status).toBe(200);
    expect(m.downloads).toHaveLength(1);
    expect(m.uploads).toHaveLength(1);
    expect(m.fetches.filter((f) => f.method === "DELETE")).toHaveLength(1);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].status).toBe("stored");
  });

  it("LEGACY COMPATIBILITY: a correctly signed legacy agent:<uuid> callback still proceeds through the pipeline", async () => {
    const m = fresh();
    const handler = await loadCallback(m);
    const res = await handler(signedOver(LEGACY_AGENT));
    expect(res.status).toBe(200);
    expect(upsertArgs(m)).toEqual([expect.objectContaining({ p_mailbox: `agent:${AGENT}`, p_status: "stored", p_attempt_id: ATTEMPT })]);
    expect(m.rows[0].source_cleanup_state).toBe("deleted");
  });

  it("GROUP unchanged: a signed legacy group callback is stored as the group mailbox", async () => {
    const m = fresh();
    const handler = await loadCallback(m);
    const res = await handler(signedOver(GROUP));
    expect(res.status).toBe(200);
    expect(upsertArgs(m)).toEqual([expect.objectContaining({ p_mailbox: "group", p_status: "stored" })]);
  });

  it("OLD-DEFECT NEGATIVE CONTROL: signed over one colon canonicalization, delivered with another ⇒ 403, nothing written", async () => {
    // Twilio-side canonicalization differs from the received bytes: the historical failure is still representable.
    for (const [signed, sent] of [
      [`?source=voicemail&mailbox=agent:${AGENT}&${ids}`, LEGACY_AGENT], // signed decoded, received %3A
      [LEGACY_AGENT, `?source=voicemail&mailbox=agent:${AGENT}&${ids}`], // signed %3A, received decoded
    ]) {
      const m = fresh();
      const handler = await loadCallback(m);
      const res = await handler(signedOver(signed, sent));
      expect(res.status).toBe(403);
      expectNothingTouched(m);
    }
  });

  it.each([
    ["mailbox_agent_id changed after signing", NEW_AGENT, NEW_AGENT.replace(AGENT, AGENT2), {}],
    ["agent mailbox swapped to group after signing", NEW_AGENT, GROUP, {}],
    ["group mailbox swapped to agent after signing", GROUP, NEW_AGENT, {}],
    ["body parameter changed after signing", NEW_AGENT, NEW_AGENT, { sentParams: { ...CALLBACK_PARAMS, RecordingDuration: "8" } }],
    ["signed with another token", NEW_AGENT, NEW_AGENT, { token: "someone-elses-token" }],
    ["no signature at all", NEW_AGENT, NEW_AGENT, { noSignature: true }],
  ] as const)("TAMPERED (%s) ⇒ 403 with zero persistence", async (_label, signed, sent, opts) => {
    const m = fresh();
    const handler = await loadCallback(m);
    const res = await handler(signedOver(signed, sent, opts as Parameters<typeof signedOver>[2]));
    expect(res.status).toBe(403);
    expectNothingTouched(m);
  });

  it.each([
    ["legacy agent + mailbox_agent_id (same id)", `?source=voicemail&mailbox=agent%3A${AGENT}&mailbox_agent_id=${AGENT}&${ids}`, "conflicting_mailbox"],
    ["legacy agent + a different mailbox_agent_id", `?source=voicemail&mailbox=agent%3A${AGENT}&mailbox_agent_id=${AGENT2}&${ids}`, "conflicting_mailbox"],
    ["group + mailbox_agent_id", `?source=voicemail&mailbox=group&mailbox_agent_id=${AGENT}&${ids}`, "conflicting_mailbox"],
    ["mailbox=agent without an id", `?source=voicemail&mailbox=agent&${ids}`, "invalid_mailbox_agent_id"],
    ["mailbox=agent with a non-UUID id", `?source=voicemail&mailbox=agent&mailbox_agent_id=nope&${ids}`, "invalid_mailbox_agent_id"],
    ["upper-case legacy prefix", `?source=voicemail&mailbox=AGENT%3A${AGENT}&${ids}`, "invalid_mailbox"],
    ["duplicated mailbox_agent_id", `?source=voicemail&mailbox=agent&mailbox_agent_id=${AGENT}&mailbox_agent_id=${AGENT2}&${ids}`, "duplicate_param"],
    ["duplicated mailbox", `?source=voicemail&mailbox=group&mailbox=agent&mailbox_agent_id=${AGENT}&${ids}`, "duplicate_param"],
  ])("FAIL CLOSED after a VALID signature (%s) ⇒ acknowledged, nothing read or written, no query value logged", async (_label, search, reason) => {
    const m = fresh();
    const handler = await loadCallback(m);
    const res = await handler(signedOver(search));
    expect(res.status).toBe(200); // acknowledged; the Twilio source is preserved (no DELETE)
    expectNothingTouched(m);
    const out = consoleText();
    expect(out).toContain(reason);
    for (const v of [AGENT, AGENT2, CALL_ROW, ORG, ATTEMPT]) expect(out).not.toContain(v);
  });

  it.each([
    ["source=x then source=voicemail", `?source=x&source=voicemail&mailbox=group&${ids}`],
    ["source=voicemail then source=x", `?source=voicemail&source=x&mailbox=group&${ids}`],
    ["source=Voicemail (wrong case)", `?source=Voicemail&mailbox=group&${ids}`],
  ])("DISPATCH GUARD (%s) ⇒ acknowledged, never the conversation-recording pipeline", async (_label, search) => {
    const m = fresh();
    const handler = await loadCallback(m);
    const res = await handler(signedOver(search));
    expect(res.status).toBe(200);
    expectNothingTouched(m); // in particular: no `calls` read, no download, upload or DELETE
  });

  it("CONTROL: a callback with NO source still takes the conversation-recording path (it reads `calls`)", async () => {
    const m = fresh();
    const handler = await loadCallback(m);
    const res = await handler(signedOver(""));
    expect(res.status).toBe(200); // unmatched CallSid in this model: acknowledged without download/upload/delete
    expect(m.tables).toContain("calls");
    expect(m.fetches).toEqual([]);
  });

  it("LOG HYGIENE: the success log carries the mailbox TYPE only — never the mailbox identity or other query values", async () => {
    for (const [search, kind] of [[NEW_AGENT, "agent"], [LEGACY_AGENT, "agent"], [GROUP, "group"]] as const) {
      vi.mocked(console.log).mockClear(); vi.mocked(console.warn).mockClear(); vi.mocked(console.error).mockClear();
      const m = fresh();
      const handler = await loadCallback(m);
      expect((await handler(signedOver(search))).status).toBe(200);
      const pipelineLog = vi.mocked(console.log).mock.calls.find((c) => String(c[0]).includes("voicemail pipeline"));
      expect(pipelineLog?.[1]).toEqual({ recordingSid: REC, callSid: CALL_SID, mailbox_kind: kind, outcome: "stored" });
      const out = consoleText();
      for (const v of [AGENT, CALL_ROW, ATTEMPT, `agent:${AGENT}`]) expect(out).not.toContain(v);
    }
  });
});
