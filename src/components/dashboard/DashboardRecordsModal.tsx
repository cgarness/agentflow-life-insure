import React, { useEffect, useState } from "react";
import { DashboardModalEmpty, DashboardModalError, DashboardModalLoading, DashboardModalPagerFooter, DashboardModalShell } from "@/components/dashboard/ui/DashboardModalShell";
import { DashboardFilterChips, DashboardSearchInput, type FilterChip } from "@/components/dashboard/ui/DashboardFilterChips";
import { DashboardList } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import type { DashboardTone } from "@/components/dashboard/ui/dashboardTones";
import { DashboardRecordRow } from "@/components/dashboard/DashboardRecordRow";
import { recordText, type RecordType } from "@/components/dashboard/dashboardRecordText";
import type { PeopleLookup } from "@/lib/dashboard-people";

type Filter = string;

/** Type-specific filters over the LOADED rows (never presented as server-wide totals). */
function filtersFor(type: RecordType, rows: any[]): { chips: FilterChip<Filter>[]; test: (f: Filter, row: any) => boolean } | null {
  const count = (pred: (row: any) => boolean) => rows.filter(pred).length;
  if (type === "policies_sold" || type === "premium_sold") {
    const field = type === "policies_sold" ? "premium_amount" : "annual_premium";
    const known = (row: any) => row[field] != null;
    return {
      chips: [
        { id: "all", label: "All", count: rows.length },
        { id: "known", label: "Premium known", count: count(known) },
        { id: "unknown", label: "Premium unknown", count: count((r) => !known(r)) },
      ],
      test: (f, row) => f === "all" || (f === "known") === known(row),
    };
  }
  if (type === "appointments") {
    const types = [...new Set(rows.map((r) => r.type).filter(Boolean))] as string[];
    if (types.length < 2) return null;
    return {
      chips: [{ id: "all", label: "All", count: rows.length }, ...types.map((t) => ({ id: t, label: t, count: count((r) => r.type === t) }))],
      test: (f, row) => f === "all" || row.type === f,
    };
  }
  return null;
}

export interface DashboardRecordsModalProps {
  open: boolean;
  onClose: () => void;
  type: RecordType;
  tone: DashboardTone;
  icon: React.ElementType;
  title: string;
  description: string;
  scopeNote: string | null;
  rows: any[];
  loading: boolean;
  loadError: boolean;
  pageError: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  onRetry: () => void;
  onLoadMore: () => void;
  onView: (item: any) => void;
  onCall: (item: any) => void;
  canOpen: (item: any) => boolean;
  /** Writing-agent names (policies / premium in a Team view). */
  people?: PeopleLookup | null;
}

/** Calls Made, Appointments, Policies Sold and Annual Premium on the shared shell. */
const DashboardRecordsModal: React.FC<DashboardRecordsModalProps> = (props) => {
  const { open, onClose, type, tone, icon, title, description, scopeNote, rows, loading, loadError, pageError, loadingMore, hasMore } = props;
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (open) { setFilter("all"); setSearch(""); }
  }, [open, type]);

  const filters = filtersFor(type, rows);
  const query = search.trim().toLowerCase();
  const visible = rows.filter((row) => {
    if (filters && !filters.test(filter, row)) return false;
    if (!query) return true;
    const { title: name, meta } = recordText(type, row);
    return [name, meta, row.contact_phone ?? ""].some((v) => String(v).toLowerCase().includes(query));
  });

  return (
    <DashboardModalShell
      open={open}
      onClose={onClose}
      tone={tone}
      icon={icon}
      title={title}
      description={description}
      onScroll={props.onScroll}
      toolbar={
        <>
          <DashboardScopeNote text={scopeNote} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{rows.length} records loaded</p>
            {hasMore && <p className="text-xs text-muted-foreground">Filters apply to loaded records</p>}
          </div>
          {filters && <DashboardFilterChips<Filter> label="Filter loaded records" chips={filters.chips} value={filter} onChange={setFilter} />}
          <DashboardSearchInput label="Search loaded records" value={search} onChange={setSearch} />
        </>
      }
      footer={
        <DashboardModalPagerFooter shown={visible.length} loaded={rows.length} hasMore={hasMore} pageError={pageError}
          loadError={loadError} loading={loading} loadingMore={loadingMore} onLoadMore={props.onLoadMore} onClose={onClose} />
      }
    >
      {loading ? (
        <DashboardModalLoading />
      ) : loadError ? (
        <DashboardModalError onRetry={props.onRetry} />
      ) : visible.length > 0 ? (
        <DashboardList label={title}>
          {visible.map((item, idx) => (
            <DashboardRecordRow key={item.__rowKey ?? item.id ?? idx} type={type} tone={tone} item={item}
              canOpen={props.canOpen(item)} onView={props.onView} onCall={props.onCall}
              people={props.people && (type === "policies_sold" || type === "premium_sold") ? props.people : null} />
          ))}
        </DashboardList>
      ) : (
        <DashboardModalEmpty
          message={rows.length === 0 ? "No records found" : "No matches in loaded records."}
          hint={hasMore ? "More records may be available. Load the next page to check." : undefined}
        />
      )}
      {pageError && <p role="alert" className="py-2 text-center text-xs text-amber-600 dark:text-amber-500">Couldn't load more records</p>}
    </DashboardModalShell>
  );
};

export default DashboardRecordsModal;
