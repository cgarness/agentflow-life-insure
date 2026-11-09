import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import KpiTile from "../KpiTile";
import { BC4_CASES, env } from "@/lib/__tests__/reportsV3Fixtures";

describe("KpiTile (D6 §4.3)", () => {
  for (const c of BC4_CASES) {
    it(`BC4 case ${c.n}: ${c.scenario}`, () => {
      for (const e of c.envelopes) {
        const want = c.expect[e.id];
        const { container, unmount } = render(<KpiTile id={e.id} envelope={e} />);
        const tile = container.querySelector(`[data-kpi-id="${e.id}"]`)!;
        expect(tile.querySelector("span[aria-hidden='true']")?.textContent).toBe(want.text);
        if (want.cue) expect(tile.textContent).toContain(want.cue === "Not enough data" ? "No eligible data" : want.cue);
        expect(tile.querySelectorAll("button[aria-expanded]")).toHaveLength(want.chips.filter(c => c !== "partial").length);
        expect(tile.textContent).not.toMatch(/^0$/);
        unmount();
      }
    });
  }
  it("never shows a failed panel as 0, and shows a skeleton while loading", () => {
    const { rerender } = render(<KpiTile id={5} envelope={null} />);
    expect(screen.getByLabelText("Calls: not loaded").textContent).toBe("—");
    rerender(<KpiTile id={5} envelope={undefined} />);
    expect(screen.getByLabelText("Calls: loading")).toBeTruthy();
  });
  it("shows the calculated value without a Partial badge and retains source coverage", () => {
    const envelope = env({ id: 9, value: 2.5, status: "partial", reason: "attempt_unverified", numerator: 5, denominator: 2,
      coverage: { eligible: 8, assessable: 5, unassessable: 3, reasons: { attempt_unverified: 3 } } });
    render(<KpiTile id={9} envelope={envelope} />);
    expect(screen.queryByRole("button", { name: "Partial" })).toBeNull();
    expect(screen.getByText("2.5")).toBeTruthy();
    expect(envelope.coverage?.unassessable).toBe(3);
  });
});
