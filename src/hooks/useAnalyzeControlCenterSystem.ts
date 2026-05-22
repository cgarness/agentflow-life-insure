import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { systemInventoryManifest } from "@/lib/control-center/systemInventoryManifest";
import {
  buildFeatureUpserts,
  buildIssueUpserts,
  buildHealthCheckUpserts,
  type LiveSignals
} from "@/lib/control-center/analyzeSystem";

export function useAnalyzeControlCenterSystem() {
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const runSystemAudit = async () => {
    setScanning(true);
    try {
      // 1. Fetch DB signals via analyze_system_db RPC
      const { data: dbSignalsRaw, error: dbErr } = await supabase.rpc("analyze_system_db");
      if (dbErr) throw dbErr;

      const dbSignals = dbSignalsRaw as any;

      // 2. Scan Edge Functions via OPTIONS pings
      const uniqueEdgeFns = Array.from(
        new Set(
          systemInventoryManifest.flatMap((f) => f.expected_edge_functions || [])
        )
      ).filter(Boolean);

      const edgeFunctionState: Record<string, "active" | "missing"> = {};

      await Promise.all(
        uniqueEdgeFns.map(async (fnName) => {
          try {
            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`,
              { method: "OPTIONS" }
            );
            if (response.status === 404) {
              edgeFunctionState[fnName] = "missing";
            } else {
              edgeFunctionState[fnName] = "active";
            }
          } catch (err) {
            edgeFunctionState[fnName] = "active";
          }
        })
      );

      // Assemble signals
      const liveSignals: LiveSignals = {
        tables: dbSignals.tables || [],
        rls_disabled: dbSignals.rls_disabled || [],
        rls_no_policy: dbSignals.rls_no_policy || [],
        rls_always_true: dbSignals.rls_always_true || [],
        sec_def_public: dbSignals.sec_def_public || [],
        sec_def_authenticated: dbSignals.sec_def_authenticated || [],
        mutable_search_path: dbSignals.mutable_search_path || [],
        public_buckets: dbSignals.public_buckets || [],
        public_extensions: dbSignals.public_extensions || [],
        system_status: dbSignals.system_status || [],
        edgeFunctions: edgeFunctionState
      };

      // 3. Compile Upsert Payload Structures
      const featureUpserts = buildFeatureUpserts(systemInventoryManifest, liveSignals);
      const issueUpserts = buildIssueUpserts(liveSignals);
      const healthCheckUpserts = buildHealthCheckUpserts(systemInventoryManifest, liveSignals);

      // 4. Upsert Features
      const { error: featErr } = await supabase
        .from("control_center_features")
        .upsert(featureUpserts, { onConflict: "feature_key" });
      if (featErr) throw featErr;

      // 5. Fetch existing issues to preserve manual overrides (resolved, ignored) and first_seen_at
      const { data: existingIssues } = await supabase
        .from("control_center_issues")
        .select("issue_key, status, first_seen_at");

      const nowStr = new Date().toISOString();
      const mappedIssuesPayload = issueUpserts.map((issue) => {
        const existing = existingIssues?.find((ei) => ei.issue_key === issue.issue_key);
        
        // Preserve resolved/ignored statuses
        const status = (existing?.status === "resolved" || existing?.status === "ignored")
          ? existing.status
          : issue.status;

        // Preserve first_seen_at, set last_seen_at
        const first_seen_at = existing?.first_seen_at || nowStr;
        const last_seen_at = nowStr;

        return {
          ...issue,
          status,
          first_seen_at,
          last_seen_at
        };
      });

      // 6. Upsert Issues
      const { error: issueErr } = await supabase
        .from("control_center_issues")
        .upsert(mappedIssuesPayload as any, { onConflict: "issue_key" });
      if (issueErr) throw issueErr;

      // Auto-resolve previously open/active issues that are no longer detected in this audit run
      const undetectedActiveKeys = (existingIssues || [])
        .filter((ei) => ei.status !== "resolved" && ei.status !== "ignored")
        .filter((ei) => !issueUpserts.some((ui) => ui.issue_key === ei.issue_key))
        .map((ei) => ei.issue_key);

      if (undetectedActiveKeys.length > 0) {
        const { error: resolveErr } = await supabase
          .from("control_center_issues")
          .update({ status: "resolved", last_seen_at: nowStr })
          .in("issue_key", undetectedActiveKeys);
        if (resolveErr) throw resolveErr;
      }

      // 7. Fetch existing Checks to preserve manual overrides and calculate failure counts
      const { data: existingChecks } = await supabase
        .from("control_center_health_checks")
        .select("check_key, failure_count, is_enabled, last_success_at, last_failure_at");

      const mappedChecksPayload = healthCheckUpserts.map((hc) => {
        const existing = existingChecks?.find((ec) => ec.check_key === hc.check_key);
        const isCurrentlyEnabled = existing ? existing.is_enabled : hc.is_enabled;

        let failure_count = existing?.failure_count || 0;
        let last_error: string | null = null;
        let last_success_at: string | null = existing?.last_success_at || null;
        let last_failure_at: string | null = existing?.last_failure_at || null;

        if (hc.status === "healthy") {
          failure_count = 0;
          last_success_at = nowStr;
        } else {
          failure_count += 1;
          last_failure_at = nowStr;
          last_error = hc.metadata?.finding || `Check failed status: ${hc.status}`;
        }

        return {
          ...hc,
          is_enabled: isCurrentlyEnabled,
          last_run_at: nowStr,
          last_success_at,
          last_failure_at,
          failure_count,
          last_error
        };
      });

      const { data: upsertedChecks, error: checkErr } = await supabase
        .from("control_center_health_checks")
        .upsert(mappedChecksPayload as any, { onConflict: "check_key" })
        .select();
      if (checkErr) throw checkErr;

      // 8. Write run history logs for each check
      if (upsertedChecks && upsertedChecks.length > 0) {
        const runInserts = upsertedChecks.map((uc) => {
          return {
            health_check_id: uc.id,
            status: uc.status,
            started_at: nowStr,
            finished_at: nowStr,
            duration_ms: 0,
            error_message: uc.last_error,
            result_summary: `Audited target [${uc.target}]. Result: ${uc.status}`,
            metadata: uc.metadata || {}
          };
        });

        const { error: runErr } = await supabase
          .from("control_center_health_check_runs")
          .insert(runInserts as any);
        if (runErr) throw runErr;
      }

      toast.success("System audit completed and inventories updated.");
      
      // Invalidate queries to refresh lists
      queryClient.invalidateQueries({ queryKey: ["control-center"] });
    } catch (err: any) {
      toast.error(err.message || "Audit failed");
    } finally {
      setScanning(false);
    }
  };

  return { scanning, runSystemAudit };
}
