import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { checkDNC, DNC_VERIFY_ERROR } from "./dncCheck";
import { normalizePhoneNumber, toE164Plus } from "./phoneUtils";
beforeEach(() => { rpc.mockReset(); });
describe("DNC verification", () => {
  it.each(["(555) 123-4567", "+1 555 123 4567", "5551234567", "15551234567"])("normalizes %s consistently", phone => {
    expect(normalizePhoneNumber(phone)).toBe("15551234567");
    expect(toE164Plus(phone)).toBe("+15551234567");
  });
  it("preserves explicit international country digits", () => expect(toE164Plus("+44 1234 5678")).toBe("+4412345678"));
  it.each([{ data: null, error: null }, { data: {}, error: null }, { data: { blocked: false }, error: null }, { data: null, error: { message: "offline" } }])("fails closed on missing or failed database verification", async response => {
    rpc.mockResolvedValue(response);
    await expect(checkDNC("5551234567", "org-a")).rejects.toThrow(DNC_VERIFY_ERROR);
  });
  it("does not send the supplied organization as authority", async () => {
    rpc.mockResolvedValue({ data: { blocked: true, match: { id: "dnc", phone_number: "+15551234567", reason: null } }, error: null });
    expect((await checkDNC("5551234567", "org-a", "cl-a")).blocked).toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_dialer_dnc", { p_phone: "5551234567", p_campaign_lead_id: "cl-a" });
  });
  it("fails closed when the transport rejects", async () => {
    rpc.mockRejectedValue(new Error("network"));
    await expect(checkDNC("5551234567", "org-a")).rejects.toThrow(DNC_VERIFY_ERROR);
  });
});
