import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomField } from "@/lib/types";

const h = vi.hoisted(() => ({
  org: "org-a", user: "user-a", role: "Admin", fields: [] as CustomField[],
  preferences: {} as Record<string, unknown>, upserts: [] as Record<string, unknown>[],
  agency: {} as Record<string, unknown>, agencyWrites: [] as Record<string, unknown>[],
  fieldReads: [] as string[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: h.user }, profile: { id: h.user, role: h.role } }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: h.preferences }, error: null }) }) }),
  upsert: async (data: { settings: Record<string, unknown> }) => {
    h.upserts.push(data); h.preferences = data.settings; return { error: null };
  },
}) } }));
vi.mock("@/lib/supabase-settings", () => ({
  customFieldsSupabaseApi: { getAll: vi.fn(async (org: string) => { h.fieldReads.push(org); return h.fields; }) },
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
  contactManagementSettingsSupabaseApi: {
    getSettings: vi.fn(async (organizationId: string) => ({ organizationId, ...h.agency })),
    updateSettings: vi.fn(async (org: string, payload: Record<string, unknown>) => {
      h.agencyWrites.push({ org, ...payload }); h.agency = { ...h.agency, ...payload };
    }),
  },
}));
import ContactManagement from "../ContactManagement";
const field = (id: string, name: string, extra: Partial<CustomField> = {}): CustomField => ({
  id, name, active: true, required: false, type: "Text", appliesTo: ["Leads", "Clients", "Recruits"], usageCount: 0,
  scope: "agency", createdBy: null, createdAt: "2026-01-01", ...extra,
});
const rowNames = () => Array.from(document.querySelectorAll('[draggable="true"]')).map(row => row.querySelector("span.text-sm")?.textContent);
async function open() {
  fireEvent.click(await screen.findByRole("button", { name: "Field Layout" }));
  await waitFor(() => expect(rowNames()).toContain("Gender"));
}
const save = () => fireEvent.click(screen.getByRole("button", { name: /^Save (My Layout|Agency Default)$/i }));
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); h.org = "org-a"; h.user = "user-a"; h.role = "Admin";
  h.preferences = { theme: "retained", contact_field_layout: { lead: ["phone", "custom:Gender", "custom:Gender", "custom: gender ", "stale", "firstName"] } };
  h.agency = {}; h.upserts = []; h.agencyWrites = []; h.fieldReads = [];
  h.fields = [field("a", "Gender"), field("b", "Gender"), field("c", " gender "), field("d", "additional_policies"), field("e", "Inactive", { active: false })];
});

describe("Field Layout logical identity", () => {
  it("deduplicates physical definitions and layout aliases without saving on open", async () => {
    render(<ContactManagement />); await open();
    expect(rowNames().slice(0, 3)).toEqual(["Phone", "Gender", "First Name"]);
    expect(rowNames().filter(name => name === "Gender")).toHaveLength(1);
    expect(rowNames()).not.toContain("additional_policies"); expect(rowNames()).not.toContain("Inactive");
    expect(h.upserts).toHaveLength(0); expect(h.agencyWrites).toHaveLength(0);
  });
  it("reorder → save → reopen retains intended user order and unrelated preferences", async () => {
    const view = render(<ContactManagement />); await open();
    const rows = document.querySelectorAll('[draggable="true"]');
    fireEvent.dragStart(rows[1]); fireEvent.dragOver(rows[0]); fireEvent.drop(rows[0]);
    expect(rowNames()[0]).toBe("Gender"); save();
    await waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(h.preferences.theme).toBe("retained");
    const layout = (h.preferences.contact_field_layout as { lead: string[] }).lead;
    expect(layout.slice(0, 3)).toEqual(["custom:Gender", "phone", "firstName"]);
    expect(new Set(layout).size).toBe(layout.length);
    view.unmount(); render(<ContactManagement />); await open();
    expect(rowNames().slice(0, 3)).toEqual(["Gender", "Phone", "First Name"]);
  });
  it("keeps agency saves separate and exposes one custom identity for clients/recruits", async () => {
    render(<ContactManagement />); await open();
    fireEvent.click(screen.getByRole("button", { name: /^Agency Default$/ })); save();
    await waitFor(() => expect(h.agencyWrites).toHaveLength(1));
    expect(h.agencyWrites[0].org).toBe("org-a"); expect(h.upserts).toHaveLength(0);
    await waitFor(() => expect(rowNames()).toContain("Gender"));
    for (const type of ["clients", "recruits"]) {
      fireEvent.click(screen.getByRole("button", { name: type }));
      expect(rowNames().filter(name => name === "Gender")).toHaveLength(1);
      expect(rowNames()).toContain("State");
    }
  });
  it("Agent gets permitted personal fields and cannot save an agency default", async () => {
    h.role = "Agent"; h.fields = [field("a", "Gender", { scope: "personal", createdBy: h.user }), field("own", "Own optional", { scope: "personal", createdBy: h.user })];
    render(<ContactManagement />); await open();
    expect(screen.getByRole("button", { name: /^Agency Default$/ })).toBeDisabled();
    expect(rowNames()).toContain("Own optional"); save();
    await waitFor(() => expect(h.upserts).toHaveLength(1)); expect(h.agencyWrites).toHaveLength(0);
  });
  it("agency/user switching masks prior rows immediately and a late response cannot restore them", async () => {
    const { customFieldsSupabaseApi } = await import("@/lib/supabase-settings");
    const view = render(<ContactManagement />); await open();
    let resolveOld!: (fields: CustomField[]) => void;
    vi.mocked(customFieldsSupabaseApi.getAll).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    // A new org remounts both settings and the local Field Layout draft.
    h.org = "org-b"; h.user = "user-b";
    view.rerender(<ContactManagement />); expect(rowNames()).toHaveLength(0);
    fireEvent.click(await screen.findByRole("button", { name: "Field Layout" }));
    await waitFor(() => expect(resolveOld).toBeDefined());
    h.org = "org-c"; h.user = "user-c"; h.fields = [field("current", "Current agency")];
    view.rerender(<ContactManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "Field Layout" }));
    await waitFor(() => expect(rowNames()).toContain("Current agency"));
    await act(async () => resolveOld([field("foreign", "Old agency")]));
    expect(rowNames()).not.toContain("Old agency"); expect(rowNames()).not.toContain("Gender");
    expect(rowNames()).toContain("Current agency");
    expect(h.upserts).toHaveLength(0); expect(h.agencyWrites).toHaveLength(0);
  });
});

it("resolves existing hidden alias preferences without writing on open", async () => {
  h.preferences.fieldVisibility = { lead: { "custom: gender ": false } };
  render(<ContactManagement />);
  fireEvent.click(await screen.findByRole("button", { name: "Field Layout" }));
  await waitFor(() => expect(rowNames()).toContain("Phone"));
  expect(rowNames()).not.toContain("Gender");
  expect(h.upserts).toHaveLength(0);
});
