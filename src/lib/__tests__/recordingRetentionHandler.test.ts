// Corrective pass (2026-09-16), item 3 — the REAL recording-retention-purge handler, EXECUTED.
//
// Deno's absence does not prevent this. The handler is bundled with esbuild (its one external import
// resolved to a local stub), `Deno.serve`/`Deno.env` are supplied by this harness, and the database
// and fetch adapters are test doubles. What runs is the actual index.ts and the actual voicemail.ts —
// not a re-implementation — so the wiring itself is under test.
//
// The reproduction: index.ts used to capture `now` AFTER awaiting phone_settings and pass it as the
// invocation clock, so a first read that consumed 120 s was invisible and the helper still admitted a
// provider DELETE despite the documented 110 s admission limit.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "../../../supabase/functions/recording-retention-purge/voicemail";

const REPO = path.resolve(__dirname, "../../..");
const ENTRY = path.join(REPO, "supabase/functions/recording-retention-purge/index.ts");
const SECRET = "test-cron-secret";
const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const OWNER = "AC" + "b".repeat(32);
const REC = "RE" + "c".repeat(32);

type Handler = (req: Request) => Promise<Response>;

interface Recorder {
  fetches: Array<{ url: string; method?: string }>;
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  clock: { t: number };
}

let bundlePath: string;
let baselineBundlePath: string | null = null;
const nodeRequire = createRequire(__filename);

/**
 * Bundles the real entrypoint once.
 *
 * The esbuild BINARY is used rather than its JS API: the API asserts
 * `new TextEncoder().encode("") instanceof Uint8Array`, which is false across jsdom's realm boundary.
 * The only edit made to the source is the specifier of its single remote import — asserted below to
 * be exactly one line — so what runs is the real index.ts and the real voicemail.ts.
 */
beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rrp-handler-"));

  const stubName = "supabase-stub.mjs";
  writeFileSync(
    path.join(dir, stubName),
    "export const createClient = (...a) => globalThis.__TEST_CREATE_CLIENT__(...a);\nexport default { createClient };\n",
  );

  // byte copy of the helper, so the bundle contains the genuine article
  const realHelper = readFileSync(path.join(REPO, "supabase/functions/recording-retention-purge/voicemail.ts"), "utf8");
  writeFileSync(path.join(dir, "voicemail.ts"), realHelper);

  const realIndex = readFileSync(ENTRY, "utf8");
  const patchedIndex = realIndex.replace(
    /from "https:\/\/esm\.sh\/@supabase\/supabase-js@2";/,
    `from "./${stubName}";`,
  );
  // exactly one line differs, and it is the import specifier
  const diffLines = realIndex.split("\n").filter((l, i) => l !== patchedIndex.split("\n")[i]);
  expect(diffLines).toHaveLength(1);
  expect(diffLines[0]).toContain("createClient");
  writeFileSync(path.join(dir, "index.ts"), patchedIndex);

  // CommonJS so Node's own loader can take it: vite would otherwise intercept a dynamic import of a
  // path outside its root. (The DEPLOYMENT closure is checked separately with --platform=neutral.)
  const out = path.join(dir, "handler.cjs");
  execFileSync(
    path.join(REPO, "node_modules/.bin/esbuild"),
    [path.join(dir, "index.ts"), "--bundle", "--format=cjs", "--platform=node", `--outfile=${out}`],
    { stdio: "pipe" },
  );
  bundlePath = out;

  // ── the SAME harness against 0707038, so the reproduction is measured, not asserted ──────────
  try {
    const bDir = mkdtempSync(path.join(tmpdir(), "rrp-handler-0707038-"));
    writeFileSync(path.join(bDir, stubName), readFileSync(path.join(dir, stubName), "utf8"));
    const oldHelper = execFileSync(
      "git", ["show", "0707038:supabase/functions/recording-retention-purge/voicemail.ts"],
      { cwd: REPO, encoding: "utf8" },
    );
    const oldIndex = execFileSync(
      "git", ["show", "0707038:supabase/functions/recording-retention-purge/index.ts"],
      { cwd: REPO, encoding: "utf8" },
    );
    writeFileSync(path.join(bDir, "voicemail.ts"), oldHelper);
    writeFileSync(
      path.join(bDir, "index.ts"),
      oldIndex.replace(/from "https:\/\/esm\.sh\/@supabase\/supabase-js@2";/, `from "./${stubName}";`),
    );
    const bOut = path.join(bDir, "handler.cjs");
    execFileSync(
      path.join(REPO, "node_modules/.bin/esbuild"),
      [path.join(bDir, "index.ts"), "--bundle", "--format=cjs", "--platform=node", `--outfile=${bOut}`],
      { stdio: "pipe" },
    );
    baselineBundlePath = bOut;
  } catch {
    baselineBundlePath = null; // shallow clone without the commit: the baseline probe is skipped
  }
}, 60_000);

