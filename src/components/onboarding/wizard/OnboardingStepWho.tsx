import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/shared/PhoneInput";
import { normalizePhoneNumber } from "@/utils/phoneUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { US_STATE_NAMES } from "@/constants/us-geo";
import { cn } from "@/lib/utils";
import OnboardingField from "@/components/onboarding/OnboardingField";
import { describedBy } from "@/components/onboarding/fieldA11y";
import {
  ONBOARDING_FIELD_CLASS,
  ONBOARDING_FIELD_INVALID_CLASS,
  ONBOARDING_HEADING_CLASS,
  ONBOARDING_POPOVER_CLASS,
  ONBOARDING_SUBHEADING_CLASS,
} from "@/components/onboarding/onboardingTheme";
import { ONBOARDING_FIELD_IDS } from "@/lib/onboarding-validation";

interface Props {
  firstName: string;
  lastName: string;
  phone: string;
  residentState: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<{ firstName: string; lastName: string; phone: string; residentState: string }>) => void;
}

const IDS = ONBOARDING_FIELD_IDS;

export function OnboardingStepWho({ firstName, lastName, phone, residentState, errors, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={ONBOARDING_HEADING_CLASS}>Tell us about you</h1>
        <p className={ONBOARDING_SUBHEADING_CLASS}>
          We'll use this information for your internal profile, team visibility, and account recovery.
        </p>
      </div>

      {/* Stacked on narrow screens; two columns only once there is room. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <OnboardingField id={IDS.firstName} label="First name" error={errors.firstName}>
          <Input
            id={IDS.firstName}
            value={firstName}
            autoComplete="given-name"
            aria-invalid={errors.firstName ? true : undefined}
            aria-describedby={describedBy(IDS.firstName, { error: Boolean(errors.firstName) })}
            onChange={(e) => onChange({ firstName: e.target.value })}
            className={cn(ONBOARDING_FIELD_CLASS, errors.firstName && ONBOARDING_FIELD_INVALID_CLASS)}
          />
        </OnboardingField>

        <OnboardingField id={IDS.lastName} label="Last name" error={errors.lastName}>
          <Input
            id={IDS.lastName}
            value={lastName}
            autoComplete="family-name"
            aria-invalid={errors.lastName ? true : undefined}
            aria-describedby={describedBy(IDS.lastName, { error: Boolean(errors.lastName) })}
            onChange={(e) => onChange({ lastName: e.target.value })}
            className={cn(ONBOARDING_FIELD_CLASS, errors.lastName && ONBOARDING_FIELD_INVALID_CLASS)}
          />
        </OnboardingField>
      </div>

      <OnboardingField
        id={IDS.phone}
        label="Phone"
        error={errors.phone}
        helper="For internal contact and account recovery. This is not used as your outbound caller ID."
      >
        <PhoneInput
          id={IDS.phone}
          value={phone}
          autoComplete="tel"
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={describedBy(IDS.phone, { helper: true, error: Boolean(errors.phone) })}
          onChange={(v) => onChange({ phone: normalizePhoneNumber(v) })}
          className={cn(ONBOARDING_FIELD_CLASS, errors.phone && ONBOARDING_FIELD_INVALID_CLASS)}
        />
      </OnboardingField>

      <OnboardingField
        id={IDS.residentState}
        label="Resident state"
        error={errors.residentState}
        helper="Your home state — you can add every state you're licensed in on the next step."
      >
        <Select value={residentState} onValueChange={(v) => onChange({ residentState: v })}>
          <SelectTrigger
            id={IDS.residentState}
            aria-invalid={errors.residentState ? true : undefined}
            aria-describedby={describedBy(IDS.residentState, { helper: true, error: Boolean(errors.residentState) })}
            className={cn(ONBOARDING_FIELD_CLASS, errors.residentState && ONBOARDING_FIELD_INVALID_CLASS)}
          >
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent className={ONBOARDING_POPOVER_CLASS}>
            {US_STATE_NAMES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </OnboardingField>
    </div>
  );
}
