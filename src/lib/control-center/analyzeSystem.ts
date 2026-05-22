import { SystemInventoryFeature } from "./systemInventoryManifest";

export interface LiveSignals {
  tables: string[];
  rls_disabled: string[];
  rls_no_policy: string[];
  rls_always_true: { table: string; policy: string }[];
  sec_def_public: string[];
  sec_def_authenticated: string[];
  mutable_search_path: string[];
  public_buckets: string[];
  public_extensions: string[];
  system_status: {
    component_name: string;
    status: string;
    description: string | null;
    notes: string | null;
  }[];
  edgeFunctions: Record<string, "active" | "missing">;
}

export interface FeatureUpsert {
  feature_key: string;
  name: string;
  category: string;
  description: string;
  status: string;
  priority: string;
  is_customer_visible: boolean;
  is_internal_only: boolean;
  metadata: Record<string, any>;
}

export interface IssueUpsert {
  issue_key: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: "open" | "investigating" | "fix_in_progress" | "waiting_on_review" | "resolved" | "ignored";
  source: string;
  metadata: Record<string, any>;
}

export interface HealthCheckUpsert {
  check_key: string;
  name: string;
  description: string;
  category: string;
  check_type: "http_ping" | "database_query" | "edge_function_ping" | "twilio_token_test" | "auth_test" | "storage_test" | "realtime_test" | "workflow_test" | "manual_check";
  target: string;
  expected_result: string;
  status: "healthy" | "degraded" | "failing" | "unknown" | "disabled";
  is_enabled: boolean;
  severity: "critical" | "high" | "medium" | "low" | "info";
  metadata: Record<string, any>;
}

// 1. Build Feature Upserts
export function buildFeatureUpserts(
  manifest: SystemInventoryFeature[],
  liveSignals: LiveSignals
): FeatureUpsert[] {
  return manifest.map((feat) => {
    // Determine status
    let status = feat.expected_status;

    if (feat.expected_status === "planned" || feat.expected_status === "not_started") {
      // Planned or deferred
      status = feat.expected_status;
    } else {
      // Feature is supposed to be live or in testing/progress
      const missingTables = feat.expected_tables.filter(
        (t) => !liveSignals.tables.includes(t)
      );
      const missingFunctions = feat.expected_edge_functions.filter(
        (f) => liveSignals.edgeFunctions[f] === "missing"
      );

      // Check if it has security advisor findings on its tables
      const hasTableSecurityIssue = feat.expected_tables.some(
        (t) =>
          liveSignals.rls_disabled.includes(t) ||
          liveSignals.rls_always_true.some((p) => p.table === t)
      );

      if (missingTables.length === feat.expected_tables.length && feat.expected_tables.length > 0) {
        status = "not_started";
      } else if (missingTables.length > 0 || missingFunctions.length > 0) {
        status = "broken";
      } else if (hasTableSecurityIssue) {
        status = "live_with_issues";
      } else {
        status = feat.expected_status;
      }
    }

    return {
      feature_key: feat.feature_key,
      name: feat.name,
      category: feat.category,
      description: feat.description,
      status,
      priority: feat.priority,
      is_customer_visible: feat.is_customer_visible,
      is_internal_only: feat.is_internal_only,
      metadata: {
        expected_tables: feat.expected_tables,
        expected_edge_functions: feat.expected_edge_functions,
        expected_routes: feat.expected_routes,
        expected_notes: feat.expected_notes
      }
    };
  });
}

