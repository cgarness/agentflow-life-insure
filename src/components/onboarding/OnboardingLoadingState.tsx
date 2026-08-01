import React, { useEffect } from "react";
import { Loader2 } from "lucide-react";
import Logo from "@/components/shared/Logo";
import { ONBOARDING_CARD_CLASS, ONBOARDING_HAIRLINE_CLASS } from "@/components/onboarding/onboardingTheme";

/**
 * Branded loading screen for `/onboarding` — the same black page and dark navy
 * card as the wizard itself, with visible status text instead of a bare spinner.
 *
 * The status text lives in a `role="status"` live region so assistive technology
 * announces it; the spinner is decorative and never the only signal.
 */
const OnboardingLoadingState: React.FC = () => {
  useEffect(() => {
    document.body.classList.add("bg-black");
    return () => document.body.classList.remove("bg-black");
  }, []);

  return (
    <div className="dark relative flex min-h-dvh w-full overflow-x-hidden bg-black text-slate-100">
      <main className="relative m-auto w-full max-w-md px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex justify-center sm:mb-8">
          <Logo variant="full" themeOverride="dark" iconClassName="h-9 w-9" textClassName="h-5" />
        </div>
        <div className={ONBOARDING_CARD_CLASS}>
          <div className={ONBOARDING_HAIRLINE_CLASS} aria-hidden="true" />
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-blue-400" aria-hidden="true" />
            <p role="status" aria-live="polite" className="text-sm font-medium text-slate-200">
              Preparing your workspace…
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default OnboardingLoadingState;
