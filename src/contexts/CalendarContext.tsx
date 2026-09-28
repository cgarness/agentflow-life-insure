import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { buildAppointmentInsertOwnership } from "@/lib/calendar/appointmentOwnership";

// Known launch defaults. Kept as a compatibility alias — appointment.type is
// stored as text and may be a custom org-defined value. Use the shared
// helpers in src/lib/calendar/appointmentTypes.ts for colors/durations/etc.
export type CalAppointmentType = "Sales Call" | "Follow Up" | "Recruit Interview" | "Policy Review" | "Policy Anniversary" | "Other";
export type CalAppointmentStatus = "Scheduled" | "Confirmed" | "Completed" | "Cancelled" | "No Show";

export interface CalendarAppointment {
  id: string;
  title: string;
  type: string;
  status: CalAppointmentStatus;
  date: Date;
  startTime: string;
  endTime: string;
  contactName: string;
  contactId: string;
  agent: string;
  notes: string;
  start_time?: string; // Original ISO string from DB
  end_time?: string;   // Original ISO string from DB
  /** Responsible person (reminder recipient). */
  user_id?: string;
  /** Scheduler. Needed for the invariant-#22 fallback when user_id is NULL. */
  created_by?: string | null;
  /** Status exactly as stored. `status` above is coerced for display; reminder gating reads this. */
  raw_status?: string;
}

