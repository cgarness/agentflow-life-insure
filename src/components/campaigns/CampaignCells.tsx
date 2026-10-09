import React from "react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  campaignTypeLabel, formatExactTimestamp, formatLastDialedRelative, initialsFor, resolveLastDialedIso,
  type AssigneeProfile, type AssigneeProfileMap,
} from "@/components/dialer/campaignSelectionModel";
import {
  agentsModel, campaignTypeKey, metricNumber, parseStringList, progressPercent,
  type CampaignMetrics, type CampaignRow, type MetricState,
} from "@/lib/campaigns-table/model";
import type { LoadStatus } from "@/hooks/useCampaignsTableData";

const TYPE_CLASS: Record<string, string> = {
  personal: "border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-300",
  team: "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  open: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  other: "border-border bg-muted text-muted-foreground",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
      TYPE_CLASS[campaignTypeKey(type)])}>
      {campaignTypeLabel(type) || "Unknown"}
    </span>
  );
}

const STATUS_CLASS: Record<string, { pill: string; dot: string }> = {
  Active: { pill: "border-success/25 bg-success/10 text-success", dot: "bg-success" },
  Paused: { pill: "border-warning/25 bg-warning/10 text-warning", dot: "bg-warning" },
  Draft: { pill: "border-border bg-muted/60 text-muted-foreground", dot: "bg-muted-foreground/60" },
  Completed: { pill: "border-primary/25 bg-primary/10 text-primary", dot: "bg-primary" },
  Archived: { pill: "border-border/60 text-muted-foreground/70", dot: "bg-muted-foreground/40" },
};

export function StatusPill({ status }: { status: string }) {
  const c = STATUS_CLASS[status] ?? STATUS_CLASS.Draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", c.pill)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      {status}
    </span>
  );
}

function Dash({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default text-muted-foreground">
          <span aria-hidden="true">—</span>
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent><p className="text-xs">{label}</p></TooltipContent>
    </Tooltip>
  );
}

export function MetricValue({ metric, className }: { metric: MetricState; className?: string }) {
  if (metric.kind === "loading") return <Skeleton data-testid="metric-loading" className="inline-block h-4 w-8 align-middle" />;
  if (metric.kind === "error") return <Dash label="Metrics unavailable" />;
  if (metric.kind === "unavailable") return <Dash label="Not available for this campaign" />;
  return <span className={cn("tabular-nums text-foreground", className)}>{metric.value.toLocaleString()}</span>;
}

/** Called at least once / total. Never labelled untouched or completed. */
export function LeadProgress({ metrics, compact = false }: { metrics: CampaignMetrics; compact?: boolean }) {
  const pct = progressPercent(metrics);
  const called = metricNumber(metrics.called);
  const total = metricNumber(metrics.total);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", compact ? "w-full" : "w-40")} data-testid="lead-progress">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={cn(compact ? "flex flex-wrap items-baseline gap-x-1" : "whitespace-nowrap")}>
          <span className="whitespace-nowrap">
            <MetricValue metric={metrics.called} className="font-medium" />
            <span className="text-muted-foreground"> / </span>
            <MetricValue metric={metrics.total} className="text-muted-foreground" />
          </span>
          {compact && called !== null && <>{" "}<span className="text-xs text-muted-foreground">called</span></>}
        </span>
        {!compact && pct !== null && total !== null && total > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Progress value={pct ?? 0} aria-hidden="true"
              className={cn("h-1 bg-muted", pct === null && "opacity-40")} />
          </div>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">Called at least once</p></TooltipContent>
      </Tooltip>
    </div>
  );
}

function people(ids: string[], map: AssigneeProfileMap): AssigneeProfile[] {
  return ids.map((id) => map[id] ?? { id, displayName: null, avatarUrl: null });
}

/** Compact initials stack with `+N`; full names in a tooltip and for screen readers. */
function AgentAvatars({ list, max = 4 }: { list: AssigneeProfile[]; max?: number }) {
  const shown = list.slice(0, max);
  const names = list.map((p) => p.displayName ?? "Unknown user").join(", ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-testid="agents-stack" className="inline-flex items-center rounded-full">
          <span className="flex -space-x-1.5" aria-hidden="true">
            {shown.map((p) => (
              <Avatar key={p.id} className="h-7 w-7 ring-2 ring-card">
                {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                <AvatarFallback className="bg-muted text-[10px] font-semibold text-foreground/80">{initialsFor(p.displayName)}</AvatarFallback>
              </Avatar>
            ))}
          </span>
          {list.length > shown.length && (
            <span aria-hidden="true" className="ml-1.5 text-xs font-medium tabular-nums text-muted-foreground">+{list.length - shown.length}</span>
          )}
          <span className="sr-only">{names}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs"><p className="text-xs">{names}</p></TooltipContent>
    </Tooltip>
  );
}

/** Leadership sees identities; everyone else sees an assigned-agent count only. */
export function AgentsCell({ row, assignees }: { row: CampaignRow; assignees: { status: LoadStatus; map: AssigneeProfileMap } | null }) {
  const model = agentsModel(row);
  if (model.kind === "open") return <span className="whitespace-nowrap text-sm text-muted-foreground">Open to agency</span>;
  if (model.ids.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  if (!assignees || assignees.status === "error") {
    return <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{model.ids.length} assigned</span>;
  }
  if (assignees.status === "loading" && model.ids.some((id) => !assignees.map[id])) {
    return <Skeleton data-testid="agents-loading" className="h-6 w-16 rounded-full" />;
  }
  return <AgentAvatars list={people(model.ids, assignees.map)} />;
}

export function AssigneeNames({ ids, assignees }: { ids: string[]; assignees: { status: LoadStatus; map: AssigneeProfileMap } | null }) {
  if (ids.length === 0) return <span className="text-muted-foreground">—</span>;
  if (!assignees || assignees.status === "error") return <span>{ids.length} assigned</span>;
  if (assignees.status === "loading" && ids.some((id) => !assignees.map[id])) return <Skeleton className="h-4 w-24" />;
  return <span className="break-words">{people(ids, assignees.map).map((p) => p.displayName ?? "Unknown user").join(", ")}</span>;
}

export interface LastDialedView {
  status: LoadStatus;
  map: Record<string, string | null> | null;
}

/** Organization-wide last call time; a loaded map without the id means never dialed. */
export function LastDialedValue({ id, lastDialed, nowMs }: { id: string; lastDialed: LastDialedView; nowMs: number }) {
  if (lastDialed.status === "loading") return <Skeleton className="inline-block h-4 w-16 align-middle" />;
  if (lastDialed.status === "error" || !lastDialed.map) return <Dash label="Last dialed unavailable" />;
  const iso = resolveLastDialedIso(id, lastDialed.map);
  if (!iso) return <span className="text-sm text-muted-foreground">Never</span>;
  const exact = formatExactTimestamp(iso);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default whitespace-nowrap text-sm text-foreground">
          {formatLastDialedRelative(iso, nowMs)}
          <span className="sr-only"> ({exact})</span>
        </span>
      </TooltipTrigger>
      <TooltipContent><p className="text-xs">{exact}</p></TooltipContent>
    </Tooltip>
  );
}

export function TagChips({ tags, max = 2 }: { tags: unknown; max?: number }) {
  const list = parseStringList(tags);
  if (list.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  const shown = list.slice(0, max);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((t) => (
        <span key={t} className="max-w-[8rem] truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={t}>{t}</span>
      ))}
      {list.length > shown.length && <span className="text-[11px] font-medium text-muted-foreground">+{list.length - shown.length}</span>}
    </span>
  );
}
