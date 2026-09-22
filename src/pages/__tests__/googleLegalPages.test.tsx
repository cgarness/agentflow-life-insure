import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PrivacyPolicyPage from "../PrivacyPolicyPage";
import TermsOfServicePage from "../TermsOfServicePage";

describe("public Google legal pages", () => {
  it.each([["Privacy Policy", PrivacyPolicyPage], ["Terms of Service", TermsOfServicePage]] as const)("renders %s without an authenticated context", (title, Page) => {
    render(<MemoryRouter><Page /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("not approved for publication");
    expect(screen.getAllByRole("link", { name: "Privacy Policy" }).every(link => link.getAttribute("href") === "/privacy")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Terms of Service" }).every(link => link.getAttribute("href") === "/terms")).toBe(true);
  });
  it("discloses unmatched messages and retention handling in the draft", () => {
    render(<MemoryRouter><PrivacyPolicyPage /></MemoryRouter>);
    expect(screen.getByRole("main")).toHaveTextContent(/not matched|not been matched|not linked/);
    expect(screen.getByRole("main")).toHaveTextContent(/retention/i);
    expect(screen.getByRole("link", { name: "Google API Services User Data Policy" })).toHaveAttribute("href", "https://developers.google.com/terms/api-services-user-data-policy");
  });
});