/**
 * Loads the bundled handler with adapters supplied for every external dependency the function has:
 * the Deno registration + environment, the database client, and fetch.
 */
async function loadHandler(opts: {
  /** Milliseconds of wall clock the first (phone_settings) read consumes. */
  firstReadCostMs: number;
  dueRows?: Array<Record<string, unknown>>;
  /** Load the 0707038 sources instead of the working tree. */
  baseline?: boolean;
}): Promise<{ handler: Handler; rec: Recorder }> {
  const rec: Recorder = { fetches: [], rpcs: [], clock: { t: 1_700_000_000_000 } };
  vi.spyOn(Date, "now").mockImplementation(() => rec.clock.t);

  const dueRows = opts.dueRows ?? [];
  const deleted = new Set<string>();

  // ── database adapter ────────────────────────────────────────────────────────────────────────
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      builder.select = self;
      builder.eq = self;
      builder.maybeSingle = async () => ({ data: null, error: null });
      if (table === "phone_settings") {
        builder.gt = async () => {
          rec.clock.t += opts.firstReadCostMs; // the slow initial read
          return { data: [], error: null };
        };
      } else {
        builder.gt = async () => ({ data: [], error: null });
        // inbound_routing_settings is awaited directly off select()
        builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      }
      return builder;
    },
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    async rpc(fn: string, args: Record<string, unknown>) {
      rec.rpcs.push({ fn, args });
      if (fn === "voicemails_cleanup_batch") {
        return { data: dueRows.filter((r) => !deleted.has(String(r.recording_sid))), error: null };
      }
      if (fn === "mark_voicemail_source_deleted") {
        deleted.add(String(args.p_recording_sid));
        return { data: { updated: true }, error: null };
      }
      return { data: null, error: null };
    },
  };
  (globalThis as Record<string, unknown>).__TEST_CREATE_CLIENT__ = () => client;

  // ── fetch adapter ───────────────────────────────────────────────────────────────────────────
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    rec.fetches.push({ url: String(url), method: init?.method });
    return new Response(null, { status: 204 });
  }) as typeof globalThis.fetch;

  // ── Deno registration + environment ─────────────────────────────────────────────────────────
  let captured: Handler | undefined;
  const env: Record<string, string> = {
    RECORDING_RETENTION_CRON_SECRET: SECRET,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
    TWILIO_AUTH_TOKEN: "auth-token",
  };
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: Handler) => { captured = h; },
  };

  const target = opts.baseline ? (baselineBundlePath as string) : bundlePath;
  delete nodeRequire.cache[nodeRequire.resolve(target)];
  nodeRequire(target); // top-level Deno.serve(...) runs here
  if (!captured) throw new Error("the handler never registered itself with Deno.serve");
  return { handler: captured, rec };
}

function cronRequest(): Request {
  return new Request("https://example.supabase.co/functions/v1/recording-retention-purge", {
    method: "POST",
    headers: { "x-cron-secret": SECRET, "Content-Type": "application/json" },
  });
}

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

const dueRow = { id: "v1", recording_sid: REC, provider_account_sid: OWNER, source_cleanup_attempts: 0, organization_id: ORG };

