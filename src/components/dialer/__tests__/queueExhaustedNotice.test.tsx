/**
 * QueueExhaustedNotice (Part B, PB-19 / B4-13): the Team/Open empty-queue notice owns its
 * get_queue_metrics result per campaignId.
 *
 * Pins: loading ("Checking queue…") and failed ("Couldn't load queue status.") are their own
 * headings with no detail; every ready branch keeps its distinct heading (no leads, licensing,
 * completed, locked by others, retry/callback waiting) and the "Next eligible in" line; a
 * previous campaign's row, error or next-eligible time never drives the current campaign, and
 * a late response for a previous campaign is ignored. One RPC call per campaignId, same name
 * and arguments.
 */
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: unknown; resolve: (reply: RpcReply) => void }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) =>
      new Promise<RpcReply>((resolve) => {
        h.calls.push({ fn, args, resolve });
      }),
  },
}));

import QueueExhaustedNotice from "../QueueExhaustedNotice";

const NOW = new Date("2026-10-11T12:00:00.000Z");
/** 2h 30m (and a few seconds) after NOW, so formatTimeUntil renders "2h 30m". */
const IN_2H30 = "2026-10-11T14:30:30.000Z";
const IN_45M = "2026-10-11T12:45:30.000Z";

const LOADING = "Checking queue…";
const FAILED = "Couldn't load queue status.";
const OLD_DEFAULT_HEADING = "No Available Contacts In Queue.";
const OLD_DEFAULT_DETAIL = /Your queue is empty or all contacts have been processed/;

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    total_leads: 10,
    eligible_leads: 5,
    locked_leads: 0,
    active_agents: 0,
    available_leads: 0,
    retry_blocked_leads: 0,
    callback_waiting_leads: 0,
    next_eligible_at: null,
    ...overrides,
  };
}

async function reply(index: number, value: RpcReply) {
  await act(async () => {
    h.calls[index].resolve(value);
  });
}

function heading() {
  return screen.getByRole("heading", { level: 2 }).textContent;
}

/** The detail and next-eligible lines are the only <p> elements the notice renders. */
function paragraphs(container: HTMLElement) {
  return Array.from(container.querySelectorAll("p")).map((p) => p.textContent);
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.calls = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  vi.useRealTimers();
});

describe("QueueExhaustedNotice — loading and failed states", () => {
  it("shows only 'Checking queue…' while the current campaign is loading", () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    expect(heading()).toBe(LOADING);
    expect(paragraphs(container)).toEqual([]);
    expect(screen.queryByText(OLD_DEFAULT_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByText(OLD_DEFAULT_DETAIL)).not.toBeInTheDocument();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].fn).toBe("get_queue_metrics");
    expect(h.calls[0].args).toEqual({ p_campaign_id: "camp-a" });
  });

  it("shows 'Couldn't load queue status.' with no detail on an RPC error", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: null, error: { message: "boom" } });
    expect(heading()).toBe(FAILED);
    expect(paragraphs(container)).toEqual([]);
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    expect(screen.queryByText(OLD_DEFAULT_DETAIL)).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it.each([
    ["an empty array", []],
    ["null data", null],
  ])("treats %s (no row) as a failed load, never as an empty campaign", async (_label, data) => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data, error: null });
    expect(heading()).toBe(FAILED);
    expect(paragraphs(container)).toEqual([]);
    expect(screen.queryByText("This Campaign Has No Leads.")).not.toBeInTheDocument();
    expect(screen.queryByText("Campaign Complete.")).not.toBeInTheDocument();
  });
});

