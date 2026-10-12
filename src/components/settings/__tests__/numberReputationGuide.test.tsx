/**
 * Part B, Area 6a (B6-63, B6-64, B6-65) — Number Reputation keeps one reference and loses the decorative banner.
 *
 * - The decorative ReputationAiScanner mount is gone ("AI line monitor", "LIVE NEURAL FILTER", …).
 * - The Reputation Signal Guide is the single reference: the five hover-only HelpCircle header tooltips are gone,
 *   and the guide toggle is a native, focusable <button type="button"> with aria-expanded / aria-controls.
 * - The signal columns and their per-row values still render (no signal or status data changed).
 */
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  query: { data: [] as unknown[], refetch: () => Promise.resolve(), isLoading: false },
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => h.query }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), auth: {}, functions: {} } }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("framer-motion", () => {
  const strip = ({ initial: _i, animate: _a, transition: _t, ...rest }: Record<string, unknown>) => rest;
  return {
    motion: {
      tr: (p: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...(strip(p as Record<string, unknown>) as React.HTMLAttributes<HTMLTableRowElement>)} />,
      div: (p: React.HTMLAttributes<HTMLDivElement>) => <div {...(strip(p as Record<string, unknown>) as React.HTMLAttributes<HTMLDivElement>)} />,
    },
  };
});

import NumberReputation from "@/components/settings/NumberReputation";

const ROW = {
  id: "pn-1",
  phone_number: "+15551230001",
  friendly_name: "Main line",
  status: "active",
  spam_status: "flagged",
  spam_score: null,
  spam_checked_at: null,
  attestation_level: "A",
  shaken_stir_attestation: null,
  carrier_reputation_data: {
    carriers: [
      { name: "AT&T", blocking_rate: 1 },
      { name: "Verizon", blocking_rate: 3 },
      { name: "T-Mobile", spam_label: "Spam Likely" },
    ],
  },
  daily_call_count: null,
  daily_call_limit: null,
  created_at: "2026-10-01T00:00:00Z",
  last_outbound_shaken_stir: null,
  calls_today: 4,
};

/**
 * jsdom does not synthesize the click a browser dispatches when Enter (keydown) or Space (keyup) activates a
 * native, enabled <button>. This mirrors that platform behaviour and nothing more: a clickable <div> (the old
 * toggle) is not activated, so the keyboard assertions fail for anything but a real button.
 */
const pressKey = (el: HTMLElement, key: "Enter" | " ") => {
  fireEvent.keyDown(el, { key });
  const nativeButton = el instanceof HTMLButtonElement && !el.disabled;
  if (nativeButton && key === "Enter") fireEvent.click(el);
  fireEvent.keyUp(el, { key });
  if (nativeButton && key === " ") fireEvent.click(el);
};

const guideToggle = () => screen.getByRole("button", { name: /Reputation Signal Guide/ });

beforeEach(() => {
  h.query = { data: [ROW], refetch: () => Promise.resolve(), isLoading: false };
});
afterEach(cleanup);

describe("NumberReputation — single guide, no decorative scanner (B6-63, B6-64, B6-65)", () => {
  it("renders none of the decorative scanner strings and keeps only the limitation in the header", () => {
    const { container } = render(<NumberReputation />);
    expect(screen.getByRole("heading", { name: "Number Reputation" })).toBeInTheDocument();
    expect(screen.getByText("These are signals, not guarantees.")).toBeInTheDocument();
    expect(screen.queryByText(/Monitor caller ID health/)).toBeNull();
    for (const s of [/AI line monitor/i, /LIVE NEURAL FILTER/i, /Reputation shield/i, /Protected lines/i, /Continuous watch/i, /Spam label watch/i]) {
      expect(screen.queryByText(s)).toBeNull();
    }
    expect(container.textContent ?? "").not.toMatch(/neural/i);
  });

  it("deletes the five header HelpCircle tooltips; the signal columns and row values still render", () => {
    const { container } = render(<NumberReputation />);
    expect(container.querySelector('[class*="help-circle"], [class*="circle-help"], .cursor-help')).toBeNull();

    for (const name of ["Phone number", "Attestation", "Spam likely", "Calls today", "AT&T", "Verizon", "T-Mobile", "Last check", "Actions"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }

    const row = screen.getAllByRole("row")[1];
    const cells = within(row);
    expect(cells.getByText("+15551230001")).toBeInTheDocument();
    expect(cells.getByText("Main line")).toBeInTheDocument();
    expect(cells.getByText("Full (A)")).toBeInTheDocument();
    expect(cells.getByTitle(/^High \/ Flagged spam likelihood/)).toBeInTheDocument();
    expect(cells.getByText("4")).toBeInTheDocument();
    expect(cells.getByTitle("Check")).toBeInTheDocument(); // AT&T: blocking rate 1 → good
    expect(cells.getByTitle("Warning")).toBeInTheDocument(); // Verizon: blocking rate 3 → warning
    expect(cells.getByTitle("Flag")).toBeInTheDocument(); // T-Mobile: spam label → bad
    expect(cells.getByText("Never")).toBeInTheDocument();
    expect(cells.getByRole("button", { name: "Check" })).toBeEnabled();
  });

  it("the guide toggle is a native button with aria-expanded/aria-controls that toggles on click", () => {
    render(<NumberReputation />);
    const toggle = guideToggle();
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(screen.queryByText("Spam Heuristics")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const region = document.getElementById(controls as string);
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByText("Spam Heuristics")).toBeInTheDocument();
    expect(within(region as HTMLElement).getByText("Attestation (SHAKEN/STIR)")).toBeInTheDocument();
    expect(within(region as HTMLElement).getByText("Network Specific Signals")).toBeInTheDocument();
    expect(within(region as HTMLElement).getByText(/is normal \(especially for lower call volumes\)/)).toBeInTheDocument();
    expect(toggle).toHaveTextContent("Hide Guide");
    // The guide is the single reference: each definition appears once.
    expect(screen.getAllByText(/Strongest identity confidence/)).toHaveLength(1);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Spam Heuristics")).toBeNull();
    expect(toggle).toHaveTextContent("Show Guide");
  });

  it("the guide toggle is in the tab order and toggles with Enter and Space", () => {
    render(<NumberReputation />);
    const toggle = guideToggle();
    expect(toggle.tabIndex).toBe(0);
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    pressKey(toggle, "Enter");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Spam Heuristics")).toBeInTheDocument();

    pressKey(toggle, " ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Spam Heuristics")).toBeNull();
  });

  it("empty state keeps its recovery action and the shortened header", () => {
    h.query = { data: [], refetch: () => Promise.resolve(), isLoading: false };
    render(<NumberReputation />);
    expect(screen.getByText("No active numbers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Phone System" })).toBeInTheDocument();
    expect(screen.getByText("These are signals, not guarantees.")).toBeInTheDocument();
    expect(screen.queryByText(/Monitor caller ID health/)).toBeNull();
    expect(screen.queryByText(/AI line monitor/i)).toBeNull();
  });
});
