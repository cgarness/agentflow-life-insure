import {
  OnboardingStepAgencyFounder,
  type TeamSizeIntent,
} from "@/components/onboarding/wizard/OnboardingStepAgencyFounder";
import { OnboardingStepWorkspace } from "@/components/onboarding/wizard/OnboardingStepWorkspace";

export type { TeamSizeIntent };

interface FounderProps {
  mode: "founder";
  agencyName: string;
  agencyTimezone: string;
  teamSize: TeamSizeIntent;
  errors: Record<string, string>;
  onChange: (patch: Partial<{ agencyName: string; agencyTimezone: string; teamSize: TeamSizeIntent }>) => void;
}

interface InviteProps {
  mode: "invite";
  orgName: string;
  role: string;
  uplineLabel: string | null;
}

type Props = FounderProps | InviteProps;

/**
 * Step three. Self-serve founders set up their agency; invited agents confirm
 * the workspace they were invited into. The branch is driven by the same
 * `isFounder` (`signup_source === "self_serve"`) flag the completion path uses.
 */
export function OnboardingStepAgency(props: Props) {
  if (props.mode === "invite") {
    return <OnboardingStepWorkspace orgName={props.orgName} role={props.role} uplineLabel={props.uplineLabel} />;
  }

  const { agencyName, agencyTimezone, teamSize, errors, onChange } = props;
  return (
    <OnboardingStepAgencyFounder
      agencyName={agencyName}
      agencyTimezone={agencyTimezone}
      teamSize={teamSize}
      errors={errors}
      onChange={onChange}
    />
  );
}
