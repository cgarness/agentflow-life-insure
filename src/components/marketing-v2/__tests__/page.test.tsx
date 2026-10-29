import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingPageV2 from "@/pages/LandingPageV2";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.querySelector('meta[name="robots"]')?.remove(); });
const show = () => render(<MemoryRouter><LandingPageV2 /></MemoryRouter>);

describe("private V2 page contract", () => {
  it("uses signup rather than trial/purchase promises and avoids unverified pricing/contact destinations", () => {
    show();
    const links = screen.getAllByRole("link");
    const signup = links.filter(link => link.textContent?.includes("Get started"));
    expect(signup.length).toBe(3); signup.forEach(link => expect(link.getAttribute("href")).toBe("/signup"));
    expect(links.some(link => ["/pricing", "/contact"].includes(link.getAttribute("href") || ""))).toBe(false);
    expect(document.body.textContent).not.toMatch(/14-day|no per-minute|predictive|AI-powered|hundreds of agencies|\$49|\$99/i);
    expect(screen.getByText(/Plan prices and trial terms are not confirmed/)).toBeTruthy();
  });
  it("has valid section anchors, working mobile navigation and an accessible FAQ", () => {
    show();
    screen.getAllByRole("link").filter(link => link.getAttribute("href")?.startsWith("#")).forEach(link => {
      expect(document.getElementById(link.getAttribute("href")!.slice(1))).toBeTruthy();
    });
    const menu = screen.getByRole("button", { name: "Open menu" }); fireEvent.click(menu);
    expect(screen.getByRole("navigation", { name: "Mobile homepage navigation" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("link", { name: /^Dialer$/ }).at(-1)!);
    expect(screen.queryByRole("navigation", { name: "Mobile homepage navigation" })).toBeNull();
    const faq = screen.getByRole("button", { name: "How does dialing work?" }); fireEvent.click(faq);
    expect(faq.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(faq.getAttribute("aria-controls")!)?.textContent).toContain("start each call");
  });
  it("sets private metadata and restores an existing robots tag on exit", () => {
    document.title = "Original";
    const robots = document.createElement("meta"); robots.name = "robots"; robots.content = "index, follow";
    document.head.appendChild(robots);
    const view = show(); expect(document.title).toContain("Private Homepage V2");
    expect(robots.content).toBe("noindex, nofollow, noarchive");
    view.unmount(); expect(document.title).toBe("Original"); expect(robots.content).toBe("index, follow");
  });
  it("removes only its own robots tag, preserving a preexisting tag with no content attribute", () => {
    const robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots);
    const view = show(); view.unmount(); expect(robots.hasAttribute("content")).toBe(false);
    robots.remove(); const second = show(); second.unmount();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});
