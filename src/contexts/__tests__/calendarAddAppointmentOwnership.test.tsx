/**
 * CalendarProvider — appointment ownership, truthful updates, mapper fields, and fetch freshness.
 *
 * Plan: docs/plans/2026-09-28-contact-followups/implementation_plan.md §4.2, §5.1, §5.3, §11.
 *
 *   appointments.user_id    = the RESPONSIBLE user (reminder recipient) — an explicit assignee is honoured
 *   appointments.created_by = the SCHEDULER (the real session user) — stamped on insert, never caller-supplied
 *   appointments.organization_id = the REAL profile's organization — never caller-supplied
 *
 * The REAL CalendarProvider is rendered; only AuthContext and the Supabase client are mocked. The
 * client mock is a chainable, thenable builder that RECORDS every call (op, payload, .eq filters,
 * .select argument) and lets each test script the response per operation — including deferred
 * promises, so fetch/write orderings can be driven step by step.
 */

import React from "react";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REAL_ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const APPT_1 = "a0000000-0000-4000-8000-000000000001";
const APPT_2 = "a0000000-0000-4000-8000-000000000002";
const APPT_3 = "a0000000-0000-4000-8000-000000000003";
const APPT_NEW = "a0000000-0000-4000-8000-0000000000ff";

type Op = "select" | "insert" | "update" | "delete";
type Result = { data: unknown; error: unknown };
interface Call {
  table: string;
  op: Op;
  payload: unknown;
  eq: Record<string, unknown>;
  selectArg: unknown;
  ordered: boolean;
}

const db = vi.hoisted(() => ({
  calls: [] as Array<{
    table: string;
    op: "select" | "insert" | "update" | "delete";
    payload: unknown;
    eq: Record<string, unknown>;
    selectArg: unknown;
    ordered: boolean;
  }>,
  /** Scripted responses per op, consumed FIFO; an entry may be a result or a (deferred) promise of one. */
  queues: {
    select: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: [] as unknown[],
  } as Record<"select" | "insert" | "update" | "delete", unknown[]>,
  /** Rows a default (unscripted) fetch returns. */
  serverRows: [] as Record<string, unknown>[],
}));

const authState = vi.hoisted(() => ({ organizationId: "" as string | null }));

vi.mock("@/integrations/supabase/client", () => {
  function defaultResult(rec: {
    op: string;
    payload: unknown;
    eq: Record<string, unknown>;
  }): { data: unknown; error: unknown } {
    if (rec.op === "select") return { data: db.serverRows.map((r) => ({ ...r })), error: null };
    if (rec.op === "insert") {
      const row = Array.isArray(rec.payload) ? rec.payload[0] : rec.payload;
      return { data: { id: "a0000000-0000-4000-8000-0000000000ff", ...(row as object) }, error: null };
    }
    if (rec.op === "update") return { data: [{ id: rec.eq.id }], error: null };
    return { data: null, error: null };
  }

  function makeBuilder(table: string) {
    const rec = {
      table,
      op: "select" as "select" | "insert" | "update" | "delete",
      payload: undefined as unknown,
      eq: {} as Record<string, unknown>,
      selectArg: undefined as unknown,
      ordered: false,
    };
    db.calls.push(rec);
    let settled: Promise<unknown> | null = null;
    const settle = () => {
      if (!settled) {
        const queue = db.queues[rec.op];
        settled = queue.length > 0 ? Promise.resolve(queue.shift()) : Promise.resolve(defaultResult(rec));
      }
      return settled;
    };
    const b: Record<string, unknown> = {
      select(arg?: unknown) {
        rec.selectArg = arg;
        return b;
      },
      insert(payload: unknown) {
        rec.op = "insert";
        rec.payload = payload;
        return b;
      },
      update(payload: unknown) {
        rec.op = "update";
        rec.payload = payload;
        return b;
      },
      delete() {
        rec.op = "delete";
        return b;
      },
      eq(col: string, val: unknown) {
        rec.eq[col] = val;
        return b;
      },
      gte() { return b; },
      lte() { return b; },
      order() {
        rec.ordered = true;
        return b;
      },
      single() { return settle(); },
      maybeSingle() { return settle(); },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return settle().then(resolve, reject);
      },
    };
    return b;
  }
  const channel: Record<string, unknown> = {
    on() { return channel; },
    subscribe() { return channel; },
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      channel: () => channel,
      removeChannel: () => {},
      auth: {},
    },
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: ADMIN },
    profile: { id: ADMIN, organization_id: authState.organizationId, role: "Admin" },
    realProfile: { id: ADMIN, organization_id: authState.organizationId, role: "Admin" },
    isImpersonating: false,
  }),
}));

