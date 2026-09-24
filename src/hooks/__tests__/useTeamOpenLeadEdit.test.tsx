import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resolveTeamOpenLeadFields } from "@/lib/dialerLeadFields";
import type { CustomField } from "@/lib/types";

/**
 * useTeamOpenLeadEdit — Team/Open inline-edit persistence. Isolated fixtures only: the Supabase
 * client and leadsSupabaseApi are mocked; nothing reaches a database.
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
  freshBag: { data: { custom_fields: {} as unknown } as unknown, error: null as unknown },
  snapshotError: null as unknown,
  update: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/supabase-contacts", () => ({ leadsSupabaseApi: { update: h.update } }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    q.select = (...args: unknown[]) => { h.calls.push({ table, op: "select", args }); return q; };
    q.eq = (...args: unknown[]) => { h.calls.push({ table, op: "eq", args }); return q; };
    q.maybeSingle = () => Promise.resolve(h.freshBag);
    q.update = (values: unknown) => {
      h.calls.push({ table, op: "update", args: [values] });
      const u: Record<string, unknown> = {};
      u.eq = (...args: unknown[]) => {
        h.calls.push({ table, op: "update.eq", args });
        return Promise.resolve({ error: h.snapshotError });
      };
      return u;
    };
    return q;
  };
  return { supabase: { from } };
});

import { useTeamOpenLeadEdit } from "@/hooks/useTeamOpenLeadEdit";

const def = (name: string, type: CustomField["type"]): CustomField => ({
  id: `id-${name}`, name, type, appliesTo: ["Leads"], required: false, active: true, usageCount: 0, createdBy: null,
});
const storedBag = { Goal: "Term", Untouched: "keep", additional_policies: [{ carrier: "X" }], __agentflow: { duplicateImport: true }, tags: ["Duplicate"] };
const master = { id: "lead-1", first_name: "Ada", last_name: "L", phone: "5551234567", email: "a@b.co", state: "TX", lead_source: "Facebook", custom_fields: storedBag, user_id: "u1" };
const fields = resolveTeamOpenLeadFields({
  layoutIds: ["firstName", "lastName", "custom:Goal"],
  sources: { snapshot: { id: "cl-1", lead_id: "lead-1", first_name: "Ada", last_name: "L", phone: "5551234567", state: "TX" }, master },
  definitions: [def("Goal", "Text"), def("Beneficiary", "Text")],
});

const returnedLead = (over: Record<string, unknown> = {}) => ({
  id: "lead-1", firstName: "Augusta", lastName: "L", phone: "5551234567", email: "a@b.co", state: "TX", status: "New",
  leadSource: "Facebook", leadScore: 5, assignedAgentId: "", userId: "u1", customFields: storedBag, createdAt: "c", updatedAt: "u", ...over,
});

function setup(identityKey = "cl-1:lead-1") {
  const onSaved = vi.fn();
  let editing = false;
  const setIsEditing = vi.fn((v: boolean) => { editing = v; });
  const hook = renderHook(
    (p: { identityKey: string | null; isEditing: boolean }) =>
      useTeamOpenLeadEdit({
        identityKey: p.identityKey, fields, leadId: "lead-1", campaignLeadId: "cl-1", organizationId: "org-1",
        isEditing: p.isEditing, setIsEditing, onSaved,
      }),
    { initialProps: { identityKey, isEditing: false } },
  );
  const start = () => { act(() => hook.result.current.start()); hook.rerender({ identityKey, isEditing: editing }); };
  return { hook, onSaved, setIsEditing, start, isEditing: () => editing };
}

beforeEach(() => {
  h.calls = [];
  h.freshBag = { data: { custom_fields: storedBag }, error: null };
  h.snapshotError = null;
  h.update.mockReset();
  Object.values(h.toast).forEach((f) => f.mockReset());
});

describe("useTeamOpenLeadEdit — save destinations", () => {
  it("a standard edit sends only the changed standard key and syncs the campaign snapshot", async () => {
    h.update.mockResolvedValue(returnedLead());
    const { hook, onSaved, start } = setup();
    start();
    act(() => hook.result.current.setField("std:firstName", "Augusta"));
    await act(() => hook.result.current.save());
    expect(h.update).toHaveBeenCalledWith("lead-1", { firstName: "Augusta" });
    expect(h.calls.some((c) => c.table === "leads" && c.op === "select")).toBe(false); // no bag read for standard-only
    const snap = h.calls.find((c) => c.table === "campaign_leads" && c.op === "update");
    expect(snap?.args[0]).toEqual({ first_name: "Augusta" });
    expect(h.calls.find((c) => c.op === "update.eq")?.args).toEqual(["id", "cl-1"]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ identityKey: "cl-1:lead-1", snapshot: { first_name: "Augusta" } }));
    expect(h.toast.success).toHaveBeenCalledWith("Contact updated");
  });

  it("a custom edit merges only that key onto a FRESH org-scoped read; reserved and unrelated keys survive", async () => {
    const fresh = { ...storedBag, AddedElsewhere: "new since load" };
    h.freshBag = { data: { custom_fields: fresh }, error: null };
    h.update.mockResolvedValue(returnedLead());
    const { hook, start } = setup();
    start();
    act(() => hook.result.current.setField("custom:Goal", "Whole life"));
    await act(() => hook.result.current.save());
    expect(h.calls.filter((c) => c.table === "leads" && c.op === "eq").map((c) => c.args)).toEqual([["id", "lead-1"], ["organization_id", "org-1"]]);
    const payload = h.update.mock.calls[0][1] as { customFields: Record<string, unknown> };
    expect(Object.keys(payload)).toEqual(["customFields"]);
    expect(payload.customFields).toEqual({ ...fresh, Goal: "Whole life" });
    expect(payload.customFields.additional_policies).toBe(fresh.additional_policies);
    expect(payload.customFields.__agentflow).toBe(fresh.__agentflow);
    expect(payload.customFields.tags).toBe(fresh.tags);
    expect(h.calls.some((c) => c.table === "campaign_leads")).toBe(false); // no snapshot column changed
  });

  it("a failed fresh read writes NOTHING and keeps the draft", async () => {
    h.freshBag = { data: null, error: { message: "RLS" } };
    const { hook, onSaved, start, isEditing } = setup();
    start();
    act(() => hook.result.current.setField("custom:Goal", "Whole life"));
    await act(() => hook.result.current.save());
    expect(h.update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.result.current.draft["custom:Goal"]).toBe("Whole life");
    expect(isEditing()).toBe(true);
    expect(h.toast.error).toHaveBeenCalled();
  });

  it("a failed update keeps edit mode and the draft, and reports no success", async () => {
    h.update.mockRejectedValue(new Error("Cannot coerce the result to a single JSON object"));
    const { hook, onSaved, start, isEditing } = setup();
    start();
    act(() => hook.result.current.setField("std:firstName", "Augusta"));
    await act(() => hook.result.current.save());
    expect(onSaved).not.toHaveBeenCalled();
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("You don't have permission to edit this contact. Nothing was saved.");
    expect(hook.result.current.draft["std:firstName"]).toBe("Augusta");
    expect(isEditing()).toBe(true);
  });

  it("D-6: master saved but the campaign copy failed → partial-success warning, master still adopted, no retry", async () => {
    h.update.mockResolvedValue(returnedLead());
    h.snapshotError = { message: "boom" };
    const { hook, onSaved, start } = setup();
    start();
    act(() => hook.result.current.setField("std:firstName", "Augusta"));
    await act(() => hook.result.current.save());
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ snapshot: null }));
    expect(h.toast.warning).toHaveBeenCalled();
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("invalid input is refused by Zod before any request, keeping the draft", async () => {
    const { hook, onSaved, start, isEditing } = setup();
    start();
    act(() => hook.result.current.setField("std:email", "not-an-email"));
    await act(() => hook.result.current.save());
    expect(hook.result.current.errors).toHaveProperty("std:email");
    expect(h.update).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(isEditing()).toBe(true);
  });
});

describe("useTeamOpenLeadEdit — identity safety", () => {
  it("a lead change drops the draft and a late save result is never applied to the new lead", async () => {
    let resolveUpdate: (v: unknown) => void = () => {};
    h.update.mockReturnValue(new Promise((r) => { resolveUpdate = r; }));
    const { hook, onSaved, start, setIsEditing } = setup();
    start();
    act(() => hook.result.current.setField("std:firstName", "Augusta"));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = hook.result.current.save(); });
    hook.rerender({ identityKey: "cl-2:lead-2", isEditing: true }); // lock lost → another lead
    expect(hook.result.current.draft).toEqual({});
    expect(setIsEditing).toHaveBeenLastCalledWith(false);
    await act(async () => { resolveUpdate(returnedLead()); await pending; });
    expect(onSaved).not.toHaveBeenCalled();
    expect(h.toast.success).toHaveBeenCalledWith("Changes saved to the previous contact.");
  });

  it("any existing dialer reset (isEditing → false) discards the draft", () => {
    const { hook, start } = setup();
    start();
    act(() => hook.result.current.setField("std:firstName", "Augusta"));
    hook.rerender({ identityKey: "cl-1:lead-1", isEditing: false });
    expect(hook.result.current.draft).toEqual({});
  });
});
