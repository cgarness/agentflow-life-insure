import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";

export interface ClosingAppointmentCandidate { id: string; startTime: string; title: string; type: string }

/**
 * Held (Completed) Sales Appointments of the buyer in the 30 days up to the Sold Date, read under the appointments RLS
 * (D4 §4). Only types classified `sales` qualify. Nothing is requested under View As, without identity or a Sold Date.
 */
export function useClosingAppointmentCandidates(contactIds: Array<string | null | undefined>, soldDate: string | null | undefined) {
  const { user, isImpersonating } = useAuth();
  const { organizationId } = useOrganization();
  const ids = [...new Set(contactIds.filter((id): id is string => !!id))].sort();
  const day = soldDate && /^\d{4}-\d{2}-\d{2}$/.test(soldDate) ? soldDate : null;
  const enabled = !!user?.id && !!organizationId && !isImpersonating && ids.length > 0 && !!day;
  return useQuery<ClosingAppointmentCandidate[]>({
    queryKey: ["closing-appointment-candidates", organizationId, ids.join(","), day],
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const types = await (supabase as any).from("appointment_types").select("name")
        .eq("organization_id", organizationId).eq("business_category", "sales").abortSignal(signal);
      if (types.error) throw new Error(types.error.message);
      const salesTypes = (types.data ?? []).map((t: { name: string }) => t.name);
      if (salesTypes.length === 0) return [];
      const from = new Date(`${day}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 31);
      const until = new Date(`${day}T00:00:00Z`); until.setUTCDate(until.getUTCDate() + 1);
      const { data, error } = await (supabase as any).from("appointments").select("id,start_time,title,type")
        .eq("organization_id", organizationId).in("contact_id", ids).eq("status", "Completed").in("type", salesTypes)
        .gte("start_time", from.toISOString()).lt("start_time", until.toISOString())
        .order("start_time", { ascending: false }).limit(20).abortSignal(signal);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: { id: string; start_time: string; title: string | null; type: string }) =>
        ({ id: r.id, startTime: r.start_time, title: r.title ?? "Appointment", type: r.type }));
    },
  });
}
