/**
 * CalendarProvider mixes no identities: appointments are read and written for the REAL session
 * user, so the organization they are scoped to must be the REAL profile's too.
 *
 * At dcb71a6 the provider paired `useAuth().user.id` (always real) with
 * `useOrganization().organizationId` (derived from the EFFECTIVE — possibly viewed — profile).
 * Activation currently confines "View As" targets to the operator's own organization, so the two
 * values coincide today; this pins the IDENTITY, not the coincidence, so a future cross-org
 * "View As" cannot silently start querying the real user's appointments inside the viewed
 * organization.
 */

import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REAL_ORG = "11111111-1111-4111-8111-111111111111";
const VIEWED_ORG = "22222222-2222-4222-8222-222222222222";

const db = vi.hoisted(() => ({
  queries: [] as { table: string; eq: Record<string, unknown> }[],
}));
const authState = vi.hoisted(() => ({ isImpersonating: false }));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec = { table, eq: {} as Record<string, unknown> };
    db.queries.push(rec);
    const b: Record<string, unknown> = {
      select() { return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      gte() { return b; }, lte() { return b; }, order() { return b; },
      insert() { return b; }, update() { return b; }, delete() { return b; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return b;
  }
  const channel = { on() { return channel; }, subscribe() { return channel; } };
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
    user: { id: OPERATOR },
    profile: authState.isImpersonating
      ? { id: "viewed-1", organization_id: VIEWED_ORG, role: "Agent" }
      : { id: OPERATOR, organization_id: REAL_ORG, role: "Super Admin" },
    realProfile: { id: OPERATOR, organization_id: REAL_ORG, role: "Super Admin" },
    isImpersonating: authState.isImpersonating,
  }),
}));

import { CalendarProvider } from "@/contexts/CalendarContext";

const apptQueries = () => db.queries.filter((q) => q.table === "appointments");

beforeEach(() => {
  db.queries = [];
  authState.isImpersonating = false;
});
afterEach(cleanup);

describe("CalendarProvider organization identity", () => {
  it("queries the REAL profile's organization even while impersonating", async () => {
    authState.isImpersonating = true;
    render(
      <CalendarProvider>
        <div data-testid="child" />
      </CalendarProvider>,
    );

    await waitFor(() => expect(apptQueries().length).toBeGreaterThan(0));
    for (const q of apptQueries()) {
      expect(q.eq.organization_id, "an appointments query used the viewed organization").toBe(REAL_ORG);
    }
  });

  // POSITIVE CONTROL — passes at dcb71a6: outside View As the two derivations coincide.
  it("queries the same organization for an ordinary session", async () => {
    render(
      <CalendarProvider>
        <div data-testid="child" />
      </CalendarProvider>,
    );

    await waitFor(() => expect(apptQueries().length).toBeGreaterThan(0));
    expect(apptQueries()[0].eq.organization_id).toBe(REAL_ORG);
  });
});
