import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import Reports from "../../../src/pages/Reports";
import { buildReportCsv, downloadCsv } from "../../../src/lib/reports-export";
import { fixture } from "./stubs";
import "../../../src/index.css";

Object.assign(window, { reportsFixture: {
  ...fixture,
  // Separate adversarial CSV example; does not alter the SQL-backed report payload or its metadata.
  downloadFormulaExample: () => downloadCsv("fixture-formula-safety.csv", buildReportCsv({
    report: "Synthetic formula safety example", scope: "organization", agentLabel: "All agents",
    window: fixture.payloads.summary.window,
  }, ["Synthetic text", "Unknown", "Exact number"], [["=1+1", null, 10.01]])),
} });

createRoot(document.getElementById("root")!).render(
  <MemoryRouter><main className="p-3 md:p-6"><Reports /></main><Toaster /></MemoryRouter>,
);
