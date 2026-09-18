import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, PhoneIncoming, ShieldCheck, Smartphone, Users } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { announceRoutingEngine } from "@/lib/agentAvailability";
import {
  INBOUND_GROUP_MAX,
  RETENTION_DAYS_MAX,
  RETENTION_DAYS_MIN,
  RING_SECONDS_MAX,
  RING_SECONDS_MIN,
  clampInt,
  validateInboundGroupSelection,
} from "@/lib/inboundSettingsValidation";

interface AgentOption {
  id: string;
  name: string;
  hasIdentity: boolean;
  connected: boolean;
  mobileConfigured: boolean;
}

interface V2Settings {
  routing_engine: "legacy" | "v2";
  inbound_group_agent_ids: string[];
  browser_ring_seconds: number;
  mobile_ring_seconds: number;
  voicemail_retention_days: number;
}

const DEFAULTS: V2Settings = {
  routing_engine: "legacy",
  inbound_group_agent_ids: [],
  browser_ring_seconds: 20,
  mobile_ring_seconds: 20,
  voicemail_retention_days: 30,
};

/**
 * Inbound Calling v2 — administrator card (implementation_plan.md rev 3 §6.5, §7.2, §14).
 * The explicit inbound group (1–10 Active agents, D5/D10), the ring windows (D4/P5, P17 calibration),
 * voicemail retention (P13) and the per-organization engine flag (P15). Group and engine changes go
 * through the SECURITY DEFINER RPCs (set_inbound_group / set_inbound_routing_engine) which validate
 * membership server-side and refuse activation without a valid group and at least one fresh phone
 * registration; the numeric settings are a direct admin update on inbound_routing_settings.
 */
