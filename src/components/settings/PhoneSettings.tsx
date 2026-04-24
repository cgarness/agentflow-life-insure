import React from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { TwilioCredentialsSection } from "./phone/TwilioCredentialsSection";
import { TrustHubSection } from "./phone/TrustHubSection";
import type { PhoneSettingsController } from "./phone/usePhoneSettingsController";

/**
 * TODO: Add `phone_settings.inbound_routing` and `voicemail_enabled` columns when migrations ship;
 * until then both live in `api_secret` JSON with `twilio_api_key_secret` and `local_presence_enabled`.
 *
 * Inbound routing (WebRTC strategy) and local presence live under Phone System → **Inbound Routing** and **Phone Numbers** tabs.
 * Number inventory / purchase: **Phone Numbers** tab (`NumberManagementSection`).
 */
export interface PhoneSettingsProps {
  phone: PhoneSettingsController;
}

const PhoneSettings: React.FC<PhoneSettingsProps> = ({ phone: s }) => {
  const { role, isSuperAdmin } = useOrganization();
  const canManageTrustHub = isSuperAdmin || role === "Admin" || role === "Super Admin";

  return (
    <div className="space-y-6">
      {isSuperAdmin && (
        <TwilioCredentialsSection
          accountSid={s.accountSid}
          setAccountSid={s.setAccountSid}
          authToken={s.authToken}
          setAuthToken={s.setAuthToken}
          apiKeySid={s.apiKeySid}
          setApiKeySid={s.setApiKeySid}
          apiKeySecret={s.apiKeySecret}
          setApiKeySecret={s.setApiKeySecret}
          applicationSid={s.applicationSid}
          setApplicationSid={s.setApplicationSid}
          recordingEnabled={s.recordingEnabled}
          setRecordingEnabled={s.setRecordingEnabled}
          hasChanges={s.hasChanges}
          saving={s.saving}
          onSave={s.handleSave}
          testing={s.testing}
          onTest={s.handleTest}
          testResult={s.testResult}
        />
      )}

      <TrustHubSection
        trustHubProfileSid={s.trustHubProfileSid}
        numbers={s.numbers}
        canManageTrustHub={canManageTrustHub}
        onTrustHubRefresh={s.fetchData}
      />
    </div>
  );
};

export default PhoneSettings;
