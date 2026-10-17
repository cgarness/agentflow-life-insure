import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import { identityDecisionsSchema, type IdentityDecision, type IdentityReviewPreview, type SheetSourceRow } from "@/lib/google-sheets/schema";
import IdentityReviewRows from "./IdentityReviewRows";

interface Props { source: SheetSourceRow; onClose: () => void; onDone: () => void }

const REFRESH = new Set(["review_changed", "connection_changed"]);

/**
 * Resolves "identity_ambiguous": rows without a Lead ID that were left out at activation can't be located, so every
 * row that could be one of them needs the agent's explicit choice. Decisions apply only to the reviewed snapshot;
 * if the sheet or Google connection changed, the list refreshes and choices for unchanged rows are kept.
 */
const SheetIdentityReviewDialog: React.FC<Props> = ({ source, onClose, onDone }) => {
  const [data, setData] = useState<IdentityReviewPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, IdentityDecision>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setData(null);
    try {
      const r = await sheetsApi<IdentityReviewPreview>("identity_review_preview", { source_id: source.id, expected_version: source.config_version });
      if (!alive.current) return;
      setData(r);
      setChoices((c) => Object.fromEntries(Object.entries(c).filter(([k]) => r.rows.some((x) => x.key === k))));
    } catch (e) {
      if (alive.current) setError(e instanceof SheetsApiError ? e.message : "Couldn't read the sheet.");
    }
  }, [source.id, source.config_version]);
  useEffect(() => { void load(); }, [load]);

  const keys = data?.rows.map((r) => r.key) ?? [];
  const decided = identityDecisionsSchema(keys).safeParse(choices);
  const setAll = (d: IdentityDecision) => setChoices(Object.fromEntries(keys.map((k) => [k, d])));

  const apply = async () => {
    if (!data) return;
    if (!decided.success) { setError("Choose what to do with every row."); return; }
    setBusy(true); setError(null);
    try {
      await sheetsApi("identity_review_apply", { source_id: source.id, expected_version: source.config_version,
        snapshot: data.snapshot, decisions: decided.data });
      toast.success("Sheet resumed");
      onDone(); onClose();
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof SheetsApiError && REFRESH.has(e.code)) { setNotice(e.message); await load(); }
      else setError(e instanceof SheetsApiError ? e.message : "Couldn't apply. Try again.");
    } finally { if (alive.current) setBusy(false); }
  };

  const missing = data?.unresolved_rows ?? [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-xl" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Review {source.display_name}</DialogTitle></DialogHeader>
        {notice && <p className="text-xs text-amber-500">{notice}</p>}
        {!data && !error && <Skeleton className="h-24 w-full" />}
        {data && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {missing.length > 0
                ? `${missing.length === 1 ? "A row" : `${missing.length} rows`} without a Lead ID that ${missing.length === 1 ? "was" : "were"} left out when you enabled this sheet (originally row ${missing.join(", ")}) can't be found. Any row below could be one of them. Choose what to do with each.`
                : "Every left-out row is back in place. Resume to continue."}
            </p>
            {data.rows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAll("import")} disabled={busy}>Import all</Button>
                  <Button size="sm" variant="outline" onClick={() => setAll("exclude")} disabled={busy}>Keep all out</Button>
                  <span className="text-xs text-muted-foreground">{Object.keys(choices).length} of {keys.length} chosen</span>
                </div>
                <IdentityReviewRows rows={data.rows} choices={choices} onChange={(k, d) => setChoices((c) => ({ ...c, [k]: d }))} />
              </>
            )}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={apply} disabled={busy || !data || !decided.success}>Resume</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SheetIdentityReviewDialog;
