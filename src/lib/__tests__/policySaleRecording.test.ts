import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: h }));
import { clientsSupabaseApi } from "@/lib/supabase-clients";
import { saleMonthlyPremium } from "@/lib/policySaleRecording";
import { clientSaleFormSchema } from "@/lib/clientSaleForm";
import { annualPremiumForWin } from "@/components/leaderboard/leaderboardPremium";
import type { Client } from "@/lib/types";
const client = { firstName: "Pat", lastName: "Lee", phone: "5551234567", premiumAmount: "$100.50", carrier: "Carrier", soldDate: "2026-10-03", assignedAgentId: "agent" } as Omit<Client,"id"|"createdAt"|"updatedAt">;
beforeEach(() => {
  h.rpc.mockReset(); h.from.mockReset();
  h.rpc.mockImplementation((name: string) => Promise.resolve(name === "notify_win" ? { data: 1, error: null } : {
    data: { client: { id: "client", first_name: "Pat", last_name: "Lee", premium: 100.5 }, client_id: "client", win_ids: ["win"], idempotent: false }, error: null,
  }));
});
describe("interactive client sale", () => {
  it("uses one transaction with stable request ID and notifies only its persisted wins", async () => {
    const options = { requestId: "same-request", recordSale: true };
    for (let i=0;i<2;i++) await clientsSupabaseApi.create(client, "org", options);
    expect(h.rpc.mock.calls.filter(([name]) => name === "create_client_with_sale")).toHaveLength(2);
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_request_id: "same-request", p_expected_org: "org", p_record_sale: true, p_client: { premium: 100.5, assigned_agent_id: "agent" } });
    expect(h.rpc.mock.calls[1]).toEqual(["notify_win", { p_win_id: "win" }]);
    expect(h.from).not.toHaveBeenCalled();
  });
  it("a win persistence failure rejects the save and never sends notification", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "could not save win" } });
    await expect(clientsSupabaseApi.create(client,"org",{ requestId: "r",recordSale: true })).rejects.toThrow("could not save win");
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it("notification failure leaves a successful saved client", async () => {
    h.rpc.mockImplementation((name: string) => Promise.resolve(name === "notify_win" ? { error: { message: "offline" } } : {
      data: { client: { id: "client" }, client_id: "client", win_ids: ["win"] }, error: null,
    }));
    await expect(clientsSupabaseApi.create(client,"org",{ requestId: "r",recordSale: true })).resolves.toMatchObject({ id:"client" });
  });
  it("contact-only interactive save uses receipt but requests no sale", async () => {
    await clientsSupabaseApi.create(client,"org",{ requestId:"r",recordSale:false });
    expect(h.rpc.mock.calls[0][1].p_record_sale).toBe(false);
  });
  it.each(["garbage", "-25", "$30abc", "1.001", "Infinity"])("rejects malformed premium %s before submitting", async premiumAmount => {
    await expect(clientsSupabaseApi.create({...client,premiumAmount},"org",{requestId:"r",recordSale:true})).rejects.toThrow(/premium/);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("keeps unknown amounts distinct from zero and uses monthly currency", () => {
    expect(saleMonthlyPremium("")).toBeNull();
    expect(saleMonthlyPremium("0")).toBe(0);
    expect(saleMonthlyPremium("$1,234.56")).toBe(1234.56);
  });
  it("validates explicit sale evidence but allows ordinary contact entry", () => {
    expect(clientSaleFormSchema.safeParse({...client,carrier:"",recordSale:true}).success).toBe(false);
    expect(clientSaleFormSchema.safeParse({...client,soldDate:"2026-02-30",recordSale:true}).success).toBe(false);
    expect(clientSaleFormSchema.safeParse({...client,carrier:"",soldDate:"",recordSale:false}).success).toBe(true);
  });
});
describe("policy premium snapshots", () => {
  const fallback = new Map([["client", 100]]);
  it.each([null,0,undefined])("never borrows a primary premium for a snapshot amount %s", premium_amount => {
    expect(annualPremiumForWin({agent_id:"agent",contact_id:"client",premium_amount,premium_snapshot:true},fallback)).toBe(0);
  });
  it("preserves legacy fallback and annualizes exactly once", () => {
    expect(annualPremiumForWin({agent_id:"agent",contact_id:"client",premium_amount:0},fallback)).toBe(1200);
    expect(annualPremiumForWin({agent_id:"agent",contact_id:"client",premium_amount:25,premium_snapshot:true},fallback)).toBe(300);
  });
});
