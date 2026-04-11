import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { RoutingSettings } from "./types";

interface Props {
  settings: RoutingSettings;
  onChange: (patch: Partial<RoutingSettings>) => void;
}

const ContactsOnlyCard: React.FC<Props> = ({ settings, onChange }) => {
  const toggle = async (val: boolean) => {
    onChange({ contacts_only: val });
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({ contacts_only: val, updated_at: new Date().toISOString() })
      .eq("organization_id", settings.organization_id);
    if (error) {
      toast.error("Failed to save setting.");
      onChange({ contacts_only: !val });
      return;
    }
    toast.success("Setting saved");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts-Only Mode</CardTitle>
        <CardDescription>When enabled, only calls from existing contacts ring your team. Unknown callers are sent straight to voicemail.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex-1 pr-4">
            <p className="text-sm font-medium text-foreground">Only ring for known contacts</p>
            <p className="text-xs text-muted-foreground">Unknown numbers will be greeted and routed to voicemail without disturbing agents.</p>
          </div>
          <Switch checked={settings.contacts_only} onCheckedChange={toggle} />
        </div>
      </CardContent>
    </Card>
  );
};

export default ContactsOnlyCard;
