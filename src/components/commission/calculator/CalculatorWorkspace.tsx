import React from "react";
import { Info } from "lucide-react";
import { calculateEstimate, disclaimerText, resolveLevel } from "@/lib/commission/calculator";
import { validateCalculatorForm } from "@/lib/commission/schemas";
import type { ReadyCalculatorContext } from "@/lib/commission/types";
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Your contract level: <span className="font-semibold text-foreground">{shownLevel}</span>
      </p>
      {level.kind !== "valid" ? (
        <div role="status" className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{level.message}</span>
        </div>
      ) : context.products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your agency&apos;s comp grid has no active products yet. Ask your admin.</p>
      ) : (
        <>
          <CalculatorInputs inputs={inputs} errors={validation.errors ?? {}} />
          <CalculatorResults result={result} />
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {disclaimerText(context.grid.name, context.grid.effectiveDate)}
      </p>
    </div>
  );
};

export default CalculatorWorkspace;
