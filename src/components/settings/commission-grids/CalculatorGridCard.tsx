import React, { useState } from "react";
import { Calculator } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { IconTile, StatusPill } from "@/components/commission/ui/CommissionSurface";
import { cn } from "@/lib/utils";
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
    <section
      className={cn(
        "rounded-xl border p-4 shadow-sm transition-colors sm:p-5",
        current ? "border-primary/25 bg-primary/[0.03]" : "border-border/60 bg-card",
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={Calculator} tone={current ? "primary" : "muted"} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Calculator grid</h2>
              {current ? <StatusPill tone="success">Live</StatusPill> : <StatusPill tone="muted">Off</StatusPill>}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {current
                ? "Agents estimate first-year commission from this grid and their own contract level."
                : "No grid is selected, so agents don't see the Commission Calculator."}
            </p>
          </div>
        </div>
        <div className="w-full space-y-1.5 md:w-80 md:shrink-0">
          <Label htmlFor="calculator-grid" className="text-xs text-muted-foreground">Grid used by the calculator</Label>
          <Select value={overview.calculatorGridId ?? NONE} onValueChange={choose} disabled={select.isPending}>
            <SelectTrigger id="calculator-grid" aria-label="Grid used by the calculator" className="bg-background">
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
      </div>
      <ConfirmActionDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </section>
  );
};

export default CalculatorGridCard;