describe("QueueExhaustedNotice — distinct ready states", () => {
  it("no leads (total_leads 0): heading only", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ total_leads: 0, eligible_leads: 0 })], error: null });
    expect(heading()).toBe("This Campaign Has No Leads.");
    expect(paragraphs(container)).toEqual([]);
    expect(screen.queryByText(/Import or assign leads/)).not.toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
  });

  it("accepts a single-object RPC payload as the row", async () => {
    render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: metrics({ total_leads: 0, eligible_leads: 0 }), error: null });
    expect(heading()).toBe("This Campaign Has No Leads.");
  });

  it("licensing restriction keeps its heading and the remedy only", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" requireLicensedStateAccess />);
    await reply(0, { data: [metrics({ eligible_leads: 0 })], error: null });
    expect(heading()).toBe("No leads in your licensed states for this campaign.");
    expect(paragraphs(container)).toEqual(["Add licenses in your profile or ask your admin."]);
    expect(screen.queryByText(/hold an active license/)).not.toBeInTheDocument();
  });

  it("no leads still wins over the licensing restriction", async () => {
    render(<QueueExhaustedNotice campaignId="camp-a" requireLicensedStateAccess />);
    await reply(0, { data: [metrics({ total_leads: 0, eligible_leads: 0 })], error: null });
    expect(heading()).toBe("This Campaign Has No Leads.");
  });

  it("completed (eligible_leads 0) keeps its heading and processed-set detail", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ eligible_leads: 0 })], error: null });
    expect(heading()).toBe("Campaign Complete.");
    expect(paragraphs(container)).toEqual([
      "Every lead in this campaign has been processed (called, removed, or marked DNC).",
    ]);
  });

  it("locked by others states the locked and active counts (plural)", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ locked_leads: 3, active_agents: 2 })], error: null });
    expect(heading()).toBe("All Available Leads Are Being Dialed.");
    expect(paragraphs(container)).toEqual(["3 leads are locked by 2 active agents."]);
    expect(screen.queryByText(/One may free up shortly/)).not.toBeInTheDocument();
    expect(screen.queryByText(/currently locked/)).not.toBeInTheDocument();
  });

  it("locked by others (singular)", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ locked_leads: 1, active_agents: 1 })], error: null });
    expect(paragraphs(container)).toEqual(["1 lead is locked by 1 active agent."]);
  });

  it("retry/callback waiting lists the buckets and the next eligible time", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, {
      data: [metrics({ retry_blocked_leads: 2, callback_waiting_leads: 1, next_eligible_at: IN_2H30 })],
      error: null,
    });
    expect(heading()).toBe("No Eligible Leads Right Now.");
    expect(paragraphs(container)).toEqual(["2 waiting on retry, 1 upcoming callback.", "Next eligible in 2h 30m"]);
    expect(screen.queryByText(/aren't callable yet/)).not.toBeInTheDocument();
  });

  it("retry/callback waiting with plural callbacks only", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ callback_waiting_leads: 4 })], error: null });
    expect(paragraphs(container)).toEqual(["4 upcoming callbacks."]);
  });

  it("retry/callback waiting with no bucket counts uses the fallback", async () => {
    const { container } = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ next_eligible_at: IN_45M })], error: null });
    expect(heading()).toBe("No Eligible Leads Right Now.");
    expect(paragraphs(container)).toEqual([
      "Waiting on retry timing, callbacks, or suppression.",
      "Next eligible in 45m",
    ]);
  });

  it("a next eligible time in the past is not shown", async () => {
    render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ retry_blocked_leads: 1, next_eligible_at: "2026-10-11T11:00:00.000Z" })], error: null });
    expect(screen.queryByText(/Next eligible in/)).not.toBeInTheDocument();
  });

  it("keeps one fetch per campaignId when other props change", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ eligible_leads: 0 })], error: null });
    view.rerender(<QueueExhaustedNotice campaignId="camp-a" requireLicensedStateAccess />);
    expect(heading()).toBe("No leads in your licensed states for this campaign.");
    expect(h.calls).toHaveLength(1);
  });
});

