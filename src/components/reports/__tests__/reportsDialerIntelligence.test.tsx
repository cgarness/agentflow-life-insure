/**
 * Dialer intelligence (U-2, U-4, U-7, D-4): the ranked disposition share list that replaced the donut, the
 * calling heatmap as a semantic table with sr-only cell values, segmented toggles that expose aria-pressed,
 * the Deep Dive repeat-colour treatment (configured colours never recoloured), one-line captions, and the
 * diagnostics default open/closed state. CSV report names, headers and rows are unchanged.
 */
import React from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportsQueryError } from "@/lib/reports-queries";
import type { ReportDispositions } from "@/lib/reports-schemas";
import { reportDispositions, reportSummary, reportVolume } from "@/lib/__tests__/reportsFixtures";
import CallDurationAnalysis from "../CallDurationAnalysis";
import CallFlowAnalysis from "../CallFlowAnalysis";
import CallingHeatmap from "../CallingHeatmap";
import CommunicationsStats from "../CommunicationsStats";
import DispositionDeepDive from "../DispositionDeepDive";
import DispositionsPieChart from "../DispositionsPieChart";
import ReportPanelState from "../ReportPanelState";

type Props = Record<string, unknown>;
const chart = vi.hoisted(() => ({ bars: [] as Props[] }));

// SVG geometry belongs to the browser fixture; here the charts' series props are what matter.
vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Nothing = () => null;
  return {
    ResponsiveContainer: Pass, BarChart: Pass, LineChart: Pass,
    CartesianGrid: Nothing, XAxis: Nothing, YAxis: Nothing, Tooltip: Nothing, Line: Nothing, LabelList: Nothing,
    Bar: (props: Props) => { chart.bars.push(props); return null; },
  };
});

beforeEach(() => { chart.bars = []; });

const titleButton = (name: string) => screen.getByRole("button", { name });
const open = (name: string) => fireEvent.click(titleButton(name));
const pressed = (group: HTMLElement) =>
  within(group).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]);

type DispositionRow = ReportDispositions["by_disposition"][number];
const disposition = (key: string, name: string, calls: number, color = "#3B82F6"): DispositionRow => ({
  key, name, color, calls, avg_duration_seconds: 30, counts_as_contacted: false, converts: false, dnc: false, callback: false, appointment: false,
});

