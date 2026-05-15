import React, { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  waitConfigToMinutes, waitEditorSchema, type WorkflowNodeRow,
} from "@/lib/workflow-types";
import PanelShell from "./PanelShell";

interface Props {
  node: WorkflowNodeRow;
  onClose: () => void;
  onSave: (patch: { config: Record<string, unknown>; label?: string | null }) => Promise<void>;
}

type Unit = "minutes" | "hours" | "days";

function readEditorState(cfg: Record<string, unknown> | null): { duration: number; unit: Unit } {
  const c = cfg ?? {};
  if (typeof c.duration === "number" && c.duration > 0 && typeof c.unit === "string") {
    return { duration: c.duration, unit: (c.unit as Unit) ?? "hours" };
  }
  const mins = Number(c.duration_minutes ?? 0);
  if (Number.isFinite(mins) && mins > 0) {
    if (mins % 1440 === 0) return { duration: mins / 1440, unit: "days" };
    if (mins % 60 === 0) return { duration: mins / 60, unit: "hours" };
    return { duration: mins, unit: "minutes" };
  }
  return { duration: 1, unit: "days" };
}

const WaitConfigPanel: React.FC<Props> = ({ node, onClose, onSave }) => {
  const [{ duration, unit }, setEditor] = useState(() => readEditorState(node.config));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setEditor(readEditorState(node.config)); }, [node.id, node.config]);

  const handleDuration = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") { setEditor((s) => ({ ...s, duration: 0 })); return; }
    const parsed = parseInt(trimmed, 10);
    setEditor((s) => ({ ...s, duration: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }));
  };

  const handleSave = async () => {
    const safeDuration = duration > 0 ? duration : 1;
    const editor = waitEditorSchema.safeParse({ duration: safeDuration, unit });
    if (!editor.success) {
      toast({ title: editor.error.issues[0].message, variant: "destructive" });
      return;
    }
    const durationMinutes = waitConfigToMinutes(editor.data.duration, editor.data.unit);
    setSaving(true);
    try {
      const config = {
        duration: editor.data.duration,
        unit: editor.data.unit,
        duration_minutes: durationMinutes,
      };
      const label = `Wait ${editor.data.duration} ${editor.data.unit}`;
      await onSave({ config, label });
      toast({ title: "Delay saved" });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: msg, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <PanelShell open title="Wait / Delay" subtitle="Pause the workflow before the next step" onClose={onClose} onSave={handleSave} saving={saving}>
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-foreground">Duration *</label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={duration > 0 ? duration : ""}
            placeholder="1"
            onChange={(e) => handleDuration(e.target.value)}
            className="w-28"
          />
          <select
            value={unit}
            onChange={(e) => setEditor((s) => ({ ...s, unit: e.target.value as Unit }))}
            className="h-9 flex-1 rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Blank or zero defaults to 1 day.
        </p>
      </div>
    </PanelShell>
  );
};

export default WaitConfigPanel;
