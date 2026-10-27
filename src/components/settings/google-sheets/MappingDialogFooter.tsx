import React from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { SAVE_BLOCKER_TEXT, type SaveBlocker } from "@/lib/google-sheets/previewGate";

interface Props {
  step: "pick" | "map" | "preview"; active: boolean; busy: boolean; canPreview: boolean; blockers: SaveBlocker[];
  onBack: () => void; onPreview: () => void; onSave: () => void;
}

/** Mapping v2 dialog actions. Save / Enable stay off, with the reason shown, until the preview gate is satisfied. */
const MappingDialogFooter: React.FC<Props> = ({ step, active, busy, canPreview, blockers, onBack, onPreview, onSave }) => (
  <DialogFooter className="gap-2 sm:items-center">
    {step === "preview" && blockers.length > 0 && (
      <p className="text-xs text-muted-foreground sm:mr-auto" role="status">{SAVE_BLOCKER_TEXT[blockers[0]]}</p>
    )}
    {step === "preview" && <Button variant="outline" size="sm" onClick={onBack} disabled={busy}>Back</Button>}
    {step === "map" && <Button size="sm" onClick={onPreview} disabled={busy || !canPreview}>Preview</Button>}
    {step === "preview" && <Button size="sm" onClick={onSave} disabled={busy || blockers.length > 0}>{active ? "Save" : "Enable"}</Button>}
  </DialogFooter>
);

export default MappingDialogFooter;
