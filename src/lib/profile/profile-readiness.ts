/**
 * profile-readiness — "Am I fully set up to operate my business, and if not, what remains?"
 *
 * This is a PURE function over data the application can actually verify today. It is deliberately
 * separate from the component that renders it so that when the configurable agency onboarding
 * system arrives it replaces the COMPUTATION, not the UI: a future engine produces the same
 * `ReadinessCheck[]` from agency-defined requirements and `ReadinessCard` keeps working unchanged.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------------------------
 * No E&O insurance, no AML/anti-fraud course, no background check, no contracting packet, no
 * carrier certification. AgentFlow stores none of those, and a checklist item with no data behind
 * it is a fabricated compliance requirement. When the onboarding engine can express them, they
 * arrive with their storage.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO HONEST-REPORTING RULES THIS FILE ENFORCES
 * ---------------------------------------------------------------------------------------------
 *  1. `profiles.onboarding_complete` is a COARSE BOOLEAN, not a step engine. It is presented as ONE
 *     factor called "Onboarding wizard completed" and is never dressed up as progress through
 *     configurable steps. It is DISPLAY ONLY — it is self-writable by any authenticated user and
 *     the wizard (`useOnboardingPageFlow`) owns writing it.
 *
 *  2. A LICENCE WITH NO EXPIRATION DATE IS NOT EVIDENCE OF CURRENCY. `expirationStatus()` returns
 *     `"none"` for a null date, and 17 of 18 production licence rows are in exactly that state.
 *     The "no expired licences" check therefore passes on an ABSENCE of evidence, so it carries an
 *     explicit neutral note saying how many licences have no expiration recorded. Rendering those
 *     as a green "Active" — which the existing Settings card does — asserts something unearned.
 */

import { normalizeUsState } from "@/utils/stateUtils";

export type ReadinessState = "complete" | "incomplete" | "unknown";

export interface ReadinessCheck {
  /** Stable identifier — a future configurable engine can key its own requirements to these. */
  id: string;
  label: string;
  state: ReadinessState;
  /** One short sentence shown when the check is not complete, or as a neutral caveat. */
  detail?: string;
  /** Where the agent goes to resolve it. An ABSOLUTE path: `setSearchParams` is route-relative. */
  actionPath?: string;
  actionLabel?: string;
}

export interface ReadinessSummary {
  checks: ReadinessCheck[];
  completeCount: number;
  totalCount: number;
  /** 0-100, rounded. `null` when there is nothing to measure. */
  percent: number | null;
  /** True only when every check is `complete`. */
  isFullyReady: boolean;
}

/** The minimum a licence row must expose for readiness. Mirrors `LicenseRow` in stateLicenseSchema. */
export interface ReadinessLicense {
  state: string;
  expiration_date: string | null;
}

export interface ReadinessInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  npn?: string | null;
  residentState?: string | null;
  onboardingComplete?: boolean | null;
  carrierAppointmentCount: number;
  licenses: ReadinessLicense[];
  /** Today, injected so the pure function stays deterministic under test. */
  today?: Date;
}

function isFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Compare two state values that are stored in DIFFERENT formats.
 *
 * `profiles.resident_state` is written as a FULL NAME by Settings (`ProfileInfoCard`) and as a
 * 2-LETTER CODE by User Management, while `agent_state_licenses.state` holds both forms in
 * production ("CA" and "California" are separate rows). Both sides must be normalized or the match
 * silently misses. `normalizeUsState` is the canonical normalizer and is a byte-for-byte mirror of
 * the SQL `public.normalize_us_state`, so TypeScript and SQL cannot disagree.
 */
function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!isFilled(a) || !isFilled(b)) return false;
  return normalizeUsState(a as string).toUpperCase() === normalizeUsState(b as string).toUpperCase();
}

const SETTINGS_PROFILE = "/settings?section=my-profile";
const SETTINGS_LICENSES = "/settings?section=state-licenses";