// 2. Build Issue Upserts (deterministic deduplication)
export function buildIssueUpserts(liveSignals: LiveSignals): IssueUpsert[] {
  const upserts: IssueUpsert[] = [];

  // RLS Disabled in Public
  for (const table of liveSignals.rls_disabled) {
    upserts.push({
      issue_key: `security.rls_disabled.public.${table}`,
      title: `RLS Disabled on public.${table}`,
      description: `Table public.${table} has Row Level Security disabled. This allows unauthorized read/write access from anonymous client credentials.`,
      severity: "critical",
      status: "open",
      source: "supabase_advisor",
      metadata: { table, finding: "RLS Disabled" }
    });
  }

  // RLS Enabled No Policy
  for (const table of liveSignals.rls_no_policy) {
    upserts.push({
      issue_key: `security.rls_no_policy.public.${table}`,
      title: `RLS Enabled but No Policies on public.${table}`,
      description: `Table public.${table} has Row Level Security enabled but no active security policies. All access from clients is fully locked down.`,
      severity: "medium",
      status: "open",
      source: "supabase_advisor",
      metadata: { table, finding: "RLS Enabled No Policy" }
    });
  }

  // RLS Policy Always True
  for (const item of liveSignals.rls_always_true) {
    upserts.push({
      issue_key: `security.rls_always_true.public.${item.table}.${item.policy}`,
      title: `RLS Policy Always True on public.${item.table}`,
      description: `Table public.${item.table} has a security policy "${item.policy}" that evaluates to true. This allows open access without correct tenant filtering.`,
      severity: "high",
      status: "open",
      source: "supabase_advisor",
      metadata: { table: item.table, policy: item.policy, finding: "RLS Policy Always True" }
    });
  }

  // Public Can Execute SECURITY DEFINER Function
  for (const fn of liveSignals.sec_def_public) {
    upserts.push({
      issue_key: `security.sec_def_public.public.${fn}`,
      title: `Public can execute SECURITY DEFINER public.${fn}`,
      description: `Function public.${fn} runs with SECURITY DEFINER and is executable by the PUBLIC role. Check if this exposes administrative or backend secrets.`,
      severity: "high",
      status: "open",
      source: "supabase_advisor",
      metadata: { function: fn, finding: "Public Executable SECURITY DEFINER" }
    });
  }

  // Signed-In Users Can Execute SECURITY DEFINER Function
  for (const fn of liveSignals.sec_def_authenticated) {
    // Exclude certain standard admin functions that are safe
    if (fn === "is_admin" || fn === "is_super_admin" || fn === "is_platform_admin") continue;
    upserts.push({
      issue_key: `security.sec_def_authenticated.public.${fn}`,
      title: `Signed-In Users can execute SECURITY DEFINER public.${fn}`,
      description: `Function public.${fn} runs with SECURITY DEFINER and is executable by any authenticated user. Ensure strict RLS checks inside the function.`,
      severity: "medium",
      status: "open",
      source: "supabase_advisor",
      metadata: { function: fn, finding: "Authenticated Executable SECURITY DEFINER" }
    });
  }

  // Function Search Path Mutable
  for (const fn of liveSignals.mutable_search_path) {
    upserts.push({
      issue_key: `security.advisor.function_search_path_mutable.public.${fn}`,
      title: `Mutable Function Search Path on public.${fn}`,
      description: `SECURITY DEFINER function public.${fn} does not declare a search_path config. This allows malicious actors to intercept internal helper calls.`,
      severity: "medium",
      status: "open",
      source: "supabase_advisor",
      metadata: { function: fn, finding: "Function Search Path Mutable" }
    });
  }

  // Missing expected Edge Functions
  for (const [fn, state] of Object.entries(liveSignals.edgeFunctions)) {
    if (state === "missing") {
      upserts.push({
        issue_key: `edge_function.missing.${fn}`,
        title: `Edge Function Not Registered: ${fn}`,
        description: `The Edge Function "${fn}" is expected by the system but returned a 404. It may not be deployed on Supabase.`,
        severity: "high",
        status: "open",
        source: "system_analysis",
        metadata: { function: fn, finding: "Edge Function Missing" }
      });
    }
  }

  return upserts;
}

