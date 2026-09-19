import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { useTheme } from "next-themes";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { SlidersHorizontal, ChevronDown, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { z } from "zod";
import { ProfileSettingsSection } from "./ProfileSettingsSection";
import { ProfileNotificationsSection } from "./ProfileNotificationsSection";
import { ProfileCallForwardingSection } from "./ProfileCallForwardingSection";

const US_TIMEZONES = [
  "Eastern Time (US & Canada)",
  "Central Time (US & Canada)",
  "Mountain Time (US & Canada)",
  "Pacific Time (US & Canada)",
  "Alaska Time",
  "Hawaii Time",
];

const preferencesSchema = z.object({
  emailNotifs: z.boolean(),
  smsNotifs: z.boolean(),
  pushNotifs: z.boolean(),
  timezone: z.string(),
  isDark: z.boolean(),
});

/**
 * Preferences — Appearance · Notifications · Call Forwarding · Timezone.
 *
 * Everything here except Call Forwarding is stored on `profiles` and saved by this card's button.
 * Call Forwarding owns its own state and save because it writes a different table
 * (`agent_inbound_settings`) with its own failure modes; it is hidden under "View As".
 */
export const ProfilePreferencesCard: React.FC = () => {
  const { profile, updateProfile } = useAuth();
  const { registerDirty } = useUnsavedChanges();
  const { theme, setTheme } = useTheme();

  const [emailNotifs, setEmailNotifs] = useState(profile?.email_notifications_enabled ?? true);
  const [smsNotifs, setSmsNotifs] = useState(profile?.sms_notifications_enabled ?? false);
  const [pushNotifs, setPushNotifs] = useState(profile?.push_notifications_enabled ?? true);
  const [timezone, setTimezone] = useState(profile?.timezone ?? "Eastern Time (US & Canada)");
  const [prefSaving, setPrefSaving] = useState(false);

  const isDark = theme === "dark";

  const [saved, setSaved] = useState({
    emailNotifs: profile?.email_notifications_enabled ?? true,
    smsNotifs: profile?.sms_notifications_enabled ?? false,
    pushNotifs: profile?.push_notifications_enabled ?? true,
    timezone: profile?.timezone ?? "Eastern Time (US & Canada)",
    isDark: profile?.theme_preference === "dark",
  });

  useEffect(() => {
    if (profile) {
      setEmailNotifs(profile.email_notifications_enabled ?? true);
      setSmsNotifs(profile.sms_notifications_enabled ?? false);
      setPushNotifs(profile.push_notifications_enabled ?? true);
      setTimezone(profile.timezone || "Eastern Time (US & Canada)");
      setSaved({
        emailNotifs: profile.email_notifications_enabled ?? true,
        smsNotifs: profile.sms_notifications_enabled ?? false,
        pushNotifs: profile.push_notifications_enabled ?? true,
        timezone: profile.timezone || "Eastern Time (US & Canada)",
        isDark: profile.theme_preference === "dark",
      });
    }
  }, [profile]);

  const isDirty = useMemo(() => {
    return (
      emailNotifs !== saved.emailNotifs ||
      smsNotifs !== saved.smsNotifs ||
      pushNotifs !== saved.pushNotifs ||
      timezone !== saved.timezone ||
      isDark !== saved.isDark
    );
  }, [emailNotifs, smsNotifs, pushNotifs, timezone, isDark, saved]);

  useEffect(() => {
    registerDirty("profile-preferences", isDirty);
    return () => registerDirty("profile-preferences", false);
  }, [isDirty, registerDirty]);

  const handleSavePreferences = async () => {
    const result = preferencesSchema.safeParse({ emailNotifs, smsNotifs, pushNotifs, timezone, isDark });
    if (!result.success) return;

    setPrefSaving(true);
    try {
      await updateProfile({
        theme_preference: isDark ? "dark" : "light",
        email_notifications_enabled: emailNotifs,
        sms_notifications_enabled: smsNotifs,
        push_notifications_enabled: pushNotifs,
        timezone: timezone,
      });
      setSaved({ emailNotifs, smsNotifs, pushNotifs, timezone, isDark });
      toast({ title: "Preferences saved.", className: "bg-success text-success-foreground" });
    } catch (err: any) {
      toast({ title: "Failed to save preferences", description: err.message, variant: "destructive" });
    } finally {
      setPrefSaving(false);
    }
  };

  return (
    <Card className="bg-card border-border rounded-lg mb-6 overflow-hidden">
      <Collapsible defaultOpen={false} className="group">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                <SlidersHorizontal className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg">Preferences</CardTitle>
                <p className="text-xs text-muted-foreground">Appearance, notifications, call forwarding, and timezone</p>
              </div>
            </div>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 border-t border-border/50 pt-6">
            <ProfileSettingsSection title="Appearance">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-foreground">Dark mode</p>
                <Switch checked={isDark} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} aria-label="Dark mode" />
              </div>
            </ProfileSettingsSection>

            <ProfileNotificationsSection
              emailNotifs={emailNotifs}
              smsNotifs={smsNotifs}
              pushNotifs={pushNotifs}
              onPushChange={setPushNotifs}
            />

            <ProfileCallForwardingSection />

            <ProfileSettingsSection title="Timezone">
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                aria-label="Timezone"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-xs"
              >
                {US_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </ProfileSettingsSection>

            <div className="flex justify-start pt-4 border-t border-border/50">
              <Button onClick={handleSavePreferences} disabled={prefSaving || !isDirty} className="px-6 rounded-lg">
                {prefSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...
                  </>
                ) : (
                  "Save Preferences"
                )}
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
