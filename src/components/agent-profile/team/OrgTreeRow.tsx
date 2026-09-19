/**
 * OrgTreeRow — one node of the full organization tree, and its subtree.
 *
 * PROGRESSIVE EXPANSION LIVES HERE. A collapsed node does not render its children AT ALL — the
 * subtree is not mounted, not merely hidden — which is what keeps opening a large organization
 * cheap. `HierarchyTree.tsx`, the existing org chart, renders every descendant unconditionally with
 * a per-node blurred gradient and `backdrop-blur` and has no collapse state; that is precisely the
 * cliff this avoids.
 *
 * Avatars are INITIALS. `avatar_url` holds a base64 data URL (`ProfileAvatarUploader.tsx:48`), so
 * loading it for every node would pull megabytes to draw 32px circles.
 */

import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  formatCount,
} from "@/lib/profile/profile-format";
import { displayNameFor, initialsFor, type OrgTreeNode } from "@/lib/profile/profile-org-view";
import { DEFAULT_EXPANDED_DEPTH, subtreeMatches } from "@/lib/profile/org-tree-filter";
import { cn } from "@/lib/utils";

export interface OrgTreeRowProps {
  node: OrgTreeNode;
  expanded: Set<string>;
  toggle: (id: string) => void;
  filter: string;
  isRoot: boolean;
}

export const OrgTreeRow: React.FC<OrgTreeRowProps> = ({
  node,
  expanded,
  toggle,
  filter,
  isRoot,
}) => {
  const hasChildren = node.children.length > 0;
  // An active filter forces branches open, so a deep match is never hidden behind a closed parent.
  const isOpen = filter !== "" ? true : expanded.has(node.id) || node.depth < DEFAULT_EXPANDED_DEPTH;

  if (!subtreeMatches(node, filter)) return null;

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50",
          isRoot && "bg-primary/5",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={isOpen ? "Collapse" : "Expand"}
            aria-expanded={isOpen}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}

        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
            isRoot
              ? "border-primary/30 bg-primary/15 text-primary"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {initialsFor(node)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {displayNameFor(node)}
            {isRoot && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{node.role}</p>
        </div>

        {node.descendantCount > 0 && (
          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {formatCount(node.descendantCount)}
          </span>
        )}
      </div>

      {/* The subtree is MOUNTED only when open — this is what keeps a large organization cheap. */}
      {hasChildren && isOpen && (
        <ul className="ml-[18px] border-l border-border/60 pl-3">
          {node.children.map((child) => (
            <OrgTreeRow
              key={child.id}
              node={child}
              expanded={expanded}
              toggle={toggle}
              filter={filter}
              isRoot={false}
            />
          ))}
        </ul>
      )}
    </li>
  );
};
