/**
 * Telephony belongs to the REAL authenticated operator — "View As" must be invisible to it.
 *
 * THE DEFECT THIS PINS. `TwilioProvider` read `useAuth().profile`, which `AuthContext` swaps for
 * the VIEWED agent's profile while a Super Admin impersonates. The provider mounts ABOVE
 * `AppLayout`, so hiding `FloatingDialer` changed nothing: every effect keyed on `profile?.id`
 * re-ran as the viewed agent the moment "View As" began. Worst was the mid-call orphan recovery,
 * which queries the newest active `calls` row for that id and can UPDATE the viewed agent's live
 * outbound row to `failed` (stale ringing) or `completed` (silent finalize) — the operator's
 * browser "recovering" a call that is actually live in the AGENT's browser.
 *
 * The contract: the provider's operational profile is `useAuth().realProfile`, which never changes
 * when "View As" starts or switches, so activation triggers no re-query, no re-initialisation and
 * no write — and anything that does run carries the OPERATOR's id, never the viewed agent's.
 *
 * The supabase mock is a RECORDER: every builder captures its table, filters and update payloads,
 * so "never queries or updates with the agent's id" is an assertion about calls actually made.
 */

import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIEWED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG = "11111111-1111-4111-8111-111111111111";

interface Recorded {
  table: string;
  op: "select" | "update" | "insert";
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  payload?: unknown;
}

const db = vi.hoisted(() => ({
  queries: [] as {
    table: string; op: string; eq: Record<string, unknown>; in: Record<string, unknown[]>; payload?: unknown;
  }[],
  /** Row returned to the ORPHAN check (`calls` select … maybeSingle). */
  orphanRow: null as Record<string, unknown> | null,
}));

