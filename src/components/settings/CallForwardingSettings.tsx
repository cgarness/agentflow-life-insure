import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";

const normalizePhone = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && raw.trim().startsWith("+")) return `+${digits}`;
  return null;
};

const CallForwardingSettings: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inboundEnabled, setInboundEnabled] = useState(true);
  const [forwardingEnabled, setForwardingEnabled] = useState(false);
  const [forwardingNumber, setForwardingNumber] = useState("");
  const [numberError, setNumberError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("inbound_enabled, call_forwarding_enabled, call_forwarding_number")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      toast.error("Failed to load call settings.");
      setLoading(false);
      return;
    }

    if (data) {
      const d = data as any;
      setInboundEnabled(d.inbound_enabled ?? true);
      setForwardingEnabled(!!d.call_forwarding_enabled);
      setForwardingNumber(d.call_forwarding_number || "");
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const toggleInbound = async (val: boolean) => {
    setInboundEnabled(val);
    const { error } = await supabase
      .from("profiles")
      .update({ inbound_enabled: val } as any)
      .eq("id", user!.id);
    if (error) {
      toast.error("Failed to update inbound setting.");
      setInboundEnabled(!val);
      return;
    }
    toast.success(val ? "Inbound calls enabled" : "Inbound calls paused");
  };

  const saveForwarding = async () => {
    setNumberError(null);

    let normalized: string | null = null;
    if (forwardingEnabled) {
      normalized = normalizePhone(forwardingNumber);
      if (!normalized) {
        setNumberError("Enter a valid US phone number (10 digits).");
        return;
      }
    }

    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        call_forwarding_enabled: forwardingEnabled,
        call_forwarding_number: forwardingEnabled ? normalized : null,
      } as any)
      .eq("id", user!.id);
    setSaving(false);

    if (error) {
      toast.error("Failed to save call forwarding.");
      return;
    }
    if (forwardingEnabled && normalized) setForwardingNumber(normalized);
    toast.success("Call forwarding saved");
  };

  if (loading) {
    return (
      <Card className="bg-card border-border rounded-xl mb-6">
        <CardHeader><CardTitle className="text-base">Call Handling</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border rounded-xl mb-6">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Phone className="w-5 h-5 text-primary" />
        </div>
        <div>
          <CardTitle className="text-base">Call Handling</CardTitle>
          <CardDescription>Control whether inbound calls ring your web dialer or get forwarded to another number.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex-1 pr-4">
            <p className="text-sm font-medium text-foreground">Accept Inbound Calls</p>
            <p className="text-xs text-muted-foreground">
              When off, inbound calls will skip your WebRTC phone and go to the next available agent.
            </p>
          </div>
          <Switch checked={inboundEnabled} onCheckedChange={toggleInbound} />
        </div>

        <div className="border-t border-border pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <p className="text-sm font-medium text-foreground">Forward Calls to My Cell</p>
              <p className="text-xs text-muted-foreground">
                Ring an external number (like your mobile) instead of the web dialer when calls route to you.
              </p>
            </div>
            <Switch checked={forwardingEnabled} onCheckedChange={setForwardingEnabled} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cf-number" className="text-sm font-medium text-foreground">Forwarding Number</Label>
            <Input
              id="cf-number"
              type="tel"
              placeholder="(555) 555-5555"
              value={forwardingNumber}
              onChange={(e) => { setForwardingNumber(e.target.value); setNumberError(null); }}
              disabled={!forwardingEnabled}
              className="max-w-xs disabled:opacity-40"
            />
            {numberError && <p className="text-xs text-destructive">{numberError}</p>}
          </div>

          <Button onClick={saveForwarding} disabled={saving} className="px-6">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Call Forwarding"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CallForwardingSettings;
