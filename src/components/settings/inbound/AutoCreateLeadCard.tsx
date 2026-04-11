import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { RoutingSettings } from "./types";

interface Props {
  settings: RoutingSettings;
  onChange: (patch: Partial<RoutingSettings>) => void;
}

const AutoCreateLeadCard: React.FC<Props> = ({ settings, onChange }) => {
  const toggle = async (val: boolean) => {
    onChange({ auto_create_lead: val });
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({ auto_create_lead: val, updated_at: new Date().toISOString() })
      .eq("organization_id", settings.organization_id);
    if (error) {
      toast.error("Failed to save setting.");
      onChange({ auto_create_lead: !val });
      return;
    }
    toast.success("Setting saved");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-Create Leads on Inbound</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">Automatically create a new lead when an unknown number calls in</p>
          <Switch checked={settings.auto_create_lead} onCheckedChange={toggle} />
        </div>
      </CardContent>
    </Card>
  );
};

export default AutoCreateLeadCard;
