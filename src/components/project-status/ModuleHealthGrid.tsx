import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StickyNote } from "lucide-react";
import { StatusBadge, resolveDisplayStatus } from "./statusBadge";
import { matchesQuery } from "./InventorySearch";
import type { ParsedModule, ProjectStatusOverlay } from "@/lib/project-status/types";
import type { OverlayEditTarget } from "./OverlayEditSheet";

interface ModuleHealthGridProps {
  modules: ParsedModule[];
  overlayMap: Map<string, ProjectStatusOverlay>;
  search: string;
  onEdit: (target: OverlayEditTarget) => void;
}

const ModuleHealthGrid: React.FC<ModuleHealthGridProps> = ({ modules, overlayMap, search, onEdit }) => {
  const filtered = modules.filter(
    (m) => matchesQuery(`${m.name} ${m.excerpt}`, search)
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((m) => {
        const overlay = overlayMap.get(m.itemKey);
        const status = resolveDisplayStatus(m.inferredStatus, overlay?.status);
        return (
          <Card
            key={m.itemKey}
            className="cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => onEdit({
              itemKey: m.itemKey,
              section: "module",
              title: m.name,
              inferredStatus: m.inferredStatus,
            })}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{m.name}</CardTitle>
                {status && <StatusBadge status={status} />}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground line-clamp-4">{m.excerpt}</p>
              {overlay?.note && (
                <p className="text-xs text-amber-500/90 mt-2 flex gap-1">
                  <StickyNote className="w-3 h-3 shrink-0" />
                  {overlay.note}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default ModuleHealthGrid;
