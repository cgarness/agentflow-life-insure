import React, { useMemo } from "react";
import { CheckCircle2, AlertTriangle, AlertOctagon, Megaphone, Clock } from "lucide-react";
import TrackerStatCard from "@/components/control-center/tracker/TrackerStatCard";
import {
  IssueStatusPill,
  MarketablePill,
  RealityPill,
  SeverityPill,
  StatusPill,
} from "@/components/control-center/tracker/TrackerStatusBadge";
import {
  deriveCompletionPercent,
  isWithinLastDays,
  TRACKER_ATTENTION_STATUSES,
  TRACKER_ISSUE_OPEN_STATUSES,
  TRACKER_STATUSES,
  TRACKER_STATUS_LABELS,
  type TrackerIssue,
  type TrackerItem,
  type TrackerMarketingClaim,
  type TrackerSystem,
} from "@/lib/control-center/trackerTypes";

interface Props {
  systems: TrackerSystem[];
  items: TrackerItem[];
  issues: TrackerIssue[];
  claims: TrackerMarketingClaim[];
}

const TrackerDashboard: React.FC<Props> = ({ systems, items, issues, claims }) => {
  const overall = deriveCompletionPercent(items);

  const needsAttention = useMemo(
    () => systems.filter((s) => TRACKER_ATTENTION_STATUSES.includes(s.status)),
    [systems],
  );

  const openIssues = useMemo(
    () => issues.filter((i) => TRACKER_ISSUE_OPEN_STATUSES.includes(i.status)),
    [issues],
  );
  const openCriticalHigh = openIssues.filter(
    (i) => i.severity === "critical" || i.severity === "high",
  );

  const marketable = useMemo(() => {
    const yes = systems.filter((s) => s.marketable_status === "yes").length;
    const partial = systems.filter((s) => s.marketable_status === "partial").length;
    const no = systems.filter((s) => s.marketable_status === "no").length;
    return { yes, partial, no };
  }, [systems]);

  const recentlyReviewed = useMemo(
    () => systems.filter((s) => isWithinLastDays(s.last_reviewed_at, 7)).length,
    [systems],
  );

  const blockers = useMemo(
    () =>
      [...openCriticalHigh].sort(
        (a, b) => new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime(),
      ),
    [openCriticalHigh],
  );

  const marketingWarnings = useMemo(
    () => claims.filter((c) => c.reality_status !== "accurate"),
    [claims],
  );

  const systemsByStatus = useMemo(() => {
    const map = new Map<string, TrackerSystem[]>();
    for (const s of systems) {
      const list = map.get(s.status) ?? [];
      list.push(s);
      map.set(s.status, list);
    }
    return map;
  }, [systems]);

  const recentlyUpdated = useMemo(
    () =>
      [...systems]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 6),
    [systems],
  );

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <TrackerStatCard
          label="Overall completion"
          value={`${overall}%`}
          tone={overall >= 80 ? "success" : overall >= 50 ? "warning" : "danger"}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={`${items.filter((i) => i.status === "complete").length}/${items.length} items complete`}
        />
        <TrackerStatCard
          label="Systems need attention"
          value={needsAttention.length}
          tone={needsAttention.length > 0 ? "warning" : "default"}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint="needs work / broken / not started"
        />
        <TrackerStatCard
          label="Open critical+high"
          value={openCriticalHigh.length}
          tone={openCriticalHigh.length > 0 ? "danger" : "success"}
          icon={<AlertOctagon className="h-4 w-4" />}
          hint={`${openIssues.length} open issues total`}
        />
        <TrackerStatCard
          label="Marketable"
          value={`${marketable.yes}/${marketable.partial}/${marketable.no}`}
          icon={<Megaphone className="h-4 w-4" />}
          hint="yes / partial / no"
        />
        <TrackerStatCard
          label="Reviewed (7d)"
          value={recentlyReviewed}
          icon={<Clock className="h-4 w-4" />}
          hint="systems reviewed this week"
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
            Launch blockers
          </h2>
          {blockers.length === 0 ? (
            <p className="text-sm text-slate-500">No open critical or high issues. 🎉</p>
          ) : (
            <ul className="space-y-2">
              {blockers.slice(0, 8).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200 truncate">{i.title}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SeverityPill severity={i.severity} />
                    <IssueStatusPill status={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
            Marketing reality warnings
          </h2>
          {marketingWarnings.length === 0 ? (
            <p className="text-sm text-slate-500">All tracked claims are accurate.</p>
          ) : (
            <ul className="space-y-2">
              {marketingWarnings.slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200 truncate">{c.feature_claim}</span>
                  <RealityPill reality={c.reality_status} className="shrink-0" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
          Systems by status
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TRACKER_STATUSES.filter((st) => (systemsByStatus.get(st) ?? []).length > 0).map(
            (st) => (
              <div
                key={st}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <StatusPill status={st} />
                  <span className="text-xs text-slate-500">
                    {(systemsByStatus.get(st) ?? []).length}
                  </span>
                </div>
                <ul className="space-y-1">
                  {(systemsByStatus.get(st) ?? []).map((s) => (
                    <li key={s.id} className="text-sm text-slate-300 truncate">
                      {s.name}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3">
          Recently updated
        </h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
          {recentlyUpdated.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-sm text-slate-200 truncate">{s.name}</div>
                <div className="text-xs text-slate-500">{s.category}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <MarketablePill marketable={s.marketable_status} />
                <StatusPill status={s.status} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default TrackerDashboard;