export function computeReadiness(input: ReadinessInput): ReadinessSummary {
  const today = input.today ?? new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const expired = input.licenses.filter(
    (l) => isFilled(l.expiration_date) && (l.expiration_date as string) < todayIso,
  );
  const withoutExpiration = input.licenses.filter((l) => !isFilled(l.expiration_date));
  const hasResidentLicense = input.licenses.some((l) => sameState(l.state, input.residentState));

  const checks: ReadinessCheck[] = [
    {
      id: "onboarding",
      label: "Onboarding wizard completed",
      state: input.onboardingComplete ? "complete" : "incomplete",
      detail: input.onboardingComplete
        ? undefined
        : "Finish the onboarding wizard to confirm your account setup.",
      actionPath: input.onboardingComplete ? undefined : "/onboarding",
      actionLabel: input.onboardingComplete ? undefined : "Open onboarding",
    },
    {
      id: "identity",
      label: "Profile details complete",
      state:
        isFilled(input.firstName) &&
        isFilled(input.lastName) &&
        isFilled(input.email) &&
        isFilled(input.phone)
          ? "complete"
          : "incomplete",
      detail: "Name, email and phone number on your profile.",
      actionPath: SETTINGS_PROFILE,
      actionLabel: "Edit profile",
    },
    {
      id: "npn",
      label: "National Producer Number on file",
      state: isFilled(input.npn) ? "complete" : "incomplete",
      detail: isFilled(input.npn) ? undefined : "Add your NPN so it appears on your profile.",
      actionPath: SETTINGS_PROFILE,
      actionLabel: "Add NPN",
    },
    {
      id: "resident-state",
      label: "Resident state set",
      state: isFilled(input.residentState) ? "complete" : "incomplete",
      detail: isFilled(input.residentState) ? undefined : "Set the state you are resident in.",
      actionPath: SETTINGS_PROFILE,
      actionLabel: "Set resident state",
    },
    {
      id: "resident-license",
      label: "Resident-state licence recorded",
      // Without a resident state there is nothing to match against — that is UNKNOWN, not a
      // second failure for the same missing field.
      state: !isFilled(input.residentState)
        ? "unknown"
        : hasResidentLicense
          ? "complete"
          : "incomplete",
      detail: !isFilled(input.residentState)
        ? "Set your resident state first."
        : hasResidentLicense
          ? undefined
          : "No licence recorded for your resident state.",
      actionPath: SETTINGS_LICENSES,
      actionLabel: "Add licence",
    },
    {
      id: "licenses-current",
      label: "No expired licences",
      state: expired.length === 0 ? "complete" : "incomplete",
      detail:
        expired.length > 0
          ? `${expired.length} licence${expired.length === 1 ? "" : "s"} past the expiration date on file.`
          : withoutExpiration.length > 0
            ? // The honest caveat. A missing expiration date is an absence of evidence, and this
              // check passing on it must not read as confirmed currency.
              `${withoutExpiration.length} licence${withoutExpiration.length === 1 ? " has" : "s have"} no expiration date on file.`
            : undefined,
      actionPath: SETTINGS_LICENSES,
      actionLabel: "Review licences",
    },
    {
      id: "carriers",
      label: "Carrier appointments on file",
      state: input.carrierAppointmentCount > 0 ? "complete" : "incomplete",
      detail:
        input.carrierAppointmentCount > 0
          ? undefined
          : "Add the carriers you are appointed with.",
      actionPath: SETTINGS_PROFILE,
      actionLabel: "Add carriers",
    },
  ];

  // An `unknown` check is neither a pass nor a fail: it is excluded from BOTH sides of the ratio,
  // so a missing prerequisite cannot make the percentage look worse than the evidence supports.
  const measurable = checks.filter((c) => c.state !== "unknown");
  const completeCount = measurable.filter((c) => c.state === "complete").length;
  const totalCount = measurable.length;

  return {
    checks,
    completeCount,
    totalCount,
    percent: totalCount === 0 ? null : Math.round((completeCount / totalCount) * 100),
    isFullyReady: totalCount > 0 && completeCount === totalCount,
  };
}
