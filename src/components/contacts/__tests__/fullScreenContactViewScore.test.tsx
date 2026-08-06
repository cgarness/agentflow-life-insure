/**
 * Lead-score exposure fix (2026-08-06) — Lead Details must not show or edit the
 * internal `leads.lead_score`, in READ mode or EDIT mode.
 *
 * The agency layout fixture is the VERBATIM `field_order_lead` column default
 * from migration `20260326220000_add_field_order_to_settings.sql` — i.e. what a
 * real organization row holds — so this exercises the actual production path
 * where a stale saved layout would otherwise re-expose the field. No migration
 * and no data rewrite: `resolveFieldOrder` sanitizes it on read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/** Verbatim migration 20260326220000 default — still contains "leadScore". */
const MIGRATION_DEFAULT_FIELD_ORDER_LEAD = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "state",
  "leadSource",
  "leadScore",
  "age",
  "dateOfBirth",
  "spouseInfo",
  "assignedAgentId",
  "notes",
];

/**
 * Chainable Supabase stub: every builder method returns the same thenable, so
 * any `.from(...).select(...).eq(...)` chain (awaited directly or via
 * `.maybeSingle()`) resolves to the table's configured payload.
 */
const tableData: Record<string, unknown> = {};

function makeQuery(table: string) {
  const result = { data: tableData[table] ?? null, error: null };
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [
    "select",
    "eq",
    "in",
    "or",
    "not",
    "order",
    "limit",
    "gte",
    "lt",
    "neq",
    "is",
  ]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => Promise.resolve(result);
  query.single = () => Promise.resolve(result);
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

vi.mock("@/lib/supabase-notes", () => ({
  notesSupabaseApi: { getByContact: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => {}) },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: {
    getLeadStages: vi.fn(async () => []),
    getRecruitStages: vi.fn(async () => []),
  },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: {
    getMyConnections: vi.fn(async () => []),
    getContactEmails: vi.fn(async () => []),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { id: "user-1", first_name: "Alexa", last_name: "Segura" },
  }),
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
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasContactsPermission: () => true }),
}));

// Heavy children irrelevant to the field grid.
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({
  MessageTemplatesPickerModal: () => null,
}));
vi.mock("./TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";

const lead = {
  id: "lead-1",
  firstName: "Dana",
  lastName: "Reyes",
  phone: "5125550123",
  email: "dana@example.com",
  state: "TX",
  status: "New",
  leadSource: "Facebook",
  leadScore: 9,
  age: 47,
  assignedAgentId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const baseProps = {
  contact: lead,
  type: "lead" as const,
  onClose: vi.fn(),
  onUpdate: vi.fn(async () => {}),
  onDelete: vi.fn(async () => {}),
};

/** Field labels are rendered as their own elements, so an exact-ish match is safe. */
const scoreLabels = () => screen.queryAllByText(/^\s*score\s*$/i);

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableData)) delete tableData[key];
  // The organization's saved layout still carries the stale "leadScore" key.
  tableData["contact_management_settings"] = {
    field_order_lead: MIGRATION_DEFAULT_FIELD_ORDER_LEAD,
    required_fields_lead: {},
  };
});

describe("FullScreenContactView — lead score is not exposed", () => {
  it("renders no Score field in READ mode even when the agency layout still lists leadScore", async () => {
    render(<FullScreenContactView {...baseProps} />);

    // Wait for the core load to resolve the (stale) agency layout.
    await waitFor(() => expect(screen.getByText("Source")).toBeInTheDocument());

    expect(scoreLabels()).toHaveLength(0);
    expect(screen.queryByText("Score: 9")).toBeNull();
  });

  it("still renders Age and the other lead fields from that same layout", async () => {
    render(<FullScreenContactView {...baseProps} />);

    await waitFor(() => expect(screen.getByText("Source")).toBeInTheDocument());

    // Some labels (Phone/Email) also appear in the header action bar, so assert
    // presence rather than uniqueness.
    for (const label of ["First Name", "Last Name", "Phone", "Email", "State", "Age", "DOB"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Assigned Agent")).toBeInTheDocument();
  });

  it("renders no Score field in EDIT mode", async () => {
    render(<FullScreenContactView {...baseProps} />);

    await waitFor(() => expect(screen.getByText("Source")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    // Edit mode is live (Save/Cancel replace the EDIT affordance).
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(scoreLabels()).toHaveLength(0);
    // No numeric score input carries the stored value.
    for (const input of screen.queryAllByRole("spinbutton")) {
      expect((input as HTMLInputElement).value).not.toBe("9");
    }
  });
});
