import React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { FieldCatalog } from "@/lib/google-sheets/fieldCatalog";
import { isColumnsError, type PreviewState } from "@/lib/google-sheets/previewGate";
import { STANDARD_FIELDS, type SourceDraftV2 } from "@/lib/google-sheets/schema";
import IgnoredColumnsPanel from "./IgnoredColumnsPanel";

const OUTCOME: Record<string, string> = {
  import: "Ready", invalid: "Needs fixes", duplicate_flag: "Duplicate · flagged", duplicate_skip: "Duplicate · skipped", duplicate_import: "Duplicate",
  missing_id: "No Lead ID", duplicate_id: "Lead ID conflict", repeat: "Repeat · imported once",
};
const LABELS = new Map<string, string>(STANDARD_FIELDS.map((f) => [f.key, f.label]));
const CORE = new Set(["first_name", "last_name", "phone"]);

interface Props {
  preview: PreviewState; draft: SourceDraftV2; onChange: (d: SourceDraftV2) => void; showExisting: boolean;
  catalog: FieldCatalog; newColumns: string[]; onRetry: () => void; onReviewColumns: () => void;
}

/**
 * Read-only v2 preview (creates nothing; the dialog owns the request). Every mapped optional field is shown exactly
 * as it will be STORED — the values come from the server's own import pass — then everything that won't be imported
 * needs the owner's confirmation. A sheet whose columns changed must be reviewed before anything can be saved.
 */
const PreviewStepV2: React.FC<Props> = ({ preview, draft, onChange, showExisting, catalog, newColumns, onRetry, onReviewColumns }) => {
  if (preview.status === "error") {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-xs text-destructive">{preview.message}</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          {isColumnsError(preview.code) && <Button type="button" size="sm" variant="outline" onClick={onReviewColumns}>Review columns</Button>}
        </div>
      </div>
    );
  }
  if (preview.status !== "ready") {
    return <div className="space-y-2" aria-busy="true"><p className="text-xs text-muted-foreground">Checking the sheet…</p><Skeleton className="h-32 w-full" /></div>;
  }
  const data = preview.data;
  const optional = [...draft.columns.filter((c) => !CORE.has(c.target)).map((c) => ({ target: c.target, header: c.header })),
    ...(draft.columns.some((c) => c.target === "lead_source") ? [] : [{ target: "lead_source", header: "(default)" }])];
  const label = (t: string) => LABELS.get(t) ?? catalog.byValue.get(t)?.label ?? "Removed field";
  const existing = Math.max(0, data.valid_rows - data.imported_before);
  const drift = data.unaccounted_headers ?? [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.total_rows} row{data.total_rows === 1 ? "" : "s"} now · {data.valid_rows} ready · {data.invalid_rows} need fixes{data.repeat_rows ? ` · ${data.repeat_rows} ${data.repeat_rows === 1 ? "repeat" : "repeats"}` : ""}
        {" · values shown exactly as they will be saved"}
      </p>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Row</th><th className="p-2 text-left">Name</th><th className="p-2 text-left">Phone</th><th className="p-2 text-left">Result</th>
              {optional.map((o) => <th key={o.target} className="whitespace-nowrap p-2 text-left" title={`Column: ${o.header}`}>{label(o.target)}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const byTarget = new Map((r.fields ?? []).map((f) => [f.target, f]));
              return (
                <tr key={r.row} className="border-t">
                  <td className="p-2">{r.row}</td>
                  <td className="max-w-[10rem] truncate p-2">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td className="p-2">{r.phone || "—"}</td>
                  <td className="whitespace-nowrap p-2">{OUTCOME[r.outcome] ?? r.outcome}</td>
                  {optional.map((o) => {
                    const f = byTarget.get(o.target);
                    return (
                      <td key={o.target} className="max-w-[12rem] truncate p-2" title={f?.value}>
                        {f ? f.value : "—"}
                        {f?.kept_as_text && <span className="ml-1 text-amber-600 dark:text-amber-400">kept as typed</span>}
                        {f?.not_an_option && <span className="ml-1 text-amber-600 dark:text-amber-400">not an option</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drift.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-xs text-destructive">The sheet's columns changed since you mapped it: new columns {drift.join(", ")}. Review them before saving.</p>
          <Button type="button" size="sm" variant="outline" onClick={onReviewColumns}>Review columns</Button>
        </div>
      )}
      <IgnoredColumnsPanel ignored={draft.ignored} newColumns={newColumns} notImportable={data.not_importable} acknowledged={draft.acknowledged}
        onAcknowledge={(v) => onChange({ ...draft, acknowledged: v })} />
      {showExisting && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Checkbox id="gs-existing" checked={draft.includeExisting} onCheckedChange={(v) => onChange({ ...draft, includeExisting: v === true })} />
            <Label htmlFor="gs-existing" className="text-sm">Also import existing rows</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {draft.includeExisting ? `${existing} existing rows will be imported${data.imported_before ? ` · ${data.imported_before} imported before` : ""}.`
              : "Only rows added after you enable this sheet are imported."}
          </p>
          {draft.includeExisting && data.has_lead_created_workflows && <p className="text-xs text-amber-500">Lead Created workflows will run for these leads.</p>}
        </div>
      )}
      {!showExisting && <p className="text-xs text-muted-foreground">Changes apply to rows imported after you save. Leads already imported are not changed.</p>}
    </div>
  );
};

export default PreviewStepV2;
