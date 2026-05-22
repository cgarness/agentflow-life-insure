import type {
  FeaturePriority,
  FeatureStatus,
  HealthCheckType,
  HealthStatus,
  IssueSeverity,
  IssueSource,
  IssueStatus,
  RuntimeEventType,
  RuntimeEventSource,
  RuntimeEventSeverity,
  RuntimeEventStatus,
} from "./constants";

/**
 * Row shapes for the four control_center_* tables.
 * Hand-typed for now; `supabase/types.ts` will be regenerated after the
 * migration is applied to production, at which point these can be replaced
 * with `Database["public"]["Tables"]["control_center_*"]["Row"]` aliases.
 */

export interface ControlCenterFeature {
  id: string;
  organization_id: string | null;
  feature_key: string;
  name: string;
  category: string;
  description: string | null;
  status: FeatureStatus;
  priority: FeaturePriority;
  owner: string | null;
  is_customer_visible: boolean;
  is_internal_only: boolean;
  is_blocked: boolean;
  blocked_reason: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ControlCenterIssue {
  id: string;
  organization_id: string | null;
  feature_id: string | null;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  source: IssueSource;
  reported_by: string | null;
  assigned_to: string | null;
  first_seen_at: string;
  last_seen_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ControlCenterHealthCheck {
  id: string;
  check_key: string;
  name: string;
  description: string | null;
  category: string;
  check_type: HealthCheckType;
  target: string | null;
  expected_result: string | null;
  status: HealthStatus;
  last_run_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  last_error: string | null;
  is_enabled: boolean;
  severity: IssueSeverity;
  created_at: string;
  updated_at: string;
}

export interface ControlCenterHealthCheckRun {
  id: string;
  health_check_id: string;
  status: HealthStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  result_summary: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ControlCenterRuntimeEvent {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  event_key: string | null;
  event_type: RuntimeEventType;
  severity: RuntimeEventSeverity;
  source: RuntimeEventSource;
  route: string | null;
  component_name: string | null;
  title: string;
  message: string | null;
  stack: string | null;
  metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  status: RuntimeEventStatus;
  created_at: string;
  updated_at: string;
}

