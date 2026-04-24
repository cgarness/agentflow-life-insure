import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type Profile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isSelfServeSignup, needsAppOnboardingWizard } from "@/lib/onboarding-wizard";
import type { TeamSizeIntent } from "@/components/onboarding/wizard/OnboardingStepAgency";

function digitsFromCommission(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(/\D/g, "");
}

/** RLS uses JWT app_metadata.role/org; refresh until the profile trigger has stamped claims. */
async function refreshSessionUntilClaimsReady(maxAttempts = 12): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw error;
    const meta = data.session?.user?.app_metadata as Record<string, unknown> | undefined;
    const role = meta?.role as string | undefined;
    const org = meta?.organization_id as string | undefined;
    if (role && org) return;
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error("Session is still missing organization or role claims. Try signing out and back in, then finish setup.");
}

export function useOnboardingPageFlow() {
  const navigate = useNavigate();
  const { user, profile, updateProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [uplineLabel, setUplineLabel] = useState<string | null>(null);
  const isFounder = useMemo(() => isSelfServeSignup(user ?? null), [user]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [residentState, setResidentState] = useState("");
  const [npn, setNpn] = useState("");
  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  const [timezone, setTimezone] = useState("Eastern Time (US & Canada)");
  /** Digits only (e.g. 105); persisted as typed. */
  const [commissionDigits, setCommissionDigits] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [agencyTimezone, setAgencyTimezone] = useState("Eastern Time (US & Canada)");
  const [teamSize, setTeamSize] = useState<TeamSizeIntent>("solo");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user || !needsAppOnboardingWizard(user)) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.first_name || "");
    setLastName(profile.last_name || "");
    setPhone(profile.phone || "");
    setResidentState(profile.resident_state || "");
    setNpn(profile.npn || "");
    const ls = profile.licensed_states;
    setLicensedStates(Array.isArray(ls) ? (ls as string[]) : []);
    setTimezone(profile.timezone || "Eastern Time (US & Canada)");
    setCommissionDigits(digitsFromCommission(profile.commission_level));
    if (isFounder) setAgencyTimezone(profile.timezone || "Eastern Time (US & Canada)");
  }, [profile, isFounder]);

  useEffect(() => {
    if (!profile?.organization_id) return;
    void (async () => {
      const { data } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.organization_id!)
        .maybeSingle();
      const name = data?.name || "";
      setOrgName(name || "Your agency");
      if (isFounder && name) setAgencyName(name);
    })();
  }, [profile?.organization_id, isFounder]);

  useEffect(() => {
    if (!profile?.upline_id) {
      setUplineLabel(null);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name,last_name")
        .eq("id", profile.upline_id!)
        .maybeSingle();
      if (data) setUplineLabel(`${data.first_name || ""} ${data.last_name || ""}`.trim() || null);
      else setUplineLabel(null);
    })();
  }, [profile?.upline_id]);

  const validateStep0 = useCallback(() => {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = "Required";
    if (!lastName.trim()) e.lastName = "Required";
    if (!phone.trim()) e.phone = "Required";
    else if (phone.replace(/\D/g, "").length < 10) e.phone = "Enter a valid phone number";
    if (!residentState) e.residentState = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [firstName, lastName, phone, residentState]);

  const validateStep1 = useCallback(() => {
    setErrors({});
    return true;
  }, []);

  const validateStep2 = useCallback(() => {
    if (!isFounder) return true;
    const e: Record<string, string> = {};
    if (!agencyName.trim()) e.agencyName = "Agency name is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [agencyName, isFounder]);

  const finish = useCallback(async () => {
    if (!user || !profile) return;
    setSaving(true);
    try {
      await refreshSessionUntilClaimsReady();

      const npnVal = npn.trim();
      const commissionVal = commissionDigits.trim();
      const patch: Partial<Profile> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        resident_state: residentState,
        licensed_states: licensedStates as unknown as Profile["licensed_states"],
        timezone: isFounder ? agencyTimezone : timezone,
        onboarding_complete: true,
      };
      if (npnVal !== "") patch.npn = npnVal;
      if (commissionVal !== "") patch.commission_level = commissionVal;

      await updateProfile(patch);

      if (isFounder && profile.organization_id && agencyName.trim()) {
        const { error: orgErr } = await supabase
          .from("organizations")
          .update({ name: agencyName.trim(), updated_at: new Date().toISOString() })
          .eq("id", profile.organization_id);
        if (orgErr) {
          console.warn("Onboarding: could not update organization name", orgErr);
          toast.message("Agency name could not be saved yet — you can ask a super admin or retry from settings later.");
        }
      }

      const meta = { ...(user.user_metadata as Record<string, unknown>) };
      meta.app_wizard_completed = true;
      if (isFounder) meta.team_size_intent = teamSize;

      const { error: authErr } = await supabase.auth.updateUser({ data: meta });
      if (authErr) throw authErr;
      await supabase.auth.refreshSession();
      toast.success("Welcome to AgentFlow!");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      console.error(err);
      const fromObj =
        err &&
        typeof err === "object" &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : null;
      const msg =
        err instanceof Error ? err.message : fromObj || "Could not finish setup. Please try again.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [
    user,
    profile,
    updateProfile,
    firstName,
    lastName,
    phone,
    residentState,
    npn,
    licensedStates,
    timezone,
    agencyTimezone,
    commissionDigits,
    isFounder,
    agencyName,
    teamSize,
    navigate,
  ]);

  const next = useCallback(async () => {
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !validateStep1()) return;
    if (step === 2) {
      if (!validateStep2()) return;
      await finish();
      return;
    }
    setStep((s) => s + 1);
    setErrors({});
  }, [step, validateStep0, validateStep1, validateStep2, finish]);

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
    setErrors({});
  }, []);

  return {
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
    commissionDigits,
    setCommissionDigits,
    agencyName,
    setAgencyName,
    agencyTimezone,
    setAgencyTimezone,
    teamSize,
    setTeamSize,
    errors,
    next,
    back,
  };
}
