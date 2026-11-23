import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useUnsavedNavigationGuard } from "@/hooks/useUnsavedNavigationGuard";
import type { DraftRecord } from "@/lib/automation-api";
import { triggerNode } from "../../../supabase/functions/_shared/automations/graph";
import { AutomationActivity } from "./AutomationActivity";
import AutomationReleaseStatus from "./AutomationReleaseStatus";
import AutomationReview from "./AutomationReview";
import ConfirmDialog from "./editor/ConfirmDialog";
import EditorToolbar from "./editor/EditorToolbar";
import { useAutomationDraft } from "./editor/useAutomationDraft";
import WorkflowWorkspace from "./editor/WorkflowWorkspace";
import { Problem } from "./inspector/Field";
import { useStepNames } from "./steps/useStepNames";

interface Props {
  /** The saved draft to open. Absent for a new, blank workflow that exists only on this screen until it is saved. */
  record?: DraftRecord;
  session: number;
  scope: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}

export default function AutomationEditor({record, session, scope, onBack, onSaved}: Props) {
  const draft = useAutomationDraft({record, session, scope, onSaved});
  const [asking, setAsking] = useState<"archive" | "leave" | null>(null);
  // Sidebar links, browser back and forward, reload and close are held while there are unsaved changes. A save in
  // flight is not held: saving a new automation replaces its address, and nothing can be edited until it settles.
  const guard = useUnsavedNavigationGuard(draft.dirty && !draft.busy);
  const names = useStepNames(scope, draft.graph);
  const {mode, graph, snapshot, notice} = draft;
  const general = draft.issues.filter(issue => !issue.node_id);
  // Bottom padding of its own: when the editor is taller than the window, the layout's padding sits behind it.
  return <section className="flex min-h-0 flex-col gap-4 pb-6">
    <EditorToolbar draft={draft} onArchive={() => setAsking("archive")}
      onBack={() => { if (draft.dirty) setAsking("leave"); else onBack(); }}/>
    {notice && <p role={notice.tone === "error" ? "alert" : "status"}
      className={notice.tone === "error" ? "rounded-lg bg-badge-error-surface p-3 text-sm text-badge-error-text" : "rounded-lg border bg-card p-3 text-sm"}>
      {notice.text}
    </p>}
    <fieldset disabled={draft.busy} className="flex min-h-0 min-w-0 flex-col gap-4">
      {draft.revision > 0 && mode !== "review" && <AutomationReleaseStatus published={draft.published} controls={snapshot?.controls ?? null}
        status={snapshot?.status} trigger={snapshot?.trigger_type ?? null} onRefresh={draft.refreshStatus}/>}
      {mode === "activity" && <AutomationActivity workflowId={draft.id}/>}
      {mode === "edit" && <>
        {draft.readOnly && draft.status && <p className="text-sm text-muted-foreground">This saved graph is read-only.</p>}
        {general.length > 0 && <ul aria-label="Problems with this automation" className="space-y-1.5 rounded-lg bg-badge-error-surface p-3">
          {general.map((issue, index) => <li key={index}><Problem>{issue.message}</Problem></li>)}
        </ul>}
        {/* On a wide screen the workspace takes the height left under the page header, so the canvas has room. */}
        <div className="flex min-h-0 flex-col lg:h-[max(34rem,calc(100dvh-21rem))]">
          <WorkflowWorkspace graph={graph} selected={draft.selected} issues={draft.inlineIssues} names={names} scope={scope}
            readOnly={draft.readOnly} onChange={draft.edit} onSelect={draft.select}/>
        </div>
      </>}
      {(mode === "preview" || mode === "review") && <AutomationReview graph={graph} scope={scope} mode={mode} overlaps={draft.overlap}
        issues={mode === "review" ? draft.issues : draft.localIssues} requirements={draft.requirements} onFix={draft.select}/>}
      {mode === "review" && <>
        <AutomationReleaseStatus review onRefresh={draft.refreshStatus} controls={snapshot?.controls ?? null}
          status={snapshot ? snapshot.status === "draft" ? "active" : snapshot.status : undefined}
          trigger={triggerNode(graph)?.type ?? null}/>
        {snapshot && !draft.revisionMatches && <p role="status" className="text-sm">
          The saved draft changed. Reopen the editor to review the current version.
        </p>}
        {!draft.reviewMatches && <p role="status" className="text-sm">Review the current agency settings before publishing.</p>}
        <div>
          <Button type="button" className="h-11 md:h-10" disabled={!draft.canPublish} onClick={() => { void draft.publish(); }}>
            Publish version
          </Button>
        </div>
      </>}
    </fieldset>
    <ConfirmDialog open={asking === "archive"} title="Archive this automation?" destructive
      description="It stops enrolling, and steps still waiting for contacts already in it are cancelled. This cannot be undone here."
      confirm="Archive automation" cancel="Cancel" onOpenChange={open => { if (!open) setAsking(null); }}
      onConfirm={() => { void draft.lifecycle("archive"); }}/>
    <ConfirmDialog open={asking === "leave" || guard.blocked} title="Leave without saving?"
      description="Your changes to this draft have not been saved. Leaving now discards them."
      confirm="Leave without saving" cancel="Keep editing"
      onOpenChange={open => { if (!open) { setAsking(null); guard.cancel(); } }}
      onConfirm={() => {
        // Confirming lets the held navigation, or this screen's own Back, through without asking again.
        const own = asking === "leave";
        guard.confirm();
        if (own) onBack();
      }}/>
  </section>;
}
