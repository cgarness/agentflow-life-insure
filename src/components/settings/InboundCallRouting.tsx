import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const ROUTING_ID = "00000000-0000-0000-0000-000000000000";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface BHRow {
  id: string;
  day_of_week: number;
  is_open: boolean;
  open_time: string;
  close_time: string;
}

interface RoutingSettings {
  routing_mode: string;
  auto_create_lead: boolean;
  after_hours_sms_enabled: boolean;
  after_hours_sms: string;
}

const InboundCallRouting: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState<BHRow[]>([]);
  const [routing, setRouting] = useState<RoutingSettings>({
    routing_mode: "round_robin",
    auto_create_lead: false,
    after_hours_sms_enabled: false,
    after_hours_sms: "Thank you for calling. We are currently closed. We will return your call during business hours.",
  });

  const [savingHours, setSavingHours] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);
  const [savingAfterHours, setSavingAfterHours] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [bhRes, rtRes] = await Promise.all([
      supabase.from("business_hours").select("*").order("day_of_week"),
      (supabase as any).from("inbound_routing_settings").select("*").eq("id", ROUTING_ID).maybeSingle(),
    ]);

    if (bhRes.error || rtRes.error) {
      toast.error("Failed to load data. Please try again.");
      setLoading(false);
      return;
    }

    setHours(
      (bhRes.data || []).map((r: any) => ({
        id: r.id,
        day_of_week: r.day_of_week,
        is_open: r.is_open ?? true,
        open_time: r.open_time || "09:00",
        close_time: r.close_time || "17:00",
      }))
    );

    if (rtRes.data) {
      const d = rtRes.data as any;
      setRouting({
        routing_mode: d.routing_mode || "round_robin",
        auto_create_lead: !!d.auto_create_lead,
        after_hours_sms_enabled: !!d.after_hours_sms_enabled,
        after_hours_sms: d.after_hours_sms || "",
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveBusinessHours = async () => {
    setSavingHours(true);
    await new Promise((r) => setTimeout(r, 800));
    for (const h of hours) {
      const { error } = await supabase
        .from("business_hours")
        .update({ is_open: h.is_open, open_time: h.open_time, close_time: h.close_time })
        .eq("id", h.id);
      if (error) {
        toast.error("Failed to save business hours.");
        setSavingHours(false);
        return;
      }
    }
    setSavingHours(false);
    toast.success("Business hours saved");
  };

  const saveRoutingMode = async () => {
    setSavingRouting(true);
    await new Promise((r) => setTimeout(r, 800));
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({ routing_mode: routing.routing_mode, updated_at: new Date().toISOString() })
      .eq("id", ROUTING_ID);
    setSavingRouting(false);
    if (error) {
      toast.error("Failed to save routing mode.");
      return;
    }
    toast.success("Routing mode saved");
  };

  const toggleAutoCreate = async (val: boolean) => {
    setRouting((r) => ({ ...r, auto_create_lead: val }));
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({ auto_create_lead: val, updated_at: new Date().toISOString() })
      .eq("id", ROUTING_ID);
    if (error) {
      toast.error("Failed to save setting.");
      return;
    }
    toast.success("Setting saved");
  };

  const saveAfterHours = async () => {
    setSavingAfterHours(true);
    await new Promise((r) => setTimeout(r, 800));
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({
        after_hours_sms_enabled: routing.after_hours_sms_enabled,
        after_hours_sms: routing.after_hours_sms,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ROUTING_ID);
    setSavingAfterHours(false);
    if (error) {
      toast.error("Failed to save after-hours settings.");
      return;
    }
    toast.success("After-hours settings saved");
  };

  const updateHour = (idx: number, field: keyof BHRow, value: any) => {
    setHours((prev) => prev.map((h, i) => (i === idx ? { ...h, [field]: value } : h)));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-foreground">Inbound Call Routing</h3>

      {/* Card 1 — Business Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Business Hours</CardTitle>
          <CardDescription>Define when your team accepts inbound calls.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {hours.map((h, idx) => (
              <div key={h.id} className="flex items-center gap-4">
                <span className="w-24 text-sm font-medium text-foreground">{DAY_NAMES[h.day_of_week]}</span>
                <Switch checked={h.is_open} onCheckedChange={(v) => updateHour(idx, "is_open", v)} />
                <input
                  type="time"
                  value={h.open_time}
                  onChange={(e) => updateHour(idx, "open_time", e.target.value)}
                  disabled={!h.is_open}
                  className="h-9 px-2 rounded-md border border-input bg-background text-sm disabled:opacity-40"
                />
                <span className="text-muted-foreground">—</span>
                <input
                  type="time"
                  value={h.close_time}
                  onChange={(e) => updateHour(idx, "close_time", e.target.value)}
                  disabled={!h.is_open}
                  className="h-9 px-2 rounded-md border border-input bg-background text-sm disabled:opacity-40"
                />
              </div>
            ))}
          </div>
          <Button onClick={saveBusinessHours} disabled={savingHours}>
            {savingHours ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Business Hours"}
          </Button>
        </CardContent>
      </Card>

      {/* Card 2 — Routing Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Inbound Routing</CardTitle>
          <CardDescription>How inbound calls are distributed when agents are available.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={routing.routing_mode}
            onValueChange={(v) => setRouting((r) => ({ ...r, routing_mode: v }))}
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
          <Button onClick={saveRoutingMode} disabled={savingRouting}>
            {savingRouting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Card 3 — Lead Auto-Creation */}
      <Card>
        <CardHeader>
          <CardTitle>Auto-Create Leads on Inbound</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground">Automatically create a new lead when an unknown number calls in</p>
            <Switch checked={routing.auto_create_lead} onCheckedChange={toggleAutoCreate} />
          </div>
        </CardContent>
      </Card>

      {/* Card 4 — After-Hours SMS */}
      <Card>
        <CardHeader>
          <CardTitle>After-Hours Auto-Reply</CardTitle>
          <CardDescription>Send an automatic SMS when someone calls outside business hours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Enable after-hours SMS reply</p>
            <Switch
              checked={routing.after_hours_sms_enabled}
              onCheckedChange={(v) => setRouting((r) => ({ ...r, after_hours_sms_enabled: v }))}
            />
          </div>
          <div className="space-y-1.5">
            <Textarea
              value={routing.after_hours_sms}
              onChange={(e) => {
                if (e.target.value.length <= 160) setRouting((r) => ({ ...r, after_hours_sms: e.target.value }));
              }}
              disabled={!routing.after_hours_sms_enabled}
              maxLength={160}
              rows={3}
              className="disabled:opacity-40"
            />
            <p className="text-xs text-muted-foreground text-right">{routing.after_hours_sms.length}/160</p>
          </div>
          <Button onClick={saveAfterHours} disabled={savingAfterHours}>
            {savingAfterHours ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default InboundCallRouting;
