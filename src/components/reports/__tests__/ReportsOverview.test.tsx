import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AGENT_A, AGENT_B, emptySummary, policyQuality, premium, reportSummary } from "@/lib/__tests__/reportsFixtures";
import type { LoadState } from "@/hooks/useReportsData";
import type { ReportSummary } from "@/lib/reports-schemas";
import { PERIOD_TOTALS_LINE, PRODUCTION_BASIS_BAR, PRODUCTION_BASIS_BAR_SHORT } from "@/lib/reports-basis-text";
import ReportsOverview from "../ReportsOverview";
import ReportsActivityFlow from "../ReportsActivityFlow";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { ReportsQueryError } from "@/lib/reports-queries";

const ready = (data: ReportSummary): LoadState<ReportSummary> => ({ status: "ready", data });
const band = () => screen.getByRole("region", { name: "Production overview" });
const policiesCell = () => within(screen.getByRole("article", { name: "Policies sold" }));
const premiumCell = () => within(screen.getByRole("article", { name: "Known annual premium" }));
const meter = (container: HTMLElement) => container.querySelector('[role="progressbar"]');
type AgentRow = ReportSummary["by_agent"][number];
const agents = (...counts: [string, number][]): AgentRow[] => counts.map(([name, n], i) => ({ ...reportSummary().by_agent[i % 2], agent_id: i % 2 ? AGENT_B : AGENT_A, name, policies_sold: n }));

