import React, { useState } from "react";
import { Calculator } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useCommissionGridMutations } from "@/hooks/useCommissionGridsAdmin";
import type { AdminOverview } from "@/lib/commission/adminTypes";
import ConfirmActionDialog, { type PendingConfirmation } from "./ConfirmActionDialog";
import { errorMessage } from "./gridFormat";

const NONE = "__none__";

interface CalculatorGridCardProps {
  overview: AdminOverview;
}

/**
 * The agency's calculator grid: active private grids plus enabled active shared grids. Compare-and-set
 * against the selection this admin saw, so two admins never silently overwrite each other; every change
 * is confirmed because agents' estimates change immediately.
 */
const CalculatorGridCard: React.FC<CalculatorGridCardProps> = ({ overview }) => {
  const { select } = useCommissionGridMutations();
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const eligible = overview.grids.filter((grid) => grid.isActive);
  const current = overview.grids.find((grid) => grid.id === overview.calculatorGridId) ?? null;

  const choose = (value: string) => {
    const gridId = value === NONE ? null : value;
    if (gridId === overview.calculatorGridId) return;
    const target = eligible.find((grid) => grid.id === gridId);
    setConfirmation({
      title: target ? `Use ${target.name} for the calculator?` : "Turn the calculator off?",
      description: target
        ? "Agents will estimate from this grid right away."
        : "Agents won't see the Commission Calculator until you choose a grid again.",
      confirmLabel: target ? "Use this grid" : "Turn off",
      destructive: !target,
      onConfirm: () =>
        select.mutate(
          { gridId, expectedCurrent: overview.calculatorGridId },
          {
            onSuccess: () => toast({ title: target ? "Calculator grid updated" : "Calculator turned off" }),
            onError: (error) => toast({ title: "Calculator grid not changed", description: errorMessage(error), variant: "destructive" }),
          },
        ),
    });
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">Calculator grid</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {current
          ? "Agents estimate first-year commission from this grid and their own contract level."
          : "No grid is selected, so agents don't see the Commission Calculator."}
      </p>
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="calculator-grid">Grid used by the calculator</Label>
        <Select value={overview.calculatorGridId ?? NONE} onValueChange={choose} disabled={select.isPending}>
          <SelectTrigger id="calculator-grid" aria-label="Grid used by the calculator">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None — calculator off</SelectItem>
            {eligible.map((grid) => (
              <SelectItem key={grid.id} value={grid.id}>
                {grid.name}
                {grid.shared ? " (AgentFlow)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ConfirmActionDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </section>
  );
};

export default CalculatorGridCard;
