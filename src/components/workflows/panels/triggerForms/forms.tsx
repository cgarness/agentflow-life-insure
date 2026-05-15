import React from "react";
import { Input } from "@/components/ui/input";
import type { Disposition, PipelineStage, LeadSource, CustomField } from "@/lib/types";
import { TRACKED_FIELDS, type TriggerType } from "@/lib/workflow-types";
import { Label, SelectField, NumberField } from "./fields";

export interface FormContext {
  triggerType: TriggerType;
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  data: {
    dispositions: Disposition[];
    leadStages: PipelineStage[];
    recruitStages: PipelineStage[];
    sources: LeadSource[];
    dateFields: CustomField[];
  };
}

export function renderTriggerForm(ctx: FormContext): React.ReactElement {
  const { triggerType, config, set, data } = ctx;

  if (triggerType === "disposition") {
    return (
      <SelectField
        label="Disposition"
        value={(config.disposition_id as string) || ""}
        onChange={(v) => set({ disposition_id: v })}
        options={data.dispositions.map((d) => ({ value: d.id, label: d.name }))}
        placeholder="Select disposition…"
      />
    );
  }

  if (triggerType === "stage_change") {
    const pType = (config.pipeline_type as "lead" | "recruit") || "lead";
    const stages = pType === "recruit" ? data.recruitStages : data.leadStages;
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
        options={[{ value: "", label: "Any source" }, ...data.sources.map((s) => ({ value: s.id, label: s.name }))]}
      />
    );
  }

  if (triggerType === "time_based") {
    return (
      <div className="space-y-3">
        <NumberField
          label="Days without contact"
          value={Number(config.days ?? 7)} min={1}
          onChange={(n) => set({ days: n, condition: "no_contact", applies_to: config.applies_to ?? "leads" })}
        />
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
      <div><Label>Tag name</Label>
        <Input value={(config.tag as string) || ""} onChange={(e) => set({ tag: e.target.value })}
          placeholder="e.g., hot-lead" maxLength={50} /></div>
    );
  }

  if (triggerType === "sms_received") {
    return (
      <div><Label>Only trigger if message contains (optional)</Label>
        <Input value={(config.keyword_filter as string) || ""} onChange={(e) => set({ keyword_filter: e.target.value })}
          placeholder="e.g., interested" maxLength={100} /></div>
    );
  }

  if (triggerType === "contact_field_changed") {
    return (
      <SelectField
        label="Watch field"
        value={(config.field_name as string) || ""}
        onChange={(v) => set({ field_name: v })}
        options={TRACKED_FIELDS.map((f) => ({ value: f.value, label: f.label }))}
        placeholder="Select a field…"
      />
    );
  }

  if (triggerType === "birthday_approaching") {
    return (
      <div className="space-y-3">
        <NumberField label="Days before birthday" value={Number(config.days_before ?? 7)} min={0}
          onChange={(n) => set({ days_before: n })} />
        <SelectField
          label="Applies to"
          value={(config.applies_to as string) || "leads"}
          onChange={(v) => set({ applies_to: v })}
          options={[{ value: "leads", label: "Leads" }, { value: "clients", label: "Clients" }]}
        />
      </div>
    );
  }

  if (triggerType === "custom_date_approaching") {
    return (
      <div className="space-y-3">
        <SelectField
          label="Custom date field"
          value={(config.field_name as string) || ""}
          onChange={(v) => set({ field_name: v })}
          options={data.dateFields.map((f) => ({ value: f.name, label: f.name }))}
          placeholder={data.dateFields.length === 0 ? "No Date custom fields configured" : "Select a field…"}
        />
        <NumberField label="Days before" value={Number(config.days_before ?? 30)} min={0}
          onChange={(n) => set({ days_before: n })} />
      </div>
    );
  }

  if (triggerType === "stale_lead") {
    return (
      <NumberField label="Days with no activity or stage change" value={Number(config.days ?? 14)} min={1}
        onChange={(n) => set({ days: n })} />
    );
  }

  if (triggerType === "appointment_booked" || triggerType === "appointment_cancelled" || triggerType === "appointment_no_show") {
    return (
      <div><Label>Appointment type (optional)</Label>
        <Input value={(config.appointment_type as string) || ""}
          onChange={(e) => set({ appointment_type: e.target.value || null })}
          placeholder="e.g., Sales Call" maxLength={100} />
        <p className="mt-1.5 text-xs text-muted-foreground">Leave blank to match any appointment type.</p></div>
    );
  }

  if (triggerType === "task_completed" || triggerType === "task_overdue" || triggerType === "email_replied") {
    return (
      <div className="rounded-md bg-yellow-500/10 p-3 text-xs text-yellow-500">
        Coming soon — this trigger type is not yet active. You can save the workflow as a draft.
      </div>
    );
  }

  return <p className="text-sm text-muted-foreground">No additional configuration needed for this trigger.</p>;
}
