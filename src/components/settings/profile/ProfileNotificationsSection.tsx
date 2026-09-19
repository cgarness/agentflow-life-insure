import React, { useCallback, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useNotifications } from "@/contexts/NotificationContext";
import { ProfileSettingsSection } from "./ProfileSettingsSection";

type PushPermissionState = NotificationPermission | "unsupported";

const readPushPermission = (): PushPermissionState =>
  typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";

/**
 * Notifications. Email and SMS are not wired yet, so they stay visible but quiet and disabled rather
 * than pretending to work. The browser-permission states keep their recovery wording: an agent whose
 * browser has blocked alerts cannot fix it without being told where to look.
 */
export const ProfileNotificationsSection: React.FC<{
  emailNotifs: boolean;
  smsNotifs: boolean;
  pushNotifs: boolean;
  onPushChange: (enabled: boolean) => void;
}> = ({ emailNotifs, smsNotifs, pushNotifs, onPushChange }) => {
  const { requestPushPermission } = useNotifications();
  const [pushPermission, setPushPermission] = useState<PushPermissionState>(readPushPermission);

  // Browser permission is requested HERE, on the enable gesture — never on render.
  const handlePushToggle = useCallback(
    (enabled: boolean) => {
      onPushChange(enabled);
      if (enabled) void requestPushPermission().then((result) => setPushPermission(result));
    },
    [onPushChange, requestPushPermission],
  );

  const pushUnsupported = pushPermission === "unsupported";
  let pushStatus: string;
  if (pushUnsupported) {
    pushStatus = "Not supported in this browser.";
  } else if (!pushNotifs) {
    pushStatus = "Off.";
  } else if (pushPermission === "denied") {
    pushStatus = "Blocked in browser — allow notifications for this site in your browser's site settings, then toggle again.";
  } else if (pushPermission === "granted") {
    pushStatus = "Enabled.";
  } else {
    pushStatus = "Waiting for browser permission — allow the prompt, or toggle again to re-request.";
  }

  return (
    <ProfileSettingsSection title="Notifications">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Browser notifications</p>
          <p className="text-xs text-muted-foreground">Receive alerts while AgentFlow is in the background.</p>
          <p data-testid="push-status" className="mt-1 text-xs text-muted-foreground/90">
            {pushStatus}
          </p>
        </div>
        <Switch
          checked={pushNotifs}
          onCheckedChange={handlePushToggle}
          disabled={pushUnsupported}
          aria-label="Browser notifications"
        />
      </div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <p className="text-sm">Email · Not yet connected</p>
        <Switch checked={emailNotifs} disabled aria-label="Email notifications (not yet connected)" />
      </div>
      <div className="flex items-center justify-between gap-4 text-muted-foreground">
        <p className="text-sm">SMS · Not yet connected</p>
        <Switch checked={smsNotifs} disabled aria-label="SMS notifications (not yet connected)" />
      </div>
    </ProfileSettingsSection>
  );
};

export default ProfileNotificationsSection;
