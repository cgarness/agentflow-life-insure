/**
 * Campaigns table reads (src/lib/campaigns-table/queries.ts).
 *
 * Pins: every read is organization-scoped in the query and takes the AbortSignal; lists page by
 * the RAW rows received (a server row cap below the page size cannot end a sweep early) up to the
 * exact count requested on the first page only, de-duplicate ids, stop on an empty page when no
 * count is available, and refuse (too_large) instead of rendering a silently short list; a
 * provider error is a visible `failed`; assignee profiles are chunked; agency status fails open
 * unless the read was aborted; and the shared TanStack options never retry a hard cap.
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
  fallback: null as ((op: Op) => Resp) | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const CHAIN = ["select", "eq", "is", "in", "order", "range", "update", "insert"];
  function respond(op: Op): Promise<Resp> {
    const next = h.queue.shift() ?? h.fallback;
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
  ASSIGNEE_ID_CHUNK,
  CAMPAIGNS_TABLE_QUERY_OPTIONS,
  CAMPAIGN_LIST_MAX_ROWS,
  CAMPAIGN_LIST_PAGE_SIZE,
  CampaignsQueryError,
  fetchAssigneeProfiles,
  fetchCampaignLastDialed,
  fetchCampaignRows,
  fetchCreateModalAgents,
  fetchOrgStatus,
} from "@/lib/campaigns-table/queries";
import { CAMPAIGN_LIST_COLUMNS } from "@/lib/campaigns-table/model";

const ORG = "11111111-1111-4111-8111-111111111111";

const argsOf = (op: Op, method: string) => op.calls.filter((c) => c.method === method).map((c) => c.args);
const rangeOf = (op: Op) => argsOf(op, "range")[0] as [number, number];
/** Whether this request asked PostgREST for an exact count (select options, or rpc options). */
const wantsCount = (op: Op) => {
  const opts = op.kind === "rpc" ? op.rpcArgs[1] : argsOf(op, "select")[0]?.[1];
  return (opts as { count?: string } | undefined)?.count === "exact";
};

/**
 * A fake PostgREST endpoint: honours the requested range but returns at most `cap` rows per
 * response (a server-side max-rows below the client page size), and reports `total` only when
 * the request asked for count=exact.
 */
function cappedServer<T>(rows: T[], cap: number, opts: { count?: boolean } = {}) {
  return (op: Op): Resp => {
    const [from, to] = rangeOf(op);
    const n = Math.min(cap, to - from + 1);
    return {
      data: rows.slice(from, from + n),
      error: null,
      count: opts.count === false ? null : wantsCount(op) ? rows.length : null,
    };
  };
}

const campaignRow = (i: number, extra: Record<string, unknown> = {}) => ({ id: `camp-${i}`, name: `Campaign ${i}`, ...extra });
const makeRows = (n: number) => Array.from({ length: n }, (_, i) => campaignRow(i));

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}

beforeEach(() => {
  h.ops = [];
  h.queue = [];
  h.fallback = null;
});
afterEach(() => {
  expect(h.queue).toHaveLength(0);
});

describe("constants", () => {
  it("page size 500, hard cap 10 000, assignee chunk 100", () => {
    expect(CAMPAIGN_LIST_PAGE_SIZE).toBe(500);
    expect(CAMPAIGN_LIST_MAX_ROWS).toBe(10_000);
    expect(ASSIGNEE_ID_CHUNK).toBe(100);
  });
});

