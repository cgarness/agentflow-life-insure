import React, { useEffect, useMemo, useRef, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import { autoMapV2 } from "@/lib/google-sheets/autoMap";
import { buildFieldCatalog } from "@/lib/google-sheets/fieldCatalog";
import { buildHeaderState, reconcileIgnored } from "@/lib/google-sheets/headerState";
import { serverSupportsMappingV2 } from "@/lib/google-sheets/mappingGate";
import { acknowledgementToken, isColumnsError, needsAcknowledgement, saveBlockers } from "@/lib/google-sheets/previewGate";
import { sourceDraftV2Schema, toPayloadV2, type SheetSourceRow, type SheetsContext, type SourceDraftV2 } from "@/lib/google-sheets/schema";
import AddSheetDialog from "./AddSheetDialog";
import type { CreateFieldViewer } from "./CreateCustomFieldForm";
import MappingStepV2, { type CatalogState } from "./MappingStepV2";
import PreviewStepV2 from "./PreviewStepV2";
import MappingDialogFooter from "./MappingDialogFooter";
import type { ReviewOverride } from "./SheetReviewDialog";
import SheetPickStep from "./SheetPickStep";
import { usePreviewV2 } from "./usePreviewV2";
import { useSheetHeaders } from "./useSheetHeaders";
import { useSheetPick, type PickResultWithHeaders } from "./useSheetPick";

interface Props {
  source: SheetSourceRow | null;
  context: UseQueryResult<SheetsContext>;
  viewer: CreateFieldViewer & { id: string | null };
  onClose: () => void;
  onSaved: () => void;
  onNeedsReview: (s: SheetSourceRow, o: ReviewOverride) => void;
}

/**
 * Mapping v2 entry point (the build flag is on). The catalog is re-read on open; only when the server confirms mapping
 * v2 does the v2 editor run. Otherwise the legacy editor runs unchanged — and a v2 mapping is never opened by it.
 */
const AddSheetDialogV2: React.FC<Props> = (props) => {
  const { context, source } = props;
  useEffect(() => { void context.refetch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (context.isFetchedAfterMount && context.isSuccess && !serverSupportsMappingV2(context.data)) {
    if (source?.mapping?.v === 2) return <UnavailableNotice onClose={props.onClose} />;
    return <AddSheetDialog source={source} context={context.data} onClose={props.onClose} onSaved={props.onSaved} onNeedsReview={props.onNeedsReview} />;
  }
  return <MappingDialogV2 {...props} />;
};

export const UnavailableNotice: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent className="max-w-md" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Edit sheet</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">This sheet uses the updated column mapping, which is temporarily unavailable. It keeps importing as saved.</p>
      <DialogFooter><Button size="sm" onClick={onClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
);

const fromSource = (s: SheetSourceRow): SourceDraftV2 => ({
  displayName: s.display_name, leadSourceDefault: s.lead_source_default, idHeader: s.identity_mode === "source_id" ? s.id_header : null,
  columns: s.mapping?.columns ?? [], ignored: s.mapping?.v === 2 ? s.mapping.ignored : [], includeExisting: s.include_existing, acknowledged: false,
});

const MappingDialogV2: React.FC<Props> = ({ source, context, viewer, onClose, onSaved, onNeedsReview }) => {
  const active = source !== null && source.state !== "draft";
  const [step, setStep] = useState<"pick" | "map" | "preview">(source ? "map" : "pick");
  const [pick, setPick] = useState<PickResultWithHeaders | null>(source ? { spreadsheetId: source.spreadsheet_id, spreadsheetName: source.spreadsheet_name,
    sheetId: Number(source.sheet_id), sheetTitle: source.sheet_title, headers: [] } : null);
  const [draft, setDraft] = useState<SourceDraftV2>(source ? fromSource(source) : {
    displayName: "", leadSourceDefault: "Google Sheets", idHeader: null, columns: [], ignored: [], includeExisting: false, acknowledged: false });
  const [saved, setSaved] = useState<{ id: string; version: number } | null>(source ? { id: source.id, version: source.config_version } : null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [driftSeen, setDriftSeen] = useState<string[]>([]);
  const autoMapPending = useRef(false);
  const lastSignature = useRef<string | null | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const headersApi = useSheetHeaders(pick ? { spreadsheetId: pick.spreadsheetId, sheetId: pick.sheetId } : null, pick?.headerInfo);
  const headers = headersApi.state;

  const catalog = useMemo<CatalogState>(() => (!context.isFetchedAfterMount ? { status: "loading" }
    : context.isError || !context.data ? { status: "error" } : { status: "ready", context: context.data }),
  [context.isFetchedAfterMount, context.isError, context.data]);
  const fc = useMemo(() => (catalog.status === "ready" ? buildFieldCatalog(catalog.context, viewer.id) : null), [catalog, viewer.id]);
  const savedMapping = source ? { columns: source.mapping?.columns ?? [], ignored: source.mapping?.v === 2 ? source.mapping.ignored : undefined } : null;
  const hs = headers.status === "ready" ? buildHeaderState(headers.data, savedMapping, draft.columns) : null;
  const mappable = hs?.mappableHeaders ?? [];
  // Save / Enable need a successful preview of exactly this draft, unchanged columns and the acknowledgement.
  const preview = usePreviewV2(pick, draft, step === "preview");
  const blockers = saveBlockers(draft, preview.key, preview.state);
  const ackToken = acknowledgementToken(preview.state);
  const outsideNeedsAck = preview.state.status === "ready" && needsAcknowledgement(preview.state.data.not_importable);
  // What can't be imported changed since the owner confirmed it: confirm again.
  useEffect(() => {
    if (preview.state.status !== "ready") return;
    const sig = preview.state.data.not_importable?.signature ?? null;
    if (lastSignature.current !== undefined && lastSignature.current !== sig) setDraft((d) => ({ ...d, acknowledged: false }));
    lastSignature.current = sig;
  }, [preview.state]);

  // Auto-detect only on a fresh pick, once the catalog is ready; then every other column is listed as not imported.
  useEffect(() => {
    if (!autoMapPending.current || !fc || headers.status !== "ready" || catalog.status !== "ready") return;
    autoMapPending.current = false;
    const auto = autoMapV2(headers.data.header, fc, catalog.context.custom_fields);
    setDraft((d) => reconcileIgnored({ ...d, ...auto }, buildHeaderState(headers.data, null, auto.columns).mappableHeaders));
  }, [fc, headers, catalog]);
  // Whenever the current columns are (re)read — editing, or "Review columns" after the sheet changed — unmapped columns
  // become explicit "not imported" entries (a fresh pick waits for auto-detection above).
  useEffect(() => { if (hs && !autoMapPending.current) setDraft((d) => reconcileIgnored(d, hs.mappableHeaders)); }, [headers]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewColumns = () => {
    const changed = preview.state.status === "ready" ? preview.state.data.unaccounted_headers ?? [] : [];
    setDriftSeen((d) => Array.from(new Set([...d, ...changed])));
    setErrors([]); setStep("map"); void headersApi.retry();
  };

  const onPicked = (p: PickResultWithHeaders) => {
    autoMapPending.current = true;
    setPick(p);
    setDraft((d) => ({ ...d, displayName: d.displayName || `${p.spreadsheetName} – ${p.sheetTitle}`.slice(0, 120) }));
    setStep("map");
  };
  const sheetPick = useSheetPick(onPicked, contentRef);

  const validate = (needAck: boolean): boolean => {
    const r = sourceDraftV2Schema(mappable, { notImportable: outsideNeedsAck }).safeParse(draft);
    const issues = r.success ? [] : r.error.issues.filter((i) => needAck || i.path[0] !== "acknowledged").map((i) => i.message);
    if (hs?.duplicatedMapped.length) issues.unshift(`Rename the repeated column in Google Sheets: ${hs.duplicatedMapped.join(", ")}`);
    setErrors(issues);
    return issues.length === 0;
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) {
      setErrors([e instanceof SheetsApiError ? (e.code.startsWith("header:duplicate") ? "A mapped column appears more than once in the sheet." : e.message)
        : "Couldn't save. Your changes are kept."]);
      // The sheet no longer matches what was previewed: show it as it is now (nothing was written).
      if (e instanceof SheetsApiError && (isColumnsError(e.code) || e.code === "inspection_incomplete")) void preview.retry();
    } finally { setBusy(false); }
  };
  const save = async () => {
    const res = await sheetsApi<{ source_id: string; config_version: number }>("save", {
      source_id: saved?.id ?? null, expected_version: saved?.version ?? null, payload: toPayloadV2(draft, pick!), not_importable_ack: ackToken });
    const next = { id: res.source_id, version: res.config_version };
    setSaved(next);
    return next;
  };
  const saveActive = () => run(async () => {
    if (blockers.length || !validate(true) || !source) return;
    if ((draft.idHeader ?? null) !== (source.identity_mode === "source_id" ? source.id_header : null)) {
      onNeedsReview(source, { identityMode: draft.idHeader ? "source_id" : "row_position", idHeader: draft.idHeader, columns: draft.columns,
        ignored: draft.ignored, notImportableAck: ackToken });
      return;
    }
    await save();
    toast.success("Mapping saved");
    onSaved(); onClose();
  });
  const enable = () => run(async () => {
    if (blockers.length || !validate(true)) return;
    const s = await save();
    const r = await sheetsApi<{ outcome: string }>("activate", { source_id: s.id, expected_version: s.version, not_importable_ack: ackToken });
    toast.success(r.outcome === "already_active" ? "Already enabled" : draft.includeExisting ? "Enabled · importing existing rows" : "Enabled · watching for new rows");
    onSaved(); onClose();
  });

  return (
    <Dialog open={!sheetPick.picking} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent ref={contentRef} className="max-h-[90vh] max-w-3xl overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{source ? "Edit sheet" : "Add sheet"}</DialogTitle></DialogHeader>
        {step === "pick" && <SheetPickStep pick={sheetPick} />}
        {step === "map" && pick && (
          <MappingStepV2 draft={draft} onChange={setDraft} headers={headers} onRetryHeaders={headersApi.retry} catalog={catalog}
            onRetryCatalog={() => void context.refetch()} refreshCatalog={async () => (await context.refetch()).data?.custom_fields ?? null}
            saved={savedMapping} viewer={viewer} errors={errors} />
        )}
        {step === "preview" && pick && fc && (
          <>
            <PreviewStepV2 preview={preview.state} draft={draft} onChange={setDraft} showExisting={!active} catalog={fc}
              newColumns={[...(hs?.columns.filter((c) => c.status === "new").map((c) => c.header) ?? []), ...driftSeen]}
              onRetry={() => void preview.retry()} onReviewColumns={reviewColumns} />
            {errors.length > 0 && <p className="text-xs text-destructive" role="alert">{errors[0]}</p>}
          </>
        )}
        <MappingDialogFooter step={step} active={active} busy={busy} canPreview={!!hs && !!fc} blockers={blockers}
          onBack={() => { setErrors([]); setStep("map"); }} onPreview={() => { if (validate(false)) setStep("preview"); }}
          onSave={active ? saveActive : enable} />
      </DialogContent>
    </Dialog>
  );
};

export default AddSheetDialogV2;
