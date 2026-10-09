import { useId } from "react";
import { Progress } from "@/components/ui/progress";
import type { ReportPremium } from "@/lib/reports-schemas";
import { isPartialPremium, premiumCoverageText } from "@/lib/reports-basis-text";

/**
 * Premium coverage under the known annual premium: a decorative meter (absent when nothing is known), then the
 * coverage in words, which is what assistive technology reads. A partial amount leads the line with a "Partial"
 * chip described by that coverage text (C7). Nothing renders for an empty cohort; no percentage ever appears.
 */
export default function PremiumCoverage({ premium }: { premium: ReportPremium }) {
  const id = useId();
  if (premium.policy_count === 0) return null;
  const text = premiumCoverageText(premium);
  return (
    <div className="mt-3 md:mt-4">
      {premium.known_count > 0 && (
        <Progress aria-hidden="true" className="h-1.5 bg-muted" value={(100 * premium.known_count) / premium.policy_count}
          getValueLabel={() => text} />
      )}
      <p className="mt-1.5 text-xs tabular-nums text-muted-foreground md:text-sm">
        {isPartialPremium(premium) && (
          <span aria-describedby={id}
            className="mr-2 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-px text-[11px] font-medium leading-4 text-foreground">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
            Partial
          </span>
        )}
        <span id={id}>{text}</span>
      </p>
    </div>
  );
}
