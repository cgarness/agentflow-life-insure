/**
 * Shared auth shell contract.
 *
 * Guards the things every auth page depends on and that are easy to regress:
 * the dark-token scope (the app's default theme is `light`), the solid black
 * full-viewport background, the body tint that prevents a white band on
 * overscroll, and the centered card — with no split-screen/marketing chrome
 * and no entrance animation.
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AuthShell from "@/components/auth/AuthShell";
import AuthAlert from "@/components/auth/AuthAlert";

const renderShell = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => {
  cleanup();
  document.body.classList.remove("bg-black");
});

describe("AuthShell", () => {
  it("scopes dark tokens so shadcn primitives do not resolve the light theme", () => {
    const { container } = renderShell(
      <AuthShell>
        <p>content</p>
      </AuthShell>,
    );
    const root = container.querySelector("div");
    expect(root).toHaveClass("dark");
    expect(root).toHaveClass("bg-black");
  });

  it("uses a dynamic-viewport min-height rather than min-h-screen", () => {
    // min-h-screen (100vh) is what leaves a white band under mobile browser chrome.
    const { container } = renderShell(
      <AuthShell>
        <p>content</p>
      </AuthShell>,
    );
    const root = container.querySelector("div");
    expect(root).toHaveClass("min-h-dvh");
    expect(root).not.toHaveClass("min-h-screen");
  });

  it("prevents horizontal overflow at narrow widths", () => {
    const { container } = renderShell(
      <AuthShell>
        <p>content</p>
      </AuthShell>,
    );
    expect(container.querySelector("div")).toHaveClass("overflow-x-hidden");
  });

  it("tints the body while mounted and restores it on unmount", () => {
    expect(document.body.classList.contains("bg-black")).toBe(false);

    const { unmount } = renderShell(
      <AuthShell>
        <p>content</p>
      </AuthShell>,
    );
    expect(document.body.classList.contains("bg-black")).toBe(true);

    // Must not leak into the authenticated app shell after an SPA navigation.
    unmount();
    expect(document.body.classList.contains("bg-black")).toBe(false);
  });

  it("renders a single centered card with no split-screen or marketing panel", () => {
    const { container } = renderShell(
      <AuthShell>
        <p>content</p>
      </AuthShell>,
    );
    // No brand/marketing column — the Command Deck split screen is retired.
    expect(container.querySelector("aside")).toBeNull();
    // The card surface exists: rounded, bordered, on the black page.
    const card = container.querySelector("main > div");
    expect(card?.className).toContain("rounded-2xl");
    expect(card?.className).toContain("border");
  });

  it("has no entrance animation — the card renders static", () => {
    const { container } = renderShell(
      <AuthShell>
        <p>content</p>
      </AuthShell>,
    );
    expect(container.innerHTML).not.toMatch(/animate-in|fade-in|slide-in/);
  });
});

describe("AuthAlert", () => {
  it("keeps the live region mounted when empty so later messages are announced", () => {
    renderShell(<AuthAlert />);
    const region = screen.getByRole("alert");
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");
  });

  it("renders the message with an icon that is hidden from assistive technology", () => {
    const { container } = renderShell(<AuthAlert>Invalid login credentials</AuthAlert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(container.querySelector("svg[aria-hidden='true']")).toBeTruthy();
  });
});