describe("fetchCampaignRows", () => {
  it("selects the explicit projection with count=exact, org-scoped, ordered created_at desc (nulls last) then id", async () => {
    const ctrl = new AbortController();
    const rows = makeRows(3);
    h.fallback = cappedServer(rows, 1000);

    const out = await fetchCampaignRows(ORG, ctrl.signal);

    expect(out).toEqual(rows);
    expect(h.ops).toHaveLength(1);
    const [op] = h.ops;
    expect(op.kind).toBe("from");
    expect(op.target).toBe("campaigns");
    expect(op.calls).toEqual([
      { method: "select", args: [CAMPAIGN_LIST_COLUMNS, { count: "exact" }] },
      { method: "eq", args: ["organization_id", ORG] },
      { method: "order", args: ["created_at", { ascending: false, nullsFirst: false }] },
      { method: "order", args: ["id", { ascending: true }] },
      { method: "range", args: [0, 499] },
      { method: "abortSignal", args: [ctrl.signal] },
    ]);
    // The projection never reads the unmaintained stored metrics.
    expect(CAMPAIGN_LIST_COLUMNS).not.toMatch(/leads_contacted|leads_converted/);
  });

  it("pages by RAW rows received under a 300-row server cap, all the way to the exact count", async () => {
    const ctrl = new AbortController();
    const rows = makeRows(1000);
    h.fallback = cappedServer(rows, 300);

    const out = await fetchCampaignRows(ORG, ctrl.signal);

    expect(out).toHaveLength(1000);
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(h.ops.map(rangeOf)).toEqual([
      [0, 499],
      [300, 799],
      [600, 1099],
      [900, 1399],
    ]);
    // count=exact is requested on the first page only.
    expect(h.ops.map((op) => argsOf(op, "select")[0])).toEqual([
      [CAMPAIGN_LIST_COLUMNS, { count: "exact" }],
      [CAMPAIGN_LIST_COLUMNS, undefined],
      [CAMPAIGN_LIST_COLUMNS, undefined],
      [CAMPAIGN_LIST_COLUMNS, undefined],
    ]);
    for (const op of h.ops) {
      expect(op.target).toBe("campaigns");
      expect(argsOf(op, "eq")).toEqual([["organization_id", ORG]]);
      expect(op.signal).toBe(ctrl.signal);
    }
  });

  it("stops exactly at the count without an extra trailing request", async () => {
    h.fallback = cappedServer(makeRows(600), 300);

    const out = await fetchCampaignRows(ORG);

    expect(out).toHaveLength(600);
    expect(h.ops.map(rangeOf)).toEqual([
      [0, 499],
      [300, 799],
    ]);
  });

  it("de-duplicates ids across pages, keeping the first occurrence", async () => {
    const a = campaignRow(1);
    const b = campaignRow(2, { name: "first copy" });
    const bAgain = campaignRow(2, { name: "second copy" });
    const c = campaignRow(3);
    h.queue.push({ data: [a, b], error: null, count: 3 }, { data: [bAgain, c], error: null, count: null });

    const out = await fetchCampaignRows(ORG);

    expect(out).toEqual([a, b, c]);
    expect(h.ops.map(rangeOf)).toEqual([
      [0, 499],
      [2, 501],
    ]);
  });

  it("with no count available, keeps paging until an empty page", async () => {
    const rows = makeRows(700);
    h.queue.push(
      { data: rows.slice(0, 500), error: null, count: null },
      { data: rows.slice(500), error: null, count: null },
      { data: [], error: null, count: null },
    );

    const out = await fetchCampaignRows(ORG);

    expect(out).toHaveLength(700);
    expect(h.ops.map(rangeOf)).toEqual([
      [0, 499],
      [500, 999],
      [700, 1199],
    ]);
  });

  it("an empty organization resolves [] after one request", async () => {
    h.queue.push({ data: [], error: null, count: 0 });
    await expect(fetchCampaignRows(ORG)).resolves.toEqual([]);
    expect(h.ops).toHaveLength(1);
  });

  it("count above the hard cap → CampaignsQueryError(too_large) without fetching more", async () => {
    h.fallback = (op) => ({ ...cappedServer(makeRows(500), 500)(op), count: CAMPAIGN_LIST_MAX_ROWS + 1 });

    const err = await caught(fetchCampaignRows(ORG));

    expect(err).toBeInstanceOf(CampaignsQueryError);
    expect(err).toMatchObject({ kind: "too_large", name: "CampaignsQueryError" });
    expect(h.ops).toHaveLength(1);
  });

  it("a count exactly at the hard cap is loaded in full", async () => {
    h.fallback = cappedServer(makeRows(CAMPAIGN_LIST_MAX_ROWS), CAMPAIGN_LIST_PAGE_SIZE);

    const out = await fetchCampaignRows(ORG);

    expect(out).toHaveLength(CAMPAIGN_LIST_MAX_ROWS);
    expect(h.ops).toHaveLength(CAMPAIGN_LIST_MAX_ROWS / CAMPAIGN_LIST_PAGE_SIZE);
  });

  it("with no count, receiving more than the hard cap → too_large (no unbounded sweep)", async () => {
    let served = 0;
    h.fallback = () => {
      const data = Array.from({ length: CAMPAIGN_LIST_PAGE_SIZE }, () => campaignRow(served++));
      return { data, error: null, count: null };
    };

    const err = await caught(fetchCampaignRows(ORG));

    expect(err).toMatchObject({ kind: "too_large" });
    expect(h.ops).toHaveLength(CAMPAIGN_LIST_MAX_ROWS / CAMPAIGN_LIST_PAGE_SIZE + 1);
  });

  it("a provider error on the first page → CampaignsQueryError(failed) carrying the raw error", async () => {
    const providerError = { code: "PGRST301", message: "JWT expired" };
    h.queue.push({ data: null, error: providerError, count: null });

    const err = await caught(fetchCampaignRows(ORG));

    expect(err).toBeInstanceOf(CampaignsQueryError);
    expect(err).toMatchObject({ kind: "failed", cause: providerError });
  });

  it("a provider error on a later page rejects (never a partial list)", async () => {
    h.queue.push({ data: makeRows(300), error: null, count: 1000 }, { data: null, error: { message: "boom" } });

    const err = await caught(fetchCampaignRows(ORG));

    expect(err).toMatchObject({ kind: "failed" });
    expect(h.ops).toHaveLength(2);
  });

  it("does not call abortSignal when no signal is given", async () => {
    h.fallback = cappedServer(makeRows(2), 500);
    await fetchCampaignRows(ORG);
    expect(argsOf(h.ops[0], "abortSignal")).toEqual([]);
  });
});

