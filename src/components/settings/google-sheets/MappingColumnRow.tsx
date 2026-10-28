import React from "react";
import { Button } from "@/components/ui/button";
import type { FieldCatalog } from "@/lib/google-sheets/fieldCatalog";
import type { ColumnState } from "@/lib/google-sheets/headerState";
import MappingFieldPicker from "./MappingFieldPicker";

interface Props {
  column: ColumnState;
  value: string;
  catalog: FieldCatalog;
  usedBy: Map<string, string>;
  /** A field chosen here that another column uses: shown for confirmation, never moved silently. */
  pendingMove: { target: string; from: string } | null;
  onSelect: (target: string) => void;
  onConfirmMove: () => void;
  onCancelMove: () => void;
  onCreate: (suggestedName: string) => void;
  createForm: React.ReactNode;
}

/** One compact source header aligned with its target field; sample values remain available in Preview. */
const MappingColumnRow: React.FC<Props> = ({ column, value, catalog, usedBy, pendingMove, onSelect, onConfirmMove, onCancelMove, onCreate, createForm }) => (
  <div className="space-y-2">
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2">
      <div className="flex min-h-9 min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={column.header}>{column.header}</span>
        {column.status === "new" && <span className="shrink-0 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">New</span>}
      </div>
      <MappingFieldPicker header={column.header} value={value} options={catalog.options} missingStandard={catalog.missingStandard}
        usedBy={usedBy} onSelect={onSelect} onCreate={onCreate} />
    </div>
    {pendingMove && (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-xs" role="alert">
        <span>“{catalog.byValue.get(pendingMove.target)?.label ?? "This field"}” is mapped to “{pendingMove.from}”. Move it to this column?</span>
        <span className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onCancelMove}>Keep</Button>
          <Button type="button" size="sm" onClick={onConfirmMove}>Move</Button>
        </span>
      </div>
    )}
    {createForm}
  </div>
);

export default MappingColumnRow;
