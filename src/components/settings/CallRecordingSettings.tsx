import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

const CallRecordingSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState("0");

  const [originals, setOriginals] = useState({ recordingEnabled: false, retentionDays: "0" });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("phone_settings")
      .select("recording_enabled, transcription_enabled, recording_retention_days")
      .eq("id", SINGLETON_ID)
      .maybeSingle();

    if (error) {
      toast.error("Failed to load data. Please try again.");
      setLoading(false);
      return;
    }

    if (data) {
      const d = data as any;
      setRecordingEnabled(!!d.recording_enabled);
      setTranscriptionEnabled(!!d.transcription_enabled);
      setRetentionDays(String(d.recording_retention_days ?? 0));
      setOriginals({
        recordingEnabled: !!d.recording_enabled,
        retentionDays: String(d.recording_retention_days ?? 0),
      });
    }
    setLoading(false);
  };

  const hasChanges =
    recordingEnabled !== originals.recordingEnabled ||
    retentionDays !== originals.retentionDays;

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    const { error } = await supabase
      .from("phone_settings")
      .upsert({
        id: SINGLETON_ID,
        recording_enabled: recordingEnabled,
        recording_retention_days: parseInt(retentionDays),
        updated_at: new Date().toISOString(),
      } as any);

    setSaving(false);
    if (error) {
      toast.error("Failed to save recording settings.");
      return;
    }
    setOriginals({ recordingEnabled, retentionDays });
    toast.success("Recording settings saved");
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Call Recording</h3>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-primary" />
            Call Recording
          </CardTitle>
          <CardDescription>Control how calls are recorded and how long recordings are retained.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Enable Recording */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Enable Call Recording</p>
            </div>
            <Switch checked={recordingEnabled} onCheckedChange={setRecordingEnabled} />
          </div>

          {/* AI Transcription */}
          <div className="flex items-center justify-between opacity-60">
            <div>
              <p className="text-sm font-medium text-foreground">
                AI Transcription <span className="text-muted-foreground text-xs">(Coming Soon)</span>
              </p>
            </div>
            <Switch checked={transcriptionEnabled} disabled />
          </div>

          {/* Retention */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Auto-delete recordings after</p>
            </div>
            <Select value={retentionDays} onValueChange={setRetentionDays}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="0">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default CallRecordingSettings;
