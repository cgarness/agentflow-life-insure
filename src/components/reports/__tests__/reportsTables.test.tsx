/**
 * Reports tables (U-3, U-11, D-6): one labelled, focusable frame with a pinned first column; production
 * columns first; tfoot rows (one cell per column) instead of paragraphs; screen-only columns; and CSV
 * headers and rows exactly as before.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AgentEfficiency from "../AgentEfficiency";
import AgentPerformanceCards from "../AgentPerformanceCards";
import CampaignPerformance from "../CampaignPerformance";
import LeadSourceTable from "../LeadSourceTable";
import { AGENT_A, CAMPAIGN_1, premium, reportCampaigns, reportLeadSources, reportSummary } from "@/lib/__tests__/reportsFixtures";
import { CAMPAIGN_LINEAGE_NOTE, CAMPAIGN_VISIBILITY_NOTE, CURRENT_ASSIGNMENT_NOTE } from "@/lib/reports-policy-text";
import type { ReportCampaigns, ReportLeadSources } from "@/lib/reports-schemas";

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div className="w-[600px] h-[300px]">{children}</div> };
});

const headers = (table: HTMLElement) => Array.from(table.querySelectorAll("thead th"), (th) => th.textContent ?? "");
/** A row's cell texts keyed by column header; one cell per column (no colSpan) is what makes this mapping valid. */
const cellsByHeader = (table: HTMLElement, row: HTMLElement) => {
  const heads = headers(table);
  expect(row.children).toHaveLength(heads.length);
  for (const cell of Array.from(row.children)) expect(cell).not.toHaveAttribute("colspan");
  return Object.fromEntries(Array.from(row.children, (cell, i) => [heads[i], cell.textContent ?? ""]));
};
const tableIn = (regionName: string) => {
  const region = screen.getByRole("region", { name: regionName });
  const table = region.querySelector(":scope > table") as HTMLElement;
  expect(table).not.toBeNull(); // the table is the region's direct child
  return { region, table };
};

