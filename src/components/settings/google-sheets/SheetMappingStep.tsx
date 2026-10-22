import React, { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customFieldOptions } from "@/lib/google-sheets/autoMap";
import { SKIP, STANDARD_FIELDS, type SheetsContext, type SourceDraft } from "@/lib/google-sheets/schema";

interface Props {
  headers: string[];
  draft: SourceDraft;
  onChange: (d: SourceDraft) => void;
  context: SheetsContext | null;
  errors: string[];
}

const NONE = "__none__";

/** Column → field mapping. Only supported standard fields and permitted active custom fields. */
const SheetMappingStep: React.FC<Props> = ({ headers, draft, onChange, context, errors }) => {
  const custom = useMemo(() => customFieldOptions(context?.custom_fields ?? []), [context]);
  const sources = useMemo(() => Array.from(new Set(["Google Sheets", ...(context?.lead_sources ?? [])])), [context]);
  const targetOf = (h: string) => draft.columns.find((c) => c.header === h)?.target ?? SKIP;
  const setTarget = (h: string, target: string) => {
    const rest = draft.columns.filter((c) => c.header !== h && (target === SKIP || c.target !== target));
    onChange({ ...draft, columns: target === SKIP ? rest : [...rest, { header: h, target }] });
  };
  const usable = headers.filter((h) => h.trim());

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="gs-name" className="text-xs">Name</Label>
          <Input id="gs-name" value={draft.displayName} maxLength={120} onChange={(e) => onChange({ ...draft, displayName: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Lead Source (when not in the sheet)</Label>
          <Select value={draft.leadSourceDefault} onValueChange={(v) => onChange({ ...draft, leadSourceDefault: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Lead ID column</Label>
        <Select value={draft.idHeader ?? NONE} onValueChange={(v) => onChange({
          ...draft, idHeader: v === NONE ? null : v, columns: draft.columns.filter((c) => c.header !== v) })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None — use row order</SelectItem>
            {usable.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        {usable.filter((h) => h !== draft.idHeader).map((h) => (
          <div key={h} className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm truncate" title={h}>{h}</span>
            <Select value={targetOf(h)} onValueChange={(v) => setTarget(h, v)}>
              <SelectTrigger aria-label={`Field for ${h}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SKIP}>Don't import</SelectItem>
                {STANDARD_FIELDS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                {custom.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {errors.length > 0 && <p className="text-xs text-destructive">{errors[0]}</p>}
    </div>
  );
};

export default SheetMappingStep;
