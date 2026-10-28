import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { buildFieldCatalog, unmappedRequiredFields } from "@/lib/google-sheets/fieldCatalog";
import { applyColumnChoice, buildHeaderState, dropMissing, IGNORE_TARGET, reconcileIgnored, type HeaderState } from "@/lib/google-sheets/headerState";
import type { CatalogField, SheetsContext, SourceDraftV2 } from "@/lib/google-sheets/schema";
import CreateCustomFieldForm, { type CreateFieldViewer } from "./CreateCustomFieldForm";
import HeaderIssues from "./HeaderIssues";
import MappingColumnRow from "./MappingColumnRow";
import type { HeadersState } from "./useSheetHeaders";

const NONE = "__none__";

/** Never "Every column is imported" while anything — ignored, headerless, repeated or past GR — is left out. */
function summary(ignored: number, hs: HeaderState): string {
  const b = hs.beyondLimit;
  const outside = hs.columns.filter((c) => c.status === "blank_data" || c.status === "duplicate").length + (b ? b.columns.length : 0);
  const unchecked = !!b?.unchecked;
  if (!ignored && !outside && !unchecked) return "Every column is imported.";
  const n = ignored + outside;
  return `${n ? `${n} column${n === 1 ? "" : "s"} won't be imported` : "Some columns may not be imported"}${unchecked ? " (columns past the checked range included)" : ""} — you'll confirm on the next step.`;
}
export type CatalogState = { status: "loading" } | { status: "error" } | { status: "ready"; context: SheetsContext };

interface Props {
  draft: SourceDraftV2;
  onChange: (d: SourceDraftV2) => void;
  headers: HeadersState;
  onRetryHeaders: () => void;
  catalog: CatalogState;
  onRetryCatalog: () => void;
  refreshCatalog: () => Promise<CatalogField[] | null>;
  saved: { columns: { header: string; target: string }[]; ignored?: string[] } | null;
  viewer: CreateFieldViewer & { id: string | null };
  errors: string[];
}

/** Mapping v2: the CURRENT sheet's columns, each imported into a field or explicitly not imported. */
const MappingStepV2: React.FC<Props> = ({ draft, onChange, headers, onRetryHeaders, catalog, onRetryCatalog, refreshCatalog, saved, viewer, errors }) => {
  const [creating, setCreating] = useState<{ header: string; name: string } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ header: string; target: string; from: string } | null>(null);
  const ready = catalog.status === "ready" && headers.status === "ready";
  const fc = useMemo(() => (catalog.status === "ready" ? buildFieldCatalog(catalog.context, viewer.id) : null), [catalog, viewer.id]);
  const hs = useMemo(() => (headers.status === "ready" ? buildHeaderState(headers.data, saved, draft.columns) : null), [headers, saved, draft.columns]);

  if (catalog.status === "loading") return <div className="space-y-2" aria-busy="true"><p className="text-xs text-muted-foreground">Loading your fields…</p><Skeleton className="h-40 w-full" /></div>;
  if (catalog.status === "error") {
    return <Blocked text="Couldn't load your fields, so the field list would be incomplete." onRetry={onRetryCatalog} />;
  }
  if (headers.status === "loading") return <div className="space-y-2" aria-busy="true"><p className="text-xs text-muted-foreground">Reading the sheet's columns…</p><Skeleton className="h-40 w-full" /></div>;
  if (headers.status === "error") return <Blocked text={`${headers.message} Your saved mapping is unchanged.`} onRetry={onRetryHeaders} />;
  if (!ready || !fc || !hs) return null;

  const mappable = hs.mappableHeaders;
  const targetOf = (h: string) => draft.columns.find((c) => c.header === h)?.target ?? IGNORE_TARGET;
  const usedBy = new Map(draft.columns.map((c) => [c.target, c.header]));
  const choose = (header: string, target: string) => {
    const from = usedBy.get(target);
    if (target !== IGNORE_TARGET && from && from !== header) { setPendingMove({ header, target, from }); return; }
    onChange(applyColumnChoice(draft, header, target, mappable));
  };
  const required = unmappedRequiredFields(catalog.context, draft.columns.map((c) => c.target));
  const sources = Array.from(new Set(["Google Sheets", ...catalog.context.lead_sources]));

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
            <SelectTrigger aria-label="Lead Source"><SelectValue /></SelectTrigger>
            <SelectContent>{sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Lead ID column</Label>
        <Select value={draft.idHeader ?? NONE} onValueChange={(v) => onChange(reconcileIgnored({ ...draft, idHeader: v === NONE ? null : v,
          columns: draft.columns.filter((c) => c.header !== v) }, mappable))}>
          <SelectTrigger aria-label="Lead ID column"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None — use row order</SelectItem>
            {mappable.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <HeaderIssues state={hs} />
      {hs.missing.length > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(dropMissing(draft, hs.missing, mappable))}>
          Stop importing the missing columns
        </Button>
      )}
      <div className="space-y-3">
        {hs.columns.filter((c) => c.mappable && c.header !== draft.idHeader).map((c) => (
          <MappingColumnRow key={c.key} column={c} value={targetOf(c.header)} catalog={fc} usedBy={usedBy}
            pendingMove={pendingMove?.header === c.header ? { target: pendingMove.target, from: pendingMove.from } : null}
            onSelect={(t) => choose(c.header, t)}
            onConfirmMove={() => { onChange(applyColumnChoice(draft, c.header, pendingMove!.target, mappable)); setPendingMove(null); }}
            onCancelMove={() => setPendingMove(null)}
            onCreate={(name) => setCreating({ header: c.header, name })}
            createForm={creating?.header === c.header ? (
              <CreateCustomFieldForm suggestedName={creating.name} fields={catalog.context.custom_fields} viewer={viewer} refreshCatalog={refreshCatalog}
                onCancel={() => setCreating(null)}
                onMapped={(target, message) => { setCreating(null); if (target) { onChange(applyColumnChoice(draft, c.header, target, mappable)); toast.success(message); } }} />
            ) : null} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {summary(draft.ignored.length, hs)}
      </p>
      {required.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">Required fields not in this sheet: {required.join(", ")}. Leads will import without them.</p>}
      {errors.length > 0 && <p className="text-xs text-destructive" role="alert">{errors[0]}</p>}
    </div>
  );
};

const Blocked: React.FC<{ text: string; onRetry: () => void }> = ({ text, onRetry }) => (
  <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
    <span>{text}</span>
    <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
  </div>
);

export default MappingStepV2;
