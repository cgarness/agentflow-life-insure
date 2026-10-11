/**
 * Part B, PB-1: four dialogs drop a visible description that only restated the title, and opt out of
 * Radix's description wiring with `aria-describedby={undefined}` on that one Content.
 *
 *   B5-09 MessageTemplatesPickerModal (shared by the contact view and the Dialer)
 *   B5-23 ContactsFilterModal sheet
 *   B5-28 FullScreenContactView Delete Note dialog
 *   B5-53 AppointmentModal (shared by Calendar, the contact view and the Dialer)
 *
 * Each must keep its accessible name (the title), carry no aria-describedby (no dangling id), lose the
 * removed text, and make Radix log neither the "Missing `Description`" warning nor the missing-title error.
 */
vi.mock("@/hooks/useSmsConsentStatus", () => ({ useSmsConsentStatus: () => ({ data: { enforced: false }, error: null, refetch: vi.fn() }) }));
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  notes: [] as Array<Record<string, unknown>>,
  // STABLE reference: AppointmentModal's init effect depends on it.
  types: [] as never[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    for (const m of ["select", "eq", "in", "or", "not", "order", "limit", "gte", "lte", "lt", "neq", "is", "range", "abortSignal"]) {
      q[m] = () => q;
    }
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: null, error: null });
    return q;
  };
  return {
    supabase: {
      from: () => makeQuery(),
      auth: { getSession: async () => ({ data: { session: null } }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => {},
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {}, message: () => {} } }));
vi.mock("@/hooks/useContactHistory", () => ({ useContactHistory: () => ({
  conversation: { items: [], loading: false, error: null, hasMore: false },
  activity: { items: [], loading: false, error: null, hasMore: false },
  refresh: vi.fn(), loadConversation: vi.fn(), loadActivity: vi.fn(),
}) }));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => h.notes) } }));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({})) },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-dispositions", () => ({ dispositionsSupabaseApi: { getAll: vi.fn(async () => []) } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { id: "user-1", first_name: "Alexa", last_name: "Segura", role: "Admin", organization_id: "org-1" },
  }),
}));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: vi.fn() }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({ formatDate: (v: string) => v, formatDateTime: (v: string) => v, branding: { companyName: "AgentFlow" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/hooks/useAppointmentTypes", () => ({ useAppointmentTypes: () => ({ types: h.types }) }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// Heavy contact-view children that are irrelevant to the Delete Note dialog.
vi.mock("@/components/contacts/followups/ContactFollowUpsCard", () => ({ ContactFollowUpsCard: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/contacts/TasksPanel", () => ({ TasksPanel: () => null }));

import { MessageTemplatesPickerModal } from "@/components/messaging/MessageTemplatesPickerModal";
import ContactsFilterModal, { type ContactsFilterValues } from "@/components/contacts/ContactsFilterModal";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import AppointmentModal from "@/components/calendar/AppointmentModal";

const FILTERS: ContactsFilterValues = {
  stateFilter: "", downlineAgentIds: [], statusFilter: "", sourceFilter: "", startDate: undefined,
  endDate: undefined, timezoneFilters: [], callableNowFilter: false, attemptCountFilters: [],
  lastDispositionFilter: "", policyTypeFilter: "",
};

const LEAD = {
  id: "lead-1", firstName: "Dana", lastName: "Reyes", phone: "5125550123", email: "dana@example.com",
  state: "TX", status: "New", leadSource: "Facebook", assignedAgentId: "user-1",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

let warnSpy: MockInstance;
let errorSpy: MockInstance;
const radixMessages = () =>
  [...warnSpy.mock.calls, ...errorSpy.mock.calls]
    .map((args) => args.map(String).join(" "))
    .filter((m) => /Missing `Description`|aria-describedby=\{undefined\}|requires a `(Dialog|Sheet)?Title`/.test(m));

/** The dialog keeps its title as its accessible name and carries no description reference. */
async function expectTitledWithoutDescription(name: string) {
  const dialog = await screen.findByRole("dialog", { name });
  expect(dialog).not.toHaveAttribute("aria-describedby");
  expect(radixMessages()).toEqual([]);
  return dialog;
}

beforeEach(() => {
  h.notes = [];
  warnSpy = vi.spyOn(console, "warn");
  errorSpy = vi.spyOn(console, "error");
});
afterEach(() => {
  cleanup();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("PB-1 redundant dialog descriptions", () => {
  it("B5-09 Message templates picker keeps its title and drops the intro", async () => {
    render(
      <MessageTemplatesPickerModal open onOpenChange={() => {}} channel="sms" mergeInput={{ contact: {} }} onApply={() => {}} />,
    );
    await expectTitledWithoutDescription("Message templates");
    expect(screen.queryByText(/Pick a saved template/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Merge fields fill in/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search templates...")).toBeInTheDocument();
  });

  it("B5-23 Contacts filter sheet keeps 'Filter Leads' and drops the intro", async () => {
    render(
      <ContactsFilterModal
        open onOpenChange={() => {}} activeTab="Leads" filters={FILTERS} onFiltersChange={() => {}}
        downlineAgents={[]} filterStatuses={["New"]} leadSources={["Facebook"]}
      />,
    );
    await expectTitledWithoutDescription("Filter Leads");
    expect(screen.queryByText(/Narrow down your/i)).not.toBeInTheDocument();
  });

  it("B5-28 Delete Note keeps its title and both actions, without the restating question", async () => {
    h.notes = [{ id: "note-1", note: "Prefers mornings", pinned: false, agentName: "Alexa Segura", createdAt: "2026-01-02T00:00:00Z" }];
    render(
      <MemoryRouter>
        <FullScreenContactView contact={LEAD} type="lead" onClose={vi.fn()} onUpdate={vi.fn(async () => {})} onDelete={vi.fn(async () => {})} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    const pin = await screen.findByTitle("Pin note");
    fireEvent.click(pin.nextElementSibling as HTMLElement);

    const dialog = await expectTitledWithoutDescription("Delete Note");
    expect(screen.queryByText(/Are you sure you want to delete this note/i)).not.toBeInTheDocument();
    expect(dialog).toContainElement(screen.getByRole("button", { name: "Delete" }));
    expect(dialog).toContainElement(screen.getByRole("button", { name: "Cancel" }));
  });

  it("B5-53 Appointment dialog keeps 'Schedule Meeting' and drops the intro", async () => {
    render(
      <MemoryRouter>
        <AppointmentModal open onClose={() => {}} onSave={() => true} editing={null} defaultDate={new Date(2030, 0, 15)} />
      </MemoryRouter>,
    );
    await expectTitledWithoutDescription("Schedule Meeting");
    expect(screen.queryByText(/Set your next meeting details/i)).not.toBeInTheDocument();
  });

  it("B5-53 Appointment dialog keeps 'Edit Appointment' and drops the intro when editing", async () => {
    render(
      <MemoryRouter>
        <AppointmentModal
          open onClose={() => {}} onSave={() => true}
          editing={{
            id: "appt-1", title: "Sales Call with Pat", type: "Sales Call", status: "Scheduled",
            date: new Date(2030, 0, 15), startTime: "10:00 AM", endTime: "10:30 AM", contactName: "Pat Doe",
            contactId: "", agent: "", notes: "", user_id: "user-1", created_by: "user-1", raw_status: "Scheduled",
          }}
        />
      </MemoryRouter>,
    );
    await expectTitledWithoutDescription("Edit Appointment");
    expect(screen.queryByText(/Update your meeting details/i)).not.toBeInTheDocument();
  });
});
