import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentStatus } from "@/contexts/AgentStatusContext";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { supabase } from "@/integrations/supabase/client";
import { normalizeMobileForwardNumber } from "@/lib/inboundSettingsValidation";
import { ProfileSettingsSection } from "./ProfileSettingsSection";
import { CallForwardingActivationNotice } from "./CallForwardingActivationNotice";
import { CallForwardingFormFields } from "./CallForwardingFormFields";

/**
 * Call Forwarding — the agent's own unanswered-call destination and personal voicemail greeting.
 *
 * Storage is unchanged from the card this replaces: the self-owned `public.agent_inbound_settings`
 * row (RLS self select/insert/update), keyed on `agent_id`, scoped by `organization_id` taken from
 * the REAL operator's profile — never the "View As" profile, and hidden entirely while impersonating.
 * The number is normalised before it is stored and the database refuses one of the agency's own
 * numbers; that rejection is surfaced verbatim because the agent has to act on it.
 *
 * A recorded-greeting link is no longer editable here (there is no way for an agent to produce one),
 * but any value already stored is preserved on save rather than erased.
 */

const GREETING_MAX = 500;

const callForwardingSchema = z.object({
  mobile: z
    .string()
    .trim()
    .refine((v) => v === "" || normalizeMobileForwardNumber(v) !== null, "Enter a valid mobile number."),
  greeting: z.string().max(GREETING_MAX, `Keep your greeting under ${GREETING_MAX} characters.`),
});

type FieldErrors = { mobile?: string; greeting?: string };

/** Supabase rejections are plain objects, not Errors — the agent has to be able to read them. */
const describeError = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
};

export const ProfileCallForwardingSection: React.FC = () => {
  const { user, realProfile, isImpersonating } = useAuth();
  const { activationPending, engine } = useAgentStatus();
  const { registerDirty } = useUnsavedChanges();
  const orgId = realProfile?.organization_id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mobile, setMobile] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [greeting, setGreeting] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  // Not editable here; carried through every save so a stored link is never silently dropped.
  const [greetingUrl, setGreetingUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState({ mobile: "", enabled: true, greeting: "" });

  const active = Boolean(user?.id) && !isImpersonating;

  useEffect(() => {
    if (!active || !user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("agent_inbound_settings")
        .select("mobile_forward_number, mobile_forward_enabled, voicemail_greeting_text, voicemail_greeting_url")
        .eq("agent_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error(`Couldn't load your call forwarding settings: ${error.message}`);
      } else if (data) {
        const next = {
          mobile: data.mobile_forward_number ?? "",
          enabled: data.mobile_forward_enabled ?? true,
          greeting: data.voicemail_greeting_text ?? "",
        };
        setMobile(next.mobile);
        setEnabled(next.enabled);
        setGreeting(next.greeting);
        setGreetingUrl(data.voicemail_greeting_url ?? null);
        setSaved(next);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, user?.id]);

  const isDirty = useMemo(
    () => mobile !== saved.mobile || enabled !== saved.enabled || greeting !== saved.greeting,
    [mobile, enabled, greeting, saved],
  );

  useEffect(() => {
    registerDirty("profile-call-forwarding", active && isDirty);
    return () => registerDirty("profile-call-forwarding", false);
  }, [active, isDirty, registerDirty]);

  const handleSave = useCallback(async () => {
    if (!user?.id || !orgId || isImpersonating) return;
    const parsed = callForwardingSchema.safeParse({ mobile, greeting });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "mobile" || field === "greeting") next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const normalized = normalizeMobileForwardNumber(mobile);
      const { error } = await supabase.from("agent_inbound_settings").upsert(
        {
          agent_id: user.id,
          organization_id: orgId,
          mobile_forward_number: normalized,
          mobile_forward_enabled: enabled,
          voicemail_greeting_text: greeting.trim() || null,
          voicemail_greeting_url: greetingUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id" },
      );
      if (error) throw error;
      const next = { mobile: normalized ?? "", enabled, greeting: greeting.trim() };
      setMobile(next.mobile);
      setGreeting(next.greeting);
      setSaved(next);
      toast.success("Call forwarding saved.");
    } catch (e) {
      toast.error(`Couldn't save call forwarding: ${describeError(e)}`);
    } finally {
      setSaving(false);
    }
  }, [user?.id, orgId, isImpersonating, mobile, enabled, greeting, greetingUrl]);

  if (!active) return null;

  return (
    <ProfileSettingsSection title="Call Forwarding" description="Send unanswered calls to your mobile." data-testid="profile-call-forwarding">
      {activationPending && <CallForwardingActivationNotice engine={engine} />}
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/30" />
      ) : (
        <>
          <CallForwardingFormFields
            enabled={enabled}
            onEnabledChange={setEnabled}
            mobile={mobile}
            onMobileChange={(value) => {
              setMobile(value);
              if (errors.mobile) setErrors((p) => ({ ...p, mobile: undefined }));
            }}
            mobileError={errors.mobile}
            greeting={greeting}
            onGreetingChange={(value) => {
              setGreeting(value);
              if (errors.greeting) setErrors((p) => ({ ...p, greeting: undefined }));
            }}
            greetingError={errors.greeting}
            greetingMaxLength={GREETING_MAX}
          />
          <Button onClick={() => void handleSave()} disabled={saving || !isDirty} variant="outline" size="sm" className="rounded-lg">
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save call forwarding"
            )}
          </Button>
        </>
      )}
    </ProfileSettingsSection>
  );
};

export default ProfileCallForwardingSection;
