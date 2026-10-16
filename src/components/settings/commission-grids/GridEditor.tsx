import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Grid3x3, Layers, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "@/contexts/UnsavedChangesContext";
import { toast } from "@/hooks/use-toast";
import { useCommissionGridMutations, useGridSnapshot } from "@/hooks/useCommissionGridsAdmin";
import { useGridEditorDraft } from "@/hooks/useGridEditorDraft";
import { useUnsavedNavigationGuard } from "@/hooks/useUnsavedNavigationGuard";
import { CommissionApiError } from "@/lib/commission/errors";
import { LoadingBlock, SurfaceSection } from "@/components/commission/ui/CommissionSurface";
import ConfirmActionDialog, { type PendingConfirmation } from "./ConfirmActionDialog";
import ContractLevelsSection from "./ContractLevelsSection";
import EditorHeader from "./EditorHeader";
import EditorSaveBar from "./EditorSaveBar";
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
    return <LoadingBlock label="Loading grid…" rows={4} />;
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
    <div className="space-y-5">
      <EditorHeader
        title={draft.name.trim() || "Untitled grid"}
        meta={lastEdited(base.grid.updatedAt, base.grid.updatedByName)}
        backLabel="Commission grids"
        onBack={leaveEditor}
        calculator={gridId === calculatorGridId}
        active={draft.isActive}
      />
      {snapshot.isError && <LoadErrorNotice message={refreshMessage} onRetry={retryRefresh} retrying={snapshot.isFetching} />}
      {(conflict || editor.newerRevision) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-foreground">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            This grid was changed by someone else. Reload to see the latest version.
          </span>
          <Button size="sm" variant="outline" className="h-8 bg-background"
            onClick={() => (editor.dirty ? ask({ title: "Reload and discard your changes?", description: "Your unsaved changes will be lost.", confirmLabel: "Reload", destructive: true, onConfirm: () => void reload() }) : void reload())}>
            Reload
          </Button>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <SurfaceSection icon={Settings2} title="Details" as="h3">
          <GridDetailsSection draft={draft} disabled={busy} onChange={actions.setDetails} />
        </SurfaceSection>
        <SurfaceSection icon={Layers} title="Contract levels" count={draft.levels.length} as="h3">
          <ContractLevelsSection draft={draft} disabled={busy} onAdd={actions.addLevel} onRemove={actions.removeLevel} confirm={ask} />
        </SurfaceSection>
      </div>
      <ProductsSection draft={draft} disabled={busy} actions={actions} messagesFor={messagesFor} confirm={ask} />
      <SurfaceSection
        icon={Grid3x3}
        title="Rates (% of annual premium)"
        description="Leave a cell blank when the product isn't available at that level. Enter 0 for a real zero rate."
        as="h3"
        bodyClassName="p-0 sm:p-0"
      >
        <RateMatrix levels={draft.levels} rows={rows} value={(ref, level) => draft.rates[ref]?.[level] ?? ""} onChange={actions.setRate} invalidCells={invalidCells} readOnly={busy} framed={false} />
      </SurfaceSection>
      <EditorSaveBar
        dirty={editor.dirty}
        busy={busy}
        summary={summary}
        canSave={editor.dirty && !busy && issues.length === 0}
        onDiscard={editor.discard}
        onSave={requestSave}
      />
      <ConfirmActionDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      <UnsavedChangesDialog open={guard.blocked} onStay={guard.cancel} onLeave={guard.confirm} />
    </div>
  );
};

export default GridEditor;
