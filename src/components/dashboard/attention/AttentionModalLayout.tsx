import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttentionFeed, AttentionView } from "@/hooks/useAttentionDetailFeed";
import { DashboardModalEmpty, DashboardModalError, DashboardModalLoading, DashboardModalShell } from "@/components/dashboard/ui/DashboardModalShell";
import { DashboardFilterChips, DashboardSearchInput, type FilterChip } from "@/components/dashboard/ui/DashboardFilterChips";
import { DashboardList, DashboardStatusBadge } from "@/components/dashboard/ui/DashboardListRow";
import { DashboardScopeNote } from "@/components/dashboard/ui/DashboardScopeNote";
import type { DashboardTone } from "@/components/dashboard/ui/dashboardTones";

export interface AttentionFilters<T> {
  chips: FilterChip<string>[];
  test: (filter: string, row: T) => boolean;
}

interface Props<T> {
  open: boolean;
  onClose: () => void;
  tone: DashboardTone;
  icon: React.ElementType;
  title: string;
  description: string;
  /** "callbacks" / "missed calls" — used in counts and labels. */
  noun: string;
  /** The singular ("callback" / "missed call"). */
  nounOne: string;
  feed: AttentionFeed<T>;
  scopeNote: string | null;
  /** Clear is available: the Active / Cleared views are offered. */
  clearable: boolean;
  /** What the Cleared view means, in one sentence. */
  clearedNote: string;
  /** Filter chips over the LOADED active rows (never presented as server-wide totals). */
  filters: (rows: T[]) => AttentionFilters<T> | null;
  matches: (row: T, query: string) => boolean;
  renderRow: (row: T) => React.ReactNode;
  keyOf: (row: T) => string;
  onViewChange: (view: AttentionView) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  /** Wraps the list, for focus recovery after a row leaves it. */
  listRef?: React.Ref<HTMLDivElement>;
}

/**
 * The shared frame of the Callbacks and Missed Calls detail views (plan §3.7, §4.3): an Active /
 * Cleared view, filters and search over the loaded rows, exact totals in the footer, and the
 * loading / failed / empty / paging / refresh states. Presentation only — the feed reads.
 */
export function AttentionModalLayout<T>(props: Props<T>) {
  const { open, onClose, feed, clearable } = props;
  const noun = props.noun;
  const count = (n: number) => (n === 1 ? props.nounOne : props.noun);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (open) { setFilter("all"); setSearch(""); }
  }, [open]);

  const cleared = feed.view === "cleared";
  const source = cleared ? feed.clearedRows : feed.rows;
  const filters = cleared ? null : props.filters(feed.rows);
  const query = search.trim().toLowerCase();
  const visible = source.filter((row) => (!filters || filters.test(filter, row)) && (!query || props.matches(row, query)));
  const total = cleared ? feed.cleared : feed.active;

  return (
    <DashboardModalShell
      open={open}
      onClose={onClose}
      tone={props.tone}
      icon={props.icon}
      title={props.title}
      description={props.description}
      onScroll={props.onScroll}
      toolbar={
        <>
          <DashboardScopeNote text={props.scopeNote} />
          {clearable && (
            <DashboardFilterChips<AttentionView> label={`${props.title} view`} value={feed.view} onChange={props.onViewChange}
              chips={[{ id: "active", label: "Active", count: feed.active }, { id: "cleared", label: "Cleared", count: feed.cleared }]} />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {cleared ? `${source.length} cleared ${count(source.length)}` : `${source.length} ${count(source.length)} loaded`}
            </p>
            {!cleared && <p className="text-xs text-muted-foreground">Filters apply to loaded records</p>}
          </div>
          {cleared && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <DashboardStatusBadge status="cleared" /> <span>{props.clearedNote}</span>
            </p>
          )}
          {filters && <DashboardFilterChips<string> label={`Filter loaded ${noun}`} chips={filters.chips} value={filter} onChange={setFilter} />}
          <DashboardSearchInput label={`Search ${cleared ? "cleared" : "loaded"} ${noun}`} value={search} onChange={setSearch} />
          {feed.refreshing && <p role="status" className="text-xs text-muted-foreground">Updating…</p>}
          {feed.refreshError && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">Couldn't refresh — showing the list from before.</p>}
        </>
      }
      footer={
        <>
          <span className="text-xs text-muted-foreground">
            Showing {visible.length} of {total} {cleared ? "cleared" : "active"} {count(total)}
          </span>
          {!cleared && (feed.hasMore || feed.pageError) && feed.status === "ready" ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onLoadMore} disabled={feed.loadingMore} className="rounded-lg">
              {feed.loadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {feed.pageError ? "Retry page" : "Load more"}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-lg">Close</Button>
          )}
        </>
      }
    >
      {feed.status === "loading" || (cleared && feed.clearedStatus === "loading") ? (
        <DashboardModalLoading />
      ) : feed.status === "failed" || (cleared && feed.clearedStatus === "failed") ? (
        <DashboardModalError onRetry={props.onRetry} />
      ) : visible.length > 0 ? (
        <div ref={props.listRef} className="outline-none">
          <p tabIndex={-1} data-list-focus-fallback="" className="sr-only">{cleared ? `Cleared ${noun}` : props.title}</p>
          <DashboardList label={cleared ? `Cleared ${noun}` : props.title}>
            {visible.map((row) => <React.Fragment key={props.keyOf(row)}>{props.renderRow(row)}</React.Fragment>)}
          </DashboardList>
        </div>
      ) : (
        <DashboardModalEmpty
          message={source.length === 0 ? (cleared ? `No cleared ${noun}` : "No records found") : `No matches in ${cleared ? "cleared" : "loaded"} ${noun}.`}
          hint={!cleared && feed.hasMore ? `More ${noun} may be available. Load the next page to check.` : undefined}
        />
      )}
      {!cleared && feed.pageError && <p role="alert" className="py-2 text-center text-xs text-amber-600 dark:text-amber-500">Couldn't load more records</p>}
    </DashboardModalShell>
  );
}
