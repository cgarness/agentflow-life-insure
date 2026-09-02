/**
 * `useCustomMenuLinks` honors its `enabled` option at the QUERY level.
 *
 * The Sidebar passes `enabled: !isImpersonating` (pinned in viewAsSidebarNav.test.tsx), but that
 * suite mocks this hook — so the wiring inside the hook (`enabled: callerEnabled &&
 * !!organizationId`) needs its own proof that `enabled: false` means no `custom_menu_links` read
 * is ISSUED, not merely no link rendered.
 */

import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ tables: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    db.tables.push(table);
    const b: Record<string, unknown> = {
      select() { return b; }, eq() { return b; }, order() { return b; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return b;
  }
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "33333333-3333-4333-8333-333333333333" }),
}));

import { useCustomMenuLinks } from "@/hooks/useCustomMenuLinks";

const Probe: React.FC<{ enabled?: boolean }> = ({ enabled }) => {
  const q = useCustomMenuLinks(enabled === undefined ? undefined : { enabled });
  return <span data-testid="status">{q.status}</span>;
};

const renderProbe = (enabled?: boolean) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Probe enabled={enabled} />
    </QueryClientProvider>,
  );
};

beforeEach(() => { db.tables = []; });
afterEach(cleanup);

describe("useCustomMenuLinks enabled gate", () => {
  it("enabled: false issues NO custom_menu_links read", async () => {
    renderProbe(false);

    // Give a would-be query every chance to fire before asserting silence.
    await new Promise((r) => setTimeout(r, 50));
    expect(db.tables, "the query ran despite enabled: false").not.toContain("custom_menu_links");
    expect(screen.getByTestId("status").textContent).toBe("pending");
  });

  // POSITIVE CONTROL — the default is unchanged: with an organization, the read happens.
  it("issues the read by default", async () => {
    renderProbe();

    await waitFor(() => expect(db.tables).toContain("custom_menu_links"));
  });
});
