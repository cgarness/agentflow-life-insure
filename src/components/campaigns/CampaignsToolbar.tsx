import React from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CAMPAIGN_STATUSES, SORT_LABELS,
  type CampaignFilters, type CampaignSort, type SortKey, type StatusFilter, type TypeFilter,
} from "@/lib/campaigns-table/model";

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "personal", label: "Personal" },
  { value: "team", label: "Team" },
  { value: "open", label: "Open Pool" },
];
const SORT_KEYS: SortKey[] = ["created", "name", "status", "type", "progress", "total", "converted", "contacted", "last_dialed"];
const TRIGGER = "h-9 rounded-lg border-border/70 bg-card text-sm";

interface Props {
  filters: CampaignFilters;
  onFiltersChange: (next: CampaignFilters) => void;
  sort: CampaignSort;
  onSortKey: (key: SortKey) => void;
  onToggleDir: () => void;
  showReset: boolean;
  onReset: () => void;
  /** The Columns control (desktop table only). */
  columnsControl?: React.ReactNode;
}

export default function CampaignsToolbar({
  filters, onFiltersChange, sort, onSortKey, onToggleDir, showReset, onReset, columnsControl,
}: Props) {
  const set = (patch: Partial<CampaignFilters>) => onFiltersChange({ ...filters, ...patch });
  return (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center" role="search" aria-label="Filter campaigns">
      <div className="relative w-full xl:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search campaigns"
          aria-label="Search campaigns" className="h-9 rounded-lg border-border/70 bg-card pl-9 pr-8 text-sm" />
        {filters.search && (
          <button type="button" onClick={() => set({ search: "" })} aria-label="Clear search"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select value={filters.type} onValueChange={(v) => set({ type: v as TypeFilter })}>
          <SelectTrigger aria-label="Campaign type" className={`${TRIGGER} sm:w-[9.5rem]`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => set({ status: v as StatusFilter })}>
          <SelectTrigger aria-label="Campaign status" className={`${TRIGGER} sm:w-[9.5rem]`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CAMPAIGN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="col-span-2 flex items-center gap-1 sm:col-span-1">
          <Select value={sort.key} onValueChange={(v) => onSortKey(v as SortKey)}>
            <SelectTrigger aria-label="Sort by" className={`${TRIGGER} w-full sm:w-[11rem]`}>
              <span className="truncate">
                <span className="text-muted-foreground">Sort:</span>{" "}<SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {SORT_KEYS.map((k) => <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" onClick={onToggleDir}
            aria-label={sort.dir === "asc" ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}
            className="h-9 w-9 shrink-0 rounded-lg border-border/70 bg-card">
            {sort.dir === "asc" ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : <ArrowDown className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2 xl:ml-auto">
        {showReset && (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} className="h-9 rounded-lg text-muted-foreground hover:text-foreground">
            Reset
          </Button>
        )}
        {columnsControl}
      </div>
    </div>
  );
}
