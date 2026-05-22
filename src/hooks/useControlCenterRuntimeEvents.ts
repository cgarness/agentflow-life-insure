import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsPlatformAdmin } from "@/hooks/useIsPlatformAdmin";
import type { ControlCenterRuntimeEvent } from "@/lib/control-center/types";
import type { RuntimeEventStatus } from "@/lib/control-center/constants";

const TABLE = "control_center_runtime_events";
const QUERY_KEY = ["control-center", "runtime-events"] as const;

export function useControlCenterRuntimeEvents() {
  const isPlatformAdmin = useIsPlatformAdmin();

  return useQuery({
    queryKey: QUERY_KEY,
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<ControlCenterRuntimeEvent[]> => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .select("*")
        .order("last_seen_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as ControlCenterRuntimeEvent[];
    },
  });
}

export function useUpdateRuntimeEventStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; status: RuntimeEventStatus }) => {
      const { data, error } = await supabase
        .from(TABLE as never)
        .update({ status: args.status } as never)
        .eq("id", args.id)
        .select("*")
        .maybeSingle();

      if (error) throw error;
      return data as unknown as ControlCenterRuntimeEvent | null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
