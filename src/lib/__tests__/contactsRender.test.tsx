/**
 * Regression guard for the Build 2 production-only TDZ:
 *   "Cannot access 'sortCol' before initialization"
 * fetchData's useCallback dependency array (evaluated eagerly during render)
 * referenced sortCol/sortDir, which were declared LATER in the component body.
 * Rendering the component executes the body top-to-bottom and hits that deps
 * array — so renderToString reproduces the crash (before the fix) and proves it
 * gone (after). tsc / unit tests / madge all missed it; this test would not.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

// --- contexts / hooks ---
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { organization_id: "o1", role: "Admin" }, isBuildingOrganization: false }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "o1", role: "Admin", isSuperAdmin: false }),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: unknown) => String(v ?? ""), formatDateTime: (v: unknown) => String(v ?? "") }),
}));
vi.mock("@/hooks/useContactScope", () => ({
  useContactScope: () => ({
    scope: "mine", setScope: () => {}, availableScopes: ["mine"],
    maxScope: "all", teamAgents: [], teamAgentIds: [], hasDownline: false, ready: true, prefError: false,
  }),
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ state: null, pathname: "/contacts", search: "", hash: "", key: "t" }),
  useSearchParams: () => [new URLSearchParams(""), () => {}],
}));

// --- supabase (effects don't run under renderToString, but the module is imported) ---
vi.mock("@/integrations/supabase/client", () => {
  const res = Promise.resolve({ data: [], error: null, count: 0 });
  const b: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (p === "then" ? (res as unknown as { then: unknown }).then.bind(res) : () => b) });
  return { supabase: { from: () => b, rpc: () => b, auth: {} } };
});

// --- heavy child components stubbed so the JSX tree renders trivially ---
vi.mock("@/components/contacts/FullScreenContactView", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddClientModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddRecruitModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AgentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactsFilterModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ContactKanbanBoard", () => ({ ContactKanbanBoard: () => null }));
vi.mock("@/components/contacts/ContactScopeSelector", () => ({ default: () => null }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  CommissionGate: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Contacts from "@/pages/Contacts";

describe("Contacts page renders without a temporal-dead-zone crash", () => {
  it("executes the component body (incl. fetchData deps) without 'before initialization'", () => {
    let err: unknown;
    try {
      renderToString(React.createElement(Contacts));
    } catch (e) {
      err = e;
    }
    // The fix is specifically that no binding is accessed before initialization.
    if (err) expect(String((err as Error).message)).not.toMatch(/before initialization/i);
    expect(err).toBeUndefined();
  });
});
