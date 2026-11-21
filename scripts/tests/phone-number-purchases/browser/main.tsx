import React, { lazy, Suspense, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../../../src/components/ui/tooltip";
import type { PhoneNumberRow } from "../../../../src/components/settings/phone/NumberManagementSection";
import { createRoot } from "react-dom/client";
import { NumberPurchaseDialog } from "../../../../src/components/settings/phone/NumberPurchaseDialog";
import { Button } from "../../../../src/components/ui/button";
import { org } from "./auth";
import "../../../../src/index.css";

const NumberManagement = lazy(() => import("../../../../src/components/settings/phone/NumberManagementSection")
  .then(module => ({ default: module.NumberManagementSection })));
const queryClient = new QueryClient();

function SetupFixture() {
  const [organization, setOrganization] = useState(org);
  const [rows, setRows] = useState<PhoneNumberRow[]>([{
    id: "22222222-2222-4222-8222-222222222222", status: "active", assigned_to: null,
    assignment_type: "agency", phone_number: "+12135550100", area_code: "213", friendly_name: "Agency line",
    is_default: false, spam_status: null, spam_score: null, spam_checked_at: null,
  }]);
  return <QueryClientProvider client={queryClient}><TooltipProvider>
    <Button onClick={() => setOrganization("33333333-3333-4333-8333-333333333333")}>Switch fixture agency</Button>
    <Suspense fallback={null}><NumberManagement organizationId={organization} numbers={rows} setNumbers={setRows}
      agents={[]} groups={[]} groupMembers={[]} onRefresh={async () => {}} /></Suspense>
  </TooltipProvider></QueryClientProvider>;
}

function Fixture() {
  const [open, setOpen] = useState(true);
  const [completed, setCompleted] = useState<string[]>([]);
  return <main className="space-y-4 p-6">
    <h1 className="text-xl font-semibold">Phone Numbers</h1>
    <p className="text-sm text-muted-foreground">Synthetic browser verification. All requests stay in this fixture.</p>
    <Button onClick={() => setOpen(true)}>Purchase number</Button>
    <p data-testid="completed">{completed.join(", ")}</p>
    <NumberPurchaseDialog open={open} organizationId={org} onOpenChange={setOpen}
      onCompleted={async (numbers) => setCompleted((current) => [...new Set([...current, ...numbers])])} />
  </main>;
}
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).get("scenario") === "setup" ? <SetupFixture /> : <Fixture />,
);
