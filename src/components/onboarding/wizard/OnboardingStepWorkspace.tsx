import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import { ONBOARDING_HEADING_CLASS, ONBOARDING_SUBHEADING_CLASS } from "@/components/onboarding/onboardingTheme";

interface Props {
  /** Resolved agency name; may be empty when the org/branding lookup returned nothing. */
  orgName: string;
  role: string;
  uplineLabel: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  residentState: string;
  npn: string;
  /** Normalized full state names from the licensed-states adapter — never objects. */
  licensedStates: string[];
  /** Digits only (e.g. "80"); the % suffix is display-only. */
  commissionDigits: string;
  timezone: string;
}

const SECTION_CARD_CLASS = "rounded-xl border border-slate-700/60 bg-slate-950/40 p-5";
const SECTION_HEADING_CLASS = "text-[11px] font-semibold uppercase tracking-wider text-slate-400";
const DT_CLASS = "text-[11px] font-medium uppercase tracking-wider text-slate-500";

/** One labelled value; empty values render the shared "Not provided" fallback. */
function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={DT_CLASS}>{label}</dt>
      <dd className={cn("mt-0.5 break-words text-sm", value ? "text-slate-200" : "text-slate-400")}>
        {value || "Not provided"}
      </dd>
    </div>
  );
}

/**
 * Final step for an invited agent: a read-only review before completion. The
 * agency/role/upline were derived server-side from the invitation; the
 * personal details are the CURRENT local wizard state (Steps 1–2 edits are not
 * persisted until the user finishes), so this must never read from the stale
 * profile row. Back is the edit affordance — no separate Edit button.
 */
export function OnboardingStepWorkspace({
  orgName,
  role,
  uplineLabel,
  firstName,
  lastName,
  phone,
  residentState,
  npn,
  licensedStates,
  commissionDigits,
  timezone,
}: Props) {
  const trimmed = orgName.trim();
  const headingName = trimmed || "your agency";
  const summaryName = trimmed || "Your agency";

  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  const phoneDisplay = phone.trim() ? formatPhoneNumber(phone) : "";
  const commissionDisplay = commissionDigits.trim() ? `${commissionDigits.trim()}%` : "";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={ONBOARDING_HEADING_CLASS}>You're joining {headingName}</h1>
        <p className={ONBOARDING_SUBHEADING_CLASS}>Review your details before entering AgentFlow.</p>
      </div>

      <section aria-labelledby="onboarding-agency-details" className={SECTION_CARD_CLASS}>
        <h2 id="onboarding-agency-details" className={SECTION_HEADING_CLASS}>
          Agency details
        </h2>
        <div className="mt-4 flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300"
          >
            <Building2 className="h-5 w-5" />
          </span>
          <dl className="min-w-0 flex-1 space-y-3">
            <div className="min-w-0">
              <dt className={DT_CLASS}>Agency</dt>
              <dd className="break-words text-base font-semibold text-white">{summaryName}</dd>
            </div>
            <div className="min-w-0">
              <dt className={DT_CLASS}>Your role</dt>
              <dd className="break-words text-sm text-slate-200">{role}</dd>
            </div>
            {uplineLabel && (
              <div className="min-w-0">
                <dt className={DT_CLASS}>Upline</dt>
                <dd className="break-words text-sm text-slate-200">{uplineLabel}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <section aria-labelledby="onboarding-your-details" className={SECTION_CARD_CLASS}>
        <h2 id="onboarding-your-details" className={SECTION_HEADING_CLASS}>
          Your details
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <SummaryItem label="Full name" value={fullName} />
          <SummaryItem label="Phone" value={phoneDisplay} />
          <SummaryItem label="Resident state" value={residentState.trim()} />
          <SummaryItem label="NPN" value={npn.trim()} />
          <SummaryItem label="Commission level" value={commissionDisplay} />
          <SummaryItem label="Timezone" value={timezone.trim()} />
          <div className="min-w-0 sm:col-span-2">
            <dt className={DT_CLASS}>Licensed states</dt>
            <dd className="mt-1">
              {licensedStates.length === 0 ? (
                <span className="text-sm text-slate-400">None selected</span>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {licensedStates.map((state) => (
                    <li
                      key={state}
                      className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200"
                    >
                      {state}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
