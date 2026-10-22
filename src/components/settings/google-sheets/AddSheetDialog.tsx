import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import { autoMap } from "@/lib/google-sheets/autoMap";
import { sourceDraftSchema, toPayload, type SheetSourceRow, type SheetsContext, type SourceDraft } from "@/lib/google-sheets/schema";
import type { ReviewOverride } from "./SheetReviewDialog";
import SheetPickStep, { type PickResult } from "./SheetPickStep";
import SheetMappingStep from "./SheetMappingStep";
import SheetPreviewStep from "./SheetPreviewStep";

interface Props {
  source: SheetSourceRow | null;
  context: SheetsContext | null;
  onClose: () => void;
  onSaved: () => void;
  onNeedsReview: (s: SheetSourceRow, o: ReviewOverride) => void;
}

const fromSource = (s: SheetSourceRow): SourceDraft => ({
  displayName: s.display_name, leadSourceDefault: s.lead_source_default, idHeader: s.identity_mode === "source_id" ? s.id_header : null,
  columns: s.mapping?.columns ?? [], includeExisting: s.include_existing,
});

/** Add / edit a sheet. The draft survives failed saves and activations; the saved source id is reused. */
const AddSheetDialog: React.FC<Props> = ({ source, context, onClose, onSaved, onNeedsReview }) => {
  const active = source !== null && source.state !== "draft";
  const [step, setStep] = useState<"pick" | "map" | "preview">(source ? "map" : "pick");
  const [pick, setPick] = useState<PickResult | null>(source ? {
    spreadsheetId: source.spreadsheet_id, spreadsheetName: source.spreadsheet_name, sheetId: Number(source.sheet_id),
    sheetTitle: source.sheet_title, headers: source.mapping?.columns.map((c) => c.header) ?? [] } : null);
  const [draft, setDraft] = useState<SourceDraft>(source ? fromSource(source) : {
    displayName: "", leadSourceDefault: "Google Sheets", idHeader: null, columns: [], includeExisting: false });
  const [saved, setSaved] = useState<{ id: string; version: number } | null>(source ? { id: source.id, version: source.config_version } : null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Editing: refresh headers from the live sheet (falls back to the saved mapping's headers).
  useEffect(() => {
    if (!source) return;
    sheetsApi<{ header: string[] }>("headers", { spreadsheet_id: source.spreadsheet_id, sheet_id: source.sheet_id })
      .then((h) => { if (alive.current) setPick((p) => (p ? { ...p, headers: Array.from(new Set([...h.header, ...p.headers])) } : p)); })
      .catch(() => undefined);
  }, [source]);

  const onPicked = (p: PickResult) => {
    const auto = autoMap(p.headers, context?.custom_fields ?? []);
    setPick(p);
    setDraft((d) => ({ ...d, displayName: d.displayName || `${p.spreadsheetName} – ${p.sheetTitle}`.slice(0, 120), ...auto }));
    setStep("map");
  };

  const validate = (): boolean => {
    const r = sourceDraftSchema.safeParse(draft);
    setErrors(r.success ? [] : r.error.issues.map((i) => i.message));
    return r.success;
  };

  const save = async (): Promise<{ id: string; version: number } | null> => {
    if (!pick) return null;
    const res = await sheetsApi<{ source_id: string; config_version: number }>("save", {
      source_id: saved?.id ?? null, expected_version: saved?.version ?? null, payload: toPayload(draft, pick) });
    const next = { id: res.source_id, version: res.config_version };
    if (alive.current) setSaved(next);
    return next;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); }
    catch (e) { if (alive.current) setErrors([e instanceof SheetsApiError ? e.message : "Couldn't save. Your changes are kept."]); }
    finally { if (alive.current) setBusy(false); }
  };

  const saveActive = () => run(async () => {
    if (!validate() || !source) return;
    const identityChanged = (draft.idHeader ?? null) !== (source.identity_mode === "source_id" ? source.id_header : null);
    if (identityChanged) {
      onNeedsReview(source, { identityMode: draft.idHeader ? "source_id" : "row_position", idHeader: draft.idHeader, columns: draft.columns });
      return;
    }
    await save();
    toast.success("Mapping saved");
    onSaved(); onClose();
  });

  const enable = () => run(async () => {
    if (!validate()) return;
    const s = await save(); // draft persisted first; a failed activation keeps the same source id
    if (!s) return;
    const r = await sheetsApi<{ outcome: string }>("activate", { source_id: s.id, expected_version: s.version });
    toast.success(r.outcome === "already_active" ? "Already enabled" : draft.includeExisting ? "Enabled · importing existing rows" : "Enabled · watching for new rows");
    onSaved(); onClose();
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{source ? "Edit sheet" : "Add sheet"}</DialogTitle></DialogHeader>
        {step === "pick" && <SheetPickStep onPicked={onPicked} />}
        {step === "map" && pick && <SheetMappingStep headers={pick.headers} draft={draft} onChange={setDraft} context={context} errors={errors} />}
        {step === "preview" && pick && (
          <>
            <SheetPreviewStep pick={pick} draft={draft} onChange={setDraft} showExisting={!active} />
            {errors.length > 0 && <p className="text-xs text-destructive">{errors[0]}</p>}
          </>
        )}
        <DialogFooter className="gap-2">
          {step === "preview" && <Button variant="outline" size="sm" onClick={() => setStep("map")} disabled={busy}>Back</Button>}
          {step === "map" && active && <Button size="sm" onClick={saveActive} disabled={busy}>Save</Button>}
          {step === "map" && !active && (
            <Button size="sm" onClick={() => { if (validate()) setStep("preview"); }} disabled={busy}>Preview</Button>
          )}
          {step === "preview" && <Button size="sm" onClick={enable} disabled={busy}>Enable</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddSheetDialog;
