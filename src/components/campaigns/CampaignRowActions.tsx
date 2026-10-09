import React from "react";
import { Copy, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CampaignRow, DuplicateEligibility } from "@/lib/campaigns-table/model";

interface Props {
  row: CampaignRow;
  duplicate: DuplicateEligibility;
  orgLocked: boolean;
  onOpen: (id: string) => void;
  onDuplicate: (row: CampaignRow) => void;
  /** Larger touch targets for the stacked layout. */
  touch?: boolean;
}

/** Open + a permission-gated overflow. No dialing action lives here (management ≠ Dialer). */
export default function CampaignRowActions({ row, duplicate, orgLocked, onOpen, onDuplicate, touch = false }: Props) {
  const reason = duplicate === "owner_only" ? "Only the campaign owner can duplicate"
    : orgLocked ? "Unavailable while the agency is suspended or archived" : null;
  return (
    <div className="flex items-center justify-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={() => onOpen(row.id)}
        aria-label={`Open ${row.name}`}
        className={cn("rounded-lg border-border/70 bg-transparent px-3 text-xs font-medium", touch ? "h-10 min-w-[4.5rem]" : "h-8")}>
        Open
      </Button>
      {duplicate !== "hidden" && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={`More actions for ${row.name}`}
              className={cn("rounded-lg text-muted-foreground hover:text-foreground", touch ? "h-10 w-10" : "h-8 w-8")}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem disabled={reason !== null} onSelect={() => onDuplicate(row)} className="items-start gap-2">
              <Copy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex flex-col">
                <span>Duplicate</span>
                {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
