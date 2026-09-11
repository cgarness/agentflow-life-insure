import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Volume2, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getTwilioDevice } from "@/lib/twilio-voice";
import { useTwilio } from "@/contexts/TwilioContext";
import {
  applyRingtoneOutputs,
  listAudioOutputs,
  loadRingtoneOutputPref,
  saveRingtoneOutputPref,
  testRingtoneOutputs,
  type AudioOutputOption,
  type RingtoneOutputPref,
} from "@/lib/ringtoneOutputs";

/**
 * Inbound Calling v2 — D9: where the incoming ring plays. Default = every available output (speakers
 * AND headset). The choice is a per-browser convenience (localStorage) applied to the Twilio Device on
 * every registration; when a chosen device is unplugged the ring falls back to all outputs.
 */
export const ProfileRingtoneOutputCard: React.FC = () => {
  const { status } = useTwilio();
  const [pref, setPref] = useState<RingtoneOutputPref>(() => loadRingtoneOutputPref());
  const [outputs, setOutputs] = useState<AudioOutputOption[]>([]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [applied, setApplied] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const device = getTwilioDevice();
    const list = listAudioOutputs(device);
    setOutputs(list);
    setSupported(device?.audio ? device.audio.isOutputSelectionSupported : null);
    const r = await applyRingtoneOutputs(device, loadRingtoneOutputPref());
    setApplied(r.applied);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, status]);

  const selectedIds = useMemo(() => (pref.mode === "selected" ? pref.deviceIds : outputs.map((o) => o.deviceId)), [pref, outputs]);

  const update = useCallback(async (next: RingtoneOutputPref) => {
    setPref(next);
    saveRingtoneOutputPref(next);
    const r = await applyRingtoneOutputs(getTwilioDevice(), next);
    setApplied(r.applied);
  }, []);

  const toggle = (deviceId: string, checked: boolean) => {
    const base = pref.mode === "selected" ? pref.deviceIds : outputs.map((o) => o.deviceId);
    const nextIds = checked ? [...new Set([...base, deviceId])] : base.filter((id) => id !== deviceId);
    if (nextIds.length === 0) { toast.message("At least one output must ring — falling back to all outputs."); void update({ mode: "all" }); return; }
    void update(nextIds.length === outputs.length ? { mode: "all" } : { mode: "selected", deviceIds: nextIds });
  };

  const handleTest = async () => {
    setTesting(true);
    const ok = await testRingtoneOutputs(getTwilioDevice());
    setTesting(false);
    if (!ok) toast.error("Could not play the test ring — is the phone connected?");
  };

  return (
    <Card className="border-border/60 shadow-sm" data-testid="profile-ringtone-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Volume2 className="h-4 w-4 text-primary" aria-hidden />
          Incoming ring outputs
        </CardTitle>
        <CardDescription>
          By default an incoming call rings on every audio output (speakers and headset). Choose specific outputs here; this setting is per browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {supported === false && (
          <p className="text-sm text-muted-foreground">This browser does not support choosing ring outputs (Chrome or Edge do). The default output rings.</p>
        )}
        {supported !== false && outputs.length === 0 && (
          <p className="text-sm text-muted-foreground">{status === "ready" ? "No audio outputs reported yet — click Refresh." : "Connect the phone (dialer shows Ready) to list outputs."}</p>
        )}
        <div className="space-y-2">
          {outputs.map((o) => (
            <label key={o.deviceId} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 text-sm">
              <Checkbox checked={selectedIds.includes(o.deviceId)} onCheckedChange={(c) => toggle(o.deviceId, c === true)} aria-label={`Ring on ${o.label}`} />
              <span className="flex-1 truncate">{o.label}</span>
              {applied.includes(o.deviceId) && <span className="text-xs text-muted-foreground">ringing</span>}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => void update({ mode: "all" })} disabled={pref.mode === "all"}>Ring on all outputs</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh</Button>
          <Button type="button" size="sm" onClick={() => void handleTest()} disabled={testing || status !== "ready"}>
            {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Test ring
          </Button>
          <Label className="text-xs text-muted-foreground">Mode: {pref.mode === "all" ? "all outputs" : `${pref.deviceIds.length} selected`}</Label>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProfileRingtoneOutputCard;
