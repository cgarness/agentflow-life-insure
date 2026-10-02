import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LeadCard from "@/components/dialer/LeadCard";
import TeamOpenLeadDetails from "@/components/dialer/TeamOpenLeadDetails";
import { resolveTeamOpenLeadFields } from "@/lib/dialerLeadFields";

afterEach(cleanup);

const row = { id: "queue-1", lead_id: "lead-1", first_name: "Ada", last_name: "Team", age: 0 };
const fields = resolveTeamOpenLeadFields({
  layoutIds: ["firstName"],
  sources: {
    snapshot: row,
    master: {
      id: "lead-1", notes: "Ask about final expense", lead_source: "Referral",
      custom_fields: { Goal: "Final expense", Smoker: false, Blank: "", __agentflow: "hidden" },
    },
  },
  definitions: null,
});
const props = {
  lead: row, callAttempts: 0, maxAttempts: 5, lastDisposition: null, isClaimed: false,
  isEditing: false, editForm: {}, onEditChange: vi.fn(),
  teamOpenDetails: <TeamOpenLeadDetails
    fields={fields} masterStatus="loaded" definitionsUnavailable={false} isEditing={false}
    draft={{}} errors={{}} saving={false} onChange={vi.fn()} onRetry={vi.fn()}
  />,
};

describe("Team details presentation", () => {
  it.each(["idle", "ringing", "connected"] as const)("shows authorized populated fields at %s with a confirmed Team display", (callStatus) => {
    render(<LeadCard {...props} callStatus={callStatus} teamDetailsVisible />);
    const grid = screen.getByTestId("team-open-lead-details");
    expect(within(grid).getByText("Ask about final expense")).toBeInTheDocument();
    expect(within(grid).getByText("Final expense")).toBeInTheDocument();
    expect(within(grid).getByText("No")).toBeInTheDocument();
    expect(within(grid).getByText("0")).toBeInTheDocument();
    expect(within(grid).queryByText("Blank")).toBeNull();
    expect(grid.textContent).not.toContain("__agentflow");
    expect(screen.queryByText(/Revealed on connect/i)).toBeNull();
  });

  it("masks an old connected call immediately when the Team display confirmation is lost", () => {
    const { rerender } = render(<LeadCard {...props} callStatus="connected" teamDetailsVisible />);
    expect(screen.getByTestId("team-open-lead-details")).toBeInTheDocument();
    rerender(<LeadCard {...props} callStatus="connected" teamDetailsVisible={false} />);
    expect(screen.queryByTestId("team-open-lead-details")).toBeNull();
  });

  it.each([{ isAdvancing: true }, { lead: null }])("does not reveal while advancing or without a lead: %j", (over) => {
    render(<LeadCard {...props} {...over} callStatus="connected" teamDetailsVisible />);
    expect(screen.queryByTestId("team-open-lead-details")).toBeNull();
  });

  it("keeps the Open Pool idle/ringing stages when no Team override is provided", () => {
    const { rerender } = render(<LeadCard {...props} callStatus="idle" />);
    expect(screen.queryByTestId("team-open-lead-details")).toBeNull();
    rerender(<LeadCard {...props} callStatus="ringing" />);
    expect(screen.getByText(/Revealed on connect/i)).toBeInTheDocument();
    expect(screen.queryByTestId("team-open-lead-details")).toBeNull();
  });
});
