import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { US_TIMEZONES } from "@/constants/us-geo";
import { cn } from "@/lib/utils";
import OnboardingField from "@/components/onboarding/OnboardingField";
import LicensedStatesMultiSelect from "@/components/onboarding/LicensedStatesMultiSelect";
import { describedBy } from "@/components/onboarding/fieldA11y";
import {
  ONBOARDING_FIELD_CLASS,
  ONBOARDING_HEADING_CLASS,
  ONBOARDING_POPOVER_CLASS,
  ONBOARDING_SUBHEADING_CLASS,
} from "@/components/onboarding/onboardingTheme";
import { ONBOARDING_FIELD_IDS } from "@/lib/onboarding-validation";

interface Props {
  npn: string;
  licensedStates: string[];
  timezone: string;
  commissionDigits: string;
  /**
   * Invited agents set their own timezone here (it is saved to `profiles.timezone`).
   * Self-serve founders do NOT: their profile timezone comes from the agency
   * default on step three, so showing a personal picker here would offer a value
   * that completion discards.
   */
  showsPersonalTimezone: boolean;
  errors: Record<string, string>;
  onChange: (
    patch: Partial<{ npn: string; licensedStates: string[]; timezone: string; commissionDigits: string }>,
  ) => void;
}

const IDS = ONBOARDING_FIELD_IDS;

export function OnboardingStepCredentials({
  npn,
  licensedStates,
  timezone,
  commissionDigits,
  showsPersonalTimezone,
  errors,
  onChange,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={ONBOARDING_HEADING_CLASS}>Licensing and production details</h1>
        <p className={ONBOARDING_SUBHEADING_CLASS}>
          All optional — add what you have now and update any of it later in Settings.
        </p>
      </div>

      <OnboardingField
        id={IDS.npn}
        label="National Producer Number (NPN)"
        optional
        error={errors.npn}
        helper="Your NPN is stored on your profile for reference."
      >
        <Input
          id={IDS.npn}
          value={npn}
          placeholder="e.g. 12345678"
          autoComplete="off"
          aria-describedby={describedBy(IDS.npn, { helper: true, error: Boolean(errors.npn) })}
          onChange={(e) => onChange({ npn: e.target.value })}
          className={cn(ONBOARDING_FIELD_CLASS)}
        />
      </OnboardingField>

      <OnboardingField
        id={IDS.licensedStates}
        label="Licensed states"
        optional
        helper="Search, then pick every state you're licensed in. Use Select all or Clear to move quickly."
      >
        <LicensedStatesMultiSelect
          id={IDS.licensedStates}
          value={licensedStates}
          onChange={(next) => onChange({ licensedStates: next })}
          describedBy={describedBy(IDS.licensedStates, { helper: true })}
        />
      </OnboardingField>

      {showsPersonalTimezone && (
        <OnboardingField
          id={IDS.timezone}
          label="Your timezone"
          optional
          helper="Used for your own scheduling and reporting."
        >
          <Select value={timezone} onValueChange={(v) => onChange({ timezone: v })}>
            <SelectTrigger
              id={IDS.timezone}
              aria-describedby={describedBy(IDS.timezone, { helper: true })}
              className={cn(ONBOARDING_FIELD_CLASS)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={ONBOARDING_POPOVER_CLASS}>
              {US_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </OnboardingField>
      )}

      <OnboardingField
        id={IDS.commissionDigits}
        label="Commission level"
        optional
        error={errors.commissionDigits}
        helper="Numbers only — do not include the % sign."
      >
        <Input
          id={IDS.commissionDigits}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="e.g. 105"
          value={commissionDigits}
          aria-describedby={describedBy(IDS.commissionDigits, {
            helper: true,
            error: Boolean(errors.commissionDigits),
          })}
          onChange={(e) => onChange({ commissionDigits: e.target.value.replace(/\D/g, "") })}
          className={cn(ONBOARDING_FIELD_CLASS)}
        />
      </OnboardingField>
    </div>
  );
}
