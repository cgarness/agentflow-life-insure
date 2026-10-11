/**
 * CampaignHeatmap (Part B, B4-66): a failed calls query is not an empty history.
 *
 * Pins: on error the panel says "Couldn't load call data.", never "No call data yet", and every
 * cell uses the existing loading style with no "0 calls" tooltip; "No call data yet" appears
 * only after a successful empty load; data renders the scale with neither message; a failed
 * background refetch keeps the grid that already loaded. The query
 * (table, projection and filters) is unchanged.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom shims Radix Tooltip needs (scoped to this file, not the global setup)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(window as any).ResizeObserver = (window as any).ResizeObserver || RO;

type Reply = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  reply: null as null | Promise<{ data: unknown; error: unknown }>,
  queries: [] as Array<{ table: string; chain: Array<[string, unknown[]]> }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const record = { table, chain: [] as Array<[string, unknown[]]> };
      h.queries.push(record);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "gt"]) {
        b[m] = (...args: unknown[]) => {
          record.chain.push([m, args]);
          return b;
        };
      }
      b.then = (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) =>
        (h.reply ?? Promise.resolve({ data: [], error: null })).then(resolve, reject);
      return b;
    },
  },
}));

import { CampaignHeatmap } from "../CampaignHeatmap";

const CELLS = 14 * 7; // 8am..9pm × Mon..Sun
const LOADING_CELL = "bg-muted/20";
const FAILED = "Couldn't load call data.";
const EMPTY = "No call data yet";

function renderHeatmap(filter: "all" | "answered" = "all") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <CampaignHeatmap title="Calls Made" campaignId="camp-1" filter={filter} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** The 98 grid cells (the legend swatches are w-3, the cells w-4). */
function cells(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("div.rounded-sm.w-4"));
}

beforeEach(() => {
  h.reply = null;
  h.queries = [];
});

afterEach(() => {
  cleanup();
});

describe("CampaignHeatmap — failed vs empty vs data", () => {
  it("loading: no message and every cell in the loading style", () => {
    h.reply = new Promise(() => {});
    const { container } = renderHeatmap();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    const grid = cells(container);
    expect(grid).toHaveLength(CELLS);
    expect(grid.every((c) => c.classList.contains(LOADING_CELL))).toBe(true);
  });

  it("failed: says so, never claims an empty history, and fabricates no zeros", async () => {
    h.reply = Promise.resolve({ data: null, error: { message: "private diagnostic" } });
    const { container } = renderHeatmap();
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();

    const grid = cells(container);
    expect(grid).toHaveLength(CELLS);
    expect(grid.every((c) => c.classList.contains(LOADING_CELL))).toBe(true);
    expect(grid.some((c) => c.classList.contains("bg-muted/40"))).toBe(false);

    await act(async () => {
      fireEvent.focus(grid[0]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 calls/)).not.toBeInTheDocument();
  });

  it("empty: 'No call data yet' only after a successful empty load", async () => {
    h.reply = Promise.resolve({ data: [], error: null });
    const { container } = renderHeatmap();
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();

    const grid = cells(container);
    expect(grid.every((c) => c.classList.contains("bg-muted/40"))).toBe(true);
    expect(grid.some((c) => c.classList.contains(LOADING_CELL))).toBe(false);

    await act(async () => {
      fireEvent.focus(grid[0]);
      // let Radix/floating-ui finish positioning inside act
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Mon 8a — 0 calls");
  });

  it("data: renders the scale with neither message", async () => {
    // Local-time Monday 10:15 (getDay/getHours read local time, as the component does).
    const monday = new Date(2026, 9, 12, 10, 15);
    expect(monday.getDay()).toBe(1);
    h.reply = Promise.resolve({
      data: [
        { started_at: monday.toISOString(), duration: 60 },
        { started_at: new Date(2026, 9, 12, 10, 40).toISOString(), duration: 12 },
      ],
      error: null,
    });
    const { container } = renderHeatmap();
    await screen.findByText("Calls Made");
    await waitFor(() => {
      expect(cells(container).some((c) => c.classList.contains("bg-primary/20"))).toBe(true);
    });
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    const grid = cells(container);
    expect(grid.filter((c) => c.classList.contains("bg-primary/20"))).toHaveLength(1);
    expect(grid.some((c) => c.classList.contains(LOADING_CELL))).toBe(false);
  });

  it("a failed background refetch keeps the grid that already loaded", async () => {
    const monday = new Date(2026, 9, 12, 10, 15);
    h.reply = Promise.resolve({ data: [{ started_at: monday.toISOString(), duration: 60 }], error: null });
    const { container, client } = renderHeatmap();
    await waitFor(() => {
      expect(cells(container).filter((c) => c.classList.contains("bg-primary/20"))).toHaveLength(1);
    });

    h.reply = Promise.resolve({ data: null, error: { message: "refetch failed" } });
    await act(async () => {
      await client.refetchQueries();
    });
    await waitFor(() => expect(client.getQueryState(["campaignHeatmap", "camp-1", "all"])?.status).toBe("error"));
    expect(client.getQueryState(["campaignHeatmap", "camp-1", "all"])?.data).toBeTruthy();

    const grid = cells(container);
    expect(grid.filter((c) => c.classList.contains("bg-primary/20"))).toHaveLength(1);
    expect(grid.some((c) => c.classList.contains(LOADING_CELL))).toBe(false);
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("keeps the existing calls query (and the answered filter)", async () => {
    renderHeatmap("answered");
    await screen.findByText(EMPTY);
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0].table).toBe("calls");
    expect(h.queries[0].chain).toEqual([
      ["select", ["started_at, duration"]],
      ["eq", ["campaign_id", "camp-1"]],
      ["not", ["started_at", "is", null]],
      ["gt", ["duration", 45]],
    ]);
  });
});
