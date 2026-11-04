import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NumberPurchaseDialog } from "../../../../src/components/settings/phone/NumberPurchaseDialog";
import { Button } from "../../../../src/components/ui/button";
import { org } from "./auth";
import "../../../../src/index.css";

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
createRoot(document.getElementById("root")!).render(<Fixture />);
