import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CarriersPage from "../../../../src/pages/CarriersPage";
import Carriers from "../../../../src/components/settings/Carriers";
import { Toaster } from "../../../../src/components/ui/toaster";
import { fixtureClient } from "./client";
import { identities, setFixtureIdentity } from "./auth";
import "../../../../src/index.css";

declare global { interface Window { carrierFixture: typeof fixtureClient & { identities: typeof identities; setIdentity: typeof setFixtureIdentity } } }
window.carrierFixture = { ...fixtureClient, identities, setIdentity: setFixtureIdentity };
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).get("theme") === "dark");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export function Fixture() {
  return <QueryClientProvider client={queryClient}><BrowserRouter>
    <div className="min-h-screen bg-background text-foreground">
      <nav aria-label="Verification navigation" className="flex flex-wrap items-center gap-4 border-b p-4 text-sm">
        <span className="text-muted-foreground">Synthetic carrier verification</span>
        <Link className="text-primary underline" to="/carriers">Directory</Link>
        <Link className="text-primary underline" to="/settings?section=carriers">Settings</Link>
      </nav>
      <main className="p-4 lg:p-6">
        <Routes>
          <Route path="/settings" element={<section className="mx-auto max-w-5xl"><h1 className="mb-4 text-2xl font-semibold">Carrier settings</h1><Carriers /></section>} />
          <Route path="*" element={<CarriersPage />} />
        </Routes>
      </main>
    </div><Toaster />
  </BrowserRouter></QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
