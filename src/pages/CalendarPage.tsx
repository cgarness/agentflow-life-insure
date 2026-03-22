import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Search, 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  Phone,
  MessageSquare,
  Mail,
  ChevronDown,
  RefreshCw,
  LayoutGrid,
  Columns3,
  Rows3,
  List as ListIcon
} from "lucide-react";
import {
  CalendarAppointment,
  CalAppointmentStatus, 
  CalAppointmentType, 
  APPOINTMENT_TYPE_COLORS, 
  APPOINTMENT_STATUS_COLORS,
  useCalendar
} from "@/contexts/CalendarContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import AppointmentModal from "@/components/calendar/AppointmentModal";
import ContactModal from "@/components/contacts/ContactModal";
import { Lead } from "@/lib/types";
import { useBranding } from "@/contexts/BrandingContext";


// Helper functions from original
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const timeStringToDate = (baseDate: Date, time: string) => {
  const date = new Date(baseDate);
  const parts = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!parts) return date;

  let hours = parseInt(parts[1]);
  const minutes = parseInt(parts[2]);
  const ampm = parts[3].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  date.setHours(hours, minutes, 0, 0);
  return date;
};

type ViewType = "Month" | "Week" | "Day" | "List";

const VALID_TYPES: CalAppointmentType[] = ["Sales Call", "Follow Up", "Recruit Interview", "Policy Review", "Policy Anniversary", "Other"];
const VALID_STATUSES: CalAppointmentStatus[] = ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"];

type AppointmentSyncMeta = {
  externalEventId: string | null;
  syncSource: string;
  externalProvider: string | null;
};

