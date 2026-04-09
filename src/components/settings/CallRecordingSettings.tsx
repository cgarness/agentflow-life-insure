import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CallRecordingSettings: React.FC = () => {
  const { organizationId } = useOrganization();
  const [phoneSettingsRowId, setPhoneSettingsRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState("0");

  const [originals, setOriginals] = useState({ recordingEnabled: false, retentionDays: "0" });

  const fetchSettings = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      setPhoneSettingsRowId(null);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("phone_settings")
      .select("id, recording_enabled, transcription_enabled, recording_retention_days")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      toast.error("Failed to load data. Please try again.");
      setLoading(false);
      return;
    }

    if (data) {
      const d = data as any;
      setPhoneSettingsRowId(d.id ?? null);
      setRecordingEnabled(!!d.recording_enabled);
      setTranscriptionEnabled(!!d.transcription_enabled);
      setRetentionDays(String(d.recording_retention_days ?? 0));
      setOriginals({
        recordingEnabled: !!d.recording_enabled,
        retentionDays: String(d.recording_retention_days ?? 0),
      });
    } else {
      setPhoneSettingsRowId(null);
      setRecordingEnabled(true);
      setTranscriptionEnabled(false);
      setRetentionDays("0");
      setOriginals({ recordingEnabled: true, retentionDays: "0" });
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const hasChanges =
    recordingEnabled !== originals.recordingEnabled ||
    retentionDays !== originals.retentionDays;

  const handleSave = async () => {
    if (!organizationId) {
      toast.error("No organization — cannot save recording settings.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("phone_settings")
      .upsert(
        {
          id: phoneSettingsRowId || undefined,
          organization_id: organizationId,
          recording_enabled: recordingEnabled,
          transcription_enabled: transcriptionEnabled,
          recording_retention_days: parseInt(retentionDays, 10),
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "organization_id" }
      )
      .select("id")
      .maybeSingle();

    setSaving(false);
    if (error) {
      toast.error("Failed to save recording settings.");
      return;
    }
    if (data?.id) setPhoneSettingsRowId(data.id);
    setOriginals({ recordingEnabled, retentionDays });
    toast.success("Call recording settings saved");
  };

  if (!organizationId) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Call Recording</h3>
        <p className="text-sm text-muted-foreground">Link your account to an organization to manage recording settings.</p>
      </div>
    );
  }

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
