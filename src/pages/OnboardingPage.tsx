import { useEffect } from "react";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import OnboardingStepper from "@/components/onboarding/OnboardingStepper";
import OnboardingNavigation from "@/components/onboarding/OnboardingNavigation";
import OnboardingLoadingState from "@/components/onboarding/OnboardingLoadingState";
import OnboardingAlert from "@/components/onboarding/OnboardingAlert";
import { OnboardingStepWho } from "@/components/onboarding/wizard/OnboardingStepWho";
import { OnboardingStepCredentials } from "@/components/onboarding/wizard/OnboardingStepCredentials";
import { OnboardingStepAgency } from "@/components/onboarding/wizard/OnboardingStepAgency";
import { useOnboardingPageFlow } from "@/hooks/useOnboardingPageFlow";
import { ONBOARDING_FIELD_IDS } from "@/lib/onboarding-validation";

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
    showsPersonalTimezone,
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
    commissionDigits,
    setCommissionDigits,
    agencyName,
    setAgencyName,
    agencyTimezone,
    setAgencyTimezone,
    teamSize,
    setTeamSize,
    errors,
    alertMessage,
    errorFocus,
    next,
    back,
    signOut,
  } = flow;

  // A failed Continue moves focus to the first invalid field, in DOM order. The
  // nonce changes on every failure so a repeated submit re-focuses.
  useEffect(() => {
    if (!errorFocus) return;
    const el = document.getElementById(ONBOARDING_FIELD_IDS[errorFocus.field]);
    if (el instanceof HTMLElement) el.focus();
  }, [errorFocus]);

  if (!user || !profile) return <OnboardingLoadingState />;

  const primaryLabel =
    step < STEPS - 1 ? "Continue" : isFounder ? "Complete setup" : "Enter AgentFlow";

  return (
    <OnboardingShell busy={saving} onSignOut={() => void signOut()}>
      <div className="mt-6 space-y-2">
        <OnboardingStepper current={step} finalLabel={isFounder ? "Agency" : "Workspace"} />
        <p className="text-xs text-slate-400">
          Step {step + 1} of {STEPS}
        </p>
      </div>

      <div className="mt-7">
        <OnboardingAlert className="mb-5 empty:mb-0">{alertMessage || null}</OnboardingAlert>

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
            commissionDigits={commissionDigits}
            showsPersonalTimezone={showsPersonalTimezone}
            errors={errors}
            onChange={(p) => {
              if (p.npn !== undefined) setNpn(p.npn);
              if (p.licensedStates !== undefined) setLicensedStates(p.licensedStates);
              if (p.timezone !== undefined) setTimezone(p.timezone);
              if (p.commissionDigits !== undefined) setCommissionDigits(p.commissionDigits);
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
              orgName={orgName}
              role={profile.role}
              uplineLabel={uplineLabel}
              firstName={firstName}
              lastName={lastName}
              phone={phone}
              residentState={residentState}
              npn={npn}
              licensedStates={licensedStates}
              commissionDigits={commissionDigits}
              timezone={timezone}
            />
          ))}
      </div>

      <OnboardingNavigation
        canGoBack={step > 0}
        saving={saving}
        primaryLabel={primaryLabel}
        onBack={back}
        onNext={() => void next()}
      />
    </OnboardingShell>
  );
}
