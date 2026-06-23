/**
 * Contacts Build 4 — ContactKanbanBoard render contract.
 *
 * Asserts the board shows FULL filtered counts (not the page slice), surfaces a
 * truncation note, renders configured stages in deterministic order, and adds an
 * explicit Unmapped column so off-stage records never disappear. KanbanCard is
 * stubbed so we test the board/column structure, not card internals.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { Lead, Recruit, PipelineStage } from "@/lib/types";
import type { KanbanStageData } from "@/lib/contactsFilters";

vi.mock("@/components/contacts/KanbanCard", () => ({
  KanbanCard: ({ id }: { id: string }) => <div data-testid={`card-${id}`} />,
}));

import { ContactKanbanBoard } from "@/components/contacts/ContactKanbanBoard";

const stage = (id: string, name: string, order: number): PipelineStage => ({
  id,
  name,
  color: "#123456",
  isDefault: false,
  convertToClient: false,
  order,
  pipelineType: "lead",
});
const card = (id: string, status: string | null) => ({ id, status }) as unknown as Lead;

const baseProps = {
  tab: "Leads" as const,
  pipelineStages: [stage("s-new", "New", 0), stage("s-quote", "Quoted", 1), stage("s-sold", "Sold", 2)],
  perColumnLimit: 50,
  agentProfiles: [],
  onStatusChange: vi.fn(async () => {}),
  onEdit: () => {},
  onClick: () => {},
};

describe("ContactKanbanBoard", () => {
  it("renders configured stages in order + a trailing Unmapped column for off-stage statuses", () => {
    const stages: KanbanStageData<Lead | Recruit>[] = [
      { status: "New", total: 312, cards: [card("a", "New"), card("b", "New")] },
      { status: "Legacy", total: 4, cards: [card("u", "Legacy")] },
    ];
    render(<ContactKanbanBoard {...baseProps} stages={stages} />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["New", "Quoted", "Sold", "Unmapped"]);
  });

  it("shows the EXACT full count per column, not the visible card count", () => {
    const stages: KanbanStageData<Lead | Recruit>[] = [
      { status: "New", total: 312, cards: [card("a", "New"), card("b", "New")] },
    ];
    render(<ContactKanbanBoard {...baseProps} stages={stages} />);

    // Header badge is the exact full count even though only 2 cards are hydrated.
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByTestId("card-a")).toBeInTheDocument();
    expect(screen.getByTestId("card-b")).toBeInTheDocument();
    // Bounded slice is flagged.
    expect(screen.getByText("Showing 2 of 312")).toBeInTheDocument();
  });

  it("keeps off-stage records visible in the Unmapped column (never dropped)", () => {
    const stages: KanbanStageData<Lead | Recruit>[] = [
      { status: "Legacy A", total: 1, cards: [card("x", "Legacy A")] },
      { status: null, total: 1, cards: [card("y", null)] },
    ];
    render(<ContactKanbanBoard {...baseProps} stages={stages} />);

    expect(screen.getByText("Unmapped")).toBeInTheDocument();
    expect(screen.getByText("Status not in your pipeline configuration")).toBeInTheDocument();
    expect(screen.getByTestId("card-x")).toBeInTheDocument();
    expect(screen.getByTestId("card-y")).toBeInTheDocument();
  });

  it("renders an error panel instead of columns when the fetch failed", () => {
    render(<ContactKanbanBoard {...baseProps} stages={[]} error="boom" />);
    expect(screen.getByText("Couldn't load the board")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});
