import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface Props { ignored: string[]; newColumns: string[]; acknowledged: boolean; onAcknowledge: (v: boolean) => void }

/** The columns that will NOT be imported, listed by name; saving needs the owner's explicit confirmation. */
const IgnoredColumnsPanel: React.FC<Props> = ({ ignored, newColumns, acknowledged, onAcknowledge }) => {
  if (!ignored.length) return <p className="text-xs text-muted-foreground">Every column is imported.</p>;
  const isNew = new Set(newColumns);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium">Not imported ({ignored.length})</p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Columns not imported">
        {ignored.map((h) => (
          <li key={h} className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
            {h}{isNew.has(h) && <span className="ml-1 font-medium text-blue-600 dark:text-blue-400">New</span>}
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-2">
        <Checkbox id="gs-ack-ignored" checked={acknowledged} onCheckedChange={(v) => onAcknowledge(v === true)} />
        <Label htmlFor="gs-ack-ignored" className="text-sm leading-snug">
          I understand {ignored.length === 1 ? "this column" : `these ${ignored.length} columns`} won't be imported into AgentFlow.
        </Label>
      </div>
    </div>
  );
};

export default IgnoredColumnsPanel;
