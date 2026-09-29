/**
 * fetchContactFollowUpRows — the Follow-ups card's per-contact reads (appointments + lead campaign callbacks).
 *
 * Pins: tenant + contact scoping through parameterized `.eq()`, no owner filter (RLS alone decides), the
 * open-status and non-terminal filters, the per-source cap, "fails closed" (an error rejects the whole
 * load, cancels the sibling, and only after every read settled), and cancellation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Step = { method: string; args: unknown[] };
type Scripted = { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;

const h = vi.hoisted(() => ({
  reads: [] as { table: string; steps: Step[]; signal: AbortSignal | null; settled: boolean }[],
  results: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const CHAIN = ["select", "eq", "in", "not", "or", "order", "limit"];
  function makeBuilder(table: string) {
    const rec = { table, steps: [] as Step[], signal: null as AbortSignal | null, settled: false };
    h.reads.push(rec);
    const b: Record<string, unknown> = {};
    for (const m of CHAIN) {
      b[m] = (...args: unknown[]) => {
        rec.steps.push({ method: m, args });
        return b;
      };
    }
    b.abortSignal = (signal: AbortSignal) => {
      rec.signal = signal;
      return b;
    };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(h.results[table] ?? { data: [], error: null })
        .finally(() => {
          rec.settled = true;
        })
        .then(resolve, reject);
    return b;
  }
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

import {
  FOLLOW_UP_SOURCE_LIMIT,
  FollowUpsCancelledError,
  fetchContactFollowUpRows,
} from "@/lib/contactFollowUpsQueries";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const read = (table: string) => {
  const r = h.reads.find((x) => x.table === table);
  if (!r) throw new Error(`no ${table} read`);
  return r;
};
const stepsOf = (table: string, method: string) => read(table).steps.filter((s) => s.method === method);

function deferred() {
  let resolve!: (v: { data: unknown; error: unknown }) => void;
  const promise = new Promise<{ data: unknown; error: unknown }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.reads = [];
  h.results = {};
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("scoping and filters", () => {
  it("a lead reads open appointments and non-terminal campaign callbacks, org + contact scoped, capped", async () => {
    h.results = {
      appointments: { data: [{ id: "a1" }], error: null },
      campaign_leads: { data: [{ id: "c1" }], error: null },
    };

    const rows = await fetchContactFollowUpRows({ contactId: LEAD, contactType: "lead", organizationId: ORG });

    expect(rows).toEqual({ appointments: [{ id: "a1" }], campaign: [{ id: "c1" }], truncated: false });
    expect(h.reads.map((r) => r.table)).toEqual(["appointments", "campaign_leads"]);

    expect(stepsOf("appointments", "eq").map((s) => s.args)).toEqual([
      ["organization_id", ORG],
      ["contact_id", LEAD],
    ]);
    expect(stepsOf("appointments", "in").map((s) => s.args)).toEqual([["status", ["Scheduled", "Confirmed"]]]);
    expect(stepsOf("appointments", "limit").map((s) => s.args)).toEqual([[FOLLOW_UP_SOURCE_LIMIT]]);
    expect(stepsOf("appointments", "select")[0].args[0]).toContain("created_by");

    expect(stepsOf("campaign_leads", "eq").map((s) => s.args)).toEqual([
      ["organization_id", ORG],
      ["lead_id", LEAD],
    ]);
    expect(stepsOf("campaign_leads", "not").map((s) => s.args)).toEqual([
      ["status", "in", "(DNC,Completed,Removed,Failed)"],
    ]);
    expect(stepsOf("campaign_leads", "or").map((s) => s.args)).toEqual([
      ["callback_due_at.not.is.null,scheduled_callback_at.not.is.null"],
    ]);
    expect(stepsOf("campaign_leads", "limit").map((s) => s.args)).toEqual([[FOLLOW_UP_SOURCE_LIMIT]]);
  });

  it("no owner filter is added and no id is ever interpolated into a raw filter string", async () => {
    await fetchContactFollowUpRows({ contactId: LEAD, contactType: "lead", organizationId: ORG });
    for (const r of h.reads) {
      const cols = r.steps.filter((s) => s.method === "eq").map((s) => s.args[0]);
      expect(cols).not.toContain("user_id");
      expect(cols).not.toContain("created_by");
      expect(cols).not.toContain("callback_agent_id");
      for (const s of r.steps.filter((x) => x.method === "or" || x.method === "not")) {
        expect(JSON.stringify(s.args)).not.toContain(LEAD);
        expect(JSON.stringify(s.args)).not.toContain(ORG);
      }
    }
  });

  it.each(["client", "recruit"] as const)("a %s never reads campaign_leads", async (contactType) => {
    h.results = { appointments: { data: [{ id: "a1" }], error: null } };
    const rows = await fetchContactFollowUpRows({ contactId: LEAD, contactType, organizationId: ORG });
    expect(h.reads.map((r) => r.table)).toEqual(["appointments"]);
    expect(rows.campaign).toEqual([]);
  });
});

describe("results", () => {
  it("null data is 'none visible', not an error", async () => {
    h.results = {
      appointments: { data: null, error: null },
      campaign_leads: { data: null, error: null },
    };
    await expect(
      fetchContactFollowUpRows({ contactId: LEAD, contactType: "lead", organizationId: ORG }),
    ).resolves.toEqual({ appointments: [], campaign: [], truncated: false });
  });

  it.each(["appointments", "campaign_leads"])("hitting the cap on %s marks the load truncated", async (table) => {
    h.results = {
      [table]: { data: Array.from({ length: FOLLOW_UP_SOURCE_LIMIT }, (_, i) => ({ id: `r${i}` })), error: null },
    };
    const rows = await fetchContactFollowUpRows({ contactId: LEAD, contactType: "lead", organizationId: ORG });
    expect(rows.truncated).toBe(true);
  });
});

describe("fails closed", () => {
  it("an error in one read rejects the load, aborts the sibling, and only after the sibling settled", async () => {
    const sibling = deferred();
    const failure = { message: "permission denied", code: "42501" };
    h.results = {
      appointments: { data: null, error: failure },
      campaign_leads: sibling.promise,
    };

    let outcome: "pending" | "rejected" = "pending";
    const load = fetchContactFollowUpRows({ contactId: LEAD, contactType: "lead", organizationId: ORG }).catch(
      (e: unknown) => {
        outcome = "rejected";
        return e;
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(read("campaign_leads").signal?.aborted, "the sibling read is cancelled").toBe(true);
    expect(outcome, "never settles while a read is still on the wire").toBe("pending");

    sibling.resolve({ data: [{ id: "c1" }], error: null });
    const err = await load;
    expect(outcome).toBe("rejected");
    // A safe, generic message for the UI; the raw error stays in `cause` (logged, never rendered).
    expect(err).toMatchObject({
      name: "DashboardQueryError",
      context: "contact-followups:appointments",
      cause: failure,
      message: "Couldn't load this data. Please try again.",
    });
  });

  it("a caller abort rejects with FollowUpsCancelledError (not a failure)", async () => {
    const pending = deferred();
    h.results = { appointments: pending.promise, campaign_leads: { data: [], error: null } };
    const controller = new AbortController();
    const load = fetchContactFollowUpRows({
      contactId: LEAD,
      contactType: "lead",
      organizationId: ORG,
      signal: controller.signal,
    });
    controller.abort();
    expect(read("appointments").signal?.aborted).toBe(true);
    pending.resolve({ data: [{ id: "a1" }], error: null });
    await expect(load).rejects.toBeInstanceOf(FollowUpsCancelledError);
  });

  it("an already-aborted caller signal never returns data", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchContactFollowUpRows({ contactId: LEAD, contactType: "lead", organizationId: ORG, signal: controller.signal }),
    ).rejects.toBeInstanceOf(FollowUpsCancelledError);
  });
});
