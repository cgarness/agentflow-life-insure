import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, List, LayoutGrid } from "lucide-react";

const typeColors: Record<string, string> = {
  "Sales Call": "bg-primary",
  "Follow Up": "bg-success",
  "Recruit Interview": "bg-info",
  "Policy Review": "bg-warning",
  "Anniversary": "bg-pink-500",
  "Other": "bg-muted-foreground",
};

const typeBadgeColors: Record<string, string> = {
  "Sales Call": "bg-primary/10 text-primary",
  "Follow Up": "bg-success/10 text-success",
  "Recruit Interview": "bg-info/10 text-info",
  "Policy Review": "bg-warning/10 text-warning",
  "Anniversary": "bg-pink-100 text-pink-600",
  "Other": "bg-muted text-muted-foreground",
};

const sampleAppointments: Record<number, Array<{ time: string; name: string; type: string }>> = {
  3: [{ time: "10:00 AM", name: "John Martinez", type: "Sales Call" }],
  7: [{ time: "2:00 PM", name: "Sarah Williams", type: "Follow Up" }],
  10: [{ time: "9:00 AM", name: "Mike Johnson", type: "Recruit Interview" }, { time: "3:00 PM", name: "Lisa Park", type: "Policy Review" }],
  14: [{ time: "11:00 AM", name: "Tom Harris", type: "Sales Call" }],
  17: [{ time: "1:00 PM", name: "Robert Chen", type: "Anniversary" }],
  21: [{ time: "10:30 AM", name: "Amy Zhang", type: "Follow Up" }, { time: "4:00 PM", name: "David Brown", type: "Sales Call" }],
  25: [{ time: "9:00 AM", name: "Maria Lopez", type: "Sales Call" }],
  28: [{ time: "2:30 PM", name: "Karen White", type: "Policy Review" }],
};

const CalendarPage: React.FC = () => {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = now.toLocaleString("default", { month: "long", year: "numeric" });

  const days = Array.from({ length: firstDay }, () => null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  const selectedAppts = sampleAppointments[selectedDay] || [];

  const allAppts = Object.entries(sampleAppointments)
    .flatMap(([day, appts]) => appts.map((a) => ({ ...a, day: Number(day) })))
    .sort((a, b) => a.day - b.day);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold text-foreground min-w-[140px] text-center">{monthName}</span>
            <button className="w-8 h-8 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <button className="px-3 py-1.5 rounded-lg bg-accent text-foreground text-sm font-medium hover:bg-accent/80 sidebar-transition">Today</button>
          <div className="flex bg-accent rounded-lg p-0.5">
            <button onClick={() => setView("calendar")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "calendar" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setView("list")} className={`px-2.5 py-1 rounded-md sidebar-transition ${view === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><List className="w-4 h-4" /></button>
          </div>
          <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 hover:bg-primary/90 sidebar-transition"><Plus className="w-4 h-4" /> Schedule</button>
        </div>
      </div>

      {view === "calendar" ? (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border overflow-hidden">
            {/* Day Headers */}
            <div className="grid grid-cols-7 border-b">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
              ))}
            </div>
            {/* Calendar Grid */}
            <div className="grid grid-cols-7">
              {days.map((day, i) => (
                <button
                  key={i}
                  onClick={() => day && setSelectedDay(day)}
                  disabled={!day}
                  className={`min-h-[80px] p-1.5 border-b border-r text-left sidebar-transition ${
                    day === today ? "bg-primary/5" : ""
                  } ${day === selectedDay ? "ring-2 ring-primary ring-inset" : ""} ${
                    day ? "hover:bg-accent/50" : ""
                  }`}
                >
                  {day && (
                    <>
                      <span className={`text-xs font-medium ${day === today ? "w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center" : "text-foreground"}`}>{day}</span>
                      <div className="flex gap-0.5 mt-1 flex-wrap">
                        {(sampleAppointments[day] || []).map((a, j) => (
                          <span key={j} className={`w-1.5 h-1.5 rounded-full ${typeColors[a.type]}`} />
                        ))}
                      </div>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Selected Day Agenda */}
          <div className="bg-card rounded-xl border p-4">
            <h3 className="font-semibold text-foreground mb-3">
              {selectedDay === today ? "Today" : `${monthName.split(" ")[0]} ${selectedDay}`} — {selectedAppts.length} appointment{selectedAppts.length !== 1 ? "s" : ""}
            </h3>
            {selectedAppts.length > 0 ? (
              <div className="space-y-2">
                {selectedAppts.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-accent/50">
                    <span className="text-sm font-mono text-primary font-medium">{a.time}</span>
                    <span className="text-sm text-foreground font-medium">{a.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeColors[a.type]}`}>{a.type}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No appointments scheduled.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {[
            { label: "Today", appts: allAppts.filter((a) => a.day === today) },
            { label: "Tomorrow", appts: allAppts.filter((a) => a.day === today + 1) },
            { label: "This Week", appts: allAppts.filter((a) => a.day > today + 1 && a.day <= today + 7) },
            { label: "Later", appts: allAppts.filter((a) => a.day > today + 7) },
          ].filter((g) => g.appts.length > 0).map((group) => (
            <div key={group.label}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{group.label}</h3>
              <div className="space-y-2">
                {group.appts.map((a, i) => (
                  <div key={i} className="bg-card rounded-xl border p-4 flex items-center gap-4 hover:shadow-md sidebar-transition">
                    <div className="text-center shrink-0">
                      <p className="text-2xl font-bold text-foreground">{a.day}</p>
                      <p className="text-xs text-muted-foreground">{monthName.split(" ")[0]}</p>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-primary">{a.time}</span>
                        <span className="text-sm font-medium text-foreground">{a.name}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadgeColors[a.type]}`}>{a.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CalendarPage;
