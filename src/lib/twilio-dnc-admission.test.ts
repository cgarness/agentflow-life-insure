import { describe, expect, it, vi } from "vitest";
import { verifyOutboundDncAdmission } from "../../supabase/functions/twilio-voice-webhook/dncGuard";
const params = { CallRowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", From: "client:agent-a", To: "+15551234567", CallerId: "+15557654321", CallSid: "CAparent", OrgId: "untrusted" };
describe("signed outbound webhook admission boundary", () => {
  it("binds the Twilio identity, destination, caller ID and parent SID; ignores browser OrgId", async () => {
    const admit = vi.fn().mockResolvedValue({ data: { admitted: true }, error: null });
    expect(await verifyOutboundDncAdmission(params, admit)).toBe(true);
    expect(admit).toHaveBeenCalledWith({ p_call_id: params.CallRowId, p_identity: "agent-a", p_to: params.To, p_caller_id: params.CallerId, p_parent_sid: params.CallSid });
  });
  it.each([{ data: { admitted: false }, error: null }, { data: null, error: null }, { data: { admitted: true }, error: "db error" }])("refuses unverified admission", async result => {
    expect(await verifyOutboundDncAdmission(params, vi.fn().mockResolvedValue(result))).toBe(false);
  });
  it("refuses a database outage", async () => expect(await verifyOutboundDncAdmission(params, vi.fn().mockRejectedValue(new Error("offline")))).toBe(false));
  it.each([{ ...params, From: "+15550000000" }, { ...params, CallRowId: "" }, { ...params, CallSid: undefined }])("refuses missing authenticated identity or call lineage before the RPC", async input => {
    const admit = vi.fn();
    expect(await verifyOutboundDncAdmission(input, admit)).toBe(false);
    expect(admit).not.toHaveBeenCalled();
  });
});
