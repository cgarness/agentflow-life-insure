import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";
import type { HealthCheckFormValues } from "@/lib/control-center/healthCheckSchema";
import type {
  ControlCenterHealthCheck,
  ControlCenterHealthCheckRun,
} from "@/lib/control-center/types";

const TABLE = "control_center_health_checks";
const RUNS_TABLE = "control_center_health_check_runs";
const QUERY_KEY = ["control-center", "health-checks"] as const;
const RUNS_QUERY_KEY = ["control-center", "health-check-runs"] as const;

function emptyToNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function toUpsert(values: HealthCheckFormValues) {
  return {
    check_key: values.check_key.trim(),
    name: values.name.trim(),
    category: values.category.trim(),
    check_type: values.check_type,
    description: emptyToNull(values.description),
    target: emptyToNull(values.target),
    expected_result: emptyToNull(values.expected_result),
    status: values.status,
    severity: values.severity,
    is_enabled: values.is_enabled,
  };
}

export function useControlCenterHealthChecks() {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: QUERY_KEY,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<ControlCenterHealthCheck[]> => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .select("*")
        .order("category", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ControlCenterHealthCheck[];
    },
  });
}

export function useCreateControlCenterHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: HealthCheckFormValues) => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .insert(toUpsert(values) as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ControlCenterHealthCheck | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useUpdateControlCenterHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; values: HealthCheckFormValues }) => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .update(toUpsert(args.values) as never)
        .eq("id", args.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ControlCenterHealthCheck | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteControlCenterHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
    },
  });
}

/**
 * v1 stub: records a manual "run" without performing any live probe.
 * Only updates is_enabled === true checks. Leaves health status set to
 * 'unknown' so the UI clearly conveys "no live probe wired yet."
 */
export function useRunAllHealthChecks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (checks: ControlCenterHealthCheck[]) => {
      const enabled = checks.filter((c) => c.is_enabled);
      if (enabled.length === 0) return { ran: 0 };

      const now = new Date().toISOString();
      const runs = enabled.map((c) => ({
        health_check_id: c.id,
        status: "unknown",
        started_at: now,
        finished_at: now,
        duration_ms: 0,
        result_summary: "Manual run (v1 stub — no live probe wired yet)",
        metadata: { stub: true } as Record<string, unknown>,
      }));

      const { error: runsError } = await supabase
        .from(RUNS_TABLE as never)
        .insert(runs as never);
      if (runsError) throw runsError;

      const { error: updateError } = await supabase
        .from(TABLE as never)
        .update({ last_run_at: now, status: "unknown" } as never)
        .in(
          "id",
          enabled.map((c) => c.id),
        );
      if (updateError) throw updateError;

      return { ran: enabled.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
    },
  });
}

export function useRecentHealthCheckRuns(limit = 25) {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: [...RUNS_QUERY_KEY, limit],
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<ControlCenterHealthCheckRun[]> => {
      const { data, error } = await supabase
        .from(RUNS_TABLE as never)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as ControlCenterHealthCheckRun[];
    },
  });
}