describe("fetchCampaignLastDialed", () => {
  const lastDialedRow = (i: number) => ({
    campaign_id: `camp-${i}`,
    last_dialed_at: i % 3 === 0 ? null : `2026-10-0${(i % 9) + 1}T10:00:00.000001+00:00`,
  });

  it("calls the no-arg RPC with count=exact, ordered by campaign_id, ranged, and maps {id: last_dialed_at}", async () => {
    const ctrl = new AbortController();
    h.queue.push({
      data: [
        { campaign_id: "c1", last_dialed_at: "2026-10-08T21:14:03.512345+00:00" },
        { campaign_id: "c2", last_dialed_at: null },
      ],
      error: null,
      count: 2,
    });

    const out = await fetchCampaignLastDialed(ctrl.signal);

    expect(out).toEqual({ c1: "2026-10-08T21:14:03.512345+00:00", c2: null });
    expect(h.ops).toHaveLength(1);
    const [op] = h.ops;
    expect(op.kind).toBe("rpc");
    expect(op.target).toBe("get_campaign_last_dialed");
    expect(op.rpcArgs).toEqual([undefined, { count: "exact" }]);
    expect(op.calls).toEqual([
      { method: "order", args: ["campaign_id", { ascending: true }] },
      { method: "range", args: [0, 499] },
      { method: "abortSignal", args: [ctrl.signal] },
    ]);
  });

  it("pages by raw rows under a server cap, count requested on the first page only", async () => {
    const ctrl = new AbortController();
    const rows = Array.from({ length: 700 }, (_, i) => lastDialedRow(i));
    h.fallback = cappedServer(rows, 300);

    const out = await fetchCampaignLastDialed(ctrl.signal);

    expect(Object.keys(out)).toHaveLength(700);
    for (const r of rows) expect(out[r.campaign_id]).toBe(r.last_dialed_at);
    expect(h.ops.map(rangeOf)).toEqual([
      [0, 499],
      [300, 799],
      [600, 1099],
    ]);
    expect(h.ops.map((op) => op.rpcArgs)).toEqual([
      [undefined, { count: "exact" }],
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect(h.ops.every((op) => op.signal === ctrl.signal)).toBe(true);
  });

  it("no count → stops on an empty page", async () => {
    h.queue.push({ data: [lastDialedRow(1)], error: null, count: null }, { data: [], error: null, count: null });

    const out = await fetchCampaignLastDialed();

    expect(out).toEqual({ "camp-1": lastDialedRow(1).last_dialed_at });
    expect(h.ops).toHaveLength(2);
    expect(argsOf(h.ops[0], "abortSignal")).toEqual([]);
  });

  it("a provider error → CampaignsQueryError(failed)", async () => {
    const providerError = { message: "function does not exist" };
    h.queue.push({ data: null, error: providerError, count: null });

    const err = await caught(fetchCampaignLastDialed());

    expect(err).toBeInstanceOf(CampaignsQueryError);
    expect(err).toMatchObject({ kind: "failed", cause: providerError });
  });

  it("count above the hard cap → too_large", async () => {
    h.queue.push({ data: [lastDialedRow(1)], error: null, count: CAMPAIGN_LIST_MAX_ROWS + 1 });
    await expect(fetchCampaignLastDialed()).rejects.toMatchObject({ kind: "too_large" });
    expect(h.ops).toHaveLength(1);
  });
});

describe("fetchAssigneeProfiles", () => {
  it("no ids → {} with no request", async () => {
    await expect(fetchAssigneeProfiles(ORG, [])).resolves.toEqual({});
    expect(h.ops).toHaveLength(0);
  });

  it("chunks ids by 100, each chunk org-scoped with .in(id) and the abort signal", async () => {
    const ctrl = new AbortController();
    const ids = Array.from({ length: 250 }, (_, i) => `agent-${i}`);
    h.fallback = (op) => ({
      data: (argsOf(op, "in")[0][1] as string[]).map((id) => ({ id, first_name: "A", last_name: id, avatar_url: null })),
      error: null,
    });

    const out = await fetchAssigneeProfiles(ORG, ids, ctrl.signal);

    expect(Object.keys(out)).toHaveLength(250);
    expect(h.ops).toHaveLength(3);
    const chunks = [ids.slice(0, 100), ids.slice(100, 200), ids.slice(200)];
    h.ops.forEach((op, i) => {
      expect(op.target).toBe("profiles");
      expect(op.calls).toEqual([
        { method: "select", args: ["id, first_name, last_name, avatar_url"] },
        { method: "eq", args: ["organization_id", ORG] },
        { method: "in", args: ["id", chunks[i]] },
        { method: "abortSignal", args: [ctrl.signal] },
      ]);
    });
  });

  it("maps display names and avatars (blank → null), leaving unreturned ids absent", async () => {
    h.queue.push({
      data: [
        { id: "p1", first_name: "Ann", last_name: "Lee", avatar_url: "https://cdn.example/a.png" },
        { id: "p2", first_name: "Bo", last_name: null, avatar_url: "   " },
        { id: "p3", first_name: null, last_name: "Kim", avatar_url: "" },
        { id: "p4", first_name: null, last_name: null, avatar_url: null },
        { id: "p5", first_name: "", last_name: "", avatar_url: undefined },
        { id: "p6", first_name: " ", last_name: "", avatar_url: null },
      ],
      error: null,
    });

    const out = await fetchAssigneeProfiles(ORG, ["p1", "p2", "p3", "p4", "p5", "p6", "missing"]);

    expect(out).toEqual({
      p1: { id: "p1", displayName: "Ann Lee", avatarUrl: "https://cdn.example/a.png" },
      p2: { id: "p2", displayName: "Bo", avatarUrl: null },
      p3: { id: "p3", displayName: "Kim", avatarUrl: null },
      p4: { id: "p4", displayName: null, avatarUrl: null },
      p5: { id: "p5", displayName: null, avatarUrl: null },
      p6: { id: "p6", displayName: null, avatarUrl: null },
    });
    expect(out).not.toHaveProperty("missing");
    expect(argsOf(h.ops[0], "abortSignal")).toEqual([]);
  });

  it("an error in any chunk throws CampaignsQueryError(failed) and stops", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `agent-${i}`);
    const providerError = { message: "boom" };
    h.queue.push({ data: [], error: null }, { data: null, error: providerError });

    const err = await caught(fetchAssigneeProfiles(ORG, ids));

    expect(err).toBeInstanceOf(CampaignsQueryError);
    expect(err).toMatchObject({ kind: "failed", cause: providerError });
    expect(h.ops).toHaveLength(2);
  });
});

