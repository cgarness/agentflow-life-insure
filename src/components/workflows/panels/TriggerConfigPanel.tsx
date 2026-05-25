import React, { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { workflowApi } from "@/lib/supabase-workflows";
import { dispositionsSupabaseApi } from "@/lib/supabase-dispositions";
import { pipelineSupabaseApi, leadSourcesSupabaseApi } from "@/lib/supabase-settings";
import { useOrganization } from "@/hooks/useOrganization";
import {
  TRIGGER_LABELS, triggerConfigSchemas, formatTriggerLabelSync,
  type WorkflowRow, type TriggerType,
} from "@/lib/workflow-types";
import PanelShell from "./PanelShell";
import TriggerConfigForm from "../TriggerConfigForm";
import TriggerTypeSelector from "../TriggerTypeSelector";

interface Props {
  workflow: WorkflowRow;
  onClose: () => void;
  onSaved: (updated: WorkflowRow) => void;
}

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
          <TriggerSummary workflow={workflow} />
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
        <TriggerTypeSelector
          value={triggerType}
          onChange={(t) => { setTriggerType(t); setConfig({}); }}
        />
      </div>
      <div className="rounded-lg border border-border/50 p-3">
        <TriggerConfigForm triggerType={triggerType} config={config} onChange={setConfig} />
      </div>
    </PanelShell>
  );
};

const ReadField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="whitespace-pre-wrap rounded-lg bg-accent/40 p-2 text-sm text-foreground">{value}</p>
  </div>
);

// Resolves disposition/stage/source IDs into human-readable summaries.
const TriggerSummary: React.FC<{ workflow: WorkflowRow }> = ({ workflow }) => {
  const { organizationId } = useOrganization();
  const [summary, setSummary] = useState<string>(
    formatTriggerLabelSync(workflow.trigger_type, workflow.trigger_config),
  );

  useEffect(() => {
    let alive = true;
    const cfg = workflow.trigger_config ?? {};
    (async () => {
      try {
        if (workflow.trigger_type === "disposition" && cfg.disposition_id) {
          if (!organizationId) return;
          const all = await dispositionsSupabaseApi.getAll(organizationId);
          const d = all.find((x) => x.id === cfg.disposition_id);
          if (alive) setSummary(d ? `Disposition: ${d.name}` : "Disposition (deleted)");
        } else if (workflow.trigger_type === "stage_change") {
          const [l, r] = await Promise.all([
            pipelineSupabaseApi.getLeadStages(organizationId),
            pipelineSupabaseApi.getRecruitStages(organizationId),
          ]);
          const all = [...l, ...r];
          const toName = all.find((s) => s.id === cfg.to_stage_id)?.name ?? "?";
          const fromName = cfg.from_stage_id
            ? all.find((s) => s.id === cfg.from_stage_id)?.name ?? "?"
            : "Any";
          if (alive) setSummary(`Stage Change: ${fromName} → ${toName}`);
        } else if (workflow.trigger_type === "lead_created" && cfg.source_id) {
          const sources = await leadSourcesSupabaseApi.getAll(organizationId);
          const s = sources.find((x) => x.id === cfg.source_id);
          if (alive) setSummary(`New lead from ${s?.name ?? "unknown source"}`);
        }
      } catch {
        // soft-fail; sync formatter result already set
      }
    })();
    return () => { alive = false; };
  }, [workflow.id, workflow.trigger_type, workflow.trigger_config, organizationId]);

  return <ReadField label="Summary" value={summary} />;
};

export default TriggerConfigPanel;
