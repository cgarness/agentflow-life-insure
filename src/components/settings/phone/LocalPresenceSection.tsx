import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MapPin } from "lucide-react";

type Props = {
  localPresenceEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  uniqueAreaCodes: string[];
};

export const LocalPresenceSection: React.FC<Props> = ({ localPresenceEnabled, onToggle, uniqueAreaCodes }) => {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/40 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="w-4 h-4 text-primary" />
          Local presence (area code matching)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Enable local presence</p>
            <p className="text-xs text-muted-foreground">
              Local presence uses your active org numbers to choose the best caller ID for outbound dials based on the lead&apos;s area code. When off, the dialer uses your default number.
            </p>
          </div>
          <Switch checked={localPresenceEnabled} onCheckedChange={(c) => onToggle(c === true)} />
        </div>
        <div className="bg-accent/50 rounded-lg p-3">
          <p className="text-sm text-foreground">
            You have numbers covering <span className="font-semibold">{uniqueAreaCodes.length}</span> area code{uniqueAreaCodes.length !== 1 ? "s" : ""}
            {uniqueAreaCodes.length > 0 && (
              <>
                : <span className="font-mono text-xs">{uniqueAreaCodes.join(", ")}</span>
              </>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
