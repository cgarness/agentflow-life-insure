import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { RoutingSettings } from "./types";

interface Props {
  settings: RoutingSettings;
  onChange: (patch: Partial<RoutingSettings>) => void;
}

const AfterHoursSmsCard: React.FC<Props> = ({ settings, onChange }) => {
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({
        after_hours_sms_enabled: settings.after_hours_sms_enabled,
        after_hours_sms: settings.after_hours_sms,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", settings.organization_id);
    setSaving(false);
    if (error) {
      toast.error("Failed to save after-hours settings.");
      return;
    }
    toast.success("After-hours settings saved");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>After-Hours Auto-Reply</CardTitle>
        <CardDescription>Send an automatic SMS when someone calls outside business hours.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Enable after-hours SMS reply</p>
          <Switch
            checked={settings.after_hours_sms_enabled}
            onCheckedChange={(v) => onChange({ after_hours_sms_enabled: v })}
          />
        </div>
        <div className="space-y-1.5">
          <Textarea
            value={settings.after_hours_sms}
            onChange={(e) => {
              if (e.target.value.length <= 160) onChange({ after_hours_sms: e.target.value });
            }}
            disabled={!settings.after_hours_sms_enabled}
            maxLength={160}
            rows={3}
            className="disabled:opacity-40"
          />
          <p className="text-xs text-muted-foreground text-right">{settings.after_hours_sms.length}/160</p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default AfterHoursSmsCard;
