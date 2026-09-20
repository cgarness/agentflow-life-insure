/**
 * `handleStatusChange` must not show a status that was never saved.
 *
 * THE DEFECT THIS PINS. The handler used to paint the new status into `localStatus` and
 * `editForm.status` BEFORE awaiting `onUpdate`, with no error handling at all:
 *
 *     setStatusDropdownOpen(false);
 *     setLocalStatus(newStatus);                 // ← optimistic, before the write
 *     setEditForm(f => ({ ...f, status: newStatus }));
 *     await onUpdate(contact.id, { status: newStatus });   // ← no try/catch
 *     await activitiesSupabaseApi.add(...);
 *     toast.success(...);
 *
 * So a rejected save left the NEW status on the badge, wrote nothing to the database, produced no
 * message of any kind, and escaped as an unhandled promise rejection. The status pill and the
 * record then disagreed until the page was reloaded.
 *
 * The contract now matches `handleSave` (PR #376): commit locally only after the authoritative
 * save succeeds; on failure keep the old status, write no activity, show no success toast, show
 * one concise error, and never leave the rejection unobserved.
 *
 * Harness mirrors `fullScreenContactViewSaveFailure.test.tsx`.
 */
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
    add: vi.fn(async (payload: Record<string, unknown>) => { h.activityAdds.push(payload); return { id: "a1" }; }),
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
  useBranding: () => ({ formatDate: (v: string) => v, formatDateTime: (v: string) => v, branding: { companyName: "AgentFlow" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ hasContactsPermission: () => true }) }));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({ MessageTemplatesPickerModal: () => null }));
vi.mock("../TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { ContactSaveRefusedError } from "@/lib/contactSavePolicy";

const lead = {
  id: "lead-1",
  firstName: "Dana",
  lastName: "Reyes",
  phone: "5125550123",
  email: "dana@example.com",
  state: "TX",
  status: "New",
  leadSource: "Facebook Ads",
  assignedAgentId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

let onUpdate: ReturnType<typeof vi.fn>;

/** The status pill is the button whose label is the current status. */
const statusPill = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") });

async function renderLead() {
  render(
    <FullScreenContactView
      contact={lead}
      type="lead"
      onClose={vi.fn()}
      onUpdate={onUpdate}
      onDelete={vi.fn(async () => {})}
    />
  );
  // The Call button is the stable "the view has mounted" marker used across the FSCV suites.
  await screen.findByRole("button", { name: /^call$/i });
}

/** Open the status dropdown and pick `next`. */
async function changeStatusTo(current: string, next: string) {
  fireEvent.click(statusPill(current));
  const option = await screen.findByRole("button", { name: new RegExp(`^${next}$`, "i") });
  fireEvent.click(option);
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  h.errorToasts.length = 0;
  h.successToasts.length = 0;
  h.activityAdds.length = 0;
  onUpdate = vi.fn(async () => {});
  for (const key of Object.keys(tableData)) delete tableData[key];
  tableData["contact_management_settings"] = { required_fields_lead: {} };
});

describe("handleStatusChange — a rejected status change shows nothing that did not happen", () => {
  it("keeps the OLD status on screen, writes no activity, toasts no success, and reports the error", async () => {
    onUpdate = vi.fn(async () => { throw new Error("permission denied for table leads"); });
    await renderLead();

    await changeStatusTo("New", "Contacted");

    await waitFor(() => expect(h.errorToasts).toContain("permission denied for table leads"));

    // The old status is still the one displayed — it was never optimistically committed.
    expect(statusPill("New")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^contacted$/i })).not.toBeInTheDocument();

    expect(h.successToasts).toEqual([]);
    expect(h.activityAdds).toHaveLength(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith("lead-1", { status: "Contacted" });
  });

  it("falls back to a concise message when the rejection carries none", async () => {
    onUpdate = vi.fn(async () => { throw new Error("   "); });
    await renderLead();

    await changeStatusTo("New", "Hot");

    await waitFor(() => expect(h.errorToasts).toEqual(["Failed to update status"]));
    expect(statusPill("New")).toBeInTheDocument();
    expect(h.successToasts).toEqual([]);
  });

  it("handles a non-Error rejection without showing a blank toast or a success", async () => {
    onUpdate = vi.fn(async () => { throw "just a string"; });
    await renderLead();

    await changeStatusTo("New", "Hot");

    await waitFor(() => expect(h.errorToasts).toEqual(["Failed to update status"]));
    expect(statusPill("New")).toBeInTheDocument();
    expect(h.activityAdds).toHaveLength(0);
  });

  it("a REFUSED status change is silent when already reported, and still changes nothing", async () => {
    onUpdate = vi.fn(async () => { throw new ContactSaveRefusedError("blocked by agency settings"); });
    await renderLead();

    await changeStatusTo("New", "Contacted");

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    // `reported: true` — the refusing surface already told the user, so no second toast here.
    expect(h.errorToasts).toEqual([]);
    expect(h.successToasts).toEqual([]);
    expect(h.activityAdds).toHaveLength(0);
    expect(statusPill("New")).toBeInTheDocument();
  });

  it("an UNREPORTED refusal surfaces its message once", async () => {
    onUpdate = vi.fn(async () => { throw new ContactSaveRefusedError("nobody told you yet", { reported: false }); });
    await renderLead();

    await changeStatusTo("New", "Contacted");

    await waitFor(() => expect(h.errorToasts).toEqual(["nobody told you yet"]));
    expect(h.successToasts).toEqual([]);
    expect(statusPill("New")).toBeInTheDocument();
  });

  it("the dropdown closes on a failure — it does not stay open over a status that was not saved", async () => {
    onUpdate = vi.fn(async () => { throw new Error("nope"); });
    await renderLead();

    await changeStatusTo("New", "Contacted");
    await waitFor(() => expect(h.errorToasts).toHaveLength(1));

    // "Change Status" is the dropdown's own heading; its absence means the menu closed.
    expect(screen.queryByText("Change Status")).not.toBeInTheDocument();
  });
});

describe("handleStatusChange — a successful status change is committed exactly once", () => {
  it("shows the new status, writes ONE activity and toasts success ONCE", async () => {
    await renderLead();

    await changeStatusTo("New", "Contacted");

    await waitFor(() => expect(h.successToasts).toEqual(["Status updated to Contacted"]));
    expect(onUpdate).toHaveBeenCalledWith("lead-1", { status: "Contacted" });
    expect(statusPill("Contacted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new$/i })).not.toBeInTheDocument();

    expect(h.activityAdds).toHaveLength(1);
    expect(h.activityAdds[0]).toMatchObject({
      contactId: "lead-1",
      contactType: "lead",
      type: "status",
      description: "Status changed to Contacted",
    });
    expect(h.errorToasts).toEqual([]);
  });

  it("a retry after a failure commits normally", async () => {
    onUpdate = vi.fn(async () => { throw new Error("transient"); });
    await renderLead();
    await changeStatusTo("New", "Contacted");
    await waitFor(() => expect(h.errorToasts).toEqual(["transient"]));
    expect(statusPill("New")).toBeInTheDocument();

    onUpdate = vi.fn(async () => {});
    cleanup();
    await renderLead();
    await changeStatusTo("New", "Contacted");

    await waitFor(() => expect(h.successToasts).toEqual(["Status updated to Contacted"]));
    expect(statusPill("Contacted")).toBeInTheDocument();
    expect(h.activityAdds).toHaveLength(1);
  });
});
