import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, PhoneCall, Clock, Voicemail, Forward, MessageSquare, Route, ShieldAlert, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface BHRow {
  id: string;
  day_of_week: number;
  is_open: boolean;
  open_time: string;
  close_time: string;
}

interface RoutingSettings {
  id?: string;
  routing_mode: string;
  auto_create_lead: boolean;
  after_hours_sms_enabled: boolean;
  after_hours_sms: string;
  voicemail_enabled: boolean;
  fallback_action: "voicemail" | "forward" | "hangup";
  voicemail_greeting_text: string;
  voicemail_greeting_url: string;
  forwarding_number: string;
}

const defaultRoutingSettings: RoutingSettings = {
  routing_mode: "assigned",
  auto_create_lead: false,
  after_hours_sms_enabled: false,
  after_hours_sms: "Thank you for calling. We are currently closed. We will return your call during business hours.",
  voicemail_enabled: true,
  fallback_action: "voicemail",
  voicemail_greeting_text: "Thank you for calling. No one is available to take your call right now. Please leave a message after the tone.",
  voicemail_greeting_url: "",
  forwarding_number: "",
};

export const InboundRoutingManager: React.FC = () => {
  const { organizationId } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [hours, setHours] = useState<BHRow[]>([]);
  const [routing, setRouting] = useState<RoutingSettings>(defaultRoutingSettings);

  const fetchData = useCallback(async () => {
    if (!organizationId) return;
    
    setLoading(true);
    
    // Fetch Business Hours
    const { data: bhData, error: bhError } = await supabase
      .from("business_hours")
      .select("*")
      .eq("organization_id", organizationId)
      .order("day_of_week");
      
    if (bhError) {
      console.error(bhError);
      toast.error("Failed to load business hours");
    } else if (bhData && bhData.length > 0) {
      setHours(
        bhData.map((r: any) => ({
          id: r.id,
          day_of_week: r.day_of_week,
          is_open: r.is_open ?? true,
          open_time: r.open_time ? r.open_time.slice(0, 5) : "09:00",
          close_time: r.close_time ? r.close_time.slice(0, 5) : "17:00",
        }))
      );
    } else {
      // Create defaults if they don't exist
      const defaultHours = DAY_NAMES.map((_, i) => ({
        id: `temp-${i}`,
        day_of_week: i,
        is_open: i > 0 && i < 6, // Mon-Fri open
        open_time: "09:00",
        close_time: "17:00"
      }));
      setHours(defaultHours);
    }

    // Fetch Routing Settings
    const { data: rtData, error: rtError } = await supabase
      .from("inbound_routing_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (rtError) {
      console.error(rtError);
      toast.error("Failed to load routing settings");
    } else if (rtData) {
      setRouting({
        id: rtData.id,
        routing_mode: rtData.routing_mode || "assigned",
        auto_create_lead: !!rtData.auto_create_lead,
        after_hours_sms_enabled: !!rtData.after_hours_sms_enabled,
        after_hours_sms: rtData.after_hours_sms || defaultRoutingSettings.after_hours_sms,
        voicemail_enabled: rtData.voicemail_enabled ?? true,
        fallback_action: (rtData.fallback_action as any) || "voicemail",
        voicemail_greeting_text: rtData.voicemail_greeting_text || defaultRoutingSettings.voicemail_greeting_text,
        voicemail_greeting_url: rtData.voicemail_greeting_url || "",
        forwarding_number: rtData.forwarding_number || "",
      });
    }

    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!organizationId) return;
    setSaving(true);
    
    try {
      // 1. Save Business Hours
      const hoursUpsert = hours.map(h => ({
        ...(h.id.startsWith("temp-") ? {} : { id: h.id }),
        organization_id: organizationId,
        day_of_week: h.day_of_week,
        is_open: h.is_open,
        open_time: h.open_time,
        close_time: h.close_time,
      }));
      
      const { error: bhError } = await supabase
        .from("business_hours")
        .upsert(hoursUpsert, { onConflict: "id" });
        
      if (bhError) throw bhError;

      // 2. Save Routing Settings
      const rtPayload = {
        organization_id: organizationId,
        routing_mode: routing.routing_mode,
        auto_create_lead: routing.auto_create_lead,
        after_hours_sms_enabled: routing.after_hours_sms_enabled,
        after_hours_sms: routing.after_hours_sms,
        voicemail_enabled: routing.voicemail_enabled,
        fallback_action: routing.fallback_action,
        voicemail_greeting_text: routing.voicemail_greeting_text,
        voicemail_greeting_url: routing.voicemail_greeting_url,
        forwarding_number: routing.forwarding_number,
        updated_at: new Date().toISOString()
      };

      let rtError;
      if (routing.id) {
        const res = await supabase.from("inbound_routing_settings").update(rtPayload).eq("id", routing.id);
        rtError = res.error;
      } else {
        const res = await supabase.from("inbound_routing_settings").insert([rtPayload]);
        rtError = res.error;
      }

      if (rtError) throw rtError;
      
      toast.success("Inbound routing configuration saved successfully");
      await fetchData(); // Refresh to get proper IDs if inserted
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to save settings: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateHour = (idx: number, field: keyof BHRow, value: any) => {
    setHours((prev) => prev.map((h, i) => (i === idx ? { ...h, [field]: value } : h)));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Inbound Journey</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Design exactly what happens when a customer calls your organization.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="min-w-[120px] shadow-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Flow Builder */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* STEP 1: Routing Strategy */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <Card className="border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
              <div className="h-1 w-full bg-primary/80"></div>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Route className="w-5 h-5 text-primary" />
                  1. Routing Strategy
                </CardTitle>
                <CardDescription>How should incoming calls be distributed during business hours?</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={routing.routing_mode}
                  onValueChange={(v) => setRouting(r => ({ ...r, routing_mode: v }))}
                  className="grid gap-4 md:grid-cols-3"
                >
                  <label
                    htmlFor="route-assigned"
                    className={`flex flex-col items-center justify-center p-4 text-center cursor-pointer rounded-xl border-2 transition-all ${
                      routing.routing_mode === "assigned"
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border/40 hover:border-border hover:bg-muted/30"
                    }`}
                  >
                    <RadioGroupItem value="assigned" id="route-assigned" className="sr-only" />
                    <div className="p-3 bg-blue-500/10 text-blue-500 rounded-full mb-3">
                      <PhoneCall className="w-6 h-6" />
                    </div>
                    <span className="font-medium text-sm text-foreground">Assigned Agent</span>
                    <span className="text-xs text-muted-foreground mt-1">Ring the lead's owner</span>
                  </label>
                  
                  <label
                    htmlFor="route-all"
                    className={`flex flex-col items-center justify-center p-4 text-center cursor-pointer rounded-xl border-2 transition-all ${
                      routing.routing_mode === "all-ring"
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border/40 hover:border-border hover:bg-muted/30"
                    }`}
                  >
                    <RadioGroupItem value="all-ring" id="route-all" className="sr-only" />
                    <div className="p-3 bg-purple-500/10 text-purple-500 rounded-full mb-3">
                      <PhoneCall className="w-6 h-6" />
                    </div>
                    <span className="font-medium text-sm text-foreground">Ring All</span>
                    <span className="text-xs text-muted-foreground mt-1">First to answer wins</span>
                  </label>

                  <label
                    htmlFor="route-rr"
                    className={`flex flex-col items-center justify-center p-4 text-center cursor-pointer rounded-xl border-2 transition-all ${
                      routing.routing_mode === "round_robin"
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border/40 hover:border-border hover:bg-muted/30"
                    }`}
                  >
                    <RadioGroupItem value="round_robin" id="route-rr" className="sr-only" />
                    <div className="p-3 bg-green-500/10 text-green-500 rounded-full mb-3">
                      <PhoneCall className="w-6 h-6" />
                    </div>
                    <span className="font-medium text-sm text-foreground">Round Robin</span>
                    <span className="text-xs text-muted-foreground mt-1">Distribute evenly</span>
                  </label>
                </RadioGroup>
              </CardContent>
            </Card>
          </motion.div>

          {/* STEP 2: Fallback & Voicemail */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
            <Card className="border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
              <div className="h-1 w-full bg-orange-500/80"></div>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldAlert className="w-5 h-5 text-orange-500" />
                  2. Unanswered / Fallback
                </CardTitle>
                <CardDescription>If no agents are available, or the call goes unanswered, what happens next?</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Fallback Action</Label>
                  <Select
                    value={routing.fallback_action}
                    onValueChange={(v: any) => setRouting(r => ({ ...r, fallback_action: v }))}
                  >
                    <SelectTrigger className="w-full md:w-[300px] h-10">
                      <SelectValue placeholder="Select an action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="voicemail">
                        <div className="flex items-center gap-2"><Voicemail className="w-4 h-4 text-muted-foreground"/> Send to Voicemail</div>
                      </SelectItem>
                      <SelectItem value="forward">
                        <div className="flex items-center gap-2"><Forward className="w-4 h-4 text-muted-foreground"/> Forward to External Number</div>
                      </SelectItem>
                      <SelectItem value="hangup">
                        <div className="flex items-center gap-2"><PhoneOff className="w-4 h-4 text-muted-foreground"/> Hang Up (Play Greeting)</div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Voicemail Settings */}
                {routing.fallback_action === "voicemail" && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        Text-to-Speech Greeting
                      </Label>
                    </div>
                    <Textarea 
                      value={routing.voicemail_greeting_text}
                      onChange={(e) => setRouting(r => ({ ...r, voicemail_greeting_text: e.target.value }))}
                      placeholder="Hi, you've reached us. Please leave a message."
                      className="resize-none min-h-[80px]"
                    />
                    <p className="text-xs text-muted-foreground">This text will be spoken to the caller before the beep.</p>
                  </div>
                )}

                {/* Forwarding Settings */}
                {routing.fallback_action === "forward" && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
                    <Label className="text-sm font-medium">External Forwarding Number</Label>
                    <Input 
                      type="tel"
                      value={routing.forwarding_number}
                      onChange={(e) => setRouting(r => ({ ...r, forwarding_number: e.target.value }))}
                      placeholder="+1 (555) 123-4567"
                      className="max-w-[300px]"
                    />
                    <p className="text-xs text-muted-foreground">Calls will be forwarded to this number if the primary routing fails.</p>
                  </div>
                )}

                {/* Hangup Settings */}
                {routing.fallback_action === "hangup" && (
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
                     <Label className="text-sm font-medium">Goodbye Message (Text-to-Speech)</Label>
                     <Textarea 
                      value={routing.voicemail_greeting_text}
                      onChange={(e) => setRouting(r => ({ ...r, voicemail_greeting_text: e.target.value }))}
                      placeholder="Sorry, we missed you. Goodbye."
                      className="resize-none min-h-[80px]"
                    />
                    <p className="text-xs text-muted-foreground">This message will play before immediately dropping the call.</p>
                  </div>
                )}

              </CardContent>
            </Card>
          </motion.div>

          {/* STEP 3: Auto Lead Creation */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
             <Card className="border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                      Auto-Create Leads
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">Automatically create a lead record for unknown inbound callers.</p>
                  </div>
                  <Switch 
                    checked={routing.auto_create_lead} 
                    onCheckedChange={(v) => setRouting(r => ({ ...r, auto_create_lead: v }))} 
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>

        </div>

        {/* Right Column: Global Schedules */}
        <div className="lg:col-span-4 space-y-6">
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
            <Card className="border-border/60 shadow-sm h-full">
              <CardHeader className="pb-4 border-b border-border/40">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="w-5 h-5 text-primary" />
                  Business Hours
                </CardTitle>
                <CardDescription>Set your organization's availability.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-5">
                {hours.map((h, i) => (
                  <div key={h.id} className="flex flex-col gap-2 p-3 rounded-lg hover:bg-muted/30 transition-colors border border-transparent hover:border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium w-24 text-foreground">{DAY_NAMES[h.day_of_week]}</span>
                      <Switch checked={h.is_open} onCheckedChange={(v) => updateHour(i, "is_open", v)} />
                    </div>
                    {h.is_open && (
                      <div className="flex items-center gap-2 animate-in fade-in mt-1">
                        <Input
                          type="time"
                          value={h.open_time}
                          onChange={(e) => updateHour(i, "open_time", e.target.value)}
                          className="h-8 text-xs bg-background"
                        />
                        <span className="text-muted-foreground text-xs font-medium">to</span>
                        <Input
                          type="time"
                          value={h.close_time}
                          onChange={(e) => updateHour(i, "close_time", e.target.value)}
                          className="h-8 text-xs bg-background"
                        />
                      </div>
                    )}
                    {!h.is_open && (
                      <div className="h-8 flex items-center text-xs text-muted-foreground/70 italic mt-1">
                        Closed
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: 0.1 }}>
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    After-Hours SMS
                  </div>
                  <Switch 
                    checked={routing.after_hours_sms_enabled}
                    onCheckedChange={(v) => setRouting(r => ({ ...r, after_hours_sms_enabled: v }))}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <Textarea
                  disabled={!routing.after_hours_sms_enabled}
                  value={routing.after_hours_sms}
                  onChange={(e) => setRouting(r => ({ ...r, after_hours_sms: e.target.value }))}
                  placeholder="Type an auto-reply message..."
                  className="resize-none h-24 text-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-2">
                  Sent automatically to callers when you are closed.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>

      </div>
    </div>
  );
};

export default InboundRoutingManager;
