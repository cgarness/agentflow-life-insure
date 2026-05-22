import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";
import type { IssueFormValues } from "@/lib/control-center/issueSchema";
import type { ControlCenterIssue } from "@/lib/control-center/types";

const TABLE = "control_center_issues";
const QUERY_KEY = ["control-center", "issues"] as const;

function emptyToNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function nullableUuid(v: string | undefined | null): string | null {
  if (!v) return null;
  return v;
}

function toInsert(values: IssueFormValues, reportedBy: string | null) {
  const resolved = values.status === "resolved";
  return {
    title: values.title.trim(),
    description: emptyToNull(values.description),
    severity: values.severity,
    status: values.status,
    source: values.source,
    feature_id: nullableUuid(values.feature_id ?? null),
    reported_by: reportedBy,
    resolution_notes: emptyToNull(values.resolution_notes),
    resolved_at: resolved ? new Date().toISOString() : null,
  };
}

function toUpdate(values: IssueFormValues) {
  const resolved = values.status === "resolved";
  return {
    title: values.title.trim(),
    description: emptyToNull(values.description),
    severity: values.severity,
    status: values.status,
    source: values.source,
    feature_id: nullableUuid(values.feature_id ?? null),
    resolution_notes: emptyToNull(values.resolution_notes),
    resolved_at: resolved ? new Date().toISOString() : null,
  };
}

export function useControlCenterIssues() {
  const isPlatformAdmin = useIsPlatformAdmin();
  return useQuery({
    queryKey: QUERY_KEY,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<ControlCenterIssue[]> => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .select("*")
        .order("severity", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ControlCenterIssue[];
    },
  });
}

export function useCreateControlCenterIssue() {
  const qc = useQueryClient();
  const { realProfile } = useAuth();
  return useMutation({
    mutationFn: async (values: IssueFormValues) => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .insert(toInsert(values, realProfile?.id ?? null) as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ControlCenterIssue | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useUpdateControlCenterIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; values: IssueFormValues }) => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .update(toUpdate(args.values) as never)
        .eq("id", args.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ControlCenterIssue | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteControlCenterIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
