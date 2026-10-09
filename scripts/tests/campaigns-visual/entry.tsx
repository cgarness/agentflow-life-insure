import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "../../../src/components/ui/tooltip";
import Campaigns from "../../../src/pages/Campaigns";
import "./stubs";
import "../../../src/index.css";

const params = new URLSearchParams(window.location.search);
if (params.get("theme") !== "light") document.documentElement.classList.add("dark");
const collapsed = params.get("sidebar") === "collapsed";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// Reproduces the app shell's content box: fixed sidebar from md up (w-60, or w-16 collapsed)
// and AppLayout's `p-4 lg:p-6` main padding, so widths match what users actually see.
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <MemoryRouter>
        <div className="min-h-screen bg-background text-foreground">
          <aside data-testid="shell-sidebar" className={`fixed inset-y-0 left-0 hidden border-r border-border bg-card md:block ${collapsed ? "w-16" : "w-60"}`} />
          <main className={`p-4 lg:p-6 ${collapsed ? "md:ml-16" : "md:ml-60"}`}>
            <Campaigns />
          </main>
        </div>
        <Toaster />
      </MemoryRouter>
    </TooltipProvider>
  </QueryClientProvider>,
);
