import React, { useState } from "react";
import { matchesQuery } from "./InventorySearch";
import type { ParsedMigrationRow } from "@/lib/project-status/types";

interface MigrationHistoryTableProps {
  rows: ParsedMigrationRow[];
  search: string;
}

const MigrationHistoryTable: React.FC<MigrationHistoryTableProps> = ({ rows, search }) => {
  const [sortAsc, setSortAsc] = useState(false);
  const filtered = rows.filter((r) =>
    matchesQuery(`${r.migrationId} ${r.topic} ${r.outcome}`, search)
  );
  const sorted = [...filtered].sort((a, b) => {
    const cmp = a.migrationId.localeCompare(b.migrationId);
    return sortAsc ? cmp : -cmp;
  });

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto max-h-[400px]">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 sticky top-0">
            <tr>
              <th className="text-left py-2 px-3 font-medium">
                <button type="button" onClick={() => setSortAsc(!sortAsc)} className="hover:underline">
                  Migration ID {sortAsc ? "↑" : "↓"}
                </button>
              </th>
              <th className="text-left py-2 px-3 font-medium">Topic</th>
              <th className="text-left py-2 px-3 font-medium min-w-[200px]">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.migrationId} className="border-t border-border/50 align-top">
                <td className="py-2 px-3 font-mono whitespace-nowrap">{r.migrationId}</td>
                <td className="py-2 px-3">{r.topic}</td>
                <td className="py-2 px-3 text-muted-foreground line-clamp-3">{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground p-4">No migrations match.</p>
      )}
    </div>
  );
};

export default MigrationHistoryTable;
