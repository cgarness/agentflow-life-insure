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
  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-end">
    <div className="space-y-1.5 sm:col-span-2">
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
    <div className="flex h-10 items-center gap-2.5 rounded-md bg-muted/40 px-3 ring-1 ring-inset ring-border/50">
      <Switch id="grid-active" checked={draft.isActive} disabled={disabled} onCheckedChange={(isActive) => onChange({ isActive })} />
      <Label htmlFor="grid-active">Active</Label>
    </div>
  </div>
);

export default GridDetailsSection;
