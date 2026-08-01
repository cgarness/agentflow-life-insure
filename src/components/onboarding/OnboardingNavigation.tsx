import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ONBOARDING_PRIMARY_BUTTON_CLASS,
  ONBOARDING_SECONDARY_BUTTON_CLASS,
} from "@/components/onboarding/onboardingTheme";

interface OnboardingNavigationProps {
  /** Disables Back on the first step. */
  canGoBack: boolean;
  /** Completion in flight — locks both actions so the wizard cannot submit twice. */
  saving: boolean;
  primaryLabel: string;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Navigation footer, integrated into the card rather than a detached page footer.
 *
 * The spinner stays animated under `prefers-reduced-motion` because it is
 * essential status feedback (WCAG 2.2 SC 2.3.3 exempts essential animation) and
 * it is always paired with text.
 */
const OnboardingNavigation: React.FC<OnboardingNavigationProps> = ({
  canGoBack,
  saving,
  primaryLabel,
  onBack,
  onNext,
}) => (
  <div className="mt-8 border-t border-slate-700/50 pt-5">
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={!canGoBack || saving}
        className={cn(ONBOARDING_SECONDARY_BUTTON_CLASS, "w-full sm:w-auto sm:min-w-[7rem]")}
      >
        Back
      </Button>
      <Button
        type="button"
        onClick={onNext}
        disabled={saving}
        className={cn(ONBOARDING_PRIMARY_BUTTON_CLASS, "w-full sm:w-auto sm:min-w-[12rem]")}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Setting up your workspace…
          </>
        ) : (
          primaryLabel
        )}
      </Button>
    </div>
  </div>
);

export default OnboardingNavigation;
