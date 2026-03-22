import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type CalAppointmentType = "Sales Call" | "Follow Up" | "Recruit Interview" | "Policy Review" | "Policy Anniversary" | "Other";
export type CalAppointmentStatus = "Scheduled" | "Confirmed" | "Completed" | "Cancelled" | "No Show";

export interface CalendarAppointment {
  id: string;
  title: string;
  type: CalAppointmentType;
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
}

const VALID_TYPES: CalAppointmentType[] = [
  "Sales Call", "Follow Up", "Recruit Interview", "Policy Review", "Policy Anniversary", "Other"
];

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

export const APPOINTMENT_TYPE_COLORS: Record<CalAppointmentType, string> = {
  "Sales Call": "#3B82F6",
  "Follow Up": "#22C55E",
  "Recruit Interview": "#A855F7",
  "Policy Review": "#F97316",
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

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 12);

function makeDate(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

const initialAppointments: CalendarAppointment[] = [
  { id: uid(), title: "Call with James Morrison", type: "Sales Call", status: "Scheduled", date: makeDate(0), startTime: "10:00 AM", endTime: "10:30 AM", contactName: "James Morrison", contactId: "l1", agent: "Chris Garcia", notes: "Interested in Term Life" },
  { id: uid(), title: "Follow Up — Sarah Chen", type: "Follow Up", status: "Confirmed", date: makeDate(0), startTime: "2:00 PM", endTime: "2:30 PM", contactName: "Sarah Chen", contactId: "l2", agent: "Chris Garcia", notes: "Called back as requested" },
  { id: uid(), title: "Interview — Marcus Webb", type: "Recruit Interview", status: "Scheduled", date: makeDate(1), startTime: "11:00 AM", endTime: "12:00 PM", contactName: "Marcus Webb", contactId: "l3", agent: "Chris Garcia", notes: "Potential team lead candidate" },
  { id: uid(), title: "Policy Review — Linda Park", type: "Policy Review", status: "Scheduled", date: makeDate(3), startTime: "3:00 PM", endTime: "3:30 PM", contactName: "Linda Park", contactId: "l4", agent: "Chris Garcia", notes: "" },
  { id: uid(), title: "Anniversary — Robert Ellis", type: "Policy Anniversary", status: "Scheduled", date: makeDate(5), startTime: "9:00 AM", endTime: "9:30 AM", contactName: "Robert Ellis", contactId: "l5", agent: "Chris Garcia", notes: "Auto-generated: 3-year anniversary" },
  { id: uid(), title: "Call with Diana Ross", type: "Sales Call", status: "Completed", date: makeDate(-1), startTime: "1:00 PM", endTime: "1:30 PM", contactName: "Diana Ross", contactId: "l6", agent: "Chris Garcia", notes: "" },
];

interface CalendarContextValue {
  appointments: CalendarAppointment[];
  loading: boolean;
  addAppointment: (a: any) => Promise<void>;
  updateAppointment: (id: string, data: any) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;
  fetchAppointments: () => Promise<void>;
  todayCount: number;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export const useCalendar = () => {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be inside CalendarProvider");
  return ctx;
};

export const CalendarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);

  const mapAppointment = useCallback((appt: any): CalendarAppointment => {
    const startDate = new Date(appt.start_time);
    const endDate = appt.end_time ? new Date(appt.end_time) : startDate;

    return {
      id: appt.id,
      title: appt.title,
      type: VALID_TYPES.includes(appt.type) ? appt.type : "Other",
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
    };
  }, []);

  const fetchAppointments = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    
    // Fetch a broad range: 30 days ago to 90 days in future
    const startRange = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endRange = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_time', startRange)
      .lte('start_time', endRange)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching appointments:', error);
    } else if (data) {
      setAppointments(data.map(mapAppointment));
    }
    setLoading(false);
  }, [user?.id, mapAppointment]);

  useEffect(() => {
    fetchAppointments();

    if (!user?.id) return;

    // Realtime subscription
    const channel = supabase
      .channel('calendar_appointments_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setAppointments(prev => [...prev, mapAppointment(payload.new)].sort((a, b) => 
               new Date(a.date).getTime() - new Date(b.date).getTime()
            ));
          } else if (payload.eventType === 'UPDATE') {
            setAppointments(prev => prev.map(a => a.id === payload.new.id ? mapAppointment(payload.new) : a));
          } else if (payload.eventType === 'DELETE') {
            setAppointments(prev => prev.filter(a => a.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchAppointments, mapAppointment]);

  const addAppointment = useCallback(async (a: any) => {
    if (!user?.id) return;
    const { error } = await supabase.from('appointments').insert([{ ...a, user_id: user.id }]);
    if (error) {
      console.error('Error adding appointment:', error);
      throw error;
    }
  }, [user?.id]);

  const updateAppointment = useCallback(async (id: string, data: any) => {
    const { error } = await supabase.from('appointments').update(data).eq('id', id);
    if (error) {
      console.error('Error updating appointment:', error);
      throw error;
    }
  }, []);

  const deleteAppointment = useCallback(async (id: string) => {
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) {
      console.error('Error deleting appointment:', error);
      throw error;
    }
  }, []);

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
