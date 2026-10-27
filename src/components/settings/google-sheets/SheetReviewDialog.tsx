import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import type { SheetSourceRow, StructuralReview } from "@/lib/google-sheets/schema";
import { REVIEW_REASONS } from "@/lib/google-sheets/status";

export interface ReviewOverride {
  identityMode: "source_id" | "row_position"; idHeader: string | null; columns: { header: string; target: string }[];
  /** Mapping v2 only: the acknowledged ignored headers of the edited mapping. */
  ignored?: string[];
  /** Mapping v2 only: the preview's token for the content no mapping can import, as the owner acknowledged it. */
  notImportableAck?: string;
}
interface Props { source: SheetSourceRow; override?: ReviewOverride; onClose: () => void; onDone: () => void }

const REFRESH = new Set(["review_changed", "connection_changed"]);

const Choice: React.FC<{ id: string; value: string; onChange: (v: string) => void; options: [string, string][] }> = ({ id, value, onChange, options }) => (
  <RadioGroup value={value} onValueChange={onChange} className="pl-1">
    {options.map(([v, label]) => (
      <div key={v} className="flex items-center gap-2">
        <RadioGroupItem value={v} id={`${id}-${v}`} /><Label htmlFor={`${id}-${v}`}>{label}</Label>
      </div>
    ))}
  </RadioGroup>
);

/**
 * Recovery after structural changes or a Lead ID change. Rows matched by Lead ID are definitive; rows that match
 * only by name, phone and email are ambiguous, so the agent decides (no preselection). The apply is bound to the
 * reviewed snapshot: if the sheet or the Google connection changed, the preview refreshes and choices are kept.
 */
const SheetReviewDialog: React.FC<Props> = ({ source, override, onClose, onDone }) => {
  const [data, setData] = useState<StructuralReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [matched, setMatched] = useState("");
  const [unknown, setUnknown] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const body = useCallback(() => ({
    source_id: source.id, expected_version: source.config_version,
    identity_mode: override?.identityMode ?? source.identity_mode,
    id_header: override ? override.idHeader : source.id_header,
    // Keeps the stored mapping version: a v2 mapping is never downgraded by a review (v1 payloads are unchanged).
    mapping: override?.ignored !== undefined ? { v: 2, columns: override.columns, ignored: override.ignored }
      : source.mapping?.v === 2 ? { ...source.mapping, columns: override?.columns ?? source.mapping.columns }
      : { v: 1, columns: override?.columns ?? source.mapping.columns },
    ...(override?.notImportableAck ? { not_importable_ack: override.notImportableAck } : {}),
  }), [source, override]);

  const load = useCallback(async () => {
    setData(null);
    try {
      const r = await sheetsApi<StructuralReview>("review_preview", body());
      if (alive.current) setData(r);
    } catch (e) {
      if (alive.current) setError(e instanceof SheetsApiError ? e.message : "Couldn't read the sheet.");
    }
  }, [body]);
  useEffect(() => { void load(); }, [load]);

  const ready = Boolean(data && (data.matched === 0 || matched) && (data.unknown === 0 || unknown));
  const apply = async () => {
    if (!data || !ready) return;
    setBusy(true); setError(null);
    try {
      await sheetsApi("review_apply", { ...body(), snapshot: data.snapshot,
        import_matched: data.matched ? matched === "import" : null, import_unknown: data.unknown ? unknown === "import" : null });
      toast.success("Sheet resumed");
      onDone(); onClose();
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof SheetsApiError && REFRESH.has(e.code)) { setNotice(e.message); await load(); }
      else setError(e instanceof SheetsApiError ? e.message : "Couldn't apply. Try again.");
    } finally { if (alive.current) setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Review {source.display_name}</DialogTitle></DialogHeader>
        {!override && source.review_reason && <p className="text-sm text-muted-foreground">{REVIEW_REASONS[source.review_reason] ?? "This sheet changed."}</p>}
        {notice && <p className="text-xs text-amber-500">{notice}</p>}
        {!data && !error && <Skeleton className="h-16 w-full" />}
        {data && (
          <div className="space-y-3 text-sm">
            {data.established > 0 && <p className="text-muted-foreground">{data.established} rows already imported or left out (matched by Lead ID)</p>}
            {data.matched > 0 && (
              <div className="space-y-1">
                <p>{data.matched} rows have the same name, phone and email as rows already imported or left out</p>
                <Choice id="gs-matched" value={matched} onChange={setMatched}
                  options={[["keep", "Keep them out"], ["import", "Import them as new leads"]]} />
              </div>
            )}
            {data.unknown > 0 && (
              <div className="space-y-1">
                <p>{data.unknown} rows are new or changed</p>
                <Choice id="gs-unknown" value={unknown} onChange={setUnknown}
                  options={[["skip", "Skip them"], ["import", "Import them as new leads"]]} />
              </div>
            )}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={apply} disabled={busy || !ready}>Resume</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SheetReviewDialog;
