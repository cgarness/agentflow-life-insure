import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarAppointment, APPOINTMENT_TYPE_COLORS, CalAppointmentStatus } from "@/contexts/CalendarContext";
import AppointmentPopover from "./AppointmentPopover";

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getWeekStart(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  r.setHours(0, 0, 0, 0);
  return r;
}

const HOURS_START = 7;
const HOURS_END = 21;
const SLOT_HEIGHT = 48;
const SLOTS = (HOURS_END - HOURS_START) * 2;

function timeToSlot(time: string): number {
  const match = time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return 0;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ap = match[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return Math.max(0, (h - HOURS_START) * 2 + (m >= 30 ? 1 : 0));
}

function slotToTime(slot: number): string {
  const totalMinutes = (HOURS_START * 60) + (slot * 30);
  let h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ap}`;
}

interface Props {
  appointments: CalendarAppointment[];
  onEditAppointment: (a: CalendarAppointment) => void;
  onDeleteAppointment: (id: string) => void;
  onStatusChange: (id: string, s: CalAppointmentStatus) => void;
  onOpenContact?: (contactId: string) => void;
  onScheduleAt: (date: Date, time: string) => void;
}

const WeekView: React.FC<Props> = ({ appointments, onEditAppointment, onDeleteAppointment, onStatusChange, onOpenContact, onScheduleAt }) => {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [popover, setPopover] = useState<{ appointment: CalendarAppointment; rect: DOMRect } | null>(null);
  const [nowLine, setNowLine] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = new Date();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const prevWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  const nextWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  const goToday = () => setWeekStart(getWeekStart(new Date()));

  const weekLabel = (() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const sMonth = weekStart.toLocaleString("default", { month: "short" });
    const eMonth = end.toLocaleString("default", { month: "short" });
    if (sMonth === eMonth) return `${sMonth} ${weekStart.getDate()} – ${end.getDate()}, ${weekStart.getFullYear()}`;
    return `${sMonth} ${weekStart.getDate()} – ${eMonth} ${end.getDate()}, ${end.getFullYear()}`;
  })();

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const totalMin = (h - HOURS_START) * 60 + m;
      setNowLine(totalMin >= 0 ? (totalMin / 30) * SLOT_HEIGHT : -1);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current && nowLine > 0) {
      scrollRef.current.scrollTop = Math.max(0, nowLine - 100);
    }
  }, []);

  const getApptsForDay = (d: Date) => appointments.filter(a => sameDay(new Date(a.date), d));

  const handleSlotClick = (day: Date, slotIndex: number) => {
    const time = slotToTime(slotIndex);
    onScheduleAt(day, time);
  };

  const handleBlockClick = (e: React.MouseEvent, a: CalendarAppointment) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ appointment: a, rect });
  };

  const isCurrentWeek = sameDay(weekStart, getWeekStart(new Date()));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Nav */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="w-8 h-8 rounded-md bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 transition-colors duration-150"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={nextWeek} className="w-8 h-8 rounded-md bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 transition-colors duration-150"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <h2 className="text-lg font-bold text-foreground">{weekLabel}</h2>
        <button onClick={goToday} className="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors duration-150">Today</button>
      </div>

      {/* Grid */}
      <div className="bg-card rounded-lg border border-border overflow-hidden flex-1 flex flex-col min-h-0">
        {/* Day headers */}
        <div className="grid border-b border-border" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
          <div className="py-2" />
          {days.map((d, i) => {
            const isToday2 = sameDay(d, today);
            return (
              <div key={i} className={`py-2 text-center border-l border-border ${isToday2 ? "bg-primary/10" : ""}`}>
                <div className="text-xs font-semibold text-muted-foreground">{d.toLocaleString("default", { weekday: "short" })}</div>
                <div className={`text-sm font-bold ${isToday2 ? "text-primary" : "text-foreground"}`}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
          <div className="relative" style={{ gridTemplateColumns: "56px repeat(7, 1fr)", display: "grid", minHeight: SLOTS * SLOT_HEIGHT }}>
            {/* Time labels */}
            <div className="relative">
              {Array.from({ length: SLOTS }, (_, i) => (
                <div key={i} className="absolute w-full text-right pr-2 text-xs text-muted-foreground" style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}>
                  {i % 2 === 0 ? slotToTime(i) : ""}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((day, di) => {
              const dayAppts = getApptsForDay(day);
              const isToday2 = sameDay(day, today);
              return (
                <div key={di} className={`relative border-l border-border ${isToday2 ? "bg-primary/5" : ""}`}>
                  {/* Slot lines */}
                  {Array.from({ length: SLOTS }, (_, si) => (
                    <div key={si} onClick={() => handleSlotClick(day, si)}
                      className="absolute w-full border-b border-border/50 cursor-pointer hover:bg-accent/20 transition-colors duration-150"
                      style={{ top: si * SLOT_HEIGHT, height: SLOT_HEIGHT }} />
                  ))}

                  {/* Appointment blocks */}
                  {dayAppts.map(a => {
                    const startSlot = timeToSlot(a.startTime);
                    const endSlot = timeToSlot(a.endTime);
                    const duration = Math.max(1, endSlot - startSlot);
                    const col = APPOINTMENT_TYPE_COLORS[a.type];
                    return (
                      <div key={a.id} onClick={e => handleBlockClick(e, a)}
                        className="absolute left-1 right-1 rounded-md px-2 py-1 cursor-pointer overflow-hidden z-10 hover:opacity-90 transition-opacity duration-150"
                        style={{
                          top: startSlot * SLOT_HEIGHT + 1,
                          height: duration * SLOT_HEIGHT - 2,
                          backgroundColor: col + "33",
                          borderLeft: `3px solid ${col}`,
                        }}>
                        <div className="text-xs font-bold text-foreground truncate">{a.title}</div>
                        <div className="text-xs text-muted-foreground">{a.startTime} – {a.endTime}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Current time line */}
            {isCurrentWeek && nowLine > 0 && nowLine < SLOTS * SLOT_HEIGHT && (
              <div className="absolute pointer-events-none" style={{ top: nowLine, left: 56, right: 0, zIndex: 20 }}>
                <div className="w-full h-0.5 bg-red-500 relative">
                  <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Popover */}
      {popover && (
        <AppointmentPopover
          appointment={popover.appointment}
          anchorRect={popover.rect}
          onClose={() => setPopover(null)}
          onEdit={a => { setPopover(null); onEditAppointment(a); }}
          onDelete={id => { onDeleteAppointment(id); setPopover(null); }}
          onStatusChange={onStatusChange}
          onOpenContact={onOpenContact}
        />
      )}
    </div>
  );
};

export default WeekView;