const CalendarPage: React.FC = () => {
  const { user } = useAuth();
  const { 
    appointments, 
    loading, 
    addAppointment, 
    updateAppointment, 
    deleteAppointment,
    fetchAppointments 
  } = useCalendar();

  // --- Design State ---
  const [appointmentMetaById, setAppointmentMetaById] = useState<Record<string, AppointmentSyncMeta>>({});
  const [currentDate, setCurrentDate] = useState(new Date());
  const { formatDate, formatDateTime, formatTime } = useBranding();

  const [googleConnected, setGoogleConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalEditing, setModalEditing] = useState<CalendarAppointment | null>(null);
  const [modalDefaultDate, setModalDefaultDate] = useState<Date | undefined>(undefined);
  const [modalDefaultTime, setModalDefaultTime] = useState<string | undefined>(undefined);
  const [contactModalLead, setContactModalLead] = useState<Lead | null>(null);

  // Contact search state
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<Array<{ id: string; name: string; phone: string; email: string }>>([]);
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string; phone: string; email: string } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");

  // New Design State
  const [searchParams, setSearchParams] = useSearchParams();
  const currentView = (searchParams.get("view") as ViewType) || "Month";
  const setCurrentView = (view: ViewType) => {
    setSearchParams({ view });
  };
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const views: { name: ViewType; icon: any }[] = [
    { name: "Month", icon: LayoutGrid },
    { name: "Week", icon: Columns3 },
    { name: "Day", icon: Rows3 },
    { name: "List", icon: ListIcon },
  ];

  // Logic Implementations
  // Removed local fetchAppointments - now covered by CalendarContext

  const checkGoogleStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-status", { body: {} });
      if (!error && data?.connected) setGoogleConnected(true);
      else setGoogleConnected(false);
    } catch {
      setGoogleConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchAppointments();
    checkGoogleStatus();
  }, [fetchAppointments]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-inbound-sync", { body: {} });
      if (error) {
        toast({ title: "Sync failed", variant: "destructive" });
      } else {
        toast({ title: "Google Calendar synced", description: `${data?.imported ?? 0} imported, ${data?.updated ?? 0} updated` });
        await fetchAppointments();
      }
    } catch (e) {
      toast({ title: "Sync failed", variant: "destructive" });
    }
    setSyncing(false);
  };

  const syncAppointmentToGoogle = async (payload: any) => {
    try {
      await supabase.functions.invoke("google-calendar-sync-appointment", {
        body: {
          action: payload.action,
          appointment_id: payload.appointmentId,
          title: payload.title,
          notes: payload.notes,
          start_time: payload.startTime,
          end_time: payload.endTime,
          attendee_email: payload.attendeeEmail,
          external_event_id: payload.externalEventId,
        },
      });
    } catch (error) {
      console.error("External sync failed", error);
    }
  };

  const resolveAttendeeEmail = async (contactId?: string, fallbackEmail?: string | null) => {
    if (fallbackEmail) return fallbackEmail;
    if (!contactId) return null;
    const { data } = await supabase.from("leads").select("email").eq("id", contactId).maybeSingle();
    return data?.email || null;
  };

  const handleSave = async (data: Omit<CalendarAppointment, "id">) => {
    const startDate = timeStringToDate(new Date(data.date), data.startTime);
    const endDate = timeStringToDate(new Date(data.date), data.endTime);
    let contactId = selectedContact?.id || data.contactId || "";
    let attendeeEmail: string | null = selectedContact?.email || null;

    if (!modalEditing && creatingNew && newFirstName.trim() && newLastName.trim()) {
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert([{ first_name: newFirstName.trim(), last_name: newLastName.trim() }])
        .select().single();
      if (leadError || !newLead) { toast({ title: "Failed to create contact", variant: "destructive" }); return; }
      contactId = newLead.id;
      attendeeEmail = newLead.email || null;
    }

    const localPayload = {
      user_id: user?.id,
      title: data.title,
      contact_name: data.contactName,
      contact_id: contactId || null,
      type: data.type,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      notes: data.notes,
      status: data.status,
      sync_source: "internal",
      created_by: user?.id,
    };

    if (modalEditing) {
      const existingMeta = appointmentMetaById[modalEditing.id];
      try {
        await updateAppointment(modalEditing.id, localPayload);
        toast({ title: "Appointment updated" });
        await syncAppointmentToGoogle({
          action: "update",
          appointmentId: modalEditing.id,
          title: data.title,
          notes: data.notes,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          attendeeEmail: await resolveAttendeeEmail(contactId, attendeeEmail),
          externalEventId: existingMeta?.externalEventId,
        });
      } catch (error) {
        toast({ title: "Failed to update appointment", variant: "destructive" });
      }
      return;
    }

    try {
      // For create, we need the ID for Google sync.
      // Context's addAppointment inserts but doesn't return the ID right now.
      // I'll update CalendarContext to return the ID or I'll just keep the local insert here for now.
      // Actually, let's update CalendarContext.tsx's addAppointment to return the data.
      
      const { data: inserted, error } = await supabase.from('appointments').insert([localPayload]).select('id').single();
      if (error || !inserted) { toast({ title: "Failed to save appointment", variant: "destructive" }); return; }
      toast({ title: "Appointment scheduled" });
      
      await syncAppointmentToGoogle({
        action: "create",
        appointmentId: inserted.id,
        title: data.title,
        notes: data.notes,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        attendeeEmail: await resolveAttendeeEmail(contactId, attendeeEmail),
      });
    } catch (error) {
       console.error("Save error", error);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    const externalEventId = appointmentMetaById[appointmentId]?.externalEventId;
    try {
      await deleteAppointment(appointmentId);
      toast({ title: "Appointment deleted" });
      await syncAppointmentToGoogle({ action: "delete", appointmentId, externalEventId });
    } catch (error) {
      toast({ title: "Failed to delete appointment", variant: "destructive" });
    }
  };

  const searchContacts = async (query: string) => {
    setContactSearch(query);
    setSelectedContact(null);
    if (query.length < 2) { setContactResults([]); return; }
    setSearchLoading(true);
    const { data, error } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email')
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
      .limit(8);
    if (!error && data) {
      setContactResults(data.map(l => ({ id: l.id, name: `${l.first_name} ${l.last_name}`, phone: l.phone || "", email: l.email || "" })));
    }
    setSearchLoading(false);
  };

  const openSchedule = (date?: Date, time?: string) => {
    setModalEditing(null);
    setModalDefaultDate(date || currentDate);
    setModalDefaultTime(time);
    setModalOpen(true);
  };


  const openEdit = (a: CalendarAppointment) => {
    const meta = appointmentMetaById[a.id];
    if (meta?.syncSource === "external") {
      toast({ title: "Managed in Google Calendar", description: "Edit it in Google Calendar to update it here." });
      return;
    }
    setModalEditing(a);
    setModalOpen(true);
  };

  const handleOpenContact = async (contactId: string) => {
    if (!contactId) return;
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', contactId)
      .maybeSingle();
    
    if (!error && data) {
      setContactModalLead(data as unknown as Lead);
    } else {
      toast({ title: "Failed to fetch contact details", variant: "destructive" });
    }
  };


  // Helper View Renders
  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    return (
      <div className="grid grid-cols-7 gap-px bg-border/50 border border-border rounded-xl overflow-hidden shadow-sm h-full flex-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="bg-muted/30 py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            {day}
          </div>
        ))}
        {Array.from({ length: 35 }).map((_, i) => {
          let dayDisplay, isCurrentMonth = true;
          if (i < firstDay) { dayDisplay = daysInPrevMonth - (firstDay - i - 1); isCurrentMonth = false; }
          else if (i >= firstDay + daysInMonth) { dayDisplay = i - (firstDay + daysInMonth) + 1; isCurrentMonth = false; }
          else { dayDisplay = i - firstDay + 1; }

          const date = new Date(year, isCurrentMonth ? month : (i < firstDay ? month - 1 : month + 1), dayDisplay);
          const dayAppts = appointments.filter(a => sameDay(new Date(a.date), date));

          return (
            <div key={i} onClick={() => setSelectedDate(date)} className={`h-full bg-card p-1.5 border-t border-border transition-colors hover:bg-accent/5 cursor-pointer relative ${!isCurrentMonth ? "opacity-30" : ""} ${sameDay(date, selectedDate) ? "ring-2 ring-primary ring-inset z-10" : ""}`}>

              <span className={`text-xs font-medium ${isCurrentMonth && sameDay(date, new Date()) ? "bg-primary text-primary-foreground w-6 h-6 flex items-center justify-center rounded-full" : "text-foreground"}`}>
                {dayDisplay}
              </span>
              <div className="mt-1 space-y-0.5 overflow-hidden">
                {dayAppts.slice(0, 3).map(a => (
                  <div key={a.id} onClick={(e) => { e.stopPropagation(); openEdit(a); }} className="text-[9px] px-1 py-0 rounded border truncate font-medium" style={{ backgroundColor: `${APPOINTMENT_TYPE_COLORS[a.type]}15`, color: APPOINTMENT_TYPE_COLORS[a.type], borderColor: `${APPOINTMENT_TYPE_COLORS[a.type]}40` }}>
                    {a.startTime.split(':')[0]} {a.title}
                  </div>
                ))}
                {dayAppts.length > 3 && <div className="text-[8px] text-muted-foreground pl-1">+{dayAppts.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderWeekView = () => (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-full bg-muted/5">
       <div className="grid grid-cols-8 gap-px bg-border/50 border-b border-border shrink-0">
        <div className="bg-muted/10 p-2"></div>
        {Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(currentDate);
          d.setDate(d.getDate() - d.getDay() + i);
          return (
            <div key={i} className="bg-muted/10 p-2 text-center">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">{format(d, 'EEE')}</div>
              <div className={`text-sm font-bold ${sameDay(d, new Date()) ? "text-primary" : ""}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="grid grid-cols-8 gap-px bg-border/10 h-[1000px]">
          <div className="col-span-1 border-r border-border bg-card/50">
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="h-20 border-b border-border/50 text-[9px] text-muted-foreground p-1.5 text-right">{i + 7}:00 AM</div>
            ))}
          </div>
          {Array.from({ length: 7 }).map((_, i) => {
             const d = new Date(currentDate);
             d.setDate(d.getDate() - d.getDay() + i);
             const dayAppts = appointments.filter(a => sameDay(new Date(a.date), d));
             return (
              <div key={i} className="relative group border-r border-border last:border-r-0">
                 {Array.from({ length: 14 }).map((_, j) => (
                  <div key={j} className="h-20 border-b border-border/50 group-hover:bg-accent/5 transition-colors"></div>
                ))}
                {dayAppts.map(a => {
                  const [hourStr, minPart] = a.startTime.split(':');
                  const hour = parseInt(hourStr) + (a.startTime.includes('PM') && hourStr !== '12' ? 12 : (a.startTime.includes('AM') && hourStr === '12' ? -12 : 0));
                  const top = (hour - 7) * 80 + (parseInt(minPart) / 60) * 80;
                  return (
                    <div key={a.id} onClick={() => openEdit(a)} className="absolute left-0.5 right-0.5 p-1.5 rounded-md border-l-2 shadow-sm z-10 cursor-pointer hover:brightness-95 transition-all text-xs overflow-hidden" style={{ top: `${top}px`, backgroundColor: `${APPOINTMENT_TYPE_COLORS[a.type]}20`, borderColor: APPOINTMENT_TYPE_COLORS[a.type] }}>
                      <div className="font-bold truncate" style={{ color: APPOINTMENT_TYPE_COLORS[a.type] }}>{a.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderDayView = () => {
    const dayAppts = appointments.filter(a => sameDay(new Date(a.date), currentDate));
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-full">
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold">{format(currentDate, 'EEEE')}</h3>
            <p className="text-xs text-muted-foreground">{formatDate(currentDate)}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar p-6">
          <div className="space-y-6">
            {dayAppts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <CalendarIcon className="w-12 h-12 mb-4 opacity-20" />
                <p>No appointments scheduled for today</p>
              </div>
            ) : (
              dayAppts.map(appt => (
                <div key={appt.id} onClick={() => openEdit(appt)} className="flex gap-6 items-start group cursor-pointer">
                  <div className="w-20 pt-1 text-sm font-medium text-muted-foreground shrink-0">{appt.startTime}</div>
                  <div className="flex-1 p-5 rounded-xl border border-border hover:border-primary/50 hover:shadow-md transition-all bg-accent/5" style={{ borderLeft: `4px solid ${APPOINTMENT_TYPE_COLORS[appt.type]}` }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-base font-bold text-foreground">{appt.title}</h4>
                        <div className="flex items-center gap-4 mt-2">
                           <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                             <User className="w-3.5 h-3.5" /> {appt.contactName}
                           </div>
                           <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                             <Clock className="w-3.5 h-3.5" /> {appt.endTime ? `${appt.startTime} - ${appt.endTime}` : appt.startTime}
                           </div>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase" style={{ backgroundColor: `${APPOINTMENT_STATUS_COLORS[appt.status]}20`, color: APPOINTMENT_STATUS_COLORS[appt.status] }}>
                        {appt.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderListView = () => (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm h-full flex flex-col">
      <div className="overflow-y-auto no-scrollbar">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10 bg-muted/20 border-b border-border">
            <tr className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <th className="px-6 py-4">Title</th>
              <th className="px-6 py-4">Contact</th>
              <th className="px-6 py-4">Date & Time</th>
              <th className="px-6 py-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {appointments.map(appt => (
              <tr key={appt.id} onClick={() => openEdit(appt)} className="hover:bg-accent/5 transition-colors cursor-pointer group">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: APPOINTMENT_TYPE_COLORS[appt.type] }} />
                    <span className="text-sm font-medium text-foreground">{appt.title}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold">
                      {(appt.contactName || "?")[0]}
                    </div>
                    <span className="text-sm truncate">{appt.contactName}</span>
                  </div>
                </td>
                 <td className="px-6 py-4">
                    <div className="text-sm text-foreground">{formatDate(new Date(appt.date))}</div>
                    <div className="text-[10px] text-muted-foreground">{appt.startTime}</div>
                 </td>
                <td className="px-6 py-4">
                  <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase" style={{ backgroundColor: `${APPOINTMENT_STATUS_COLORS[appt.status]}20`, color: APPOINTMENT_STATUS_COLORS[appt.status] }}>{appt.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const agendaAppts = useMemo(() => {
    return appointments
      .filter(a => sameDay(new Date(a.date), selectedDate))
      .sort((a,b) => {
        const timeA = timeStringToDate(new Date(a.date), a.startTime).getTime();
        const timeB = timeStringToDate(new Date(b.date), b.startTime).getTime();
        return timeA - timeB;
      });
  }, [appointments, selectedDate]);

  if (loading) return (

    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const shouldShowContactSearch = modalOpen && !modalEditing && !selectedContact && !creatingNew;
  const shouldShowCreateForm = modalOpen && !modalEditing && creatingNew && !selectedContact;
  const shouldShowAppointmentModal = modalOpen && (!!modalEditing || !!selectedContact || (creatingNew && !!newFirstName && !!newLastName));

  return (
    <div className="p-4 space-y-4 max-w-[1600px] mx-auto h-[calc(100vh-var(--topbar-height)-1rem)] flex flex-col overflow-hidden animate-in fade-in duration-500">
      {/* Consolidated Header */}
      <div className="relative flex items-center justify-between bg-card p-3 rounded-xl border border-border shadow-sm shrink-0 min-h-[64px]">
        <div className="flex items-center bg-muted/50 p-1 rounded-lg border border-border backdrop-blur-sm z-10">
          {views.map(v => (
            <button key={v.name} onClick={() => setCurrentView(v.name)} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${currentView === v.name ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}>
              <v.icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{v.name}</span>
            </button>
          ))}
        </div>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center pointer-events-auto">
            <h1 className="text-lg font-extrabold tracking-tight text-foreground flex items-center gap-2">
              <div className="p-1 rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <CalendarIcon className="w-4 h-4" />
              </div>
              Calendar
            </h1>
             <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none mt-0.5">
              {format(currentDate, 'MMMM yyyy')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 z-10">
          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-accent/30 border border-border mr-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search meetings..." 
              className="bg-transparent border-none text-xs focus:ring-0 w-32" 
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
            />
          </div>
          {googleConnected && (

            <button onClick={handleSyncNow} disabled={syncing} title="Sync Google Calendar" className="p-2 rounded-lg bg-accent/50 border border-border text-muted-foreground hover:text-foreground transition-all disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            </button>
          )}
          <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg border border-border">
            <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))} className="p-1.5 rounded-md hover:bg-accent transition-colors"><ChevronLeft className="w-4 h-4"/></button>
            <button onClick={() => setCurrentDate(new Date())} className="px-2 py-0.5 text-[9px] font-bold bg-accent rounded hover:bg-accent/80 transition-colors uppercase">Today</button>
            <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))} className="p-1.5 rounded-md hover:bg-accent transition-colors"><ChevronRight className="w-4 h-4"/></button>
          </div>
          <button onClick={() => openSchedule()} className="flex items-center gap-1.5 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-bold text-xs shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
            <Plus className="w-3.5 h-3.5" /> <span className="hidden md:inline">Schedule</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-row gap-4 min-h-0 overflow-hidden">
        <div className="flex-1 relative min-h-0">
          {currentView === "Month" && renderMonthView()}
          {currentView === "Week" && renderWeekView()}
          {currentView === "Day" && renderDayView()}
          {currentView === "List" && renderListView()}
        </div>

        <div className="w-80 hidden xl:flex flex-col bg-card border border-border rounded-xl shadow-sm overflow-hidden min-h-0">
          <div className="p-4 border-b border-border bg-muted/10 shrink-0">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 uppercase tracking-tight">
              <Rows3 className="w-4 h-4 text-primary" />
              Agenda
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3">
             <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
              {sameDay(selectedDate, new Date()) ? "Today" : format(selectedDate, 'MMM d')}
            </div>
            {agendaAppts.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-10 text-center px-4 bg-muted/5 rounded-xl border border-dashed border-border">
                  <Clock className="w-8 h-8 text-muted-foreground mb-2 opacity-20" />
                  <p className="text-[10px] text-muted-foreground">No events scheduled</p>
                  <button onClick={() => openSchedule(selectedDate)} className="mt-3 text-[10px] font-bold text-primary hover:underline uppercase tracking-tight">Schedule One</button>
               </div>
            ) : (
              agendaAppts.map(appt => (

                <div key={appt.id} onClick={() => openEdit(appt)} className="group relative bg-accent/10 border border-border rounded-xl p-3 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer">
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase" style={{ backgroundColor: `${APPOINTMENT_TYPE_COLORS[appt.type]}20`, color: APPOINTMENT_TYPE_COLORS[appt.type] }}>
                      {appt.type}
                    </span>
                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button className="p-1 rounded bg-background border border-border text-muted-foreground hover:text-primary"><Phone className="w-3 h-3"/></button>
                      <button className="p-1 rounded bg-background border border-border text-muted-foreground hover:text-success"><MessageSquare className="w-3 h-3"/></button>
                    </div>
                  </div>
                  <h4 className="text-sm font-bold text-foreground mb-1 group-hover:text-primary transition-colors">{appt.title}</h4>
                  <div className="space-y-1">
                     <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(new Date(appt.date))} at {appt.startTime}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span className="font-medium text-foreground">{appt.contactName}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
            
            <div className="pt-4 px-1">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Daily Performance</div>
              <div className="bg-primary/5 rounded-xl border border-primary/10 p-4 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground font-medium">Appointments Today</span>
                  <span className="font-bold text-primary">{appointments.filter(a => sameDay(new Date(a.date), new Date())).length}</span>
                </div>
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary w-[60%] rounded-full shadow-[0_0_8px_rgba(59,130,246,0.3)]" />
                </div>
                <p className="text-[9px] text-muted-foreground leading-relaxed">Keep it up! Reach out to your next contact 10 mins early.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AppointmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={modalEditing ? handleDeleteAppointment : undefined}
        editing={modalEditing}
        defaultDate={modalDefaultDate}
        defaultTime={modalDefaultTime}
        prefillContactName={selectedContact?.name}
        prefillContactId={selectedContact?.id}
      />


      {contactModalLead && (
        <ContactModal
          lead={contactModalLead}
          onClose={() => setContactModalLead(null)}
          onUpdate={async () => {}}
          onDelete={async () => {}}
        />
      )}
    </div>
  );
};

export default CalendarPage;
