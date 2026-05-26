import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Route, Voicemail, Forward, PhoneOff, ShieldAlert } from "lucide-react";

interface PhoneNumberRoutingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber: {
    id: string;
    phone_number: string;
    friendly_name: string | null;
    inbound_routing_mode?: string | null;
    voicemail_enabled?: boolean | null;
    fallback_action?: string | null;
    voicemail_greeting_text?: string | null;
    forwarding_number?: string | null;
  };
  onUpdate: () => void;
  organizationId: string;
}

export const PhoneNumberRoutingModal: React.FC<PhoneNumberRoutingModalProps> = ({
  open,
  onOpenChange,
  phoneNumber,
  organizationId,
  onUpdate
}) => {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({
    inbound_routing_mode: phoneNumber.inbound_routing_mode || "global",
    voicemail_enabled: phoneNumber.voicemail_enabled ?? true,
    fallback_action: phoneNumber.fallback_action || "global",
    voicemail_greeting_text: phoneNumber.voicemail_greeting_text || "",
    forwarding_number: phoneNumber.forwarding_number || "",
  });

  useEffect(() => {
    if (open) {
      setSettings({
        inbound_routing_mode: phoneNumber.inbound_routing_mode || "global",
        voicemail_enabled: phoneNumber.voicemail_enabled ?? true,
        fallback_action: phoneNumber.fallback_action || "global",
        voicemail_greeting_text: phoneNumber.voicemail_greeting_text || "",
        forwarding_number: phoneNumber.forwarding_number || "",
      });
    }
  }, [open, phoneNumber]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {
        inbound_routing_mode: settings.inbound_routing_mode === "global" ? null : settings.inbound_routing_mode,
        voicemail_enabled: settings.voicemail_enabled,
        fallback_action: settings.fallback_action === "global" ? null : settings.fallback_action,
        voicemail_greeting_text: settings.voicemail_greeting_text || null,
        forwarding_number: settings.forwarding_number || null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from("phone_numbers")
        .update(payload)
        .eq("id", phoneNumber.id)
        .eq("organization_id", organizationId);

      if (error) throw error;

      toast.success("Number configuration saved");
      onUpdate();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to save: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="w-5 h-5 text-primary" />
            Configure Inbound Journey
          </DialogTitle>
          <DialogDescription>
            Custom routing for {phoneNumber.friendly_name || phoneNumber.phone_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Routing Mode */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Routing Strategy</Label>
            <Select
              value={settings.inbound_routing_mode}
              onValueChange={(v) => setSettings(s => ({ ...s, inbound_routing_mode: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Use Global Default</SelectItem>
                <SelectItem value="assigned">Assigned Agent Only</SelectItem>
                <SelectItem value="all-ring">Ring All Agents</SelectItem>
                <SelectItem value="round_robin">Round Robin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Determines who rings when this specific number is called.
            </p>
          </div>

          <div className="h-px bg-border/50" />

          {/* Fallback Action */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-orange-500" />
              Unanswered / Fallback
            </Label>
            <Select
              value={settings.fallback_action}
              onValueChange={(v) => setSettings(s => ({ ...s, fallback_action: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select fallback" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Use Global Default</SelectItem>
                <SelectItem value="voicemail">Send to Voicemail</SelectItem>
                <SelectItem value="forward">Forward to External Number</SelectItem>
                <SelectItem value="hangup">Hang Up</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {settings.fallback_action === "voicemail" && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
              <Label className="text-xs font-medium">Custom Greeting (TTS)</Label>
              <Textarea 
                value={settings.voicemail_greeting_text}
                onChange={(e) => setSettings(s => ({ ...s, voicemail_greeting_text: e.target.value }))}
                placeholder="Leave blank to use global default..."
                className="resize-none min-h-[70px] text-sm"
              />
            </div>
          )}

          {settings.fallback_action === "forward" && (
            <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
              <Label className="text-xs font-medium">Forwarding Number</Label>
              <Input 
                value={settings.forwarding_number}
                onChange={(e) => setSettings(s => ({ ...s, forwarding_number: e.target.value }))}
                placeholder="+1 (555) 000-0000"
                className="text-sm"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Voicemail Enabled</Label>
              <p className="text-[11px] text-muted-foreground">Allow callers to leave recordings.</p>
            </div>
            <Switch 
              checked={settings.voicemail_enabled}
              onCheckedChange={(v) => setSettings(s => ({ ...s, voicemail_enabled: v }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