describe("QueueExhaustedNotice — campaign ownership", () => {
  it("switching campaign while mounted shows loading, never the previous campaign's state", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ eligible_leads: 0 })], error: null });
    expect(heading()).toBe("Campaign Complete.");

    view.rerender(<QueueExhaustedNotice campaignId="camp-b" />);
    expect(heading()).toBe(LOADING);
    expect(paragraphs(view.container)).toEqual([]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].args).toEqual({ p_campaign_id: "camp-b" });

    await reply(1, { data: [metrics({ total_leads: 0, eligible_leads: 0 })], error: null });
    expect(heading()).toBe("This Campaign Has No Leads.");
  });

  it("a failure for the new campaign after a previous success shows the failed state", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ retry_blocked_leads: 2, next_eligible_at: IN_2H30 })], error: null });
    expect(screen.getByText("Next eligible in 2h 30m")).toBeInTheDocument();

    view.rerender(<QueueExhaustedNotice campaignId="camp-b" />);
    await reply(1, { data: null, error: { message: "boom" } });
    expect(heading()).toBe(FAILED);
    expect(paragraphs(view.container)).toEqual([]);
    expect(screen.queryByText(/Next eligible in/)).not.toBeInTheDocument();
  });

  it("an empty response for the new campaign after a previous success shows the failed state", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ locked_leads: 3, active_agents: 2 })], error: null });
    view.rerender(<QueueExhaustedNotice campaignId="camp-b" />);
    await reply(1, { data: [], error: null });
    expect(heading()).toBe(FAILED);
    expect(screen.queryByText(/locked by/)).not.toBeInTheDocument();
  });

  it("a previous failure never shows for the new campaign", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: null, error: { message: "boom" } });
    expect(heading()).toBe(FAILED);
    view.rerender(<QueueExhaustedNotice campaignId="camp-b" />);
    expect(heading()).toBe(LOADING);
    await reply(1, { data: [metrics({ eligible_leads: 0 })], error: null });
    expect(heading()).toBe("Campaign Complete.");
  });

  it("ignores a late response from the previous campaign that arrives after the switch", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    view.rerender(<QueueExhaustedNotice campaignId="camp-b" />);
    expect(h.calls.map((c) => c.args)).toEqual([{ p_campaign_id: "camp-a" }, { p_campaign_id: "camp-b" }]);

    // camp-a answers late, while camp-b is still loading: nothing changes.
    await reply(0, { data: [metrics({ retry_blocked_leads: 3, next_eligible_at: IN_2H30 })], error: null });
    expect(heading()).toBe(LOADING);
    expect(paragraphs(view.container)).toEqual([]);

    await reply(1, { data: [metrics({ eligible_leads: 0 })], error: null });
    expect(heading()).toBe("Campaign Complete.");
    expect(screen.queryByText(/Next eligible in/)).not.toBeInTheDocument();
  });

  it("ignores a late previous-campaign response that arrives after the new campaign loaded", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    view.rerender(<QueueExhaustedNotice campaignId="camp-b" />);
    await reply(1, { data: [metrics({ total_leads: 0, eligible_leads: 0 })], error: null });
    expect(heading()).toBe("This Campaign Has No Leads.");

    await reply(0, { data: null, error: { message: "late boom" } });
    expect(heading()).toBe("This Campaign Has No Leads.");
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
  });

  it("never shows the previous campaign's next eligible time for the new campaign", async () => {
    const view = render(<QueueExhaustedNotice campaignId="camp-a" />);
    await reply(0, { data: [metrics({ retry_blocked_leads: 2, next_eligible_at: IN_2H30 })], error: null });
    expect(screen.getByText("Next eligible in 2h 30m")).toBeInTheDocument();

    view.rerender(<QueueExhaustedNotice campaignId="camp-b" />);
    expect(screen.queryByText(/Next eligible in/)).not.toBeInTheDocument();

    await reply(1, { data: [metrics({ retry_blocked_leads: 1, next_eligible_at: null })], error: null });
    expect(heading()).toBe("No Eligible Leads Right Now.");
    expect(screen.queryByText(/Next eligible in/)).not.toBeInTheDocument();

    view.rerender(<QueueExhaustedNotice campaignId="camp-c" />);
    await reply(2, { data: [metrics({ retry_blocked_leads: 1, next_eligible_at: IN_45M })], error: null });
    expect(screen.getByText("Next eligible in 45m")).toBeInTheDocument();
    expect(screen.queryByText("Next eligible in 2h 30m")).not.toBeInTheDocument();
  });
});
