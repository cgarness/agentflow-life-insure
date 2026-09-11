import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneForwarded, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { normalizeMobileForwardNumber } from "@/lib/inboundSettingsValidation";

/**
 * Inbound Calling v2 — the agent's OWN inbound settings (agent_inbound_settings; D3, D6, D12):
 * the mobile destination for unanswered/offline forwarding and the personal voicemail greeting.
 * Self-owned rows only (RLS self select/insert/update); the number is stored in E.164 and refused by
 * the database when it equals one of the organization's own AgentFlow numbers (loop guard).
 */
export const ProfileInboundCard: React.FC = () => {
  const { user, realProfile, isImpersonating } = useAuth();
  const orgId = realProfile?.organization_id ?? null;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mobile, setMobile] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [greetingText, setGreetingText] = useState("");
  const [greetingUrl, setGreetingUrl] = useState("");
  const [saved, setSaved] = useState({ mobile: "", enabled: true, greetingText: "", greetingUrl: "" });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("agent_inbound_settings")
        .select("mobile_forward_number, mobile_forward_enabled, voicemail_greeting_text, voicemail_greeting_url")
        .eq("agent_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error(`Could not load your inbound settings: ${error.message}`);
      } else if (data) {
        const next = {
          mobile: data.mobile_forward_number ?? "",
          enabled: data.mobile_forward_enabled ?? true,
          greetingText: data.voicemail_greeting_text ?? "",
          greetingUrl: data.voicemail_greeting_url ?? "",
        };
        setMobile(next.mobile); setEnabled(next.enabled); setGreetingText(next.greetingText); setGreetingUrl(next.greetingUrl);
        setSaved(next);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const isDirty = useMemo(
    () => mobile !== saved.mobile || enabled !== saved.enabled || greetingText !== saved.greetingText || greetingUrl !== saved.greetingUrl,
    [mobile, enabled, greetingText, greetingUrl, saved],
  );

  const handleSave = useCallback(async () => {
    if (!user?.id || !orgId || isImpersonating) return;
    const normalized = normalizeMobileForwardNumber(mobile);
    if (mobile.trim() && !normalized) {
      toast.error("Enter a valid mobile number (10-digit US number or +country code).");
      return;
    }
    if (greetingText.length > 500) { toast.error("Greeting must be 500 characters or fewer."); return; }
    if (greetingUrl.trim() && !/^https:\/\//.test(greetingUrl.trim())) { toast.error("Greeting URL must start with https://"); return; }
    setSaving(true);
    try {
      const payload = {
        agent_id: user.id,
        organization_id: orgId,
        mobile_forward_number: normalized,
        mobile_forward_enabled: enabled,
        voicemail_greeting_text: greetingText.trim() || null,
        voicemail_greeting_url: greetingUrl.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("agent_inbound_settings").upsert(payload, { onConflict: "agent_id" });
      if (error) throw error;
      const next = { mobile: normalized ?? "", enabled, greetingText: greetingText.trim(), greetingUrl: greetingUrl.trim() };
      setMobile(next.mobile); setSaved(next);
      toast.success("Inbound settings saved.");
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [user?.id, orgId, isImpersonating, mobile, enabled, greetingText, greetingUrl]);

  if (!user || isImpersonating) return null;

  return (
    <Card className="border-border/60 shadow-sm" data-testid="profile-inbound-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneForwarded className="h-4 w-4 text-primary" aria-hidden />
          Inbound calls to your mobile
        </CardTitle>
        <CardDescription>
          When you are signed out, disconnected, or do not answer within 20 seconds in AgentFlow, your calls ring this
          number. Mobile conversations are never recorded; the call is still logged as “Missed in AgentFlow — forwarded to mobile”.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted/30" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="inbound-mobile">Mobile number</Label>
                <Input id="inbound-mobile" type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+1 555 123 4567" autoComplete="tel" />
                <p className="text-xs text-muted-foreground">Stored as E.164. Cannot be one of the agency's own AgentFlow numbers.</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">Forward to my mobile</p>
                  <p className="text-xs text-muted-foreground">Off ⇒ unanswered calls go straight to your voicemail.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Forward to my mobile" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inbound-greeting">Voicemail greeting (spoken)</Label>
              <Textarea id="inbound-greeting" value={greetingText} onChange={(e) => setGreetingText(e.target.value)} maxLength={500} placeholder="Hi, you've reached … please leave a message after the tone." className="min-h-[72px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inbound-greeting-url">Greeting audio URL (optional, https)</Label>
              <Input id="inbound-greeting-url" value={greetingUrl} onChange={(e) => setGreetingUrl(e.target.value)} placeholder="https://…/greeting.mp3" />
              <p className="text-xs text-muted-foreground">When set, the audio plays instead of the spoken greeting. Leave both blank to use the agency greeting.</p>
            </div>
            <div className="flex justify-start border-t border-border/50 pt-4">
              <Button onClick={() => void handleSave()} disabled={saving || !isDirty} className="px-6 rounded-lg">
                {saving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…</> : "Save inbound settings"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ProfileInboundCard;