import { CalendarProvider, useCalendar } from "@/contexts/CalendarContext";

// ── harness ─────────────────────────────────────────────────────────────────────────────────

type Ctx = ReturnType<typeof useCalendar>;
const probe: { ctx: Ctx | null } = { ctx: null };

function Probe() {
  probe.ctx = useCalendar();
  return <div data-testid="loading">{String(probe.ctx.loading)}</div>;
}

function ctx(): Ctx {
  if (!probe.ctx) throw new Error("CalendarProvider not rendered");
  return probe.ctx;
}

function deferred<T = Result>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const apptCalls = (): Call[] => db.calls.filter((c) => c.table === "appointments");
const fetchCalls = (): Call[] => apptCalls().filter((c) => c.op === "select");
const insertCalls = (): Call[] => apptCalls().filter((c) => c.op === "insert");
const updateCalls = (): Call[] => apptCalls().filter((c) => c.op === "update");
const insertedRow = (i = 0): Record<string, unknown> => {
  const payload = insertCalls()[i].payload as Record<string, unknown>[];
  expect(Array.isArray(payload)).toBe(true);
  expect(payload).toHaveLength(1);
  return payload[0];
};
const ids = () => ctx().appointments.map((a) => a.id);
const byId = (id: string) => ctx().appointments.find((a) => a.id === id);

/** Let pending promise chains and React updates settle. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function row(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Appt ${id.slice(-2)}`,
    type: "Sales Call",
    status: "Scheduled",
    start_time: "2026-10-05T17:00:00.000Z",
    end_time: "2026-10-05T17:30:00.000Z",
    contact_name: "Pat Client",
    contact_id: "d0000000-0000-4000-8000-000000000001",
    notes: "",
    user_id: ADMIN,
    created_by: ADMIN,
    organization_id: REAL_ORG,
    ...over,
  };
}

/** Render the real provider and wait until the mount fetch has settled. */
async function mountSettled() {
  render(
    <CalendarProvider>
      <Probe />
    </CalendarProvider>,
  );
  await waitFor(() => expect(ctx().loading).toBe(false));
  await flush();
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.calls = [];
  db.queues.select = [];
  db.queues.insert = [];
  db.queues.update = [];
  db.queues.delete = [];
  db.serverRows = [];
  authState.organizationId = REAL_ORG;
  probe.ctx = null;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
});

// ── (1)–(4) addAppointment ownership ────────────────────────────────────────────────────────

describe("addAppointment — ownership stamp (Own-1, Own-2, Own-5)", () => {
  it("Admin + explicit assignee Agent A ⇒ user_id = A, created_by = Admin, organization_id = REAL_ORG", async () => {
    await mountSettled();

    let returned: unknown;
    await act(async () => {
      returned = await ctx().addAppointment({
        title: "Sales call with Pat",
        type: "Sales Call",
        status: "Scheduled",
        start_time: "2026-10-06T16:00:00.000Z",
        end_time: "2026-10-06T16:30:00.000Z",
        user_id: AGENT_A,
      });
    });

    expect(insertCalls()).toHaveLength(1);
    const payload = insertedRow();
    expect(payload.user_id, "the explicit assignee must survive the insert").toBe(AGENT_A);
    expect(payload.created_by, "created_by is the real scheduler").toBe(ADMIN);
    expect(payload.organization_id).toBe(REAL_ORG);
    expect(payload.title).toBe("Sales call with Pat");
    // the row is read back so the caller gets the persisted record
    expect(insertCalls()[0].selectArg).toBeUndefined();
    expect((returned as Record<string, unknown>).id).toBe(APPT_NEW);
    expect((returned as Record<string, unknown>).user_id).toBe(AGENT_A);
  });

  it.each([
    ["omitted", {}],
    ["empty string", { user_id: "" }],
    ["undefined", { user_id: undefined }],
    ["null", { user_id: null }],
    ["whitespace only", { user_id: "   " }],
  ])("no explicit assignee (%s) ⇒ user_id = the real session user", async (_label, assignee) => {
    await mountSettled();

    await act(async () => {
      await ctx().addAppointment({
        title: "Self-booked",
        start_time: "2026-10-06T16:00:00.000Z",
        ...assignee,
      });
    });

    const payload = insertedRow();
    expect(payload.user_id).toBe(ADMIN);
    expect(payload.created_by).toBe(ADMIN);
    expect(payload.organization_id).toBe(REAL_ORG);
  });

  it("a caller-supplied organization_id / created_by never wins", async () => {
    await mountSettled();

    await act(async () => {
      await ctx().addAppointment({
        title: "Spoof attempt",
        start_time: "2026-10-06T16:00:00.000Z",
        user_id: AGENT_A,
        organization_id: OTHER_ORG,
        created_by: AGENT_B,
      });
    });

    const payload = insertedRow();
    expect(payload.organization_id).toBe(REAL_ORG);
    expect(payload.created_by).toBe(ADMIN);
    expect(payload.user_id).toBe(AGENT_A);
  });

  it("the ...a pass-through is untouched: a camelCase object reaches insert with its keys unmapped", async () => {
    await mountSettled();
    const before = ctx().appointments.length;
    // The camelCase shape DialerPage used to send (removed by the Dialer writer fix, root plan §19;
    // PostgREST rejects it, so it could never duplicate a row).
    const date = new Date(2026, 9, 6);
    const camel = {
      title: "Dialer appointment",
      type: "Sales Call",
      status: "Scheduled",
      contactName: "Pat Client",
      contactId: "d0000000-0000-4000-8000-000000000001",
      date,
      startTime: "9:00 AM",
      endTime: "9:30 AM",
      agent: "agent@example.com",
      notes: "from dialer",
    };
    const snapshot = { ...camel };
    const pgError = { message: "Could not find the 'agent' column of 'appointments'", code: "PGRST204" };
    db.queues.insert.push({ data: null, error: pgError });

    let caught: unknown;
    await act(async () => {
      await ctx().addAppointment(camel).catch((e: unknown) => {
        caught = e;
      });
    });

    expect(caught).toBe(pgError);
    const payload = insertedRow();
    expect(Object.keys(payload).sort()).toEqual(
      [...Object.keys(camel), "user_id", "created_by", "organization_id"].sort(),
    );
    for (const [k, v] of Object.entries(camel)) expect(payload[k]).toBe(v);
    expect(payload.date).toBe(date);
    for (const snake of ["contact_name", "contact_id", "start_time", "end_time", "agent_id"]) {
      expect(payload).not.toHaveProperty(snake);
    }
    expect(payload.user_id).toBe(ADMIN);
    expect(payload.created_by).toBe(ADMIN);
    expect(payload.organization_id).toBe(REAL_ORG);
    // the caller's object is not mutated, and a rejected insert appends nothing
    expect(camel).toEqual(snapshot);
    expect(camel).not.toHaveProperty("created_by");
    expect(ctx().appointments).toHaveLength(before);
  });

  it("with no real organization context it throws and never inserts", async () => {
    authState.organizationId = null;
    await mountSettled();

    let caught: unknown;
    await act(async () => {
      await ctx().addAppointment({ title: "x", user_id: AGENT_A }).catch((e: unknown) => {
        caught = e;
      });
    });

    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).toMatch(/missing user or organization context/);
    expect(insertCalls()).toHaveLength(0);
    expect(fetchCalls()).toHaveLength(0);
  });
});

// ── (5) updateAppointment: exact payload, filters, truthful failure ─────────────────────────

