import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { dispositionsSupabaseApi } from "@/lib/supabase-dispositions";
import { pipelineSupabaseApi, leadSourcesSupabaseApi } from "@/lib/supabase-settings";
import type { Disposition, PipelineStage, LeadSource } from "@/lib/types";
import type { TriggerType } from "@/lib/workflow-types";

interface Props {
  triggerType: TriggerType;
  config: Record<string, unknown>;
  onChange: (cfg: Record<string, unknown>) => void;
}

const TriggerConfigForm: React.FC<Props> = ({ triggerType, config, onChange }) => {
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [leadStages, setLeadStages] = useState<PipelineStage[]>([]);
  const [recruitStages, setRecruitStages] = useState<PipelineStage[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (triggerType === "disposition") {
          const d = await dispositionsSupabaseApi.getAll();
          if (alive) setDispositions(d);
        }
        if (triggerType === "stage_change") {
          const [l, r] = await Promise.all([
            pipelineSupabaseApi.getLeadStages(),
            pipelineSupabaseApi.getRecruitStages(),
          ]);
          if (alive) { setLeadStages(l); setRecruitStages(r); }
        }
        if (triggerType === "lead_created") {
          const s = await leadSourcesSupabaseApi.getAll();
          if (alive) setSources(s);
        }
      } catch {
        // soft-fail; user can pick from empty list
      }
    })();
    return () => { alive = false; };
  }, [triggerType]);

  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  if (triggerType === "disposition") {
    return (
      <SelectField
        label="Disposition"
        value={(config.disposition_id as string) || ""}
        onChange={(v) => set({ disposition_id: v })}
        options={dispositions.map((d) => ({ value: d.id, label: d.name }))}
        placeholder="Select disposition…"
      />
    );
  }

  if (triggerType === "stage_change") {
    const pType = (config.pipeline_type as "lead" | "recruit") || "lead";
    const stages = pType === "recruit" ? recruitStages : leadStages;
    return (
      <div className="space-y-3">
        <SelectField
          label="Pipeline"
          value={pType}
          onChange={(v) => set({ pipeline_type: v, from_stage_id: "", to_stage_id: "" })}
          options={[{ value: "lead", label: "Lead Pipeline" }, { value: "recruit", label: "Recruit Pipeline" }]}
        />
        <SelectField
          label="From Stage (optional)"
          value={(config.from_stage_id as string) || ""}
          onChange={(v) => set({ from_stage_id: v || null })}
          options={[{ value: "", label: "Any stage" }, ...stages.map((s) => ({ value: s.id, label: s.name }))]}
        />
        <SelectField
          label="To Stage *"
          value={(config.to_stage_id as string) || ""}
          onChange={(v) => set({ to_stage_id: v })}
          options={stages.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Select target stage…"
        />
      </div>
    );
  }

  if (triggerType === "lead_created") {
    return (
      <SelectField
        label="Lead Source (optional)"
        value={(config.source_id as string) || ""}
        onChange={(v) => set({ source_id: v || null })}
        options={[{ value: "", label: "Any source" }, ...sources.map((s) => ({ value: s.id, label: s.name }))]}
      />
    );
  }

  if (triggerType === "time_based") {
    return (
      <div className="space-y-3">
        <div>
          <Label>Days without contact</Label>
          <Input
            type="number"
            min={1}
            value={(config.days as number) || 7}
            onChange={(e) => set({ days: Math.max(1, parseInt(e.target.value) || 1) })}
          />
        </div>
        <SelectField
          label="Applies to"
          value={(config.applies_to as string) || "leads"}
          onChange={(v) => set({ applies_to: v })}
          options={[
            { value: "leads", label: "Leads" },
            { value: "clients", label: "Clients" },
            { value: "recruits", label: "Recruits" },
          ]}
        />
      </div>
    );
  }

  if (triggerType === "tag_added" || triggerType === "tag_removed") {
    return (
      <div>
        <Label>Tag name</Label>
        <Input
          value={(config.tag as string) || ""}
          onChange={(e) => set({ tag: e.target.value })}
          placeholder="e.g., hot-lead"
          maxLength={50}
        />
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      No additional configuration needed. Trigger this workflow manually from the canvas.
    </p>
  );
};

const Label: React.FC<React.PropsWithChildren> = ({ children }) => (
  <label className="mb-1.5 block text-sm font-medium text-foreground">{children}</label>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}> = ({ label, value, onChange, options, placeholder }) => (
  <div>
    <Label>{label}</Label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

export default TriggerConfigForm;
