import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import BusinessHoursCard from "./inbound/BusinessHoursCard";
import RoutingModeCard from "./inbound/RoutingModeCard";
import AutoCreateLeadCard from "./inbound/AutoCreateLeadCard";
import AfterHoursSmsCard from "./inbound/AfterHoursSmsCard";
import ContactsOnlyCard from "./inbound/ContactsOnlyCard";
import VoicemailSettingsCard from "./inbound/VoicemailSettingsCard";
import type { RoutingSettings } from "./inbound/types";

const DEFAULT_AFTER_HOURS_MSG =
  "Thank you for calling. We are currently closed. We will return your call during business hours.";

const InboundCallRouting: React.FC = () => {
  const { organizationId } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<RoutingSettings | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);

    const { data, error } = await (supabase as any)
      .from("inbound_routing_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      toast.error("Failed to load inbound routing settings.");
      setLoading(false);
      return;
    }

    if (data) {
      setSettings({
        id: data.id,
        organization_id: data.organization_id,
        routing_mode: data.routing_mode || "round_robin",
        auto_create_lead: !!data.auto_create_lead,
        after_hours_sms_enabled: !!data.after_hours_sms_enabled,
        after_hours_sms: data.after_hours_sms || DEFAULT_AFTER_HOURS_MSG,
        contacts_only: !!data.contacts_only,
        voicemail_greeting_url: data.voicemail_greeting_url || null,
        ring_timeout_seconds: data.ring_timeout_seconds ?? 20,
      });
    } else {
      // Row should be auto-created by DB trigger; if missing, try to insert defaults.
      const { data: inserted, error: insErr } = await (supabase as any)
        .from("inbound_routing_settings")
        .insert({
          organization_id: organizationId,
          routing_mode: "round_robin",
          auto_create_lead: false,
          after_hours_sms_enabled: false,
          after_hours_sms: DEFAULT_AFTER_HOURS_MSG,
          contacts_only: false,
          voicemail_greeting_url: null,
          ring_timeout_seconds: 20,
        })
        .select()
        .single();

      if (!insErr && inserted) {
        setSettings({
          id: inserted.id,
          organization_id: inserted.organization_id,
          routing_mode: inserted.routing_mode || "round_robin",
          auto_create_lead: !!inserted.auto_create_lead,
          after_hours_sms_enabled: !!inserted.after_hours_sms_enabled,
          after_hours_sms: inserted.after_hours_sms || DEFAULT_AFTER_HOURS_MSG,
          contacts_only: !!inserted.contacts_only,
          voicemail_greeting_url: inserted.voicemail_greeting_url || null,
          ring_timeout_seconds: inserted.ring_timeout_seconds ?? 20,
        });
      }
    }

    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleChange = (patch: Partial<RoutingSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  if (loading || !settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-foreground">Inbound Call Routing</h3>
      <BusinessHoursCard />
      <RoutingModeCard settings={settings} onChange={handleChange} />
      <ContactsOnlyCard settings={settings} onChange={handleChange} />
      <VoicemailSettingsCard settings={settings} onChange={handleChange} />
      <AutoCreateLeadCard settings={settings} onChange={handleChange} />
      <AfterHoursSmsCard settings={settings} onChange={handleChange} />
    </div>
  );
};

export default InboundCallRouting;
