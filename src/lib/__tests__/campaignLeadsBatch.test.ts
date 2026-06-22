import { describe, it, expect, beforeEach, vi } from "vitest";

const { rpcCalls } = vi.hoisted(() => ({ rpcCalls: [] as Array<{ name: string; args: any }> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      rpcCalls.push({ name, args });
      // Echo a result proportional to the batch so aggregate counts can be asserted:
      // first lead of each batch is "skipped", the rest "added".
      const n = (args.p_lead_ids as string[]).length;
      return Promise.resolve({ data: { added: n - 1, skipped: 1, skipped_ids: [] }, error: null });
    },
  },
}));

import { addLeadsToCampaignBatched } from "@/lib/supabase-campaign-leads";

const mkIds = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

beforeEach(() => { rpcCalls.length = 0; });

describe("addLeadsToCampaignBatched", () => {
  it("batches >500 leads into 500-row RPC calls and sums counts exactly", async () => {
    const res = await addLeadsToCampaignBatched("camp-1", mkIds(1200), "hist-1");
    // 1200 -> 500 / 500 / 200
    expect(rpcCalls.map((c) => c.args.p_lead_ids.length)).toEqual([500, 500, 200]);
    // added = (500-1)+(500-1)+(200-1) = 1197 ; skipped = 3
    expect(res).toEqual({ added: 1197, skipped: 3 });
  });

  it("forwards p_import_history_id on every batch", async () => {
    await addLeadsToCampaignBatched("camp-1", mkIds(600), "hist-xyz");
    expect(rpcCalls).toHaveLength(2);
    rpcCalls.forEach((c) => {
      expect(c.name).toBe("add_leads_to_campaign");
      expect(c.args.p_campaign_id).toBe("camp-1");
      expect(c.args.p_import_history_id).toBe("hist-xyz");
    });
  });

  it("omits the import id (undefined → SQL default NULL) for the generic 2-arg call path", async () => {
    await addLeadsToCampaignBatched("camp-2", mkIds(3));
    expect(rpcCalls[0].args.p_import_history_id).toBeUndefined();
  });

  it("propagates an RPC error (no silent partial success)", async () => {
    rpcCalls.length = 0;
    const { supabase } = await import("@/integrations/supabase/client");
    const spy = vi.spyOn(supabase, "rpc").mockResolvedValueOnce({ data: null, error: { message: "boom" } } as any);
    await expect(addLeadsToCampaignBatched("camp-3", mkIds(2), "h")).rejects.toBeTruthy();
    spy.mockRestore();
  });
});
