import React, { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, Trash2, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import type { RoutingSettings } from "./types";

interface Props {
  settings: RoutingSettings;
  onChange: (patch: Partial<RoutingSettings>) => void;
}

const MIN_RING = 10;
const MAX_RING = 60;

const VoicemailSettingsCard: React.FC<Props> = ({ settings, onChange }) => {
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const onPickFile = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav"].includes(file.type)) {
      toast.error("Please upload an MP3 or WAV file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Greeting must be under 5MB.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "mp3";
      const path = `${settings.organization_id}/greeting-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voicemail-assets")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("voicemail-assets").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updErr } = await (supabase as any)
        .from("inbound_routing_settings")
        .update({ voicemail_greeting_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("organization_id", settings.organization_id);
      if (updErr) throw updErr;

      onChange({ voicemail_greeting_url: publicUrl });
      toast.success("Voicemail greeting uploaded");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload greeting.");
    } finally {
      setUploading(false);
    }
  };

  const removeGreeting = async () => {
    const url = settings.voicemail_greeting_url;
    if (!url) return;

    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({ voicemail_greeting_url: null, updated_at: new Date().toISOString() })
      .eq("organization_id", settings.organization_id);
    if (error) {
      toast.error("Failed to remove greeting.");
      return;
    }

    // Try to delete the stored file (best-effort)
    try {
      const marker = "/voicemail-assets/";
      const idx = url.indexOf(marker);
      if (idx !== -1) {
        const path = url.slice(idx + marker.length);
        await supabase.storage.from("voicemail-assets").remove([path]);
      }
    } catch {
      // ignore cleanup failures
    }

    onChange({ voicemail_greeting_url: null });
    if (audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
    toast.success("Greeting removed");
  };

  const togglePlay = () => {
    if (!settings.voicemail_greeting_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(settings.voicemail_greeting_url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => toast.error("Unable to play greeting"));
      setPlaying(true);
    }
  };

  const saveRingTimeout = async () => {
    const value = Math.max(MIN_RING, Math.min(MAX_RING, settings.ring_timeout_seconds || 20));
    setSaving(true);
    const { error } = await (supabase as any)
      .from("inbound_routing_settings")
      .update({ ring_timeout_seconds: value, updated_at: new Date().toISOString() })
      .eq("organization_id", settings.organization_id);
    setSaving(false);
    if (error) {
      toast.error("Failed to save ring timeout.");
      return;
    }
    onChange({ ring_timeout_seconds: value });
    toast.success("Ring timeout saved");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voicemail Settings</CardTitle>
        <CardDescription>Upload a greeting and control how long callers ring before being sent to voicemail.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">Voicemail Greeting</Label>
          {settings.voicemail_greeting_url ? (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-accent/30">
              <Button size="icon" variant="outline" onClick={togglePlay} className="shrink-0">
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">Custom greeting uploaded</p>
                <p className="text-xs text-muted-foreground truncate">{settings.voicemail_greeting_url.split("/").pop()}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={removeGreeting} className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4 mr-1" /> Remove
              </Button>
            </div>
          ) : (
            <div className="p-4 rounded-lg border border-dashed border-border text-center">
              <p className="text-xs text-muted-foreground mb-3">
                No custom greeting. Callers will hear the default: "Please leave a message after the tone."
              </p>
              <Button variant="outline" size="sm" onClick={onPickFile} disabled={uploading}>
                {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4 mr-2" /> Upload Greeting</>}
              </Button>
            </div>
          )}
          {settings.voicemail_greeting_url && (
            <Button variant="outline" size="sm" onClick={onPickFile} disabled={uploading}>
              {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4 mr-2" /> Replace Greeting</>}
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav"
            className="hidden"
            onChange={handleFileSelected}
          />
          <p className="text-xs text-muted-foreground">MP3 or WAV, up to 5MB.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ring-timeout" className="text-sm font-medium text-foreground">
            Ring Timeout (seconds)
          </Label>
          <div className="flex items-center gap-3">
            <Input
              id="ring-timeout"
              type="number"
              min={MIN_RING}
              max={MAX_RING}
              value={settings.ring_timeout_seconds}
              onChange={(e) => onChange({ ring_timeout_seconds: parseInt(e.target.value) || MIN_RING })}
              className="w-32"
            />
            <Button onClick={saveRingTimeout} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            How long agents ring before the call is sent to voicemail ({MIN_RING}–{MAX_RING} seconds).
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default VoicemailSettingsCard;