describe("updateAppointment — exact payload and truthful failure (D-16/D-22)", () => {
  it("sends exactly the given payload (no created_by / organization_id injected), filtered by id + org", async () => {
    db.serverRows = [row(APPT_1, { user_id: AGENT_A, created_by: ADMIN })];
    await mountSettled();

    const data = { status: "Confirmed", user_id: AGENT_B, notes: "moved to B" };
    const snapshot = { ...data };
    await act(async () => {
      await ctx().updateAppointment(APPT_1, data);
    });

    expect(updateCalls()).toHaveLength(1);
    const call = updateCalls()[0];
    expect(call.payload).toBe(data);
    expect(call.payload).toEqual(snapshot);
    expect(call.payload).not.toHaveProperty("created_by");
    expect(call.payload).not.toHaveProperty("organization_id");
    expect(call.eq).toEqual({ id: APPT_1, organization_id: REAL_ORG });
    expect(call.selectArg, "the update must read back affected rows to detect a zero-row result").toBe("id");
    // success: no rollback refetch
    expect(fetchCalls()).toHaveLength(1);
  });

  it.each([
    ["an empty array", []],
    ["null", null],
  ])("a zero-row result (data = %s) REJECTS, and its rollback refetch is silent", async (_label, zeroRows) => {
    db.serverRows = [row(APPT_1, { status: "Scheduled", user_id: AGENT_A })];
    await mountSettled();
    expect(fetchCalls()).toHaveLength(1);

    db.queues.update.push({ data: zeroRows, error: null });
    const rollback = deferred();
    db.queues.select.push(rollback.promise);

    let resolved = false;
    let caught: unknown;
    await act(async () => {
      await ctx()
        .updateAppointment(APPT_1, { status: "Cancelled", user_id: AGENT_B })
        .then(
          () => {
            resolved = true;
          },
          (e: unknown) => {
            caught = e;
          },
        );
    });

    expect(resolved, "an update RLS silently filtered out must not report success").toBe(false);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/not applied/);

    // the rollback refetch is issued, and while it is in flight the page spinner is NOT shown
    expect(fetchCalls()).toHaveLength(2);
    expect(ctx().loading).toBe(false);
    // optimistic state is still showing until the rollback settles
    expect(byId(APPT_1)?.status).toBe("Cancelled");

    await act(async () => {
      rollback.resolve({ data: [row(APPT_1, { status: "Scheduled", user_id: AGENT_A })], error: null });
    });
    await flush();

    expect(ctx().loading).toBe(false);
    expect(byId(APPT_1)?.status, "the rollback restores the persisted row").toBe("Scheduled");
    expect(byId(APPT_1)?.user_id).toBe(AGENT_A);
    expect(fetchCalls()).toHaveLength(2);
  });

  it("an error result rejects with that error, with a silent rollback refetch", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    const rlsError = { message: "permission denied for table appointments", code: "42501" };
    db.queues.update.push({ data: null, error: rlsError });
    const rollback = deferred();
    db.queues.select.push(rollback.promise);

    let caught: unknown;
    await act(async () => {
      await ctx().updateAppointment(APPT_1, { notes: "x" }).catch((e: unknown) => {
        caught = e;
      });
    });

    expect(caught).toBe(rlsError);
    expect(fetchCalls()).toHaveLength(2);
    expect(ctx().loading).toBe(false);

    await act(async () => {
      rollback.resolve({ data: [row(APPT_1)], error: null });
    });
    await flush();
    expect(ctx().loading).toBe(false);
  });
});

// ── (6) mapper fields ───────────────────────────────────────────────────────────────────────

