import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConnectionStatus, SheetSourceRow } from "@/lib/google-sheets/schema";
import SheetSourceRowItem from "./SheetSourceRow";

interface Props {
  sources: SheetSourceRow[];
  loading: boolean;
  loadError: boolean;
  connection: ConnectionStatus["connection"];
  canAdd: boolean;
  onAdd: () => void;
  onEdit: (s: SheetSourceRow) => void;
  onReview: (s: SheetSourceRow) => void;
  onIdentityReview: (s: SheetSourceRow) => void;
  onChanged: () => void;
}

const SheetSourceList: React.FC<Props> = ({ sources, loading, loadError, connection, canAdd, onAdd, onEdit, onReview, onIdentityReview, onChanged }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-foreground">Sheets</p>
      {canAdd && (
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="w-4 h-4 mr-1" /> Add sheet
        </Button>
      )}
    </div>
    {loading && <Skeleton className="h-16 w-full" />}
    {loadError && <p className="text-xs text-destructive">Couldn't load your sheets.</p>}
    {!loading && !loadError && sources.length === 0 && <p className="text-xs text-muted-foreground">No sheets yet.</p>}
    {sources.map((s) => (
      <SheetSourceRowItem key={s.id} source={s} connection={connection} onEdit={onEdit} onReview={onReview}
        onIdentityReview={onIdentityReview} onChanged={onChanged} />
    ))}
  </div>
);

export default SheetSourceList;
