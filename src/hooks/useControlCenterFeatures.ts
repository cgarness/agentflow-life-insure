import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";
import type { FeatureFormValues } from "@/lib/control-center/featureSchema";
import type { ControlCenterFeature } from "@/lib/control-center/types";

const TABLE = "control_center_features";
const QUERY_KEY = ["control-center", "features"] as const;

function emptyToNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function toInsert(values: FeatureFormValues) {
  return {
    feature_key: values.feature_key.trim(),
    name: values.name.trim(),
    category: values.category.trim(),
    description: emptyToNull(values.description),
    status: values.status,
    priority: values.priority,
    owner: emptyToNull(values.owner),
    is_customer_visible: values.is_customer_visible,
    is_internal_only: values.is_internal_only,
    is_blocked: values.is_blocked,
    blocked_reason: values.is_blocked ? emptyToNull(values.blocked_reason) : null,
  };
}

export function useControlCenterFeatures() {
  const isPlatformAdmin = useIsPlatformAdmin();

  return useQuery({
    queryKey: QUERY_KEY,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<ControlCenterFeature[]> => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .select("*")
        .order("priority", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ControlCenterFeature[];
    },
  });
}

export function useCreateControlCenterFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: FeatureFormValues) => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .insert(toInsert(values) as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ControlCenterFeature | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useUpdateControlCenterFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; values: FeatureFormValues }) => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .update(toInsert(args.values) as never)
        .eq("id", args.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ControlCenterFeature | null;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteControlCenterFeature() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