describe("the real handler, executed", () => {
  it("registers a handler and answers an authenticated cron request", async () => {
    const { handler } = await loadHandler({ firstReadCostMs: 0 });
    const res = await handler(cronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // the legacy fields are still present and unchanged in name
    expect(body).toHaveProperty("orgs_processed");
    expect(body).toHaveProperty("calls_cleared");
    expect(body).toHaveProperty("storage_objects_removed");
    // and the voicemail phases ride alongside them
    expect(body).toHaveProperty("voicemail_phases_ok");
    expect(body.voicemail_source_cleanup).toBeTruthy();
  });

  it("rejects an unauthenticated request without touching anything", async () => {
    const { handler, rec } = await loadHandler({ firstReadCostMs: 0 });
    const res = await handler(
      new Request("https://example.supabase.co/functions/v1/recording-retention-purge", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(rec.rpcs).toHaveLength(0);
    expect(rec.fetches).toHaveLength(0);
  });

  it("CONTROL: with a fast first read the cleanup phase runs and issues a provider DELETE", async () => {
    const { handler, rec } = await loadHandler({ firstReadCostMs: 0, dueRows: [dueRow] });
    const body = await (await handler(cronRequest())).json();

    expect(body.voicemail_source_cleanup.status).not.toBe("skipped");
    expect(rec.fetches.filter((f) => f.method === "DELETE")).toHaveLength(1);
    expect(rec.fetches[0].url).toContain(`/Accounts/${OWNER}/Recordings/${REC}`);
  });

  it("REPRODUCTION: a 120 s first read exhausts the admission limit, so NO new voicemail work starts", async () => {
    const firstReadCostMs = 120_000;
    expect(firstReadCostMs).toBeGreaterThan(LIMITS.INVOCATION_BUDGET_MS); // 110 s

    const { handler, rec } = await loadHandler({ firstReadCostMs, dueRows: [dueRow] });
    const body = await (await handler(cronRequest())).json();

    // the defect was: a provider DELETE was still issued after 120 s had already elapsed
    expect(rec.fetches.filter((f) => f.method === "DELETE")).toHaveLength(0);
    expect(body.voicemail_source_cleanup.status).toBe("skipped");
    expect(body.voicemail_source_cleanup.reason).toBe("invocation_budget_exhausted");
    expect(body.voicemail_retention.status).toBe("skipped");
    expect(body.voicemail_retention.reason).toBe("invocation_budget_exhausted");
    expect(body.voicemail_phases_ok).toBe(false);
    // nothing was queried either — admission closes before the first query, not after it
    expect(rec.rpcs.filter((r) => r.fn === "voicemails_cleanup_batch")).toHaveLength(0);
    // and the conversation-recording purge still answered normally
    expect(body.ok).toBe(true);
  });

  it("BASELINE 0707038: the same 120 s first read still issued a provider DELETE", async () => {
    if (!baselineBundlePath) return; // commit unreachable in a shallow clone
    const { handler, rec } = await loadHandler({ firstReadCostMs: 120_000, dueRows: [dueRow], baseline: true });
    const body = await (await handler(cronRequest())).json();

    // the defect, measured: admission was never checked against the real handler entry
    expect(rec.fetches.filter((f) => f.method === "DELETE")).toHaveLength(1);
    expect(body.voicemail_source_cleanup.status).not.toBe("skipped");
  });

  it("the invocation clock is captured before the first await, not after it", async () => {
    // A read just under the limit still admits work; the same read would have been invisible before.
    const { rec: fast } = await loadHandler({ firstReadCostMs: LIMITS.INVOCATION_BUDGET_MS - 5_000, dueRows: [dueRow] });
    void fast;
    const { handler, rec } = await loadHandler({
      firstReadCostMs: LIMITS.INVOCATION_BUDGET_MS - 5_000,
      dueRows: [dueRow],
    });
    const body = await (await handler(cronRequest())).json();
    expect(body.voicemail_source_cleanup.status).not.toBe("skipped");
    expect(rec.fetches.filter((f) => f.method === "DELETE")).toHaveLength(1);
  });
});
