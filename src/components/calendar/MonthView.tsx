import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarAppointment, APPOINTMENT_TYPE_COLORS, CalAppointmentType } from "@/contexts/CalendarContext";
import AppointmentPopover from "./AppointmentPopover";
import { CalAppointmentStatus } from "@/contexts/CalendarContext";

const ALL_TYPES: CalAppointmentType[] = ["Sales Call", "Follow Up", "Recruit Interview", "Policy Review", "Policy Anniversary", "Other"];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface Props {
  currentMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  appointments: CalendarAppointment[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onDayClick: (d: Date) => void;
  onEditAppointment: (a: CalendarAppointment) => void;
  onDeleteAppointment: (id: string) => void;
  onStatusChange: (id: string, s: CalAppointmentStatus) => void;
  onOpenContact?: (contactId: string) => void;
}

const MonthView: React.FC<Props> = ({
  currentMonth, onPrevMonth, onNextMonth, onToday,
  appointments, selectedDate, onSelectDate, onDayClick,
  onEditAppointment, onDeleteAppointment, onStatusChange, onOpenContact,
}) => {
  const [popover, setPopover] = useState<{ appointment: CalendarAppointment; rect: DOMRect } | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const today = new Date();
  const firstDayOfMonth = new Date(year, month, 1);
  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < startDay; i++) {
    const d = daysInPrevMonth - startDay + 1 + i;
    cells.push({ date: new Date(year, month - 1, d), inMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ date: new Date(year, month, i), inMonth: true });
  }
  const totalCells = 35; // 5 rows × 7 cols
  while (cells.length < totalCells) {
    const d = cells.length - startDay - daysInMonth + 1;
    cells.push({ date: new Date(year, month + 1, d), inMonth: false });
  }
  cells.length = totalCells;

  const monthLabel = currentMonth.toLocaleString("default", { month: "long", year: "numeric" });
  const getApptsForDate = (d: Date) => appointments.filter(a => sameDay(new Date(a.date), d));

  const handlePillClick = (e: React.MouseEvent, a: CalendarAppointment) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ appointment: a, rect });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Month Nav */}
      <div className="flex items-center justify-between px-1 mb-3">
        <div className="flex items-center gap-2">
          <button onClick={onPrevMonth} className="w-8 h-8 rounded-md bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 transition-colors duration-150"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={onNextMonth} className="w-8 h-8 rounded-md bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 transition-colors duration-150"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <h2 className="text-lg font-bold text-foreground">{monthLabel}</h2>
        <button onClick={onToday} className="px-3 py-1.5 rounded-md border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors duration-150">Today</button>
      </div>

      {/* Grid */}
      <div className="bg-card rounded-lg border border-border overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="grid grid-cols-7 border-b border-border">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 auto-rows-fr min-h-0">
          {cells.map((cell, i) => {
            const appts = getApptsForDate(cell.date);
            const isToday = sameDay(cell.date, today);
            const isSelected = sameDay(cell.date, selectedDate);
            return (
              <button key={i} onClick={() => { onSelectDate(cell.date); if (cell.inMonth) onDayClick(cell.date); }}
                className={`min-h-[100px] p-1.5 border-b border-r border-border text-left transition-colors duration-150 flex flex-col ${
                  !cell.inMonth ? "opacity-40" : ""
                } ${isSelected ? "ring-2 ring-primary ring-inset" : ""} ${isToday && cell.inMonth && isSelected ? "bg-primary/5" : ""} hover:bg-accent/30`}>
                <span className={`text-sm font-medium inline-flex items-center justify-center ${isToday && cell.inMonth ? "w-6 h-6 rounded-full text-white" : "text-foreground"}`}
                  style={isToday && cell.inMonth ? { backgroundColor: "#3B82F6" } : undefined}>
                  {cell.date.getDate()}
                </span>
                <div className="flex flex-col gap-0.5 mt-1 overflow-hidden flex-1">
                  {appts.slice(0, 2).map(a => {
                    const col = APPOINTMENT_TYPE_COLORS[a.type];
                    return (
                      <div key={a.id} onClick={e => handlePillClick(e, a)}
                        className="text-[10px] px-1 py-0.5 rounded truncate w-full text-white cursor-pointer transition-opacity duration-150 hover:opacity-80"
                        style={{ backgroundColor: col }}>
                        {a.startTime.replace(/ /g, "")} {a.title}
                      </div>
                    );
                  })}
                  {appts.length > 2 && <span className="text-[10px] text-muted-foreground">+{appts.length - 2} more</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-3 flex-wrap">
        {ALL_TYPES.map(t => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: APPOINTMENT_TYPE_COLORS[t] }} />
            <span className="text-xs text-muted-foreground">{t}</span>
          </div>
        ))}
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

export default MonthView;
