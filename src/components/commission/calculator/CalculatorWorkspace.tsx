import React from "react";
import { BadgeCheck, Info } from "lucide-react";
import { calculateEstimate, resolveLevel } from "@/lib/commission/calculator";
import { validateCalculatorForm } from "@/lib/commission/schemas";
import type { ReadyCalculatorContext } from "@/lib/commission/types";
import { IconTile } from "@/components/commission/ui/CommissionSurface";
import { WhenAmountsShown } from "@/components/commission/ui/AmountsVisibility";
import { HIDDEN_AMOUNT, useAmounts } from "@/components/commission/ui/amountsContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CalculatorInputs from "./CalculatorInputs";
import CalculatorResults from "./CalculatorResults";
import { useCalculatorInputs } from "./useCalculatorInputs";

interface CalculatorWorkspaceProps {
  context: ReadyCalculatorContext;
}

/**
 * The calculator for one ready grid. The estimate is DERIVED on every render from the current inputs, the
 * current grid snapshot and the caller's own level, so a result can never outlive the inputs, grid,
 * profile or organization it was calculated for. The parent remounts this per user, agency and grid.
 */
const CalculatorWorkspace: React.FC<CalculatorWorkspaceProps> = ({ context }) => {
  const level = resolveLevel(context);
  const { hidden } = useAmounts();
  const inputs = useCalculatorInputs(context);
  const validation = validateCalculatorForm(inputs.values, inputs.terms);
  const result =
    level.kind === "valid" && validation.ok
      ? calculateEstimate(context, level.level, {
          productId: validation.productId,
          age: validation.age,
          term: validation.term,
          monthlyPremium: validation.monthlyPremium,
        })
      : null;
  const shownLevel = context.commissionLevel?.trim() || "Not set";
  const usable = level.kind === "valid" && context.products.length > 0;

  return (
    <div className="space-y-5">
      <div className={usable ? "grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" : "max-w-3xl"}>
        <section className="rounded-xl border border-border/60 bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b border-border/50 px-5 py-4">
            <IconTile icon={BadgeCheck} />
            <p className="text-sm text-muted-foreground">
              Your level: <span className="font-semibold tabular-nums text-foreground">{hidden ? HIDDEN_AMOUNT : shownLevel}</span>
            </p>
          </div>
          <div className="p-5">
            {level.kind !== "valid" ? (
              <div role="status" className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-4 py-3 text-sm text-foreground ring-1 ring-inset ring-border/60">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{level.message}</span>
              </div>
            ) : context.products.length === 0 ? (
              <p className="text-sm text-muted-foreground">Your agency&apos;s comp grid has no active products yet. Ask your admin.</p>
            ) : (
              // Inputs (premium included) are entered only with amounts shown; while hidden they stay as typed.
              <WhenAmountsShown><CalculatorInputs inputs={inputs} errors={validation.errors ?? {}} /></WhenAmountsShown>
            )}
          </div>
        </section>
        {usable && (
          <div className="lg:sticky lg:top-6">
            <CalculatorResults result={result} />
          </div>
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        Estimate only
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="About this estimate"
              className="rounded-full p-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Info className="h-3.5 w-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 p-3 text-xs leading-relaxed">
            Assumes a 75% advance. Actual commission and payment timing may vary by age, plan type and carrier rules. Calculator
            results aren&apos;t saved or reported.
          </PopoverContent>
        </Popover>
      </p>
    </div>
  );
};

export default CalculatorWorkspace;
