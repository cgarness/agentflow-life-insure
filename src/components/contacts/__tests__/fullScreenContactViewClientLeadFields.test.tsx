vi.mock("@/hooks/useSmsConsentStatus", () => ({ useSmsConsentStatus: () => ({ data: { enforced: false }, error: null, refetch: vi.fn() }) }));
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

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
  successToasts: [] as string[],
  activityAdds: [] as Array<Record<string, unknown>>,
  fields: [] as import("@/lib/types").CustomField[],
  organizationId: "org-1",
  userId: "user-1",
  canEdit: true,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (msg: string) => h.errorToasts.push(msg),
    success: (msg: string) => h.successToasts.push(msg),
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
  customFieldsSupabaseApi: { getAll: vi.fn(async () => h.fields) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: h.userId },
    profile: { id: h.userId, first_name: "Alexa", last_name: "Segura" },
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
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.organizationId }) }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasContactsPermission: () => h.canEdit }),
}));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/followups/ContactFollowUpsCard", () => ({ ContactFollowUpsCard: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({
  MessageTemplatesPickerModal: () => null,
}));
vi.mock("../TasksPanel", () => ({ TasksPanel: () => null }));


vi.mock("@/lib/supabase-dispositions", () => ({ dispositionsSupabaseApi: { getAll: vi.fn(async () => []) } }));
import FullScreenContactView from "@/components/contacts/FullScreenContactView";

import { rowToClient } from "@/lib/supabase-clients";

// A converted client exactly as the server returns it after 20261021200000 (mapped by the real rowToClient).
const convertedRow = {
  id: "synthetic-client", first_name: "Pat", last_name: "Lee", phone: "2025550101", email: "pat@example.test", state: "CA",
  policy_type: "Term", carrier: "Synthetic Life", premium: 50, face_amount: 100000, sold_date: "2026-10-01",
  assigned_agent_id: "user-1", notes: "Agent conversion note", created_at: "2026-10-21T20:00:00Z", updated_at: "2026-10-21T20:00:00Z",
  date_of_birth: "03/04/1960", age: 66, best_time_to_call: "Morning", spouse_info: { name: "Sam", age: 64 },
  custom_fields: { Gender: "Female", additional_policies: [{ policyId: "p-2", policyType: "Final Expense", carrier: "Synthetic Life",
    premiumAmount: "30.00", soldDate: "2026-10-01" }] },
  lead_conversion: { version: 1, lead_id: "lead-1", converted_at: "2026-10-21T20:00:00+00:00", converted_by: "user-1",
    lead_status: "Interested", lead_source: "Facebook", lead_score: 9, lead_created_at: "2026-09-01T12:00:00+00:00",
    lead_notes: "Original lead notes text" },
};
const historicalRow = {
  id: "historical-client", first_name: "Old", last_name: "Client", phone: "2025550102", email: "old@example.test", state: "TX",
  policy_type: "Term", carrier: "Synthetic Life", premium: 40, created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
};
const labels = (name: string) => Array.from(document.querySelectorAll("label")).filter(l => l.textContent === name);
const editor = (name: string) => labels(name)[0]?.parentElement?.querySelector("input, textarea, select") as HTMLInputElement | null | undefined;
const onUpdate = vi.fn(async (_id: string, _data: Record<string, unknown>) => {});
async function mount(type: "lead" | "client", contact: Record<string, unknown>) {
  const view = render(<FullScreenContactView type={type} contact={contact} onUpdate={onUpdate} onClose={vi.fn()} onDelete={vi.fn()} />);
  await waitFor(() => expect(labels("First Name")).toHaveLength(1));
  return view;
}
const edit = () => fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
const save = () => fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  h.fields = []; h.organizationId = "org-1"; h.userId = "user-1"; h.canEdit = true;
  h.errorToasts.length = 0; h.successToasts.length = 0; h.activityAdds.length = 0;
  onUpdate.mockImplementation(async () => {});
  for (const key of Object.keys(tableData)) delete tableData[key];
});

