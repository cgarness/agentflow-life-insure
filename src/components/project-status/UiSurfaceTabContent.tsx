import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import CodeRefsPanel from "./CodeRefsPanel";
import { StatusBadge, resolveDisplayStatus } from "./statusBadge";
import {
  buildVisibleIdSet,
  resolveNodeStatus,
  UI_OVERLAY_SECTION,
  uiItemKey,
  type StatusFilterValue,
  type UiInventoryNode,
} from "@/lib/project-status/treeUtils";
import type { ProjectStatusOverlay } from "@/lib/project-status/types";
import type { OverlayEditTarget } from "./OverlayEditSheet";

function RenderNode({
  node,
  path,
  visibleIds,
  overlayMap,
  onEdit,
  depth,
}: {
  node: UiInventoryNode;
  path: string[];
  visibleIds: Set<string> | null;
  overlayMap: Map<string, ProjectStatusOverlay>;
  onEdit: (target: OverlayEditTarget) => void;
  depth: number;
}) {
  const fullId = [...path, node.id].join(".");
  if (visibleIds && !visibleIds.has(fullId)) return null;

  const itemKey = uiItemKey(fullId);
  const overlay = overlayMap.get(itemKey);
  const status = resolveNodeStatus(node, overlay);
  const hasChildren = Boolean(node.children?.length);
  const [open, setOpen] = useState(depth < 3);

  const editBtn = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
      onClick={() => onEdit({
        itemKey,
        section: UI_OVERLAY_SECTION,
        title: node.label,
        inferredStatus: node.inferredStatus,
      })}
      aria-label="Edit status and note"
    >
      <Pencil className="w-3.5 h-3.5" />
    </Button>
  );

  if (!hasChildren) {
    return (
      <div className={cn("flex items-start gap-2 py-2 px-2 rounded-md hover:bg-muted/30 group", depth > 0 && "ml-3")}>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{node.label}</span>
            {status && <StatusBadge status={status} />}
            {editBtn}
          </div>
          {node.description && <p className="text-xs text-muted-foreground mt-0.5">{node.description}</p>}
          {overlay?.note && (
            <p className="text-xs text-amber-500/90 mt-1 flex gap-1">
              <StickyNote className="w-3 h-3 shrink-0" />
              {overlay.note}
            </p>
          )}
          <CodeRefsPanel code={node.code} />
        </div>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(depth > 0 && "ml-3 border-l border-border/40 pl-2")}>
      <div className="flex items-start gap-1 py-1.5 group">
        <CollapsibleTrigger asChild>
          <button type="button" className="mt-1 text-muted-foreground hover:text-foreground shrink-0 p-0.5">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </CollapsibleTrigger>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("font-medium", depth === 0 ? "text-base" : "text-sm")}>{node.label}</span>
            {status && <StatusBadge status={status} />}
            {editBtn}
          </div>
          {node.description && <p className="text-xs text-muted-foreground mt-0.5">{node.description}</p>}
          {overlay?.note && (
            <p className="text-xs text-amber-500/90 mt-1 flex gap-1">
              <StickyNote className="w-3 h-3 shrink-0" />
              {overlay.note}
            </p>
          )}
          <CollapsibleContent>
            <CodeRefsPanel code={node.code} />
            <div className="mt-1">
              {node.children!.map((child) => (
                <RenderNode
                  key={child.id}
                  node={child}
                  path={[...path, node.id]}
                  visibleIds={visibleIds}
                  overlayMap={overlayMap}
                  onEdit={onEdit}
                  depth={depth + 1}
                />
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </div>
    </Collapsible>
  );
}

interface UiSurfaceTabContentProps {
  tab: UiInventoryNode;
  overlayMap: Map<string, ProjectStatusOverlay>;
  search: string;
  statusFilter: StatusFilterValue;
  onEdit: (target: OverlayEditTarget) => void;
}

/** Renders a single top-level app tab (Dashboard, Contacts, …). */
const UiSurfaceTabContent: React.FC<UiSurfaceTabContentProps> = ({
  tab, overlayMap, search, statusFilter, onEdit,
}) => {
  const visibleIds = useMemo(
    () => buildVisibleIdSet(tab, overlayMap, search, statusFilter),
    [tab, overlayMap, search, statusFilter]
  );

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border/50 bg-card/20 p-2">
        {tab.children?.length ? (
          tab.children.map((child) => (
            <RenderNode
              key={child.id}
              node={child}
              path={[tab.id]}
              visibleIds={visibleIds}
              overlayMap={overlayMap}
              onEdit={onEdit}
              depth={0}
            />
          ))
        ) : (
          <RenderNode
            node={tab}
            path={[]}
            visibleIds={visibleIds}
            overlayMap={overlayMap}
            onEdit={onEdit}
            depth={0}
          />
        )}
        {visibleIds && visibleIds.size === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No items match the current search or status filter.
          </p>
        )}
      </div>
    </div>
  );
};

export default UiSurfaceTabContent;
