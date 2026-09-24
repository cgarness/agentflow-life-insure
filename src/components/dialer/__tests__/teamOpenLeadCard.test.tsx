import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import LeadCard from "@/components/dialer/LeadCard";
import TeamOpenLeadDetails from "@/components/dialer/TeamOpenLeadDetails";
import { resolveTeamOpenLeadFields } from "@/lib/dialerLeadFields";
import type { CustomField } from "@/lib/types";

afterEach(cleanup);

const def = (name: string, type: CustomField["type"] = "Text", extra: Partial<CustomField> = {}): CustomField => ({
  id: `id-${name}`, name, type, appliesTo: ["Leads"], required: false, active: true, usageCount: 0, createdBy: null, ...extra,
});
const snapshot = { id: "cl-1", lead_id: "lead-1", first_name: "Ada", last_name: "Lovelace", phone: "5551234567", state: "TX", age: 0, source: "" };
const master = {
  id: "lead-1", first_name: "Ada", last_name: "Lovelace", phone: "5551234567", state: "TX", lead_source: "Facebook", age: 44,
  date_of_birth: "1980-12-10", custom_fields: { "Policy Goal": "Final expense", Smoker: false, additional_policies: [{ carrier: "X" }], __agentflow: { d: 1 }, tags: ["Duplicate"], Nested: { a: 1 } },
};
const fieldsFor = (m: Record<string, unknown> | null, layoutIds: string[] = ["firstName", "lastName"]) =>
  resolveTeamOpenLeadFields({ layoutIds, sources: { snapshot, master: m }, definitions: [def("Policy Goal", "Dropdown", { dropdownOptions: ["Final expense", "Term"] }), def("Smoker"), def("Beneficiary")] });

const detailsProps = (over: Partial<React.ComponentProps<typeof TeamOpenLeadDetails>> = {}) => ({
  fields: fieldsFor(master),
  masterStatus: "loaded" as const,
  definitionsUnavailable: false,
  isEditing: false,
  draft: {},
  errors: {},
  saving: false,
  onChange: vi.fn(),
  onRetry: vi.fn(),
  ...over,
});

const cardProps = {
  callAttempts: 1, maxAttempts: 5, lastDisposition: null, isClaimed: false, isEditing: false,
  editForm: {}, onEditChange: vi.fn(),
};

describe("Team / Open connected card", () => {
  it("shows populated custom values (incl. ones missing from the layout), keeps false, hides blanks and internals", () => {
    render(<LeadCard lead={snapshot} callStatus="connected" {...cardProps} teamOpenDetails={<TeamOpenLeadDetails {...detailsProps()} />} />);
    const grid = screen.getByTestId("team-open-lead-details");
    expect(within(grid).getByText("Final expense")).toBeInTheDocument();
    expect(within(grid).getByText("No")).toBeInTheDocument(); // Smoker false retained
    expect(within(grid).getByText("12/10/1980")).toBeInTheDocument();
    expect(within(grid).getByText("Facebook")).toBeInTheDocument();
    expect(within(grid).queryByText("Beneficiary")).toBeNull(); // empty agency field hidden in view mode
    expect(grid.textContent).not.toMatch(/additional_policies|__agentflow|Duplicate|\[object Object\]/);
  });

  it("unavailable master → explicit notice with the campaign copy, never presented as an empty contact", () => {
    render(<TeamOpenLeadDetails {...detailsProps({ fields: fieldsFor(null), masterStatus: "unavailable" })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/isn't available to you yet/);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Final expense")).toBeNull();
  });

  it("error → retry control", () => {
    const onRetry = vi.fn();
    render(<TeamOpenLeadDetails {...detailsProps({ fields: fieldsFor(null), masterStatus: "error", onRetry })} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("edit mode exposes supported empty agency fields with type-appropriate controls; structured values stay read-only", () => {
    const onChange = vi.fn();
    render(<TeamOpenLeadDetails {...detailsProps({ isEditing: true, onChange })} />);
    const beneficiary = screen.getByLabelText("Beneficiary");
    fireEvent.change(beneficiary, { target: { value: "Kid" } });
    expect(onChange).toHaveBeenCalledWith("custom:Beneficiary", "Kid");
    expect(screen.getByLabelText("Policy Goal").tagName).toBe("SELECT");
    expect(screen.getByLabelText("State").tagName).toBe("SELECT");
    expect(screen.queryByLabelText("Nested")).toBeNull(); // object value: no input
    expect(screen.queryByRole("textbox", { name: "Source" })).toBeNull(); // D-4 read-only
  });

  it("idle and ringing stages are unchanged even when Team/Open details are supplied", () => {
    const details = <TeamOpenLeadDetails {...detailsProps()} />;
    const { rerender } = render(<LeadCard lead={snapshot} callStatus="idle" {...cardProps} teamOpenDetails={details} />);
    expect(screen.queryByTestId("team-open-lead-details")).toBeNull();
    expect(screen.queryByText("Final expense")).toBeNull();
    rerender(<LeadCard lead={snapshot} callStatus="ringing" {...cardProps} teamOpenDetails={details} />);
    expect(screen.queryByTestId("team-open-lead-details")).toBeNull();
    expect(screen.getByText(/Revealed on connect/i)).toBeInTheDocument();
    expect(screen.queryByText("Lovelace")).toBeNull();
  });
});

describe("Personal campaigns keep the legacy card", () => {
  it("without teamOpenDetails, LeadCard renders its descriptor grid exactly as before", () => {
    const personalLead = { ...snapshot, email: "ada@example.com", date_of_birth: "1980-12-10" };
    render(
      <LeadCard
        lead={personalLead}
        callStatus="connected"
        {...cardProps}
        fieldDescriptors={[{ label: "First Name", key: "first_name", kind: "standard" }, { label: "DOB", key: "date_of_birth", kind: "standard" }, { label: "Email", key: "email", kind: "standard" }]}
      />,
    );
    expect(screen.queryByTestId("team-open-lead-details")).toBeNull();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("12/10/1980")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });
});
