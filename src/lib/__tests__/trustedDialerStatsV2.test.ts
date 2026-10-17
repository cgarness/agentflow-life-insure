import { beforeEach, describe, expect, it, vi } from "vitest";
/**
 * The Dialer header reads Policies Sold for the agent-local Sold Date from the versioned RPC only. The legacy RPC
 * (entry-time policy counts, kept for tabs opened before the release) is never called, and a response without the
 * Sold Date basis, or for a different day, is never shown.
 */
const io = vi.hoisted(() => ({ data: null as any, error: null as any, rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: io.rpc } }));
import { getTrustedTodayDialerStats, TrustedStatsUnavailable } from "../supabase-dialer-stats";

const campaignId = "cccccccc-0000-4000-8000-00000000000c";
const legacyRow = { calls_made: 12, contacted_calls: 5, total_talk_seconds: 640, policies_sold: 2, session_duration_seconds: 900,
  closed_session_duration_seconds: 600, active_session_id: null, active_session_started_at: null };
const read = (timeZone: string, at: string) => getTrustedTodayDialerStats({ agentId: "a", organizationId: "o", campaignId, timeZone, date: new Date(at) });

beforeEach(() => {
  io.error = null;
  io.rpc.mockReset().mockImplementation((_name: string, args: Record<string, unknown>) =>
    Promise.resolve({ data: io.data ?? [{ ...legacyRow, policy_date_basis: "sold_date", policy_sale_date: args.p_sale_date }], error: io.error }));
  io.data = null;
});

describe("getTrustedTodayDialerStats — Sold Date v2", () => {
  it.each([
    ["America/Los_Angeles", "2026-10-17T02:00:00Z", "2026-10-16", "2026-10-16T07:00:00.000Z", "2026-10-17T07:00:00.000Z"],
    ["America/New_York", "2026-10-16T03:30:00Z", "2026-10-15", "2026-10-15T04:00:00.000Z", "2026-10-16T04:00:00.000Z"],
    ["Pacific/Kiritimati", "2026-10-16T12:00:00Z", "2026-10-17", "2026-10-16T10:00:00.000Z", "2026-10-17T10:00:00.000Z"],
  ])("%s at %s sends the agent-local Sold Date %s with that day's window", async (zone, at, saleDate, start, end) => {
    const stats = await read(zone, at);
    expect(io.rpc).toHaveBeenCalledTimes(1);
    expect(io.rpc).toHaveBeenCalledWith("get_trusted_today_dialer_stats_v2", { p_campaign_id: campaignId, p_start: start, p_end: end, p_sale_date: saleDate });
    expect(stats).toEqual(legacyRow); // basis fields are checked, then stripped
  });

  it("never calls the legacy entry-time RPC", async () => {
    await read("America/Los_Angeles", "2026-10-16T20:30:00Z");
    expect(io.rpc.mock.calls.map(([name]) => name)).toEqual(["get_trusted_today_dialer_stats_v2"]);
  });

  it.each([
    ["a legacy-shaped row without the basis", [{ ...legacyRow }]],
    ["an entry-time basis", [{ ...legacyRow, policy_date_basis: "created_at", policy_sale_date: "2026-10-16" }]],
    ["a malformed sale date", [{ ...legacyRow, policy_date_basis: "sold_date", policy_sale_date: "10/16/2026" }]],
  ])("rejects %s", async (_label, data) => {
    io.data = data;
    await expect(read("America/Los_Angeles", "2026-10-16T20:30:00Z")).rejects.toBeInstanceOf(TrustedStatsUnavailable);
  });

  it("rejects totals for a different day than the one requested", async () => {
    io.data = [{ ...legacyRow, policy_date_basis: "sold_date", policy_sale_date: "2026-10-17" }]; // the UTC date
    await expect(read("America/Los_Angeles", "2026-10-17T02:00:00Z")).rejects.toThrow("Dialer stats returned a different day. Retry.");
  });

  it("surfaces a server refusal as unavailable, never as zeros", async () => {
    io.error = { code: "22023", message: "Invalid Dialer sale date for this local day" }; io.data = [];
    await expect(read("America/Los_Angeles", "2026-10-16T20:30:00Z")).rejects.toBeInstanceOf(TrustedStatsUnavailable);
  });
});
