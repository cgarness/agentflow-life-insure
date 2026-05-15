import React, { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { workflowApi } from "@/lib/supabase-workflows";
import {
  TRIGGER_LABELS, triggerConfigSchemas,
  type WorkflowRow, type TriggerType,
} from "@/lib/workflow-types";
import PanelShell from "./PanelShell";
import TriggerConfigForm from "../TriggerConfigForm";

interface Props {
  workflow: WorkflowRow;
  onClose: () => void;
  onSaved: (updated: WorkflowRow) => void;
}

const TRIGGER_OPTIONS: TriggerType[] = [
  "disposition", "stage_change", "lead_created",
  "time_based", "tag_added", "tag_removed", "manual",
];

const TriggerConfigPanel: React.FC<Props> = ({ workflow, onClose, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [triggerType, setTriggerType] = useState<TriggerType>(workflow.trigger_type);
  const [config, setConfig] = useState<Record<string, unknown>>(workflow.trigger_config ?? {});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const cfgParse = triggerConfigSchemas[triggerType].safeParse(config);
    if (!cfgParse.success) { toast({ title: cfgParse.error.issues[0].message, variant: "destructive" }); return; }
    setSaving(true);
    try {
      const cfg = cfgParse.data as Record<string, unknown>;
      await workflowApi.update(workflow.id, { trigger_type: triggerType, trigger_config: cfg });
      onSaved({ ...workflow, trigger_type: triggerType, trigger_config: cfg });
      toast({ title: "Trigger updated" });
      setEditing(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update trigger";
      toast({ title: msg, variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (!editing) {
    return (
      <PanelShell open title="Trigger" subtitle={TRIGGER_LABELS[workflow.trigger_type]} onClose={onClose}>
        <div className="space-y-3">
          <ReadField label="Type" value={TRIGGER_LABELS[workflow.trigger_type]} />
          <ReadField
            label="Configuration"
            value={
              workflow.trigger_config && Object.keys(workflow.trigger_config).length > 0
                ? JSON.stringify(workflow.trigger_config, null, 2)
                : "—"
            }
            mono
          />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border/50 bg-background/50 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Edit Trigger
          </button>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell open title="Edit Trigger" onClose={() => setEditing(false)} onSave={handleSave} saving={saving}>
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-foreground">Trigger type *</label>
        <select
          value={triggerType}
          onChange={(e) => { setTriggerType(e.target.value as TriggerType); setConfig({}); }}
          className="h-9 w-full rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
        >
          {TRIGGER_OPTIONS.map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </select>
      </div>
      <div className="rounded-lg border border-border/50 p-3">
        <TriggerConfigForm triggerType={triggerType} config={config} onChange={setConfig} />
      </div>
    </PanelShell>
  );
};

const ReadField: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`whitespace-pre-wrap rounded-lg bg-accent/40 p-2 text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
  </div>
);

export default TriggerConfigPanel;
