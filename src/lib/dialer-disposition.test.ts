import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { persistDisposition, applyPersistedDisposition, removeQueueLead, verifyOutboundAdmission } from "./dialer-disposition";
import { useDispositionPersistence } from "@/hooks/useDispositionPersistence";
import { applyDispositionToQueue } from "./queue-manager";
const result = { id: "lead-a", call_id: "call-a", contact_id: "master-a", contact_type: "lead", status: "DNC", disposition_version: 1, dnc_suppressed: true, lock_released: true, replayed: false };
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: result, error: null }); });
describe("canonical disposition client", () => {
  it("sends identity and input only, never org authority or behavior flags", async () => {
    await persistDisposition({ campaignLeadId: "lead-a", callId: "call-a", dispositionId: "disp", operationId: "op", notes: "requested", expectedVersion: 0 });
    expect(rpc).toHaveBeenCalledWith("advance_campaign_lead", {
      p_campaign_lead_id: "lead-a", p_call_id: "call-a", p_disposition_id: "disp", p_operation_id: "op",
      p_notes: "requested", p_expected_version: 0, p_release_lock: true, p_callback_due_at: null,
      p_callback_note: null, p_converted_client_id: null, p_action: "disposition",
    });
  });
  it.each([
    { data: null, error: { message: "DNC persistence failed" } },
    { data: {}, error: null },
    { data: { ...result, id: "lead-b" }, error: null },
    { data: { ...result, lock_released: false }, error: null },
  ])("rejects failed, unconfirmed, wrong-lead or failed-release saves", async (response) => {
    rpc.mockResolvedValue(response);
    await expect(persistDisposition({ campaignLeadId: "lead-a", operationId: "op", releaseLock: true })).rejects.toThrow();
  });
  it("never applies a removed lead's result to the shifted neighbor", () => {
    const a = { id: "lead-a", status: "Queued" }, b = { id: "lead-b", status: "Queued" };
    const queue = removeQueueLead([a, b], a.id);
    expect(applyPersistedDisposition(queue, a.id, result)).toEqual([b]);
    expect(applyPersistedDisposition([b, a], a.id, result)[0]).toBe(b);
  });
  it("a phone suppressed by another campaign is hidden even when this saved status is Called", () => {
    const a = { ...result, id: "lead-a", status: "Called" }, b = { id: "lead-b", status: "Queued" };
    expect(applyDispositionToQueue([a,b], a, "Not Interested", 60, null, new Date())).toEqual([b]);
  });
  it("reuses a lost-response operation for retry and Save Only → Next, but not a new no-call visit", async () => {
    const { result: hook } = renderHook(() => useDispositionPersistence());
    const input = { campaignLeadId: "lead-a", dispositionId: "disp", notes: "note", visitKey: "a:1", releaseLock: false, expectedVersion: 0 };
    rpc.mockResolvedValueOnce({ data: null, error: { message: "response lost" } });
    await expect(hook.current(input)).rejects.toThrow();
    await hook.current({ ...input, releaseLock: true, expectedVersion: 1 });
    expect(rpc.mock.calls[0][1].p_operation_id).toBe(rpc.mock.calls[1][1].p_operation_id);
    await hook.current({ ...input, visitKey: "a:3" });
    expect(rpc.mock.calls[2][1].p_operation_id).not.toBe(rpc.mock.calls[0][1].p_operation_id);
  });
  it.each([null, {}, { admitted: null }, { admitted: false }])("never advances an unverified/refused outbound call", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(verifyOutboundAdmission("call-a")).rejects.toThrow();
    expect(rpc.mock.calls.map(c => c[0])).toEqual(["get_outbound_admission"]);
  });
});
