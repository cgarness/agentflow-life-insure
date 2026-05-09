import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TwilioCredentialsSection } from "./phone/TwilioCredentialsSection";
import { usePhoneSettingsController } from "./phone/usePhoneSettingsController";

const TwilioConnection: React.FC = () => {
  const phone = usePhoneSettingsController();

  if (phone.loading) {
    return (
      <div className="space-y-4">
        <h3 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
          <span className="h-6 w-1 shrink-0 rounded-full bg-border" aria-hidden />
          <span className="text-foreground">Twilio Connection</span>
        </h3>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
        <span className="h-6 w-1 shrink-0 rounded-full bg-border" aria-hidden />
        <span className="text-foreground">Twilio Connection</span>
      </h3>
      <TwilioCredentialsSection
        accountSid={phone.accountSid}
        setAccountSid={phone.setAccountSid}
        authToken={phone.authToken}
        setAuthToken={phone.setAuthToken}
        apiKeySid={phone.apiKeySid}
        setApiKeySid={phone.setApiKeySid}
        apiKeySecret={phone.apiKeySecret}
        setApiKeySecret={phone.setApiKeySecret}
        applicationSid={phone.applicationSid}
        setApplicationSid={phone.setApplicationSid}
        recordingEnabled={phone.recordingEnabled}
        setRecordingEnabled={phone.setRecordingEnabled}
        hasChanges={phone.hasChanges}
        saving={phone.saving}
        onSave={phone.handleSave}
        testing={phone.testing}
        onTest={phone.handleTest}
        testResult={phone.testResult}
      />
    </div>
  );
};

export default TwilioConnection;
