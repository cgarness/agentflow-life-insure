import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Route } from "lucide-react";
import type { InboundRoutingStrategy } from "./phoneSettingsSecretJson";

type Props = {
  inboundRouting: InboundRoutingStrategy;
  onInboundRoutingChange: (v: InboundRoutingStrategy) => void;
  voicemailEnabled: boolean;
  onVoicemailEnabledChange: (v: boolean) => void;
};

export const InboundRoutingSection: React.FC<Props> = ({
  inboundRouting,
  onInboundRoutingChange,
  voicemailEnabled,
  onVoicemailEnabledChange,
}) => {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/40 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Route className="w-5 h-5 text-primary" />
          Inbound call routing
        </CardTitle>
        <CardDescription>Choose how inbound calls from your purchased numbers reach agents.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-3">
          <Label className="text-sm font-medium">Routing strategy</Label>
          <RadioGroup
            value={inboundRouting === "round-robin" ? "assigned" : inboundRouting}
            onValueChange={(v) => onInboundRoutingChange(v as InboundRoutingStrategy)}
            className="grid gap-3"
          >
            <label
              htmlFor="route-assigned"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background p-3 hover:bg-accent/30 transition-colors"
            >
              <RadioGroupItem value="assigned" id="route-assigned" className="mt-1" />
              <div>
                <p className="text-sm font-medium text-foreground">Assigned agent</p>
                <p className="text-xs text-muted-foreground">Ring the agent linked to that caller ID in AgentFlow.</p>
              </div>
            </label>
            <label
              htmlFor="route-all"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background p-3 hover:bg-accent/30 transition-colors"
            >
              <RadioGroupItem value="all-ring" id="route-all" className="mt-1" />
              <div>
                <p className="text-sm font-medium text-foreground">Ring all agents</p>
                <p className="text-xs text-muted-foreground">Every online agent rings; first to answer wins.</p>
              </div>
            </label>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-start gap-3 rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 opacity-60 cursor-not-allowed">
                  <RadioGroupItem value="round-robin" id="route-rr" className="mt-1 pointer-events-none" disabled />
                  <div>
                    <p className="text-sm font-medium text-foreground">Round robin</p>
                    <p className="text-xs text-muted-foreground">Distributes inbound calls evenly across the team.</p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                Coming soon — requires agent presence tracking
              </TooltipContent>
            </Tooltip>
          </RadioGroup>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Voicemail</p>
            <p className="text-xs text-muted-foreground">When off, unanswered inbound calls simply end instead of going to voicemail.</p>
          </div>
          <Switch checked={voicemailEnabled} onCheckedChange={onVoicemailEnabledChange} />
        </div>
      </CardContent>
    </Card>
  );
};
