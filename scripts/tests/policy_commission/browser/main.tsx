import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import CommissionsPage from "../../../../src/pages/CommissionsPage";
import { fixture } from "./fixtures";
import "../../reports-visual/fonts/inter.css";
import "../../../../src/index.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const initial = new URLSearchParams(location.search).get("route") || "/commissions";
export function Probe() {
  Object.assign(fixture, { navigate: useNavigate(), refresh: () => client.invalidateQueries({ queryKey: ["policy-commissions"] }) });
  const where = useLocation();
  return <output className="sr-only" data-testid="location">{where.pathname}{where.search}</output>;
}
Object.assign(window, { commissionFixture: fixture });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}>
    <div className="min-h-screen bg-background">
      <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 hidden h-screen w-60 border-r border-border bg-card md:block" />
      <div aria-hidden="true" className="pointer-events-none fixed left-0 right-0 top-0 h-16 border-b border-border bg-background/95 md:left-60" />
      <main className="pt-16 md:ml-60"><div className="p-4 lg:p-6">
        <Routes><Route path="/commissions/:tab?" element={<CommissionsPage />} /></Routes>
      </div></main><Probe /><Toaster />
    </div>
  </MemoryRouter></QueryClientProvider>,
);