describe("Reports production band", () => {
  it("preserves cents and shows coverage in words with a meter and a Partial chip (no percentage)", () => {
    const { container } = render(<ReportsOverview summary={ready(reportSummary())} onRetry={vi.fn()} />);
    expect(policiesCell().getByText("5")).toHaveAttribute("data-report-value", "hero");
    expect(policiesCell().getByText("Primary + additional policies")).toBeInTheDocument();
    const value = premiumCell().getByText("$1,481.40");
    expect(value.tagName).toBe("P"); // the money-clipping guard scans leaf <p> values
    expect(value).toHaveAttribute("data-report-value", "hero");
    const coverage = premiumCell().getByText("4 of 5 premiums known · 1 unknown excluded");
    const chip = premiumCell().getByText("Partial");
    expect(chip).toHaveAttribute("aria-describedby", coverage.id);
    expect(meter(container)).not.toBeNull();
    expect(meter(container)!.closest('[aria-hidden="true"]')).not.toBeNull(); // decorative; the words are read
    expect(premiumCell().getByText("Known monthly").parentElement).toHaveTextContent("$123.45");
    expect(premiumCell().getByText("Avg per known policy").closest("div")).toHaveTextContent("$370.35");
    expect(premiumCell().getByText("Avg / known policy")).toBeInTheDocument(); // the phone label
    expect(screen.getByText(PRODUCTION_BASIS_BAR)).toBeInTheDocument();
    expect(screen.getByText(PRODUCTION_BASIS_BAR_SHORT)).toBeInTheDocument();
    expect(band().textContent).not.toMatch(/%/);
    expect(container.querySelector("svg.lucide-shield-check, svg.lucide-circle-dollar-sign")).toBeNull(); // no hero icons
    expect(screen.queryByText(/excluded from amount|have a known premium/)).not.toBeInTheDocument();
  });

  it("renders all-unknown premium as unavailable, even if a zero amount arrives, with no meter or chip", () => {
    const allUnknown = { ...premium(5, 0), annual_premium: 0, monthly_premium: 0, average_annual_premium: 0 };
    const { container } = render(<ReportsOverview summary={ready(reportSummary({ premium: allUnknown }))} onRetry={vi.fn()} />);
    expect(premiumCell().getAllByText("Unavailable")).toHaveLength(2); // annual + known monthly
    expect(premiumCell().queryByText("$0.00")).not.toBeInTheDocument();
    expect(premiumCell().getByText("0 of 5 premiums known · 5 unknown excluded")).toBeInTheDocument();
    expect(premiumCell().getByText("Avg per known policy").closest("div")).toHaveTextContent("—"); // zero denominator
    expect(meter(container)).toBeNull();
    expect(premiumCell().queryByText("Partial")).not.toBeInTheDocument();
  });

  it("keeps a successful empty period and a known zero distinct from unknown", () => {
    const view = render(<ReportsOverview summary={ready(emptySummary())} onRetry={vi.fn()} />);
    expect(screen.getAllByText("$0.00")).toHaveLength(2); // annual + monthly; the average has no denominator
    expect(premiumCell().getByText("Avg per known policy").closest("div")).toHaveTextContent("—");
    expect(screen.getAllByText("No policies sold in this period.")).toHaveLength(1);
    expect(meter(view.container)).toBeNull();
    expect(screen.queryByText(/premiums? known/)).not.toBeInTheDocument();
    view.rerender(<ReportsOverview summary={ready(reportSummary({ premium: premium(1, 1, 0), policies_sold: 1 }))} onRetry={vi.fn()} />);
    expect(screen.getAllByText("$0.00")).toHaveLength(3); // a known zero: annual, monthly and average
    expect(screen.getByText("1 of 1 premium known")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Partial")).not.toBeInTheDocument();
    expect(meter(view.container)).not.toBeNull();
  });

  it("stacks a long premium instead of shrinking it and does not invent period comparisons", () => {
    const large = { ...premium(1, 1), annual_premium: 1234567890.12, monthly_premium: 102880657.51, average_annual_premium: 1234567890.12 };
    const view = render(<ReportsOverview summary={ready(reportSummary({ premium: large }))} onRetry={vi.fn()} />);
    expect(premiumCell().getByText("$1,234,567,890.12", { selector: "[data-report-value]" })).toBeInTheDocument();
    expect(screen.getByText("$102,880,657.51")).toBeInTheDocument();
    expect(view.container.querySelector("[data-hero-layout]")).toHaveAttribute("data-hero-layout", "stacked");
    expect(view.container.textContent).not.toMatch(/previous|last period|[0-9]%/i);
    view.rerender(<ReportsOverview summary={ready(reportSummary())} onRetry={vi.fn()} />);
    expect(view.container.querySelector("[data-hero-layout]")).toHaveAttribute("data-hero-layout", "split"); // "$1,481.40"
  });

  it("withholds previous values during loading and error, and supports retry", () => {
    const retry = vi.fn();
    const view = render(<ReportsOverview summary={ready(reportSummary())} onRetry={retry} />);
    view.rerender(<ReportsOverview summary={{ status: "loading" }} onRetry={retry} />);
    expect(screen.queryByText("$1,481.40")).not.toBeInTheDocument();
    expect(screen.queryByText("Most policies — current assignments")).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-report-state="loading"]')).toBeInTheDocument();
    view.rerender(<ReportsOverview summary={{ status: "error", error: new ReportsQueryError("unavailable") }} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This is not a zero");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(band().textContent).not.toMatch(/\d/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows the scope-wide policy quality note verbatim, with a caution icon, only when there is one", () => {
    const view = render(<ReportsOverview summary={ready(reportSummary())} onRetry={vi.fn()} />);
    expect(screen.queryByText(/Data quality across this scope/)).not.toBeInTheDocument();
    view.rerender(<ReportsOverview summary={ready({ ...reportSummary(), policy_quality: policyQuality(2, 1) })} onRetry={vi.fn()} />);
    const note = within(band()).getByText("Data quality across this scope, all dates (not only this period): 2 policies have no usable sale date and are not counted in any period; 1 additional-policy record could not be read.");
    expect(note.parentElement!.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("Most policies — current assignments (from the same summary)", () => {
  const leaderRow = () => within(band()).getByText("Most policies — current assignments").parentElement!;

  it("names the agent with the most policies by current assignment", () => {
    render(<ReportsOverview summary={ready(reportSummary())} onRetry={vi.fn()} />);
    expect(leaderRow()).toHaveTextContent("Bob Agent · 2 policies");
    expect(within(band()).getAllByText("Most policies — current assignments")).toHaveLength(1);
  });

  it.each([
    ["one policy", agents(["Alice Agent", 1], ["Bob Agent", 0]), "Alice Agent · 1 policy"],
    ["a tie on the top count", agents(["Bob Agent", 3], ["Alice Agent", 3]), "2 agents tied · 3 policies each"],
    ["a tie on one policy", agents(["Bob Agent", 1], ["Alice Agent", 1]), "2 agents tied · 1 policy each"],
    ["a tie below the leader", agents(["Bob Agent", 1], ["Alice Agent", 4], ["Cara Agent", 1]), "Alice Agent · 4 policies"],
  ])("%s", (_label, byAgent, text) => {
    render(<ReportsOverview summary={ready(reportSummary({}, byAgent))} onRetry={vi.fn()} />);
    expect(leaderRow()).toHaveTextContent(text);
    expect(leaderRow().querySelector("dd")!.textContent).toBe(text);
  });

  it("is absent when no agent has a policy, and in personal scope", () => {
    const view = render(<ReportsOverview summary={ready(reportSummary({}, agents(["Alice Agent", 0], ["Bob Agent", 0])))} onRetry={vi.fn()} />);
    expect(screen.queryByText("Most policies — current assignments")).not.toBeInTheDocument();
    view.rerender(<ReportsOverview summary={ready({ ...reportSummary(), scope: "own", requested_scope: "personal" })} onRetry={vi.fn()} />);
    expect(screen.queryByText("Most policies — current assignments")).not.toBeInTheDocument();
    expect(screen.queryByText(/Bob Agent/)).not.toBeInTheDocument();
  });
});

describe("Period totals", () => {
  it("shows five independent totals with their date basis, no arrows and no funnel rate", () => {
    const { container } = render(<ReportsActivityFlow summary={ready(reportSummary({ calls_made: 1, contacted: 1, appointments_set: 9, converted: 2, policies_sold: 15 }))} onRetry={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Period totals" });
    expect(section).toHaveAttribute("aria-labelledby", "report-totals-title");
    const labels = ["Calls made", "Contacted calls", "Bookings created (all types)", "Converted leads/clients", "Policies sold"];
    expect(Array.from(container.querySelectorAll("dt")).map((node) => node.textContent)).toEqual(labels);
    expect(Array.from(container.querySelectorAll("dt + dd")).map((node) => node.textContent)).toEqual(["1", "1", "9", "2", "15"]);
    expect(Array.from(container.querySelectorAll("dd + dd")).map((node) => node.textContent))
      .toEqual(["by call date", "by call date", "by date created", "distinct people · by call date", "by sale date"]);
    expect(screen.getByText(PERIOD_TOTALS_LINE)).toBeInTheDocument();
    expect(screen.queryByText(/moving through a funnel/)).not.toBeInTheDocument(); // the full statement is in Data basis
    expect(container.querySelector("svg")).toBeNull(); // no ArrowRight between independent totals
    expect(container.textContent).not.toContain("%");
  });

  it("shows successful zeros but removes them when access is denied", () => {
    const view = render(<ReportsActivityFlow summary={ready(emptySummary())} onRetry={vi.fn()} />);
    expect(screen.getAllByText("0")).toHaveLength(5);
    view.rerender(<ReportsActivityFlow summary={{ status: "error", error: new ReportsQueryError("denied") }} onRetry={vi.fn()} />);
    expect(screen.getByText("You don't have access to this report.")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