describe("mapAppointment — created_by and raw_status survive every path", () => {
  it("fetched raw rows keep created_by and raw_status; a lowercase 'cancelled' reads Scheduled but keeps its raw value", async () => {
    db.serverRows = [
      row(APPT_1, { status: "cancelled", user_id: AGENT_A, created_by: ADMIN }),
      row(APPT_2, { status: "Confirmed", user_id: null, created_by: AGENT_B }),
      (() => {
        const r = row(APPT_3, { status: "Completed" });
        delete r.created_by;
        return r;
      })(),
    ];
    await mountSettled();

    const a1 = byId(APPT_1)!;
    expect(a1.status, "display coercion is unchanged").toBe("Scheduled");
    expect(a1.raw_status, "reminder gating needs the stored value").toBe("cancelled");
    expect(a1.created_by).toBe(ADMIN);
    expect(a1.user_id).toBe(AGENT_A);

    const a2 = byId(APPT_2)!;
    expect(a2.user_id).toBeNull();
    expect(a2.created_by, "a NULL-user_id row keeps its #22 fallback owner").toBe(AGENT_B);
    expect(a2.status).toBe("Confirmed");
    expect(a2.raw_status).toBe("Confirmed");

    const a3 = byId(APPT_3)!;
    expect(a3.created_by).toBeNull();
    expect(a3.raw_status).toBe("Completed");
  });

  it("the optimistic update merge keeps created_by and raw_status (status-changing and status-free edits)", async () => {
    db.serverRows = [
      row(APPT_1, { status: "cancelled", user_id: AGENT_A, created_by: ADMIN }),
      row(APPT_2, { status: "Scheduled", user_id: null, created_by: AGENT_B }),
    ];
    await mountSettled();

    // status-free edit: raw_status stays the stored value
    const pending1 = deferred();
    db.queues.update.push(pending1.promise);
    let p1: Promise<void> | undefined;
    act(() => {
      p1 = ctx().updateAppointment(APPT_1, { notes: "left a voicemail" });
    });
    await flush();
    const optimistic1 = byId(APPT_1)!;
    expect(optimistic1.notes).toBe("left a voicemail");
    expect(optimistic1.created_by).toBe(ADMIN);
    expect(optimistic1.raw_status).toBe("cancelled");
    expect(optimistic1.status).toBe("Scheduled");
    await act(async () => {
      pending1.resolve({ data: [{ id: APPT_1 }], error: null });
      await p1;
    });

    // status-changing edit: raw_status follows the new status; created_by untouched
    const pending2 = deferred();
    db.queues.update.push(pending2.promise);
    let p2: Promise<void> | undefined;
    act(() => {
      p2 = ctx().updateAppointment(APPT_2, { status: "Confirmed", user_id: AGENT_A });
    });
    await flush();
    const optimistic2 = byId(APPT_2)!;
    expect(optimistic2.status).toBe("Confirmed");
    expect(optimistic2.raw_status).toBe("Confirmed");
    expect(optimistic2.user_id).toBe(AGENT_A);
    expect(optimistic2.created_by).toBe(AGENT_B);
    await act(async () => {
      pending2.resolve({ data: [{ id: APPT_2 }], error: null });
      await p2;
    });

    await flush();
    expect(byId(APPT_1)!.created_by).toBe(ADMIN);
    expect(byId(APPT_2)!.created_by).toBe(AGENT_B);
    expect(byId(APPT_2)!.raw_status).toBe("Confirmed");
  });

  it("the add append carries created_by and raw_status from the inserted row", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    await act(async () => {
      await ctx().addAppointment({
        title: "For Agent A",
        status: "Scheduled",
        start_time: "2026-10-07T16:00:00.000Z",
        end_time: "2026-10-07T16:30:00.000Z",
        user_id: AGENT_A,
      });
    });

    const added = byId(APPT_NEW)!;
    expect(added).toBeDefined();
    expect(added.user_id).toBe(AGENT_A);
    expect(added.created_by).toBe(ADMIN);
    expect(added.raw_status).toBe("Scheduled");
    expect(ctx().appointments).toHaveLength(2);
  });
});

// ── (7) freshness ordering ──────────────────────────────────────────────────────────────────

