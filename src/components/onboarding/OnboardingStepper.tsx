import React from "react";
import { cn } from "@/lib/utils";

interface OnboardingStepperProps {
  /** Zero-based index of the step on screen. */
  current: number;
  /** Third-step label: "Agency" for self-serve founders, "Workspace" for invited agents. */
  finalLabel: string;
}

/**
 * Three-step progress indicator.
 *
 * Meaning never depends on colour: every step carries its number, its label, and
 * visually-hidden state text, and the current step is additionally marked with
 * `aria-current="step"`.
 *
 * Steps already passed are labelled **"visited"**, not "completed", and get no
 * checkmark — nothing is persisted until the final submit, so a completion glyph
 * would claim something untrue.
 */
const OnboardingStepper: React.FC<OnboardingStepperProps> = ({ current, finalLabel }) => {
  const steps = ["Profile", "Licensing", finalLabel];

  return (
    <ol aria-label="Setup progress" className="flex w-full items-start gap-1 sm:gap-2">
      {steps.map((label, index) => {
        const isCurrent = index === current;
        const isVisited = index < current;
        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:flex-row sm:gap-3"
          >
            <span className="flex items-center gap-2 sm:gap-3">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  isCurrent && "border-blue-400 bg-blue-500 text-white",
                  isVisited && "border-blue-400/70 bg-blue-500/15 text-blue-200",
                  !isCurrent && !isVisited && "border-slate-700 bg-slate-800/60 text-slate-500",
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  "truncate text-[11px] sm:text-sm",
                  isCurrent && "font-semibold text-white",
                  isVisited && "font-medium text-slate-200",
                  !isCurrent && !isVisited && "text-slate-500",
                )}
              >
                {label}
                <span className="sr-only">
                  {isCurrent ? " — current step" : isVisited ? " — visited" : " — not started"}
                </span>
              </span>
            </span>
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="hidden h-px flex-1 bg-slate-700/70 sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default OnboardingStepper;
