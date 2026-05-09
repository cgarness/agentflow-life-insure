import React from "react";
import { useOrganization } from "@/hooks/useOrganization";
import { TrustHubSection } from "./phone/TrustHubSection";
import type { PhoneSettingsController } from "./phone/usePhoneSettingsController";

export interface PhoneSettingsProps {
  phone: PhoneSettingsController;
}

const PhoneSettings: React.FC<PhoneSettingsProps> = ({ phone: s }) => {
  const { role, isSuperAdmin } = useOrganization();
  const canManageTrustHub = isSuperAdmin || role === "Admin" || role === "Super Admin";

  return (
    <TrustHubSection
      trustHubProfileSid={s.trustHubProfileSid}
      numbers={s.numbers}
      canManageTrustHub={canManageTrustHub}
      onTrustHubRefresh={s.fetchData}
    />
  );
};

export default PhoneSettings;
