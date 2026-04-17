import * as React from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { format, parse, isValid, addMonths, subMonths, setMonth, setYear } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateInputProps {
  value?: string; // Expects YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear + 20 - 1900 + 1 }, (_, i) => 1900 + i);

export const DateInput: React.FC<DateInputProps> = ({ value, onChange, className, placeholder, required }) => {
  const [inputValue, setInputValue] = React.useState("");
  const [open, setOpen] = React.useState(false);

  // The month currently displayed in the calendar (for navigation)
  const [viewMonth, setViewMonth] = React.useState<Date>(() => {
    if (value) {
      const d = new Date(value + "T00:00:00");
      if (isValid(d)) return d;
    }
    return new Date();
  });

  const displayFormat = "MM/dd/yyyy";

  // Sync text input when prop value changes
  React.useEffect(() => {
    if (value) {
      try {
        const date = new Date(value + "T00:00:00");
        if (isValid(date)) {
          setInputValue(format(date, displayFormat));
          setViewMonth(date);
        }
      } catch {
        setInputValue("");
      }
    } else {
      setInputValue("");
    }
  }, [value, displayFormat]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    // Auto-insert separators as the user types forward
    if (val.length > inputValue.length) {
      if (val.length === 2 || val.length === 5) val += "/";
    }
    setInputValue(val);

    if (val.length === displayFormat.length) {
      const parsed = parse(val, displayFormat, new Date());
      if (isValid(parsed)) {
        onChange(format(parsed, "yyyy-MM-dd"));
        setViewMonth(parsed);
      }
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"));
      setInputValue(format(date, displayFormat));
      setViewMonth(date);
      setOpen(false);
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewMonth(prev => setMonth(prev, parseInt(e.target.value)));
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewMonth(prev => setYear(prev, parseInt(e.target.value)));
  };

  const goToPrevMonth = () => setViewMonth(prev => subMonths(prev, 1));
  const goToNextMonth = () => setViewMonth(prev => addMonths(prev, 1));

  const selectCls =
    "appearance-none bg-background border border-border rounded-md px-2 py-1 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer";

  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        placeholder={placeholder || displayFormat.toUpperCase()}
        required={required}
        className="w-full h-9 px-3 pr-10 rounded-lg bg-muted text-sm text-foreground border border-border focus:ring-2 focus:ring-primary/50 focus:outline-none transition-all"
      />
      <div className="absolute right-0 top-0 h-full flex items-center pr-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0 z-[300]" align="end">
            {/* Custom navigation header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="h-7 w-7 opacity-60 hover:opacity-100"
                onClick={goToPrevMonth}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-1">
                <select
                  value={viewMonth.getMonth()}
                  onChange={handleMonthChange}
                  className={selectCls}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i}>{m}</option>
                  ))}
                </select>
                <select
                  value={viewMonth.getFullYear()}
                  onChange={handleYearChange}
                  className={selectCls}
                >
                  {YEARS.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="h-7 w-7 opacity-60 hover:opacity-100"
                onClick={goToNextMonth}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Day picker — hide its own caption since we have ours */}
            <Calendar
              mode="single"
              selected={value ? new Date(value + "T00:00:00") : undefined}
              onSelect={handleDateSelect}
              month={viewMonth}
              onMonthChange={setViewMonth}
              fixedWeeks
              showOutsideDays
              classNames={{
                caption: "hidden", // hide built-in caption; we use our own
                nav: "hidden",      // hide built-in nav buttons too
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};
