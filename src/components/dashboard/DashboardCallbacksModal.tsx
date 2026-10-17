import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, Phone, RefreshCw, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  bucketCallback,
  CALLBACK_LOOKAHEAD_DAYS,
  CALLBACK_LOOKBACK_DAYS,
  type CallbackBucket,
  type NormalizedCallbackRow,
} from "@/lib/dashboard-callbacks";
import { startOfLocalDayPlus } from "@/lib/local-calendar";

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
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "dueToday", label: "Today" },
  { id: "dueSoon", label: "Upcoming" },
];

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
}

function callbackBucket(row: DashboardCallbackRow, now: Date): CallbackBucket {
  return bucketCallback(
    { dueAt: row.start_time } as NormalizedCallbackRow,
    now,
    startOfLocalDayPlus(now, 1),
  );
}

function CallbackListRow({
  row, bucket, onCall, onView,
}: {
  row: DashboardCallbackRow;
  bucket: CallbackBucket;
  onCall: Props["onCall"];
  onView: Props["onView"];
}) {
  const timestamp = new Date(row.start_time);
  const dueLabel = Number.isNaN(timestamp.getTime())
    ? "Date unavailable"
    : timestamp.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const name = row.contact_name || "Unknown contact";
  const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("");
  const status = bucket === "overdue" ? "Overdue" : bucket === "dueToday" ? "Today" : "Upcoming";
  const statusStyle = bucket === "overdue"
    ? "border-red-500/20 bg-red-500/10 text-red-500"
    : bucket === "dueToday"
      ? "border-blue-500/20 bg-blue-500/10 text-blue-500"
      : "border-border bg-muted text-muted-foreground";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-3 sm:px-4">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initials || <UserRound className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-[1_1_180px] space-y-1">
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{dueLabel}</span>
          {" · "}{row.type === "Campaign callback" ? "Campaign" : "Follow-up"}
        </p>
        {row.notes && <p className="line-clamp-2 text-xs text-muted-foreground">{row.notes}</p>}
      </div>
      <span className={"rounded-full border px-2.5 py-1 text-[11px] font-medium " + statusStyle}>{status}</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg"
          disabled={!row.__canOpen} title={!row.__canOpen ? row.__blockedReason ?? "Contact unavailable" : undefined}
          aria-label={"View " + name} onClick={() => onView(row)}>
          View
        </Button>
        <Button type="button" size="sm" className="h-9 gap-1.5 rounded-lg"
          disabled={!row.__canAct} title={!row.__canAct ? row.__blockedReason ?? "Cannot call this contact" : undefined}
          aria-label={"Call " + name} onClick={event => onCall(event, row)}>
          <Phone className="h-3.5 w-3.5" /> Call
        </Button>
      </div>
    </div>
  );
}

export default function DashboardCallbacksModal({
  open, onClose, rows, loading, loadError, pageError, loadingMore, hasMore, onCall, onView, onRetry, onLoadMore, onScroll,
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
  const counts = {
    all: bucketed.length,
    overdue: bucketed.filter(item => item.bucket === "overdue").length,
    dueToday: bucketed.filter(item => item.bucket === "dueToday").length,
    dueSoon: bucketed.filter(item => item.bucket === "dueSoon").length,
  };
  const query = search.trim().toLowerCase();
  const visible = bucketed.filter(({ row, bucket }) =>
    (filter === "all" || bucket === filter) &&
    (!query || [row.contact_name, row.phone, row.notes ?? ""].some(value => value.toLowerCase().includes(query))),
  );

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
      <DialogContent className="flex max-h-[min(90dvh,780px)] w-[calc(100vw-1.5rem)] max-w-[760px] flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-lg font-semibold tracking-tight">Callbacks</DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                Past {CALLBACK_LOOKBACK_DAYS} days through the next {CALLBACK_LOOKAHEAD_DAYS} days
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="shrink-0 space-y-3 border-b border-border px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{loaded.length} callbacks loaded</p>
            <p className="text-xs text-muted-foreground">Filters apply to loaded records</p>
          </div>
          <div aria-label="Filter loaded callbacks" className="flex flex-wrap gap-1.5">
            {FILTERS.map(item => (
              <Button key={item.id} type="button" size="sm"
                variant={filter === item.id ? "default" : "outline"}
                aria-pressed={filter === item.id}
                className="h-8 rounded-lg px-3 text-xs"
                onClick={() => setFilter(item.id)}>
                {item.label} ({counts[item.id]})
              </Button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search loaded callbacks" placeholder="Search loaded callbacks" value={search}
              onChange={event => setSearch(event.target.value)} className="h-9 rounded-lg pl-9 text-sm" />
          </div>
        </div>

        <div onScroll={onScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/10 px-4 py-4 sm:px-6" aria-live="polite">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading records...
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              <p className="text-sm text-foreground">Couldn't load these records</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          ) : visible.length > 0 ? (
            visible.map(({ row, bucket }) => (
              <CallbackListRow key={row.__rowKey} row={row} bucket={bucket} onCall={onCall} onView={onView} />
            ))
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {loaded.length === 0 ? "No records found" : "No matches in loaded callbacks."}
              {hasMore && <p className="mt-2 text-xs">More callbacks may be available. Load the next page to check.</p>}
            </div>
          )}
          {pageError && (
            <p role="alert" className="py-2 text-center text-xs text-amber-500">Couldn't load more records</p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-4 py-3 sm:px-6">
          <span className="text-xs text-muted-foreground">Showing {visible.length} of {loaded.length} loaded</span>
          {(hasMore || pageError) && !loadError ? (
            <Button type="button" variant="outline" size="sm" onClick={onLoadMore} disabled={loading || loadingMore}
              className="rounded-lg">
              {loadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {pageError ? "Retry page" : "Load more"}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-lg">Close</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
