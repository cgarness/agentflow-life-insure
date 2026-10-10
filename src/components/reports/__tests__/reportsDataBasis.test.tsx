/**
 * Data basis disclosure (plan §5.9): keyboard open and close with focus returning to the trigger that opened
 * it, the methodology verbatim from the shared constants, live data quality only for a ready summary, and
 * loading / unavailable states that say so in words without a single digit.
 */
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DataBasisButton } from "@/components/reports/ReportDataBasis";
import type { LiveSummary } from "@/components/reports/ReportDataQuality";
import { CAMPAIGN_ATTRIBUTION_NOTE, CURRENT_ASSIGNMENT_NOTE, POLICY_SOURCE_NOTE } from "@/lib/reports-policy-text";
import { PREMIUM_BASIS, integrityExportNotes } from "@/lib/reports-integrity-text";
import {
  DATA_QUALITY_LOADING, DATA_QUALITY_UNAVAILABLE, INDEPENDENT_PANELS_NOTE, PERIOD_TOTALS_NOTE, dataBasisSections, liveQualityNotes, timeZoneNote,
} from "@/lib/reports-basis-text";
import { AS_OF, policyQuality, reportSummary } from "@/lib/__tests__/reportsFixtures";

const TZ = "America/Los_Angeles";
const REASON = "Conversion removes the source lead and clients carry no lead source, so conversions cannot be attributed to a lead source.";
const READY: LiveSummary = { status: "ready", data: { ...reportSummary(), policy_quality: policyQuality(2, 1) } };

const renderButtons = (summary: LiveSummary = READY, convertedReason: string | null = REASON) => render(
  <div>
    <div data-testid="context"><DataBasisButton summary={summary} timeZone={TZ} today="2026-07-20" convertedReason={convertedReason} /></div>
    <div data-testid="band"><DataBasisButton summary={summary} timeZone={TZ} today="2026-07-20" convertedReason={convertedReason} /></div>
  </div>,
);
const trigger = (where: "context" | "band") => within(screen.getByTestId(where)).getByRole("button", { name: "Data basis" });
const sheet = () => screen.getByRole("dialog", { name: "Data basis" });
const region = (name: string) => within(sheet()).getByRole("region", { name });

/** jsdom has no implicit button activation, so mirror the browser: Enter clicks on keydown, Space on keyup, unless a handler prevents it. */
function press(el: HTMLElement, key: "Enter" | " ") {
  expect(el.tagName).toBe("BUTTON");
  const down = fireEvent.keyDown(el, { key, code: key === " " ? "Space" : "Enter" });
  if (key === "Enter") { if (down) fireEvent.click(el); return; }
  if (fireEvent.keyUp(el, { key, code: "Space" }) && down) fireEvent.click(el);
}

const width = window.innerWidth;
afterEach(() => { Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width }); });

describe("Data basis trigger and sheet", () => {
  it("opens with Enter or Space, closes with Esc or Close, and returns focus to the trigger that opened it", async () => {
    renderButtons();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // content mounts only while open

    trigger("context").focus();
    press(trigger("context"), "Enter");
    expect(sheet()).toBeInTheDocument();
    await waitFor(() => expect(sheet().contains(document.activeElement)).toBe(true));
    expect(within(sheet()).getByText("How Reports counts and credits these numbers.")).toBeInTheDocument();
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

describe("Data basis wording", () => {
  it("shows every static section and sentence verbatim from the shared constants", () => {
    renderButtons();
    fireEvent.click(trigger("context"));
    for (const section of dataBasisSections(REASON)) {
      const body = region(section.title);
      expect(within(body).getByRole("heading", { level: 3, name: section.title })).toBeInTheDocument();
      for (const p of section.paragraphs) expect(within(body).getByText(p)).toBeInTheDocument();
    }
    for (const text of [POLICY_SOURCE_NOTE, CURRENT_ASSIGNMENT_NOTE, CAMPAIGN_ATTRIBUTION_NOTE, PREMIUM_BASIS, PERIOD_TOTALS_NOTE, timeZoneNote(TZ), INDEPENDENT_PANELS_NOTE]) {
      expect(within(sheet()).getByText(text)).toBeInTheDocument();
    }
    expect(within(sheet()).getByText(`Converted by source isn't available: ${REASON}`)).toBeInTheDocument();
    const text = sheet().textContent ?? "";
    expect(text).not.toMatch(/(?<!call )contact rate/i);
    for (const m of text.matchAll(/conversion[\s-]+rate/gi)) expect(text.slice(Math.max(0, (m.index ?? 0) - 18), m.index).toLowerCase()).toMatch(/(^|\s)no (stage-to-stage )?$/);
  });

  it("omits the lead-source reason when that payload is not current", () => {
    renderButtons(READY, null);
    fireEvent.click(trigger("context"));
    expect(within(sheet()).queryByText(/Converted by source/)).not.toBeInTheDocument();
    expect(within(sheet()).getByText("Cost and ROI tracking are not available yet.")).toBeInTheDocument();
  });
});

describe("live data quality", () => {
  it("a ready summary lists the summary CSV's own sentences and its as-of time", () => {
    renderButtons();
    fireEvent.click(trigger("context"));
    const items = within(region("Data quality in this summary")).getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(liveQualityNotes((READY as Extract<LiveSummary, { status: "ready" }>).data));
    const csv = integrityExportNotes(reportSummary());
    expect(items).toContain(csv.find((n) => n.startsWith("Session rate cohort:")));
    expect(items).toContain("Data quality across this scope, all dates (not only this period): 2 policies have no usable sale date and are not counted in any period; 1 additional-policy record could not be read.");
    const freshness = region("Time zone and freshness");
    const time = freshness.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe(AS_OF);
    expect(time.textContent).toBe("11:00 AM PDT");
    expect(freshness.textContent).toContain("Summary as of 11:00 AM PDT");
  });

  it.each([
    ["loading", { status: "loading" } as LiveSummary, DATA_QUALITY_LOADING],
    ["unavailable", { status: "unavailable" } as LiveSummary, DATA_QUALITY_UNAVAILABLE],
  ])("a %s summary says so in words: no digits, no zero, no as-of", (_label, summary, message) => {
    renderButtons(summary);
    fireEvent.click(trigger("context"));
    const quality = region("Data quality in this summary");
    expect(within(quality).getByText(message)).toBeInTheDocument();
    expect(within(quality).queryByRole("listitem")).not.toBeInTheDocument();
    expect(quality.textContent).not.toMatch(/\d/);
    const freshness = region("Time zone and freshness");
    expect(freshness.textContent).not.toMatch(/\d/);
    expect(freshness.textContent).not.toMatch(/Summary as of/);
    expect(sheet().querySelector("time")).toBeNull();
    expect(sheet().textContent).not.toMatch(/\$0\.00|Session rate cohort|Sessions assessed/);
  });
});