describe("fetchCreateModalAgents", () => {
  const agent = (i: number) => ({ id: `u-${i}`, first_name: "F", last_name: `L${i}`, email: `u${i}@x.test`, role: "Agent" });

  it("reads Active same-org profiles, paged by id", async () => {
    const ctrl = new AbortController();
    const rows = [agent(1), agent(2)];
    h.queue.push({ data: rows, error: null, count: 2 });

    const out = await fetchCreateModalAgents(ORG, ctrl.signal);

    expect(out).toEqual(rows);
    expect(h.ops).toHaveLength(1);
    expect(h.ops[0].target).toBe("profiles");
    expect(h.ops[0].calls).toEqual([
      { method: "select", args: ["id, first_name, last_name, email, role", { count: "exact" }] },
      { method: "eq", args: ["organization_id", ORG] },
      { method: "eq", args: ["status", "Active"] },
      { method: "order", args: ["id", { ascending: true }] },
      { method: "range", args: [0, 499] },
      { method: "abortSignal", args: [ctrl.signal] },
    ]);
  });

  it("keeps both filters on every page under a server cap", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => agent(i));
    h.fallback = cappedServer(rows, 300);

    const out = await fetchCreateModalAgents(ORG);

    expect(out).toHaveLength(450);
    expect(h.ops.map(rangeOf)).toEqual([
      [0, 499],
      [300, 799],
    ]);
    for (const op of h.ops) {
      expect(argsOf(op, "eq")).toEqual([
        ["organization_id", ORG],
        ["status", "Active"],
      ]);
    }
  });

  it("a provider error → CampaignsQueryError(failed)", async () => {
    h.queue.push({ data: null, error: { message: "boom" } });
    await expect(fetchCreateModalAgents(ORG)).rejects.toMatchObject({ kind: "failed" });
  });
});

