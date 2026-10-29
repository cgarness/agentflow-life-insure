import React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface RowMenuItem {
  id: string;
  label: string;
  icon?: React.ElementType;
  onSelect?: () => void;
  disabled?: boolean;
  /** Shown under the label (e.g. why it is disabled, or what it does). */
  hint?: string;
  /** A submenu (e.g. Remind later ▸ Tomorrow / In 3 days / Next week). */
  items?: RowMenuItem[];
  /** Draw a separator above this item. */
  separated?: boolean;
}

function ItemBody({ item }: { item: RowMenuItem }) {
  const Icon = item.icon;
  return (
    <span className="flex min-w-0 items-start gap-2">
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="min-w-0">
        <span className="block text-sm">{item.label}</span>
        {item.hint && <span className="block text-xs text-muted-foreground">{item.hint}</span>}
      </span>
    </span>
  );
}

/**
 * A row's visible primary action plus an accessible "More actions" menu (Radix:
 * arrow keys, Escape, typeahead, focus return). Nothing here is hover-only.
 */
export const DashboardRowActions: React.FC<{
  /** Who the row is about, for the menu's accessible name. */
  name: string;
  primary?: React.ReactNode;
  items?: RowMenuItem[];
  menuLabel?: string;
  busy?: boolean;
}> = ({ name, primary, items = [], menuLabel, busy = false }) => (
  <div className="flex items-center gap-1.5">
    {primary}
    {items.length > 0 && (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg"
            aria-label={`More actions for ${name}`}
            disabled={busy}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {menuLabel && <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{menuLabel}</DropdownMenuLabel>}
          {items.map((item) => (
            <React.Fragment key={item.id}>
              {item.separated && <DropdownMenuSeparator />}
              {item.items ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={item.disabled}>
                    <ItemBody item={item} />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    {item.items.map((child) => (
                      <DropdownMenuItem key={child.id} disabled={child.disabled} onSelect={() => child.onSelect?.()}>
                        <ItemBody item={child} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem disabled={item.disabled} onSelect={() => item.onSelect?.()}>
                  <ItemBody item={item} />
                </DropdownMenuItem>
              )}
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )}
  </div>
);