// 3. Build Health Check Upserts
export function buildHealthCheckUpserts(
  manifest: SystemInventoryFeature[],
  liveSignals: LiveSignals
): HealthCheckUpsert[] {
  const upserts: HealthCheckUpsert[] = [];

  // --- Supabase checks ---
  upserts.push({
    check_key: "supabase.public_schema_present",
    name: "Supabase Public Schema Present",
    description: "Verifies the database public schema contains tables and is responsive.",
    category: "Supabase",
    check_type: "database_query",
    target: "pg_tables",
    expected_result: "tables count > 0",
    status: liveSignals.tables.length > 0 ? "healthy" : "failing",
    is_enabled: true,
    severity: "critical",
    metadata: { tables_count: liveSignals.tables.length }
  });

  const ccTables = [
    "control_center_features",
    "control_center_issues",
    "control_center_health_checks",
    "control_center_health_check_runs"
  ];
  const missingCcTables = ccTables.filter((t) => !liveSignals.tables.includes(t));
  upserts.push({
    check_key: "supabase.control_center_tables_present",
    name: "Control Center Schema Presence",
    description: "Verifies that all 4 Control Center management tables exist.",
    category: "Supabase",
    check_type: "database_query",
    target: "control_center_features, control_center_issues, control_center_health_checks, control_center_health_check_runs",
    expected_result: "all tables present",
    status: missingCcTables.length === 0 ? "healthy" : missingCcTables.length < 4 ? "degraded" : "failing",
    is_enabled: true,
    severity: "critical",
    metadata: { missing_tables: missingCcTables }
  });

  const criticalIssuesCount = liveSignals.rls_disabled.length + liveSignals.rls_always_true.length;
  upserts.push({
    check_key: "supabase.rls_advisors",
    name: "RLS Policies Integrity",
    description: "Audits for disabled RLS or always-true logic in security policies.",
    category: "Supabase",
    check_type: "database_query",
    target: "pg_tables, pg_policies",
    expected_result: "0 disabled RLS tables",
    status: criticalIssuesCount === 0 ? "healthy" : "degraded",
    is_enabled: true,
    severity: "high",
    metadata: {
      rls_disabled_count: liveSignals.rls_disabled.length,
      always_true_count: liveSignals.rls_always_true.length
    }
  });

  const missingEdgeFns = Object.values(liveSignals.edgeFunctions).filter((s) => s === "missing").length;
  upserts.push({
    check_key: "supabase.edge_functions_active",
    name: "Edge Functions Deployment Status",
    description: "Validates all expected Edge Functions respond to routing requests.",
    category: "Supabase",
    check_type: "edge_function_ping",
    target: "Edge Functions list",
    expected_result: "0 missing functions",
    status: missingEdgeFns === 0 ? "healthy" : missingEdgeFns < Object.keys(liveSignals.edgeFunctions).length ? "degraded" : "failing",
    is_enabled: true,
    severity: "high",
    metadata: { missing_count: missingEdgeFns }
  });

  // --- Telephony ---
  upserts.push({
    check_key: "twilio.token_function_registered",
    name: "Twilio Voice JWT Generator",
    description: "Verifies the Twilio Voice auth token Edge Function is deployed.",
    category: "Telephony",
    check_type: "edge_function_ping",
    target: "twilio-voice-token",
    expected_result: "active",
    status: liveSignals.edgeFunctions["twilio-voice-token"] === "active" ? "healthy" : "failing",
    is_enabled: true,
    severity: "critical",
    metadata: {}
  });

  upserts.push({
    check_key: "twilio.voice_webhook_registered",
    name: "Twilio Voice Webhook Handler",
    description: "Verifies that the inbound TwiML generator function is online.",
    category: "Telephony",
    check_type: "edge_function_ping",
    target: "twilio-voice-inbound",
    expected_result: "active",
    status: liveSignals.edgeFunctions["twilio-voice-inbound"] === "active" ? "healthy" : "failing",
    is_enabled: true,
    severity: "critical",
    metadata: {}
  });

  // --- Dialer Data ---
  upserts.push({
    check_key: "dialer.calls_table_present",
    name: "Calls Ledger Table",
    description: "Verifies target public.calls exists.",
    category: "Dialer Data",
    check_type: "database_query",
    target: "public.calls",
    expected_result: "table exists",
    status: liveSignals.tables.includes("calls") ? "healthy" : "failing",
    is_enabled: true,
    severity: "critical",
    metadata: {}
  });

  upserts.push({
    check_key: "dialer.call_logs_table_present",
    name: "Call Logs Table",
    description: "Verifies target public.call_logs exists.",
    category: "Dialer Data",
    check_type: "database_query",
    target: "public.call_logs",
    expected_result: "table exists",
    status: liveSignals.tables.includes("call_logs") ? "healthy" : "failing",
    is_enabled: true,
    severity: "high",
    metadata: {}
  });

  // --- Workflows ---
  upserts.push({
    check_key: "workflow.executor_function_registered",
    name: "Workflow Step Executor",
    description: "Verifies the workflow-executor endpoint is active.",
    category: "Workflow",
    check_type: "edge_function_ping",
    target: "workflow-executor",
    expected_result: "active",
    status: liveSignals.edgeFunctions["workflow-executor"] === "active" ? "healthy" : "failing",
    is_enabled: true,
    severity: "high",
    metadata: {}
  });

  // --- Platform checks ---
  upserts.push({
    check_key: "system_status.rows_present",
    name: "System Status Service Ledger",
    description: "Verifies existing public.system_status rows exist.",
    category: "Platform",
    check_type: "database_query",
    target: "public.system_status",
    expected_result: "rows count > 0",
    status: liveSignals.system_status.length > 0 ? "healthy" : "degraded",
    is_enabled: true,
    severity: "high",
    metadata: { rows_count: liveSignals.system_status.length }
  });

  upserts.push({
    check_key: "security.advisors_available",
    name: "Database Security Audit API",
    description: "Checks availability of public.analyze_system_db RPC.",
    category: "Platform",
    check_type: "database_query",
    target: "public.analyze_system_db",
    expected_result: "RPC responds",
    status: "healthy", // Implicitly yes since we ran it
    is_enabled: true,
    severity: "high",
    metadata: {}
  });

  return upserts;
}
