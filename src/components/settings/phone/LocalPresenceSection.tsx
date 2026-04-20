import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MapPin, Info } from "lucide-react";

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
              When on, the dialer prefers caller IDs that match the lead&apos;s area code. When off, it uses your default number.
            </p>
          </div>
          <Switch checked={localPresenceEnabled} onCheckedChange={(c) => onToggle(c === true)} />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          Routing, voicemail, local presence, and your Twilio API key secret share the secured settings bundle column until dedicated fields are added.
        </p>
        <div className="bg-accent/50 rounded-lg p-3">
          <p className="text-sm text-foreground">
            You have numbers covering <span className="font-semibold">{uniqueAreaCodes.length}</span> area code{uniqueAreaCodes.length !== 1 ? "s" : ""}
            {uniqueAreaCodes.length > 0 && (
              <>
                : <span className="font-mono text-xs">{uniqueAreaCodes.join(", ")}</span>
              </>
            )}
          </p>
          {uniqueAreaCodes.length < 3 && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Info className="w-3 h-3" /> Tip: add numbers in additional area codes to improve answer rates when dialing term-life leads out of state.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
