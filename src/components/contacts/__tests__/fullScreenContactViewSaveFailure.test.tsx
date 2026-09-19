/**
 * `handleSave` must not report a save that did not happen (BUGFIX follow-up, 2026-09-19).
 *
 * `handleSave` used to `await onUpdate(...)` with no error handling, then unconditionally exit edit
 * mode, clear the dirty flags, write a "details updated" activity and toast success. A rejection
 * therefore skipped all of that and escaped as an unhandled promise rejection: the save was safely
 * refused, but the user saw no failure message.
 *
 * That became reachable the moment the client write boundary gained a guard that REFUSES rather
 * than merely fails — `assertCustomFieldsWriteSafe` throws on a corrupted
 * `custom_fields.additional_policies` and writes nothing (U3, AGENT_RULES invariant #35) — and it
 * was always reachable through an ordinary PostgREST/RLS error.
 *
 * The contract, the same posture AGENT_RULES §31 requires of `Conversations.handleSendMessage`:
 * on failure the user keeps edit mode, their typed values and their dirty state, gets a concise
 * error, and NO activity or success toast is produced. On success nothing changes from before.
 *
 * Harness mirrors `fullScreenContactViewQuickCall.test.tsx` (the established FSCV mock pattern).
 * Every fixture is synthetic.
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
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({
  MessageTemplatesPickerModal: () => null,
}));
vi.mock("../TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { ADDITIONAL_POLICIES_KEY } from "@/lib/reservedCustomFields";

const client = {
  id: "client-1",
  firstName: "Dana",
  lastName: "Reyes",
  phone: "5125550123",
  email: "dana@example.com",
  state: "TX",
  policyType: "Final Expense",
  carrier: "Americo",
  policyNumber: "FE-1001",
  assignedAgentId: "user-1",
  notes: "Primary policy issued.",
  customFields: { Gender: "F" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const onClose = vi.fn();
let onUpdate: ReturnType<typeof vi.fn>;

const enterEditMode = () => fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
const save = () => fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
const inEditMode = () => screen.queryByRole("button", { name: /^save$/i }) !== null;

function inputForLabel(label: string): HTMLInputElement {
  const labelEl = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.trim() === label);
  if (!labelEl) throw new Error(`no label "${label}" on screen`);
  const input = labelEl.parentElement?.querySelector("input, textarea, select");
  if (!input) throw new Error(`label "${label}" has no editor`);
  return input as HTMLInputElement;
}

async function renderAndEdit(contact: Record<string, unknown> = client) {
  render(
    <FullScreenContactView
      contact={contact}
      type="client"
      onClose={onClose}
      onUpdate={onUpdate}
      onDelete={vi.fn(async () => {})}
    />
  );
  await waitFor(() => expect(screen.getAllByText("Carrier").length).toBeGreaterThan(0));
  enterEditMode();
  await waitFor(() => expect(inEditMode()).toBe(true));
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  h.errorToasts.length = 0;
  h.successToasts.length = 0;
  h.activityAdds.length = 0;
  onUpdate = vi.fn(async () => {});
  onClose.mockClear();
  for (const key of Object.keys(tableData)) delete tableData[key];
  tableData["contact_management_settings"] = { required_fields_client: {} };
});

// ---------------------------------------------------------------------------------------------
// A rejected save reports the failure and changes nothing
// ---------------------------------------------------------------------------------------------
describe("FullScreenContactView.handleSave — a refused save is reported, not swallowed", () => {
  it("shows the thrown Error message, keeps edit mode, and writes no activity or success toast", async () => {
    onUpdate = vi.fn(async () => {
      throw new Error("clientsSupabaseApi.update: refusing to write custom_fields.additional_policies as a string.");
    });
    await renderAndEdit();
    fireEvent.change(inputForLabel("Carrier"), { target: { value: "Gerber Life" } });
    save();

    await waitFor(() => expect(h.errorToasts).toHaveLength(1));
    expect(h.errorToasts[0]).toContain("refusing to write custom_fields.additional_policies");

    // Nothing that implies success may have happened.
    expect(h.successToasts).toHaveLength(0);
    expect(h.activityAdds).toHaveLength(0);

    // The user is left exactly where they were: still editing, with what they typed.
    expect(inEditMode()).toBe(true);
    expect(inputForLabel("Carrier").value).toBe("Gerber Life");
    expect(inputForLabel("Phone").value).toBeTruthy();
  });

  it("keeps the dirty state, so closing still warns about unsaved edits", async () => {
    onUpdate = vi.fn(async () => {
      throw new Error("permission denied for table clients");
    });
    await renderAndEdit();
    fireEvent.change(inputForLabel("Policy #"), { target: { value: "FE-2002" } });
    save();
    await waitFor(() => expect(h.errorToasts).toHaveLength(1));

    // hasUnsavedChanges is observable through tryClose: a clean form closes immediately, a dirty
    // one opens the discard confirmation instead.
    fireEvent.click(document.querySelectorAll("button")[0]);
    await waitFor(() => expect(screen.getByText("Discard Changes?")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a safe message when the rejection carries no usable one", async () => {
    for (const thrown of [new Error(""), new Error("   "), "a bare string", { code: 42 }, null, undefined]) {
      cleanup();
      h.errorToasts.length = 0;
      h.successToasts.length = 0;
      onUpdate = vi.fn(async () => {
        throw thrown;
      });
      await renderAndEdit();
      save();

      await waitFor(() => expect(h.errorToasts).toHaveLength(1));
      expect(h.errorToasts[0]).toBe("Failed to save contact");
      expect(h.successToasts).toHaveLength(0);
      expect(inEditMode()).toBe(true);
    }
  });

  it("stays recoverable — a retry that succeeds completes normally", async () => {
    let attempt = 0;
    onUpdate = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient failure");
    });
    await renderAndEdit();
    fireEvent.change(inputForLabel("Carrier"), { target: { value: "Gerber Life" } });

    save();
    await waitFor(() => expect(h.errorToasts).toHaveLength(1));
    expect(inEditMode()).toBe(true);

    save();
    await waitFor(() => expect(h.successToasts).toHaveLength(1));
    expect(inEditMode()).toBe(false);
    expect(h.activityAdds).toHaveLength(1);
    // The edit the user made before the first failure is what finally got saved.
    expect((onUpdate.mock.calls[1][1] as Record<string, unknown>).carrier).toBe("Gerber Life");
  });
});

// ---------------------------------------------------------------------------------------------
// A successful save is unchanged
// ---------------------------------------------------------------------------------------------
describe("FullScreenContactView.handleSave — success behaves exactly as before", () => {
  it("exits edit mode, clears dirty state, adds the activity and toasts success", async () => {
    await renderAndEdit();
    fireEvent.change(inputForLabel("Carrier"), { target: { value: "Gerber Life" } });
    save();

    await waitFor(() => expect(h.successToasts).toHaveLength(1));
    expect(h.successToasts[0]).toBe("Client updated successfully");
    expect(h.errorToasts).toHaveLength(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    expect(h.activityAdds).toHaveLength(1);
    expect(h.activityAdds[0]).toMatchObject({
      contactId: "client-1",
      contactType: "client",
      type: "note",
    });
    expect(String(h.activityAdds[0].description)).toContain("Client details updated by");

    expect(inEditMode()).toBe(false);
    // Dirty state cleared: closing no longer warns.
    fireEvent.click(document.querySelectorAll("button")[0]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Discard Changes?")).toBeNull();
  });

  it("a blocked required-field save is still refused before onUpdate is ever called", async () => {
    await renderAndEdit();
    fireEvent.change(inputForLabel("Phone"), { target: { value: "" } });
    save();

    await waitFor(() => expect(h.errorToasts).toHaveLength(0));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(h.successToasts).toHaveLength(0);
    expect(inEditMode()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// End to end: the real write guard, on a row that is ALREADY corrupt
// ---------------------------------------------------------------------------------------------
describe("the real clientsSupabaseApi guard surfaces through the UI, not as an unhandled rejection", () => {
  it("a pre-corrupted additional_policies blocks the save with a clear message and no write", async () => {
    // The documented consequence of U3: a row whose reserved key is ALREADY a string (corrupted
    // before the fix, or by a path outside this app) cannot be re-saved until it is repaired. It
    // must fail VISIBLY — the alternative is quietly re-persisting known-broken policy data.
    const corrupted = {
      ...client,
      customFields: { Gender: "F", [ADDITIONAL_POLICIES_KEY]: "[object Object],[object Object]" },
    };
    onUpdate = vi.fn((id: string, data: Record<string, unknown>) =>
      clientsSupabaseApi.update(id, data as never)
    );

    await renderAndEdit(corrupted);
    fireEvent.change(inputForLabel("Carrier"), { target: { value: "Gerber Life" } });
    save();

    await waitFor(() => expect(h.errorToasts).toHaveLength(1));
    expect(h.errorToasts[0]).toContain("custom_fields.additional_policies");
    expect(h.errorToasts[0]).toContain("must be a JSON array");
    expect(h.errorToasts[0]).toContain("Nothing was saved");

    expect(h.successToasts).toHaveLength(0);
    expect(h.activityAdds).toHaveLength(0);
    expect(inEditMode()).toBe(true);
    expect(inputForLabel("Carrier").value).toBe("Gerber Life");
  });
});
