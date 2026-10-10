import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import {
  type EmailSubscriptionStatus,
  fetchMyEmailSubscriptions,
  setMyOnboardingEmailOptOut,
} from "@/lib/emailSubscriptions";

/**
 * "Onboarding tips by email" switch. Renders NOTHING unless the server reports the onboarding
 * program as live for the signed-in user's agency, so while the program is disabled (the default)
 * the Settings page is unchanged. Not rendered under "View As": the preference belongs to the real
 * signed-in user (invariant #31), and the RPC derives the user from the session anyway.
 * Saves immediately and shows the saved server state; a failed save keeps the previous state.
 */
export const OnboardingEmailPreference: React.FC = () => {
  const { user, isImpersonating } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<{ userId: string; value: EmailSubscriptionStatus } | null>(null);
  const [saving, setSaving] = useState(false);
  const loadSeq = useRef(0);

  useEffect(() => {
    const seq = ++loadSeq.current;
    if (!userId || isImpersonating) return;
    fetchMyEmailSubscriptions()
      .then((value) => {
        if (seq === loadSeq.current) setStatus(value ? { userId, value } : null);
      })
      .catch(() => {
        if (seq === loadSeq.current) setStatus(null);
      });
  }, [userId, isImpersonating]);

  // Status loaded for another user (or none) is never shown.
  const current = status && status.userId === userId ? status.value : null;
  if (!userId || isImpersonating || !current?.onboarding_program_enabled) return null;

  const subscribed = !current.onboarding_opted_out;

  const onChange = async (checked: boolean) => {
    if (saving) return;
    setSaving(true);
    const seq = loadSeq.current;
    try {
      const optedOut = await setMyOnboardingEmailOptOut({ optedOut: !checked });
      if (seq === loadSeq.current) setStatus({ userId, value: { ...current, onboarding_opted_out: optedOut } });
      toast.success(optedOut ? "Onboarding tips turned off" : "Onboarding tips turned on");
    } catch {
      toast.error("Couldn't save your email preference. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Onboarding tips by email</p>
        <p className="text-xs text-muted-foreground">Short emails to help you get started. Account emails always arrive.</p>
      </div>
      <Switch
        checked={subscribed}
        onCheckedChange={onChange}
        disabled={saving}
        aria-label="Onboarding tips by email"
      />
    </div>
  );
};

export default OnboardingEmailPreference;
