import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { toast } from "@/hooks/use-toast";
import { useCommissionGridMutations, useGridSnapshot } from "@/hooks/useCommissionGridsAdmin";
import { useGridEditorDraft } from "@/hooks/useGridEditorDraft";
import { useUnsavedNavigationGuard } from "@/hooks/useUnsavedNavigationGuard";
import { CommissionApiError } from "@/lib/commission/errors";
import ConfirmActionDialog, { type PendingConfirmation } from "./ConfirmActionDialog";
import ContractLevelsSection from "./ContractLevelsSection";
import GridDetailsSection from "./GridDetailsSection";
import LoadErrorNotice from "./LoadErrorNotice";
import { errorMessage, lastEdited } from "./gridFormat";
import { draftRows } from "./matrixRows";
import ProductsSection from "./ProductsSection";
import RateMatrix from "./RateMatrix";
import UnsavedChangesDialog from "./UnsavedChangesDialog";

interface GridEditorProps {
  gridId: string;
  calculatorGridId: string | null;
  onClose: () => void;
}

/**
 * Private-grid editor. Every edit stays in a local draft (never persisted elsewhere) until ONE atomic save
 * at the loaded revision; a stale save is refused by the server and shown as a conflict, never merged.
 * Leaving with unsaved changes is held for confirmation (section changes, sidebar links, back/forward,
 * reload/close).
 */
const GridEditor: React.FC<GridEditorProps> = ({ gridId, calculatorGridId, onClose }) => {
  const snapshot = useGridSnapshot(gridId);
  const editor = useGridEditorDraft(snapshot.data);
  const { save } = useCommissionGridMutations();
  const guard = useUnsavedNavigationGuard(editor.dirty);
  const { registerDirty } = useUnsavedChanges();
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [conflict, setConflict] = useState(false);
  const { draft, base, issues, actions } = editor;

  useEffect(() => {
    registerDirty("commission-grid-editor", editor.dirty);
    return () => registerDirty("commission-grid-editor", false);
  }, [editor.dirty, registerDirty]);

  const messagesFor = useMemo(() => {
    const byRef = new Map<string, string[]>();
    for (const issue of issues) {
      if (issue.ref && issue.scope !== "rate") byRef.set(issue.ref, [...new Set([...(byRef.get(issue.ref) ?? []), issue.message])]);
    }
    return (ref: string) => byRef.get(ref) ?? [];
  }, [issues]);
  const invalidCells = useMemo(() => new Set(issues.filter((i) => i.scope === "rate").map((i) => `${i.ref}:${i.level}`)), [issues]);
  const rows = useMemo(() => (draft ? draftRows(draft) : []), [draft]);
  const summary = [...new Set(issues.filter((i) => !i.ref || i.scope === "rate").map((i) => i.message))];

  const retryRefresh = () => void snapshot.refetch();
  // Only a failed INITIAL load (no draft yet, so nothing is held) replaces the editor. A failed background
  // refresh keeps the draft, the controls and both dialogs below, with a compact error and Retry.
  if (snapshot.isError && !snapshot.data) {
    return <LoadErrorNotice message={errorMessage(snapshot.error)} onRetry={retryRefresh} retrying={snapshot.isFetching} />;
  }
  if (!draft || !base) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading grid…
      </div>
    );
  }

  const busy = save.isPending || editor.awaitingSaved;
  const doSave = () =>
    save.mutate(
      { gridId, revision: base.grid.revision, changes: editor.changes },
      {
        onSuccess: ({ revision }) => {
          editor.markSaved(revision);
          toast({ title: "Grid saved" });
        },
        onError: (error) => {
          if (error instanceof CommissionApiError && error.kind === "conflict") setConflict(true);
          else toast({ title: "Not saved", description: errorMessage(error), variant: "destructive" });
        },
      },
    );
  const requestSave = () => {
    if (gridId !== calculatorGridId) return doSave();
    setConfirmation({
      title: "Save changes to the calculator grid?",
      description: draft.isActive
        ? "Agents estimate from this grid, so they'll see these changes right away."
        : "Deactivating this grid turns the Commission Calculator off for your agents until you choose another grid.",
      confirmLabel: "Save changes",
      destructive: !draft.isActive,
      onConfirm: doSave,
    });
  };
  const reload = async () => {
    const fresh = await snapshot.refetch();
    if (fresh.isError || !fresh.data) return; // keep the draft and the conflict; the refresh error offers Retry
    editor.reset(fresh.data);
    setConflict(false);
  };
  const refreshMessage = editor.awaitingSaved
    ? "Your changes were saved, but the latest version of this grid couldn't be loaded."
    : editor.dirty ? "Couldn't refresh this grid. Your unsaved changes are still here." : "Couldn't refresh this grid.";
  const ask = (pending: PendingConfirmation) => setConfirmation(pending);
  const leaveEditor = () =>
    editor.dirty
      ? ask({ title: "Discard unsaved changes?", description: "Your changes to this grid will be lost.", confirmLabel: "Discard", destructive: true, onConfirm: onClose })
      : onClose();

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={leaveEditor}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Commission grids
        </Button>
        <p className="text-xs text-muted-foreground">{lastEdited(base.grid.updatedAt, base.grid.updatedByName)}</p>
      </div>
      {snapshot.isError && <LoadErrorNotice message={refreshMessage} onRetry={retryRefresh} retrying={snapshot.isFetching} />}
      {(conflict || editor.newerRevision) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
            This grid was changed by someone else. Reload to see the latest version.
          </span>
          <Button size="sm" variant="outline"
            onClick={() => (editor.dirty ? ask({ title: "Reload and discard your changes?", description: "Your unsaved changes will be lost.", confirmLabel: "Reload", destructive: true, onConfirm: () => void reload() }) : void reload())}>
            Reload
          </Button>
        </div>
      )}
      <GridDetailsSection draft={draft} disabled={busy} onChange={actions.setDetails} />
      <ContractLevelsSection draft={draft} disabled={busy} onAdd={actions.addLevel} onRemove={actions.removeLevel} confirm={ask} />
      <ProductsSection draft={draft} disabled={busy} actions={actions} messagesFor={messagesFor} confirm={ask} />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Rates (% of annual premium)</h3>
        <p className="text-xs text-muted-foreground">Leave a cell blank when the product isn&apos;t available at that level. Enter 0 for a real zero rate.</p>
        <RateMatrix levels={draft.levels} rows={rows} value={(ref, level) => draft.rates[ref]?.[level] ?? ""} onChange={actions.setRate} invalidCells={invalidCells} readOnly={busy} />
      </section>
      <div className="sticky bottom-0 z-30 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t bg-card px-6 py-3">
        <div className="space-y-0.5 text-xs">
          {editor.dirty ? <p className="font-medium text-foreground">Unsaved changes</p> : <p className="text-muted-foreground">All changes saved</p>}
          {summary.map((message) => <p key={message} className="text-destructive">{message}</p>)}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!editor.dirty || busy} onClick={editor.discard}>Discard</Button>
          <Button disabled={!editor.dirty || busy || issues.length > 0} onClick={requestSave}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />} Save changes
          </Button>
        </div>
      </div>
      <ConfirmActionDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      <UnsavedChangesDialog open={guard.blocked} onStay={guard.cancel} onLeave={guard.confirm} />
    </div>
  );
};

export default GridEditor;