describe("fetchOrgStatus", () => {
  it("reads organizations.status by id with maybeSingle and the abort signal", async () => {
    const ctrl = new AbortController();
    h.queue.push({ data: { status: "suspended" }, error: null });

    await expect(fetchOrgStatus(ORG, ctrl.signal)).resolves.toBe("suspended");
    expect(h.ops).toHaveLength(1);
    expect(h.ops[0].target).toBe("organizations");
    expect(h.ops[0].calls).toEqual([
      { method: "select", args: ["status"] },
      { method: "eq", args: ["id", ORG] },
      { method: "abortSignal", args: [ctrl.signal] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it.each(["active", "suspended", "archived"])("returns the stored status %s", async (status) => {
    h.queue.push({ data: { status }, error: null });
    await expect(fetchOrgStatus(ORG)).resolves.toBe(status);
  });

  it.each([
    ["a missing row", null],
    ["a null status", { status: null }],
    ["an empty status", { status: "" }],
  ])("%s → \"active\"", async (_label, data) => {
    h.queue.push({ data, error: null });
    await expect(fetchOrgStatus(ORG)).resolves.toBe("active");
  });

  it("a read error fails open to \"active\" (no signal)", async () => {
    h.queue.push({ data: null, error: { message: "network" } });
    await expect(fetchOrgStatus(ORG)).resolves.toBe("active");
  });

  it("a read error fails open to \"active\" when the signal was not aborted", async () => {
    const ctrl = new AbortController();
    h.queue.push({ data: null, error: { message: "network" } });
    await expect(fetchOrgStatus(ORG, ctrl.signal)).resolves.toBe("active");
  });

  it("an error after the signal aborted rejects with that error instead of resolving \"active\"", async () => {
    const ctrl = new AbortController();
    const abortError = { name: "AbortError", message: "The operation was aborted." };
    h.queue.push(() => {
      ctrl.abort();
      return { data: null, error: abortError };
    });

    const err = await caught(fetchOrgStatus(ORG, ctrl.signal));

    expect(err).toBe(abortError);
  });
});

describe("CAMPAIGNS_TABLE_QUERY_OPTIONS", () => {
  const { retry } = CAMPAIGNS_TABLE_QUERY_OPTIONS;

  it("30 s stale time and no window-focus refetch", () => {
    expect(CAMPAIGNS_TABLE_QUERY_OPTIONS.staleTime).toBe(30_000);
    expect(CAMPAIGNS_TABLE_QUERY_OPTIONS.refetchOnWindowFocus).toBe(false);
  });

  it("never retries too_large", () => {
    expect(retry(0, new CampaignsQueryError("too_large"))).toBe(false);
    expect(retry(1, new CampaignsQueryError("too_large"))).toBe(false);
  });

  it("retries the first failure once for any other error", () => {
    expect(retry(0, new CampaignsQueryError("failed"))).toBe(true);
    expect(retry(0, new Error("network"))).toBe(true);
    expect(retry(0, { message: "plain object" })).toBe(true);
  });

  it("does not retry once a failure has already been retried", () => {
    expect(retry(1, new CampaignsQueryError("failed"))).toBe(false);
    expect(retry(2, new Error("network"))).toBe(false);
  });
});
