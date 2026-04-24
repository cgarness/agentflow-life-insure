import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type Profile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isSelfServeSignup, needsAppOnboardingWizard } from "@/lib/onboarding-wizard";
import type { TeamSizeIntent } from "@/components/onboarding/wizard/OnboardingStepAgency";
import { COMMISSION_LEVELS } from "@/constants/us-geo";

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
  const [commissionLevel, setCommissionLevel] = useState("Street");
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
    const rawCl = profile.commission_level || COMMISSION_LEVELS[0];
    if (!isFounder) setCommissionLevel(rawCl);
    else {
      setCommissionLevel(
        (COMMISSION_LEVELS as readonly string[]).includes(rawCl) ? rawCl : COMMISSION_LEVELS[0],
      );
    }
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
    const e: Record<string, string> = {};
    if (!npn.trim()) e.npn = "NPN is required for insurance producers";
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [npn]);

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
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        resident_state: residentState,
        npn: npn.trim(),
        licensed_states: licensedStates as unknown as Profile["licensed_states"],
        timezone: isFounder ? agencyTimezone : timezone,
        commission_level: commissionLevel,
        onboarding_complete: true,
      });

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
      toast.error("Could not finish setup. Please try again.");
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
    commissionLevel,
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
  };
}