const VALID_STATUSES: CalAppointmentStatus[] = [
  "Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Compatibility export — preserved for any code still importing it. Live
// rendering should use getAppointmentTypeColor() from
// src/lib/calendar/appointmentTypes.ts so custom org types resolve correctly.
export const APPOINTMENT_TYPE_COLORS: Record<CalAppointmentType, string> = {
  "Sales Call": "#3B82F6",
  "Follow Up": "#F97316",
  "Recruit Interview": "#A855F7",
  "Policy Review": "#22C55E",
  "Policy Anniversary": "#EC4899",
  "Other": "#64748B",
};

export const APPOINTMENT_STATUS_COLORS: Record<CalAppointmentStatus, string> = {
  Scheduled: "#3B82F6",
  Confirmed: "#22C55E",
  Completed: "#64748B",
  Cancelled: "#EF4444",
  "No Show": "#F97316",
};


export interface FetchAppointmentsOptions {
  /** Background refresh: never toggles `loading`, and is skipped while any fetch is in flight. */
  silent?: boolean;
}

interface CalendarContextValue {
  appointments: CalendarAppointment[];
  loading: boolean;
  addAppointment: (a: any) => Promise<any>;
  updateAppointment: (id: string, data: any) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;
  fetchAppointments: (opts?: FetchAppointmentsOptions) => Promise<void>;
  todayCount: number;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export const useCalendar = () => {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be inside CalendarProvider");
  return ctx;
};

export const CalendarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, realProfile } = useAuth();
  /**
   * REAL operational identity only — stated precisely, because the four operations below are not
   * scoped the same way:
   *
   *   - The organization context is pinned to `realProfile.organization_id`, never to
   *     `useOrganization().organizationId`, which derives from the effective ("View As") profile.
   *   - The initial appointment fetch is ORGANIZATION-scoped: every row in that organization
   *     inside the ±180-day window that the database policies return to this session. It is not
   *     filtered by `user.id` client-side. (The realtime channel, by contrast, is filtered to
   *     `user_id = user.id`.)
   *   - Creation stamps this organization and `created_by` = the REAL `user.id` (the scheduler).
   *     `user_id` (the responsible person / reminder recipient) is the caller's explicit assignee when
   *     supplied, else the REAL `user.id` — an explicit assignee is never overwritten.
   *   - Update and delete are constrained by appointment id PLUS this organization, and remain
   *     subject to the database policies — the `organization_id` filter is a tenant boundary in
   *     the query, not an ownership check.
   *
   * Under "View As" the effective profile never reaches any of this. Activation currently confines
   * targets to the operator's own organization, so the two organization values coincide today;
   * this pins the IDENTITY, not the coincidence. While `organizationId` is null (real profile still
   * loading, or loaded with no organization) the four operations do NOT all behave alike: `fetchAppointments` settles `loading`
   * and returns without a query, whereas `addAppointment`, `updateAppointment` and
   * `deleteAppointment` THROW ("missing user or organization context") rather than write; the
   * realtime subscription is keyed on `user.id` alone and does not consult the organization.
   * (`appointments` is NOT in the `supabase_realtime` publication, so that subscription never
   * delivers; freshness comes from `fetchAppointments`, including ReminderPopup's silent refresh.)
   */
  const organizationId = realProfile?.organization_id ?? null;
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  // Newest fetch wins; a fetch that started before a local write is discarded and re-issued, so a
  // pre-write snapshot can never drop an added row, restore a deleted one, or revert an edit.
  const fetchGenRef = useRef(0);
  const writeSeqRef = useRef(0);
  const inFlightRef = useRef(0);
  const fetchRef = useRef<((opts?: FetchAppointmentsOptions) => Promise<void>) | null>(null);

  const mapAppointment = useCallback((appt: any): CalendarAppointment => {
    const startDate = new Date(appt.start_time);
    const endDate = appt.end_time ? new Date(appt.end_time) : startDate;

    const rawType = typeof appt.type === "string" ? appt.type.trim() : "";

    return {
      id: appt.id,
      title: appt.title,
      type: rawType.length > 0 ? rawType : "Other",
      status: VALID_STATUSES.includes(appt.status) ? appt.status : "Scheduled",
      date: new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()),
      startTime: formatTime(startDate),
      endTime: formatTime(endDate),
      contactName: appt.contact_name || "",
      contactId: appt.contact_id || "",
      agent: appt.agent_id || "",
      notes: appt.notes || "",
      start_time: appt.start_time,
      end_time: appt.end_time,
      user_id: appt.user_id,
      created_by: appt.created_by ?? null,
      raw_status:
        typeof appt.raw_status === "string" ? appt.raw_status : typeof appt.status === "string" ? appt.status : "",
    };
  }, []);

  const fetchAppointments = useCallback(async (opts?: FetchAppointmentsOptions) => {
    const silent = opts?.silent === true;
    if (!user?.id || !organizationId) {
      if (!silent) setLoading(false);
      return;
    }
    if (silent && inFlightRef.current > 0) return;

    const gen = ++fetchGenRef.current;
    const writeSeqAtStart = writeSeqRef.current;
    inFlightRef.current += 1;
    if (!silent) setLoading(true);
    let reissue = false;

    try {
      // Fetch a broad range: 180 days ago to 180 days in future
      const startRange = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
      const endRange = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('start_time', startRange)
        .lte('start_time', endRange)
        .order('start_time', { ascending: true });

      if (error) {
        // A failed refresh keeps the current list.
        console.error('Error fetching appointments:', error);
      } else if (data && gen === fetchGenRef.current) {
        if (writeSeqRef.current !== writeSeqAtStart) reissue = true;
        else setAppointments(data.map(mapAppointment));
      }
    } finally {
      inFlightRef.current -= 1;
      // A non-silent call always clears its spinner, even when its data was superseded.
      if (!silent) setLoading(false);
    }

    if (reissue) void fetchRef.current?.({ silent: true });
  }, [user?.id, organizationId, mapAppointment]);
  fetchRef.current = fetchAppointments;

  const addAppointment = useCallback(async (a: any) => {
    if (!user?.id || !organizationId) {
      throw new Error("Cannot save appointment: missing user or organization context");
    }
    
    // No optimistic insert: the row id comes from the DB. The caller's object is passed through
    // untouched (no camelCase→column mapping); only the ownership columns are stamped, and an
    // explicit `user_id` (the assignee) is preserved.
    const { data, error } = await supabase
      .from('appointments')
      .insert([{
        ...a,
        ...buildAppointmentInsertOwnership({
          explicitAssigneeId: a?.user_id,
          creatorUserId: user.id,
          organizationId,
        }),
      }] as any)
      .select()
      .single();

    if (error) {
      console.error('Error adding appointment:', error);
      throw error;
    }
    
    if (data) {
      const mapped = mapAppointment(data);
      writeSeqRef.current += 1;
      setAppointments(prev => [...prev, mapped].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      ));
    }
    return data;
  }, [user?.id, organizationId, mapAppointment]);

  const updateAppointment = useCallback(async (id: string, data: any) => {
    if (!user?.id || !organizationId) throw new Error("Cannot update appointment: missing user or organization context");
    // Optimistic update
    writeSeqRef.current += 1;
    setAppointments(prev => prev.map(a => {
      if (a.id !== id) return a;
      const raw_status = typeof data?.status === "string" ? data.status : a.raw_status;
      return { ...a, ...data, ...mapAppointment({ ...a, ...data, raw_status }) };
    }));

    // `.select("id")`: an update RLS hides affects zero rows WITHOUT an error. Treat that as a failure
    // so the UI never reports a save or reassignment that did not happen.
    const { data: updated, error } = await supabase
      .from('appointments')
      .update(data)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('id');
    const failure = error ?? (!updated || updated.length === 0
      ? new Error("Appointment update was not applied (not found or not permitted)")
      : null);
    if (failure) {
      console.error('Error updating appointment:', failure);
      void fetchAppointments({ silent: true });
      throw failure;
    }
  }, [fetchAppointments, mapAppointment, organizationId, user?.id]);

  const deleteAppointment = useCallback(async (id: string) => {
    if (!user?.id || !organizationId) throw new Error("Cannot delete appointment: missing user or organization context");
    // Optimistic update
    writeSeqRef.current += 1;
    setAppointments(prev => prev.filter(a => a.id !== id));

    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId);
    if (error) {
      console.error('Error deleting appointment:', error);
      void fetchAppointments({ silent: true });
      throw error;
    }
  }, [fetchAppointments, organizationId, user?.id]);

  useEffect(() => {
    fetchAppointments();

    if (!user?.id) return;

    // Realtime subscription with unique channel name
    const channel = supabase
      .channel(`calendar_appointments_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('Calendar realtime payload:', payload);
          if (payload.eventType === 'INSERT') {
            const mapped = mapAppointment(payload.new);
            setAppointments(prev => {
              // Check if already exists (e.g. from optimistic update)
              if (prev.some(a => a.id === mapped.id)) return prev;
              return [...prev, mapped].sort((a, b) => 
                new Date(a.date).getTime() - new Date(b.date).getTime()
              );
            });
          } else if (payload.eventType === 'UPDATE') {
            const mapped = mapAppointment(payload.new);
            setAppointments(prev => prev.map(a => a.id === mapped.id ? mapped : a));
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            if (deletedId) {
                setAppointments(prev => prev.filter(a => a.id !== deletedId));
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('Calendar realtime channel error');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, organizationId, fetchAppointments, mapAppointment]);


  const todayCount = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
    
    return appointments.filter(a => {
      const d = new Date(a.date).getTime();
      return d >= startOfDay && d < endOfDay;
    }).length;
  }, [appointments]);

  return (
    <CalendarContext.Provider value={{ 
      appointments, 
      loading, 
      addAppointment, 
      updateAppointment, 
      deleteAppointment, 
      fetchAppointments,
      todayCount 
    }}>
      {children}
    </CalendarContext.Provider>
  );
};
