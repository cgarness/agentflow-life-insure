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
    from: (t: string) => builder(t),
    storage: {
      from: () => ({
        upload: async (p: string) => { model.uploads.push(p); return { data: { path: p }, error: null }; },
        remove: async () => ({ data: [], error: null }),
      }),
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      model.rpcs.push({ fn, args });
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
    if (init?.method === "DELETE") return new Response(null, { status: model.deleteStatus });
    model.downloads.push(u);
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
    cleanupBatch: async (limit) => ({
      data: model.rows
        .filter((r) => ["stored", "purged"].includes(r.status) && r.source_cleanup_state !== "deleted" && r.source_cleanup_attempts < 50)
        .slice(0, limit)
        .map((r) => ({
          id: r.id, recording_sid: r.recording_sid,
          provider_account_sid: r.provider_account_sid, source_cleanup_attempts: r.source_cleanup_attempts,
        })),
      error: null,
    }),
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
  return { fetches: [], rpcs: [], uploads: [], downloads: [], deleteStatus: 503, ...over };
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

    const out = await runWorker(m);
    expect(out.unresolved_ownership).toBe(1);
    expect(out.provider_deletions).toBe(0);
    expect(m.rows[0].source_cleanup_state).not.toBe("deleted");
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
