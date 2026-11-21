import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { PurchaseScope } from "@/lib/phone-number-purchase";

const rowSchema = z.object({
  phone_number_id: z.string().uuid(),
  trust_state: z.enum(["pending", "waiting", "retry", "review", "linked", "inactive"]),
  sms_state: z.enum(["pending", "waiting", "retry", "review", "registering", "ready", "toll_free", "voice_only", "inactive"]),
  can_retry: z.boolean(),
  trust_code: z.string().nullable(),
  sms_code: z.string().nullable(),
});
export type NumberSetupRow = z.infer<typeof rowSchema>;
const rowList = z.array(rowSchema);
const batchSize = 200;

type SetupRpc = {
  rpc(name: "phone_number_setup_status", args: { p_org: string; p_numbers: string[] }): PromiseLike<{ data: unknown; error: unknown }>;
  rpc(name: "phone_number_setup_retry", args: { p_org: string; p_number: string }): PromiseLike<{ data: unknown; error: unknown }>;
};
const api = supabase as unknown as SetupRpc;

export function useNumberSetupStatus(scope: PurchaseScope | null, numbers: ReadonlyArray<{ id: string }>) {
  const client = useQueryClient();
  const ids = [...new Set(numbers.map(number => number.id))].sort();
  const org = scope?.organization_id;
  const actor = scope?.actor_id;
  const queryKey = ["phone-number-setup", actor, org, ids] as const;
  const status = useQuery<Map<string, NumberSetupRow>>({
    queryKey, enabled: !!scope && ids.length > 0, retry: false, staleTime: 0, gcTime: 0,
    refetchInterval: query => {
      if (query.state.error) return 30_000;
      const rows = query.state.data;
      if (!rows?.size) return false;
      const pending = [...rows.values()].some(row => ["pending", "retry", "registering"].includes(row.sms_state)
        || ["pending", "retry"].includes(row.trust_state));
      return pending ? 15_000 : 60_000;
    },
    queryFn: async ({ signal }) => {
      if (!org || !actor) throw new Error("Agency access required.");
      const rows = new Map<string, NumberSetupRow>();
      for (let start = 0; start < ids.length; start += batchSize) {
        if (signal.aborted) throw new Error("Number setup read cancelled.");
        const batch = ids.slice(start, start + batchSize);
        const { data, error } = await api.rpc("phone_number_setup_status", { p_org: org, p_numbers: batch });
        if (error) throw new Error("Setup status unavailable.");
        for (const row of rowList.parse(data)) {
          if (!batch.includes(row.phone_number_id) || rows.has(row.phone_number_id)) throw new Error("Unexpected setup status.");
          rows.set(row.phone_number_id, row);
        }
      }
      return rows;
    },
  });
  const rows = scope && !status.isError ? status.data : undefined;
  const retry = useMutation({
    mutationFn: async (variables: { org: string; actor: string; id: string }) => {
      const { data, error } = await api.rpc("phone_number_setup_retry", { p_org: variables.org, p_number: variables.id });
      if (error || typeof data !== "boolean") throw new Error("Setup retry unavailable.");
      return data;
    },
    onSuccess: (_result, variables) => client.invalidateQueries({ queryKey: ["phone-number-setup", variables.actor, variables.org] }),
  });
  const retryInScope = !!scope && retry.variables?.org === org && retry.variables?.actor === actor;
  return {
    rows, readFailed: !!scope && status.isError,
    refresh: () => scope && ids.length ? status.refetch() : undefined,
    retry: (id: string) => {
      const row = rows?.get(id);
      if (scope && row?.can_retry && !retry.isPending) {
        retry.mutate({ id, org: scope.organization_id, actor: scope.actor_id });
      }
    },
    retrying: retryInScope && retry.isPending ? retry.variables.id : null,
    retryError: retryInScope && retry.isError ? retry.variables.id : null,
    retryQueued: retryInScope && retry.isSuccess && retry.data === true ? retry.variables.id : null,
  };
}