/** The shared frame: labelled, keyboard-focusable scroller; a fade beside (not inside) it; every first cell pinned and opaque. */
function expectFramed(regionName: string) {
  const { region, table } = tableIn(regionName);
  expect(region).toHaveAttribute("tabindex", "0");
  expect(region.className).toMatch(/overflow-x-auto/);
  expect(region.parentElement!.querySelector(":scope > [data-scroll-fade]")).not.toBeNull();
  expect(region.querySelector("[data-scroll-fade]")).toBeNull();
  expect(table.className).toMatch(/border-separate/);
  expect(table.querySelector("caption")?.className).toMatch(/sr-only/);
  const firstCells = Array.from(table.querySelectorAll("tr > :first-child"));
  expect(firstCells.length).toBeGreaterThan(1);
  for (const cell of firstCells) {
    expect(cell.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(cell.className).toMatch(/(^|\s)left-0(\s|$)/);
    expect(cell.className).toMatch(/(^|\s)bg-card(\s|$)/);
  }
  return table;
}

const renderCampaigns = (campaigns: ReportCampaigns, onExport?: () => void) =>
  render(<MemoryRouter><CampaignPerformance campaigns={campaigns} onExport={onExport} /></MemoryRouter>);

describe("Campaign performance", () => {
  it("names each campaign with a real link in a row header, never a tr[role=link]", () => {
    const { container } = renderCampaigns(reportCampaigns());
    const link = screen.getByRole("link", { name: "Spring Team" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", `/campaigns/${CAMPAIGN_1}`);
    expect(link.closest("th")).toHaveAttribute("scope", "row");
    expect(link.className).toMatch(/focus-visible:ring-2/);
    expect(container.querySelector('tr[role="link"], tr[tabindex], tr[onclick]')).toBeNull();
  });

  it("puts production first on screen while the CSV keeps today's column order and rows", () => {
    const onExport = vi.fn();
    renderCampaigns(reportCampaigns(), onExport);
    const table = expectFramed("Campaign performance table");
    expect(headers(table)).toEqual([
      "Campaign", "Policies (campaign-attributed)", "Known annual premium", "Known / total policies", "Calls made",
      "Contacted calls", "Call contact rate", "Leads dialed", "Contacted leads", "Converted leads", "Type",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Export Campaign performance CSV" }));
    expect(onExport).toHaveBeenCalledWith(
      "Campaign Performance",
      ["Campaign", "Type", "Calls made", "Contacted calls", "Call contact rate %", "Leads dialed", "Contacted leads", "Converted leads", "Policies (campaign-attributed)", "Known annual premium", "Known / total policies"],
      [
        ["Spring Team", "Team", 4, 3, 75, 2, 2, 1, 2, 0, "2/2"],
        ["Attribution unavailable", null, 13, null, null, null, null, null, 3, 0, "3/3"],
      ],
    );
  });

  it("the Attribution unavailable tfoot row reconciles the partition; non-applicable cells are blank, never —", () => {
    const campaigns = reportCampaigns();
    campaigns.premium_attribution_unavailable = premium(3, 2, 100);
    renderCampaigns(campaigns);
    const { table } = tableIn("Campaign performance table");
    const row = within(table).getByRole("row", { name: /^Attribution unavailable/ });
    expect(row.parentElement!.tagName).toBe("TFOOT");
    expect(row).toHaveTextContent("Missing, ambiguous or restricted");
    const cells = cellsByHeader(table, row);
    expect(cells).toMatchObject({
      "Policies (campaign-attributed)": "3", "Known annual premium": "$1,200.00", "Known / total policies": "2/3", "Calls made": "13",
      "Contacted calls": "", "Call contact rate": "", "Leads dialed": "", "Contacted leads": "", "Converted leads": "", Type: "",
    });
    const spring = cellsByHeader(table, within(table).getByRole("row", { name: /^Spring Team/ }));
    expect(Number(spring["Policies (campaign-attributed)"]) + Number(cells["Policies (campaign-attributed)"])).toBe(campaigns.policies_in_period);
    expect(screen.queryByText(/have unavailable campaign attribution/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Known annual premium in that subset/)).not.toBeInTheDocument();
  });

  it("shows one note on screen (the lineage contract); visibility and counting rules live in Data basis", () => {
    renderCampaigns(reportCampaigns());
    expect(screen.getByText(CAMPAIGN_LINEAGE_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(CAMPAIGN_VISIBILITY_NOTE.slice(0, 40)))).not.toBeInTheDocument();
    expect(screen.queryByText(/Converted leads are unique campaign leads/)).not.toBeInTheDocument();
  });

  it("captions the chart in sentence case and hides it below sm", () => {
    renderCampaigns(reportCampaigns());
    const caption = screen.getByText("Top 1 by calls made");
    expect(caption.parentElement!.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(caption.parentElement!.className).toMatch(/sm:block/);
    expect(screen.queryByText(/CALLS MADE VS/i)).not.toBeInTheDocument();
  });

  it("with no visible campaign still discloses unavailable attribution in the tfoot", () => {
    const campaigns = { ...reportCampaigns(), campaigns: [] };
    renderCampaigns(campaigns);
    expect(screen.getByText("No visible campaign breakdown in this period.")).toBeInTheDocument();
    const { table } = tableIn("Campaign performance table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(cellsByHeader(table, within(table).getByRole("row", { name: /^Attribution unavailable/ }))["Calls made"]).toBe("13");
  });

  it("has no tfoot when every call and policy has a visible campaign", () => {
    const campaigns: ReportCampaigns = { ...reportCampaigns(), calls_attribution_unavailable: 0, policies_attribution_unavailable: 0, premium_attribution_unavailable: premium(0) };
    renderCampaigns(campaigns);
    expect(tableIn("Campaign performance table").table.querySelector("tfoot")).toBeNull();
  });
});

describe("Lead sources", () => {
  it("hides Converted on screen (the server pins it unavailable) but keeps it in the CSV", () => {
    const onExport = vi.fn();
    const leadSources = reportLeadSources();
    render(<LeadSourceTable leadSources={leadSources} onExport={onExport} />);
    const table = expectFramed("Lead sources table");
    expect(headers(table)).toEqual(["Source", "New leads", "Calls made", "Contacted calls", "Call contact rate", "Leads dialed", "Contacted leads"]);
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
    expect(screen.getByText(`Converted by source isn't available: ${leadSources.converted_unavailable_reason}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export Lead sources CSV" }));
    const [report, csvHeaders, rows] = onExport.mock.calls[0];
    expect(report).toBe("Lead Source Performance");
    expect(csvHeaders).toEqual(["Source", "New leads", "Calls made", "Contacted calls", "Call contact rate %", "Leads dialed", "Contacted leads", "Converted"]);
    expect(rows).toEqual([
      ["Facebook", 2, 6, 3, 50, 2, 2, null],
      ["Referral", 1, 0, 0, null, 0, 0, null],
      ["Attribution unavailable", null, 10, null, null, null, null, null],
    ]);
  });

  it("puts calls with no current lead in a tfoot row, with no rate bar and no ROI line", () => {
    const { container } = render(<LeadSourceTable leadSources={reportLeadSources()} />);
    const { table } = tableIn("Lead sources table");
    const row = within(table).getByRole("row", { name: /^Not linked to a current lead/ });
    expect(row.parentElement!.tagName).toBe("TFOOT");
    expect(cellsByHeader(table, row)).toEqual({
      Source: "Not linked to a current lead", "New leads": "", "Calls made": "10", "Contacted calls": "", "Call contact rate": "",
      "Leads dialed": "", "Contacted leads": "",
    });
    expect(screen.queryByText(/outbound calls are not linked to a current lead/)).not.toBeInTheDocument();
    expect(screen.queryByText("Cost and ROI tracking are not available yet.")).not.toBeInTheDocument();
    expect(container.querySelector("[style]")).toBeNull(); // the decorative rate bar is gone
  });

  it("still discloses unlinked calls when no source has activity (the table renders with only its tfoot)", () => {
    const leadSources: ReportLeadSources = { ...reportLeadSources(), sources: [], unattributed_calls: 5 };
    render(<LeadSourceTable leadSources={leadSources} />);
    expect(screen.getByText("No lead-source activity in this period.")).toBeInTheDocument();
    const { table } = tableIn("Lead sources table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(cellsByHeader(table, within(table).getByRole("row", { name: /^Not linked to a current lead/ }))["Calls made"]).toBe("5");
  });

  it("with no sources and no unlinked calls shows only the empty state", () => {
    render(<LeadSourceTable leadSources={{ ...reportLeadSources(), sources: [], unattributed_calls: 0 }} />);
    expect(screen.getByText("No lead-source activity in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Lead sources table" })).not.toBeInTheDocument();
  });
});

describe("Agent performance", () => {
  it("uses the shared frame, pins the agent column in every row (tfoot too) and drops the methodology paragraph", () => {
    render(<AgentPerformanceCards summary={reportSummary()} selectedAgentId={AGENT_A} selectableAgentIds={new Set([AGENT_A])} onSelectAgent={vi.fn()} />);
    const table = expectFramed("Agent performance table");
    expect(table.querySelector("tfoot tr > :first-child")).toHaveTextContent(/^Unattributed/);
    expect(headers(table)).toContain("Contacted calls");
    expect(screen.queryByText(CURRENT_ASSIGNMENT_NOTE)).not.toBeInTheDocument();
    const selected = screen.getByRole("button", { name: "Clear agent filter for Alice Agent" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(within(selected.closest("th")!).getByText("Selected").className).toMatch(/text-foreground/);
  });
});

describe("Agent efficiency", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Agent efficiency" }));

  it("adds Session-matched calls on screen beside the rate it explains; the CSV is unchanged", () => {
    const onExport = vi.fn();
    const summary = reportSummary();
    summary.by_agent[0].session_matched_calls = 9;
    render(<AgentEfficiency summary={summary} currentUserId={null} onExport={onExport} />);
    open();
    const table = expectFramed("Agent efficiency table");
    expect(headers(table)).toEqual([
      "Agent", "Calls made", "Session time", "Session-matched calls", "Calls per session hour", "Call contact rate", "Talk time",
      "Policies (current assignment)",
    ]);
    const alice = cellsByHeader(table, within(table).getByRole("row", { name: /^Alice Agent/ }));
    // 9 matched calls over 9000 s (2.5 h) = 3.6 calls per session hour.
    expect(alice).toMatchObject({ "Calls made": "10", "Session time": "2h 30m 0s", "Session-matched calls": "9", "Calls per session hour": "3.6", "Talk time": "4m 24s" });
    expect(screen.getByText("Calls per session hour = session-matched calls ÷ session hours.")).toBeInTheDocument();
    expect(screen.queryByText(CURRENT_ASSIGNMENT_NOTE, { exact: false })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export Agent efficiency CSV" }));
    const [report, csvHeaders, rows] = onExport.mock.calls[0];
    expect(report).toBe("Agent Efficiency");
    expect(csvHeaders).toEqual(["Agent", "Calls made", "Session time (s)", "Calls per session hour", "Call contact rate %", "Talk time (s)", "Policies (current assignment)"]);
    expect(rows[0]).toEqual(["Alice Agent", 10, 9000, 3.6, 40, 264, 1]);
  });

  it("an agent with no session time reads —, never 0", () => {
    const summary = reportSummary();
    summary.by_agent[1].session_seconds = 0;
    render(<AgentEfficiency summary={summary} currentUserId={null} />);
    open();
    const { table } = tableIn("Agent efficiency table");
    expect(cellsByHeader(table, within(table).getByRole("row", { name: /^Bob Agent/ }))).toMatchObject({ "Session time": "0s", "Calls per session hour": "—" });
  });
});