export const InboundV2Section: React.FC<{ organizationId: string | null; onEngineChange?: (engine: "legacy" | "v2") => void }> = ({ organizationId, onEngineChange }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [settings, setSettings] = useState<V2Settings>(DEFAULTS);
  const [saved, setSaved] = useState<V2Settings>(DEFAULTS);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [prereq, setPrereq] = useState<{ fresh_registrations?: number; agents_without_mobile?: string[] } | null>(null);

  // Keep the parent callback out of `load`'s dependencies: an inline arrow from the parent would otherwise
  // re-create `load` on every parent render and the effect below would refetch, discarding unsaved edits.
  const onEngineChangeRef = useRef(onEngineChange);
  useEffect(() => { onEngineChangeRef.current = onEngineChange; }, [onEngineChange]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [{ data: rt, error: rtErr }, { data: profiles, error: pErr }, { data: regs }, { data: mobiles }] = await Promise.all([
        supabase.from("inbound_routing_settings").select("routing_engine, inbound_group_agent_ids, browser_ring_seconds, mobile_ring_seconds, voicemail_retention_days").eq("organization_id", organizationId).maybeSingle(),
        supabase.from("profiles").select("id, first_name, last_name, twilio_client_identity, status").eq("organization_id", organizationId).eq("status", "Active").order("first_name"),
        supabase.from("agent_phone_registrations").select("agent_id, registered, last_seen_at").eq("organization_id", organizationId).eq("registered", true),
        supabase.from("agent_inbound_settings").select("agent_id, mobile_forward_enabled, mobile_forward_number").eq("organization_id", organizationId),
      ]);
      if (rtErr) throw rtErr;
      if (pErr) throw pErr;
      const next: V2Settings = rt
        ? {
            routing_engine: rt.routing_engine === "v2" ? "v2" : "legacy",
            inbound_group_agent_ids: Array.isArray(rt.inbound_group_agent_ids) ? rt.inbound_group_agent_ids : [],
            browser_ring_seconds: clampInt(rt.browser_ring_seconds, RING_SECONDS_MIN, RING_SECONDS_MAX, 20),
            mobile_ring_seconds: clampInt(rt.mobile_ring_seconds, RING_SECONDS_MIN, RING_SECONDS_MAX, 20),
            voicemail_retention_days: clampInt(rt.voicemail_retention_days, RETENTION_DAYS_MIN, RETENTION_DAYS_MAX, 30),
          }
        : DEFAULTS;
      setSettings(next); setSaved(next);
      onEngineChangeRef.current?.(next.routing_engine);
      announceRoutingEngine(next.routing_engine);   // the availability surfaces follow the engine in-session
      const freshCutoff = Date.now() - 3 * 60 * 1000;
      const connected = new Set((regs ?? []).filter((r) => r.last_seen_at && new Date(r.last_seen_at).getTime() >= freshCutoff).map((r) => r.agent_id));
      const withMobile = new Set((mobiles ?? []).filter((m) => m.mobile_forward_enabled && !!m.mobile_forward_number).map((m) => m.agent_id));
      setAgents((profiles ?? []).map((p) => ({
        id: p.id,
        name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.id,
        hasIdentity: !!(p.twilio_client_identity || "").trim(),
        connected: connected.has(p.id),
        mobileConfigured: withMobile.has(p.id),
      })));
    } catch (e) {
      // Admin-only read of registrations/mobile settings may be refused by RLS for non-admins — the card
      // still renders the engine state and group from the routing settings row.
      console.warn("[InboundV2Section] load:", e instanceof Error ? e.message : e);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const isDirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(saved), [settings, saved]);
  const eligibleAgents = useMemo(() => agents.filter((a) => a.hasIdentity), [agents]);

  const toggleAgent = (id: string, checked: boolean) => {
    setSettings((s) => {
      const ids = checked ? [...new Set([...s.inbound_group_agent_ids, id])] : s.inbound_group_agent_ids.filter((x) => x !== id);
      if (ids.length > INBOUND_GROUP_MAX) { toast.error(`At most ${INBOUND_GROUP_MAX} agents can be in the inbound group.`); return s; }
      return { ...s, inbound_group_agent_ids: ids };
    });
  };

  const handleSave = async () => {
    if (!organizationId) return;
    const group = validateInboundGroupSelection(settings.inbound_group_agent_ids);
    if (group.ok === false && settings.routing_engine === "v2") { toast.error(group.message); return; }
    setSaving(true);
    try {
      if (group.ok && JSON.stringify(group.ids) !== JSON.stringify(saved.inbound_group_agent_ids)) {
        const { error } = await supabase.rpc("set_inbound_group", { p_ids: group.ids });
        if (error) throw error;
      }
      const numeric = {
        browser_ring_seconds: clampInt(settings.browser_ring_seconds, RING_SECONDS_MIN, RING_SECONDS_MAX, 20),
        mobile_ring_seconds: clampInt(settings.mobile_ring_seconds, RING_SECONDS_MIN, RING_SECONDS_MAX, 20),
        voicemail_retention_days: clampInt(settings.voicemail_retention_days, RETENTION_DAYS_MIN, RETENTION_DAYS_MAX, 30),
      };
      if (numeric.browser_ring_seconds !== saved.browser_ring_seconds || numeric.mobile_ring_seconds !== saved.mobile_ring_seconds || numeric.voicemail_retention_days !== saved.voicemail_retention_days) {
        const { error } = await supabase.from("inbound_routing_settings").update({ ...numeric, updated_at: new Date().toISOString() }).eq("organization_id", organizationId);
        if (error) throw error;
      }
      toast.success("Inbound Calling v2 settings saved.");
      await load();
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleEngine = async (engine: "legacy" | "v2") => {
    if (!organizationId) return;
    if (engine === "v2" && isDirty) { toast.error("Save the group and timings first, then activate."); return; }
    setSwitching(true);
    try {
      const { data, error } = await supabase.rpc("set_inbound_routing_engine", { p_engine: engine });
      if (error) throw error;
      const d = (data && typeof data === "object" ? data : {}) as { routing_engine?: string; fresh_registrations?: number; agents_without_mobile?: string[] };
      setPrereq({ fresh_registrations: d.fresh_registrations, agents_without_mobile: d.agents_without_mobile });
      toast.success(engine === "v2" ? "Inbound Calling v2 is active for this organization." : "Inbound routing returned to the legacy engine (new calls only; calls in progress finish on v2).");
      await load();
    } catch (e) {
      toast.error(`Could not switch the routing engine: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSwitching(false);
    }
  };

  const active = settings.routing_engine === "v2";

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="border-border/60 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm" data-testid="inbound-v2-section">
        <div className={`h-1 w-full ${active ? "bg-emerald-500/80" : "bg-muted-foreground/30"}`} />
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between gap-2 text-lg">
            <span className="flex items-center gap-2"><PhoneIncoming className="w-5 h-5 text-primary" /> Inbound Calling v2</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${active ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{active ? "Active" : "Legacy routing"}</span>
          </CardTitle>
          <CardDescription>
            Contact's assigned agent first (direct lines take precedence), 20-second browser ring, mobile forwarding with Press 1, agent voicemail, and an explicit inbound group for unassigned callers.
            {active ? " While active, the routing strategy, fallback chain and fallback action below are not used." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted/30" />
          ) : (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm font-medium"><Users className="w-4 h-4 text-muted-foreground" /> Inbound group (unassigned callers ring all of these at once, max {INBOUND_GROUP_MAX})</Label>
                {eligibleAgents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No Active agents with a phone identity yet.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {eligibleAgents.map((a) => {
                      const checked = settings.inbound_group_agent_ids.includes(a.id);
                      return (
                        <label key={a.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${checked ? "border-primary/60 bg-primary/5" : "border-border/50"}`}>
                          <Checkbox checked={checked} onCheckedChange={(c) => toggleAgent(a.id, c === true)} aria-label={`Include ${a.name} in the inbound group`} />
                          <span className="flex-1 truncate">{a.name}</span>
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className={`h-2 w-2 rounded-full ${a.connected ? "bg-emerald-500" : "bg-muted-foreground/40"}`} title={a.connected ? "Phone connected" : "Phone not connected"} />
                            {a.mobileConfigured ? <Smartphone className="h-3 w-3" aria-label="Mobile forwarding configured" /> : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{settings.inbound_group_agent_ids.length} selected. Only Available, connected, non-busy members ring; when none qualifies the caller reaches the group voicemail.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="v2-browser-ring">Browser ring (seconds)</Label>
                  <Input id="v2-browser-ring" type="number" min={RING_SECONDS_MIN} max={RING_SECONDS_MAX} value={settings.browser_ring_seconds} onChange={(e) => setSettings((s) => ({ ...s, browser_ring_seconds: Number(e.target.value) }))} />
                  <p className="text-[11px] text-muted-foreground">Provider setting (integer). Twilio may hold the ring up to ~5 s longer; measured timings show in each agent's connection diagnostics.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v2-mobile-ring">Mobile ring (seconds)</Label>
                  <Input id="v2-mobile-ring" type="number" min={RING_SECONDS_MIN} max={RING_SECONDS_MAX} value={settings.mobile_ring_seconds} onChange={(e) => setSettings((s) => ({ ...s, mobile_ring_seconds: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v2-retention">Voicemail retention (days, after listening)</Label>
                  <Input id="v2-retention" type="number" min={RETENTION_DAYS_MIN} max={RETENTION_DAYS_MAX} value={settings.voicemail_retention_days} onChange={(e) => setSettings((s) => ({ ...s, voicemail_retention_days: Number(e.target.value) }))} />
                  <p className="text-[11px] text-muted-foreground">Unheard voicemails are kept up to 90 days regardless.</p>
                </div>
              </div>

              {prereq && (
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Activation check</p>
                  <p>Fresh phone registrations: {prereq.fresh_registrations ?? "—"}. Group members without a mobile number: {prereq.agents_without_mobile?.length ?? 0} (their unanswered calls go straight to voicemail).</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
                <Button onClick={() => void handleSave()} disabled={saving || !isDirty} className="min-w-[160px]">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{saving ? "Saving…" : "Save group & timings"}
                </Button>
                {active ? (
                  <Button variant="outline" onClick={() => void handleEngine("legacy")} disabled={switching}>
                    {switching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Return to legacy routing
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => void handleEngine("v2")} disabled={switching || isDirty}>
                    {switching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Activate Inbound Calling v2
                  </Button>
                )}
                <p className="text-[11px] text-muted-foreground">Activation requires a saved group and at least one agent with a connected phone. Switching engines affects new calls only.</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default InboundV2Section;
