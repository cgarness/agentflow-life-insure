/**
 * Campaigns table column preferences (src/lib/campaigns-table/prefs.ts).
 *
 * Pins: the read is the caller's own `user_preferences` row (eq user_id + maybeSingle) and never
 * writes; the stored layout lives under one org-namespaced key and every other settings key and
 * every other organization's entry survives a merge; a write is a compare-and-set on the EXACT
 * `updated_at` string PostgREST returned, a zero-row update is a conflict (re-read + one retry,
 * never a success), a concurrent insert (23505) falls back to the CAS update path, a failed read
 * or a superseded owner sends no write at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { method: string; args: unknown[] };
type Resp = { data?: unknown; error?: unknown; count?: number | null };
interface Op {
  kind: "from" | "rpc";
  target: string;
  rpcArgs: unknown[];
  calls: Call[];
  signal: AbortSignal | null;
}
type Scripted = Resp | ((op: Op) => Resp);

const h = vi.hoisted(() => ({
  ops: [] as Op[],
  queue: [] as Scripted[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const CHAIN = ["select", "eq", "is", "in", "order", "range", "update", "insert"];
  function respond(op: Op): Promise<Resp> {
    const next = h.queue.shift();
    if (!next) return Promise.reject(new Error(`unscripted ${op.kind} ${op.target}`));
    const r = typeof next === "function" ? next(op) : next;
    return Promise.resolve({ data: null, error: null, ...r });
  }
  function builder(op: Op) {
    h.ops.push(op);
    let settled: Promise<Resp> | null = null;
    const run = () => (settled ??= respond(op));
    const b: Record<string, unknown> = {};
    for (const m of CHAIN) {
      b[m] = (...args: unknown[]) => {
        op.calls.push({ method: m, args });
        return b;
      };
    }
    b.abortSignal = (signal: AbortSignal) => {
      op.calls.push({ method: "abortSignal", args: [signal] });
      op.signal = signal;
      return b;
    };
    b.maybeSingle = () => {
      op.calls.push({ method: "maybeSingle", args: [] });
      return run();
    };
    b.then = (resolve: (v: Resp) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject);
    return b;
  }
  return {
    supabase: {
      from: (table: string) => builder({ kind: "from", target: table, rpcArgs: [], calls: [], signal: null }),
      rpc: (name: string, ...rest: unknown[]) => builder({ kind: "rpc", target: name, rpcArgs: rest, calls: [], signal: null }),
    },
  };
});

import {
  CAMPAIGNS_TABLE_PREFS_KEY,
  CampaignsPrefsError,
  CampaignsPrefsSupersededError,
  layoutFromSettings,
  mergeLayoutIntoSettings,
  readPrefsRow,
  writeColumnLayout,
} from "@/lib/campaigns-table/prefs";
import { DEFAULT_COLUMN_LAYOUT, normalizeColumnLayout, type ColumnLayout } from "@/lib/campaigns-table/columns";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
// Microsecond precision + explicit offset: a Date round-trip would turn this into "...07.123Z".
const TS1 = "2026-10-09T14:03:07.123456+00:00";
const TS2 = "2026-10-09T14:03:09.654321+00:00";

const CUSTOM: ColumnLayout = {
  order: ["agents", "status", "progress", "converted", "contacted", "created", "tags", "last_dialed"],
  hidden: ["tags", "last_dialed"],
};
const OTHER_LAYOUT = {
  order: ["status", "progress", "agents", "converted", "contacted", "created", "tags", "last_dialed"],
  hidden: ["converted"],
};

const argsOf = (op: Op, method: string) => op.calls.filter((c) => c.method === method).map((c) => c.args);
const methodsOf = (op: Op) => op.calls.map((c) => c.method);
const isWrite = (op: Op) => op.calls.some((c) => c.method === "update" || c.method === "insert");
const isRead = (op: Op) => op.calls.some((c) => c.method === "maybeSingle");

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}

const rowResp = (settings: unknown, updatedAt: string | null): Resp => ({
  data: { settings, updated_at: updatedAt },
  error: null,
});
const NO_ROW: Resp = { data: null, error: null };
const UPDATED: Resp = { data: [{ updated_at: TS2 }], error: null };

beforeEach(() => {
  h.ops = [];
  h.queue = [];
});
afterEach(() => {
  // Every scripted response was consumed: no test silently stops short of the calls it scripted.
  expect(h.queue).toHaveLength(0);
});

describe("readPrefsRow", () => {
  it("reads only the caller's row (settings + updated_at, eq user_id, maybeSingle) and never writes", async () => {
    const ctrl = new AbortController();
    h.queue.push(rowResp({ theme: "dark" }, TS1));

    const row = await readPrefsRow(USER, ctrl.signal);

    expect(row).toEqual({ exists: true, settings: { theme: "dark" }, updatedAt: TS1 });
    expect(h.ops).toHaveLength(1);
    const [op] = h.ops;
    expect(op.kind).toBe("from");
    expect(op.target).toBe("user_preferences");
    expect(op.calls).toEqual([
      { method: "select", args: ["settings, updated_at"] },
      { method: "eq", args: ["user_id", USER] },
      { method: "abortSignal", args: [ctrl.signal] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(isWrite(op)).toBe(false);
  });

  it("does not attach an abort signal when none is given", async () => {
    h.queue.push(rowResp({}, TS1));
    await readPrefsRow(USER);
    expect(methodsOf(h.ops[0])).toEqual(["select", "eq", "maybeSingle"]);
  });

  it("returns updated_at verbatim (no Date normalization)", async () => {
    h.queue.push(rowResp({}, TS1));
    const row = await readPrefsRow(USER);
    expect(row.updatedAt).toBe(TS1);
    expect(row.updatedAt).not.toBe(new Date(TS1).toISOString());
  });

  it("maps a missing updated_at to null", async () => {
    h.queue.push({ data: { settings: {} }, error: null });
    expect((await readPrefsRow(USER)).updatedAt).toBeNull();
  });

  it("no row → exists:false with empty settings and null updatedAt", async () => {
    h.queue.push(NO_ROW);
    expect(await readPrefsRow(USER)).toEqual({ exists: false, settings: {}, updatedAt: null });
  });

  it("a provider error → CampaignsPrefsError(kind read) carrying the raw error", async () => {
    const providerError = { code: "42501", message: "permission denied" };
    h.queue.push({ data: null, error: providerError });

    const err = await caught(readPrefsRow(USER));

    expect(err).toBeInstanceOf(CampaignsPrefsError);
    expect(err).toMatchObject({ kind: "read", cause: providerError, name: "CampaignsPrefsError" });
  });

  it.each([
    ["null", null],
    ["an array", [{ campaigns_table: {} }]],
    ["a string", "{\"campaigns_table\":{}}"],
    ["a number", 42],
    ["a boolean", true],
  ])("settings that are %s → CampaignsPrefsError(kind unsupported)", async (_label, settings) => {
    h.queue.push(rowResp(settings, TS1));
    const err = await caught(readPrefsRow(USER));
    expect(err).toBeInstanceOf(CampaignsPrefsError);
    expect(err).toMatchObject({ kind: "unsupported" });
  });
});

describe("layoutFromSettings", () => {
  it("nothing saved → the defaults", () => {
    expect(layoutFromSettings({}, ORG)).toEqual(DEFAULT_COLUMN_LAYOUT);
    expect(layoutFromSettings({ theme: "dark" }, ORG)).toEqual(DEFAULT_COLUMN_LAYOUT);
  });

  it("reads this organization's entry", () => {
    const settings = { [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [ORG]: CUSTOM, [OTHER_ORG]: OTHER_LAYOUT } } };
    expect(layoutFromSettings(settings, ORG)).toEqual(CUSTOM);
  });

  it("ignores another organization's entry", () => {
    const settings = { [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT } } };
    expect(layoutFromSettings(settings, ORG)).toEqual(DEFAULT_COLUMN_LAYOUT);
    expect(layoutFromSettings(settings, OTHER_ORG)).toEqual(OTHER_LAYOUT);
  });

  it("normalizes a stale entry (unknown ids dropped, newer columns added with default visibility)", () => {
    const settings = {
      [CAMPAIGNS_TABLE_PREFS_KEY]: {
        v: 1,
        orgs: {
          [ORG]: {
            order: ["agents", "status", "legacy_col", "progress", "converted", "contacted", "created", "tags"],
            hidden: ["legacy_col", "tags"],
          },
        },
      },
    };
    expect(layoutFromSettings(settings, ORG)).toEqual({
      order: ["agents", "status", "progress", "converted", "contacted", "created", "tags", "last_dialed"],
      hidden: ["tags", "last_dialed"],
    });
  });

  it.each([
    ["a string container", "campaigns"],
    ["an array container", [CUSTOM]],
    ["a newer version", { v: 2, orgs: { [ORG]: CUSTOM } }],
    ["a missing version", { orgs: { [ORG]: CUSTOM } }],
    ["missing orgs", { v: 1 }],
    ["orgs as an array", { v: 1, orgs: [CUSTOM] }],
    ["an entry with a string order", { v: 1, orgs: { [ORG]: { order: "agents,status", hidden: [] } } }],
    ["an entry with non-string ids", { v: 1, orgs: { [ORG]: { order: [1, 2], hidden: [] } } }],
    ["an entry with null hidden", { v: 1, orgs: { [ORG]: { order: CUSTOM.order, hidden: null } } }],
    ["an entry over 64 ids", { v: 1, orgs: { [ORG]: { order: Array.from({ length: 65 }, () => "status"), hidden: [] } } }],
    ["a null entry", { v: 1, orgs: { [ORG]: null } }],
  ])("malformed (%s) → the defaults", (_label, container) => {
    expect(layoutFromSettings({ [CAMPAIGNS_TABLE_PREFS_KEY]: container }, ORG)).toEqual(DEFAULT_COLUMN_LAYOUT);
  });
});

describe("mergeLayoutIntoSettings", () => {
  const base = () => ({
    theme: "dark",
    dashboard_widgets: { order: ["callbacks", "leaderboard"], hidden: [] },
    nested: { deep: { value: 1 } },
    [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT, [ORG]: OTHER_LAYOUT } },
  });

  it("changes only orgs[orgId] and preserves every other settings key and other orgs' entries", () => {
    const settings = base();
    const before = structuredClone(settings);

    const next = mergeLayoutIntoSettings(settings, ORG, CUSTOM);

    expect(next).toEqual({
      theme: "dark",
      dashboard_widgets: { order: ["callbacks", "leaderboard"], hidden: [] },
      nested: { deep: { value: 1 } },
      [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT, [ORG]: CUSTOM } },
    });
    expect(settings).toEqual(before); // input is not mutated
  });

  it("creates the v1 container when nothing is stored yet", () => {
    expect(mergeLayoutIntoSettings({ theme: "light" }, ORG, CUSTOM)).toEqual({
      theme: "light",
      [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [ORG]: CUSTOM } },
    });
  });

  it("stores copies of the layout arrays, not the caller's references", () => {
    const layout: ColumnLayout = { order: [...CUSTOM.order], hidden: [...CUSTOM.hidden] };
    const next = mergeLayoutIntoSettings({}, ORG, layout);
    layout.order.reverse();
    layout.hidden.push("status");
    const stored = (next[CAMPAIGNS_TABLE_PREFS_KEY] as { orgs: Record<string, ColumnLayout> }).orgs[ORG];
    expect(stored).toEqual(CUSTOM);
  });

  it("keeps another organization's entry verbatim even when it is malformed", () => {
    const settings = { [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: "junk-from-a-newer-client" } } };
    expect(mergeLayoutIntoSettings(settings, ORG, CUSTOM)[CAMPAIGNS_TABLE_PREFS_KEY]).toEqual({
      v: 1,
      orgs: { [OTHER_ORG]: "junk-from-a-newer-client", [ORG]: CUSTOM },
    });
  });

  it("null removes only this organization's entry", () => {
    const settings = base();
    const next = mergeLayoutIntoSettings(settings, ORG, null);
    expect(next).toEqual({
      theme: "dark",
      dashboard_widgets: { order: ["callbacks", "leaderboard"], hidden: [] },
      nested: { deep: { value: 1 } },
      [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT } },
    });
    // The original still has this org's entry.
    expect((settings[CAMPAIGNS_TABLE_PREFS_KEY] as { orgs: Record<string, unknown> }).orgs[ORG]).toEqual(OTHER_LAYOUT);
  });

  it.each([
    ["2", 2],
    ["\"1\"", "1"],
    ["0", 0],
    ["null", null],
  ])("an existing container with v = %s → CampaignsPrefsError(kind unsupported)", (_label, v) => {
    const settings = { [CAMPAIGNS_TABLE_PREFS_KEY]: { v, orgs: { [OTHER_ORG]: OTHER_LAYOUT } } };
    let err: unknown;
    try {
      mergeLayoutIntoSettings(settings, ORG, CUSTOM);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CampaignsPrefsError);
    expect(err).toMatchObject({ kind: "unsupported" });
    // Reset is refused too: it would otherwise overwrite a newer format.
    expect(() => mergeLayoutIntoSettings(settings, ORG, null)).toThrow(CampaignsPrefsError);
  });

  it.each([
    ["orgs is a string", { v: 1, orgs: "bad" }],
    ["orgs is missing", { v: 1 }],
    ["orgs is an array", { v: 1, orgs: [OTHER_LAYOUT] }],
    ["the container is a string", "garbage"],
    ["the container is an array", [OTHER_LAYOUT]],
    ["the container is null", null],
  ])("a malformed v1 container (%s) is replaced", (_label, container) => {
    const next = mergeLayoutIntoSettings({ theme: "dark", [CAMPAIGNS_TABLE_PREFS_KEY]: container }, ORG, CUSTOM);
    expect(next).toEqual({ theme: "dark", [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [ORG]: CUSTOM } } });
  });
});

describe("writeColumnLayout", () => {
  const write = (layout: ColumnLayout | null, isCurrent: () => boolean = () => true) =>
    writeColumnLayout({ userId: USER, orgId: ORG, layout, isCurrent });

  it("no row → inserts {user_id, settings} and returns the saved layout", async () => {
    h.queue.push(NO_ROW, { data: null, error: null });

    const saved = await write(CUSTOM);

    expect(saved).toEqual(CUSTOM);
    expect(h.ops).toHaveLength(2);
    const [read, insert] = h.ops;
    expect(isRead(read)).toBe(true);
    expect(argsOf(read, "eq")).toEqual([["user_id", USER]]);
    expect(insert.target).toBe("user_preferences");
    expect(insert.calls).toEqual([
      {
        method: "insert",
        args: [{ user_id: USER, settings: { [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [ORG]: CUSTOM } } } }],
      },
    ]);
  });

  it("existing row → compare-and-set update on user_id AND the exact observed updated_at, selecting updated_at", async () => {
    const stored = {
      theme: "dark",
      dashboard_widgets: { order: ["callbacks"], hidden: [] },
      [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT } },
    };
    h.queue.push(rowResp(stored, TS1), UPDATED);

    const saved = await write(CUSTOM);

    expect(saved).toEqual(CUSTOM);
    expect(h.ops).toHaveLength(2);
    const update = h.ops[1];
    expect(update.target).toBe("user_preferences");
    expect(update.calls).toEqual([
      {
        method: "update",
        args: [
          {
            settings: {
              theme: "dark",
              dashboard_widgets: { order: ["callbacks"], hidden: [] },
              [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT, [ORG]: CUSTOM } },
            },
          },
        ],
      },
      { method: "eq", args: ["user_id", USER] },
      { method: "eq", args: ["updated_at", TS1] },
      { method: "select", args: ["updated_at"] },
    ]);
    // Exactly the string PostgREST returned — never a Date round-trip.
    expect(argsOf(update, "eq")[1][1]).toBe(TS1);
    expect(h.ops.some((op) => argsOf(op, "insert").length > 0)).toBe(false);
  });

  it("an existing row with a null updated_at filters with .is(updated_at, null)", async () => {
    h.queue.push(rowResp({}, null), UPDATED);

    await write(CUSTOM);

    const update = h.ops[1];
    expect(methodsOf(update)).toEqual(["update", "eq", "is", "select"]);
    expect(argsOf(update, "eq")).toEqual([["user_id", USER]]);
    expect(argsOf(update, "is")).toEqual([["updated_at", null]]);
  });

  it.each([
    ["an empty array", []],
    ["null", null],
  ])("a zero-row update (%s) re-reads, retries once with the new updated_at, then fails with conflict", async (_label, data) => {
    h.queue.push(
      rowResp({ theme: "dark" }, TS1),
      { data, error: null },
      rowResp({ theme: "dark", added_elsewhere: true }, TS2),
      { data, error: null },
    );

    const err = await caught(write(CUSTOM));

    expect(err).toBeInstanceOf(CampaignsPrefsError);
    expect(err).toMatchObject({ kind: "conflict" });
    expect(h.ops).toHaveLength(4); // read, update, read, update — no third attempt
    expect(h.ops.map((op) => (isRead(op) ? "read" : isWrite(op) ? "write" : "other"))).toEqual([
      "read",
      "write",
      "read",
      "write",
    ]);
    expect(argsOf(h.ops[1], "eq")).toEqual([["user_id", USER], ["updated_at", TS1]]);
    expect(argsOf(h.ops[3], "eq")).toEqual([["user_id", USER], ["updated_at", TS2]]);
    // The retry merges onto the re-read settings, not the stale first read.
    expect(argsOf(h.ops[3], "update")[0][0]).toEqual({
      settings: { theme: "dark", added_elsewhere: true, [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [ORG]: CUSTOM } } },
    });
  });

  it("a zero-row update followed by a successful retry resolves with the saved layout", async () => {
    h.queue.push(rowResp({}, TS1), { data: [], error: null }, rowResp({ other: 1 }, TS2), UPDATED);

    await expect(write(CUSTOM)).resolves.toEqual(CUSTOM);
    expect(h.ops).toHaveLength(4);
    expect(argsOf(h.ops[3], "eq")[1]).toEqual(["updated_at", TS2]);
  });

  it("an update error → CampaignsPrefsError(kind write) with no retry", async () => {
    const providerError = { code: "42501", message: "rls" };
    h.queue.push(rowResp({}, TS1), { data: null, error: providerError });

    const err = await caught(write(CUSTOM));

    expect(err).toBeInstanceOf(CampaignsPrefsError);
    expect(err).toMatchObject({ kind: "write", cause: providerError });
    expect(h.ops).toHaveLength(2);
  });

  it("insert 23505 (row created concurrently) → re-read → CAS update, never a blind update", async () => {
    h.queue.push(
      NO_ROW,
      { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
      rowResp({ theme: "light", [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT } } }, TS2),
      UPDATED,
    );

    const saved = await write(CUSTOM);

    expect(saved).toEqual(CUSTOM);
    expect(h.ops).toHaveLength(4);
    const [read1, insert, read2, update] = h.ops;
    expect(isRead(read1)).toBe(true);
    expect(argsOf(insert, "insert")).toHaveLength(1);
    expect(isRead(read2)).toBe(true);
    expect(update.calls).toEqual([
      {
        method: "update",
        args: [
          {
            settings: {
              theme: "light",
              [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT, [ORG]: CUSTOM } },
            },
          },
        ],
      },
      { method: "eq", args: ["user_id", USER] },
      { method: "eq", args: ["updated_at", TS2] },
      { method: "select", args: ["updated_at"] },
    ]);
  });

  it("a second 23505 ends in conflict and never sends an update", async () => {
    const dup = { data: null, error: { code: "23505" } };
    h.queue.push(NO_ROW, dup, NO_ROW, dup);

    const err = await caught(write(CUSTOM));

    expect(err).toMatchObject({ kind: "conflict" });
    expect(h.ops.some((op) => argsOf(op, "update").length > 0)).toBe(false);
  });

  it("any other insert error → CampaignsPrefsError(kind write) with no retry", async () => {
    const providerError = { code: "42501", message: "rls" };
    h.queue.push(NO_ROW, { data: null, error: providerError });

    const err = await caught(write(CUSTOM));

    expect(err).toMatchObject({ kind: "write", cause: providerError });
    expect(h.ops).toHaveLength(2);
  });

  it("a read error throws kind read and sends NO write", async () => {
    h.queue.push({ data: null, error: { message: "network" } });

    const err = await caught(write(CUSTOM));

    expect(err).toBeInstanceOf(CampaignsPrefsError);
    expect(err).toMatchObject({ kind: "read" });
    expect(h.ops).toHaveLength(1);
    expect(h.ops.some(isWrite)).toBe(false);
  });

  it("a read error on the retry throws kind read and sends no second write", async () => {
    h.queue.push(rowResp({}, TS1), { data: [], error: null }, { data: null, error: { message: "network" } });

    const err = await caught(write(CUSTOM));

    expect(err).toMatchObject({ kind: "read" });
    expect(h.ops.filter(isWrite)).toHaveLength(1);
  });

  it("an unsupported stored format throws kind unsupported and sends NO write", async () => {
    h.queue.push(rowResp({ [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 2, orgs: {} } }, TS1));

    const err = await caught(write(CUSTOM));

    expect(err).toMatchObject({ kind: "unsupported" });
    expect(h.ops.some(isWrite)).toBe(false);
  });

  it("isCurrent() turning false during the read → CampaignsPrefsSupersededError and NO write", async () => {
    let current = true;
    const isCurrent = vi.fn(() => current);
    h.queue.push(() => {
      current = false; // the owner (user/org) changed while the read was in flight
      return rowResp({}, TS1);
    });

    const err = await caught(write(CUSTOM, isCurrent));

    expect(err).toBeInstanceOf(CampaignsPrefsSupersededError);
    expect(isCurrent).toHaveBeenCalled();
    expect(h.ops).toHaveLength(1);
    expect(h.ops.some(isWrite)).toBe(false);
  });

  it("isCurrent() is re-checked after the retry read: superseded there → no second write", async () => {
    let current = true;
    h.queue.push(rowResp({}, TS1), { data: [], error: null }, () => {
      current = false;
      return rowResp({}, TS2);
    });

    const err = await caught(write(CUSTOM, () => current));

    expect(err).toBeInstanceOf(CampaignsPrefsSupersededError);
    expect(h.ops.filter(isWrite)).toHaveLength(1);
  });

  it("reset (layout null) removes only this organization's entry and returns the defaults", async () => {
    h.queue.push(
      rowResp({ theme: "dark", [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [ORG]: CUSTOM, [OTHER_ORG]: OTHER_LAYOUT } } }, TS1),
      UPDATED,
    );

    const saved = await write(null);

    expect(saved).toEqual(DEFAULT_COLUMN_LAYOUT);
    expect(argsOf(h.ops[1], "update")[0][0]).toEqual({
      settings: { theme: "dark", [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs: { [OTHER_ORG]: OTHER_LAYOUT } } },
    });
  });

  it("returns the normalized saved layout, not the raw input", async () => {
    const partial: ColumnLayout = { order: ["agents", "status"], hidden: [] };
    h.queue.push(NO_ROW, { data: null, error: null });

    const saved = await write(partial);

    expect(saved).toEqual(normalizeColumnLayout(partial));
    expect(saved.order).toHaveLength(DEFAULT_COLUMN_LAYOUT.order.length);
    expect(new Set(saved.order)).toEqual(new Set(DEFAULT_COLUMN_LAYOUT.order));
    expect(saved).not.toBe(partial);
  });
});
