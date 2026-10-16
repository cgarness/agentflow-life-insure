import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { GridDraft } from "@/lib/commission/gridDraft";

interface GridDetailsSectionProps {
  draft: GridDraft;
  disabled: boolean;
  onChange: (patch: Partial<Pick<GridDraft, "name" | "effectiveDate" | "isActive">>) => void;
}

/** Name, effective date and active status. Values are kept exactly as typed; validation reports problems. */
const GridDetailsSection: React.FC<GridDetailsSectionProps> = ({ draft, disabled, onChange }) => (
  <section className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
    <div className="space-y-1.5">
      <Label htmlFor="grid-name">Grid name</Label>
      <Input id="grid-name" value={draft.name} maxLength={120} disabled={disabled} onChange={(e) => onChange({ name: e.target.value })} />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="grid-effective-date">Effective date</Label>
      <Input
        id="grid-effective-date"
        type="date"
        value={draft.effectiveDate}
        disabled={disabled}
        onChange={(e) => onChange({ effectiveDate: e.target.value })}
      />
    </div>
    <div className="flex items-center gap-2 pb-2">
      <Switch id="grid-active" checked={draft.isActive} disabled={disabled} onCheckedChange={(isActive) => onChange({ isActive })} />
      <Label htmlFor="grid-active">Active</Label>
    </div>
  </section>
);

export default GridDetailsSection;
