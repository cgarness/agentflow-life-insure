/**
 * Deep-linked contact quick-call identity (production defect, 2026-08-11).
 *
 * `/leads/:id`, `/clients/:id` and `/recruits/:id` fetch with `select("*")`, so the page
 * holds a RAW snake_case row. It was handed straight to `FullScreenContactView`, which
 * reads canonical camelCase — so the Call button dispatched
 * `name: "undefined undefined"`, `FloatingDialer` split it into first/last, and
 * `TwilioContext.makeCall` snapshotted it into `calls.contact_name`.
 *
 * This exercises the REAL page and the REAL Call button over a stubbed Supabase, and
 * asserts on the canonical `quick-call` event `FloatingDialer` actually listens for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QUICK_CALL_EVENT } from "@/lib/quick-call";

/** Raw rows exactly as PostgREST returns them for `select("*")`. */
const RAW_ROWS: Record<string, Record<string, unknown>> = {
  leads: {
    id: "11111111-1111-1111-1111-111111111111",
    first_name: "Charlotte",
    last_name: "Kearney",
    phone: "5125550123",
    email: "charlotte@example.com",
    state: "TX",
    status: "New",
    lead_source: "Facebook Ads",
    lead_score: 7,
    assigned_agent_id: "aaaa0000-0000-0000-0000-000000000001",
    organization_id: "0f000000-0000-0000-0000-0000000000aa",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  clients: {
    id: "22222222-2222-2222-2222-222222222222",
    first_name: "Charlotte",
    last_name: "Kearney",
    phone: "5125550124",
    email: "charlotte@example.com",
    state: "TX",
    policy_type: "Term",
    carrier: "Mutual",
    premium: 120,
    face_amount: 250000,
    organization_id: "0f000000-0000-0000-0000-0000000000aa",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  recruits: {
    id: "33333333-3333-3333-3333-333333333333",
    first_name: "Charlotte",
    last_name: "Kearney",
    phone: "5125550125",
    email: "charlotte@example.com",
    state: "TX",
    status: "Prospect",
    organization_id: "0f000000-0000-0000-0000-0000000000aa",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
};

/** Chainable Supabase stub — every builder method returns the same thenable. */
const tableData: Record<string, unknown> = {};

function makeQuery(table: string) {
  const result = { data: tableData[table] ?? null, error: null };
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "eq", "in", "or", "not", "order", "limit", "gte", "lt", "neq", "is", "update", "delete"]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => Promise.resolve(result);
  query.single = () => Promise.resolve(result);
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));

const h = vi.hoisted(() => ({ routeId: "" }));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: h.routeId }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/supabase-notes", () => ({
  notesSupabaseApi: { getByContact: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({ id: "a1" })) },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { id: "user-1", first_name: "Alexa", last_name: "Segura" } }),
}));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: vi.fn() }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
    branding: { companyName: "AgentFlow" },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "0f000000-0000-0000-0000-0000000000aa" }),
}));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));

vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("@/components/contacts/TasksPanel", () => ({ TasksPanel: () => null }));

import ContactDeepLinkPage from "@/pages/ContactDeepLinkPage";

type QuickCallDetailShape = {
  contactId: string;
  name: string;
  phone: string;
  type: string;
  fromNumber?: string;
};

let received: QuickCallDetailShape[] = [];
const capture = (e: Event) => received.push((e as CustomEvent).detail as QuickCallDetailShape);

beforeEach(() => {
  received = [];
  window.addEventListener(QUICK_CALL_EVENT, capture);
  for (const key of Object.keys(tableData)) delete tableData[key];
});

afterEach(() => {
  window.removeEventListener(QUICK_CALL_EVENT, capture);
  cleanup();
  vi.clearAllMocks();
});

/** Mount the deep-link page for one contact kind and click its real Call button. */
async function deepLinkAndCall(contactType: "lead" | "client" | "recruit", row: Record<string, unknown>) {
  const table = contactType === "lead" ? "leads" : contactType === "client" ? "clients" : "recruits";
  tableData[table] = row;
  h.routeId = row.id as string;

  render(<ContactDeepLinkPage contactType={contactType} />);

  const callButton = await screen.findByRole("button", { name: /^call$/i });
  fireEvent.click(callButton);
}

describe("deep-linked contact quick-call carries a real identity", () => {
  it("A. raw Supabase LEAD row dispatches name 'Charlotte Kearney'", async () => {
    await deepLinkAndCall("lead", RAW_ROWS.leads);

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].name).toBe("Charlotte Kearney");
    expect(received[0].type).toBe("lead");
    expect(received[0].contactId).toBe(RAW_ROWS.leads.id);
    expect(received[0].phone).toBe("5125550123");
  });

  it("B. raw Supabase CLIENT row dispatches name 'Charlotte Kearney' and type 'client'", async () => {
    await deepLinkAndCall("client", RAW_ROWS.clients);

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].name).toBe("Charlotte Kearney");
    expect(received[0].type).toBe("client");
    expect(received[0].contactId).toBe(RAW_ROWS.clients.id);
    expect(received[0].phone).toBe("5125550124");
  });

  it("C. raw Supabase RECRUIT row dispatches name 'Charlotte Kearney' and type 'recruit'", async () => {
    await deepLinkAndCall("recruit", RAW_ROWS.recruits);

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].name).toBe("Charlotte Kearney");
    expect(received[0].type).toBe("recruit");
    expect(received[0].contactId).toBe(RAW_ROWS.recruits.id);
    expect(received[0].phone).toBe("5125550125");
  });

  it("D. never dispatches the literal 'undefined undefined' — not even for a null last_name", async () => {
    await deepLinkAndCall("lead", { ...RAW_ROWS.leads, last_name: null });

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].name).not.toBe("undefined undefined");
    expect(received[0].name).not.toMatch(/\bundefined\b/);
    expect(received[0].name).not.toMatch(/\bnull\b/);
    expect(received[0].name).toBe("Charlotte");
  });

  it("D. a row with no name at all dispatches an empty name, never a placeholder literal", async () => {
    await deepLinkAndCall("lead", { ...RAW_ROWS.leads, first_name: null, last_name: null });

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].name).toBe("");
    // The call still starts — a nameless contact must remain dialable.
    expect(received[0].phone).toBe("5125550123");
    expect(received[0].contactId).toBe(RAW_ROWS.leads.id);
  });

  it("renders the resolved name in the record header (not blank)", async () => {
    tableData.leads = RAW_ROWS.leads;
    h.routeId = RAW_ROWS.leads.id as string;
    render(<ContactDeepLinkPage contactType="lead" />);

    expect(await screen.findByText("Charlotte Kearney")).toBeInTheDocument();
  });

  it("preserves the selected fromNumber when the org has an active number", async () => {
    tableData.phone_numbers = [
      { phone_number: "+15125559000", friendly_name: "Main", is_default: true },
    ];
    await deepLinkAndCall("lead", RAW_ROWS.leads);

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].fromNumber).toBe("+15125559000");
  });

  it("omits fromNumber entirely when the org has no usable number", async () => {
    await deepLinkAndCall("lead", RAW_ROWS.leads);

    await waitFor(() => expect(received).toHaveLength(1));
    expect("fromNumber" in received[0]).toBe(false);
  });
});
