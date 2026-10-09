/**
 * getCampaignCardStats (src/lib/campaign-card-stats.ts) — the Campaigns table's metric source.
 *
 * Pins: ids are de-duplicated and sent to `get_campaign_card_stats` in chunks of
 * CAMPAIGN_CARD_STATS_CHUNK, results are merged; any failed chunk rejects the whole call with
 * CampaignCardStatsError (no partial map, no silent `{}`); the AbortSignal reaches every chunk;
 * no ids → no RPC; null columns coerce to 0 for rows that ARE returned, while campaigns the RPC
 * did not return stay absent (never a fabricated zero).
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
  CAMPAIGN_CARD_STATS_CHUNK,
  CampaignCardStatsError,
  getCampaignCardStats,
} from "@/lib/campaign-card-stats";

const idsSent = (op: Op) => (op.rpcArgs[0] as { p_campaign_ids: string[] }).p_campaign_ids;
const makeIds = (n: number, prefix = "camp") => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(4, "0")}`);

/** Deterministic per-id stats so a merged map can be checked against every id. */
function statsRow(id: string) {
  const n = Number(id.split("-").pop());
  return {
    campaign_id: id,
    total_leads: n + 10,
    called_leads: n + 5,
    contacted_leads: n + 2,
    converted_leads: n + 1,
    policies_sold: n,
  };
}
const echoServer = (op: Op): Resp => ({ data: idsSent(op).map(statsRow), error: null });

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

describe("getCampaignCardStats — request shape", () => {
  it("chunks are 200 ids", () => {
    expect(CAMPAIGN_CARD_STATS_CHUNK).toBe(200);
  });

  it("no ids → {} and no RPC call", async () => {
    await expect(getCampaignCardStats([])).resolves.toEqual({});
    expect(h.ops).toHaveLength(0);
  });

  it("calls get_campaign_card_stats with p_campaign_ids and maps the row", async () => {
    h.queue.push({
      data: [
        {
          campaign_id: "c1",
          total_leads: 120,
          called_leads: 80,
          contacted_leads: 30,
          converted_leads: 4,
          policies_sold: 6,
        },
      ],
      error: null,
    });

    const out = await getCampaignCardStats(["c1"]);

    expect(out).toEqual({ c1: { total: 120, called: 80, contacted: 30, converted: 4, policiesSold: 6 } });
    expect(h.ops).toHaveLength(1);
    const [op] = h.ops;
    expect(op.kind).toBe("rpc");
    expect(op.target).toBe("get_campaign_card_stats");
    expect(op.rpcArgs).toEqual([{ p_campaign_ids: ["c1"] }]);
    expect(op.calls).toEqual([]); // no signal given → no abortSignal call
  });
});

describe("getCampaignCardStats — chunking, de-duplication and merging", () => {
  it("de-duplicates ids and sends them in first-seen order, 200 per call, merging every chunk", async () => {
    const ids = makeIds(450);
    h.fallback = echoServer;

    const out = await getCampaignCardStats([...ids, ...ids.slice(0, 50), ids[3], ids[449]]);

    expect(h.ops.map((op) => op.target)).toEqual([
      "get_campaign_card_stats",
      "get_campaign_card_stats",
      "get_campaign_card_stats",
    ]);
    expect(h.ops.map(idsSent)).toEqual([ids.slice(0, 200), ids.slice(200, 400), ids.slice(400)]);
    const sent = h.ops.flatMap(idsSent);
    expect(new Set(sent).size).toBe(sent.length);
    expect(Object.keys(out)).toHaveLength(450);
    for (const id of ids) {
      const r = statsRow(id);
      expect(out[id]).toEqual({
        total: r.total_leads,
        called: r.called_leads,
        contacted: r.contacted_leads,
        converted: r.converted_leads,
        policiesSold: r.policies_sold,
      });
    }
  });

  it("exactly 200 unique ids (plus duplicates) is a single call", async () => {
    const ids = makeIds(200);
    h.fallback = echoServer;

    await getCampaignCardStats([...ids, ...ids.slice(0, 30)]);

    expect(h.ops).toHaveLength(1);
    expect(idsSent(h.ops[0])).toEqual(ids);
  });

  it("201 unique ids split 200 + 1", async () => {
    const ids = makeIds(201);
    h.fallback = echoServer;

    const out = await getCampaignCardStats(ids);

    expect(h.ops.map((op) => idsSent(op).length)).toEqual([200, 1]);
    expect(idsSent(h.ops[1])).toEqual([ids[200]]);
    expect(Object.keys(out)).toHaveLength(201);
  });

  it("does not mutate the caller's id array", async () => {
    const ids = ["b", "a", "b"];
    h.queue.push({ data: [], error: null });
    await getCampaignCardStats(ids);
    expect(ids).toEqual(["b", "a", "b"]);
    expect(idsSent(h.ops[0])).toEqual(["b", "a"]);
  });
});

describe("getCampaignCardStats — failures never yield a partial map", () => {
  it("a failed later chunk rejects with CampaignCardStatsError (raw error as cause) and stops requesting", async () => {
    const ids = makeIds(450);
    const providerError = { code: "57014", message: "canceling statement due to statement timeout" };
    h.queue.push(
      (op) => echoServer(op),
      { data: null, error: providerError },
    );

    const err = await caught(getCampaignCardStats(ids));

    expect(err).toBeInstanceOf(CampaignCardStatsError);
    expect(err).toMatchObject({
      name: "CampaignCardStatsError",
      message: "Campaign metrics could not be loaded.",
      cause: providerError,
    });
    expect(h.ops).toHaveLength(2); // the third chunk is never requested
  });

  it("a failed first chunk rejects as well (no silent {})", async () => {
    h.queue.push({ data: null, error: { message: "permission denied" } });

    await expect(getCampaignCardStats(["c1", "c2"])).rejects.toBeInstanceOf(CampaignCardStatsError);
    expect(h.ops).toHaveLength(1);
  });
});

describe("getCampaignCardStats — abort signal", () => {
  it("passes the signal to every chunk via abortSignal", async () => {
    const ctrl = new AbortController();
    h.fallback = echoServer;

    await getCampaignCardStats(makeIds(401), { signal: ctrl.signal });

    expect(h.ops).toHaveLength(3);
    for (const op of h.ops) {
      expect(op.signal).toBe(ctrl.signal);
      expect(op.calls).toEqual([{ method: "abortSignal", args: [ctrl.signal] }]);
    }
  });

  it("without a signal no abortSignal call is made", async () => {
    h.fallback = echoServer;
    await getCampaignCardStats(makeIds(201), {});
    expect(h.ops.every((op) => op.calls.length === 0)).toBe(true);
  });
});

describe("getCampaignCardStats — row coercion", () => {
  it("null columns coerce to 0 for a returned row; a campaign not returned stays absent", async () => {
    h.queue.push({
      data: [
        {
          campaign_id: "returned",
          total_leads: null,
          called_leads: null,
          contacted_leads: null,
          converted_leads: null,
          policies_sold: null,
        },
      ],
      error: null,
    });

    const out = await getCampaignCardStats(["returned", "omitted-personal"]);

    expect(out.returned).toEqual({ total: 0, called: 0, contacted: 0, converted: 0, policiesSold: 0 });
    expect(out).not.toHaveProperty("omitted-personal");
  });

  it("null data for a chunk resolves to no rows for that chunk (not an error)", async () => {
    h.queue.push({ data: null, error: null });
    await expect(getCampaignCardStats(["c1"])).resolves.toEqual({});
  });
});
