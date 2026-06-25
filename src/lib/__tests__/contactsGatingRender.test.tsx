/**
 * Contacts Build 5 (CP2) — Contacts page permission gating (render-level).
 *
 * Renders the real Contacts page (server render, no effects) with the Contacts
 * permission reader mocked, and asserts that permission-gated toolbar entry
 * points (Import CSV, Add Lead) appear only when allowed. The conversion path is
 * never represented in the catalog, so it cannot be gated (see contactsPermissions.test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

// Mutable permission holder (hoisted so the vi.mock factory can read it).
const permState = vi.hoisted(() => ({ allow: true }));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasContactsPermission: () => permState.allow,
    hasPageAccess: () => true,
    hasFeatureAccess: () => true,
    getDataScope: () => "all",
    canSeeCommission: () => true,
    hasSettingsSectionAccess: () => true,
    isLoading: false,
    error: null,
    permissions: null,
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { organization_id: "o1", role: "Agent" }, isBuildingOrganization: false }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "o1", role: "Agent", isSuperAdmin: false }),
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
vi.mock("@/integrations/supabase/client", () => {
  const res = Promise.resolve({ data: [], error: null, count: 0 });
  const b: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (p === "then" ? (res as unknown as { then: unknown }).then.bind(res) : () => b) });
  return { supabase: { from: () => b, rpc: () => b, auth: {} } };
});
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

function renderHtml(): string {
  return renderToString(React.createElement(Contacts));
}

describe("Contacts page — permission-gated toolbar entry points", () => {
  beforeEach(() => {
    permState.allow = true;
  });

  // NOTE: SSR renders `Add {addContactType}` as `Add <!-- -->Lead`, so the Add
  // button is matched by its closing marker `Lead</button>` (the "Leads" tab is
  // `Leads</button>`, which does not match `Lead</button>`).
  it("shows Import CSV and Add Lead when the Contacts permissions are granted", () => {
    permState.allow = true;
    const html = renderHtml();
    expect(html).toContain("Import CSV");
    expect(html).toContain("Lead</button>");
  });

  it("hides Import CSV and Add Lead when the Contacts permissions are denied", () => {
    permState.allow = false;
    const html = renderHtml();
    expect(html).not.toContain("Import CSV");
    expect(html).not.toContain("Lead</button>");
  });
});