describe("Disposition breakdown: a ranked share list, not a donut (U-2, D-4)", () => {
  it("names every row in text with its count, share and a share bar; the colour is only a swatch", () => {
    const onExport = vi.fn();
    render(<DispositionsPieChart dispositions={reportDispositions()} onExport={onExport} />);
    expect(titleButton("Disposition breakdown")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("6 outbound calls")).toBeInTheDocument(); // header meta
    const list = screen.getByRole("list", { name: "Dispositions by share of outbound calls" });
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Not Interested3 calls50.0% of outbound calls",
      "=Sold Contacted · Converts2 calls33.3% of outbound calls",
      "(No disposition)1 call16.7% of outbound calls",
    ]);
    const bars = items.map((li) => li.querySelector<HTMLElement>('[aria-hidden="true"] > div')!);
    expect(bars.map((bar) => parseFloat(bar.style.width).toFixed(1))).toEqual(["50.0", "33.3", "16.7"]);
    for (const bar of bars) expect(bar.className).toMatch(/bg-primary/); // one accent, never the configured colour
    const swatch = items[0].querySelector<HTMLElement>('span[aria-hidden="true"]')!;
    expect(swatch.style.backgroundColor).toBe("rgb(239, 68, 68)"); // configured #EF4444, unchanged
    expect(swatch.className).toMatch(/\bh-2\b.*\bw-2\b/);
    expect(screen.queryByText(/Top \d+ by calls/)).not.toBeInTheDocument(); // only when grouped
    expect(screen.getByRole("region", { name: "Disposition breakdown" }).querySelector("svg")).toBeNull(); // no donut
    expect(screen.queryByText(/share is of all outbound calls/)).not.toBeInTheDocument(); // footnote moved to Data basis

    fireEvent.click(screen.getByRole("button", { name: "Export Disposition breakdown CSV" }));
    expect(onExport).toHaveBeenCalledWith(
      "Disposition Breakdown",
      ["Disposition", "Calls", "Share %", "Counts as contacted", "Converts", "DNC", "Callback", "Appointment"],
      [
        ["Not Interested", 3, 50, "No", "No", "No", "No", "No"],
        ["=Sold", 2, 33.3, "Yes", "Yes", "No", "No", "No"],
        ["(No disposition)", 1, 16.7, "No", "No", "No", "No", "No"],
      ],
    );
  });

  it("past eight dispositions says Top 8 by calls and keeps the Other row, so the rows add up to the total", () => {
    const rows = Array.from({ length: 10 }, (_, i) => disposition(`d${i}`, `Disposition ${i + 1}`, 10 - i));
    const d: ReportDispositions = { ...reportDispositions(), total_calls: 55, by_disposition: [...rows, disposition("unused", "Unused", 0)] };
    const onExport = vi.fn();
    render(<DispositionsPieChart dispositions={d} onExport={onExport} />);
    expect(screen.getByText("Top 8 by calls")).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "Dispositions by share of outbound calls" })).getAllByRole("listitem");
    expect(items).toHaveLength(9);
    expect(items[8].textContent).toBe("Other 2 more dispositions3 calls5.5% of outbound calls");
    expect(screen.queryByText("Unused")).not.toBeInTheDocument(); // a zero-call disposition has no row on screen…
    fireEvent.click(screen.getByRole("button", { name: "Export Disposition breakdown CSV" }));
    expect(onExport.mock.calls[0][2]).toHaveLength(11); // …but stays in the CSV, as before
  });

  it("with no outbound calls shows the empty state and no header total", () => {
    render(<DispositionsPieChart dispositions={{ ...reportDispositions(), total_calls: 0, by_disposition: [] }} />);
    expect(screen.getByText("No outbound calls in this period.")).toBeInTheDocument();
    expect(screen.queryByText(/outbound calls?$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("Calling heatmap: a semantic table (U-7)", () => {
  it("has hour column headers, pinned day row headers and sr-only values in every cell", () => {
    render(<CallingHeatmap volume={reportVolume()} />);
    const region = screen.getByRole("region", { name: "Calling heatmap table" });
    expect(region).toHaveAttribute("tabindex", "0");
    const table = region.querySelector(":scope > table") as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(table.className).toMatch(/border-spacing-\[3px\]/);
    expect(table.className).not.toMatch(/border-spacing-0/);
    expect(table.querySelector("caption")).toHaveClass("sr-only");
    const hours = Array.from(table.querySelectorAll('thead th[scope="col"]'), (th) => th.querySelector(".sr-only")?.textContent);
    expect(hours).toHaveLength(17); // the day corner + 6 AM … 9 PM
    expect(hours.slice(0, 3)).toEqual(["Day", "6 AM", "7 AM"]);
    expect(hours[16]).toBe("9 PM");
    expect(Array.from(table.querySelectorAll('tbody th[scope="row"]'), (th) => th.textContent)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    for (const cell of Array.from(table.querySelectorAll("tr > :first-child"))) expect(cell.className).toMatch(/(^|\s)sticky left-0 z-10 bg-card(\s|$)/);
    expect(table.querySelectorAll("tbody td")).toHaveLength(7 * 16);
    // sr-only text is absolutely positioned: each cell holding it is positioned, so the text stays inside the
    // scroller rather than widening the page at 390px (measured in Chromium on the synthetic fixture).
    for (const cell of Array.from(table.querySelectorAll("th, td")).filter((c) => c.querySelector(".sr-only"))) {
      expect(cell.className).toMatch(/(^|\s)(relative|sticky)(\s|$)/);
    }

    const busy = screen.getByText("Fri 10 AM: 5 calls made, 1 contacted, 20.0% call contact rate");
    expect(busy).toHaveClass("sr-only");
    const busyCell = busy.closest("td")!;
    expect(busyCell).not.toHaveClass("bg-muted"); // shaded by its data-driven primary intensity instead
    const shown = busyCell.querySelector('[aria-hidden="true"]')!;
    expect(shown.textContent).toBe("5");
    expect(shown.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(shown.className).toMatch(/md:inline/);
    expect(shown.className).toMatch(/text-\[11px\] font-medium/);

    const quiet = screen.getByText("Mon 9 AM: 0 calls made, 0 contacted, no call contact rate").closest("td")!;
    expect(quiet).toHaveClass("bg-muted");
    expect(quiet.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("switches metric with a segmented control whose state is aria-pressed; values stay in the cell text", () => {
    render(<CallingHeatmap volume={reportVolume()} />);
    const group = screen.getByRole("group", { name: "Heatmap metric" });
    expect(pressed(group)).toEqual([["Calls made", "true"], ["Call contact rate", "false"]]);
    fireEvent.click(within(group).getByRole("button", { name: "Call contact rate" }));
    expect(pressed(group)).toEqual([["Calls made", "false"], ["Call contact rate", "true"]]);
    const busy = screen.getByText("Fri 10 AM: 5 calls made, 1 contacted, 20.0% call contact rate").closest("td")!;
    expect(busy.querySelector('[aria-hidden="true"]')!.textContent).toBe("20%");
    expect(screen.getByRole("region", { name: "Calling heatmap table" }).querySelector("caption")!.textContent).toBe("Call contact rate by day and agency hour");
  });

  it("captions the agency time zone, has no Activity badge and keeps the CSV rows", () => {
    const onExport = vi.fn();
    render(<CallingHeatmap volume={reportVolume()} onExport={onExport} />);
    expect(screen.getByText("Agency time (America/Los_Angeles)")).toBeInTheDocument();
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hours are in the agency time zone/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export Calling heatmap CSV" }));
    const [report, headers, rows] = onExport.mock.calls[0];
    expect([report, headers]).toEqual(["Calling Heatmap", ["Day", "Hour", "Calls made", "Contacted"]]);
    expect(rows).toHaveLength(7 * 16);
    expect(rows[0]).toEqual(["Sun", "6 AM", 0, 0]);
    expect(rows).toContainEqual(["Fri", "10 AM", 5, 1]);
  });

  it("widens to all 24 hours when calls fall outside 6 AM–9 PM", () => {
    const volume = reportVolume();
    volume.heatmap = volume.heatmap.map((c) => (c.dow === 2 && c.hour === 23 ? { ...c, calls_made: 1, contacted: 1 } : c));
    render(<CallingHeatmap volume={volume} />);
    const table = screen.getByRole("region", { name: "Calling heatmap table" }).querySelector("table")!;
    expect(table.className).toMatch(/min-w-\[760px\]/);
    expect(table.querySelectorAll("tbody td")).toHaveLength(7 * 24);
    expect(screen.getByText("Tue 11 PM: 1 call made, 1 contacted, 100.0% call contact rate")).toBeInTheDocument();
  });
});

describe("Disposition deep dive", () => {
  it("uses two labelled segmented controls with aria-pressed", () => {
    render(<DispositionDeepDive dispositions={reportDispositions()} />);
    open("Disposition deep dive");
    const by = screen.getByRole("group", { name: "Break down by" });
    const values = screen.getByRole("group", { name: "Show values as" });
    expect(pressed(by)).toEqual([["By agent", "true"], ["By campaign", "false"]]);
    expect(pressed(values)).toEqual([["Count", "true"], ["% of row total", "false"]]);
    fireEvent.click(within(by).getByRole("button", { name: "By campaign" }));
    fireEvent.click(within(values).getByRole("button", { name: "% of row total" }));
    expect(pressed(by)).toEqual([["By agent", "false"], ["By campaign", "true"]]);
    expect(pressed(values)).toEqual([["Count", "false"], ["% of row total", "true"]]);
  });

  it("draws a repeated configured colour lighter with a ringed legend swatch, never recoloured; the legend names every series", () => {
    const d: ReportDispositions = {
      ...reportDispositions(),
      by_disposition: [disposition("a", "Not Interested", 3, "#EF4444"), disposition("b", "Sold", 2, "#22C55E"), disposition("c", "DNC", 1, "#ef4444")],
      by_agent: [{ ...reportDispositions().by_agent[0], counts: { a: 3, b: 2, c: 1 } }],
    };
    render(<DispositionDeepDive dispositions={d} />);
    open("Disposition deep dive");
    const bars = Object.fromEntries(chart.bars.map((b) => [b.name as string, b]));
    expect([bars["Not Interested"].fill, bars["Not Interested"].fillOpacity]).toEqual(["#EF4444", 1]);
    expect([bars.Sold.fill, bars.Sold.fillOpacity]).toEqual(["#22C55E", 1]);
    expect([bars.DNC.fill, bars.DNC.fillOpacity]).toEqual(["#ef4444", 0.55]); // the later repeat, configured colour kept

    const legend = within(screen.getByRole("list", { name: "Dispositions" })).getAllByRole("listitem");
    expect(legend.map((li) => li.textContent)).toEqual(["Not Interested", "Sold", "DNC"]);
    const swatch = (li: HTMLElement) => li.querySelector<HTMLElement>('span[aria-hidden="true"]')!;
    expect(swatch(legend[0]).className).not.toMatch(/ring-1/);
    expect(swatch(legend[2]).className).toMatch(/ring-1 ring-foreground\/40/);
    const fill = swatch(legend[2]).firstElementChild as HTMLElement;
    expect(fill.className).toMatch(/opacity-\[0\.55\]/);
    expect(fill.style.backgroundColor).toBe("rgb(239, 68, 68)");
  });

  it("keeps the CSV report name, headers and rows", () => {
    const onExport = vi.fn();
    render(<DispositionDeepDive dispositions={reportDispositions()} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Disposition deep dive CSV" }));
    expect(onExport).toHaveBeenCalledWith(
      "Disposition Deep Dive - By agent",
      ["Name", "Not Interested", "=Sold", "(No disposition)", "Total"],
      [["Alice Agent", 3, 2, 1, 6]],
    );
  });
});

describe("Call flow and Call duration captions", () => {
  it("Call flow: segmented By hour / By day, sentence-case panel captions and one plain footnote", () => {
    const onExport = vi.fn();
    const { container } = render(<CallFlowAnalysis volume={reportVolume()} onExport={onExport} />);
    open("Call flow");
    const group = screen.getByRole("group", { name: "Call flow view" });
    expect(pressed(group)).toEqual([["By hour", "true"], ["By day", "false"]]);
    expect(screen.getByText("Calls made")).toHaveClass("text-xs", "font-medium", "text-muted-foreground");
    expect(screen.getByText("Call contact rate")).toHaveClass("text-xs", "font-medium", "text-muted-foreground");
    expect(screen.getByText("Hours and days are in the agency time zone; a bucket with no calls shows no call contact rate.")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/uppercase|tracking-widest|font-black/);
    fireEvent.click(within(group).getByRole("button", { name: "By day" }));
    expect(pressed(group)).toEqual([["By hour", "false"], ["By day", "true"]]);
    fireEvent.click(screen.getByRole("button", { name: "Export Call flow CSV" }));
    expect(onExport.mock.calls[0].slice(0, 2)).toEqual(["Call Flow by Day", ["Day", "Calls made", "Contacted", "Call contact rate %"]]);
    expect(onExport.mock.calls[0][2]).toContainEqual(["Fri", 5, 1, 20]);
  });

  it("Call duration: segmented view, plain insight text and the one-line footnote", () => {
    render(<CallDurationAnalysis dispositions={reportDispositions()} />);
    open("Call duration");
    expect(pressed(screen.getByRole("group", { name: "Call duration view" }))).toEqual([["By disposition", "true"], ["Distribution", "false"]]);
    const insight = screen.getByText(/^Calls with a converting disposition averaged/);
    expect(insight.className).toBe("mt-3 text-xs text-muted-foreground"); // no tinted box
    expect(screen.getByText("Stored outbound call durations; estimates and unknown provenance are listed in Data basis.")).toBeInTheDocument();
    expect(screen.getByText("Average duration")).toHaveClass("text-xs", "font-medium");
  });
});

describe("Call summary", () => {
  it("is collapsed by default; the premium tiles left the screen but the CSV rows are unchanged", () => {
    const onExport = vi.fn();
    const summary = reportSummary();
    render(<CommunicationsStats summary={summary} dayCount={31} onExport={onExport} />);
    expect(titleButton("Call summary")).toHaveAttribute("aria-expanded", "false");
    open("Call summary");
    expect(screen.queryByText(/premium/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("term").map((dt) => dt.textContent)).toEqual([
      "Calls made", "Inbound calls", "Contacted calls", "Call contact rate", "Talk time", "Avg talk time per dial", "Calls made per day", "Inbound talk time",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Export Call summary CSV" }));
    const t = summary.totals;
    expect(onExport).toHaveBeenCalledWith("Call Summary", ["Metric", "Value"], [
      ["Known annual premium (current monthly ×12)", t.premium.annual_premium],
      ["Average annual premium per known policy", t.premium.average_annual_premium],
      ["Calls made (outbound)", 19],
      ["Inbound calls", 2],
      ["Contacted", 11],
      ["Call contact rate (%)", 57.9],
      ["Talk time (seconds)", 740],
      ["Avg talk time per dial (seconds)", 38.9],
      ["Calls made per day", 0.6],
      ["Inbound talk time (seconds)", 340],
    ]);
  });
});

describe("diagnostics default open/closed (local, not persisted)", () => {
  it("opens Disposition breakdown and Calling heatmap; collapses Call summary, Call flow, Call duration and Deep dive", () => {
    render(
      <>
        <DispositionsPieChart dispositions={reportDispositions()} />
        <CallingHeatmap volume={reportVolume()} />
        <CommunicationsStats summary={reportSummary()} dayCount={31} />
        <CallFlowAnalysis volume={reportVolume()} />
        <CallDurationAnalysis dispositions={reportDispositions()} />
        <DispositionDeepDive dispositions={reportDispositions()} />
      </>,
    );
    const state = (name: string) => titleButton(name).getAttribute("aria-expanded");
    expect(["Disposition breakdown", "Calling heatmap"].map(state)).toEqual(["true", "true"]);
    expect(["Call summary", "Call flow", "Call duration", "Disposition deep dive"].map(state)).toEqual(["false", "false", "false", "false"]);
  });
});

describe("ReportPanelState", () => {
  it("an error reads as a semibold title, a warning icon and the verbatim not-a-zero copy, with no digits", () => {
    const error = Object.assign(new Error("The report took too long to load."), { kind: "timeout" }) as unknown as ReportsQueryError;
    const onRetry = vi.fn();
    const { container } = render(
      <ReportPanelState title="Calling heatmap" state={{ status: "error", error }} onRetry={onRetry}>{() => <p>never</p>}</ReportPanelState>,
    );
    const notice = container.querySelector('[data-report-state="error"]')!;
    expect(within(notice as HTMLElement).getByRole("heading", { name: "Calling heatmap" }).className).toMatch(/font-semibold/);
    expect(notice.querySelector("h3")!.className).not.toMatch(/font-bold/);
    expect(notice.querySelector("svg")!.getAttribute("class")).toMatch(/text-warning/);
    expect(notice.innerHTML).not.toMatch(/amber/);
    expect(screen.getByText("Couldn't load calling heatmap.")).toBeInTheDocument();
    expect(screen.getByText("The report took too long to load. This is not a zero — the numbers are unknown until it loads.")).toBeInTheDocument();
    expect(notice.textContent).not.toMatch(/\d/);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("Reports captions", () => {
  it("no Reports surface uses 9-10px text, font-black or uppercase tracking captions", () => {
    const dir = join(process.cwd(), "src/components/reports");
    // The two unmounted legacy files are excluded (reportsContracts pins that Reports never mounts them).
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !["CustomReportBuilder.tsx", "ScheduledReportsModal.tsx"].includes(f));
    expect(files.length).toBeGreaterThan(30);
    for (const f of files) {
      const code = readFileSync(join(dir, f), "utf8");
      expect(code, f).not.toMatch(/text-\[(9|10)px\]|font-black|\buppercase\b|tracking-widest|tracking-wider|tracking-tighter/);
    }
  });
});
