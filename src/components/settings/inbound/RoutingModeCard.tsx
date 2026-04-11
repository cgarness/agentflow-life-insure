import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { RoutingSettings } from "./types";

interface Props {
  settings: RoutingSettings;
  onChange: (patch: Partial<RoutingSettings>) => void;
}

const RoutingModeCard: React.FC<Props> = ({ settings, onChange }) => {
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({ routing_mode: settings.routing_mode, updated_at: new Date().toISOString() })
      .eq("organization_id", settings.organization_id);
    setSaving(false);
    if (error) {
      toast.error("Failed to save routing mode.");
      return;
    }
    toast.success("Routing mode saved");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbound Routing</CardTitle>
        <CardDescription>How inbound calls are distributed when agents are available.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={settings.routing_mode}
          onValueChange={(v) => onChange({ routing_mode: v })}
        >
          <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-accent/50">
            <RadioGroupItem value="round_robin" id="rr" className="mt-1" />
            <Label htmlFor="rr" className="cursor-pointer">
              <p className="text-sm font-medium text-foreground">Round Robin</p>
              <p className="text-xs text-muted-foreground">Distribute calls evenly — goes to the agent who has been waiting the longest</p>
            </Label>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-accent/50">
            <RadioGroupItem value="assigned_agent" id="aa" className="mt-1" />
            <Label htmlFor="aa" className="cursor-pointer">
              <p className="text-sm font-medium text-foreground">Assigned Agent First</p>
              <p className="text-xs text-muted-foreground">Route to the contact's assigned agent first, fall back to round robin if unavailable</p>
            </Label>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-accent/50">
            <RadioGroupItem value="first_available" id="fa" className="mt-1" />
            <Label htmlFor="fa" className="cursor-pointer">
              <p className="text-sm font-medium text-foreground">First Available</p>
              <p className="text-xs text-muted-foreground">Ring the first agent with Available status — fastest connection</p>
            </Label>
          </div>
        </RadioGroup>
        <Button onClick={save} disabled={saving}>
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default RoutingModeCard;
