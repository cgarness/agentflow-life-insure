import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import type { SheetSourceRow } from "@/lib/google-sheets/schema";
import { REVIEW_REASONS } from "@/lib/google-sheets/status";

export interface ReviewOverride { identityMode: "source_id" | "row_position"; idHeader: string | null; columns: { header: string; target: string }[] }
interface Props { source: SheetSourceRow; override?: ReviewOverride; onClose: () => void; onDone: () => void }

/** Recovery after structural changes or a Lead ID change: the agent decides what happens to unknown rows. */
const SheetReviewDialog: React.FC<Props> = ({ source, override, onClose, onDone }) => {
  const [counts, setCounts] = useState<{ known: number; unknown: number; config_version: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<"skip" | "import">("skip");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const body = () => ({
    source_id: source.id, expected_version: source.config_version,
    identity_mode: override?.identityMode ?? source.identity_mode,
    id_header: override ? override.idHeader : source.id_header,
    mapping: { v: 1, columns: override?.columns ?? source.mapping.columns },
  });

  useEffect(() => {
    sheetsApi<{ known: number; unknown: number; config_version: number }>("review_preview", body())
      .then((r) => { if (alive.current) setCounts(r); })
      .catch((e) => { if (alive.current) setError(e instanceof SheetsApiError ? e.message : "Couldn't read the sheet."); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      await sheetsApi("review_apply", { ...body(), import_unknown: choice === "import" });
      toast.success("Sheet resumed");
      onDone(); onClose();
    } catch (e) {
      if (alive.current) setError(e instanceof SheetsApiError ? e.message : "Couldn't apply. Try again.");
    } finally { if (alive.current) setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Review {source.display_name}</DialogTitle></DialogHeader>
        {!override && source.review_reason && <p className="text-sm text-muted-foreground">{REVIEW_REASONS[source.review_reason] ?? "This sheet changed."}</p>}
        {!counts && !error && <Skeleton className="h-16 w-full" />}
        {counts && (
          <div className="space-y-3">
            <p className="text-sm">{counts.known} rows already handled · {counts.unknown} new or changed</p>
            {counts.unknown > 0 && (
              <RadioGroup value={choice} onValueChange={(v) => setChoice(v as "skip" | "import")}>
                <div className="flex items-center gap-2"><RadioGroupItem value="skip" id="gs-skip" /><Label htmlFor="gs-skip">Skip them</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="import" id="gs-import" /><Label htmlFor="gs-import">Import them as new leads</Label></div>
              </RadioGroup>
            )}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={apply} disabled={busy || !counts}>Resume</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SheetReviewDialog;
