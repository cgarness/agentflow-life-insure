import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface BHRow {
  id: string;
  day_of_week: number;
  is_open: boolean;
  open_time: string;
  close_time: string;
}

const BusinessHoursCard: React.FC = () => {
  const [hours, setHours] = useState<BHRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("business_hours")
      .select("*")
      .order("day_of_week")
      .then(({ data }) => {
        setHours(
          (data || []).map((r: any) => ({
            id: r.id,
            day_of_week: r.day_of_week,
            is_open: r.is_open ?? true,
            open_time: r.open_time || "09:00",
            close_time: r.close_time || "17:00",
          }))
        );
      });
  }, []);

  const updateHour = (idx: number, field: keyof BHRow, value: any) => {
    setHours((prev) => prev.map((h, i) => (i === idx ? { ...h, [field]: value } : h)));
  };

  const save = async () => {
    setSaving(true);
    for (const h of hours) {
      const { error } = await supabase
        .from("business_hours")
        .update({ is_open: h.is_open, open_time: h.open_time, close_time: h.close_time })
        .eq("id", h.id);
      if (error) {
        toast.error("Failed to save business hours.");
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    toast.success("Business hours saved");
  };

  return (
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
        <Button onClick={save} disabled={saving}>
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Business Hours"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default BusinessHoursCard;
