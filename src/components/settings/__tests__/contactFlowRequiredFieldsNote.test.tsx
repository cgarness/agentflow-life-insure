/**
 * Settings › Contact Flow › Required Fields note (UI copy cleanup V2, final polish, 2026-10-12).
 *
 * The note names only where the Required Fields settings are enforced (the Contacts Add and Edit forms and the
 * contact view) and the one import limitation (rows are checked only for first name, last name and phone). It no
 * longer claims enforcement on every create/edit form, per-row CSV enforcement, or custom-field enforcement
 * "where custom-field inputs are surfaced" (the Dialer inline edit surfaces them and checks nothing). The Custom
 * Fields tab's own Required helper (B6-93) is unchanged. Copy only: no enforcement code is exercised or changed.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-a" }, profile: { id: "user-a", role: "Admin" } }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-a" }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: {} }, error: null }) }) }),
  upsert: async () => ({ error: null }),
}) } }));
vi.mock("@/lib/supabase-settings", () => ({
  customFieldsSupabaseApi: { getAll: vi.fn(async () => []) },
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
  contactManagementSettingsSupabaseApi: {
    getSettings: vi.fn(async (organizationId: string) => ({ organizationId })),
    updateSettings: vi.fn(async () => {}),
  },
}));

import ContactManagement from "../ContactManagement";

const NOTE =
  "Enforced on the Add and Edit forms in Contacts and in the contact view. Lead CSV imports check only first name, last name and phone on each row.";
const B6_93_HELPER = "Enforced in the contact view. Lead CSV imports must map a column to it.";

afterEach(cleanup);

describe("Contact Flow › Required Fields note", () => {
  it("states where the settings are enforced and the import row limitation, without the contradicted claims", async () => {
    render(<ContactManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "Required Fields" }));

    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Required Fields" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Required Fields" })).toBeInTheDocument();

    expect(screen.queryByText(/create\/edit forms/i)).toBeNull();
    expect(screen.queryByText(/where custom-field inputs are surfaced/i)).toBeNull();
    expect(screen.queryByText(/Custom required fields are enforced/i)).toBeNull();
    expect(screen.queryByText(/enforced on create\/edit forms and CSV imports/i)).toBeNull();
  });

  it("leaves the Custom Fields tab's Required helper (B6-93) unchanged", async () => {
    render(<ContactManagement />);
    fireEvent.click(await screen.findByRole("button", { name: "Custom Fields" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Add Custom Field/ }))[0]);

    expect(await screen.findByText(B6_93_HELPER)).toBeInTheDocument();
  });
});
