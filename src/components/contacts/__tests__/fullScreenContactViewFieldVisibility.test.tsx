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
import type { CustomField } from "@/lib/types";

const definition = (id: string, name: string, extra: Partial<CustomField> = {}): CustomField => ({
  id, name, type: "Text", active: true, required: false, appliesTo: ["Leads", "Clients", "Recruits"], usageCount: 0,
  scope: "agency", createdBy: null, createdAt: "2026-01-01", ...extra,
});
const fixture = {
  id: "synthetic-contact", firstName: "Test", lastName: "Person", phone: "2025550101", state: "TX",
  customFields: { Gender: "Example", Beneficiary: "Fixture", "Amt Requested": "$30,000+", "Favorite Hobby": "Walking",
    "Have Life Insurance": false, "Date/Time": "Synthetic date", Platform: "Fixture platform", Ad: "Fixture ad",
    "Interested In": "Fixture product", "Health.Note": "Synthetic note" },
};
const labels = (name: string) => Array.from(document.querySelectorAll("label")).filter(l => l.textContent === name);
const editor = (name: string) => {
  const input = labels(name)[0]?.parentElement?.querySelector("input, textarea, select");
  if (!input) throw new Error(`No editor for ${name}`);
  return input as HTMLInputElement;
};
const onUpdate = vi.fn(async (_id: string, _data: Record<string, unknown>) => {});
const onClose = vi.fn();
async function mount(type: "lead" | "client" | "recruit" = "lead", contact: Record<string, unknown> = fixture) {
  const view = render(<FullScreenContactView type={type} contact={contact} onUpdate={onUpdate} onClose={onClose} onDelete={vi.fn()} />);
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

describe("Contact Details field identity", () => {
  it.each([1, 3])("renders one stored key once with %i physical definitions (mounted regression)", async count => {
    h.fields = Array.from({ length: count }, (_, i) => definition(`gender-${i}`, "Gender"));
    await mount();
    expect(labels("Gender")).toHaveLength(1);
    expect(screen.getAllByText("Example")).toHaveLength(1);
  });
});


describe("visibility, editing and preservation", () => {
  it.each(["lead", "client", "recruit"] as const)("shows all ten synthetic keys once for %s and includes empty permitted fields only in Edit", async type => {
    h.fields = Object.keys(fixture.customFields).flatMap((key, i) => Array.from({ length: i < 9 ? 3 : 1 }, (_, n) => definition(`${i}-${n}`, key)));
    h.fields.push(definition("empty", "Optional empty"), definition("inactive", "Inactive empty", { active: false }),
      definition("reserved", "additional_policies", { required: true }));
    await mount(type, { ...fixture, email: "  ", age: 0, customFields: { ...fixture.customFields, Empty: " ", Null: null } });
    for (const key of Object.keys(fixture.customFields)) expect(labels(key)).toHaveLength(1);
    expect(screen.getByText("false")).toBeInTheDocument();
    expect(labels("Email")).toHaveLength(0);
    expect(labels("Empty")).toHaveLength(0);
    expect(labels("Optional empty")).toHaveLength(0);
    edit();
    expect(editor("Email")).toHaveValue(""); // Native email input trims display whitespace; no save coercion.
    expect(editor("Optional empty")).toHaveValue("");
    expect(editor("Empty")).toHaveValue(" ");
    expect(labels("Inactive empty")).toHaveLength(0);
    expect(labels("additional_policies")).toHaveLength(0);
    expect(editor("State")).toBeInTheDocument();
    if (type === "lead") expect(editor("Best Time to Call")).toBeInTheDocument();
    if (type === "client") expect(editor("Beneficiary Name")).toBeInTheDocument();
  });
  it("no-op and unrelated saves preserve ranges, unknown structured values, key variants and policies exactly", async () => {
    h.fields = [definition("amount", "Amt Requested", { type: "Number" }), definition("choice", "Choice", { type: "Dropdown", dropdownOptions: ["New"] })];
    const customFields = { ...fixture.customFields, " gender ": "different", Choice: "Legacy choice", Unknown: { nested: [false, 0] },
      additional_policies: [{ policyType: "Whole Life", premiumAmount: "$20/mo", extra: { retained: true } }] };
    await mount("client", { ...fixture, customFields });
    edit();
    expect(editor("Amt Requested")).toHaveAttribute("type", "text");
    expect(editor("Amt Requested")).toHaveValue("$30,000+");
    expect(editor("Choice")).toHaveValue("Legacy choice");
    expect(labels("Unknown")[0].parentElement?.querySelector("input")).toBeNull();
    expect(labels("additional_policies")).toHaveLength(0);
    save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1].customFields).toEqual(customFields);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull());
    edit(); fireEvent.change(editor("First Name"), { target: { value: "Updated" } }); save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(onUpdate.mock.calls[1][1].customFields).toEqual(customFields);
    expect(onUpdate.mock.calls[1][1].firstName).toBe("Updated");
  });
  it("updates exact dotted keys without changing their siblings or coercing boolean false", async () => {
    await mount(); edit();
    expect(editor("Have Life Insurance")).toHaveValue("false");
    fireEvent.change(editor("Health.Note"), { target: { value: "Intentional edit" } });
    save(); await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1].customFields).toEqual({ ...fixture.customFields, "Health.Note": "Intentional edit" });
    expect(onUpdate.mock.calls[0][1].customFields).not.toHaveProperty("Health");
  });
  it("required standard and logical custom constraints block saves without destroying drafts", async () => {
    h.fields = [definition("a", "Answer", { required: true }), definition("b", " answer ", { required: true })];
    await mount(); edit(); save();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(h.errorToasts.at(-1)).toContain("Answer");
    fireEvent.change(editor("Answer"), { target: { value: "Recorded" } });
    fireEvent.change(editor("First Name"), { target: { value: "" } }); save();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("First name is required")).toBeInTheDocument();
    fireEvent.change(editor("First Name"), { target: { value: "Test" } }); save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
  });
  it("retains a failed-save draft and Cancel restores exact saved values", async () => {
    onUpdate.mockRejectedValueOnce(new Error("Synthetic refusal"));
    await mount(); edit();
    fireEvent.change(editor("Amt Requested"), { target: { value: "New range" } }); save();
    await waitFor(() => expect(h.errorToasts).toContain("Synthetic refusal"));
    expect(editor("Amt Requested")).toHaveValue("New range");
    expect(h.successToasts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByText("$30,000+")).toBeInTheDocument();
    edit(); expect(editor("Amt Requested")).toHaveValue("$30,000+");
  });
  it("honors the existing contact edit permission", async () => {
    h.canEdit = false; await mount();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });
  it("drops previous agency definitions at the first commit and rejects a late read", async () => {
    const { customFieldsSupabaseApi } = await import("@/lib/supabase-settings");
    h.fields = [definition("a", "Agency A optional")];
    const view = await mount(); edit();
    expect(editor("Agency A optional")).toBeInTheDocument();
    let resolveB!: (fields: CustomField[]) => void;
    vi.mocked(customFieldsSupabaseApi.getAll).mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve; }));
    h.organizationId = "org-2";
    view.rerender(<FullScreenContactView type="lead" contact={fixture} onUpdate={onUpdate} onClose={onClose} onDelete={vi.fn()} />);
    expect(labels("Agency A optional")).toHaveLength(0);
    h.organizationId = "org-3"; h.fields = [definition("c", "Agency C optional")];
    view.rerender(<FullScreenContactView type="lead" contact={fixture} onUpdate={onUpdate} onClose={onClose} onDelete={vi.fn()} />);
    await waitFor(() => expect(labels("First Name")).toHaveLength(1)); edit();
    expect(editor("Agency C optional")).toBeInTheDocument();
    await import("@testing-library/react").then(({ act }) => act(async () => resolveB([definition("b", "Agency B optional")])));
    expect(labels("Agency B optional")).toHaveLength(0);
    expect(editor("Agency C optional")).toBeInTheDocument();
    expect(vi.mocked(customFieldsSupabaseApi.getAll).mock.calls.map(c => c[0])).toEqual(["org-1", "org-2", "org-3"]);
  });
});

 it("keeps custom keys named like standard fields literal", async () => {
    const customFields = { phone: "legacy extension abc", state: "Some legacy state", dateOfBirth: "Unknown date" };
    await mount("lead", { ...fixture, customFields });
    expect(screen.getByText(customFields.phone)).toBeInTheDocument();
    expect(screen.getByText(customFields.state)).toBeInTheDocument();
    expect(screen.getByText(customFields.dateOfBirth)).toBeInTheDocument();
    edit();
    expect(editor("phone")).toHaveValue(customFields.phone);
    fireEvent.change(editor("phone"), { target: { value: "extension xyz" } });
    save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1].customFields).toEqual({ ...customFields, phone: "extension xyz" });
  });
