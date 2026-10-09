/**
 * DuplicateCampaignDialog — "Duplicate campaign" confirmation on the Campaigns table.
 *
 * Pins: the insert is EXACTLY the production `buildDuplicatePayload(row, user.id, orgId)` into
 * `campaigns` and nothing else is touched (leads are never copied — no `campaign_leads`, no RPC);
 * success toasts, logs `originalCampaignId`, then calls onDuplicated before onClose; a failed
 * insert keeps the dialog open; a locked agency cannot duplicate; double clicks send one insert;
 * the dialog cannot be dismissed while saving.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { buildDuplicatePayload, type CampaignRow } from "@/lib/campaigns-table/model";

// jsdom shims Radix needs (scoped to this file, not the global setup)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as any).ResizeObserver = (window as any).ResizeObserver || RO;
(Element.prototype as any).hasPointerCapture = (Element.prototype as any).hasPointerCapture || (() => false);
(Element.prototype as any).setPointerCapture = (Element.prototype as any).setPointerCapture || (() => {});
(Element.prototype as any).releasePointerCapture = (Element.prototype as any).releasePointerCapture || (() => {});
(Element.prototype as any).scrollIntoView = (Element.prototype as any).scrollIntoView || (() => {});
// jsdom has no PointerEvent; MouseEvent carries the button/coords semantics Radix checks
(window as any).PointerEvent = (window as any).PointerEvent || MouseEvent;

type InsertResult = { data: unknown; error: unknown };

const h = vi.hoisted(() => {
  const auth = {
    user: { id: "user-1" },
    profile: { first_name: "Ada", last_name: "Lovelace" },
  };
  return {
    tables: [] as string[],
    inserts: [] as Array<{ table: string; payload: unknown }>,
    insertImpl: null as null | (() => Promise<{ data: unknown; error: unknown }>),
    rpc: vi.fn(),
    auth,
    org: { organizationId: "org-1" as string | null },
    logActivity: vi.fn(async () => {}),
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.tables.push(table);
      return {
        insert: (payload: unknown) => {
          h.inserts.push({ table, payload });
          return h.insertImpl ? h.insertImpl() : Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc: h.rpc,
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => h.org }));
vi.mock("@/lib/activityLogger", () => ({ logActivity: h.logActivity }));
vi.mock("sonner", () => ({ toast: h.toast }));

import DuplicateCampaignDialog from "../DuplicateCampaignDialog";

const ROW: CampaignRow = {
  id: "camp-1",
  name: "Final Expense Q4",
  type: "Team",
  status: "Active",
  description: "Warm leads",
  assigned_agent_ids: ["agent-a", "agent-b"],
  tags: ["fe", "q4"],
  user_id: "owner-9",
  created_by: "owner-9",
  created_at: "2026-09-01T00:00:00Z",
  organization_id: "org-1",
  retry_interval_minutes: 30,
  retry_interval_hours: null,
  max_attempts: 5,
  calling_hours_start: "09:00",
  calling_hours_end: "17:00",
  ring_timeout_seconds: 25,
  total_leads: 1200,
  leads_called: 640,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const onClose = vi.fn();
const onDuplicated = vi.fn();

function renderDialog(props: Partial<React.ComponentProps<typeof DuplicateCampaignDialog>> = {}) {
  return render(
    <DuplicateCampaignDialog campaign={ROW} orgLocked={false} onClose={onClose} onDuplicated={onDuplicated} {...props} />,
  );
}

const dialog = () => screen.getByRole("alertdialog", { name: "Duplicate campaign" });
const confirmButton = () => screen.getByRole("button", { name: "Duplicate" });

beforeEach(() => {
  h.tables = [];
  h.inserts = [];
  h.insertImpl = null;
  h.rpc.mockReset();
  h.org.organizationId = "org-1";
  h.logActivity.mockClear();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  onClose.mockReset();
  onDuplicated.mockReset();
});

describe("DuplicateCampaignDialog — rendering", () => {
  it("renders the confirmation for the provided campaign", () => {
    renderDialog();
    expect(dialog()).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("Final Expense Q4");
    expect(dialog()).toHaveTextContent("Leads are not copied.");
    expect(confirmButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("renders nothing without a campaign and sends nothing", () => {
    renderDialog({ campaign: null });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(h.tables).toEqual([]);
  });

  it("Cancel (not saving) closes without inserting", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDuplicated).not.toHaveBeenCalled();
    expect(h.tables).toEqual([]);
  });
});

describe("DuplicateCampaignDialog — insert", () => {
  it("inserts exactly buildDuplicatePayload(row, user.id, orgId) into campaigns and touches nothing else", async () => {
    renderDialog();
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(h.tables).toEqual(["campaigns"]);
    expect(h.tables).not.toContain("campaign_leads");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(1);
    const expected = buildDuplicatePayload(ROW, "user-1", "org-1");
    expect(h.inserts[0]).toEqual({ table: "campaigns", payload: expected });
    // Configuration only: a Draft copy with zeroed counters and no lead/progress carry-over.
    const payload = h.inserts[0].payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(Object.keys(expected).sort());
    expect(payload).toMatchObject({
      name: "Final Expense Q4 (Copy)",
      status: "Draft",
      total_leads: 0,
      leads_contacted: 0,
      leads_converted: 0,
      created_by: "user-1",
      organization_id: "org-1",
      assigned_agent_ids: ["agent-a", "agent-b"],
      tags: ["fe", "q4"],
    });
    expect(payload).not.toHaveProperty("leads_called");
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("user_id");
  });

  it("on success: toast.success, logActivity with originalCampaignId, then onDuplicated before onClose", async () => {
    renderDialog();
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(h.toast.success).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith("Campaign duplicated. Find it in your Draft campaigns.", expect.anything());
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(h.logActivity).toHaveBeenCalledTimes(1);
    expect(h.logActivity).toHaveBeenCalledWith({
      action: 'Duplicated campaign "Final Expense Q4"',
      category: "campaigns",
      organizationId: "org-1",
      userId: "user-1",
      userName: "Ada Lovelace",
      metadata: { originalCampaignId: "camp-1" },
    });
    expect(onDuplicated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDuplicated.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it("on insert error: toast.error, no onDuplicated/onClose/logActivity, dialog stays and can retry", async () => {
    h.insertImpl = () => Promise.resolve({ data: null, error: { message: "permission denied", code: "42501" } });
    renderDialog();
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(h.toast.error).toHaveBeenCalledWith("Failed to duplicate campaign", expect.anything());
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.logActivity).not.toHaveBeenCalled();
    expect(onDuplicated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();

    // A retry sends a second (identical) insert.
    h.insertImpl = null;
    await act(async () => { fireEvent.click(confirmButton()); });
    expect(h.inserts).toHaveLength(2);
    expect(h.inserts[1].payload).toEqual(buildDuplicatePayload(ROW, "user-1", "org-1"));
    expect(onDuplicated).toHaveBeenCalledTimes(1);
  });

  it("does not insert when the payload cannot be validated (no organization)", async () => {
    h.org.organizationId = null;
    renderDialog();
    await act(async () => { fireEvent.click(confirmButton()); });
    expect(h.tables).toEqual([]);
    expect(h.toast.error).toHaveBeenCalledWith("Failed to duplicate campaign", expect.anything());
    expect(onDuplicated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("DuplicateCampaignDialog — guards", () => {
  it("orgLocked: the confirm button is disabled and no insert is sent", async () => {
    renderDialog({ orgLocked: true });
    expect(confirmButton()).toBeDisabled();
    await act(async () => { fireEvent.click(confirmButton()); });
    expect(h.tables).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(onDuplicated).not.toHaveBeenCalled();
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("a double click sends exactly one insert", async () => {
    const pending = deferred<InsertResult>();
    h.insertImpl = () => pending.promise;
    renderDialog();
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    expect(h.inserts).toHaveLength(1);
    expect(confirmButton()).toBeDisabled();

    await act(async () => { pending.resolve({ data: null, error: null }); });
    expect(h.inserts).toHaveLength(1);
    expect(onDuplicated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks Escape and Cancel while saving, then closes once the insert succeeds", async () => {
    const pending = deferred<InsertResult>();
    h.insertImpl = () => pending.promise;
    renderDialog();
    fireEvent.click(confirmButton());

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(cancel);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();

    await act(async () => { pending.resolve({ data: null, error: null }); });
    expect(onDuplicated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape when not saving closes the dialog", () => {
    renderDialog();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.tables).toEqual([]);
  });
});

describe("DuplicateCampaignDialog — focus return (review regression)", () => {
  it("returns focus to the row's overflow trigger when the dialog closes", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "More actions";
    document.body.appendChild(trigger);
    const view = renderDialog({ returnFocusTo: trigger });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(<DuplicateCampaignDialog campaign={null} orgLocked={false} returnFocusTo={trigger} onClose={onClose} onDuplicated={onDuplicated} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
