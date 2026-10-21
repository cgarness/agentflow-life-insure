import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ClientLeadHistory } from "@/components/contacts/ClientLeadHistory";
import type { LeadConversionHistory } from "@/lib/types";

const history: LeadConversionHistory = {
  version: 1, leadId: "lead-1", convertedAt: "2026-10-21T20:00:00+00:00", convertedBy: "agent-1",
  leadStatus: "Interested", leadSource: "Facebook", leadCreatedAt: "2026-09-01T12:00:00+00:00",
  leadLastContactedAt: null, leadNotes: null, legacyConversionNotes: null, hasPreservedCustomFields: false,
};
const formatDate = (v: string) => `date(${v.slice(0, 10)})`;
const names: Record<string, string> = { "agent-1": "Ava Agent" };

afterEach(cleanup);

describe("ClientLeadHistory — read-only original lead", () => {
  it("shows every populated item as text, never as an input", () => {
    render(<ClientLeadHistory history={history} resolveAgentName={(id) => names[id] ?? ""} formatDate={formatDate} />);
    const panel = screen.getByRole("region", { name: "Original lead" });
    expect(panel).toHaveTextContent("Lead sourceFacebook");
    expect(panel).toHaveTextContent("Status at conversionInterested");
    expect(panel).toHaveTextContent("Lead createddate(2026-09-01)");
    expect(panel).toHaveTextContent("Converteddate(2026-10-21)");
    expect(panel).toHaveTextContent("Converted byAva Agent");
    expect(panel.querySelector("input, textarea, select, button")).toBeNull();
    expect(panel).not.toHaveTextContent(/score/i);
  });

  it("shows displaced lead notes verbatim and the set-aside notice", () => {
    render(<ClientLeadHistory history={{ ...history, leadNotes: "Line one\nLine two", hasPreservedCustomFields: true }}
      resolveAgentName={() => ""} formatDate={formatDate} />);
    expect(screen.getByText("Original lead notes")).toBeInTheDocument();
    expect(screen.getByText(/Line one/).textContent).toBe("Line one\nLine two");
    expect(screen.getByText(/could not be shown as client fields/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Original lead" })).toHaveTextContent("Converted byUnknown user");
  });

  it("shows an older app version's conversion notes separately, verbatim and read-only", () => {
    render(<ClientLeadHistory history={{ ...history, legacyConversionNotes: "Typed in an old tab" }}
      resolveAgentName={() => ""} formatDate={formatDate} />);
    expect(screen.getByText("Conversion notes (older app version)")).toBeInTheDocument();
    expect(screen.getByText("Typed in an old tab")).toBeInTheDocument();
    expect(screen.getByText(/kept here instead of replacing the lead/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Original lead" }).querySelector("input, textarea, select, button")).toBeNull();
  });

  it("hides missing items and renders nothing at all without history", () => {
    const { container, rerender } = render(<ClientLeadHistory history={{ ...history, leadSource: null, convertedBy: null }}
      resolveAgentName={() => ""} formatDate={formatDate} />);
    expect(screen.queryByText("Lead source")).toBeNull();
    expect(screen.queryByText("Converted by")).toBeNull();
    rerender(<ClientLeadHistory history={undefined} resolveAgentName={() => ""} formatDate={formatDate} />);
    expect(container).toBeEmptyDOMElement();
  });
});
