import React, { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { waitSchema, type WorkflowNodeRow } from "@/lib/workflow-types";
import PanelShell from "./PanelShell";

interface Props {
  node: WorkflowNodeRow;
  onClose: () => void;
  onSave: (patch: { config: Record<string, unknown>; label?: string | null }) => Promise<void>;
}

const WaitConfigPanel: React.FC<Props> = ({ node, onClose, onSave }) => {
  const [config, setConfig] = useState<Record<string, unknown>>(node.config ?? { duration: 1, unit: "hours" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setConfig(node.config ?? { duration: 1, unit: "hours" });
  }, [node.id, node.config]);

  const set = (patch: Record<string, unknown>) => setConfig((c) => ({ ...c, ...patch }));

  const handleSave = async () => {
    const r = waitSchema.safeParse(config);
    if (!r.success) { toast({ title: r.error.issues[0].message, variant: "destructive" }); return; }
    setSaving(true);
    try {
      const label = `Wait ${r.data.duration} ${r.data.unit}`;
      await onSave({ config: r.data as Record<string, unknown>, label });
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
            min={1}
            value={(config.duration as number) || 1}
            onChange={(e) => set({ duration: Math.max(1, parseInt(e.target.value) || 1) })}
            className="w-28"
          />
          <select
            value={(config.unit as string) || "hours"}
            onChange={(e) => set({ unit: e.target.value })}
            className="h-9 flex-1 rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
      </div>
    </PanelShell>
  );
};

export default WaitConfigPanel;
