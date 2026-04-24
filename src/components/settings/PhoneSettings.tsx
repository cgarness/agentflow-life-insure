import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@/hooks/useOrganization";
import { TwilioCredentialsSection } from "./phone/TwilioCredentialsSection";
import { TrustHubSection } from "./phone/TrustHubSection";
import { InboundRoutingSection } from "./phone/InboundRoutingSection";
import { NumberManagementSection } from "./phone/NumberManagementSection";
import { LocalPresenceSection } from "./phone/LocalPresenceSection";
import { formatPhone, usePhoneSettingsController } from "./phone/usePhoneSettingsController";

/**
 * TODO: Add `phone_settings.inbound_routing` and `voicemail_enabled` columns when migrations ship;
 * until then both live in `api_secret` JSON with `twilio_api_key_secret` and `local_presence_enabled`.
 */
const PhoneSettings: React.FC = () => {
  const s = usePhoneSettingsController();
  const { role, isSuperAdmin } = useOrganization();
  const canManageTrustHub = isSuperAdmin || role === "Admin" || role === "Super Admin";

  if (s.loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

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
        shakenStirEnabled={s.shakenStirEnabled}
        savingShaken={s.savingShaken}
        onShakenStirChange={(v) => void s.handleShakenStirChange(v)}
        numbers={s.numbers}
        formatPhone={formatPhone}
        canManageTrustHub={canManageTrustHub}
        onTrustHubRefresh={s.fetchData}
      />

      <InboundRoutingSection
        inboundRouting={s.inboundRouting}
        onInboundRoutingChange={(v) => void s.handleInboundRoutingChange(v)}
        voicemailEnabled={s.secretBundle.voicemail_enabled !== false}
        onVoicemailEnabledChange={(v) => void s.handleVoicemailToggle(v)}
      />

      <NumberManagementSection
        organizationId={s.organizationId ?? null}
        numbers={s.numbers}
        setNumbers={s.setNumbers}
        agents={s.agents}
        onRefresh={s.fetchData}
      />

      <LocalPresenceSection
        localPresenceEnabled={s.secretBundle.local_presence_enabled !== false}
        onToggle={(v) => void s.handleLocalPresenceToggle(v)}
        uniqueAreaCodes={s.uniqueAreaCodes}
      />
    </div>
  );
};

export default PhoneSettings;
