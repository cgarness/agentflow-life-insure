import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertOctagon, ListChecks, ShieldAlert } from "lucide-react";
import SummaryCard from "@/components/control-center/SummaryCard";
import StatusBadge from "@/components/control-center/StatusBadge";
import SeverityBadge from "@/components/control-center/SeverityBadge";
import EmptyState from "@/components/control-center/EmptyState";
import { useControlCenterFeatures } from "@/hooks/useControlCenterFeatures";
import { useControlCenterIssues } from "@/hooks/useControlCenterIssues";
import { useControlCenterHealthChecks } from "@/hooks/useControlCenterHealthChecks";
import {
  FEATURE_ATTENTION_STATUSES,
  HEALTH_ATTENTION_STATUSES,
  ISSUE_OPEN_STATUSES,
  ISSUE_SEVERITIES,
  type IssueSeverity,
} from "@/lib/control-center/constants";
import { useAuth } from "@/contexts/AuthContext";

const ControlCenterOverviewPage: React.FC = () => {
  const featuresQ = useControlCenterFeatures();
  const issuesQ = useControlCenterIssues();
  const healthQ = useControlCenterHealthChecks();
  const { realProfile } = useAuth();

  const features = featuresQ.data ?? [];
  const issues = issuesQ.data ?? [];
  const health = healthQ.data ?? [];

  const featureCounts = useMemo(() => {
    const live = features.filter((f) => f.status === "live").length;
    const attention = features.filter((f) =>
      FEATURE_ATTENTION_STATUSES.includes(f.status),
    ).length;
    return { total: features.length, live, attention };
  }, [features]);

  const issuesBySeverity = useMemo(() => {
    const open = issues.filter((i) => ISSUE_OPEN_STATUSES.includes(i.status));
    const counts = ISSUE_SEVERITIES.reduce((acc, sev) => {
      acc[sev] = open.filter((i) => i.severity === sev).length;
      return acc;
    }, {} as Record<IssueSeverity, number>);
    return { open: open.length, counts };
  }, [issues]);

  const healthCounts = useMemo(() => {
    const healthy = health.filter((h) => h.status === "healthy").length;
    const failing = health.filter((h) => h.status === "failing").length;
    const degraded = health.filter((h) => h.status === "degraded").length;
    return { total: health.length, healthy, failing, degraded };
  }, [health]);

  const attentionFeatures = features
    .filter((f) => FEATURE_ATTENTION_STATUSES.includes(f.status))
    .slice(0, 5);
  const attentionIssues = issues
    .filter((i) => ISSUE_OPEN_STATUSES.includes(i.status))
    .slice(0, 5);
  const attentionHealth = health
    .filter((h) => HEALTH_ATTENTION_STATUSES.includes(h.status))
    .slice(0, 5);

  const isLoading = featuresQ.isLoading || issuesQ.isLoading || healthQ.isLoading;
  const anyData = features.length > 0 || issues.length > 0 || health.length > 0;

  const systemTone =
    healthCounts.failing > 0 || issuesBySeverity.counts.critical > 0
      ? "danger"
      : healthCounts.degraded > 0 ||
          issuesBySeverity.counts.high > 0 ||
          featureCounts.attention > 0
        ? "warning"
        : "success";

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-100">Control Center</h1>
        <p className="text-sm text-slate-400">
          Welcome back{realProfile?.first_name ? `, ${realProfile.first_name}` : ""}. Internal
          AgentFlow platform status.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="System"
          value={
            systemTone === "danger"
              ? "Action required"
              : systemTone === "warning"
                ? "Watch"
                : "Operational"
          }
          tone={systemTone}
          icon={<ShieldAlert className="h-4 w-4" />}
          hint={`${healthCounts.healthy}/${healthCounts.total || 0} checks healthy`}
        />
        <SummaryCard
          label="Features"
          value={featureCounts.total}
          tone={featureCounts.attention > 0 ? "warning" : "default"}
          icon={<ListChecks className="h-4 w-4" />}
          hint={`${featureCounts.live} live · ${featureCounts.attention} need attention`}
        />
        <SummaryCard
          label="Open issues"
          value={issuesBySeverity.open}
          tone={
            issuesBySeverity.counts.critical > 0
              ? "danger"
              : issuesBySeverity.counts.high > 0
                ? "warning"
                : "default"
          }
          icon={<AlertOctagon className="h-4 w-4" />}
          hint={`${issuesBySeverity.counts.critical} critical · ${issuesBySeverity.counts.high} high`}
        />
        <SummaryCard
          label="Health checks"
          value={healthCounts.total}
          tone={
            healthCounts.failing > 0
              ? "danger"
              : healthCounts.degraded > 0
                ? "warning"
                : "default"
          }
          icon={<Activity className="h-4 w-4" />}
          hint={`${healthCounts.failing} failing · ${healthCounts.degraded} degraded`}
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Needs attention
          </h2>
        </div>
        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : !anyData ? (
          <EmptyState
            title="Nothing tracked yet"
            description="Add features, issues, and health checks to populate the Control Center."
          />
        ) : attentionFeatures.length === 0 &&
          attentionIssues.length === 0 &&
          attentionHealth.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
            All clear. No features, issues, or health checks currently flagged.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Features
              </h3>
              {attentionFeatures.length === 0 ? (
                <p className="text-xs text-slate-500">None.</p>
              ) : (
                <ul className="space-y-2">
                  {attentionFeatures.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2">
                      <Link
                        to="/control-center/features"
                        className="text-sm text-slate-200 hover:text-white truncate"
                      >
                        {f.name}
                      </Link>
                      <StatusBadge status={f.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Open issues
              </h3>
              {attentionIssues.length === 0 ? (
                <p className="text-xs text-slate-500">None.</p>
              ) : (
                <ul className="space-y-2">
                  {attentionIssues.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2">
                      <Link
                        to="/control-center/issues"
                        className="text-sm text-slate-200 hover:text-white truncate"
                      >
                        {i.title}
                      </Link>
                      <SeverityBadge severity={i.severity} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Health checks
              </h3>
              {attentionHealth.length === 0 ? (
                <p className="text-xs text-slate-500">None.</p>
              ) : (
                <ul className="space-y-2">
                  {attentionHealth.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-2">
                      <Link
                        to="/control-center/health"
                        className="text-sm text-slate-200 hover:text-white truncate"
                      >
                        {h.name}
                      </Link>
                      <StatusBadge status={h.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default ControlCenterOverviewPage;
