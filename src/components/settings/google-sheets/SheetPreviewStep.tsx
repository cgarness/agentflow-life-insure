import React, { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import { toPayload, type PreviewResult, type SourceDraft } from "@/lib/google-sheets/schema";
import type { PickResult } from "./SheetPickStep";

const OUTCOME: Record<string, string> = {
  import: "Ready", invalid: "Needs fixes", duplicate_flag: "Duplicate · flagged", duplicate_skip: "Duplicate · skipped", duplicate_import: "Duplicate",
  missing_id: "No Lead ID", duplicate_id: "Lead ID conflict", repeat: "Repeat · imported once",
};

interface Props { pick: PickResult; draft: SourceDraft; onChange: (d: SourceDraft) => void; showExisting: boolean }

/** Read-only preview: creates no leads and starts no workflows. */
const SheetPreviewStep: React.FC<Props> = ({ pick, draft, onChange, showExisting }) => {
  const [data, setData] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true; // a late response for an older mapping is discarded
    setData(null); setError(null);
    const p = toPayload(draft, pick);
    sheetsApi<PreviewResult>("preview", { spreadsheet_id: p.spreadsheet_id, sheet_id: p.sheet_id, mapping: p.mapping,
      identity_mode: p.identity_mode, id_header: p.id_header })
      .then((r) => { if (current) setData(r); })
      .catch((e) => { if (current) setError(e instanceof SheetsApiError ? e.message : "Couldn't load a preview."); });
    return () => { current = false; };
    // includeExisting does not change the preview read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick.spreadsheetId, pick.sheetId, JSON.stringify(draft.columns), draft.idHeader]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data) return <Skeleton className="h-32 w-full" />;
  const existing = Math.max(0, data.valid_rows - data.imported_before);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.total_rows} rows now · {data.valid_rows} ready · {data.invalid_rows} need fixes{data.repeat_rows ? ` · ${data.repeat_rows} ${data.repeat_rows === 1 ? "repeat" : "repeats"}` : ""}
      </p>
      <div className="max-h-56 overflow-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr><th className="p-2 text-left">Row</th><th className="p-2 text-left">Name</th><th className="p-2 text-left">Phone</th><th className="p-2 text-left">Result</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.row} className="border-t">
                <td className="p-2">{r.row}</td>
                <td className="p-2 truncate max-w-[10rem]">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</td>
                <td className="p-2">{r.phone || "—"}</td>
                <td className="p-2">{OUTCOME[r.outcome] ?? r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showExisting && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Checkbox id="gs-existing" checked={draft.includeExisting} onCheckedChange={(v) => onChange({ ...draft, includeExisting: v === true })} />
            <Label htmlFor="gs-existing" className="text-sm">Also import existing rows</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {draft.includeExisting
              ? `${existing} existing rows will be imported${data.imported_before ? ` · ${data.imported_before} imported before` : ""}.`
              : "Only rows added after you enable this sheet are imported."}
          </p>
          {draft.includeExisting && data.has_lead_created_workflows && (
            <p className="text-xs text-amber-500">Lead Created workflows will run for these leads.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default SheetPreviewStep;
