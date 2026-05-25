import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { AppointmentTypeRecord } from "@/lib/calendar/appointmentTypes";

type Row = {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  duration_minutes: number;
  sort_order: number;
  is_default: boolean;
  is_locked: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function mapRow(row: Row): AppointmentTypeRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
    durationMinutes: row.duration_minutes,
    sortOrder: row.sort_order,
    isDefault: row.is_default,
    isLocked: row.is_locked,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface UseAppointmentTypesOptions {
  includeInactive?: boolean;
}

interface UseAppointmentTypesResult {
  types: AppointmentTypeRecord[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAppointmentTypes(options: UseAppointmentTypesOptions = {}): UseAppointmentTypesResult {
  const { includeInactive = false } = options;
  const { organizationId } = useOrganization();
  const [types, setTypes] = useState<AppointmentTypeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setTypes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let query = supabase
      .from("appointment_types")
      .select("*")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (!includeInactive) {
      query = query.eq("is_active", true);
    }
    const { data, error: err } = await query;
    if (err) {
      setError(err.message || "Failed to load appointment types");
      setTypes([]);
    } else if (data) {
      setTypes((data as Row[]).map(mapRow));
    }
    setLoading(false);
  }, [organizationId, includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  return { types, loading, error, reload: load };
}
