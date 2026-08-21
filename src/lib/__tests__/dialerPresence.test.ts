/**
 * supabase-dialer-presence — the ONE batched RPC wrapper for selection-screen presence.
 * Fail-first: the module does not exist until the redesign ships.
 * Contract pinned here:
 *   - exactly ONE get_dialer_campaign_presence call for N campaigns (no per-row N+1);
 *   - a returned Supabase error REJECTS (an error is never coerced into zeros);
 *   - rows parse into a campaign-id-keyed map with camelCase identity entries;
 *   - empty input resolves {} without calling the RPC at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: h.rpc },
}));

import { getDialerCampaignPresence } from "@/lib/supabase-dialer-presence";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getDialerCampaignPresence", () => {
  it("issues exactly one batched RPC call for many campaigns", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    await getDialerCampaignPresence(["c1", "c2", "c3", "c4", "c5"]);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("get_dialer_campaign_presence", {
      p_campaign_ids: ["c1", "c2", "c3", "c4", "c5"],
    });
  });

  it("parses rows into a campaign-keyed map with camelCase identities", async () => {
    h.rpc.mockResolvedValue({
      data: [
        {
          campaign_id: "c1",
          active_agent_count: 2,
          active_agents: [
            {
              agent_id: "u-1",
              display_name: "Alice One",
              avatar_url: "https://cdn.example/a.png",
              last_heartbeat_at: "2026-08-20T18:00:00Z",
            },
            { agent_id: "u-2", display_name: null, avatar_url: null, last_heartbeat_at: null },
          ],
        },
        { campaign_id: "c2", active_agent_count: 0, active_agents: [] },
      ],
      error: null,
    });
    const map = await getDialerCampaignPresence(["c1", "c2"]);
    expect(map.c1.activeAgentCount).toBe(2);
    expect(map.c1.activeAgents).toEqual([
      {
        agentId: "u-1",
        displayName: "Alice One",
        avatarUrl: "https://cdn.example/a.png",
        lastHeartbeatAt: "2026-08-20T18:00:00Z",
      },
      { agentId: "u-2", displayName: null, avatarUrl: null, lastHeartbeatAt: null },
    ]);
    expect(map.c2).toEqual({ activeAgentCount: 0, activeAgents: [] });
  });

  it("tolerates a null/absent identity payload (Agent-role callers)", async () => {
    h.rpc.mockResolvedValue({
      data: [{ campaign_id: "c1", active_agent_count: 3, active_agents: null }],
      error: null,
    });
    const map = await getDialerCampaignPresence(["c1"]);
    expect(map.c1).toEqual({ activeAgentCount: 3, activeAgents: [] });
  });

  it("REJECTS on a returned error — never resolves an error into zeros", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "42501" } });
    await expect(getDialerCampaignPresence(["c1"])).rejects.toBeTruthy();
  });

  it("resolves {} for empty input without touching the network", async () => {
    const map = await getDialerCampaignPresence([]);
    expect(map).toEqual({});
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("omits campaigns the server did not return (unauthorized ids stay absent, not zero)", async () => {
    h.rpc.mockResolvedValue({
      data: [{ campaign_id: "c1", active_agent_count: 1, active_agents: [] }],
      error: null,
    });
    const map = await getDialerCampaignPresence(["c1", "c-foreign"]);
    expect(map.c1).toBeDefined();
    expect(map["c-foreign"]).toBeUndefined();
  });
});