describe("fetchAppointments — freshness ordering (§5.3)", () => {
  it("(a) silent then non-silent in flight; the newer non-silent resolves first, the stale silent last ⇒ loading false, newer data kept", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    const silentD = deferred();
    const loudD = deferred();
    db.queues.select.push(silentD.promise, loudD.promise);

    let silentP: Promise<void> | undefined;
    let loudP: Promise<void> | undefined;
    act(() => {
      silentP = ctx().fetchAppointments({ silent: true });
    });
    expect(ctx().loading, "a silent fetch never shows the spinner").toBe(false);
    act(() => {
      loudP = ctx().fetchAppointments();
    });
    expect(fetchCalls()).toHaveLength(3);
    expect(ctx().loading).toBe(true);

    await act(async () => {
      loudD.resolve({ data: [row(APPT_1), row(APPT_2)], error: null });
      await loudP;
    });
    expect(ctx().loading).toBe(false);
    expect(ids()).toEqual([APPT_1, APPT_2]);

    await act(async () => {
      silentD.resolve({ data: [row(APPT_3)], error: null });
      await silentP;
    });
    await flush();

    expect(ctx().loading).toBe(false);
    expect(ids(), "a superseded (older) fetch must not overwrite newer data").toEqual([APPT_1, APPT_2]);
    expect(fetchCalls(), "a superseded read is not re-issued").toHaveLength(3);
  });

  it("(a) silent then non-silent in flight; the stale silent resolves first ⇒ it is discarded, the spinner clears when the newer one lands", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    const silentD = deferred();
    const loudD = deferred();
    db.queues.select.push(silentD.promise, loudD.promise);

    let silentP: Promise<void> | undefined;
    let loudP: Promise<void> | undefined;
    act(() => {
      silentP = ctx().fetchAppointments({ silent: true });
    });
    act(() => {
      loudP = ctx().fetchAppointments();
    });

    await act(async () => {
      silentD.resolve({ data: [row(APPT_3)], error: null });
      await silentP;
    });
    expect(ids(), "the older silent snapshot is discarded").toEqual([APPT_1]);
    expect(ctx().loading, "the newer non-silent fetch still owns the spinner").toBe(true);

    await act(async () => {
      loudD.resolve({ data: [row(APPT_1), row(APPT_2)], error: null });
      await loudP;
    });
    await flush();

    expect(ctx().loading).toBe(false);
    expect(ids()).toEqual([APPT_1, APPT_2]);
  });

  it("(a) two non-silent fetches resolving out of order ⇒ loading false and the newer data kept", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    const olderD = deferred();
    const newerD = deferred();
    db.queues.select.push(olderD.promise, newerD.promise);

    let olderP: Promise<void> | undefined;
    let newerP: Promise<void> | undefined;
    act(() => {
      olderP = ctx().fetchAppointments();
      newerP = ctx().fetchAppointments();
    });
    expect(ctx().loading).toBe(true);

    await act(async () => {
      newerD.resolve({ data: [row(APPT_1), row(APPT_2)], error: null });
      await newerP;
    });
    await act(async () => {
      olderD.resolve({ data: [row(APPT_3)], error: null });
      await olderP;
    });
    await flush();

    expect(ctx().loading).toBe(false);
    expect(ids()).toEqual([APPT_1, APPT_2]);
  });

  it("(b) silent fetch in flight → addAppointment resolves → stale fetch resolves ⇒ added row remains, exactly one silent follow-up refetch", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();
    const baseFetches = fetchCalls().length;

    const staleD = deferred();
    const followUpD = deferred();
    db.queues.select.push(staleD.promise, followUpD.promise);

    let staleP: Promise<void> | undefined;
    act(() => {
      staleP = ctx().fetchAppointments({ silent: true });
    });
    expect(fetchCalls()).toHaveLength(baseFetches + 1);

    await act(async () => {
      await ctx().addAppointment({
        title: "Booked mid-refresh",
        status: "Scheduled",
        start_time: "2026-10-08T16:00:00.000Z",
        user_id: AGENT_A,
      });
    });
    expect(ids()).toContain(APPT_NEW);

    // the in-flight read started before the insert: its snapshot lacks the new row
    await act(async () => {
      staleD.resolve({ data: [row(APPT_1)], error: null });
      await staleP;
    });
    await flush();

    expect(ids(), "a pre-write snapshot must not drop the just-added row").toContain(APPT_NEW);
    expect(fetchCalls(), "exactly one follow-up refetch is issued").toHaveLength(baseFetches + 2);
    expect(ctx().loading, "the follow-up refetch is silent").toBe(false);

    const addedRow = { ...row(APPT_NEW, { user_id: AGENT_A, created_by: ADMIN, start_time: "2026-10-08T16:00:00.000Z" }) };
    await act(async () => {
      followUpD.resolve({ data: [row(APPT_1), addedRow], error: null });
    });
    await flush();

    expect(ids()).toEqual([APPT_1, APPT_NEW]);
    expect(byId(APPT_NEW)!.user_id).toBe(AGENT_A);
    expect(ctx().loading).toBe(false);
    expect(fetchCalls(), "the follow-up converges; nothing further is issued").toHaveLength(baseFetches + 2);
  });

  it("(b) a pre-delete snapshot cannot bring back a deleted row", async () => {
    db.serverRows = [row(APPT_1), row(APPT_2)];
    await mountSettled();
    const baseFetches = fetchCalls().length;

    const staleD = deferred();
    db.queues.select.push(staleD.promise);

    let staleP: Promise<void> | undefined;
    act(() => {
      staleP = ctx().fetchAppointments({ silent: true });
    });
    await act(async () => {
      await ctx().deleteAppointment(APPT_2);
    });
    expect(ids()).toEqual([APPT_1]);

    db.serverRows = [row(APPT_1)];
    await act(async () => {
      staleD.resolve({ data: [row(APPT_1), row(APPT_2)], error: null });
      await staleP;
    });
    await flush();

    expect(ids()).toEqual([APPT_1]);
    expect(fetchCalls()).toHaveLength(baseFetches + 2);
    expect(ctx().loading).toBe(false);
  });

  it("(c) a silent call while a fetch is in flight is a no-op (no extra query)", async () => {
    // the mount (non-silent) fetch is held in flight
    const mountD = deferred();
    db.queues.select.push(mountD.promise);
    render(
      <CalendarProvider>
        <Probe />
      </CalendarProvider>,
    );
    await flush();
    expect(fetchCalls()).toHaveLength(1);
    expect(ctx().loading).toBe(true);

    await act(async () => {
      await ctx().fetchAppointments({ silent: true });
    });
    expect(fetchCalls(), "silent during a non-silent in-flight fetch").toHaveLength(1);

    await act(async () => {
      mountD.resolve({ data: [row(APPT_1)], error: null });
    });
    await flush();
    expect(ctx().loading).toBe(false);
    expect(ids()).toEqual([APPT_1]);

    // silent during a silent in-flight fetch
    const silentD = deferred();
    db.queues.select.push(silentD.promise);
    let silentP: Promise<void> | undefined;
    act(() => {
      silentP = ctx().fetchAppointments({ silent: true });
    });
    expect(fetchCalls()).toHaveLength(2);
    await act(async () => {
      await ctx().fetchAppointments({ silent: true });
      await ctx().fetchAppointments({ silent: true });
    });
    expect(fetchCalls(), "silent during a silent in-flight fetch").toHaveLength(2);
    expect(ctx().loading).toBe(false);

    await act(async () => {
      silentD.resolve({ data: [row(APPT_1), row(APPT_2)], error: null });
      await silentP;
    });
    await flush();
    expect(ids()).toEqual([APPT_1, APPT_2]);

    // once nothing is in flight, a silent call runs again
    await act(async () => {
      await ctx().fetchAppointments({ silent: true });
    });
    expect(fetchCalls()).toHaveLength(3);
    for (const c of fetchCalls()) {
      expect(c.eq).toEqual({ organization_id: REAL_ORG });
      expect(c.ordered).toBe(true);
    }
  });
});

