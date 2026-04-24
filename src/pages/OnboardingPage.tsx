import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { OnboardingStepWho } from "@/components/onboarding/wizard/OnboardingStepWho";
import { OnboardingStepCredentials } from "@/components/onboarding/wizard/OnboardingStepCredentials";
import { OnboardingStepAgency } from "@/components/onboarding/wizard/OnboardingStepAgency";
import { useOnboardingPageFlow } from "@/hooks/useOnboardingPageFlow";

const STEPS = 3;

export default function OnboardingPage() {
  const flow = useOnboardingPageFlow();
  const {
    user,
    profile,
    step,
    saving,
    orgName,
    uplineLabel,
    isFounder,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    phone,
    setPhone,
    residentState,
    setResidentState,
    npn,
    setNpn,
    licensedStates,
    setLicensedStates,
    timezone,
    setTimezone,
    commissionLevel,
    setCommissionLevel,
    agencyName,
    setAgencyName,
    agencyTimezone,
    setAgencyTimezone,
    teamSize,
    setTeamSize,
    errors,
    next,
    back,
  } = flow;

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const progress = ((step + 1) / STEPS) * 100;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 py-4 flex items-center justify-between max-w-3xl mx-auto w-full">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">AgentFlow setup</p>
          <p className="text-sm text-muted-foreground">Step {step + 1} of {STEPS}</p>
        </div>
        <div className="w-40">
          <Progress value={progress} className="h-2" />
        </div>
      </header>

      <main className="flex-1 px-4 py-8 max-w-lg mx-auto w-full">
        {step === 0 && (
          <OnboardingStepWho
            firstName={firstName}
            lastName={lastName}
            phone={phone}
            residentState={residentState}
            errors={errors}
            onChange={(p) => {
              if (p.firstName !== undefined) setFirstName(p.firstName);
              if (p.lastName !== undefined) setLastName(p.lastName);
              if (p.phone !== undefined) setPhone(p.phone);
              if (p.residentState !== undefined) setResidentState(p.residentState);
            }}
          />
        )}
        {step === 1 && (
          <OnboardingStepCredentials
            npn={npn}
            licensedStates={licensedStates}
            timezone={timezone}
            commissionLevel={commissionLevel}
            commissionReadOnly={!isFounder}
            errors={errors}
            onChange={(p) => {
              if (p.npn !== undefined) setNpn(p.npn);
              if (p.licensedStates !== undefined) setLicensedStates(p.licensedStates);
              if (p.timezone !== undefined) setTimezone(p.timezone);
              if (p.commissionLevel !== undefined) setCommissionLevel(p.commissionLevel);
            }}
          />
        )}
        {step === 2 &&
          (isFounder ? (
            <OnboardingStepAgency
              mode="founder"
              agencyName={agencyName}
              agencyTimezone={agencyTimezone}
              teamSize={teamSize}
              errors={errors}
              onChange={(p) => {
                if (p.agencyName !== undefined) setAgencyName(p.agencyName);
                if (p.agencyTimezone !== undefined) setAgencyTimezone(p.agencyTimezone);
                if (p.teamSize !== undefined) setTeamSize(p.teamSize);
              }}
            />
          ) : (
            <OnboardingStepAgency
              mode="invite"
              orgName={orgName || "Your agency"}
              role={profile.role}
              uplineLabel={uplineLabel}
            />
          ))}
      </main>

      <footer className="border-t border-border px-4 py-4 max-w-lg mx-auto w-full flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={back} disabled={step === 0 || saving}>
          Back
        </Button>
        <Button type="button" onClick={() => void next()} disabled={saving}>
          {saving ? "Saving…" : step === STEPS - 1 ? "Finish" : "Continue"}
        </Button>
      </footer>
    </div>
  );
}
