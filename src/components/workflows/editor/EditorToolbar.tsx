import { useId } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workflowStatusBadge, type StatusBadge } from "../list/statusBadges";
import type { AutomationDraft, EditorMode } from "./useAutomationDraft";

interface Props {
  draft: AutomationDraft;
  onBack: () => void;
  onArchive: () => void;
}

function lifecycleBadge(draft: AutomationDraft): StatusBadge {
  if (draft.revision === 0) return {label: "Not saved", tone: "neutral"};
  if (!draft.status && draft.statusPending) return {label: "Checking status…", tone: "neutral"};
  return workflowStatusBadge(draft.status);
}

/** Name, saved state and the explicit steps: Save draft, then Save & review. Publishing happens in the review. */
export default function EditorToolbar({draft, onBack, onArchive}: Props) {
  const id = useId();
  const {mode, revision, status, readOnly, dirty} = draft;
  const badge = lifecycleBadge(draft);
  const saved = dirty ? "Unsaved changes" : revision > 0 ? "All changes saved" : "Nothing saved yet";
  const tab = (target: EditorMode, label: string) => <Button type="button" variant="outline" className="h-11 md:h-10"
    aria-pressed={mode === target} onClick={() => draft.setMode(target)}>{label}</Button>;
  return <header className="space-y-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button type="button" variant="outline" className="h-11 md:h-10" disabled={draft.busy} onClick={onBack}>
        <ArrowLeft aria-hidden="true"/>Back to automations
      </Button>
      <Badge variant={badge.tone}>{badge.label}</Badge>
      <p className="text-xs text-muted-foreground" aria-live="polite">{saved}</p>
    </div>
    <fieldset disabled={draft.busy} className="grid min-w-0 gap-3 lg:grid-cols-[minmax(16rem,28rem)_minmax(0,1fr)] lg:items-end">
      <div className="space-y-1.5">
        <Label htmlFor={id}>Automation name</Label>
        <Input id={id} value={draft.name} disabled={readOnly} maxLength={100} placeholder="Untitled automation"
          onChange={event => draft.rename(event.target.value)}/>
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {mode !== "edit" && tab("edit", "Edit draft")}
        {tab("preview", "Preview")}
        {revision > 0 && tab("activity", "Activity")}
        {status === "active" && <Button type="button" variant="outline" className="h-11 md:h-10"
          onClick={() => { void draft.lifecycle("pause"); }}>Pause</Button>}
        {status === "paused" && <Button type="button" variant="outline" className="h-11 md:h-10"
          onClick={() => { void draft.lifecycle("resume"); }}>Resume</Button>}
        {revision > 0 && status && status !== "archived" && <Button type="button" variant="ghost" className="h-11 md:h-10"
          onClick={onArchive}>Archive</Button>}
        {!readOnly && <>
          <Button type="button" variant="outline" className="h-11 md:h-10" onClick={() => { void draft.saveDraft(); }}>Save draft</Button>
          {/* The one filled action here. In the review, Publish version takes that role. */}
          <Button type="button" variant={mode === "review" ? "outline" : "default"} className="h-11 md:h-10"
            onClick={() => { void draft.review(); }}>Save &amp; review</Button>
        </>}
      </div>
    </fieldset>
  </header>;
}