describe("fetchAppointments — a read that overlaps an in-flight write (review finding: write window)", () => {
  it("a fetch that starts while an update is in flight and lands AFTER it commits cannot revert the edit", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();
    const baseFetches = fetchCalls().length;

    const updD = deferred();
    const staleD = deferred();
    db.queues.update.push(updD.promise);
    db.queues.select.push(staleD.promise);

    let upP: Promise<void> | undefined;
    act(() => {
      upP = ctx().updateAppointment(APPT_1, { status: "Cancelled" });
    });
    expect(byId(APPT_1)!.raw_status).toBe("Cancelled");

    // The read starts before the update commits: its snapshot still says Scheduled.
    let staleP: Promise<void> | undefined;
    act(() => {
      staleP = ctx().fetchAppointments({ silent: true });
    });
    await act(async () => {
      updD.resolve({ data: [{ id: APPT_1 }], error: null });
      await upP;
    });
    db.serverRows = [row(APPT_1, { status: "Cancelled" })];
    await act(async () => {
      staleD.resolve({ data: [row(APPT_1)], error: null });
      await staleP;
    });
    await flush();

    expect(byId(APPT_1)!.raw_status, "the pre-commit snapshot must not revert the edit").toBe("Cancelled");
    expect(fetchCalls(), "the overlapping read is re-issued once").toHaveLength(baseFetches + 2);
  });

  it("a fetch that lands while the update is still pending is discarded; one refetch runs once the write settles", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();
    const baseFetches = fetchCalls().length;

    const updD = deferred();
    db.queues.update.push(updD.promise);

    let upP: Promise<void> | undefined;
    act(() => {
      upP = ctx().updateAppointment(APPT_1, { status: "Cancelled", user_id: AGENT_B });
    });
    await act(async () => {
      await ctx().fetchAppointments({ silent: true }); // resolves with the pre-commit row
    });
    await flush();
    expect(byId(APPT_1)!.raw_status).toBe("Cancelled");
    expect(byId(APPT_1)!.user_id).toBe(AGENT_B);
    expect(fetchCalls(), "no refetch while the write is pending").toHaveLength(baseFetches + 1);

    db.serverRows = [row(APPT_1, { status: "Cancelled", user_id: AGENT_B })];
    await act(async () => {
      updD.resolve({ data: [{ id: APPT_1 }], error: null });
      await upP;
    });
    await flush();

    expect(fetchCalls(), "exactly one refetch after the write settles").toHaveLength(baseFetches + 2);
    expect(byId(APPT_1)!.raw_status).toBe("Cancelled");
    expect(byId(APPT_1)!.user_id).toBe(AGENT_B);
  });

  it("a failed update still rolls back: the overlapping stale read is replaced by a fresh one", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    const updD = deferred();
    db.queues.update.push(updD.promise);
    let upP: Promise<void> | undefined;
    act(() => {
      upP = ctx().updateAppointment(APPT_1, { status: "Cancelled" }).catch(() => undefined);
    });
    await act(async () => {
      await ctx().fetchAppointments({ silent: true });
    });
    await act(async () => {
      updD.resolve({ data: [], error: null }); // zero rows: RLS hid the row
      await upP;
    });
    await flush();

    expect(byId(APPT_1)!.raw_status, "the rollback refetch restores the server row").toBe("Scheduled");
  });

  it("a read that lands while an insert is pending cannot duplicate the new row", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    const insD = deferred();
    db.queues.insert.push(insD.promise);
    let addP: Promise<unknown> | undefined;
    act(() => {
      addP = ctx().addAppointment({ title: "New", status: "Scheduled", start_time: "2026-10-08T16:00:00.000Z" });
    });
    const inserted = row(APPT_NEW, { start_time: "2026-10-08T16:00:00.000Z" });
    // The insert has committed server-side, so this read already contains it.
    db.serverRows = [row(APPT_1), inserted];
    await act(async () => {
      await ctx().fetchAppointments({ silent: true });
    });
    await act(async () => {
      insD.resolve({ data: inserted, error: null });
      await addP;
    });
    await flush();

    expect(ids()).toEqual([APPT_1, APPT_NEW]);
  });
});

describe("fetchAppointments — the spinner belongs to the last non-silent fetch (review finding: loading flash)", () => {
  it("an older non-silent fetch landing first does not clear the spinner while a newer one is still loading", async () => {
    db.serverRows = [row(APPT_1)];
    await mountSettled();

    const olderD = deferred();
    const newerD = deferred();
    db.queues.select.push(olderD.promise, newerD.promise);
    let olderP: Promise<void> | undefined;
    let newerP: Promise<void> | undefined;
    act(() => {
      olderP = ctx().fetchAppointments();
      newerP = ctx().fetchAppointments();
    });

    await act(async () => {
      olderD.resolve({ data: [row(APPT_3)], error: null });
      await olderP;
    });
    expect(ctx().loading, "the newer fetch still owns the spinner").toBe(true);
    expect(ids()).toEqual([APPT_1]);

    await act(async () => {
      newerD.resolve({ data: [row(APPT_1), row(APPT_2)], error: null });
      await newerP;
    });
    expect(ctx().loading).toBe(false);
    expect(ids()).toEqual([APPT_1, APPT_2]);
  });
});
