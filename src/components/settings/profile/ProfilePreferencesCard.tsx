import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { SlidersHorizontal, ChevronDown, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { z } from "zod";

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
    const result = preferencesSchema.safeParse({
      emailNotifs,
      smsNotifs,
      pushNotifs,
      timezone,
      isDark,
    });

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
      setSaved({
        emailNotifs,
        smsNotifs,
        pushNotifs,
        timezone,
        isDark,
      });
      toast({
        title: "Preferences saved.",
        className: "bg-success text-success-foreground",
      });
    } catch (err: any) {
      toast({
        title: "Failed to save preferences",
        description: err.message,
        variant: "destructive",
      });
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
                <p className="text-xs text-muted-foreground">Theme, notifications, and timezone</p>
              </div>
            </div>
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 border-t border-border/50 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Dark Mode</p>
                <p className="text-xs text-muted-foreground">Toggle between dark and light interface</p>
              </div>
              <Switch checked={isDark} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-sm font-semibold text-foreground mb-3">Notifications</p>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Email Notifications</p>
                    <p className="text-xs text-muted-foreground">Receive updates and alerts via email</p>
                  </div>
                  <Switch checked={emailNotifs} onCheckedChange={setEmailNotifs} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">SMS Notifications</p>
                    <p className="text-xs text-muted-foreground">Get text message alerts for important events</p>
                  </div>
                  <Switch checked={smsNotifs} onCheckedChange={setSmsNotifs} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Desktop Push Notifications</p>
                    <p className="text-xs text-muted-foreground">Show browser notifications for real-time updates</p>
                  </div>
                  <Switch checked={pushNotifs} onCheckedChange={setPushNotifs} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-sm font-medium text-foreground">Timezone</p>
              </div>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {US_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
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
