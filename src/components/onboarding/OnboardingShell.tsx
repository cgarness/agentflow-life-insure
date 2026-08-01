import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/shared/Logo";
import { cn } from "@/lib/utils";
import {
  ONBOARDING_CARD_CLASS,
  ONBOARDING_HAIRLINE_CLASS,
  ONBOARDING_QUIET_BUTTON_CLASS,
} from "@/components/onboarding/onboardingTheme";

interface OnboardingShellProps {
  /** Completion in flight — marks the card busy and blocks the sign-out action. */
  busy?: boolean;
  /** Sign out. Wired to the existing `useAuth().logout` by the page — never a second signOut path. */
  onSignOut?: () => void;
  children: React.ReactNode;
}

/**
 * Full-viewport shell for the `/onboarding` wizard: a solid black page with one
 * centered dark-navy card, the AgentFlow platform logo above it, and a quiet
 * sign-out action in the card header.
 *
 * `min-h-dvh` (dynamic viewport height) replaces `min-h-screen`, which leaves a
 * white band under mobile browser chrome. `.dark` is scoped here because the
 * app's default theme is `light` — without it every shadcn primitive inside
 * would resolve near-white semantic tokens.
 *
 * Centering uses flex + `m-auto`: the card sits dead-center while it fits, and
 * tops out against the shell padding and scrolls naturally on short viewports.
 */
const OnboardingShell: React.FC<OnboardingShellProps> = ({ busy = false, onSignOut, children }) => {
  // The app's `<body>` carries the light `--background`, which shows through as a
  // white band on mobile overscroll even though the shell fills the viewport.
  useEffect(() => {
    document.body.classList.add("bg-black");
    return () => document.body.classList.remove("bg-black");
  }, []);

  return (
    <div className="dark relative flex min-h-dvh w-full overflow-x-hidden bg-black text-slate-100">
      <main className="relative m-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex justify-center sm:mb-8">
          <Logo variant="full" themeOverride="dark" iconClassName="h-9 w-9" textClassName="h-5" />
        </div>

        <div className={ONBOARDING_CARD_CLASS} aria-busy={busy || undefined}>
          <div className={ONBOARDING_HAIRLINE_CLASS} aria-hidden="true" />
          <div className="p-5 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Account setup</p>
              {onSignOut && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onSignOut}
                  disabled={busy}
                  className={cn(ONBOARDING_QUIET_BUTTON_CLASS)}
                >
                  Sign out
                </Button>
              )}
            </div>
            <div className="mt-4 h-px w-full bg-slate-700/50" aria-hidden="true" />
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};

export default OnboardingShell;
