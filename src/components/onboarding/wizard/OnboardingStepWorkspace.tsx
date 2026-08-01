import { Building2 } from "lucide-react";
import { ONBOARDING_HEADING_CLASS, ONBOARDING_SUBHEADING_CLASS } from "@/components/onboarding/onboardingTheme";

interface Props {
  /** Resolved agency name; may be empty when the org/branding lookup returned nothing. */
  orgName: string;
  role: string;
  uplineLabel: string | null;
}

/**
 * Final step for an invited agent: a read-only confirmation of the workspace
 * they are joining. No celebratory animation, no editable field — the org, role
 * and upline were all derived server-side from the invitation.
 */
export function OnboardingStepWorkspace({ orgName, role, uplineLabel }: Props) {
  const trimmed = orgName.trim();
  const headingName = trimmed || "your agency";
  const summaryName = trimmed || "Your agency";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={ONBOARDING_HEADING_CLASS}>You're joining {headingName}</h1>
        <p className={ONBOARDING_SUBHEADING_CLASS}>
          You're joining an existing AgentFlow workspace. Confirm the details below and you're in.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-5">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300"
          >
            <Building2 className="h-5 w-5" />
          </span>
          <dl className="min-w-0 flex-1 space-y-3">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Agency</dt>
              <dd className="text-base font-semibold text-white">{summaryName}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Your role</dt>
              <dd className="text-sm text-slate-200">{role}</dd>
            </div>
            {uplineLabel && (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Upline</dt>
                <dd className="text-sm text-slate-200">{uplineLabel}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