const authState = vi.hoisted(() => ({
  isImpersonating: false,
  effective: null as Record<string, unknown> | null,
  real: null as Record<string, unknown> | null,
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: authState.userId },
    // EXACTLY the production contract: `profile` is the effective (possibly viewed) profile,
    // `realProfile` is always the real operator's row.
    profile: authState.isImpersonating ? authState.effective : authState.real,
    realProfile: authState.real,
    isImpersonating: authState.isImpersonating,
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec: Recorded = { table, op: "select", eq: {}, in: {} };
    db.queries.push(rec);
    const b: Record<string, unknown> = {
      select() { return b; },
      update(payload: unknown) { rec.op = "update"; rec.payload = payload; return b; },
      insert(payload: unknown) { rec.op = "insert"; rec.payload = payload; return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      in(col: string, vals: unknown[]) { rec.in[col] = vals; return b; },
      or() { return b; }, order() { return b; }, limit() { return b; }, neq() { return b; },
      maybeSingle() {
        if (rec.table === "calls" && rec.op === "select") {
          return Promise.resolve({ data: db.orphanRow, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return b;
  }
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
        refreshSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

// The Voice SDK never runs under test; every entry point is an inert recorder.
vi.mock("@twilio/voice-sdk", () => ({ Device: class {} }));
vi.mock("@/lib/twilio-voice", () => ({
  initTwilioDevice: vi.fn(() => new Promise(() => {})), // registration never settles — irrelevant here
  destroyTwilioDevice: vi.fn(() => Promise.resolve()),
  twilioMakeCall: vi.fn(),
  twilioHangUp: vi.fn(),
  twilioHangUpAll: vi.fn(),
  twilioAnswerCall: vi.fn(),
  getTwilioDevice: vi.fn(() => null),
  getCallSid: vi.fn(() => null),
  getCallDirection: vi.fn(() => null),
  getCallStatus: vi.fn(() => null),
  clearIncomingCallHandlers: vi.fn(),
  subscribeToIncomingCalls: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, { error: () => {}, success: () => {}, info: () => {}, message: () => {} }),
}));

import { TwilioProvider } from "@/contexts/TwilioContext";

const operatorRow = () => ({
  id: OPERATOR, organization_id: ORG, role: "Super Admin", is_super_admin: true,
  first_name: "Op", last_name: "Erator",
});
const viewedRow = () => ({
  id: VIEWED, organization_id: ORG, role: "Agent", is_super_admin: false,
  first_name: "Ada", last_name: "Agent",
});

const callsQueries = () => db.queries.filter((q) => q.table === "calls");
const queriesTouching = (id: string) =>
  db.queries.filter((q) => Object.values(q.eq).includes(id) || Object.values(q.in).some((v) => v.includes(id)));

const settle = async () => { await new Promise((r) => setTimeout(r, 30)); };

function renderProvider() {
  return render(
    <TwilioProvider>
      <div data-testid="child" />
    </TwilioProvider>,
  );
}

beforeEach(() => {
  db.queries = [];
  db.orphanRow = null;
  authState.isImpersonating = false;
  authState.real = operatorRow();
  authState.effective = null;
  authState.userId = OPERATOR;
});
afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("a Super Admin viewing an Agent never touches the Agent's calls", () => {
  it("the orphan check queries the OPERATOR's id, not the viewed agent's", async () => {
    authState.isImpersonating = true;
    authState.effective = viewedRow();
    renderProvider();
    await settle();

    const orphanSelects = callsQueries().filter((q) => q.op === "select");
    expect(orphanSelects.length, "the orphan check never ran at all").toBeGreaterThan(0);
    for (const q of orphanSelects) {
      expect(q.eq.agent_id, "an active-call lookup used the viewed agent's id").toBe(OPERATOR);
    }
    expect(queriesTouching(VIEWED), "some query carried the viewed agent's id").toEqual([]);
  });

  it("an orphan UPDATE (stale-ringing cleanup) writes with the OPERATOR's id, never the agent's", async () => {
    // A stale ringing OUTBOUND row — the classification that triggers the automatic
    // `status: 'failed'` write. Under the defect this row would have been the VIEWED agent's and
    // the operator's browser would have failed it out from under them.
    db.orphanRow = {
      id: "call-1", twilio_call_sid: "CA1", contact_id: null, caller_id_used: "+15550001111",
      started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      status: "ringing", direction: "outbound",
    };
    authState.isImpersonating = true;
    authState.effective = viewedRow();
    renderProvider();
    await waitFor(() => expect(callsQueries().some((q) => q.op === "update")).toBe(true));

    for (const q of callsQueries().filter((q) => q.op === "update")) {
      expect(q.eq.agent_id, "a calls UPDATE was scoped to the viewed agent").toBe(OPERATOR);
    }
    expect(queriesTouching(VIEWED)).toEqual([]);
  });

  it("ENTERING View As triggers no new call query, recovery, update or initialisation", async () => {
    // The identity the provider runs on must not CHANGE when impersonation starts: `realProfile`
    // is the same row before and after, so effects keyed on the profile id must not re-fire.
    const view = renderProvider();
    await settle();
    db.queries = [];

    authState.isImpersonating = true;
    authState.effective = viewedRow();
    view.rerender(
      <TwilioProvider>
        <div data-testid="child" />
      </TwilioProvider>,
    );
    await settle();

    expect(callsQueries(), "activation re-ran a calls query").toEqual([]);
    expect(queriesTouching(VIEWED), "activation issued a query for the viewed agent").toEqual([]);
  });

  it("fails closed while the real profile is unavailable", async () => {
    authState.real = null;
    authState.isImpersonating = true;
    authState.effective = viewedRow();
    renderProvider();
    await settle();

    // No real profile → no telephony identity → nothing is queried, for anyone. The effective
    // profile must NOT be used as a fallback identity.
    expect(callsQueries()).toEqual([]);
    expect(queriesTouching(VIEWED)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("ordinary non-impersonating telephony is unchanged", () => {
  // POSITIVE CONTROLS — pass at dcb71a6. `realProfile === profile` outside View As, so pinning the
  // provider to `realProfile` must be invisible to a normal session.
  it("the orphan check still runs for the signed-in agent", async () => {
    renderProvider();
    await settle();

    const orphanSelects = callsQueries().filter((q) => q.op === "select");
    expect(orphanSelects.length).toBeGreaterThan(0);
    expect(orphanSelects[0].eq.agent_id).toBe(OPERATOR);
  });

  it("stale-ringing cleanup still fires for the signed-in agent's own orphan", async () => {
    db.orphanRow = {
      id: "call-2", twilio_call_sid: "CA2", contact_id: null, caller_id_used: "+15550001111",
      started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      status: "ringing", direction: "outbound",
    };
    renderProvider();

    await waitFor(() => expect(callsQueries().some((q) => q.op === "update")).toBe(true));
    const upd = callsQueries().find((q) => q.op === "update")!;
    expect(upd.eq.agent_id).toBe(OPERATOR);
    expect((upd.payload as { status?: string })?.status).toBe("failed");
  });

  it("renders its children either way", async () => {
    renderProvider();
    expect(screen.getByTestId("child")).toBeTruthy();
  });
});
