import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  bucketCallback,
  CALLBACK_LOOKAHEAD_DAYS,
  CALLBACK_LOOKBACK_DAYS,
  type CallbackBucket,
  type NormalizedCallbackRow,
} from "@/lib/dashboard-callbacks";
import { startOfLocalDayPlus } from "@/lib/local-calendar";
import { DashboardModalEmpty, DashboardModalError, DashboardModalLoading, DashboardModalPagerFooter, DashboardModalShell } from "@/components/dashboard/ui/DashboardModalShell";
import { DashboardFilterChips, DashboardSearchInput, type FilterChip } from "@/components/dashboard/ui/DashboardFilterChips";
import { DashboardList, DashboardListRow, DashboardStatusPill } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import { ATTENTION_PILL, DASHBOARD_TONES, NEUTRAL_PILL } from "@/components/dashboard/ui/dashboardTones";

/** Presentation only: the parent retains the canonical callback query and pagination. */
export interface DashboardCallbackRow {
  __callback: true;
  __rowKey: string;
  __canAct: boolean;
  __canOpen: boolean;
  __blockedReason: string | null;
  contact_name: string;
  contact_id: string | null;
  contact_type: string | null;
  phone: string;
  start_time: string;
  notes: string | null;
  type: string;
}

type Filter = "all" | CallbackBucket;

interface Props {
  open: boolean;
  onClose: () => void;
  rows: DashboardCallbackRow[];
  loading: boolean;
  loadError: boolean;
  pageError: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onCall: (event: React.MouseEvent<HTMLButtonElement>, row: DashboardCallbackRow) => void;
  onView: (row: DashboardCallbackRow) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  /** Whose callbacks these are, when the perspective suggests otherwise (plan §2A). */
  scopeNote?: string | null;
}

function callbackBucket(row: DashboardCallbackRow, now: Date): CallbackBucket {
  return bucketCallback({ dueAt: row.start_time } as NormalizedCallbackRow, now, startOfLocalDayPlus(now, 1));
}

const STATUS: Record<CallbackBucket, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: ATTENTION_PILL },
  dueToday: { label: "Today", className: DASHBOARD_TONES.blue.pill },
  dueSoon: { label: "Upcoming", className: NEUTRAL_PILL },
};

function CallbackListRow({ row, bucket, onCall, onView }: { row: DashboardCallbackRow; bucket: CallbackBucket; onCall: Props["onCall"]; onView: Props["onView"] }) {
  const timestamp = new Date(row.start_time);
  const dueLabel = Number.isNaN(timestamp.getTime())
    ? "Date unavailable"
    : timestamp.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const name = row.contact_name || "Unknown contact";
  const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("");

  return (
    <DashboardListRow
      tone="blue"
      leading={
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-xs font-semibold text-blue-700 dark:text-blue-300">
          {initials || <UserRound className="h-4 w-4" />}
        </span>
      }
      title={name}
      meta={`${dueLabel} · ${row.type === "Campaign callback" ? "Campaign" : "Follow-up"}`}
      detail={row.notes && <p className="line-clamp-2 text-xs text-muted-foreground">{row.notes}</p>}
      status={<DashboardStatusPill className={STATUS[bucket].className}>{STATUS[bucket].label}</DashboardStatusPill>}
      actions={
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg"
            disabled={!row.__canOpen} title={!row.__canOpen ? row.__blockedReason ?? "Contact unavailable" : undefined}
            aria-label={"View " + name} onClick={() => onView(row)}>
            View
          </Button>
          <Button type="button" size="sm" className="h-9 gap-1.5 rounded-lg"
            disabled={!row.__canAct} title={!row.__canAct ? row.__blockedReason ?? "Cannot call this contact" : undefined}
            aria-label={"Call " + name} onClick={event => onCall(event, row)}>
            <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call
          </Button>
        </div>
      }
    />
  );
}

export default function DashboardCallbacksModal({
  open, onClose, rows, loading, loadError, pageError, loadingMore, hasMore, onCall, onView, onRetry, onLoadMore, onScroll, scopeNote = null,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) { setFilter("all"); setSearch(""); }
  }, [open]);

  // The parent fetches 20 rows at a time. Keep local filters explicitly scoped
  // to loaded rows; never misrepresent them as server-wide totals or search.
  const loaded = rows.filter(row => row.__callback === true);
  const now = new Date();
  const bucketed = useMemo(
    () => loaded.map(row => ({ row, bucket: callbackBucket(row, now) })),
    // Recompute on each new page, open, or local filtering render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, open, filter, search],
  );
  const count = (bucket: CallbackBucket) => bucketed.filter(item => item.bucket === bucket).length;
  const chips: FilterChip<Filter>[] = [
    { id: "all", label: "All", count: bucketed.length },
    { id: "overdue", label: "Overdue", count: count("overdue") },
    { id: "dueToday", label: "Today", count: count("dueToday") },
    { id: "dueSoon", label: "Upcoming", count: count("dueSoon") },
  ];
  const query = search.trim().toLowerCase();
  const visible = bucketed.filter(({ row, bucket }) =>
    (filter === "all" || bucket === filter) &&
    (!query || [row.contact_name, row.phone, row.notes ?? ""].some(value => value.toLowerCase().includes(query))),
  );

  return (
    <DashboardModalShell
      open={open}
      onClose={onClose}
      tone="blue"
      icon={CalendarClock}
      title="Callbacks"
      description={`Past ${CALLBACK_LOOKBACK_DAYS} days through the next ${CALLBACK_LOOKAHEAD_DAYS} days`}
      onScroll={onScroll}
      toolbar={
        <>
          <DashboardScopeNote text={scopeNote} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{loaded.length} callbacks loaded</p>
            <p className="text-xs text-muted-foreground">Filters apply to loaded records</p>
          </div>
          <DashboardFilterChips<Filter> label="Filter loaded callbacks" chips={chips} value={filter} onChange={setFilter} />
          <DashboardSearchInput label="Search loaded callbacks" value={search} onChange={setSearch} />
        </>
      }
      footer={
        <DashboardModalPagerFooter shown={visible.length} loaded={loaded.length} hasMore={hasMore} pageError={pageError}
          loadError={loadError} loading={loading} loadingMore={loadingMore} onLoadMore={onLoadMore} onClose={onClose} />
      }
    >
      {loading ? (
        <DashboardModalLoading />
      ) : loadError ? (
        <DashboardModalError onRetry={onRetry} />
      ) : visible.length > 0 ? (
        <DashboardList label="Callbacks">
          {visible.map(({ row, bucket }) => (
            <CallbackListRow key={row.__rowKey} row={row} bucket={bucket} onCall={onCall} onView={onView} />
          ))}
        </DashboardList>
      ) : (
        <DashboardModalEmpty
          message={loaded.length === 0 ? "No records found" : "No matches in loaded callbacks."}
          hint={hasMore ? "More callbacks may be available. Load the next page to check." : undefined}
        />
      )}
      {pageError && <p role="alert" className="py-2 text-center text-xs text-amber-600 dark:text-amber-500">Couldn't load more records</p>}
    </DashboardModalShell>
  );
}
