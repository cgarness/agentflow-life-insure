import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CarrierDirectory from "../CarrierDirectory";
import CarriersPage from "@/pages/CarriersPage";
import type { CarrierDirectoryItem } from "@/lib/carrierResources";

const mocks = vi.hoisted(() => ({ directory: vi.fn(), auth: vi.fn() }));
vi.mock("@/hooks/useCarrierDirectory", () => ({ useCarrierDirectory: mocks.directory }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: mocks.auth }));

const carrier = (overrides: Partial<CarrierDirectoryItem> = {}): CarrierDirectoryItem => ({
  id: "carrier-one", name: "Example Life", portal_url: null, logo_url: null,
  contact_phones: [], contact_emails: [], resource_links: [], ...overrides,
});
const writeText = vi.fn();
const retry = vi.fn();
const ready = (scopeKey = "account-one") => ({
  carriers: [carrier()], status: "ready", scopeKey, retry,
});
const renderPage = () => render(<MemoryRouter><CarriersPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ profile: { role: "agent", is_super_admin: false }, isImpersonating: false });
  mocks.directory.mockReturnValue(ready());
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(cleanup);

describe("Carrier directory", () => {
  it("sorts carrier names, starts closed, and allows one expanded card", () => {
    render(<CarrierDirectory carriers={[carrier({ id: "z", name: "Zenith Example" }), carrier({ id: "a", name: "Alpha Example" })]} />);
    const triggers = screen.getAllByRole("button");
    expect(triggers.map((trigger) => trigger.textContent)).toEqual(["AAlpha Example", "ZZenith Example"]);
    triggers.forEach((trigger) => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveAttribute("aria-controls");
    });
    fireEvent.click(triggers[0]);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(triggers[1]);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(triggers[1]);
    expect(triggers[1]).toHaveAttribute("aria-expanded", "false");
  });

  it("retains Radix keyboard navigation between native carrier buttons", () => {
    render(<CarrierDirectory carriers={[carrier({ id: "a", name: "Alpha Example" }), carrier({ id: "b", name: "Beta Example" })]} />);
    const first = screen.getByRole("button", { name: "Alpha Example" });
    const second = screen.getByRole("button", { name: "Beta Example" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
    expect(first.tagName).toBe("BUTTON");
  });

  it("searches names only, ignores case and edge whitespace, and closes cards on search", () => {
    render(<CarrierDirectory carriers={[carrier({ resource_links: [{ id: "r", label: "Hidden search term", url: "https://carrier.example/guide", group: "guides_training" }] }), carrier({ id: "other", name: "Other Example" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Example Life" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  EXAMPLE LIFE " } });
    expect(screen.getByRole("button", { name: "Example Life" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Other Example" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Hidden search term" } });
    expect(screen.getByRole("status")).toHaveTextContent("No carriers found");
  });

  it("shows an agency empty state without sample carriers", () => {
    render(<CarrierDirectory carriers={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No carriers yet");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders safe grouped links, includes the portal once, and hides unsafe URLs", () => {
    render(<CarrierDirectory carriers={[carrier({
      portal_url: "https://carrier.example/portal", logo_url: "javascript:alert(1)",
      resource_links: [
        { id: "duplicate", label: "Duplicate portal", url: "https://carrier.example/portal", group: "quick_links" },
        { id: "application", label: "Application", url: "https://carrier.example/apply", group: "quick_links" },
        { id: "guide", label: "Underwriting guide", url: "https://carrier.example/guide.pdf", group: "guides_training" },
        { id: "unsafe", label: "Unsafe link", url: "javascript:alert(1)", group: "quick_links" },
      ],
    })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Example Life" }));
    expect(screen.getByRole("heading", { name: "Quick links" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Guides & training" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contacts" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
    screen.getAllByRole("link").forEach((link) => {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAccessibleName(/opens in a new tab/);
    });
    expect(screen.queryByText("Duplicate portal")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsafe link")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/appointed/i)).not.toBeInTheDocument();
  });

  it("omits empty sections and provides a carrier-level empty state", () => {
    render(<CarrierDirectory carriers={[carrier()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Example Life" }));
    expect(screen.getByText("No resources added yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Quick links|Guides & training|Contacts/ })).not.toBeInTheDocument();
  });

  it("uses native contact links and keeps invalid contacts as readable text", () => {
    render(<CarrierDirectory carriers={[carrier({
      contact_phones: [{ label: "Agent support", value: "+1 (800) 555-0100 ext. 12" }, { label: "Legacy phone", value: "See your contract" }],
      contact_emails: [{ label: "Underwriting", value: "uw@carrier.example" }, { label: "Legacy email", value: "invalid?email" }],
    })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Example Life" }));
    expect(screen.getByRole("link", { name: "+1 (800) 555-0100 ext. 12" })).toHaveAttribute("href", "tel:+18005550100;ext=12");
    expect(screen.getByRole("link", { name: "uw@carrier.example" })).toHaveAttribute("href", "mailto:uw%40carrier.example");
    expect(screen.getByText("See your contract").closest("a")).toBeNull();
    expect(screen.getByText("invalid?email").closest("a")).toBeNull();
  });

  it("announces copy success only after the clipboard operation succeeds", async () => {
    let finish: () => void = () => undefined;
    writeText.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    render(<CarrierDirectory carriers={[carrier({ contact_phones: [{ label: "Support", value: " 800-555-0100 " }] })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Example Life" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Support phone number" }));
    expect(writeText).toHaveBeenCalledWith("800-555-0100");
    expect(screen.queryByText("Phone number copied.")).not.toBeInTheDocument();
    await act(async () => { finish(); });
    expect(screen.getByRole("status")).toHaveTextContent("Phone number copied.");
  });

  it("reports clipboard rejection without claiming success", async () => {
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    render(<CarrierDirectory carriers={[carrier({ contact_phones: [{ label: "Support", value: "800-555-0100" }] })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Example Life" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Support phone number" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not copy."));
    expect(screen.queryByText("Phone number copied.")).not.toBeInTheDocument();
  });
});

describe("Carriers page", () => {
  it.each(["loading", "error", "unavailable"])("withholds stale carriers while %s", (status) => {
    mocks.directory.mockReturnValue({ ...ready(), status });
    renderPage();
    expect(screen.queryByRole("button", { name: "Example Life" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    if (status === "error") {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(retry).toHaveBeenCalledOnce();
    } else {
      expect(screen.getByRole("status")).toHaveTextContent(status === "loading" ? "Loading carriers" : "not available");
    }
  });

  it("limits the Settings shortcut to ready administrators outside View As", () => {
    const view = renderPage();
    expect(screen.queryByRole("link", { name: "Manage carriers" })).not.toBeInTheDocument();
    mocks.auth.mockReturnValue({ profile: { role: "admin" }, isImpersonating: false });
    view.rerender(<MemoryRouter><CarriersPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Manage carriers" })).toHaveAttribute("href", "/settings?section=carriers");
    mocks.auth.mockReturnValue({ profile: { role: "admin" }, isImpersonating: true });
    view.rerender(<MemoryRouter><CarriersPage /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Manage carriers" })).not.toBeInTheDocument();
  });

  it("resets search and expansion when the confirmed account scope changes", () => {
    const view = renderPage();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Example" } });
    fireEvent.click(screen.getByRole("button", { name: "Example Life" }));
    mocks.directory.mockReturnValue(ready("account-two"));
    view.rerender(<MemoryRouter><CarriersPage /></MemoryRouter>);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Example Life" })).toHaveAttribute("aria-expanded", "false");
  });
});
