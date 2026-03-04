import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

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
  addAppointment: (a: Omit<CalendarAppointment, "id">) => void;
  updateAppointment: (id: string, data: Partial<CalendarAppointment>) => void;
  deleteAppointment: (id: string) => void;
  todayCount: number;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export const useCalendar = () => {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar must be inside CalendarProvider");
  return ctx;
};

export const CalendarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [appointments, setAppointments] = useState<CalendarAppointment[]>(initialAppointments);

  const addAppointment = useCallback((a: Omit<CalendarAppointment, "id">) => {
    setAppointments(prev => [...prev, { ...a, id: uid() }]);
  }, []);

  const updateAppointment = useCallback((id: string, data: Partial<CalendarAppointment>) => {
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, ...data } : a));
  }, []);

  const deleteAppointment = useCallback((id: string) => {
    setAppointments(prev => prev.filter(a => a.id !== id));
  }, []);

  const todayCount = useMemo(() => {
    const now = new Date();
    return appointments.filter(a => {
      const d = new Date(a.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }).length;
  }, [appointments]);

  return (
    <CalendarContext.Provider value={{ appointments, addAppointment, updateAppointment, deleteAppointment, todayCount }}>
      {children}
    </CalendarContext.Provider>
  );
};
