export const FEATURE_STATUSES = [
  "not_started",
  "planned",
  "in_progress",
  "needs_review",
  "testing",
  "live",
  "live_with_issues",
  "broken",
  "blocked",
  "deprecated",
] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const FEATURE_STATUS_LABELS: Record<FeatureStatus, string> = {
  not_started: "Not started",
  planned: "Planned",
  in_progress: "In progress",
  needs_review: "Needs review",
  testing: "Testing",
  live: "Live",
  live_with_issues: "Live (issues)",
  broken: "Broken",
  blocked: "Blocked",
  deprecated: "Deprecated",
};

export const FEATURE_PRIORITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "parking_lot",
] as const;
export type FeaturePriority = (typeof FEATURE_PRIORITIES)[number];

export const FEATURE_PRIORITY_LABELS: Record<FeaturePriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  parking_lot: "Parking lot",
};

export const ISSUE_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_SEVERITY_LABELS: Record<IssueSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const ISSUE_STATUSES = [
  "open",
  "investigating",
  "fix_in_progress",
  "waiting_on_review",
  "resolved",
  "ignored",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  fix_in_progress: "Fix in progress",
  waiting_on_review: "Waiting on review",
  resolved: "Resolved",
  ignored: "Ignored",
};

export const ISSUE_SOURCES = [
  "manual",
  "system_health_check",
  "frontend_error",
  "edge_function_error",
  "twilio",
  "supabase",
  "vercel",
  "user_report",
  "agent_report",
] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];

export const ISSUE_SOURCE_LABELS: Record<IssueSource, string> = {
  manual: "Manual",
  system_health_check: "Health check",
  frontend_error: "Frontend error",
  edge_function_error: "Edge function error",
  twilio: "Twilio",
  supabase: "Supabase",
  vercel: "Vercel",
  user_report: "User report",
  agent_report: "Agent report",
};

export const HEALTH_STATUSES = [
  "healthy",
  "degraded",
  "failing",
  "unknown",
  "disabled",
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
  unknown: "Unknown",
  disabled: "Disabled",
};

export const HEALTH_CHECK_TYPES = [
  "http_ping",
  "database_query",
  "edge_function_ping",
  "twilio_token_test",
  "auth_test",
  "storage_test",
  "realtime_test",
  "workflow_test",
  "manual_check",
] as const;
export type HealthCheckType = (typeof HEALTH_CHECK_TYPES)[number];

export const HEALTH_CHECK_TYPE_LABELS: Record<HealthCheckType, string> = {
  http_ping: "HTTP ping",
  database_query: "Database query",
  edge_function_ping: "Edge function ping",
  twilio_token_test: "Twilio token test",
  auth_test: "Auth test",
  storage_test: "Storage test",
  realtime_test: "Realtime test",
  workflow_test: "Workflow test",
  manual_check: "Manual check",
};

/** Statuses that count as "needs attention" in Overview. */
export const FEATURE_ATTENTION_STATUSES: FeatureStatus[] = [
  "broken",
  "blocked",
  "live_with_issues",
];

export const ISSUE_OPEN_STATUSES: IssueStatus[] = [
  "open",
  "investigating",
  "fix_in_progress",
  "waiting_on_review",
];

export const HEALTH_ATTENTION_STATUSES: HealthStatus[] = ["failing", "degraded"];

export const RUNTIME_EVENT_TYPES = [
  "frontend_error",
  "frontend_unhandled_rejection",
  "analysis_failure",
  "auth_error",
  "integration_error",
  "telemetry_warning",
] as const;
export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_EVENT_TYPE_LABELS: Record<RuntimeEventType, string> = {
  frontend_error: "Frontend error",
  frontend_unhandled_rejection: "Unhandled rejection",
  analysis_failure: "Analysis failure",
  auth_error: "Auth error",
  integration_error: "Integration error",
  telemetry_warning: "Telemetry warning",
};

export const RUNTIME_EVENT_SOURCES = ["frontend", "supabase", "control_center"] as const;
export type RuntimeEventSource = (typeof RUNTIME_EVENT_SOURCES)[number];

export const RUNTIME_EVENT_SOURCE_LABELS: Record<RuntimeEventSource, string> = {
  frontend: "Frontend",
  supabase: "Supabase",
  control_center: "Control Center",
};

export const RUNTIME_EVENT_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type RuntimeEventSeverity = (typeof RUNTIME_EVENT_SEVERITIES)[number];

export const RUNTIME_EVENT_SEVERITY_LABELS: Record<RuntimeEventSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const RUNTIME_EVENT_STATUSES = ["open", "investigating", "resolved", "ignored"] as const;
export type RuntimeEventStatus = (typeof RUNTIME_EVENT_STATUSES)[number];

export const RUNTIME_EVENT_STATUS_LABELS: Record<RuntimeEventStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  resolved: "Resolved",
  ignored: "Ignored",
};

