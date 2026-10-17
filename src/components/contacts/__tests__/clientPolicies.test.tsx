import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ClientPolicies, ClientPolicyCount } from "../ClientPolicies";
import { getClientPolicyDisplay } from "@/lib/client-policy-display";
import type { Client } from "@/lib/types";

afterEach(cleanup);
const client: Partial<Client> = {
  id: "synthetic-client",
  carrier: "Example Life", policyType: "Whole Life", policyNumber: "EX-100",
  premiumAmount: "$64.25", faceAmount: "$18,000", soldDate: "2026-10-01",
  customFields: { additional_policies: [{
    carrier: "Sample Assurance", policyType: "Term", policyNumber: "EX-200",
    premiumAmount: "$31.60/mo", faceAmount: "90000", issueDate: "2026-09-12",
    effectiveDate: "2026-10-12",
  }] },
};
const date = (value: string) => `date:${value}`;

describe("read-only client policy display", () => {
  it("shows the total count and expands each policy independently with its own values", () => {
    render(<><ClientPolicyCount client={client} /><ClientPolicies client={client} formatDate={date} /></>);
    expect(screen.getByText("2 policies")).toBeInTheDocument();
    const primary = screen.getByRole("button", { name: /Example Life/ });
    const additional = screen.getByRole("button", { name: /Sample Assurance/ });
    expect(primary).toHaveAttribute("aria-expanded", "false");
    expect(additional).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("EX-200")).not.toBeInTheDocument();
    fireEvent.click(additional);
    expect(additional).toHaveAttribute("aria-expanded", "true");
    const details = within(screen.getByRole("region", { name: /Sample Assurance/ }));
    for (const text of ["EX-200", "$31.60", "$90,000.00", "date:2026-09-12", "date:2026-10-12"]) {
      expect(details.getByText(text)).toBeInTheDocument();
    }
    expect(details.queryByText("$64.25")).not.toBeInTheDocument();
    fireEvent.click(primary);
    expect(screen.getByText("EX-100")).toBeInTheDocument();
    expect(additional).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(additional);
    expect(screen.queryByText("EX-200")).not.toBeInTheDocument();
  });

  it("does not count a default-only imported client as a policy or duplicate a single primary view", () => {
    const blank: Partial<Client> = { id: "blank", policyType: "Term", premiumAmount: "$0.00", faceAmount: "0" };
    expect(getClientPolicyDisplay(blank).policies).toHaveLength(0);
    const { container } = render(<><ClientPolicyCount client={blank} /><ClientPolicies client={blank} formatDate={date} /></>);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const single = { ...client, customFields: undefined };
    expect(getClientPolicyDisplay(single).policies).toHaveLength(1);
    const view = render(<><ClientPolicyCount client={single} /><ClientPolicies client={single} formatDate={date} /></>);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows additional-only policies without inventing a primary, coverage or monthly premium", () => {
    const additionalOnly = { id: "extra", policyType: "Term" as const, customFields: {
      additional_policies: [{ carrier: "Only Carrier", premiumAmount: "", faceAmount: 0 }],
    } };
    render(<ClientPolicies client={additionalOnly} formatDate={date} />);
    expect(screen.getByText("Policies (1)")).toBeInTheDocument();
    expect(screen.queryByText(/Primary/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Only Carrier/ }));
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it.each(["corrupted", [null, 42, { carrier: "Valid extra", premiumAmount: "8.40" }]])(
    "surfaces malformed data without hiding a valid primary (%j)", additional_policies => {
      const malformed = { ...client, customFields: { additional_policies } };
      render(<><ClientPolicyCount client={malformed} /><ClientPolicies client={malformed} formatDate={date} /></>);
      expect(screen.getByText("Review policies")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Some policy details could not be displayed.");
      expect(screen.getByRole("button", { name: /Example Life/ })).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("[object Object]");
    },
  );

  it("reads frozen policy data without mutation and replaces it immediately on a contact switch", () => {
    const entry = Object.freeze({ carrier: "Frozen Carrier", premiumAmount: "12", issueDate: "2026-01-02" });
    const bag = Object.freeze({ additional_policies: Object.freeze([entry]) });
    const frozen = Object.freeze({ ...client, customFields: bag });
    const before = JSON.stringify(frozen);
    const view = render(<ClientPolicies client={frozen} formatDate={date} />);
    fireEvent.click(screen.getByRole("button", { name: /Frozen Carrier/ }));
    expect(JSON.stringify(frozen)).toBe(before);
    view.rerender(<ClientPolicies client={{ ...client, id: "next", customFields: {
      additional_policies: [{ carrier: "Next Carrier", policyNumber: "NEXT-1" }],
    } }} formatDate={date} />);
    expect(screen.queryByText("Frozen Carrier")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next Carrier/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("NEXT-1")).not.toBeInTheDocument();
  });
});