describe("converted client — preserved lead information in the existing profile", () => {
  it("read mode shows the preserved person fields and the read-only Original lead panel", async () => {
    await mount("client", rowToClient(convertedRow) as unknown as Record<string, unknown>);
    expect(labels("DOB")).toHaveLength(1);
    expect(screen.getByText("03/04/1960")).toBeInTheDocument(); // a legacy DOB format is shown, never blanked
    expect(labels("Age")).toHaveLength(1);
    expect(screen.getByText("66")).toBeInTheDocument();
    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("name: Sam · age: 64")).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Original lead" });
    expect(panel).toHaveTextContent("Lead sourceFacebook");
    expect(panel).toHaveTextContent("Status at conversionInterested");
    expect(panel).toHaveTextContent("Converted byAlexa Segura");
    expect(panel).toHaveTextContent("Original lead notes text");
    expect(document.body).not.toHaveTextContent(/lead score|\bscore\b/i);
    expect(labels("Source")).toHaveLength(0); // lead source is history, never an editable client field
    expect(labels("additional_policies")).toHaveLength(0);
    expect(screen.getByText("Agent conversion note")).toBeInTheDocument();
  });

  it("edit mode offers the person fields; structured spouse info stays read-only; history is never editable", async () => {
    await mount("client", rowToClient(convertedRow) as unknown as Record<string, unknown>);
    edit();
    expect(editor("DOB")).toHaveAttribute("type", "text"); // the date picker cannot show 03/04/1960
    expect(editor("DOB")).toHaveValue("03/04/1960");
    expect(editor("Age")).toHaveValue(66);
    expect(editor("Best Time to Call")).toHaveValue("Morning"); // a legacy option stays selectable
    expect(editor("Spouse Info")).toBeNull();
    expect(screen.getByText("name: Sam · age: 64")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Original lead" })).toBeNull();
    fireEvent.change(editor("First Name")!, { target: { value: "Patricia" } });
    save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const sent = onUpdate.mock.calls[0][1];
    expect(sent.firstName).toBe("Patricia");
    expect(sent.dateOfBirth).toBe("03/04/1960");
    expect(sent.age).toBe(66);
    expect(sent.spouseInfo).toEqual({ name: "Sam", age: 64 });
    expect(sent.customFields).toEqual(convertedRow.custom_fields);
    expect(sent.leadConversion).toEqual(rowToClient(convertedRow).leadConversion);
  });

  it("saves edited person fields and refuses an invalid change without leaving edit mode", async () => {
    await mount("client", rowToClient({ ...convertedRow, spouse_info: "Sam" }) as unknown as Record<string, unknown>);
    edit();
    fireEvent.change(editor("Age")!, { target: { value: "200" } });
    save();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(h.errorToasts.at(-1)).toBe("Age must be a whole number from 0 to 130.");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    fireEvent.change(editor("Age")!, { target: { value: "67" } });
    fireEvent.change(editor("Best Time to Call")!, { target: { value: "Anytime" } });
    fireEvent.change(editor("Spouse Info")!, { target: { value: "Sam Lee" } });
    save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1]).toMatchObject({ age: 67, bestTimeToCall: "Anytime", spouseInfo: "Sam Lee", dateOfBirth: "03/04/1960" });
  });

  it("a historical client without the new fields renders safely: nothing invented, no panel, editable when wanted", async () => {
    await mount("client", rowToClient(historicalRow) as unknown as Record<string, unknown>);
    for (const name of ["DOB", "Age", "Best Time to Call", "Spouse Info"]) expect(labels(name)).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Original lead" })).toBeNull();
    edit();
    expect(editor("DOB")).toBeTruthy();
    expect(editor("Age")).toHaveValue(null);
    expect(editor("Spouse Info")).toHaveValue("");
    fireEvent.change(editor("First Name")!, { target: { value: "Older" } });
    save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const sent = onUpdate.mock.calls[0][1];
    for (const key of ["dateOfBirth", "age", "bestTimeToCall", "spouseInfo", "leadConversion"]) expect(sent[key]).toBeUndefined();
  });

  it("leads are unchanged: Source and the lead-only editors still render for leads", async () => {
    await mount("lead", { id: "synthetic-lead", firstName: "Lead", lastName: "Person", phone: "2025550103", state: "TX",
      leadSource: "Referral", age: 40, dateOfBirth: "1986-01-01", bestTimeToCall: "Anytime", spouseInfo: "Kim" });
    expect(labels("Source")).toHaveLength(1);
    expect(labels("Age")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Original lead" })).toBeNull();
  });
});
