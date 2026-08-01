import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { US_TIMEZONES } from "@/constants/us-geo";
import { cn } from "@/lib/utils";
import OnboardingField from "@/components/onboarding/OnboardingField";
import { describedBy } from "@/components/onboarding/fieldA11y";
import {
  ONBOARDING_FIELD_CLASS,
  ONBOARDING_FIELD_INVALID_CLASS,
  ONBOARDING_HEADING_CLASS,
  ONBOARDING_LABEL_CLASS,
  ONBOARDING_POPOVER_CLASS,
  ONBOARDING_SUBHEADING_CLASS,
} from "@/components/onboarding/onboardingTheme";
import { ONBOARDING_FIELD_IDS } from "@/lib/onboarding-validation";

/** Persisted `user_metadata.team_size_intent` values — unchanged. */
export type TeamSizeIntent = "solo" | "small" | "large";

/** Display ranges only; the stored values stay `solo` / `small` / `large`. */
const TEAM_SIZES: { value: TeamSizeIntent; label: string; id: string }[] = [
  { value: "solo", label: "Just me", id: "onboarding-team-size-solo" },
  { value: "small", label: "2–10 producers", id: "onboarding-team-size-small" },
  { value: "large", label: "11+ producers", id: "onboarding-team-size-large" },
];

interface Props {
  agencyName: string;
  agencyTimezone: string;
  teamSize: TeamSizeIntent;
  errors: Record<string, string>;
  onChange: (patch: Partial<{ agencyName: string; agencyTimezone: string; teamSize: TeamSizeIntent }>) => void;
}

const IDS = ONBOARDING_FIELD_IDS;

export function OnboardingStepAgencyFounder({ agencyName, agencyTimezone, teamSize, errors, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={ONBOARDING_HEADING_CLASS}>Set up your agency</h1>
        <p className={ONBOARDING_SUBHEADING_CLASS}>
          This creates the workspace your team will use for calling, managing leads, and tracking production.
        </p>
      </div>

      <OnboardingField id={IDS.agencyName} label="Agency display name" error={errors.agencyName}>
        <Input
          id={IDS.agencyName}
          value={agencyName}
          autoComplete="organization"
          aria-invalid={errors.agencyName ? true : undefined}
          aria-describedby={describedBy(IDS.agencyName, { error: Boolean(errors.agencyName) })}
          onChange={(e) => onChange({ agencyName: e.target.value })}
          className={cn(ONBOARDING_FIELD_CLASS, errors.agencyName && ONBOARDING_FIELD_INVALID_CLASS)}
        />
      </OnboardingField>

      <OnboardingField
        id={IDS.agencyTimezone}
        label="Agency default timezone"
        helper="Used for your agency's scheduling and for your own profile."
      >
        <Select value={agencyTimezone} onValueChange={(v) => onChange({ agencyTimezone: v })}>
          <SelectTrigger
            id={IDS.agencyTimezone}
            aria-describedby={describedBy(IDS.agencyTimezone, { helper: true })}
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

      <div className="space-y-2">
        <Label id="onboarding-team-size-label" className={ONBOARDING_LABEL_CLASS}>
          How many producers do you expect?
        </Label>
        <RadioGroup
          aria-labelledby="onboarding-team-size-label"
          value={teamSize}
          onValueChange={(v) => onChange({ teamSize: v as TeamSizeIntent })}
          className="grid gap-3 sm:grid-cols-3"
        >
          {TEAM_SIZES.map((option) => {
            const selected = teamSize === option.value;
            return (
              <label
                key={option.value}
                htmlFor={option.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-slate-900",
                  selected
                    ? "border-blue-400/70 bg-blue-500/10 text-white"
                    : "border-slate-700/70 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:bg-slate-800/60",
                )}
              >
                <RadioGroupItem
                  value={option.value}
                  id={option.id}
                  className="border-slate-500 text-blue-400 focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=checked]:border-blue-400"
                />
                <span className="font-medium">
                  {option.label}
                  {selected && <span className="sr-only"> — selected</span>}
                </span>
              </label>
            );
          })}
        </RadioGroup>
      </div>
    </div>
  );
}
