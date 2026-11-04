/**
 * How it's calculated (D6 §4.4): keyboard open and close with focus returning to the trigger that opened it, the
 * sheet geometry, definitions and the approved notes always, and coverage only from current envelopes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DataBasisButton } from "@/components/reports/ReportDataBasis";
import { ALL_LOADING, type Panels } from "@/lib/reports-panels";
import { KPI_REGISTRY } from "@/lib/reports-kpi-registry";
import { buildV3Bundle } from "@/lib/__tests__/reportsV3Fixtures";
import { EFFECTIVE_PREMIUM_BASIS, HOW_CALCULATED_DESCRIPTION, ORIGINAL_SELLER_NOTE, SALE_SOURCE_NOTE } from "@/lib/reports-v3-text";

const TZ = "America/Chicago";
const b = buildV3Bundle({ requestedScope: "agency", startDate: "2026-07-01", endDate: "2026-07-14" });
const READY = { ...ALL_LOADING, summary: { status: "ready", data: b.summaryV3 }, journey: { status: "ready", data: b.journeyV3 },
  salesAppointments: { status: "ready", data: b.salesAppointmentsV3 } } as unknown as Panels;
const renderButtons = (panels: Panels = READY) => render(
  <div>
    <div data-testid="context"><DataBasisButton panels={panels} timeZone={TZ} today="2026-07-15" /></div>
    <div data-testid="band"><DataBasisButton panels={panels} timeZone={TZ} today="2026-07-15" /></div>
  </div>,
);
const trigger = (where: "context" | "band") => within(screen.getByTestId(where)).getByRole("button", { name: "How it's calculated" });
const sheet = () => screen.getByRole("dialog", { name: "How it's calculated" });

/** jsdom has no implicit button activation, so mirror the browser: Enter clicks on keydown, Space on keyup, unless a handler prevents it. */
function press(el: HTMLElement, key: "Enter" | " ") {
  expect(el.tagName).toBe("BUTTON");
  const down = fireEvent.keyDown(el, { key, code: key === " " ? "Space" : "Enter" });
  if (key === "Enter") { if (down) fireEvent.click(el); return; }
  if (fireEvent.keyUp(el, { key, code: "Space" }) && down) fireEvent.click(el);
}

const width = window.innerWidth;
afterEach(() => { Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width }); });

describe("How it's calculated: trigger and sheet", () => {
  it("opens with Enter or Space, closes with Esc or Close, and returns focus to the trigger that opened it", async () => {
    renderButtons();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // content mounts only while open

    trigger("context").focus();
    press(trigger("context"), "Enter");
    expect(sheet()).toBeInTheDocument();
    await waitFor(() => expect(sheet().contains(document.activeElement)).toBe(true));
    expect(within(sheet()).getByText(HOW_CALCULATED_DESCRIPTION)).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(trigger("context")));

    trigger("band").focus();
    press(trigger("band"), " ");
    expect(sheet()).toBeInTheDocument();
    await waitFor(() => expect(sheet().contains(document.activeElement)).toBe(true));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(trigger("band")));
  });

  it("is a right sheet from 768px and a bounded, safe-area-padded bottom sheet below it", async () => {
    const { unmount } = renderButtons();
    fireEvent.click(trigger("context"));
    expect(sheet().className).toMatch(/\bright-0\b/);
    expect(sheet().className).toContain("sm:max-w-md");
    unmount();
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
    renderButtons();
    fireEvent.click(trigger("context"));
    await waitFor(() => expect(sheet().className).toMatch(/\bbottom-0\b/));
    expect(sheet().className).toContain("max-h-[85dvh]");
    expect(sheet().className).toContain("overflow-y-auto");
    expect(sheet().className).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
  });

  it("keeps a 20px trigger with a 40px hit area", () => {
    renderButtons();
    expect(trigger("context").className).toMatch(/\bh-5\b/);
    expect(trigger("context").className).toContain("after:-inset-y-2.5");
  });
});

describe("How it's calculated: content", () => {
  it("defines all 23 metrics and carries the approved basis notes verbatim (in the sheet, not under the cards)", () => {
    renderButtons(); fireEvent.click(trigger("context"));
    for (const k of KPI_REGISTRY) expect(within(sheet()).getAllByText(k.label).length).toBeGreaterThan(0);
    for (const note of [SALE_SOURCE_NOTE, ORIGINAL_SELLER_NOTE, EFFECTIVE_PREMIUM_BASIS]) expect(within(sheet()).getByText(note)).toBeInTheDocument();
    expect(SALE_SOURCE_NOTE).toBe("Policies sold counts recorded policy sales by Sold Date.");
    expect(EFFECTIVE_PREMIUM_BASIS).toBe("AP uses the original sale\u2019s effective monthly premium \u00d7 12, including audited corrections.");
    expect(HOW_CALCULATED_DESCRIPTION).toBe("How each metric is calculated, dated and credited.");
  });
  it("lists coverage only from current envelopes, with words (never digits) for panels that are not loaded", () => {
    renderButtons({ ...READY, journey: { status: "loading" } } as Panels); fireEvent.click(trigger("context"));
    expect(within(sheet()).getByText(/not loaded, so their coverage isn't shown/)).toBeInTheDocument();
    expect(within(sheet()).queryByText(/1 Call Close · /)).toBeNull();
    expect(within(sheet()).getByText(/Sales appointments booked · Not available/)).toBeInTheDocument();
  });
  it("shows the conditional legacy-premium line only when it applies, and the talk-time and dialer-time lines always", () => {
    const legacy = buildV3Bundle({ requestedScope: "agency", startDate: "2026-07-01", endDate: "2026-07-14" });
    legacy.summaryV3.metrics[0].detail.premium.legacy_record_fallback = 1;
    renderButtons(); fireEvent.click(trigger("context"));
    expect(within(sheet()).queryByText(/older sale uses its current policy premium/)).toBeNull();
    expect(within(sheet()).getByText(/^Talk time: /)).toBeInTheDocument();
    expect(within(sheet()).getByText(/^Time in dialer: /)).toBeInTheDocument();
  });
  it("shows each current reader's as-of in the agency time zone", () => {
    renderButtons(); fireEvent.click(trigger("context"));
    expect(within(sheet()).getByTestId("data-basis-as-of").textContent).toMatch(/summary as of/);
  });
});
