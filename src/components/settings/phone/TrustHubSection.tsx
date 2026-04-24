import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/40 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="w-5 h-5 text-primary" />
          Trust Hub
        </CardTitle>
        <CardDescription>
          Register your agency with Twilio Trust Hub so carriers can treat your outbound life insurance calls as verified business
          traffic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <TrustHubRegistrationPanel
          canManageTrustHub={canManageTrustHub}
          trustHubProfileSid={trustHubProfileSid}
          numbers={numbers}
          onRefresh={onTrustHubRefresh}
        />
      </CardContent>
    </Card>
  );
};
