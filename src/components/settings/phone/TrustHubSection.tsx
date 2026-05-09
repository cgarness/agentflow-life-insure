import React from "react";
import { Shield } from "lucide-react";
import { TrustHubRegistrationPanel } from "./TrustHubRegistrationPanel";
import type { TrustNumberRow } from "./trustHubTypes";

export type { TrustNumberRow } from "./trustHubTypes";

type Props = {
  trustHubProfileSid: string | null;
  numbers: TrustNumberRow[];
  canManageTrustHub: boolean;
  onTrustHubRefresh: () => Promise<void>;
};

export const TrustHubSection: React.FC<Props> = ({
  trustHubProfileSid,
  numbers,
  canManageTrustHub,
  onTrustHubRefresh,
}) => {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">Twilio Trust Hub</h3>
          <p className="text-xs text-muted-foreground">
            Register your agency to verify your business identity with Twilio and improve call answer rates.
          </p>
        </div>
      </div>
      <TrustHubRegistrationPanel
        canManageTrustHub={canManageTrustHub}
        trustHubProfileSid={trustHubProfileSid}
        numbers={numbers}
        onRefresh={onTrustHubRefresh}
      />
    </div>
  );
};
