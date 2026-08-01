import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type Profile } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isSelfServeSignup, needsAppOnboardingWizard } from "@/lib/onboarding-wizard";
import { BRANDING_DEFAULTS } from "@/components/settings/brandingConfig";
import type { TeamSizeIntent } from "@/components/onboarding/wizard/OnboardingStepAgency";
import {
  describeCompletionError,
  firstInvalidField,
  onboardingFounderAgencySchema,
  onboardingProfileSchema,
  zodErrorsToFieldMap,
  type OnboardingFieldKey,
} from "@/lib/onboarding-validation";

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

const VALIDATION_ALERT = "Check the highlighted fields below.";

export function useOnboardingPageFlow() {
  const navigate = useNavigate();
  const { user, profile, updateProfile, logout } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  /** Blocks a second completion even before `saving` has been flushed to React state. */
  const savingRef = useRef(false);
  const [orgName, setOrgName] = useState("");
  const [uplineLabel, setUplineLabel] = useState<string | null>(null);
  const isFounder = useMemo(() => isSelfServeSignup(user ?? null), [user]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Card-level announcement (validation summary or a sanitized completion failure). */
  const [alertMessage, setAlertMessage] = useState("");
  /** Focus target for the first invalid field; the nonce re-fires on repeated failures. */
  const [errorFocus, setErrorFocus] = useState<{ field: OnboardingFieldKey; nonce: number } | null>(null);
  const focusNonceRef = useRef(0);

  const clearError = useCallback((key: string) => {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const [firstName, setFirstNameState] = useState("");
  const [lastName, setLastNameState] = useState("");
  const [phone, setPhoneState] = useState("");
  const [residentState, setResidentStateState] = useState("");
  const [npn, setNpn] = useState("");
  const [licensedStates, setLicensedStates] = useState<string[]>([]);
  const [timezone, setTimezone] = useState("Eastern Time (US & Canada)");
  /** Digits only (e.g. 105); persisted as typed. */
  const [commissionDigits, setCommissionDigits] = useState("");
  const [agencyName, setAgencyNameState] = useState("");
  const [agencyTimezone, setAgencyTimezone] = useState("Eastern Time (US & Canada)");
  const [teamSize, setTeamSize] = useState<TeamSizeIntent>("solo");

  // Editing a field clears its own stale error immediately.
  const setFirstName = useCallback((v: string) => { setFirstNameState(v); clearError("firstName"); }, [clearError]);
  const setLastName = useCallback((v: string) => { setLastNameState(v); clearError("lastName"); }, [clearError]);
  const setPhone = useCallback((v: string) => { setPhoneState(v); clearError("phone"); }, [clearError]);
  const setResidentState = useCallback((v: string) => { setResidentStateState(v); clearError("residentState"); }, [clearError]);
  const setAgencyName = useCallback((v: string) => { setAgencyNameState(v); clearError("agencyName"); }, [clearError]);

  useEffect(() => {
    if (!user || !needsAppOnboardingWizard(user)) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!profile) return;
    setFirstNameState(profile.first_name || "");
    setLastNameState(profile.last_name || "");
    setPhoneState(profile.phone || "");
    setResidentStateState(profile.resident_state || "");
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
      const orgId = profile.organization_id!;
      const [{ data: orgRow }, { data: brandRow }] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
        supabase.from("company_settings").select("company_name").eq("organization_id", orgId).maybeSingle(),
      ]);
      const name = brandRow?.company_name?.trim() || orgRow?.name || "";
      // Stored raw — the display fallback ("your agency") belongs to the view.
      setOrgName(name);
      if (isFounder && name) setAgencyNameState(name);
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

  /** Publishes the validation result: errors, the card announcement, and the focus target. */
  const applyValidation = useCallback((stepIndex: number, fieldErrors: Record<string, string>) => {
    setErrors(fieldErrors);
    const failed = Object.keys(fieldErrors).length > 0;
    setAlertMessage(failed ? VALIDATION_ALERT : "");
    if (failed) {
      const field = firstInvalidField(stepIndex, fieldErrors);
      if (field) {
        focusNonceRef.current += 1;
        setErrorFocus({ field, nonce: focusNonceRef.current });
      }
    }
    return !failed;
  }, []);

  const validateStep0 = useCallback(() => {
    const parsed = onboardingProfileSchema.safeParse({ firstName, lastName, phone, residentState });
    return applyValidation(0, parsed.success ? {} : zodErrorsToFieldMap(parsed.error));
  }, [firstName, lastName, phone, residentState, applyValidation]);

  /** Every field on the licensing step is optional — nothing can block navigation. */
  const validateStep1 = useCallback(() => applyValidation(1, {}), [applyValidation]);

  const validateStep2 = useCallback(() => {
    if (!isFounder) return applyValidation(2, {});
    const parsed = onboardingFounderAgencySchema.safeParse({ agencyName });
    return applyValidation(2, parsed.success ? {} : zodErrorsToFieldMap(parsed.error));
  }, [agencyName, isFounder, applyValidation]);

  const finish = useCallback(async () => {
    if (!user || !profile) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setAlertMessage("");
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
        const orgId = profile.organization_id;
        const trimmed = agencyName.trim();
        const [{ error: orgErr }, { error: brandErr }] = await Promise.all([
          supabase
            .from("organizations")
            .update({ name: trimmed, updated_at: new Date().toISOString() })
            .eq("id", orgId),
          supabase.from("company_settings").upsert(
            {
              organization_id: orgId,
              company_name: trimmed,
              logo_url: null,
              logo_name: null,
              favicon_url: null,
              favicon_name: null,
              timezone: agencyTimezone || BRANDING_DEFAULTS.timezone,
              time_format: BRANDING_DEFAULTS.timeFormat,
              company_phone: "",
              website_url: "",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "organization_id" }
          ),
        ]);
        if (orgErr) {
          console.warn("Onboarding: could not update organization name", orgErr);
        }
        if (brandErr) {
          console.warn("Onboarding: could not save company branding (agency name)", brandErr);
          toast.message(
            "Agency display name could not be saved to Company Branding yet — you can set it under Settings later."
          );
        } else if (orgErr) {
          toast.message(
            "Agency name could not be saved on the organization record — you can retry from Settings later."
          );
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
      // Never surface Supabase/PostgREST internals to the user — only copy this app authored.
      const msg = describeCompletionError(err);
      setAlertMessage(msg);
      toast.error(msg);
    } finally {
      savingRef.current = false;
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
    if (savingRef.current) return;
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !validateStep1()) return;
    if (step === 2) {
      if (!validateStep2()) return;
      await finish();
      return;
    }
    setStep((s) => s + 1);
    setErrors({});
    setAlertMessage("");
  }, [step, validateStep0, validateStep1, validateStep2, finish]);

  const back = useCallback(() => {
    if (savingRef.current) return;
    setStep((s) => Math.max(0, s - 1));
    setErrors({});
    setAlertMessage("");
  }, []);

  /** Header sign-out — the existing AuthContext logout, never a second signOut path. */
  const signOut = useCallback(async () => {
    if (savingRef.current) return;
    try {
      await logout();
    } catch (err) {
      console.error(err);
      toast.error("Could not sign out. Please try again.");
    }
  }, [logout]);

  return {
    user,
    profile,
    step,
    saving,
    orgName,
    uplineLabel,
    isFounder,
    /** Invited agents pick their own timezone; founders inherit the agency default (step three). */
    showsPersonalTimezone: !isFounder,
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
  };
}
