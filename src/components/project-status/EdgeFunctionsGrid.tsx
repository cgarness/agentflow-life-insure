import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import type { EdgeFunctionEntry, EdgeFunctionCategory } from "@/config/edgeFunctionsManifest";
import { matchesQuery } from "./InventorySearch";

interface EdgeFunctionsGridProps {
  functions: EdgeFunctionEntry[];
  search: string;
}

const EdgeFunctionsGrid: React.FC<EdgeFunctionsGridProps> = ({ functions, search }) => {
  const byCategory = useMemo(() => {
    const map = new Map<EdgeFunctionCategory, EdgeFunctionEntry[]>();
    for (const fn of functions) {
      if (!matchesQuery(`${fn.name} ${fn.category} ${fn.description ?? ""}`, search)) continue;
      const list = map.get(fn.category) ?? [];
      list.push(fn);
      map.set(fn.category, list);
    }
    return map;
  }, [functions, search]);

  return (
    <div className="space-y-4">
      {[...byCategory.entries()].map(([cat, fns]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold">{cat}</h3>
            <Badge variant="secondary" className="text-xs">{fns.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {fns.map((fn) => (
              <span
                key={fn.name}
                className="text-xs rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 font-mono"
                title={fn.description}
              >
                {fn.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default EdgeFunctionsGrid;
