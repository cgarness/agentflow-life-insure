/**
 * FullOrganizationTreeDialog — the whole organization, on demand.
 *
 * The tree itself is `OrgTreeRow`, which mounts a subtree only when it is open, so opening this on
 * a large organization costs a handful of rows rather than hundreds of nodes in the DOM.
 *
 * The data is the SAME roster the compact preview already has — one `getAgentScopeIds` traversal
 * and one `profiles` read — so opening this dialog issues no additional query.
 */

import React, { useMemo, useState } from "react";
import { Network, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatCount,
} from "@/lib/profile/profile-format";
import { OrgTreeRow } from "./OrgTreeRow";
import type { OrgTreeView } from "@/lib/profile/profile-org-view";

export interface FullOrganizationTreeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: OrgTreeView | null;
}

export const FullOrganizationTreeDialog: React.FC<FullOrganizationTreeDialogProps> = ({
  open,
  onOpenChange,
  view,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalPeople = useMemo(() => (view?.root ? view.totalDownline + 1 : 0), [view]);
  const trimmedFilter = filter.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // Reset on CLOSE, not on open. Reopening then starts from the default depth rather than
        // the last session's expansion, and a stale filter can never hide the whole tree on open.
        if (!next) {
          setExpanded(new Set());
          setFilter("");
        }
      }}
    >
      <DialogContent className="max-h-[85vh] w-[95vw] max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1.5 border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-primary" />
            Full organization
          </DialogTitle>
          <DialogDescription>
            {view?.root
              ? `${formatCount(totalPeople)} ${
                  totalPeople === 1 ? "person" : "people"
                }, ${formatCount(view.maxDepth)} ${
                  view.maxDepth === 1 ? "level" : "levels"
                } deep. Branches below the second level start collapsed.`
              : "Your organization chart."}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name or role"
              className="h-9 pl-9"
            />
          </div>
        </div>

        <ScrollArea className="max-h-[55vh]">
          <div className="px-4 py-3">
            {view?.root ? (
              <ul>
                <OrgTreeRow
                  node={view.root}
                  expanded={expanded}
                  toggle={toggle}
                  filter={trimmedFilter}
                  isRoot
                />
              </ul>
            ) : (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No organization chart is available.
              </p>
            )}

            {view && view.unattached.length > 0 && (
              /* Authorized agents whose branch could not be attached — a missing upline row, or a
                 cycle the forest builder broke. Surfaced rather than silently dropped. */
              <div className="mt-4 border-t border-border/60 pt-4">
                <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-warning">
                  Not placed in the chart
                </p>
                <ul>
                  {view.unattached.map((node) => (
                    <OrgTreeRow
                      key={node.id}
                      node={node}
                      expanded={expanded}
                      toggle={toggle}
                      filter={trimmedFilter}
                      isRoot={false}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
