import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Shield } from "lucide-react";
import { TrustHubRegistrationPanel } from "./TrustHubRegistrationPanel";
import type { TrustNumberRow } from "./trustHubTypes";

export type { TrustNumberRow } from "./trustHubTypes";

type Props = {
  trustHubProfileSid: string | null;
  shakenStirEnabled: boolean;
  savingShaken: boolean;
  onShakenStirChange: (enabled: boolean) => void;
  numbers: TrustNumberRow[];
  formatPhone: (n: string) => string;
  canManageTrustHub: boolean;
  onTrustHubRefresh: () => Promise<void>;
};

export const TrustHubSection: React.FC<Props> = ({
  trustHubProfileSid,
  shakenStirEnabled,
  savingShaken,
  onShakenStirChange,
  numbers,
  formatPhone,
  canManageTrustHub,
  onTrustHubRefresh,
}) => {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/40 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="w-5 h-5 text-primary" />
          Number reputation & trust
        </CardTitle>
        <CardDescription>
          Trust Hub and SHAKEN/STIR help carriers see your calls as legitimate — especially important for life insurance outreach.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <TrustHubRegistrationPanel
          canManageTrustHub={canManageTrustHub}
          trustHubProfileSid={trustHubProfileSid}
          numbers={numbers}
          formatPhone={formatPhone}
          onRefresh={onTrustHubRefresh}
        />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">SHAKEN/STIR attestation</p>
            <p className="text-xs text-muted-foreground">Leave on so signed outbound calls request full attestation when your carrier supports it.</p>
          </div>
          <Switch disabled={savingShaken} checked={shakenStirEnabled} onCheckedChange={onShakenStirChange} />
        </div>

        {numbers.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Per-number STIR and Trust labels above reflect your Twilio configuration. Default outbound numbers should match your agency&apos;s verified business identity.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
