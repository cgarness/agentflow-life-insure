/**
 * `useContactScope` under "View As" — no reads at all, and it still becomes `ready`.
 *
 * The hook already withheld the `get_contact_scope_agents` downline RPC while impersonating
 * (its predicate derives from `auth.uid()`, so it can only ever answer for the REAL operator),
 * and already refused to PERSIST a scope. But its stored-scope loader still ran: a plain
 * `user_preferences` select on the real `user.id`, issued from a session that is previewing
 * someone else. The read's only purposes are to gate `ready` and to surface a load failure —
 * both of which a preview session can settle without touching the operator's row.
 */

import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const db = vi.hoisted(() => ({ tables: [] as string[], rpcs: [] as string[] }));
const authState = vi.hoisted(() => ({ isImpersonating: false }));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    db.tables.push(table);
    const b: Record<string, unknown> = {
      select() { return b; }, eq() { return b; }, upsert() { return Promise.resolve({ error: null }); },
      maybeSingle() { return Promise.resolve({ data: { settings: {} }, error: null }); },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return b;
  }
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: (name: string) => { db.rpcs.push(name); return Promise.resolve({ data: [], error: null }); },
      auth: {},
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: OPERATOR },
    isImpersonating: authState.isImpersonating,
  }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    getDataScope: () => "own",
    hasContactsPermission: () => true,
    isLoading: false,
  }),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(""), () => {}],
}));

import { useContactScope } from "@/hooks/useContactScope";

const Probe: React.FC = () => {
  const { ready, prefError } = useContactScope();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="prefError">{String(prefError)}</span>
    </div>
  );
};

beforeEach(() => {
  db.tables = [];
  db.rpcs = [];
  authState.isImpersonating = false;
});
afterEach(cleanup);

describe("useContactScope under View As", () => {
  it("issues NO user_preferences read and no downline RPC, and still becomes ready", async () => {
    authState.isImpersonating = true;
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(db.tables, "the operator's preference row was read under View As").not.toContain("user_preferences");
    expect(db.rpcs, "the auth.uid()-scoped downline RPC ran under View As").toEqual([]);
    expect(screen.getByTestId("prefError").textContent).toBe("false");
  });

  // POSITIVE CONTROL — passes at dcb71a6.
  it("an ordinary session still reads the stored scope and resolves the downline", async () => {
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(db.tables).toContain("user_preferences");
    expect(db.rpcs).toContain("get_contact_scope_agents");
  });
});
