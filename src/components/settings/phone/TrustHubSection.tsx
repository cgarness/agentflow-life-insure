import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Shield } from "lucide-react";

export type TrustNumberRow = {
  id: string;
  phone_number: string;
  shaken_stir_attestation?: string | null;
  attestation_level?: string | null;
  trust_hub_status?: string | null;
};

type Props = {
  trustHubProfileSid: string | null;
  shakenStirEnabled: boolean;
  savingShaken: boolean;
  onShakenStirChange: (enabled: boolean) => void;
  numbers: TrustNumberRow[];
  formatPhone: (n: string) => string;
};

export const TrustHubSection: React.FC<Props> = ({
  trustHubProfileSid,
  shakenStirEnabled,
  savingShaken,
  onShakenStirChange,
  numbers,
  formatPhone,
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
        <div className="rounded-lg border border-border/50 bg-muted/15 p-4 space-y-2">
          <p className="text-sm font-medium text-foreground">Trust Hub status</p>
          {trustHubProfileSid ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/20">Registered</Badge>
              <code className="text-xs font-mono text-muted-foreground break-all">{trustHubProfileSid}</code>
            </div>
          ) : (
            <div className="space-y-1">
              <Badge variant="secondary">Not configured</Badge>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Register your business with Twilio Trust Hub to improve answer rates. This can be done in your Twilio Console.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">SHAKEN/STIR attestation</p>
            <p className="text-xs text-muted-foreground">Leave on so signed outbound calls request full attestation when your carrier supports it.</p>
          </div>
          <Switch disabled={savingShaken} checked={shakenStirEnabled} onCheckedChange={onShakenStirChange} />
        </div>

        {numbers.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Per-number reputation</p>
            <ul className="max-h-48 overflow-y-auto divide-y divide-border/60 rounded-lg border border-border/50">
              {numbers.map((n) => {
                const att = (n.shaken_stir_attestation || n.attestation_level || "—").toString();
                const th = (n.trust_hub_status || "—").toString();
                return (
                  <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <span className="font-mono text-foreground">{formatPhone(n.phone_number)}</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        STIR {att}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        Trust {th}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-muted-foreground">Trust Hub registration from AgentFlow is Phase&nbsp;14 — this view is informational.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
