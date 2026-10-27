import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { needsAcknowledgement, notImportableLines } from "@/lib/google-sheets/previewGate";
import type { NotImportable } from "@/lib/google-sheets/schema";

interface Props {
  ignored: string[]; newColumns: string[]; notImportable?: NotImportable; acknowledged: boolean; onAcknowledge: (v: boolean) => void;
}

/** Everything that will NOT be imported, listed; saving needs the owner's explicit confirmation of exactly this list. */
const IgnoredColumnsPanel: React.FC<Props> = ({ ignored, newColumns, notImportable, acknowledged, onAcknowledge }) => {
  const outside = needsAcknowledgement(notImportable) ? notImportableLines(notImportable) : [];
  if (!ignored.length && !outside.length) {
    const wide = notImportable && notImportable.beyond.width > 200;
    return <p className="text-xs text-muted-foreground">Every column is imported.{wide ? " The columns past GR are empty." : ""}</p>;
  }
  const isNew = new Set(newColumns);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      {ignored.length > 0 && (
        <>
          <p className="text-xs font-medium">Not imported ({ignored.length})</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Columns not imported">
            {ignored.map((h) => (
              <li key={h} className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                {h}{isNew.has(h) && <span className="ml-1 font-medium text-blue-600 dark:text-blue-400">New</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {outside.length > 0 && (
        <div className="space-y-1" aria-label="Content that can't be imported">
          <p className="text-xs font-medium">Can't be imported</p>
          {outside.map((t) => <p key={t} className="text-xs text-amber-600 dark:text-amber-400">{t}</p>)}
        </div>
      )}
      <div className="flex items-start gap-2">
        <Checkbox id="gs-ack-ignored" checked={acknowledged} onCheckedChange={(v) => onAcknowledge(v === true)} />
        <Label htmlFor="gs-ack-ignored" className="text-sm leading-snug">
          {outside.length ? "I understand everything listed here won't be imported into AgentFlow."
            : `I understand ${ignored.length === 1 ? "this column" : `these ${ignored.length} columns`} won't be imported into AgentFlow.`}
        </Label>
      </div>
    </div>
  );
};

export default IgnoredColumnsPanel;
