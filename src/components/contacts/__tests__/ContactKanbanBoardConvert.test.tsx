/**
 * Contacts QA Fix Pass 1 — Kanban convert-stage drag guard (Fix 4) + DragOverlay (Fix 11).
 *
 * Verifies the board routes a drag onto a convert_to_client stage to onConvertRequest
 * (opening ConvertLeadModal, NO status persisted), a drag onto a normal stage to
 * onStatusChange, and — for a board with no convert handler (Recruits) — falls back to a
 * plain status move. Also verifies onDragStart renders the dragged card in the DragOverlay
 * (Fix 11). @dnd-kit/core is mocked so we can invoke the captured drag callbacks directly;
 * KanbanColumn is stubbed so the only source of card content is the overlay.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import type { Lead, Recruit, PipelineStage } from "@/lib/types";
import type { KanbanStageData } from "@/lib/contactsFilters";

let capturedOnDragEnd: ((e: { active: { id: string }; over: { id: string } | null }) => void) | null = null;
let capturedOnDragStart: ((e: { active: { id: string } }) => void) | null = null;

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd, onDragStart }: {
    children: React.ReactNode;
    onDragEnd: typeof capturedOnDragEnd;
    onDragStart: typeof capturedOnDragStart;
  }) => {
    capturedOnDragEnd = onDragEnd;
    capturedOnDragStart = onDragStart;
    return <div>{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
  closestCorners: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({ sortableKeyboardCoordinates: vi.fn() }));
vi.mock("@/components/contacts/KanbanColumn", () => ({ default: () => <div data-testid="col" /> }));

import { ContactKanbanBoard } from "@/components/contacts/ContactKanbanBoard";
import { COLUMN_DROP_PREFIX } from "@/lib/contactsKanban";

const stage = (id: string, name: string, order: number, convertToClient = false): PipelineStage => ({
  id,
  name,
  color: "#000",
  isDefault: false,
  convertToClient,
  order,
  pipelineType: "lead",
});
const card = (id: string, status: string | null, firstName = "Test", lastName = "Lead") =>
  ({ id, status, firstName, lastName, assignedAgentId: "", leadScore: 5 }) as unknown as Lead;

// New + Quoted are normal; Sold is a convert_to_client stage.
const pipelineStages = [stage("s-new", "New", 0), stage("s-quote", "Quoted", 1), stage("s-sold", "Sold", 2, true)];
const stages: KanbanStageData<Lead | Recruit>[] = [
  { status: "New", total: 1, cards: [card("a", "New", "Ada", "Lovelace")] },
  { status: "Quoted", total: 0, cards: [] },
  { status: "Sold", total: 0, cards: [] },
];
const baseProps = {
  tab: "Leads" as const,
  pipelineStages,
  stages,
  perColumnLimit: 50,
  agentProfiles: [],
  onEdit: () => {},
  onClick: () => {},
};
const drop = (activeId: string, columnKey: string) =>
  act(() => { capturedOnDragEnd?.({ active: { id: activeId }, over: { id: COLUMN_DROP_PREFIX + columnKey } }); });

describe("ContactKanbanBoard — convert-stage drag guard (Fix 4) + overlay (Fix 11)", () => {
  it("drop on a convert_to_client stage calls onConvertRequest, not onStatusChange", () => {
    const onStatusChange = vi.fn(async () => {});
    const onConvertRequest = vi.fn();
    render(<ContactKanbanBoard {...baseProps} onStatusChange={onStatusChange} onConvertRequest={onConvertRequest} />);
    drop("a", "Sold");
    expect(onConvertRequest).toHaveBeenCalledWith("a");
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("drop on a normal stage calls onStatusChange, not onConvertRequest", () => {
    const onStatusChange = vi.fn(async () => {});
    const onConvertRequest = vi.fn();
    render(<ContactKanbanBoard {...baseProps} onStatusChange={onStatusChange} onConvertRequest={onConvertRequest} />);
    drop("a", "Quoted");
    expect(onStatusChange).toHaveBeenCalledWith("a", "Quoted");
    expect(onConvertRequest).not.toHaveBeenCalled();
  });

  it("without a convert handler (Recruits), a convert stage falls back to a plain status move", () => {
    const onStatusChange = vi.fn(async () => {});
    render(<ContactKanbanBoard {...baseProps} onStatusChange={onStatusChange} />);
    drop("a", "Sold");
    expect(onStatusChange).toHaveBeenCalledWith("a", "Sold");
  });

  it("Fix 11: onDragStart renders the dragged card in the DragOverlay", () => {
    render(<ContactKanbanBoard {...baseProps} onStatusChange={vi.fn(async () => {})} onConvertRequest={vi.fn()} />);
    // No active card yet → the overlay holds no card content (KanbanColumn is stubbed out).
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    act(() => { capturedOnDragStart?.({ active: { id: "a" } }); });
    expect(screen.getByTestId("drag-overlay")).toHaveTextContent("Ada Lovelace");
  });
});
