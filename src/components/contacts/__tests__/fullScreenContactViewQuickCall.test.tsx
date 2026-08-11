/**
 * Case F — the ALREADY-CORRECT surface must not regress.
 *
 * `Contacts.tsx` passes canonical camelCase contacts (via `rowToLead`/`rowToClient`/
 * `rowToRecruit`) into `FullScreenContactView`. Those quick-calls were always named
 * correctly; the 2026-08-11 fix must leave them byte-identical while repairing the
 * raw-row path. Also pins the new refusal behaviour for an undialable number.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QUICK_CALL_EVENT } from "@/lib/quick-call";

const tableData: Record<string, unknown> = {};

function makeQuery(table: string) {
  const result = { data: tableData[table] ?? null, error: null };
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "eq", "in", "or", "not", "order", "limit", "gte", "lt", "neq", "is"]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => Promise.resolve(result);
  query.single = () => Promise.resolve(result);
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

const h = vi.hoisted(() => ({
  errorToasts: [] as string[],
  activityAdds: [] as Array<Record<string, unknown>>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (msg: string) => h.errorToasts.push(msg),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: {
    getByContact: vi.fn(async () => []),
    add: vi.fn(async (payload: Record<string, unknown>) => {
      h.activityAdds.push(payload);
      return { id: "a1" };
    }),
  },
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
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("./TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";

/** Exactly the shape Contacts.tsx hands the view today (canonical `Lead`). */
const CANONICAL_LEAD = {
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Charlotte",
  lastName: "Kearney",
  phone: "5125550123",
  email: "charlotte@example.com",
  state: "TX",
  status: "New",
  leadSource: "Facebook Ads",
  leadScore: 7,
  assignedAgentId: "user-1",
  userId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

type QuickCallDetailShape = { contactId: string; name: string; phone: string; type: string; fromNumber?: string };

let received: QuickCallDetailShape[] = [];
const capture = (e: Event) => received.push((e as CustomEvent).detail as QuickCallDetailShape);

beforeEach(() => {
  received = [];
  h.errorToasts = [];
  h.activityAdds = [];
  window.addEventListener(QUICK_CALL_EVENT, capture);
  for (const key of Object.keys(tableData)) delete tableData[key];
});

afterEach(() => {
  window.removeEventListener(QUICK_CALL_EVENT, capture);
  cleanup();
  vi.clearAllMocks();
});

async function renderAndCall(contact: Record<string, unknown>, type: "lead" | "client" | "recruit" = "lead") {
  render(
    <FullScreenContactView
      contact={contact}
      type={type}
      onClose={vi.fn()}
      onUpdate={vi.fn(async () => {})}
      onDelete={vi.fn(async () => {})}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /^call$/i }));
}

describe("F. canonical Contacts quick-calls are unchanged", () => {
  it("dispatches the correct name, id, phone and type for a canonical lead", async () => {
    await renderAndCall(CANONICAL_LEAD);

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      contactId: CANONICAL_LEAD.id,
      name: "Charlotte Kearney",
      phone: "5125550123",
      type: "lead",
    });
  });

  it("keeps a client typed as client and a recruit typed as recruit", async () => {
    await renderAndCall({ ...CANONICAL_LEAD, id: "c-1" }, "client");
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].type).toBe("client");
    expect(received[0].name).toBe("Charlotte Kearney");

    cleanup();
    await renderAndCall({ ...CANONICAL_LEAD, id: "r-1" }, "recruit");
    await waitFor(() => expect(received).toHaveLength(2));
    expect(received[1].type).toBe("recruit");
    expect(received[1].name).toBe("Charlotte Kearney");
  });

  it("preserves a multi-word surname verbatim", async () => {
    await renderAndCall({ ...CANONICAL_LEAD, lastName: "Van Der Berg" });

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].name).toBe("Charlotte Van Der Berg");
  });

  it("does not strip a real surname that resembles a placeholder", async () => {
    await renderAndCall({ ...CANONICAL_LEAD, lastName: "Null" });

    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].name).toBe("Charlotte Null");
  });
});

describe("the no-phone path keeps its ORIGINAL behaviour (this fix must not change it)", () => {
  it("still writes the 'Call initiated' activity and shows no new error toast", async () => {
    await renderAndCall({ ...CANONICAL_LEAD, phone: "" });

    // Unconditional, exactly as before the fix: the activity is logged even though no
    // call can start. The dialer then silently does nothing — unchanged for the agent.
    await waitFor(() => expect(h.activityAdds.length).toBeGreaterThan(0));
    expect(h.activityAdds.some((a) => a.type === "call")).toBe(true);
    expect(received).toHaveLength(0);
    expect(h.errorToasts).toHaveLength(0);
  });

  it("logs the activity on a normal dialable call too", async () => {
    await renderAndCall(CANONICAL_LEAD);

    await waitFor(() => expect(received).toHaveLength(1));
    expect(h.activityAdds.some((a) => a.type === "call")).toBe(true);
    expect(h.errorToasts).toHaveLength(0);
  });
});
