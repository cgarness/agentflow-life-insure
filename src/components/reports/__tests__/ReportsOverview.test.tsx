import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { emptySummary, premium, reportSummary } from "@/lib/__tests__/reportsFixtures";
import type { LoadState } from "@/hooks/useReportsData";
import type { ReportSummary } from "@/lib/reports-schemas";
import ReportsOverview from "../ReportsOverview";
import ReportsActivityFlow from "../ReportsActivityFlow";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { ReportsQueryError } from "@/lib/reports-queries";

const ready = (data: ReportSummary): LoadState<ReportSummary> => ({ status: "ready", data });

describe("Reports production overview", () => {
  it("preserves cents, known and unknown coverage, and the approved policy/premium basis", () => {
    render(<ReportsOverview summary={ready(reportSummary())} onRetry={vi.fn()} />);
    const policies = within(screen.getByRole("article", { name: "Policies sold" }));
    const amounts = within(screen.getByRole("article", { name: "Known annual premium" }));
    expect(policies.getByText("5")).toBeInTheDocument();
    expect(policies.getByText(/counted on each policy's sale date/)).toBeInTheDocument();
    expect(amounts.getByText("$1,481.40")).toBeInTheDocument();
    expect(amounts.getByText("$123.45")).toBeInTheDocument();
    expect(amounts.getByText("4 of 5 policies have a known premium.")).toBeInTheDocument();
    expect(amounts.getByText(/excluded from amount/).parentElement).toHaveTextContent("1 policy");
    expect(screen.getByText(/current book values, not sale snapshots/)).toBeInTheDocument();
    expect(screen.getByText(/current assigned agent, not the original seller/)).toBeInTheDocument();
  });

  it("renders all-unknown premium as unavailable, even if a zero amount arrives", () => {
    const allUnknown = { ...premium(5, 0), annual_premium: 0, monthly_premium: 0 };
    render(<ReportsOverview summary={ready(reportSummary({ premium: allUnknown }))} onRetry={vi.fn()} />);
    const amounts = within(screen.getByRole("article", { name: "Known annual premium" }));
    expect(amounts.getAllByText("Unavailable")).toHaveLength(2);
    expect(amounts.queryByText("$0.00")).not.toBeInTheDocument();
    expect(amounts.getByText("0 of 5 policies have a known premium.")).toBeInTheDocument();
    expect(amounts.getByText(/excluded from amount/).parentElement).toHaveTextContent("5 policies");
  });

  it("keeps a successful empty period and a known zero distinct from unknown", () => {
    const view = render(<ReportsOverview summary={ready(emptySummary())} onRetry={vi.fn()} />);
    expect(screen.getAllByText("$0.00")).toHaveLength(2);
    expect(screen.getAllByText("No policies sold in this period.")).toHaveLength(2);
    view.rerender(<ReportsOverview summary={ready(reportSummary({ premium: premium(1, 1, 0), policies_sold: 1 }))} onRetry={vi.fn()} />);
    expect(screen.getAllByText("$0.00")).toHaveLength(2);
    expect(screen.getByText("1 of 1 policies have a known premium.")).toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("retains full large amounts and does not invent period comparisons", () => {
    const large = { ...premium(1, 1), annual_premium: 1234567890.12, monthly_premium: 102880657.51 };
    const { container } = render(<ReportsOverview summary={ready(reportSummary({ premium: large }))} onRetry={vi.fn()} />);
    expect(screen.getByText("$1,234,567,890.12")).toBeInTheDocument();
    expect(screen.getByText("$102,880,657.51")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/previous|last period|[0-9]%/i);
  });

  it("withholds previous values during loading and error, and supports retry", () => {
    const retry = vi.fn();
    const view = render(<ReportsOverview summary={ready(reportSummary())} onRetry={retry} />);
    view.rerender(<ReportsOverview summary={{ status: "loading" }} onRetry={retry} />);
    expect(screen.queryByText("$1,481.40")).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-report-state="loading"]')).toBeInTheDocument();
    view.rerender(<ReportsOverview summary={{ status: "error", error: new ReportsQueryError("unavailable") }} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This is not a zero");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("Reports activity and production", () => {
  it("shows independent counts without a fabricated funnel rate or decreasing-stage requirement", () => {
    const { container } = render(<ReportsActivityFlow summary={ready(reportSummary({ calls_made: 1, contacted: 1, appointments_set: 9, converted: 2, policies_sold: 15 }))} onRetry={vi.fn()} />);
    const labels = ["Calls made", "Contacted", "Bookings created", "Converted leads / clients", "Policies sold"];
    expect(Array.from(container.querySelectorAll("dt")).map((node) => node.textContent)).toEqual(labels);
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText(/independent period totals, not one cohort/)).toHaveTextContent("policies use their sale dates");
    expect(screen.getByText(/campaign-lead or call identity/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("%");
  });

  it("keeps the scope visible while methodology opens and closes without changing totals", () => {
    const { container } = render(<ReportsActivityFlow summary={ready(reportSummary())} onRetry={vi.fn()} />);
    const details = container.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    const explanation = screen.getByText(/independent period totals, not one cohort/);
    const counts = Array.from(container.querySelectorAll("dd"), (node) => node.textContent);
    expect(screen.getByText("Independent period totals · Not a conversion funnel")).toBeVisible();
    expect(details).not.toHaveAttribute("open");
    expect(explanation).not.toBeVisible();
    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(explanation).toBeVisible();
    fireEvent.click(summary);
    expect(details).not.toHaveAttribute("open");
    expect(Array.from(container.querySelectorAll("dd"), (node) => node.textContent)).toEqual(counts);
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
