import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { COLUMN_DEFS, type ColumnId } from "@/lib/campaigns-table/columns";
import type { CampaignSort, SortKey } from "@/lib/campaigns-table/model";
import CampaignTableRow, { type CampaignRowRenderProps } from "./CampaignTableRow";

/** Header band: muted tint layered over the opaque card color, so sticky cells never show through. */
const HEAD_CLASS =
  "h-10 whitespace-nowrap border-b border-border/60 bg-card bg-[linear-gradient(hsl(var(--muted)_/_0.45),hsl(var(--muted)_/_0.45))] px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

interface SortHeadProps {
  label: string;
  sortKey: SortKey | null;
  sort: CampaignSort;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}

function SortHead({ label, sortKey, sort, onSort, align = "left", className }: SortHeadProps) {
  if (!sortKey) return <TableHead scope="col" className={cn(HEAD_CLASS, align === "right" && "text-right", className)}>{label}</TableHead>;
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(HEAD_CLASS, align === "right" && "text-right", className)}>
      <button type="button" onClick={() => onSort(sortKey)}
        className={cn("group/sort inline-flex items-center gap-1 rounded uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground", align === "right" && "flex-row-reverse")}>
        {label}
        <Icon aria-hidden="true" className={cn("h-3 w-3", !active && "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")} />
      </button>
    </TableHead>
  );
}

interface Props extends Omit<CampaignRowRenderProps, "row" | "metrics" | "expanded" | "onToggle" | "duplicate"> {
  rows: CampaignRowRenderProps["row"][];
  metricsById: Record<string, CampaignRowRenderProps["metrics"]>;
  duplicateFor: (row: CampaignRowRenderProps["row"]) => CampaignRowRenderProps["duplicate"];
  sort: CampaignSort;
  onSort: (key: SortKey) => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
}

/** Desktop campaign table (xl+). Campaign and Actions are fixed; the middle columns follow preferences. */
export default function CampaignsTable({ rows, metricsById, duplicateFor, sort, onSort, expandedId, onToggle, columns, ...rest }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm [container-type:inline-size]">
      <Table className="border-separate border-spacing-0" aria-label="Campaigns">
        <TableHeader className="[&_tr]:border-0">
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead scope="col" className={cn(HEAD_CLASS, "w-10 pl-3 pr-0")}><span className="sr-only">Details</span></TableHead>
            <SortHead label="Campaign" sortKey="name" sort={sort} onSort={onSort} className="w-full min-w-[13rem]" />
            {columns.map((id: ColumnId) => {
              const def = COLUMN_DEFS[id];
              return <SortHead key={id} label={def.label} sortKey={def.sortKey} sort={sort} onSort={onSort} align={def.align} className={def.widthClass} />;
            })}
            <TableHead scope="col" className={cn(HEAD_CLASS, "sticky right-0 z-20 w-32 text-right shadow-[-1px_0_0_hsl(var(--border)_/_0.6)]")}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&>tr:last-child>td]:border-b-0">
          {rows.map((row) => (
            <CampaignTableRow key={row.id} row={row} metrics={metricsById[row.id]} duplicate={duplicateFor(row)}
              expanded={expandedId === row.id} onToggle={() => onToggle(row.id)} columns={columns} {...rest} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
