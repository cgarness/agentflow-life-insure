import React, { useState } from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Search, 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  MoreHorizontal,
  Mail,
  Phone,
  MessageSquare,
  LayoutGrid,
  Rows3,
  Columns3,
  List as ListIcon
} from "lucide-react";

type ViewType = "Month" | "Week" | "Day" | "List";

interface Appointment {
  id: string;
  title: string;
  time: string;
  duration: string;
  contact: string;
  type: string;
  status: "Scheduled" | "Confirmed" | "Completed";
  color: string;
}

const mockAppointments: Appointment[] = [
  {
    id: "1",
    title: "Sales Call: John Smith",
    time: "10:00 AM",
    duration: "45 min",
    contact: "John Smith",
    type: "Sales Call",
    status: "Confirmed",
    color: "#3B82F6"
  },
  {
    id: "2",
    title: "Follow Up: Sarah Connor",
    time: "2:00 PM",
    duration: "30 min",
    contact: "Sarah Connor",
    type: "Follow Up",
    status: "Scheduled",
    color: "#10B981"
  }
];

const Calendar2: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>("Month");
  const [currentDate, setCurrentDate] = useState(new Date());

  const views: { name: ViewType; icon: any }[] = [
    { name: "Month", icon: LayoutGrid },
    { name: "Week", icon: Columns3 },
    { name: "Day", icon: Rows3 },
    { name: "List", icon: ListIcon },
  ];

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    // Calculate days to show to ensure exactly 5 rows (35 days)
    const prevMonthDays = getDaysInMonth(year, month - 1);
    const days: { day: number; currentMonth: boolean }[] = [];

    // Add days from previous month
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, currentMonth: false });
    }

    // Add days from current month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, currentMonth: true });
    }

    // Fill remaining days from next month to reach 35 (5 rows * 7 days)
    let nextMonthDay = 1;
    while (days.length < 35) {
      days.push({ day: nextMonthDay++, currentMonth: false });
    }

    // If it exceeds 35 (e.g. 6 rows needed naturally), we still force 5 rows by truncating/clamping
    // but usually, a 5-row design is a specific aesthetic choice that might sacrifice some days or overlap.
    // To strictly have 5 rows, we just take the first 35.
    const displayDays = days.slice(0, 35);

    return (
      <div className="grid grid-cols-7 gap-px bg-border/50 border border-border rounded-xl overflow-hidden shadow-sm">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="bg-muted/30 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {day}
          </div>
        ))}
        {displayDays.map((dateObj, i) => (
          <div 
            key={i} 
            className={`min-h-[100px] lg:min-h-[120px] bg-card p-2 border-t border-border transition-colors hover:bg-accent/5 cursor-pointer relative ${!dateObj.currentMonth ? "opacity-40" : ""}`}
          >
            <span className={`text-sm font-medium ${dateObj.currentMonth && dateObj.day === new Date().getDate() && month === new Date().getMonth() ? "bg-primary text-primary-foreground w-7 h-7 flex items-center justify-center rounded-full" : "text-foreground"}`}>
              {dateObj.day}
            </span>
            {dateObj.currentMonth && dateObj.day === 12 && (
              <div className="mt-2 space-y-1">
                <div className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-200 truncate font-medium">
                  10:00 Sales Call
                </div>
              </div>
            )}
            {dateObj.currentMonth && dateObj.day === 12 && (
              <div className="mt-1">
                <div className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-200 truncate font-medium">
                  14:00 Follow Up
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderWeekView = () => (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-[600px]">
      <div className="grid grid-cols-8 gap-px bg-border/50 border-b border-border">
        <div className="bg-muted/10 p-4"></div>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
          <div key={day} className="bg-muted/10 p-4 text-center">
            <div className="text-xs font-semibold text-muted-foreground uppercase">{day}</div>
            <div className="text-lg font-bold">{(10 + i)}</div>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="grid grid-cols-8 gap-px bg-border/20 h-[1000px]">
          <div className="col-span-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-20 border-b border-border text-[10px] text-muted-foreground p-2 text-right">
                {i + 8}:00 AM
              </div>
            ))}
          </div>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="relative group">
               {Array.from({ length: 12 }).map((_, j) => (
                <div key={j} className="h-20 border-b border-border group-hover:bg-accent/5 transition-colors"></div>
              ))}
              {i === 2 && (
                <div className="absolute top-[160px] left-1 right-1 p-2 rounded-lg bg-primary/10 border-l-4 border-primary shadow-sm z-10">
                  <div className="text-xs font-bold text-primary">Sales Call</div>
                  <div className="text-[10px] text-primary/80">10:00 AM - 10:45 AM</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderDayView = () => (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-[600px]">
      <div className="p-6 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Wednesday</h3>
          <p className="text-sm text-muted-foreground">March 12, 2026</p>
        </div>
        <div className="flex gap-2">
           <button className="p-2 rounded-full hover:bg-accent text-muted-foreground"><Search className="w-5 h-5"/></button>
           <button className="p-2 rounded-full hover:bg-accent text-muted-foreground"><MoreHorizontal className="w-5 h-5"/></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar p-6">
        <div className="space-y-6">
          {mockAppointments.map(appt => (
            <div key={appt.id} className="flex gap-6 items-start group">
              <div className="w-20 pt-1 text-sm font-medium text-muted-foreground">{appt.time}</div>
              <div className="flex-1 p-4 rounded-xl border border-border hover:border-primary/50 hover:shadow-md transition-all cursor-pointer bg-accent/5">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-foreground">{appt.title}</h4>
                    <div className="flex items-center gap-4 mt-2">
                       <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                         <User className="w-3.5 h-3.5" /> {appt.contact}
                       </div>
                       <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                         <Clock className="w-3.5 h-3.5" /> {appt.duration}
                       </div>
                    </div>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1.5 rounded-lg bg-background border border-border hover:text-primary"><Phone className="w-4 h-4"/></button>
                    <button className="p-1.5 rounded-lg bg-background border border-border hover:text-success"><MessageSquare className="w-4 h-4"/></button>
                    <button className="p-1.5 rounded-lg bg-background border border-border hover:text-info"><Mail className="w-4 h-4"/></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderListView = () => (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <th className="px-6 py-4">Title</th>
            <th className="px-6 py-4">Contact</th>
            <th className="px-6 py-4">Time</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {mockAppointments.map(appt => (
            <tr key={appt.id} className="hover:bg-accent/5 transition-colors cursor-pointer group">
              <td className="px-6 py-4 font-medium text-foreground">{appt.title}</td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                    {appt.contact.charAt(0)}
                  </div>
                  <span className="text-sm">{appt.contact}</span>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-muted-foreground">{appt.time}</td>
              <td className="px-6 py-4">
                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                  appt.status === "Confirmed" ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"
                }`}>
                  {appt.status}
                </span>
              </td>
              <td className="px-6 py-4 text-right">
                <button className="p-2 rounded-lg hover:bg-background border border-transparent hover:border-border transition-all">
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-4 space-y-4 max-w-[1600px] mx-auto h-[calc(100vh-var(--topbar-height)-1rem)] flex flex-col overflow-hidden animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <CalendarIcon className="w-5 h-5" />
            </div>
            Calendar 2
          </h1>
          <p className="text-xs text-muted-foreground font-medium">Manage your schedule and appointments</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-muted/50 p-1 rounded-lg border border-border backdrop-blur-sm">
            {views.map(v => (
              <button
                key={v.name}
                onClick={() => setCurrentView(v.name)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
                  currentView === v.name 
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border" 
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                <v.icon className="w-3.5 h-3.5" />
                {v.name}
              </button>
            ))}
          </div>

          <button className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-bold text-xs shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
            <Plus className="w-3.5 h-3.5" /> Schedule
          </button>
        </div>
      </div>

      {/* Main Calendar Content */}
      <div className="space-y-4 flex-1 flex flex-col min-h-0">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between bg-card p-3 rounded-xl border border-border shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">
              {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))} className="p-1.5 rounded-lg hover:bg-accent transition-colors"><ChevronLeft className="w-4 h-4"/></button>
              <button onClick={() => setCurrentDate(new Date())} className="px-2 py-0.5 text-[10px] font-bold bg-accent rounded hover:bg-accent/80 transition-colors">Today</button>
              <button onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))} className="p-1.5 rounded-lg hover:bg-accent transition-colors"><ChevronRight className="w-4 h-4"/></button>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-accent/30 border border-border">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input type="text" placeholder="Search events..." className="bg-transparent border-none text-xs focus:ring-0 w-32" />
            </div>
          </div>
        </div>

        {/* View Layouts */}
        <div className="relative flex-1 min-h-0">
          {currentView === "Month" && (
            <div className="h-full flex flex-col">
              <div className="grid grid-cols-7 gap-px bg-border/50 border border-border rounded-xl overflow-hidden shadow-sm h-full flex-1">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div key={day} className="bg-muted/30 py-2 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                    {day}
                  </div>
                ))}
                {/* 35 days (5 rows * 7 columns) */}
                {Array.from({ length: 35 }).map((_, i) => {
                   const year = currentDate.getFullYear();
                   const month = currentDate.getMonth();
                   const firstDay = new Date(year, month, 1).getDay();
                   const daysInPrevMonth = new Date(year, month, 0).getDate();
                   const daysInMonth = new Date(year, month + 1, 0).getDate();
                   
                   let dayDisplay;
                   let isCurrentMonth = true;
                   
                   if (i < firstDay) {
                     dayDisplay = daysInPrevMonth - (firstDay - i - 1);
                     isCurrentMonth = false;
                   } else if (i >= firstDay + daysInMonth) {
                     dayDisplay = i - (firstDay + daysInMonth) + 1;
                     isCurrentMonth = false;
                   } else {
                     dayDisplay = i - firstDay + 1;
                   }

                   return (
                    <div 
                      key={i} 
                      className={`h-full bg-card p-1.5 border-t border-border transition-colors hover:bg-accent/5 cursor-pointer relative ${!isCurrentMonth ? "opacity-30" : ""}`}
                    >
                      <span className={`text-xs font-medium ${isCurrentMonth && dayDisplay === new Date().getDate() && month === new Date().getMonth() ? "bg-primary text-primary-foreground w-6 h-6 flex items-center justify-center rounded-full" : "text-foreground"}`}>
                        {dayDisplay}
                      </span>
                      {isCurrentMonth && dayDisplay === 12 && (
                        <div className="mt-1 space-y-0.5">
                          <div className="text-[9px] px-1 py-0 rounded bg-blue-500/10 text-blue-600 border border-blue-200 truncate font-medium">
                            10:00 Sales
                          </div>
                          <div className="text-[9px] px-1 py-0 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-200 truncate font-medium">
                            14:00 Follow
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {currentView === "Week" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-full">
              <div className="grid grid-cols-8 gap-px bg-border/50 border-b border-border shrink-0">
                <div className="bg-muted/10 p-2"></div>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                  <div key={day} className="bg-muted/10 p-2 text-center">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase">{day}</div>
                    <div className="text-sm font-bold">{(10 + i)}</div>
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="grid grid-cols-8 gap-px bg-border/20 h-[800px]">
                  <div className="col-span-1 border-r border-border">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="h-16 border-b border-border text-[9px] text-muted-foreground p-1.5 text-right">
                        {i + 8}:00 AM
                      </div>
                    ))}
                  </div>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="relative group border-r border-border last:border-r-0">
                       {Array.from({ length: 12 }).map((_, j) => (
                        <div key={j} className="h-16 border-b border-border group-hover:bg-accent/5 transition-colors"></div>
                      ))}
                      {i === 2 && (
                        <div className="absolute top-[128px] left-0.5 right-0.5 p-1.5 rounded-md bg-primary/10 border-l-2 border-primary shadow-sm z-10">
                          <div className="text-[10px] font-bold text-primary truncate">Sales Call</div>
                          <div className="text-[8px] text-primary/80 truncate">10:00 AM</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {currentView === "Day" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-full">
              <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-bold">Wednesday</h3>
                  <p className="text-xs text-muted-foreground">March 12, 2026</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar p-4">
                <div className="space-y-4">
                  {mockAppointments.map(appt => (
                    <div key={appt.id} className="flex gap-4 items-start group">
                      <div className="w-16 pt-1 text-xs font-medium text-muted-foreground shrink-0">{appt.time}</div>
                      <div className="flex-1 p-3 rounded-lg border border-border hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer bg-accent/5">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="text-sm font-bold text-foreground">{appt.title}</h4>
                            <div className="flex items-center gap-3 mt-1.5">
                               <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                 <User className="w-3 h-3" /> {appt.contact}
                               </div>
                               <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                 <Clock className="w-3 h-3" /> {appt.duration}
                               </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {currentView === "List" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm h-full flex flex-col">
              <div className="overflow-y-auto no-scrollbar">
                <table className="w-full text-left">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted/20 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <th className="px-5 py-3">Title</th>
                      <th className="px-5 py-3">Contact</th>
                      <th className="px-5 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mockAppointments.map(appt => (
                      <tr key={appt.id} className="hover:bg-accent/5 transition-colors cursor-pointer group">
                        <td className="px-5 py-3 text-sm font-medium text-foreground">{appt.title}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                              {appt.contact.charAt(0)}
                            </div>
                            <span className="text-xs truncate">{appt.contact}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">{appt.time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


export default Calendar2;
