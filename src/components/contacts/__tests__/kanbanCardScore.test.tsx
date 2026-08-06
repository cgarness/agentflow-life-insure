/**
 * Lead-score exposure fix (2026-08-06) — Contacts Kanban cards must not display
 * the internal `leads.lead_score`.
 *
 * Renders `KanbanCardBody`, the sortable-free presentational export that BOTH
 * the in-flow card and the DragOverlay clone render, so no dnd-kit context is
 * needed and both surfaces are covered by one assertion set.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import type { Lead, Recruit } from "@/lib/types";
import { KanbanCardBody } from "@/components/contacts/KanbanCard";

const agentProfiles = [{ id: "agent-1", firstName: "Alexa", lastName: "Segura" }];

const lead = (overrides: Partial<Lead> = {}) =>
  ({
    id: "lead-1",
    firstName: "Dana",
    lastName: "Reyes",
    phone: "(512) 555-0123",
    email: "dana@example.com",
    state: "TX",
    status: "New",
    leadSource: "Facebook",
    leadScore: 9,
    assignedAgentId: "agent-1",
    ...overrides,
  }) as unknown as Lead;

const recruit = () =>
  ({
    id: "recruit-1",
    firstName: "Sam",
    lastName: "Ortiz",
    phone: "(512) 555-0199",
    email: "sam@example.com",
    state: "CA",
    status: "Interviewing",
    assignedAgentId: "agent-1",
  }) as unknown as Recruit;

const baseProps = {
  agentProfiles,
  onEdit: vi.fn(),
};

describe("KanbanCardBody — lead score is never displayed", () => {
  it("renders no Score label and no raw score value for a lead", () => {
    render(<KanbanCardBody {...baseProps} contact={lead()} type="lead" />);

    expect(screen.queryByText(/score/i)).toBeNull();
    expect(screen.queryByText(/\b9\b/)).toBeNull();
  });

  it("still renders the lead's name, state, source and contact details", () => {
    render(<KanbanCardBody {...baseProps} contact={lead()} type="lead" />);

    expect(screen.getByText("Dana Reyes")).toBeInTheDocument();
    expect(screen.getByText("TX")).toBeInTheDocument();
    expect(screen.getByText("Facebook")).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();
    expect(screen.getByText("(512) 555-0123")).toBeInTheDocument();
    // Assigned-agent initials badge.
    expect(screen.getByText("AS")).toBeInTheDocument();
  });

  it("hides the score for a high-score lead that previously rendered a success badge", () => {
    render(<KanbanCardBody {...baseProps} contact={lead({ leadScore: 10 })} type="lead" />);

    expect(screen.queryByText(/score/i)).toBeNull();
    expect(screen.queryByText("Score: 10")).toBeNull();
    expect(screen.queryByText(/\b10\b/)).toBeNull();
  });

  it("hides the score for a low-score lead that previously rendered a warning badge", () => {
    render(<KanbanCardBody {...baseProps} contact={lead({ leadScore: 2 })} type="lead" />);

    expect(screen.queryByText(/score/i)).toBeNull();
    expect(screen.queryByText(/\b2\b/)).toBeNull();
  });

  it("leaves the recruit card unchanged", () => {
    render(<KanbanCardBody {...baseProps} contact={recruit()} type="recruit" />);

    expect(screen.getByText("Sam Ortiz")).toBeInTheDocument();
    expect(screen.getByText("CA")).toBeInTheDocument();
    expect(screen.getByText("Recruit Pipeline")).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it("renders the lead-source badge through the injected renderer", () => {
    render(
      <KanbanCardBody
        {...baseProps}
        contact={lead()}
        type="lead"
        renderLeadSourceBadge={(source) => <span>src:{source}</span>}
      />
    );

    expect(screen.getByText("src:Facebook")).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).toBeNull();
  });
});
