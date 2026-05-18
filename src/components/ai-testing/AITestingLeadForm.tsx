import React from "react";
import type { LeadContext } from "@/lib/aiTestingPrompt";

type Props = {
  lead: LeadContext;
  onChange: (lead: LeadContext) => void;
};

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export const AITestingLeadForm: React.FC<Props> = ({ lead, onChange }) => {
  const set = (key: keyof LeadContext, value: string) => {
    onChange({ ...lead, [key]: value });
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Lead details</h2>
        <p className="text-xs text-muted-foreground">
          The agent sees these in its instructions — use a first name so it greets them naturally.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">First name</label>
          <input className={inputClass} value={lead.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} placeholder="Maria" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Last name</label>
          <input className={inputClass} value={lead.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} placeholder="Garcia" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Age</label>
          <input className={inputClass} value={lead.age ?? ""} onChange={(e) => set("age", e.target.value)} placeholder="42" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">State</label>
          <input className={inputClass} value={lead.state ?? ""} onChange={(e) => set("state", e.target.value)} placeholder="CA" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">City</label>
          <input className={inputClass} value={lead.city ?? ""} onChange={(e) => set("city", e.target.value)} placeholder="Riverside" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Lead source</label>
          <input className={inputClass} value={lead.lead_source ?? ""} onChange={(e) => set("lead_source", e.target.value)} placeholder="Facebook lead form" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Product interest</label>
          <input className={inputClass} value={lead.product_interest ?? ""} onChange={(e) => set("product_interest", e.target.value)} placeholder="Term life for family" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Your name (on the call)</label>
          <input className={inputClass} value={lead.agent_name ?? ""} onChange={(e) => set("agent_name", e.target.value)} placeholder="Alex" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Agency name</label>
          <input className={inputClass} value={lead.agency_name ?? ""} onChange={(e) => set("agency_name", e.target.value)} placeholder="Family First Life" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <textarea
            className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={lead.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Requested info on $500k term. Best time: evenings. Spouse on the policy."
          />
        </div>
      </div>
    </section>
  );
};
