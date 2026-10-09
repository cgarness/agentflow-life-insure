import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import Reports from "../../../src/pages/Reports";
import { buildReportCsv, downloadCsv } from "../../../src/lib/reports-export";
import { fixture } from "./stubs";
import "./fonts/inter.css";
import "../../../src/index.css";

Object.assign(window, { reportsFixture: {
  ...fixture,
  // Separate adversarial CSV example; does not alter the SQL-backed report payload or its metadata.
  downloadFormulaExample: () => downloadCsv("fixture-formula-safety.csv", buildReportCsv({
    report: "Synthetic formula safety example", scope: "organization", agentLabel: "All agents",
    window: fixture.payloads.summary.window,
  }, ["Synthetic text", "Unknown", "Exact number"], [["=1+1", null, 10.01]])),
} });

// Geometry-only stand-ins for the app chrome (AppLayout: fixed 64px TopBar, 240px Sidebar from md, p-4 lg:p-6),
// so first-screen budgets and table widths are measured in the production frame. They carry no text and no
// h1 (CI checks the first h1 is "Reports") and ignore the pointer, so they never intercept a click.
createRoot(document.getElementById("root")!).render(
  <MemoryRouter>
    <div className="min-h-screen bg-background">
      <div aria-hidden="true" data-fixture-chrome="sidebar"
        className="pointer-events-none fixed left-0 top-0 z-50 hidden h-screen w-60 border-r border-border bg-card md:block" />
      <div aria-hidden="true" data-fixture-chrome="topbar"
        className="pointer-events-none fixed left-0 right-0 top-0 z-50 h-16 border-b border-border bg-background/95 md:left-60" />
      <main className="pt-16 md:ml-60">
        <div className="p-4 lg:p-6"><Reports /></div>
      </main>
    </div>
    <Toaster />
  </MemoryRouter>,
);
