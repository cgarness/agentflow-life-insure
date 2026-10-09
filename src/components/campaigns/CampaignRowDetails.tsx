import React from "react";
import {
  formatCallingWindow, maxAttemptsLabel, retryIntervalLabel, ringTimeoutLabel, type AssigneeProfileMap,
} from "@/components/dialer/campaignSelectionModel";
import { agentsModel, parseStringList, type CampaignMetrics, type CampaignRow } from "@/lib/campaigns-table/model";
import type { LoadStatus } from "@/hooks/useCampaignsTableData";
import { AssigneeNames, LastDialedValue, MetricValue, type LastDialedView } from "./CampaignCells";

interface Props {
  id: string;
  row: CampaignRow;
  metrics: CampaignMetrics;
  lastDialed: LastDialedView;
  assignees: { status: LoadStatus; map: AssigneeProfileMap } | null;
  nowMs: number;
  formatDate: (date: string | null | undefined) => string;
}

function Item({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Compact inline details: existing campaign fields and trusted metrics only. */
export default function CampaignRowDetails({ id, row, metrics, lastDialed, assignees, nowMs, formatDate }: Props) {
  const description = (row.description ?? "").trim();
  const tags = parseStringList(row.tags);
  const agents = agentsModel(row);
  return (
    <div id={id} data-testid={`campaign-details-${row.id}`} className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        <Item label="Total leads"><MetricValue metric={metrics.total} /></Item>
        <Item label="Called"><MetricValue metric={metrics.called} /></Item>
        <Item label="Contacted"><MetricValue metric={metrics.contacted} /></Item>
        <Item label="Converted"><MetricValue metric={metrics.converted} /></Item>
        <Item label="Created">{row.created_at ? formatDate(row.created_at) : "—"}</Item>
        <Item label="Last dialed"><LastDialedValue id={row.id} lastDialed={lastDialed} nowMs={nowMs} /></Item>
        <Item label="Retry interval">{retryIntervalLabel(row)}</Item>
        <Item label="Max attempts">{maxAttemptsLabel(row.max_attempts)}</Item>
        <Item label="Calling window">{formatCallingWindow(row.calling_hours_start, row.calling_hours_end)}</Item>
        <Item label="Ring timeout">{ringTimeoutLabel(row.ring_timeout_seconds)}</Item>
        <Item label={agents.kind === "personal" ? "Owner" : "Assigned agents"} wide>
          <AssigneeNames ids={agents.ids} assignees={assignees} />
          {agents.kind === "open" && <span className="text-muted-foreground"> · Open to agency</span>}
        </Item>
      </dl>
      {(description || tags.length > 0) && (
        <div className="flex flex-col gap-3 border-t border-border/50 pt-3 sm:flex-row sm:gap-8">
          {description && (
            <p className="min-w-0 flex-1 whitespace-pre-line break-words text-sm text-muted-foreground">{description}</p>
          )}
          {tags.length > 0 && (
            <ul className="flex flex-wrap items-start gap-1 sm:max-w-sm sm:justify-end" aria-label="Tags">
              {tags.map((t) => (
                <li key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
