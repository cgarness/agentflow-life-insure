import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarAppointment, APPOINTMENT_TYPE_COLORS, CalAppointmentStatus } from "@/contexts/CalendarContext";
import AppointmentPopover from "./AppointmentPopover";

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const HOURS_START = 7;
const HOURS_END = 21;
const SLOT_HEIGHT = 52;
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

const DayView: React.FC<Props> = ({ appointments, onEditAppointment, onDeleteAppointment, onStatusChange, onOpenContact, onScheduleAt }) => {
  const [currentDate, setCurrentDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [popover, setPopover] = useState<{ appointment: CalendarAppointment; rect: DOMRect } | null>(null);
  const [nowLine, setNowLine] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const isToday = sameDay(currentDate, today);

  const prevDay = () => setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
  const nextDay = () => setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });
  const goToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setCurrentDate(d); };

  const dateLabel = currentDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const dayAppts = appointments.filter(a => sameDay(new Date(a.date), currentDate));

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const totalMin = (now.getHours() - HOURS_START) * 60 + now.getMinutes();
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

  const handleSlotClick = (slotIndex: number) => {
    onScheduleAt(currentDate, slotToTime(slotIndex));
  };

  const handleBlockClick = (e: React.MouseEvent, a: CalendarAppointment) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ appointment: a, rect });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Nav */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <button onClick={prevDay} className="w-8 h-8 rounded-md bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 transition-colors duration-150"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={nextDay} className="w-8 h-8 rounded-md bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 transition-colors duration-150"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <h2 className="text-lg font-bold text-foreground">{dateLabel}</h2>
        <button onClick={goToday} className="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors duration-150">Today</button>
      </div>

      {/* Time grid */}
      <div className="bg-card rounded-lg border border-border overflow-hidden flex-1 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
          <div className="relative" style={{ display: "grid", gridTemplateColumns: "56px 1fr", minHeight: SLOTS * SLOT_HEIGHT }}>
            {/* Time labels */}
            <div className="relative">
              {Array.from({ length: SLOTS }, (_, i) => (
                <div key={i} className="absolute w-full text-right pr-2 text-xs text-muted-foreground" style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}>
                  {i % 2 === 0 ? slotToTime(i) : ""}
                </div>
              ))}
            </div>

            {/* Day column */}
            <div className={`relative border-l border-border ${isToday ? "bg-primary/5" : ""}`}>
              {Array.from({ length: SLOTS }, (_, si) => (
                <div key={si} onClick={() => handleSlotClick(si)}
                  className="absolute w-full border-b border-border/50 cursor-pointer hover:bg-accent/20 transition-colors duration-150"
                  style={{ top: si * SLOT_HEIGHT, height: SLOT_HEIGHT }} />
              ))}

              {dayAppts.map(a => {
                const startSlot = timeToSlot(a.startTime);
                const endSlot = timeToSlot(a.endTime);
                const duration = Math.max(1, endSlot - startSlot);
                const col = APPOINTMENT_TYPE_COLORS[a.type];
                return (
                  <div key={a.id} onClick={e => handleBlockClick(e, a)}
                    className="absolute left-2 right-2 rounded-md px-3 py-1.5 cursor-pointer overflow-hidden z-10 hover:opacity-90 transition-opacity duration-150"
                    style={{
                      top: startSlot * SLOT_HEIGHT + 1,
                      height: duration * SLOT_HEIGHT - 2,
                      backgroundColor: col + "33",
                      borderLeft: `3px solid ${col}`,
                    }}>
                    <div className="text-sm font-bold text-foreground truncate">{a.title}</div>
                    <div className="text-xs text-muted-foreground">{a.startTime} – {a.endTime}</div>
                  </div>
                );
              })}

              {/* Current time line */}
              {isToday && nowLine > 0 && nowLine < SLOTS * SLOT_HEIGHT && (
                <div className="absolute left-0 right-0 pointer-events-none" style={{ top: nowLine, zIndex: 20 }}>
                  <div className="w-full h-0.5 bg-red-500 relative">
                    <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                  </div>
                </div>
              )}
            </div>
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

export default DayView;
